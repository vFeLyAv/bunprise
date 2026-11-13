/**
 * IS1–IS8 — in-app invitations and the secrecy of reservations (docs/spec/in-app-invites-design.md §5): the owner of
 * a list (the host, or the owner of a "Meine Follower" list) never learns a bit about reservations through anything
 * the invitation feature added. IS6's lock-order part (acceptance while a reservation on the own list is running)
 * lives on real PostgreSQL: test/concurrency/invitations.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, type TestDb } from '../../src/harness'
import { addWish, createList } from '../follows/seed'
import { createMember, expectRpcError, rpc } from '../pilot/seed'
import { SWITCH_ON, createOccasion, friends, inboxId, outcomeText, respond, seedInvites, send, withdraw, type InviteWorld } from './seed'

let t: TestDb
beforeAll(async () => {
  // the feature ships switched off (20261027120000 header): these tests are about the released feature
  t = await createTestDb({ extraSql: [SWITCH_ON] })
})
afterAll(() => t.close())

const INVITATION_TABLES = ['occasion_invitations', 'invitation_attempts', 'occasion_invite_refusals', 'invitation_cooldowns', 'member_invited_by']

interface SecrecyWorld extends InviteWorld {
  /** Hanna's standalone list "Meine Follower" with one wish */
  followerList: string
  followerWish: string
  /** the occasion of Fabian that Hanna is invited into (pending) */
  foreign: string
}

/**
 * Hanna hosts O; guests may invite; Gina invited Felix, who accepted (a guest by invitation). Olga befriends Hanna
 * and has Hanna's pending invitation into O. Fabian (Hanna's friend) invited HANNA into his own occasion (pending).
 * Hanna also owns a "Meine Follower" list; Fabian, as her follower, can reserve on it.
 */
async function secrecyWorld(): Promise<SecrecyWorld> {
  const w = await seedInvites(t, { guestsCanInvite: true })
  await send(t, w.guest, w.occasionId, [w.felix])
  await respond(t, w.felix, await inboxId(t, w.felix, w.occasionId), true)
  await friends(t, w.host, w.olga)
  await send(t, w.host, w.occasionId, [w.olga]) // Hanna's own pending invitation
  const foreign = (await createOccasion(t, w.fabian, { title: 'Fabians Fest' })).occasionId
  await send(t, w.fabian, foreign, [w.host]) // Hanna is invited somewhere else (pending)
  const followerList = await createList(t, w.host, 'Meine Wünsche', { visibility: 'followers' })
  const followerWish = await addWish(t, w.host, followerList, 'Hängematte')
  return { ...w, followerList, followerWish, foreign }
}

/** Everything the owner (Hanna) can read, as text. */
async function ownerSnapshot(w: SecrecyWorld) {
  const h = w.host
  return {
    get_me: await outcomeText(t, h, 'get_me'),
    get_feed: await outcomeText(t, h, 'get_feed'),
    get_occasion_screen: await outcomeText(t, h, 'get_occasion_screen', [w.occasionId]),
    get_invite_candidates: await outcomeText(t, h, 'get_invite_candidates', [w.occasionId]),
    get_sent_invitations: await outcomeText(t, h, 'get_sent_invitations', [w.occasionId]),
    get_my_invitations: await outcomeText(t, h, 'get_my_invitations'),
    get_occasion_invite_info: await outcomeText(t, h, 'get_occasion_invite_info', [w.occasionId]),
    get_lists_overview: await outcomeText(t, h, 'get_lists_overview'),
    get_list_screen: await outcomeText(t, h, 'get_list_screen', [w.followerList]),
    export_my_invitations: await outcomeText(t, h, 'export_my_invitations'),
    export_my_data: JSON.stringify({ ...(JSON.parse(await outcomeText(t, h, 'export_my_data')) as Record<string, unknown>), exported_at: null }),
  }
}

describe('IS1 — the owner\'s every answer is byte-identical whatever the guests by invitation reserve', () => {
  it('reserve / cancel / re-reserve traffic of an invited guest and a follower changes nothing for Hanna', async () => {
    const w = await secrecyWorld()
    const before = await ownerSnapshot(w)
    expect(before.get_occasion_screen.startsWith('{')).toBe(true) // not vacuous: real answers
    expect(JSON.parse(before.get_my_invitations)).toHaveLength(1)
    expect(JSON.parse(before.get_sent_invitations)).toHaveLength(1)
    await rpc(t, w.felix, 'reserve_wish', [w.wish1])
    await rpc(t, w.felix, 'reserve_wish', [w.wish2])
    await rpc(t, w.fabian, 'reserve_wish', [w.followerWish])
    expect(await ownerSnapshot(w)).toEqual(before)
    await rpc(t, w.felix, 'cancel_reservation', [w.wish1])
    await rpc(t, w.fabian, 'cancel_reservation', [w.followerWish])
    expect(await ownerSnapshot(w)).toEqual(before)
    await rpc(t, w.guest, 'reserve_wish', [w.wish1])
    expect(await ownerSnapshot(w)).toEqual(before)
  })
})

