/**
 * The database switch of the in-app invitations (private.features.occasion_invitations).
 * 20261027120000_occasion_invitations.sql creates it OFF (column default false); 20261027130000_occasion_invitations_on.sql
 * switches it ON with the 4th release and the pilot-4 legal texts (Felix 26.10: «так включи приглашения и исправь
 * Datenschutz и AGB»). While it is off (the default of a re-created row, and the state after the emergency template
 * supabase/emergency/occasion_invitations_off.sql) every invitation RPC refuses or shows nothing, the two settings cannot
 * be set, and not one row of the feature comes into existence. This file proves the OFF behaviour by switching it off
 * itself, right after checking that the migrations leave it on.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, createTestDb, scalar, type TestDb } from '../../src/harness'
import { execAs, expectRpcError, rpc } from '../pilot/seed'
import { createOccasion, seedInvites } from './seed'

const SWITCH_OFF = 'update private.features set occasion_invitations = false'
const ON_MIGRATION = '20261027130000_occasion_invitations_on.sql'

let t: TestDb
/** the switch exactly as `db push` of every migration leaves it */
let afterMigrations: boolean
beforeAll(async () => {
  t = await createTestDb()
  afterMigrations = await scalar<boolean>(t.db, 'select occasion_invitations from private.features')
  await t.db.query(SWITCH_OFF) // everything below is about the OFF state
})
afterAll(() => t.close())

describe('the switch after all migrations (4th release)', () => {
  it('is ON: 20261027130000 switches it on with the pilot-4 texts, the column default stays off', async () => {
    expect(afterMigrations).toBe(true)
    expect(t.appliedMigrations).toContain(ON_MIGRATION)
    expect(t.appliedMigrations.indexOf(ON_MIGRATION)).toBeGreaterThan(t.appliedMigrations.indexOf('20261027120000_occasion_invitations.sql'))
    expect(t.appliedMigrations.indexOf(ON_MIGRATION)).toBeGreaterThan(t.appliedMigrations.indexOf('20261026200000_legal_versions_pilot_4.sql'))
    expect(await readFile(join(MIGRATIONS_DIR, ON_MIGRATION), 'utf8')).toMatch(/^update private\.features set occasion_invitations = true;$/m)
    expect(await scalar<string>(t.db, `select column_default from information_schema.columns
      where table_schema = 'private' and table_name = 'features' and column_name = 'occasion_invitations'`)).toBe('false')
  })
})

const TABLES = ['occasion_invitations', 'invitation_attempts', 'occasion_invite_refusals', 'invitation_cooldowns', 'member_invited_by']
const UNKNOWN = '00000000-0000-4000-8000-000000000000'

async function rowsInFeatureTables(): Promise<number> {
  let total = 0
  for (const table of TABLES) total += await scalar<number>(t.db, `select count(*)::int from public.${table}`)
  return total
}

describe('switched off', () => {
  it('the database switch is false for the tests below', async () => {
    expect(await scalar<boolean>(t.db, 'select occasion_invitations from private.features')).toBe(false)
  })

  it('every invitation RPC refuses or shows nothing — and writes nothing', async () => {
    const w = await seedInvites(t)
    await expectRpcError(rpc(t, w.host, 'get_invite_candidates', [w.occasionId]), 'not_found')
    await expectRpcError(rpc(t, w.host, 'send_occasion_invites', [w.occasionId, [w.felix]]), 'not_found')
    await expectRpcError(rpc(t, w.host, 'withdraw_occasion_invite', [w.occasionId, w.felix]), 'not_found')
    await expectRpcError(rpc(t, w.host, 'get_sent_invitations', [w.occasionId]), 'not_found')
    expect(await rpc(t, w.felix, 'get_my_invitations')).toEqual([])
    await expectRpcError(rpc(t, w.felix, 'respond_occasion_invite', [UNKNOWN, true]), 'invite_invalid')
    await expectRpcError(rpc(t, w.felix, 'respond_occasion_invite', [UNKNOWN, false]), 'invite_invalid')
    expect(await rpc(t, w.host, 'get_occasion_invite_info', [w.occasionId])).toEqual({ guests_can_invite: false, can_invite: false, invited_by: [] })
    expect(await rpc(t, w.guest, 'get_occasion_invite_info', [w.occasionId])).toEqual({ guests_can_invite: false, can_invite: false, invited_by: [] })
    expect((await rpc<{ inbox: { occasion_invites: number } }>(t, w.felix, 'get_me')).inbox.occasion_invites).toBe(0)
    // the own export still answers (Art. 15) — and holds no invitation data
    expect(await rpc(t, w.host, 'export_my_invitations')).toMatchObject({
      received: [], sent: [], refusals: [], silences: [], attempts: [], invited_by: [], joined_through_me: [],
    })
    expect(await rowsInFeatureTables()).toBe(0)
  })

  it('the two settings cannot be set through REST (other columns can)', async () => {
    const w = await seedInvites(t)
    await expectRpcError(execAs(t, w.host, 'update occasions set guests_can_invite = true where id = $1', [w.occasionId]), 'not_allowed')
    await expectRpcError(
      t.asUser(w.host, (tx) => tx.query(`insert into occasions (host_id, title, starts_at, guests_can_invite) values ($1, 'X', now() + interval '3 days', true)`, [w.host])),
      'not_allowed',
    )
    await expectRpcError(execAs(t, w.felix, `update profiles set invitations_from = 'nobody' where id = $1`, [w.felix]), 'not_allowed')
    expect(await execAs(t, w.host, `update occasions set title = 'Neu' where id = $1`, [w.occasionId])).toBe(1)
    expect(await execAs(t, w.felix, `update profiles set display_name = 'Felix B.' where id = $1`, [w.felix])).toBe(1)
    expect(await scalar<boolean>(t.db, 'select guests_can_invite from occasions where id = $1', [w.occasionId])).toBe(false)
    expect(await scalar<string>(t.db, 'select invitations_from from profiles where id = $1', [w.felix])).toBe('friends')
  })

  it('the release template (supabase/emergency/occasion_invitations_on.sql) switches it on again', async () => {
    const w = await seedInvites(t)
    await t.db.exec(await readFile(join(MIGRATIONS_DIR, '..', 'emergency', 'occasion_invitations_on.sql'), 'utf8'))
    try {
      expect((await rpc<{ profile: { id: string } }[]>(t, w.host, 'get_invite_candidates', [w.occasionId])).map((c) => c.profile.id).sort())
        .toEqual([w.fabian, w.felix].sort())
      expect(await execAs(t, w.host, 'update occasions set guests_can_invite = true where id = $1', [w.occasionId])).toBe(1)
      await createOccasion(t, w.host, { guestsCanInvite: true })
    } finally {
      await t.db.query(SWITCH_OFF)
    }
  })
})
