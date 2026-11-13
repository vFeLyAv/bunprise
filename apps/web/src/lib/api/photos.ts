import type { Json } from '../database.types'
import { AppError, toAppError } from '../errors'
import { timed, unwrap } from './base'
import { asAccount, bearer } from './identity'
import type { ExportedData } from './types'

// Occasion cover photos (supabase/migrations/20261020160000_occasion_photos.sql, ADR
// docs/decisions/2026-10-20-occasion-photos-in-postgres.md). The bytes live in Postgres and travel as base64
// inside the RPC envelopes; access follows the occasion's own membership rules in the database.
// Every call acts for ONE account (identity.ts asAccount, `expectedUserId` last), like every other wrapper.
//
// THE documented exception to "one RPC per screen": get_occasion_screen() carries only the cover's meta
// (occasion.photo = { width, height, updated_at } | null) — enough to lay the screen out at once — and the
// occasion screen asks get_occasion_photo() for the bytes AFTER its first paint (features/occasions/photo).
// The screen's own answer stays small; a tinted skeleton of the right size stands in meanwhile.

export type PhotoMime = 'image/webp' | 'image/jpeg'

export const PHOTO_MIMES: readonly PhotoMime[] = ['image/webp', 'image/jpeg']

/** Client limits = database limits (the client re-encodes, the database checks again). */
export const PHOTO_LIMITS = {
  /** decoded bytes the database takes (400 KB) */
  maxBytes: 409_600,
  /** stated size, each side */
  maxSide: 2048,
  /** the client re-encodes to at most this long side */
  targetSide: 1600,
  /** a picked file above this is refused before it is decoded (20 MB) */
  inputMaxBytes: 20 * 1024 * 1024,
  /** hosted occasions with a photo per account (the database's quota) */
  perHost: 20,
} as const

/** What the client uploads: re-encoded bytes (no metadata) and their real size in pixels. */
export interface PhotoUpload {
  mime: PhotoMime
  bytes: Uint8Array
  width: number
  height: number
}

/** A cover as the screens use it. */
export interface OccasionPhoto {
  mime: PhotoMime
  blob: Blob
  width: number
  height: number
  /** the version (= occasion.photo.updated_at of the screen) */
  updated_at: string
}

/** One entry of export_my_occasion_photos() (a type alias, so it is plain JSON for the export file). */
export type ExportedOccasionPhoto = {
  occasion_id: string
  occasion_title: string
  mime: PhotoMime
  width: number
  height: number
  size_bytes: number
  updated_at: string
  data_base64: string
}

/**
 * The database's quota (at most 20 hosted occasions with a photo) — its own error, so the UI can say what
 * to do. Code `validation` for everything else that reads errors generically.
 */
export class PhotoLimitError extends AppError {
  constructor(cause?: unknown) {
    super('validation', { cause })
    this.name = 'PhotoLimitError'
  }
}

export function isPhotoLimitError(err: unknown): err is PhotoLimitError {
  return err instanceof PhotoLimitError
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The raw PostgREST error of the quota (P0001 'photo_limit'); the shared mapping would make it 'generic'. */
export function isPhotoLimitRaw(error: unknown): boolean {
  return isRecord(error) && error.code === 'P0001' && error.message === 'photo_limit'
}

/** PostgREST "function not found" (a server without the photo migration): there can be no photos then. */
export function isMissingFunction(error: unknown): boolean {
  return isRecord(error) && error.code === 'PGRST202'
}

// ---- base64 (the transport of the bytes) ----------------------------------------------------------

type WithBase64 = Uint8Array & { toBase64?: () => string }
type Uint8ArrayFromBase64 = { fromBase64?: (text: string) => Uint8Array }

/** Standard base64 with padding (what decode(text, 'base64') reads). */
export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as WithBase64).toBase64
  if (typeof native === 'function') return native.call(bytes)
  let binary = ''
  const CHUNK = 0x8000 // keeps the argument list of fromCharCode small
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  const native = (Uint8Array as unknown as Uint8ArrayFromBase64).fromBase64
  if (typeof native === 'function') return native(text)
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export const isPhotoMime = (value: unknown): value is PhotoMime => value === 'image/webp' || value === 'image/jpeg'
const isMime = isPhotoMime
const isSide = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= PHOTO_LIMITS.maxSide

