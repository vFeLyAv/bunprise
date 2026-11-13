/**
 * Occasion cover photos (supabase/migrations/20261020160000_occasion_photos.sql) on PGlite.
 * Host A (Anna), members B (Ben) and C (Cem), outsider D (Dana) from seedPilot().
 *   - only the host sets / replaces / removes; host + active members read; everybody else (outsider, former
 *     member, blocked pair, unknown occasion) gets the SAME 'not_found' as "there is no photo";
 *   - limits: decoded size 1 … 409600 bytes, magic bytes match the mime, 1 … 2048 px, 20 photos per host;
 *   - no direct table access at all (no grants, RLS forced without a policy);
 *   - cascade with the occasion and with the host account; export of the own photos;
 *   - get_occasion_screen carries occasion.photo (meta or null) and the owner's answer stays byte-identical
 *     across reservation traffic (nothing about reservations changes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { countAll, createMember, execAs, expectRpcError, rpc, screen, screenText, seedPilot, type Seed } from './seed'
import { b64, fakeJpeg, fakeWebp, fromB64, MAX_PHOTO_BYTES } from './photo-bytes'

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

interface ExportedPhoto {
  occasion_id: string
  occasion_title: string
  mime: string
  width: number
  height: number
  size_bytes: number
  updated_at: string
  data_base64: string
}

interface PhotoOptions {
  mime?: string | null
  width?: number | null
  height?: number | null
}

function setPhoto(uid: string, occasionId: string, bytes: Uint8Array | string, opts: PhotoOptions = {}) {
  const data = typeof bytes === 'string' ? bytes : b64(bytes)
  return rpc<{ ok: true; updated_at: string }>(t, uid, 'set_occasion_photo', [
    occasionId,
    opts.mime === undefined ? 'image/webp' : opts.mime,
    data,
    opts.width === undefined ? 1600 : opts.width,
    opts.height === undefined ? 1067 : opts.height,
  ])
}
const getPhoto = (uid: string, occasionId: string) => rpc<PhotoAnswer>(t, uid, 'get_occasion_photo', [occasionId])
const removePhoto = (uid: string, occasionId: string) => rpc<{ ok: true }>(t, uid, 'remove_occasion_photo', [occasionId])
const exportPhotos = (uid: string) => rpc<ExportedPhoto[]>(t, uid, 'export_my_occasion_photos')
const photoRows = (occasionId: string) => countAll(t, 'occasion_photos', 'occasion_id = $1', [occasionId])
const storedBytes = (occasionId: string) =>
  t.asService((tx) => scalar<Uint8Array>(tx, 'select bytes from occasion_photos where occasion_id = $1', [occasionId]))

/** A second occasion of the same host (the trigger adds membership + list). */
async function hostOccasion(host: string, title: string, inDays = 40): Promise<string> {
  return t.asUser(host, (tx) =>
    scalar<string>(
      tx,
      `insert into occasions (host_id, title, starts_at, tz) values ($1, $2, now() + make_interval(days => $3::int), 'Europe/Berlin') returning id`,
      [host, title, inDays],
    ),
  )
}

