/**
 * Web Push: the limit of 10 devices per person under parallel subscriptions, on real PostgreSQL 17
 * (supabase/migrations/20261027150000_web_push.sql, push_subscribe; docs/handoffs/2026-10-27-web-push.md, Codex code
 * review B5; docs/decisions/0002-concurrency-tests-real-postgres.md). push_subscribe takes a per-person advisory lock
 * (`push-device:<uid>`) before its insert + "keep the 10 newest by consented_at desc, id desc" delete. PGlite is one
 * connection, so this was never tested with calls that really overlap. Here:
 *   1. one person, many devices at once (lock barrier + free races, several rounds): never more than 10 rows, every
 *      call answers { ok: true }, no deadlock / timeout / raw SQL error; a control proves the race WOULD overflow
 *      without the lock (a throwaway copy of the function without that one line, in this test cluster only);
 *   2. the same endpoint at once: exactly one row (same person: all ok; two people: one ok, one push_endpoint_taken);
 *   3. two people do not wait for each other and do not share the limit;
 *   4. the oldest go: the survivors are exactly the 10 newest (consented_at = start of the registering transaction).
 * All names invented, keys are fixtures (the shape of a real key, not a real key).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { settle, startRealPg, type Outcome, type RealPg, type Session } from '../../src/realpg'

const P256DH = `B${'A'.repeat(43)}${'b'.repeat(43)}`
const AUTH = 'Zm9vYmFyLWJhcmZvby0xMg'
const CONSENT = 'push-2026-10-27'
const LIMIT = 10
const SESSIONS = 20
/** the contract's refusals of push_subscribe (a failure must be P0001 + one of these) */
const PUSH_CODES = ['not_found', 'consent_required', 'not_authenticated', 'validation', 'push_endpoint_taken']

let db: RealPg
let pool: Session[]
let run = 0
let seq = 0

beforeAll(async () => {
  db = await startRealPg()
  // 20261027235000_web_push_on.sql switches push on; make sure (the RPC answers not_found while it is off)
  await db.admin.query('select private.set_web_push(true)')
  pool = []
  for (let i = 1; i <= SESSIONS; i++) pool.push(await db.session(`push-${i}`))
})
afterAll(async () => {
  await db?.close()
})

const endpoint = (tag = 'dev') => `https://fcm.googleapis.com/fcm/send/pl-${run}-${tag}-${++seq}`

/** People with the current consents (has_consents) — names invented. */
async function people(...names: string[]): Promise<string[]> {
  const n = ++run
  const ids: string[] = []
  for (const name of names) ids.push(await db.createUser(`${name.toLowerCase()}-pl${n}@example.test`, { name }))
  await db.admin.query(
    `insert into public.consents (profile_id, kind, version, locale)
     select u.id, lv.kind, lv.version, 'de' from unnest($1::uuid[]) as u(id) cross join public.legal_versions lv`,
    [ids],
  )
  return ids
}

/** n live auth sessions (GoTrue) of the person — one per browser. */
const authSessions = (uid: string, n: number) =>
  db.admin.rows<{ id: string }>('insert into auth.sessions (user_id) select $1 from generate_series(1, $2) returning id', [uid, n])
    .then((r) => r.map((x) => x.id))

interface Device { uid: string; sid: string; url: string; lang?: string }

/** BEGIN as the person with an access token of that session (session_id claim, like GoTrue / PostgREST). */
async function beginAs(s: Session, d: Device): Promise<void> {
  await s.begin(d.uid)
  await s.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: d.uid, role: 'authenticated', session_id: d.sid }),
  ])
}

interface Call { out: Outcome; /** now() of the transaction in µs since epoch (= consented_at of its row) */ at: bigint | null }

/** push_subscribe inside the already open transaction, then commit (rollback on error) — one PostgREST request. */
async function subscribeAndEnd(s: Session, d: Device, fn = 'push_subscribe'): Promise<Call> {
  const out = await settle(s.rpc(fn, [d.url, P256DH, AUTH, d.lang ?? 'de', CONSENT]))
  let at: bigint | null = null
  if (out.ok) at = BigInt(await s.value<string>(`select (extract(epoch from now()) * 1000000)::bigint::text`))
  await (out.ok ? s.commit() : s.rollback())
  return { out, at }
}

