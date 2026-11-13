/**
 * The bring-along list "Mitbringen" (supabase/migrations/20261025150000_potluck.sql, docs/design/2026-10-25-bring-list.md
 * §2.7) on PGlite. Host A (Anna), members B (Ben) and C (Cem), outsider D (Dana) from seedPilot().
 *   P01 the host's answer stays byte-identical around reservations, and no potluck write touches a wish, a list or a
 *       reservation row (xmin before / after)
 *   P02 catalog: RPC-only table, foreign keys only to occasions / profiles, no function of the feature mentions the
 *       secret part, reservations keep their one trigger
 *   P03 access matrix: host, guest, former / removed member, outsider, blocked with the host, anon
 *   P04 claiming: one bringer, idempotent, own unclaim only, deleted item
 *   P05 rights and limits: rename = author, delete = author or host, 50 entries, titles, sections, consents
 *   P06 leave / removal / block release the commitments, entries stay, a return restores nothing
 *   P07 a blocked pair of guests: "claimed" without the name, the id appears nowhere
 *   P08 account deletion: own entries gone, own commitments released
 *   P09 switching the list off deletes the entries
 *   P10 export_my_potluck: only the caller's own part
 *   P11 get_feed carries sections for every member and stays byte-identical for the host around reservations
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, rows, scalar, type TestDb } from '../../src/harness'
import { countAll, execAs, expectRpcError, rpc, screen, screenText, seedPilot, type OccasionScreen, type Seed } from '../pilot/seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface PotluckItem {
  id: string
  title: string
  created_at: string
  can_edit: boolean
  can_delete: boolean
  claimed: boolean
  claimed_by_me: boolean
  bringer: { profile_id: string; display_name: string | null; photo: unknown } | null
}
type PotluckScreen = OccasionScreen & {
  occasion: OccasionScreen['occasion'] & { sections: 'wishes' | 'bring' | 'both' }
  potluck: { max_items: number; items: PotluckItem[] } | null
}

const FEATURE_FUNCTIONS = [
  'public.add_potluck_item', 'public.rename_potluck_item', 'public.delete_potluck_item', 'public.claim_potluck_item',
  'public.unclaim_potluck_item', 'public.export_my_potluck', 'private.potluck_gate', 'private.potluck_title',
  'private.potluck_screen', 'private.potluck_release_on_leave', 'private.potluck_off',
]

/** The host switches the list on (REST, policy occasions_update) — or off with 'wishes'. */
function setSections(s: Seed, sections: 'wishes' | 'bring' | 'both'): Promise<number> {
  return execAs(t, s.a, 'update occasions set sections = $2 where id = $1', [s.occasionId, sections])
}

async function add(uid: string, s: Seed, title: string, claim = false): Promise<string> {
  return (await rpc<{ id: string }>(t, uid, 'add_potluck_item', [s.occasionId, title, claim])).id
}

async function potluck(uid: string, s: Seed): Promise<PotluckItem[]> {
  const sc = (await screen(t, uid, s.occasionId)) as PotluckScreen
  return sc.potluck?.items ?? []
}

/** A seed with the list switched on and two entries: "Salat" (Anna, free) and "Monopoly" (Ben, he brings it). */
async function seedList(sections: 'bring' | 'both' = 'both') {
  const s = await seedPilot(t)
  expect(await setSections(s, sections)).toBe(1)
  const salat = await add(s.a, s, 'Salat')
  const monopoly = await add(s.b, s, 'Monopoly', true)
  return { s, salat, monopoly }
}

/** Commitments by people who are no longer active members of that occasion (must always be 0). */
function claimsByInactive(): Promise<number> {
  return countAll(t, 'potluck_items i', `i.claimed_by is not null and not exists (select 1 from occasion_members m
    where m.occasion_id = i.occasion_id and m.profile_id = i.claimed_by and m.status = 'active')`)
}

/** xmin of every wish / list / reservation row of the occasion (superuser): a write would change it. */
function secretRowVersions(s: Seed): Promise<{ v: string }[]> {
  return t.asService((tx) =>
    rows<{ v: string }>(
      tx,
      `select 'w:' || w.id || ':' || w.xmin::text as v from wishes w where w.wishlist_id = $1
       union all select 'l:' || wl.id || ':' || wl.xmin::text from wishlists wl where wl.id = $1
       union all select 'r:' || r.id || ':' || r.xmin::text from reservations r where r.wishlist_id = $1
       order by 1`,
      [s.wishlistId],
    ),
  )
}

