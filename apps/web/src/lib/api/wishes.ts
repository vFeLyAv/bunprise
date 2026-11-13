import { AppError } from '../errors'
import { timed, unwrap, unwrapVoid } from './base'
import { asAccount, bearer } from './identity'
import type { Wish, WishInput, WishWithList } from './types'
import { throwIfUnavailable } from './unavailable'
import { QUANTITY_MAX, QUANTITY_MIN, wishQuantityEnabled } from './wishExtras'

// Wishes (owner only through REST). Deleting a wish (hard delete) ends an active reservation
// inside the database — the owner never learns whether there was one. The "undo 5 s" of the
// product spec is client-side: send the delete after the toast's undo window (pilot-decisions §1).
// Every call is pinned to one account (identity.ts asAccount, optional expected account).

// No updated_at: since wave 2b M1 (20261020200000_lists_standalone.sql, P9) it is not REST-readable — selecting it
// would fail with 42501. The owner gets it in the data export.
// + the details of 20261022120000_wish_details.sql (description, brand, color, gtin, shop_name; the photo is RPC only).
// + received_at of 20261022160000 ("Erhalten"; REST-readable, written only by set_wish_received → setWishReceived).
const BASE_COLUMNS = 'id, wishlist_id, title, price_cents, currency, url, note, priority, created_at'
const DETAIL_COLUMNS = `${BASE_COLUMNS}, description, brand, color, gtin, shop_name`
const WISH_COLUMNS = `${DETAIL_COLUMNS}, received_at`
// + quantity of 20261030120000 ("Anzahl"), only behind VITE_WISH_QUANTITY (an older database has no such column)
const QUANTITY_COLUMNS = `${WISH_COLUMNS}, quantity`
const fullColumns = () => (wishQuantityEnabled() ? QUANTITY_COLUMNS : WISH_COLUMNS)

/** The detail columns and their database limits (characters = code points, like Postgres length()). */
export const WISH_DETAIL_LIMITS = { description: 1000, brand: 80, color: 60, shop_name: 80 } as const
type DetailKey = 'description' | 'brand' | 'color' | 'gtin' | 'shop_name'
const DETAIL_KEYS: readonly DetailKey[] = ['description', 'brand', 'color', 'gtin', 'shop_name']

/** Trims (all whitespace), drops an empty value and cuts to the database limit; null / undefined stay as they are. */
function cleanDetail(value: string | null | undefined, max: number, multiline: boolean): string | null | undefined {
  if (value === undefined || value === null) return value
  const text = multiline
    // line breaks stay (at most one empty line in a row), every line trimmed and its whitespace collapsed
    ? value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
    : value.replace(/\s+/g, ' ').trim()
  if (text === '') return null
  const chars = [...text]
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : text
}

/** GTIN / EAN: digits only after removing spaces and dashes, 8 … 14 of them; anything else → null. */
export function normalizeGtin(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value
  const digits = value.replace(/[\s-]/g, '')
  return /^[0-9]{8,14}$/.test(digits) ? digits : null
}

/** The payload as the database checks it: title trimmed, the details cleaned (see cleanDetail / normalizeGtin). */
function cleanInput<T extends Partial<WishInput>>(input: T): T {
  const values: T = { ...input }
  if (typeof values.title === 'string') values.title = values.title.trim()
  if ('description' in values) values.description = cleanDetail(values.description, WISH_DETAIL_LIMITS.description, true)
  if ('brand' in values) values.brand = cleanDetail(values.brand, WISH_DETAIL_LIMITS.brand, false)
  if ('color' in values) values.color = cleanDetail(values.color, WISH_DETAIL_LIMITS.color, false)
  if ('shop_name' in values) values.shop_name = cleanDetail(values.shop_name, WISH_DETAIL_LIMITS.shop_name, false)
  if ('gtin' in values) values.gtin = normalizeGtin(values.gtin)
  // "Anzahl": only behind its flag, a whole number 1..10 (the database's CHECK)
  if ('quantity' in values) {
    if (!wishQuantityEnabled() || values.quantity === undefined) delete values.quantity
    else values.quantity = Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, Math.round(values.quantity)))
  }
  return values
}

