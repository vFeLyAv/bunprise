/**
 * "Erhalten" (wishes.received_at, set_wish_received) and moving a wish (move_wish) —
 * supabase/migrations/20261022160000_list_photos_received_move.sql, parts B and C, on PGlite.
 * The follows world of test/follows/seed.ts: Paula owns L1 ("Meine Follower": Finn + Greta accepted, Rosa only
 * asked; wishes w1 prio 3, w2 prio 1, w3 prio 2), L2 ("Nur ich") and the occasion O1 with its list (Moritz is a
 * guest); Paula blocked Bea; Xaver is a stranger; O2 is Moritz's occasion (guests Paula, Bea, Finn).
 *   received: owner-only RPC (no REST write); the screens split open / received for every role; a received wish is
 *     never NEWLY reserved (not_allowed), existing reservations stay untouched; the cap of 5 skips received wishes;
 *     the owner's whole world is byte-identical with and without reservations before and after marking.
 *   move: the owner of BOTH lists only (one not_found); photo, details and received_at move along; every reader
 *     category: a giver who can read the target keeps the reservation (it follows the wish), everybody else's ends
 *     as 'wish_moved' (snapshot only); INV-1 after every move; the owner's world does not depend on reservations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { countAll, execAs, expectRpcError, rpc } from '../pilot/seed'
import { b64, fakeWebp } from '../pilot/photo-bytes'
import { addWish, createList, rpcText, seedFollows, type FollowSeed } from '../follows/seed'
import { checkInvariants, ownerSnapshot } from '../follows/invariants'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

type Json = Record<string, unknown>
interface Screen { wishes: Json[]; received: Json[] }
interface ListScreen extends Screen { list: Json }
interface OccasionScreen { wishlist: Screen }
type Reservation = { wish_id: string | null; wishlist_id: string | null; status: string; end_reason: string | null }

const mark = (uid: string, wish: string, received: boolean | null = true) =>
  rpc<{ ok: true; received_at: string | null }>(t, uid, 'set_wish_received', [wish, received])
const move = (uid: string, wish: string, list: string) => rpc<{ ok: true }>(t, uid, 'move_wish', [wish, list])
const reserve = (uid: string, wish: string) => rpc<{ ok: true }>(t, uid, 'reserve_wish', [wish])
const listScreen = (uid: string, list: string) => rpc<ListScreen>(t, uid, 'get_list_screen', [list])
const occasionScreen = (uid: string, occasion: string) => rpc<OccasionScreen>(t, uid, 'get_occasion_screen', [occasion])
const ids = (list: readonly Json[]) => list.map((w) => w.id)
const flags = (w: Json | undefined) => (w ? [w.reserved, w.reserved_by_me] : undefined)
const byId = (list: readonly Json[], id: string) => list.find((w) => w.id === id)

function reservationsOf(wish: string): Promise<Reservation[]> {
  return rows<Reservation>(t.db, 'select wish_id, wishlist_id, status, end_reason from reservations where wish_id = $1 order by created_at, id', [wish])
}
async function myReservation(uid: string, wish: string): Promise<Json> {
  const mine = await rpc<Json[]>(t, uid, 'my_reservations')
  const row = mine.find((r) => r.wish_id === wish)
  if (!row) throw new Error(`no reservation of ${wish} in my_reservations of ${uid}`)
  return row
}
/** A row that is not live has no wish_id any more (20261027200000): found by its snapshot title. */
async function myReservationTitled(uid: string, title: string): Promise<Json> {
  const mine = await rpc<Json[]>(t, uid, 'my_reservations')
  const row = mine.find((r) => r.wish_title === title)
  if (!row) throw new Error(`no reservation "${title}" in my_reservations of ${uid}`)
  return row
}
const statesOf = async (wish: string) => (await reservationsOf(wish)).map((r) => [r.status, r.end_reason])
function restoreConsents(uid: string) {
  return t.asService((tx) =>
    tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions`, [uid]),
  )
}
/** Paula's whole world (every REST column she can read, every read RPC, her screens, the export). */
function paulaWorld(s: FollowSeed, extraLists: readonly string[] = []) {
  return ownerSnapshot(t, s.paula, { occasionIds: [s.o1], listIds: [s.l1, s.l2, ...extraLists], profileIds: [s.finn, s.greta] })
}

// =============================================================================================================
// B) received
// =============================================================================================================

describe('set_wish_received: who may mark', () => {
  let s: FollowSeed
  beforeAll(async () => {
    s = await seedFollows(t)
  })

  it('only the list owner; everybody else and an unknown wish: one not_found; null: validation; no REST write', async () => {
    const unknown = '00000000-0000-4000-8000-00000000beef'
    const first = await expectRpcError(mark(s.finn, s.l1Wishes[0]), 'not_found')
    for (const uid of [s.finn, s.greta, s.rosa, s.moritz, s.xaver, s.bea]) {
      for (const wish of [s.l1Wishes[0], s.o1Wish, s.l2Wish, unknown]) {
        const err = await expectRpcError(mark(uid, wish), 'not_found')
        expect({ code: err.code, message: err.message }).toEqual({ code: first.code, message: first.message })
      }
    }
    await expectRpcError(mark(s.paula, unknown), 'not_found')
    await expectRpcError(mark(s.paula, s.l1Wishes[0], null), 'validation')
    await expectDbError(execAs(t, s.paula, 'update wishes set received_at = now() where id = $1', [s.l1Wishes[0]]), '42501')
    expect(await scalar<string | null>(t.db, 'select received_at from wishes where id = $1', [s.l1Wishes[0]])).toBeNull()
  })

  it('marking keeps the first moment (idempotent); un-marking clears it; REST readers see received_at', async () => {
    const on = await mark(s.paula, s.l1Wishes[0])
    expect(on).toEqual({ ok: true, received_at: expect.any(String) })
    expect(await mark(s.paula, s.l1Wishes[0])).toEqual(on)
    // REST: the wish's readers read the column (like the other wish columns)
    const read = (uid: string) => t.asUser(uid, (tx) => rows(tx, 'select received_at from wishes where id = $1', [s.l1Wishes[0]]))
    for (const uid of [s.paula, s.finn]) expect((await read(uid)).length, uid).toBe(1)
    for (const uid of [s.rosa, s.moritz, s.xaver]) expect(await read(uid), uid).toEqual([])
    expect(await mark(s.paula, s.l1Wishes[0], false)).toEqual({ ok: true, received_at: null })
    expect(await mark(s.paula, s.l1Wishes[0], false)).toEqual({ ok: true, received_at: null })
    // no consents needed (the owner edits her own wish, like a REST update of it)
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.paula]))
    try {
      expect((await mark(s.paula, s.l2Wish)).ok).toBe(true)
    } finally {
      await restoreConsents(s.paula)
    }
  })
})

describe('received: the screens split open / received for every role', () => {
  it('owner, follower, guest; the giver still sees reserved_by_me; free wishes leave it out; un-marking restores', async () => {
    const s = await seedFollows(t)
    const [w1, w2, w3] = s.l1Wishes
    expect(await reserve(s.finn, w1)).toEqual({ ok: true })
    const at1 = (await mark(s.paula, w1)).received_at
    await mark(s.paula, s.o1Wish)

    const paula = await listScreen(s.paula, s.l1)
    expect(ids(paula.wishes)).toEqual([w3, w2])
    expect(ids(paula.received)).toEqual([w1])
    expect(paula.received[0]).toMatchObject({ received_at: at1, reserved: null, reserved_by_me: null })
    for (const w of paula.wishes) expect(w.received_at).toBeNull()
    const finn = await listScreen(s.finn, s.l1)
    expect([ids(finn.wishes), ids(finn.received)]).toEqual([[w3, w2], [w1]])
    expect(flags(finn.received[0])).toEqual([true, true]) // the giver knows: received
    expect(finn.received[0]!.received_at).toBe(at1)
    expect(flags((await listScreen(s.greta, s.l1)).received[0])).toEqual([true, false])

    for (const uid of [s.paula, s.moritz]) {
      const sc = await occasionScreen(uid, s.o1)
      expect([ids(sc.wishlist.wishes), ids(sc.wishlist.received)], uid).toEqual([[], [s.o1Wish]])
    }
    expect(flags((await occasionScreen(s.moritz, s.o1)).wishlist.received[0])).toEqual([false, false])

    const free = await rpc<{ ideas: Json[] }>(t, s.greta, 'get_free_wishes', [s.paula, null])
    expect(free.ideas.map((i) => i.wish_id).sort()).toEqual([w2, w3].sort())
    const moritzFree = await rpc<{ ideas: Json[] }>(t, s.moritz, 'get_free_wishes', [s.paula, null])
    expect(moritzFree.ideas).toEqual([]) // O1's only wish is received

    // newest received first
    await mark(s.paula, w2)
    expect(ids((await listScreen(s.paula, s.l1)).received)).toEqual([w2, w1])
    // un-marking restores the wish — with the giver's reservation untouched
    await mark(s.paula, w1, false)
    await mark(s.paula, w2, false)
    const back = await listScreen(s.finn, s.l1)
    expect([ids(back.wishes), back.received]).toEqual([[w1, w3, w2], []])
    expect(flags(byId(back.wishes, w1))).toEqual([true, true])
  })
})

describe('received and reservations', () => {
  it('never NEWLY reserved (not_allowed, the code of every non-reservable wish); the holder keeps it, sees it, may cancel', async () => {
    const s = await seedFollows(t)
    const [w1, w2] = s.l1Wishes
    expect(await reserve(s.finn, w1)).toEqual({ ok: true })
    const before = await reservationsOf(w1)
    await mark(s.paula, w1)
    await mark(s.paula, s.o1Wish)
    expect(await reservationsOf(w1)).toEqual(before) // the owner's action never touches reservations

    const noAccess = await expectRpcError(reserve(s.rosa, w2), 'not_allowed') // a waiting request: no access at all
    for (const [uid, wish] of [[s.greta, w1], [s.moritz, s.o1Wish]] as const) {
      const err = await expectRpcError(reserve(uid, wish), 'not_allowed')
      expect({ code: err.code, message: err.message }).toEqual({ code: noAccess.code, message: noAccess.message })
    }
    expect(await reserve(s.finn, w1)).toEqual({ ok: true }) // idempotent for the holder
    expect(await countAll(t, 'reservations', `wish_id = $1 and status = 'active'`, [w1])).toBe(1)
    const mine = await myReservation(s.finn, w1)
    expect(mine).toMatchObject({ status: 'active', end_reason: null, wish_title: 'Kopfhörer', received_at: expect.any(String) })

    expect(await rpc(t, s.finn, 'cancel_reservation', [w1])).toEqual({ ok: true })
    await expectRpcError(reserve(s.finn, w1), 'not_allowed') // gone: a new reservation is a NEW one
    await mark(s.paula, w1, false)
    expect(await reserve(s.greta, w1)).toEqual({ ok: true })
    expect((await myReservation(s.greta, w1)).received_at).toBeNull()
    await checkInvariants(t)
  })

  it('the cap of 5 per giver and recipient counts no reservations of received wishes', async () => {
    const s = await seedFollows(t)
    const list = await createList(t, s.paula, 'Viele', { visibility: 'followers' })
    const wishes: string[] = []
    for (let i = 0; i < 7; i++) wishes.push(await addWish(t, s.paula, list, `Wunsch ${i + 1}`))
    for (const w of wishes.slice(0, 5)) expect(await reserve(s.finn, w)).toEqual({ ok: true })
    await expectRpcError(reserve(s.finn, wishes[5]!), 'limit_reached')
    await mark(s.paula, wishes[0]!)
    expect(await reserve(s.finn, wishes[5]!)).toEqual({ ok: true })
    await expectRpcError(reserve(s.finn, wishes[6]!), 'limit_reached')
    await mark(s.paula, wishes[0]!, false) // 6 active now — the cap is a brake for NEW reservations only
    await expectRpcError(reserve(s.finn, wishes[6]!), 'limit_reached')
  })

  it("secrecy: the owner's world is byte-identical with and without reservations, before and after marking", async () => {
    const s = await seedFollows(t)
    const [w1, , w3] = s.l1Wishes
    const world = () => paulaWorld(s)
    const empty = await world()
    expect(await reserve(s.finn, w1)).toEqual({ ok: true })
    expect(await reserve(s.moritz, s.o1Wish)).toEqual({ ok: true })
    expect(await world()).toEqual(empty)

    // the answer for a reserved wish and a free one: the same shape, only the moment differs
    const answers = [await mark(s.paula, w1), await mark(s.paula, s.o1Wish), await mark(s.paula, w3)]
    for (const a of answers) expect(Object.keys(a).sort()).toEqual(['ok', 'received_at'])
    const marked = await world()
    expect(await rpc(t, s.finn, 'cancel_reservation', [w1])).toEqual({ ok: true })
    expect(await rpc(t, s.moritz, 'cancel_reservation', [s.o1Wish])).toEqual({ ok: true })
    expect(await world()).toEqual(marked)

    await mark(s.paula, w1, false)
    await mark(s.paula, s.o1Wish, false)
    await mark(s.paula, w3, false)
    const unmarked = await world()
    expect(await reserve(s.greta, w1)).toEqual({ ok: true })
    expect(await reserve(s.moritz, s.o1Wish)).toEqual({ ok: true })
    expect(await world()).toEqual(unmarked)

    // the secret table is not named at all (the comment explains the shared lock with reserve_wish)
    const src = await scalar<string>(t.db, `select prosrc from pg_proc where proname = 'set_wish_received'`)
    expect(src).not.toMatch(/\breservations\b/i)
  })
})

// =============================================================================================================
// C) move
// =============================================================================================================

describe('move_wish: who may move', () => {
  it('only the owner of both lists; one not_found for everything else; the same list = nothing; no REST move', async () => {
    const s = await seedFollows(t)
    const [w1] = s.l1Wishes
    const moritzWish = await addWish(t, s.moritz, s.o2List, 'Brettspiel')
    const unknown = '00000000-0000-4000-8000-00000000cafe'
    const first = await expectRpcError(move(s.finn, w1, s.l2), 'not_found')
    const refusals = [
      ...[s.finn, s.greta, s.rosa, s.moritz, s.xaver, s.bea].flatMap((uid) => [[uid, w1, s.l2], [uid, s.o1Wish, s.l1], [uid, w1, s.o2List]]),
      [s.paula, w1, s.o2List], // a foreign target (Paula is only a guest of O2)
      [s.paula, moritzWish, s.l1], // a foreign wish
      [s.moritz, moritzWish, s.l1], // Moritz's wish into Paula's list
      [s.paula, unknown, s.l1], [s.paula, w1, unknown],
    ] as const
    for (const [uid, wish, list] of refusals) {
      const err = await expectRpcError(move(uid, wish, list), 'not_found')
      expect({ code: err.code, message: err.message }, `${uid} ${wish} → ${list}`).toEqual({ code: first.code, message: first.message })
    }
    expect(await scalar<string>(t.db, 'select wishlist_id from wishes where id = $1', [w1])).toBe(s.l1)
    expect(await move(s.paula, w1, s.l1)).toEqual({ ok: true })
    expect(await scalar<string>(t.db, 'select wishlist_id from wishes where id = $1', [w1])).toBe(s.l1)
    // REST has no UPDATE grant on wishlist_id
    await expectDbError(execAs(t, s.paula, 'update wishes set wishlist_id = $2 where id = $1', [w1, s.l2]), '42501')
  })

  it('the guard: even with a column grant an API role cannot move a wish (only move_wish can)', async () => {
    const s = await seedFollows(t)
    // a grant that must never exist — inside one rolled-back transaction
    const attempt = t.db.transaction(async (tx) => {
      await tx.exec('grant update (wishlist_id) on public.wishes to authenticated')
      await tx.exec('set local role authenticated')
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`,
        [s.paula, JSON.stringify({ sub: s.paula, role: 'authenticated' })])
      await tx.query('update public.wishes set wishlist_id = $2 where id = $1', [s.l1Wishes[0], s.l2])
    })
    await expectRpcError(attempt, 'not_allowed')
    expect(await scalar<boolean>(t.db, `select has_column_privilege('authenticated', 'public.wishes', 'wishlist_id', 'update')`)).toBe(false)
  })

  it('moving into a list others can read needs the current consents; into "Nur ich" never', async () => {
    const s = await seedFollows(t)
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.paula]))
    try {
      expect(await move(s.paula, s.l1Wishes[0], s.l2)).toEqual({ ok: true })
      await expectRpcError(move(s.paula, s.l1Wishes[0], s.l1), 'consent_required')
      await expectRpcError(move(s.paula, s.l2Wish, s.o1List), 'consent_required')
    } finally {
      await restoreConsents(s.paula)
    }
    expect(await move(s.paula, s.l1Wishes[0], s.l1)).toEqual({ ok: true })
  })
})