describe('P01 the secret stays secret', () => {
  it('the host\'s answer with commitments is byte-identical around reservations and cancellations', async () => {
    const { s, salat } = await seedList()
    await rpc(t, s.c, 'claim_potluck_item', [salat])
    const before = await screenText(t, s.a, s.occasionId)
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w2])
    expect(await screenText(t, s.a, s.occasionId)).toBe(before)
    await rpc(t, s.b, 'cancel_reservation', [s.w1])
    await rpc(t, s.c, 'reserve_wish', [s.w1])
    expect(await screenText(t, s.a, s.occasionId)).toBe(before)
    // the new keys add no "reserv": still the 2 null-valued keys per wish of the owner branch
    expect(before.match(/reserv/g)).toHaveLength(6)
  })

  it('adding, claiming, unclaiming, renaming and deleting entries never writes a wish, list or reservation row', async () => {
    const { s, salat, monopoly } = await seedList()
    await rpc(t, s.c, 'reserve_wish', [s.w3])
    const versions = await secretRowVersions(s)
    const extra = await add(s.c, s, 'Musikbox', true)
    await rpc(t, s.b, 'claim_potluck_item', [salat])
    await rpc(t, s.b, 'unclaim_potluck_item', [monopoly])
    await rpc(t, s.c, 'rename_potluck_item', [extra, 'Musikbox (groß)'])
    await rpc(t, s.a, 'delete_potluck_item', [extra])
    expect(await secretRowVersions(s)).toEqual(versions)
  })
})

describe('P02 catalog', () => {
  it('potluck_items: no privilege for any API role, RLS forced without a policy', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        expect(await scalar<boolean>(t.db, `select has_table_privilege('${role}', 'public.potluck_items', '${priv}')`), `${role} ${priv}`).toBe(false)
      }
      expect(await scalar<boolean>(t.db, `select has_any_column_privilege('${role}', 'public.potluck_items', 'select')`)).toBe(false)
    }
    expect(await rows(t.db, `select polname from pg_policy where polrelid = 'public.potluck_items'::regclass`)).toEqual([])
    expect(await rows(t.db, `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.potluck_items'::regclass`))
      .toEqual([{ relrowsecurity: true, relforcerowsecurity: true }])
  })

  it('its foreign keys lead to occasions and profiles only; nothing references it', async () => {
    const out = await rows<{ target: string }>(
      t.db,
      `select confrelid::regclass::text as target from pg_constraint where conrelid = 'public.potluck_items'::regclass and contype = 'f' order by 1`,
    )
    expect(out.map((r) => r.target).sort()).toEqual(['occasions', 'profiles', 'profiles'])
    expect(await rows(t.db, `select conname from pg_constraint where confrelid = 'public.potluck_items'::regclass`)).toEqual([])
  })

  it('no function of the feature mentions the secret part (wishes, lists, reservations)', async () => {
    for (const fn of FEATURE_FUNCTIONS) {
      const body = await scalar<string>(
        t.db,
        `select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = $1`,
        [fn],
      )
      expect(body, fn).not.toMatch(/reserv|wish/i)
    }
    // the screen's new part is outside the owner branch: that branch is unchanged (literal nulls, no reservations)
    const screenBody = await scalar<string>(t.db, `select prosrc from pg_proc where proname = 'get_occasion_screen'`)
    // (since 20261027200000 the wish part of the screen lives in private.list_wish_objects; comments stripped: the
    // branch's own comment says that it never references the reservations table)
    const listBody = await scalar<string>(t.db, `select prosrc from pg_proc where proname = 'list_wish_objects'`)
    const owner = listBody.slice(listBody.indexOf('\n', listBody.indexOf('OWNER BRANCH')), listBody.indexOf('AUDIENCE BRANCH')).replace(/--[^\n]*/g, '')
    expect(owner.length).toBeGreaterThan(100)
    expect(screenBody).not.toMatch(/potluck_screen[\s\S]*OWNER BRANCH/)
    expect(owner).toContain('null::boolean')
    expect(owner).not.toMatch(/potluck/i)
    expect(owner).not.toMatch(/reservations/i)
    expect(screenBody).toMatch(/v_occ\s+record/)
  })

  it('reservations keep exactly one trigger; the only new triggers sit on occasion_members and occasions', async () => {
    const trg = await rows<{ rel: string; tgname: string }>(
      t.db,
      `select c.relname as rel, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal and t.tgname like '%potluck%' order by 1, 2`,
    )
    expect(trg).toEqual([
      { rel: 'occasion_members', tgname: 'occasion_members_potluck_release' },
      { rel: 'occasions', tgname: 'occasions_potluck_off' },
    ])
    const onReservations = await rows<{ tgname: string }>(
      t.db,
      `select t.tgname from pg_trigger t where t.tgrelid = 'public.reservations'::regclass and not t.tgisinternal`,
    )
    expect(onReservations).toEqual([{ tgname: 'reservation_guard' }])
  })
})

