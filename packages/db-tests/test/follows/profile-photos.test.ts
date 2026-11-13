/**
 * Profile photos and banner photos (supabase/migrations/20261024120000_profile_photos.sql) on PGlite.
 * The follows world of test/follows/seed.ts: Finn + Greta follow Paula (accepted), Rosa only asked (pending, visible to
 * Paula), Moritz is a guest of Paula's O1 and hosts O2 (guests Paula, Bea, Finn), Paula blocked Bea, Xaver is a stranger.
 *
 * THE VISIBILITY RULE: a person's profile photo and banner photo are visible to exactly the people who may see the
 * person's profile card (private.knows_profile): the person, a guest of the same occasion, a visible follow relation
 * in either direction (accepted, my own pending request, a request I can see) — never across a block, never a
 * stranger (also not through a follow link). In this world that is:
 *   Paula  → Paula, Finn (follower + O2), Greta (follower), Rosa (her visible request), Moritz (O1 / O2)
 *   Finn   → Finn, Paula, Moritz (O2), Bea (O2)          Greta → Greta, Paula        Rosa → Rosa, Paula (own request)
 *   Moritz → Moritz, Paula, Finn, Bea (O2)               Xaver → Xaver               Bea  → Bea, Moritz, Finn (O2)
 * Everything else — no access, no photo, unknown person or kind — is ONE answer: not_found.
 *   - the pattern of the other photos: RPC only, own writes, input checked first, limits, one row per kind;
 *   - every answer that carries a person carries the meta through the same rule (cards, people screen, overview,
 *     list screen, free wishes, occasion screen, follow-link peek; get_me / export for the own ones);
 *   - gone with the account (cascade), unreadable at once when the card is (unfollow, remove_follower, block, leaving);
 *   - secrecy: nothing new names the secret table; the owner's world is byte-identical across reservations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { countAll, createMember, expectRpcError, rpc } from '../pilot/seed'
import { b64, fakeJpeg, fakeWebp, fromB64, MAX_PHOTO_BYTES } from '../pilot/photo-bytes'
import { rpcText, seedFollows, type FollowSeed } from './seed'
import { ownerSnapshot } from './invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

type Kind = 'avatar' | 'banner'
type Json = Record<string, unknown>
type Meta = { width: number; height: number; updated_at: string } | null
interface PhotoAnswer {
  mime: string
  data: string
  width: number
  height: number
  updated_at: string
}

const KINDS: readonly Kind[] = ['avatar', 'banner']
/** a 512 px square avatar and a 1600 × 1067 banner, as the client prepares them */
const SIZE: Record<Kind, { width: number; height: number }> = { avatar: { width: 512, height: 512 }, banner: { width: 1600, height: 1067 } }
const photoBytes = (kind: Kind, size = 300, seed = 1) => fakeWebp(size, seed, 'VP8 ', SIZE[kind].width, SIZE[kind].height)

function setPhoto(uid: string, kind: string | null, bytes: Uint8Array | string, opts: { mime?: string; width?: number; height?: number } = {}) {
  const size = SIZE[(kind === 'banner' ? 'banner' : 'avatar') as Kind]
  return rpc<{ ok: true; updated_at: string }>(t, uid, 'set_profile_photo', [
    kind, opts.mime ?? 'image/webp', typeof bytes === 'string' ? bytes : b64(bytes), opts.width ?? size.width, opts.height ?? size.height,
  ])
}
const getPhoto = (uid: string, profileId: string | null, kind: string | null) => rpc<PhotoAnswer>(t, uid, 'get_profile_photo', [profileId, kind])
const removePhoto = (uid: string, kind: string | null) => rpc<{ ok: true }>(t, uid, 'remove_profile_photo', [kind])
const photoRows = (profileId: string) => countAll(t, 'profile_photos', 'profile_id = $1', [profileId])
const UNKNOWN_PROFILE = '00000000-0000-4000-8000-00000000abcd'

/** Both photos of a person; the meta as every answer must show it. */
async function setBoth(uid: string, seed = 1): Promise<{ avatar: Meta; banner: Meta }> {
  const a = await setPhoto(uid, 'avatar', photoBytes('avatar', 300, seed))
  const b = await setPhoto(uid, 'banner', photoBytes('banner', 400, seed))
  return { avatar: { ...SIZE.avatar, updated_at: a.updated_at }, banner: { ...SIZE.banner, updated_at: b.updated_at } }
}

