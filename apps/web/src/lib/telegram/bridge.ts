// Our own small bridge to the Telegram client (docs/spec/telegram-mini-app.md §1.3–1.4, §2.3) instead of
// telegram-web-app.js or an npm SDK (CLAUDE.md: no third-party scripts — a foreign script on our origin could read
// the Supabase session). main.tsx loads this chunk lazily, after the first screen and only when IN_TELEGRAM
// (lib/telegram/detect.ts); nothing imports it statically.
//
// The protocol (core.telegram.org/api/web-events; the details as telegram-web-app.js does them):
//   page → client: TelegramWebviewProxy.postEvent(type, json) in the mobile and desktop apps (window.external.notify
//     in old desktop builds); in Telegram Web (an iframe) window.parent.postMessage('{"eventType":…,"eventData":…}')
//     — to the Telegram Web origins only, not to '*' like the script;
//   client → page: window.Telegram.WebView.receiveEvent(type, data) in the apps; `message` events in Telegram Web,
//     accepted only from window.parent AND from a Telegram Web origin.
// Every method is gated by the client's Bot API version (sessionStorage `bunprise.tg`, written by detect.ts).
// What it does (spec section): colours of the shown theme, light or dark, and Telegram's own theme changes (3.3), no swipe-down-to-minimise because our sheets are
// dragged down (3.4), expand + ready (1.4), safe areas → --sa-* (3.4), Telegram's Back ↔ our "Zurück" and the
// sheets (3.2), foreign links → the external browser (1.6, 3.6), haptics (3.8), closing confirmation while a form
// has unsaved changes (3.11).

import { storageKeys } from '../app'
import { setHapticSink, type HapticKind } from '../haptics'
import { currentTheme, onThemeChange, setTelegramScheme, THEME_COLORS, type Theme } from '../theme'
import { schemeOf } from './detect'
import { onClosingChange } from './closing'
import './bridge.css'

type EventData = Record<string, unknown>
type Send = (type: string, data?: EventData) => void
type Receive = (type: string, data?: unknown) => void

/** The globals of the Telegram clients (no global augmentation: only this module touches them). */
export type TelegramWindow = Window & {
  TelegramWebviewProxy?: { postEvent?: (type: string, data?: string) => void }
  Telegram?: { WebView?: { receiveEvent?: Receive } }
  TelegramGameProxy?: { receiveEvent?: Receive }
  TelegramGameProxy_receiveEvent?: Receive
}

/** The Telegram Web clients that may frame us — the same list as frame-ancestors in public/_headers. */
export const TELEGRAM_WEB_ORIGINS: readonly string[] = ['https://web.telegram.org', 'https://webk.telegram.org', 'https://weba.telegram.org']


const HAPTICS: Record<HapticKind, EventData> = {
  tap: { type: 'impact', impact_style: 'light' },
  select: { type: 'selection_change' },
  success: { type: 'notification', notification_type: 'success' },
  warning: { type: 'notification', notification_type: 'warning' },
  error: { type: 'notification', notification_type: 'error' },
}

/** How events reach the client, in telegram-web-app.js's order; null = not inside a Telegram client. */
export function channel(win: TelegramWindow): Send | null {
  const proxy = win.TelegramWebviewProxy
  if (typeof proxy?.postEvent === 'function') {
    const post = proxy.postEvent.bind(proxy)
    // like the script: the data as a JSON string (undefined when an event has none)
    return (type, data) => post(type, JSON.stringify(data))
  }
  const external: unknown = Reflect.get(win, 'external')
  const notify: unknown = external !== null && typeof external === 'object' ? Reflect.get(external, 'notify') : undefined
  if (typeof notify === 'function') {
    return (type, data) => void notify.call(external, JSON.stringify({ eventType: type, eventData: data }))
  }
  if (win.parent !== win) {
    const parent = win.parent
    return (type, data) => {
      const message = JSON.stringify({ eventType: type, eventData: data })
      // a target origin that is not the parent's drops the message: only the Telegram Web client that frames us reads it
      for (const origin of TELEGRAM_WEB_ORIGINS) parent.postMessage(message, origin)
    }
  }
  return null
}

