/**
 * F05 — the silent refusal (follows-design §2.10, §5.4, INV-3, INV-3b, INV-6, P4, P5, review #2 / #3), with snapshots
 * of BOTH sides: the badge (get_me), get_lists_overview whole (stats + suggestions), get_people_screen, the cards of
 * each other (relation + can_request), the export, and the answers of request_follow*.
 *   INV-3   Rosa's snapshot is the same before and after Paula's refusal (byte for byte), and the same as the snapshot
 *           of a control requester (Anna) whom Paula did NOT refuse — also after both withdrew and asked again.
 *   INV-3b  Paula's snapshot does not move when the hidden Rosa withdraws, asks again, or her request expires and is
 *           purged; the only deliberate exception is Paula's own export (hidden_requests_received — and the link's
 *           use_count, which counts a new request whoever asks; the screens never show it).
 *   INV-6   block -> unblock -> ask again stays hidden until the OLD `until`; the silence only ends by time.
 *   remove_follower: a removed follower's new requests are hidden for 30 days, also after their block -> unblock.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, scalar, type TestDb } from '../../src/harness'
import { createMember, expectRpcError, rpc } from '../pilot/seed'
import { NAMES, exportOf, followRows, seedFollows, type FollowSeed } from './seed'
import { checkInvariants, cooldownRows, normalizeFor, relationSnapshot, type RelationSnapshotOptions } from './invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface People {
  requests_in: { profile: { id: string } }[]
  requests_out: { profile: { id: string } }[]
}
interface FollowsExport {
  following: { display_name: string; status: string }[]
  requests_received: { display_name: string }[]
  hidden_requests_received: { display_name: string }[]
  hidden_requesters: { display_name: string; until: string }[]
  follow_links: { use_count: number }[]
}

const inbox = async (uid: string) => (await rpc<{ inbox: { follow_requests: number } }>(t, uid, 'get_me')).inbox.follow_requests
const requestsIn = async (uid: string) => (await rpc<People>(t, uid, 'get_people_screen')).requests_in.map((r) => r.profile.id)
const followsExport = async (uid: string) => (await exportOf(t, uid))['follows'] as FollowsExport

/** INV-3b: the hider's snapshot without the deliberate export exception. */
const HIDER: RelationSnapshotOptions = {
  omitExport: (e) => {
    const f = e['follows'] as Record<string, unknown> & { follow_links: Record<string, unknown>[] }
    delete f['hidden_requests_received']
    for (const l of f.follow_links) delete l['use_count']
  },
}