/** "no photo" — the reference refusal every other refusal must equal (code + message). */
async function noPhotoError(viewer: string, owner: string) {
  const err = await expectRpcError(getPhoto(viewer, owner, 'banner'), 'not_found')
  return { code: err.code, message: err.message }
}

describe('profile photos: own writes, reads, limits', () => {
  let s: FollowSeed
  beforeAll(async () => {
    s = await seedFollows(t)
  })

  it('a person sets, replaces and removes both kinds; one-line base64; remove is idempotent', async () => {
    const avatar = photoBytes('avatar', 2048, 2)
    const first = await setPhoto(s.paula, 'avatar', avatar)
    expect(first).toEqual({ ok: true, updated_at: expect.any(String) })
    const got = await getPhoto(s.paula, s.paula, 'avatar')
    expect(got).toEqual({ mime: 'image/webp', data: expect.any(String), width: 512, height: 512, updated_at: first.updated_at })
    expect(got.data).not.toMatch(/\s/)
    expect(fromB64(got.data)).toEqual(avatar)
    const jpeg = fakeJpeg(900, 3, 480, 480)
    const second = await setPhoto(s.paula, 'avatar', jpeg, { mime: 'image/jpeg', width: 480, height: 480 })
    expect(Date.parse(second.updated_at)).toBeGreaterThan(Date.parse(first.updated_at))
    expect(await getPhoto(s.paula, s.paula, 'avatar')).toEqual({ mime: 'image/jpeg', data: b64(jpeg), width: 480, height: 480, updated_at: second.updated_at })
    const banner = photoBytes('banner', 700, 4)
    await setPhoto(s.paula, 'banner', banner)
    expect(fromB64((await getPhoto(s.paula, s.paula, 'banner')).data)).toEqual(banner)
    expect(await photoRows(s.paula)).toBe(2)
    expect(await removePhoto(s.paula, 'avatar')).toEqual({ ok: true })
    expect(await removePhoto(s.paula, 'avatar')).toEqual({ ok: true }) // idempotent
    await expectRpcError(getPhoto(s.paula, s.paula, 'avatar'), 'not_found')
    expect(fromB64((await getPhoto(s.paula, s.paula, 'banner')).data)).toEqual(banner) // the other kind stays
    expect(await removePhoto(s.paula, 'banner')).toEqual({ ok: true })
    expect(await photoRows(s.paula)).toBe(0)
  })

  it('the quota is the key: one photo per kind and person (replacing keeps one row; both kinds = 2 rows)', async () => {
    const u = await createMember(t, 'Sammlerin')
    for (let i = 0; i < 5; i++) await setPhoto(u, 'avatar', photoBytes('avatar', 200 + 2 * i, i + 1)) // (an odd WebP size is malformed)
    expect(await photoRows(u)).toBe(1)
    for (let i = 0; i < 3; i++) await setPhoto(u, 'banner', photoBytes('banner', 300 + 2 * i, i + 1))
    expect(await rows(t.db, 'select kind, octet_length(bytes) as n from profile_photos where profile_id = $1 order by kind', [u]))
      .toEqual([{ kind: 'avatar', n: 208 }, { kind: 'banner', n: 304 }])
    // a write always lands on the caller's own row: there is no parameter that names another person
    expect(await scalar<string>(t.db, `select pg_get_function_identity_arguments('public.set_profile_photo'::regproc)`))
      .toBe('p_kind text, p_mime text, p_data_base64 text, p_width integer, p_height integer')
  })

  it('409600 decoded bytes and 2048 px are fine; one byte more, other types, wrong magic bytes or size, a bad kind are not', async () => {
    const u = await createMember(t, 'Grenze')
    await setPhoto(u, 'banner', fakeWebp(MAX_PHOTO_BYTES, 1, 'VP8 ', 2048, 2048), { width: 2048, height: 2048 })
    expect(await scalar<number>(t.db, `select octet_length(bytes) from profile_photos where profile_id = $1 and kind = 'banner'`, [u])).toBe(MAX_PHOTO_BYTES)
    const refused: [string | null, Uint8Array | string, { mime?: string; width?: number; height?: number }][] = [
      ['banner', fakeWebp(MAX_PHOTO_BYTES + 1), { width: 1600, height: 1067 }],
      ['avatar', fakeJpeg(200, 1, 512, 512), { mime: 'image/webp' }], // the magic bytes say JPEG
      ['avatar', photoBytes('avatar', 200), { mime: 'image/png' }],
      ['avatar', photoBytes('avatar', 200), { width: 511 }], // stated ≠ real size
      ['banner', fakeWebp(300, 1, 'VP8 ', 2049, 100), { width: 2049, height: 100 }],
      ['avatar', '!!!!', {}],
      ['photo', photoBytes('avatar', 200), {}], // unknown kind
      [null, photoBytes('avatar', 200), {}],
    ]
    for (const uid of [u, s.finn]) {
      for (const [kind, bytes, opts] of refused) await expectRpcError(setPhoto(uid, kind, bytes, opts), 'validation')
    }
    await expectRpcError(removePhoto(u, 'photo'), 'validation')
    await expectRpcError(removePhoto(u, null), 'validation')
    // reading an unknown kind is the one answer of every refusal
    expect({ code: (await expectRpcError(getPhoto(u, u, 'photo'), 'not_found')).code }).toEqual({ code: 'P0001' })
    expect(await photoRows(s.finn)).toBe(0)
    expect(await photoRows(u)).toBe(1)
  })

  it('set needs current consents; remove and export do not', async () => {
    const u = await createMember(t, 'Ohne')
    await setPhoto(u, 'avatar', photoBytes('avatar'))
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [u]))
    await expectRpcError(setPhoto(u, 'banner', photoBytes('banner')), 'consent_required')
    expect(await rpc<unknown[]>(t, u, 'export_my_profile_photos')).toHaveLength(1)
    expect(await removePhoto(u, 'avatar')).toEqual({ ok: true })
    expect(await photoRows(u)).toBe(0)
  })

  it('anon cannot call any profile-photo RPC', async () => {
    for (const call of [
      `select public.get_profile_photo('${s.paula}', 'avatar')`,
      `select public.remove_profile_photo('avatar')`,
      `select public.set_profile_photo('avatar', 'image/webp', '${b64(photoBytes('avatar', 64))}', 512, 512)`,
      'select public.export_my_profile_photos()',
    ]) {
      const err = await expectDbError(t.asAnon((tx) => tx.query(call)), '42501')
      expect(err.message, call).toMatch(/permission denied for function/)
    }
  })

  it('no privilege for the API roles on profile_photos; RLS forced, no policy; the helpers are not callable', async () => {
    await setPhoto(s.greta, 'avatar', photoBytes('avatar'))
    for (const sql of ['select * from profile_photos', 'select count(*) from profile_photos', 'delete from profile_photos', 'update profile_photos set width = 2']) {
      for (const uid of [s.greta, s.paula]) {
        const err = await expectDbError(t.asUser(uid, (tx) => tx.query(sql)), '42501')
        expect(err.message, sql).toMatch(/permission denied for table profile_photos/)
      }
      await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
    }
    for (const who of ['anon', 'authenticated', 'public']) {
      for (const priv of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
        expect(await scalar<boolean>(t.db, `select has_table_privilege('${who}', 'public.profile_photos', '${priv}')`), `${who} ${priv}`).toBe(false)
      }
    }
    expect(await rows(t.db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.profile_photos'::regclass`))
      .toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
    expect(await rows(t.db, `select policyname from pg_policies where schemaname = 'public' and tablename = 'profile_photos'`)).toEqual([])
    for (const fn of ['private.profile_photo_meta(uuid, text)', 'private.profile_photo_fields(uuid)', 'private.profile_card(uuid)']) {
      for (const who of ['authenticated', 'anon']) {
        expect(await scalar<boolean>(t.db, `select has_function_privilege('${who}', '${fn}', 'execute')`), `${who} ${fn}`).toBe(false)
      }
    }
    await expectDbError(t.asUser(s.greta, (tx) => tx.query(`select private.profile_photo_fields($1)`, [s.greta])), '42501')
  })
})

