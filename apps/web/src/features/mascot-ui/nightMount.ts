// One sleeping mascot in the app (@bunprise/mascot/night, approved 31.10) with the app's rules around it — used by
// NightMascot.tsx (Start corner, Freunde Tapsi) and features/lists/ListsBuddy.tsx (the buddy at night):
//   - lazy: the night entry loads with Pompon's look (./pompon.ts) only when a mascot really sleeps on a screen;
//   - one mascot animates at a time (./stage.ts): every night moment asks for the stage first (a tap wake-up as a
//     'response', falling asleep / the morning / the peek as a 'decoration'; refused = not now, see the package);
//     the sleeping loop is his idle — paused while another mascot holds the stage;
//   - the clock: ./night.ts (the device's clock, dev/demo `?night=`); «Nachts schlafen» off = he behaves as by day;
//   - still poses (reduced motion, «Weniger», battery saver) are the caller's `still`;
//   - the person scrolls nearby → one sleepy peek at most every 20 s (the package counts);
//   - a tap: haptics 'tap' through lib/haptics only — nothing else vibrates at night;
//   - only his body catches a touch (`hit`): the card he sleeps on stays tappable; decorative (aria-hidden) unless
//     the caller gives him a label;
//   - one timer, no polling: re-reads the clock when the next thing can happen (his awake time ends, 23:00 / 07:00)
//     and when the app comes back to the front.
import type { Bunny, BunnyCoat, Hamster, HamsterCoat, HamsterScene } from '@bunprise/mascot'
import type { NightKind, NightMascot, NightState } from '@bunprise/mascot/night'
import { haptic } from '../../lib/haptics'
import { nightClock } from './night'
import { nightSleep } from './nightSetting'
import { registerMascot, releaseStage, requestStage, setMascotIdle, unregisterMascot, type StageMember } from './stage'

export type NightModule = typeof import('@bunprise/mascot/night')

/** startAwake: this long on screen, awake, before he falls asleep (ms). */
export const START_AWAKE_MS = 900
/** A night moment the stage refused is asked for again after this (ms). */
export const RETRY_MS = 4000

let modulePromise: Promise<NightModule> | null = null

/** The night entry, with Pompon's look (./pompon.ts: the fluffy cheeks) set before the first puppet. */
export function loadNight(): Promise<NightModule> {
  modulePromise ??= Promise.all([import('@bunprise/mascot/night'), import('./pompon')]).then(([mod]) => mod).catch((err: unknown) => {
    modulePromise = null
    throw err
  })
  return modulePromise
}

export interface NightMountOptions {
  kind: NightKind
  /** px width of the puppet's box */
  size: number
  coat?: BunnyCoat | HamsterCoat
  /** Tapsi in "Freunde" holds his binoculars */
  binoculars?: boolean
  /** reduced motion / «Weniger» / battery saver: still poses only */
  still: boolean
  /** the night began while this screen was open: awake first, then he falls asleep in front of you */
  startAwake?: boolean
  /** scrolling inside this makes him peek (default: the whole document — every scroll on the screen) */
  scroller?: HTMLElement | Window | Document | null
  /** places his box (left / top in the parent); again whenever the parent's size changes */
  place: (m: NightMascot) => void
  /**
   * A tap while he is awake plays this puppet scene (a 'response' on the stage; a find of «Pompons Sammlung» like
   * Mascot.tsx notes it) instead of his small hop — Tapsi in "Freunde": 'speck', as by day. Not under still poses.
   */
  awakeScene?: HamsterScene
  /** a tap while he is awake: true = answered by the caller — else `awakeScene` or his small hop (both on the stage) */
  onAwakeTap?: (m: NightMascot) => boolean
  onChange?: (state: NightState, m: NightMascot) => void
  /** an accessible name: his body becomes a button (keyboard: Enter / Space = a tap); without: aria-hidden */
  label?: string
  /** Pompon wears today's outfit («Pompons Sammlung», ../sammlung/wear.ts) */
  wear?: boolean
}

export interface NightHandle {
  readonly mascot: NightMascot
  /** his stage id (./stage.ts) */
  readonly id: symbol
  setStill(still: boolean): void
  /** paused from outside (a sheet is open, the screen hides him): no moment, no loop */
  setPaused(paused: boolean): void
  destroy(): void
}

