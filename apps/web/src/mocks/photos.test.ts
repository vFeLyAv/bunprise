import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { createDemoPhotos, createPhotoHandlers, DEMO_COVER_OCCASION, DEMO_COVER_SIZE } from './photos'
import { DEMO_SUPABASE_URL, DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// The demo server's cover photos follow the rules of 20261020160000_occasion_photos.sql (host-only writes,
// host + active members read, one "not found" for everyone else, limits, quota, cascade, export) and show
// their meta in get_occasion_screen. The seeded cover of "Annas Einweihung" is a valid WebP.

const NOW = Date.parse('2026-10-20T10:00:00Z')
const { anna, ben, clara } = DEMO_PEOPLE
const OUTSIDER = '00000000-0000-4000-8000-0000000000ee'

function seeded() {
  const world = createDemoWorld(() => NOW)
  seedDemoWorld(world, NOW)
  const person = (id: string): DemoPerson => ({ id, displayName: () => 'Dana', hasConsents: () => true })
  world.addPerson(person(OUTSIDER))
  const photos = createDemoPhotos(world, () => NOW)
  world.setPhotoMetaSource(photos.metaOf)
  photos.seedDemoCover()
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
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
const upload = (data = webp(64)) => ({ occasionId: DEMO_OCCASIONS.barbecue, mime: 'image/webp', data, width: 1600, height: 1067 })

describe('demo cover photos', () => {
  it('"Annas Einweihung" starts with the generated cover; its meta is in the screen of host and guests', () => {
    const { world, photos } = seeded()
    const forBen = photos.get(ben.id, DEMO_COVER_OCCASION) as { mime: string; data: string; width: number; height: number }
    expect(forBen).toMatchObject({ mime: 'image/webp', ...DEMO_COVER_SIZE })
    const bytes = Uint8Array.from(atob(forBen.data), (c) => c.charCodeAt(0))
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe('WEBP')
    expect(bytes.length).toBeLessThanOrEqual(409_600)
    expect(world.getOccasionScreen(anna.id, DEMO_COVER_OCCASION).occasion.photo).toMatchObject(DEMO_COVER_SIZE)
    expect(world.getOccasionScreen(clara.id, DEMO_COVER_OCCASION).occasion.photo).toMatchObject(DEMO_COVER_SIZE)
    expect(world.getOccasionScreen(ben.id, DEMO_OCCASIONS.barbecue).occasion.photo).toBeNull()
  })

  it('only the host writes; members read; everybody else gets the answer of "no photo"', () => {
    const { photos } = seeded()
    expect(code(() => photos.set(anna.id, upload()))).toBe('P0001:not_found') // a guest of Ben's barbecue
    expect(code(() => photos.remove(anna.id, DEMO_OCCASIONS.barbecue))).toBe('P0001:not_found')
    const answer = photos.set(ben.id, upload()) as { ok: boolean; updated_at: string }
    expect(answer.ok).toBe(true)
    expect(photos.get(anna.id, DEMO_OCCASIONS.barbecue)).toMatchObject({ mime: 'image/webp', updated_at: answer.updated_at })
    expect(code(() => photos.get(OUTSIDER, DEMO_OCCASIONS.barbecue))).toBe('P0001:not_found')
    expect(photos.remove(ben.id, DEMO_OCCASIONS.barbecue)).toEqual({ ok: true })
    expect(code(() => photos.get(ben.id, DEMO_OCCASIONS.barbecue))).toBe('P0001:not_found')
  })

  it('the limits: type, size in px, base64 and decoded bytes, magic bytes', () => {
    const { photos } = seeded()
    for (const bad of [
      { ...upload(), mime: 'image/png' },
      { ...upload(), width: 0 },
      { ...upload(), height: 2049 },
      { ...upload(), data: '!!!!' },
      { ...upload(), data: 'AA' },
      { ...upload(), data: webp(409_601) },
      { ...upload(), mime: 'image/jpeg' }, // WebP bytes declared as JPEG
    ]) {
      expect(code(() => photos.set(ben.id, bad))).toBe('P0001:validation')
    }
    expect((photos.set(ben.id, upload(webp(409_600))) as { ok: boolean }).ok).toBe(true)
  })

  it('a deleted occasion takes its cover along (nothing readable, nothing in the export)', () => {
    const { world, photos } = seeded()
    photos.set(ben.id, upload())
    const barbecue = world.occasionRows(ben.id).filter((occasion) => occasion.id === DEMO_OCCASIONS.barbecue)
    world.deleteOccasions(ben.id, barbecue, true)
    expect(code(() => photos.get(ben.id, DEMO_OCCASIONS.barbecue))).toBe('P0001:not_found')
    expect(photos.exportFor(ben.id)).toEqual([])
  })

  it('the export has the own hosted covers with their bytes, never a guest view', () => {
    const { photos } = seeded()
    expect(photos.exportFor(anna.id)).toEqual([expect.objectContaining({ occasion_id: DEMO_COVER_OCCASION, mime: 'image/webp', ...DEMO_COVER_SIZE })])
    expect(photos.exportFor(ben.id)).toEqual([])
    expect(photos.exportFor(clara.id)).toEqual([])
  })
})

describe('demo cover photo RPCs over HTTP', () => {
  const { photos } = seeded()
  const server = setupServer(...createPhotoHandlers({
    photos,
    viewerOf: (request) => (request.headers.get('authorization') === 'Bearer ben' ? ben.id : null),
    delays: { upload: 0, read: 0 },
  }))
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
  afterAll(() => server.close())

  const call = (name: string, body: unknown, token = 'ben') =>
    fetch(`${DEMO_SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('answers like PostgREST: the envelope, P0001 codes, 401 without a session, exact argument names', async () => {
    const set = await call('set_occasion_photo', { p_occasion_id: DEMO_OCCASIONS.barbecue, p_mime: 'image/webp', p_data_base64: webp(80), p_width: 800, p_height: 600 })
    expect(set.status).toBe(200)
    expect(await set.json()).toMatchObject({ ok: true, updated_at: expect.any(String) })
    const read = await call('get_occasion_photo', { p_occasion_id: DEMO_OCCASIONS.barbecue })
    expect(await read.json()).toMatchObject({ mime: 'image/webp', width: 800, height: 600 })
    const foreign = await call('set_occasion_photo', { p_occasion_id: DEMO_OCCASIONS.housewarming, p_mime: 'image/webp', p_data_base64: webp(80), p_width: 800, p_height: 600 })
    expect(foreign.status).toBe(400)
    expect(await foreign.json()).toMatchObject({ code: 'P0001', message: 'not_found' })
    expect((await call('get_occasion_photo', { p_occasion_id: DEMO_OCCASIONS.barbecue }, 'nobody')).status).toBe(401)
    expect((await call('get_occasion_photo', { occasion: DEMO_OCCASIONS.barbecue })).status).toBe(404)
    expect(await (await call('export_my_occasion_photos', {})).json()).toEqual([expect.objectContaining({ occasion_id: DEMO_OCCASIONS.barbecue })])
  })
})
