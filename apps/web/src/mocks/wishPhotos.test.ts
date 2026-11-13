import { describe, expect, it } from 'vitest'
import type { OccasionScreenWish } from '../lib/api/types'
import { DEMO_OCCASIONS, DEMO_PEOPLE, DEMO_RESERVED_WISH_ID, seedDemoWorld } from './fixtures'
import { DemoDbError } from './rest'
import { createDemoWishPhotos, DEMO_PRODUCT_SIZE } from './wishPhotos'
import { createDemoWorld, type DemoPerson } from './world'

// The demo server's wish photos follow the rules of 20261022120000_wish_details.sql (list-owner writes, the wish's
// readers read, one "not found" for everyone else, limits, cascade, export); every wish answer carries the details
// and the photo meta; three demo wishes have details, the coffee grinder a (fictional) picture.

const NOW = Date.parse('2026-10-22T10:00:00Z')
const { anna, ben } = DEMO_PEOPLE
const OUTSIDER = '00000000-0000-4000-8000-0000000000ee'
const TOWELS = 'd1e0d000-0000-4000-8000-000000000104' // Anna's housewarming list, with details, no photo
const APRON = 'd1e0d000-0000-4000-8000-000000000203' // Ben's barbecue list

function seeded() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  world.addPerson({ id: OUTSIDER, displayName: () => 'Dana', hasConsents: () => true } satisfies DemoPerson)
  const photos = createDemoWishPhotos(world, () => NOW)
  world.setWishPhotoMetaSource(photos.metaOf)
  photos.seedDemoPhoto(DEMO_RESERVED_WISH_ID)
  return { world, photos }
}

function code(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof DemoDbError) return `${error.code}:${error.message}`
    throw error
  }
  throw new Error('expected a refusal')
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
function webp(size: number): string {
  const bytes = new Uint8Array(size).fill(5)
  bytes.set(ascii('RIFF'), 0)
  new DataView(bytes.buffer).setUint32(4, size - 8, true)
  bytes.set(ascii('WEBP'), 8)
  bytes.set(ascii('VP8 '), 12)
  return btoa(String.fromCharCode(...bytes))
}
const upload = (wishId: string, data = webp(64)) => ({ wishId, mime: 'image/webp', data, width: 800, height: 600 })

describe('demo wish details', () => {
  it('the owner and the guests see the same details and photo meta; the coffee grinder has the demo picture', () => {
    const { world } = seeded()
    const forAnna = world.getOccasionScreen(anna.id, DEMO_OCCASIONS.housewarming).wishlist?.wishes ?? []
    const forBen = world.getOccasionScreen(ben.id, DEMO_OCCASIONS.housewarming).wishlist?.wishes ?? []
    const grinder = forAnna.find((wish) => wish.id === DEMO_RESERVED_WISH_ID)
    expect(grinder).toMatchObject({ brand: 'Mahlwerk & Söhne', color: 'Buche natur', gtin: '2001234567893', shop_name: 'Küchenkontor', photo: DEMO_PRODUCT_SIZE })
    expect(forAnna.find((wish) => wish.id === TOWELS)).toMatchObject({ brand: 'Leinenliebe', gtin: null, photo: null })
    // the details never depend on reservations: Ben (who reserved the grinder) sees the same keys and values
    // (20261027200000: the place hints differ by role — the owner's home / paused / also_in, a guest's also_in;
    // 20261030120000: so does `together` — the owner's ids + titles, a guest's with the flags of what they may see)
    const strip = ({ reserved: _r, reserved_by_me: _m, home: _h, paused: _p, also_in: _a, together: _t, ...rest }: OccasionScreenWish) => rest
    expect(forBen.map(strip)).toEqual(forAnna.map(strip))
    // every wish carries every key (null without details)
    for (const wish of forAnna) for (const key of ['description', 'brand', 'color', 'gtin', 'shop_name', 'photo']) expect(wish, key).toHaveProperty(key)
  })

  it('REST: the owner writes details, the check constraints hold, guests read them', () => {
    const { world } = seeded()
    const towels = world.wishRows(anna.id).filter((wish) => wish.id === TOWELS)
    world.updateWishes(anna.id, towels, { color: 'Grau', gtin: '12345678' }, true)
    expect(world.wishRows(ben.id).find((wish) => wish.id === TOWELS)).toMatchObject({ color: 'Grau', gtin: '12345678' })
    expect(code(() => world.updateWishes(anna.id, towels, { gtin: '1234' }, true))).toMatch(/23514/)
    expect(code(() => world.updateWishes(anna.id, towels, { brand: '   ' }, true))).toMatch(/23514/)
    expect(code(() => world.updateWishes(anna.id, towels, { description: 'x'.repeat(1001) }, true))).toMatch(/23514/)
    // a guest updates nothing (RLS: wishes_update is the owner's)
    expect(code(() => world.updateWishes(ben.id, world.wishRows(ben.id).filter((wish) => wish.id === TOWELS), { color: 'Rot' }, true))).toMatch(/PGRST116/)
  })
})