export function mountNight(mod: NightModule, parent: HTMLElement, o: NightMountOptions): NightHandle {
  const id = Symbol('night')
  let external = false
  let stageStopped = false
  let claimed = false
  let still = o.still
  let destroyed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  // startAwake: he is on screen (faded in) for a moment before he yawns
  let startAt = o.startAwake ? Date.now() + START_AWAKE_MS : 0
  const mascotRef: { m: NightMascot | null } = { m: null }
  const paused = () => external || stageStopped
  const gate = (moment: string): boolean => {
    // paused from outside nothing animates (the package jumps to the moment's end): no stage needed
    if (external) return true
    if (!requestStage(id, moment === 'wake' ? 'response' : 'decoration')) return false
    claimed = true
    stageStopped = false
    mascotRef.m?.setPaused(paused())
    return true
  }
  const m = new mod.NightMascot(parent, {
    kind: o.kind,
    size: o.size,
    ...(o.coat ? { coat: o.coat } : {}),
    binoculars: !!o.binoculars,
    hit: true,
    drip: true,
    still,
    enabled: nightSleep.get(),
    now: nightClock,
    ...(o.startAwake ? { startAwake: true } : {}),
    gate,
    onTap: () => haptic('tap'),
    onAwakeTap: () => {
      const me = mascotRef.m
      if (!me || (o.onAwakeTap?.(me) ?? false)) return true
      // still poses: a tap moves nothing (the package's Weniger contract); else his answer through the stage
      const puppet = me.rig.puppet
      if (still || puppet.busy || !requestStage(id, 'response')) return true
      const scene = o.kind === 'hamster' ? o.awakeScene : undefined
      if (scene) {
        void import('../sammlung/note').then((n) => n.noteMascotScene('hamster', scene), () => undefined)
        void (puppet as Hamster).play(scene).finally(() => releaseStage(id))
      } else void puppet.hop().finally(() => releaseStage(id))
      return true
    },
    onChange: (state, me) => {
      if (claimed && !me.busy) {
        claimed = false
        releaseStage(id)
      }
      if (mascotRef.m) arm()
      o.onChange?.(state, me)
    },
  })
  mascotRef.m = m

  const box = m.rig.box
  box.setAttribute('data-night', o.kind)
  const hit = m.rig.hit
  if (o.label && hit) {
    hit.setAttribute('role', 'button')
    hit.setAttribute('tabindex', '0')
    hit.setAttribute('aria-label', o.label)
    hit.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      m.tap()
    })
  } else box.setAttribute('aria-hidden', 'true')
  // a touch that starts on him is his own (the app's swipe between tabs leaves it alone, like the Lists buddy)
  hit?.setAttribute('data-drag-own', '')

  const member: StageMember = {
    // a night moment, or the scene of an awake tap (Tapsi's speck)
    get busy() {
      return m.busy || m.rig.puppet.busy
    },
    get isDestroyed() {
      return m.isDestroyed
    },
    get suspended() {
      return m.suspended
    },
    // the sleeping loop (awake: his idle life) is his idle: it pauses while another mascot holds the stage
    stopIdle: () => {
      stageStopped = true
      m.setPaused(paused())
    },
    startIdle: () => {
      stageStopped = false
      m.setPaused(paused())
    },
  }
  registerMascot(id, member, !still)

  o.place(m)
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!destroyed) o.place(m) }) : null
  ro?.observe(parent)

  // re-read the clock exactly when something can change: his awake time ends, or 23:00 / 07:00; a moment the stage
  // refused (another mascot animated) is asked for again a little later
  function arm(): void {
    clearTimeout(timer)
    if (destroyed) return
    const now = nightClock()
    let wait: number
    if (startAt) wait = Math.max(0, startAt - Date.now())
    else {
      const wants = mod.wantsSleep({ now, enabled: nightSleep.get(), awakeUntil: m.awakeUntil })
      const waiting = (m.state === 'awake' && wants) || ((m.state === 'asleep' || m.state === 'peek') && !wants)
      const untilAwake = m.awakeUntil > now ? m.awakeUntil - now : Infinity
      const untilChange = mod.minutesToChange(mod.minuteOfDay(now)) * 60_000
      wait = waiting ? RETRY_MS : Math.min(untilAwake, untilChange) + 250
    }
    timer = setTimeout(() => {
      startAt = 0
      m.update()
      arm()
    }, Math.min(wait, 2 ** 31 - 1))
  }
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || destroyed) return
    m.update()
    arm()
  }
  document.addEventListener('visibilitychange', onVisible)
  // (capture: a scroll inside any element of the screen counts — scroll events do not bubble)
  const scroller = o.scroller ?? document
  const onScroll = () => m.nudge()
  scroller.addEventListener('scroll', onScroll, { passive: true, capture: true })
  const offSetting = nightSleep.subscribe(() => m.setEnabled(nightSleep.get()))
  arm()

  // Pompon awake (a tap woke him, the morning came): the ear pull and the shake, as everywhere (31.10, ./pomponPlay.ts —
  // its own lazy chunk). Asleep he is not shaken up; a press on his ear then is a tap like any other (it wakes him).
  let detachPlay: (() => void) | null = null
  if (o.kind === 'bunny' && (o.coat ?? 'fawn') === 'fawn') {
    import('./pomponPlay').then((p) => {
      if (destroyed) return
      detachPlay = p.attachPompon({
        box: () => m.rig.puppet.host,
        target: m.rig.hit ?? m.rig.box,
        borrow: () => (m.state !== 'awake' || m.busy || m.rig.driven || m.rig.puppet.busy || external || m.isDestroyed ? null : { puppet: m.rig.puppet as Bunny }),
        still: () => still,
      })
    }, () => undefined)
  }

  let stopWear: (() => void) | null = null
  if (o.wear && o.kind === 'bunny') {
    import('../sammlung/wear').then((w) => {
      if (!destroyed) stopWear = w.wearToday(() => (m.isDestroyed ? null : { root: m.rig.puppet.root, host: m.rig.puppet.host }))
    }, () => undefined)
  }

  return {
    mascot: m,
    id,
    setStill(next) {
      if (destroyed || next === still) return
      still = next
      setMascotIdle(id, !still && !external)
      m.setStill(next)
    },
    setPaused(next) {
      if (destroyed || next === external) return
      external = next
      // hidden, he gives his idle turn to the next mascot (one mascot animates at a time)
      setMascotIdle(id, !still && !external)
      m.setPaused(paused())
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      clearTimeout(timer)
      ro?.disconnect()
      document.removeEventListener('visibilitychange', onVisible)
      scroller.removeEventListener('scroll', onScroll, { capture: true })
      offSetting()
      stopWear?.()
      detachPlay?.()
      unregisterMascot(id)
      m.destroy()
    },
  }
}
