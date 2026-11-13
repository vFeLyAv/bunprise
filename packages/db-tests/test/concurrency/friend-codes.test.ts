/**
 * Friend codes under concurrency on real PostgreSQL 17 (supabase/migrations/20261027160000_friend_codes.sql, Codex
 * review 27.10 #5; docs/spec/add-friends-design.md §3). The lock order of a lookup: the caller's own advisory lock →
 * private.lock_profile_pair → the code row.
 *   1. Parallel misses of ONE account queue on its advisory lock: the second sees the first one's miss — without
 *      the lock both would read 9 and the account would end at 11.
 *   2. A request waiting for the pair while the owner switches the code off: it re-checks under the lock and answers
 *      { invalid: true } — no follow row, no miss (nobody guessed).
 *   3. The 20th place raced by two newcomers: exactly one gets it.
 * Always: a contract answer, never a deadlock / timeout.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { settle, startRealPg, type RealPg, type Session } from '../../src/realpg'

let db: RealPg
let s1: Session
let s2: Session
let run = 0

beforeAll(async () => {
  db = await startRealPg()
  s1 = await db.session('fc-1')
  s2 = await db.session('fc-2')
})
afterAll(async () => {
  await db?.close()
})

async function people(...names: string[]): Promise<string[]> {
  const n = ++run
  const ids: string[] = []
  for (const name of names) ids.push(await db.createUser(`${name.toLowerCase()}-fc${n}@example.test`, { name }))
  await db.admin.query(
    `insert into public.consents (profile_id, kind, version, locale)
     select u.id, lv.kind, lv.version, 'de' from unnest($1::uuid[]) as u(id) cross join public.legal_versions lv`,
    [ids],
  )
  return ids
}

const newCode = (uid: string) => db.asUser(uid, (s) => s.rpc<{ code: string }>('create_friend_code', [false])).then((r) => r.code)
const misses = (uid: string) => db.admin.value<number>('select count(*)::int from public.friend_code_misses where profile_id = $1', [uid])

describe('friend codes on real PostgreSQL', () => {
  it('parallel misses of one account queue: the 10th and 11th in flight end at exactly 10', async () => {
    const [guesser] = (await people('Rater')) as [string]
    await db.admin.query(`insert into public.friend_code_misses (profile_id) select $1 from generate_series(1, 9)`, [guesser])
    await s1.begin(guesser)
    expect(await s1.rpc('peek_friend_code', ['ZZZZZZZZ'])).toEqual({ invalid: true }) // miss 10, not committed yet
    await s2.begin(guesser)
    const second = settle(s2.rpc('peek_friend_code', ['ZZZZZZZY']))
    const info = await db.waitUntilBlocked(s2, s1, second)
    expect(info.waitEvent).toBe('Lock:advisory')
    await s1.commit()
    expect(await second).toMatchObject({ ok: false, code: 'P0001', message: 'rate_limited' })
    await s2.rollback()
    expect(await misses(guesser)).toBe(10)
  })

  it('a request waiting for the pair while the owner switches the code off answers { invalid: true }', async () => {
    const [owner, asker] = (await people('Paula', 'Finn')) as [string, string]
    const code = await newCode(owner)
    await s1.begin(owner)
    expect(await s1.rpc('revoke_friend_codes')).toEqual({ ok: true }) // holds the owner's profile lock
    await s2.begin(asker)
    const request = settle(s2.rpc('request_follow_via_code', [code]))
    await db.waitUntilBlocked(s2, s1, request)
    await s1.commit()
    expect(await request).toEqual({ ok: true, value: { invalid: true } })
    await s2.commit()
    expect(await db.admin.value<number>('select count(*)::int from public.follows where follower_id = $1', [asker])).toBe(0)
    expect(await misses(asker)).toBe(0)
  })

  it('the 20th place raced by two newcomers: exactly one request, the other { invalid: true }', async () => {
    const [owner, a, b] = (await people('Paula', 'Ada', 'Bo')) as [string, string, string]
    const code = await newCode(owner)
    await db.admin.query(`update public.friend_codes set use_count = 19 where owner_id = $1`, [owner])
    await s1.begin(a)
    await s2.begin(b)
    // each commits as soon as its own statement returned (the other one may be waiting for it)
    const attempt = (s: Session) => settle(s.rpc('request_follow_via_code', [code])).then(async (r) => {
      await s.commit()
      return r
    })
    const [ra, rb] = await Promise.all([attempt(s1), attempt(s2)])
    const answers = [ra, rb].map((r) => (r.ok ? r.value : r))
    expect(answers).toContainEqual({ status: 'requested', profile_id: owner })
    expect(answers).toContainEqual({ invalid: true })
    expect(await db.admin.value<number>('select use_count from public.friend_codes where owner_id = $1', [owner])).toBe(20)
    expect(await db.admin.value<number>('select count(*)::int from public.follows where followee_id = $1', [owner])).toBe(1)
  })
})
