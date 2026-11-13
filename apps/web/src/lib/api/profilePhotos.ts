import type { Json } from '../database.types'
import { AppError, toAppError } from '../errors'
import { timed, unwrap } from './base'
import { asAccount, bearer } from './identity'
import { bytesToBase64, isPhotoMime, photoFromAnswer, type OccasionPhoto, type PhotoMime, type PhotoUpload } from './photos'
import type { ExportedData } from './types'
import { isMissingServerFeature, throwIfUnavailable } from './unavailable'

// A person's own PROFILE PHOTO (the round picture instead of the initials) and own BANNER PHOTO (instead of a preset
// banner) — supabase/migrations/20261024120000_profile_photos.sql. Stored in Postgres exactly like the occasion covers,
// wish photos and list covers (lib/api/photos.ts, wishPhotos.ts, listPhotos.ts; ADR docs/decisions/2026-10-20-occasion-
// photos-in-postgres.md): the same limits (PHOTO_LIMITS: WebP/JPEG after the client's re-encode, ≤ 400 KB, ≤ 2048 px),
// the same client pipeline (features/occasions/photo/pipeline.ts preparePhoto(); the avatar as a 512 px square).
// One photo of each kind per person (the database's primary key); replacing is always fine.
//
// WHO SEES THEM — the database decides (private.knows_profile): exactly the people who may see the person's profile
// card — the person, guests of a shared occasion, a visible follow relation (accepted either way, a pending request
// the viewer sent or can see), never across a block, never a stranger. Every answer that shows a person carries only
// the meta: `photo` / `banner_photo` = { width, height, updated_at } | null (profile cards, get_me, the overview's
// `me` and suggestions, occasion host and members); the bytes come lazily from getProfilePhoto() after the first
// paint. Cache them per ['profilePhoto', profileId, kind, updated_at] in MEMORY only (other people's photos are other
// people's data). Everybody else and "no photo": one answer, not_found.
// A server without the migration: FeatureUnavailableError ("Das geht bald"); the export simply has none.
// Every call acts for ONE account (identity.ts asAccount, `expectedUserId` last), like every other wrapper.

export type ProfilePhotoKind = 'avatar' | 'banner'
export const PROFILE_PHOTO_KINDS: readonly ProfilePhotoKind[] = ['avatar', 'banner']

/** A profile / banner photo as the screens use it (the same shape as an occasion cover). */
export type ProfilePhoto = OccasionPhoto

/** One entry of export_my_profile_photos() (a type alias, so it is plain JSON for the export file). */
export type ExportedProfilePhoto = {
  kind: ProfilePhotoKind
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

export const isProfilePhotoKind = (value: unknown): value is ProfilePhotoKind => value === 'avatar' || value === 'banner'

/**
 * Puts or replaces my own photo of one kind → its new version. Online only; `photo` must come from preparePhoto()
 * (re-encoded, no metadata). Refusals: 'validation' (bytes, type, size, kind), 'consent_required',
 * FeatureUnavailableError (server without the migration).
 */
export function uploadProfilePhoto(kind: ProfilePhotoKind, photo: PhotoUpload, expectedUserId?: string): Promise<{ updated_at: string }> {
  return timed('set_profile_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase
      .rpc('set_profile_photo', {
        p_kind: kind,
        p_mime: photo.mime,
        p_data_base64: bytesToBase64(photo.bytes),
        p_width: photo.width,
        p_height: photo.height,
      })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('profile_photos', result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true || typeof data.updated_at !== 'string') throw new AppError('generic')
    return { updated_at: data.updated_at }
  }))
}

/** Removes my own photo of one kind (idempotent). Deleting the account removes both by itself (cascade). */
export function deleteProfilePhoto(kind: ProfilePhotoKind, expectedUserId?: string): Promise<void> {
  return timed('remove_profile_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('remove_profile_photo', { p_kind: kind })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('profile_photos', result.error)
    const data: unknown = unwrap(result)
    if (!isRecord(data) || data.ok !== true) throw new AppError('generic')
  }))
}

/**
 * A person's photo of one kind, for everybody who may see the person's card. Everyone else — and "no photo" — gets
 * `not_found` (one answer). The UI turns the Blob into an object URL (lib/objectUrl.ts) and revokes it later.
 */
export function getProfilePhoto(profileId: string, kind: ProfilePhotoKind, expectedUserId?: string): Promise<ProfilePhoto> {
  return timed('get_profile_photo', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('get_profile_photo', { p_profile_id: profileId, p_kind: kind })
      .setHeader('Authorization', bearer(account))
    throwIfUnavailable('profile_photos', result.error)
    return photoFromAnswer(unwrap(result))
  }))
}

/** My own profile and banner photo with their bytes — for the data export. A server without the migration: []. */
export function exportMyProfilePhotos(expectedUserId?: string): Promise<ExportedProfilePhoto[]> {
  return timed('export_my_profile_photos', () => asAccount(expectedUserId, async (account) => {
    const result = await account.supabase.rpc('export_my_profile_photos').setHeader('Authorization', bearer(account))
    if (isMissingServerFeature(result.error)) return []
    if (result.error) throw toAppError(result.error)
    const data: unknown = result.data
    if (!Array.isArray(data)) throw new AppError('generic')
    return data.filter((entry): entry is ExportedProfilePhoto =>
      isRecord(entry) && isProfilePhotoKind(entry.kind) && isPhotoMime(entry.mime) && typeof entry.data_base64 === 'string')
  }))
}

/** The export file with my profile photos (`profile_photos`, after the RPC's keys). */
export function withProfilePhotos(data: ExportedData, photos: readonly ExportedProfilePhoto[]): ExportedData {
  if (!isRecord(data)) return data
  return { ...(data as Record<string, Json | undefined>), profile_photos: photos.map((photo) => ({ ...photo })) }
}
