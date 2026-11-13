/** v1.1 regression attacks. PGlite has one connection; concurrent lock schedules need hosted Postgres. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { ALL_TABLES, WISH_TITLES, createMember, execAs, expectRpcError, rpc, screen, seedPilot, type MyReservation } from './seed'

let t: TestDb
beforeAll(async () => { t = await createTestDb() })
afterAll(() => t?.close())

describe('v1.1 secrecy and privileges', () => {
  it('denies system-column reads and cross-table xmax inference on every exposed table', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    for (const table of ALL_TABLES) {
      expect(await scalar<boolean>(t.db, `select has_table_privilege('authenticated', $1, 'SELECT')`, [`public.${table}`]), table).toBe(false)
      for (const column of ['xmin', 'xmax', 'ctid', 'tableoid']) {
        await expectDbError(t.asUser(s.a, (tx) => tx.query(`select ${column} from public.${table}`)), '42501')
      }
    }
    await expectDbError(t.asUser(s.a, (tx) => tx.query(
      `select p.id, p.display_name from wishes w join profiles p on p.xmax = w.xmax where w.id = $1`, [s.w1])), '42501')
  })

  it('accepts a user report but rejects forged moderation fields and server timestamps', async () => {
    const s = await seedPilot(t)
    for (const [column, value] of [['handled_at', 'now()'], ['outcome', "'closed'"], ['created_at', "'2000-01-01'"]] as const) {
      await expectDbError(t.asUser(s.b, (tx) => tx.query(
        `insert into reports(reporter_id,target_kind,target_id,reason,${column}) values ($1,'profile',$2,'spam',${value})`, [s.b, s.a])), '42501')
    }
    expect(await execAs(t, s.b, `insert into reports(reporter_id,target_kind,target_id,reason) values ($1,'profile',$2,'spam')`, [s.b, s.a])).toBe(1)
    const report = await t.asUser(s.b, (tx) => rows(tx, `select handled_at, outcome from reports where reporter_id = $1`, [s.b]))
    expect(report).toEqual([{ handled_at: null, outcome: null }])
  })

  for (const revoke of ['remove', 'leave', 'block'] as const) {
    it(`returns only the stored wish snapshot after ${revoke}, including in exports`, async () => {
      const s = await seedPilot(t)
      await rpc(t, s.b, 'reserve_wish', [s.w1])
      if (revoke === 'remove') await rpc(t, s.a, 'remove_member', [s.occasionId, s.b])
      else if (revoke === 'leave') await rpc(t, s.b, 'leave_occasion', [s.occasionId])
      else await rpc(t, s.a, 'block_user', [s.b])
      await execAs(t, s.a, `update wishes set title = 'NEW SECRET WISH' where id = $1`, [s.w1])
      await execAs(t, s.a, `update occasions set title = 'NEW SECRET EVENT', starts_at = now() + interval '180 days' where id = $1`, [s.occasionId])
      await execAs(t, s.a, `update profiles set display_name = 'NEW SECRET NAME' where id = $1`, [s.a])
      const history = await rpc<MyReservation[]>(t, s.b, 'my_reservations')
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({ wish_title: WISH_TITLES.w1, occasion_id: null, occasion_title: null, starts_at: null, status: 'ended' })
      const exported = await rpc<{ reservations_made_by_me: Record<string, unknown>[] }>(t, s.b, 'export_my_data')
      expect(exported.reservations_made_by_me).toHaveLength(1)
      expect(exported.reservations_made_by_me[0]).toMatchObject({ wish_title: WISH_TITLES.w1, recipient_name: null, occasion_title: null })
      expect(JSON.stringify(exported)).not.toMatch(/NEW SECRET/)
      await expectRpcError(rpc(t, s.b, 'reserve_wish', [s.w2]), 'not_allowed')
    })
  }

  it('requires a link created after removal, even if an active link was backdated by a privileged operator', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.a, 'remove_member', [s.occasionId, s.b])
    await expectRpcError(rpc(t, s.b, 'accept_invite', [s.token]), 'invite_invalid')
    const fresh = await rpc<{ token: string }>(t, s.a, 'create_invite', [s.occasionId])
    await t.asService((tx) => tx.query(`update invites set created_at = now() - interval '1 day' where occasion_id = $1 and revoked_at is null`, [s.occasionId]))
    await expectRpcError(rpc(t, s.b, 'accept_invite', [fresh.token]), 'invite_invalid')
    await t.asService((tx) => tx.query(`update invites set created_at = clock_timestamp() where occasion_id = $1 and revoked_at is null`, [s.occasionId]))
    expect(await rpc(t, s.b, 'accept_invite', [fresh.token])).toEqual({ occasion_id: s.occasionId })
  })

  it('refuses a blocked host even with an inconsistent active membership', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.a, 'block_user', [s.b])
    await t.asService((tx) => tx.query(`update occasion_members set status = 'active' where occasion_id = $1 and profile_id = $2`, [s.occasionId, s.b]))
    await expectRpcError(screen(t, s.b, s.occasionId), 'not_found')
    await expectRpcError(rpc(t, s.b, 'reserve_wish', [s.w1]), 'not_allowed')
    await expectRpcError(rpc(t, s.b, 'accept_invite', [s.token]), 'invite_invalid')
  })

  it('enforces one unrevoked invite in the database as well as in the RPC', async () => {
    const s = await seedPilot(t)
    await expectDbError(t.asService((tx) => tx.query(
      `insert into invites(occasion_id,created_by,token_hash,expires_at) values ($1,$2,sha256('other'::bytea),now()+interval '1 day')`, [s.occasionId, s.a])), '23505')
    await rpc(t, s.a, 'create_invite', [s.occasionId])
    expect(await scalar<number>(t.db, `select count(*)::int from invites where occasion_id = $1 and revoked_at is null`, [s.occasionId])).toBe(1)
  })

  it('rejects old claims immediately after account deletion', async () => {
    const uid = await createMember(t, 'Deleted')
    expect(await rpc(t, uid, 'delete_my_account')).toEqual({ ok: true })
    for (const method of ['get_me', 'get_feed', 'my_reservations', 'export_my_data', 'delete_my_account']) {
      await expectRpcError(rpc(t, uid, method), 'not_allowed')
    }
  })

  it('permits export and account deletion with missing or outdated legal records', async () => {
    const missing = await createMember(t, 'Missing', { consents: false })
    expect(await rpc(t, missing, 'export_my_data')).toMatchObject({ profile: { id: missing }, consents: [] })
    expect(await rpc(t, missing, 'delete_my_account')).toEqual({ ok: true })
    const outdated = await createMember(t, 'Outdated')
    await t.asService((tx) => tx.query(`update legal_versions set version = 'terms-new-test-version' where kind = 'terms'`))
    expect(await rpc(t, outdated, 'get_me')).toMatchObject({ consents_ok: false })
    expect(await rpc(t, outdated, 'export_my_data')).toMatchObject({ profile: { id: outdated } })
    expect(await rpc(t, outdated, 'delete_my_account')).toEqual({ ok: true })
  })
})

describe('v1.1 data limits and retention', () => {
  it('rejects other currencies, blank required values, and oversized raw text with valid trimmed lengths', async () => {
    const s = await seedPilot(t)
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`update wishes set currency = 'CHF' where id = $1`, [s.w1])), '23514')
    for (const [table, column, id, max] of [['wishes', 'title', s.w1, 120], ['wishlists', 'title', s.wishlistId, 80], ['occasions', 'title', s.occasionId, 80]] as const) {
      for (const invalid of [' ', `x${' '.repeat(max)}`]) {
        await expectDbError(t.asUser(s.a, (tx) => tx.query(`update ${table} set ${column} = $1 where id = $2`, [invalid, id])), '23514')
      }
      expect(await execAs(t, s.a, `update ${table} set ${column} = $1 where id = $2`, ['x'.repeat(max), id])).toBe(1)
    }
    await expectDbError(t.asUser(s.a, (tx) => tx.query(`insert into occasion_addresses(occasion_id,address) values ($1,$2)`, [s.occasionId, `x${' '.repeat(300)}`])), '23514')
    await expectDbError(t.asUser(s.b, (tx) => tx.query(`insert into reports(reporter_id,target_kind,target_id,reason) values ($1,'profile',$2,$3)`, [s.b, s.a, `x${' '.repeat(1000)}`])), '23514')
  })

  it('purges only never-signed-in accounts older than 24 hours', async () => {
    const stale = await t.createUser('stale@example.test')
    const fresh = await t.createUser('fresh@example.test')
    const signedIn = await t.createUser('confirmed@example.test')
    await t.asService(async (tx) => {
      await tx.query(`update auth.users set created_at = now()-interval '25 hours' where id = $1`, [stale])
      await tx.query(`update auth.users set created_at = now()-interval '23 hours' where id = $1`, [fresh])
      await tx.query(`update auth.users set created_at = now()-interval '10 days', last_sign_in_at = now()-interval '1 day' where id = $1`, [signedIn])
      await tx.query(`select private.purge_unconfirmed_users()`)
    })
    const surviving = await rows<{ id: string }>(t.db, `select id from auth.users where id in ($1,$2,$3)`, [stale, fresh, signedIn])
    expect(surviving.map((row) => row.id).sort()).toEqual([fresh, signedIn].sort())
    expect(await rows(t.db, `select id from profiles where id = $1`, [stale])).toEqual([])
  })

  it('purges ended reservations and closed reports after 90 days, preserving recent/open/active data', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.b, 'cancel_reservation', [s.w1])
    await rpc(t, s.b, 'reserve_wish', [s.w2])
    await rpc(t, s.b, 'cancel_reservation', [s.w2])
    await rpc(t, s.b, 'reserve_wish', [s.w3])
    await t.asService(async (tx) => {
      await tx.query(`update reservations set ended_at = now()-interval '91 days' where reserver_id = $1 and wish_id = $2`, [s.b, s.w1])
      await tx.query(`update reservations set ended_at = now()-interval '89 days' where reserver_id = $1 and wish_id = $2`, [s.b, s.w2])
      await tx.query(`insert into reports(reporter_id,target_kind,target_id,reason,created_at,handled_at) values
        ($1,'profile',$2,'old closed',now()-interval '100 days',now()-interval '91 days'),
        ($1,'profile',$2,'recent closed',now()-interval '100 days',now()-interval '89 days'),
        ($1,'profile',$2,'old open',now()-interval '100 days',null)`, [s.b, s.a])
      await tx.query(`select private.purge_expired_records()`)
    })
    expect(await rows(t.db, `select wish_id,status from reservations where reserver_id = $1 order by status`, [s.b])).toEqual([
      { wish_id: s.w3, status: 'active' }, { wish_id: s.w2, status: 'ended' },
    ])
    expect((await rows<{ reason: string }>(t.db, `select reason from reports where reporter_id = $1 order by reason`, [s.b])).map((r) => r.reason)).toEqual(['old open', 'recent closed'])
  })

  it('exposes neither retention execution nor the lock helper to API roles', async () => {
    const uid = await createMember(t, 'Private')
    for (const sql of ['select private.purge_unconfirmed_users()', 'select private.purge_expired_records()', 'select private.lock_profile_pair(null,null)']) {
      await expectDbError(t.asUser(uid, (tx) => tx.query(sql)), '42501')
      await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
    }
  })
})
