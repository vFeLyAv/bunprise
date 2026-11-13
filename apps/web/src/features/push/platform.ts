import { ACTIVE_STORAGE_PREFIX, DEMO_MODE } from '../../lib/app'
import { IN_TELEGRAM } from '../../lib/telegram/detect'

// Can THIS device get push notifications, and what does the person need to know (docs/spec/web-push-design.md §2)?
// Synchronous and tiny: the Profil row and the hint under an invitation card read it on render; the heavy part
// (subscribing, the sheet) is a lazy chunk (./device.ts, ./PushSheet.tsx).
//   telegram     a Telegram Mini App: no web push there — nothing is shown at all
//   demo         `npm run dev:demo`: the switches are simulated, no browser prompt, no real push
//   ios-browser  iPhone / iPad in Safari (not from the home screen): push works only in the home-screen app (iOS 16.4+)
//   unsupported  a browser without service worker / Push API / notifications
//   ready        the browser can do it (the permission may still be default / granted / denied)

export type PushPlatform = 'telegram' | 'demo' | 'ios-browser' | 'unsupported' | 'ready'

interface Env {
  telegram: boolean
  demo: boolean
  userAgent: string
  platform: string
  maxTouchPoints: number
  standalone: boolean
  supported: boolean
}

function currentEnv(): Env {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  let standalone = false
  try {
    standalone = (nav as (Navigator & { standalone?: boolean }) | undefined)?.standalone === true
      || (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
  } catch {
    standalone = false
  }
  return {
    telegram: IN_TELEGRAM,
    demo: DEMO_MODE,
    userAgent: nav?.userAgent ?? '',
    platform: nav?.platform ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone,
    supported: typeof window !== 'undefined' && !!nav && 'serviceWorker' in nav && 'PushManager' in window && 'Notification' in window,
  }
}

/** iPhone, iPod or iPad (an iPad in desktop mode says "MacIntel" but has a touch screen). */
export function isAppleMobile(env: Pick<Env, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return /iPad|iPhone|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1)
}

export function pushPlatform(env: Env = currentEnv()): PushPlatform {
  if (env.telegram) return 'telegram'
  if (env.demo) return 'demo'
  if (isAppleMobile(env) && !env.standalone) return 'ios-browser'
  return env.supported ? 'ready' : 'unsupported'
}

/** The browser's permission for notifications ('default' = never asked). */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  try {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  } catch {
    return 'unsupported'
  }
}

// ---- the device marker (localStorage, removed on sign-out with every other key of the prefix) --------------------
// { user, endpoint, lang, at }: THIS browser's subscription was registered for this account (docs/storage-registry.md
// "push"). It is a hint for the screen and for the start-up check (./device.ts syncPushDevice) — the database decides
// what is sent (a device is used only while its session lives).

const MARKER_KEY = `${ACTIVE_STORAGE_PREFIX}push`
const HINT_KEY = `${ACTIVE_STORAGE_PREFIX}pushHint`

export interface PushMarker {
  user: string
  endpoint: string
  lang: string
  /** last registration with the database (ms) */
  at: number
}

export function readPushMarker(userId: string): PushMarker | null {
  try {
    const raw = window.localStorage.getItem(MARKER_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PushMarker>
    if (value.user !== userId || typeof value.endpoint !== 'string' || typeof value.lang !== 'string' || typeof value.at !== 'number') return null
    return value as PushMarker
  } catch {
    return null
  }
}

export function writePushMarker(marker: PushMarker | null): void {
  try {
    if (marker) window.localStorage.setItem(MARKER_KEY, JSON.stringify(marker))
    else window.localStorage.removeItem(MARKER_KEY)
  } catch {
    /* storage unavailable: the switch shows "off" next time; the database still knows the device */
  }
}

/** The hint under an invitation card ("Neue Einladungen sofort aufs Handy?") was closed on this device. */
export function pushHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return true // without storage the hint would come back on every visit: better not at all
  }
}

export function dismissPushHint(): void {
  try {
    window.localStorage.setItem(HINT_KEY, '1')
  } catch {
    /* storage unavailable */
  }
}
