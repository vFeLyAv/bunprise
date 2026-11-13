/**
 * The invitation e-mail in the database (supabase/migrations/20261028000000_invite_email.sql,
 * docs/spec/invite-email-design.md §14): the switch, the opt-in, the outbox trigger, the dispatch to the Worker (pg_net
 * stub: shims/000_supabase_shims.sql records the requests), suppression and the sender's cloak (a mail exactly when the
 * invitation is visible in the app), the rate limit and the digest, the unsubscribe token (anon, through the Worker),
 * the Worker's answers (retry), purge, export, deletion, privileges — and 🔒 the secrecy of reservations.
 * All names invented, e-mails @example.test.
 */
import { createHmac, createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { addWish, createList } from '../follows/seed'
import { createMember, execAs, expectRpcError, rpc } from '../pilot/seed'
import { SWITCH_ON, OCCASION_TITLE, friends, inboxId, respond, seedInvites, send, withdraw } from '../invitations/seed'

const SECRET = 'db-test-push-secret-0123456789abcdef-0123456789'
const MAIL_ON = 'select private.set_invite_email_feature(true)'
const VAULT = `insert into vault.shim_secrets (name, secret) values ('push_dispatch_secret', '${SECRET}') on conflict (name) do nothing`
const CONSENT = 'invite-email-2026-10-28'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb({ extraSql: [SWITCH_ON, MAIL_ON, VAULT] })
})
afterAll(() => t.close())
beforeEach(async () => {
  await t.db.exec(`delete from net.shim_requests; delete from net._http_response; delete from private.invite_email_requests;
                   delete from private.invite_email_outbox; delete from public.invite_email_prefs; delete from public.invite_email_tokens;
                   delete from private.invite_email_sent`)
})

interface Message { n: number; to: string; lang: string; token: string }
interface SentRequest { id: number; url: string; ts: string; payload: string; sig: string; messages: Message[] }

const dispatch = () => scalar<number>(t.db, 'select private.invite_email_dispatch()')
/** pretend the 5 minutes of grace (and any waiting) are over */
const due = () => t.db.exec(`update private.invite_email_outbox set not_before = now() - interval '1 second'`)
const optIn = (uid: string, lang = 'de', consent = CONSENT) => rpc<{ ok: true; enabled: boolean }>(t, uid, 'set_invite_email', [true, lang, consent])
const optOut = (uid: string) => rpc<{ ok: true; enabled: boolean }>(t, uid, 'set_invite_email', [false, null, null])
const settings = (uid: string) => rpc<{ available: boolean; enabled: boolean; address: boolean }>(t, uid, 'get_invite_email_settings')
const unsubscribe = (token: string | null) => t.asAnon((tx) => scalar<{ ok: true } | null>(tx, 'select public.invite_email_unsubscribe($1) as v', [token]))
const emailOf = (uid: string) => scalar<string>(t.db, 'select email from auth.users where id = $1', [uid])
const outboxCount = () => scalar<number>(t.db, 'select count(*)::int from private.invite_email_outbox')

async function sentRequests(): Promise<SentRequest[]> {
  const list = await rows<{ id: number; url: string; body: { ts: string; payload: string; sig: string } }>(t.db, 'select id, url, body from net.shim_requests order by id')
  return list.map((r) => ({ id: Number(r.id), url: r.url, ...r.body, messages: (JSON.parse(r.body.payload) as { messages: Message[] }).messages }))
}
const sentMessages = async () => (await sentRequests()).flatMap((r) => r.messages)
const sentTo = async () => (await sentMessages()).map((m) => m.to).sort()

/** the Worker's answer to a request (what pg_net writes) */
const answer = (id: number, status: number | null, content: string | null) =>
  t.db.query('insert into net._http_response (id, status_code, content) values ($1, $2, $3)', [id, status, content])

/** Felix opted in (German), invited by Hanna (host) into "Grillabend"; the grace is over. */
async function invitedAndOptedIn(lang = 'de') {
  const w = await seedInvites(t)
  await optIn(w.felix, lang)
  await send(t, w.host, w.occasionId, [w.felix])
  await due()
  return w
}

