// The home-screen icon chosen on this device (Felix 27.10, Einstellungen → App-Symbol, AppIconPicker.tsx).
// A PWA's icon is fixed when it is added to the home screen: iOS reads <link rel="apple-touch-icon"> at "Zum
// Home-Bildschirm", Android / Chrome read the icons of <link rel="manifest"> when installing (an installed app may pick a
// changed manifest up later by itself). So choosing only swaps those links (and the tab icon); public/boot.js links the
// chosen variant again on every page load, before anything can read them. Loaded only with the settings screen.
import { DEFAULT_APP_ICON, appIconLinks, isAppIcon, type AppIconId } from './appIconVariants'
import { isStandalone, type PlatformInfo } from '../onboarding/platform'

/**
 * localStorage key — deliberately OUTSIDE the account prefix `bunprise.` (lib/app.ts STORAGE_PREFIX): a device
 * preference like the theme, it survives sign-out without adding a word to the first screen's KEEP_ON_SIGN_OUT (the
 * /soon budget). Absent = the classic icon. public/boot.js reads the same key (docs/storage-registry.md).
 */
export const APP_ICON_KEY = 'bunprise-appIcon'

const listeners = new Set<() => void>()
/** this visit's choice, for a browser that blocks storage */
let chosen: AppIconId = DEFAULT_APP_ICON

/** The choice on this device; anything unknown = the classic icon. */
export function readAppIcon(): AppIconId {
  try {
    const value = localStorage.getItem(APP_ICON_KEY)
    return isAppIcon(value) ? value : DEFAULT_APP_ICON
  } catch {
    return chosen
  }
}

/** Points the page's manifest, Apple touch icon and tab icon at one variant (only links that exist: a dev server has no manifest). */
export function applyAppIcon(id: AppIconId, doc: Document = document): void {
  const links = appIconLinks(id)
  const hrefs: Record<string, string> = { manifest: links.manifest, 'apple-touch-icon': links.appleTouchIcon, icon: links.icon }
  for (const [rel, href] of Object.entries(hrefs)) {
    const link = doc.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
    if (link && link.getAttribute('href') !== href) link.setAttribute('href', href)
  }
}

/** Saves the choice (the classic one forgets it) and links it at once. */
export function setAppIcon(id: AppIconId): void {
  chosen = id
  try {
    if (id === DEFAULT_APP_ICON) localStorage.removeItem(APP_ICON_KEY)
    else localStorage.setItem(APP_ICON_KEY, id)
  } catch {
    /* storage blocked: `chosen` keeps it for this visit */
  }
  applyAppIcon(id)
  for (const listener of listeners) listener()
}

/** For useSyncExternalStore: this tab's choices and another tab's (storage event). */
export function onAppIconChange(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== APP_ICON_KEY && event.key !== null) return
    applyAppIcon(readAppIcon())
    listener()
  }
  listeners.add(listener)
  addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    removeEventListener('storage', onStorage)
  }
}

/** Which honest hint the picker shows: where the phone takes the icon from, and whether this is the installed app. */
export type AppIconHint = 'ios' | 'ios_installed' | 'android' | 'android_installed' | 'other'

export function appIconHint(platform: Pick<PlatformInfo, 'userAgent' | 'maxTouchPoints' | 'standalone' | 'displayModeStandalone'>): AppIconHint {
  const ua = platform.userAgent
  const installed = isStandalone(platform)
  // an iPad in desktop mode says "Macintosh" but has touch (as onboarding/platform.ts isIosSafari)
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && platform.maxTouchPoints > 1)) return installed ? 'ios_installed' : 'ios'
  if (/\bAndroid\b/.test(ua)) return installed ? 'android_installed' : 'android'
  return 'other'
}
