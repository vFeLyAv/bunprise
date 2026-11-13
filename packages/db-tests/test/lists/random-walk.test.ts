/**
 * F19 + F20 — the seeded random walk (follows-design §7.2 F19 / F20, §6.2; M1–M4 + the red button):
 *   400 steps, 6 people (a deleted account is replaced by a new person), a fixed seed. Steps: reserve, cancel, both
 *   kinds of requests, answer, withdraw / unfollow, remove a follower, block, unblock, visibility, the suggestions
 *   switch, creating and deleting lists and wishes, joining / leaving / removing from occasions, new occasions, links
 *   (create / revoke), deleting an account, and the red button off / on — played exactly as the emergency template
 *   supabase/emergency/follower_lists_off.sql (§9).
 *   After EVERY step: INV-1 (no active reservation without access), INV-5 (no follow inside a blocked pair), INV-6
 *   (no silence got shorter; only the account cascade removes one) and the pilot rules; every refusal is a code of the
 *   contract (P0001 + a known message) — nothing else may fail.
 *   F20: around every reserve / cancel step the owner of the wish's list gets byte-identical answers (every read RPC,
 *   the export, the own screens, the REST rows of the own lists and wishes).
 * Reproducible: every choice comes from the seeded generator and from registries kept in creation order (never from
 * the order of random UUIDs).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, isDbError, rows, scalar, type TestDb } from '../../src/harness'
import { createMember, queryAs, rpc } from '../pilot/seed'
import { UNKNOWN_ID, addWish, createList, createOccasion, followLink, invite, pressRedButton, releaseRedButton, rpcOutcome } from '../follows/seed'
import { checkInvariants, cooldownRows } from '../follows/invariants'

/** The fixed seed of the suite; F19_SEED=<n> replays another walk locally (e.g. to hunt a finding). */
const SEED = Number(process.env['F19_SEED'] ?? 0x2b20_1020)
const STEPS = Number(process.env['F19_STEPS'] ?? 400)
/** The error codes of the RPC contract (pilot-decisions §2 + limit_reached, follows-design §5.1). */
const CONTRACT = new Set(['not_allowed', 'not_found', 'already_reserved', 'invite_invalid', 'consent_required', 'profile_incomplete', 'validation', 'limit_reached'])
const LIST_COLS = 'id, occasion_id, owner_id, recipient_id, title, created_at, visibility, cover_tone, cover_icon, due_on'
const WISH_COLS = 'id, wishlist_id, title, price_cents, currency, url, note, priority, created_at'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