describe('move_wish: what moves along', () => {
  it('photo, details and received_at go with the wish; the readers follow the new list', async () => {
    const s = await seedFollows(t)
    const [w1] = s.l1Wishes
    await execAs(t, s.paula, `update wishes set brand = 'Klangwerk' where id = $1`, [w1])
    const photo = await rpc<{ updated_at: string }>(t, s.paula, 'set_wish_photo', [w1, 'image/webp', b64(fakeWebp(300, 2)), 1600, 1067])
    const { received_at } = await mark(s.paula, w1)
    expect((await rpc<{ mime: string }>(t, s.finn, 'get_wish_photo', [w1])).mime).toBe('image/webp')

    expect(await move(s.paula, w1, s.l2)).toEqual({ ok: true })
    expect(byId((await listScreen(s.paula, s.l1)).received, w1)).toBeUndefined()
    const moved = byId((await listScreen(s.paula, s.l2)).received, w1)
    expect(moved).toMatchObject({ brand: 'Klangwerk', received_at, photo: { width: 1600, height: 1067, updated_at: photo.updated_at } })
    await expectRpcError(rpc(t, s.finn, 'get_wish_photo', [w1]), 'not_found') // "Nur ich" now
    expect(await t.asUser(s.finn, (tx) => rows(tx, 'select id from wishes where id = $1', [w1]))).toEqual([])

    expect(await move(s.paula, w1, s.o1List)).toEqual({ ok: true })
    expect((await rpc<{ mime: string }>(t, s.moritz, 'get_wish_photo', [w1])).mime).toBe('image/webp')
    expect(byId((await occasionScreen(s.moritz, s.o1)).wishlist.received, w1)).toMatchObject({ brand: 'Klangwerk', received_at })
    expect(await countAll(t, 'wish_photos', 'wish_id = $1', [w1])).toBe(1)
  })
})