describe('INV-3: the requester cannot tell a silent refusal from waiting', () => {
  let s: FollowSeed
  let anna: string
  beforeAll(async () => {
    s = await seedFollows(t)
    anna = await createMember(t, 'Anna') // control: asks the same way, is never refused
    await rpc(t, anna, 'request_follow_via_link', [s.token])
  })

  it('Rosa before and after the refusal: byte-identical; Rosa and Anna: identical up to their own id, name and times', async () => {
    const opts: RelationSnapshotOptions = { token: s.token, askAgain: true }
    const rosaBefore = await relationSnapshot(t, s.rosa, s.paula, opts)
    const annaBefore = await relationSnapshot(t, anna, s.paula, opts)
    expect(normalizeFor(rosaBefore, { id: s.rosa, name: NAMES.rosa })).toEqual(normalizeFor(annaBefore, { id: anna, name: 'Anna' }))
    expect(rosaBefore['request_follow']).toBe('{"status": "requested"}')
    expect(rosaBefore['request_follow_via_link']).toBe(`{"status": "requested", "profile_id": "${s.paula}"}`)
    // the snapshots carry real content (no "error vs error" equality)
    expect(rosaBefore['card']).toContain('"i_follow": "requested"')
    expect(rosaBefore['card']).toContain('"can_request": false')
    expect(rosaBefore['people']).toContain(s.paula)
    expect(rosaBefore['peek']).toContain('"i_follow": "requested"')
    expect(rosaBefore['export']).toContain('"status": "requested"')

    const cooldownsBefore = await cooldownRows(t)
    expect(await rpc(t, s.paula, 'respond_follow', [s.rosa, false])).toEqual({ ok: true })
    expect(await relationSnapshot(t, s.rosa, s.paula, opts)).toEqual(rosaBefore)
    // the row itself stays as it was: the refusal lives in Paula's silence only
    expect(await followRows(t, 'follower_id = $1', [s.rosa])).toEqual([{ follower_id: s.rosa, followee_id: s.paula, status: 'pending' }])
    await checkInvariants(t, { cooldownsBefore })
  })

  it('withdraw + ask again IN the silence looks exactly like withdraw + ask again without one', async () => {
    const opts: RelationSnapshotOptions = { token: s.token, askAgain: true }
    for (const who of [s.rosa, anna]) {
      expect(await rpc(t, who, 'unfollow', [s.paula])).toEqual({ ok: true })
      expect(await rpc(t, who, 'request_follow_via_link', [s.token])).toEqual({ status: 'requested', profile_id: s.paula })
    }
    const rosa = await relationSnapshot(t, s.rosa, s.paula, opts)
    const control = await relationSnapshot(t, anna, s.paula, opts)
    expect(normalizeFor(rosa, { id: s.rosa, name: NAMES.rosa })).toEqual(normalizeFor(control, { id: anna, name: 'Anna' }))
    // the requester's own export says "requested" — never "refused" or "hidden"
    expect((await followsExport(s.rosa)).following).toEqual([expect.objectContaining({ display_name: NAMES.paula, status: 'requested' })])
    expect(JSON.stringify(await exportOf(t, s.rosa))).not.toMatch(/hidden_requests_received":\s*\[\{|until/)
  })
})

describe('INV-3b: the silence is real for the one who hid', () => {
  it('Paula\'s badge, overview, people screen, card of Rosa and export do not move by anything Rosa does', async () => {
    const s = await seedFollows(t)
    expect(await inbox(s.paula)).toBe(1) // Rosa's request is visible before the refusal
    expect(await requestsIn(s.paula)).toEqual([s.rosa])
    await rpc(t, s.paula, 'respond_follow', [s.rosa, false])
    expect(await inbox(s.paula)).toBe(0)
    const before = await relationSnapshot(t, s.paula, s.rosa, HIDER)
    expect(before['card']).toBe('error:P0001:not_found') // no visible relation, no shared occasion
    expect((await followsExport(s.paula)).hidden_requests_received).toEqual([expect.objectContaining({ display_name: NAMES.rosa })])
    expect((await followsExport(s.paula)).hidden_requesters).toEqual([expect.objectContaining({ display_name: NAMES.rosa })])
    const cooldownsBefore = await cooldownRows(t)

    // Rosa withdraws
    await rpc(t, s.rosa, 'unfollow', [s.paula])
    expect(await relationSnapshot(t, s.paula, s.rosa, HIDER)).toEqual(before)
    expect((await followsExport(s.paula)).hidden_requests_received).toEqual([])
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.rosa, true]), 'not_found')

    // Rosa asks again — in the silence
    expect(await rpc(t, s.rosa, 'request_follow_via_link', [s.token])).toEqual({ status: 'requested', profile_id: s.paula })
    expect(await relationSnapshot(t, s.paula, s.rosa, HIDER)).toEqual(before)
    expect((await followsExport(s.paula)).hidden_requests_received).toEqual([expect.objectContaining({ display_name: NAMES.rosa })])
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.rosa, true]), 'not_found')
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.rosa, false]), 'not_found')

    // her request expires …
    await t.asService((tx) =>
      tx.query(`update follows set requested_at = now() - interval '31 days', expires_at = now() - interval '1 day' where follower_id = $1 and followee_id = $2`, [s.rosa, s.paula]),
    )
    expect(await relationSnapshot(t, s.paula, s.rosa, HIDER)).toEqual(before)
    expect((await followsExport(s.paula)).hidden_requests_received).toEqual([])
    // … and the daily purge removes it (the silence itself is still running and stays)
    await t.asService((tx) => tx.query('select private.purge_expired_records()'))
    expect(await followRows(t, 'follower_id = $1 and followee_id = $2', [s.rosa, s.paula])).toEqual([])
    expect(await relationSnapshot(t, s.paula, s.rosa, HIDER)).toEqual(before)
    await checkInvariants(t, { cooldownsBefore })
    expect(await cooldownRows(t)).toEqual(cooldownsBefore)
  })

  it('the requester\'s view after expiry is "none" again, exactly like any expired request (no trace of the silence)', async () => {
    const s = await seedFollows(t)
    await rpc(t, s.paula, 'respond_follow', [s.rosa, false])
    await t.asService((tx) =>
      tx.query(`update follows set requested_at = now() - interval '31 days', expires_at = now() - interval '1 day' where follower_id = $1`, [s.rosa]),
    )
    expect((await rpc<People>(t, s.rosa, 'get_people_screen')).requests_out).toEqual([])
    await expectRpcError(rpc(t, s.rosa, 'get_profile_card', [s.paula]), 'not_found') // no relation left, no shared occasion
    expect((await followsExport(s.rosa)).following).toEqual([]) // an expired, not yet purged row is not "requested"
  })
})