describe('the switch (private.features.invite_email)', () => {
  it('ships OFF: the migration alone leaves it false, without a dispatch job', async () => {
    const fresh = await createTestDb({ extraSql: [SWITCH_ON] })
    try {
      expect(await scalar(fresh.db, 'select invite_email from private.features')).toBe(false)
      const anna = await createMember(fresh, 'Anna')
      expect(await rpc(fresh, anna, 'get_invite_email_settings')).toEqual({ available: false, enabled: false, address: true })
      await expectRpcError(rpc(fresh, anna, 'set_invite_email', [true, 'de', CONSENT]), 'not_found')
      // switching off is always allowed (it narrows)
      expect(await rpc(fresh, anna, 'set_invite_email', [false, null, null])).toEqual({ ok: true, enabled: false })
      // no outbox row for any invitation while it is off
      const w = await seedInvites(fresh)
      await send(fresh, w.host, w.occasionId, [w.felix])
      expect(await scalar(fresh.db, 'select count(*)::int from private.invite_email_outbox')).toBe(0)
      expect(await scalar(fresh.db, 'select private.invite_email_dispatch()')).toBe(0)
      expect(await scalar(fresh.db, 'select count(*)::int from net.shim_requests')).toBe(0)
    } finally {
      await fresh.close()
    }
  })

  it('switching off empties the outbox and keeps the opt-ins; on again uses them', async () => {
    const w = await seedInvites(t)
    await optIn(w.felix)
    await send(t, w.host, w.occasionId, [w.felix])
    expect(await outboxCount()).toBe(1)
    await t.db.exec("insert into private.invite_email_requests (request_id, items) values (987654, '[]')")
    await t.db.query('select private.set_invite_email_feature(false)')
    try {
      expect(await outboxCount()).toBe(0)
      expect(await scalar(t.db, 'select count(*)::int from private.invite_email_requests')).toBe(0)   // Codex review #7
      expect(await settings(w.felix)).toEqual({ available: false, enabled: true, address: true })
      await due()
      expect(await dispatch()).toBe(0)
    } finally {
      await t.db.query(MAIL_ON)
    }
    expect(await settings(w.felix)).toMatchObject({ available: true, enabled: true })
  })
})

describe('the opt-in: get_invite_email_settings / set_invite_email', () => {
  it('default OFF; on stores de|en (ru / uk -> de) with the consent version; again = new language; off deletes the row', async () => {
    const anna = await createMember(t, 'Anna')
    expect(await settings(anna)).toEqual({ available: true, enabled: false, address: true })
    expect(await optIn(anna, 'ru')).toEqual({ ok: true, enabled: true })
    expect(await rows(t.db, 'select lang, consent from public.invite_email_prefs where profile_id = $1', [anna]))
      .toEqual([{ lang: 'de', consent: CONSENT }])
    await optIn(anna, 'uk')
    expect(await scalar(t.db, 'select lang from public.invite_email_prefs where profile_id = $1', [anna])).toBe('de')
    await optIn(anna, 'en')
    expect(await scalar(t.db, 'select lang from public.invite_email_prefs where profile_id = $1', [anna])).toBe('en')
    expect(await settings(anna)).toEqual({ available: true, enabled: true, address: true })
    expect(await optOut(anna)).toEqual({ ok: true, enabled: false })
    expect(await scalar(t.db, 'select count(*)::int from public.invite_email_prefs where profile_id = $1', [anna])).toBe(0)
    expect(await settings(anna)).toMatchObject({ enabled: false })
  })

  it('checks language, consent version, the current consents and a confirmed address', async () => {
    const anna = await createMember(t, 'Anna')
    await expectRpcError(optIn(anna, 'fr'), 'validation')
    await expectRpcError(optIn(anna, 'de', 'yes'), 'validation')
    await expectRpcError(rpc(t, anna, 'set_invite_email', [null, 'de', CONSENT]), 'validation')
    const noConsent = await createMember(t, 'Nocon', { consents: false })
    await expectRpcError(optIn(noConsent), 'consent_required')
    const unconfirmed = await createMember(t, 'Unbestätigt')
    await t.db.query('update auth.users set email_confirmed_at = null where id = $1', [unconfirmed])
    expect(await settings(unconfirmed)).toEqual({ available: true, enabled: false, address: false })
    await expectRpcError(optIn(unconfirmed), 'no_address')
    const odd = await createMember(t, 'Seltsam')
    await t.db.query(`update auth.users set email = 'kein adresse' where id = $1`, [odd])
    expect(await settings(odd)).toMatchObject({ address: false })
  })

  it('the app learns WHETHER there is an address, never the address', async () => {
    const anna = await createMember(t, 'Anna')
    await optIn(anna)
    const text = JSON.stringify([await settings(anna), await rpc(t, anna, 'export_my_invite_email')])
    expect(text).not.toContain(await emailOf(anna))
    expect(text).not.toContain('@')
  })
})