/**
 * A server WITHOUT 20261022120000 does not know the detail columns: PostgREST answers PGRST204 ("column not in
 * the schema cache", for the payload) or Postgres 42703 (undefined column, for the select). The failed statement
 * changed nothing, so the wrapper repeats it once without the details — the wish is saved, its details are not.
 */
function isMissingColumn(error: unknown, keys: readonly string[]): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  const text = typeof message === 'string' ? message : ''
  return (code === 'PGRST204' || code === '42703') && keys.some((key) => text.includes(key))
}
const isMissingDetailColumn = (error: unknown) => isMissingColumn(error, DETAIL_KEYS)
/** A server with the details but without 20261022160000: only `received_at` is unknown (it is never written). */
const isMissingReceivedColumn = (error: unknown) => isMissingColumn(error, ['received_at'])
/** A server without 20261030120000: `quantity` is unknown (payload and select). */
const isMissingQuantityColumn = (error: unknown) => isMissingColumn(error, ['quantity'])

function withoutQuantity<T extends Partial<WishInput>>(values: T): T {
  const copy: T = { ...values }
  delete copy.quantity
  return copy
}

function withoutDetails<T extends Partial<WishInput>>(values: T): T {
  const copy: T = { ...values }
  for (const key of DETAIL_KEYS) delete copy[key]
  return copy
}

/** Legacy rows get the detail keys (and received_at) as null, so callers always see the full Wish shape. */
function withNullDetails(row: Record<string, unknown>): Wish {
  return { description: null, brand: null, color: null, gtin: null, shop_name: null, received_at: null, ...row } as Wish
}

type WishValues = Partial<WishInput>

/**
 * One write (insert or update … returning). On an older server: once more without received_at (a server with the
 * details), then without the details too (a server before 20261022120000). A failed statement changed nothing.
 */
async function writeWish(
  run: (values: WishValues, columns: string) => PromiseLike<{ data: unknown; error: unknown }>,
  values: WishValues,
): Promise<Wish> {
  let result = await run(values, fullColumns())
  // a server without the quantity column: once more without it (the wish is saved, its quantity stays 1)
  if (isMissingQuantityColumn(result.error)) {
    values = withoutQuantity(values)
    result = await run(values, WISH_COLUMNS)
  }
  if (isMissingReceivedColumn(result.error)) result = await run(values, DETAIL_COLUMNS)
  if (isMissingDetailColumn(result.error)) {
    const legacy = await run(withoutDetails(values), BASE_COLUMNS)
    return withNullDetails(unwrap(legacy) as Record<string, unknown>)
  }
  return withNullDetails(unwrap(result) as Record<string, unknown>)
}

/**
 * Cleans a typed link: adds https:// when the scheme is missing, allows only http(s),
 * rejects javascript:/data: and anything over 2048 chars. Returns null for an empty field.
 */
export function normalizeWishUrl(raw: string | null | undefined): string | null | 'invalid' {
  const text = (raw ?? '').trim()
  if (text === '') return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid'
    if (!url.hostname.includes('.')) return 'invalid'
    const normalized = url.toString()
    return normalized.length > 2048 ? 'invalid' : normalized
  } catch {
    return 'invalid'
  }
}

/**
 * Creates a wish (owner only, RLS). The details (description, brand, color, gtin, shop_name) are optional; they are
 * cleaned like the database checks them (cleanInput). The photo is a separate step AFTER the wish exists:
 * uploadWishPhoto() in lib/api/wishPhotos.ts.
 */
export function createWish(wishlistId: string, input: WishInput, expectedUserId?: string): Promise<Wish> {
  return asAccount(expectedUserId, (account) =>
    writeWish((values, columns) => account.supabase
      .from('wishes')
      .insert({ ...(values as WishInput), wishlist_id: wishlistId })
      .select(columns)
      .single()
      .setHeader('Authorization', bearer(account)), { ...cleanInput(input) }))
}

/** Changes the given fields (owner only, RLS); details: '' or blank → null (cleared). */
export function updateWish(wishId: string, patch: Partial<WishInput>, expectedUserId?: string): Promise<Wish> {
  return asAccount(expectedUserId, (account) =>
    writeWish((values, columns) => account.supabase.from('wishes').update(values).eq('id', wishId).select(columns).single()
      .setHeader('Authorization', bearer(account)), { ...cleanInput(patch) }))
}