function expectContract(label: string, out: Outcome): void {
  if (out.ok) return
  const contract = out.code === 'P0001' && PUSH_CODES.includes(out.message)
  expect(contract, `${label}: database error outside the contract: ${out.code} ${out.message}`).toBe(true)
}

const OK = { ok: true, value: { ok: true, invitations: true } }

/** Devices already registered (seeded as the superuser), `minutesAgo[i]` minutes old; returns their endpoints. */
async function preseed(uid: string, minutesAgo: readonly number[]): Promise<{ url: string; at: bigint }[]> {
  if (minutesAgo.length === 0) return []
  const [sid] = (await authSessions(uid, 1)) as [string]
  const out: { url: string; at: bigint }[] = []
  for (const m of minutesAgo) {
    const url = endpoint('old')
    const at = await db.admin.value<string>(
      `insert into public.push_subscriptions (profile_id, session_id, endpoint, p256dh, auth, lang, consent, consented_at)
       values ($1, $2, $3, $4, $5, 'de', $6, now() - make_interval(mins => $7::int))
       returning (extract(epoch from consented_at) * 1000000)::bigint::text`,
      [uid, sid, url, P256DH, AUTH, CONSENT, m],
    )
    out.push({ url, at: BigInt(at) })
  }
  return out
}

const devicesOf = (uid: string) =>
  db.admin.rows<{ endpoint: string }>('select endpoint from public.push_subscriptions where profile_id = $1 order by endpoint', [uid])
    .then((r) => r.map((x) => x.endpoint))

/** Pids of `sessions` that are queued for an advisory lock right now. */
const advisoryWaiters = (sessions: readonly Session[]) =>
  db.admin.value<number>(
    `select count(distinct pid)::int from pg_locks where locktype = 'advisory' and not granted and pid = any($1::int[])`,
    [sessions.map((s) => s.pid)],
  )