describe('the outbox trigger: the same work for every invitation, delivered or suppressed, opted in or not', () => {
  it('one id-only row per new invitation row, 5 minutes later — also for a suppressed one and for people who never opted in', async () => {
    const w = await seedInvites(t)
    await execAs(t, w.fabian, `update profiles set invitations_from = 'nobody' where id = $1`, [w.fabian])
    await send(t, w.host, w.occasionId, [w.felix, w.fabian])   // felix: delivered, not opted in; fabian: suppressed
    const invitations = await rows<{ id: string; delivered: boolean }>(t.db,
      'select id, delivered from public.occasion_invitations where occasion_id = $1 order by delivered', [w.occasionId])
    expect(invitations.map((r) => r.delivered)).toEqual([false, true])
    const outbox = await rows<{ invitation_id: string; profile_id: string | null; attempt: number; wait: boolean }>(t.db,
      `select invitation_id, profile_id, attempt, not_before between now() + interval '4 minutes' and now() + interval '6 minutes' as wait
         from private.invite_email_outbox order by id`)
    expect(outbox).toEqual(expect.arrayContaining(invitations.map((r) => ({ invitation_id: r.id, profile_id: null, attempt: 0, wait: true }))))
    expect(outbox).toHaveLength(2)
    expect(await rows(t.db, `select column_name from information_schema.columns where table_schema = 'private' and table_name = 'invite_email_outbox' order by ordinal_position`))
      .toEqual(['id', 'invitation_id', 'profile_id', 'attempt', 'not_before', 'created_at'].map((column_name) => ({ column_name })))
  })

  it('nothing goes before the grace is over (withdrawn within 5 minutes = no mail)', async () => {
    const w = await seedInvites(t)
    await optIn(w.felix)
    await send(t, w.host, w.occasionId, [w.felix])
    expect(await dispatch()).toBe(0)
    expect(await outboxCount()).toBe(1)                     // still waiting
    await withdraw(t, w.host, w.occasionId, w.felix)
    await due()
    expect(await dispatch()).toBe(0)
    expect(await outboxCount()).toBe(0)
    expect(await sentRequests()).toEqual([])
  })
})