describe('the host sets, replaces and removes the cover', () => {
  let s: Seed
  beforeAll(async () => {
    s = await seedPilot(t)
  })

  it('set: stored with mime, size and author; the answer carries the version', async () => {
    const webp = fakeWebp(2048, 1)
    const answer = await setPhoto(s.a, s.occasionId, webp, { width: 1600, height: 1067 })
    expect(answer).toEqual({ ok: true, updated_at: expect.any(String) })
    const row = await t.asService((tx) =>
      rows<{ mime: string; width: number; height: number; updated_by: string; size: number }>(
        tx,
        'select mime, width, height, updated_by, octet_length(bytes) as size from occasion_photos where occasion_id = $1',
        [s.occasionId],
      ),
    )
    expect(row).toEqual([{ mime: 'image/webp', width: 1600, height: 1067, updated_by: s.a, size: 2048 }])
    expect(await storedBytes(s.occasionId)).toEqual(webp)
  })

  it('get as host: the same bytes back as one-line base64, plus the stated size and version', async () => {
    const photo = await getPhoto(s.a, s.occasionId)
    expect(photo).toEqual({ mime: 'image/webp', data: expect.any(String), width: 1600, height: 1067, updated_at: expect.any(String) })
    expect(photo.data).not.toMatch(/\s/)
    expect(fromB64(photo.data)).toEqual(fakeWebp(2048, 1))
  })

  it('replace: one row, new bytes and type, a newer version', async () => {
    const before = await getPhoto(s.a, s.occasionId)
    const jpeg = fakeJpeg(4096, 2, 1200, 1600)
    const answer = await setPhoto(s.a, s.occasionId, jpeg, { mime: 'image/jpeg', width: 1200, height: 1600 })
    expect(Date.parse(answer.updated_at)).toBeGreaterThan(Date.parse(before.updated_at))
    expect(await photoRows(s.occasionId)).toBe(1)
    const after = await getPhoto(s.a, s.occasionId)
    expect(after).toMatchObject({ mime: 'image/jpeg', width: 1200, height: 1600, updated_at: answer.updated_at })
    expect(fromB64(after.data)).toEqual(jpeg)
  })

  it('members and outsiders cannot write: not_found, nothing changes', async () => {
    const before = await storedBytes(s.occasionId)
    for (const uid of [s.b, s.c, s.d]) {
      await expectRpcError(setPhoto(uid, s.occasionId, fakeWebp(64, 9)), 'not_found')
      await expectRpcError(removePhoto(uid, s.occasionId), 'not_found')
    }
    expect(await storedBytes(s.occasionId)).toEqual(before)
  })

  it('remove: the photo is gone, a second remove is fine, reading answers not_found', async () => {
    expect(await removePhoto(s.a, s.occasionId)).toEqual({ ok: true })
    expect(await photoRows(s.occasionId)).toBe(0)
    expect(await removePhoto(s.a, s.occasionId)).toEqual({ ok: true })
    await expectRpcError(getPhoto(s.a, s.occasionId), 'not_found')
    await expectRpcError(getPhoto(s.b, s.occasionId), 'not_found')
  })

  it('an unknown occasion: not_found for set, remove and get', async () => {
    const unknown = '00000000-0000-4000-8000-00000000abcd'
    await expectRpcError(setPhoto(s.a, unknown, fakeWebp(64)), 'not_found')
    await expectRpcError(removePhoto(s.a, unknown), 'not_found')
    await expectRpcError(getPhoto(s.a, unknown), 'not_found')
  })

  it('set needs current consents; remove does not (own data can always go)', async () => {
    const occasionId = await hostOccasion(s.a, 'Ohne Zustimmung')
    await setPhoto(s.a, occasionId, fakeWebp(64))
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.a]))
    try {
      await expectRpcError(setPhoto(s.a, occasionId, fakeWebp(80)), 'consent_required')
      expect(await removePhoto(s.a, occasionId)).toEqual({ ok: true })
      expect(await photoRows(occasionId)).toBe(0)
    } finally {
      await t.asService((tx) =>
        tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [s.a]),
      )
    }
  })
})