describe('move_wish: the reservations of every reader category (INV-1)', () => {
  let s: FollowSeed
  let l3: string
  let lamp: string
  beforeAll(async () => {
    s = await seedFollows(t)
    // Greta is a follower AND a guest of O1; Finn only a follower; Moritz only a guest
    expect(await rpc(t, s.greta, 'accept_invite', [s.o1Invite])).toEqual({ occasion_id: s.o1 })
    l3 = await createList(t, s.paula, 'Zweite Liste', { visibility: 'followers' })
    lamp = await addWish(t, s.paula, s.o1List, 'Lampe')
  })

  // 20261027200000 (lazy liveness): move_wish never touches reservations. The giver who cannot read the new list holds
  // a DEAD row from that moment on (no answer shows it as reserved; he sees "unavailable", no wish id, no context —
  // not even the list it was made on); the cleanup ends it ('access_ended'). The giver who can read it keeps it.
  it('L1 → the occasion list: the follower-only giver loses it (unavailable, snapshot only), the follower + guest keeps it', async () => {
    const [w1, w2] = s.l1Wishes
    expect(await reserve(s.finn, w1)).toEqual({ ok: true })
    expect(await reserve(s.greta, w2)).toEqual({ ok: true })
    expect(await move(s.paula, w1, s.o1List)).toEqual({ ok: true })
    expect(await move(s.paula, w2, s.o1List)).toEqual({ ok: true })
    expect(await statesOf(w1)).toEqual([['active', null]]) // untouched by the owner's move: dead now
    expect(await statesOf(w2)).toEqual([['active', null]])
    // the wish's live data is gone for Finn: a rename (and received_at) of the moved wish does not reach him
    await execAs(t, s.paula, `update wishes set title = 'Kopfhörer (neu)' where id = $1`, [w1])
    await mark(s.paula, w1)
    expect(await myReservationTitled(s.finn, 'Kopfhörer')).toMatchObject({
      wish_id: null, status: 'ended', end_reason: 'unavailable', occasion_id: null, occasion_title: null, list: null, received_at: null,
    })
    await mark(s.paula, w1, false)
    expect(await myReservation(s.greta, w2)).toMatchObject({ status: 'active', occasion_id: s.o1, wish_title: 'Buch', list: null })
    expect(flags(byId((await occasionScreen(s.greta, s.o1)).wishlist.wishes, w2))).toEqual([true, true])
    expect(flags(byId((await occasionScreen(s.moritz, s.o1)).wishlist.wishes, w2))).toEqual([true, false])
    expect(flags(byId((await occasionScreen(s.moritz, s.o1)).wishlist.wishes, w1))).toEqual([false, false]) // free again
    await checkInvariants(t) // (runs the cleanup)
    expect(await statesOf(w1)).toEqual([['ended', 'access_ended']])
    expect(await statesOf(w2)).toEqual([['active', null]])
  })

  it('the occasion list → L1: the guest-only giver loses it, the guest + follower keeps it', async () => {
    expect(await reserve(s.moritz, s.o1Wish)).toEqual({ ok: true })
    expect(await reserve(s.greta, lamp)).toEqual({ ok: true })
    expect(await move(s.paula, s.o1Wish, s.l1)).toEqual({ ok: true })
    expect(await move(s.paula, lamp, s.l1)).toEqual({ ok: true })
    expect(await statesOf(s.o1Wish)).toEqual([['active', null]]) // dead for Moritz now
    expect(await statesOf(lamp)).toEqual([['active', null]])
    // Moritz: the snapshot title only, no context (only a live reservation has one)
    await execAs(t, s.paula, `update wishes set title = 'Gartenstuhl (neu)' where id = $1`, [s.o1Wish])
    expect(await myReservationTitled(s.moritz, 'Gartenstuhl')).toMatchObject({
      wish_id: null, status: 'ended', end_reason: 'unavailable', occasion_id: null, list: null, received_at: null,
    })
    expect(await myReservation(s.greta, lamp)).toMatchObject({ status: 'active', occasion_id: null, list: { id: s.l1, title: 'Meine Wünsche', owner_name: 'Paula' } })
    expect(flags(byId((await listScreen(s.greta, s.l1)).wishes, lamp))).toEqual([true, true])
    expect(flags(byId((await listScreen(s.finn, s.l1)).wishes, lamp))).toEqual([true, false])
    await checkInvariants(t)
  })

  it('L1 → another follower list: the follower keeps it; → "Nur ich": everybody loses it; moving back revives nothing', async () => {
    const w3 = s.l1Wishes[2]
    expect(await reserve(s.finn, w3)).toEqual({ ok: true })
    expect(await move(s.paula, w3, l3)).toEqual({ ok: true })
    expect(await statesOf(w3)).toEqual([['active', null]])
    expect(flags(byId((await listScreen(s.finn, l3)).wishes, w3))).toEqual([true, true])

    expect(await move(s.paula, w3, s.l2)).toEqual({ ok: true })
    expect(await move(s.paula, lamp, s.l2)).toEqual({ ok: true })
    expect((await myReservationTitled(s.finn, 'Teekanne')).end_reason).toBe('unavailable')
    await checkInvariants(t) // the cleanup ends both dead rows
    expect(await statesOf(w3)).toEqual([['ended', 'access_ended']])
    expect(await statesOf(lamp)).toEqual([['ended', 'access_ended']])

    expect(await move(s.paula, w3, s.l1)).toEqual({ ok: true })
    expect((await reservationsOf(w3)).map((r) => r.status)).toEqual(['ended'])
    expect(flags(byId((await listScreen(s.finn, s.l1)).wishes, w3))).toEqual([false, false])
    expect(await reserve(s.greta, w3)).toEqual({ ok: true }) // free for everybody who can read L1 again
    // nobody outside ever held anything: the blocked person, the stranger and the waiting request
    for (const uid of [s.bea, s.xaver, s.rosa]) expect(await countAll(t, 'reservations', 'reserver_id = $1', [uid]), uid).toBe(0)
    await checkInvariants(t)
  })
})