describe('dispatch: what goes to the Worker', () => {
  it('a visible invitation of an opted-in person -> one signed batch with address, language and a token — nothing else', async () => {
    const w = await invitedAndOptedIn('en')
    expect(await dispatch()).toBe(1)
    const [request, ...more] = await sentRequests()
    expect(more).toEqual([])
    expect(request!.url).toBe('https://bunprise.de/api/email/send')
    // the Worker's check, done independently here: the "invite-email.v1." prefix keeps push and mail batches apart
    expect(request!.sig).toBe(createHmac('sha256', SECRET).update(`invite-email.v1.${request!.ts}.${request!.payload}`).digest('hex'))
    expect(request!.sig).not.toBe(createHmac('sha256', SECRET).update(`${request!.ts}.${request!.payload}`).digest('hex'))
    expect(Math.abs(Number(request!.ts) - Date.now() / 1000)).toBeLessThan(60)
    const payload = JSON.parse(request!.payload) as { v: number; messages: Message[] }
    expect(payload.v).toBe(1)
    expect(payload.messages).toHaveLength(1)
    const m = payload.messages[0]!
    expect(Object.keys(m).sort()).toEqual(['lang', 'n', 'to', 'token'])
    expect(m).toMatchObject({ n: 1, to: await emailOf(w.felix), lang: 'en' })
    expect(m.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // neutral: no inviter, no host, no title, no date in what leaves the database
    for (const word of ['Hanna', 'Gina', OCCASION_TITLE, 'Gartenweg', 'invitation', w.occasionId, w.host]) {
      expect(request!.payload, word).not.toContain(word)
    }
    // only the token's sha256 is stored; the rate limit is set; the queue is empty
    expect(await rows(t.db, 'select profile_id from public.invite_email_tokens where token_hash = $1', [createHash('sha256').update(m.token).digest()]))
      .toEqual([{ profile_id: w.felix }])
    expect(await scalar(t.db, 'select count(*)::int from private.invite_email_sent where profile_id = $1', [w.felix])).toBe(1)
    expect(await outboxCount()).toBe(0)
    expect(await rows(t.db, 'select items from private.invite_email_requests where request_id = $1', [request!.id]))
      .toEqual([{ items: [expect.objectContaining({ p: w.felix, a: 0 })] }])
    expect(await dispatch()).toBe(0)                         // a second run has nothing to do
  })

  it('NOTHING for: not opted in, opted out, each silent suppression reason, withdrawn, declined, accepted, cancelled, expired, unconfirmed address', async () => {
    const cases: Record<string, () => Promise<void>> = {
      notOptedIn: async () => {
        const w = await seedInvites(t)
        await send(t, w.host, w.occasionId, [w.felix])
      },
      optedOut: async () => {
        const w = await seedInvites(t)
        await optIn(w.felix)
        await send(t, w.host, w.occasionId, [w.felix])
        await optOut(w.felix)
      },
      nobody: async () => {                                   // suppression 3: "Einladungen in Anlässe: Niemand"
        const w = await seedInvites(t)
        await optIn(w.felix)
        await execAs(t, w.felix, `update profiles set invitations_from = 'nobody' where id = $1`, [w.felix])
        await send(t, w.host, w.occasionId, [w.felix])
      },
      blockWithHost: async () => {                            // suppression 1: a guest invites someone the host blocked
        const w = await seedInvites(t, { guestsCanInvite: true })
        await optIn(w.felix)
        await t.db.query('insert into public.blocks (blocker_id, blocked_id) values ($1, $2)', [w.felix, w.host])
        await send(t, w.guest, w.occasionId, [w.felix])
      },
      removedByHost: async () => {                            // suppression 2: removed by the host, a guest invites
        const w = await seedInvites(t, { guestsCanInvite: true })
        await rpc(t, w.felix, 'accept_invite', [w.token])
        await rpc(t, w.host, 'remove_member', [w.occasionId, w.felix])
        await optIn(w.felix)
        await send(t, w.guest, w.occasionId, [w.felix])
      },
      declinedThisOccasion: async () => {                     // suppression 4: refused this occasion before
        const w = await seedInvites(t, { guestsCanInvite: true })
        await send(t, w.host, w.occasionId, [w.felix])
        await respond(t, w.felix, await inboxId(t, w.felix, w.occasionId), false)
        await optIn(w.felix)
        await t.db.exec('delete from private.invite_email_outbox')
        await send(t, w.guest, w.occasionId, [w.felix])
      },
      accepted: async () => {
        const w = await seedInvites(t)
        await optIn(w.felix)
        await send(t, w.host, w.occasionId, [w.felix])
        await respond(t, w.felix, await inboxId(t, w.felix, w.occasionId), true)
      },
      withdrawn: async () => {
        const w = await seedInvites(t)
        await optIn(w.felix)
        await send(t, w.host, w.occasionId, [w.felix])
        await withdraw(t, w.host, w.occasionId, w.felix)
      },
      declined: async () => {
        const w = await seedInvites(t)
        await optIn(w.felix)
        await send(t, w.host, w.occasionId, [w.felix])
        await respond(t, w.felix, await inboxId(t, w.felix, w.occasionId), false)
      },
      cancelled: async () => {
        const w = await seedInvites(t)
        await optIn(w.felix)
        await send(t, w.host, w.occasionId, [w.felix])
        await execAs(t, w.host, 'update occasions set cancelled_at = now() where id = $1', [w.occasionId])
      },
      expired: async () => {
        const w = await seedInvites(t)
        await optIn(w.felix)
        await send(t, w.host, w.occasionId, [w.felix])
        await t.db.query(`update public.occasion_invitations set expires_at = now() - interval '1 minute' where occasion_id = $1`, [w.occasionId])
      },
      unfriended: async () => {
        const w = await seedInvites(t)
        await optIn(w.felix)
        await send(t, w.host, w.occasionId, [w.felix])
        await rpc(t, w.felix, 'unfollow', [w.host])
      },
      unconfirmedAddress: async () => {
        const w = await seedInvites(t)
        await optIn(w.felix)
        await send(t, w.host, w.occasionId, [w.felix])
        await t.db.query('update auth.users set email_confirmed_at = null where id = $1', [w.felix])
      },
    }
    for (const [name, prepare] of Object.entries(cases)) {
      await prepare()
      await due()
      await dispatch()
      expect(await sentRequests(), name).toEqual([])
      expect(await outboxCount(), name).toBe(0)
      // a dropped row leaves no trace: no token, no rate-limit time
      expect(await scalar(t.db, 'select count(*)::int from public.invite_email_tokens'), name).toBe(0)
      expect(await scalar(t.db, 'select count(*)::int from private.invite_email_sent'), name).toBe(0)
    }
  })

  it('the sender\'s cloak: a suppressed invitation changes nothing for the invitee\'s later mails (no delay, no token)', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    await optIn(w.felix)
    // Gina's invitation is suppressed: Felix had "Niemand" at that moment, then "Von Freunden" again
    await execAs(t, w.felix, `update profiles set invitations_from = 'nobody' where id = $1`, [w.felix])
    await send(t, w.guest, w.occasionId, [w.felix])
    await execAs(t, w.felix, `update profiles set invitations_from = 'friends' where id = $1`, [w.felix])
    expect(await scalar(t.db, 'select delivered from public.occasion_invitations where occasion_id = $1', [w.occasionId])).toBe(false)
    expect(await outboxCount()).toBe(1)                     // the sender's work was the same
    await due()
    await dispatch()
    expect(await sentRequests()).toEqual([])
    // the next visible invitation (another host) goes at once, as if the suppressed one never existed
    const other = await createMember(t, 'Otto')
    await friends(t, other, w.felix)
    const o2 = await t.asUser(other, (tx) => scalar<string>(tx,
      `insert into occasions (host_id, title, starts_at, tz) values ($1, 'Spieleabend', now() + interval '9 days', 'Europe/Berlin') returning id`, [other]))
    await send(t, other, o2, [w.felix])
    await due()
    expect(await dispatch()).toBe(1)
    expect(await sentTo()).toEqual([await emailOf(w.felix)])
  })

  it('a suppressed duplicate next to a visible invitation -> exactly one mail', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    await optIn(w.felix)
    await send(t, w.host, w.occasionId, [w.felix])            // delivered, visible
    await send(t, w.guest, w.occasionId, [w.felix])           // suppressed: the delivery slot is taken (reason 6)
    expect((await rows<{ delivered: boolean }>(t.db, 'select delivered from public.occasion_invitations where occasion_id = $1', [w.occasionId]))
      .map((r) => r.delivered).sort()).toEqual([false, true])
    expect(await outboxCount()).toBe(2)
    await due()
    expect(await dispatch()).toBe(1)
    expect(await sentTo()).toEqual([await emailOf(w.felix)])
    expect(await scalar(t.db, 'select count(*)::int from public.invite_email_tokens where profile_id = $1', [w.felix])).toBe(1)
  })

  it('at most one mail per 6 hours: what comes meanwhile waits and goes as ONE mail, only if something is still visible', async () => {
    const w = await invitedAndOptedIn()
    expect(await dispatch()).toBe(1)
    await t.db.exec('delete from net.shim_requests')
    // two more invitations within the gap (two other hosts)
    const hosts = [await createMember(t, 'Otto'), await createMember(t, 'Paula')]
    for (const host of hosts) {
      await friends(t, host, w.felix)
      const o = await t.asUser(host, (tx) => scalar<string>(tx,
        `insert into occasions (host_id, title, starts_at, tz) values ($1, 'Fest', now() + interval '9 days', 'Europe/Berlin') returning id`, [host]))
      await send(t, host, o, [w.felix])
    }
    await due()
    expect(await dispatch()).toBe(0)
    // both wait until last_sent_at + 6 h
    expect(await rows(t.db, `select (not_before - (select last_sent_at from private.invite_email_sent where profile_id = $1)) = interval '6 hours' as ok
                               from private.invite_email_outbox`, [w.felix])).toEqual([{ ok: true }, { ok: true }])
    // the gap is over: ONE mail for both
    await t.db.query(`update private.invite_email_sent set last_sent_at = now() - interval '7 hours' where profile_id = $1`, [w.felix])
    await due()
    expect(await dispatch()).toBe(1)
    expect(await sentTo()).toEqual([await emailOf(w.felix)])
    expect(await outboxCount()).toBe(0)
  })

  it('switching off and on again does not reset the 6 hours (Codex review #3)', async () => {
    const w = await invitedAndOptedIn()
    expect(await dispatch()).toBe(1)
    await t.db.exec('delete from net.shim_requests')
    await optOut(w.felix)
    await optIn(w.felix)
    const otto = await createMember(t, 'Otto')
    await friends(t, otto, w.felix)
    const o = await t.asUser(otto, (tx) => scalar<string>(tx,
      `insert into occasions (host_id, title, starts_at, tz) values ($1, 'Fest', now() + interval '9 days', 'Europe/Berlin') returning id`, [otto]))
    await send(t, otto, o, [w.felix])
    await due()
    expect(await dispatch()).toBe(0)
    expect(await sentRequests()).toEqual([])
    expect(await outboxCount()).toBe(1)                     // waits for the gap
  })

  it('many invisible rows never use up the room of a visible one (Codex review #2)', async () => {
    await t.db.exec(`insert into private.invite_email_outbox (invitation_id, not_before)
                     select gen_random_uuid(), now() - interval '1 minute' from generate_series(1, 600)`)
    const w = await invitedAndOptedIn()
    expect(await dispatch()).toBe(1)
    expect(await sentTo()).toEqual([await emailOf(w.felix)])
    expect(await outboxCount()).toBe(0)
  })

  it('a waiting digest is dropped when nothing in it is visible any more', async () => {
    const w = await invitedAndOptedIn()
    await dispatch()
    await t.db.exec('delete from net.shim_requests')
    const otto = await createMember(t, 'Otto')
    await friends(t, otto, w.felix)
    const o = await t.asUser(otto, (tx) => scalar<string>(tx,
      `insert into occasions (host_id, title, starts_at, tz) values ($1, 'Fest', now() + interval '9 days', 'Europe/Berlin') returning id`, [otto]))
    await send(t, otto, o, [w.felix])
    await due()
    await dispatch()                                          // waits for the gap
    await withdraw(t, otto, o, w.felix)
    await t.db.query(`update private.invite_email_sent set last_sent_at = now() - interval '7 hours' where profile_id = $1`, [w.felix])
    await due()
    expect(await dispatch()).toBe(0)
    expect(await sentRequests()).toEqual([])
    expect(await outboxCount()).toBe(0)
  })

  it('several people at once: batches of at most 10, positions 1..10 per batch', async () => {
    const host = await createMember(t, 'Hanna')
    const occasions: string[] = []
    for (let i = 0; i < 3; i++) {
      occasions.push(await t.asUser(host, (tx) => scalar<string>(tx,
        `insert into occasions (host_id, title, starts_at, tz) values ($1, 'Fest', now() + interval '9 days', 'Europe/Berlin') returning id`, [host])))
    }
    const people: string[] = []
    for (let i = 0; i < 12; i++) {
      const p = await createMember(t, `Gast${i}`)
      await friends(t, host, p)
      await optIn(p)
      people.push(p)
    }
    // 12 recipients: the sender quota is 5 per minute, so three senders' worth by resetting the ledger
    for (let i = 0; i < 12; i += 4) {
      await t.db.query('delete from public.invitation_attempts where sender_id = $1', [host])
      await send(t, host, occasions[i / 4]!, people.slice(i, i + 4))
    }
    await due()
    expect(await dispatch()).toBe(12)
    const requests = await sentRequests()
    expect(requests.map((r) => r.messages.map((m) => m.n))).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2]])
    expect(new Set(requests.flatMap((r) => r.messages.map((m) => m.to))).size).toBe(12)
  })

  it('nothing without the Vault secret (rows wait, are dropped after 8 days)', async () => {
    await invitedAndOptedIn()
    await t.db.exec(`delete from vault.shim_secrets where name = 'push_dispatch_secret'`)
    try {
      expect(await dispatch()).toBe(0)
      expect(await sentRequests()).toEqual([])
      expect(await outboxCount()).toBe(1)
      await t.db.exec(`update private.invite_email_outbox set created_at = now() - interval '9 days'`)
      await dispatch()
      expect(await outboxCount()).toBe(0)
    } finally {
      await t.db.exec(VAULT)
    }
  })
})

