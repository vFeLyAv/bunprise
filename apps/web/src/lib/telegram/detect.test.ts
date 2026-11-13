import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// detect.ts runs once at import, so every case loads a fresh copy after preparing the address and storage.
async function load(): Promise<boolean> {
  vi.resetModules()
  return (await import('./detect')).IN_TELEGRAM
}

// fixtures only — never real Telegram data
const LAUNCH = '#tgWebAppData=query_id%3DAAA%26user%3D%257B%2522id%2522%253A1%257D&tgWebAppVersion=9.6&tgWebAppPlatform=ios&tgWebAppThemeParams=%7B%7D'

describe('Telegram Mini App detection', () => {
  beforeEach(() => {
    sessionStorage.clear()
    history.replaceState(null, '', '/')
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy
  })

  it('a Telegram launch fragment → true, the fragment leaves the address, platform and version are kept', async () => {
    history.replaceState(null, '', `/soon?x=1${LAUNCH}`)
    expect(await load()).toBe(true)
    expect(location.hash).toBe('')
    expect(location.pathname + location.search).toBe('/soon?x=1')
    expect(sessionStorage.getItem('bunprise.tg')).toBe('ios 9.6')
    expect(JSON.stringify(sessionStorage)).not.toContain('query_id')
  })

  it('an ordinary visit → false, nothing written', async () => {
    history.replaceState(null, '', '/login')
    expect(await load()).toBe(false)
    expect(sessionStorage.getItem('bunprise.tg')).toBeNull()
  })

  it('after an in-app reload (fragment already gone) the stored flag still says true', async () => {
    sessionStorage.setItem('bunprise.tg', 'android 9.6')
    expect(await load()).toBe(true)
  })

  it("the Telegram client's webview proxy alone also says true", async () => {
    ;(window as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy = { postEvent: () => undefined }
    expect(await load()).toBe(true)
  })

  it.each(['/i#0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', '/f#follow-code'])(
    'invite and follow fragments are never touched: %s',
    async (url) => {
      history.replaceState(null, '', url)
      expect(await load()).toBe(false)
      expect(location.pathname + location.hash).toBe(url)
    },
  )

  it('blocked storage: the launch data still leaves the address and this load still knows it is Telegram', async () => {
    history.replaceState(null, '', `/soon${LAUNCH}`)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(await load()).toBe(true)
    expect(location.hash).toBe('')
    expect(location.pathname).toBe('/soon')
  })

  it('storage that throws even on reading does not break the boot', async () => {
    history.replaceState(null, '', '/soon')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(await load()).toBe(false)
  })

  it('sign-out cleanup keeps the flag (a device fact) and removes the session drafts', async () => {
    sessionStorage.setItem('bunprise.tg', 'ios 9.6')
    sessionStorage.setItem('bunprise.postLoginNext', '/soon')
    const { clearSessionDrafts } = await import('../query')
    clearSessionDrafts()
    expect(sessionStorage.getItem('bunprise.tg')).toBe('ios 9.6')
    expect(sessionStorage.getItem('bunprise.postLoginNext')).toBeNull()
  })
})

// Felix 25.10: the dark theme — Telegram's day/night from the launch theme (only its background colour)
describe("Telegram's colour scheme", () => {
  beforeEach(() => {
    sessionStorage.clear()
    history.replaceState(null, '', '/')
  })

  it('schemeOf: dark background → dark, light → light, anything else → null', async () => {
    vi.resetModules()
    const { schemeOf } = await import('./detect')
    expect(schemeOf('{"bg_color":"#17212b","text_color":"#f5f5f5"}')).toBe('dark')
    expect(schemeOf('{"bg_color": "#ffffff"}')).toBe('light')
    expect(schemeOf('{}')).toBeNull()
    expect(schemeOf('{"bg_color":"red"}')).toBeNull()
    expect(schemeOf(null)).toBeNull()
  })

  it('a night launch stores the scheme for lib/theme.ts (no Telegram user data)', async () => {
    const night = LAUNCH.replace('tgWebAppThemeParams=%7B%7D', `tgWebAppThemeParams=${encodeURIComponent('{"bg_color":"#212121"}')}`)
    history.replaceState(null, '', `/soon${night}`)
    expect(await load()).toBe(true)
    expect(sessionStorage.getItem('bunprise.tgScheme')).toBe('dark')
    expect(location.hash).toBe('')
  })

  it('a launch without a theme stores no scheme (the system decides)', async () => {
    history.replaceState(null, '', `/soon${LAUNCH}`)
    expect(await load()).toBe(true)
    expect(sessionStorage.getItem('bunprise.tgScheme')).toBeNull()
  })
})