describe('P03 access matrix', () => {
  it('host and guests read the same list; nobody else sees it, everybody else gets not_found', async () => {
    const { s, salat, monopoly } = await seedList()
    const host = await potluck(s.a, s)
    expect(host.map((i) => [i.title, i.can_edit, i.can_delete, i.claimed, i.claimed_by_me])).toEqual([
      ['Salat', true, true, false, false],
      ['Monopoly', false, true, true, false],
    ])
    expect(host[1]!.bringer).toEqual({ profile_id: s.b, display_name: 'Ben', photo: null })
    const ben = await potluck(s.b, s)
    expect(ben.map((i) => [i.title, i.can_edit, i.can_delete, i.claimed_by_me])).toEqual([
      ['Salat', false, false, false],
      ['Monopoly', true, true, true],
    ])
    // the outsider
    await expectRpcError(screen(t, s.d, s.occasionId), 'not_found')
    for (const [fn, args] of [
      ['add_potluck_item', [s.occasionId, 'Kuchen', false]],
      ['claim_potluck_item', [salat]],
      ['unclaim_potluck_item', [monopoly]],
      ['rename_potluck_item', [salat, 'x']],
      ['delete_potluck_item', [salat]],
    ] as const) {
      await expectRpcError(rpc(t, s.d, fn, [...args]), 'not_found')
    }
    // anon may not even call the functions
    for (const fn of ['add_potluck_item(null, null, null)', 'claim_potluck_item(null)', 'export_my_potluck()']) {
      await expectDbError(t.asAnon((tx) => tx.query(`select public.${fn}`)), '42501')
    }
  })

  it('a former member, a removed member and a guest blocked with the host: not_found everywhere', async () => {
    const { s, salat } = await seedList()
    await rpc(t, s.b, 'leave_occasion', [s.occasionId])
    await rpc(t, s.a, 'remove_member', [s.occasionId, s.c])
    const blocked = await seedList()
    await rpc(t, blocked.s.b, 'block_user', [blocked.s.a])
    for (const [uid, seed, item] of [[s.b, s, salat], [s.c, s, salat], [blocked.s.b, blocked.s, blocked.salat]] as const) {
      await expectRpcError(screen(t, uid, seed.occasionId), 'not_found')
      await expectRpcError(rpc(t, uid, 'add_potluck_item', [seed.occasionId, 'Kuchen', false]), 'not_found')
      await expectRpcError(rpc(t, uid, 'claim_potluck_item', [item]), 'not_found')
      await expectRpcError(rpc(t, uid, 'delete_potluck_item', [item]), 'not_found')
    }
    // an unknown occasion / item: the same answer
    await expectRpcError(rpc(t, s.a, 'add_potluck_item', ['00000000-0000-4000-8000-000000000000', 'x', false]), 'not_found')
    await expectRpcError(rpc(t, s.a, 'claim_potluck_item', ['00000000-0000-4000-8000-000000000000']), 'not_found')
  })
})

