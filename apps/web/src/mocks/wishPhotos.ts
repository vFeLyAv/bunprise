import type { JsonBodyType } from 'msw'
import type { WishPhotoMeta } from '../lib/api/types'
import demoProductDataUrl from './assets/demo-product.webp?inline'
import { bytesMatch, decodeBase64, demoPhotoDelays, photoRpcHandler } from './photos'
import { DemoDbError, raise } from './rest'
import type { DemoWorld, WishRow } from './world'

// Wish photos of the demo server (docs/demo-mode.md): the four RPCs of
// supabase/migrations/20261022120000_wish_details.sql, re-implemented on the in-memory world like src/mocks/photos.ts
// does for the occasion covers (an independent copy of the rules, so tests compare the two):
//   set_wish_photo / remove_wish_photo — the list owner only (anyone else: not_found);
//   get_wish_photo — whoever may read the wish (world.canReadWishlist: owner, guest of the occasion, accepted
//                    follower of a "Meine Follower" list, never across a block); everyone else and "no photo": not_found;
//   export_my_wish_photos — the photos on the caller's own wishes;
//   limits: mime webp|jpeg, 1 … 2048 px, base64 → 1 … 409600 bytes, magic bytes, 100 photos per owner.
// Cascade: a photo is served only while its wish exists in a list of the same owner (a deleted wish, list,
// occasion or account leaves nothing readable; stale entries are dropped on the next access).
// Memory only: a reload resets the photos with the world. The demo wish "Kaffeemühle mit Handkurbel" starts with a
// generated, fictional product picture (assets/demo-product.webp — the same picture the demo /api/link-image returns).

export const DEMO_PRODUCT_SIZE = { width: 480, height: 480 } as const

const MAX_BYTES = 409_600
const MAX_BASE64 = 546_136
const MAX_SIDE = 2048
const PER_OWNER = 100

interface StoredWishPhoto {
  wishId: string
  ownerId: string
  mime: 'image/webp' | 'image/jpeg'
  data: string
  size: number
  width: number
  height: number
  updated_at: string
}

const isSide = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE

/** The base64 part of the bundled demo picture (a data: URL from Vite's ?inline). */
export function demoProductBase64(): string {
  return demoProductDataUrl.slice(demoProductDataUrl.indexOf(',') + 1)
}

