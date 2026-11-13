import { describe, expect, it } from 'vitest'
import { AppError } from '../errors'
import { FeatureUnavailableError, isFeatureUnavailableError, isMissingServerFeature, throwIfUnavailable } from './unavailable'

// The calm error of a server that does not have a migration yet (lib/api/unavailable.ts).

describe('isMissingServerFeature', () => {
  it('the four codes of "this server does not know it" — never anything else', () => {
    for (const code of ['PGRST202', 'PGRST204', '42703', '42883']) expect(isMissingServerFeature({ code, message: 'x' }), code).toBe(true)
    for (const error of [{ code: 'P0001', message: 'not_found' }, { code: '42501' }, { message: 'PGRST202' }, null, 'PGRST202', undefined]) {
      expect(isMissingServerFeature(error), JSON.stringify(error)).toBe(false)
    }
  })
})

describe('FeatureUnavailableError', () => {
  it('is an AppError (generic) with the feature; throwIfUnavailable throws only for the four codes', () => {
    const err = new FeatureUnavailableError('move_wish', { code: '42883' })
    expect(err).toBeInstanceOf(AppError)
    expect(err).toMatchObject({ code: 'generic', key: 'errors.generic', feature: 'move_wish', name: 'FeatureUnavailableError' })
    expect(isFeatureUnavailableError(err)).toBe(true)
    expect(isFeatureUnavailableError(err, 'list_photos')).toBe(false)
    expect(isFeatureUnavailableError(new AppError('generic'))).toBe(false)
    expect(() => throwIfUnavailable('list_photos', { code: 'PGRST202', message: 'x' })).toThrow(FeatureUnavailableError)
    expect(() => throwIfUnavailable('list_photos', { code: 'P0001', message: 'not_found' })).not.toThrow()
    expect(() => throwIfUnavailable('list_photos', null)).not.toThrow()
  })
})
