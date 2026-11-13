/**
 * The cover motif of an occasion (supabase/migrations/20261027140000_occasion_cover_theme.sql, Felix 26.10):
 *   occasions.cover_theme is null by default (every occasion so far: no motif), the host stores a key of the
 *   allow-list or 'none' through REST (insert and update), host and members get the same value through
 *   get_occasion_screen and get_feed; an unknown key is refused; a guest or an outsider cannot write it; an outsider
 *   learns nothing; the owner's screen and feed stay byte-identical whatever is reserved. The allow-list is the
 *   app's THEME_IDS (apps/web/src/features/occasions/covers/themes.ts) + 'none'.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectDbError, MIGRATIONS_DIR, rows, scalar, type TestDb } from '../../src/harness'
import { createMember, execAs, rpc, screen, screenText, seedPilot, type Feed, type Seed } from '../pilot/seed'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

interface CoverScreen {
  occasion: { cover_theme?: string | null; title: string }
}
type CoverFeed = { upcoming: (Feed['upcoming'][number] & { cover_theme?: string | null })[]; past: (Feed['past'][number] & { cover_theme?: string | null })[] }

const feedText = (uid: string) => t.asUser(uid, (tx) => scalar<string>(tx, 'select public.get_feed()::text'))
const feedRow = async (uid: string, occasionId: string) => {
  const feed = await rpc<CoverFeed>(t, uid, 'get_feed')
  return [...feed.upcoming, ...feed.past].find((row) => row.id === occasionId)
}
const screenTheme = async (uid: string, occasionId: string) => (await screen(t, uid, occasionId) as unknown as CoverScreen).occasion

/** The host sets the motif through REST (the app's path: column grant + policy occasions_update). */
function setTheme(s: Seed, theme: string | null, as = s.a): Promise<number> {
  return execAs(t, as, 'update occasions set cover_theme = $2 where id = $1', [s.occasionId, theme])
}

describe('cover_theme in the screens', () => {
  it('null by default: the key is there for host and members, in the screen and in the feed', async () => {
    const s = await seedPilot(t)
    for (const uid of [s.a, s.b, s.c]) {
      const occasion = await screenTheme(uid, s.occasionId)
      expect('cover_theme' in occasion).toBe(true)
      expect(occasion.cover_theme).toBeNull()
      const row = await feedRow(uid, s.occasionId)
      expect(row && 'cover_theme' in row).toBe(true)
      expect(row?.cover_theme).toBeNull()
    }
  })

  it('stored by the host, returned to host and members alike; "none" (switched off) and null again', async () => {
    const s = await seedPilot(t)
    expect(await setTheme(s, 'birthday')).toBe(1)
    for (const uid of [s.a, s.b, s.c]) {
      expect((await screenTheme(uid, s.occasionId)).cover_theme).toBe('birthday')
      expect((await feedRow(uid, s.occasionId))?.cover_theme).toBe('birthday')
    }
    expect(await setTheme(s, 'none')).toBe(1)
    for (const uid of [s.a, s.b]) {
      expect((await screenTheme(uid, s.occasionId)).cover_theme).toBe('none')
      expect((await feedRow(uid, s.occasionId))?.cover_theme).toBe('none')
    }
    expect(await setTheme(s, null)).toBe(1)
    expect((await screenTheme(s.b, s.occasionId)).cover_theme).toBeNull()
  })

  it('the host can create an occasion with a motif (the table INSERT grant covers the column)', async () => {
    const s = await seedPilot(t)
    const id = await t.asUser(s.a, (tx) =>
      scalar<string>(tx, `insert into occasions (host_id, title, starts_at, tz, cover_theme) values ($1, 'Spieleabend', now() + interval '3 days', 'Europe/Berlin', 'gamenight') returning id`, [s.a]))
    expect((await screenTheme(s.a, id)).cover_theme).toBe('gamenight')
    expect((await feedRow(s.a, id))?.cover_theme).toBe('gamenight')
    // REST read of the column (select grant) for the host
    expect(await t.asUser(s.a, (tx) => scalar<string>(tx, 'select cover_theme from occasions where id = $1', [id]))).toBe('gamenight')
  })

  it('a member reads the column through REST too (the select grant), like the title', async () => {
    const s = await seedPilot(t)
    await setTheme(s, 'sport')
    expect(await t.asUser(s.b, (tx) => scalar<string>(tx, 'select cover_theme from occasions where id = $1', [s.occasionId]))).toBe('sport')
  })
})