export function createDemoWishPhotos(world: DemoWorld, clock: () => number = Date.now) {
  const t = world.internals
  const photos = new Map<string, StoredWishPhoto>()
  let lastStamp = 0

  function stamp(): string {
    lastStamp = Math.max(clock(), lastStamp + 1)
    return new Date(lastStamp).toISOString()
  }

  /** The owner of the wish's list, or undefined for an unknown wish / list. */
  function ownerOf(wish: WishRow | undefined): string | undefined {
    return wish ? t.wishlists.get(wish.wishlist_id)?.owner_id : undefined
  }

  /** A photo only while its wish still exists in a list of the same owner (cascade); else it is dropped. */
  function live(wishId: string): StoredWishPhoto | undefined {
    const photo = photos.get(wishId)
    if (!photo) return undefined
    if (ownerOf(t.wishes.get(wishId)) === photo.ownerId) return photo
    photos.delete(wishId)
    return undefined
  }

  /** The wish if the viewer owns its list; one answer (not_found) for unknown and foreign. */
  function ownWish(viewer: string, wishId: string | null): WishRow {
    const wish = wishId === null ? undefined : t.wishes.get(wishId)
    if (!wish || ownerOf(wish) !== viewer) throw raise('not_found')
    return wish
  }

  function set(viewer: string, args: { wishId: string | null; mime: unknown; data: unknown; width: unknown; height: unknown }): JsonBodyType {
    t.requireUser(viewer)
    const { wishId, mime, data, width, height } = args
    if (!t.hasConsents(viewer)) throw raise('consent_required')
    if ((mime !== 'image/webp' && mime !== 'image/jpeg') || !isSide(width) || !isSide(height)
      || typeof data !== 'string' || data.length < 4 || data.length > MAX_BASE64) {
      throw raise('validation')
    }
    const bytes = decodeBase64(data)
    if (!bytes || bytes.length < 1 || bytes.length > MAX_BYTES || !bytesMatch(mime, bytes)) throw raise('validation')
    const wish = ownWish(viewer, wishId)
    const owned = [...photos.keys()].filter((id) => live(id)?.ownerId === viewer)
    if (!photos.has(wish.id) && owned.length >= PER_OWNER) throw new DemoDbError('P0001', 'photo_limit', 400)
    const updated_at = stamp()
    photos.set(wish.id, { wishId: wish.id, ownerId: viewer, mime, data, size: bytes.length, width, height, updated_at })
    return { ok: true, updated_at }
  }

  function remove(viewer: string, wishId: string | null): JsonBodyType {
    t.requireUser(viewer)
    const wish = ownWish(viewer, wishId)
    photos.delete(wish.id)
    return { ok: true }
  }

  function get(viewer: string, wishId: string | null): JsonBodyType {
    t.requireUser(viewer)
    const wish = wishId === null ? undefined : t.wishes.get(wishId)
    const photo = wish && t.canReadWishlist(wish.wishlist_id, viewer) ? live(wish.id) : undefined
    if (!photo) throw raise('not_found') // no access and no photo: one answer
    return { mime: photo.mime, data: photo.data, width: photo.width, height: photo.height, updated_at: photo.updated_at }
  }

  /** private.wish_detail_fields()' photo key (the world asks for it, src/mocks/world.ts). */
  function metaOf(wishId: string): WishPhotoMeta | null {
    const photo = live(wishId)
    return photo ? { width: photo.width, height: photo.height, updated_at: photo.updated_at } : null
  }

  function exportFor(viewer: string): JsonBodyType {
    t.requireUser(viewer)
    return [...t.wishes.values()]
      .filter((wish) => ownerOf(wish) === viewer)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))
      .flatMap((wish) => {
        const photo = live(wish.id)
        return photo
          ? [{ wish_id: wish.id, wish_title: wish.title, wishlist_id: wish.wishlist_id, mime: photo.mime, width: photo.width,
              height: photo.height, size_bytes: photo.size, updated_at: photo.updated_at, data_base64: photo.data }]
          : []
      })
  }

  /** A fixture photo (service role): the bundled, fictional product picture on one demo wish. */
  function seedDemoPhoto(wishId: string): void {
    const wish = t.wishes.get(wishId)
    const ownerId = ownerOf(wish)
    const data = demoProductBase64()
    const bytes = decodeBase64(data)
    if (!wish || !ownerId || !bytes || !bytesMatch('image/webp', bytes)) return
    photos.set(wishId, { wishId, ownerId, mime: 'image/webp', data, size: bytes.length, ...DEMO_PRODUCT_SIZE, updated_at: stamp() })
  }

  return { set, remove, get, metaOf, exportFor, seedDemoPhoto }
}

export type DemoWishPhotos = ReturnType<typeof createDemoWishPhotos>

export interface WishPhotoHandlerOptions {
  photos: DemoWishPhotos
  /** profile id of the request's valid demo session, or null (→ 401) */
  viewerOf: (request: Request) => string | null
  /** tests: no artificial delays */
  delays?: { upload: number; read: number }
}

export function createWishPhotoHandlers({ photos, viewerOf, delays = demoPhotoDelays }: WishPhotoHandlerOptions) {
  const id = (args: Record<string, unknown>) => (typeof args.p_wish_id === 'string' ? args.p_wish_id : null)
  return [
    photoRpcHandler(viewerOf, 'set_wish_photo', { p_wish_id: 'uuid', p_mime: 'text', p_data_base64: 'text', p_width: 'int', p_height: 'int' },
      () => delays.upload,
      (me, args) => photos.set(me, { wishId: id(args), mime: args.p_mime, data: args.p_data_base64, width: args.p_width, height: args.p_height })),
    photoRpcHandler(viewerOf, 'remove_wish_photo', { p_wish_id: 'uuid' }, () => delays.upload / 2, (me, args) => photos.remove(me, id(args))),
    photoRpcHandler(viewerOf, 'get_wish_photo', { p_wish_id: 'uuid' }, () => delays.read, (me, args) => photos.get(me, id(args))),
    photoRpcHandler(viewerOf, 'export_my_wish_photos', {}, () => 0, (me) => photos.exportFor(me)),
  ]
}