describe('who may read the cover', () => {
  it('host and active members read the same photo; outsider and unknown get the answer of "no photo"', async () => {
    const s = await seedPilot(t)
    // a member of an occasion WITHOUT a photo: this is the answer everybody else must get, byte for byte
    const noPhoto = await expectRpcError(getPhoto(s.b, s.occasionId), 'not_found')
    await setPhoto(s.a, s.occasionId, fakeWebp(512, 3))
    const host = await getPhoto(s.a, s.occasionId)
    expect(await getPhoto(s.b, s.occasionId)).toEqual(host)
    expect(await getPhoto(s.c, s.occasionId)).toEqual(host)
    const outsider = await expectRpcError(getPhoto(s.d, s.occasionId), 'not_found')
    expect({ code: outsider.code, message: outsider.message }).toEqual({ code: noPhoto.code, message: noPhoto.message })
  })

  it('a removed member, a member who left, and a member who blocked the host: not_found', async () => {
    const s = await seedPilot(t)
    await setPhoto(s.a, s.occasionId, fakeJpeg(300, 4), { mime: 'image/jpeg' })
    await rpc(t, s.a, 'remove_member', [s.occasionId, s.b])
    await expectRpcError(getPhoto(s.b, s.occasionId), 'not_found')
    await rpc(t, s.c, 'leave_occasion', [s.occasionId])
    await expectRpcError(getPhoto(s.c, s.occasionId), 'not_found')
    // back through a new link → the photo is there again
    const { token } = await rpc<{ token: string }>(t, s.a, 'create_invite', [s.occasionId])
    await rpc(t, s.c, 'accept_invite', [token])
    expect((await getPhoto(s.c, s.occasionId)).mime).toBe('image/jpeg')
    // a guest who blocks the host leaves the occasion (block_user): no access any more
    await rpc(t, s.c, 'block_user', [s.a])
    await expectRpcError(getPhoto(s.c, s.occasionId), 'not_found')
  })

  it('anon cannot call any photo RPC', async () => {
    const s = await seedPilot(t)
    for (const call of [
      `select public.get_occasion_photo('${s.occasionId}')`,
      `select public.remove_occasion_photo('${s.occasionId}')`,
      `select public.set_occasion_photo('${s.occasionId}', 'image/webp', '${b64(fakeWebp(64))}', 10, 10)`,
      'select public.export_my_occasion_photos()',
    ]) {
      const err = await expectDbError(t.asAnon((tx) => tx.query(call)), '42501')
      expect(err.message, call).toMatch(/permission denied for function/)
    }
  })
})

