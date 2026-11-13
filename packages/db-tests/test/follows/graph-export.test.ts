/**
 * F13 — the social graph and the export (follows-design §5.5 my_follows_export, §8.3, INV-4, P2, S11):
 *   no answer to Finn contains Greta's id (and the other way round) — followers do not know each other; the same
 *   scan for every person of the seed (INV-4: only ids of people one may know);
 *   Paula's export: followers, visible requests, hidden_requests_received (Rosa during the silence), hidden_requesters,
 *   links with use_count and never token_hash, the banner, her lists and wishes WITH updated_at (through
 *   my_wishlists_export although REST cannot read it any more), nothing about reservations on her wishes;
 *   Rosa's export shows only "requested"; an expired but not yet purged request is not in following[];
 *   nobody else's id in any export (display names only).
 * (in_suggestions in the profile and the reservation parts — "list and owner null after losing access" — are M3.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, rows, scalar, type TestDb } from '../../src/harness'
import { rpc } from '../pilot/seed'
import { L1_TITLE, L2_TITLE, NAMES, exportOf, rpcText, seedFollows, type FollowSeed } from './seed'
import { answersOf, expectOnlyKnownProfiles } from './invariants'

let t: TestDb
let s: FollowSeed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedFollows(t)
  await t.asUser(s.paula, (tx) => tx.query(`update profiles set banner = 'sunrise' where id = $1`, [s.paula]))
})
afterAll(() => t.close())

interface FollowsExport {
  following: Record<string, unknown>[]
  followers: Record<string, unknown>[]
  requests_received: Record<string, unknown>[]
  hidden_requests_received: Record<string, unknown>[]
  hidden_requesters: Record<string, unknown>[]
  follow_links: Record<string, unknown>[]
}

const followsOf = async (uid: string) => (await exportOf(t, uid))['follows'] as FollowsExport

describe('INV-4: the graph stays private', () => {
  it('no answer to Finn contains Greta\'s id, and none to Greta contains Finn\'s', async () => {
    for (const [viewer, hidden] of [[s.finn, s.greta], [s.greta, s.finn], [s.rosa, s.finn], [s.rosa, s.greta]] as const) {
      for (const text of await answersOf(t, viewer, { occasionIds: [s.o1, s.o2], tokens: [s.token] })) {
        expect(text, `${viewer} learned about ${hidden}`).not.toContain(hidden)
      }
    }
  })

  it('every person of the seed only ever receives ids of people they may know', async () => {
    for (const uid of [s.paula, s.finn, s.greta, s.rosa, s.moritz, s.xaver, s.bea]) {
      await expectOnlyKnownProfiles(t, uid, { occasionIds: [s.o1, s.o2], tokens: [s.token] })
    }
  })

  it('the stats are own numbers only: Paula has 2 followers and 1 request; Finn follows 1; nobody sees Paula\'s numbers', async () => {
    const paula = await rpc<{ stats: Record<string, number> }>(t, s.paula, 'get_lists_overview')
    expect(paula.stats).toMatchObject({ followers: 2, following: 0, requests: 1 })
    expect((await rpc<{ stats: Record<string, number> }>(t, s.finn, 'get_lists_overview')).stats).toMatchObject({ followers: 0, following: 1, requests: 0 })
    expect((await rpc<{ stats: Record<string, number> }>(t, s.rosa, 'get_lists_overview')).stats).toMatchObject({ followers: 0, following: 0, requests: 0 })
    expect(await rpcText(t, s.finn, 'get_profile_card', [s.paula])).not.toMatch(/"(followers|following|requests)"\s*:\s*\d/)
  })
})

describe('export_my_data: the follows block', () => {
  it('Paula: followers, visible requests, links (use_count, no token_hash), banner, lists + wishes with updated_at, no reservations', async () => {
    const exp = await exportOf(t, s.paula)
    expect(exp['format']).toBe('bunprise-export-v2')
    expect(exp['profile']).toMatchObject({ id: s.paula, banner: 'sunrise' })
    const f = exp['follows'] as FollowsExport
    // + friend_codes / friend_code_misses (20261027160000; their content: test/follows/friend-codes.test.ts)
    expect(Object.keys(f).sort()).toEqual(['follow_links', 'followers', 'following', 'friend_code_misses', 'friend_codes', 'hidden_requesters', 'hidden_requests_received', 'requests_received'])
    expect(f.followers.map((x) => x['display_name'])).toEqual([NAMES.finn, NAMES.greta])
    for (const x of f.followers) expect(Object.keys(x).sort()).toEqual(['accepted_at', 'display_name'])
    expect(f.requests_received).toEqual([{ display_name: NAMES.rosa, requested_at: expect.any(String) }])
    expect([f.following, f.hidden_requests_received, f.hidden_requesters]).toEqual([[], [], []])
    expect(f.follow_links).toEqual([{ created_at: expect.any(String), expires_at: expect.any(String), revoked_at: null, use_count: 3 }])
    const lists = exp['wishlists'] as { title: string; occasion_id: string | null; updated_at: string; visibility: string; wishes: { updated_at: string }[] }[]
    expect(lists.map((l) => l.title)).toEqual([L1_TITLE, L2_TITLE, 'Paulas Gartenfest'])
    for (const l of lists) {
      expect(l.updated_at).toEqual(expect.any(String))
      for (const w of l.wishes) expect(w.updated_at).toEqual(expect.any(String))
    }
    // L1's audience is the seed's business (M3: 'followers'); L2 is "Nur ich", the occasion list is the occasion's
    expect(lists.map((l) => l.occasion_id === null)).toEqual([true, true, false])
    expect(lists.slice(1).map((l) => l.visibility)).toEqual(['private', 'occasion'])
    const text = JSON.stringify(exp)
    expect(text).not.toMatch(/token_hash|until":/)
    expect(text.replace('reservations_made_by_me', '')).not.toMatch(/reserv/)
    const hashHex = await scalar<string>(t.db, `select encode(sha256(convert_to($1::text, 'UTF8')), 'hex')`, [s.token])
    expect(text).not.toContain(hashHex)
    expect(text).not.toContain(s.token)
  })

  it('during the silence: Rosa is in Paula\'s hidden_requests_received and hidden_requesters — and nowhere visible', async () => {
    await rpc(t, s.paula, 'respond_follow', [s.rosa, false])
    const f = await followsOf(s.paula)
    expect(f.requests_received).toEqual([])
    expect(f.hidden_requests_received).toEqual([{ display_name: NAMES.rosa, requested_at: expect.any(String) }])
    expect(f.hidden_requesters).toEqual([{ display_name: NAMES.rosa, until: expect.any(String) }])
    // Rosa's own export: only "requested" — no silence, no refusal
    const rosa = await followsOf(s.rosa)
    expect(rosa.following).toEqual([{ display_name: NAMES.paula, status: 'requested', requested_at: expect.any(String), accepted_at: null, expires_at: expect.any(String) }])
    expect([rosa.followers, rosa.requests_received, rosa.hidden_requests_received, rosa.hidden_requesters, rosa.follow_links]).toEqual([[], [], [], [], []])
    // Finn's export: following Paula (accepted)
    expect((await followsOf(s.finn)).following).toEqual([
      { display_name: NAMES.paula, status: 'accepted', requested_at: expect.any(String), accepted_at: expect.any(String), expires_at: null },
    ])
  })

  it('an expired, not yet purged request is not "requested" any more in the requester\'s export (nor hidden for the other side)', async () => {
    await t.asService((tx) =>
      tx.query(`update follows set requested_at = now() - interval '40 days', expires_at = now() - interval '10 days' where follower_id = $1`, [s.rosa]),
    )
    expect(await rows(t.db, `select status from follows where follower_id = $1`, [s.rosa])).toEqual([{ status: 'pending' }]) // still stored
    expect((await followsOf(s.rosa)).following).toEqual([])
    expect((await followsOf(s.paula)).hidden_requests_received).toEqual([])
    expect((await followsOf(s.paula)).hidden_requesters).toHaveLength(1) // Paula's own decision is still running
  })

  it('no export carries anybody else\'s id — only display names', async () => {
    const people = [s.paula, s.finn, s.greta, s.rosa, s.moritz, s.xaver, s.bea]
    for (const uid of people) {
      const text = await t.asUser(uid, (tx) => scalar<string>(tx, 'select public.export_my_data()::text'))
      for (const other of people.filter((p) => p !== uid)) expect(text, `${uid}'s export names ${other}`).not.toContain(other)
    }
  })
})
