/**
 * The invitation e-mail under concurrency on real PostgreSQL 17 (docs/decisions/0002-concurrency-tests-real-postgres.md,
 * supabase/migrations/20261028000000_invite_email.sql "LOCKS", docs/spec/invite-email-design.md §11, §14).
 * Each pair in both orders: one side holds its locks in an open transaction, the other runs.
 *   - switch-off <-> dispatch: once "off" has answered, no later dispatch decides a mail for that person;
 *   - account deletion <-> dispatch: never a deadlock, never a mail for a deleted account;
 *   - the red button <-> dispatch: after "off" no dispatch sends;
 *   - 🔒 a reservation on the invitee's own list <-> dispatch: the dispatch neither waits nor skips (the answer and the
 *     timing do not depend on reservations).
 * The dispatch runs as the superuser, like pg_cron. The pg_net stub records requests (shims/000_supabase_shims.sql).
 * World (./world.ts): host Anna with an occasion + wishes, guests Ben (b) and Cem (c), outsiders Dana (d), Emil (e).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { settle, startRealPg, type RealPg } from '../../src/realpg'
import { seedWorld, type World } from './world'

const SECRET = 'realpg-test-push-secret-0123456789abcdef-0123456789'
const CONSENT = 'invite-email-2026-10-28'

let db: RealPg
beforeAll(async () => {
  db = await startRealPg()
  await db.admin.query(`insert into vault.shim_secrets (name, secret) values ('push_dispatch_secret', $1) on conflict (name) do nothing`, [SECRET])
  await db.admin.query('select private.set_invite_email_feature(true)')
})
afterAll(async () => {
  await db?.close()
})

async function friends(a: string, b: string): Promise<void> {
  await db.admin.query(
    `insert into public.follows (follower_id, followee_id, status, requested_at, accepted_at)
     values ($1, $2, 'accepted', now(), now()), ($2, $1, 'accepted', now(), now()) on conflict do nothing`,
    [a, b],
  )
}

const optIn = (uid: string) => db.asUser(uid, (s) => s.rpc('set_invite_email', [true, 'de', CONSENT]))
const due = () => db.admin.query(`update private.invite_email_outbox set not_before = now() - interval '1 second'`)
const dispatch = () => db.admin.value<number>('select private.invite_email_dispatch()')
const emailOf = (uid: string) => db.admin.value<string>('select email from auth.users where id = $1', [uid])

/** every address the stub has seen since `afterId` */
async function sentTo(afterId = 0): Promise<string[]> {
  const list = await db.admin.rows<{ body: { payload: string } }>(
    `select body from net.shim_requests where id > $1 and url like '%/api/email/send' order by id`, [afterId])
  return list.flatMap((r) => (JSON.parse(r.body.payload) as { messages: { to: string }[] }).messages.map((m) => m.to))
}
const lastRequestId = () => db.admin.value<number>('select coalesce(max(id), 0)::int from net.shim_requests')

/** Dana opted in and is invited by Anna (host) into the world's occasion; the grace is over. */
async function danaInvited(): Promise<World> {
  const w = await seedWorld(db)
  await friends(w.host, w.d)
  await optIn(w.d)
  await db.asUser(w.host, (s) => s.rpc('send_occasion_invites', [w.occasionId, [w.d]]))
  await due()
  return w
}