describe('limits (client = database)', () => {
  let s: Seed
  beforeAll(async () => {
    s = await seedPilot(t)
  })

  it('accepts exactly 409600 decoded bytes (WebP and JPEG) and 2048 px', async () => {
    await setPhoto(s.a, s.occasionId, fakeWebp(MAX_PHOTO_BYTES, 1, 'VP8 ', 2048, 2048), { width: 2048, height: 2048 })
    expect(await scalar<number>(t.db, 'select octet_length(bytes) from occasion_photos where occasion_id = $1', [s.occasionId])).toBe(MAX_PHOTO_BYTES)
    await setPhoto(s.a, s.occasionId, fakeJpeg(MAX_PHOTO_BYTES, 1, 1, 1), { mime: 'image/jpeg', width: 1, height: 1 })
  })

  it('refuses one byte more — checked after decoding (409601 bytes have the same base64 length as 409600)', async () => {
    expect(b64(fakeWebp(MAX_PHOTO_BYTES + 1)).length).toBe(b64(fakeWebp(MAX_PHOTO_BYTES)).length)
    await expectRpcError(setPhoto(s.a, s.occasionId, fakeWebp(MAX_PHOTO_BYTES + 1)), 'validation')
    await expectRpcError(setPhoto(s.a, s.occasionId, fakeJpeg(MAX_PHOTO_BYTES + 3), { mime: 'image/jpeg' }), 'validation')
  })

  it('refuses empty, broken or overlong base64', async () => {
    for (const data of ['', 'AA', '!!!!', '****====', 'A'.repeat(546_140)]) {
      await expectRpcError(setPhoto(s.a, s.occasionId, data), 'validation')
    }
  })

  it('refuses other types and bytes that are not what the mime says', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(40).fill(7)])
    const cases: [Uint8Array, string | null][] = [
      [png, 'image/png'],
      [png, 'image/webp'],
      [fakeJpeg(200), null],
      [fakeJpeg(200), 'image/gif'],
      [fakeJpeg(200), 'image/webp'], // JPEG bytes declared as WebP
      [fakeWebp(200), 'image/jpeg'], // WebP bytes declared as JPEG
      [fakeJpeg(200).slice(0, 198), 'image/jpeg'], // no end-of-image marker
      [Uint8Array.from([...fakeJpeg(200), 0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]), 'image/jpeg'], // something appended
      [fakeWebp(200, 1, 'ABCD'), 'image/webp'], // no VP8 / VP8L / VP8X chunk
      [Uint8Array.from([...fakeWebp(200), 0, 0]), 'image/webp'], // the RIFF size no longer matches
    ]
    for (const [bytes, mime] of cases) {
      await expectRpcError(setPhoto(s.a, s.occasionId, bytes, { mime }), 'validation')
    }
    // VP8L (lossless) and VP8X (extended) are fine
    await setPhoto(s.a, s.occasionId, fakeWebp(300, 2, 'VP8L'))
    await setPhoto(s.a, s.occasionId, fakeWebp(300, 3, 'VP8X'))
  })

  it('refuses a stated size outside 1 … 2048 px', async () => {
    for (const [width, height] of [[0, 10], [10, 0], [2049, 10], [10, 2049], [-5, 10], [null, 10], [10, null]] as const) {
      await expectRpcError(setPhoto(s.a, s.occasionId, fakeWebp(64), { width, height }), 'validation')
    }
  })

  it('a refused upload leaves the stored photo untouched', async () => {
    const good = fakeWebp(1000, 5)
    await setPhoto(s.a, s.occasionId, good)
    await expectRpcError(setPhoto(s.a, s.occasionId, fakeWebp(MAX_PHOTO_BYTES + 1)), 'validation')
    await expectRpcError(setPhoto(s.a, s.occasionId, fakeJpeg(100), { mime: 'image/webp' }), 'validation')
    expect(await storedBytes(s.occasionId)).toEqual(good)
  })

  it('the table bounds hold even for a privileged writer (CHECK constraints)', async () => {
    const insert = (size: number, mime = 'image/webp', width = 10) =>
      t.asService((tx) =>
        tx.query(
          `insert into occasion_photos (occasion_id, mime, bytes, width, height, updated_by)
           values ($1, $2, decode(repeat('ab', $3), 'hex'), $4, 10, $5)
           on conflict (occasion_id) do update set bytes = excluded.bytes, mime = excluded.mime, width = excluded.width`,
          [s.occasionId, mime, size, width, s.a],
        ),
      )
    await expectDbError(insert(MAX_PHOTO_BYTES + 1), '23514')
    await expectDbError(insert(0), '23514')
    await expectDbError(insert(10, 'image/png'), '23514')
    await expectDbError(insert(10, 'image/webp', 4096), '23514')
  })

  it('at most 20 hosted occasions with a photo; replacing one is fine, removing one frees a place', async () => {
    const host = await createMember(t, 'Quotenhost')
    const ids: string[] = []
    for (let i = 0; i < 21; i++) ids.push(await hostOccasion(host, `Fest ${i + 1}`, 10 + i))
    for (const id of ids.slice(0, 20)) await setPhoto(host, id, fakeWebp(40))
    await expectRpcError(setPhoto(host, ids[20]!, fakeWebp(40)), 'photo_limit')
    await setPhoto(host, ids[3]!, fakeWebp(48, 7)) // replace: still 20
    await removePhoto(host, ids[0]!)
    await setPhoto(host, ids[20]!, fakeWebp(40))
    expect(await scalar<number>(t.db, 'select count(*)::int from occasion_photos where updated_by = $1', [host])).toBe(20)
  })
})

