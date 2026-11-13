import { afterEach, describe, expect, it, vi } from 'vitest'

// Inside / outside a Telegram Mini App (lib/telegram/detect.ts decides once at startup; here switchable).
const telegram = vi.hoisted(() => ({ on: false }))
vi.mock('../../lib/telegram/detect', () => ({ get IN_TELEGRAM() { return telegram.on } }))

import { isIosSafari, readPlatform, shouldOfferHomeScreen, type PlatformInfo } from './platform'

// Real-world shaped user agents (no personal data).
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  // iPadOS asks for desktop sites: the UA says "Macintosh", only the touch points tell it apart
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.71 Mobile/15E148 Safari/604.1',
  firefoxIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15',
  edgeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.0.2478.50 Mobile/15E148 Safari/605.1.15',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.3.12.235 (iPhone15,2; iOS 17_4; de_DE; de; scale=3.00; 1179x2556; 601420853)',
  facebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0.37.104;FBBV/600000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.4]',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
}

function platform(userAgent: string, patch: Partial<PlatformInfo> = {}): PlatformInfo {
  return { userAgent, maxTouchPoints: 5, standalone: false, displayModeStandalone: false, inTelegram: false, ...patch }
}

describe('"Zum Home-Bildschirm" hint: iOS Safari only, never in the installed app', () => {
  it('offers the hint in Safari on iPhone and iPad (also in desktop mode)', () => {
    expect(shouldOfferHomeScreen(platform(UA.iphoneSafari))).toBe(true)
    expect(shouldOfferHomeScreen(platform(UA.ipadSafari))).toBe(true)
    expect(shouldOfferHomeScreen(platform(UA.ipadDesktopMode, { maxTouchPoints: 5 }))).toBe(true)
  })

  it('stays quiet once the app runs from the Home Screen', () => {
    expect(shouldOfferHomeScreen(platform(UA.iphoneSafari, { standalone: true }))).toBe(false)
    expect(shouldOfferHomeScreen(platform(UA.iphoneSafari, { displayModeStandalone: true }))).toBe(false)
  })

  it('skips other iOS browsers and in-app browsers (no Safari share sheet entry)', () => {
    for (const ua of [UA.chromeIos, UA.firefoxIos, UA.edgeIos, UA.instagram, UA.facebook]) {
      expect(isIosSafari({ userAgent: ua, maxTouchPoints: 5 })).toBe(false)
    }
  })

  it('never inside Telegram, even when its web view reports itself like Safari (telegram-mini-app §3.7)', () => {
    expect(shouldOfferHomeScreen(platform(UA.iphoneSafari, { inTelegram: true }))).toBe(false)
    expect(shouldOfferHomeScreen(platform(UA.ipadSafari, { inTelegram: true }))).toBe(false)
  })

  it('never shows on Android, a Mac or Windows', () => {
    expect(shouldOfferHomeScreen(platform(UA.androidChrome))).toBe(false)
    expect(shouldOfferHomeScreen(platform(UA.macSafari, { maxTouchPoints: 0 }))).toBe(false)
    expect(shouldOfferHomeScreen(platform(UA.windowsFirefox, { maxTouchPoints: 0 }))).toBe(false)
    expect(shouldOfferHomeScreen(platform(''))).toBe(false)
  })
})

describe('readPlatform', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'standalone')
    telegram.on = false
  })

  it('reads the Telegram flag: Safari\'s user agent inside Telegram gets no Home Screen hint', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA.iphoneSafari)
    expect(readPlatform().inTelegram).toBe(false)
    expect(shouldOfferHomeScreen(readPlatform())).toBe(true)
    telegram.on = true
    expect(readPlatform().inTelegram).toBe(true)
    expect(shouldOfferHomeScreen(readPlatform())).toBe(false)
  })

  it('reads the user agent, touch points and both standalone signals from the browser', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(UA.iphoneSafari)
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    const read = readPlatform()
    expect(read.userAgent).toBe(UA.iphoneSafari)
    expect(read.standalone).toBe(true)
    expect(read.displayModeStandalone).toBe(false) // jsdom: no display-mode match
    expect(typeof read.maxTouchPoints).toBe('number')
  })

  it('treats a non-boolean navigator.standalone as a normal tab', () => {
    Object.defineProperty(navigator, 'standalone', { value: 'yes', configurable: true })
    expect(readPlatform().standalone).toBe(false)
  })
})