describe('the rules in the database', () => {
  it('an unknown key is refused (insert and update) — also a wrong case, an empty string, a name', async () => {
    const s = await seedPilot(t)
    for (const bad of ['Birthday', '', 'hiking', 'Geburtstag', 'birthday ', 'https://example.com/a.png']) {
      const err = await expectDbError(setTheme(s, bad), '23514')
      expect(err.message, bad).toContain('occasions_cover_theme_check')
    }
    const insert = execAs(t, s.a, `insert into occasions (host_id, title, starts_at, cover_theme) values ($1, 'Party', now() + interval '1 day', 'disco')`, [s.a])
    expect((await expectDbError(insert, '23514')).message).toContain('occasions_cover_theme_check')
    // nothing changed
    expect((await screenTheme(s.a, s.occasionId)).cover_theme).toBeNull()
  })

  it('only the host writes it: a guest and an outsider change nothing', async () => {
    const s = await seedPilot(t)
    await setTheme(s, 'birthday')
    expect(await setTheme(s, 'party', s.b)).toBe(0)
    expect(await setTheme(s, 'party', s.d)).toBe(0)
    expect((await screenTheme(s.a, s.occasionId)).cover_theme).toBe('birthday')
  })

  it('an outsider learns nothing (one answer, an empty feed)', async () => {
    const s = await seedPilot(t)
    await setTheme(s, 'birthday')
    await expectDbError(screen(t, s.d, s.occasionId), 'P0001')
    expect(await rpc<CoverFeed>(t, s.d, 'get_feed')).toEqual({ upcoming: [], past: [] })
    expect(await t.asUser(s.d, (tx) => rows(tx, 'select cover_theme from occasions where id = $1', [s.occasionId]))).toEqual([])
  })

  it('the allow-list is the app\'s THEME_IDS + "none", under its name', async () => {
    const def = await scalar<string>(t.db, `select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.occasions'::regclass and conname = 'occasions_cover_theme_check'`)
    const inDb = [...def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort()
    const app = await readFile(join(MIGRATIONS_DIR, '..', '..', 'apps', 'web', 'src', 'features', 'occasions', 'covers', 'themes.ts'), 'utf8')
    const list = /export const THEME_IDS = \[([^\]]*)\]/.exec(app)?.[1] ?? ''
    const inApp = [...list.matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    expect(inApp.length).toBe(16)
    expect(inDb).toEqual([...inApp, 'none'].sort())
  })
})

describe('secrecy', () => {
  it('the owner: screen and feed byte-identical with 0 and 5 reservations (motif set)', async () => {
    const s = await seedPilot(t)
    await setTheme(s, 'birthday')
    const extra = await t.asUser(s.a, (tx) =>
      rows<{ id: string }>(tx, `insert into wishes (wishlist_id, title) values ($1, 'Kerze'), ($1, 'Tee') returning id`, [s.wishlistId]))
    const screenBefore = await screenText(t, s.a, s.occasionId)
    const feedBefore = await feedText(s.a)
    expect((JSON.parse(screenBefore) as CoverScreen).occasion.cover_theme).toBe('birthday')

    for (const wish of [s.w1, s.w2, s.w3]) await rpc(t, s.b, 'reserve_wish', [wish])
    for (const wish of extra) await rpc(t, s.c, 'reserve_wish', [wish.id])
    expect(await scalar<number>(t.db, `select count(*)::int from reservations r join wishlists wl on wl.id = r.wishlist_id where wl.occasion_id = $1 and r.status = 'active'`, [s.occasionId])).toBe(5)

    expect(await screenText(t, s.a, s.occasionId)).toBe(screenBefore)
    expect(await feedText(s.a)).toBe(feedBefore)
  })

  it('the motif is the same for every viewer: a reservation changes nobody\'s cover_theme', async () => {
    const s = await seedPilot(t)
    await setTheme(s, 'party')
    const before = await Promise.all([s.a, s.b, s.c].map((uid) => feedRow(uid, s.occasionId)))
    await rpc(t, s.b, 'reserve_wish', [s.w1])
    const after = await Promise.all([s.a, s.b, s.c].map((uid) => feedRow(uid, s.occasionId)))
    expect(before.map((r) => r?.cover_theme)).toEqual(['party', 'party', 'party'])
    expect(after.map((r) => r?.cover_theme)).toEqual(['party', 'party', 'party'])
  })

  it('a new guest sees the stored motif at once (no per-viewer state)', async () => {
    const s = await seedPilot(t)
    await setTheme(s, 'wedding')
    const e = await createMember(t, 'Ella')
    await rpc(t, e, 'accept_invite', [s.token])
    expect((await screenTheme(e, s.occasionId)).cover_theme).toBe('wedding')
  })
})
