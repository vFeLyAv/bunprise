/**
 * Web Push in the database (supabase/migrations/20261027150000_web_push.sql, docs/spec/web-push-design.md §13):
 * devices, preferences, the outbox trigger, dispatch to the Worker (pg_net stub: shims/000_supabase_shims.sql records
 * the requests), the Worker's answers (gone / retry), purge, export, privileges — and 🔒 the secrecy of reservations:
 * a push for an invitation never depends on reservations, neither the owner's nor the invitee's own.
 * All names invented, keys are fixtures (the shape of a real key, not a real key).
 */
import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type Querier, type TestDb } from '../../src/harness'
import { addWish, createList } from '../follows/seed'
import { createMember, execAs, expectRpcError, rpc } from '../pilot/seed'
import { SWITCH_ON, inboxId, respond, seedInvites, send, withdraw } from '../invitations/seed'

const SECRET = 'db-test-push-secret-0123456789abcdef-0123456789'
const PUSH_ON = 'select private.set_web_push(true)'
const VAULT = `insert into vault.shim_secrets (name, secret) values ('push_dispatch_secret', '${SECRET}')`
const P256DH = `B${'A'.repeat(43)}${'b'.repeat(43)}`
const AUTH = 'Zm9vYmFyLWJhcmZvby0xMg'
const CONSENT = 'push-2026-10-27'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb({ extraSql: [SWITCH_ON, PUSH_ON, VAULT] })
})
afterAll(() => t.close())
beforeEach(async () => {
  await t.db.exec('delete from net.shim_requests; delete from net._http_response; delete from private.push_requests; delete from private.push_outbox')
})

let endpointSeq = 0
const endpoint = (host = 'https://fcm.googleapis.com/fcm/send/') => `${host}device-${++endpointSeq}`

/** A live auth session for the person (what GoTrue writes at sign-in). */
async function session(uid: string): Promise<string> {
  return scalar<string>(t.db, 'insert into auth.sessions (user_id) values ($1) returning id', [uid])
}

/** Runs as the person with an access token of that session (session_id claim, like GoTrue). */
function asDevice<T>(uid: string, sid: string | null, fn: (tx: Querier) => Promise<T>): Promise<T> {
  return t.asUser(uid, async (tx) => {
    const claims: Record<string, string> = { sub: uid, role: 'authenticated' }
    if (sid) claims['session_id'] = sid
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    return fn(tx)
  })
}

function rpcDevice<T = unknown>(uid: string, sid: string | null, fn: string, args: readonly unknown[] = []): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
  return asDevice(uid, sid, (tx) => scalar<T>(tx, `select public.${fn}(${placeholders}) as v`, args))
}

function subscribe(uid: string, sid: string | null, url: string, lang = 'de', extra: { p256dh?: string; auth?: string; consent?: string } = {}) {
  return rpcDevice<{ ok: true; invitations: boolean }>(uid, sid, 'push_subscribe', [url, extra.p256dh ?? P256DH, extra.auth ?? AUTH, lang, extra.consent ?? CONSENT])
}

interface Message { n: number; id: string; endpoint: string; p256dh: string; auth: string; lang: string; ttl: number; kind: string; inviter: string; title: string }
interface SentRequest { id: number; url: string; ts: string; payload: string; sig: string; messages: Message[] }

const dispatch = () => scalar<number>(t.db, 'select private.push_dispatch()')

async function sentRequests(): Promise<SentRequest[]> {
  const list = await rows<{ id: number; url: string; body: { ts: string; payload: string; sig: string } }>(t.db, 'select id, url, body from net.shim_requests order by id')
  return list.map((r) => ({ id: Number(r.id), url: r.url, ...r.body, messages: (JSON.parse(r.body.payload) as { messages: Message[] }).messages }))
}

const sentMessages = async () => (await sentRequests()).flatMap((r) => r.messages)

/** Felix with a device, invited by Hanna (host) into "Grillabend". */
async function invitedWithDevice(lang = 'de') {
  const w = await seedInvites(t)
  const sid = await session(w.felix)
  const url = endpoint()
  await subscribe(w.felix, sid, url, lang)
  return { ...w, sid, url }
}

