import { beforeEach, describe, expect, it, vi } from 'vitest'

// lib/api/wishes.ts: the wish details (20261022120000) — cleaned like the database checks them, selected with the
// wish, and the one-time retry without them against a server that does not know the columns yet.
const calls: { op: string; values?: unknown; columns: string }[] = []
const answers: { data: unknown; error: unknown }[] = []

function chain(op: string, values?: unknown) {
  const entry: { op: string; values?: unknown; columns: string } = { op, values, columns: '' }
  calls.push(entry)
  const self = {
    select(columns: string) { entry.columns = columns; return self },
    eq() { return self },
    single() { return self },
    setHeader() { return Promise.resolve(answers.shift() ?? { data: null, error: { code: 'XX', message: 'no answer' } }) },
  }
  return self
}

const supabase = {
  from: vi.fn(() => ({
    insert: (values: unknown) => chain('insert', values),
    update: (values: unknown) => chain('update', values),
    select: (columns: string) => chain('select').select(columns),
  })),
  auth: { getSession: vi.fn() },
}
vi.mock('../supabase', () => ({
  getSupabase: () => Promise.resolve(supabase),
  hasLocalSession: () => false,
  onClientReady: () => () => {},
  getLocalSession: () => Promise.resolve(null),
}))

import { createWish, getWish, normalizeGtin, updateWish } from './wishes'

const ROW = { id: 'w-1', wishlist_id: 'l-1', title: 'Kaffeemühle', price_cents: 4500, currency: 'EUR', url: null, note: null, priority: 3, created_at: '2026-10-22T10:00:00Z' }
const DETAILS = { description: 'Handmühle', brand: 'Mahlwerk', color: 'Buche', gtin: '2001234567893', shop_name: 'Küchenkontor' }

beforeEach(() => {
  calls.length = 0
  answers.length = 0
  vi.mocked(supabase.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'owner-1' }, access_token: 't' } }, error: null } as never)
})

describe('the details on create / update', () => {
  it('are sent cleaned (trimmed, blank → null, capped, GTIN digits only) and selected back', async () => {
    answers.push({ data: { ...ROW, ...DETAILS }, error: null })
    const wish = await createWish('l-1', {
      title: ' Kaffeemühle ', description: '  Handmühle \r\n\r\n mit   Kurbel ', brand: '  Mahlwerk  ', color: '   ', gtin: '2001-2345 67893',
      shop_name: 'K'.repeat(90),
    })
    expect(calls[0]?.values).toEqual({
      title: 'Kaffeemühle', description: 'Handmühle\n\nmit Kurbel', brand: 'Mahlwerk', color: null, gtin: '2001234567893',
      shop_name: 'K'.repeat(80), wishlist_id: 'l-1',
    })
    expect(calls[0]?.columns).toMatch(/description, brand, color, gtin, shop_name, received_at$/)
    // a row without received_at (e.g. a hand-built answer) gets it as null: callers always see the full shape
    expect(wish).toEqual({ ...ROW, ...DETAILS, received_at: null })
  })

  it('update sends only the given fields; a description is capped at 1000 characters', async () => {
    answers.push({ data: { ...ROW, ...DETAILS }, error: null })
    await updateWish('w-1', { brand: '', description: '🎁'.repeat(1001) })
    const values = calls[0]?.values as Record<string, string | null>
    expect(Object.keys(values).sort()).toEqual(['brand', 'description'])
    expect(values.brand).toBeNull()
    expect([...(values.description ?? '')]).toHaveLength(1000)
  })

  it('normalizeGtin: 8 … 14 digits after removing spaces and dashes, else null', () => {
    expect(normalizeGtin('4006381333931')).toBe('4006381333931')
    expect(normalizeGtin(' 4006-381 333931 ')).toBe('4006381333931')
    expect(normalizeGtin('1234567')).toBeNull()
    expect(normalizeGtin('ABC12345678')).toBeNull()
    expect(normalizeGtin(null)).toBeNull()
    expect(normalizeGtin(undefined)).toBeUndefined()
  })
})

describe('a server without the details (before 20261022120000)', () => {
  it('create: retried once without the details; the wish comes back with null details', async () => {
    answers.push({ data: null, error: { code: 'PGRST204', message: "Could not find the 'brand' column of 'wishes' in the schema cache" } })
    answers.push({ data: ROW, error: null })
    const wish = await createWish('l-1', { title: 'Kaffeemühle', brand: 'Mahlwerk' })
    expect(calls).toHaveLength(2)
    expect(calls[1]?.values).toEqual({ title: 'Kaffeemühle', wishlist_id: 'l-1' })
    expect(calls[1]?.columns).not.toMatch(/brand/)
    expect(wish).toEqual({ ...ROW, description: null, brand: null, color: null, gtin: null, shop_name: null, received_at: null })
  })

  it('getWish: an undefined column (42703) is read again without the details', async () => {
    answers.push({ data: null, error: { code: '42703', message: 'column wishes.description does not exist' } })
    answers.push({ data: { ...ROW, wishlist: { id: 'l-1', occasion_id: null, owner_id: 'owner-1' } }, error: null })
    const wish = await getWish('w-1')
    expect(wish).toMatchObject({ id: 'w-1', description: null, gtin: null, wishlist: { id: 'l-1' } })
  })

  it('a server with the details but without 20261022160000: only received_at is dropped, the details stay', async () => {
    answers.push({ data: null, error: { code: '42703', message: 'column wishes.received_at does not exist' } })
    answers.push({ data: { ...ROW, ...DETAILS }, error: null })
    const wish = await createWish('l-1', { title: 'Kaffeemühle', brand: 'Mahlwerk' })
    expect(calls).toHaveLength(2)
    expect(calls[1]?.values).toEqual({ title: 'Kaffeemühle', brand: 'Mahlwerk', wishlist_id: 'l-1' })
    expect(calls[1]?.columns).toMatch(/shop_name$/)
    expect(wish).toEqual({ ...ROW, ...DETAILS, received_at: null })
    // getWish the same way (PGRST204 for the select list)
    answers.push({ data: null, error: { code: 'PGRST204', message: "Could not find the 'received_at' column of 'wishes' in the schema cache" } })
    answers.push({ data: { ...ROW, ...DETAILS, wishlist: { id: 'l-1', occasion_id: null, owner_id: 'owner-1' } }, error: null })
    expect(await getWish('w-1')).toMatchObject({ brand: 'Mahlwerk', received_at: null })
  })

  it('the oldest server: received_at first, then the details — the wish is still saved', async () => {
    answers.push({ data: null, error: { code: '42703', message: 'column wishes.received_at does not exist' } })
    answers.push({ data: null, error: { code: '42703', message: 'column wishes.description does not exist' } })
    answers.push({ data: ROW, error: null })
    const wish = await updateWish('w-1', { title: 'Neu', brand: 'X' })
    expect(calls).toHaveLength(3)
    expect(calls[2]?.values).toEqual({ title: 'Neu' })
    expect(wish).toEqual({ ...ROW, description: null, brand: null, color: null, gtin: null, shop_name: null, received_at: null })
  })

  it('any other error is not retried', async () => {
    answers.push({ data: null, error: { code: '23514', message: 'new row violates check constraint "wishes_title_check"' } })
    await expect(createWish('l-1', { title: 'x' })).rejects.toBeDefined()
    expect(calls).toHaveLength(1)
  })
})
