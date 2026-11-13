import { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Callbacks {
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
  'timeout-callback': () => void
}

const scriptSelector = 'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]'

function fakeApi() {
  const callbacks: Callbacks[] = []
  return {
    callbacks,
    ready: (callback: () => void) => callback(),
    render: vi.fn((_container: HTMLElement, options: Callbacks) => {
      callbacks.push(options)
      return `widget-${callbacks.length}`
    }),
    remove: vi.fn(),
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-key')
})

afterEach(() => {
  cleanup()
  document.querySelectorAll(scriptSelector).forEach((script) => script.remove())
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('optional Turnstile', () => {
  it('renders nothing and loads no script when the feature is off', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    const { Turnstile } = await import('./Turnstile')
    const { container } = render(<Turnstile onToken={vi.fn()} resetKey={0} label="Security check" />)
    expect(container.childElementCount).toBe(0)
    expect(document.querySelector(scriptSelector)).toBeNull()
  })

  it('shares one lazy script under StrictMode and removes the active widget on unmount', async () => {
    const { Turnstile } = await import('./Turnstile')
    const onToken = vi.fn()
    const view = render(<StrictMode><Turnstile onToken={onToken} resetKey={0} label="Security check" /></StrictMode>)
    expect(document.querySelectorAll(scriptSelector)).toHaveLength(1)
    const api = fakeApi()
    vi.stubGlobal('turnstile', api)
    await act(async () => {
      document.querySelector(scriptSelector)?.dispatchEvent(new Event('load'))
    })
    expect(api.render).toHaveBeenCalledTimes(1)
    api.callbacks[0]?.callback('verified-token')
    expect(onToken).toHaveBeenLastCalledWith('verified-token')
    view.unmount()
    expect(api.remove).toHaveBeenCalledWith('widget-1')
    expect(onToken).toHaveBeenLastCalledWith(null)
  })

  it('invalidates expired, failed and timed-out tokens and ignores removed-widget callbacks', async () => {
    const api = fakeApi()
    vi.stubGlobal('turnstile', api)
    const { Turnstile } = await import('./Turnstile')
    const onToken = vi.fn()
    const view = render(<Turnstile onToken={onToken} resetKey={0} label="Security check" />)
    await act(async () => {})
    const first = api.callbacks[0]
    expect(first).toBeDefined()
    first?.callback('verified-token')
    first?.['expired-callback']()
    expect(onToken).toHaveBeenLastCalledWith(null)
    first?.callback('new-token')
    first?.['error-callback']()
    expect(onToken).toHaveBeenLastCalledWith(null)
    first?.callback('another-token')
    first?.['timeout-callback']()
    expect(onToken).toHaveBeenLastCalledWith(null)
    view.rerender(<Turnstile onToken={onToken} resetKey={1} label="Security check" />)
    await act(async () => {})
    expect(api.remove).toHaveBeenCalledWith('widget-1')
    expect(api.render).toHaveBeenCalledTimes(2)
    first?.callback('stale-token')
    expect(onToken).toHaveBeenLastCalledWith(null)
  })

  it('reuses the widget when the parent passes a new callback', async () => {
    const api = fakeApi()
    vi.stubGlobal('turnstile', api)
    const { Turnstile } = await import('./Turnstile')
    const first = vi.fn()
    const second = vi.fn()
    const view = render(<Turnstile onToken={first} resetKey={0} label="Security check" />)
    await act(async () => {})
    view.rerender(<Turnstile onToken={second} resetKey={0} label="Security check" />)
    api.callbacks[0]?.callback('verified-token')
    expect(api.render).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenLastCalledWith('verified-token')
  })

  it('fails closed when the script cannot load', async () => {
    const { Turnstile } = await import('./Turnstile')
    const onToken = vi.fn()
    render(<Turnstile onToken={onToken} resetKey={0} label="Security check" />)
    await act(async () => {
      document.querySelector(scriptSelector)?.dispatchEvent(new Event('error'))
    })
    expect(onToken).toHaveBeenLastCalledWith(null)
    expect(onToken.mock.calls.some(([token]) => typeof token === 'string')).toBe(false)
    expect(document.querySelector(scriptSelector)).toBeNull()
  })
})