describe('the visibility rule: exactly where the profile card is', () => {
  let s: FollowSeed
  let people: Record<string, string>
  let meta: Record<string, { avatar: Meta; banner: Meta }>
  /** viewer → the people whose photos the viewer may see (the matrix of the header) */
  let sees: Record<string, string[]>
  beforeAll(async () => {
    s = await seedFollows(t)
    people = { paula: s.paula, finn: s.finn, greta: s.greta, rosa: s.rosa, moritz: s.moritz, xaver: s.xaver, bea: s.bea }
    meta = {}
    let seed = 1
    for (const [name, id] of Object.entries(people)) meta[name] = await setBoth(id, seed++)
    sees = {
      paula: ['paula', 'finn', 'greta', 'rosa', 'moritz'],
      finn: ['finn', 'paula', 'moritz', 'bea'],
      greta: ['greta', 'paula'],
      rosa: ['rosa', 'paula'],
      moritz: ['moritz', 'paula', 'finn', 'bea'],
      xaver: ['xaver'],
      bea: ['bea', 'moritz', 'finn'],
    }
  })
  const fields = (name: string) => ({ photo: meta[name]!.avatar, banner_photo: meta[name]!.banner })
  const hidden = { photo: null, banner_photo: null }

  it('get_profile_photo for every pair and kind: the bytes exactly for the matrix; everybody else the "no photo" answer', async () => {
    const none = await createMember(t, 'Ohne Foto')
    const reference = await noPhotoError(none, none)
    for (const [viewerName, viewer] of Object.entries(people)) {
      for (const [ownerName, owner] of Object.entries(people)) {
        for (const kind of KINDS) {
          if (sees[viewerName]!.includes(ownerName)) {
            const got = await getPhoto(viewer, owner, kind)
            expect({ ...SIZE[kind], updated_at: got.updated_at }, `${viewerName} → ${ownerName} ${kind}`).toEqual(meta[ownerName]![kind])
          } else {
            const err = await expectRpcError(getPhoto(viewer, owner, kind), 'not_found')
            expect({ code: err.code, message: err.message }, `${viewerName} → ${ownerName} ${kind}`).toEqual(reference)
          }
        }
      }
      for (const [owner, kind] of [[UNKNOWN_PROFILE, 'avatar'], [null, 'avatar'], [s.paula, 'photo'], [s.paula, null]] as const) {
        const err = await expectRpcError(getPhoto(viewer, owner, kind), 'not_found')
        expect({ code: err.code, message: err.message }).toEqual(reference)
      }
    }
  })

  it('the rule IS the card: get_profile_card answers exactly for the same pairs, with the same meta', async () => {
    for (const [viewerName, viewer] of Object.entries(people)) {
      for (const [ownerName, owner] of Object.entries(people)) {
        if (sees[viewerName]!.includes(ownerName)) {
          const card = await rpc<{ profile: Json }>(t, viewer, 'get_profile_card', [owner])
          expect(card.profile, `${viewerName} → ${ownerName}`).toEqual({ id: owner, display_name: expect.any(String), banner: null, ...fields(ownerName) })
        } else {
          await expectRpcError(rpc(t, viewer, 'get_profile_card', [owner]), 'not_found')
        }
      }
    }
  })

  it('get_people_screen: requests, followers, following carry the meta; the blocked list never does', async () => {
    const paula = await rpc<{ requests_in: { profile: Json }[]; followers: { profile: Json }[]; blocked: Json[] }>(t, s.paula, 'get_people_screen')
    expect(paula.requests_in.map((r) => r.profile)).toEqual([{ id: s.rosa, display_name: 'Rosa', banner: null, ...fields('rosa') }])
    expect(paula.followers.map((r) => r.profile)).toEqual([
      { id: s.finn, display_name: 'Finn', banner: null, ...fields('finn') },
      { id: s.greta, display_name: 'Greta', banner: null, ...fields('greta') },
    ])
    expect(paula.blocked).toEqual([{ profile_id: s.bea, display_name: 'Bea', blocked_at: expect.any(String) }])
    const rosa = await rpc<{ requests_out: { profile: Json }[] }>(t, s.rosa, 'get_people_screen')
    expect(rosa.requests_out.map((r) => r.profile)).toEqual([{ id: s.paula, display_name: 'Paula', banner: null, ...fields('paula') }])
    const greta = await rpc<{ following: { profile: Json }[] }>(t, s.greta, 'get_people_screen')
    expect(greta.following.map((r) => r.profile)).toEqual([{ id: s.paula, display_name: 'Paula', banner: null, ...fields('paula') }])
  })

  it('get_lists_overview: me (own), following[].profile and suggestions[].profile', async () => {
    const finn = await rpc<{ me: Json; following: { profile: Json }[]; suggestions: { profile: Json }[] }>(t, s.finn, 'get_lists_overview')
    expect(finn.me).toEqual({ id: s.finn, display_name: 'Finn', banner: null, ...fields('finn'), live_links: 0 })
    expect(finn.following.map((f) => f.profile)).toEqual([{ id: s.paula, display_name: 'Paula', banner: null, ...fields('paula') }])
    expect(finn.suggestions.map((x) => x.profile)).toEqual([{ id: s.moritz, display_name: 'Moritz', ...fields('moritz') }])
    // Paula sees Greta suggested? No: Greta follows her (a visible relation is not a suggestion). Moritz is (O1 / O2).
    const paula = await rpc<{ suggestions: { profile: Json }[] }>(t, s.paula, 'get_lists_overview')
    expect(paula.suggestions.map((x) => x.profile)).toEqual([{ id: s.moritz, display_name: 'Moritz', ...fields('moritz') }])
  })

  it('get_list_screen (the owner card), get_free_wishes (the person)', async () => {
    for (const uid of [s.paula, s.finn, s.greta]) {
      const sc = await rpc<{ list: { owner: Json } }>(t, uid, 'get_list_screen', [s.l1])
      expect(sc.list.owner, uid).toEqual({ id: s.paula, display_name: 'Paula', banner: null, ...fields('paula') })
    }
    const free = await rpc<{ person: Json }>(t, s.finn, 'get_free_wishes', [s.paula, null])
    expect(free.person).toEqual({ id: s.paula, display_name: 'Paula', banner: null, ...fields('paula') })
  })

  it('get_occasion_screen: the host and every listed member carry their profile photo (never a blocked one)', async () => {
    const o1 = await rpc<{ occasion: { host: Json }; members: Json[] }>(t, s.moritz, 'get_occasion_screen', [s.o1])
    expect(o1.occasion.host).toEqual({ id: s.paula, display_name: 'Paula', photo: meta.paula!.avatar })
    expect(o1.members.map((m) => [m.profile_id, m.photo])).toEqual([[s.paula, meta.paula!.avatar], [s.moritz, meta.moritz!.avatar]])
    // O2 through Paula's eyes: Bea (blocked) is not listed; through Bea's: Paula is not, the host is
    const o2Paula = await rpc<{ occasion: { host: Json }; members: Json[] }>(t, s.paula, 'get_occasion_screen', [s.o2])
    expect(o2Paula.occasion.host).toEqual({ id: s.moritz, display_name: 'Moritz', photo: meta.moritz!.avatar })
    expect(o2Paula.members.map((m) => [m.profile_id, m.photo])).toEqual([[s.moritz, meta.moritz!.avatar], [s.paula, meta.paula!.avatar], [s.finn, meta.finn!.avatar]])
    const o2Bea = await rpc<{ members: Json[] }>(t, s.bea, 'get_occasion_screen', [s.o2])
    expect(o2Bea.members.map((m) => [m.profile_id, m.photo])).toEqual([[s.moritz, meta.moritz!.avatar], [s.bea, meta.bea!.avatar], [s.finn, meta.finn!.avatar]])
    expect(JSON.stringify(o2Bea)).not.toContain(s.paula)
  })

  it('peek_follow_link: a stranger with the link sees the card WITHOUT the photos; a person who knows Paula sees them', async () => {
    const xaver = await rpc<{ profile: Json }>(t, s.xaver, 'peek_follow_link', [s.token])
    expect(xaver.profile).toEqual({ id: s.paula, display_name: 'Paula', banner: null, ...hidden })
    await expectRpcError(getPhoto(s.xaver, s.paula, 'avatar'), 'not_found')
    for (const [uid, name] of [[s.rosa, 'rosa'], [s.finn, 'finn'], [s.paula, 'paula']] as const) {
      expect((await rpc<{ profile: Json }>(t, uid, 'peek_follow_link', [s.token])).profile, name)
        .toEqual({ id: s.paula, display_name: 'Paula', banner: null, ...fields('paula') })
    }
  })

  it('own answers: get_me.profile and export_my_data().profile carry the meta (the export never the bytes)', async () => {
    const me = await rpc<{ profile: Json }>(t, s.paula, 'get_me')
    expect(me.profile).toMatchObject(fields('paula'))
    const text = await t.asUser(s.paula, (tx) => scalar<string>(tx, 'select public.export_my_data()::text'))
    expect((JSON.parse(text) as { profile: Json }).profile).toMatchObject(fields('paula'))
    expect(text).not.toContain(b64(photoBytes('avatar', 300, 1)))
    expect(text).not.toContain(b64(photoBytes('banner', 400, 1)))
  })
})

