import { describe, expect, it } from 'vitest'
import { DEMO_OCCASIONS, DEMO_PEOPLE, seedDemoWorld } from './fixtures'
import { DEMO_INVITATION_ID, DEMO_INVITE_OCCASION, createDemoInvitations } from './invitations'
import { DEMO_LIST_PEOPLE, seedListsDemo } from './lists'
import { DemoDbError } from './rest'
import { createDemoWorld, type DemoPerson } from './world'

// The demo's in-app invitations behave like supabase/migrations/20261027120000_occasion_invitations.sql (the SQL
// itself is proven in packages/db-tests/test/invitations): friends only, the sender's cloak, the silent decline,
// the closed occasion, quotas, the host's "eingeladen von", and Anna's scripted "Beitreten".

const NOW = Date.parse('2026-10-26T10:00:00Z')
const MILA = '00000000-0000-4000-8000-0000000000aa'
const { anna, ben, clara } = DEMO_PEOPLE
const { paula, rosa } = DEMO_LIST_PEOPLE

function person(id: string, name: string): DemoPerson {
  return { id, displayName: () => name, hasConsents: () => true }
}

/** The demo world around Mila (the first account: Anna and Paula are her friends), invitations seeded. */
function world(options: { script?: boolean } = {}) {
  let clock = NOW
  const w = createDemoWorld(() => clock)
  seedDemoWorld(w, NOW)
  seedListsDemo(w, MILA, NOW)
  w.addPerson(person(MILA, 'Mila'))
  w.addGuest(DEMO_OCCASIONS.housewarming, MILA)
  const scheduled: (() => void)[] = []
  const inv = createDemoInvitations(w, options.script ? { schedule: (run) => scheduled.push(run) } : { acceptors: false })
  inv.seedDemo(MILA, NOW)
  return { w, inv, scheduled, later: (ms: number) => { clock += ms } }
}

/** Mila's own occasion (in 10 days); returns its id. */
function milasOccasion(w: ReturnType<typeof world>['w']): string {
  const [row] = w.insertOccasions(MILA, [{ host_id: MILA, title: 'Milas Feier', starts_at: new Date(NOW + 10 * 86_400_000).toISOString(), all_day: false }], true)
  return row!.id
}

function code(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof DemoDbError) return error.message
    throw error
  }
  throw new Error('expected a refusal')
}