describe('the Worker\'s answers (invite_email_collect)', () => {
  async function oneMail() {
    const w = await invitedAndOptedIn()
    await dispatch()
    const [request] = await sentRequests()
    await t.db.exec('delete from net.shim_requests')
    return { w, request: request! }
  }

  it('retry [n] -> the same person once more (no 6-hour wait, a fresh token), at most three attempts in all', async () => {
    const { w, request } = await oneMail()
    await answer(request.id, 200, JSON.stringify({ retry: [1], sent: 0, failed: 0 }))
    await dispatch()
    expect(await rows(t.db, 'select profile_id, attempt, invitation_id from private.invite_email_outbox'))
      .toEqual([{ profile_id: w.felix, attempt: 1, invitation_id: null }])
    expect(await scalar(t.db, 'select count(*)::int from private.invite_email_requests')).toBe(0)
    await due()
    expect(await dispatch()).toBe(1)
    const [second] = await sentRequests()
    expect(second!.messages[0]!.to).toBe(await emailOf(w.felix))
    expect(second!.messages[0]!.token).not.toBe(JSON.parse(request.payload).messages[0].token)
    await t.db.exec('delete from net.shim_requests')
    await answer(second!.id, 200, JSON.stringify({ retry: [1] }))
    await dispatch()
    expect(await rows(t.db, 'select attempt from private.invite_email_outbox')).toEqual([{ attempt: 2 }])
    await due()
    await dispatch()
    const [third] = await sentRequests()
    await answer(third!.id, 200, JSON.stringify({ retry: [1] }))
    await dispatch()
    expect(await outboxCount()).toBe(0)                     // three attempts in all
  })

  it('the retry window counts from the FIRST attempt, not from the invitation (Codex review #6)', async () => {
    const w = await seedInvites(t)
    await optIn(w.felix)
    await send(t, w.host, w.occasionId, [w.felix])
    // the database was paused for two days: the invitation's row is old when its first mail is tried
    await t.db.exec(`update private.invite_email_outbox set created_at = now() - interval '2 days', not_before = now() - interval '1 second'`)
    expect(await dispatch()).toBe(1)
    const [request] = await sentRequests()
    await answer(request!.id, 503, null)
    await dispatch()
    expect(await rows(t.db, 'select profile_id, attempt from private.invite_email_outbox')).toEqual([{ profile_id: w.felix, attempt: 1 }])
  })

  it('a retry is dropped when the person opted out or sees nothing any more', async () => {
    const a = await oneMail()
    await answer(a.request.id, 200, JSON.stringify({ retry: [1] }))
    await optOut(a.w.felix)
    await dispatch()
    expect(await outboxCount()).toBe(0)                     // not even queued

    const b = await oneMail()
    await answer(b.request.id, 200, JSON.stringify({ retry: [1] }))
    await dispatch()
    expect(await outboxCount()).toBe(1)
    await withdraw(t, b.w.host, b.w.occasionId, b.w.felix)
    await due()
    expect(await dispatch()).toBe(0)
    expect(await sentRequests()).toEqual([])
  })

  it('timeout / 5xx / no answer in 10 minutes -> once more; 501 (no Brevo key), 401, 400, garbage -> never', async () => {
    for (const [status, content, retried] of [
      [null, null, true], [503, 'busy', true], [429, null, true], [520, null, true], [524, null, true], [500, null, true],
      [501, '{"error":"not_available"}', false], [401, null, false], [400, null, false], [200, 'not json', false], [200, '{"retry":"x"}', false],
    ] as const) {
      const { request } = await oneMail()
      await answer(request.id, status, content)
      await dispatch()
      expect(await outboxCount(), `${status} ${content}`).toBe(retried ? 1 : 0)
      await t.db.exec('delete from private.invite_email_outbox')
    }
    const { request } = await oneMail()
    await t.db.query(`update private.invite_email_requests set sent_at = now() - interval '11 minutes' where request_id = $1`, [request.id])
    await dispatch()
    expect(await outboxCount()).toBe(1)
  })
})