// ---- RPCs ---------------------------------------------------------------------------------------------

/** The host puts or replaces the cover → its new version. Online only; the caller re-encoded the bytes. */
export function setOccasionPhoto(occasionId: string, photo: PhotoUpload, expectedUserId?: string): Promise<{ updated_at: string }> {
  return timed('set_occasion_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase
      .rpc('set_occasion_photo', {
        p_occasion_id: occasionId,
        p_mime: photo.mime,
        p_data_base64: bytesToBase64(photo.bytes),
        p_width: photo.width,
        p_height: photo.height,
      })
      .setHeader('Authorization', bearer(account))
    if (isPhotoLimitRaw(result.error)) throw new PhotoLimitError(result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true || typeof data.updated_at !== 'string') throw new AppError('generic')
    return { updated_at: data.updated_at }
  }))
}

/** The host removes the cover (idempotent). */
export function removeOccasionPhoto(occasionId: string, expectedUserId?: string): Promise<void> {
  return timed('remove_occasion_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('remove_occasion_photo', { p_occasion_id: occasionId })
      .setHeader('Authorization', bearer(account))
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true) throw new AppError('generic')
  }))
}

/**
 * The cover's bytes for the host or an active member. Everyone else — and a cover that is gone — gets
 * `not_found` (the database gives one answer for both).
 */
export function getOccasionPhoto(occasionId: string, expectedUserId?: string): Promise<OccasionPhoto> {
  return timed('get_occasion_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('get_occasion_photo', { p_occasion_id: occasionId })
      .setHeader('Authorization', bearer(account))
    return photoFromAnswer(unwrap(result))
  }))
}

/**
 * The answer of get_occasion_photo / get_wish_photo ({ mime, data (base64), width, height, updated_at }) as a
 * Blob with its meta; anything malformed is AppError 'generic'.
 */
export function photoFromAnswer(data: unknown): OccasionPhoto {
  if (!isRecord(data) || !isMime(data.mime) || typeof data.data !== 'string' || !isSide(data.width) || !isSide(data.height)
    || typeof data.updated_at !== 'string') {
    throw new AppError('generic')
  }
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(data.data)
  } catch (err) {
    throw new AppError('generic', { cause: err })
  }
  // a copy into a plain ArrayBuffer: Blob parts must not be views of a shared buffer
  const blob = new Blob([bytes.slice().buffer], { type: data.mime })
  return { mime: data.mime, blob, width: data.width, height: data.height, updated_at: data.updated_at }
}

/**
 * My own covers (occasions I host) with their bytes — the client adds them to the data export
 * (features/account ExportPage). A server without the photo migration has no photos at all: [].
 */
export function exportMyOccasionPhotos(expectedUserId?: string): Promise<ExportedOccasionPhoto[]> {
  return timed('export_my_occasion_photos', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('export_my_occasion_photos').setHeader('Authorization', bearer(account))
    if (isMissingFunction(result.error)) return []
    if (result.error) throw toAppError(result.error)
    const data: unknown = result.data
    if (!Array.isArray(data)) throw new AppError('generic')
    return data.filter((entry): entry is ExportedOccasionPhoto =>
      isRecord(entry) && typeof entry.occasion_id === 'string' && isMime(entry.mime) && typeof entry.data_base64 === 'string')
  }))
}

/** The export file with my covers (`occasion_photos`, after the RPC's keys). */
export function withOccasionPhotos(data: ExportedData, photos: readonly ExportedOccasionPhoto[]): ExportedData {
  if (!isRecord(data)) return data
  return { ...(data as Record<string, Json | undefined>), occasion_photos: photos.map((photo) => ({ ...photo })) }
}
