// The Lists buddy at night (Felix 31.10 approved «Ночью маскоты спят»: «спящие норм, оставляем»). A lazy chunk
// next to ListsBuddy.tsx, loaded only when the mascots sleep (23:00 – 07:00, «Nachts schlafen» on).
//
// At night Pompon does not roam: he sleeps (@bunprise/mascot/night via mascot-ui/nightMount.ts) — opened at night on
// the stats row where the buddy lives (62 % along it, the buddy's own home spot), already asleep. A tap wakes him
// (2 s): then the BUDDY takes over on that very spot (his normal life, 10 min after the last touch of him), and when
// the time is up he falls asleep where he stands (once he stands still and faces you — never mid-walk or mid-throw).
// 07:00 / the switch turned off: he wakes up by himself and stays the buddy. Hidden (another mascot of the tab on
// screen) or a sheet open: the sleeper pauses and hides like the buddy would; a sleep that falls due unseen happens
// without the moment.
// Design change vs the gallery (docs/handoffs/2026-10-31-night-in-app.md): the gallery's buddy walks back to the
// stats row first — the package has no "go home" for him, so he dozes off where he stands; next opening he sleeps
// on the stats row again.
import type { ListsBuddy as Buddy, ReducedMotionMode } from '@bunprise/mascot/buddy'
import type { NightMascot, NightState } from '@bunprise/mascot/night'
import { AWAKE_MS, isNight, minuteOfDay, minutesToChange, wantsSleep } from '@bunprise/mascot/night-clock'
import { nightClock } from '../mascot-ui/night'
import { loadNight, mountNight, RETRY_MS, type NightHandle } from '../mascot-ui/nightMount'
import { nightSleep } from '../mascot-ui/nightSetting'

/** Where he stands: on the floor [data-buddy-floor="<floor>"], dx px from its left end. */
export interface Spot {
  floor: string
  dx: number
}

export interface BuddyNightContext {
  /** the buddy's stage (position: relative) */
  stage: HTMLElement
  scroller: HTMLElement | Window
  buddy(): Buddy | null
  /** builds the day buddy (ListsBuddy.tsx), his feet at `start` */
  buildBuddy(start?: { floor: string; x: number }): Promise<Buddy | null>
  /** removes the day buddy */
  dropBuddy(): void
  /** the package's reduced-motion mode of the buddy ('force' / 'auto' + the system → still poses) */
  settings(): { reducedMotion: ReducedMotionMode; hidden: boolean; sheetOpen: boolean }
}

export interface BuddyNight {
  /** the night's rules apply now (the buddy's haptics: only the tap) */
  readonly night: boolean
  /** the sleeper (null while the buddy is awake) — tests */
  readonly sleeper: NightMascot | null
  sync(): void
  destroy(): void
}

const SIZE = 96
/** The buddy's home spot on the stats row (src/buddy/buddy.ts: 62 % along it). */
const HOME_AT = 0.62
/** The buddy's margin at the floor's ends (buddy.ts margin(): 0.9 × his body radius 84 units × 1.2 at 96 px). */
const MARGIN = 0.9 * 84 * 1.2 * (SIZE / 400)
/** While he is busy (walking, inspecting, held) the sleep is asked for again after this (ms). */
const BUSY_RETRY_MS = 1500

