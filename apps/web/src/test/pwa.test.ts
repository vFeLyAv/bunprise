import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const pwa = vi.hoisted(() => ({ register: vi.fn(), update: vi.fn(), notify: vi.fn() }))
vi.mock('virtual:pwa-register', () => ({ registerSW: pwa.register }))
vi.mock('../lib/toast', () => ({ toast: { info: pwa.notify } }))

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('DEV', false)
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
  pwa.register.mockReset().mockReturnValue(pwa.update)
  pwa.update.mockReset()
  pwa.notify.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'serviceWorker')
  vi.unstubAllEnvs()
})

describe('lazy PWA registration', () => {
  it('registers immediately when the lazy module arrives after window load', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    const { setupPwaUpdates } = await import('../lib/pwa')
    setupPwaUpdates()
    setupPwaUpdates()
    expect(pwa.register).toHaveBeenCalledTimes(1)
  })

  it('waits for load when needed and registers once even if setup is called twice', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    const { setupPwaUpdates } = await import('../lib/pwa')
    setupPwaUpdates()
    setupPwaUpdates()
    expect(pwa.register).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('load'))
    window.dispatchEvent(new Event('load'))
    expect(pwa.register).toHaveBeenCalledTimes(1)
  })

  it('does not register in development', async () => {
    vi.stubEnv('DEV', true)
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    const { setupPwaUpdates } = await import('../lib/pwa')
    setupPwaUpdates()
    expect(pwa.register).not.toHaveBeenCalled()
  })

  it('offers an update without reloading until the person chooses its action', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    const { setupPwaUpdates } = await import('../lib/pwa')
    setupPwaUpdates()
    const options = pwa.register.mock.calls[0]?.[0] as Parameters<typeof import('virtual:pwa-register').registerSW>[0]
    options?.onNeedRefresh?.()
    expect(pwa.update).not.toHaveBeenCalled()
    const notice = pwa.notify.mock.calls[0]?.[1] as { onAction: () => void }
    notice.onAction()
    expect(pwa.update).toHaveBeenCalledWith(true)
  })
})
