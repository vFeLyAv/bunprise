import { act, cleanup, render, screen } from '@testing-library/react'
import { LazyMotion, domMax } from 'motion/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sheet } from '../../ui/Sheet'
import { haptic } from '../haptics'
import { channel, startBridge, TELEGRAM_WEB_ORIGINS, versionAtLeast, type TelegramWindow } from './bridge'
import { holdClosing } from './closing'

// The Telegram client is faked: TelegramWebviewProxy records what the page sends; incoming events are calls of
// window.Telegram.WebView.receiveEvent (apps) or `message` events from the parent frame (Telegram Web).
// Fixtures only — never real Telegram data.

const win = window as TelegramWindow
let postEvent: ReturnType<typeof vi.fn<(type: string, data?: string) => void>>
let stop: (() => void) | null = null

/** What the page sent so far, the data parsed back from JSON. */
const sent = () => postEvent.mock.calls.map(([type, data]) => [type, data === undefined ? undefined : JSON.parse(data)] as const)
const sentTypes = () => sent().map(([type]) => type)
const lastOf = (type: string) => sent().filter(([t]) => t === type).at(-1)?.[1]
const start = (version: string) => {
  stop = startBridge(win, version)
}
const receive = (type: string, data?: unknown) => act(() => win.Telegram?.WebView?.receiveEvent?.(type, data))
/** MutationObserver callbacks run as microtasks. */
const flush = () => act(async () => {})

beforeEach(() => {
  postEvent = vi.fn<(type: string, data?: string) => void>()
  win.TelegramWebviewProxy = { postEvent }
})

