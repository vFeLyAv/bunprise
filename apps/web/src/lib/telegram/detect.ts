// Is this tab a Telegram Mini App? (docs/spec/telegram-mini-app.md §2.4) — imported by main.tsx BEFORE the
// router, because Telegram puts its launch data into the URL fragment (#tgWebAppData=…&tgWebAppPlatform=…) and
// that personal data must leave the address bar and the history before the router reads the location.
// Only a fragment with `tgWebAppPlatform=` is touched: /i#<token> and /f#<code> stay as they are.
// The flag survives in-app reloads in sessionStorage (`bunprise.tg`, kept by clearSessionDrafts); everything else
// (the bridge to the Telegram client) loads lazily and only inside Telegram. Kept tiny: it is in every first screen.
// It also reads Telegram's colour scheme from the launch theme (only the background colour's brightness, like
// telegram-web-app.js; `bunprise.tgScheme`): lib/theme.ts follows it while the person has not chosen a theme.
import { storageKeys } from '../app'

/** 'dark' | 'light' from the theme's bg_color (JSON text): dark when its channels average below half, else null. */
export function schemeOf(themeParams: string | null): 'light' | 'dark' | null {
  const hex = /"bg_color":\s*"#([0-9a-f]{6})"/i.exec(themeParams ?? '')?.[1]
  if (!hex) return null
  const n = parseInt(hex, 16)
  return (n >> 16) + ((n >> 8) & 255) + (n & 255) < 384 ? 'dark' : 'light'
}

function detect(): boolean {
  try {
    const { hash, pathname, search } = location
    if (hash.includes('tgWebAppPlatform=')) {
      const launch = new URLSearchParams(hash.slice(1))
      // the launch data leaves the address FIRST — also when storage is blocked (Codex review 24.10: else it would
      // travel on into /login?next=…); remembering the flag for reloads is best effort
      history.replaceState(history.state, '', pathname + search)
      try {
        sessionStorage.setItem(storageKeys.telegram, `${launch.get('tgWebAppPlatform')} ${launch.get('tgWebAppVersion')}`)
        const scheme = schemeOf(launch.get('tgWebAppThemeParams'))
        if (scheme) sessionStorage.setItem(storageKeys.telegramScheme, scheme)
      } catch {
        /* storage blocked: this load still knows it runs in Telegram */
      }
      return true
    }
    return 'TelegramWebviewProxy' in window || sessionStorage.getItem(storageKeys.telegram) !== null
  } catch {
    return false
  }
}

export const IN_TELEGRAM = detect()