describe('IS2 / IS3 — candidates, send and withdraw ignore reservations', () => {
  it('a friend who reserved on Hanna\'s follower list and one who did not: the same candidate entry, answers and codes', async () => {
    const w = await secrecyWorld()
    const keen = await createMember(t, 'Karla')
    const calm = await createMember(t, 'Kalle')
    await friends(t, w.host, keen)
    await friends(t, w.host, calm)
    const candidatesBefore = await outcomeText(t, w.host, 'get_invite_candidates', [w.occasionId])
    await rpc(t, keen, 'reserve_wish', [w.followerWish])
    expect(await outcomeText(t, w.host, 'get_invite_candidates', [w.occasionId])).toBe(candidatesBefore)
    const cs = await rpc<{ profile: { id: string }; state: string; expires_at: string | null }[]>(t, w.host, 'get_invite_candidates', [w.occasionId])
    const entry = (id: string) => { const c = cs.find((x) => x.profile.id === id)!; return { state: c.state, expires_at: c.expires_at } }
    expect(entry(keen)).toEqual(entry(calm))
    const answer = await send(t, w.host, w.occasionId, [keen, calm])
    expect({ ...answer[0], profile_id: 'x' }).toEqual({ ...answer[1], profile_id: 'x' })
    expect(await withdraw(t, w.host, w.occasionId, keen)).toEqual(await withdraw(t, w.host, w.occasionId, calm))
    // a third person reserving on the occasion list does not move the codes either
    await rpc(t, w.felix, 'reserve_wish', [w.wish2])
    await expectRpcError(send(t, w.host, w.occasionId, [w.felix]), 'not_found') // a member: the same with or without
    await rpc(t, w.felix, 'cancel_reservation', [w.wish2])
    await expectRpcError(send(t, w.host, w.occasionId, [w.felix]), 'not_found')
  })
})

describe('IS4 — the text of every invitation function never names the secret tables', () => {
  it('no reservation, wish or wishlist word in the bodies (pg_proc.prosrc)', async () => {
    const fns = await rows<{ fn: string; src: string }>(
      t.db,
      `select n.nspname || '.' || p.proname as fn, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private')
          and (p.proname ~ '(invitation|invite_candidate|occasion_invites?|invite_info|invite_lock|may_invite|mutual_follow|occasion_invite)'
               or p.proname = 'get_me')
          and p.proname not in ('accept_invite', 'create_invite')
        order by 1`,
    )
    expect(fns.map((f) => f.fn)).toEqual([
      'private.invitation_cutoff',
      'private.invitation_deliverable',
      'private.invitation_sender_state',
      'private.invitation_settings_guard',
      'private.invitation_visible',
      'private.invitations_on',
      'private.invitations_on_block',
      'private.invitations_on_membership',
      'private.invitations_on_nobody',
      'private.invitations_on_occasion_change',
      'private.invitations_on_unfollow',
      'private.invite_lock_key',
      'private.is_invite_candidate',
      'private.is_mutual_follow',
      'private.may_invite',
      'private.purge_invitations',
      'private.visible_invitation_ids',
      'public.export_my_invitations',
      'public.get_invite_candidates',
      'public.get_me',
      'public.get_my_invitations',
      'public.get_occasion_invite_info',
      'public.get_sent_invitations',
      'public.respond_occasion_invite',
      'public.send_occasion_invites',
      'public.withdraw_occasion_invite',
    ])
    for (const f of fns) expect(f.src, f.fn).not.toMatch(/reserv|wishlist|wishes/i)
    // no trigger of the feature sits on a secret table, and no new table references one
    const triggers = await rows<{ tbl: string }>(
      t.db,
      `select c.relname as tbl from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_proc p on p.oid = tg.tgfoid
        where not tg.tgisinternal and p.proname like 'invitations_on%' order by 1`,
    )
    expect(triggers.map((x) => x.tbl)).toEqual(['blocks', 'follows', 'occasion_members', 'occasions', 'profiles'])
    const refs = await rows<{ target: string }>(
      t.db,
      `select distinct confrelid::regclass::text as target from pg_constraint
        where contype = 'f' and conrelid = any ($1::regclass[]) order by 1`,
      [INVITATION_TABLES.map((x) => `public.${x}`)],
    )
    expect(refs.map((r) => r.target)).toEqual(['occasion_members', 'occasions', 'profiles'])
  })
})

