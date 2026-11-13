// «Ночью маскоты спят» in the app (approved 31.10, playsInApp('night')): is it night for the mascots right now?
// 23:00 – 07:00 by THIS device's clock (@bunprise/mascot/night-clock — the pure rules, no puppet) and the switch
// «Nachts schlafen» (./nightSetting.ts). The places that show a sleeping mascot (Start corner, Lists buddy, Freunde
// Tapsi, the "+" menu's `sleepy`) load this module with import() — never statically: a static import from their
// chunks put this module's chunk into the preload lists of the first screens (+0.13 KB gz on /soon, which is at its
// 200 KB limit). The puppets themselves load later with @bunprise/mascot/night (./nightMount.ts).
//
// Daytime check (dev server and demo only — a production build drops it): `?night=1` (night, 23:30), `?night=0`
// (day, 12:00), `?night=22:59` (any time: the clock then runs on from there), `?night=auto` (the real clock again).
// src/dev/nightOverride.ts reads the parameter at boot and keeps the offset for this tab (sessionStorage).
// Tests pin the clock with `globalThis.__bunpriseNightClock` (src/test/setup.ts: noon, so no test depends on the hour
// it runs at).
import { isNight, minuteOfDay, minutesToChange } from '@bunprise/mascot/night-clock'
// (this chunk needs a link to the shell: without one, the bundler moves its runtime helpers out of the shell into a
// chunk of their own, which every first screen then loads — +0.5 KB gz on /soon)
import { DEMO_MODE } from '../../lib/app'
import { playsInApp } from './inGallery'
import { nightSleep } from './nightSetting'

/** sessionStorage (dev / demo only): ms to add to the device clock — the daytime check of the night. */
export const NIGHT_OVERRIDE_KEY = 'bunprise.dev.nightClock'

declare global {
  // dev / tests only: the mascots' clock (ms) — see the header
  var __bunpriseNightClock: (() => number) | undefined
}

/** The mascots' clock (ms): the device's clock (dev / demo: shifted by `?night=`). */
export function nightClock(): number {
  // (a build folds both to false and drops the rest)
  if (import.meta.env.DEV || DEMO_MODE) {
    const pinned = globalThis.__bunpriseNightClock
    if (pinned) return pinned()
    try {
      const v = Number(window.sessionStorage.getItem(NIGHT_OVERRIDE_KEY) ?? 0)
      if (Number.isFinite(v)) return Date.now() + v
    } catch {
      /* the device's clock */
    }
  }
  return Date.now()
}

/** 23:00 – 07:00 by the mascots' clock (the switch is not asked here). */
export function isNightNow(): boolean {
  return isNight(minuteOfDay(nightClock()))
}

/** Now: the mascots sleep — night by their clock, «Nachts schlafen» on, and the scene is not held in the gallery. */
export function sleepsNow(): boolean {
  return playsInApp('night') && nightSleep.get() && isNightNow()
}

/**
 * Calls `cb(sleepsNow())` at once and again whenever it changes: at 23:00 / 07:00, when the switch changes, and when
 * the app comes back to the front (a hidden tab slows its timers down). Returns the stop function.
 */
export function watchSleeps(cb: (sleeps: boolean) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last: boolean | null = null
  const check = () => {
    clearTimeout(timer)
    const now = sleepsNow()
    if (now !== last) {
      last = now
      cb(now)
    }
    timer = setTimeout(check, Math.min(minutesToChange(minuteOfDay(nightClock())) * 60_000 + 250, 2 ** 31 - 1))
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }
  check()
  document.addEventListener('visibilitychange', onVisible)
  const off = nightSleep.subscribe(check)
  return () => {
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
    off()
  }
}
