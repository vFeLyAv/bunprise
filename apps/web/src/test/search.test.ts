import { describe, expect, it } from 'vitest'
import { compact, isUuid, legalSearch, optionalEnum, optionalString, uuidParam } from '../lib/search'

// lib/search.ts replaced zod/mini in the route files (bundle budget, docs/contract.md §10).
// The checks must stay as strict as z.uuid() for ids and stay lenient for search values.

describe('route search/param validators', () => {
  it('keeps only strings and allowed literals; drops everything else', () => {
    expect(optionalString('/soon')).toBe('/soon')
    expect(optionalString(123)).toBeUndefined()
    expect(optionalString({ next: '/x' })).toBeUndefined()
    expect(optionalEnum('signup', ['signup', 'signin'])).toBe('signup')
    expect(optionalEnum('admin', ['signup', 'signin'])).toBeUndefined()
    expect(optionalEnum(1, ['signup', 'signin'])).toBeUndefined()
  })

  it('compact() leaves no undefined keys (same shape as a zod object)', () => {
    expect(compact({ a: 'x', b: undefined })).toEqual({ a: 'x' })
    expect(Object.keys(compact({ a: undefined }))).toEqual([])
    expect(legalSearch({ version: 'terms-2026-10-pilot-1', lang: 'fr', extra: 1 })).toEqual({ version: 'terms-2026-10-pilot-1' })
    expect(legalSearch({ lang: 'en' })).toEqual({ lang: 'en' })
  })

  it('accepts real UUIDs (v4 and the demo fixtures) and rejects anything else', () => {
    expect(isUuid('3f2b9c1e-8a4d-4c2b-9e1f-0a1b2c3d4e5f')).toBe(true)
    expect(isUuid('d1e0b000-0000-4000-8000-000000000002')).toBe(true)
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true)
    for (const bad of ['', 'new', '3f2b9c1e-8a4d-0c2b-9e1f-0a1b2c3d4e5f', '3f2b9c1e-8a4d-4c2b-7e1f-0a1b2c3d4e5f',
      '3f2b9c1e8a4d4c2b9e1f0a1b2c3d4e5f', ' 3f2b9c1e-8a4d-4c2b-9e1f-0a1b2c3d4e5f', '../soon', 42]) {
      expect(isUuid(bad), String(bad)).toBe(false)
    }
  })

  it('uuidParam() parses, throws on malformed ids and stringifies back', () => {
    const params = uuidParam('occasionId')
    const id = '3f2b9c1e-8a4d-4c2b-9e1f-0a1b2c3d4e5f'
    expect(params.parse({ occasionId: id })).toEqual({ occasionId: id })
    expect(() => params.parse({ occasionId: 'not-a-uuid' })).toThrow()
    expect(params.stringify({ occasionId: id })).toEqual({ occasionId: id })
  })
})