describe('switch-off <-> dispatch', () => {
  it('switch-off holds the preference row: the dispatch does not wait, sends nothing for Dana and decides nothing later', async () => {
    const w = await danaInvited()
    const before = await lastRequestId()
    const user = await db.session('opt-out')
    try {
      await user.begin(w.d)
      await user.rpc('set_invite_email', [false, null, null])        // holds the row lock, not committed
      const started = Date.now()
      expect(await dispatch()).toBe(0)                                // SKIP LOCKED: no wait
      expect(Date.now() - started).toBeLessThan(3000)
      expect(await db.admin.value<number>('select count(*)::int from private.invite_email_outbox')).toBe(1)  // later
      await user.commit()
      await due()
      expect(await dispatch()).toBe(0)
      expect(await db.admin.value<number>('select count(*)::int from private.invite_email_outbox')).toBe(0)
      expect(await sentTo(before)).toEqual([])
    } finally {
      await user.end()
    }
  })

  it('a running dispatch holds the preference row: switch-off waits, then nothing more is decided for Dana', async () => {
    const w = await danaInvited()
    const before = await lastRequestId()
    const cron = await db.session('cron')
    const user = await db.session('opt-out')
    try {
      await cron.begin()
      expect(await cron.value<number>('select private.invite_email_dispatch()')).toBe(1)   // decided, not committed
      await user.begin(w.d)
      const off = settle(user.rpc('set_invite_email', [false, null, null]))
      const info = await db.waitUntilBlocked(user, cron, off)
      expect(info.blockedBy).toContain(cron.pid)
      await cron.commit()
      expect(await off).toMatchObject({ ok: true })
      await user.commit()
      expect(await sentTo(before)).toEqual([await emailOf(w.d)])    // the one mail decided BEFORE "off" answered
      // a new invitation after "off": no mail, whatever the rate limit says
      const bensOccasion = await db.asUser(w.b, (s) => s.value<string>(
        `insert into public.occasions (host_id, title, starts_at, tz) values ($1, 'Spieleabend', now() + interval '9 days', 'Europe/Berlin') returning id`, [w.b]))
      await friends(w.b, w.d)
      await db.asUser(w.b, (s) => s.rpc('send_occasion_invites', [bensOccasion, [w.d]]))
      await due()
      expect(await dispatch()).toBe(0)
      expect(await sentTo(before)).toEqual([await emailOf(w.d)])
    } finally {
      await cron.end()
      await user.end()
    }
  })
})

describe('account deletion <-> dispatch', () => {
  it('deletion first (open): the dispatch does not wait and sends nothing; deletion then commits', async () => {
    const w = await danaInvited()
    const before = await lastRequestId()
    const user = await db.session('delete')
    try {
      await user.begin(w.d)
      await user.rpc('delete_my_account')
      const started = Date.now()
      expect(await settle(dispatch())).toEqual({ ok: true, value: 0 })
      expect(Date.now() - started).toBeLessThan(3000)
      await user.commit()
      await due()
      expect(await dispatch()).toBe(0)
      expect(await sentTo(before)).toEqual([])
      expect(await db.admin.value<number>('select count(*)::int from public.invite_email_prefs where profile_id = $1', [w.d])).toBe(0)
    } finally {
      await user.end()
    }
  })

  it('dispatch first (open): deletion waits for it, no deadlock, and the account\'s rows are gone afterwards', async () => {
    const w = await danaInvited()
    const cron = await db.session('cron')
    const user = await db.session('delete')
    try {
      await cron.begin()
      expect(await cron.value<number>('select private.invite_email_dispatch()')).toBe(1)
      await user.begin(w.d)
      const deleting = settle(user.rpc('delete_my_account'))
      await db.waitUntilBlocked(user, cron, deleting)
      await cron.commit()
      expect(await deleting).toMatchObject({ ok: true })
      await user.commit()
      for (const table of ['public.invite_email_prefs', 'public.invite_email_tokens']) {
        expect(await db.admin.value<number>(`select count(*)::int from ${table} where profile_id = $1`, [w.d]), table).toBe(0)
      }
    } finally {
      await cron.end()
      await user.end()
    }
  })
})

