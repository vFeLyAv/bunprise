/**
 * F11 — REST writes (follows-design §4.2, A8, S2): every operation on follows / follow_cooldowns / follow_links is
 * refused with 42501 for every API role (owner, follower, waiting, outsider, anon) before any row, index or policy
 * could answer; followers do not insert, change or delete Paula's lists or their wishes (only owners write).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, type TestDb } from '../../src/harness'
import { countAll, execAs, queryAs } from '../pilot/seed'
import { m3Applied, seedFollows, type FollowSeed } from './seed'

let t: TestDb
let s: FollowSeed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedFollows(t)
})
afterAll(() => t.close())

function statements(): string[] {
  const now = `now() + interval '1 day'`
  return [
    `select * from follows`,
    `select follower_id from follows where followee_id = '${s.paula}'`,
    `select count(*) from follow_cooldowns`,
    `select exists (select 1 from follow_links where owner_id = '${s.paula}')`,
    `select f.status from follows f for update`,
    `insert into follows (follower_id, followee_id, status, accepted_at) values ('${s.xaver}', '${s.paula}', 'accepted', now())`,
    `insert into follows (follower_id, followee_id, expires_at) values ('${s.xaver}', '${s.paula}', ${now})`,
    `insert into follow_cooldowns (followee_id, follower_id, until) values ('${s.xaver}', '${s.paula}', ${now})`,
    `insert into follow_links (owner_id, token_hash, expires_at) values ('${s.xaver}', sha256('x'::bytea), ${now})`,
    `update follows set status = 'accepted', accepted_at = now(), expires_at = null where follower_id = '${s.rosa}'`,
    `update follow_cooldowns set until = now()`,
    `update follow_links set use_count = 0, revoked_at = null`,
    `delete from follows where follower_id = '${s.finn}'`,
    `delete from follow_cooldowns`,
    `delete from follow_links`,
    `truncate follows`,
    `truncate follow_links`,
  ]
}

describe('the three follow tables: no REST path at all', () => {
  it('owner, follower, waiting and outsider: permission denied for every statement; nothing changes', async () => {
    const snapshot = () =>
      rows(t.db, `select (select count(*) from follows)::int as f, (select count(*) from follow_cooldowns)::int as c,
                          (select count(*) from follow_links)::int as l, (select string_agg(status, ',' order by follower_id) from follows) as st`)
    const before = await snapshot()
    for (const uid of [s.paula, s.finn, s.rosa, s.xaver, s.bea]) {
      for (const sql of statements()) {
        const err = await expectDbError(t.asUser(uid, (tx) => tx.query(sql)), '42501')
        expect(err.message, `${uid}: ${sql}`).toMatch(/permission denied for table follow(s|_cooldowns|_links)/)
        expect(err.message).not.toMatch(/duplicate|unique|violates|check/)
      }
    }
    for (const sql of statements()) await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
    expect(await snapshot()).toEqual(before)
  })

  it('embedding / joining the follow tables into readable tables is refused as well', async () => {
    for (const sql of [
      `select p.id from profiles p where exists (select 1 from follows f where f.follower_id = p.id)`,
      `select p.id, (select count(*) from follows f where f.followee_id = p.id) from profiles p`,
      `select o.id from occasions o order by (select count(*) from follow_links)`,
      `select wl.id from wishlists wl join follows f on f.followee_id = wl.owner_id`,
      `explain select * from follows`,
    ]) {
      const err = await expectDbError(t.asUser(s.finn, (tx) => tx.query(sql)), '42501')
      expect(err.message, sql).toMatch(/permission denied for table follow/)
    }
  })
})

describe('followers do not write the owner\'s lists', () => {
  it('Finn and Greta (accepted followers) can neither create, change nor delete Paula\'s lists or wishes', async () => {
    for (const uid of [s.finn, s.greta]) {
      await expectDbError(
        t.asUser(uid, (tx) => tx.query(`insert into wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, 'Für Paula', 'private')`, [s.paula])),
        '42501',
      )
      expect(await execAs(t, uid, `update wishlists set title = 'x', cover_tone = 1 where id = $1`, [s.l1])).toBe(0)
      expect(await execAs(t, uid, `update wishlists set due_on = '2027-01-01' where id = $1`, [s.l1])).toBe(0)
      expect(await execAs(t, uid, `delete from wishlists where id = $1`, [s.l1])).toBe(0)
      await expectDbError(t.asUser(uid, (tx) => tx.query(`update wishlists set visibility = 'private' where id = $1`, [s.l1])), '42501')
      await expectDbError(t.asUser(uid, (tx) => tx.query(`insert into wishes (wishlist_id, title) values ($1, 'untergeschoben')`, [s.l1])), '42501')
      expect(await execAs(t, uid, `update wishes set title = 'x' where wishlist_id = $1`, [s.l1])).toBe(0)
      expect(await execAs(t, uid, `delete from wishes where wishlist_id = $1`, [s.l1])).toBe(0)
      // reading: M1 / M2 not one standalone list of Paula; from M3 on at most her 'followers' lists — never "Nur ich"
      const readable = await queryAs<{ id: string; visibility: string }>(t, uid, `select id, visibility from wishlists where owner_id = $1 and occasion_id is null`, [s.paula])
      if (!(await m3Applied(t))) expect(readable).toEqual([])
      for (const l of readable) expect(l.visibility).toBe('followers')
      expect(await queryAs(t, uid, `select id from wishes where wishlist_id = $1`, [s.l2])).toEqual([])
      if (!(await m3Applied(t))) expect(await queryAs(t, uid, `select id from wishes where wishlist_id = $1`, [s.l1])).toEqual([])
    }
    expect(await countAll(t, 'wishes', 'wishlist_id = $1', [s.l1])).toBe(3)
    expect(await rows(t.db, `select title, cover_tone from wishlists where id = $1`, [s.l1])).toEqual([{ title: 'Meine Wünsche', cover_tone: 2 }])
  })
})
