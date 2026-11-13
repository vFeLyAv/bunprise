/**
 * F12 — no enumeration of people (follows-design §1.3, §4.3, P1, P2): get_profile_card and request_follow give ONE
 * answer — not_found — for an unknown id, a stranger (Xaver), a blocked person (Bea) and null (request_follow also for
 * oneself); unfollow without a relation is {ok:true}; remove_follower of a non-follower is not_found; a malformed id is
 * the same 22P02 for everybody. A card never shows somebody's followers, followings or their numbers.
 * (get_profile_card(oneself) is the own card — INV-2 snapshots it; "себя → not_found" in §7.2 F12 applies to request_follow.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, type TestDb } from '../../src/harness'
import { expectRpcError, rpc } from '../pilot/seed'
import { NAMES, UNKNOWN_ID, followRows, m3Applied, seedFollows, type FollowSeed } from './seed'
import { checkInvariants } from './invariants'

let t: TestDb
let s: FollowSeed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedFollows(t)
})
afterAll(() => t.close())

const CARD_KEYS = ['can_find_gift', 'can_request', 'lists', 'profile', 'relation', 'shared_occasions']

interface Card {
  profile: { id: string; display_name: string | null; banner: string | null }
  relation: { self: boolean; i_follow: string; follows_me: string; mutual: boolean }
  can_request: boolean
  can_find_gift: boolean
  lists: unknown[]
  shared_occasions: { id: string; title: string; starts_at: string }[]
}

describe('one answer for unknown, stranger, blocked and null', () => {
  it('get_profile_card: not_found (identical code and text) for every one of them, for every caller', async () => {
    const answers = new Set<string>()
    for (const viewer of [s.paula, s.finn, s.xaver]) {
      for (const target of [UNKNOWN_ID, null]) {
        const err = await expectRpcError(rpc(t, viewer, 'get_profile_card', [target]), 'not_found')
        answers.add(JSON.stringify({ code: err.code, message: err.message }))
      }
    }
    for (const [viewer, target] of [[s.paula, s.xaver], [s.paula, s.bea], [s.bea, s.paula], [s.xaver, s.paula], [s.finn, s.greta], [s.greta, s.finn]] as const) {
      const err = await expectRpcError(rpc(t, viewer, 'get_profile_card', [target]), 'not_found')
      answers.add(JSON.stringify({ code: err.code, message: err.message }))
    }
    expect([...answers]).toEqual([JSON.stringify({ code: 'P0001', message: 'not_found' })])
  })

  it('request_follow: not_found for unknown, stranger, blocked, null and oneself; nothing is written', async () => {
    for (const target of [UNKNOWN_ID, s.xaver, s.bea, null, s.paula]) {
      await expectRpcError(rpc(t, s.paula, 'request_follow', [target]), 'not_found')
    }
    await expectRpcError(rpc(t, s.bea, 'request_follow', [s.paula]), 'not_found') // the blocked side, too
    await expectRpcError(rpc(t, s.greta, 'request_follow', [s.finn]), 'not_found') // two followers of Paula share nothing
    expect(await followRows(t, 'follower_id in ($1, $2, $3)', [s.paula, s.bea, s.greta])).toEqual([{ follower_id: s.greta, followee_id: s.paula, status: 'accepted' }])
    await checkInvariants(t)
  })

  it('unfollow without a relation is ok (idempotent); remove_follower of a non-follower is not_found', async () => {
    for (const target of [UNKNOWN_ID, s.xaver, s.bea, null, s.paula]) {
      expect(await rpc(t, s.paula, 'unfollow', [target])).toEqual({ ok: true })
    }
    for (const target of [UNKNOWN_ID, s.xaver, s.bea, null, s.paula, s.moritz, s.rosa]) {
      await expectRpcError(rpc(t, s.paula, 'remove_follower', [target]), 'not_found')
    }
    expect(await followRows(t, 'followee_id = $1', [s.paula])).toHaveLength(3) // Finn, Greta accepted; Rosa waiting
  })

  it('a malformed id fails identically (22P02) before any logic, for every role', async () => {
    const messages = new Set<string>()
    for (const uid of [s.paula, s.finn, s.xaver, s.bea]) {
      for (const fn of ['get_profile_card', 'request_follow', 'unfollow', 'remove_follower', 'get_list_screen']) {
        messages.add((await expectDbError(rpc(t, uid, fn, ['nicht-uuid']), '22P02')).message)
      }
      messages.add((await expectDbError(rpc(t, uid, 'respond_follow', ['nicht-uuid', true]), '22P02')).message)
    }
    expect(messages.size).toBe(1)
  })
})

describe('what a card shows', () => {
  it('exactly the contract keys; never followers, followings or counts of the other person', async () => {
    const card = await rpc<Card>(t, s.finn, 'get_profile_card', [s.paula])
    expect(Object.keys(card).sort()).toEqual(CARD_KEYS)
    expect(card.profile).toEqual({ id: s.paula, display_name: NAMES.paula, banner: null, photo: null, banner_photo: null })
    expect(card.relation).toEqual({ self: false, i_follow: 'following', follows_me: 'none', mutual: false })
    expect(card.can_request).toBe(false) // Finn already follows
    expect(typeof card.can_find_gift).toBe('boolean')
    expect(Array.isArray(card.lists)).toBe(true)
    if (!(await m3Applied(t))) expect([card.can_find_gift, card.lists]).toEqual([false, []]) // M3 / M4 fill them
    expect(card.shared_occasions.map((o) => o.title)).toEqual(['Moritz’ Spieleabend'])
    const text = JSON.stringify(card)
    for (const other of [s.greta, s.rosa, s.moritz, s.bea]) expect(text).not.toContain(other)
    expect(text).not.toMatch(/follower_count|followers|following_count|"following"\s*:/)
  })

  it('the own card: self, no relation, nothing to request; a stranger who only asked is visible to the asked one', async () => {
    const own = await rpc<Card>(t, s.paula, 'get_profile_card', [s.paula])
    expect(own.relation).toEqual({ self: true, i_follow: 'none', follows_me: 'none', mutual: false })
    expect([own.can_request, own.shared_occasions]).toEqual([false, []])
    if (!(await m3Applied(t))) expect(own.lists).toEqual([])
    // Rosa (no shared occasion) is visible to Paula only through her visible request
    expect((await rpc<Card>(t, s.paula, 'get_profile_card', [s.rosa])).relation).toEqual({ self: false, i_follow: 'none', follows_me: 'requested', mutual: false })
    // Moritz shares O1 with Paula: visible, and the request rule says yes
    const moritz = await rpc<Card>(t, s.paula, 'get_profile_card', [s.moritz])
    expect(moritz.can_request).toBe(true)
    expect(moritz.shared_occasions.map((o) => o.id)).toEqual([s.o2, s.o1]) // upcoming ones by start: O2 (10 days), O1 (20 days)
  })
})
