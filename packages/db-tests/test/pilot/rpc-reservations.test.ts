/**
 * reserve_wish / cancel_reservation / my_reservations (pilot-decisions §2): identical `not_allowed` for the
 * list owner and for an outsider, `already_reserved` only for members, idempotent re-press, cancel by the
 * reserver only, wishes rows untouched, my_reservations strictly own.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, type TestDb } from '../../src/harness'
import { OCCASION_TITLE, WISH_TITLES, countAll, expectRpcError, queryAs, rpc, seedPilot, type MyReservation, type Seed } from './seed'

let t: TestDb
let s: Seed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedPilot(t)
})
afterAll(() => t.close())

// wave 2b M3 (follows-design §5.5): + `list` — the list without an occasion while readable, null for occasion rows
// 20261022160000: + received_at (the owner marked the wish as received; live like the title)
const MY_RES_KEYS = ['created_at', 'end_reason', 'list', 'occasion_id', 'occasion_title', 'received_at', 'starts_at', 'status', 'wish_id', 'wish_title']

describe('reserve_wish', () => {
  it('owner of the list and outsider get the SAME not_allowed, with and without an existing reservation', async () => {
    const ownerFree = await expectRpcError(rpc(t, s.a, 'reserve_wish', [s.w1]), 'not_allowed')
    const outsiderFree = await expectRpcError(rpc(t, s.d, 'reserve_wish', [s.w1]), 'not_allowed')
    expect(ownerFree.message).toBe(outsiderFree.message)
    expect(ownerFree.code).toBe(outsiderFree.code)

    expect(await rpc(t, s.b, 'reserve_wish', [s.w1])).toEqual({ ok: true })

    const ownerTaken = await expectRpcError(rpc(t, s.a, 'reserve_wish', [s.w1]), 'not_allowed')
    const outsiderTaken = await expectRpcError(rpc(t, s.d, 'reserve_wish', [s.w1]), 'not_allowed')
    expect(ownerTaken.message).toBe(ownerFree.message)
    expect(outsiderTaken.message).toBe(outsiderFree.message)
    // a wish nobody can see at all
    await expectRpcError(rpc(t, s.a, 'reserve_wish', ['00000000-0000-4000-8000-000000000000']), 'not_found')
    await expectRpcError(rpc(t, s.b, 'reserve_wish', ['00000000-0000-4000-8000-000000000000']), 'not_found')
  })

  it('stores one active row with the parties and a title snapshot', async () => {
    const r = await rows(
      t.db,
      `select wish_id, wishlist_id, recipient_id, reserver_id, status, end_reason, ended_at, wish_title_snapshot
         from reservations where wish_id = $1`,
      [s.w1],
    )
    expect(r).toEqual([
      { wish_id: s.w1, wishlist_id: s.wishlistId, recipient_id: s.a, reserver_id: s.b, status: 'active', end_reason: null, ended_at: null, wish_title_snapshot: WISH_TITLES.w1 },
    ])
  })

  it('a second member gets already_reserved; the same reserver again gets ok and still holds exactly one row', async () => {
    await expectRpcError(rpc(t, s.c, 'reserve_wish', [s.w1]), 'already_reserved')
    expect(await rpc(t, s.b, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect(await countAll(t, 'reservations', `wish_id = $1 and status = 'active'`, [s.w1])).toBe(1)
    expect(await countAll(t, 'reservations', `wish_id = $1`, [s.w1])).toBe(1)
  })

  it('the partial unique index also stops the superuser from a second active row', async () => {
    const err = await expectDbError(
      t.asService((tx) =>
        tx.query(
          `insert into reservations (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot) values ($1, $2, $3, $4, 'x')`,
          [s.w1, s.wishlistId, s.a, s.c],
        ),
      ),
      '23505',
    )
    expect(err.message).toMatch(/reservations_one_active_per_wish/)
  })

  it('needs current consents (consent_required), reading still works', async () => {
    await t.asService((tx) => tx.query(`delete from consents where profile_id = $1 and kind = 'privacy_notice'`, [s.c]))
    await expectRpcError(rpc(t, s.c, 'reserve_wish', [s.w2]), 'consent_required')
    expect(await queryAs(t, s.c, 'select id from wishes')).toHaveLength(3)
    await t.asUser(s.c, (tx) =>
      tx.query(`insert into consents (profile_id, kind, version, locale) select $1, kind, version, 'de' from legal_versions where kind = 'privacy_notice'`, [s.c]),
    )
    expect(await rpc(t, s.c, 'reserve_wish', [s.w2])).toEqual({ ok: true })
  })

  it('anon cannot call it', async () => {
    await expectDbError(t.asAnon((tx) => tx.query('select public.reserve_wish($1)', [s.w3])), '42501')
  })
})

describe('cancel_reservation', () => {
  it('owner / outsider → not_allowed; other member → not_found; reserver → ok; again → not_found; wish free again', async () => {
    await expectRpcError(rpc(t, s.a, 'cancel_reservation', [s.w1]), 'not_allowed')
    await expectRpcError(rpc(t, s.d, 'cancel_reservation', [s.w1]), 'not_allowed')
    await expectRpcError(rpc(t, s.c, 'cancel_reservation', [s.w1]), 'not_found')
    await expectRpcError(rpc(t, s.c, 'cancel_reservation', [s.w3]), 'not_found') // nobody holds w3: same answer
    expect(await countAll(t, 'reservations', `wish_id = $1 and status = 'active'`, [s.w1])).toBe(1)

    expect(await rpc(t, s.b, 'cancel_reservation', [s.w1])).toEqual({ ok: true })
    expect(await rows(t.db, `select status, end_reason, ended_at is not null as ended from reservations where wish_id = $1`, [s.w1])).toEqual([
      { status: 'ended', end_reason: 'by_reserver', ended: true },
    ])
    await expectRpcError(rpc(t, s.b, 'cancel_reservation', [s.w1]), 'not_found')
    await expectRpcError(rpc(t, s.b, 'cancel_reservation', ['00000000-0000-4000-8000-000000000000']), 'not_found')

    expect(await rpc(t, s.c, 'reserve_wish', [s.w1])).toEqual({ ok: true })
    expect(await countAll(t, 'reservations', `wish_id = $1`, [s.w1])).toBe(2)
    expect(await countAll(t, 'reservations', `wish_id = $1 and status = 'active' and reserver_id = $2`, [s.w1, s.c])).toBe(1)
  })
})

describe('side channels on wishes (data-spec §6 #5, #7, #28)', () => {
  it('reserving and cancelling never touches the wishes rows (updated_at, xmin, full row) nor the host\'s REST view', async () => {
    const s2 = await seedPilot(t)
    const snapshot = () =>
      rows(t.db, `select id, xmin::text as x, updated_at::text as u, to_jsonb(w)::text as j from wishes w where wishlist_id = $1 order by id`, [s2.wishlistId])
    // explicit columns: since wave 2b M1 the host cannot read wishes.updated_at through REST (a whole row needs every
    // column); the superuser snapshot above still compares updated_at, xmin and the full row
    const hostView = () =>
      queryAs(
        t,
        s2.a,
        `select jsonb_build_object('id', w.id, 'wishlist_id', w.wishlist_id, 'title', w.title, 'price_cents', w.price_cents,
                'currency', w.currency, 'url', w.url, 'note', w.note, 'priority', w.priority, 'created_at', w.created_at)::text as j
           from wishes w where wishlist_id = $1 order by id`,
        [s2.wishlistId],
      )
    const before = await snapshot()
    const hostBefore = await hostView()
    await rpc(t, s2.b, 'reserve_wish', [s2.w1])
    await rpc(t, s2.c, 'reserve_wish', [s2.w2])
    await rpc(t, s2.b, 'cancel_reservation', [s2.w1])
    await rpc(t, s2.c, 'reserve_wish', [s2.w1])
    expect(await snapshot()).toEqual(before)
    expect(await hostView()).toEqual(hostBefore)
    // the host's own edit still works exactly as without reservations (and is the only thing that bumps updated_at)
    await t.asUser(s2.a, (tx) => tx.query(`update wishes set price_cents = 5990 where id = $1`, [s2.w1]))
    const after = await snapshot()
    expect(after.find((r) => r['id'] === s2.w1)!['u']).not.toBe(before.find((r) => r['id'] === s2.w1)!['u'])
    expect(after.filter((r) => r['id'] !== s2.w1)).toEqual(before.filter((r) => r['id'] !== s2.w1))
  })
})

describe('my_reservations', () => {
  it('lists only the caller\'s own reservations with the contract shape; the host sees nothing about anyone', async () => {
    const s3 = await seedPilot(t)
    await rpc(t, s3.b, 'reserve_wish', [s3.w1])
    await rpc(t, s3.b, 'reserve_wish', [s3.w3])
    await rpc(t, s3.c, 'reserve_wish', [s3.w2])

    const mine = await rpc<MyReservation[]>(t, s3.b, 'my_reservations')
    expect(mine).toHaveLength(2)
    for (const r of mine) expect(Object.keys(r).sort()).toEqual(MY_RES_KEYS)
    expect(mine.map((r) => r.wish_id).sort()).toEqual([s3.w1, s3.w3].sort())
    expect(mine.find((r) => r.wish_id === s3.w1)).toMatchObject({
      wish_title: WISH_TITLES.w1,
      occasion_id: s3.occasionId,
      occasion_title: OCCASION_TITLE,
      status: 'active',
      end_reason: null,
    })
    expect(JSON.stringify(mine)).not.toContain(s3.c)

    expect(await rpc(t, s3.a, 'my_reservations')).toEqual([])
    expect(await rpc(t, s3.d, 'my_reservations')).toEqual([])
    expect((await rpc<MyReservation[]>(t, s3.c, 'my_reservations')).map((r) => r.wish_id)).toEqual([s3.w2])
    await expectDbError(t.asAnon((tx) => tx.query('select public.my_reservations()')), '42501')
    // nothing beyond the contract: no recipient / reserver ids or names
    expect(JSON.stringify(mine)).not.toContain(s3.a)
    expect(JSON.stringify(mine)).not.toMatch(/recipient|reserver|display_name/)
  })

  it('ended by others within 90 days stays visible; own cancellation and older endings disappear', async () => {
    const s4 = await seedPilot(t)
    await rpc(t, s4.b, 'reserve_wish', [s4.w1])
    await rpc(t, s4.b, 'reserve_wish', [s4.w2])
    await rpc(t, s4.b, 'reserve_wish', [s4.w3])
    await rpc(t, s4.b, 'cancel_reservation', [s4.w3]) // own cancellation: not listed
    await t.asService((tx) =>
      tx.query(`update reservations set status = 'ended', end_reason = 'member_removed', ended_at = now() - interval '10 days' where wish_id = $1`, [s4.w1]),
    )
    await t.asService((tx) =>
      tx.query(`update reservations set status = 'ended', end_reason = 'member_removed', ended_at = now() - interval '91 days' where wish_id = $1`, [s4.w2]),
    )
    const mine = await rpc<MyReservation[]>(t, s4.b, 'my_reservations')
    // since 20261027200000 a giver gets only the public reason ('unavailable', Q1) and no context of an ended row
    expect(mine.map((r) => [r.wish_id, r.status, r.end_reason])).toEqual([[null, 'ended', 'unavailable']])
  })
})
