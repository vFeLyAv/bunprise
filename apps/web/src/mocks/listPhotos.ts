import type { JsonBodyType } from 'msw'
import type { ListPhotoMeta } from '../lib/api/types'
import birthdayCoverDataUrl from './assets/demo-list-birthday.webp?inline'
import christmasCoverDataUrl from './assets/demo-list-christmas.webp?inline'
import { bytesMatch, decodeBase64, demoPhotoDelays, photoRpcHandler } from './photos'
import { DemoDbError, raise } from './rest'
import type { DemoWorld, WishlistRow } from './world'

// List cover photos of the demo server (docs/demo-mode.md): the four RPCs of
// supabase/migrations/20261022160000_list_photos_received_move.sql (part A), re-implemented on the in-memory world like
// src/mocks/wishPhotos.ts does for wish photos (an independent copy of the rules, so tests compare the two):
//   set_list_photo / remove_list_photo — the list owner only (anyone else: not_found);
//   get_list_photo — whoever may read the list (world.canReadWishlist: owner, guest of the occasion, accepted follower
//                    of a "Meine Follower" list, never across a block); everyone else and "no cover": not_found;
//   export_my_list_photos — the covers of the caller's own lists;
//   limits: mime webp|jpeg, 1 … 2048 px, base64 → 1 … 409600 bytes, magic bytes, 30 covers per owner.
// Cascade: a cover is served only while its list exists with the same owner (a deleted list, occasion or account
// leaves nothing readable; stale entries are dropped on the next access).
// Memory only: a reload resets the covers with the world. Two demo lists start with a generated, invented cover
// (assets/demo-list-birthday.webp: a cake with candles and balloons; assets/demo-list-christmas.webp: a tree in the
// snow — drawn from our own SVG, no people, no brands).

export const DEMO_LIST_COVER_SIZE = { width: 960, height: 540 } as const

const MAX_BYTES = 409_600
const MAX_BASE64 = 546_136
const MAX_SIDE = 2048
const PER_OWNER = 30

interface StoredListPhoto {
  listId: string
  ownerId: string
  mime: 'image/webp' | 'image/jpeg'
  data: string
  size: number
  width: number
  height: number
  updated_at: string
}

const isSide = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE
const base64Of = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1)

/** The bundled demo covers (base64 of the WebP files). */
export const DEMO_LIST_COVERS = {
  birthday: () => base64Of(birthdayCoverDataUrl),
  christmas: () => base64Of(christmasCoverDataUrl),
} as const

