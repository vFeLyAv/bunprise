/**
 * The contract of the M2 screens for the UI chain (follows-design §5.2): exact jsonb keys and the fixed orders of
 * get_people_screen (requests_in / requests_out / followers / following / blocked / links), the answers of
 * request_follow / request_follow_via_link / create_follow_link, get_me.inbox and the stats of get_lists_overview.
 * Orders never depend on reservations: requests newest first, followers / following by display_name, id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../../src/harness'
import { createMember, rpc } from '../pilot/seed'
import { NAMES, followLink, seedFollows, type FollowSeed } from './seed'

let t: TestDb
let s: FollowSeed
let anna: string
beforeAll(async () => {
  t = await createTestDb()
  s = await seedFollows(t)
  anna = await createMember(t, 'Anna') // asks after Rosa: newest first in requests_in
  await rpc(t, anna, 'request_follow_via_link', [s.token])
  // Paula follows Moritz (shared O1): accepted, so her "following" is not empty
  await rpc(t, s.paula, 'request_follow', [s.moritz])
  await rpc(t, s.moritz, 'respond_follow', [s.paula, true])
  // Paula asks Greta (via Greta's link): an outgoing request
  await rpc(t, s.paula, 'request_follow_via_link', [await followLink(t, s.greta)])
})
afterAll(() => t.close())

// + the photo meta of 20261024120000 (nobody of the seed has a photo)
const card = (id: string, name: string) => ({ id, display_name: name, banner: null, photo: null, banner_photo: null })

interface People {
  requests_in: Record<string, unknown>[]
  requests_out: Record<string, unknown>[]
  followers: Record<string, unknown>[]
  following: Record<string, unknown>[]
  blocked: Record<string, unknown>[]
  links: Record<string, unknown>[]
}

describe('get_people_screen', () => {
  it('exact keys and orders', async () => {
    const p = await rpc<People>(t, s.paula, 'get_people_screen')
    expect(Object.keys(p).sort()).toEqual(['blocked', 'followers', 'following', 'links', 'requests_in', 'requests_out'])
    expect(p.requests_in).toEqual([
      { profile: card(anna, 'Anna'), requested_at: expect.any(String), shared_occasions: [], i_follow: 'none' },
      { profile: card(s.rosa, NAMES.rosa), requested_at: expect.any(String), shared_occasions: [], i_follow: 'none' },
    ])
    expect(p.requests_out).toEqual([{ profile: card(s.greta, NAMES.greta), requested_at: expect.any(String), expires_at: expect.any(String) }])
    // followers by display_name: Finn, Greta; Paula asked Greta back -> i_follow 'requested'
    expect(p.followers).toEqual([
      { profile: card(s.finn, NAMES.finn), accepted_at: expect.any(String), i_follow: 'none' },
      { profile: card(s.greta, NAMES.greta), accepted_at: expect.any(String), i_follow: 'requested' },
    ])
    expect(p.following).toEqual([{ profile: card(s.moritz, NAMES.moritz), accepted_at: expect.any(String), follows_me: 'none' }])
    expect(p.blocked).toEqual([{ profile_id: s.bea, display_name: NAMES.bea, blocked_at: expect.any(String) }])
    expect(p.links).toEqual([{ created_at: expect.any(String), expires_at: expect.any(String) }])
  })

  it('the other sides: Moritz sees Paula as follower (mutual not yet); Greta sees Paula\'s request with the context', async () => {
    const m = await rpc<People>(t, s.moritz, 'get_people_screen')
    expect(m.followers).toEqual([{ profile: card(s.paula, NAMES.paula), accepted_at: expect.any(String), i_follow: 'none' }])
    const g = await rpc<People>(t, s.greta, 'get_people_screen')
    // Greta already follows Paula: the context "Du folgst Paula" comes from i_follow
    expect(g.requests_in).toEqual([{ profile: card(s.paula, NAMES.paula), requested_at: expect.any(String), shared_occasions: [], i_follow: 'following' }])
    expect(g.following).toEqual([{ profile: card(s.paula, NAMES.paula), accepted_at: expect.any(String), follows_me: 'requested' }])
    // the context "Gemeinsam in: …": Paula's card of Finn names their shared occasion O2 (Moritz's)
    const finnCtx = await rpc<{ shared_occasions: { id: string; title: string; starts_at: string }[] }>(t, s.paula, 'get_profile_card', [s.finn])
    expect(finnCtx.shared_occasions).toEqual([{ id: s.o2, title: 'Moritz’ Spieleabend', starts_at: expect.any(String) }])
  })
})

describe('answers of the actions, the badge and the stats', () => {
  it('request answers, create_follow_link, get_me.inbox, get_lists_overview stats', async () => {
    const xLink = await rpc<Record<string, unknown>>(t, s.xaver, 'create_follow_link')
    expect(Object.keys(xLink).sort()).toEqual(['expires_at', 'token'])
    expect(await rpc(t, s.paula, 'request_follow_via_link', [xLink['token']])).toEqual({ status: 'requested', profile_id: s.xaver })
    expect(await rpc(t, s.paula, 'request_follow', [s.moritz])).toEqual({ status: 'following' })
    // (+ occasion_invites since 20261027120000: nobody invited them in-app here)
    expect((await rpc<{ inbox: unknown }>(t, s.paula, 'get_me')).inbox).toEqual({ follow_requests: 2, occasion_invites: 0 }) // Rosa, Anna
    expect((await rpc<{ inbox: unknown }>(t, s.xaver, 'get_me')).inbox).toEqual({ follow_requests: 1, occasion_invites: 0 }) // Paula
    const ov = await rpc<{ me: Record<string, unknown>; stats: Record<string, number> }>(t, s.paula, 'get_lists_overview')
    expect(ov.me).toEqual({ id: s.paula, display_name: NAMES.paula, banner: null, photo: null, banner_photo: null, live_links: 1 })
    expect(ov.stats).toMatchObject({ followers: 2, following: 1, requests: 2 })
    expect(Object.keys(ov.stats).sort()).toEqual(['followers', 'following', 'friends_lists', 'my_lists', 'my_wishes', 'requests'])
  })
})
