import { describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { createFollowsApi } from './follows'
import { createListsApi, DEMO_LIST_PEOPLE, seedListsDemo } from './lists'
import { bytesMatch, decodeBase64 } from './photos'
import { createDemoProfilePhotos, DEMO_PROFILE_PHOTOS } from './profilePhotos'
import { DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// The demo server's own profile / banner photos follow the rules of 20261024120000_profile_photos.sql: the caller writes
// only their own (one per kind), whoever may see the person's card reads (knowsProfile: self, a shared active occasion,
// a visible follow relation — a pending request included —, never across a block), ONE "not found" for everyone else,
// the limits, the cascade, the export; every answer that shows a person carries only the meta, as the viewer may see it.

const NOW = Date.parse('2026-10-24T10:00:00Z')
const ME = '00000000-0000-4000-8000-0000000000aa'
const OUTSIDER = '00000000-0000-4000-8000-0000000000ee'
const { anna, ben, clara } = DEMO_PEOPLE
const { paula, finn } = DEMO_LIST_PEOPLE

function seeded() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  seedListsDemo(world, ME, NOW)
  for (const [id, name] of [[ME, 'Mila'], [OUTSIDER, 'Dana']] as const) {
    world.addPerson({ id, displayName: () => name, hasConsents: () => true } satisfies DemoPerson)
  }
  const photos = createDemoProfilePhotos(world, () => NOW)
  world.setProfilePhotoSource({
    fieldsFor: photos.fieldsFor,
    ownFields: (id) => ({ photo: photos.ownMeta(id, 'avatar'), banner_photo: photos.ownMeta(id, 'banner') }),
  })
  photos.seedDemoPhoto(anna.id, 'avatar', DEMO_PROFILE_PHOTOS.annaAvatar)
  photos.seedDemoPhoto(anna.id, 'banner', DEMO_PROFILE_PHOTOS.annaBanner)
  photos.seedDemoPhoto(paula.id, 'avatar', DEMO_PROFILE_PHOTOS.paulaAvatar)
  return { world, photos, lists: createListsApi(world), follows: createFollowsApi(world) }
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
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
const upload = (kind: string, data = webp(64)) => ({ kind, mime: 'image/webp', data, width: 512, height: 512 })
const NOT_FOUND = 'P0001:not_found'
type Json = Record<string, unknown>

describe('demo profile photos', () => {
  it('the bundled pictures are real WebP files under the 400 KB limit', () => {
    for (const picture of Object.values(DEMO_PROFILE_PHOTOS)) {
      const bytes = decodeBase64(picture.data())
      expect(bytes && bytesMatch('image/webp', bytes)).toBe(true)
      expect(bytes!.length).toBeLessThan(409_600)
    }
  })

  it("the visibility rule: Anna's photos for herself, followers and co-guests; one not_found for a stranger", () => {
    const { photos } = seeded()
    const own = photos.get(anna.id, anna.id, 'avatar')
    expect(own).toMatchObject({ mime: 'image/webp', width: 512, height: 512 })
    // ME and Paula follow Anna; Ben and Clara are guests of her housewarming
    for (const who of [ME, paula.id, ben.id, clara.id]) expect(photos.get(who, anna.id, 'avatar'), who).toEqual(own)
    expect(photos.get(ME, anna.id, 'banner')).toMatchObject({ width: 1200, height: 480 })
    for (const [who, person, kind] of [[OUTSIDER, anna.id, 'avatar'], [OUTSIDER, anna.id, 'banner'], [ME, paula.id, 'banner'],
      [ME, anna.id, 'cover'], [ME, '00000000-0000-4000-8000-00000000ffff', 'avatar']] as const) {
      expect(code(() => photos.get(who, person, kind)), `${who} ${person} ${kind}`).toBe(NOT_FOUND)
    }
  })

  it('a pending request: both sides see each other; a block ends it both ways', () => {
    const { photos, follows } = seeded()
    photos.set(finn.id, upload('avatar'))
    photos.set(ME, upload('avatar'))
    // Finn asked to follow ME (pending, visible to ME)
    expect(photos.get(ME, finn.id, 'avatar')).toMatchObject({ width: 512 })
    expect(photos.get(finn.id, ME, 'avatar')).toMatchObject({ width: 512 })
    follows.blockUser(ME, anna.id)
    expect(code(() => photos.get(ME, anna.id, 'avatar'))).toBe(NOT_FOUND)
    expect(code(() => photos.get(anna.id, ME, 'avatar'))).toBe(NOT_FOUND)
  })

  it('only the own photo is written; one per kind; limits; removing is idempotent', () => {
    const { photos } = seeded()
    const first = photos.set(ME, upload('avatar')) as Json
    const second = photos.set(ME, upload('avatar', webp(80))) as Json
    expect(Date.parse(second.updated_at as string)).toBeGreaterThan(Date.parse(first.updated_at as string))
    expect(photos.set(ME, upload('banner'))).toEqual({ ok: true, updated_at: expect.any(String) })
    expect(photos.exportFor(ME)).toHaveLength(2)
    for (const bad of [upload('cover'), { ...upload('avatar'), mime: 'image/png' }, { ...upload('avatar'), width: 4096 }, upload('avatar', '!!!!'),
      upload('avatar', webp(409_601))]) {
      expect(code(() => photos.set(ME, bad))).toBe('P0001:validation')
    }
    expect(photos.remove(ME, 'avatar')).toEqual({ ok: true })
    expect(photos.remove(ME, 'avatar')).toEqual({ ok: true })
    expect(code(() => photos.remove(ME, 'cover'))).toBe('P0001:validation')
    expect(code(() => photos.get(ME, ME, 'avatar'))).toBe(NOT_FOUND)
  })

  it('the export: own photos only, ordered by kind; a deleted account leaves nothing readable', () => {
    const { world, photos } = seeded()
    expect((photos.exportFor(anna.id) as Json[]).map((entry) => entry.kind)).toEqual(['avatar', 'banner'])
    expect(photos.exportFor(ME)).toEqual([])
    world.deletePerson(anna.id)
    expect(code(() => photos.get(ME, anna.id, 'avatar'))).toBe(NOT_FOUND)
    expect(photos.ownMeta(anna.id, 'avatar')).toBeNull()
  })

  it('every answer that shows a person carries the meta the viewer may see (cards, overview, people, occasion)', () => {
    const { world, lists, follows, photos } = seeded()
    const annaAvatar = photos.ownMeta(anna.id, 'avatar')
    const annaBanner = photos.ownMeta(anna.id, 'banner')
    expect(annaAvatar).not.toBeNull()
    const card = follows.getProfileCard(ME, anna.id) as { profile: Json }
    expect(card.profile).toMatchObject({ id: anna.id, photo: annaAvatar, banner_photo: annaBanner })
    const overview = lists.getListsOverview(ME) as { me: Json; following: { profile: Json }[] }
    expect(overview.me).toMatchObject({ photo: null, banner_photo: null })
    expect(overview.following.find((p) => p.profile.id === anna.id)?.profile).toMatchObject({ photo: annaAvatar })
    expect(overview.following.find((p) => p.profile.id === paula.id)?.profile).toMatchObject({ photo: photos.ownMeta(paula.id, 'avatar'), banner_photo: null })
    const screen = world.getOccasionScreen(ben.id, DEMO_OCCASIONS.housewarming)
    expect(screen.occasion.host.photo).toEqual(annaAvatar)
    expect(screen.members.find((m) => m.profile_id === anna.id)?.photo).toEqual(annaAvatar)
    // after a block the card is gone and the people screen's blocked row has no photo key
    follows.blockUser(ME, anna.id)
    expect(code(() => follows.getProfileCard(ME, anna.id))).toBe(NOT_FOUND)
    const people = follows.getPeopleScreen(ME) as { blocked: Json[] }
    expect(people.blocked.find((row) => row.profile_id === anna.id)).not.toHaveProperty('photo')
  })
})