describe('INV-6: block → unblock → ask again stays hidden until the old `until`', () => {
  it('Rosa blocks Paula, unblocks, asks again: hidden until Paula\'s old silence ends; then it is visible again', async () => {
    const s = await seedFollows(t)
    await rpc(t, s.paula, 'respond_follow', [s.rosa, false])
    const silence = await cooldownRows(t)
    const paulasSilence = silence.find((c) => c.followee_id === s.paula && c.follower_id === s.rosa)!
    expect(paulasSilence).toBeDefined()

    expect(await rpc(t, s.rosa, 'block_user', [s.paula])).toEqual({ ok: true })
    expect(await followRows(t, '(follower_id = $1 and followee_id = $2) or (follower_id = $2 and followee_id = $1)', [s.rosa, s.paula])).toEqual([])
    await checkInvariants(t, { cooldownsBefore: silence })
    expect(await cooldownRows(t)).toEqual(silence) // the block erased nothing
    expect(await rpc(t, s.rosa, 'unblock_user', [s.paula])).toEqual({ ok: true })
    expect(await cooldownRows(t)).toEqual(silence)

    expect(await rpc(t, s.rosa, 'request_follow_via_link', [s.token])).toEqual({ status: 'requested', profile_id: s.paula })
    expect(await inbox(s.paula)).toBe(0)
    expect(await requestsIn(s.paula)).toEqual([])
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.rosa, true]), 'not_found')
    expect((await cooldownRows(t)).find((c) => c.followee_id === s.paula && c.follower_id === s.rosa)).toEqual(paulasSilence)

    // the superuser moves the silence into the past: the request is visible again and can be accepted
    await t.asService((tx) => tx.query(`update follow_cooldowns set until = now() - interval '1 second' where followee_id = $1 and follower_id = $2`, [s.paula, s.rosa]))
    expect(await inbox(s.paula)).toBe(1)
    expect(await requestsIn(s.paula)).toEqual([s.rosa])
    expect(await rpc(t, s.paula, 'respond_follow', [s.rosa, true])).toEqual({ ok: true })
    expect(await followRows(t, 'follower_id = $1', [s.rosa])).toEqual([{ follower_id: s.rosa, followee_id: s.paula, status: 'accepted' }])
  })

  it('a second refusal never shortens the silence: until = greatest(old, new)', async () => {
    const s = await seedFollows(t)
    await t.asService((tx) =>
      tx.query(`insert into follow_cooldowns (followee_id, follower_id, until) values ($1, $2, now() + interval '90 days')`, [s.paula, s.xaver]),
    )
    const longSilence = (await cooldownRows(t)).find((c) => c.follower_id === s.xaver)!
    // the superuser hides it for a moment so that Xaver's request can be refused "again"
    await t.asService((tx) => tx.query(`update follow_cooldowns set until = now() - interval '1 second' where follower_id = $1`, [s.xaver]))
    await rpc(t, s.xaver, 'request_follow_via_link', [s.token])
    await t.asService((tx) => tx.query(`update follow_cooldowns set until = to_timestamp($2::double precision / 1000) where follower_id = $1`, [s.xaver, longSilence.until_ms]))
    // with the long silence back in place the request is hidden; a fresh refusal is impossible (not visible) …
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.xaver, false]), 'not_found')
    // … and remove_follower's upsert keeps the later end, too
    await t.asService((tx) => tx.query(`update follows set status = 'accepted', accepted_at = now(), expires_at = null where follower_id = $1 and followee_id = $2`, [s.xaver, s.paula]))
    expect(await rpc(t, s.paula, 'remove_follower', [s.xaver])).toEqual({ ok: true })
    expect((await cooldownRows(t)).find((c) => c.follower_id === s.xaver)!.until_ms).toBe(longSilence.until_ms)
  })
})

