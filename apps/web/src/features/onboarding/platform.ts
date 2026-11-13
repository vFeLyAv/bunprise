// "Zum Home-Bildschirm hinzufügen" (product-pilot F3, design-system-motion §3 InstallHint): only in
// Safari on iPhone / iPad, and only while the app is not already running from the Home Screen.
// Other iOS browsers and the in-app browsers of social apps have no Safari share sheet with this
// entry, so they get no hint. Android / desktop never see it. Nothing is stored: the onboarding
// itself runs once per account (onboarding_done_at).
// Inside a Telegram Mini App never either — said explicitly, not left to the user agent
// (docs/spec/telegram-mini-app.md §3.7): the page lives in Telegram, there is no Safari share sheet.
import { IN_TELEGRAM } from '../../lib/telegram/detect'

export interface PlatformInfo {
  userAgent: string
  /** navigator.maxTouchPoints: tells an iPad in desktop mode (UA "Macintosh") from a real Mac */
  maxTouchPoints: number
  /** navigator.standalone (iOS only): true when the Home Screen app is running */
  standalone: boolean
  /** matchMedia('(display-mode: standalone)') */
  displayModeStandalone: boolean
  /** opened as a Telegram Mini App (lib/telegram/detect.ts) */
  inTelegram: boolean
}

export function readPlatform(): PlatformInfo {
  if (typeof navigator === 'undefined') {
    return { userAgent: '', maxTouchPoints: 0, standalone: false, displayModeStandalone: false, inTelegram: IN_TELEGRAM }
  }
  const nav = navigator as Navigator & { standalone?: unknown }
  let displayModeStandalone = false
  try {
    displayModeStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  } catch {
    /* very old engines: treat as a normal browser tab */
  }
  return {
    userAgent: typeof nav.userAgent === 'string' ? nav.userAgent : '',
    maxTouchPoints: typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0,
    standalone: nav.standalone === true,
    displayModeStandalone,
    inTelegram: IN_TELEGRAM,
  }
}

const IOS_DEVICE = /\b(?:iPhone|iPad|iPod)\b/
const DESKTOP_MAC = /\bMacintosh\b/
/** WebKit-based iOS browsers that are not Safari (Chrome, Firefox, Edge, Opera, Google app …) */
const OTHER_IOS_BROWSER = /\b(?:CriOS|FxiOS|EdgiOS|OPiOS|OPT|YaBrowser|DuckDuckGo|GSA|Brave|Vivaldi)\//
/** in-app browsers of social apps and messengers */
const IN_APP_BROWSER = /\b(?:FBAN|FBAV|FBIOS|FB_IAB|Instagram|LinkedInApp|Snapchat|Pinterest|TikTok|musical_ly|BytedanceWebview|Line|MicroMessenger|Twitter|WhatsApp|Telegram)\b/

export function isIosSafari(platform: Pick<PlatformInfo, 'userAgent' | 'maxTouchPoints'>): boolean {
  const ua = platform.userAgent
  const ios = IOS_DEVICE.test(ua) || (DESKTOP_MAC.test(ua) && platform.maxTouchPoints > 1)
  if (!ios) return false
  // Safari (also an iPad in desktop mode) names its version and engine; app web views do not.
  if (!/\bVersion\/\d/.test(ua) || !/\bSafari\/\d/.test(ua)) return false
  return !OTHER_IOS_BROWSER.test(ua) && !IN_APP_BROWSER.test(ua)
}

export function isStandalone(platform: Pick<PlatformInfo, 'standalone' | 'displayModeStandalone'>): boolean {
  return platform.standalone || platform.displayModeStandalone
}

export function shouldOfferHomeScreen(platform: PlatformInfo): boolean {
  return !platform.inTelegram && isIosSafari(platform) && !isStandalone(platform)
}