/** mulberry32: a tiny seeded generator, [0, 1). */
function generator(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = a
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

interface ListEntry { id: string; owner: string; occasion: string | null }
interface WishEntry { id: string; list: string }
interface OccasionEntry { id: string; host: string; list: string }
interface TokenEntry { owner: string; token: string }

/** Everything the owner can read about their own world (F20 / INV-2). */
async function ownerBytes(uid: string): Promise<string[]> {
  const out: string[] = []
  for (const fn of ['get_me', 'get_feed', 'get_lists_overview', 'get_people_screen', 'my_reservations']) out.push(await rpcOutcome(t, uid, fn))
  out.push(await t.asUser(uid, (tx) => scalar<string>(tx, `select (public.export_my_data() - 'exported_at')::text`)))
  out.push(await rpcOutcome(t, uid, 'get_profile_card', [uid]))
  const own = await rows<{ id: string; occasion_id: string | null }>(t.db, 'select id, occasion_id from wishlists where owner_id = $1 order by id', [uid])
  for (const l of own) {
    out.push(l.occasion_id ? await rpcOutcome(t, uid, 'get_occasion_screen', [l.occasion_id]) : await rpcOutcome(t, uid, 'get_list_screen', [l.id]))
  }
  out.push(JSON.stringify(await queryAs(t, uid, `select ${LIST_COLS} from wishlists where owner_id = $1 order by id`, [uid])))
  out.push(
    JSON.stringify(
      await queryAs(t, uid, `select ${WISH_COLS} from wishes w where exists (select 1 from wishlists wl where wl.id = w.wishlist_id and wl.owner_id = $1) order by id`, [uid]),
    ),
  )
  return out
}

describe('F19 + F20 the random walk', () => {
  it('400 steps, 6 people, fixed seed: the invariants after every step; owners byte-identical around reserve / cancel', async () => {
    const rnd = generator(SEED)
    const chance = (p: number) => rnd() < p
    const pick = <T>(xs: readonly T[]): T | undefined => (xs.length === 0 ? undefined : xs[Math.floor(rnd() * xs.length)])

    // ---- registries in creation order --------------------------------------------------------------------
    const BASE = ['Paula', 'Finn', 'Greta', 'Rosa', 'Moritz', 'Xaver']
    const slots: string[] = []
    const lists: ListEntry[] = []
    const wishes: WishEntry[] = []
    const occasions: OccasionEntry[] = []
    const tokens: TokenEntry[] = []
    let born = 0

    const alive = async (table: 'profiles' | 'wishlists' | 'wishes' | 'occasions', ids: readonly string[]): Promise<Set<string>> => {
      if (ids.length === 0) return new Set()
      const r = await rows<{ id: string }>(t.db, `select id from public.${table} where id = any($1::uuid[])`, [ids])
      return new Set(r.map((x) => x.id))
    }
    const aliveWishes = async () => {
      const set = await alive('wishes', wishes.map((w) => w.id))
      return wishes.filter((w) => set.has(w.id))
    }
    const aliveLists = async (owner?: string) => {
      const set = await alive('wishlists', lists.map((l) => l.id))
      return lists.filter((l) => set.has(l.id) && (owner === undefined || l.owner === owner))
    }
    const aliveOccasions = async () => {
      const set = await alive('occasions', occasions.map((o) => o.id))
      return occasions.filter((o) => set.has(o.id))
    }
    const ownerOfWish = (wishId: string) => lists.find((l) => l.id === wishes.find((w) => w.id === wishId)?.list)?.owner
    const others = (uid: string) => slots.filter((x) => x !== uid)
    /** ids from a superuser query, kept in the order of `order` (never the order of the UUIDs) */
    const ordered = async (order: readonly string[], sql: string, params: readonly unknown[]): Promise<string[]> => {
      const set = new Set((await rows<{ id: string }>(t.db, sql, params)).map((r) => r.id))
      return order.filter((id) => set.has(id))
    }

    const newPerson = async (name: string): Promise<string> => {
      const uid = await createMember(t, name)
      const list = await createList(t, uid, `${name}s Wünsche`, { visibility: 'followers' })
      lists.push({ id: list, owner: uid, occasion: null })
      for (let k = 1; k <= 3; k++) wishes.push({ id: await addWish(t, uid, list, `${name} ${k}`, 1 + (k % 3), 10 - k), list })
      const secret = await createList(t, uid, 'Privat')
      lists.push({ id: secret, owner: uid, occasion: null })
      wishes.push({ id: await addWish(t, uid, secret, `${name} geheim`), list: secret })
      tokens.push({ owner: uid, token: await followLink(t, uid) })
      return uid
    }
    const newOccasion = async (host: string, title: string, inDays: number) => {
      const [id, list] = await createOccasion(t, host, title, inDays)
      occasions.push({ id, host, list })
      lists.push({ id: list, owner: host, occasion: id })
      for (const w of ['Grill', 'Lampe']) wishes.push({ id: await addWish(t, host, list, `${title}: ${w}`), list })
      return id
    }

    // ---- the starting world: 6 people, a ring of accepted follows plus requests, two occasions ------------
    for (const name of BASE) slots.push(await newPerson(name))
    for (let i = 0; i < slots.length; i++) {
      const a = slots[i]!
      const b = slots[(i + 1) % slots.length]!
      await rpc(t, a, 'request_follow_via_link', [tokens.find((x) => x.owner === b)!.token])
      await rpc(t, b, 'respond_follow', [a, true])
    }
    for (const [a, b] of [[0, 2], [3, 0], [5, 1], [2, 4]] as const) await rpc(t, slots[a]!, 'request_follow_via_link', [tokens.find((x) => x.owner === slots[b])!.token])
    const o1 = await newOccasion(slots[0]!, 'Fest A', 10)
    const o2 = await newOccasion(slots[4]!, 'Fest B', 25)
    for (const [occ, host, guests] of [[o1, slots[0]!, [slots[1]!, slots[4]!, slots[3]!]], [o2, slots[4]!, [slots[0]!, slots[2]!, slots[5]!]]] as const) {
      const tok = await invite(t, host, occ)
      for (const g of guests) await rpc(t, g, 'accept_invite', [tok])
    }
    for (const uid of [slots[2]!, slots[4]!]) await t.asUser(uid, (tx) => tx.query('update profiles set in_suggestions = true where id = $1', [uid]))
    await checkInvariants(t)

    // ---- the steps ------------------------------------------------------------------------------------------
    let switchOn = true
    let ownerComparisons = 0
    const outcomes = new Map<string, Map<string, number>>()
    const note = (kind: string, outcome: string) => {
      const m = outcomes.get(kind) ?? new Map<string, number>()
      m.set(outcome, (m.get(outcome) ?? 0) + 1)
      outcomes.set(kind, m)
    }
    const attempt = async (kind: string, run: () => Promise<unknown>): Promise<string> => {
      try {
        await run()
        note(kind, 'ok')
        return 'ok'
      } catch (err) {
        if (isDbError(err) && err.code === 'P0001' && CONTRACT.has(err.message)) {
          note(kind, err.message)
          return err.message
        }
        throw new Error(`step ${kind}: an answer outside the contract: ${isDbError(err) ? `${err.code} ${err.message}` : String(err)}`, { cause: err })
      }
    }
    /** reserve / cancel with the F20 check on the owner of the wish's list */
    const secretStep = async (kind: 'reserve' | 'cancel', actor: string, wish: string) => {
      const owner = ownerOfWish(wish)
      const ownerAlive = owner !== undefined && (await alive('profiles', [owner])).has(owner)
      const before = ownerAlive ? await ownerBytes(owner) : null
      await attempt(kind, () => rpc(t, actor, kind === 'reserve' ? 'reserve_wish' : 'cancel_reservation', [wish]))
      if (before && owner) {
        expect(await ownerBytes(owner), `F20: ${kind} by ${actor} on a wish of ${owner}`).toEqual(before)
        ownerComparisons++
      }
    }

    type Step = [weight: number, kind: string, run: (actor: string) => Promise<void>]
    const STEP_TABLE: Step[] = [
      [18, 'reserve', async (actor) => {
        const all = await aliveWishes()
        const readable = await ordered(all.map((w) => w.id),
          `select w.id from wishes w join wishlists wl on wl.id = w.wishlist_id where w.id = any($1::uuid[]) and wl.owner_id <> $2 and private.can_read_wishlist(wl.id, $2)`,
          [all.map((w) => w.id), actor])
        const wish = chance(0.03) ? UNKNOWN_ID : chance(0.75) ? pick(readable) ?? pick(all)?.id : pick(all)?.id
        if (wish) await secretStep('reserve', actor, wish)
      }],
      [9, 'cancel', async (actor) => {
        const all = await aliveWishes()
        const mine = await ordered(all.map((w) => w.id), `select wish_id as id from reservations where reserver_id = $1 and status = 'active'`, [actor])
        const wish = chance(0.75) ? pick(mine) ?? pick(all)?.id : pick(all)?.id
        if (wish) await secretStep('cancel', actor, wish)
      }],
      [6, 'request_follow', async (actor) => {
        const target = chance(0.05) ? UNKNOWN_ID : pick(others(actor))
        await attempt('request_follow', () => rpc(t, actor, 'request_follow', [target]))
      }],
      [6, 'request_follow_via_link', async (actor) => {
        const token = chance(0.05) ? 'f'.repeat(64) : pick(tokens.filter((x) => x.owner !== actor))?.token
        if (token) await attempt('request_follow_via_link', () => rpc(t, actor, 'request_follow_via_link', [token]))
      }],
      [3, 'create_follow_link', async (actor) => {
        await attempt('create_follow_link', async () => tokens.push({ owner: actor, token: await followLink(t, actor) }))
      }],
      [9, 'respond_follow', async (actor) => {
        const waiting = await ordered(slots, `select follower_id as id from follows where followee_id = $1 and status = 'pending'`, [actor])
        const target = chance(0.8) ? pick(waiting) ?? pick(others(actor)) : pick(others(actor))
        const accept = chance(0.6)
        await attempt('respond_follow', () => rpc(t, actor, 'respond_follow', [target, accept]))
      }],
      [4, 'unfollow', async (actor) => {
        const mine = await ordered(slots, `select followee_id as id from follows where follower_id = $1`, [actor])
        const target = chance(0.8) ? pick(mine) ?? pick(others(actor)) : pick(others(actor))
        await attempt('unfollow', () => rpc(t, actor, 'unfollow', [target]))
      }],
      [3, 'remove_follower', async (actor) => {
        const followers = await ordered(slots, `select follower_id as id from follows where followee_id = $1 and status = 'accepted'`, [actor])
        const target = chance(0.8) ? pick(followers) ?? pick(others(actor)) : pick(others(actor))
        await attempt('remove_follower', () => rpc(t, actor, 'remove_follower', [target]))
      }],
      [2, 'block_user', async (actor) => {
        await attempt('block_user', () => rpc(t, actor, 'block_user', [pick(others(actor))]))
      }],
      [3, 'unblock_user', async (actor) => {
        const blocked = await ordered(slots, `select blocked_id as id from blocks where blocker_id = $1`, [actor])
        await attempt('unblock_user', () => rpc(t, actor, 'unblock_user', [chance(0.8) ? pick(blocked) ?? pick(others(actor)) : pick(others(actor))]))
      }],
      [6, 'set_list_visibility', async (actor) => {
        const own = (await aliveLists(actor)).filter((l) => l.occasion === null)
        const list = chance(0.8) ? pick(own)?.id ?? pick(lists)?.id : pick(lists)?.id
        const vis = chance(0.1) ? 'occasion' : chance(0.5) ? 'private' : 'followers'
        if (list) await attempt('set_list_visibility', () => rpc(t, actor, 'set_list_visibility', [list, vis]))
      }],
      [2, 'in_suggestions', async (actor) => {
        const on = chance(0.5)
        await attempt('in_suggestions', () => t.asUser(actor, (tx) => tx.query('update profiles set in_suggestions = $2 where id = $1', [actor, on])))
      }],
      [2, 'create_list', async (actor) => {
        await attempt('create_list', async () => {
          const id = await createList(t, actor, 'Neue Liste', { visibility: chance(0.5) ? 'followers' : 'private' })
          lists.push({ id, owner: actor, occasion: null })
        })
      }],
      [1, 'delete_list', async (actor) => {
        const own = (await aliveLists(actor)).filter((l) => l.occasion === null)
        const list = pick(own)
        if (list) await attempt('delete_list', () => t.asUser(actor, (tx) => tx.query('delete from wishlists where id = $1', [list.id])))
      }],
      [5, 'create_wish', async (actor) => {
        const list = pick(await aliveLists(actor))
        if (list) await attempt('create_wish', async () => wishes.push({ id: await addWish(t, actor, list.id, 'Neuer Wunsch', 1 + Math.floor(rnd() * 3)), list: list.id }))
      }],
      [2, 'delete_wish', async (actor) => {
        const own = new Set((await aliveLists(actor)).map((l) => l.id))
        const wish = pick((await aliveWishes()).filter((w) => own.has(w.list)))
        if (wish) await attempt('delete_wish', () => t.asUser(actor, (tx) => tx.query('delete from wishes where id = $1', [wish.id])))
      }],
      [3, 'join_occasion', async (actor) => {
        const occ = pick((await aliveOccasions()).filter((o) => o.host !== actor))
        if (!occ) return
        const token = await rpc<{ token: string }>(t, occ.host, 'create_invite', [occ.id])
        await attempt('join_occasion', () => rpc(t, actor, 'accept_invite', [token.token]))
      }],
      [2, 'leave_occasion', async (actor) => {
        const occ = pick(await aliveOccasions())
        if (occ) await attempt('leave_occasion', () => rpc(t, actor, 'leave_occasion', [occ.id]))
      }],
      [1, 'remove_member', async (actor) => {
        // the host of an occasion (the actor when they host one) removes somebody
        const all = await aliveOccasions()
        const occ = pick(all.filter((o) => o.host === actor)) ?? pick(all)
        const member = occ ? pick(others(occ.host)) : undefined
        if (occ && member) await attempt('remove_member', () => rpc(t, occ.host, 'remove_member', [occ.id, member]))
      }],
      [1, 'create_occasion', async (actor) => {
        await attempt('create_occasion', () => newOccasion(actor, 'Spontanes Fest', 1 + Math.floor(rnd() * 50)))
      }],
      [1, 'revoke_follow_links', async (actor) => {
        await attempt('revoke_follow_links', () => rpc(t, actor, 'revoke_follow_links'))
      }],
      [1, 'delete_my_account', async (actor) => {
        await attempt('delete_my_account', () => rpc(t, actor, 'delete_my_account'))
        const index = slots.indexOf(actor)
        slots[index] = await newPerson(`${BASE[index]}${++born}`)
        // the newcomer asks somebody of the walk (through a live link) so the graph keeps moving
        const token = pick(tokens.filter((x) => x.owner !== slots[index]))?.token
        if (token) await attempt('request_follow_via_link', () => rpc(t, slots[index]!, 'request_follow_via_link', [token]))
      }],
      [1.5, 'red_button', async () => {
        if (switchOn) await pressRedButton(t)
        else await releaseRedButton(t)
        switchOn = !switchOn
        note('red_button', switchOn ? 'on' : 'off')
      }],
    ]
    const total = STEP_TABLE.reduce((sum, [w]) => sum + w, 0)

    for (let step = 0; step < STEPS; step++) {
      let r = rnd() * total
      const [, kind, run] = STEP_TABLE.find(([w]) => (r -= w) < 0) ?? STEP_TABLE[0]!
      const actor = pick(slots)!
      const cooldownsBefore = await cooldownRows(t)
      try {
        await run(actor)
        await checkInvariants(t, { cooldownsBefore })
      } catch (err) {
        throw new Error(`random walk, step ${step} (${kind} by ${actor}): ${err instanceof Error ? err.message : String(err)}`, { cause: err })
      }
    }
    if (!switchOn) await releaseRedButton(t)

    // ---- the walk was not vacuous ------------------------------------------------------------------------
    const count = (kind: string, outcome?: string) => {
      const m = outcomes.get(kind)
      if (!m) return 0
      return outcome ? (m.get(outcome) ?? 0) : [...m.values()].reduce((a, b) => a + b, 0)
    }
    for (const [, kind] of STEP_TABLE) expect(count(kind), `the walk never ran ${kind}`).toBeGreaterThan(0)
    expect(count('reserve', 'ok'), 'successful reservations').toBeGreaterThanOrEqual(15)
    expect(count('reserve', 'not_allowed'), 'refused reservations').toBeGreaterThan(0)
    expect(count('cancel', 'ok'), 'successful cancellations').toBeGreaterThan(0)
    expect(count('respond_follow', 'ok'), 'answered requests').toBeGreaterThan(0)
    expect(count('red_button', 'off'), 'red button pressed').toBeGreaterThan(0)
    expect(count('red_button', 'on'), 'red button released').toBeGreaterThan(0)
    expect(ownerComparisons, 'F20 comparisons').toBeGreaterThanOrEqual(60)
    // every refusal was a code of the contract (anything else threw above)
    for (const m of outcomes.values()) for (const key of m.keys()) expect(['ok', 'on', 'off', ...CONTRACT]).toContain(key)
    console.info(`[F19] ${STEPS} steps, ${ownerComparisons} owner comparisons, outcomes: ${JSON.stringify(Object.fromEntries([...outcomes].map(([k, m]) => [k, Object.fromEntries(m)])))}`)
  }, 900_000)
})
