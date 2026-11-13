/**
 * F18 — branch markers in the function text (follows-design §5.5, S4): the owner's paths never even NAME the
 * reservation table. pg_proc.prosrc is the body as stored.
 *   get_list_screen      the text after the line "-- OWNER BRANCH" up to the next "-- <NAME> BRANCH" marker (or the end)
 *                        contains no "reservations";
 *   get_lists_overview   no "reservations" anywhere in the body (no card of the overview has a reservation key, §2.4);
 *   the people / link / follow RPCs of M2 never touch reservations except through the two end_* helpers (unfollow,
 *   remove_follower, block_user) — and the screens (cards, people, peek, get_me) not at all.
 *   get_occasion_screen  the pilot's rule keeps holding after M1 re-created it (owner branch before the member branch).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, scalar, type TestDb } from '../../src/harness'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

function prosrc(fn: string, schema = 'public'): Promise<string> {
  return scalar<string>(t.db, `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $2 and p.proname = $1`, [fn, schema])
}

/** The text after the marker line up to the next "-- <WORD> BRANCH" marker line (or the end of the body). */
function branchAfter(body: string, marker: string): string {
  const lines = body.split('\n')
  const start = lines.findIndex((l) => l.includes(`-- ${marker}`))
  expect(start, `marker "-- ${marker}" missing`).toBeGreaterThanOrEqual(0)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /--\s*[A-Z]+ BRANCH/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n')
}

describe('F18 branch markers', () => {
  // since 20261027200000 the wishes of both list screens come from private.list_wish_objects (OWNER BRANCH, then
  // AUDIENCE BRANCH); the screens themselves never name the table
  it('get_list_screen / list_wish_objects: the OWNER BRANCH does not mention reservations, nor anything before the audience branch', async () => {
    expect(await prosrc('get_list_screen')).not.toMatch(/reservation/i)
    const body = await prosrc('list_wish_objects', 'private')
    const owner = branchAfter(body, 'OWNER BRANCH')
    expect(owner).toContain('null::boolean')
    expect(owner.replace(/--[^\n]*/g, '')).not.toMatch(/reservations/i)
    const audience = body.search(/--\s*AUDIENCE BRANCH/)
    expect(audience).toBeGreaterThan(0)
    expect(body.slice(0, audience).replace(/--[^\n]*/g, '')).not.toMatch(/reservations/i)
    // the owner helpers it calls never name the table either
    for (const fn of ['owner_list_wishes', 'wish_places_for_owner', 'received_prompt_due', 'occasion_wishlist_json']) {
      expect((await prosrc(fn, 'private')).replace(/--[^\n]*/g, ''), fn).not.toMatch(/reservations/i)
    }
  })

  it('get_lists_overview: the word "reservations" appears nowhere in the body; the owner part is marked', async () => {
    const body = await prosrc('get_lists_overview')
    expect(body).toContain('-- OWNER BRANCH: wishlists + stored places only')
    expect(body).not.toMatch(/reservation/i)
  })

  it('the people / card / link screens and get_me never touch reservations', async () => {
    for (const fn of ['get_profile_card', 'get_people_screen', 'peek_follow_link', 'get_me', 'request_follow', 'request_follow_via_link',
      'respond_follow', 'create_follow_link', 'revoke_follow_links', 'remove_follower', 'remove_member', 'block_user',
      'delete_my_account', 'set_list_visibility', 'move_wish', 'add_wishes_to_list', 'remove_wish_from_list',
      'delete_wish_everywhere', 'dismiss_received_prompt']) {
      // 20261027200000 (INV-7 a): no owner action names the table — not even through an end_* helper
      expect((await prosrc(fn)).replace(/--[^\n]*/g, ''), fn).not.toMatch(/reservation/i)
    }
    // the giver's OWN narrowing actions end only their own dead rows, through the one helper (index on reserver_id)
    for (const fn of ['unfollow', 'leave_occasion']) {
      const body = await prosrc(fn)
      expect(body, fn).toContain('private.end_own_dead_reservations(v_uid,')
      expect(body, fn).not.toMatch(/public\.reservations/)
    }
  })

  it('get_occasion_screen (re-created with `v_wl record`): the wish part comes from private.occasion_wishlist_json; no reservation in its text', async () => {
    const body = await prosrc('get_occasion_screen')
    expect(body).toMatch(/v_wl\s+record/)
    expect(body).not.toMatch(/wishlists%rowtype/)
    expect(body).toContain('private.occasion_wishlist_json(v_wl.id, v_uid)')
    expect(body.replace(/--[^\n]*/g, '')).not.toMatch(/reservation/i)
    expect(body).toContain("'photo'") // agent G's key survives the re-creation
  })

  it('no function of public / private still declares a wishlists %rowtype (strict_multi_assignment, A10)', async () => {
    const offenders = await scalar<string[]>(
      t.db,
      `select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosrc ~* 'wishlists%rowtype'`,
    )
    expect(offenders).toEqual([])
  })
})
