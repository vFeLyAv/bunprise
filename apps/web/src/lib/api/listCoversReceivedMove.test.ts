import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '../database.types'

// List covers, "Erhalten" and moving a wish (20261022160000) — the wrappers against the demo server (src/mocks):
// exactly the requests the UI will send, the answers' shapes, and every refusal as the AppError code the screens
// translate. Plus the parsers (list `photo`, the `received` part) and the list link. Fictional accounts only.
const access = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(access.client),
  hasLocalSession: () => access.client !== null,
  getLocalSession: () => Promise.resolve(null),
  onClientReady: () => () => {},
}))

import { acceptConsents } from './consents'
import { deleteListPhoto, exportMyListPhotos, getListPhoto, uploadListPhoto } from './listPhotos'
import { buildListUrl, createList, getListScreen, getListsOverview, newListId } from './lists'
import { asListScreen, asWishlist } from './lists.types'
import { updateMyProfile } from './profile'
import { reserveWish } from './reservations'
import { createWish, getWish, moveWish, setWishReceived } from './wishes'
import { createDemoHandlers, DEMO_CODE, DEMO_SUPABASE_URL } from '../../mocks/handlers'
import { DEMO_LIST_RECEIVED_WISH, DEMO_LISTS } from '../../mocks/lists'
import { demoPhotoDelays } from '../../mocks/photos'

type Client = SupabaseClient<Database>

const server = setupServer()
let clientCount = 0

const pauses = { ...demoPhotoDelays }
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  // the demo's visible "uploading" pause is not needed here (read at request time, mocks/photos.ts)
  Object.assign(demoPhotoDelays, { upload: 0, read: 0 })
})
beforeEach(() => {
  server.resetHandlers(...createDemoHandlers())
  access.client = null
})
afterAll(() => {
  server.close()
  vi.restoreAllMocks()
  Object.assign(demoPhotoDelays, pauses)
})

async function becomes(email: string, name: string): Promise<{ client: Client; id: string }> {
  const client = createClient<Database>(DEMO_SUPABASE_URL, 'demo', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `demo-covers-${clientCount++}` },
  })
  await client.auth.signInWithOtp({ email })
  const verified = await client.auth.verifyOtp({ email, token: DEMO_CODE, type: 'email' })
  expect(verified.error).toBeNull()
  access.client = client
  await updateMyProfile({ display_name: name, locale: 'de' })
  await acceptConsents('de')
  return { client, id: verified.data.session!.user.id }
}

/** A minimal WebP the demo server accepts (RIFF size + WEBP + VP8 chunk tag; the database parses more). */
function tinyWebp(size = 64): Uint8Array {
  const bytes = new Uint8Array(size).fill(5)
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
  bytes.set(ascii('RIFF'), 0)
  new DataView(bytes.buffer).setUint32(4, size - 8, true)
  bytes.set(ascii('WEBP'), 8)
  bytes.set(ascii('VP8 '), 12)
  return bytes
}

const META = { width: expect.any(Number), height: expect.any(Number), updated_at: expect.any(String) }

describe('list covers against the demo server', () => {
  it('the seeded covers reach a follower (cards, "Bald", the screen, the bytes); "Nur ich" stays one not_found', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const overview = await getListsOverview(me.id)
    const cards = overview.following.flatMap((person) => person.lists)
    expect(cards.find((card) => card.id === DEMO_LISTS.annaBirthday)?.photo).toEqual({ width: 960, height: 540, updated_at: expect.any(String) })
    expect(cards.find((card) => card.id === DEMO_LISTS.paulaChristmas)?.photo).toEqual({ width: 960, height: 540, updated_at: expect.any(String) })
    expect(cards.find((card) => card.id === DEMO_LISTS.annaWishes)?.photo).toBeNull()
    expect(overview.upcoming.find((entry) => entry.list.id === DEMO_LISTS.annaBirthday)?.list.photo).toEqual(META)
    expect((await getListScreen(DEMO_LISTS.annaBirthday, me.id)).list.photo).toEqual(META)
    const cover = await getListPhoto(DEMO_LISTS.annaBirthday, me.id)
    expect(cover).toMatchObject({ mime: 'image/webp', width: 960, height: 540 })
    expect(cover.blob.size).toBeGreaterThan(1000)
    await expect(getListPhoto(DEMO_LISTS.annaPrivate, me.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getListPhoto(DEMO_LISTS.annaWishes, me.id)).rejects.toMatchObject({ code: 'not_found' }) // no cover: the same answer
  })

  it('the owner uploads, sees the meta everywhere, exports and removes; another account cannot touch it', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const id = newListId()
    await createList({ id, title: 'Geburtstag', visibility: 'followers', cover_tone: 1, cover_icon: 'cake', due_on: null }, me.id)
    const { updated_at } = await uploadListPhoto(id, { mime: 'image/webp', bytes: tinyWebp(), width: 800, height: 450 }, me.id)
    const meta = { width: 800, height: 450, updated_at }
    expect((await getListScreen(id, me.id)).list.photo).toEqual(meta)
    expect((await getListsOverview(me.id)).my_lists.find((card) => card.id === id)?.photo).toEqual(meta)
    expect(await getListPhoto(id, me.id)).toMatchObject(meta)
    expect(await exportMyListPhotos(me.id)).toEqual([expect.objectContaining({ wishlist_id: id, list_title: 'Geburtstag', occasion_id: null, ...meta })])
    await expect(uploadListPhoto(id, { mime: 'image/webp', bytes: tinyWebp(), width: 800, height: 450 }, me.id).then(() => 'ok')).resolves.toBe('ok')
    await expect(uploadListPhoto(DEMO_LISTS.annaWishes, { mime: 'image/webp', bytes: tinyWebp(), width: 8, height: 8 }, me.id))
      .rejects.toMatchObject({ code: 'not_found' })

    const other = await becomes('jonas@example.test', 'Jonas')
    await expect(deleteListPhoto(id, other.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getListPhoto(id, other.id)).rejects.toMatchObject({ code: 'not_found' })

    access.client = me.client
    await deleteListPhoto(id, me.id)
    await expect(getListPhoto(id, me.id)).rejects.toMatchObject({ code: 'not_found' })
    expect((await getListScreen(id, me.id)).list.photo).toBeNull()
  })
})