describe('remove_follower', () => {
  it('ends the follow silently, sets a 30-day silence; the removed follower\'s new requests stay hidden, also after block → unblock', async () => {
    const s = await seedFollows(t)
    const before = await cooldownRows(t)
    expect(await rpc(t, s.paula, 'remove_follower', [s.finn])).toEqual({ ok: true })
    expect(await followRows(t, 'follower_id = $1 and followee_id = $2', [s.finn, s.paula])).toEqual([])
    const silence = (await cooldownRows(t)).find((c) => c.followee_id === s.paula && c.follower_id === s.finn)!
    const days = (silence.until_ms - Date.parse(await scalar<string>(t.db, 'select now()::text'))) / 86_400_000
    expect(days).toBeGreaterThan(29.99)
    await checkInvariants(t, { cooldownsBefore: before })

    // Finn still shares O2 with Paula: he sees her card and may ask again — hidden
    const card = await rpc<{ relation: Record<string, unknown>; can_request: boolean }>(t, s.finn, 'get_profile_card', [s.paula])
    expect(card.relation).toEqual({ self: false, i_follow: 'none', follows_me: 'none', mutual: false })
    expect(card.can_request).toBe(true)
    expect(await rpc(t, s.finn, 'request_follow', [s.paula])).toEqual({ status: 'requested' })
    expect(await inbox(s.paula)).toBe(1) // Rosa only
    expect(await requestsIn(s.paula)).toEqual([s.rosa])
    // block → unblock by Finn does not shorten Paula's silence
    const withSilence = await cooldownRows(t)
    await rpc(t, s.finn, 'block_user', [s.paula])
    await rpc(t, s.finn, 'unblock_user', [s.paula])
    expect(await cooldownRows(t)).toEqual(withSilence)
    expect(await rpc(t, s.finn, 'request_follow', [s.paula])).toEqual({ status: 'requested' })
    expect(await requestsIn(s.paula)).toEqual([s.rosa])

    // the same answer whatever: a second removal, a non-follower, nobody, null
    await expectRpcError(rpc(t, s.paula, 'remove_follower', [s.finn]), 'not_found') // only waiting now
    await expectRpcError(rpc(t, s.paula, 'remove_follower', [s.xaver]), 'not_found')
    await expectRpcError(rpc(t, s.paula, 'remove_follower', [s.rosa]), 'not_found') // waiting, not following
    await expectRpcError(rpc(t, s.paula, 'remove_follower', [null]), 'not_found')
    await checkInvariants(t, { cooldownsBefore: withSilence })
  })

  it('respond_follow: validation for a missing answer, not_found for nobody / null; refusing needs no consents, accepting does', async () => {
    const s = await seedFollows(t)
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.rosa, null]), 'validation')
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [null, true]), 'not_found')
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.xaver, true]), 'not_found')
    await t.asService((tx) => tx.query(`delete from consents where profile_id = $1 and kind = 'terms'`, [s.paula]))
    await expectRpcError(rpc(t, s.paula, 'respond_follow', [s.rosa, true]), 'consent_required')
    expect(await rpc(t, s.paula, 'respond_follow', [s.rosa, false])).toEqual({ ok: true })
    expect(await inbox(s.paula)).toBe(0)
  })
})
