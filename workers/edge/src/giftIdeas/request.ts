import { ApiError, isRecord, readBytes, withDeadline } from '../http'
import { isCatalogLang, isGiftInterest, isGiftStyle, parseCursor } from './catalog'
import type { CatalogRequest, GiftInterest, GiftStyle } from './catalog'

// The body of POST /api/gift-ideas, exactly as the contract describes it (apps/web/src/lib/api/giftIdeas.ts;
// the demo server applies the same rules, apps/web/src/mocks/giftIdeas.ts readBody) — anything else is a 400.
// It carries category ids and a budget, never anything about a person; `mode` is checked and then dropped.

/** 200 ids of 64 characters are ≈ 13 KiB of JSON. */
const BODY_MAX = 16 * 1024
const INTERESTS_MAX = 8
/** taste directions (27.10): a few ids of a fixed vocabulary, never a brand or a wish */
const STYLES_MAX = 6
const EXCLUDE_MAX = 200
const CURSOR_MAX = 512
/** = the database limit of a wish price; also "no upper limit" of a budget */
const PRICE_MAX = 100_000_000
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/
const TOPIC_PATTERN = /^[a-z]{1,32}$/

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= PRICE_MAX

export async function readGiftIdeasRequest(req: Request): Promise<CatalogRequest> {
  const contentType = req.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new ApiError('invalid_request')
  const bytes = await withDeadline(5000, (signal) => readBytes(req, BODY_MAX, signal))
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
  } catch {
    throw new ApiError('invalid_request')
  }
  return parseGiftIdeasBody(body)
}

export function parseGiftIdeasBody(body: unknown): CatalogRequest {
  if (!isRecord(body)) throw new ApiError('invalid_request')
  const { mode, interests, budget, exclude_ids: exclude, lang, cursor, topic, styles } = body
  if (styles !== undefined && styles !== null && (!Array.isArray(styles) || styles.length > STYLES_MAX || !styles.every((value) => typeof value === 'string'))) {
    throw new ApiError('invalid_request')
  }
  // a shelf ("Stöbern nach Thema"): its id only — an unknown but well-formed id is an empty shelf, not an error
  if (topic !== undefined && topic !== null && (typeof topic !== 'string' || !TOPIC_PATTERN.test(topic))) throw new ApiError('invalid_request')
  if (mode !== 'for_someone' && mode !== 'for_me') throw new ApiError('invalid_request')
  if (!Array.isArray(interests) || interests.length > INTERESTS_MAX || !interests.every((value) => typeof value === 'string')) {
    throw new ApiError('invalid_request')
  }
  if (!isRecord(budget) || !isCents(budget.min_cents) || !isCents(budget.max_cents) || budget.min_cents > budget.max_cents) {
    throw new ApiError('invalid_request')
  }
  if (!Array.isArray(exclude) || exclude.length > EXCLUDE_MAX || !exclude.every((value) => typeof value === 'string')) {
    throw new ApiError('invalid_request')
  }
  // the app's UI language (30.10: de, en, ru, uk); older apps send only de / en — each text falls back per field
  if (!isCatalogLang(lang)) throw new ApiError('invalid_request')
  let start: number | undefined
  if (cursor !== undefined && cursor !== null) {
    if (typeof cursor !== 'string' || cursor.length > CURSOR_MAX) throw new ApiError('invalid_request')
    const parsed = parseCursor(cursor)
    if (parsed === null) throw new ApiError('invalid_request')
    start = parsed
  }
  // unknown interest ids are dropped (the shared vocabulary may grow on one side first), each once
  const known: GiftInterest[] = []
  for (const value of interests) if (isGiftInterest(value) && !known.includes(value)) known.push(value)
  // the same for the taste directions: unknown ids are dropped, each once
  const tastes: GiftStyle[] = []
  for (const value of Array.isArray(styles) ? styles : []) if (isGiftStyle(value) && !tastes.includes(value)) tastes.push(value)
  return {
    interests: known,
    budget: { min_cents: budget.min_cents, max_cents: budget.max_cents },
    exclude_ids: exclude.filter((id) => ID_PATTERN.test(id)),
    lang,
    ...(start === undefined ? {} : { start }),
    ...(typeof topic === 'string' ? { topic } : {}),
    ...(tastes.length > 0 ? { styles: tastes } : {}),
  }
}