describe('unsubscribe without sign-in (public.invite_email_unsubscribe, anon)', () => {
  async function tokenFor() {
    const w = await invitedAndOptedIn()
    await dispatch()
    const [m] = await sentMessages()
    return { w, token: m!.token }
  }

  it('the token of a mail switches the e-mails off; a second click is ok too; switching on again keeps old links working', async () => {
    const { w, token } = await tokenFor()
    expect(await unsubscribe(token)).toEqual({ ok: true })
    expect(await settings(w.felix)).toMatchObject({ enabled: false })
    expect(await unsubscribe(token)).toEqual({ ok: true })
    await optIn(w.felix)
    expect(await unsubscribe(token)).toEqual({ ok: true })
    expect(await settings(w.felix)).toMatchObject({ enabled: false })
  })

  it('unknown, malformed, null and 90-day-old tokens: null, nothing changes', async () => {
    const { w, token } = await tokenFor()
    await optIn(w.felix)
    for (const bad of [null, '', 'x', `${token}x`, token.slice(1), 'A'.repeat(43), `${token.slice(0, 42)}!`, "' or 1=1 --"]) {
      expect(await unsubscribe(bad), String(bad)).toBeNull()
    }
    await t.db.query(`update public.invite_email_tokens set created_at = now() - interval '91 days'`)
    expect(await unsubscribe(token)).toBeNull()
    expect(await settings(w.felix)).toMatchObject({ enabled: true })
  })

  it('refuses a read-only transaction; authenticated and PUBLIC cannot call it; anon calls nothing else of it', async () => {
    const { w, token } = await tokenFor()
    await expectDbError(t.asAnon(async (tx) => {
      await tx.exec('set transaction read only')
      return tx.query('select public.invite_email_unsubscribe($1)', [token])
    }), 'P0001')
    await expectDbError(t.asUser(w.felix, (tx) => tx.query('select public.invite_email_unsubscribe($1)', [token])), '42501')
    const can = (role: string, fn: string) => scalar<boolean>(t.db, `select has_function_privilege($1, $2, 'execute')`, [role, fn])
    expect(await can('anon', 'public.invite_email_unsubscribe(text)')).toBe(true)
    expect(await can('authenticated', 'public.invite_email_unsubscribe(text)')).toBe(false)
    expect(await can('public', 'public.invite_email_unsubscribe(text)')).toBe(false)
    for (const fn of ['public.get_invite_email_settings()', 'public.set_invite_email(boolean,text,text)', 'public.export_my_invite_email()']) {
      expect(await can('anon', fn), fn).toBe(false)
      expect(await can('authenticated', fn), fn).toBe(true)
    }
  })
})