describe('a RETRY row <-> account deletion (Codex review #1)', () => {
  it('the retry queue has no foreign key into profiles (a deletion cannot cascade into a row the dispatch holds)', async () => {
    expect(await db.admin.value<number>(
      `select count(*)::int from pg_constraint where conrelid = 'private.invite_email_outbox'::regclass and contype = 'f'`)).toBe(0)
  })

  it('deletion open while Dana\'s retry is due: the dispatch neither waits nor sends; afterwards the retry is dropped', async () => {
    const w = await danaInvited()
    expect(await dispatch()).toBe(1)
    const request = await db.admin.value<number>('select max(request_id)::int from private.invite_email_requests')
    await db.admin.query('insert into net._http_response (id, status_code, content) values ($1, 503, null)', [request])
    await dispatch()                                                // collects: one retry row for Dana
    expect(await db.admin.rows('select profile_id, attempt from private.invite_email_outbox where profile_id = $1', [w.d]))
      .toEqual([{ profile_id: w.d, attempt: 1 }])
    await due()
    const before = await lastRequestId()
    const user = await db.session('delete')
    try {
      await user.begin(w.d)
      await user.rpc('delete_my_account')                           // holds Dana's profile FOR UPDATE, not committed
      const started = Date.now()
      expect(await settle(dispatch())).toEqual({ ok: true, value: 0 })
      expect(Date.now() - started).toBeLessThan(3000)
      await user.commit()
      await due()
      expect(await dispatch()).toBe(0)
      expect(await sentTo(before)).toEqual([])
      expect(await db.admin.value<number>('select count(*)::int from private.invite_email_outbox where profile_id = $1', [w.d])).toBe(0)
    } finally {
      await user.end()
    }
  })
})

describe('the red button <-> dispatch', () => {
  it('dispatch first: the switch waits for it; afterwards the queue is empty', async () => {
    await danaInvited()
    const cron = await db.session('cron')
    const admin2 = await db.session('switch')
    try {
      await cron.begin()
      expect(await cron.value<number>('select private.invite_email_dispatch()')).toBe(1)
      await admin2.begin()
      const switching = settle(admin2.query('select private.set_invite_email_feature(false)'))
      await db.waitUntilBlocked(admin2, cron, switching)
      await cron.commit()
      expect((await switching).ok).toBe(true)
      await admin2.commit()
      expect(await db.admin.value<boolean>('select invite_email from private.features')).toBe(false)
      expect(await db.admin.value<number>('select count(*)::int from private.invite_email_outbox')).toBe(0)
    } finally {
      await db.admin.query('select private.set_invite_email_feature(true)')
      await cron.end()
      await admin2.end()
    }
  })

  it('switch first (open): the dispatch waits, then sees "off" and sends nothing', async () => {
    const w = await danaInvited()
    const before = await lastRequestId()
    const cron = await db.session('cron')
    const admin2 = await db.session('switch')
    try {
      await admin2.begin()
      await admin2.query('select private.set_invite_email_feature(false)')
      const running = settle(cron.value<number>('select private.invite_email_dispatch()'))
      await db.waitUntilBlocked(cron, admin2, running)
      await admin2.commit()
      expect(await running).toEqual({ ok: true, value: 0 })
      expect(await sentTo(before)).toEqual([])
      expect(await db.admin.value<number>('select count(*)::int from public.invite_email_prefs where profile_id = $1', [w.d])).toBe(1) // kept
    } finally {
      await db.admin.query('select private.set_invite_email_feature(true)')
      await cron.end()
      await admin2.end()
    }
  })
})

describe('🔒 a reservation on the invitee\'s own list <-> dispatch', () => {
  it('Anna (who owns a list) is invited by Ben; Cem\'s reservation on Anna\'s list is open: the mail goes at once, the same as without', async () => {
    const w = await seedWorld(db)
    const bensOccasion = await db.asUser(w.b, (s) => s.value<string>(
      `insert into public.occasions (host_id, title, starts_at, tz) values ($1, 'Spieleabend', now() + interval '9 days', 'Europe/Berlin') returning id`, [w.b]))
    await friends(w.b, w.host)
    await optIn(w.host)
    await db.asUser(w.b, (s) => s.rpc('send_occasion_invites', [bensOccasion, [w.host]]))
    await due()
    const before = await lastRequestId()
    const giver = await db.session('reserve')
    try {
      await giver.begin(w.c)
      await giver.rpc('reserve_wish', [w.w1])                       // holds lock_profile_pair(Cem, Anna), not committed
      const started = Date.now()
      expect(await dispatch()).toBe(1)                               // neither waits nor skips Anna
      expect(Date.now() - started).toBeLessThan(3000)
      await giver.commit()
      expect(await sentTo(before)).toEqual([await emailOf(w.host)])
    } finally {
      await giver.end()
    }
  })
})
