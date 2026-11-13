/**
 * Wish details + wish photos (supabase/migrations/20261022120000_wish_details.sql) on PGlite.
 * The follows world of test/follows/seed.ts: Paula owns L1 ("Meine Follower": Finn + Greta accepted, Rosa only
 * asked), L2 ("Nur ich") and the occasion O1 (Moritz is a guest); Paula blocked Bea; Xaver is a stranger.
 *   - the five detail columns: CHECK constraints, owner-only writes, read by exactly the wish's readers (REST);
 *   - every RPC that returns wishes carries them (+ photo meta) — get_occasion_screen, get_list_screen,
 *     get_free_wishes, export_my_data;
 *   - wish photos: the occasion-photo pattern (RPC only, owner writes, the wish's readers read, one not_found);
 *     gone with the wish / list / account (cascade), unreadable once access ends (unfollow, "Nur ich", block);
 *   - secrecy: the owner's answers stay byte-identical across reservations; nothing new mentions reservations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { countAll, createMember, execAs, expectRpcError, rpc } from '../pilot/seed'
import { b64, fakeJpeg, fakeWebp, fromB64, MAX_PHOTO_BYTES } from '../pilot/photo-bytes'
import { addWish, createList, rpcText, seedFollows, type FollowSeed } from '../follows/seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const DETAILS = {
  description: 'Over-Ear, Geräuschunterdrückung, 30 h Akku.',
  brand: 'Klangwerk',
  color: 'Mitternachtsblau',
  gtin: '4006381333931',
  shop_name: 'Zalando',
} as const
const DETAIL_KEYS = ['brand', 'color', 'description', 'gtin', 'photo', 'shop_name'] as const

interface PhotoAnswer {
  mime: string
  data: string
  width: number
  height: number
  updated_at: string
}

type Json = Record<string, unknown>

function setPhoto(uid: string, wishId: string, bytes: Uint8Array | string, opts: { mime?: string; width?: number; height?: number } = {}) {
  return rpc<{ ok: true; updated_at: string }>(t, uid, 'set_wish_photo', [
    wishId, opts.mime ?? 'image/webp', typeof bytes === 'string' ? bytes : b64(bytes), opts.width ?? 1600, opts.height ?? 1067,
  ])
}
const getPhoto = (uid: string, wishId: string) => rpc<PhotoAnswer>(t, uid, 'get_wish_photo', [wishId])
const removePhoto = (uid: string, wishId: string) => rpc<{ ok: true }>(t, uid, 'remove_wish_photo', [wishId])
const photoRows = (wishId: string) => countAll(t, 'wish_photos', 'wish_id = $1', [wishId])

function setDetails(uid: string, wishId: string, details: Partial<Record<keyof typeof DETAILS, string | null>> = DETAILS) {
  const keys = Object.keys(details) as (keyof typeof DETAILS)[]
  const sets = keys.map((key, i) => `${key} = $${i + 2}`).join(', ')
  return execAs(t, uid, `update wishes set ${sets} where id = $1`, [wishId, ...keys.map((key) => details[key])])
}

function wishIn(list: readonly Json[], id: string, key = 'id'): Json {
  const found = list.find((w) => w[key] === id)
  if (!found) throw new Error(`wish ${id} not in the answer`)
  return found
}

describe('the detail columns', () => {
  let s: FollowSeed
  beforeAll(async () => {
    s = await seedFollows(t)
  })

  it('the owner inserts and updates them through REST (insert … returning, like lib/api/wishes.ts)', async () => {
    const id = await t.asUser(s.paula, (tx) =>
      scalar<string>(
        tx,
        `insert into wishes (wishlist_id, title, description, brand, color, gtin, shop_name)
         values ($1, 'Rucksack', $2, $3, $4, $5, $6) returning id`,
        [s.l1, DETAILS.description, DETAILS.brand, DETAILS.color, DETAILS.gtin, DETAILS.shop_name],
      ),
    )
    expect(await setDetails(s.paula, id, { color: 'Grün', gtin: '12345678', shop_name: null })).toBe(1)
    const row = await t.asUser(s.paula, (tx) => rows(tx, 'select description, brand, color, gtin, shop_name from wishes where id = $1', [id]))
    expect(row).toEqual([{ description: DETAILS.description, brand: DETAILS.brand, color: 'Grün', gtin: '12345678', shop_name: null }])
  })

  it('CHECK constraints: lengths of the raw string, no blank values, GTIN = 8 … 14 digits', async () => {
    const ok: Partial<Record<keyof typeof DETAILS, string>>[] = [
      { description: 'x'.repeat(1000) }, { brand: 'b'.repeat(80) }, { color: 'c'.repeat(60) }, { shop_name: 's'.repeat(80) },
      { gtin: '12345678' }, { gtin: '12345678901234' }, { brand: ' Lego ' },
    ]
    for (const details of ok) expect(await setDetails(s.paula, s.l1Wishes[0], details), JSON.stringify(details)).toBe(1)
    const bad: Partial<Record<keyof typeof DETAILS, string>>[] = [
      { description: 'x'.repeat(1001) }, { description: '' }, { description: '   ' },
      // (btrim() trims spaces only — the style of every text check since v1.1; the client trims all whitespace)
      { brand: 'b'.repeat(81) }, { brand: '' }, { brand: '   ' },
      { color: 'c'.repeat(61) }, { color: '' },
      { shop_name: 's'.repeat(81) }, { shop_name: ' ' },
      { gtin: '1234567' }, { gtin: '123456789012345' }, { gtin: '40063813339a1' }, { gtin: ' 12345678' }, { gtin: '' },
    ]
    for (const details of bad) {
      await expectDbError(setDetails(s.paula, s.l1Wishes[0], details), '23514')
    }
  })

  it('only the owner writes them: a follower, a guest and a stranger update nothing', async () => {
    await setDetails(s.paula, s.l1Wishes[1], DETAILS)
    for (const uid of [s.finn, s.moritz, s.xaver]) {
      expect(await setDetails(uid, s.l1Wishes[1], { brand: 'Fremd' }), uid).toBe(0)
      expect(await setDetails(uid, s.o1Wish, { brand: 'Fremd' }), uid).toBe(0)
    }
    expect(await scalar<string>(t.db, 'select brand from wishes where id = $1', [s.l1Wishes[1]])).toBe(DETAILS.brand)
  })

  it('REST read: exactly the wish readers (follower of L1, guest of O1), nobody else; GTIN included', async () => {
    await setDetails(s.paula, s.o1Wish, DETAILS)
    const read = (uid: string, id: string) =>
      t.asUser(uid, (tx) => rows(tx, 'select description, brand, color, gtin, shop_name from wishes where id = $1', [id]))
    expect(await read(s.finn, s.l1Wishes[1])).toEqual([DETAILS])
    expect(await read(s.moritz, s.o1Wish)).toEqual([DETAILS])
    for (const uid of [s.rosa, s.xaver, s.bea, s.moritz]) expect(await read(uid, s.l1Wishes[1]), uid).toEqual([])
    for (const uid of [s.finn, s.xaver, s.bea]) expect(await read(uid, s.o1Wish), uid).toEqual([])
  })
})

describe('every RPC that returns wishes carries the details and the photo meta', () => {
  let s: FollowSeed
  let photoAt: string
  beforeAll(async () => {
    s = await seedFollows(t)
    await setDetails(s.paula, s.l1Wishes[0], DETAILS)
    await setDetails(s.paula, s.o1Wish, DETAILS)
    photoAt = (await setPhoto(s.paula, s.l1Wishes[0], fakeWebp(400, 1, 'VP8 ', 800, 600), { width: 800, height: 600 })).updated_at
  })

  const expected = () => ({ ...DETAILS, photo: { width: 800, height: 600, updated_at: photoAt } })
  const pick = (w: Json) => Object.fromEntries(DETAIL_KEYS.map((key) => [key, w[key]]))

  it('get_list_screen: owner and follower branch', async () => {
    for (const uid of [s.paula, s.finn]) {
      const sc = await rpc<{ wishes: Json[] }>(t, uid, 'get_list_screen', [s.l1])
      expect(pick(wishIn(sc.wishes, s.l1Wishes[0])), uid).toEqual(expected())
      // a wish without details: every key present, null
      expect(pick(wishIn(sc.wishes, s.l1Wishes[2])), uid).toEqual(Object.fromEntries(DETAIL_KEYS.map((key) => [key, null])))
    }
  })

  it('get_occasion_screen: host and guest branch (photo null without one)', async () => {
    for (const uid of [s.paula, s.moritz]) {
      const sc = await rpc<{ wishlist: { wishes: Json[] } }>(t, uid, 'get_occasion_screen', [s.o1])
      expect(pick(wishIn(sc.wishlist.wishes, s.o1Wish)), uid).toEqual({ ...DETAILS, photo: null })
    }
  })

  it('get_free_wishes: the follower sees the details of a free wish', async () => {
    const free = await rpc<{ ideas: Json[] }>(t, s.finn, 'get_free_wishes', [s.paula, null])
    expect(pick(wishIn(free.ideas, s.l1Wishes[0], 'wish_id'))).toEqual(expected())
  })

  it('export_my_data: the owner gets the details of the own wishes (the bytes: export_my_wish_photos)', async () => {
    const text = await t.asUser(s.paula, (tx) => scalar<string>(tx, 'select public.export_my_data()::text'))
    const data = JSON.parse(text) as { wishlists: { wishes: Json[] }[] }
    const wish = wishIn(data.wishlists.flatMap((l) => l.wishes), s.l1Wishes[0])
    expect(pick(wish)).toEqual(expected())
    expect(text).not.toContain(b64(fakeWebp(400, 1, 'VP8 ', 800, 600)))
  })
})

describe('wish photos: who writes, who reads', () => {
  let s: FollowSeed
  beforeAll(async () => {
    s = await seedFollows(t)
  })

  it('the owner sets, replaces and removes; the stored bytes come back as one-line base64', async () => {
    const webp = fakeWebp(2048, 2)
    const first = await setPhoto(s.paula, s.l1Wishes[0], webp)
    expect(first).toEqual({ ok: true, updated_at: expect.any(String) })
    const got = await getPhoto(s.paula, s.l1Wishes[0])
    expect(got).toEqual({ mime: 'image/webp', data: expect.any(String), width: 1600, height: 1067, updated_at: first.updated_at })
    expect(got.data).not.toMatch(/\s/)
    expect(fromB64(got.data)).toEqual(webp)
    const jpeg = fakeJpeg(900, 3, 600, 800)
    const second = await setPhoto(s.paula, s.l1Wishes[0], jpeg, { mime: 'image/jpeg', width: 600, height: 800 })
    expect(Date.parse(second.updated_at)).toBeGreaterThan(Date.parse(first.updated_at))
    expect(await photoRows(s.l1Wishes[0])).toBe(1)
    expect(await removePhoto(s.paula, s.l1Wishes[0])).toEqual({ ok: true })
    expect(await removePhoto(s.paula, s.l1Wishes[0])).toEqual({ ok: true })
    await expectRpcError(getPhoto(s.paula, s.l1Wishes[0]), 'not_found')
  })

  it('nobody but the owner writes: not_found, nothing changes', async () => {
    const bytes = fakeWebp(300, 4)
    await setPhoto(s.paula, s.l1Wishes[1], bytes)
    await setPhoto(s.paula, s.o1Wish, fakeWebp(300, 5))
    for (const uid of [s.finn, s.greta, s.rosa, s.moritz, s.bea, s.xaver]) {
      for (const wish of [s.l1Wishes[1], s.o1Wish, s.l2Wish]) {
        await expectRpcError(setPhoto(uid, wish, fakeWebp(64, 9)), 'not_found')
        await expectRpcError(removePhoto(uid, wish), 'not_found')
      }
    }
    expect(fromB64((await getPhoto(s.paula, s.l1Wishes[1])).data)).toEqual(bytes)
  })

  it('readers = the wish readers: followers of L1, the guest of O1; one not_found for everybody else', async () => {
    const noPhoto = await expectRpcError(getPhoto(s.finn, s.l1Wishes[2]), 'not_found') // readable wish, no photo
    const owner = await getPhoto(s.paula, s.l1Wishes[1])
    for (const uid of [s.finn, s.greta]) expect(await getPhoto(uid, s.l1Wishes[1]), uid).toEqual(owner)
    expect((await getPhoto(s.moritz, s.o1Wish)).mime).toBe('image/webp')
    await setPhoto(s.paula, s.l2Wish, fakeWebp(100, 6))
    const refusals = [
      [s.rosa, s.l1Wishes[1]], [s.xaver, s.l1Wishes[1]], [s.bea, s.l1Wishes[1]], [s.moritz, s.l1Wishes[1]], // not a follower / stranger / blocked
      [s.finn, s.o1Wish], [s.bea, s.o1Wish], [s.xaver, s.o1Wish], // not a guest of O1
      [s.finn, s.l2Wish], [s.greta, s.l2Wish], [s.moritz, s.l2Wish], // "Nur ich"
      [s.finn, '00000000-0000-4000-8000-00000000abcd'], // unknown wish
    ] as const
    for (const [uid, wish] of refusals) {
      const err = await expectRpcError(getPhoto(uid, wish), 'not_found')
      expect({ code: err.code, message: err.message }).toEqual({ code: noPhoto.code, message: noPhoto.message })
    }
  })

  it('access ends → the photo is unreadable at once: "Nur ich", unfollow, remove_follower, block, leaving the occasion', async () => {
    await setPhoto(s.paula, s.l1Wishes[1], fakeWebp(120, 7))
    expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'private'])).toEqual({ ok: true })
    await expectRpcError(getPhoto(s.finn, s.l1Wishes[1]), 'not_found')
    expect(await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'followers'])).toEqual({ ok: true })
    expect((await getPhoto(s.finn, s.l1Wishes[1])).mime).toBe('image/webp')
    await rpc(t, s.finn, 'unfollow', [s.paula])
    await expectRpcError(getPhoto(s.finn, s.l1Wishes[1]), 'not_found')
    await rpc(t, s.paula, 'remove_follower', [s.greta])
    await expectRpcError(getPhoto(s.greta, s.l1Wishes[1]), 'not_found')
    await rpc(t, s.moritz, 'block_user', [s.paula])
    await expectRpcError(getPhoto(s.moritz, s.o1Wish), 'not_found')
  })

  it('set needs current consents; remove does not', async () => {
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.paula]))
    try {
      await expectRpcError(setPhoto(s.paula, s.l1Wishes[2], fakeWebp(80)), 'consent_required')
      expect(await removePhoto(s.paula, s.l1Wishes[1])).toEqual({ ok: true })
    } finally {
      await t.asService((tx) =>
        tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [s.paula]),
      )
    }
  })

  it('anon cannot call any wish-photo RPC', async () => {
    for (const call of [
      `select public.get_wish_photo('${s.l1Wishes[0]}')`,
      `select public.remove_wish_photo('${s.l1Wishes[0]}')`,
      `select public.set_wish_photo('${s.l1Wishes[0]}', 'image/webp', '${b64(fakeWebp(64))}', 10, 10)`,
      'select public.export_my_wish_photos()',
    ]) {
      const err = await expectDbError(t.asAnon((tx) => tx.query(call)), '42501')
      expect(err.message, call).toMatch(/permission denied for function/)
    }
  })
})

describe('wish photos: limits (the occasion photo limits)', () => {
  let s: FollowSeed
  beforeAll(async () => {
    s = await seedFollows(t)
  })

  it('409600 decoded bytes and 2048 px are fine; one byte more, other types or wrong magic bytes are not', async () => {
    await setPhoto(s.paula, s.l1Wishes[0], fakeWebp(MAX_PHOTO_BYTES, 1, 'VP8 ', 2048, 2048), { width: 2048, height: 2048 })
    await expectRpcError(setPhoto(s.paula, s.l1Wishes[0], fakeWebp(MAX_PHOTO_BYTES + 1)), 'validation')
    await expectRpcError(setPhoto(s.paula, s.l1Wishes[0], fakeJpeg(200), { mime: 'image/webp' }), 'validation')
    await expectRpcError(setPhoto(s.paula, s.l1Wishes[0], fakeWebp(200), { mime: 'image/png' }), 'validation')
    await expectRpcError(setPhoto(s.paula, s.l1Wishes[0], fakeWebp(200), { width: 1599 }), 'validation') // stated ≠ real size
    await expectRpcError(setPhoto(s.paula, s.l1Wishes[0], '!!!!'), 'validation')
    expect(await scalar<number>(t.db, 'select octet_length(bytes) from wish_photos where wish_id = $1', [s.l1Wishes[0]])).toBe(MAX_PHOTO_BYTES)
  })

  it('at most 100 own wishes with a photo; replacing is fine, removing frees a place', async () => {
    const owner = await createMember(t, 'Sammlerin')
    const list = await createList(t, owner, 'Viele')
    const ids: string[] = []
    for (let i = 0; i < 101; i++) ids.push(await addWish(t, owner, list, `Wunsch ${i + 1}`))
    for (const id of ids.slice(0, 100)) await setPhoto(owner, id, fakeWebp(40))
    await expectRpcError(setPhoto(owner, ids[100]!, fakeWebp(40)), 'photo_limit')
    await setPhoto(owner, ids[5]!, fakeWebp(48, 2))
    await removePhoto(owner, ids[0]!)
    await setPhoto(owner, ids[100]!, fakeWebp(40))
    expect(await countAll(t, 'wish_photos', 'updated_by = $1', [owner])).toBe(100)
  })
})

describe('wish photos: no table access, cascades, export', () => {
  it('no privilege for the API roles on wish_photos; RLS forced, no policy; the helper is not callable', async () => {
    const s = await seedFollows(t)
    await setPhoto(s.paula, s.l1Wishes[0], fakeWebp(64))
    for (const sql of ['select * from wish_photos', 'select count(*) from wish_photos', 'delete from wish_photos', 'update wish_photos set width = 2']) {
      for (const uid of [s.paula, s.finn]) {
        const err = await expectDbError(t.asUser(uid, (tx) => tx.query(sql)), '42501')
        expect(err.message, sql).toMatch(/permission denied for table wish_photos/)
      }
      await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
    }
    for (const who of ['anon', 'authenticated', 'public']) {
      for (const priv of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
        expect(await scalar<boolean>(t.db, `select has_table_privilege('${who}', 'public.wish_photos', '${priv}')`), `${who} ${priv}`).toBe(false)
      }
    }
    expect(await rows(t.db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.wish_photos'::regclass`))
      .toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
    expect(await rows(t.db, `select policyname from pg_policies where schemaname = 'public' and tablename = 'wish_photos'`)).toEqual([])
    expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', 'private.wish_detail_fields(public.wishes)', 'execute')`)).toBe(false)
  })

  it('deleting the wish, the list, the occasion or the account deletes the photos', async () => {
    const s = await seedFollows(t)
    const extra = await addWish(t, s.paula, s.l2, 'Noch einer')
    for (const wish of [s.l1Wishes[0], s.l1Wishes[1], s.l2Wish, extra, s.o1Wish]) await setPhoto(s.paula, wish, fakeWebp(64))
    expect(await execAs(t, s.paula, 'delete from wishes where id = $1', [s.l1Wishes[0]])).toBe(1)
    expect(await photoRows(s.l1Wishes[0])).toBe(0)
    await expectRpcError(getPhoto(s.paula, s.l1Wishes[0]), 'not_found')
    expect(await execAs(t, s.paula, 'delete from wishlists where id = $1', [s.l2])).toBe(1)
    expect(await countAll(t, 'wish_photos', 'wish_id = any($1::uuid[])', [[s.l2Wish, extra]])).toBe(0)
    expect(await execAs(t, s.paula, 'delete from occasions where id = $1', [s.o1])).toBe(1)
    expect(await photoRows(s.o1Wish)).toBe(0)
    expect(await rpc(t, s.paula, 'delete_my_account')).toEqual({ ok: true })
    expect(await countAll(t, 'wish_photos', 'updated_by = $1', [s.paula])).toBe(0)
  })

  it('export_my_wish_photos: the own photos with bytes; a follower gets none of them', async () => {
    const s = await seedFollows(t)
    const bytes = fakeJpeg(700, 8, 640, 480)
    const set = await setPhoto(s.paula, s.l1Wishes[0], bytes, { mime: 'image/jpeg', width: 640, height: 480 })
    expect(await rpc(t, s.paula, 'export_my_wish_photos')).toEqual([{
      wish_id: s.l1Wishes[0], wish_title: 'Kopfhörer', wishlist_id: s.l1, mime: 'image/jpeg', width: 640, height: 480,
      size_bytes: 700, updated_at: set.updated_at, data_base64: b64(bytes),
    }])
    expect(await rpc(t, s.finn, 'export_my_wish_photos')).toEqual([])
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.paula]))
    expect(await rpc<unknown[]>(t, s.paula, 'export_my_wish_photos')).toHaveLength(1)
  })
})

describe('secrecy: the details and photos say nothing about reservations', () => {
  it("the owner's screens and photo answer are byte-identical before and after reservations; reserve/cancel work", async () => {
    const s = await seedFollows(t)
    await setDetails(s.paula, s.l1Wishes[0], DETAILS)
    await setDetails(s.paula, s.o1Wish, DETAILS)
    await setPhoto(s.paula, s.l1Wishes[0], fakeWebp(256, 3))
    await setPhoto(s.paula, s.o1Wish, fakeWebp(256, 4))
    const snapshot = async () => [
      await rpcText(t, s.paula, 'get_list_screen', [s.l1]),
      await rpcText(t, s.paula, 'get_occasion_screen', [s.o1]),
      await rpcText(t, s.paula, 'get_wish_photo', [s.l1Wishes[0]]),
      await rpcText(t, s.paula, 'get_wish_photo', [s.o1Wish]),
      await t.asUser(s.paula, (tx) => scalar<string>(tx, `select (public.export_my_data() - 'exported_at')::text`)),
      await rpcText(t, s.paula, 'export_my_wish_photos'),
    ]
    const before = await snapshot()
    expect(await rpc(t, s.finn, 'reserve_wish', [s.l1Wishes[0]])).toEqual({ ok: true })
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.o1Wish])).toEqual({ ok: true })
    expect(await snapshot()).toEqual(before)
    // the giver sees "taken by me", the other follower only "taken" — the new keys are the same for both
    const finn = await rpc<{ wishes: Json[] }>(t, s.finn, 'get_list_screen', [s.l1])
    const greta = await rpc<{ wishes: Json[] }>(t, s.greta, 'get_list_screen', [s.l1])
    const strip = (w: Json) => { const { reserved: _r, reserved_by_me: _m, ...rest } = w; return rest }
    expect(strip(wishIn(finn.wishes, s.l1Wishes[0]))).toEqual(strip(wishIn(greta.wishes, s.l1Wishes[0])))
    expect(await getPhoto(s.greta, s.l1Wishes[0])).toEqual(await getPhoto(s.finn, s.l1Wishes[0]))
    // a reserved wish leaves the free list (as before), the details never bring it back
    const free = await rpc<{ ideas: Json[] }>(t, s.greta, 'get_free_wishes', [s.paula, null])
    expect(free.ideas.map((i) => i.wish_id)).not.toContain(s.l1Wishes[0])
    expect(await rpc(t, s.finn, 'cancel_reservation', [s.l1Wishes[0]])).toEqual({ ok: true })
    expect(await rpc(t, s.moritz, 'cancel_reservation', [s.o1Wish])).toEqual({ ok: true })
    expect(await snapshot()).toEqual(before)
  })

  it('no new function or column mentions reservations', async () => {
    const src = await rows<{ fn: string; src: string }>(
      t.db,
      `select p.proname as fn, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.proname in ('wish_detail_fields', 'set_wish_photo', 'remove_wish_photo', 'get_wish_photo', 'export_my_wish_photos')`,
    )
    expect(src.map((x) => x.fn).sort()).toEqual(['export_my_wish_photos', 'get_wish_photo', 'remove_wish_photo', 'set_wish_photo', 'wish_detail_fields'])
    for (const x of src) expect(x.src, x.fn).not.toMatch(/reserv/i)
  })
})
