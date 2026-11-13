/**
 * Direct table access through RLS (what PostgREST would allow): host A, members B/C, outsider D, anon.
 * Covers data-and-secrecy.md §6 rows 1–3 (reservations: permission denied for everyone, incl. counts),
 * 5, 8–10 and §4 column grants, plus the pilot-decisions gates (consents + display_name, one list per occasion).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import {
  ALL_TABLES,
  NAMES,
  OCCASION_TITLE,
  countAll,
  countAs,
  createMember,
  execAs,
  giveConsents,
  queryAs,
  rpc,
  seedPilot,
  type Seed,
} from './seed'

let t: TestDb
let s: Seed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedPilot(t)
})
afterAll(() => t.close())

describe('anon', () => {
  it('cannot read a single table', async () => {
    for (const table of ALL_TABLES) {
      const err = await expectDbError(t.asAnon((tx) => rows(tx, `select * from ${table}`)), '42501')
      expect(err.message, table).toMatch(/permission denied/)
    }
  })

  it('cannot execute any RPC', async () => {
    for (const call of [
      'select public.get_me()',
      'select public.get_feed()',
      'select public.my_reservations()',
      'select public.export_my_data()',
      `select public.reserve_wish('${s.w1}')`,
      `select public.get_occasion_screen('${s.occasionId}')`,
      `select public.accept_invite('${s.token}')`,
    ]) {
      const err = await expectDbError(t.asAnon((tx) => tx.query(call)), '42501')
      expect(err.message, call).toMatch(/permission denied for function/)
    }
  })
})

describe('occasion content per role', () => {
  it('host and members read the occasion, its list, wishes and members; the outsider reads nothing', async () => {
    for (const uid of [s.a, s.b, s.c]) {
      expect(await countAs(t, uid, 'occasions', 'id = $1', [s.occasionId])).toBe(1)
      expect(await countAs(t, uid, 'wishlists', 'occasion_id = $1', [s.occasionId])).toBe(1)
      expect(await countAs(t, uid, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(3)
      expect(await countAs(t, uid, 'occasion_members', 'occasion_id = $1', [s.occasionId])).toBe(3)
    }
    for (const table of ['occasions', 'wishlists', 'wishes', 'occasion_members']) {
      expect(await countAs(t, s.d, table), table).toBe(0)
    }
  })

  it('profiles: people from a shared occasion are visible, strangers are not', async () => {
    const seen = await queryAs<{ display_name: string }>(t, s.a, 'select display_name from profiles order by display_name')
    expect(seen.map((r) => r.display_name)).toEqual([NAMES.a, NAMES.b, NAMES.c])
    expect(await queryAs<{ id: string }>(t, s.d, 'select id from profiles')).toEqual([{ id: s.d }])
  })

  it('the row returned for wishes carries no reservation information at all', async () => {
    const cols = await rows<{ column_name: string }>(
      t.db,
      `select column_name from information_schema.columns where table_schema = 'public' and table_name in ('wishes', 'wishlists', 'occasions')`,
    )
    expect(cols.some((c) => /reserv/i.test(c.column_name))).toBe(false)
  })
})

describe('reservations have no REST path (data-spec §6 #1–#3, #11–#13 → variant B)', () => {
  beforeAll(async () => {
    await rpc(t, s.b, 'reserve_wish', [s.w1])
  })

  it('select / count: permission denied for host, reserver, member, outsider', async () => {
    for (const uid of [s.a, s.b, s.c, s.d]) {
      for (const sql of [
        'select * from reservations',
        'select id, wish_id, status from reservations',
        'select count(*) from reservations',
        `select count(*) from reservations where wish_id = '${s.w1}'`,
        'select reserver_id from reservations',
      ]) {
        const err = await expectDbError(t.asUser(uid, (tx) => rows(tx, sql)), '42501')
        expect(err.message, `${uid} ${sql}`).toMatch(/permission denied for table reservations/)
      }
    }
  })

  it('insert / update / delete: permission denied before any index or policy could act as an oracle', async () => {
    const insert = `insert into reservations (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot)
                    values ('${s.w1}', '${s.wishlistId}', '${s.a}', '${s.c}', 'x')`
    for (const uid of [s.a, s.b, s.c, s.d]) {
      for (const sql of [insert, `update reservations set status = 'ended'`, 'delete from reservations']) {
        const err = await expectDbError(t.asUser(uid, (tx) => tx.query(sql)), '42501')
        expect(err.message, `${uid} ${sql}`).toMatch(/permission denied for table reservations/)
        expect(err.message).not.toMatch(/duplicate|unique/)
      }
    }
    expect(await countAll(t, 'reservations')).toBe(1)
  })
})

describe('invites and addresses', () => {
  it('invites: the host sees metadata but never token_hash; members and outsiders see no row', async () => {
    const meta = await queryAs<{ use_count: number; max_uses: number }>(
      t,
      s.a,
      'select id, occasion_id, created_by, expires_at, max_uses, use_count, revoked_at, created_at from invites where occasion_id = $1',
      [s.occasionId],
    )
    expect(meta).toHaveLength(1)
    expect(meta[0]).toMatchObject({ use_count: 2, max_uses: 50 })
    for (const sql of ['select token_hash from invites', 'select * from invites']) {
      const err = await expectDbError(t.asUser(s.a, (tx) => rows(tx, sql)), '42501')
      expect(err.message).toMatch(/permission denied/)
    }
    expect(await countAs(t, s.b, 'invites')).toBe(0)
    expect(await countAs(t, s.d, 'invites')).toBe(0)
  })

  it('occasion_addresses: host, and members only once they said "going"', async () => {
    expect(await execAs(t, s.a, `insert into occasion_addresses (occasion_id, address) values ($1, 'Musterstraße 1')`, [s.occasionId])).toBe(1)
    expect(await countAs(t, s.a, 'occasion_addresses')).toBe(1)
    expect(await countAs(t, s.b, 'occasion_addresses')).toBe(0)
    expect(await execAs(t, s.b, `update occasion_members set rsvp = 'going' where occasion_id = $1 and profile_id = $2`, [s.occasionId, s.b])).toBe(1)
    expect(await countAs(t, s.b, 'occasion_addresses')).toBe(1)
    expect(await countAs(t, s.c, 'occasion_addresses')).toBe(0)
    expect(await countAs(t, s.d, 'occasion_addresses')).toBe(0)
    // a member may hold the column grant, RLS still filters the row away: 0 rows, no error
    expect(await execAs(t, s.b, `update occasion_addresses set address = 'hacked'`)).toBe(0)
    expect(await scalar<string>(t.db, 'select address from occasion_addresses where occasion_id = $1', [s.occasionId])).toBe('Musterstraße 1')
    // outsider cannot insert one either
    await expectDbError(t.asUser(s.d, (tx) => tx.query(`insert into occasion_addresses (occasion_id, address) values ($1, 'x')`, [s.occasionId])), '42501')
  })
})

describe('column grants and ownership', () => {
  it('occasion_members: own rsvp yes, status/role no, other people no', async () => {
    expect(await execAs(t, s.c, `update occasion_members set rsvp = 'maybe' where occasion_id = $1 and profile_id = $2`, [s.occasionId, s.c])).toBe(1)
    expect(await scalar<string>(t.db, 'select rsvp from occasion_members where occasion_id = $1 and profile_id = $2', [s.occasionId, s.c])).toBe('maybe')
    await expectDbError(t.asUser(s.c, (tx) => tx.query(`update occasion_members set status = 'left'`)), '42501')
    await expectDbError(t.asUser(s.c, (tx) => tx.query(`update occasion_members set role = 'host'`)), '42501')
    await expectDbError(t.asUser(s.c, (tx) => tx.query(`delete from occasion_members`)), '42501')
    // another member's row: 0 rows, untouched
    expect(await execAs(t, s.c, `update occasion_members set rsvp = 'declined' where profile_id = $1`, [s.b])).toBe(0)
    expect(await scalar<string>(t.db, 'select rsvp from occasion_members where occasion_id = $1 and profile_id = $2', [s.occasionId, s.b])).toBe('going')
  })

  it('profiles: own display_name / locale / onboarding_done_at, nothing else, nobody else', async () => {
    expect(await execAs(t, s.b, `update profiles set display_name = 'Benny', locale = 'en', onboarding_done_at = now() where id = $1`, [s.b])).toBe(1)
    expect(await execAs(t, s.b, `update profiles set display_name = 'Mallory' where id = $1`, [s.a])).toBe(0)
    expect(await scalar<string>(t.db, 'select display_name from profiles where id = $1', [s.a])).toBe(NAMES.a)
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`update profiles set created_at = now() where id = $1`, [s.b])), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`insert into profiles (id) values (gen_random_uuid())`)), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`delete from profiles where id = $1`, [s.b])), '42501')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`update profiles set display_name = ' spaced ' where id = $1`, [s.b])), '23514')
    // back to the fixture name for the other suites in this file
    await execAs(t, s.b, `update profiles set display_name = $2 where id = $1`, [s.b, NAMES.b])
  })

  it('wishes / wishlists / occasions: immutable keys are not even grantable, members cannot write', async () => {
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`update wishes set wishlist_id = $1`, [s.wishlistId])), '42501')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`update occasions set host_id = $1`, [s.b])), '42501')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`update wishlists set recipient_id = $1`, [s.b])), '42501')
    // member: no row to update/delete (RLS), no error
    expect(await execAs(t, s.b, `update wishes set title = 'x' where id = $1`, [s.w2])).toBe(0)
    expect(await execAs(t, s.b, `delete from wishes where id = $1`, [s.w2])).toBe(0)
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.wishlistId])).toBe(3)
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`insert into wishes (wishlist_id, title) values ($1, 'mine?')`, [s.wishlistId])), '42501')
    await expectDbError(t.asUser(s.d, (tx) => tx.query(`insert into wishes (wishlist_id, title) values ($1, 'mine?')`, [s.wishlistId])), '42501')
    // host: priority is editable and checked
    expect(await execAs(t, s.a, `update wishes set priority = 1 where id = $1`, [s.w3])).toBe(1)
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`update wishes set priority = 4 where id = $1`, [s.w3])), '23514')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`insert into wishes (wishlist_id, title, currency) values ($1, 'x', 'usd')`, [s.wishlistId])), '23514')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`insert into wishes (wishlist_id, title, url) values ($1, 'x', 'javascript:alert(1)')`, [s.wishlistId])), '23514')
    await execAs(t, s.a, `update wishes set priority = 2 where id = $1`, [s.w3])
  })

  it('legal_versions: readable by every signed-in user, never writable', async () => {
    expect(await countAs(t, s.d, 'legal_versions')).toBe(3)
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`insert into legal_versions (kind, version) values ('terms', 'x')`)), '42501')
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`update legal_versions set version = 'x'`)), '42501')
  })
})

describe('gates on creating content (pilot-decisions §1)', () => {
  it('occasions_insert needs all consents AND a display_name', async () => {
    const noConsent = await createMember(t, 'Emil', { consents: false })
    await expectDbError(
      t.asUser(noConsent, (tx) => tx.query(`insert into occasions (host_id, title, starts_at) values ($1, 'x', now())`, [noConsent])),
      '42501',
    )
    // partial consents are not enough
    await t.asUser(noConsent, (tx) =>
      tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions where kind = 'terms'`, [noConsent]),
    )
    await expectDbError(
      t.asUser(noConsent, (tx) => tx.query(`insert into occasions (host_id, title, starts_at) values ($1, 'x', now())`, [noConsent])),
      '42501',
    )

    const noName = await t.createUser('noname-rls@example.test', {})
    await giveConsents(t, noName)
    expect(await scalar<string | null>(t.db, 'select display_name from profiles where id = $1', [noName])).toBeNull()
    await expectDbError(
      t.asUser(noName, (tx) => tx.query(`insert into occasions (host_id, title, starts_at) values ($1, 'x', now())`, [noName])),
      '42501',
    )
    await execAs(t, noName, `update profiles set display_name = 'Frida' where id = $1`, [noName])
    expect(await execAs(t, noName, `insert into occasions (host_id, title, starts_at) values ($1, 'Frida feiert', now() + interval '3 days')`, [noName])).toBe(1)
    // and never for somebody else
    await expectDbError(
      t.asUser(noName, (tx) => tx.query(`insert into occasions (host_id, title, starts_at) values ($1, 'x', now())`, [s.a])),
      '42501',
    )
  })

  it('consents: only own rows, only the current version', async () => {
    const u = await createMember(t, 'Gustav', { consents: false })
    await expectDbError(
      t.asUser(u, (tx) => tx.query(`insert into consents (profile_id, kind, version, locale) values ($1, 'terms', 'terms-1999', 'de')`, [u])),
      '42501',
    )
    await expectDbError(
      t.asUser(u, (tx) => tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [s.a])),
      '42501',
    )
    await giveConsents(t, u)
    expect(await countAs(t, u, 'consents')).toBe(3)
    expect(await countAs(t, u, 'consents', 'profile_id = $1', [s.a])).toBe(0)
    await expectDbError(t.asUser(u, (tx) => tx.query(`delete from consents`)), '42501')
    await expectDbError(t.asUser(u, (tx) => tx.query(`update consents set locale = 'en'`)), '42501')
  })

  it('the wishlist is created by the trigger; a second one is denied for the host and for a member', async () => {
    const wl = await rows<{ owner_id: string; recipient_id: string; title: string }>(
      t.db,
      'select owner_id, recipient_id, title from wishlists where occasion_id = $1',
      [s.occasionId],
    )
    expect(wl).toEqual([{ owner_id: s.a, recipient_id: s.a, title: OCCASION_TITLE }])
    await expectDbError(
      t.asUser(s.a, (tx) => tx.query(`insert into wishlists (occasion_id, owner_id, recipient_id, title) values ($1, $2, $2, 'second')`, [s.occasionId, s.a])),
      '42501',
    )
    await expectDbError(
      t.asUser(s.b, (tx) => tx.query(`insert into wishlists (occasion_id, owner_id, recipient_id, title) values ($1, $2, $2, 'mine')`, [s.occasionId, s.b])),
      '42501',
    )
    expect(await countAll(t, 'wishlists', 'occasion_id = $1', [s.occasionId])).toBe(1)
    // the host may rename it, a member may not
    expect(await execAs(t, s.a, `update wishlists set title = 'Meine Wünsche' where id = $1`, [s.wishlistId])).toBe(1)
    expect(await execAs(t, s.b, `update wishlists set title = 'x' where id = $1`, [s.wishlistId])).toBe(0)
  })

  it('occasions: invalid time zone rejected, place/description limits enforced, client may choose the id', async () => {
    const err = await expectDbError(
      t.asUser(s.a, (tx) => tx.query(`insert into occasions (host_id, title, starts_at, tz) values ($1, 'x', now(), 'Mars/Olympus')`, [s.a])),
      'P0001',
    )
    expect(err.message).toBe('invalid_timezone')
    await expectDbError(
      t.asUser(s.a, (tx) => tx.query(`insert into occasions (host_id, title, starts_at, description) values ($1, 'x', now(), repeat('a', 501))`, [s.a])),
      '23514',
    )
    const id = '7b1d1f0e-6a3c-4c2b-9e2f-3c4d5e6f7a8b'
    expect(await execAs(t, s.a, `insert into occasions (id, host_id, title, starts_at) values ($1, $2, 'Client id', now() + interval '1 day')`, [id, s.a])).toBe(1)
    expect(await countAll(t, 'wishlists', 'occasion_id = $1', [id])).toBe(1)
    expect(await countAll(t, 'occasion_members', `occasion_id = $1 and role = 'host' and rsvp = 'going'`, [id])).toBe(1)
  })
})