/** Polls until `count` of `sessions` wait for an advisory lock (the barrier: they all overlap). Bounded. */
async function untilQueued(sessions: readonly Session[], count: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const n = await advisoryWaiters(sessions)
    if (n === count) return
    if (Date.now() > deadline) throw new Error(`only ${n} of ${count} calls queued on the advisory lock within ${timeoutMs} ms`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

/**
 * The 10 newest by (consented_at desc) among the seeded rows and every successful call. null when the 10th and 11th
 * share a microsecond (the id tie-break is not known for deleted rows) — never seen, but then nothing is asserted.
 */
function newestTen(rows: readonly { url: string; at: bigint }[]): string[] | null {
  const sorted = [...rows].sort((a, b) => (a.at === b.at ? 0 : a.at > b.at ? -1 : 1))
  const tenth = sorted[LIMIT - 1]
  const eleventh = sorted[LIMIT]
  if (tenth && eleventh && tenth.at === eleventh.at) return null
  return sorted.slice(0, LIMIT).map((r) => r.url).sort()
}

/**
 * Schedule A — the lock barrier: the first call holds the person's advisory lock in an open transaction, the other
 * n-1 calls are sent and must ALL be queued on that lock at the same moment; then the first commits and the queue
 * drains one by one. Schedule B — a free race: all n transactions are opened first, then the n calls are written to
 * their sockets in the same tick and each commits as soon as it answered; an observer counts the queue meanwhile.
 */
async function manyDevicesAtOnce(uid: string, n: number, schedule: 'barrier' | 'free'): Promise<{ calls: Call[]; urls: string[]; maxQueued: number }> {
  const sids = await authSessions(uid, n)
  const devices: Device[] = sids.map((sid) => ({ uid, sid, url: endpoint() }))
  const sessions = pool.slice(0, n)
  if (schedule === 'barrier') {
    const [holder, ...waiters] = sessions as [Session, ...Session[]]
    const [first, ...rest] = devices as [Device, ...Device[]]
    await beginAs(holder, first)
    const held = await settle(holder.rpc('push_subscribe', [first.url, P256DH, AUTH, 'de', CONSENT]))
    expect(held).toEqual(OK)
    const heldAt = BigInt(await holder.value<string>(`select (extract(epoch from now()) * 1000000)::bigint::text`))
    await Promise.all(waiters.map((s, i) => beginAs(s, rest[i] as Device)))
    const pending = waiters.map((s, i) => subscribeAndEnd(s, rest[i] as Device))
    try {
      await untilQueued(waiters, waiters.length)
    } finally {
      await holder.commit()
    }
    const calls = [{ out: held, at: heldAt }, ...(await Promise.all(pending))]
    return { calls, urls: devices.map((d) => d.url), maxQueued: waiters.length }
  }
  await Promise.all(sessions.map((s, i) => beginAs(s, devices[i] as Device)))
  let done = false
  let maxQueued = 0
  const observer = (async () => {
    while (!done) maxQueued = Math.max(maxQueued, await advisoryWaiters(sessions))
  })()
  const calls = await Promise.all(sessions.map((s, i) => subscribeAndEnd(s, devices[i] as Device)))
  done = true
  await observer
  return { calls, urls: devices.map((d) => d.url), maxQueued }
}

describe('one person, many devices at the same moment', () => {
  const rounds: { schedule: 'barrier' | 'free'; pre: number; n: number }[] = [
    { schedule: 'barrier', pre: 0, n: 16 },
    { schedule: 'barrier', pre: 9, n: 16 },
    { schedule: 'barrier', pre: 10, n: 20 },
    { schedule: 'free', pre: 0, n: 18 },
    { schedule: 'free', pre: 5, n: 18 },
    { schedule: 'free', pre: 9, n: 20 },
    { schedule: 'free', pre: 0, n: 20 },
    { schedule: 'free', pre: 10, n: 16 },
  ]
  for (const [i, r] of rounds.entries()) {
    it(`round ${i + 1} (${r.schedule}): ${r.pre} devices + ${r.n} parallel subscriptions → exactly ${LIMIT}, all ok, the newest stay`, async () => {
      const [anna] = (await people('Anna')) as [string]
      const seeded = await preseed(anna, Array.from({ length: r.pre }, (_, k) => 100 - k))
      const { calls, urls, maxQueued } = await manyDevicesAtOnce(anna, r.n, r.schedule)
      calls.forEach((c, k) => expectContract(`call ${k + 1}`, c.out))
      expect(calls.map((c) => c.out)).toEqual(Array.from({ length: r.n }, () => OK))
      const left = await devicesOf(anna)
      expect(left).toHaveLength(Math.min(LIMIT, r.pre + r.n))
      const expected = newestTen([...seeded, ...calls.map((c, k) => ({ url: urls[k] as string, at: c.at as bigint }))])
      if (expected) expect(left).toEqual(expected)
      // more than 10 at once: some NEW devices are pushed out although their call answered ok (the documented rule
      // "the oldest goes", by transaction start) — the app re-registers such a device at its next start
      const newGone = urls.filter((u) => !left.includes(u)).length
      console.info(`[push-limit] round ${i + 1} (${r.schedule}, ${r.pre}+${r.n}): ${left.length} rows, max ${maxQueued} calls queued at once, ${newGone} new device(s) pushed out`)
      if (r.schedule === 'barrier') expect(maxQueued).toBe(r.n - 1)
    })
  }

  it('control: the same calls WITHOUT the advisory lock overflow the limit (so the tests above can fail)', async () => {
    // A throwaway copy of the real function minus its one `perform pg_advisory_xact_lock(...)` line, created only in
    // this test cluster (never a migration). Its transactions are all opened and run before any commits.
    const def = await db.admin.value<string>(`select pg_get_functiondef('public.push_subscribe(text, text, text, text, text)'::regprocedure)`)
    const lockLine = /^\s*perform pg_advisory_xact_lock\(hashtextextended\('push-device:'.*$/m
    expect(def).toMatch(lockLine)
    expect(def).toContain('public.push_subscribe(')
    await db.admin.query(def.replace(lockLine, '').replace('public.push_subscribe(', 'public.push_subscribe_unlocked('))
    try {
      const [anna] = (await people('Anna')) as [string]
      await preseed(anna, [100, 99, 98, 97, 96, 95, 94, 93, 92])
      const n = 6
      const sids = await authSessions(anna, n)
      const sessions = pool.slice(0, n)
      const devices: Device[] = sids.map((sid) => ({ uid: anna, sid, url: endpoint() }))
      await Promise.all(sessions.map((s, i) => beginAs(s, devices[i] as Device)))
      const outs = await Promise.all(sessions.map((s, i) => settle(s.rpc('push_subscribe_unlocked', [(devices[i] as Device).url, P256DH, AUTH, 'de', CONSENT]))))
      expect(outs).toEqual(Array.from({ length: n }, () => OK))   // nobody waited: each saw 9 + its own = 10
      await Promise.all(sessions.map((s) => s.commit()))
      expect(await devicesOf(anna)).toHaveLength(9 + n)          // 15 > 10: the bug B5 the lock closes
    } finally {
      await db.admin.query('drop function if exists public.push_subscribe_unlocked(text, text, text, text, text)')
    }
  })
})

describe('the same endpoint at the same moment', () => {
  it('one person, 16 sessions, one endpoint (5 rounds): exactly one row, every call ok, the row is one call\'s whole data', async () => {
    const langs = ['de', 'en', 'ru', 'uk'] as const
    for (let round = 0; round < 5; round++) {
      const [anna] = (await people('Anna')) as [string]
      await preseed(anna, [50, 40, 30])
      const n = 16
      const url = endpoint('same')
      const sids = await authSessions(anna, n)
      const devices: Device[] = sids.map((sid, i) => ({ uid: anna, sid, url, lang: langs[i % langs.length] }))
      const sessions = pool.slice(0, n)
      await Promise.all(sessions.map((s, i) => beginAs(s, devices[i] as Device)))
      const calls = await Promise.all(sessions.map((s, i) => subscribeAndEnd(s, devices[i] as Device)))
      calls.forEach((c, k) => expectContract(`call ${k + 1}`, c.out))
      expect(calls.map((c) => c.out)).toEqual(Array.from({ length: n }, () => OK))
      const row = await db.admin.rows<{ profile_id: string; session_id: string; lang: string }>(
        'select profile_id, session_id, lang from public.push_subscriptions where endpoint = $1', [url])
      expect(row).toHaveLength(1)
      expect(row[0]?.profile_id).toBe(anna)
      // session and language come from the SAME call (no mix of two updates)
      expect(devices.some((d) => d.sid === row[0]?.session_id && d.lang === row[0]?.lang)).toBe(true)
      expect(await devicesOf(anna)).toHaveLength(4)
    }
  })

  it('two people, one endpoint (8 rounds, both start orders): one gets it, the other push_endpoint_taken, never 23505', async () => {
    const seen = { anna: 0, ben: 0 }
    for (let round = 0; round < 8; round++) {
      const [anna, ben] = (await people('Anna', 'Ben')) as [string, string]
      const url = endpoint('shared')
      const [sa] = (await authSessions(anna, 1)) as [string]
      const [sb] = (await authSessions(ben, 1)) as [string]
      const da: Device = { uid: anna, sid: sa, url }
      const db2: Device = { uid: ben, sid: sb, url }
      const [s1, s2] = pool as [Session, Session, ...Session[]]
      await Promise.all([beginAs(s1, da), beginAs(s2, db2)])
      const [ca, cb] = round % 2 === 0
        ? await Promise.all([subscribeAndEnd(s1, da), subscribeAndEnd(s2, db2)])
        : await Promise.all([subscribeAndEnd(s2, db2), subscribeAndEnd(s1, da)]).then(([b, a]) => [a, b] as const)
      expectContract('Anna', ca.out)
      expectContract('Ben', cb.out)
      const outs = [ca.out, cb.out]
      expect(outs.filter((o) => o.ok)).toEqual([OK])
      expect(outs.filter((o) => !o.ok)).toEqual([{ ok: false, code: 'P0001', message: 'push_endpoint_taken' }])
      const winner = ca.out.ok ? anna : ben
      seen[ca.out.ok ? 'anna' : 'ben'] += 1
      expect(await db.admin.rows('select profile_id from public.push_subscriptions where endpoint = $1', [url]))
        .toEqual([{ profile_id: winner }])
    }
    console.info(`[push-limit] shared endpoint: Anna won ${seen.anna}/8, Ben won ${seen.ben}/8`)
  })
})

describe('two people at the same moment', () => {
  it('Anna holds her lock: Ben is not blocked at all; only Anna\'s own second tab waits (on the advisory lock)', async () => {
    const [anna, ben] = (await people('Anna', 'Ben')) as [string, string]
    const [a1, a2] = (await authSessions(anna, 2)) as [string, string]
    const [b1] = (await authSessions(ben, 1)) as [string]
    const [holder, other, tab2] = pool as [Session, Session, Session, ...Session[]]
    await beginAs(holder, { uid: anna, sid: a1, url: endpoint() })
    expect(await settle(holder.rpc('push_subscribe', [endpoint(), P256DH, AUTH, 'de', CONSENT]))).toEqual(OK)
    try {
      // Ben, while Anna's transaction is still open: answers without waiting
      await beginAs(other, { uid: ben, sid: b1, url: endpoint() })
      const started = Date.now()
      const ben1 = await subscribeAndEnd(other, { uid: ben, sid: b1, url: endpoint() })
      expect(ben1.out).toEqual(OK)
      expect(Date.now() - started).toBeLessThan(2_000)
      // Anna's second tab: queued on HER advisory lock, held by the first tab
      await beginAs(tab2, { uid: anna, sid: a2, url: endpoint() })
      const second = subscribeAndEnd(tab2, { uid: anna, sid: a2, url: endpoint() })
      const info = await db.waitUntilBlocked(tab2, holder, second.then((c) => c.out))
      expect(info.waitEvent).toBe('Lock:advisory')
      await holder.commit()
      expect((await second).out).toEqual(OK)
    } catch (err) {
      await holder.rollback().catch(() => undefined)
      throw err
    }
    expect(await devicesOf(anna)).toHaveLength(2)
    expect(await devicesOf(ben)).toHaveLength(1)
  })

  it('Anna and Ben, 10 parallel subscriptions each on top of 5 devices each (3 rounds): each ends at exactly 10, all ok', async () => {
    for (let round = 0; round < 3; round++) {
      const [anna, ben] = (await people('Anna', 'Ben')) as [string, string]
      await preseed(anna, [60, 50, 40, 30, 20])
      await preseed(ben, [60, 50, 40, 30, 20])
      const per = SESSIONS / 2
      const devices: Device[] = []
      for (const uid of [anna, ben]) for (const sid of await authSessions(uid, per)) devices.push({ uid, sid, url: endpoint() })
      // interleave Anna's and Ben's calls over the connections
      const order = devices.map((_, i) => (i % 2 === 0 ? i / 2 : per + (i - 1) / 2))
      const sessions = pool.slice(0, SESSIONS)
      await Promise.all(sessions.map((s, i) => beginAs(s, devices[order[i] as number] as Device)))
      const calls = await Promise.all(sessions.map((s, i) => subscribeAndEnd(s, devices[order[i] as number] as Device)))
      calls.forEach((c, k) => expectContract(`call ${k + 1}`, c.out))
      expect(calls.map((c) => c.out)).toEqual(Array.from({ length: SESSIONS }, () => OK))
      expect(await devicesOf(anna)).toHaveLength(LIMIT)
      expect(await devicesOf(ben)).toHaveLength(LIMIT)
    }
  })
})

describe('the oldest go', () => {
  it('10 registered devices + 6 new ones at once: the 6 new and the 4 newest old ones stay, the 6 oldest go', async () => {
    const [anna] = (await people('Anna')) as [string]
    const old = await preseed(anna, [100, 90, 80, 70, 60, 50, 40, 30, 20, 10])  // old[0] is the oldest
    const { calls, urls } = await manyDevicesAtOnce(anna, 6, 'barrier')
    expect(calls.map((c) => c.out)).toEqual(Array.from({ length: 6 }, () => OK))
    const expected = [...urls, ...old.slice(6).map((o) => o.url)].sort()
    expect(await devicesOf(anna)).toEqual(expected)
  })

  it('re-subscribing an OLD device refreshes it (consented_at = now), so it survives the next newcomers', async () => {
    const [anna] = (await people('Anna')) as [string]
    const old = await preseed(anna, [100, 90, 80, 70, 60, 50, 40, 30, 20, 10])
    const oldest = old[0] as { url: string }
    const [sid] = (await authSessions(anna, 1)) as [string]
    const s = pool[0] as Session
    await beginAs(s, { uid: anna, sid, url: oldest.url })
    expect((await subscribeAndEnd(s, { uid: anna, sid, url: oldest.url })).out).toEqual(OK)
    const { calls, urls } = await manyDevicesAtOnce(anna, 3, 'free')
    expect(calls.map((c) => c.out)).toEqual(Array.from({ length: 3 }, () => OK))
    // gone: the three oldest that were NOT refreshed (90, 80, 70 minutes)
    const expected = [oldest.url, ...urls, ...old.slice(4).map((o) => o.url)].sort()
    expect(await devicesOf(anna)).toEqual(expected)
  })
})