describe('P04 one bringer per entry', () => {
  it('second claimer → already_claimed; the same person twice → ok; only the own commitment can be withdrawn', async () => {
    const { s, salat, monopoly } = await seedList()
    expect(await rpc(t, s.c, 'claim_potluck_item', [salat])).toEqual({ ok: true })
    await expectRpcError(rpc(t, s.b, 'claim_potluck_item', [salat]), 'already_claimed')
    await expectRpcError(rpc(t, s.a, 'claim_potluck_item', [salat]), 'already_claimed')
    expect(await rpc(t, s.c, 'claim_potluck_item', [salat])).toEqual({ ok: true })
    await expectRpcError(rpc(t, s.c, 'unclaim_potluck_item', [monopoly]), 'not_found')
    await expectRpcError(rpc(t, s.a, 'unclaim_potluck_item', [monopoly]), 'not_found')
    expect(await rpc(t, s.b, 'unclaim_potluck_item', [monopoly])).toEqual({ ok: true })
    expect((await potluck(s.a, s)).map((i) => [i.title, i.claimed, i.bringer?.profile_id ?? null])).toEqual([
      ['Salat', true, s.c],
      ['Monopoly', false, null],
    ])
    await rpc(t, s.a, 'delete_potluck_item', [salat])
    await expectRpcError(rpc(t, s.b, 'claim_potluck_item', [salat]), 'not_found')
  })
})

describe('P05 rights and limits', () => {
  it('rename: the author only; delete: the author or the host', async () => {
    const { s, salat, monopoly } = await seedList()
    await expectRpcError(rpc(t, s.b, 'rename_potluck_item', [salat, 'Nudelsalat']), 'not_allowed')
    await expectRpcError(rpc(t, s.a, 'rename_potluck_item', [monopoly, 'Uno']), 'not_allowed')
    expect(await rpc(t, s.a, 'rename_potluck_item', [salat, '  Nudelsalat  '])).toEqual({ ok: true })
    await expectRpcError(rpc(t, s.c, 'delete_potluck_item', [monopoly]), 'not_allowed')
    await expectRpcError(rpc(t, s.b, 'delete_potluck_item', [salat]), 'not_allowed')
    expect(await rpc(t, s.a, 'delete_potluck_item', [monopoly])).toEqual({ ok: true }) // the host: any entry
    expect(await rpc(t, s.a, 'delete_potluck_item', [salat])).toEqual({ ok: true })
    expect(await potluck(s.c, s)).toEqual([])
    const own = await add(s.c, s, 'Gitarre', true)
    expect(await rpc(t, s.c, 'delete_potluck_item', [own])).toEqual({ ok: true }) // the author
  })

  it('titles: trimmed, 1..80 characters, one line', async () => {
    const { s } = await seedList()
    const id = await add(s.c, s, '  Kuchen  ')
    expect((await potluck(s.c, s)).find((i) => i.id === id)!.title).toBe('Kuchen')
    for (const bad of ['', '   ', 'a'.repeat(81), 'Bier\tSaft', 'Bier\nSaft']) {
      await expectRpcError(rpc(t, s.c, 'add_potluck_item', [s.occasionId, bad, false]), 'validation')
      await expectRpcError(rpc(t, s.c, 'rename_potluck_item', [id, bad]), 'validation')
    }
    expect(await add(s.c, s, 'a'.repeat(80))).toEqual(expect.any(String))
  })

  it('at most 50 entries per occasion', async () => {
    const s = await seedPilot(t)
    await setSections(s, 'bring')
    for (let i = 1; i <= 50; i++) await add(i % 2 ? s.b : s.a, s, `Eintrag ${i}`)
    await expectRpcError(rpc(t, s.c, 'add_potluck_item', [s.occasionId, 'Nr. 51', false]), 'limit_reached')
    const sc = (await screen(t, s.c, s.occasionId)) as PotluckScreen
    expect(sc.potluck).toMatchObject({ max_items: 50 })
    expect(sc.potluck!.items).toHaveLength(50)
  })

  it('wishes only: no list (potluck null) and adding is not_allowed; guests cannot switch it on', async () => {
    const s = await seedPilot(t)
    const sc = (await screen(t, s.b, s.occasionId)) as PotluckScreen
    expect(sc.occasion.sections).toBe('wishes')
    expect(sc.potluck).toBeNull()
    await expectRpcError(rpc(t, s.a, 'add_potluck_item', [s.occasionId, 'Salat', false]), 'not_allowed')
    expect(await execAs(t, s.b, 'update occasions set sections = $2 where id = $1', [s.occasionId, 'both'])).toBe(0)
    await expectDbError(execAs(t, s.a, 'update occasions set sections = $2 where id = $1', [s.occasionId, 'alles']), '23514')
  })

  it('without current consents: add / rename / claim → consent_required; reading, withdrawing and deleting still work', async () => {
    const { s, salat, monopoly } = await seedList()
    await t.asService((tx) => tx.query('delete from consents where profile_id = $1', [s.b]))
    await expectRpcError(rpc(t, s.b, 'add_potluck_item', [s.occasionId, 'Kuchen', false]), 'consent_required')
    await expectRpcError(rpc(t, s.b, 'claim_potluck_item', [salat]), 'consent_required')
    await expectRpcError(rpc(t, s.b, 'rename_potluck_item', [monopoly, 'Uno']), 'consent_required')
    expect(await potluck(s.b, s)).toHaveLength(2)
    expect(await rpc(t, s.b, 'unclaim_potluck_item', [monopoly])).toEqual({ ok: true })
    expect(await rpc(t, s.b, 'delete_potluck_item', [monopoly])).toEqual({ ok: true })
  })
})

