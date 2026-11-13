// Choosing and following the colour theme (Felix 25.10, docs/design/2026-10-25-dark-theme.md): System (default) ·
// Hell · Dunkel · Blau (navy) · Ozean (blue accents) · Schwarz (black, 27.10), stored in localStorage `bunprise.theme` (a device preference like the language; kept on sign-out),
// and Telegram's own day/night while the person has not chosen. Loaded only by the settings screen and the Telegram
// bridge; what has to happen before the first frame is lib/themeBoot.ts (main.tsx).
import { storageKeys } from './app'
import { applyTheme, isExtraTheme, isTheme, loadThemeStyles, pinnedTheme, type Theme } from './themeBoot'

export type { Theme } from './themeBoot'
export type ThemePreference = 'system' | Theme

/** The top, middle and bottom of the page per theme (tokens.css --theme-color / --page-*): Telegram's bars. */
export const THEME_COLORS: Record<Theme, { header: string; background: string; bottomBar: string }> = {
  light: { header: '#F5EEE2', background: '#F2EBDD', bottomBar: '#F0E6D6' },
  dark: { header: '#1C1612', background: '#17120F', bottomBar: '#15100D' },
  navy: { header: '#131A2D', background: '#0F1526', bottomBar: '#0D1322' },
  ocean: { header: '#15191F', background: '#111418', bottomBar: '#0F1215' },
  black: { header: '#000000', background: '#000000', bottomBar: '#000000' },
}

const listeners = new Set<(theme: Theme) => void>()
/** this visit's choice, for a browser that blocks storage */
let chosen: ThemePreference = 'system'
let started = false

/** The person's choice on this device; anything unknown = 'system'. */
export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKeys.theme)
    return isTheme(value) ? value : 'system'
  } catch {
    return chosen
  }
}

const systemDark = (): boolean => {
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** What the screen shows: the choice, else Telegram's scheme, else the system's. */
export function currentTheme(): Theme {
  const pref = readThemePreference()
  return pref !== 'system' ? pref : pinnedTheme() ?? (systemDark() ? 'dark' : 'light')
}

/** Applies the current state and tells the listeners (the bridge repaints Telegram's bars, the settings re-read). */
function refresh(): void {
  const pref = readThemePreference()
  const pinned = pref !== 'system' ? pref : pinnedTheme()
  // Blau / Ozean / Schwarz: their stylesheet first, so the page changes in one step (never the warm night for a frame)
  if (isExtraTheme(pinned)) void loadThemeStyles(pinned).then(() => { if (readThemePreference() === pref) show(pinned) })
  else show(pinned)
}

function show(pinned: Theme | null): void {
  void applyTheme(pinned)
  const theme = currentTheme()
  for (const listener of listeners) listener(theme)
}

/** Follows the system and other tabs from the first listener on (the boot needs neither: the CSS follows the system). */
function start(): void {
  if (started) return
  started = true
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh)
  } catch {
    /* no matchMedia: nothing to follow */
  }
  addEventListener('storage', (event) => {
    if (event.key === storageKeys.theme) refresh()
  })
}

/** Saves the choice ('system' forgets it) and shows it at once. */
export function setThemePreference(pref: ThemePreference): void {
  chosen = pref
  try {
    if (pref === 'system') localStorage.removeItem(storageKeys.theme)
    else localStorage.setItem(storageKeys.theme, pref)
  } catch {
    /* storage blocked: `chosen` keeps it for this visit */
  }
  refresh()
}

/** Telegram changed day/night (bridge: theme_changed); it counts while the person has not chosen. */
export function setTelegramScheme(scheme: Theme): void {
  try {
    sessionStorage.setItem(storageKeys.telegramScheme, scheme)
  } catch {
    /* storage blocked */
  }
  refresh()
}

/** Called with the shown theme after every change. Returns the unsubscribe function. */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
