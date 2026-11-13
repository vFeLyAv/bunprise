// The colour theme before the first frame (Felix 25.10, docs/design/2026-10-25-dark-theme.md). main.tsx imports it
// right after lib/telegram/detect.ts (CSP has no inline scripts: this is the earliest place). The CSS follows the
// system by itself (tokens.css: no data-theme = color-scheme "light dark"); this only pins <html data-theme> for a
// chosen theme (localStorage `bunprise.theme`) or, inside Telegram, Telegram's scheme (`bunprise.tgScheme`), and
// keeps <meta name="theme-color"> in step. In every first screen: keep it tiny — the
// rest (choosing, listening) is lib/theme.ts, loaded only by the settings and the Telegram bridge.
// The extra dark themes (Felix 25.10: "Blau" = navy, "Ozean" = blue accents) keep their colours in one stylesheet of
// their own (styles/extraThemes.css = navy.css + ocean.css + black.css — "Schwarz", Felix 27.10): fetched only when
// pinned, never part of the first screens.
import { storageKeys } from './app'

export type Theme = 'light' | 'dark' | 'navy' | 'ocean' | 'black'

/** The top of the page per theme (tokens.css / navy.css / ocean.css / black.css --theme-color): the browser bar and the PWA status bar. */
export const THEME_TOP: Record<Theme, string> = { light: '#F5EEE2', dark: '#1C1612', navy: '#131A2D', ocean: '#15191F', black: '#000000' }

/** The themes with a stylesheet of their own (styles/extraThemes.css). */
export const isExtraTheme = (value: Theme | null): boolean => value === 'navy' || value === 'ocean' || value === 'black'

export const isTheme = (value: string | null | undefined): value is Theme =>
  value === 'light' || value === 'dark' || (value != null && isExtraTheme(value as Theme))

let extra: Promise<unknown> | undefined
/** The theme's own stylesheet (only the extra dark themes have one); resolves once it applies. Without it (offline,
 *  first visit) the page shows the dark theme (tokens.css: their data-theme is color-scheme dark) and the next call
 *  tries again. */
export function loadThemeStyles(theme: Theme | null): Promise<unknown> {
  if (!isExtraTheme(theme)) return Promise.resolve()
  return (extra ??= import('../styles/extraThemes.css').catch(() => { extra = undefined }))
}

/** The pinned theme: the choice, else Telegram's scheme, else null (= the system decides). */
export function pinnedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(storageKeys.theme) ?? sessionStorage.getItem(storageKeys.telegramScheme)
    return isTheme(value) ? value : null
  } catch {
    return null
  }
}

/** <html data-theme> and the browser-bar colour for `pinned` (null = follow the system). The rest of the page's
 *  colour scheme comes from tokens.css (:root[data-theme] sets color-scheme). Returns the theme's own stylesheet
 *  loading (boot() awaits it before the first render, so no warm night flashes). */
export function applyTheme(pinned: Theme | null = pinnedTheme()): Promise<unknown> {
  const root = document.documentElement
  if (pinned) root.setAttribute('data-theme', pinned)
  else root.removeAttribute('data-theme')
  // index.html has one theme-color tag per system scheme (media); a pinned theme gives both its colour
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = THEME_TOP[pinned ?? (meta.getAttribute('media')?.includes('dark') ? 'dark' : 'light')]
  }
  return loadThemeStyles(pinned)
}
