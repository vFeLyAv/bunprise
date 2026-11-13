import { afterEach, beforeEach, vi } from 'vitest'

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Real network calls are forbidden in Worker tests')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