describe('move_wish: secrecy', () => {
  it("the answer is constant; the owner's world after a move does not depend on the reservations", async () => {
    const s = await seedFollows(t)
    const [w1, w2, w3] = s.l1Wishes
    expect(await rpc(t, s.greta, 'accept_invite', [s.o1Invite])).toEqual({ occasion_id: s.o1 })
    const before = await paulaWorld(s)
    expect(await reserve(s.finn, w1)).toEqual({ ok: true }) // will end (Finn is no guest of O1)
    expect(await reserve(s.greta, w2)).toEqual({ ok: true }) // will be kept (Greta is a guest of O1)
    expect(await paulaWorld(s)).toEqual(before)
    // the same text for a wish whose reservation ends, one whose reservation is kept, and a free one
    const answers = [
      await rpcText(t, s.paula, 'move_wish', [w1, s.o1List]),
      await rpcText(t, s.paula, 'move_wish', [w2, s.o1List]),
      await rpcText(t, s.paula, 'move_wish', [w3, s.o1List]),
    ]
    expect(new Set(answers)).toEqual(new Set(['{"ok": true}']))
    const moved = await paulaWorld(s)
    expect(await rpc(t, s.greta, 'cancel_reservation', [w2])).toEqual({ ok: true })
    expect(await paulaWorld(s)).toEqual(moved)
    expect(await reserve(s.moritz, w3)).toEqual({ ok: true })
    expect(await paulaWorld(s)).toEqual(moved)

    // 20261027200000 (INV-7 a): move_wish never names reservations and returns only the constant
    const src = await scalar<string>(t.db, `select prosrc from pg_proc where proname = 'move_wish'`)
    expect(src.replace(/--[^\n]*/g, '')).not.toMatch(/reservation/i)
    expect(src.match(/return [^;]+;/g)).toEqual(["return jsonb_build_object('ok', true);", "return jsonb_build_object('ok', true);"])
  })
})
