import type { Json } from '../database.types'
import { AppError, toAppError } from '../errors'
import { timed, unwrap } from './base'
import { asAccount, bearer } from './identity'
import {
  bytesToBase64,
  isMissingFunction,
  isPhotoLimitRaw,
  isPhotoMime,
  photoFromAnswer,
  PhotoLimitError,
  type OccasionPhoto,
  type PhotoMime,
  type PhotoUpload,
} from './photos'
import type { ExportedData } from './types'

// Wish photos (supabase/migrations/20261022120000_wish_details.sql): the product picture of a wish, stored in
// Postgres exactly like the occasion covers (lib/api/photos.ts, ADR docs/decisions/2026-10-20-occasion-photos-in-
// postgres.md). The same limits (PHOTO_LIMITS: WebP/JPEG after the client's re-encode, ≤ 400 KB, ≤ 2048 px) and the
// same client pipeline (features/occasions/photo/pipeline.ts preparePhoto()). The quota is 100 own wishes with a
// photo (PhotoLimitError).
//
// Where the picture comes from (privacy rule: friends' browsers never contact a shop):
//   owner's browser → POST /api/link-image (our Worker, lib/api/linkImage.ts fetchLinkImage) → Blob
//   → preparePhoto(blob) (downscale + re-encode, no metadata) → uploadWishPhoto(wishId, prepared)
//   everybody who may read the wish → getWishPhoto(wishId) → Blob from OUR database (never the shop's URL).
// The wish answers of every screen RPC carry only the meta: `photo = { width, height, updated_at } | null`
// (types.ts WishPhotoMeta); the bytes come lazily through getWishPhoto() after the first paint.
// Every call acts for ONE account (identity.ts asAccount, `expectedUserId` last), like every other wrapper.

/** The database's quota: own wishes with a photo per account. */
export const WISH_PHOTOS_PER_OWNER = 100

/** A wish photo as the screens use it (the same shape as an occasion cover). */
export type WishPhoto = OccasionPhoto

/** One entry of export_my_wish_photos() (a type alias, so it is plain JSON for the export file). */
export type ExportedWishPhoto = {
  wish_id: string
  wish_title: string
  wishlist_id: string
  mime: PhotoMime
  width: number
  height: number
  size_bytes: number
  updated_at: string
  data_base64: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The list owner puts or replaces the wish's photo → its new version. Online only; `photo` must come from
 * preparePhoto() (re-encoded, no metadata). Refusals: 'not_found' (not the owner / the wish is gone),
 * 'validation' (bytes, type or size), PhotoLimitError (100 photos), 'consent_required'.
 */
export function uploadWishPhoto(wishId: string, photo: PhotoUpload, expectedUserId?: string): Promise<{ updated_at: string }> {
  return timed('set_wish_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase
      .rpc('set_wish_photo', {
        p_wish_id: wishId,
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

/** The list owner removes the wish's photo (idempotent). Deleting the wish removes it by itself (cascade). */
export function deleteWishPhoto(wishId: string, expectedUserId?: string): Promise<void> {
  return timed('remove_wish_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('remove_wish_photo', { p_wish_id: wishId })
      .setHeader('Authorization', bearer(account))
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true) throw new AppError('generic')
  }))
}

/**
 * The photo's bytes for everybody who may read the wish (owner, guest of the occasion, accepted follower of a
 * "Meine Follower" list). Everyone else — and a wish without a photo — gets `not_found` (one answer). The UI turns
 * the Blob into an object URL (URL.createObjectURL) and caches it per ['wishPhoto', wishId, photo.updated_at] in
 * memory only (never persisted, like the occasion covers).
 */
export function getWishPhoto(wishId: string, expectedUserId?: string): Promise<WishPhoto> {
  return timed('get_wish_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('get_wish_photo', { p_wish_id: wishId })
      .setHeader('Authorization', bearer(account))
    return photoFromAnswer(unwrap(result))
  }))
}

/**
 * My own wish photos with their bytes — for the data export (features/account adds them next to the occasion
 * covers). A server without the migration has no wish photos at all: [].
 */
export function exportMyWishPhotos(expectedUserId?: string): Promise<ExportedWishPhoto[]> {
  return timed('export_my_wish_photos', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('export_my_wish_photos').setHeader('Authorization', bearer(account))
    if (isMissingFunction(result.error)) return []
    if (result.error) throw toAppError(result.error)
    const data: unknown = result.data
    if (!Array.isArray(data)) throw new AppError('generic')
    return data.filter((entry): entry is ExportedWishPhoto =>
      isRecord(entry) && typeof entry.wish_id === 'string' && isPhotoMime(entry.mime) && typeof entry.data_base64 === 'string')
  }))
}

/** The export file with my wish photos (`wish_photos`, after the RPC's keys). */
export function withWishPhotos(data: ExportedData, photos: readonly ExportedWishPhoto[]): ExportedData {
  if (!isRecord(data)) return data
  return { ...(data as Record<string, Json | undefined>), wish_photos: photos.map((photo) => ({ ...photo })) }
}
