import type { Json } from '../database.types'
import { AppError, toAppError } from '../errors'
import { timed, unwrap } from './base'
import { asAccount, bearer } from './identity'
import {
  bytesToBase64,
  isPhotoLimitRaw,
  isPhotoMime,
  photoFromAnswer,
  PhotoLimitError,
  type OccasionPhoto,
  type PhotoMime,
  type PhotoUpload,
} from './photos'
import type { ExportedData } from './types'
import { isMissingServerFeature, throwIfUnavailable } from './unavailable'

// List cover photos (supabase/migrations/20261022160000_list_photos_received_move.sql, part A): the photo a list
// shows on its card in "Listen" and as the big header of the list screen. Stored in Postgres exactly like the
// occasion covers and wish photos (lib/api/photos.ts, lib/api/wishPhotos.ts; ADR docs/decisions/2026-10-20-occasion-
// photos-in-postgres.md): the same limits (PHOTO_LIMITS: WebP/JPEG after the client's re-encode, ≤ 400 KB, ≤ 2048 px),
// the same client pipeline (features/occasions/photo/pipeline.ts preparePhoto()). Quota: 30 own lists with a cover.
//
// Every answer that carries a list has only the meta: `photo = { width, height, updated_at } | null` (types.ts
// ListPhotoMeta — overview cards, upcoming, profile card, list screen, occasion screen `wishlist.photo`, free wishes);
// the bytes come lazily from getListPhoto() after the first paint. Cache them per ['listPhoto', listId,
// photo.updated_at] in MEMORY only (never persisted: other people's covers are other people's data).
// Readers = exactly the list's readers (owner, guest of the occasion, accepted follower of a "Meine Follower" list);
// everybody else and "no cover": one answer, not_found.
// A server without the migration: FeatureUnavailableError ("noch nicht verfügbar"); the export simply has none.
// Every call acts for ONE account (identity.ts asAccount, `expectedUserId` last), like every other wrapper.

/** The database's quota: own lists with a cover per account. */
export const LIST_PHOTOS_PER_OWNER = 30

/** A list cover as the screens use it (the same shape as an occasion cover). */
export type ListPhoto = OccasionPhoto

/** One entry of export_my_list_photos() (a type alias, so it is plain JSON for the export file). */
export type ExportedListPhoto = {
  wishlist_id: string
  /** an occasion's list without its own title carries the occasion's title */
  list_title: string | null
  occasion_id: string | null
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
 * The list owner puts or replaces the cover → its new version. Online only; `photo` must come from preparePhoto()
 * (re-encoded, no metadata). Refusals: 'not_found' (not the owner / the list is gone), 'validation' (bytes, type or
 * size), PhotoLimitError (30 covers), 'consent_required', FeatureUnavailableError (server without the migration).
 */
export function uploadListPhoto(listId: string, photo: PhotoUpload, expectedUserId?: string): Promise<{ updated_at: string }> {
  return timed('set_list_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase
      .rpc('set_list_photo', {
        p_list_id: listId,
        p_mime: photo.mime,
        p_data_base64: bytesToBase64(photo.bytes),
        p_width: photo.width,
        p_height: photo.height,
      })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('list_photos', result.error)
    if (isPhotoLimitRaw(result.error)) throw new PhotoLimitError(result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true || typeof data.updated_at !== 'string') throw new AppError('generic')
    return { updated_at: data.updated_at }
  }))
}

/** The list owner removes the cover (idempotent). Deleting the list removes it by itself (cascade). */
export function deleteListPhoto(listId: string, expectedUserId?: string): Promise<void> {
  return timed('remove_list_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('remove_list_photo', { p_list_id: listId })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('list_photos', result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true) throw new AppError('generic')
  }))
}

/**
 * The cover's bytes for everybody who may read the list. Everyone else — and a list without a cover — gets
 * `not_found` (one answer). The UI turns the Blob into an object URL (URL.createObjectURL) and revokes it later.
 */
export function getListPhoto(listId: string, expectedUserId?: string): Promise<ListPhoto> {
  return timed('get_list_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('get_list_photo', { p_list_id: listId })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('list_photos', result.error)
    return photoFromAnswer(unwrap(result))
  }))
}

/** My own list covers with their bytes — for the data export. A server without the migration has none: []. */
export function exportMyListPhotos(expectedUserId?: string): Promise<ExportedListPhoto[]> {
  return timed('export_my_list_photos', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('export_my_list_photos').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return []
    if (result.error) throw toAppError(result.error)
    const data: unknown = result.data
    if (!Array.isArray(data)) throw new AppError('generic')
    return data.filter((entry): entry is ExportedListPhoto =>
      isRecord(entry) && typeof entry.wishlist_id === 'string' && isPhotoMime(entry.mime) && typeof entry.data_base64 === 'string')
  }))
}

/** The export file with my list covers (`list_photos`, after the RPC's keys). */
export function withListPhotos(data: ExportedData, photos: readonly ExportedListPhoto[]): ExportedData {
  if (!isRecord(data)) return data
  return { ...(data as Record<string, Json | undefined>), list_photos: photos.map((photo) => ({ ...photo })) }
}