describe('no direct table access', () => {
  it('neither anon nor authenticated may read or write occasion_photos (host, member)', async () => {
    const s = await seedPilot(t)
    await setPhoto(s.a, s.occasionId, fakeWebp(64))
    const statements = [
      'select * from occasion_photos',
      'select count(*) from occasion_photos',
      'select occasion_id from occasion_photos',
      `insert into occasion_photos (occasion_id, mime, bytes, width, height, updated_by) values ('${s.occasionId}', 'image/webp', '\\x00', 1, 1, '${s.a}')`,
      `update occasion_photos set width = 2`,
      'delete from occasion_photos',
    ]
    for (const sql of statements) {
      for (const uid of [s.a, s.b]) {
        const err = await expectDbError(t.asUser(uid, (tx) => tx.query(sql)), '42501')
        expect(err.message, sql).toMatch(/permission denied for table occasion_photos/)
      }
      await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
    }
    expect(await photoRows(s.occasionId)).toBe(1)
  })

  it('catalog: no privilege of any kind for the API roles, RLS enabled + forced, no policy, helper not callable', async () => {
    for (const who of ['anon', 'authenticated', 'public']) {
      for (const priv of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
        expect(await scalar<boolean>(t.db, `select has_table_privilege('${who}', 'public.occasion_photos', '${priv}')`), `${who} ${priv}`).toBe(false)
      }
      for (const priv of ['select', 'insert', 'update']) {
        expect(await scalar<boolean>(t.db, `select has_any_column_privilege('${who}', 'public.occasion_photos', '${priv}')`), `${who} column ${priv}`).toBe(false)
      }
    }
    expect(
      await rows(t.db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.occasion_photos'::regclass`),
    ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
    expect(await rows(t.db, `select policyname from pg_policies where schemaname = 'public' and tablename = 'occasion_photos'`)).toEqual([])
    expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', 'private.photo_bytes_match(text, bytea)', 'execute')`)).toBe(false)
    for (const fn of [
      'public.set_occasion_photo(uuid, text, text, integer, integer)',
      'public.remove_occasion_photo(uuid)',
      'public.get_occasion_photo(uuid)',
      'public.export_my_occasion_photos()',
    ]) {
      expect(await scalar<boolean>(t.db, `select has_function_privilege('authenticated', '${fn}', 'execute')`), fn).toBe(true)
      expect(await scalar<boolean>(t.db, `select has_function_privilege('anon', '${fn}', 'execute')`), fn).toBe(false)
      expect(await scalar<boolean>(t.db, `select p.prosecdef from pg_proc p where p.oid = '${fn}'::regprocedure`), fn).toBe(true)
    }
  })
})

describe('deletion cascades', () => {
  it('deleting the occasion (REST, host) deletes its photo', async () => {
    const s = await seedPilot(t)
    await setPhoto(s.a, s.occasionId, fakeWebp(256))
    expect(await execAs(t, s.a, 'delete from occasions where id = $1', [s.occasionId])).toBe(1)
    expect(await photoRows(s.occasionId)).toBe(0)
  })

  it("deleting the host's account deletes every photo of their occasions; a guest's deletion touches none", async () => {
    const s = await seedPilot(t)
    const second = await hostOccasion(s.a, 'Zweites Fest')
    await setPhoto(s.a, s.occasionId, fakeWebp(256))
    await setPhoto(s.a, second, fakeJpeg(256), { mime: 'image/jpeg' })
    expect(await rpc(t, s.b, 'delete_my_account')).toEqual({ ok: true })
    expect(await photoRows(s.occasionId)).toBe(1)
    expect(await rpc(t, s.a, 'delete_my_account')).toEqual({ ok: true })
    expect(await countAll(t, 'occasion_photos', 'occasion_id = any($1::uuid[])', [[s.occasionId, second]])).toBe(0)
    expect(await countAll(t, 'occasion_photos', 'updated_by = $1', [s.a])).toBe(0)
  })
})

describe('export of the own photos', () => {
  it('the host gets their photos with the bytes; a guest of that occasion gets none of them', async () => {
    const s = await seedPilot(t)
    const later = await hostOccasion(s.a, 'Später', 90)
    const first = fakeWebp(700, 6, 'VP8 ', 1600, 900)
    const second = fakeJpeg(900, 7, 1000, 1500)
    const a1 = await setPhoto(s.a, s.occasionId, first, { width: 1600, height: 900 })
    const a2 = await setPhoto(s.a, later, second, { mime: 'image/jpeg', width: 1000, height: 1500 })
    const exported = await exportPhotos(s.a)
    expect(exported).toEqual([
      { occasion_id: s.occasionId, occasion_title: 'Geburtstag Anna', mime: 'image/webp', width: 1600, height: 900, size_bytes: 700, updated_at: a1.updated_at, data_base64: b64(first) },
      { occasion_id: later, occasion_title: 'Später', mime: 'image/jpeg', width: 1000, height: 1500, size_bytes: 900, updated_at: a2.updated_at, data_base64: b64(second) },
    ])
    expect(await exportPhotos(s.b)).toEqual([])
    expect(await exportPhotos(s.d)).toEqual([])
    await removePhoto(s.a, later)
    expect((await exportPhotos(s.a)).map((p) => p.occasion_id)).toEqual([s.occasionId])
  })

  it('works without current consents, like export_my_data (pilot-decisions §0 item 11)', async () => {
    const s = await seedPilot(t)
    await setPhoto(s.a, s.occasionId, fakeWebp(100))
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.a]))
    expect(await exportPhotos(s.a)).toHaveLength(1)
  })

  it('export_my_data carries no photo bytes (the client adds export_my_occasion_photos to the file)', async () => {
    const s = await seedPilot(t)
    const bytes = fakeWebp(334, 8)
    await setPhoto(s.a, s.occasionId, bytes)
    const text = await t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.export_my_data()::text'))
    expect(text).not.toContain(b64(bytes))
  })
})

