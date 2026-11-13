/**
 * F07 — blocking (follows-design §2.10, §5.4 block_user, INV-5, INV-6, A3, P6, P14, review #1 / #2). Without the
 * reservation parts of follower lists (they come with M3); the occasion-list reservations keep the pilot's reasons.
 *   follows in BOTH directions disappear, accepted and pending (INV-5); the silences of BOTH sides stay (INV-6);
 *   the cards are not_found both ways; the follow link is invite_invalid; nothing of the other in the people screens;
 *   somebody else's occasion O2 (Moritz): Paula and Bea stay guests, but REST occasion_members (every granted column)
 *   and profiles give each of them 0 rows of the other, in both directions; get_occasion_screen(O2).members of both
 *   without the other; Moritz sees both. A guest who blocks the host reads as 'left' for the host — like leaving.
 * (The RPC-side check of the pilot, test/attack/round1-rpc-errors.test.ts "two members who blocked each other",
 * stays; this file adds the REST side.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, type TestDb } from '../../src/harness'
import { countAll, createMember, expectRpcError, queryAs, rpc, screen } from '../pilot/seed'
import { NAMES, followLink, followRows, rpcText, seedFollows, type FollowSeed } from './seed'
import { checkInvariants, cooldownRows, expectOnlyKnownProfiles } from './invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const MEMBER_COLUMNS = 'occasion_id, profile_id, role, rsvp, status, invited_via, joined_at, updated_at'
const pairRows = (a: string, b: string) => followRows(t, '(follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)', [a, b])

interface People {
  requests_in: { profile: { id: string } }[]
  requests_out: { profile: { id: string } }[]
  followers: { profile: { id: string } }[]
  following: { profile: { id: string } }[]
  blocked: { profile_id: string; display_name: string | null; blocked_at: string }[]
}

describe('follows end in both directions, the silences stay', () => {
  it('accepted both ways: Paula blocks Finn → no follows row in the pair; cards, link and people screens are closed', async () => {
    const s = await seedFollows(t)
    // Paula follows Finn back (they share O2): mutual
    expect(await rpc(t, s.paula, 'request_follow', [s.finn])).toEqual({ status: 'requested' })
    expect(await rpc(t, s.finn, 'respond_follow', [s.paula, true])).toEqual({ ok: true })
    expect(await pairRows(s.paula, s.finn)).toHaveLength(2)
    expect((await rpc<{ relation: { mutual: boolean } }>(t, s.finn, 'get_profile_card', [s.paula])).relation.mutual).toBe(true)
    // Finn is also a guest of Paula's occasion O1 and holds a reservation there (the pilot path)
    await rpc(t, s.finn, 'accept_invite', [s.o1Invite])
    await rpc(t, s.finn, 'reserve_wish', [s.o1Wish])
    const cooldownsBefore = await cooldownRows(t)

    expect(await rpc(t, s.paula, 'block_user', [s.finn])).toEqual({ ok: true })
    expect(await pairRows(s.paula, s.finn)).toEqual([])
    await checkInvariants(t, { cooldownsBefore })
    expect(await cooldownRows(t)).toEqual(cooldownsBefore)
    // 20261027200000: block_user never touches reservations; the dead row was ended by the cleanup (checkInvariants)
    // with the one internal reason; the membership reads as removed
    expect(await rows(t.db, `select status, end_reason from reservations where reserver_id = $1`, [s.finn])).toEqual([{ status: 'ended', end_reason: 'access_ended' }])
    expect(await rows(t.db, `select status from occasion_members where occasion_id = $1 and profile_id = $2`, [s.o1, s.finn])).toEqual([{ status: 'removed' }])

    await expectRpcError(rpc(t, s.paula, 'get_profile_card', [s.finn]), 'not_found')
    await expectRpcError(rpc(t, s.finn, 'get_profile_card', [s.paula]), 'not_found')
    await expectRpcError(rpc(t, s.finn, 'peek_follow_link', [s.token]), 'invite_invalid')
    await expectRpcError(rpc(t, s.finn, 'request_follow_via_link', [s.token]), 'invite_invalid')
    await expectRpcError(rpc(t, s.finn, 'request_follow', [s.paula]), 'not_found')
    await expectRpcError(rpc(t, s.paula, 'request_follow', [s.finn]), 'not_found')
    const paulaPeople = await rpc<People>(t, s.paula, 'get_people_screen')
    expect(paulaPeople.followers.map((f) => f.profile.id)).toEqual([s.greta])
    expect(paulaPeople.following).toEqual([])
    expect(paulaPeople.blocked.map((b) => [b.profile_id, b.display_name])).toEqual([[s.finn, NAMES.finn], [s.bea, NAMES.bea]])
    expect(await rpcText(t, s.finn, 'get_people_screen')).not.toContain(s.paula)
    expect((await rpc<{ stats: { following: number; followers: number } }>(t, s.finn, 'get_lists_overview')).stats).toMatchObject({ following: 0, followers: 0 })
    await expectOnlyKnownProfiles(t, s.finn, { occasionIds: [s.o1, s.o2], tokens: [s.token] })
    await expectOnlyKnownProfiles(t, s.paula, { occasionIds: [s.o1, s.o2], tokens: [s.token] })

    // unblocking restores nothing: no follow, the old link stays usable for a NEW request only
    expect(await rpc(t, s.paula, 'unblock_user', [s.finn])).toEqual({ ok: true })
    expect(await pairRows(s.paula, s.finn)).toEqual([])
    expect(await rpc(t, s.finn, 'request_follow_via_link', [s.token])).toEqual({ status: 'requested', profile_id: s.paula })
  })

  it('pending both ways with a silence on both sides: Rosa blocks Paula → both rows gone, both silences untouched (INV-6)', async () => {
    const s = await seedFollows(t)
    await rpc(t, s.paula, 'respond_follow', [s.rosa, false]) // Paula's silence on Rosa (Rosa's row stays pending)
    const rosasLink = await followLink(t, s.rosa)
    await rpc(t, s.paula, 'request_follow_via_link', [rosasLink])
    await rpc(t, s.rosa, 'respond_follow', [s.paula, false]) // Rosa's silence on Paula
    expect(await pairRows(s.paula, s.rosa)).toHaveLength(2)
    const silences = await cooldownRows(t)
    expect(silences.filter((c) => [c.followee_id, c.follower_id].sort().join() === [s.paula, s.rosa].sort().join())).toHaveLength(2)

    expect(await rpc(t, s.rosa, 'block_user', [s.paula])).toEqual({ ok: true })
    expect(await pairRows(s.paula, s.rosa)).toEqual([])
    expect(await cooldownRows(t)).toEqual(silences)
    await checkInvariants(t, { cooldownsBefore: silences })
    expect(await rpc(t, s.rosa, 'unblock_user', [s.paula])).toEqual({ ok: true })
    expect(await cooldownRows(t)).toEqual(silences)
    // blocked again from the other side, then unblocked: still nothing shorter
    await rpc(t, s.paula, 'block_user', [s.rosa])
    await rpc(t, s.paula, 'unblock_user', [s.rosa])
    expect(await cooldownRows(t)).toEqual(silences)
  })

  it('block_user keeps the pilot preconditions: not_found for null / self / unknown; idempotent', async () => {
    const s = await seedFollows(t)
    await expectRpcError(rpc(t, s.paula, 'block_user', [null]), 'not_found')
    await expectRpcError(rpc(t, s.paula, 'block_user', [s.paula]), 'not_found')
    await expectRpcError(rpc(t, s.paula, 'block_user', ['00000000-0000-4000-8000-0000000000aa']), 'not_found')
    expect(await rpc(t, s.paula, 'block_user', [s.bea])).toEqual({ ok: true }) // already blocked in the seed
    expect(await countAll(t, 'blocks', 'blocker_id = $1', [s.paula])).toBe(1)
  })
})

describe('somebody else\'s occasion O2 (Moritz): both stay guests and do not see each other — through REST either', () => {
  let s: FollowSeed
  beforeAll(async () => {
    s = await seedFollows(t) // Paula blocked Bea after both had joined O2
  })

  it('both are still active guests of O2', async () => {
    expect(await rows(t.db, `select profile_id, status from occasion_members where occasion_id = $1 and profile_id in ($2, $3) order by 1`, [s.o2, s.paula, s.bea])).toEqual(
      [{ profile_id: s.paula, status: 'active' }, { profile_id: s.bea, status: 'active' }].sort((a, b) => (a.profile_id < b.profile_id ? -1 : 1)),
    )
  })

  it('REST occasion_members (every granted column) and profiles: 0 rows of the other, in both directions', async () => {
    for (const [viewer, hidden] of [[s.paula, s.bea], [s.bea, s.paula]] as const) {
      expect(await queryAs(t, viewer, `select ${MEMBER_COLUMNS} from occasion_members where occasion_id = $1 and profile_id = $2`, [s.o2, hidden])).toEqual([])
      expect(await queryAs(t, viewer, `select ${MEMBER_COLUMNS} from occasion_members where profile_id = $1`, [hidden])).toEqual([])
      expect(await queryAs(t, viewer, `select id, display_name from profiles where id = $1`, [hidden])).toEqual([])
      // the occasion itself and the other guests stay visible
      expect(await queryAs(t, viewer, `select id from occasions where id = $1`, [s.o2])).toEqual([{ id: s.o2 }])
      const visible = (await queryAs<{ profile_id: string }>(t, viewer, `select profile_id from occasion_members where occasion_id = $1`, [s.o2])).map((r) => r.profile_id)
      expect(visible.sort()).toEqual([s.moritz, viewer, s.finn].sort())
    }
  })

  it('an RSVP change of the other one leaves no trace (no row, no updated_at)', async () => {
    const before = await queryAs(t, s.paula, `select ${MEMBER_COLUMNS} from occasion_members where occasion_id = $1 order by profile_id`, [s.o2])
    await t.asUser(s.bea, (tx) => tx.query(`update occasion_members set rsvp = 'going' where occasion_id = $1 and profile_id = $2`, [s.o2, s.bea]))
    expect(await queryAs(t, s.paula, `select ${MEMBER_COLUMNS} from occasion_members where occasion_id = $1 order by profile_id`, [s.o2])).toEqual(before)
  })

  it('get_occasion_screen(O2).members of both without the other; Moritz (host) and Finn see both', async () => {
    expect((await screen(t, s.paula, s.o2)).members.map((m) => m.profile_id)).not.toContain(s.bea)
    expect((await screen(t, s.bea, s.o2)).members.map((m) => m.profile_id)).not.toContain(s.paula)
    for (const viewer of [s.moritz, s.finn]) {
      const ids = (await screen(t, viewer, s.o2)).members.map((m) => m.profile_id)
      expect(ids).toEqual(expect.arrayContaining([s.paula, s.bea, s.moritz, s.finn]))
    }
    expect((await queryAs<{ profile_id: string }>(t, s.moritz, `select profile_id from occasion_members where occasion_id = $1`, [s.o2])).map((r) => r.profile_id).sort()).toEqual(
      [s.moritz, s.paula, s.bea, s.finn].sort(),
    )
    await expectOnlyKnownProfiles(t, s.bea, { occasionIds: [s.o2] })
  })

  it('after unblocking the filter lifts again (it is computed, nothing was deleted)', async () => {
    await rpc(t, s.paula, 'unblock_user', [s.bea])
    expect(await queryAs(t, s.paula, `select profile_id from occasion_members where occasion_id = $1 and profile_id = $2`, [s.o2, s.bea])).toEqual([{ profile_id: s.bea }])
    expect(await queryAs(t, s.bea, `select id from profiles where id = $1`, [s.paula])).toEqual([{ id: s.paula }])
    await rpc(t, s.paula, 'block_user', [s.bea])
    expect(await queryAs(t, s.paula, `select profile_id from occasion_members where occasion_id = $1 and profile_id = $2`, [s.o2, s.bea])).toEqual([])
  })
})

describe('the host\'s view of a guest who blocked the host: "left", exactly like leaving', () => {
  it('Moritz blocks Paula (host of O1) → the host reads him as left with the same columns as a voluntary exit; no member sees him', async () => {
    const s = await seedFollows(t)
    const leaver = await createMember(t, 'Anna')
    await rpc(t, leaver, 'accept_invite', [s.o1Invite])
    await rpc(t, leaver, 'leave_occasion', [s.o1])
    expect(await rpc(t, s.moritz, 'block_user', [s.paula])).toEqual({ ok: true })
    const hostView = await queryAs<{ profile_id: string; status: string; role: string }>(
      t,
      s.paula,
      `select profile_id, role, status from occasion_members where occasion_id = $1 and role = 'member' order by profile_id`,
      [s.o1],
    )
    expect(hostView).toEqual(
      [{ profile_id: s.moritz, role: 'member', status: 'left' }, { profile_id: leaver, role: 'member', status: 'left' }].sort((a, b) => (a.profile_id < b.profile_id ? -1 : 1)),
    )
    // the full granted row is readable for both (the same shape: nothing tells a block from leaving)
    for (const who of [s.moritz, leaver]) {
      const r = await queryAs<Record<string, unknown>>(t, s.paula, `select ${MEMBER_COLUMNS} from occasion_members where occasion_id = $1 and profile_id = $2`, [s.o1, who])
      expect(Object.keys(r[0]!).sort()).toEqual(MEMBER_COLUMNS.split(', ').sort())
    }
    // the export of the host lists both as left, too — identically (the invoker export reads names under RLS, so
    // since the pilot neither name is shown once the person is no longer an active co-member)
    const members = (await rpc<{ occasions_hosted: { id: string; members: { display_name: string | null; status: string; role: string }[] }[] }>(t, s.paula, 'export_my_data'))
      .occasions_hosted.find((o) => o.id === s.o1)!.members
    expect(members.filter((m) => m.status === 'left').map((m) => [m.role, m.display_name])).toEqual([['member', null], ['member', null]])
    // a guest never sees the rows of people who left
    const other = await createMember(t, 'Xenia')
    const freshInvite = (await rpc<{ token: string }>(t, s.paula, 'create_invite', [s.o1])).token
    await rpc(t, other, 'accept_invite', [freshInvite])
    expect((await queryAs<{ profile_id: string }>(t, other, `select profile_id from occasion_members where occasion_id = $1`, [s.o1])).map((r) => r.profile_id).sort()).toEqual(
      [s.paula, other].sort(),
    )
    await expectDbError(t.asUser(other, (tx) => tx.query(`select xmax from occasion_members`)), '42501') // column grant: no system columns
  })
})