describe('purge, export, deletion', () => {
  it('purge_invite_email removes tokens after 90 days and old queue rows', async () => {
    await invitedAndOptedIn()
    await dispatch()
    await t.db.exec(`update public.invite_email_tokens set created_at = now() - interval '91 days';
                     update private.invite_email_sent set last_sent_at = now() - interval '8 days';
                     insert into private.invite_email_outbox (invitation_id, created_at) values (gen_random_uuid(), now() - interval '9 days');
                     update private.invite_email_requests set sent_at = now() - interval '2 hours'`)
    await t.db.query('select private.purge_invite_email()')
    expect(await scalar(t.db, 'select count(*)::int from public.invite_email_tokens')).toBe(0)
    expect(await outboxCount()).toBe(0)
    expect(await scalar(t.db, 'select count(*)::int from private.invite_email_requests')).toBe(0)
    expect(await scalar(t.db, 'select count(*)::int from private.invite_email_sent')).toBe(0)
  })

  it('export_my_invite_email: my choice, language, consent, times and the number of working links — no hashes, no address', async () => {
    const anna = await createMember(t, 'Anna')
    expect(await rpc(t, anna, 'export_my_invite_email')).toEqual({
      enabled: false, lang: null, consent: null, enabled_at: null, last_sent_at: null, unsubscribe_links: 0,
    })
    const w = await invitedAndOptedIn('en')
    await dispatch()
    const out = await rpc<Record<string, unknown>>(t, w.felix, 'export_my_invite_email')
    expect(Object.keys(out).sort()).toEqual(['consent', 'enabled', 'enabled_at', 'lang', 'last_sent_at', 'unsubscribe_links'])
    expect(out).toMatchObject({ enabled: true, lang: 'en', consent: CONSENT, unsubscribe_links: 1 })
    expect(out.last_sent_at).not.toBeNull()
  })

  it('account deletion removes the opt-in, the tokens and the person\'s retries', async () => {
    const w = await invitedAndOptedIn()
    await dispatch()
    const [request] = await sentRequests()
    await answer(request!.id, 503, null)
    await dispatch()
    expect(await outboxCount()).toBe(1)
    await rpc(t, w.felix, 'delete_my_account')
    for (const table of ['public.invite_email_prefs', 'public.invite_email_tokens', 'private.invite_email_sent']) {
      expect(await scalar(t.db, `select count(*)::int from ${table} where profile_id = $1`, [w.felix]), table).toBe(0)
    }
    // the retry row has no foreign key (Codex review #1: no deadlock with the deletion): the next run drops it unsent
    expect(await outboxCount()).toBe(1)
    await t.db.exec('delete from net.shim_requests')
    await due()
    expect(await dispatch()).toBe(0)
    expect(await outboxCount()).toBe(0)
    expect(await sentRequests()).toEqual([])
  })
})