/** The client's Bot API version ("ios 9.6" → "9.6"); unknown → 6.0, Telegram's own default. */
function storedVersion(): string {
  try {
    const version = sessionStorage.getItem(storageKeys.telegram)?.split(' ')[1]
    if (version && /^\d+(\.\d+)*$/.test(version)) return version
  } catch {
    /* storage blocked */
  }
  return '6.0'
}

/** Dotted versions compared part by part ("7.10" ≥ "7.7"), like telegram-web-app.js. */
export function versionAtLeast(version: string, min: string): boolean {
  const have = version.split('.')
  const need = min.split('.')
  for (let i = 0; i < Math.max(have.length, need.length); i += 1) {
    const a = parseInt(have[i] ?? '', 10) || 0
    const b = parseInt(need[i] ?? '', 10) || 0
    if (a !== b) return a > b
  }
  return true
}

// ---- safe areas ----------------------------------------------------------------------------------------------

const SIDES = ['top', 'right', 'bottom', 'left'] as const
type Insets = Record<(typeof SIDES)[number], number>
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
/** Larger values are not an inset but garbage. */
const MAX_INSET = 300

/** {top, right, bottom, left} in CSS px from the client; anything else counts as 0. */
function readInsets(data: unknown): Insets {
  const insets = { ...NO_INSETS }
  if (data === null || typeof data !== 'object') return insets
  const source = data as Partial<Record<keyof Insets, unknown>>
  for (const side of SIDES) {
    const value = source[side]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) insets[side] = Math.min(value, MAX_INSET)
  }
  return insets
}

/**
 * The device's safe area + the part Telegram's own UI covers (⚠️ adding the two is to be checked on devices), never
 * less than the browser's env(). An inline style on <html> beats tokens.css's :root rule, so every user of --sa-*
 * (top bar, tab bar, sheets) follows without a byte in the shell.
 */
function applyInsets(root: HTMLElement, safe: Insets, content: Insets): void {
  for (const side of SIDES) {
    root.style.setProperty(`--sa-${side}`, `max(env(safe-area-inset-${side}, 0px), ${safe[side] + content[side]}px)`)
  }
}

// ---- back ------------------------------------------------------------------------------------------------------

/** Our "Zurück" buttons (ui/TopBar.tsx; back steps inside a sheet, features/nav/CreateMenu.tsx). */
const BACK = '[data-tg-back]'

/** Not covered by a sheet (ui/sheetLayer.ts makes everything below the top sheet inert). */
const live = (element: Element) => element.closest('[inert]') === null

/** The open sheet or menu on top, if any. */
function topDialog(doc: Document): HTMLElement | null {
  return Array.from(doc.querySelectorAll<HTMLElement>('[aria-modal="true"]')).filter(live).at(-1) ?? null
}

/** The screen's own "Zurück" — while no sheet covers it. */
function screenBack(doc: Document): HTMLElement | null {
  return Array.from(doc.querySelectorAll<HTMLElement>(BACK)).find(live) ?? null
}

/**
 * Telegram's Back runs our own back logic (history or parent screen, the leave guard's question): the top sheet's own
 * back step, else Escape — which closes only the top sheet (ui/Sheet.tsx, features/nav/modal.ts) — else the screen's
 * "Zurück".
 */
function pressBack(doc: Document): void {
  const dialog = topDialog(doc)
  if (!dialog) {
    screenBack(doc)?.click()
    return
  }
  const step = dialog.querySelector<HTMLElement>(BACK)
  if (step) step.click()
  else dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

// ---- links ------------------------------------------------------------------------------------------------------

/**
 * A click on a link to another site opens it in the external browser, never inside the Mini App (§1.6: Telegram
 * allows its methods only on our origin). It is a user's click, as web_app_open_link requires. Our own links,
 * blob: (the data export), mailto: and every other scheme keep their normal behaviour.
 */
function openLinksOutside(send: Send, ownOrigin: string): (event: MouseEvent) => void {
  return (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(link instanceof HTMLAnchorElement)) return
    let url: URL
    try {
      url = new URL(link.href)
    } catch {
      return
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin === ownOrigin) return
    event.preventDefault()
    if (url.hostname === 't.me') send('web_app_open_tg_link', { path_full: url.pathname + url.search })
    else send('web_app_open_link', { url: url.href })
  }
}