describe('P06 leaving, removal and blocks release commitments', () => {
  it('leave_occasion: the commitments go, the entries stay, a return restores nothing', async () => {
    const { s, salat, monopoly } = await seedList()
    await rpc(t, s.b, 'claim_potluck_item', [salat])
    await rpc(t, s.b, 'leave_occasion', [s.occasionId])
    expect(await claimsByInactive()).toBe(0)
    expect((await potluck(s.a, s)).map((i) => [i.id, i.claimed])).toEqual([[salat, false], [monopoly, false]])
    await rpc(t, s.b, 'accept_invite', [s.token])
    const back = await potluck(s.b, s)
    expect(back.map((i) => [i.title, i.claimed_by_me, i.can_edit])).toEqual([
      ['Salat', false, false],
      ['Monopoly', false, true], // the own entry is editable again
    ])
  })

  it('remove_member and both directions of a block with the host', async () => {
    for (const end of ['remove', 'guest blocks host', 'host blocks guest'] as const) {
      const { s, salat } = await seedList()
      await rpc(t, s.c, 'claim_potluck_item', [salat])
      if (end === 'remove') await rpc(t, s.a, 'remove_member', [s.occasionId, s.c])
      if (end === 'guest blocks host') await rpc(t, s.c, 'block_user', [s.a])
      if (end === 'host blocks guest') await rpc(t, s.a, 'block_user', [s.c])
      expect(await claimsByInactive(), end).toBe(0)
      expect((await potluck(s.b, s)).map((i) => i.claimed), end).toEqual([false, true])
      expect(await countAll(t, 'potluck_items', 'occasion_id = $1', [s.occasionId]), end).toBe(2)
    }
  })
})

describe('P07 a blocked pair of guests', () => {
  it('sees "claimed" without the name, and the other id appears nowhere in the answer', async () => {
    const { s, salat } = await seedList()
    await rpc(t, s.c, 'claim_potluck_item', [salat])
    await rpc(t, s.b, 'block_user', [s.c])
    const ben = await potluck(s.b, s)
    expect(ben.find((i) => i.id === salat)).toMatchObject({ claimed: true, claimed_by_me: false, bringer: null })
    expect((await screenText(t, s.b, s.occasionId)).includes(s.c)).toBe(false)
    expect((await screenText(t, s.c, s.occasionId)).includes(s.b)).toBe(false)
    // both are still members of Anna's occasion; Anna sees both names
    expect((await potluck(s.a, s)).find((i) => i.id === salat)!.bringer?.profile_id).toBe(s.c)
  })
})

describe('P08 account deletion', () => {
  it('the own entries are deleted, the own commitments released; nothing of the person remains', async () => {
    const { s, salat, monopoly } = await seedList()
    const cake = await add(s.c, s, 'Kuchen')
    await rpc(t, s.c, 'claim_potluck_item', [salat])
    await rpc(t, s.b, 'claim_potluck_item', [cake])
    await rpc(t, s.c, 'delete_my_account')
    expect((await potluck(s.a, s)).map((i) => [i.id, i.claimed])).toEqual([[salat, false], [monopoly, true]])
    expect(await countAll(t, 'potluck_items', 'created_by = $1 or claimed_by = $1', [s.c])).toBe(0)
  })
})

