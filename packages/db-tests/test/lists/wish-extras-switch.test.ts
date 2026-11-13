/**
 * The 6th release switches "Anzahl" and "Passt zusammen" on (supabase/migrations/20261031130000_wish_extras_on.sql,
 * Felix 31.10), right after the pilot-6 privacy text that describes both (20261031120000_legal_versions_pilot_6.sql).
 * After every migration both switches are true, their column defaults stay false, and the invitation e-mail stays OFF
 * (no Brevo key yet: nothing in this release switches it on). The behaviour with the switches off is tested by
 * wish-together.test.ts, which flips them itself; the e-mail's OFF behaviour by inviteEmail/invite-email.test.ts.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, createTestDb, rows, type TestDb } from '../../src/harness'

const ON_MIGRATION = '20261031130000_wish_extras_on.sql'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

describe('wish extras switch after all migrations (6th release)', () => {
  it('wish_quantity and wish_together are on; the column defaults stay off', async () => {
    expect(await rows(t.db, 'select wish_quantity, wish_together from private.features')).toEqual([{ wish_quantity: true, wish_together: true }])
    expect(await rows(t.db, `select column_name, column_default from information_schema.columns
      where table_schema = 'private' and table_name = 'features' and column_name in ('wish_quantity', 'wish_together') order by 1`)).toEqual([
      { column_name: 'wish_quantity', column_default: 'false' },
      { column_name: 'wish_together', column_default: 'false' },
    ])
  })

  it('the ON migration is the emergency template, ordered after the feature and the pilot-6 privacy text', async () => {
    const order = t.appliedMigrations
    expect(order).toContain(ON_MIGRATION)
    expect(order.indexOf(ON_MIGRATION)).toBeGreaterThan(order.indexOf('20261030120000_wish_quantity_together.sql'))
    expect(order.indexOf(ON_MIGRATION)).toBeGreaterThan(order.indexOf('20261031120000_legal_versions_pilot_6.sql'))
    expect(order.indexOf('20261031120000_legal_versions_pilot_6.sql')).toBeGreaterThan(-1)
    const statements = (sql: string) => sql.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('--'))
    const migration = await readFile(join(MIGRATIONS_DIR, ON_MIGRATION), 'utf8')
    const template = await readFile(join(MIGRATIONS_DIR, '..', 'emergency', 'wish_extras_on.sql'), 'utf8')
    expect(statements(migration)).toEqual(['update private.features set wish_quantity = true, wish_together = true;'])
    expect(statements(migration)).toEqual(statements(template))
  })

  it('the invitation e-mail stays off: the switch is false and no dispatch job is scheduled by any migration', async () => {
    expect(await rows(t.db, 'select invite_email from private.features')).toEqual([{ invite_email: false }])
    for (const file of t.appliedMigrations) {
      const sql = (await readFile(join(MIGRATIONS_DIR, file), 'utf8')).replace(/--[^\n]*/g, '')
      // only the feature's own migration defines the switch function; nothing calls it with true
      expect(sql, file).not.toMatch(/set_invite_email_feature\s*\(\s*true\s*\)/)
      expect(sql, file).not.toMatch(/update\s+private\.features\s+set[^;]*invite_email\s*=\s*true/i)
    }
  })
})
