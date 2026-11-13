/**
 * The database "red button" (follows-design §3.4, §9, A14, review #10; M3 private.features + the emergency template
 * supabase/emergency/follower_lists_off.sql — played here exactly as written, as one transaction):
 *   after it, followers read nothing of a follower list (REST rows, screen, card, overview, gift search) and cannot
 *   reserve; every active reservation on a list without an occasion is ended as access_ended (INV-1); occasion lists,
 *   follows, requests and links are untouched; the owners' own answers do not change at all; switching back on
 *   (one statement) makes the lists readable again but brings no reservation back. A missing switch row reads as OFF.
 *   The template is not a migration (no harness applies it by itself).
 */
import { readdir, readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { expectRpcError, queryAs, rpc } from '../pilot/seed'
import { RED_BUTTON_FILE, followRows, pressRedButton, releaseRedButton, rpcOutcome, rpcText, seedFollows, type FollowSeed } from '../follows/seed'
import { checkInvariants, cooldownRows } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const switchState = () => scalar<boolean>(t.db, 'select follower_lists from private.features')

/** The owner's own answers that must not move with the switch (her branches never look at it). */
async function ownerOwnView(s: FollowSeed): Promise<Record<string, string>> {
  const overview = JSON.parse(await rpcText(t, s.paula, 'get_lists_overview')) as Record<string, unknown>
  return {
    l1: await rpcText(t, s.paula, 'get_list_screen', [s.l1]),
    l2: await rpcText(t, s.paula, 'get_list_screen', [s.l2]),
    o1: await rpcText(t, s.paula, 'get_occasion_screen', [s.o1]),
    myLists: JSON.stringify(overview['my_lists']),
    stats: JSON.stringify(overview['stats']),
    people: await rpcText(t, s.paula, 'get_people_screen'),
    me: await rpcText(t, s.paula, 'get_me'),
    card: await rpcText(t, s.paula, 'get_profile_card', [s.paula]),
    lists: JSON.stringify(await queryAs(t, s.paula, 'select id, title, visibility, cover_tone, cover_icon, due_on from wishlists where owner_id = $1 order by id', [s.paula])),
  }
}

describe('the template', () => {
  // since 20261027200000 (lazy liveness) the template does no reservation work: the cleanup ends the dead rows
  it('lives outside supabase/migrations/ and does exactly: lock profiles -> lock follows -> switch off', async () => {
    const sql = await readFile(RED_BUTTON_FILE, 'utf8')
    // ONE do-block and nothing else (supabase db push runs statements outside a transaction: a top-level LOCK fails, 27.10)
    const body = /^\s*do \$\$\s*begin\s*([\s\S]*?)\s*end \$\$;\s*$/i.exec(sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'))?.[1]
    expect(body, 'the template is one do-block').toBeDefined()
    const statements = (body ?? '')
      .split(';')
      .map((x) => x.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    expect(statements).toEqual([
      'lock table public.profiles in exclusive mode',
      'lock table public.follows in exclusive mode',
      'update private.features set follower_lists = false',
    ])
    for (const file of await readdir(MIGRATIONS_DIR)) {
      expect(await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8'), file).not.toMatch(/update\s+private\.features\s+set\s+follower_lists\s*=\s*false/i)
    }
    expect(await switchState()).toBe(true) // the migrations leave it on
  })

  it('private.features: one row, RLS forced, no policy, no privilege for any API role', async () => {
    expect(await rows(t.db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'private.features'::regclass`)).toEqual([
      { relrowsecurity: true, relforcerowsecurity: true },
    ])
    expect(await rows(t.db, `select policyname from pg_policies where schemaname = 'private' and tablename = 'features'`)).toEqual([])
    for (const who of ['anon', 'authenticated', 'public']) {
      for (const priv of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
        expect(await scalar<boolean>(t.db, `select has_table_privilege($1, 'private.features', $2)`, [who, priv]), `${who} ${priv}`).toBe(false)
      }
      for (const priv of ['select', 'insert', 'update', 'references']) {
        expect(await scalar<boolean>(t.db, `select has_any_column_privilege($1, 'private.features', $2)`, [who, priv]), `${who} column ${priv}`).toBe(false)
      }
    }
    expect(await scalar<number>(t.db, 'select count(*)::int from private.features')).toBe(1)
    await expectDbError(t.asService((tx) => tx.query('insert into private.features (singleton) values (true)')), '23505')
    await expectDbError(t.asService((tx) => tx.query('insert into private.features (singleton) values (false)')), '23514')
    const s = await seedFollows(t)
    for (const sql of ['select follower_lists from private.features', 'update private.features set follower_lists = false', 'select private.follower_lists_on()']) {
      const err = await expectDbError(t.asUser(s.finn, (tx) => tx.query(sql)), '42501')
      expect(err.message, sql).toMatch(/permission denied/)
      await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
    }
    expect(await switchState()).toBe(true)
  })
})

describe('pressing it', () => {
  let s: FollowSeed
  let before: Record<string, string>
  beforeAll(async () => {
    s = await seedFollows(t)
    await rpc(t, s.finn, 'accept_invite', [s.o1Invite])
    await rpc(t, s.finn, 'reserve_wish', [s.l1Wishes[0]])
    await rpc(t, s.greta, 'reserve_wish', [s.l1Wishes[1]])
    await rpc(t, s.finn, 'reserve_wish', [s.o1Wish]) // an occasion list: not a follower path
    before = await ownerOwnView(s)
  })

  it('the follower reservations are dead at once (the cleanup ends them); occasion reservations, follows and links stay', async () => {
    const follows = await followRows(t)
    const links = await rows(t.db, 'select id, revoked_at from follow_links order by id')
    const cooldownsBefore = await cooldownRows(t)
    await pressRedButton(t)
    expect(await switchState()).toBe(false)
    expect((await rpc<{ status: string; end_reason: string | null }[]>(t, s.greta, 'my_reservations')).map((r) => [r.status, r.end_reason])).toEqual([['ended', 'unavailable']])
    await checkInvariants(t, { cooldownsBefore }) // (runs the cleanup)
    expect(await rows(t.db, `select wish_id, status, end_reason from reservations order by created_at`)).toEqual([
      { wish_id: s.l1Wishes[0], status: 'ended', end_reason: 'access_ended' },
      { wish_id: s.l1Wishes[1], status: 'ended', end_reason: 'access_ended' },
      { wish_id: s.o1Wish, status: 'active', end_reason: null },
    ])
    expect(await followRows(t)).toEqual(follows)
    expect(await rows(t.db, 'select id, revoked_at from follow_links order by id')).toEqual(links)
  })

  it('followers read nothing and reserve nothing; the gift search and the overview are closed for follower lists', async () => {
    const [w1, , w3] = s.l1Wishes
    for (const uid of [s.finn, s.greta]) {
      expect(await queryAs(t, uid, 'select id from wishlists where id = $1', [s.l1])).toEqual([])
      expect(await queryAs(t, uid, 'select id from wishes where wishlist_id = $1', [s.l1])).toEqual([])
      expect(await rpcOutcome(t, uid, 'get_list_screen', [s.l1])).toBe('error:P0001:not_found')
      await expectRpcError(rpc(t, uid, 'reserve_wish', [w3]), 'not_allowed')
      await expectRpcError(rpc(t, uid, 'cancel_reservation', [w1]), 'not_allowed')
      const card = await rpc<{ lists: unknown[]; relation: { i_follow: string } }>(t, uid, 'get_profile_card', [s.paula])
      expect(card.lists).toEqual([])
      expect(card.relation.i_follow).toBe('following') // the follow itself stays
      const ov = await rpc<{ following: { lists: unknown[] }[] }>(t, uid, 'get_lists_overview')
      expect(ov.following.map((f) => f.lists)).toEqual([[]])
    }
    expect(await rpcOutcome(t, s.greta, 'get_free_wishes', [s.paula, null])).toBe('error:P0001:not_found')
    // Finn is also a guest of O1: that list stays open for him (occasion lists are not behind the switch)
    expect(await rpc(t, s.finn, 'cancel_reservation', [s.o1Wish])).toEqual({ ok: true })
    expect(await rpc(t, s.finn, 'reserve_wish', [s.o1Wish])).toEqual({ ok: true })
    await checkInvariants(t)
  })

  it('the owner notices nothing: her own screens, lists, people and stats are byte-identical', async () => {
    expect(await ownerOwnView(s)).toEqual(before)
    // her own lists stay fully hers (REST too): the owner's short path never asks the switch
    expect(await rpcOutcome(t, s.paula, 'get_list_screen', [s.l1])).toContain('"role": "owner"')
    expect(await queryAs(t, s.paula, 'select id from wishes where wishlist_id = $1', [s.l1])).toHaveLength(3)
  })

  it('switching back on opens the lists again — the ended reservations do not come back', async () => {
    await releaseRedButton(t)
    expect(await switchState()).toBe(true)
    const screen = await rpc<{ viewer: { role: string }; wishes: { id: string; reserved: boolean; reserved_by_me: boolean }[] }>(t, s.finn, 'get_list_screen', [s.l1])
    expect(screen.viewer.role).toBe('follower')
    expect(screen.wishes.every((w) => !w.reserved && !w.reserved_by_me)).toBe(true)
    expect(await rpc(t, s.greta, 'reserve_wish', [s.l1Wishes[0]])).toEqual({ ok: true })
    expect(await ownerOwnView(s)).toEqual(before)
    await checkInvariants(t)
  })

  it('a missing switch row reads as OFF (closed by default)', async () => {
    await t.asService((tx) => tx.query('delete from private.features'))
    try {
      expect(await scalar<boolean>(t.db, 'select private.follower_lists_on()')).toBe(false)
      expect(await rpcOutcome(t, s.finn, 'get_list_screen', [s.l1])).toBe('error:P0001:not_found')
    } finally {
      await t.asService((tx) => tx.query('insert into private.features default values')) // default: on
    }
    expect(await switchState()).toBe(true)
    await checkInvariants(t) // on again: Greta reads L1, so her reservation is consistent (INV-1)
  })
})
