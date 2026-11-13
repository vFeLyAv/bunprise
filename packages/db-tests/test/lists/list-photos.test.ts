/**
 * List cover photos (supabase/migrations/20261022160000_list_photos_received_move.sql, part A) on PGlite.
 * The follows world of test/follows/seed.ts: Paula owns L1 ("Meine Follower": Finn + Greta accepted, Rosa only
 * asked), L2 ("Nur ich") and the occasion O1 with its list (Moritz is a guest); Paula blocked Bea; Xaver is a
 * stranger; O2 is Moritz's occasion (guests Paula, Bea, Finn).
 *   - the occasion-photo pattern: RPC only, the list owner writes, exactly the list's readers read, ONE not_found;
 *   - gone with the list / occasion / account (cascade), unreadable once access ends (Nur ich, unfollow,
 *     remove_follower, block, leaving the occasion);
 *   - every answer that carries a list carries `photo` (overview cards, upcoming, profile card, list screen,
 *     occasion screen, free wishes, export);
 *   - secrecy: the owner's answers are byte-identical across reservations; nothing new names the secret table.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { countAll, createMember, execAs, expectRpcError, rpc } from '../pilot/seed'
import { b64, fakeJpeg, fakeWebp, fromB64, MAX_PHOTO_BYTES } from '../pilot/photo-bytes'
import { createList, rpcText, seedFollows, type FollowSeed } from '../follows/seed'
import { ownerSnapshot } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface PhotoAnswer {
  mime: string
  data: string
  width: number
  height: number
  updated_at: string
}
type Json = Record<string, unknown>
type Meta = { width: number; height: number; updated_at: string } | null

function setPhoto(uid: string, listId: string, bytes: Uint8Array | string, opts: { mime?: string; width?: number; height?: number } = {}) {
  return rpc<{ ok: true; updated_at: string }>(t, uid, 'set_list_photo', [
    listId, opts.mime ?? 'image/webp', typeof bytes === 'string' ? bytes : b64(bytes), opts.width ?? 1600, opts.height ?? 1067,
  ])
}
const getPhoto = (uid: string, listId: string) => rpc<PhotoAnswer>(t, uid, 'get_list_photo', [listId])
const removePhoto = (uid: string, listId: string) => rpc<{ ok: true }>(t, uid, 'remove_list_photo', [listId])
const photoRows = (listId: string) => countAll(t, 'list_photos', 'wishlist_id = $1', [listId])
const UNKNOWN_LIST = '00000000-0000-4000-8000-00000000abcd'

describe('list photos: who writes, who reads', () => {
  let s: FollowSeed
  beforeAll(async () => {
    s = await seedFollows(t)
  })

  it('the owner sets, replaces and removes (a list without an occasion and an occasion list); one-line base64', async () => {
    const webp = fakeWebp(2048, 2)
    const first = await setPhoto(s.paula, s.l1, webp)
    expect(first).toEqual({ ok: true, updated_at: expect.any(String) })
    const got = await getPhoto(s.paula, s.l1)
    expect(got).toEqual({ mime: 'image/webp', data: expect.any(String), width: 1600, height: 1067, updated_at: first.updated_at })
    expect(got.data).not.toMatch(/\s/)
    expect(fromB64(got.data)).toEqual(webp)
    const jpeg = fakeJpeg(900, 3, 600, 800)
    const second = await setPhoto(s.paula, s.l1, jpeg, { mime: 'image/jpeg', width: 600, height: 800 })
    expect(Date.parse(second.updated_at)).toBeGreaterThan(Date.parse(first.updated_at))
    expect(await photoRows(s.l1)).toBe(1)
    expect(await setPhoto(s.paula, s.o1List, fakeWebp(300, 4))).toEqual({ ok: true, updated_at: expect.any(String) })
    expect(await removePhoto(s.paula, s.l1)).toEqual({ ok: true })
    expect(await removePhoto(s.paula, s.l1)).toEqual({ ok: true }) // idempotent
    await expectRpcError(getPhoto(s.paula, s.l1), 'not_found')
  })

  it('nobody but the owner writes: not_found, nothing changes', async () => {
    const bytes = fakeWebp(300, 5)
    await setPhoto(s.paula, s.l1, bytes)
    for (const uid of [s.finn, s.greta, s.rosa, s.moritz, s.bea, s.xaver]) {
      for (const list of [s.l1, s.l2, s.o1List, UNKNOWN_LIST]) {
        await expectRpcError(setPhoto(uid, list, fakeWebp(64, 9)), 'not_found')
        await expectRpcError(removePhoto(uid, list), 'not_found')
      }
    }
    // Paula is a guest of O2, not its owner
    await expectRpcError(setPhoto(s.paula, s.o2List, fakeWebp(64, 9)), 'not_found')
    await expectRpcError(removePhoto(s.paula, s.o2List), 'not_found')
    expect(fromB64((await getPhoto(s.paula, s.l1)).data)).toEqual(bytes)
  })

  it('readers = the list readers (followers of L1, the guest of O1); one not_found for everybody else', async () => {
    await setPhoto(s.paula, s.l2, fakeWebp(100, 6))
    await setPhoto(s.paula, s.o1List, fakeWebp(110, 7))
    const noPhoto = await expectRpcError(getPhoto(s.finn, s.o2List), 'not_found') // readable list (guest of O2), no photo
    const owner = await getPhoto(s.paula, s.l1)
    for (const uid of [s.finn, s.greta]) expect(await getPhoto(uid, s.l1), uid).toEqual(owner)
    expect((await getPhoto(s.moritz, s.o1List)).mime).toBe('image/webp')
    const refusals = [
      [s.rosa, s.l1], [s.xaver, s.l1], [s.bea, s.l1], [s.moritz, s.l1], // waiting / stranger / blocked / not a follower
      [s.finn, s.o1List], [s.greta, s.o1List], [s.bea, s.o1List], [s.xaver, s.o1List], // not a guest of O1
      [s.finn, s.l2], [s.greta, s.l2], [s.moritz, s.l2], // "Nur ich"
      [s.finn, UNKNOWN_LIST], // unknown list
    ] as const
    for (const [uid, list] of refusals) {
      const err = await expectRpcError(getPhoto(uid, list), 'not_found')
      expect({ code: err.code, message: err.message }, `${uid} ${list}`).toEqual({ code: noPhoto.code, message: noPhoto.message })
    }
  })

  it('access ends → the cover is unreadable at once: "Nur ich", unfollow, remove_follower, block, leaving the occasion', async () => {
    await setPhoto(s.paula, s.l1, fakeWebp(120, 8))
    await setPhoto(s.paula, s.o1List, fakeWebp(130, 8))
    expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'private'])).toEqual({ ok: true })
    await expectRpcError(getPhoto(s.finn, s.l1), 'not_found')
    expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'followers'])).toEqual({ ok: true })
    expect((await getPhoto(s.finn, s.l1)).mime).toBe('image/webp')
    await rpc(t, s.finn, 'unfollow', [s.paula])
    await expectRpcError(getPhoto(s.finn, s.l1), 'not_found')
    await rpc(t, s.paula, 'remove_follower', [s.greta])
    await expectRpcError(getPhoto(s.greta, s.l1), 'not_found')
    await rpc(t, s.moritz, 'leave_occasion', [s.o1])
    await expectRpcError(getPhoto(s.moritz, s.o1List), 'not_found')
  })

  it('a block ends reading as well (the guest who blocks the host)', async () => {
    const w = await seedFollows(t)
    await setPhoto(w.paula, w.o1List, fakeWebp(90, 2))
    expect((await getPhoto(w.moritz, w.o1List)).mime).toBe('image/webp')
    await rpc(t, w.moritz, 'block_user', [w.paula])
    await expectRpcError(getPhoto(w.moritz, w.o1List), 'not_found')
  })

  it('set needs current consents; remove does not', async () => {
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.paula]))
    try {
      await expectRpcError(setPhoto(s.paula, s.l2, fakeWebp(80)), 'consent_required')
      expect(await removePhoto(s.paula, s.l2)).toEqual({ ok: true })
    } finally {
      await t.asService((tx) =>
        tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [s.paula]),
      )
    }
  })

  it('anon cannot call any list-photo RPC', async () => {
    for (const call of [
      `select public.get_list_photo('${s.l1}')`,
      `select public.remove_list_photo('${s.l1}')`,
      `select public.set_list_photo('${s.l1}', 'image/webp', '${b64(fakeWebp(64))}', 10, 10)`,
      'select public.export_my_list_photos()',
    ]) {
      const err = await expectDbError(t.asAnon((tx) => tx.query(call)), '42501')
      expect(err.message, call).toMatch(/permission denied for function/)
    }
  })
})

describe('list photos: limits (the occasion photo limits) and the quota', () => {
  it('409600 decoded bytes and 2048 px are fine; one byte more, other types, wrong magic bytes or size are not', async () => {
    const s = await seedFollows(t)
    await setPhoto(s.paula, s.l1, fakeWebp(MAX_PHOTO_BYTES, 1, 'VP8 ', 2048, 2048), { width: 2048, height: 2048 })
    await expectRpcError(setPhoto(s.paula, s.l1, fakeWebp(MAX_PHOTO_BYTES + 1)), 'validation')
    await expectRpcError(setPhoto(s.paula, s.l1, fakeJpeg(200), { mime: 'image/webp' }), 'validation')
    await expectRpcError(setPhoto(s.paula, s.l1, fakeWebp(200), { mime: 'image/png' }), 'validation')
    await expectRpcError(setPhoto(s.paula, s.l1, fakeWebp(200), { width: 1599 }), 'validation') // stated ≠ real size
    await expectRpcError(setPhoto(s.paula, s.l1, '!!!!'), 'validation')
    // a bad input is refused before the owner check: the same answer for a foreign list
    await expectRpcError(setPhoto(s.finn, s.l1, '!!!!'), 'validation')
    expect(await scalar<number>(t.db, 'select octet_length(bytes) from list_photos where wishlist_id = $1', [s.l1])).toBe(MAX_PHOTO_BYTES)
  })

  it('at most 30 own lists with a photo (lists without an occasion + occasion lists); replacing is fine, removing frees a place', async () => {
    const owner = await createMember(t, 'Sammlerin')
    const lists: string[] = []
    for (let i = 0; i < 20; i++) lists.push(await createList(t, owner, `Liste ${i + 1}`))
    for (let i = 0; i < 11; i++) {
      const occasion = await t.asUser(owner, (tx) =>
        scalar<string>(tx, `insert into occasions (host_id, title, starts_at, tz) values ($1, $2, now() + interval '9 days', 'Europe/Berlin') returning id`, [owner, `Fest ${i + 1}`]),
      )
      lists.push(await scalar<string>(t.db, 'select id from wishlists where occasion_id = $1', [occasion]))
    }
    for (const id of lists.slice(0, 30)) await setPhoto(owner, id, fakeWebp(40))
    await expectRpcError(setPhoto(owner, lists[30]!, fakeWebp(40)), 'photo_limit')
    await setPhoto(owner, lists[5]!, fakeWebp(48, 2))
    await removePhoto(owner, lists[0]!)
    await setPhoto(owner, lists[30]!, fakeWebp(40))
    expect(await countAll(t, 'list_photos', 'updated_by = $1', [owner])).toBe(30)
  })
})

describe('list photos: no table access, cascades, export', () => {
  it('no privilege for the API roles on list_photos; RLS forced, no policy; the helper is not callable', async () => {
    const s = await seedFollows(t)
    await setPhoto(s.paula, s.l1, fakeWebp(64))
    for (const sql of ['select * from list_photos', 'select count(*) from list_photos', 'delete from list_photos', 'update list_photos set width = 2']) {
      for (const uid of [s.paula, s.finn]) {
        const err = await expectDbError(t.asUser(uid, (tx) => tx.query(sql)), '42501')
        expect(err.message, sql).toMatch(/permission denied for table list_photos/)
      }
      await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
    }
    for (const who of ['anon', 'authenticated', 'public']) {
      for (const priv of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
        expect(await scalar<boolean>(t.db, `select has_table_privilege('${who}', 'public.list_photos', '${priv}')`), `${who} ${priv}`).toBe(false)
      }
    }
    expect(await rows(t.db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.list_photos'::regclass`))
      .toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
    expect(await rows(t.db, `select policyname from pg_policies where schemaname = 'public' and tablename = 'list_photos'`)).toEqual([])
    expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', 'private.list_photo_meta(uuid)', 'execute')`)).toBe(false)
  })

  it('deleting the list, the occasion or the account deletes the covers', async () => {
    const s = await seedFollows(t)
    for (const list of [s.l1, s.l2, s.o1List]) await setPhoto(s.paula, list, fakeWebp(64))
    expect(await execAs(t, s.paula, 'delete from wishlists where id = $1', [s.l2])).toBe(1)
    expect(await photoRows(s.l2)).toBe(0)
    await expectRpcError(getPhoto(s.paula, s.l2), 'not_found')
    expect(await execAs(t, s.paula, 'delete from occasions where id = $1', [s.o1])).toBe(1)
    expect(await photoRows(s.o1List)).toBe(0)
    expect(await rpc(t, s.paula, 'delete_my_account')).toEqual({ ok: true })
    expect(await countAll(t, 'list_photos', 'updated_by = $1', [s.paula])).toBe(0)
  })

  it('export_my_list_photos: the own covers with bytes (an occasion list with the occasion title); a follower gets none', async () => {
    const s = await seedFollows(t)
    const bytes = fakeJpeg(700, 8, 640, 480)
    const set = await setPhoto(s.paula, s.l1, bytes, { mime: 'image/jpeg', width: 640, height: 480 })
    const occ = await setPhoto(s.paula, s.o1List, fakeWebp(64, 3), { width: 1600, height: 1067 })
    expect(await rpc(t, s.paula, 'export_my_list_photos')).toEqual([
      { wishlist_id: s.l1, list_title: 'Meine Wünsche', occasion_id: null, mime: 'image/jpeg', width: 640, height: 480,
        size_bytes: 700, updated_at: set.updated_at, data_base64: b64(bytes) },
      { wishlist_id: s.o1List, list_title: 'Paulas Gartenfest', occasion_id: s.o1, mime: 'image/webp', width: 1600, height: 1067,
        size_bytes: 64, updated_at: occ.updated_at, data_base64: b64(fakeWebp(64, 3)) },
    ])
    expect(await rpc(t, s.finn, 'export_my_list_photos')).toEqual([])
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.paula]))
    expect(await rpc<unknown[]>(t, s.paula, 'export_my_list_photos')).toHaveLength(2)
  })
})

describe('every answer that carries a list carries the photo meta', () => {
  let s: FollowSeed
  let l1At: string
  let o1At: string
  let o2At: string
  beforeAll(async () => {
    s = await seedFollows(t)
    l1At = (await setPhoto(s.paula, s.l1, fakeWebp(400, 1, 'VP8 ', 800, 600), { width: 800, height: 600 })).updated_at
    o1At = (await setPhoto(s.paula, s.o1List, fakeWebp(300, 2))).updated_at
    o2At = (await setPhoto(s.moritz, s.o2List, fakeWebp(200, 3, 'VP8 ', 640, 480), { width: 640, height: 480 })).updated_at
  })
  const l1Meta = (): Meta => ({ width: 800, height: 600, updated_at: l1At })

  it('get_lists_overview: my_lists (owner), following[].lists and upcoming[].list (follower / guest)', async () => {
    const own = await rpc<{ my_lists: Json[] }>(t, s.paula, 'get_lists_overview')
    const photos = Object.fromEntries(own.my_lists.map((l) => [l.id as string, l.photo]))
    expect(photos).toEqual({ [s.l1]: l1Meta(), [s.l2]: null, [s.o1List]: { width: 1600, height: 1067, updated_at: o1At } })
    const finn = await rpc<{ following: { lists: Json[] }[]; upcoming: { list: Json }[] }>(t, s.finn, 'get_lists_overview')
    expect(finn.following[0]!.lists.map((l) => l.photo)).toEqual([l1Meta()])
    expect(finn.upcoming.map((u) => [u.list.id, u.list.photo])).toEqual([[s.o2List, { width: 640, height: 480, updated_at: o2At }]])
  })

  it('get_profile_card: the follower list cards', async () => {
    const card = await rpc<{ lists: Json[] }>(t, s.greta, 'get_profile_card', [s.paula])
    expect(card.lists.map((l) => [l.id, l.photo])).toEqual([[s.l1, l1Meta()]])
  })

  it('get_list_screen (owner and follower) and get_occasion_screen (host and guest)', async () => {
    for (const uid of [s.paula, s.finn]) {
      const sc = await rpc<{ list: Json }>(t, uid, 'get_list_screen', [s.l1])
      expect(sc.list.photo, uid).toEqual(l1Meta())
    }
    for (const uid of [s.paula, s.moritz]) {
      const sc = await rpc<{ wishlist: Json; occasion: Json }>(t, uid, 'get_occasion_screen', [s.o1])
      expect(sc.wishlist.photo, uid).toEqual({ width: 1600, height: 1067, updated_at: o1At })
      expect(sc.occasion.photo, uid).toBeNull() // the occasion's own cover is a different thing
    }
    const plain = await rpc<{ list: Json }>(t, s.paula, 'get_list_screen', [s.l2])
    expect(plain.list.photo).toBeNull()
  })

  it('get_free_wishes: ideas[].list.photo', async () => {
    const free = await rpc<{ ideas: { list: Json }[] }>(t, s.finn, 'get_free_wishes', [s.paula, null])
    expect(free.ideas.length).toBeGreaterThan(0)
    for (const idea of free.ideas) expect(idea.list.photo).toEqual(l1Meta())
  })

  it('export_my_data: the own lists carry the meta (the bytes: export_my_list_photos)', async () => {
    const text = await t.asUser(s.paula, (tx) => scalar<string>(tx, 'select public.export_my_data()::text'))
    const data = JSON.parse(text) as { wishlists: Json[] }
    expect(data.wishlists.find((l) => l.id === s.l1)!.photo).toEqual(l1Meta())
    expect(text).not.toContain(b64(fakeWebp(400, 1, 'VP8 ', 800, 600)))
  })
})

describe('secrecy: list covers say nothing about reservations', () => {
  it("the owner's whole world is byte-identical before and after reservations; nothing new names the secret table", async () => {
    const s = await seedFollows(t)
    await setPhoto(s.paula, s.l1, fakeWebp(256, 3))
    await setPhoto(s.paula, s.o1List, fakeWebp(256, 4))
    const snapshot = async () => ({
      ...(await ownerSnapshot(t, s.paula, { occasionIds: [s.o1], listIds: [s.l1, s.l2], profileIds: [s.finn] })),
      l1Photo: await rpcText(t, s.paula, 'get_list_photo', [s.l1]),
      o1Photo: await rpcText(t, s.paula, 'get_list_photo', [s.o1List]),
      photos: await rpcText(t, s.paula, 'export_my_list_photos'),
    })
    const before = await snapshot()
    expect(await rpc(t, s.finn, 'reserve_wish', [s.l1Wishes[0]])).toEqual({ ok: true })
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.o1Wish])).toEqual({ ok: true })
    expect(await snapshot()).toEqual(before)
    // the givers read the same cover as everybody else
    expect(await getPhoto(s.finn, s.l1)).toEqual(await getPhoto(s.greta, s.l1))
    expect(await rpc(t, s.finn, 'cancel_reservation', [s.l1Wishes[0]])).toEqual({ ok: true })
    expect(await snapshot()).toEqual(before)

    const src = await rows<{ fn: string; src: string }>(
      t.db,
      `select p.proname as fn, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.proname in ('list_photo_meta', 'set_list_photo', 'remove_list_photo', 'get_list_photo', 'export_my_list_photos')`,
    )
    expect(src.map((x) => x.fn).sort()).toEqual(['export_my_list_photos', 'get_list_photo', 'list_photo_meta', 'remove_list_photo', 'set_list_photo'])
    for (const x of src) expect(x.src, x.fn).not.toMatch(/reserv/i)
  })
})
