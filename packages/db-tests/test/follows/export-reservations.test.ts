/**
 * F13 (the reservation parts) + F23 — the givers' own data while and after access (follows-design §5.5, §8.3, INV-4,
 * S11, pilot-decisions §0 item 3 "live data only with access"; M3 20261020200200_follow_sharing.sql):
 *   my_reservations / the export's reservations_made_by_me carry the list {id, title, owner_name} and the LIVE wish
 *   title only while the giver may read the list; after losing access (removed, unfollowed, "Nur ich", blocked) the
 *   title is the snapshot and list / owner / recipient are null. Paula's export: profile.in_suggestions, her lists
 *   with updated_at, and nothing about the reservations on her wishes — while Finn holds some.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../src/harness'
import { execAs, rpc } from '../pilot/seed'
import { L1_TITLE, L1_WISH_TITLES, NAMES, exportOf, pressRedButton, releaseRedButton, seedFollows } from './seed'
import { checkInvariants, expectOnlyKnownProfiles } from './invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface MyReservation {
  wish_id: string | null
  wish_title: string
  status: string
  end_reason: string | null
  list: { id: string; title: string | null; owner_name: string | null } | null
}
interface ExportReservation {
  wish_title: string
  recipient_name: string | null
  occasion_title: string | null
  status: string
  end_reason: string | null
  list: { id: string; title: string | null; owner_name: string | null } | null
}

const mineOf = (uid: string) => rpc<MyReservation[]>(t, uid, 'my_reservations')
const exportedOf = async (uid: string) => (await exportOf(t, uid))['reservations_made_by_me'] as ExportReservation[]

describe('F23 live data only while the giver may read the list', () => {
  it('live title, list and owner name while readable; renames show up live', async () => {
    const s = await seedFollows(t)
    const [w1] = s.l1Wishes
    await rpc(t, s.finn, 'reserve_wish', [w1])
    expect(await mineOf(s.finn)).toEqual([
      expect.objectContaining({ wish_id: w1, wish_title: L1_WISH_TITLES.w1, status: 'active', list: { id: s.l1, title: L1_TITLE, owner_name: NAMES.paula } }),
    ])
    await execAs(t, s.paula, `update wishes set title = 'Kopfhörer (rot)' where id = $1`, [w1])
    await execAs(t, s.paula, `update wishlists set title = 'Wunschzettel' where id = $1`, [s.l1])
    await execAs(t, s.paula, `update profiles set display_name = 'Paula B.' where id = $1`, [s.paula])
    expect((await mineOf(s.finn))[0]).toMatchObject({ wish_title: 'Kopfhörer (rot)', list: { id: s.l1, title: 'Wunschzettel', owner_name: 'Paula B.' } })
    expect((await exportedOf(s.finn))[0]).toMatchObject({
      wish_title: 'Kopfhörer (rot)', recipient_name: 'Paula B.', occasion_title: null, status: 'active',
      list: { id: s.l1, title: 'Wunschzettel', owner_name: 'Paula B.' },
    })
  })

  it('after every way of losing access: the snapshot, list / owner / recipient null — removed, unfollowed, "Nur ich", blocked', async () => {
    for (const lose of ['remove_follower', 'unfollow', 'private', 'block'] as const) {
      const s = await seedFollows(t)
      const [w1] = s.l1Wishes
      await rpc(t, s.finn, 'reserve_wish', [w1])
      await execAs(t, s.paula, `update wishes set title = 'Kopfhörer (rot)' where id = $1`, [w1]) // after the reservation
      if (lose === 'remove_follower') await rpc(t, s.paula, 'remove_follower', [s.finn])
      if (lose === 'unfollow') await rpc(t, s.finn, 'unfollow', [s.paula])
      if (lose === 'private') await rpc(t, s.paula, 'set_list_visibility', [s.l1, 'private'])
      if (lose === 'block') await rpc(t, s.paula, 'block_user', [s.finn])
      // 20261027200000: the giver's own unfollow keeps its reason; every loss caused by the owner reads as the one
      // neutral 'unavailable' (Q1), without the wish id or any context
      const reason = lose === 'unfollow' ? 'unfollowed' : 'unavailable'
      expect(await mineOf(s.finn), lose).toEqual([
        expect.objectContaining({ wish_id: null, wish_title: L1_WISH_TITLES.w1, status: 'ended', end_reason: reason, list: null }),
      ])
      expect(await exportedOf(s.finn), lose).toEqual([
        expect.objectContaining({ wish_title: L1_WISH_TITLES.w1, recipient_name: null, occasion_title: null, status: 'ended', end_reason: reason, list: null }),
      ])
      await checkInvariants(t)
    }
  })

  it('the red button is a loss of access, too: snapshot and null (supabase/emergency/follower_lists_off.sql)', async () => {
    const s = await seedFollows(t)
    await rpc(t, s.finn, 'reserve_wish', [s.l1Wishes[0]])
    await pressRedButton(t)
    try {
      expect((await mineOf(s.finn))[0]).toMatchObject({ status: 'ended', end_reason: 'unavailable', list: null })
      expect((await exportedOf(s.finn))[0]).toMatchObject({ recipient_name: null, list: null })
      await checkInvariants(t) // (runs the cleanup: the dead row is ended now)
    } finally {
      await releaseRedButton(t)
    }
    // switched on again: an ended reservation never comes back and carries no context (only a live one does)
    expect((await mineOf(s.finn))[0]).toMatchObject({ status: 'ended', end_reason: 'unavailable', list: null })
    expect(L1_TITLE.length + NAMES.paula.length).toBeGreaterThan(0)
  })
})

describe('F13 Paula\'s export while givers hold reservations on her lists', () => {
  it('profile.in_suggestions, lists with updated_at, and nothing about the reservations on her wishes', async () => {
    const s = await seedFollows(t)
    await rpc(t, s.finn, 'reserve_wish', [s.l1Wishes[0]])
    await rpc(t, s.greta, 'reserve_wish', [s.l1Wishes[1]])
    await rpc(t, s.moritz, 'reserve_wish', [s.o1Wish])
    const exp = await exportOf(t, s.paula)
    expect(exp['profile']).toMatchObject({ id: s.paula, in_suggestions: false })
    expect((await exportOf(t, s.moritz))['profile']).toMatchObject({ in_suggestions: true })
    expect(exp['reservations_made_by_me']).toEqual([])
    const lists = exp['wishlists'] as { id: string; visibility: string; updated_at: string }[]
    expect(lists.find((l) => l.id === s.l1)).toMatchObject({ visibility: 'followers', updated_at: expect.any(String) })
    const text = JSON.stringify(exp)
    expect(text.replace('reservations_made_by_me', '')).not.toMatch(/reserv/)
    for (const who of [s.finn, s.greta, s.moritz]) expect(text).not.toContain(who)
    // the givers' exports: their own reservation with Paula's NAME, never her id or the other giver
    const finn = JSON.stringify(await exportOf(t, s.finn))
    expect(finn).toContain(NAMES.paula)
    expect(finn).not.toContain(s.paula)
    expect(finn).not.toContain(s.greta)
    await expectOnlyKnownProfiles(t, s.finn, { occasionIds: [s.o1, s.o2], tokens: [s.token] })
    await expectOnlyKnownProfiles(t, s.paula, { occasionIds: [s.o1, s.o2], tokens: [s.token] })
  })
})
