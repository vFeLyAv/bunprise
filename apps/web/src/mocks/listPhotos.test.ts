import { describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { createDemoListPhotos, DEMO_LIST_COVER_SIZE, DEMO_LIST_COVERS } from './listPhotos'
import { createListsApi, DEMO_LIST_PEOPLE, DEMO_LISTS, seedListsDemo } from './lists'
import { bytesMatch, decodeBase64 } from './photos'
import { DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// The demo server's list covers follow the rules of 20261022160000_list_photos_received_move.sql (part A):
// list-owner writes, the list's readers read, one "not found" for everyone else, the limits, the quota of 30,
// the cascade, the export; every answer that carries a list shows only the meta. Two demo lists have an invented cover.

const NOW = Date.parse('2026-10-22T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'
const OUTSIDER = '00000000-0000-4000-8000-0000000000ee'
const HOUSEWARMING_LIST = 'd1e0c000-0000-4000-8000-000000000001'
const { anna, ben } = DEMO_PEOPLE
const { paula } = DEMO_LIST_PEOPLE

function seeded() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  seedListsDemo(world, ME, NOW)
  for (const [id, name] of [[ME, 'Mila'], [OUTSIDER, 'Dana']] as const) {
    world.addPerson({ id, displayName: () => name, hasConsents: () => true } satisfies DemoPerson)
  }
  world.addGuest(DEMO_OCCASIONS.housewarming, ME)
  const photos = createDemoListPhotos(world, () => NOW)
  world.setListPhotoMetaSource(photos.metaOf)
  photos.seedDemoCover(DEMO_LISTS.annaBirthday, DEMO_LIST_COVERS.birthday())
  photos.seedDemoCover(DEMO_LISTS.paulaChristmas, DEMO_LIST_COVERS.christmas())
  return { world, photos, api: createListsApi(world) }
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
const upload = (listId: string, data = webp(64)) => ({ listId, mime: 'image/webp', data, width: 800, height: 450 })
const NOT_FOUND = 'P0001:not_found'

describe('demo list covers', () => {
  it('the bundled covers are real WebP files of the stated size, under the 400 KB limit', () => {
    for (const data of [DEMO_LIST_COVERS.birthday(), DEMO_LIST_COVERS.christmas()]) {
      const bytes = decodeBase64(data)
      expect(bytes && bytesMatch('image/webp', bytes)).toBe(true)
      expect(bytes!.length).toBeLessThan(409_600)
    }
    expect(DEMO_LIST_COVER_SIZE).toEqual({ width: 960, height: 540 })
  })

  it("readers = the list's readers: followers of Anna's birthday list; everybody else one not_found (also \"no cover\")", () => {
    const { photos } = seeded()
    const owner = photos.get(anna.id, DEMO_LISTS.annaBirthday)
    expect(owner).toMatchObject({ mime: 'image/webp', width: 960, height: 540 })
    for (const who of [ME, paula.id]) expect(photos.get(who, DEMO_LISTS.annaBirthday), who).toEqual(owner)
    for (const [who, list] of [[ben.id, DEMO_LISTS.annaBirthday], [OUTSIDER, DEMO_LISTS.annaBirthday], [ME, DEMO_LISTS.annaPrivate],
      [ME, DEMO_LISTS.annaWishes], [OUTSIDER, '00000000-0000-4000-8000-00000000ffff']] as const) {
      expect(code(() => photos.get(who, list)), `${who} ${list}`).toBe(NOT_FOUND)
    }
  })

  it('only the owner writes (occasion lists too); limits; the quota of 30; removing is idempotent', () => {
    const { world, photos } = seeded()
    expect(photos.set(anna.id, upload(HOUSEWARMING_LIST))).toEqual({ ok: true, updated_at: expect.any(String) })
    expect(photos.get(ME, HOUSEWARMING_LIST)).toMatchObject({ width: 800, height: 450 }) // ME is a guest
    for (const who of [ME, paula.id, ben.id, OUTSIDER]) {
      expect(code(() => photos.set(who, upload(DEMO_LISTS.annaWishes)))).toBe(NOT_FOUND)
      expect(code(() => photos.remove(who, DEMO_LISTS.annaBirthday))).toBe(NOT_FOUND)
    }
    expect(code(() => photos.set(anna.id, { ...upload(DEMO_LISTS.annaWishes), mime: 'image/png' }))).toBe('P0001:validation')
    expect(code(() => photos.set(anna.id, { ...upload(DEMO_LISTS.annaWishes), width: 4096 }))).toBe('P0001:validation')
    expect(code(() => photos.set(anna.id, upload(DEMO_LISTS.annaWishes, btoa('not a picture'))))).toBe('P0001:validation')
    // 30 covers per owner
    const at = new Date(NOW).toISOString()
    const many = Array.from({ length: 31 }, (_, i) => `0f0f0f0f-0000-4000-8000-${String(i).padStart(12, '0')}`)
    world.seed({ people: [], occasions: [], members: [], invites: [], reservations: [], wishes: [],
      wishlists: many.map((id) => ({ id, occasion_id: null, owner_id: OUTSIDER, recipient_id: OUTSIDER, title: 'L', created_at: at, updated_at: at })) })
    for (const id of many.slice(0, 30)) photos.set(OUTSIDER, upload(id))
    expect(code(() => photos.set(OUTSIDER, upload(many[30]!)))).toBe('P0001:photo_limit')
    photos.set(OUTSIDER, upload(many[0]!)) // replacing is fine
    expect(photos.remove(OUTSIDER, many[1]!)).toEqual({ ok: true })
    expect(photos.remove(OUTSIDER, many[1]!)).toEqual({ ok: true })
    expect(photos.set(OUTSIDER, upload(many[30]!))).toMatchObject({ ok: true })
  })

  it('every answer with a list carries the meta; access ends → unreadable; the list deleted → gone', () => {
    const { world, photos, api } = seeded()
    const overview = api.getListsOverview(ME) as unknown as { following: { lists: { id: string; photo: unknown }[] }[]; upcoming: { list: { id: string; photo: unknown } }[] }
    const card = overview.following.flatMap((p) => p.lists).find((l) => l.id === DEMO_LISTS.annaBirthday)
    expect(card?.photo).toEqual({ width: 960, height: 540, updated_at: expect.any(String) })
    expect(overview.upcoming.find((u) => u.list.id === DEMO_LISTS.annaBirthday)?.list.photo).toEqual(card?.photo)
    expect((api.getListScreen(ME, DEMO_LISTS.annaBirthday) as unknown as { list: { photo: unknown } }).list.photo).toEqual(card?.photo)
    const free = api.getFreeWishes(ME, anna.id, null) as unknown as { ideas: { list: { id: string; photo: unknown } }[] }
    expect(free.ideas.find((i) => i.list.id === DEMO_LISTS.annaBirthday)?.list.photo).toEqual(card?.photo)
    const own = api.getListsOverview(anna.id) as unknown as { my_lists: { id: string; photo: unknown }[] }
    expect(own.my_lists.find((l) => l.id === DEMO_LISTS.annaBirthday)?.photo).toEqual(card?.photo)
    expect(world.exportFor(anna.id).wishlists.find((l) => l.id === DEMO_LISTS.annaBirthday)?.photo).toEqual(card?.photo)

    api.setListVisibility(anna.id, DEMO_LISTS.annaBirthday, 'private')
    expect(code(() => photos.get(ME, DEMO_LISTS.annaBirthday))).toBe(NOT_FOUND)
    world.deleteWishlists(anna.id, [world.internals.wishlists.get(DEMO_LISTS.annaBirthday)!], true)
    expect(code(() => photos.get(anna.id, DEMO_LISTS.annaBirthday))).toBe(NOT_FOUND)
    expect(photos.exportFor(anna.id)).toEqual([])
  })

  it('export: the own covers with their bytes (an occasion list with the occasion title); nobody else\'s', () => {
    const { photos } = seeded()
    photos.set(anna.id, upload(HOUSEWARMING_LIST))
    const exported = photos.exportFor(anna.id) as { wishlist_id: string; list_title: string; occasion_id: string | null; data_base64: string }[]
    // by the list's creation (the birthday list is 21 days old, the occasion list 6)
    expect(exported.map((e) => [e.wishlist_id, e.list_title, e.occasion_id])).toEqual([
      [DEMO_LISTS.annaBirthday, 'Geburtstag', null],
      [HOUSEWARMING_LIST, 'Annas Einweihung', DEMO_OCCASIONS.housewarming],
    ])
    expect(exported[0]?.data_base64).toBe(DEMO_LIST_COVERS.birthday())
    expect(photos.exportFor(ME)).toEqual([])
  })
})
