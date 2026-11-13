/**
 * IP1 — the sender's cloak (docs/spec/in-app-invites-design.md §2.4, §2.5, Codex B #2): what the sender sees is the
 * same whether the invitation waits, was declined, is ignored, was silently suppressed for any of the 8 reasons, or
 * was voided for a reason the sender cannot see — in the send answer, the candidates, the sent list, the quota and
 * the export, with the unchanged expires_at, and also as a SEQUENCE (waiting -> declined between two reads).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../src/harness'
import { createMember, execAs, expectRpcError, rpc } from '../pilot/seed'
import {
  OCCASION_TITLE,
  candidates,
  createOccasion,
  friends,
  inboxId,
  outcomeText,
  resetQuota,
  respond,
  rowOf,
  seedInvites,
  send,
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

/** Everything the sender (Gina) can read about the invitations of the occasion, as text. */
async function senderView(w: InviteWorld): Promise<Record<string, string>> {
  return {
    candidates: await outcomeText(t, w.guest, 'get_invite_candidates', [w.occasionId]),
    sent: await outcomeText(t, w.guest, 'get_sent_invitations', [w.occasionId]),
    export: await outcomeText(t, w.guest, 'export_my_invitations'),
    me: await outcomeText(t, w.guest, 'get_me'),
    info: await outcomeText(t, w.guest, 'get_occasion_invite_info', [w.occasionId]),
    feed: await outcomeText(t, w.guest, 'get_feed'),
  }
}

/** A friend of Gina who gets ready for one silent reason (or for none). */
type Reason = (w: InviteWorld, r: string) => Promise<void>

const REASONS: Record<string, Reason> = {
  'none (delivered)': async () => undefined,
  '1 block between the invitee and the host': async (w, r) => {
    await rpc(t, r, 'block_user', [w.host])
  },
  '2 the host removed the invitee from this occasion': async (w, r) => {
    await rpc(t, r, 'accept_invite', [w.token])
    await rpc(t, w.host, 'remove_member', [w.occasionId, r])
  },
  '3 "Einladungen in Anlässe: Niemand"': async (_w, r) => {
    await execAs(t, r, `update profiles set invitations_from = 'nobody' where id = $1`, [r])
  },
  '4 the invitee declined an invitation into this occasion before': async (w, r) => {
    await friends(t, w.host, r)
    await send(t, w.host, w.occasionId, [r])
    await respond(t, r, await inboxId(t, r, w.occasionId), false)
    await resetQuota(t, w.host)
  },
  '5 the invitee declined this sender within 30 days (another occasion)': async (w, r) => {
    const other = await createOccasion(t, w.guest, { title: 'Anderes Fest' })
    await send(t, w.guest, other.occasionId, [r])
    await respond(t, r, await inboxId(t, r, other.occasionId), false)
  },
  '6 a pending invitation into this occasion from somebody else': async (w, r) => {
    await friends(t, w.host, r)
    await send(t, w.host, w.occasionId, [r])
    await resetQuota(t, w.host)
  },
  '7 an inbox with 20 invitations': async (_w, r) => {
    for (let i = 0; i < 20; i++) {
      const host = await createMember(t, `Volle${i}`)
      await friends(t, host, r)
      const o = await createOccasion(t, host, { title: `Voll ${i}` })
      await send(t, host, o.occasionId, [r])
    }
  },
  '8 the invitee silently refused a follow request of the sender': async (w, r) => {
    await t.db.query(`insert into public.follow_cooldowns (followee_id, follower_id, until) values ($1, $2, now() + interval '30 days')`, [r, w.guest])
  },
}

describe('the send answer and every later read are the same for a delivered and a suppressed invitation', () => {
  for (const [name, prepare] of Object.entries(REASONS)) {
    it(name, async () => {
      // twin worlds: Ronja gets the reason, Rita (control) gets nothing; both are sent in ONE call
      const w = await seedInvites(t, { guestsCanInvite: true })
      const ronja = await createMember(t, 'Ronja')
      const rita = await createMember(t, 'Rita')
      await friends(t, w.guest, ronja)
      await friends(t, w.guest, rita)
      await prepare(w, ronja)
      await resetQuota(t, w.guest)
      const answer = await send(t, w.guest, w.occasionId, [ronja, rita])
      const of = (id: string) => answer.find((a) => a.profile_id === id)!
      expect({ ...of(ronja), profile_id: 'x' }).toEqual({ ...of(rita), profile_id: 'x' })
      expect(of(ronja).state).toBe('invited')
      const delivered = (await rowOf(t, w.occasionId, w.guest, ronja))!.delivered
      expect(delivered).toBe(name.startsWith('none'))
      // the candidates and the sent list: the same entry (but the id / name / card)
      const cs = await candidates(t, w.guest, w.occasionId)
      const strip = (c: { state: string; expires_at: string | null }) => ({ state: c.state, expires_at: c.expires_at })
      expect(strip(cs.find((c) => c.profile.id === ronja)!)).toEqual(strip(cs.find((c) => c.profile.id === rita)!))
      const sent = await rpc<{ profile_id: string; state: string; expires_at: string }[]>(t, w.guest, 'get_sent_invitations', [w.occasionId])
      const s = (id: string) => sent.find((x) => x.profile_id === id)!
      expect({ ...s(ronja), profile_id: 'x', display_name: 'x' }).toEqual({ ...s(rita), profile_id: 'x', display_name: 'x' })
      // the repeat is idempotent for both, and withdrawing answers the same
      expect(await send(t, w.guest, w.occasionId, [ronja, rita])).toEqual(answer)
      expect(await withdraw(t, w.guest, w.occasionId, ronja)).toEqual(await withdraw(t, w.guest, w.occasionId, rita))
      // the export: the same entry
      const exp = await rpc<{ sent: { profile_id: string; occasion_title: string | null }[] }>(t, w.guest, 'export_my_invitations')
      const e = (id: string) => ({
        ...exp.sent.find((x) => x.profile_id === id && x.occasion_title === OCCASION_TITLE)!,
        profile_id: 'x', display_name: 'x', created_at: 'x',
      })
      expect(e(ronja)).toEqual(e(rita))
    })
  }
})

