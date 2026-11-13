import type { JsonBodyType } from 'msw'
import type { ProfilePhotoMeta } from '../lib/api/types'
import annaAvatarDataUrl from './assets/demo-avatar-anna.webp?inline'
import annaBannerDataUrl from './assets/demo-banner-anna.webp?inline'
import paulaAvatarDataUrl from './assets/demo-avatar-paula.webp?inline'
import { bytesMatch, decodeBase64, demoPhotoDelays, photoRpcHandler } from './photos'
import { raise } from './rest'
import type { DemoWorld } from './world'

// A person's own profile photo and banner photo on the demo server (docs/demo-mode.md): the four RPCs of
// supabase/migrations/20261024120000_profile_photos.sql, re-implemented on the in-memory world like src/mocks/listPhotos.ts
// does for list covers (an independent copy of the rules, so tests compare the two):
//   set_profile_photo / remove_profile_photo — the caller's OWN photo of a kind ('avatar' | 'banner'), one each;
//   get_profile_photo — whoever may see the person's card (the follow graph's knowsProfile: self, a shared active
//                       occasion, a visible follow relation, never across a block); everyone else and "no photo":
//                       ONE answer, not_found;
//   export_my_profile_photos — the caller's own photos, ordered by kind;
//   limits: kind avatar|banner, mime webp|jpeg, 1 … 2048 px, base64 → 1 … 409600 bytes, magic bytes.
// Every answer that shows a person gets the meta through fieldsFor(viewer, person) (the visibility rule) or, for the
// caller's own answers (get_me, the overview's `me`), ownMeta(person, kind).
// Cascade: a photo is served only while its person exists (a deleted account leaves nothing readable).
// Memory only: a reload resets the photos with the world. Two demo friends start with a photo — invented
// illustrations drawn from our own SVG (assets/demo-avatar-anna.webp: a sunflower; demo-banner-anna.webp: hills at
// sunrise; demo-avatar-paula.webp: a cup of tea) — no people, no brands.

export type DemoPhotoKind = 'avatar' | 'banner'

const MAX_BYTES = 409_600
const MAX_BASE64 = 546_136
const MAX_SIDE = 2048

interface StoredProfilePhoto {
  mime: 'image/webp' | 'image/jpeg'
  data: string
  size: number
  width: number
  height: number
  updated_at: string
}

const isSide = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE
const isKind = (value: unknown): value is DemoPhotoKind => value === 'avatar' || value === 'banner'
const base64Of = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1)

/** The bundled demo pictures (base64 of the WebP files) and their sizes. */
export const DEMO_PROFILE_PHOTOS = {
  annaAvatar: { data: () => base64Of(annaAvatarDataUrl), width: 512, height: 512 },
  annaBanner: { data: () => base64Of(annaBannerDataUrl), width: 1200, height: 480 },
  paulaAvatar: { data: () => base64Of(paulaAvatarDataUrl), width: 512, height: 512 },
} as const

