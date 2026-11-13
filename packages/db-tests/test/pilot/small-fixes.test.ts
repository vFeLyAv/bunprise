/**
 * Р11 small fixes (20261026190000_small_fixes.sql, Felix 26.10):
 *   - accept_invite: a cancelled occasion cannot be joined by an old link — the SAME `invite_invalid` as an
 *     unknown token (nothing about the occasion leaks), no membership, no use counted;
 *   - private.purge_unconfirmed_users: besides the 24-hour rule for never-signed-in addresses, accounts that
 *     signed in but never finished the setup (no consent record at all) go 30 days after the last sign-in;
 *     finished accounts — also those that only have to accept newer texts — stay.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, type DbError, type TestDb } from '../../src/harness'
import { countAll, createMember, execAs, expectRpcError, rpc, screen, seedPilot } from './seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

/** The parts of an error the client can see. */
const visible = (e: DbError) => {
  const x = e as DbError & { detail?: unknown; hint?: unknown }
  return { code: x.code, message: x.message, detail: x.detail ?? null, hint: x.hint ?? null }
}

const useCount = (token: string) =>
  rows<{ use_count: number }>(t.db, `select use_count from invites where token_hash = sha256(convert_to($1::text, 'UTF8'))`, [token])

describe('accept_invite and a cancelled occasion', () => {
  it('an old link of a cancelled occasion answers exactly like an unknown link; nobody joins, no use is counted', async () => {
    const s = await seedPilot(t)
    const before = await useCount(s.token)
    expect(await execAs(t, s.a, `update occasions set cancelled_at = now() where id = $1`, [s.occasionId])).toBe(1) // host cancels via REST

    const cancelled = visible(await expectRpcError(rpc(t, s.d, 'accept_invite', [s.token]), 'invite_invalid'))
    const unknown = visible(await expectRpcError(rpc(t, s.d, 'accept_invite', ['0'.repeat(64)]), 'invite_invalid'))
    expect(cancelled).toEqual(unknown)
    expect(await countAll(t, 'occasion_members', 'occasion_id = $1 and profile_id = $2', [s.occasionId, s.d])).toBe(0)
    await expectRpcError(screen(t, s.d, s.occasionId), 'not_found')
    expect(await useCount(s.token)).toEqual(before)
  })

  it('a guest who left cannot come back by the old link while the occasion is cancelled; the host still gets the same code', async () => {
    const s = await seedPilot(t)
    await rpc(t, s.c, 'leave_occasion', [s.occasionId])
    await execAs(t, s.a, `update occasions set cancelled_at = now() where id = $1`, [s.occasionId])
    await expectRpcError(rpc(t, s.c, 'accept_invite', [s.token]), 'invite_invalid')
    expect(await rows(t.db, `select status from occasion_members where occasion_id = $1 and profile_id = $2`, [s.occasionId, s.c])).toEqual([{ status: 'left' }])
    // members and the host opening the link: the same answer, their membership is untouched
    await expectRpcError(rpc(t, s.b, 'accept_invite', [s.token]), 'invite_invalid')
    await expectRpcError(rpc(t, s.a, 'accept_invite', [s.token]), 'invite_invalid')
    expect((await screen(t, s.b, s.occasionId)).viewer).toEqual({ role: 'member', rsvp: 'none' })
  })

  it('the cancellation taken back: the link works again (it is a key to a live occasion)', async () => {
    const s = await seedPilot(t)
    await execAs(t, s.a, `update occasions set cancelled_at = now() where id = $1`, [s.occasionId])
    await expectRpcError(rpc(t, s.d, 'accept_invite', [s.token]), 'invite_invalid')
    await execAs(t, s.a, `update occasions set cancelled_at = null where id = $1`, [s.occasionId])
    expect(await rpc(t, s.d, 'accept_invite', [s.token])).toEqual({ occasion_id: s.occasionId })
  })

  it('a deleted occasion: its links are gone with it — the same code', async () => {
    const s = await seedPilot(t)
    expect(await execAs(t, s.a, `delete from occasions where id = $1`, [s.occasionId])).toBe(1)
    expect(await countAll(t, 'invites', 'occasion_id = $1', [s.occasionId])).toBe(0)
    await expectRpcError(rpc(t, s.d, 'accept_invite', [s.token]), 'invite_invalid')
  })
})

describe('purge_unconfirmed_users and accounts that never finished the setup', () => {
  it('deletes never-signed-in addresses after 24 h and unfinished accounts 30 days after the last sign-in — nothing else', async () => {
    const at = (id: string, created: string, signedIn: string | null) =>
      t.asService((tx) =>
        tx.query(`update auth.users set created_at = now() - $2::interval, last_sign_in_at = now() - $3::interval where id = $1`, [id, created, signedIn]),
      )
    // never signed in (unchanged 24-hour rule)
    const neverOld = await t.createUser('never-old@example.test')
    const neverNew = await t.createUser('never-new@example.test')
    await at(neverOld, '25 hours', null)
    await at(neverNew, '23 hours', null)
    // signed in, setup never finished: no name (code sign-in) and a Google name suggestion, both without any consent
    const unfinishedNoName = await t.createUser('unfinished-noname@example.test')
    const unfinishedGoogle = await t.createUser('unfinished-google@example.test', { full_name: 'Gesa Beispiel' })
    const unfinishedRecent = await t.createUser('unfinished-recent@example.test')
    const unfinishedNew = await t.createUser('unfinished-new@example.test')
    await at(unfinishedNoName, '40 days', '31 days')
    await at(unfinishedGoogle, '31 days', '31 days')
    await at(unfinishedRecent, '90 days', '29 days') // came back recently: keeps the 30 days from now on
    await at(unfinishedNew, '10 days', '10 days')
    // finished accounts: current consents, or only older versions (has to re-confirm newer texts)
    const finished = await createMember(t, 'Fiona')
    const reconsent = await t.createUser('reconsent@example.test', { name: 'Rene' })
    await t.asService((tx) =>
      tx.query(`insert into consents (profile_id, kind, version, locale) select $1, lv.kind, 'old-' || lv.kind, 'de' from legal_versions lv`, [reconsent]),
    )
    await at(finished, '400 days', '100 days')
    await at(reconsent, '400 days', '100 days')

    const all = [neverOld, neverNew, unfinishedNoName, unfinishedGoogle, unfinishedRecent, unfinishedNew, finished, reconsent]
    await t.asService((tx) => tx.query('select private.purge_unconfirmed_users()'))
    const left = await rows<{ id: string }>(t.db, `select id from auth.users where id = any($1::uuid[])`, [all])
    expect(left.map((r) => r.id).sort()).toEqual([neverNew, unfinishedRecent, unfinishedNew, finished, reconsent].sort())
    // the profile goes with the account (cascade); the finished ones keep theirs
    const profiles = await rows<{ id: string }>(t.db, `select id from profiles where id = any($1::uuid[])`, [all])
    expect(profiles.map((r) => r.id).sort()).toEqual([neverNew, unfinishedRecent, unfinishedNew, finished, reconsent].sort())
  })

  it('the API roles still cannot run it', async () => {
    const u = await createMember(t, 'Pia')
    await expectDbError(t.asUser(u, (tx) => tx.query('select private.purge_unconfirmed_users()')), '42501')
    await expectDbError(t.asAnon((tx) => tx.query('select private.purge_unconfirmed_users()')), '42501')
  })
})