describe('HMAC-SHA256 in SQL (private.push_hmac)', () => {
  it('equals RFC 4231 test case 2 and Node for long keys and non-ASCII text', async () => {
    expect(await scalar(t.db, `select private.push_hmac('Jefe', 'what do ya want for nothing?')`))
      .toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
    const key = `${'k'.repeat(100)}-ключ`
    const message = '1761500000.{"v":1,"title":"„Grillabend“ · Ёлка"}'
    expect(await scalar(t.db, 'select private.push_hmac($1, $2)', [key, message]))
      .toBe(createHmac('sha256', key).update(message, 'utf8').digest('hex'))
  })
})

describe('devices: push_subscribe / push_unsubscribe / get_push_settings / set_push_settings', () => {
  it('registers this device for the caller and their session; checks endpoint, keys, language and consent', async () => {
    const anna = await createMember(t, 'Anna')
    const sid = await session(anna)
    const url = endpoint()
    expect(await subscribe(anna, sid, url, 'uk')).toEqual({ ok: true, invitations: true })
    expect(await rows(t.db, 'select profile_id, session_id, lang, consent from public.push_subscriptions where endpoint = $1', [url]))
      .toEqual([{ profile_id: anna, session_id: sid, lang: 'uk', consent: CONSENT }])
    for (const bad of ['https://evil.example/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:444/x', 'https://u@fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.example/x', 'https://storage.googleapis.com/x', `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
      'https://fcm.googleapis.com/a b', '',
      // one spelling per subscription (Codex code review #1)
      'https://fcm.googleapis.com/x/../fcm/send/T', 'https://fcm.googleapis.com/fcm/send/./T', 'https://fcm.googleapis.com/fcm/send/%54',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2b', 'https://wns2-par02p.notify.windows.com/w/?token=%41',
      'https://fcm.googleapis.com/fcm/send/T#x', 'https://fcm.googleapis.com/fcm\\send/T','https://FCM.googleapis.com/fcm/send/T']) {
      await expectRpcError(subscribe(anna, sid, bad), 'validation')
    }
    for (const good of ['https://web.push.apple.com/QGx', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA%2B%2Fx%3D', 'https://fcm.googleapis.com/fcm/send/cX1:APA91b-x_y']) {
      expect(await subscribe(anna, sid, good)).toMatchObject({ ok: true })
    }
    await expectRpcError(subscribe(anna, sid, endpoint(), 'de', { p256dh: `A${'A'.repeat(86)}` }), 'validation')
    await expectRpcError(subscribe(anna, sid, endpoint(), 'de', { auth: 'short' }), 'validation')
    await expectRpcError(subscribe(anna, sid, endpoint(), 'fr'), 'validation')
    await expectRpcError(subscribe(anna, sid, endpoint(), 'de', { consent: 'yes' }), 'validation')
  })

  it('needs a live session in the token, the current consents and the switch', async () => {
    const ben = await createMember(t, 'Ben')
    await expectRpcError(subscribe(ben, null, endpoint()), 'not_authenticated')
    await expectRpcError(subscribe(ben, '00000000-0000-4000-8000-000000000000', endpoint()), 'not_authenticated')
    const other = await createMember(t, 'Other')
    await expectRpcError(subscribe(ben, await session(other), endpoint()), 'not_authenticated')  // someone else's session
    const noConsent = await createMember(t, 'Nocon', { consents: false })
    await expectRpcError(subscribe(noConsent, await session(noConsent), endpoint()), 'consent_required')
    await t.db.query('select private.set_web_push(false)')
    try {
      await expectRpcError(subscribe(ben, await session(ben), endpoint()), 'not_found')
      expect(await rpcDevice(ben, null, 'get_push_settings', [null])).toEqual({ available: false, device: false, invitations: true })
    } finally {
      await t.db.query(PUSH_ON)
    }
  })

  it('the same account again moves the device to the new session; ANOTHER account never takes an endpoint over', async () => {
    const anna = await createMember(t, 'Anna')
    const mallory = await createMember(t, 'Mallory')
    const first = await session(anna)
    const url = endpoint()
    await subscribe(anna, first, url, 'de')
    const second = await session(anna)
    await subscribe(anna, second, url, 'ru')
    expect(await rows(t.db, 'select profile_id, session_id, lang from public.push_subscriptions where endpoint = $1', [url]))
      .toEqual([{ profile_id: anna, session_id: second, lang: 'ru' }])
    // Mallory copied the endpoint and keys (a shared device): refused, the row stays Anna's, untouched
    await expectRpcError(subscribe(mallory, await session(mallory), url, 'de', { p256dh: `B${'z'.repeat(86)}` }), 'push_endpoint_taken')
    expect(await rows(t.db, 'select profile_id, session_id, p256dh from public.push_subscriptions where endpoint = $1', [url]))
      .toEqual([{ profile_id: anna, session_id: second, p256dh: P256DH }])
    // Mallory cannot remove it either
    expect(await rpcDevice(mallory, null, 'push_unsubscribe', [url])).toEqual({ ok: true })
    expect(await scalar(t.db, 'select count(*)::int from public.push_subscriptions where endpoint = $1', [url])).toBe(1)
    expect(await rpcDevice(anna, null, 'push_unsubscribe', [url])).toEqual({ ok: true })
    expect(await scalar(t.db, 'select count(*)::int from public.push_subscriptions where endpoint = $1', [url])).toBe(0)
  })

  it('keeps at most 10 devices per person (the oldest consent goes)', async () => {
    const anna = await createMember(t, 'Anna')
    const sid = await session(anna)
    const urls = Array.from({ length: 11 }, () => endpoint())
    for (const [i, url] of urls.entries()) {
      await subscribe(anna, sid, url)
      await t.db.query(`update public.push_subscriptions set consented_at = now() - make_interval(mins => $2::int) where endpoint = $1`, [url, 100 - i])
    }
    const left = await rows<{ endpoint: string }>(t.db, 'select endpoint from public.push_subscriptions where profile_id = $1 order by consented_at', [anna])
    expect(left.map((r) => r.endpoint)).toEqual(urls.slice(1))
  })

  it('get_push_settings: this device only for me AND my current session; the preference is per person', async () => {
    const anna = await createMember(t, 'Anna')
    const s1 = await session(anna)
    const url = endpoint()
    await subscribe(anna, s1, url)
    expect(await rpcDevice(anna, s1, 'get_push_settings', [url])).toEqual({ available: true, device: true, invitations: true })
    expect(await rpcDevice(anna, await session(anna), 'get_push_settings', [url])).toMatchObject({ device: false })
    expect(await rpcDevice(anna, s1, 'get_push_settings', [endpoint()])).toMatchObject({ device: false })
    const ben = await createMember(t, 'Ben')
    expect(await rpcDevice(ben, await session(ben), 'get_push_settings', [url])).toMatchObject({ device: false })
    expect(await rpc(t, anna, 'set_push_settings', [false])).toEqual({ ok: true, invitations: false })
    expect(await rpcDevice(anna, s1, 'get_push_settings', [url])).toEqual({ available: true, device: true, invitations: false })
    await expectRpcError(rpc(t, anna, 'set_push_settings', [null]), 'validation')
  })
})

describe('the outbox trigger: the same work for every invitation, delivered or silently suppressed', () => {
  it('writes one id-only row per new invitation row — also for a suppressed one, also without any device', async () => {
    const w = await seedInvites(t)
    await execAs(t, w.fabian, `update profiles set invitations_from = 'nobody' where id = $1`, [w.fabian])
    await send(t, w.host, w.occasionId, [w.felix, w.fabian])
    const delivered = await rows<{ invitee_id: string; delivered: boolean; id: string }>(
      t.db, 'select id, invitee_id, delivered from public.occasion_invitations where occasion_id = $1 order by delivered', [w.occasionId])
    expect(delivered.map((r) => r.delivered)).toEqual([false, true])
    const outbox = await rows<Record<string, unknown>>(t.db, 'select kind, ref_id, subscription_id, attempt from private.push_outbox order by id')
    expect(outbox).toEqual(expect.arrayContaining(delivered.map((r) => ({ kind: 'invitation', ref_id: r.id, subscription_id: null, attempt: 0 }))))
    expect(outbox).toHaveLength(2)
    // nothing but ids in the queue
    expect(await rows(t.db, `select column_name from information_schema.columns where table_schema = 'private' and table_name = 'push_outbox' order by ordinal_position`))
      .toEqual(['id', 'kind', 'ref_id', 'subscription_id', 'attempt', 'not_before', 'created_at'].map((column_name) => ({ column_name })))
  })

  it('writes nothing while push is switched off', async () => {
    const w = await seedInvites(t)
    await t.db.query('select private.set_web_push(false)')
    try {
      await send(t, w.host, w.occasionId, [w.felix])
      expect(await scalar(t.db, 'select count(*)::int from private.push_outbox')).toBe(0)
    } finally {
      await t.db.query(PUSH_ON)
    }
  })
})

describe('dispatch: what goes to the Worker', () => {
  it('a delivered, visible invitation -> one signed batch with the inviter name, the title and the device language', async () => {
    const w = await invitedWithDevice('ru')
    const second = endpoint('https://web.push.apple.com/')
    await subscribe(w.felix, w.sid, second, 'de')
    await send(t, w.host, w.occasionId, [w.felix])
    expect(await dispatch()).toBe(2)
    const [request, ...more] = await sentRequests()
    expect(more).toEqual([])
    expect(request!.url).toBe('https://bunprise.de/api/push/send')
    // the Worker's check, done independently here
    expect(request!.sig).toBe(createHmac('sha256', SECRET).update(`${request!.ts}.${request!.payload}`).digest('hex'))
    expect(Math.abs(Number(request!.ts) - Date.now() / 1000)).toBeLessThan(60)
    expect(JSON.parse(request!.payload).v).toBe(1)
    const byEndpoint = Object.fromEntries(request!.messages.map((m) => [m.endpoint, m]))
    for (const [url, lang] of [[w.url, 'ru'], [second, 'de']] as const) {
      const m = byEndpoint[url]!
      expect({ ...m, id: undefined, ttl: undefined, n: undefined }).toEqual({
        n: undefined, id: undefined, endpoint: url, p256dh: P256DH, auth: AUTH, lang, ttl: undefined, kind: 'invitation', inviter: 'Hanna', title: 'Grillabend',
      })
      expect(m.ttl).toBeGreaterThan(0)
      expect(m.ttl).toBeLessThanOrEqual(43200)
    }
    expect(await scalar(t.db, 'select count(*)::int from private.push_outbox')).toBe(0)
    const items = await scalar<{ s: string; k: string; r: string; a: number }[]>(t.db, 'select items from private.push_requests where request_id = $1', [request!.id])
    expect(items.map((i) => [i.k, i.a])).toEqual([['invitation', 0], ['invitation', 0]])
    // a second run has nothing to do
    expect(await dispatch()).toBe(0)
  })

  it('nothing for: withdrawn, accepted, silently suppressed, preference off, dead session, stale (> 1 h) — and nothing without the secret', async () => {
    const withdrawn = await invitedWithDevice()
    await send(t, withdrawn.host, withdrawn.occasionId, [withdrawn.felix])
    await withdraw(t, withdrawn.host, withdrawn.occasionId, withdrawn.felix)

    const accepted = await invitedWithDevice()
    await send(t, accepted.host, accepted.occasionId, [accepted.felix])
    await respond(t, accepted.felix, await inboxId(t, accepted.felix, accepted.occasionId), true)

    const suppressed = await invitedWithDevice()
    await execAs(t, suppressed.felix, `update profiles set invitations_from = 'nobody' where id = $1`, [suppressed.felix])
    await send(t, suppressed.host, suppressed.occasionId, [suppressed.felix])

    const prefOff = await invitedWithDevice()
    await rpc(t, prefOff.felix, 'set_push_settings', [false])
    await send(t, prefOff.host, prefOff.occasionId, [prefOff.felix])

    const signedOut = await invitedWithDevice()
    await t.db.query('delete from auth.sessions where id = $1', [signedOut.sid]) // sign-out (here or "everywhere")
    await send(t, signedOut.host, signedOut.occasionId, [signedOut.felix])

    const stale = await invitedWithDevice()
    await send(t, stale.host, stale.occasionId, [stale.felix])
    await t.db.query(`update private.push_outbox set created_at = now() - interval '61 minutes' where ref_id in
      (select id from public.occasion_invitations where invitee_id = $1)`, [stale.felix])

    expect(await scalar(t.db, 'select count(*)::int from private.push_outbox')).toBe(6)
    expect(await dispatch()).toBe(0)
    expect(await sentRequests()).toEqual([])
    expect(await scalar(t.db, 'select count(*)::int from private.push_outbox')).toBe(0)

    // the same visible invitation sends nothing while the Vault secret is missing (the queue waits up to 1 h)
    const later = await invitedWithDevice()
    await t.db.query(`delete from vault.shim_secrets`)
    try {
      await send(t, later.host, later.occasionId, [later.felix])
      expect(await dispatch()).toBe(0)
      expect(await sentRequests()).toEqual([])
      expect(await scalar(t.db, 'select count(*)::int from private.push_outbox')).toBe(1)
    } finally {
      await t.db.query(VAULT)
    }
    expect(await dispatch()).toBe(1)
  })

  it('switching off empties the queue; batches carry at most 10 messages', async () => {
    const w = await invitedWithDevice()
    await send(t, w.host, w.occasionId, [w.felix])
    await t.db.query('select private.set_web_push(false)')
    expect(await scalar(t.db, 'select count(*)::int from private.push_outbox')).toBe(0)
    await t.db.query(PUSH_ON)

    const big = await invitedWithDevice()
    for (let i = 0; i < 9; i += 1) await subscribe(big.felix, big.sid, endpoint())   // Felix: 10 devices
    const sid2 = await session(big.fabian)
    await subscribe(big.fabian, sid2, endpoint())
    await subscribe(big.fabian, sid2, endpoint())                                       // Fabian: 2 devices
    await send(t, big.host, big.occasionId, [big.felix, big.fabian])
    expect(await dispatch()).toBe(12)
    expect((await sentRequests()).map((r) => r.messages.length)).toEqual([10, 2])
  })
})

describe('the Worker\'s answers: gone devices are deleted, busy ones retried (at most twice), lost batches retried', () => {
  async function oneBatch() {
    const w = await invitedWithDevice()
    const second = endpoint()
    await subscribe(w.felix, w.sid, second)
    await send(t, w.host, w.occasionId, [w.felix])
    await dispatch()
    const [request] = await sentRequests()
    const ids = Object.fromEntries(request!.messages.map((m) => [m.endpoint, m.id]))
    const positions = Object.fromEntries(request!.messages.map((m) => [m.endpoint, m.n]))
    expect(Object.values(positions).sort()).toEqual([1, 2])
    await t.db.exec('delete from net.shim_requests')
    return { w, request: request!, goneId: ids[w.url]!, busyId: ids[second]!, busyN: positions[second]! }
  }
  const answer = (id: number, status: number | null, content: string | null) =>
    t.db.query('insert into net._http_response (id, status_code, content, timed_out) values ($1, $2, $3, $4)', [id, status, content, status === null])
  const due = () => t.db.query(`update private.push_outbox set not_before = now()`)

  it('200 {gone, retry}: the gone device goes, the busy one gets attempt 1 (30 s later), then 2, then nothing', async () => {
    const { request, goneId, busyId, busyN } = await oneBatch()
    await answer(request.id, 200, JSON.stringify({ gone: [goneId], retry: [busyN], sent: 0, failed: 0 }))
    expect(await dispatch()).toBe(0)                       // collect first; the retry is not due yet
    expect(await scalar(t.db, 'select count(*)::int from public.push_subscriptions where id = $1', [goneId])).toBe(0)
    const retry = await rows<{ subscription_id: string; attempt: number; later: boolean }>(t.db,
      `select subscription_id, attempt, not_before > now() + interval '20 seconds' as later from private.push_outbox`)
    expect(retry).toEqual([{ subscription_id: busyId, attempt: 1, later: true }])
    expect(await scalar(t.db, 'select count(*)::int from private.push_requests')).toBe(0)

    await due()
    expect(await dispatch()).toBe(1)                       // only the busy device, not the whole invitee again
    const [second] = await sentRequests()
    expect(second!.messages.map((m) => m.id)).toEqual([busyId])
    await t.db.exec('delete from net.shim_requests')
    expect(second!.messages.map((m) => m.n)).toEqual([1])
    await answer(second!.id, 200, JSON.stringify({ gone: [], retry: [1] }))
    await dispatch()
    expect(await rows(t.db, 'select attempt from private.push_outbox')).toEqual([{ attempt: 2 }])
    await due()
    await dispatch()
    const [third] = await sentRequests()
    await answer(third!.id, 200, JSON.stringify({ gone: [], retry: [1] }))
    await dispatch()
    expect(await scalar(t.db, 'select count(*)::int from private.push_outbox')).toBe(0)   // three attempts in all
  })

  it('no usable answer (timeout, 401/5xx) or none after 10 minutes: every item once more; garbage ids are ignored', async () => {
    const a = await oneBatch()
    await answer(a.request.id, null, null)                // pg_net timed out
    await dispatch()
    expect(await scalar(t.db, 'select count(*)::int from private.push_outbox where attempt = 1')).toBe(2)
    await t.db.exec('delete from private.push_outbox')

    const b = await oneBatch()
    await t.db.query(`update private.push_requests set sent_at = now() - interval '11 minutes' where request_id = $1`, [b.request.id])
    await dispatch()
    expect(await scalar(t.db, 'select count(*)::int from private.push_outbox where attempt = 1')).toBe(2)
    await t.db.exec('delete from private.push_outbox')

    const c = await oneBatch()
    await answer(c.request.id, 200, '{"gone": ["not-a-uuid", 42, null], "retry": "x"}')
    await dispatch()
    expect(await scalar(t.db, 'select count(*)::int from public.push_subscriptions where id in ($1, $2)', [c.goneId, c.busyId])).toBe(2)
    expect(await scalar(t.db, 'select count(*)::int from private.push_outbox')).toBe(0)
    await answer(999_999, 200, JSON.stringify({ gone: [c.goneId] }))   // an answer to a request we never sent
    await dispatch()
    expect(await scalar(t.db, 'select count(*)::int from public.push_subscriptions where id = $1', [c.goneId])).toBe(1)
  })
})

describe('purge, export', () => {
  it('purge_push removes devices whose session is gone and old queue rows; live devices stay', async () => {
    const anna = await createMember(t, 'Anna')
    const live = await session(anna)
    const dead = await session(anna)
    const liveUrl = endpoint()
    const deadUrl = endpoint()
    await subscribe(anna, live, liveUrl)
    await subscribe(anna, dead, deadUrl)
    await t.db.query('delete from auth.sessions where id = $1', [dead])
    await t.db.query('select private.purge_push()')
    expect(await rows(t.db, 'select endpoint from public.push_subscriptions where profile_id = $1', [anna])).toEqual([{ endpoint: liveUrl }])
  })

  it('export_my_push: my preference and devices (address, language, consent and its time), no keys; account deletion removes all', async () => {
    const anna = await createMember(t, 'Anna')
    const sid = await session(anna)
    const url = endpoint()
    await subscribe(anna, sid, url, 'en')
    await rpc(t, anna, 'set_push_settings', [false])
    const out = await rpc<{ preferences: unknown; devices: Record<string, unknown>[] }>(t, anna, 'export_my_push')
    expect(out.preferences).toEqual({ invitations: false })
    expect(out.devices).toHaveLength(1)
    expect(Object.keys(out.devices[0]!).sort()).toEqual(['consent', 'consented_at', 'created_at', 'endpoint', 'lang'])
    expect(out.devices[0]).toMatchObject({ endpoint: url, lang: 'en', consent: CONSENT })
    expect(JSON.stringify(out)).not.toContain(P256DH)
    await rpc(t, anna, 'delete_my_account')
    expect(await scalar(t.db, 'select count(*)::int from public.push_subscriptions where endpoint = $1', [url])).toBe(0)
    expect(await scalar(t.db, 'select count(*)::int from public.push_preferences where profile_id = $1', [anna])).toBe(0)
  })
})

describe('🔒 the secrecy of reservations', () => {
  it('twin worlds: what the Worker gets for an invitation is identical whether the invitee\'s own list and the host\'s list are reserved or not', async () => {
    async function world(reserved: boolean) {
      const w = await seedInvites(t)
      // Felix owns a list for his followers; Hanna (his friend) can reserve on it
      const list = await createList(t, w.felix, 'Felix wünscht sich', { visibility: 'followers' })
      const felixWish = await addWish(t, w.felix, list, 'Kopfhörer')
      if (reserved) {
        await rpc(t, w.host, 'reserve_wish', [felixWish])        // on the INVITEE's own list
        await rpc(t, w.guest, 'reserve_wish', [w.wish1])         // on the HOST's occasion list
        await rpc(t, w.guest, 'reserve_wish', [w.wish2])
        await rpc(t, w.guest, 'cancel_reservation', [w.wish2])
      }
      const sid = await session(w.felix)
      const url = endpoint()
      await subscribe(w.felix, sid, url, 'de')
      await send(t, w.host, w.occasionId, [w.felix])
      return url
    }
    const withReservations = await world(true)
    const without = await world(false)
    expect(await scalar(t.db, 'select count(*)::int from public.reservations')).toBeGreaterThan(0)
    expect(await dispatch()).toBe(2)
    const messages = await sentMessages()
    const strip = (m: Message | undefined) => (m ? { ...m, n: 0, id: '<id>', endpoint: '<endpoint>' } : m)
    const a = strip(messages.find((m) => m.endpoint === withReservations))
    const b = strip(messages.find((m) => m.endpoint === without))
    expect(a).toBeDefined()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('no push function reads or writes wishes, wishlists or reservations (source meta-test)', async () => {
    const fns = await rows<{ fn: string; src: string }>(t.db,
      `select n.nspname || '.' || p.proname as fn, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and (p.proname like '%push%' or p.proname in ('web_push_on', 'set_web_push', 'current_session_id'))
        order by 1`)
    expect(fns.map((f) => f.fn)).toEqual([
      'private.current_session_id', 'private.purge_push', 'private.push_collect', 'private.push_dispatch',
      'private.push_endpoint_ok', 'private.push_enqueue', 'private.push_hmac', 'private.push_secret',
      'private.push_session_alive', 'private.push_wants', 'private.set_web_push', 'private.web_push_on',
      'public.export_my_push', 'public.get_push_settings', 'public.push_subscribe', 'public.push_unsubscribe', 'public.set_push_settings',
    ])
    for (const f of fns) expect(f.src.toLowerCase(), f.fn).not.toMatch(/reserv|wish/)
  })
})

describe('privileges', () => {
  it('no REST access to the push tables for anon / authenticated; the queue tables are out of reach too', async () => {
    const anna = await createMember(t, 'Anna')
    for (const table of ['public.push_subscriptions', 'public.push_preferences', 'private.push_outbox', 'private.push_requests', 'private.push_config']) {
      await expectDbError(t.asUser(anna, (tx) => tx.query(`select * from ${table}`)), '42501')
      await expectDbError(t.asAnon((tx) => tx.query(`select * from ${table}`)), '42501')
    }
    await expectDbError(t.asUser(anna, (tx) => tx.query(
      `insert into public.push_subscriptions (profile_id, session_id, endpoint, p256dh, auth, lang, consent) values ($1, gen_random_uuid(), $2, $3, $4, 'de', $5)`,
      [anna, endpoint(), P256DH, AUTH, CONSENT])), '42501')
    await expectDbError(t.asUser(anna, (tx) => tx.query(`insert into public.push_preferences (profile_id, invitations) values ($1, false)`, [anna])), '42501')
  })

  it('the five RPCs for authenticated only; dispatch, collect, purge, the switch and every helper for nobody', async () => {
    const anna = await createMember(t, 'Anna')
    await expectDbError(t.asAnon((tx) => tx.query(`select public.push_subscribe('x','x','x','de','x')`)), '42501')
    await expectDbError(t.asAnon((tx) => tx.query(`select public.get_push_settings(null)`)), '42501')
    for (const call of ['private.push_dispatch()', 'private.push_collect()', 'private.purge_push()', 'private.set_web_push(true)',
      `private.push_hmac('a', 'b')`, 'private.push_secret()', 'private.web_push_on()']) {
      await expectDbError(t.asUser(anna, (tx) => tx.query(`select ${call}`)), '42501')
    }
    const executable = await rows<{ fn: string }>(t.db,
      `select p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.proname like any (array['%push%', 'set_web_push', 'web_push_on', 'current_session_id'])
          and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)
    expect(executable.map((r) => r.fn)).toEqual(['export_my_push', 'get_push_settings', 'push_subscribe', 'push_unsubscribe', 'set_push_settings'])
  })
})

it('the Worker endpoint and the secret name are where the handoff says', async () => {
  expect(await scalar(t.db, 'select dispatch_url from private.push_config')).toBe('https://bunprise.de/api/push/send')
  expect(await scalar(t.db, 'select private.push_secret()')).toBe(SECRET)
})