describe('🔒 the secrecy of reservations', () => {
  it('twin worlds: the mail batch is identical (but for the address and the random token) whether lists are reserved or not', async () => {
    async function world(reserved: boolean) {
      const w = await seedInvites(t)
      const list = await createList(t, w.felix, 'Felix wünscht sich', { visibility: 'followers' })
      const felixWish = await addWish(t, w.felix, list, 'Kopfhörer')
      if (reserved) {
        await rpc(t, w.host, 'reserve_wish', [felixWish])        // on the INVITEE's own list
        await rpc(t, w.guest, 'reserve_wish', [w.wish1])         // on the HOST's occasion list
        await rpc(t, w.guest, 'reserve_wish', [w.wish2])
        await rpc(t, w.guest, 'cancel_reservation', [w.wish2])
      }
      await optIn(w.felix)
      await send(t, w.host, w.occasionId, [w.felix])
      return emailOf(w.felix)
    }
    const withReservations = await world(true)
    const without = await world(false)
    expect(await scalar(t.db, 'select count(*)::int from public.reservations')).toBeGreaterThan(0)
    await due()
    expect(await dispatch()).toBe(2)
    const messages = await sentMessages()
    const strip = (m: Message | undefined) => (m ? { ...m, n: 0, to: '<to>', token: '<token>' } : m)
    const a = strip(messages.find((m) => m.to === withReservations))
    const b = strip(messages.find((m) => m.to === without))
    expect(a).toBeDefined()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('the owner\'s view is unchanged: the host\'s occasion screen is the same before and after the invitee\'s mail', async () => {
    const w = await seedInvites(t)
    await optIn(w.felix)
    await send(t, w.host, w.occasionId, [w.felix])
    const before = await rpc(t, w.host, 'get_occasion_screen', [w.occasionId])
    await due()
    expect(await dispatch()).toBe(1)
    expect(await rpc(t, w.host, 'get_occasion_screen', [w.occasionId])).toEqual(before)
  })

  it('no invitation e-mail function reads or writes wishes, wishlists or reservations (source meta-test)', async () => {
    const fns = await rows<{ fn: string; src: string }>(t.db,
      `select n.nspname || '.' || p.proname as fn, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.proname like '%invite_email%'
        order by 1`)
    expect(fns.map((f) => f.fn)).toEqual([
      'private.invite_email_address', 'private.invite_email_collect', 'private.invite_email_dispatch', 'private.invite_email_enqueue',
      'private.invite_email_has_visible', 'private.invite_email_on', 'private.invite_email_requeue', 'private.purge_invite_email',
      'private.set_invite_email_feature',
      'public.export_my_invite_email', 'public.get_invite_email_settings', 'public.invite_email_unsubscribe', 'public.set_invite_email',
    ])
    for (const f of fns) expect(f.src.toLowerCase(), f.fn).not.toMatch(/reserv|wish/)
  })
})

describe('privileges', () => {
  it('no REST access to the new tables for anon / authenticated', async () => {
    const anna = await createMember(t, 'Anna')
    for (const table of ['public.invite_email_prefs', 'public.invite_email_tokens', 'private.invite_email_outbox',
      'private.invite_email_requests', 'private.invite_email_config', 'private.invite_email_sent']) {
      await expectDbError(t.asUser(anna, (tx) => tx.query(`select * from ${table}`)), '42501')
      await expectDbError(t.asAnon((tx) => tx.query(`select * from ${table}`)), '42501')
    }
    await expectDbError(t.asUser(anna, (tx) => tx.query(
      `insert into public.invite_email_prefs (profile_id, lang, consent) values ($1, 'de', $2)`, [anna, CONSENT])), '42501')
  })

  it('dispatch, collect, purge, the switch and every helper are for nobody', async () => {
    const anna = await createMember(t, 'Anna')
    for (const call of ['private.invite_email_dispatch()', 'private.invite_email_collect()', 'private.purge_invite_email()',
      'private.set_invite_email_feature(true)', 'private.invite_email_on()', `private.invite_email_address('${anna}')`,
      `private.invite_email_has_visible('${anna}')`]) {
      await expectDbError(t.asUser(anna, (tx) => tx.query(`select ${call}`)), '42501')
    }
  })
})

it('the Worker endpoint, the defaults and the secret name are where the handoff says', async () => {
  expect(await rows(t.db, `select dispatch_url, grace = interval '5 minutes' as grace, min_gap = interval '6 hours' as gap from private.invite_email_config`))
    .toEqual([{ dispatch_url: 'https://bunprise.de/api/email/send', grace: true, gap: true }])
})
