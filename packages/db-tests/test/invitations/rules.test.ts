/**
 * In-app invitations — the rules of docs/spec/in-app-invites-design.md §2 (who invites whom, the lifecycle, the
 * invitee's view, quotas) on PGlite. The sender's cloak (IP1) and the secrecy of reservations (IS1–IS8) have their
 * own files; races run on real PostgreSQL (test/concurrency/invitations.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, scalar, type TestDb } from '../../src/harness'
import { createMember, execAs, expectRpcError, giveConsents, rpc } from '../pilot/seed'
import {
  OCCASION_TITLE,
  allowGuests,
  candidates,
  countRows,
  createOccasion,
  dot,
  friends,
  inbox,
  inboxId,
  inviteInfo,
  outcomeText,
  resetQuota,
  respond,
  rowOf,
  seedInvites,
  send,
  sentList,
  withdraw,
  type InviteWorld,
  SWITCH_ON,
} from './seed'

let t: TestDb
beforeAll(async () => {
  // the feature ships switched off (20261027120000 header): these tests are about the released feature
  t = await createTestDb({ extraSql: [SWITCH_ON] })
})
afterAll(() => t.close())

const names = (list: { profile: { display_name: string | null } }[]) => list.map((c) => c.profile.display_name)
const UNKNOWN = '00000000-0000-4000-8000-000000000000'

describe('who may invite (§2.1)', () => {
  it('the host always: candidates are the host\'s friends who are not members, by name', async () => {
    const w = await seedInvites(t)
    expect(names(await candidates(t, w.host, w.occasionId))).toEqual(['Fabian', 'Felix'])
    expect(await inviteInfo(t, w.host, w.occasionId)).toEqual({ guests_can_invite: false, can_invite: true, invited_by: [] })
  })

  it('a guest only while the host switched "Gäste dürfen Freunde einladen" on (default off)', async () => {
    const w = await seedInvites(t)
    expect(await inviteInfo(t, w.guest, w.occasionId)).toEqual({ guests_can_invite: false, can_invite: false, invited_by: [] })
    await expectRpcError(candidates(t, w.guest, w.occasionId), 'not_found')
    await expectRpcError(send(t, w.guest, w.occasionId, [w.frida]), 'not_found')
    await expectRpcError(rpc(t, w.guest, 'get_sent_invitations', [w.occasionId]), 'not_found')
    // only the host can switch it (REST, policy occasions_update)
    expect(await execAs(t, w.guest, 'update occasions set guests_can_invite = true where id = $1', [w.occasionId])).toBe(0)
    expect(await allowGuests(t, w, true)).toBe(1)
    expect(await inviteInfo(t, w.guest, w.occasionId)).toEqual({ guests_can_invite: true, can_invite: true, invited_by: [] })
    expect(names(await candidates(t, w.guest, w.occasionId))).toEqual(['Felix', 'Frida'])
  })

  it('a former guest, an outsider, a pending invitee, an unknown or a null occasion: one answer, not_found', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    await rpc(t, w.guest, 'leave_occasion', [w.occasionId])
    for (const [uid, occ] of [[w.guest, w.occasionId], [w.xaver, w.occasionId], [w.felix, w.occasionId], [w.host, UNKNOWN], [w.host, null]] as const) {
      await expectRpcError(candidates(t, uid, occ as string), 'not_found')
      await expectRpcError(send(t, uid, occ as string, [w.frida]), 'not_found')
      await expectRpcError(rpc(t, uid, 'get_occasion_invite_info', [occ]), 'not_found')
    }
  })

  it('not into a cancelled occasion and not after the start (an all-day one: after its local day)', async () => {
    const w = await seedInvites(t)
    await execAs(t, w.host, 'update occasions set cancelled_at = now() where id = $1', [w.occasionId])
    await expectRpcError(candidates(t, w.host, w.occasionId), 'not_found')
    await expectRpcError(send(t, w.host, w.occasionId, [w.felix]), 'not_found')
    expect((await inviteInfo(t, w.host, w.occasionId)).can_invite).toBe(false)

    const host = await createMember(t, 'Hilde')
    const friend = await createMember(t, 'Ferdi')
    await friends(t, host, friend)
    const today = await createOccasion(t, host, { startsInDays: 0, allDay: true }) // today, all day: open until midnight
    expect(names(await candidates(t, host, today.occasionId))).toEqual(['Ferdi'])
    const started = await createOccasion(t, host, { startsInDays: -1 }) // yesterday 18:00
    await expectRpcError(candidates(t, host, started.occasionId), 'not_found')
  })
})

describe('candidates (§2.2): friends only, never a probe of somebody else\'s relations', () => {
  it('no one-way follower, no one-way followee, no pending request, no blocked friend, no member, never myself', async () => {
    const w = await seedInvites(t)
    const pending = await createMember(t, 'Paul')
    await t.db.query(`insert into public.follows (follower_id, followee_id, status, expires_at) values ($1, $2, 'pending', now() + interval '30 days')`, [pending, w.host])
    await t.db.query(`insert into public.follows (follower_id, followee_id, status, accepted_at) values ($1, $2, 'accepted', now())`, [w.host, pending])
    const followee = await createMember(t, 'Ida')
    await t.db.query(`insert into public.follows (follower_id, followee_id, status, accepted_at) values ($1, $2, 'accepted', now())`, [w.host, followee])
    expect(names(await candidates(t, w.host, w.occasionId))).toEqual(['Fabian', 'Felix'])
    await rpc(t, w.host, 'block_user', [w.fabian])
    expect(names(await candidates(t, w.host, w.occasionId))).toEqual(['Felix'])
    // a member is no candidate; after leaving, a friend is one again
    await rpc(t, w.felix, 'accept_invite', [w.token])
    expect(names(await candidates(t, w.host, w.occasionId))).toEqual([])
    await rpc(t, w.felix, 'leave_occasion', [w.occasionId])
    expect(names(await candidates(t, w.host, w.occasionId))).toEqual(['Felix'])
  })

  it('a candidate card: id, name, banner and the photo meta; state none → invited → withdrawn with the expiry', async () => {
    const w = await seedInvites(t)
    const [first] = await candidates(t, w.host, w.occasionId)
    expect(first).toEqual({
      profile: { id: w.fabian, display_name: 'Fabian', banner: null, photo: null, banner_photo: null },
      state: 'none',
      expires_at: null,
    })
    const [answer] = await send(t, w.host, w.occasionId, [w.fabian])
    let c = (await candidates(t, w.host, w.occasionId)).find((x) => x.profile.id === w.fabian)!
    expect(c).toMatchObject({ state: 'invited', expires_at: answer!.expires_at })
    expect(await withdraw(t, w.host, w.occasionId, w.fabian)).toEqual({ ok: true })
    c = (await candidates(t, w.host, w.occasionId)).find((x) => x.profile.id === w.fabian)!
    expect(c).toMatchObject({ state: 'withdrawn', expires_at: answer!.expires_at })
  })
})

describe('send (§2.6)', () => {
  it('validates the list first: empty, more than 10, a null id', async () => {
    const w = await seedInvites(t)
    const eleven = await Promise.all(Array.from({ length: 11 }, (_, i) => createMember(t, `Elf${i}`)))
    await expectRpcError(send(t, w.host, w.occasionId, []), 'validation')
    await expectRpcError(send(t, w.host, w.occasionId, eleven), 'validation')
    await expectRpcError(rpc(t, w.host, 'send_occasion_invites', [w.occasionId, null]), 'validation')
    await expectRpcError(t.asUser(w.host, (tx) => scalar(tx, 'select public.send_occasion_invites($1, array[$2::uuid, null])', [w.occasionId, w.felix])), 'validation')
  })

  it('one non-candidate makes the whole call not_found and writes nothing (not even an attempt)', async () => {
    const w = await seedInvites(t)
    for (const bad of [w.olga, w.xaver, w.guest, w.host, UNKNOWN]) {
      await expectRpcError(send(t, w.host, w.occasionId, [w.felix, bad]), 'not_found')
    }
    expect(await countRows(t, 'occasion_invitations', 'inviter_id = $1', [w.host])).toBe(0)
    expect(await countRows(t, 'invitation_attempts', 'sender_id = $1', [w.host])).toBe(0)
  })

  it('answers the sender projection per id (sorted); a repeat is idempotent: same answer, no new attempt', async () => {
    const w = await seedInvites(t)
    const first = await send(t, w.host, w.occasionId, [w.felix, w.fabian])
    expect(first.map((x) => x.profile_id)).toEqual([w.felix, w.fabian].sort())
    for (const a of first) expect(a).toEqual({ profile_id: a.profile_id, state: 'invited', expires_at: expect.any(String) })
    expect(await countRows(t, 'invitation_attempts', 'sender_id = $1', [w.host])).toBe(2)
    expect(await send(t, w.host, w.occasionId, [w.fabian, w.felix])).toEqual(first)
    expect(await countRows(t, 'invitation_attempts', 'sender_id = $1', [w.host])).toBe(2)
  })

  it('expires after 7 days, never after the start; an all-day occasion: the end of its local day', async () => {
    const w = await seedInvites(t, { startsInDays: 20 })
    const [far] = await send(t, w.host, w.occasionId, [w.felix])
    const sevenDays = await scalar<number>(t.db, `select extract(epoch from ($1::timestamptz - now()))::int`, [far!.expires_at])
    expect(Math.abs(sevenDays - 7 * 86400)).toBeLessThan(120)

    const soon = await createOccasion(t, w.host, { startsInDays: 3 })
    const [near] = await send(t, w.host, soon.occasionId, [w.fabian])
    expect(await scalar<boolean>(t.db, `select $1::timestamptz = starts_at from occasions where id = $2`, [near!.expires_at, soon.occasionId])).toBe(true)

    const allDay = await createOccasion(t, w.host, { startsInDays: 2, allDay: true })
    await resetQuota(t, w.host)
    const [day] = await send(t, w.host, allDay.occasionId, [w.fabian])
    expect(
      await scalar<boolean>(
        t.db,
        `select $1::timestamptz = (((starts_at at time zone tz)::date + 1)::timestamp at time zone tz) from occasions where id = $2`,
        [day!.expires_at, allDay.occasionId],
      ),
    ).toBe(true)
  })

  it('needs the current consents and a name (sending widens processing)', async () => {
    const w = await seedInvites(t)
    // a host without current consents (a new legal version for everybody would affect the file: drop theirs instead)
    await t.db.query(`delete from public.consents where profile_id = $1`, [w.host])
    await expectRpcError(send(t, w.host, w.occasionId, [w.felix]), 'consent_required')
    await giveConsents(t, w.host)
    await t.db.query(`update public.profiles set display_name = null where id = $1`, [w.host])
    await expectRpcError(send(t, w.host, w.occasionId, [w.felix]), 'profile_incomplete')
    await t.db.query(`update public.profiles set display_name = 'Hanna' where id = $1`, [w.host])
    expect(await send(t, w.host, w.occasionId, [w.felix])).toHaveLength(1)
  })
})

describe('the invitee (§2.5, §3.1)', () => {
  it('sees title, day and time, the host\'s NAME only, the inviter\'s card and the expiry — the dot counts it', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    expect(await dot(t, w.frida)).toBe(0)
    const [answer] = await send(t, w.guest, w.occasionId, [w.frida])
    const list = await inbox(t, w.frida)
    expect(list).toHaveLength(1)
    const inv = list[0]!
    expect(Object.keys(inv).sort()).toEqual(['created_at', 'expires_at', 'from_host', 'host_name', 'id', 'inviter', 'occasion'])
    expect(Object.keys(inv.occasion).sort()).toEqual(['all_day', 'id', 'starts_at', 'title', 'tz'])
    expect(inv).toMatchObject({
      occasion: { id: w.occasionId, title: OCCASION_TITLE, tz: 'Europe/Berlin', all_day: false },
      host_name: 'Hanna',
      from_host: false,
      inviter: { id: w.guest, display_name: 'Gina' },
      expires_at: answer!.expires_at,
    })
    // never the host's id, the place, the description, the guests, the list
    const text = JSON.stringify(list)
    for (const secret of [w.host, 'Gartenweg', 'gute Laune', w.listId, w.wish1, 'Grillzange']) expect(text).not.toContain(secret)
    expect(await dot(t, w.frida)).toBe(1)
  })

  it('accept: a normal membership (member, rsvp none); the feed shows it; the inbox and the dot are empty; once only', async () => {
    const w = await seedInvites(t)
    await send(t, w.host, w.occasionId, [w.felix])
    const id = await inboxId(t, w.felix, w.occasionId)
    expect(await respond(t, w.felix, id, true)).toEqual({ occasion_id: w.occasionId })
    expect(await scalar(t.db, 'select role || rsvp || status from occasion_members where occasion_id = $1 and profile_id = $2', [w.occasionId, w.felix])).toBe('membernoneactive')
    const feed = await rpc<{ upcoming: { id: string }[] }>(t, w.felix, 'get_feed')
    expect(feed.upcoming.map((x) => x.id)).toContain(w.occasionId)
    expect(await inbox(t, w.felix)).toEqual([])
    expect(await dot(t, w.felix)).toBe(0)
    await expectRpcError(respond(t, w.felix, id, true), 'invite_invalid')
    await expectRpcError(respond(t, w.felix, id, false), 'invite_invalid')
    expect((await rowOf(t, w.occasionId, w.host, w.felix))!).toMatchObject({ outcome: 'accepted', live: false })
  })

  it('accept needs the current consents and a name; declining needs neither', async () => {
    const w = await seedInvites(t)
    await send(t, w.host, w.occasionId, [w.felix, w.fabian])
    const felixId = await inboxId(t, w.felix, w.occasionId)
    const fabianId = await inboxId(t, w.fabian, w.occasionId)
    await t.db.query(`delete from public.consents where profile_id in ($1, $2)`, [w.felix, w.fabian])
    await expectRpcError(respond(t, w.felix, felixId, true), 'consent_required')
    expect(await respond(t, w.fabian, fabianId, false)).toEqual({ ok: true })
    await giveConsents(t, w.felix)
    await t.db.query(`update public.profiles set display_name = null where id = $1`, [w.felix])
    await expectRpcError(respond(t, w.felix, felixId, true), 'profile_incomplete')
    // a consent-less caller learns nothing about an invitation id (consents are checked first)
    await t.db.query(`delete from public.consents where profile_id = $1`, [w.felix])
    await expectRpcError(respond(t, w.felix, UNKNOWN, true), 'consent_required')
  })

  it('somebody else\'s, an unknown, a null invitation: one answer, invite_invalid; a null decision: validation', async () => {
    const w = await seedInvites(t)
    await send(t, w.host, w.occasionId, [w.felix])
    const id = await inboxId(t, w.felix, w.occasionId)
    for (const [uid, inv] of [[w.fabian, id], [w.host, id], [w.felix, UNKNOWN], [w.felix, null]] as const) {
      await expectRpcError(respond(t, uid, inv as string, true), 'invite_invalid')
      await expectRpcError(respond(t, uid, inv as string, false), 'invite_invalid')
    }
    await expectRpcError(rpc(t, w.felix, 'respond_occasion_invite', [id, null]), 'validation')
    expect(await inbox(t, w.felix)).toHaveLength(1)
  })

  it('decline: silent; this occasion stays closed for the decliner; that sender is silent for 30 days everywhere', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    const other = await createOccasion(t, w.guest, { title: 'Spieleabend' })
    const third = await createOccasion(t, w.guest, { title: 'Kino' })
    await send(t, w.guest, other.occasionId, [w.frida]) // delivered before the decline: stays
    await send(t, w.guest, w.occasionId, [w.frida])
    const id = await inboxId(t, w.frida, w.occasionId)
    expect(await respond(t, w.frida, id, false)).toEqual({ ok: true })
    expect((await inbox(t, w.frida)).map((x) => x.occasion.title)).toEqual(['Spieleabend'])
    expect(await countRows(t, 'occasion_invite_refusals', 'occasion_id = $1 and invitee_id = $2', [w.occasionId, w.frida])).toBe(1)
    expect(
      await scalar<boolean>(t.db, `select until > now() + interval '29 days' from public.invitation_cooldowns where invitee_id = $1 and inviter_id = $2`, [w.frida, w.guest]),
    ).toBe(true)
    // the host (a friend now) invites Frida into the same occasion: suppressed (the occasion is closed for her)
    await friends(t, w.host, w.frida)
    expect(await send(t, w.host, w.occasionId, [w.frida])).toEqual([{ profile_id: w.frida, state: 'invited', expires_at: expect.any(String) }])
    expect((await rowOf(t, w.occasionId, w.host, w.frida))!.delivered).toBe(false)
    // Gina into a third occasion: suppressed (30 days of silence)
    await send(t, w.guest, third.occasionId, [w.frida])
    expect((await rowOf(t, third.occasionId, w.guest, w.frida))!.delivered).toBe(false)
    expect((await inbox(t, w.frida)).map((x) => x.occasion.title)).toEqual(['Spieleabend'])
    // a block and an unblock do not shorten the silence (INV-6)
    await rpc(t, w.frida, 'block_user', [w.guest])
    await rpc(t, w.frida, 'unblock_user', [w.guest])
    expect(await countRows(t, 'invitation_cooldowns', 'invitee_id = $1 and inviter_id = $2', [w.frida, w.guest])).toBe(1)
    // ignoring changes nothing: an unanswered invitation stays as it is
  })
})

describe('the host removes somebody (IP7, Codex B #1)', () => {
  it('an old invitation of the host dies with the link join + removal; only a later one brings the person back', async () => {
    const w = await seedInvites(t)
    await send(t, w.host, w.occasionId, [w.felix])
    const oldId = await inboxId(t, w.felix, w.occasionId)
    await rpc(t, w.felix, 'accept_invite', [w.token]) // joins by the link instead
    expect(await inbox(t, w.felix)).toEqual([])
    expect((await rowOf(t, w.occasionId, w.host, w.felix))!.outcome).toBe('void')
    await rpc(t, w.host, 'remove_member', [w.occasionId, w.felix])
    await expectRpcError(respond(t, w.felix, oldId, true), 'invite_invalid')
    expect(await scalar(t.db, 'select status from occasion_members where occasion_id = $1 and profile_id = $2', [w.occasionId, w.felix])).toBe('removed')
    // the host invites again after the removal: delivered, visible, accepted
    await resetQuota(t, w.host)
    await t.db.query(`update public.occasion_invitations set live = false where occasion_id = $1 and invitee_id = $2`, [w.occasionId, w.felix])
    await send(t, w.host, w.occasionId, [w.felix])
    const newId = await inboxId(t, w.felix, w.occasionId)
    expect(await respond(t, w.felix, newId, true)).toEqual({ occasion_id: w.occasionId })
    expect(await scalar(t.db, 'select status from occasion_members where occasion_id = $1 and profile_id = $2', [w.occasionId, w.felix])).toBe('active')
  })

  it('a pending invitation of the host to a person the host then removes (after a link join) is void', async () => {
    const w = await seedInvites(t)
    await rpc(t, w.felix, 'accept_invite', [w.token])
    await rpc(t, w.host, 'remove_member', [w.occasionId, w.felix])
    // a guest cannot bring a removed person back: silently suppressed
    await allowGuests(t, w, true)
    expect(await send(t, w.guest, w.occasionId, [w.felix])).toEqual([{ profile_id: w.felix, state: 'invited', expires_at: expect.any(String) }])
    expect((await rowOf(t, w.occasionId, w.guest, w.felix))!.delivered).toBe(false)
    expect(await inbox(t, w.felix)).toEqual([])
  })
})

describe('void is terminal (IP6, Codex B #6): nothing comes back', () => {
  async function pendingWorld() {
    const w = await seedInvites(t, { guestsCanInvite: true })
    await send(t, w.host, w.occasionId, [w.fabian])
    await send(t, w.guest, w.occasionId, [w.frida])
    expect(await dot(t, w.fabian)).toBe(1)
    expect(await dot(t, w.frida)).toBe(1)
    return w
  }
  const outcome = async (w: InviteWorld, inviter: string, invitee: string) => (await rowOf(t, w.occasionId, inviter, invitee))!.outcome

  it('cancelled → void; the cancellation undone → still void', async () => {
    const w = await pendingWorld()
    await execAs(t, w.host, 'update occasions set cancelled_at = now() where id = $1', [w.occasionId])
    expect(await dot(t, w.fabian)).toBe(0)
    await execAs(t, w.host, 'update occasions set cancelled_at = null where id = $1', [w.occasionId])
    expect(await dot(t, w.fabian)).toBe(0)
    expect(await outcome(w, w.host, w.fabian)).toBe('void')
    expect(await outcome(w, w.guest, w.frida)).toBe('void')
  })

  it('the date moves: the expiry only shrinks; into the past → void; back again → still void', async () => {
    const w = await pendingWorld()
    const before = (await rowOf(t, w.occasionId, w.host, w.fabian))!.expires_at
    await execAs(t, w.host, `update occasions set starts_at = now() + interval '2 days' where id = $1`, [w.occasionId])
    const shrunk = (await rowOf(t, w.occasionId, w.host, w.fabian))!.expires_at
    expect(new Date(shrunk).getTime()).toBeLessThan(new Date(before).getTime())
    await execAs(t, w.host, `update occasions set starts_at = now() + interval '30 days' where id = $1`, [w.occasionId])
    expect((await rowOf(t, w.occasionId, w.host, w.fabian))!.expires_at).toBe(shrunk) // never grows
    expect(await dot(t, w.fabian)).toBe(1)
    await execAs(t, w.host, `update occasions set starts_at = now() - interval '1 hour' where id = $1`, [w.occasionId])
    expect(await outcome(w, w.host, w.fabian)).toBe('void')
    await execAs(t, w.host, `update occasions set starts_at = now() + interval '30 days' where id = $1`, [w.occasionId])
    expect(await dot(t, w.fabian)).toBe(0)
    expect(await outcome(w, w.host, w.fabian)).toBe('void')
  })

  it('"Gäste dürfen einladen" off → the guests\' invitations are void (the host\'s stay); on again → still void', async () => {
    const w = await pendingWorld()
    await allowGuests(t, w, false)
    expect(await outcome(w, w.guest, w.frida)).toBe('void')
    expect(await outcome(w, w.host, w.fabian)).toBe('pending')
    await allowGuests(t, w, true)
    expect(await dot(t, w.frida)).toBe(0)
    expect(await dot(t, w.fabian)).toBe(1)
  })

  it('the guest who invited leaves → void; comes back → still void', async () => {
    const w = await pendingWorld()
    await rpc(t, w.guest, 'leave_occasion', [w.occasionId])
    expect(await outcome(w, w.guest, w.frida)).toBe('void')
    await rpc(t, w.guest, 'accept_invite', [w.token])
    expect(await dot(t, w.frida)).toBe(0)
  })

  it('the friendship ends (unfollow, remove_follower) → void; friends again → still void', async () => {
    const w = await pendingWorld()
    await rpc(t, w.frida, 'unfollow', [w.guest])
    expect(await outcome(w, w.guest, w.frida)).toBe('void')
    await rpc(t, w.host, 'remove_follower', [w.fabian])
    expect(await outcome(w, w.host, w.fabian)).toBe('void')
    await friends(t, w.guest, w.frida)
    await friends(t, w.host, w.fabian)
    expect(await dot(t, w.frida)).toBe(0)
    expect(await dot(t, w.fabian)).toBe(0)
  })

  it('a block between the invitee and the host (a guest invited) → void; unblocked → still void', async () => {
    const w = await pendingWorld()
    await friends(t, w.host, w.frida)
    await rpc(t, w.frida, 'block_user', [w.host])
    expect(await outcome(w, w.guest, w.frida)).toBe('void')
    await rpc(t, w.frida, 'unblock_user', [w.host])
    await friends(t, w.host, w.frida)
    expect(await dot(t, w.frida)).toBe(0)
  })

  it('"Einladungen in Anlässe: Niemand" → every pending invitation is void and new ones are suppressed; back → still void', async () => {
    const w = await pendingWorld()
    expect(await execAs(t, w.fabian, `update profiles set invitations_from = 'nobody' where id = $1`, [w.fabian])).toBe(1)
    expect(await outcome(w, w.host, w.fabian)).toBe('void')
    expect((await rpc<{ profile: { invitations_from: string } }>(t, w.fabian, 'get_me')).profile.invitations_from).toBe('nobody')
    const other = await createOccasion(t, w.host, { title: 'Brunch' })
    await send(t, w.host, other.occasionId, [w.fabian])
    expect((await rowOf(t, other.occasionId, w.host, w.fabian))!.delivered).toBe(false)
    await execAs(t, w.fabian, `update profiles set invitations_from = 'friends' where id = $1`, [w.fabian])
    expect(await dot(t, w.fabian)).toBe(0)
    // nobody else can switch it, nobody can read it through REST, only the two values exist
    expect(await execAs(t, w.host, `update profiles set invitations_from = 'nobody' where id = $1`, [w.fabian])).toBe(0)
    await expectDbError(execAs(t, w.fabian, `update profiles set invitations_from = 'all' where id = $1`, [w.fabian]), '23514')
    await expectDbError(t.asUser(w.host, (tx) => tx.query('select invitations_from from profiles')), '42501')
  })

  it('withdraw: gone for the invitee; the triple stays busy until the original expiry (no dot spam)', async () => {
    const w = await pendingWorld()
    expect(await withdraw(t, w.host, w.occasionId, w.fabian)).toEqual({ ok: true })
    expect(await withdraw(t, w.host, w.occasionId, w.fabian)).toEqual({ ok: true }) // again: the same
    expect(await dot(t, w.fabian)).toBe(0)
    expect(await send(t, w.host, w.occasionId, [w.fabian])).toEqual([{ profile_id: w.fabian, state: 'withdrawn', expires_at: expect.any(String) }])
    expect(await dot(t, w.fabian)).toBe(0)
    await expectRpcError(withdraw(t, w.host, w.occasionId, w.felix), 'not_found') // never invited
    await expectRpcError(withdraw(t, w.guest, w.occasionId, w.fabian), 'not_found') // not mine
  })
})

describe('quotas (§2.6, IP4) — only the sender\'s own numbers', () => {
  async function manyFriends(host: string, n: number, prefix: string): Promise<string[]> {
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      const f = await createMember(t, `${prefix}${i}`)
      await friends(t, host, f)
      out.push(f)
    }
    return out
  }

  it('5 per minute: the 6th attempt is limit_reached and writes nothing; suppressed ones count too', async () => {
    const w = await seedInvites(t)
    const fs = await manyFriends(w.host, 6, 'Min')
    await t.db.query(`update public.profiles set invitations_from = 'nobody' where id = $1`, [fs[0]]) // suppressed
    await send(t, w.host, w.occasionId, fs.slice(0, 3))
    await send(t, w.host, w.occasionId, fs.slice(3, 5))
    await expectRpcError(send(t, w.host, w.occasionId, [fs[5]!]), 'limit_reached')
    expect(await countRows(t, 'invitation_attempts', 'sender_id = $1', [w.host])).toBe(5)
    expect(await rowOf(t, w.occasionId, w.host, fs[5]!)).toBeNull()
    // a repeat of the ones already sent is no new attempt
    expect(await send(t, w.host, w.occasionId, fs.slice(0, 2))).toHaveLength(2)
    // a batch that would cross the limit is refused as a whole
    await t.db.query(`update public.invitation_attempts set attempted_at = attempted_at - interval '2 minutes' where sender_id = $1`, [w.host])
    expect(await send(t, w.host, w.occasionId, [fs[5]!])).toHaveLength(1)
  })

  it('10 per 24 hours and 30 per 7 days — and deleting the occasion resets nothing (Codex B #3)', async () => {
    const w = await seedInvites(t)
    const fs = await manyFriends(w.host, 3, 'Day')
    await t.db.query(
      `insert into public.invitation_attempts (sender_id, attempted_at) select $1, now() - interval '2 hours' from generate_series(1, 9)`,
      [w.host],
    )
    await send(t, w.host, w.occasionId, [fs[0]!])
    await expectRpcError(send(t, w.host, w.occasionId, [fs[1]!]), 'limit_reached')
    // the occasion goes, the ledger stays
    const other = await createOccasion(t, w.host, { title: 'Neu' })
    await execAs(t, w.host, 'delete from occasions where id = $1', [w.occasionId])
    await expectRpcError(send(t, w.host, other.occasionId, [fs[1]!]), 'limit_reached')
    // a week: 30
    await t.db.query(`update public.invitation_attempts set attempted_at = now() - interval '2 days' where sender_id = $1`, [w.host])
    await t.db.query(
      `insert into public.invitation_attempts (sender_id, attempted_at) select $1, now() - interval '3 days' from generate_series(1, 19)`,
      [w.host],
    )
    expect(await countRows(t, 'invitation_attempts', 'sender_id = $1', [w.host])).toBe(29)
    await send(t, w.host, other.occasionId, [fs[1]!])
    await expectRpcError(send(t, w.host, other.occasionId, [fs[2]!]), 'limit_reached')
  })

  it('at most 30 open invitations of one sender (the sender projection "invited"; withdrawn ones do not count)', async () => {
    const w = await seedInvites(t)
    const fs = await manyFriends(w.host, 31, 'Open')
    for (let i = 0; i < 30; i += 5) {
      await resetQuota(t, w.host)
      await send(t, w.host, w.occasionId, fs.slice(i, i + 5))
    }
    await resetQuota(t, w.host)
    await expectRpcError(send(t, w.host, w.occasionId, [fs[30]!]), 'limit_reached')
    await withdraw(t, w.host, w.occasionId, fs[0]!)
    expect(await send(t, w.host, w.occasionId, [fs[30]!])).toHaveLength(1)
  })

  it('the invitee\'s inbox holds at most 20: the 21st is suppressed silently (the sender sees "invited")', async () => {
    const w = await seedInvites(t)
    const target = await createMember(t, 'Tara')
    for (let i = 0; i < 21; i++) {
      const host = await createMember(t, `Gast${i}`)
      await friends(t, host, target)
      const o = await createOccasion(t, host, { title: `Fest ${i}` })
      expect(await send(t, host, o.occasionId, [target])).toEqual([{ profile_id: target, state: 'invited', expires_at: expect.any(String) }])
    }
    expect(await inbox(t, target)).toHaveLength(20)
    expect(await dot(t, target)).toBe(20)
    expect(await countRows(t, 'occasion_invitations', 'invitee_id = $1 and delivered', [target])).toBe(20)
    expect(w).toBeTruthy()
  })
})

describe('"eingeladen von" (Р3, IP9): the host only, only while the inviter is an active member without a block', () => {
  it('shows the guest\'s invitations to the host; never the host\'s own; never to guests', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    await send(t, w.guest, w.occasionId, [w.frida])
    await send(t, w.host, w.occasionId, [w.fabian])
    await respond(t, w.frida, await inboxId(t, w.frida, w.occasionId), true)
    await respond(t, w.fabian, await inboxId(t, w.fabian, w.occasionId), true)
    expect((await inviteInfo(t, w.host, w.occasionId)).invited_by).toEqual([{ profile_id: w.frida, inviter: { id: w.guest, display_name: 'Gina' } }])
    for (const uid of [w.guest, w.frida, w.fabian]) expect((await inviteInfo(t, uid, w.occasionId)).invited_by).toEqual([])
    // the records are in the export of both people concerned, and the host's switch in the host's (Codex 27.10 #4)
    expect((await rpc<{ invited_by: unknown[] }>(t, w.frida, 'export_my_invitations')).invited_by).toEqual([{ occasion_title: OCCASION_TITLE, inviter_name: 'Gina' }])
    expect((await rpc<{ joined_through_me: unknown[] }>(t, w.guest, 'export_my_invitations')).joined_through_me).toEqual([{ occasion_title: OCCASION_TITLE, display_name: 'Frida' }])
    expect((await rpc<{ hosted: unknown[] }>(t, w.host, 'export_my_invitations')).hosted).toEqual([{ occasion_title: OCCASION_TITLE, guests_can_invite: true }])
  })

  it('gone while the inviter is out (it comes back with the inviter); a block between the two guests changes nothing; erased by a link join', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    await send(t, w.guest, w.occasionId, [w.frida])
    await respond(t, w.frida, await inboxId(t, w.frida, w.occasionId), true)
    await rpc(t, w.guest, 'leave_occasion', [w.occasionId])
    expect((await inviteInfo(t, w.host, w.occasionId)).invited_by).toEqual([])
    await rpc(t, w.guest, 'accept_invite', [w.token])
    expect((await inviteInfo(t, w.host, w.occasionId)).invited_by).toHaveLength(1)
    // a block between the two guests (both stay): the label stays — the host must not learn of it (Codex 27.10 #1)
    const before = await outcomeText(t, w.host, 'get_occasion_invite_info', [w.occasionId])
    await rpc(t, w.frida, 'block_user', [w.guest])
    expect(await outcomeText(t, w.host, 'get_occasion_invite_info', [w.occasionId])).toBe(before)
    await rpc(t, w.frida, 'unblock_user', [w.guest])
    // the host blocks the inviter: the inviter is out of the occasion, the label goes
    await rpc(t, w.host, 'block_user', [w.guest])
    expect((await inviteInfo(t, w.host, w.occasionId)).invited_by).toEqual([])
    await rpc(t, w.host, 'unblock_user', [w.guest])
    // Frida leaves and comes back by the link: the record is erased for good
    await rpc(t, w.frida, 'leave_occasion', [w.occasionId])
    expect(await countRows(t, 'member_invited_by', 'occasion_id = $1', [w.occasionId])).toBe(0)
    await rpc(t, w.frida, 'accept_invite', [w.token])
    expect((await inviteInfo(t, w.host, w.occasionId)).invited_by).toEqual([])
  })
})

describe('the sender\'s list (get_sent_invitations)', () => {
  it('invited / withdrawn / accepted; a former friend\'s row disappears (Codex B #8)', async () => {
    const w = await seedInvites(t)
    const extra = await createMember(t, 'Emil')
    await friends(t, w.host, extra)
    await send(t, w.host, w.occasionId, [w.felix, w.fabian, extra])
    await withdraw(t, w.host, w.occasionId, w.fabian)
    await respond(t, w.felix, await inboxId(t, w.felix, w.occasionId), true)
    const list = await sentList(t, w.host, w.occasionId)
    const byId = Object.fromEntries(list.map((x) => [x.profile_id, x.state]))
    expect(byId).toEqual({ [w.felix]: 'accepted', [w.fabian]: 'withdrawn', [extra]: 'invited' })
    expect(Object.keys(list[0]!).sort()).toEqual(['display_name', 'expires_at', 'profile_id', 'state'])
    await rpc(t, extra, 'unfollow', [w.host])
    expect((await sentList(t, w.host, w.occasionId)).map((x) => x.profile_id)).not.toContain(extra)
  })
})

describe('export (Art. 15 / 20) of both sides', () => {
  it('the invitee: decisions, hidden attempts, closed occasions, silences; the sender: the projection only', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    await send(t, w.guest, w.occasionId, [w.frida])
    await respond(t, w.frida, await inboxId(t, w.frida, w.occasionId), false)
    const other = await createOccasion(t, w.guest, { title: 'Kino' })
    await send(t, w.guest, other.occasionId, [w.frida]) // suppressed by the silence
    const mine = await rpc<Record<string, unknown>>(t, w.frida, 'export_my_invitations')
    expect(mine).toMatchObject({
      format: 'bunprise-invitations-v1',
      settings: { invitations_from: 'friends' },
      // declined: the title as she saw it, no host name any more (she is no member)
      received: [{ occasion_title: OCCASION_TITLE, host_name: null, inviter_name: 'Gina', decision: 'declined' }],
      // the attempt kept from her by the silence is NOT listed (the drafted privacy text for invitations, §8; no hint at somebody's block)
      refusals: [{ occasion_title: OCCASION_TITLE }],
      silences: [{ inviter_name: 'Gina' }],
      sent: [],
      attempts: [],
    })
    const theirs = await rpc<{ sent: Record<string, unknown>[]; attempts: string[] }>(t, w.guest, 'export_my_invitations')
    expect(theirs.sent).toEqual([
      expect.objectContaining({ profile_id: w.frida, display_name: 'Frida', occasion_title: OCCASION_TITLE, state: 'invited' }),
      expect.objectContaining({ profile_id: w.frida, display_name: 'Frida', occasion_title: 'Kino', state: 'invited' }),
    ])
    expect(theirs.attempts).toHaveLength(2)
    // the sender's own blocks are empty, and nothing about Frida's decline / silence / suppression is in their part
    const text = JSON.stringify(theirs.sent)
    for (const word of ['declined', 'refus', 'silence', 'hidden', 'delivered', 'void']) expect(text).not.toContain(word)
    expect(theirs).toMatchObject({ received: [], refusals: [], silences: [] })
    expect(Object.keys(mine).sort()).toEqual(['attempts', 'format', 'hosted', 'invited_by', 'joined_through_me', 'received', 'refusals', 'sent', 'settings', 'silences'])
  })
})

describe('export: never what the person could not see any more (Codex review 27.10)', () => {
  it('a rename of a declined / closed occasion and the names of people one does not know any more stay out', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    const other = await createOccasion(t, w.guest, { title: 'Kino' })
    await send(t, w.guest, w.occasionId, [w.frida])
    await send(t, w.guest, other.occasionId, [w.frida])
    await respond(t, w.frida, await inboxId(t, w.frida, w.occasionId), false)
    await withdraw(t, w.guest, other.occasionId, w.frida)
    await execAs(t, w.host, `update occasions set title = 'Geheimes Treffen' where id = $1`, [w.occasionId])
    await execAs(t, w.guest, `update occasions set title = 'Neuer Titel' where id = $1`, [other.occasionId])
    await rpc(t, w.frida, 'unfollow', [w.guest])
    await rpc(t, w.guest, 'unfollow', [w.frida])
    const text = JSON.stringify(await rpc(t, w.frida, 'export_my_invitations'))
    expect(text).toContain(OCCASION_TITLE) // the title she saw when declining
    for (const hidden of ['Geheimes Treffen', 'Neuer Titel', 'Hanna', 'Gina']) expect(text).not.toContain(hidden)
  })
})

describe('account deletion (IP10) and retention (IP11)', () => {
  it('deleting the sender or the invitee removes every row about them (the quota ledger too)', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    await send(t, w.guest, w.occasionId, [w.frida, w.felix])
    await respond(t, w.felix, await inboxId(t, w.felix, w.occasionId), false)
    await send(t, w.host, w.occasionId, [w.fabian])
    await rpc(t, w.guest, 'delete_my_account')
    expect(await countRows(t, 'occasion_invitations', 'inviter_id = $1 or invitee_id = $1', [w.guest])).toBe(0)
    expect(await countRows(t, 'invitation_attempts', 'sender_id = $1', [w.guest])).toBe(0)
    expect(await countRows(t, 'invitation_cooldowns', 'inviter_id = $1 or invitee_id = $1', [w.guest])).toBe(0)
    await rpc(t, w.felix, 'delete_my_account')
    expect(await countRows(t, 'occasion_invite_refusals', 'invitee_id = $1', [w.felix])).toBe(0)
    await rpc(t, w.fabian, 'delete_my_account')
    expect(await countRows(t, 'occasion_invitations', 'invitee_id = $1', [w.fabian])).toBe(0)
  })

  it('the daily purge frees an expired slot (a new invitation after the expiry works), keeps the refusal, drops old rows', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    await send(t, w.host, w.occasionId, [w.fabian])
    await send(t, w.guest, w.occasionId, [w.frida])
    await respond(t, w.frida, await inboxId(t, w.frida, w.occasionId), false)
    await t.db.query(`update public.occasion_invitations set expires_at = now() - interval '1 minute' where occasion_id = $1`, [w.occasionId])
    expect(await dot(t, w.fabian)).toBe(0)
    await t.db.query('select private.purge_invitations()')
    expect((await rowOf(t, w.occasionId, w.host, w.fabian))!).toMatchObject({ outcome: 'void', live: false })
    await resetQuota(t, w.host)
    await send(t, w.host, w.occasionId, [w.fabian])
    expect(await dot(t, w.fabian)).toBe(1)
    expect(await countRows(t, 'occasion_invite_refusals', 'occasion_id = $1', [w.occasionId])).toBe(1)
    // 30 days after creation the rows go; 7-day-old attempts go; silences after `until` go
    await t.db.query(`update public.occasion_invitations set created_at = now() - interval '31 days' where occasion_id = $1 and invitee_id = $2`, [w.occasionId, w.frida])
    await t.db.query(`update public.invitation_attempts set attempted_at = now() - interval '8 days' where sender_id = $1`, [w.guest])
    await t.db.query(`update public.invitation_cooldowns set until = now() - interval '1 minute' where invitee_id = $1`, [w.frida])
    await t.db.query('select private.purge_invitations()')
    expect(await countRows(t, 'occasion_invitations', 'invitee_id = $1', [w.frida])).toBe(0)
    expect(await countRows(t, 'invitation_attempts', 'sender_id = $1', [w.guest])).toBe(0)
    expect(await countRows(t, 'invitation_cooldowns', 'invitee_id = $1', [w.frida])).toBe(0)
    expect(await countRows(t, 'occasion_invite_refusals', 'occasion_id = $1', [w.occasionId])).toBe(1)
  })

  it('a send closes the expired rows it needs itself (without the purge): a re-invitation after the expiry', async () => {
    const w = await seedInvites(t)
    await send(t, w.host, w.occasionId, [w.fabian])
    await t.db.query(`update public.occasion_invitations set expires_at = now() - interval '1 minute' where occasion_id = $1`, [w.occasionId])
    expect((await candidates(t, w.host, w.occasionId)).find((c) => c.profile.id === w.fabian)!.state).toBe('none')
    await resetQuota(t, w.host)
    expect(await send(t, w.host, w.occasionId, [w.fabian])).toEqual([{ profile_id: w.fabian, state: 'invited', expires_at: expect.any(String) }])
    expect(await dot(t, w.fabian)).toBe(1)
  })
})

describe('the database red button (private.features.occasion_invitations)', () => {
  it('off: no candidates, no send, empty inbox, no dot, no answer; the emergency template voids what was pending', async () => {
    const w = await seedInvites(t)
    await send(t, w.host, w.occasionId, [w.fabian])
    const id = await inboxId(t, w.fabian, w.occasionId)
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { MIGRATIONS_DIR } = await import('../../src/harness')
    await t.db.exec(await readFile(join(MIGRATIONS_DIR, '..', 'emergency', 'occasion_invitations_off.sql'), 'utf8'))
    await expectRpcError(candidates(t, w.host, w.occasionId), 'not_found')
    await expectRpcError(send(t, w.host, w.occasionId, [w.felix]), 'not_found')
    expect(await inbox(t, w.fabian)).toEqual([])
    expect(await dot(t, w.fabian)).toBe(0)
    await expectRpcError(respond(t, w.fabian, id, true), 'invite_invalid')
    expect(await inviteInfo(t, w.host, w.occasionId)).toMatchObject({ can_invite: false, invited_by: [] })
    await t.db.query('update private.features set occasion_invitations = true')
    expect(await dot(t, w.fabian)).toBe(0) // nothing comes back
    expect((await candidates(t, w.host, w.occasionId)).length).toBe(2)
  })
})