describe('the visibility rule over time: requests, refusal, access ending', () => {
  it('a pending request: both see each other; after a silent refusal the requester still sees (the cloak), the refuser not', async () => {
    const s = await seedFollows(t)
    const paula = await setBoth(s.paula, 3)
    const rosa = await setBoth(s.rosa, 4)
    expect((await getPhoto(s.rosa, s.paula, 'avatar')).updated_at).toBe(paula.avatar!.updated_at)
    expect((await getPhoto(s.paula, s.rosa, 'banner')).updated_at).toBe(rosa.banner!.updated_at)
    expect(await rpc(t, s.paula, 'respond_follow', [s.rosa, false])).toEqual({ ok: true })
    // Rosa's own request row stays "Angefragt" until it expires: she still sees Paula's card and photos
    expect((await getPhoto(s.rosa, s.paula, 'banner')).updated_at).toBe(paula.banner!.updated_at)
    const card = await rpc<{ profile: Json }>(t, s.rosa, 'get_profile_card', [s.paula])
    expect(card.profile).toMatchObject({ photo: paula.avatar, banner_photo: paula.banner })
    // Paula hid the request: Rosa is a stranger to her again
    const nobody = await createMember(t, 'Ohne Foto')
    const reference = await noPhotoError(nobody, nobody)
    for (const kind of KINDS) {
      const err = await expectRpcError(getPhoto(s.paula, s.rosa, kind), 'not_found')
      expect({ code: err.code, message: err.message }).toEqual(reference)
    }
    await expectRpcError(rpc(t, s.paula, 'get_profile_card', [s.rosa]), 'not_found')
  })

  it('an accepted request: the follower and the followed see each other in both directions', async () => {
    const s = await seedFollows(t)
    const rosa = await setBoth(s.rosa, 5)
    await setBoth(s.paula, 6)
    expect(await rpc(t, s.paula, 'respond_follow', [s.rosa, true])).toEqual({ ok: true })
    expect((await getPhoto(s.paula, s.rosa, 'avatar')).updated_at).toBe(rosa.avatar!.updated_at)
    expect((await getPhoto(s.rosa, s.paula, 'avatar')).mime).toBe('image/webp')
  })

  it('access ends → unreadable at once: unfollow, remove_follower, block (also between co-guests), leaving the last shared occasion', async () => {
    const s = await seedFollows(t)
    for (const [i, uid] of [s.paula, s.finn, s.greta, s.moritz].entries()) await setBoth(uid, i + 1)
    // Greta unfollows: nothing else connects her with Paula
    await rpc(t, s.greta, 'unfollow', [s.paula])
    await expectRpcError(getPhoto(s.greta, s.paula, 'avatar'), 'not_found')
    await expectRpcError(getPhoto(s.paula, s.greta, 'avatar'), 'not_found')
    // Paula removes Finn as follower — but they are both guests of O2: the card (and so the photo) stays visible
    await rpc(t, s.paula, 'remove_follower', [s.finn])
    expect((await getPhoto(s.finn, s.paula, 'avatar')).mime).toBe('image/webp')
    expect((await getPhoto(s.paula, s.finn, 'banner')).mime).toBe('image/webp')
    // Moritz blocks Finn (co-guests of O2): never again, either direction
    await rpc(t, s.moritz, 'block_user', [s.finn])
    for (const [a, b] of [[s.moritz, s.finn], [s.finn, s.moritz]] as const) {
      for (const kind of KINDS) await expectRpcError(getPhoto(a, b, kind), 'not_found')
    }
    // Paula and Moritz share O1 and O2: leaving one keeps the card, leaving both ends it
    await rpc(t, s.moritz, 'leave_occasion', [s.o1])
    expect((await getPhoto(s.paula, s.moritz, 'avatar')).mime).toBe('image/webp')
    await rpc(t, s.paula, 'leave_occasion', [s.o2])
    await expectRpcError(getPhoto(s.paula, s.moritz, 'avatar'), 'not_found')
    await expectRpcError(getPhoto(s.moritz, s.paula, 'banner'), 'not_found')
    // a separate pair for remove_follower without a shared occasion
    const w = await seedFollows(t)
    await setBoth(w.paula, 7)
    await setBoth(w.greta, 8)
    await rpc(t, w.paula, 'remove_follower', [w.greta])
    await expectRpcError(getPhoto(w.greta, w.paula, 'avatar'), 'not_found')
    await expectRpcError(getPhoto(w.paula, w.greta, 'avatar'), 'not_found')
  })
})

