/** Regressions from B1/Codex: UUID reuse and reservation-dependent delete deadlocks, on real PostgreSQL 17. */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { settle, startRealPg, type Outcome, type RealPg, type Session } from '../../src/realpg'
import { inv1Violations, rpcAs, seedFollowWorld, type FollowWorld } from './world'

let db: RealPg
beforeAll(async () => { db = await startRealPg() })
afterAll(async () => { await db?.close() })

async function finish<T>(s: Session, pending: Promise<Outcome<T>>): Promise<Outcome<T>> {
  const out = await pending
  if (out.ok) await s.commit()
  else await s.rollback()
  return out
}

const emergency = readFileSync(new URL('../../../../supabase/emergency/follower_lists_off.sql', import.meta.url), 'utf8')
// the template is ONE do-block (supabase db push runs statements outside a transaction, a top-level LOCK fails — 27.10);
// here its inner statements run one by one inside an open transaction, so the lock order can be observed
const emergencyBody = /^\s*do \$\$\s*begin\s*([\s\S]*?)\s*end \$\$;\s*$/i.exec(emergency.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n'))?.[1] ?? ''
const emergencyStatements = emergencyBody.split(';').map((s) => s.trim()).filter(Boolean)

describe('revalidate row identity after the profile-lock wait', () => {
  for (const replacement of ['wish moved to private list', 'occasion list replaced by private list'] as const) {
    it(replacement, async () => {
      const w = await seedFollowWorld(db)
      const occasionPath = replacement === 'occasion list replaced by private list'
      const list = occasionPath ? await db.admin.value<string>('select id from public.wishlists where occasion_id = $1', [w.o1]) : w.l1
      const giver = occasionPath ? w.moritz : w.finn
      const wish = occasionPath ? await db.asUser(w.paula, (s) => s.value<string>("insert into public.wishes (wishlist_id, title) values ($1, 'Public original') returning id", [list])) : w.wishes[0]!
      const holder = await db.session('identity-owner')
      const reader = await db.session('identity-giver')
      try {
        await holder.begin(w.paula)
        await holder.query('select id from public.profiles where id = $1 for no key update', [w.paula])
        await reader.begin(giver)
        const pending = settle(reader.rpc('reserve_wish', [wish]))
        await db.waitUntilBlocked(reader, holder, pending)
        // 20261027200000 (SW34): an API role can no longer choose a wish's id at all (42501, checked below); the
        // replacement wish is written by the superuser here — the worst case: the same id, the same owner
        if (occasionPath) {
          await holder.query('delete from public.wishlists where id = $1', [list])
          await holder.query("insert into public.wishlists (id, owner_id, recipient_id, title, visibility) values ($1, $2, $2, 'PRIVATE replacement', 'private')", [list, w.paula])
          await holder.query('reset role')
          await holder.query("insert into public.wishes (id, wishlist_id, title) values ($1, $2, 'PRIVATE replacement title')", [wish, list])
        } else {
          const privateList = await holder.value<string>("insert into public.wishlists (owner_id, recipient_id, title, visibility) values ($1, $1, 'PRIVATE diary', 'private') returning id", [w.paula])
          await holder.query('delete from public.wishes where id = $1', [wish])
          await holder.query('reset role')
          await holder.query("insert into public.wishes (id, wishlist_id, title) values ($1, $2, 'PRIVATE replacement title')", [wish, privateList])
        }
        await holder.commit()
        const result = await finish(reader, pending)
        // the same owner and recipient, so the wish is "found" again — but the giver reads no place of it: refused
        expect(result).toEqual({ ok: false, code: 'P0001', message: 'not_allowed' })
        const restInsert = await settle(db.asUser(w.paula, (s) => s.query("insert into public.wishes (id, wishlist_id, title) values (gen_random_uuid(), $1, 'x')", [w.l1])))
        expect(restInsert).toMatchObject({ ok: false, code: '42501' })
        expect(await inv1Violations(db)).toBe(0)
        expect(await rpcAs(db, giver, 'my_reservations')).toEqual([])
        expect(JSON.stringify(await rpcAs(db, giver, 'export_my_data'))).not.toContain('PRIVATE replacement title')
      } finally {
        await holder.rollback(); await reader.rollback()
        await holder.end(); await reader.end()
      }
    })
  }
})

const actions: { name: string; as: (w: FollowWorld) => string; run: (s: Session, w: FollowWorld) => Promise<unknown>; wishesOnly?: boolean }[] = [
  { name: 'remove_follower', as: (w) => w.paula, run: (s, w) => s.rpc('remove_follower', [w.finn]) },
  { name: 'unfollow', as: (w) => w.finn, run: (s, w) => s.rpc('unfollow', [w.paula]) },
  { name: 'block_user', as: (w) => w.paula, run: (s, w) => s.rpc('block_user', [w.finn]) },
  { name: 'set_list_visibility', as: (w) => w.paula, run: (s, w) => s.rpc('set_list_visibility', [w.l1, 'private']), wishesOnly: true },
]

describe('bulk REST deletion cannot reveal reservations through a deadlock', () => {
  for (const action of actions) for (const reserved of [false, true]) {
    it(`${action.name} versus ${action.wishesOnly ? 'bulk wishes' : 'list'} delete, reservations=${reserved}`, async () => {
      const w = await seedFollowWorld(db)
      if (reserved) {
        // Reservation insertion order is opposite the wish cascade's heap order.
        await rpcAs(db, w.finn, 'reserve_wish', [w.wishes[2]!])
        await rpcAs(db, w.finn, 'reserve_wish', [w.wishes[0]!])
      }
      const pin = await db.session('delete-middle-pin')
      const deletion = await db.session('bulk-delete')
      const change = await db.session('end-access')
      try {
        await pin.begin()
        await pin.query('select id from public.wishes where id = $1 for key share', [w.wishes[1]!])
        await deletion.begin(w.paula)
        const deleting = settle(deletion.query(action.wishesOnly ? 'delete from public.wishes where wishlist_id = $1' : 'delete from public.wishlists where id = $1', [w.l1]).then((r) => r.rowCount))
        await db.waitUntilBlocked(deletion, pin, deleting)
        await change.begin(action.as(w))
        const changing = settle(action.run(change, w))
        const blocked = await db.waitUntilBlocked(change, deletion, changing).catch(() => null)
        await pin.rollback()
        const [deleted, changed] = await Promise.all([finish(deletion, deleting), finish(change, changing)])
        expect(deleted).toEqual({ ok: true, value: action.wishesOnly ? w.wishes.length : 1 })
        expect(changed).toEqual({ ok: true, value: { ok: true } })
        expect(blocked?.rowLockOn).toBe('profiles')
        expect(await inv1Violations(db)).toBe(0)
      } finally {
        await pin.rollback(); await deletion.rollback(); await change.rollback()
        await pin.end(); await deletion.end(); await change.end()
      }
    })
  }
})

describe('emergency shutdown and account deletion share the same first lock', () => {
  for (const person of ['paula', 'finn'] as const) {
    it(`shutdown holds its first lock while ${person} deletes the account`, async () => {
      const w = await seedFollowWorld(db)
      await rpcAs(db, w.finn, 'reserve_wish', [w.wishes[0]!])
      const shutdown = await db.session('emergency')
      const deletion = await db.session('delete-account')
      try {
        await shutdown.begin()
        await shutdown.query(emergencyStatements[0]!)
        await deletion.begin(w[person])
        const deleting = settle(deletion.rpc('delete_my_account'))
        await db.waitUntilBlocked(deletion, shutdown, deleting)
        const stopping = settle((async () => {
          for (const sql of emergencyStatements.slice(1)) await shutdown.query(sql)
          return { ok: true }
        })())
        const [deleted, stopped] = await Promise.all([finish(deletion, deleting), finish(shutdown, stopping)])
        expect(deleted).toEqual({ ok: true, value: { ok: true } })
        expect(stopped).toEqual({ ok: true, value: { ok: true } })
        expect(await inv1Violations(db)).toBe(0)
      } finally {
        await deletion.rollback(); await shutdown.rollback()
        await deletion.end(); await shutdown.end()
        await db.admin.query('update private.features set follower_lists = true')
      }
    })
  }
})

it('acceptance answers not_found if a pending request disappears after its visibility check', async () => {
  const w = await seedFollowWorld(db)
  const purge = await db.session('purge-request')
  const accept = await db.session('accept-request')
  try {
    await purge.begin()
    await purge.query('delete from public.follows where follower_id = $1 and followee_id = $2', [w.rosa, w.paula])
    await accept.begin(w.paula)
    const pending = settle(accept.rpc('respond_follow', [w.rosa, true]))
    await db.waitUntilBlocked(accept, purge, pending)
    await purge.commit()
    expect(await finish(accept, pending)).toEqual({ ok: false, code: 'P0001', message: 'not_found' })
  } finally {
    await purge.rollback(); await accept.rollback()
    await purge.end(); await accept.end()
  }
})
