import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const worker = vi.hoisted(() => {
  const start = vi.fn(async () => undefined)
  return { start, setup: vi.fn(() => ({ start })) }
})
vi.mock('msw/browser', () => ({ setupWorker: worker.setup }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubEnv('VITE_DEMO', '1')
  vi.stubEnv('VITE_SUPABASE_URL', 'http://demo.localhost')
})
afterEach(() => {
  vi.unstubAllEnvs()
  window.localStorage.clear()
})

describe('demo boot', () => {
  it('starts once and resets only its old session/cache, preserving the real account', async () => {
    window.localStorage.setItem('bunprise.auth', 'real-session')
    window.localStorage.setItem('bunprise.query', 'real-cache')
    window.localStorage.setItem('bunprise.demo.auth', 'old-demo-session')
    window.localStorage.setItem('bunprise.demo.query', 'old-demo-cache')
    const { startDemo } = await import('./browser')
    await startDemo()
    await startDemo()
    expect(worker.start).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('bunprise.demo.auth')).toBeNull()
    expect(window.localStorage.getItem('bunprise.demo.query')).toBeNull()
    expect(window.localStorage.getItem('bunprise.auth')).toBe('real-session')
    expect(window.localStorage.getItem('bunprise.query')).toBe('real-cache')
  })

  it('refuses a real backend and never starts mocks outside demo mode', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://production.example.test')
    const { startDemo } = await import('./browser')
    await expect(startDemo()).rejects.toThrow('Demo mode requires')
    expect(worker.setup).not.toHaveBeenCalled()

    vi.stubEnv('VITE_DEMO', '0')
    await startDemo()
    expect(worker.setup).not.toHaveBeenCalled()
  })
})