describe('profile photos: cascade and export', () => {
  it('deleting the account deletes both photos (and nothing of anybody else)', async () => {
    const s = await seedFollows(t)
    await setBoth(s.paula)
    await setBoth(s.finn, 2)
    expect(await rpc(t, s.paula, 'delete_my_account')).toEqual({ ok: true })
    expect(await photoRows(s.paula)).toBe(0)
    expect(await photoRows(s.finn)).toBe(2)
    await expectRpcError(getPhoto(s.finn, s.paula, 'avatar'), 'not_found')
  })

  it('export_my_profile_photos: the own photos with bytes, by kind; a follower gets only their own', async () => {
    const s = await seedFollows(t)
    const avatar = fakeJpeg(700, 8, 512, 512)
    const a = await setPhoto(s.paula, 'avatar', avatar, { mime: 'image/jpeg' })
    const banner = photoBytes('banner', 640, 3)
    const b = await setPhoto(s.paula, 'banner', banner)
    expect(await rpc(t, s.paula, 'export_my_profile_photos')).toEqual([
      { kind: 'avatar', mime: 'image/jpeg', width: 512, height: 512, size_bytes: 700, updated_at: a.updated_at, data_base64: b64(avatar) },
      { kind: 'banner', mime: 'image/webp', width: 1600, height: 1067, size_bytes: 640, updated_at: b.updated_at, data_base64: b64(banner) },
    ])
    expect(await rpc(t, s.finn, 'export_my_profile_photos')).toEqual([])
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.paula]))
    expect(await rpc<unknown[]>(t, s.paula, 'export_my_profile_photos')).toHaveLength(2)
  })

  it('get_me and the export carry null meta without photos', async () => {
    const u = await createMember(t, 'Leer')
    expect((await rpc<{ profile: Json }>(t, u, 'get_me')).profile).toMatchObject({ photo: null, banner_photo: null })
    const data = JSON.parse(await t.asUser(u, (tx) => scalar<string>(tx, 'select public.export_my_data()::text'))) as { profile: Json }
    expect(data.profile).toMatchObject({ photo: null, banner_photo: null })
  })
})

