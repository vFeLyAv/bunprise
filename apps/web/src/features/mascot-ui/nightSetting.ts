// «Nachts schlafen» (Einstellungen → Bewegung, under «Kaninchen zeigen»; default ON — Felix 31.10 approved the
// gallery's rules: «спящие норм, оставляем»). A device preference in localStorage `bunprise.nightSleep` = '0' | '1'
// (absent = on), like the haptics / sound switches — cleared on sign-out with every `bunprise.` key that is not a
// kept device preference (docs/storage-registry.md). Every change sends NIGHT_SLEEP_EVENT on window (another tab of
// the app: the `storage` event), so a sleeping mascot on a mounted screen follows at once.
// The settings row (motion/MotionSettingsSection.tsx) writes the same key and event inline: importing this module from
// the settings route would add a chunk to the route's preload list in the first-screen shell (bundle budget of
// /soon); nightSetting.test.ts keeps both spellings equal.

/** (spelled out, not built from lib/app STORAGE_PREFIX: one more import from the shell renames its exports) */
export const NIGHT_SLEEP_KEY = 'bunprise.nightSleep'
export const NIGHT_SLEEP_EVENT = 'bunprise-night-sleep'

export const nightSleep = {
  /** «Nachts schlafen» is on (default: on). */
  get(): boolean {
    try {
      return window.localStorage.getItem(NIGHT_SLEEP_KEY) !== '0'
    } catch {
      return true
    }
  },
  set(on: boolean): void {
    try {
      window.localStorage.setItem(NIGHT_SLEEP_KEY, on ? '1' : '0')
    } catch {
      /* storage unavailable: the switch still reaches this page */
    }
    window.dispatchEvent(new Event(NIGHT_SLEEP_EVENT))
  },
  /** Called on every change (this tab, or another tab of the app). */
  subscribe(fn: () => void): () => void {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === NIGHT_SLEEP_KEY) fn()
    }
    window.addEventListener(NIGHT_SLEEP_EVENT, fn)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(NIGHT_SLEEP_EVENT, fn)
      window.removeEventListener('storage', onStorage)
    }
  },
}
