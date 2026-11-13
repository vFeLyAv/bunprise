/**
 * F16 — the daily purge (private.purge_expired_records, called by the existing pg_cron job; follows-design §3.3,
 * §3.6, pilot-decisions §0 item 10): it deletes expired requests, ended silences, revoked and expired links — plus the
 * pilot's 90-day rules — and NOTHING else (live requests, accepted follows, running silences, live links stay).
 * Only the migration / cron owner can run it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, type TestDb } from '../../src/harness'
import { createMember } from '../pilot/seed'
import { followLink, seedFollows } from './seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

describe('purge_expired_records and the follow tables', () => {
  it('removes exactly the expired requests, ended silences, revoked and expired links', async () => {
    const s = await seedFollows(t) // Finn + Greta accepted, Rosa pending (live), Paula's link live
    const anna = await createMember(t, 'Anna')
    const ben = await createMember(t, 'Ben')
    await t.asService(async (tx) => {
      // an expired request (Anna -> Paula) and one that expires in a minute (Ben -> Paula)
      await tx.query(`insert into follows (follower_id, followee_id, status, requested_at, expires_at) values
        ($1, $3, 'pending', now() - interval '31 days', now() - interval '1 day'),
        ($2, $3, 'pending', now() - interval '29 days', now() + interval '1 minute')`, [anna, ben, s.paula])
      // an ended silence and a running one
      await tx.query(`insert into follow_cooldowns (followee_id, follower_id, until) values
        ($1, $2, now() - interval '1 second'), ($1, $3, now() + interval '1 day')`, [s.paula, anna, ben])
    })
    const revoked = await followLink(t, s.greta)
    const expired = await followLink(t, s.finn)
    const live = await followLink(t, s.moritz)
    await t.asService(async (tx) => {
      await tx.query(`update follow_links set revoked_at = now() where token_hash = sha256(convert_to($1::text, 'UTF8'))`, [revoked])
      await tx.query(`update follow_links set created_at = now() - interval '31 days', expires_at = now() - interval '1 minute' where token_hash = sha256(convert_to($1::text, 'UTF8'))`, [expired])
    })
    const state = () =>
      rows<{ kind: string; who: string }>(
        t.db,
        `select 'follow' as kind, f.follower_id::text || '>' || f.followee_id::text || ':' || f.status as who from follows f
         union all select 'silence', c.followee_id::text || '>' || c.follower_id::text from follow_cooldowns c
         union all select 'link', l.owner_id::text || ':' || (l.revoked_at is null)::text from follow_links l
         order by 1, 2`,
      )
    const before = await state()
    await t.asService((tx) => tx.query('select private.purge_expired_records()'))
    const after = await state()
    const gone = before.filter((b) => !after.some((a) => a.kind === b.kind && a.who === b.who))
    expect(gone.sort((a, b) => (a.kind + a.who < b.kind + b.who ? -1 : 1))).toEqual(
      [
        { kind: 'follow', who: `${anna}>${s.paula}:pending` },
        { kind: 'silence', who: `${s.paula}>${anna}` },
        { kind: 'link', who: `${s.greta}:false` },
        { kind: 'link', who: `${s.finn}:true` },
      ].sort((a, b) => (a.kind + a.who < b.kind + b.who ? -1 : 1)),
    )
    expect(after.length).toBe(before.length - 4)
    for (const kept of [`${ben}>${s.paula}:pending`, `${s.rosa}>${s.paula}:pending`, `${s.finn}>${s.paula}:accepted`, `${s.greta}>${s.paula}:accepted`]) {
      expect(after.some((a) => a.who === kept), kept).toBe(true)
    }
    expect(after.some((a) => a.kind === 'silence' && a.who === `${s.paula}>${ben}`)).toBe(true)
    expect(after.filter((a) => a.kind === 'link').map((a) => a.who).sort()).toEqual([`${s.paula}:true`, `${s.moritz}:true`].sort())
    void live
  })

  it('the API roles cannot run it', async () => {
    const u = await createMember(t, 'Pia')
    await expectDbError(t.asUser(u, (tx) => tx.query('select private.purge_expired_records()')), '42501')
    await expectDbError(t.asAnon((tx) => tx.query('select private.purge_expired_records()')), '42501')
  })
})
