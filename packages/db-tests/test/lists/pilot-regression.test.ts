/**
 * F17 — pilot regression on ONE seed (follows-design §7.2): the database is built with every migration BEFORE wave 2b
 * (supabase/migrations/* < 20261020200000), seeded with pilot data (reservations, a guest who left, a removed guest,
 * a guest who blocked the host, two guests who blocked each other), then exactly the wave-2b migrations M1–M4
 * are applied ON TOP of that data, like `supabase db push` would. Byte for byte unchanged:
 * get_occasion_screen and get_feed for host and guests; the host's export block occasions_hosted[].members (the
 * export format itself becomes v2 in M1). The M2 policy filter is on ACTIVE rows only, so "left / removed" rows stay
 * visible to the host. The later feed identity migration has a separate strict additive contract below.
 */
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, createTestDb, scalar, type TestDb } from '../../src/harness'
import { createMember, rpc, seedPilot, type Seed } from '../pilot/seed'

const WAVE_2B_FIRST = '20261020200000'
const WAVE_2B_LAST = '20261020200300_free_wishes.sql'
const FEED_IDENTITY = '20261020221230_feed_host_identity.sql'

let t: TestDb
let dir: string
let waveFiles: string[]
let s: Seed
let emil: string
let frieda: string

beforeAll(async () => {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  waveFiles = files.filter((f) => f >= WAVE_2B_FIRST && f <= WAVE_2B_LAST)
  dir = await mkdtemp(join(tmpdir(), 'bunprise-pilot-only-'))
  for (const f of files.filter((x) => x < WAVE_2B_FIRST)) await copyFile(join(MIGRATIONS_DIR, f), join(dir, f))
  t = await createTestDb({ migrationsDir: dir })

  s = await seedPilot(t)
  await rpc(t, s.b, 'reserve_wish', [s.w1])
  await rpc(t, s.c, 'reserve_wish', [s.w2])
  await rpc(t, s.b, 'cancel_reservation', [s.w1])
  await rpc(t, s.c, 'reserve_wish', [s.w1])
  emil = await createMember(t, 'Emil')
  frieda = await createMember(t, 'Frieda')
  await rpc(t, emil, 'accept_invite', [s.token])
  await rpc(t, frieda, 'accept_invite', [s.token])
  await rpc(t, emil, 'block_user', [s.a]) // a guest blocks the host: reads as 'left' for the host
  await rpc(t, s.a, 'remove_member', [s.occasionId, frieda]) // 'removed' (revokes the link)
  await rpc(t, s.b, 'block_user', [s.c]) // two guests block each other: both stay active
})
afterAll(async () => {
  await t?.close()
  await rm(dir, { recursive: true, force: true })
})

async function snapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [who, uid] of [['host', s.a], ['ben', s.b], ['cem', s.c]] as const) {
    out[`screen:${who}`] = await t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_occasion_screen($1)::text', [s.occasionId]))
    out[`feed:${who}`] = await t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_feed()::text'))
  }
  for (const [who, uid] of [['emil', emil], ['frieda', frieda], ['dana', s.d]] as const) {
    out[`feed:${who}`] = await t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_feed()::text'))
  }
  out['export:members'] = await t.asUser(s.a, (tx) =>
    scalar<string>(tx, `select (public.export_my_data() -> 'occasions_hosted' -> 0 -> 'members')::text`),
  )
  // M3 (follows-design §5.5) adds ONE key to my_reservations: `list` — always null for an occasion's reservation.
  // It is checked here and left out, everything else stays compared byte for byte (the same JSON text otherwise).
  const mine = JSON.parse(await t.asUser(s.c, (tx) => scalar<string>(tx, 'select public.my_reservations()::text'))) as Record<string, unknown>[]
  for (const r of mine) {
    if ('list' in r) {
      expect(r['list'], 'my_reservations.list of an occasion reservation').toBeNull()
      delete r['list']
    }
  }
  out['my_reservations:cem'] = JSON.stringify(mine)
  return out
}

describe('F17: pilot answers before and after the wave-2b migrations, on the same data', () => {
  it('applies exactly M1–M4 on top of a seeded pilot database', () => {
    expect(waveFiles).toEqual([
      '20261020200000_lists_standalone.sql',
      '20261020200100_follows.sql',
      '20261020200200_follow_sharing.sql', // M3 (agent J2)
      '20261020200300_free_wishes.sql', // M4 (agent J2)
    ])
  })

  it('get_occasion_screen, get_feed, my_reservations and the host export members block are byte-identical', async () => {
    const before = await snapshot()
    expect(JSON.parse(before['export:members']!).map((m: { status: string }) => m.status)).toEqual(['active', 'active', 'active', 'left', 'removed'])
    for (const file of waveFiles) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      await t.db.transaction((tx) => tx.exec(sql))
    }
    expect(await scalar<string>(t.db, `select pg_get_function_result('public.get_list_screen(uuid)'::regprocedure)`)).toBe('jsonb')
    const after = await snapshot()
    expect(after).toEqual(before)
    // the format changed by design (M1) — the only difference of the host export's head
    expect(await t.asUser(s.a, (tx) => scalar<string>(tx, `select public.export_my_data() ->> 'format'`))).toBe('bunprise-export-v2')
  })

  it('after the migrations the host still reads the left / removed rows through REST; the blocked guests do not see each other', async () => {
    const hostView = await t.asUser(s.a, (tx) =>
      scalar<string>(tx, `select string_agg(status, ',' order by status) from occasion_members where occasion_id = $1 and role = 'member'`, [s.occasionId]),
    )
    expect(hostView).toBe('active,active,left,removed')
    const benView = await t.asUser(s.b, (tx) =>
      scalar<number>(tx, `select count(*)::int from occasion_members where occasion_id = $1 and profile_id = $2`, [s.occasionId, s.c]),
    )
    expect(benView).toBe(0) // M2: the active row of a blocked pair is hidden through REST as well
  })

  it('the later feed identity migration adds only the real host_id to accessible feed rows', async () => {
    const before = await snapshot()
    await t.db.transaction(async (tx) => tx.exec(await readFile(join(MIGRATIONS_DIR, FEED_IDENTITY), 'utf8')))
    const after = await snapshot()
    expect(Object.keys(after)).toEqual(Object.keys(before))

    for (const key of Object.keys(before)) {
      if (!key.startsWith('feed:')) {
        expect(after[key], key).toBe(before[key])
        continue
      }
      const legacy = JSON.parse(before[key]!) as Record<string, Record<string, unknown>[]>
      const current = JSON.parse(after[key]!) as Record<string, Record<string, unknown>[]>
      expect(Object.keys(current), key).toEqual(Object.keys(legacy))
      for (const bucket of Object.keys(legacy)) {
        for (const row of legacy[bucket]!) expect(row, `${key}/${bucket} before`).not.toHaveProperty('host_id')
        // Same array order, values and exact keys, plus the fixture occasion's real host — no projection
        // or removal of host_id can hide a change to any other feed field.
        expect(current[bucket], `${key}/${bucket}`).toEqual(legacy[bucket]!.map((row) => ({ ...row, host_id: s.a })))
      }
      if (['feed:host', 'feed:ben', 'feed:cem'].includes(key)) {
        expect([...current['upcoming']!, ...current['past']!].map((row) => row['id']), key).toEqual([s.occasionId])
      } else {
        // Left, removed and never-invited people gain no identity or feed rows.
        expect(after[key], key).toBe(before[key])
        expect(current, key).toEqual({ upcoming: [], past: [] })
      }
    }
  })
})