describe('IS5 — no REST path to the five tables (select, count, embedding, writes, system columns)', () => {
  it('authenticated and anon: permission denied for every probe', async () => {
    const w = await secrecyWorld()
    const someColumn: Record<string, string> = {
      occasion_invitations: 'inviter_id', invitation_attempts: 'attempted_at', occasion_invite_refusals: 'created_at',
      invitation_cooldowns: 'until', member_invited_by: 'inviter_id',
    }
    for (const table of INVITATION_TABLES) {
      const probes = [
        `select * from public.${table}`,
        `select count(*) from public.${table}`,
        `select xmax from public.${table}`,
        `select o.id from public.occasions o join public.${table} x on true`,
        `delete from public.${table}`,
        `update public.${table} set ${someColumn[table]} = null`,
      ]
      for (const sql of probes) {
        await expectDbError(t.asUser(w.host, (tx) => tx.query(sql)), '42501')
        await expectDbError(t.asUser(w.felix, (tx) => tx.query(sql)), '42501')
        await expectDbError(t.asAnon((tx) => tx.query(sql)), '42501')
      }
    }
    await expectDbError(
      t.asUser(w.host, (tx) => tx.query(`insert into public.occasion_invitations (occasion_id, inviter_id, invitee_id, expires_at, delivered) values ($1, $2, $3, now() + interval '1 day', true)`, [w.occasionId, w.host, w.xaver])),
      '42501',
    )
    // the private helpers are not callable by the API role
    for (const call of [`select private.invitation_visible('${w.occasionId}')`, `select private.is_mutual_follow('${w.host}', '${w.felix}')`]) {
      await expectDbError(t.asUser(w.host, (tx) => tx.query(call)), '42501')
    }
  })
})

describe('IS6 — the host accepted into somebody else\'s occasion: answers about the own occasion and lists stay the same', () => {
  it('get_occasion_screen(own), the follower list and the invite info: byte-identical before and after joining Y', async () => {
    const w = await secrecyWorld()
    await rpc(t, w.felix, 'reserve_wish', [w.wish1])
    await rpc(t, w.fabian, 'reserve_wish', [w.followerWish])
    const own = async () => ({
      screen: await outcomeText(t, w.host, 'get_occasion_screen', [w.occasionId]),
      list: await outcomeText(t, w.host, 'get_list_screen', [w.followerList]),
      info: await outcomeText(t, w.host, 'get_occasion_invite_info', [w.occasionId]),
      candidates: await outcomeText(t, w.host, 'get_invite_candidates', [w.occasionId]),
    })
    const before = await own()
    expect(await respond(t, w.host, await inboxId(t, w.host, w.foreign), true)).toEqual({ occasion_id: w.foreign })
    expect(await own()).toEqual(before)
  })
})

describe('IS7 — a pending invitee reads nothing of the occasion', () => {
  it('screen, cover, bring-along list, list screen, invite info: not_found; REST: no row', async () => {
    const w = await secrecyWorld()
    await t.db.query(`update public.occasions set sections = 'both' where id = $1`, [w.occasionId])
    // Olga has Hanna's pending invitation
    expect((await rpc<unknown[]>(t, w.olga, 'get_my_invitations')).length).toBe(1)
    for (const [fn, args] of [
      ['get_occasion_screen', [w.occasionId]],
      ['get_occasion_photo', [w.occasionId]],
      ['get_occasion_invite_info', [w.occasionId]],
      ['get_list_screen', [w.listId]],
      ['add_potluck_item', [w.occasionId, 'Salat', false]],
      ['get_invite_candidates', [w.occasionId]],
    ] as const) {
      await expectRpcError(rpc(t, w.olga, fn, [...args]), 'not_found')
    }
    for (const sql of [
      `select id from occasions where id = '${w.occasionId}'`,
      `select id from wishlists where occasion_id = '${w.occasionId}'`,
      `select id from wishes where wishlist_id = '${w.listId}'`,
      `select profile_id from occasion_members where occasion_id = '${w.occasionId}'`,
    ]) {
      expect(await t.asUser(w.olga, (tx) => rows(tx, sql)), sql).toEqual([])
    }
    // the profile of the host stays unknown to her (no shared occasion yet): REST profiles shows only herself
    expect(await t.asUser(w.olga, (tx) => rows(tx, 'select id from profiles where id = $1', [w.host]))).toEqual([])
  })
})

describe('IS8 — no realtime', () => {
  it('none of the five tables is in a publication', async () => {
    expect(await rows(t.db, `select tablename from pg_publication_tables where tablename = any ($1::text[])`, [INVITATION_TABLES])).toEqual([])
  })
})
