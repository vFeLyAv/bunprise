/**
 * The 5th release switches "one wish in several lists" on (supabase/migrations/20261027230000_shared_wishes_on.sql,
 * Felix 27.10: «так все включаем»): after every migration both switches are true. The behaviour with the switch off
 * is tested by shared-wishes.test.ts, which turns it off itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, rows, type TestDb } from '../../src/harness'

let t: TestDb
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

describe('shared wishes switch after all migrations', () => {
  it('shared_wishes and shared_wishes_visible are on', async () => {
    expect(await rows(t.db, 'select shared_wishes, shared_wishes_visible from private.features')).toEqual([{ shared_wishes: true, shared_wishes_visible: true }])
  })
})