describe('sequences: the sender\'s reads do not move when the invitee acts or something invisible happens', () => {
  const EVENTS: Record<string, (w: InviteWorld, r: string) => Promise<void>> = {
    'the invitee declines': async (_w, r) => {
      const [inv] = await rpc<{ id: string }[]>(t, r, 'get_my_invitations')
      await respond(t, r, inv!.id, false)
    },
    'the invitee ignores it (time passes, nothing else)': async () => undefined,
    'the invitee switches to "Niemand"': async (_w, r) => {
      await execAs(t, r, `update profiles set invitations_from = 'nobody' where id = $1`, [r])
    },
    'the host blocks the invitee (not a member)': async (w, r) => {
      await rpc(t, w.host, 'block_user', [r])
    },
    'the invitee blocks the host': async (w, r) => {
      await rpc(t, r, 'block_user', [w.host])
    },
    'the invitee declines, then the host invites them into the same occasion (suppressed)': async (w, r) => {
      const [inv] = await rpc<{ id: string }[]>(t, r, 'get_my_invitations')
      await respond(t, r, inv!.id, false)
      await friends(t, w.host, r)
      await send(t, w.host, w.occasionId, [r])
    },
    'the host invites too (suppressed: the slot is taken), then the invitee declines': async (w, r) => {
      // Gina's invitation holds the delivery slot, so the host's is suppressed; the invitee declines Gina's
      await friends(t, w.host, r)
      await send(t, w.host, w.occasionId, [r])
      const [inv] = await rpc<{ id: string }[]>(t, r, 'get_my_invitations')
      await respond(t, r, inv!.id, false)
    },
    'the invitee accepts ANOTHER invitation into a different occasion': async (_w, r) => {
      const host = await createMember(t, 'Theo')
      await friends(t, host, r)
      const o = await createOccasion(t, host, { title: 'Theos Fest' })
      await send(t, host, o.occasionId, [r])
      await respond(t, r, await inboxId(t, r, o.occasionId), true)
    },
  }

  for (const [name, event] of Object.entries(EVENTS)) {
    it(name, async () => {
      const w = await seedInvites(t, { guestsCanInvite: true })
      await send(t, w.guest, w.occasionId, [w.frida])
      const before = await senderView(w)
      const expiresBefore = (await rowOf(t, w.occasionId, w.guest, w.frida))!.expires_at
      await event(w, w.frida)
      expect(await senderView(w)).toEqual(before)
      expect((await rowOf(t, w.occasionId, w.guest, w.frida))!.expires_at).toBe(expiresBefore)
    })
  }
})

describe('the quota never depends on what happened to an invitation (Codex B #2, #3)', () => {
  it('30 open invitations: declined, suppressed and voided ones keep counting, only the own withdrawal frees a place', async () => {
    const w = await seedInvites(t, { guestsCanInvite: true })
    const people: string[] = []
    for (let i = 0; i < 31; i++) {
      const p = await createMember(t, `Q${i}`)
      await friends(t, w.guest, p)
      people.push(p)
    }
    await execAs(t, people[1]!, `update profiles set invitations_from = 'nobody' where id = $1`, [people[1]!]) // suppressed
    for (let i = 0; i < 30; i += 5) {
      await resetQuota(t, w.guest)
      await send(t, w.guest, w.occasionId, people.slice(i, i + 5))
    }
    await respond(t, people[0]!, await inboxId(t, people[0]!, w.occasionId), false) // declined
    await rpc(t, people[2]!, 'block_user', [w.host]) // voided for a reason the sender cannot see
    await resetQuota(t, w.guest)
    await expectRpcError(send(t, w.guest, w.occasionId, [people[30]!]), 'limit_reached')
    await withdraw(t, w.guest, w.occasionId, people[3]!)
    expect(await send(t, w.guest, w.occasionId, [people[30]!])).toHaveLength(1)
  })
})