afterEach(() => {
  cleanup() // React first (portals live in <body>), then the hand-made nodes
  stop?.()
  stop = null
  delete win.TelegramWebviewProxy
  delete win.Telegram
  document.documentElement.removeAttribute('style')
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('channel to the Telegram client', () => {
  it('apps: TelegramWebviewProxy.postEvent with the data as a JSON string', () => {
    channel(win)?.('web_app_open_link', { url: 'https://shop.example/a' })
    expect(postEvent).toHaveBeenCalledWith('web_app_open_link', '{"url":"https://shop.example/a"}')
  })

  it('old desktop builds: window.external.notify with {eventType, eventData}', () => {
    delete win.TelegramWebviewProxy
    const notify = vi.fn()
    vi.spyOn(window, 'external', 'get').mockReturnValue({ notify } as unknown as External)
    channel(win)?.('web_app_ready')
    expect(notify).toHaveBeenCalledWith('{"eventType":"web_app_ready"}')
  })

  it('Telegram Web (iframe): postMessage to the parent, only to the Telegram Web origins, never to *', () => {
    delete win.TelegramWebviewProxy
    const postMessage = vi.fn()
    const framed = { parent: { postMessage } } as unknown as TelegramWindow
    channel(framed)?.('web_app_expand')
    expect(postMessage.mock.calls).toEqual(TELEGRAM_WEB_ORIGINS.map((origin) => ['{"eventType":"web_app_expand"}', origin]))
    expect(postMessage.mock.calls.flat()).not.toContain('*')
  })

  it('no Telegram client: no channel, the bridge does not start', () => {
    delete win.TelegramWebviewProxy
    expect(channel(win)).toBeNull()
    expect(startBridge(win, '9.6')).toBeNull()
  })
})

describe('start and version gating', () => {
  it('9.6: colours of the paper theme, no swipe-to-minimise, expand + ready, safe areas, Back hidden at first', () => {
    start('9.6')
    expect(sentTypes()).toEqual([
      'web_app_set_header_color',
      'web_app_set_background_color',
      'web_app_set_bottom_bar_color',
      'web_app_setup_swipe_behavior',
      'web_app_expand',
      'web_app_ready',
      'web_app_request_safe_area',
      'web_app_request_content_safe_area',
      'web_app_setup_back_button',
      'web_app_setup_closing_behavior',
    ])
    expect(lastOf('web_app_set_header_color')).toEqual({ color: '#F5EEE2' })
    expect(lastOf('web_app_setup_swipe_behavior')).toEqual({ allow_vertical_swipe: false })
    expect(lastOf('web_app_setup_back_button')).toEqual({ is_visible: false })
    expect(lastOf('web_app_setup_closing_behavior')).toEqual({ need_confirmation: false })
    expect(document.documentElement.hasAttribute('data-tg')).toBe(true)
  })

  it('7.0: no swipe behaviour (7.7), no bottom bar colour (7.10), no safe-area requests (8.0)', () => {
    start('7.0')
    expect(sentTypes()).toContain('web_app_set_header_color')
    expect(sentTypes()).not.toContain('web_app_setup_swipe_behavior')
    expect(sentTypes()).not.toContain('web_app_set_bottom_bar_color')
    expect(sentTypes()).not.toContain('web_app_request_safe_area')
  })

  it('6.0 (also an unknown version): only expand and ready; our own "Zurück" stays visible', () => {
    start('6.0')
    expect(sentTypes()).toEqual(['web_app_expand', 'web_app_ready'])
    expect(document.documentElement.hasAttribute('data-tg')).toBe(false)
  })

  it('reads the version detect.ts stored ("<platform> <version>")', () => {
    sessionStorage.setItem('bunprise.tg', 'android 6.0')
    stop = startBridge()
    expect(sentTypes()).toEqual(['web_app_expand', 'web_app_ready'])
    sessionStorage.clear()
  })

  it('compares dotted versions part by part', () => {
    expect(versionAtLeast('7.10', '7.7')).toBe(true)
    expect(versionAtLeast('7.7', '7.10')).toBe(false)
    expect(versionAtLeast('10.0', '9.6')).toBe(true)
    expect(versionAtLeast('6.1', '6.1')).toBe(true)
    expect(versionAtLeast('6', '6.1')).toBe(false)
  })
})

describe('safe areas → --sa-* on <html>', () => {
  it('device safe area + the area Telegram covers, never below env(); garbage counts as 0', () => {
    start('9.6')
    receive('safe_area_changed', { top: 47, bottom: 34, left: 0, right: 0 })
    receive('content_safe_area_changed', { top: 10, bottom: 'x', left: -5, right: Number.NaN })
    const style = document.documentElement.style
    expect(style.getPropertyValue('--sa-top')).toBe('max(env(safe-area-inset-top, 0px), 57px)')
    expect(style.getPropertyValue('--sa-bottom')).toBe('max(env(safe-area-inset-bottom, 0px), 34px)')
    expect(style.getPropertyValue('--sa-left')).toBe('max(env(safe-area-inset-left, 0px), 0px)')
    expect(style.getPropertyValue('--sa-right')).toBe('max(env(safe-area-inset-right, 0px), 0px)')
  })
})

describe('Telegram Web: incoming messages', () => {
  function frame() {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    const child = iframe.contentWindow as TelegramWindow & typeof globalThis
    const parent = child.parent
    const postMessage = vi.spyOn(parent, 'postMessage').mockImplementation(() => undefined)
    return { child, parent, postMessage }
  }
  const message = (child: Window & typeof globalThis, origin: string, source: Window | null, data: unknown) => {
    const event = new child.MessageEvent('message', { data, origin })
    Object.defineProperty(event, 'source', { value: source })
    child.dispatchEvent(event)
  }
  const safeArea = JSON.stringify({ eventType: 'safe_area_changed', eventData: { top: 20 } })

  it('says iframe_ready to the parent and takes events only from the parent frame at a Telegram Web origin', () => {
    delete win.TelegramWebviewProxy
    const { child, parent, postMessage } = frame()
    expect(parent).not.toBe(child)
    stop = startBridge(child, '6.0')
    expect(postMessage).toHaveBeenCalledWith('{"eventType":"iframe_ready","eventData":{"reload_supported":true}}', 'https://web.telegram.org')
    const top = () => child.document.documentElement.style.getPropertyValue('--sa-top')

    message(child, 'https://evil.example', parent, safeArea) // a foreign origin
    message(child, 'https://web.telegram.org', null, safeArea) // not from the parent frame
    message(child, 'https://web.telegram.org', child, safeArea) // not from the parent frame either
    message(child, 'https://web.telegram.org', parent, { eventType: 'safe_area_changed', eventData: { top: 20 } }) // not a string
    message(child, 'https://web.telegram.org', parent, '{broken')
    expect(top()).toBe('')

    message(child, 'https://web.telegram.org', parent, safeArea)
    expect(top()).toBe('max(env(safe-area-inset-top, 0px), 20px)')
  })

  it('never applies CSS the web client sends (set_custom_style)', () => {
    delete win.TelegramWebviewProxy
    const { child, parent } = frame()
    stop = startBridge(child, '6.0')
    message(child, 'https://web.telegram.org', parent, JSON.stringify({ eventType: 'set_custom_style', eventData: 'body{display:none}' }))
    expect(child.document.querySelectorAll('style')).toHaveLength(0)
  })
})

describe('Back button ↔ our "Zurück"', () => {
  it('visible while the screen has a "Zurück"; back_button_pressed clicks it', async () => {
    start('9.6')
    const onBack = vi.fn()
    const { unmount } = render(
      <button type="button" data-tg-back="" onClick={onBack}>
        Zurück
      </button>,
    )
    await flush()
    expect(lastOf('web_app_setup_back_button')).toEqual({ is_visible: true })
    receive('back_button_pressed')
    expect(onBack).toHaveBeenCalledTimes(1)

    unmount() // a main tab: no "Zurück" → Telegram shows its "Close"
    await flush()
    expect(lastOf('web_app_setup_back_button')).toEqual({ is_visible: false })
  })

  it('an open sheet: Escape closes only the top one, the screen stays', async () => {
    start('9.6')
    const onBack = vi.fn()
    const closed: string[] = []
    function Screen() {
      const [lower, setLower] = useState(true)
      const [upper, setUpper] = useState(true)
      return (
        <LazyMotion features={domMax} strict>
          <button type="button" data-tg-back="" onClick={onBack}>
            Zurück
          </button>
          <Sheet open={lower} onClose={() => (closed.push('lower'), setLower(false))} title="Unten" closeLabel="Schließen">
            <p>unten</p>
          </Sheet>
          <Sheet open={upper} onClose={() => (closed.push('upper'), setUpper(false))} title="Oben" closeLabel="Schließen">
            <p>oben</p>
          </Sheet>
        </LazyMotion>
      )
    }
    render(<Screen />)
    await flush()
    expect(lastOf('web_app_setup_back_button')).toEqual({ is_visible: true })
    receive('back_button_pressed')
    expect(closed).toEqual(['upper'])
    expect(onBack).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Unten' })).toBeTruthy()
  })

  it("a sheet's own back step (data-tg-back inside the dialog) goes first", async () => {
    start('9.6')
    const step = vi.fn()
    const escape = vi.fn()
    document.addEventListener('keydown', escape)
    render(
      <div role="dialog" aria-modal="true">
        <button type="button" data-tg-back="" onClick={step}>
          Zurück
        </button>
      </div>,
    )
    receive('back_button_pressed')
    expect(step).toHaveBeenCalledTimes(1)
    expect(escape).not.toHaveBeenCalled()
    document.removeEventListener('keydown', escape)
  })
})

describe('external links → the external browser', () => {
  /** Clicks a link; returns whether something prevented the browser's own navigation. */
  function click(href: string): boolean {
    const link = document.createElement('a')
    link.href = href
    link.target = '_blank'
    link.textContent = 'Link'
    document.body.append(link)
    let prevented = false
    const record = (event: Event) => {
      prevented = event.defaultPrevented
      event.preventDefault() // jsdom cannot navigate
    }
    document.addEventListener('click', record)
    link.click()
    document.removeEventListener('click', record)
    link.remove()
    return prevented
  }

  it('a shop link: web_app_open_link instead of navigating inside the Mini App', () => {
    start('9.6')
    expect(click('https://shop.example/kaffeemuehle?ref=1')).toBe(true)
    expect(lastOf('web_app_open_link')).toEqual({ url: 'https://shop.example/kaffeemuehle?ref=1' })
  })

  it('t.me links go to Telegram itself (web_app_open_tg_link)', () => {
    start('9.6')
    expect(click('https://t.me/share/url?url=x')).toBe(true)
    expect(lastOf('web_app_open_tg_link')).toEqual({ path_full: '/share/url?url=x' })
  })

  it.each([`${location.origin}/lists/1`, '/legal/impressum', 'mailto:hallo@example.test', 'blob:http://localhost/0000'])(
    'untouched: %s',
    (href) => {
      start('9.6')
      expect(click(href)).toBe(false)
      expect(sentTypes()).not.toContain('web_app_open_link')
    },
  )

  it('below 6.1 links keep their normal behaviour', () => {
    start('6.0')
    expect(click('https://shop.example/a')).toBe(false)
  })
})

describe('haptics through Telegram', () => {
  it('the one wrapper plays haptic() through the client; the settings switch still decides', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    start('9.6')
    haptic('tap')
    haptic('select')
    haptic('error')
    const feedback = sent().filter(([type]) => type === 'web_app_trigger_haptic_feedback').map(([, data]) => data)
    expect(feedback).toEqual([
      { type: 'impact', impact_style: 'light' },
      { type: 'selection_change' },
      { type: 'notification', notification_type: 'error' },
    ])
    expect(vibrate).not.toHaveBeenCalled()

    localStorage.setItem('bunprise.haptics', '0')
    postEvent.mockClear()
    haptic('tap')
    expect(sent()).toEqual([])

    // stopped (or never started): the browser's vibration again
    localStorage.clear()
    stop?.()
    stop = null
    haptic('tap')
    expect(vibrate).toHaveBeenCalledWith(10)
    Reflect.deleteProperty(navigator, 'vibrate')
  })
})

describe('closing confirmation while a form has unsaved changes', () => {
  it('on while held, off after save / leave (6.2+)', () => {
    start('9.6')
    const release = holdClosing()
    expect(lastOf('web_app_setup_closing_behavior')).toEqual({ need_confirmation: true })
    release()
    expect(lastOf('web_app_setup_closing_behavior')).toEqual({ need_confirmation: false })
  })

  it('a form that was already dirty when the bridge arrived: on at once', () => {
    const release = holdClosing()
    start('9.6')
    expect(lastOf('web_app_setup_closing_behavior')).toEqual({ need_confirmation: true })
    release()
  })

  it('below 6.2: never sent', () => {
    start('6.1')
    holdClosing()()
    expect(sentTypes()).not.toContain('web_app_setup_closing_behavior')
  })
})

// Felix 25.10: the dark theme — Telegram's bars follow the shown theme; Telegram's own day/night counts while the
// person has not chosen a theme (lib/theme.ts).
describe('colours follow the theme', () => {
  afterEach(() => {
    sessionStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it("Telegram launched at night (detect.ts stored its scheme): the bars get the night colours", () => {
    sessionStorage.setItem('bunprise.tgScheme', 'dark')
    start('9.6')
    expect(lastOf('web_app_set_header_color')).toEqual({ color: '#1C1612' })
    expect(lastOf('web_app_set_background_color')).toEqual({ color: '#17120F' })
    expect(lastOf('web_app_set_bottom_bar_color')).toEqual({ color: '#15100D' })
  })

  it('theme_changed: followed while nothing is chosen — <html> and the bars switch; a chosen theme wins', async () => {
    start('9.6')
    expect(lastOf('web_app_set_header_color')).toEqual({ color: '#F5EEE2' })
    receive('theme_changed', { theme_params: { bg_color: '#17212b', text_color: '#f5f5f5' } })
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(lastOf('web_app_set_header_color')).toEqual({ color: '#1C1612' })
    const { setThemePreference } = await import('../theme')
    act(() => setThemePreference('light'))
    expect(lastOf('web_app_set_header_color')).toEqual({ color: '#F5EEE2' })
    receive('theme_changed', { theme_params: { bg_color: '#000000' } })
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    act(() => setThemePreference('system'))
  })

  it('theme_changed without a usable bg_color changes nothing', () => {
    start('9.6')
    const before = sent().length
    receive('theme_changed', { theme_params: { bg_color: 'red' } })
    expect(sent().length).toBe(before)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