describe('"Erhalten" against the demo server', () => {
  it("the giver's side: Anna's received wish is in `received`, never newly reservable (not_allowed)", async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const screen = await getListScreen(DEMO_LISTS.annaWishes, me.id)
    expect(screen.wishes.map((wish) => wish.id)).not.toContain(DEMO_LIST_RECEIVED_WISH)
    expect(screen.received?.map((wish) => [wish.id, typeof wish.received_at, wish.reserved, wish.reserved_by_me]))
      .toEqual([[DEMO_LIST_RECEIVED_WISH, 'string', false, false]])
    await expect(reserveWish(DEMO_LIST_RECEIVED_WISH, me.id)).rejects.toMatchObject({ code: 'not_allowed' })
    await expect(setWishReceived(DEMO_LIST_RECEIVED_WISH, false, me.id)).rejects.toMatchObject({ code: 'not_found' }) // not my wish
  })

  it('the owner marks and un-marks; the screen splits; REST reads received_at but never writes it', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const id = newListId()
    await createList({ id, title: 'Meine Wünsche', visibility: 'private', cover_tone: null, cover_icon: null, due_on: null }, me.id)
    const wish = await createWish(id, { title: 'Kopfhörer', priority: 3 }, me.id)
    expect(wish.received_at).toBeNull()
    const { received_at } = await setWishReceived(wish.id, true, me.id)
    expect(typeof received_at).toBe('string')
    expect(await setWishReceived(wish.id, true, me.id)).toEqual({ received_at }) // the first moment stays
    const marked = await getListScreen(id, me.id)
    expect([marked.wishes, marked.received?.map((w) => [w.id, w.received_at, w.reserved])]).toEqual([[], [[wish.id, received_at, null]]])
    expect((await getWish(wish.id, me.id)).received_at).toBe(received_at)
    const raw = me.client as unknown as SupabaseClient
    expect((await raw.from('wishes').update({ received_at: null }).eq('id', wish.id)).error?.code).toBe('42501')
    expect(await setWishReceived(wish.id, false, me.id)).toEqual({ received_at: null })
    expect((await getListScreen(id, me.id)).wishes.map((w) => w.id)).toEqual([wish.id])
  })
})

describe('moving a wish against the demo server', () => {
  it('between my own lists (photo-less and details alike); foreign lists or wishes: one not_found', async () => {
    const me = await becomes('mila@example.test', 'Mila')
    const [from, to] = [newListId(), newListId()]
    await createList({ id: from, title: 'Alt', visibility: 'private', cover_tone: null, cover_icon: null, due_on: null }, me.id)
    await createList({ id: to, title: 'Neu', visibility: 'followers', cover_tone: null, cover_icon: null, due_on: null }, me.id)
    const wish = await createWish(from, { title: 'Buch', brand: 'Verlag' }, me.id)
    await setWishReceived(wish.id, true, me.id)
    await moveWish(wish.id, to, me.id)
    expect((await getListScreen(from, me.id)).received).toEqual([])
    expect((await getListScreen(to, me.id)).received?.[0]).toMatchObject({ id: wish.id, brand: 'Verlag', received_at: expect.any(String) })
    await moveWish(wish.id, to, me.id) // the same list: nothing happens
    await expect(moveWish(wish.id, DEMO_LISTS.annaWishes, me.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(moveWish(DEMO_LIST_RECEIVED_WISH, to, me.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(moveWish('00000000-0000-4000-8000-00000000ffff', to, me.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('parsers and the list link', () => {
  it('asListScreen: `received` and the cover meta; an older server has neither → [] and null', () => {
    const base = {
      list: { id: 'l', title: 'T', visibility: 'followers', owner: { id: 'o', display_name: 'O', banner: null } },
      viewer: { role: 'follower' },
      wishes: [{ id: 'a', title: 'A', priority: 2, reserved: false, reserved_by_me: false, received_at: null }],
    }
    const old = asListScreen(base)
    expect([old.received, old.list.photo]).toEqual([[], null])
    const now = asListScreen({
      ...base,
      list: { ...base.list, photo: { width: 960, height: 540, updated_at: 'v1' } },
      received: [{ id: 'b', title: 'B', priority: 3, reserved: true, reserved_by_me: true, received_at: '2026-10-20T10:00:00Z', stray: 1 }],
    })
    expect(now.list.photo).toEqual({ width: 960, height: 540, updated_at: 'v1' })
    expect(now.received).toEqual([expect.objectContaining({ id: 'b', reserved: true, reserved_by_me: true, received_at: '2026-10-20T10:00:00Z' })])
    expect(now.received?.[0]).not.toHaveProperty('stray')
    expect(asWishlist(now)).toMatchObject({ id: 'l', received: now.received, photo: now.list.photo })
    // a malformed meta counts as "no cover"
    expect(asListScreen({ ...base, list: { ...base.list, photo: { width: 0, height: 1, updated_at: 'x' } } }).list.photo).toBeNull()
  })

  it('buildListUrl: the app address of the list (no secret in it)', () => {
    expect(buildListUrl('1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f')).toMatch(/\/lists\/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f$/)
  })
})