export function deleteWish(wishId: string, expectedUserId?: string): Promise<void> {
  return asAccount(expectedUserId, async (account) => {
    unwrapVoid(await account.supabase.from('wishes').delete().eq('id', wishId).setHeader('Authorization', bearer(account)))
  })
}

/**
 * The list row next to the wish: PostgREST embeds the many-to-one wishes.wishlist_id → wishlists.id
 * in the SAME request. Only columns of the v1.1 column grant on wishlists; RLS of both tables applies
 * (members of the occasion read, everyone else gets no row → not_found).
 */
const LIST_EMBED = 'wishlist:wishlists(id, occasion_id, owner_id)'

function isListRef(value: unknown): value is WishWithList['wishlist'] {
  if (typeof value !== 'object' || value === null) return false
  const list = value as Record<string, unknown>
  // occasion_id is null for a list without an occasion (wave 2b M1)
  return typeof list.id === 'string' && (typeof list.occasion_id === 'string' || list.occasion_id === null) && typeof list.owner_id === 'string'
}

/**
 * Single wish for the edit form (RLS: readable by list members, editable by the owner), with the
 * occasion and the owner of its list: a deep-linked form knows where "Zurück" / "Speichern" lead
 * and whether this account may edit (and delete) it at all. A wish whose list is not readable
 * counts as not found — one answer for "does not exist" and "not yours".
 */
export function getWish(wishId: string, expectedUserId?: string): Promise<WishWithList> {
  return asAccount(expectedUserId, async (account) => {
    const read = (columns: string) => account.supabase.from('wishes').select(`${columns}, ${LIST_EMBED}`).eq('id', wishId).single()
      .setHeader('Authorization', bearer(account))
    let result = await read(fullColumns())
    if (isMissingQuantityColumn(result.error)) result = await read(WISH_COLUMNS) // a server before 20261030120000
    if (isMissingReceivedColumn(result.error)) result = await read(DETAIL_COLUMNS) // a server before 20261022160000
    if (isMissingDetailColumn(result.error)) result = await read(BASE_COLUMNS) // a server without the details
    const data = unwrap(result) as unknown as Record<string, unknown>
    const row = withNullDetails(data) as unknown as WishWithList
    if (!isListRef(row.wishlist) || row.wishlist.id !== row.wishlist_id) throw new AppError('not_found')
    return row
  })
}

// ---- "Erhalten" and moving a wish (20261022160000_list_photos_received_move.sql, parts B and C) ------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * set_wish_received(p_wish_id, p_received) → { ok, received_at } — the list owner marks a wish as received
 * ("Erhalten") or un-marks it. Marking again keeps the first moment. Not optimistic about reservations: the database
 * never touches them (a giver keeps an existing reservation and sees the wish as received; nobody can reserve it
 * newly; un-marking restores it). Refusals: 'not_found' (not the owner / gone), FeatureUnavailableError (a server
 * without the migration — show "noch nicht verfügbar").
 */
export function setWishReceived(wishId: string, received: boolean, expectedUserId?: string): Promise<{ received_at: string | null }> {
  return timed('set_wish_received', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('set_wish_received', { p_wish_id: wishId, p_received: received })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('wish_received', result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true || !(typeof data.received_at === 'string' || data.received_at === null)) {
      throw new AppError('generic')
    }
    if ((data.received_at !== null) !== received) throw new AppError('generic')
    return { received_at: data.received_at }
  }))
}

/**
 * move_wish(p_wish_id, p_target_list_id) → { ok } — moves a wish (with its photo, details and "Erhalten") to another
 * list of the SAME owner. The answer is always the same; whatever happens to reservations happens inside the
 * database (a giver who cannot read the target list loses the reservation as 'wish_moved'). Refusals: 'not_found'
 * (not the owner of both lists / gone — one answer), 'consent_required' (moving into a list others can read),
 * FeatureUnavailableError (a server without the migration). Moving into the same list does nothing.
 */
export function moveWish(wishId: string, targetListId: string, expectedUserId?: string): Promise<void> {
  return timed('move_wish', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('move_wish', { p_wish_id: wishId, p_target_list_id: targetListId })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('move_wish', result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true) throw new AppError('generic')
  }))
}