export function createDemoListPhotos(world: DemoWorld, clock: () => number = Date.now) {
  const t = world.internals
  const photos = new Map<string, StoredListPhoto>()
  let lastStamp = 0

  function stamp(): string {
    lastStamp = Math.max(clock(), lastStamp + 1)
    return new Date(lastStamp).toISOString()
  }

  /** A cover only while its list still exists with the same owner (cascade); else it is dropped. */
  function live(listId: string): StoredListPhoto | undefined {
    const photo = photos.get(listId)
    if (!photo) return undefined
    if (t.wishlists.get(listId)?.owner_id === photo.ownerId) return photo
    photos.delete(listId)
    return undefined
  }

  /** The list if the viewer owns it; one answer (not_found) for unknown and foreign. */
  function ownList(viewer: string, listId: string | null): WishlistRow {
    const list = listId === null ? undefined : t.wishlists.get(listId)
    if (!list || list.owner_id !== viewer) throw raise('not_found')
    return list
  }

  function set(viewer: string, args: { listId: string | null; mime: unknown; data: unknown; width: unknown; height: unknown }): JsonBodyType {
    t.requireUser(viewer)
    const { listId, mime, data, width, height } = args
    if (!t.hasConsents(viewer)) throw raise('consent_required')
    if ((mime !== 'image/webp' && mime !== 'image/jpeg') || !isSide(width) || !isSide(height)
      || typeof data !== 'string' || data.length < 4 || data.length > MAX_BASE64) {
      throw raise('validation')
    }
    const bytes = decodeBase64(data)
    if (!bytes || bytes.length < 1 || bytes.length > MAX_BYTES || !bytesMatch(mime, bytes)) throw raise('validation')
    const list = ownList(viewer, listId)
    const owned = [...photos.keys()].filter((id) => live(id)?.ownerId === viewer)
    if (!photos.has(list.id) && owned.length >= PER_OWNER) throw new DemoDbError('P0001', 'photo_limit', 400)
    const updated_at = stamp()
    photos.set(list.id, { listId: list.id, ownerId: viewer, mime, data, size: bytes.length, width, height, updated_at })
    return { ok: true, updated_at }
  }

  function remove(viewer: string, listId: string | null): JsonBodyType {
    t.requireUser(viewer)
    const list = ownList(viewer, listId)
    photos.delete(list.id)
    return { ok: true }
  }

  function get(viewer: string, listId: string | null): JsonBodyType {
    t.requireUser(viewer)
    const photo = listId !== null && t.canReadWishlist(listId, viewer) ? live(listId) : undefined
    if (!photo) throw raise('not_found') // no access and no cover: one answer
    return { mime: photo.mime, data: photo.data, width: photo.width, height: photo.height, updated_at: photo.updated_at }
  }

  /** private.list_photo_meta() (the world asks for it, src/mocks/world.ts). */
  function metaOf(listId: string): ListPhotoMeta | null {
    const photo = live(listId)
    return photo ? { width: photo.width, height: photo.height, updated_at: photo.updated_at } : null
  }

  function exportFor(viewer: string): JsonBodyType {
    t.requireUser(viewer)
    return [...t.wishlists.values()]
      .filter((list) => list.owner_id === viewer)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
      .flatMap((list) => {
        const photo = live(list.id)
        const occasion = list.occasion_id === null ? undefined : t.occasions.get(list.occasion_id)
        return photo
          ? [{ wishlist_id: list.id, list_title: list.title ?? occasion?.title ?? null, occasion_id: list.occasion_id, mime: photo.mime,
              width: photo.width, height: photo.height, size_bytes: photo.size, updated_at: photo.updated_at, data_base64: photo.data }]
          : []
      })
  }

  /** A fixture cover (service role): one of the bundled, invented pictures on one demo list. */
  function seedDemoCover(listId: string, data: string): void {
    const ownerId = t.wishlists.get(listId)?.owner_id
    const bytes = decodeBase64(data)
    if (!ownerId || !bytes || !bytesMatch('image/webp', bytes)) return
    photos.set(listId, { listId, ownerId, mime: 'image/webp', data, size: bytes.length, ...DEMO_LIST_COVER_SIZE, updated_at: stamp() })
  }

  return { set, remove, get, metaOf, exportFor, seedDemoCover }
}

export type DemoListPhotos = ReturnType<typeof createDemoListPhotos>

export interface ListPhotoHandlerOptions {
  photos: DemoListPhotos
  /** profile id of the request's valid demo session, or null (→ 401) */
  viewerOf: (request: Request) => string | null
  /** tests: no artificial delays */
  delays?: { upload: number; read: number }
}

export function createListPhotoHandlers({ photos, viewerOf, delays = demoPhotoDelays }: ListPhotoHandlerOptions) {
  const id = (args: Record<string, unknown>) => (typeof args.p_list_id === 'string' ? args.p_list_id : null)
  return [
    photoRpcHandler(viewerOf, 'set_list_photo', { p_list_id: 'uuid', p_mime: 'text', p_data_base64: 'text', p_width: 'int', p_height: 'int' },
      () => delays.upload,
      (me, args) => photos.set(me, { listId: id(args), mime: args.p_mime, data: args.p_data_base64, width: args.p_width, height: args.p_height })),
    photoRpcHandler(viewerOf, 'remove_list_photo', { p_list_id: 'uuid' }, () => delays.upload / 2, (me, args) => photos.remove(me, id(args))),
    photoRpcHandler(viewerOf, 'get_list_photo', { p_list_id: 'uuid' }, () => delays.read, (me, args) => photos.get(me, id(args))),
    photoRpcHandler(viewerOf, 'export_my_list_photos', {}, () => 0, (me) => photos.exportFor(me)),
  ]
}