describe('demo invitations', () => {
  it('Paula\'s invitation waits on Start for the first account: card data without the host\'s id or the place', () => {
    const { inv } = world()
    expect(inv.inboxCount(MILA)).toBe(1)
    const [card] = inv.api.getMyInvitations(MILA)
    expect(card).toMatchObject({ id: DEMO_INVITATION_ID, occasion: { id: DEMO_INVITE_OCCASION, title: 'Paulas Spieleabend' }, host_name: 'Paula Brandt', from_host: true })
    expect(JSON.stringify(card)).not.toMatch(/Lindenweg|host_id/)
  })

  it('candidates are friends only (Anna, Paula), minus members; never a one-way follower', () => {
    const { w, inv } = world()
    const occ = milasOccasion(w)
    expect(inv.api.getInviteCandidates(MILA, occ).map((c) => c.profile.display_name)).toEqual(['Anna Beispiel', 'Paula Brandt'])
    // Rosa follows Mila one way, Ben is followed one way: neither is a friend
    expect(code(() => inv.api.sendOccasionInvites(MILA, occ, [rosa.id]))).toBe('not_found')
    expect(code(() => inv.api.sendOccasionInvites(MILA, occ, [ben.id]))).toBe('not_found')
    expect(code(() => inv.api.getInviteCandidates(clara.id, occ))).toBe('not_found')
  })

  it('the sender\'s cloak: "invited" whether delivered or silently kept away', () => {
    const { w, inv } = world()
    const occ = milasOccasion(w)
    inv.setInvitationsFrom(paula.id, 'nobody')
    const answer = inv.api.sendOccasionInvites(MILA, occ, [anna.id, paula.id])
    expect(answer.map((a) => a.state)).toEqual(['invited', 'invited'])
    expect(answer[0]?.expires_at).toBe(answer[1]?.expires_at)
    expect(inv.inboxCount(paula.id)).toBe(0)
    expect(inv.inboxCount(anna.id)).toBe(1)
    expect(inv.api.getInviteCandidates(MILA, occ).map((c) => c.state)).toEqual(['invited', 'invited'])
  })

  it('accept = a normal membership (+ "eingeladen von" when a guest invited); decline = silent + the occasion closed', () => {
    const { w, inv } = world()
    expect(inv.api.respondOccasionInvite(MILA, DEMO_INVITATION_ID, true)).toEqual({ occasion_id: DEMO_INVITE_OCCASION })
    expect(w.getFeed(MILA).upcoming.map((o) => o.id)).toContain(DEMO_INVITE_OCCASION)
    expect(code(() => inv.api.respondOccasionInvite(MILA, DEMO_INVITATION_ID, true))).toBe('invite_invalid')
    // Anna's housewarming lets guests invite: Mila invites Paula; Paula declines; Anna never learns a reason
    const answer = inv.api.sendOccasionInvites(MILA, DEMO_OCCASIONS.housewarming, [paula.id])
    expect(answer[0]?.state).toBe('invited')
    const [card] = inv.api.getMyInvitations(paula.id)
    expect(inv.api.respondOccasionInvite(paula.id, card!.id, false)).toEqual({ ok: true })
    expect(inv.api.getInviteCandidates(MILA, DEMO_OCCASIONS.housewarming).find((c) => c.profile.id === paula.id)?.state).toBe('invited')
    expect(inv.inboxCount(paula.id)).toBe(0)
  })

  it('the host sees "eingeladen von" for a guest\'s invitation', () => {
    const { inv } = world()
    inv.api.sendOccasionInvites(MILA, DEMO_OCCASIONS.housewarming, [paula.id])
    const [card] = inv.api.getMyInvitations(paula.id)
    inv.api.respondOccasionInvite(paula.id, card!.id, true)
    expect(inv.api.getOccasionInviteInfo(anna.id, DEMO_OCCASIONS.housewarming).invited_by).toEqual([{ profile_id: paula.id, inviter: { id: MILA, display_name: 'Mila' } }])
    expect(inv.api.getOccasionInviteInfo(MILA, DEMO_OCCASIONS.housewarming)).toMatchObject({ guests_can_invite: true, can_invite: true, invited_by: [] })
  })

  it('5 attempts a minute; a repeat is idempotent; withdraw keeps the triple busy', () => {
    const { w, inv, later } = world()
    const occ = milasOccasion(w)
    inv.api.sendOccasionInvites(MILA, occ, [anna.id])
    expect(inv.api.sendOccasionInvites(MILA, occ, [anna.id])[0]?.state).toBe('invited')
    expect(inv.api.withdrawOccasionInvite(MILA, occ, anna.id)).toEqual({ ok: true })
    expect(inv.api.sendOccasionInvites(MILA, occ, [anna.id])[0]?.state).toBe('withdrawn')
    later(61_000)
    for (let i = 0; i < 5; i++) {
      const other = milasOccasion(w)
      inv.api.sendOccasionInvites(MILA, other, [paula.id])
    }
    expect(code(() => inv.api.sendOccasionInvites(MILA, milasOccasion(w), [paula.id]))).toBe('limit_reached')
  })

  it('Anna answers a demo account\'s invitation with "Beitreten" after a moment (Paula never answers)', () => {
    const { w, inv, scheduled } = world({ script: true })
    const occ = milasOccasion(w)
    inv.api.sendOccasionInvites(MILA, occ, [anna.id, paula.id])
    expect(scheduled).toHaveLength(1)
    scheduled[0]!()
    expect(w.getOccasionScreen(MILA, occ).members.map((m) => m.display_name)).toContain('Anna Beispiel')
    expect(inv.api.getSentInvitations(MILA, occ).map((s) => [s.display_name, s.state])).toEqual([['Anna Beispiel', 'accepted'], ['Paula Brandt', 'invited']])
  })
})