describe('get_occasion_screen carries the cover meta', () => {
  it('photo: null without a cover (key present), the meta with one — the same for host and members', async () => {
    const s = await seedPilot(t)
    for (const uid of [s.a, s.b]) {
      const sc = await screen(t, uid, s.occasionId)
      expect('photo' in sc.occasion).toBe(true)
      expect(sc.occasion.photo).toBeNull()
    }
    const { updated_at } = await setPhoto(s.a, s.occasionId, fakeWebp(128, 1, 'VP8 ', 1600, 1200), { width: 1600, height: 1200 })
    for (const uid of [s.a, s.b, s.c]) {
      const sc = await screen(t, uid, s.occasionId)
      expect(sc.occasion.photo).toEqual({ width: 1600, height: 1200, updated_at })
    }
    await removePhoto(s.a, s.occasionId)
    expect((await screen(t, s.b, s.occasionId)).occasion.photo).toBeNull()
    await expectRpcError(screen(t, s.d, s.occasionId), 'not_found')
  })

  it("with a cover the owner's screen and photo stay byte-identical across reserve / cancel traffic", async () => {
    const s = await seedPilot(t)
    await setPhoto(s.a, s.occasionId, fakeJpeg(2000, 9), { mime: 'image/jpeg' })
    const photoText = () => t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.get_occasion_photo($1)::text', [s.occasionId]))
    const screenBefore = await screenText(t, s.a, s.occasionId)
    const photoBefore = await photoText()
    const exportBefore = await t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.export_my_occasion_photos()::text'))

    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    await rpc(t, s.b, 'cancel_reservation', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w1])

    expect(await screenText(t, s.a, s.occasionId)).toBe(screenBefore)
    expect(await photoText()).toBe(photoBefore)
    expect(await t.asUser(s.a, (tx) => scalar<string>(tx, 'select public.export_my_occasion_photos()::text'))).toBe(exportBefore)
    // and no reservation id ever appears in a photo answer
    const ids = (await rows<{ id: string }>(t.db, 'select id from reservations where wishlist_id = $1', [s.wishlistId])).map((r) => r.id)
    expect(ids.length).toBeGreaterThan(0)
    for (const text of [photoBefore, exportBefore]) {
      for (const id of ids) expect(text).not.toContain(id)
      expect(text).not.toMatch(/reserv/i)
    }
  })
})