// ---- start ------------------------------------------------------------------------------------------------------

/** Starts the bridge (once, from main.tsx). Returns the stop function (for tests), or null outside a Telegram client. */
export function startBridge(win: TelegramWindow = window, version: string = storedVersion()): (() => void) | null {
  const send = channel(win)
  if (!send) return null
  const doc = win.document
  const root = doc.documentElement
  const at = (min: string) => versionAtLeast(version, min)
  const stops: Array<() => void> = []

  let safe = NO_INSETS
  let content = NO_INSETS
  const receive: Receive = (type, data) => {
    if (type === 'back_button_pressed') return pressBack(doc)
    if (type === 'theme_changed') {
      // Telegram switched day/night: followed while the person has not chosen a theme (lib/theme.ts)
      const params = data !== null && typeof data === 'object' ? (data as EventData).theme_params : undefined
      const scheme = schemeOf(JSON.stringify(params ?? null))
      if (scheme) setTelegramScheme(scheme)
      return
    }
    if (type === 'safe_area_changed') safe = readInsets(data)
    else if (type === 'content_safe_area_changed') content = readInsets(data)
    else return
    applyInsets(root, safe, content)
  }
  win.Telegram = { WebView: { receiveEvent: receive } }
  // older clients call these names (telegram-web-app.js keeps them too)
  win.TelegramGameProxy = { receiveEvent: receive }
  win.TelegramGameProxy_receiveEvent = receive

  if (win.parent !== win) {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== win.parent || !TELEGRAM_WEB_ORIGINS.includes(event.origin) || typeof event.data !== 'string') return
      let message: { eventType?: unknown; eventData?: unknown } | null
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (typeof message?.eventType !== 'string') return
      if (message.eventType === 'reload_iframe') {
        send('iframe_will_reload')
        win.location.reload()
        return
      }
      // set_custom_style (CSS from the web client) falls through to receive() and is ignored: no foreign CSS here
      receive(message.eventType, message.eventData)
    }
    win.addEventListener('message', onMessage)
    stops.push(() => win.removeEventListener('message', onMessage))
    send('iframe_ready', { reload_supported: true })
  }

  // Telegram's header, background and bottom bar in the colours of the shown theme — again on every change
  const paint = (theme: Theme) => {
    const colors = THEME_COLORS[theme]
    if (at('6.9')) send('web_app_set_header_color', { color: colors.header })
    if (at('6.1')) send('web_app_set_background_color', { color: colors.background })
    if (at('7.10')) send('web_app_set_bottom_bar_color', { color: colors.bottomBar })
  }
  paint(currentTheme())
  stops.push(onThemeChange(paint))
  if (at('7.7')) send('web_app_setup_swipe_behavior', { allow_vertical_swipe: false })
  send('web_app_expand')
  send('web_app_ready')
  if (at('8.0')) {
    send('web_app_request_safe_area')
    send('web_app_request_content_safe_area')
  }

  if (at('6.1')) {
    // Telegram's Back button: visible while there is a "Zurück" or an open sheet; our bar's own one hides (bridge.css)
    root.setAttribute('data-tg', '')
    let visible = false
    send('web_app_setup_back_button', { is_visible: false }) // the client may remember it from before a reload
    const sync = () => {
      const next = topDialog(doc) !== null || screenBack(doc) !== null
      if (next === visible) return
      visible = next
      send('web_app_setup_back_button', { is_visible: next })
    }
    const observer = new MutationObserver(sync)
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] })
    sync()
    stops.push(() => {
      observer.disconnect()
      root.removeAttribute('data-tg')
    })

    const onClick = openLinksOutside(send, win.location.origin)
    doc.addEventListener('click', onClick, true)
    stops.push(() => doc.removeEventListener('click', onClick, true))

    setHapticSink((kind) => send('web_app_trigger_haptic_feedback', HAPTICS[kind]))
    stops.push(() => setHapticSink(null))
  }

  if (at('6.2')) {
    stops.push(onClosingChange((need) => send('web_app_setup_closing_behavior', { need_confirmation: need })))
  }

  return () => {
    for (const stop of stops.splice(0)) stop()
  }
}