describe('P09 switching the list off', () => {
  it('both → wishes deletes the entries; on again: an empty list', async () => {
    const { s } = await seedList()
    expect(await setSections(s, 'wishes')).toBe(1)
    expect(await countAll(t, 'potluck_items', 'occasion_id = $1', [s.occasionId])).toBe(0)
    expect(((await screen(t, s.b, s.occasionId)) as PotluckScreen).potluck).toBeNull()
    await setSections(s, 'bring')
    expect(((await screen(t, s.b, s.occasionId)) as PotluckScreen).potluck).toEqual({ max_items: 50, items: [] })
    // bring ↔ both keeps the entries
    await add(s.b, s, 'Bier')
    await setSections(s, 'both')
    expect(await potluck(s.b, s)).toHaveLength(1)
  })

  it('deleting the occasion deletes its entries', async () => {
    const { s } = await seedList()
    expect(await execAs(t, s.a, 'delete from occasions where id = $1', [s.occasionId])).toBe(1)
    expect(await countAll(t, 'potluck_items', 'occasion_id = $1', [s.occasionId])).toBe(0)
  })
})

describe('P10 export_my_potluck', () => {
  it('only the own entries and commitments, no other person; the title only while a member', async () => {
    const { s, salat, monopoly } = await seedList()
    await rpc(t, s.c, 'claim_potluck_item', [salat])
    const ben = await rpc<{ format: string; occasions: unknown[] }>(t, s.b, 'export_my_potluck')
    expect(ben).toEqual({
      format: 'bunprise-potluck-v1',
      occasions: [{
        occasion_id: s.occasionId, occasion_title: 'Geburtstag Anna', sections: null,
        items_created: [{ title: 'Monopoly', created_at: expect.any(String), claimed: true }],
        my_claims: [{ title: 'Monopoly' }],
      }],
    })
    const text = JSON.stringify(ben)
    // ("Anna" is in the occasion title itself — the people are checked by id and by the other guest's name)
    for (const other of [s.a, s.c, 'Cem', salat, monopoly]) expect(text.includes(other), other).toBe(false)
    const anna = await rpc<{ occasions: { sections: string; items_created: unknown[]; my_claims: unknown[] }[] }>(t, s.a, 'export_my_potluck')
    expect(anna.occasions).toEqual([expect.objectContaining({ sections: 'both', items_created: [{ title: 'Salat', created_at: expect.any(String), claimed: true }], my_claims: [] })])
    await rpc(t, s.b, 'leave_occasion', [s.occasionId])
    const after = await rpc<{ occasions: { occasion_title: string | null; my_claims: unknown[] }[] }>(t, s.b, 'export_my_potluck')
    expect(after.occasions).toEqual([expect.objectContaining({ occasion_title: null, my_claims: [] })])
    expect(await rpc(t, s.d, 'export_my_potluck')).toEqual({ format: 'bunprise-potluck-v1', occasions: [] })
  })
})

describe('P11 the feed says what the occasion offers', () => {
  it('every member\'s get_feed row carries sections; it never depends on reservations', async () => {
    const s = await seedPilot(t)
    type FeedRow = { id: string; sections: string; role: string }
    const row = async (uid: string) =>
      (await rpc<{ upcoming: FeedRow[] }>(t, uid, 'get_feed')).upcoming.find((r) => r.id === s.occasionId)
    expect((await row(s.a))?.sections).toBe('wishes')
    expect(await setSections(s, 'bring')).toBe(1)
    for (const uid of [s.a, s.b, s.c]) expect((await row(uid))?.sections).toBe('bring')
    // the host's whole feed answer is the same around a reservation (the key is a column of the occasion)
    const before = JSON.stringify(await rpc(t, s.a, 'get_feed'))
    await setSections(s, 'both')
    const both = JSON.stringify(await rpc(t, s.a, 'get_feed'))
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    expect(JSON.stringify(await rpc(t, s.a, 'get_feed'))).toBe(both)
    expect(before).not.toBe(both)
  })
})
