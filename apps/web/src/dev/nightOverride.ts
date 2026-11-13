// Dev server / demo only (src/main.tsx imports it behind `import.meta.env.DEV || VITE_DEMO`, a production build
// never contains it): the daytime check of «Ночью маскоты спят». The URL parameter is read once at boot — the router
// and the sign-in flow drop it later — and kept for this tab as an offset of the mascots' clock
// (features/mascot-ui/night.ts NIGHT_OVERRIDE_KEY, sessionStorage):
//   ?night=1      night (the clock shows 23:30 now and runs on)       ?night=0     day (12:00)
//   ?night=22:59  any time of day (a minute later they fall asleep)  ?night=auto  the device's own clock again
import { atMinute, parseTime } from '@bunprise/mascot/night-clock'
import { NIGHT_OVERRIDE_KEY } from '../features/mascot-ui/night'

export function captureNightOverride(search: string = window.location.search): void {
  const value = new URLSearchParams(search).get('night')
  if (value === null) return
  try {
    if (value === 'auto') {
      window.sessionStorage.removeItem(NIGHT_OVERRIDE_KEY)
      return
    }
    const minute = value === '1' ? 23 * 60 + 30 : value === '0' ? 12 * 60 : parseTime(value)
    if (minute === null) return
    const now = Date.now()
    window.sessionStorage.setItem(NIGHT_OVERRIDE_KEY, String(atMinute(now, minute) - now))
  } catch {
    /* storage unavailable: the real clock */
  }
}