export function createDemoProfilePhotos(world: DemoWorld, clock: () => number = Date.now) {
  const t = world.internals
  const graph = world.follows
  const photos = new Map<string, StoredProfilePhoto>()
  const slot = (profileId: string, kind: DemoPhotoKind) => `${profileId}:${kind}`
  let lastStamp = 0

  function stamp(): string {
    lastStamp = Math.max(clock(), lastStamp + 1)
    return new Date(lastStamp).toISOString()
  }

  /** A photo only while its person still exists (cascade); else it is dropped. */
  function live(profileId: string, kind: DemoPhotoKind): StoredProfilePhoto | undefined {
    const photo = photos.get(slot(profileId, kind))
    if (!photo) return undefined
    if (t.people.has(profileId)) return photo
    photos.delete(slot(profileId, kind))
    return undefined
  }

  /** private.knows_profile(viewer, target) — the one visibility rule. */
  const knows = (viewer: string, target: string): boolean => graph.knowsProfile(viewer, target, t.sharesOccasion)

  function set(viewer: string, args: { kind: unknown; mime: unknown; data: unknown; width: unknown; height: unknown }): JsonBodyType {
    t.requireUser(viewer)
    const { kind, mime, data, width, height } = args
    if (!t.hasConsents(viewer)) throw raise('consent_required')
    if (!isKind(kind) || (mime !== 'image/webp' && mime !== 'image/jpeg') || !isSide(width) || !isSide(height)
      || typeof data !== 'string' || data.length < 4 || data.length > MAX_BASE64) {
      throw raise('validation')
    }
    const bytes = decodeBase64(data)
    if (!bytes || bytes.length < 1 || bytes.length > MAX_BYTES || !bytesMatch(mime, bytes)) throw raise('validation')
    const updated_at = stamp()
    photos.set(slot(viewer, kind), { mime, data, size: bytes.length, width, height, updated_at })
    return { ok: true, updated_at }
  }

  function remove(viewer: string, kind: unknown): JsonBodyType {
    t.requireUser(viewer)
    if (!isKind(kind)) throw raise('validation')
    photos.delete(slot(viewer, kind))
    return { ok: true }
  }

  function get(viewer: string, profileId: string | null, kind: unknown): JsonBodyType {
    t.requireUser(viewer)
    const photo = profileId !== null && isKind(kind) && knows(viewer, profileId) ? live(profileId, kind) : undefined
    if (!photo) throw raise('not_found') // no access, no photo, unknown person or kind: one answer
    return { mime: photo.mime, data: photo.data, width: photo.width, height: photo.height, updated_at: photo.updated_at }
  }

  /** private.profile_photo_meta(): the raw meta (the person's OWN answers). */
  function ownMeta(profileId: string, kind: DemoPhotoKind): ProfilePhotoMeta | null {
    const photo = live(profileId, kind)
    return photo ? { width: photo.width, height: photo.height, updated_at: photo.updated_at } : null
  }

  /** private.profile_photo_fields(): { photo, banner_photo } as the viewer may see them (nulls otherwise). */
  function fieldsFor(viewer: string, profileId: string): { photo: ProfilePhotoMeta | null; banner_photo: ProfilePhotoMeta | null } {
    if (!knows(viewer, profileId)) return { photo: null, banner_photo: null }
    return { photo: ownMeta(profileId, 'avatar'), banner_photo: ownMeta(profileId, 'banner') }
  }

  function exportFor(viewer: string): JsonBodyType {
    t.requireUser(viewer)
    return (['avatar', 'banner'] as const).flatMap((kind) => {
      const photo = live(viewer, kind)
      return photo
        ? [{ kind, mime: photo.mime, width: photo.width, height: photo.height, size_bytes: photo.size, updated_at: photo.updated_at, data_base64: photo.data }]
        : []
    })
  }

  /** A fixture photo (service role): one of the bundled, invented pictures for a demo person. */
  function seedDemoPhoto(profileId: string, kind: DemoPhotoKind, picture: { data: () => string; width: number; height: number }): void {
    const data = picture.data()
    const bytes = decodeBase64(data)
    if (!t.people.has(profileId) || !bytes || !bytesMatch('image/webp', bytes)) return
    photos.set(slot(profileId, kind), { mime: 'image/webp', data, size: bytes.length, width: picture.width, height: picture.height, updated_at: stamp() })
  }

  return { set, remove, get, ownMeta, fieldsFor, exportFor, seedDemoPhoto }
}

export type DemoProfilePhotos = ReturnType<typeof createDemoProfilePhotos>

export interface ProfilePhotoHandlerOptions {
  photos: DemoProfilePhotos
  /** profile id of the request's valid demo session, or null (→ 401) */
  viewerOf: (request: Request) => string | null
  /** tests: no artificial delays */
  delays?: { upload: number; read: number }
}

export function createProfilePhotoHandlers({ photos, viewerOf, delays = demoPhotoDelays }: ProfilePhotoHandlerOptions) {
  const id = (args: Record<string, unknown>) => (typeof args.p_profile_id === 'string' ? args.p_profile_id : null)
  return [
    photoRpcHandler(viewerOf, 'set_profile_photo', { p_kind: 'text', p_mime: 'text', p_data_base64: 'text', p_width: 'int', p_height: 'int' },
      () => delays.upload,
      (me, args) => photos.set(me, { kind: args.p_kind, mime: args.p_mime, data: args.p_data_base64, width: args.p_width, height: args.p_height })),
    photoRpcHandler(viewerOf, 'remove_profile_photo', { p_kind: 'text' }, () => delays.upload / 2, (me, args) => photos.remove(me, args.p_kind)),
    photoRpcHandler(viewerOf, 'get_profile_photo', { p_profile_id: 'uuid', p_kind: 'text' }, () => delays.read, (me, args) => photos.get(me, id(args), args.p_kind)),
    photoRpcHandler(viewerOf, 'export_my_profile_photos', {}, () => 0, (me) => photos.exportFor(me)),
  ]
}
