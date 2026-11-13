/**
 * create_invite / accept_invite (pilot-decisions §2, §4): host only, revoke-others, expiry rule, hashed token,
 * one `invite_invalid` for every failure reason, consent/profile gates, re-activation of removed/left members.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, one, rows, scalar, type TestDb } from '../../src/harness'
import { countAll, countAs, createMember, execAs, expectRpcError, giveConsents, rpc, screen, seedPilot, type Seed } from './seed'

let t: TestDb
let s: Seed
beforeAll(async () => {
  t = await createTestDb()
  s = await seedPilot(t)
})
afterAll(() => t.close())

const HEX64 = /^[0-9a-f]{64}$/

async function inviteRow(token: string) {
  return one<{ id: string; use_count: number; max_uses: number; revoked_at: string | null; expires_at: string; diff_starts7: number; diff_now14: number }>(
    t.db,
    `select i.id, i.use_count, i.max_uses, i.revoked_at, i.expires_at,
            extract(epoch from (i.expires_at - (o.starts_at + interval '7 days')))::float8 as diff_starts7,
            extract(epoch from (i.expires_at - (now() + interval '14 days')))::float8 as diff_now14
       from invites i join occasions o on o.id = i.occasion_id
      where i.token_hash = sha256(convert_to($1::text, 'UTF8'))`,
    [token],
  )
}

describe('create_invite', () => {
  it('only the host: member and outsider get not_found, anon permission denied', async () => {
    await expectRpcError(rpc(t, s.b, 'create_invite', [s.occasionId]), 'not_found')
    await expectRpcError(rpc(t, s.d, 'create_invite', [s.occasionId]), 'not_found')
    await expectRpcError(rpc(t, s.a, 'create_invite', ['00000000-0000-4000-8000-000000000000']), 'not_found')
    await expectDbError(t.asAnon((tx) => tx.query('select public.create_invite($1)', [s.occasionId])), '42501')
  })

  it('returns a 64-hex token once; the database keeps only its sha256; max_uses 50; expiry = starts_at + 7 d when later', async () => {
    const { token } = await rpc<{ token: string }>(t, s.a, 'create_invite', [s.occasionId])
    expect(token).toMatch(HEX64)
    const row = await inviteRow(token)
    expect(row).toMatchObject({ use_count: 0, max_uses: 50, revoked_at: null })
    expect(Math.abs(row!.diff_starts7)).toBeLessThan(1) // occasion in 30 days → starts_at + 7 d > now + 14 d
    // the plain token is stored nowhere
    expect(await scalar<number>(t.db, `select count(*)::int from invites where encode(token_hash, 'hex') = $1`, [token])).toBe(0)
    expect(await countAll(t, 'invites', 'occasion_id = $1', [s.occasionId])).toBe(2)
  })

  it('expiry = now + 14 d when the occasion is sooner than 7 days before that', async () => {
    const soon = await seedPilot(t, { startsInDays: 2 })
    const row = await inviteRow(soon.token)
    expect(Math.abs(row!.diff_now14)).toBeLessThan(120)
  })

  it('a new link revokes every older active link of the occasion', async () => {
    const s2 = await seedPilot(t)
    const first = s2.token
    const { token: second } = await rpc<{ token: string }>(t, s2.a, 'create_invite', [s2.occasionId])
    expect(second).not.toBe(first)
    expect((await inviteRow(first))!.revoked_at).not.toBeNull()
    expect((await inviteRow(second))!.revoked_at).toBeNull()
    await expectRpcError(rpc(t, s2.d, 'accept_invite', [first]), 'invite_invalid')
    expect(await rpc(t, s2.d, 'accept_invite', [second])).toEqual({ occasion_id: s2.occasionId })
    // the screen shows the active one (expires_at only), never a token
    const sc = await screen(t, s2.a, s2.occasionId)
    expect(sc.invite).toEqual({ active: true, expires_at: expect.any(String) })
  })
})

describe('accept_invite', () => {
  it('happy path: membership active/member/none, use_count +1, idempotent for an existing member', async () => {
    const s3 = await seedPilot(t)
    const before = (await inviteRow(s3.token))!.use_count
    expect(await rpc(t, s3.d, 'accept_invite', [s3.token])).toEqual({ occasion_id: s3.occasionId })
    const m = await one<{ role: string; rsvp: string; status: string; invited_via: string }>(
      t.db,
      'select role, rsvp, status, invited_via from occasion_members where occasion_id = $1 and profile_id = $2',
      [s3.occasionId, s3.d],
    )
    expect(m).toEqual({ role: 'member', rsvp: 'none', status: 'active', invited_via: (await inviteRow(s3.token))!.id })
    expect((await inviteRow(s3.token))!.use_count).toBe(before + 1)
    expect(await countAs(t, s3.d, 'wishes')).toBe(3)
    // again: same answer, no second use
    expect(await rpc(t, s3.d, 'accept_invite', [s3.token])).toEqual({ occasion_id: s3.occasionId })
    expect((await inviteRow(s3.token))!.use_count).toBe(before + 1)
    // the host on their own link: no change either
    expect(await rpc(t, s3.a, 'accept_invite', [s3.token])).toEqual({ occasion_id: s3.occasionId })
    expect((await inviteRow(s3.token))!.use_count).toBe(before + 1)
    expect(await countAll(t, 'occasion_members', `occasion_id = $1 and role = 'host'`, [s3.occasionId])).toBe(1)
  })

  it('one code for expired / revoked / exhausted / unknown / malformed tokens', async () => {
    const s4 = await seedPilot(t)
    const guest = await createMember(t, 'Ines')
    const fresh = async () => (await rpc<{ token: string }>(t, s4.a, 'create_invite', [s4.occasionId])).token

    const expired = await fresh()
    await t.asService((tx) => tx.query(`update invites set expires_at = now() - interval '1 minute' where token_hash = sha256(convert_to($1::text, 'UTF8'))`, [expired]))
    await expectRpcError(rpc(t, guest, 'accept_invite', [expired]), 'invite_invalid')

    const revoked = await fresh()
    const revokedId = (await inviteRow(revoked))!.id
    expect(await execAs(t, s4.a, `update invites set revoked_at = now() where id = $1`, [revokedId])).toBe(1) // host revokes via REST
    await expectRpcError(rpc(t, guest, 'accept_invite', [revoked]), 'invite_invalid')
    // revocation is irreversible, and members cannot touch invites at all
    await expectRpcError(t.asUser(s4.a, (tx) => tx.query(`update invites set revoked_at = null where id = $1`, [revokedId])), 'not_allowed')
    expect(await execAs(t, s4.b, `update invites set revoked_at = now()`)).toBe(0)

    const exhausted = await fresh()
    await t.asService((tx) => tx.query(`update invites set use_count = max_uses where token_hash = sha256(convert_to($1::text, 'UTF8'))`, [exhausted]))
    await expectRpcError(rpc(t, guest, 'accept_invite', [exhausted]), 'invite_invalid')

    await expectRpcError(rpc(t, guest, 'accept_invite', ['nope']), 'invite_invalid')
    await expectRpcError(rpc(t, guest, 'accept_invite', ['0'.repeat(64)]), 'invite_invalid')
    await expectRpcError(rpc(t, guest, 'accept_invite', [null]), 'invite_invalid')

    // and a good one still works afterwards
    const good = await fresh()
    expect(await rpc(t, guest, 'accept_invite', [good])).toEqual({ occasion_id: s4.occasionId })
    expect(await countAll(t, 'invites', 'occasion_id = $1 and revoked_at is null', [s4.occasionId])).toBe(1)
  })

  it('consent_required without consents, profile_incomplete without display_name', async () => {
    const s5 = await seedPilot(t)
    const noConsent = await createMember(t, 'Jonas', { consents: false })
    await expectRpcError(rpc(t, noConsent, 'accept_invite', [s5.token]), 'consent_required')
    await giveConsents(t, noConsent)
    expect(await rpc(t, noConsent, 'accept_invite', [s5.token])).toEqual({ occasion_id: s5.occasionId })

    const noName = await t.createUser('noname-invite@example.test', {})
    await giveConsents(t, noName)
    await expectRpcError(rpc(t, noName, 'accept_invite', [s5.token]), 'profile_incomplete')
    await execAs(t, noName, `update profiles set display_name = 'Kai' where id = $1`, [noName])
    expect(await rpc(t, noName, 'accept_invite', [s5.token])).toEqual({ occasion_id: s5.occasionId })
  })

  it('blocked pair: invite_invalid until unblocked', async () => {
    const s6 = await seedPilot(t)
    await rpc(t, s6.a, 'block_user', [s6.d])
    await expectRpcError(rpc(t, s6.d, 'accept_invite', [s6.token]), 'invite_invalid')
    await rpc(t, s6.a, 'unblock_user', [s6.d])
    expect(await rpc(t, s6.d, 'accept_invite', [s6.token])).toEqual({ occasion_id: s6.occasionId })
  })

  it('removed and left members are re-activated by a link (pilot-decisions §1)', async () => {
    const s7 = await seedPilot(t)
    await rpc(t, s7.a, 'remove_member', [s7.occasionId, s7.b])
    await rpc(t, s7.c, 'leave_occasion', [s7.occasionId])
    await expectRpcError(screen(t, s7.b, s7.occasionId), 'not_found')
    await expectRpcError(screen(t, s7.c, s7.occasionId), 'not_found')
    expect(await rows(t.db, `select profile_id, status from occasion_members where occasion_id = $1 and status <> 'active' order by status`, [s7.occasionId])).toEqual([
      { profile_id: s7.c, status: 'left' },
      { profile_id: s7.b, status: 'removed' },
    ])
    const { token: newLink } = await rpc<{ token: string }>(t, s7.a, 'create_invite', [s7.occasionId])
    expect(await rpc(t, s7.b, 'accept_invite', [newLink])).toEqual({ occasion_id: s7.occasionId })
    expect(await rpc(t, s7.c, 'accept_invite', [newLink])).toEqual({ occasion_id: s7.occasionId })
    expect(await countAll(t, 'occasion_members', `occasion_id = $1 and status = 'active'`, [s7.occasionId])).toBe(3)
    expect((await screen(t, s7.b, s7.occasionId)).viewer).toEqual({ role: 'member', rsvp: 'none' })
    expect((await inviteRow(newLink))!.use_count).toBe(2)
  })
})