describe('secrecy: profile photos say nothing about reservations', () => {
  it("the owner's whole world is byte-identical before and after reservations; nothing new names the secret table", async () => {
    const s = await seedFollows(t)
    await setBoth(s.paula, 5)
    await setBoth(s.finn, 6)
    await setBoth(s.moritz, 7)
    const snapshot = async () => ({
      ...(await ownerSnapshot(t, s.paula, { occasionIds: [s.o1, s.o2], listIds: [s.l1, s.l2], profileIds: [s.finn, s.moritz] })),
      avatar: await rpcText(t, s.paula, 'get_profile_photo', [s.paula, 'avatar']),
      banner: await rpcText(t, s.paula, 'get_profile_photo', [s.paula, 'banner']),
      finn: await rpcText(t, s.paula, 'get_profile_photo', [s.finn, 'avatar']),
      photos: await rpcText(t, s.paula, 'export_my_profile_photos'),
    })
    const before = await snapshot()
    expect(await rpc(t, s.finn, 'reserve_wish', [s.l1Wishes[0]])).toEqual({ ok: true })
    expect(await rpc(t, s.moritz, 'reserve_wish', [s.o1Wish])).toEqual({ ok: true })
    expect(await snapshot()).toEqual(before)
    expect(await rpc(t, s.finn, 'cancel_reservation', [s.l1Wishes[0]])).toEqual({ ok: true })
    expect(await snapshot()).toEqual(before)

    const src = await rows<{ fn: string; src: string }>(
      t.db,
      `select p.proname as fn, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and p.proname in ('profile_photo_meta', 'profile_photo_fields', 'profile_card', 'set_profile_photo', 'remove_profile_photo',
                            'get_profile_photo', 'export_my_profile_photos')`,
    )
    expect(src.map((x) => x.fn).sort()).toEqual(['export_my_profile_photos', 'get_profile_photo', 'profile_card', 'profile_photo_fields',
      'profile_photo_meta', 'remove_profile_photo', 'set_profile_photo'])
    for (const x of src) expect(x.src, x.fn).not.toMatch(/reserv/i)
  })
})