const stillOf = (mode: ReducedMotionMode): boolean =>
  mode === 'force' || (mode === 'auto' && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

export function createBuddyNight(ctx: BuddyNightContext): BuddyNight {
  let handle: NightHandle | null = null
  let prev: NightState | null = null
  let spot: Spot | null = null
  let deadline = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined
  let destroyed = false
  let swapping = false

  const rectOf = (floor: string): { x0: number; x1: number; y: number } | null => {
    const el = ctx.stage.querySelector<HTMLElement>(`[data-buddy-floor="${floor}"]`)
    if (!el) return null
    const st = ctx.stage.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return { x0: r.left - st.left, x1: r.right - st.left, y: r.top - st.top }
  }
  const home = (): Spot | null => {
    const floor = rectOf('stats') ? 'stats' : ctx.stage.querySelector<HTMLElement>('[data-buddy-floor]')?.dataset.buddyFloor
    const r = floor ? rectOf(floor) : null
    return floor && r ? { floor, dx: (r.x1 - r.x0) * HOME_AT } : null
  }
  const place = (m: NightMascot, at: Spot): void => {
    const floor = rectOf(at.floor) ? at.floor : (home()?.floor ?? at.floor)
    const r = rectOf(floor)
    if (!r) return
    const x = Math.min(Math.max(r.x0 + at.dx, r.x0 + MARGIN), Math.max(r.x0 + MARGIN, r.x1 - MARGIN))
    spot = { floor, dx: x - r.x0 }
    m.rig.box.style.left = `${(x - m.rig.size / 2).toFixed(2)}px`
    m.rig.box.style.top = `${(r.y - m.rig.feet).toFixed(2)}px`
  }
  const applyHidden = (): void => {
    if (!handle) return
    const s = ctx.settings()
    handle.mascot.rig.box.style.visibility = s.hidden ? 'hidden' : ''
    handle.setPaused(s.hidden || s.sheetOpen)
    handle.setStill(stillOf(s.reducedMotion))
  }

  /** He falls asleep on `at` (live: in front of you, from awake; else already asleep). The buddy goes in the same task. */
  async function sleepAt(at: Spot, live: boolean): Promise<void> {
    const mod = await loadNight()
    if (destroyed || handle) return
    const s = ctx.settings()
    prev = live ? 'awake' : null
    spot = null
    handle = mountNight(mod, ctx.stage, {
      kind: 'bunny',
      coat: 'fawn',
      size: SIZE,
      still: stillOf(s.reducedMotion),
      ...(live ? { startAwake: true } : {}),
      scroller: ctx.scroller,
      wear: true,
      place: (m) => place(m, spot ?? at),
      onChange: (state, m) => {
        const was = prev
        prev = state
        if (state === 'awake' && was !== null && was !== 'awake') wakeUp(m)
      },
    })
    if (prev === null) prev = handle.mascot.state
    // above the cards like the buddy's own layer
    handle.mascot.rig.box.style.zIndex = '5'
    applyHidden()
    ctx.dropBuddy()
  }

  /** The sleeper woke up (a tap, 07:00, the switch off): the buddy takes over on his spot. */
  function wakeUp(m: NightMascot): void {
    if (swapping || destroyed) return
    swapping = true
    deadline = m.awakeUntil
    const at = spot
    const r = at ? rectOf(at.floor) : null
    void ctx.buildBuddy(at && r ? { floor: at.floor, x: r.x0 + at.dx } : undefined).then((b) => {
      swapping = false
      if (destroyed || !b) return
      handle?.destroy()
      handle = null
      prev = null
      schedule()
    }, () => {
      swapping = false
    })
  }

  /** The buddy is awake: time to sleep? Then where he stands, once he stands still facing you. */
  function check(): void {
    clearTimeout(timer)
    if (destroyed || handle || swapping) return
    const b = ctx.buddy()
    if (!b) return
    const now = nightClock()
    if (!wantsSleep({ now, enabled: nightSleep.get(), awakeUntil: deadline })) {
      schedule()
      return
    }
    const s = ctx.settings()
    const p = b.position
    const r = rectOf(p.floor)
    const at: Spot | null = r ? { floor: p.floor, dx: p.x - r.x0 } : null
    if (document.hidden || s.hidden || s.sheetOpen) {
      // nobody sees him: asleep at once (no moment)
      const where = at ?? home()
      if (where) void sleepAt(where, false)
      return
    }
    const facing = ctx.stage.querySelector('.bd-host')?.shadowRoot?.querySelector('.hm.turn-l, .hm.turn-r')
    if (!at || p.mode !== 'stand' || b.info.action !== 'idle' || facing) {
      timer = setTimeout(check, BUSY_RETRY_MS)
      return
    }
    void sleepAt(at, true)
  }

  function schedule(): void {
    clearTimeout(timer)
    if (destroyed || handle) return
    const now = nightClock()
    const untilAwake = deadline > now ? deadline - now : Infinity
    const untilChange = minutesToChange(minuteOfDay(now)) * 60_000
    const wait = Math.min(untilAwake, untilChange, 2 ** 31 - 1)
    timer = setTimeout(check, Number.isFinite(wait) ? wait + 250 : RETRY_MS)
  }

  // a touch of the awake buddy at night: awake again for 10 min from now
  const onDown = (e: Event) => {
    const t = e.target as Element | null
    if (!handle && t?.closest?.('.bd-hit') && isNight(minuteOfDay(nightClock()))) deadline = nightClock() + AWAKE_MS
  }
  ctx.stage.addEventListener('pointerdown', onDown, true)
  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }
  document.addEventListener('visibilitychange', onVisible)
  const offSetting = nightSleep.subscribe(() => {
    if (nightSleep.get() && !handle) check()
  })

  // opened at night: he sleeps on the stats row; the night began while the buddy lives: he dozes off when he can
  if (ctx.buddy()) check()
  else {
    const at = home()
    if (at && wantsSleep({ now: nightClock(), enabled: nightSleep.get(), awakeUntil: -Infinity })) void sleepAt(at, false)
    else void ctx.buildBuddy()
  }

  return {
    get night() {
      return nightSleep.get() && isNight(minuteOfDay(nightClock()))
    },
    get sleeper() {
      return handle?.mascot ?? null
    },
    sync() {
      applyHidden()
      if (!handle) check()
    },
    destroy() {
      destroyed = true
      clearTimeout(timer)
      ctx.stage.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('visibilitychange', onVisible)
      offSetting()
      handle?.destroy()
      handle = null
    },
  }
}