describe('demo wish photos', () => {
  it('the seeded picture is a valid WebP within the limits, readable by the owner and the guests only', () => {
    const { photos } = seeded()
    const forBen = photos.get(ben.id, DEMO_RESERVED_WISH_ID) as { mime: string; data: string }
    expect(forBen).toMatchObject({ mime: 'image/webp', ...DEMO_PRODUCT_SIZE })
    const bytes = Uint8Array.from(atob(forBen.data), (c) => c.charCodeAt(0))
    expect(String.fromCharCode(...bytes.subarray(0, 4), ...bytes.subarray(8, 12))).toBe('RIFFWEBP')
    expect(bytes.length).toBeLessThanOrEqual(409_600)
    expect(photos.get(anna.id, DEMO_RESERVED_WISH_ID)).toEqual(forBen)
    const noPhoto = code(() => photos.get(ben.id, TOWELS))
    expect(code(() => photos.get(OUTSIDER, DEMO_RESERVED_WISH_ID))).toBe(noPhoto)
    expect(code(() => photos.get(OUTSIDER, '00000000-0000-4000-8000-00000000abcd'))).toBe(noPhoto)
  })

  it('only the list owner writes; the screens show the new version; delete of the wish takes the photo', () => {
    const { world, photos } = seeded()
    expect(code(() => photos.set(anna.id, upload(APRON)))).toBe('P0001:not_found') // Ben's wish
    expect(code(() => photos.remove(ben.id, TOWELS))).toBe('P0001:not_found')
    const answer = photos.set(ben.id, upload(APRON)) as { ok: true; updated_at: string }
    const apron = world.getOccasionScreen(anna.id, DEMO_OCCASIONS.barbecue).wishlist?.wishes.find((wish) => wish.id === APRON)
    expect(apron?.photo).toEqual({ width: 800, height: 600, updated_at: answer.updated_at })
    world.deleteWishes(ben.id, world.wishRows(ben.id).filter((wish) => wish.id === APRON), true)
    expect(code(() => photos.get(ben.id, APRON))).toBe('P0001:not_found')
    expect((photos.exportFor(ben.id) as unknown[]).length).toBe(0)
  })

  it('limits: type, magic bytes, size; export of the own photos only', () => {
    const { photos } = seeded()
    expect(code(() => photos.set(anna.id, { ...upload(TOWELS), mime: 'image/png' }))).toBe('P0001:validation')
    expect(code(() => photos.set(anna.id, upload(TOWELS, btoa('not an image at all'))))).toBe('P0001:validation')
    expect(code(() => photos.set(anna.id, { ...upload(TOWELS), width: 4096 }))).toBe('P0001:validation')
    photos.set(anna.id, upload(TOWELS))
    expect((photos.exportFor(anna.id) as { wish_id: string }[]).map((entry) => entry.wish_id).sort()).toEqual([DEMO_RESERVED_WISH_ID, TOWELS].sort())
    expect(photos.exportFor(ben.id)).toEqual([])
  })
})
