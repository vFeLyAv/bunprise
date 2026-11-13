// «Живые анимации» in the app (Felix 31.10 after the gallery rounds 2–3: «Всё остальное хорошо»; the flop and the
// slump are dropped) — the app's rules around @bunprise/mascot/alive. A lazy chunk: a place loads it with import() once
// a resting mascot stands there (never statically — its chunk would join the preload list of the first screen /soon,
// docs/handoffs/2026-10-31-night-in-app.md).
//   - where: the Lists buddy (one of his brain's deeds, features/lists/ListsBuddy.tsx) and Pompon on the Start corner
//     while he is awake there (./nightMount.ts — by day the corner has no Pompon of its own); the list header's Pompon
//     can join with attachAlive() (features/wishes/listPlay.ts);
//   - the mix (the package's AliveMix): the first ≈ 12 s after the place opens, then every 30–60 s, never the same one
//     twice in a row, the calm ones (loaf, stretch) only after 40 s without a touch; the clock counts only while he
//     can be seen (off screen / the tab hidden: the gap waits, a running moment pauses on its frame);
//   - nothing at all: «Kaninchen zeigen» off, «Animationen: Aus», «Weniger» / battery saver / the system's reduced
//     motion, asleep (the night — the place does not lend a sleeping puppet), while the person types or scrolls (the
//     decoration budget ./budget.ts: ≤ 3 a minute, 8 s quiet after each);
//   - one mascot animates at a time (./stage.ts: a 'decoration' under its own id; any tap, scene or answer of another
//     mascot with a higher class ends it at once);
//   - a press on him ends a moment at once (the rest pose; the place's own answer follows) and counts as a touch;
//   - Pompon in a costume of «Pompons Sammlung» (a held book / sword, the laptop): only the sneeze — the paws stay;
//   - each moment can go back to the gallery by name: playsInApp('alive', '<id>') (./inGallery.ts), all with 'alive'.
// Dev server / demo only: `?alive=fast` (the first after 3 s, then every 9–14 s), `?alive=groom` (only that one, fast),
// `?alive=auto` (as in the app) — read at boot by src/dev/aliveOverride.ts; `__bunpriseAlive('dig')` in the console
// plays one now on the newest place that can be seen.
import type { Bunny, Hamster } from '@bunprise/mascot'
import {
  ALIVE_IDS, ALIVE_MIX, ALIVE_PAWS_FREE, ALIVE_RULES, AliveMix, authorAlive, dressAlive, playAlive, SeenClock, wearsCostume,
  type AliveId, type AliveKind, type AliveRig, type AliveRules, type AliveRun,
} from '@bunprise/mascot/alive'
import { DEMO_MODE } from '../../lib/app'
import { getBunniesShown, getMotionAttr } from '../../ui/motionMode'
import { momentBudget, observeMomentActivity } from './budget'
import { playsInApp } from './inGallery'
import { registerMascot, releaseStage, requestStage, unregisterMascot, type StageMember } from './stage'

/** Not now (the stage, the budget, nothing fits, he was busy): asked again after this (ms of being seen). */
export const ALIVE_RETRY_MS = 4000
/** sessionStorage (dev / demo only): `?alive=` of this tab — 'fast' or one moment's id. */
export const ALIVE_DEV_KEY = 'bunprise.dev.alive'
/** `?alive=fast`: the gallery's check speed. */
export const FAST_RULES: AliveRules = { firstAfterMs: 3000, gapMs: [9000, 14000], calmAfterMs: 5000 }

declare global {
  // dev / demo only: one moment now — `__bunpriseAlive('dig')` in the console (no id: the mix picks)
  var __bunpriseAlive: ((id?: string) => boolean) | undefined
}

/** dev / demo `?alive=` (null: the app's own mix). */
export function devAlive(): { rules: AliveRules; only: AliveId | null } | null {
  // (a build folds both to false and drops the rest)
  if (!(import.meta.env.DEV || DEMO_MODE)) return null
  try {
    const v = window.sessionStorage.getItem(ALIVE_DEV_KEY)
    if (!v) return null
    if (v === 'fast') return { rules: FAST_RULES, only: null }
    return (ALIVE_IDS as readonly string[]).includes(v) ? { rules: FAST_RULES, only: v as AliveId } : null
  } catch {
    return null
  }
}

/** The app's motion level lets living moments play: mascots shown and full motion (not «Weniger», not the system's). */
export function motionAllowsAlive(): boolean {
  if (!getBunniesShown()) return false
  const level = getMotionAttr()
  if (level === 'full') return true
  if (level !== 'auto') return false
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
}

export interface AliveLoan {
  puppet: Bunny | Hamster
  /** the place gets him back */
  giveBack?: () => void
}

export interface AliveLifeOptions {
  kind: AliveKind
  /** what must be seen: his box (off screen / the tab hidden: the mix's clock stops) */
  seen: HTMLElement
  /** the moments of this place (default: all of his kind) */
  moves?: readonly AliveId[]
  /** nothing now: still poses, asleep, hidden or paused by the place */
  quiet(): boolean
  /** where a finger reaches him: a press there ends a moment at once and counts as a touch */
  touch?: HTMLElement | null
  /** seen again / not seen any more */
  onSeen?: (seen: boolean) => void
  rng?: () => number
  /** real time (ms; default performance.now): the seen clock and the quiet rule */
  realNow?: () => number
}

export interface AliveLife {
  /** a moment is due now (and the app's rules would let one start) */
  due(): boolean
  /** plays the due moment on this puppet; null = not now (asked again a little later) */
  play(loan: AliveLoan, quietMs?: number): AliveRun | null
  /** the moment that runs now */
  readonly running: AliveRun | null
  /** the mix's clock: ms he could be seen */
  clock(): number
  readonly seen: boolean
  /** when the next one is due (clock ms) */
  readonly nextAt: number
  /** a touch of him: a running moment ends, the calm ones wait 40 s again */
  touched(): void
  /** not now: ask again after `ms` */
  later(ms: number): void
  /** starts over (he woke up): the next one ≈ 12 s from now */
  restart(): void
  /** (dev) the next ask plays — this one, or the mix's pick */
  force(id?: AliveId): void
  stop(): void
  destroy(): void
}

const rigs = new WeakMap<Bunny | Hamster, AliveRig>()
function rigOf(puppet: Bunny | Hamster): AliveRig {
  let rig = rigs.get(puppet)
  if (!rig) {
    rig = dressAlive(puppet)
    rigs.set(puppet, rig)
  }
  return rig
}

const lives = new Set<{ life: AliveLife; kick: () => boolean }>()

function installDevHook(): void {
  if (!(import.meta.env.DEV || DEMO_MODE) || globalThis.__bunpriseAlive) return
  globalThis.__bunpriseAlive = (id?: string) => {
    const want = id && (ALIVE_IDS as readonly string[]).includes(id) ? (id as AliveId) : undefined
    for (const l of [...lives].reverse()) {
      if (!l.life.seen) continue
      l.life.force(want)
      if (l.kick()) return true
    }
    return false
  }
}

/** One mascot's living moments: the mix, the clock, the app's gates. The place asks (due / play). */
export function createAliveLife(o: AliveLifeOptions): AliveLife {
  const dev = devAlive()
  const rules = dev?.rules ?? ALIVE_RULES
  const realNow = o.realNow ?? (() => performance.now())
  const clock = new SeenClock(o.seen, realNow, (seen) => o.onSeen?.(seen))
  const own = o.moves ?? ALIVE_MIX.filter((m) => m.kind === o.kind).map((m) => m.id)
  const mix = new AliveMix({ kind: o.kind, now: clock.now(), allowed: dev?.only ? [dev.only] : own, rules, ...(o.rng ? { rng: o.rng } : {}), ...(dev?.only ? { repeat: true } : {}) })
  const sid = Symbol('alive')
  let run: AliveRun | null = null
  let lastTouch = realNow()
  let forced: AliveId | 'any' | null = null
  let destroyed = false
  const stopActivity = observeMomentActivity()
  const member: StageMember = {
    get busy() {
      return run !== null
    },
    get isDestroyed() {
      return destroyed
    },
    stopIdle: () => undefined,
    startIdle: () => undefined,
    // a tap, a scene or an answer of another mascot: the moment ends at once (the rest pose)
    interrupt: () => run?.stop(),
  }

  const gatesOpen = () => !destroyed && !o.quiet() && motionAllowsAlive() && playsInApp('alive')

  const allowedFor = (puppet: Bunny | Hamster): AliveId[] => {
    const base = forced && forced !== 'any' ? [forced] : own
    return base.filter((id) => playsInApp('alive', id) && (!(o.kind === 'bunny' && wearsCostume(puppet.root)) || ALIVE_PAWS_FREE.includes(id)))
  }

  const onDown = () => life.touched()
  o.touch?.addEventListener('pointerdown', onDown, { capture: true })

  const life: AliveLife = {
    due: () => gatesOpen() && clock.seen && run === null && (forced !== null || mix.due(clock.now())),
    play(loan, quietMs) {
      if (!life.due() || loan.puppet.isDestroyed) return null
      const now = clock.now()
      const quiet = forced ? Infinity : (quietMs ?? realNow() - lastTouch)
      const allowed = allowedFor(loan.puppet)
      const pickAt = forced ? Math.max(now, mix.nextAt) : now
      const id = forced && forced !== 'any' && allowed.includes(forced) ? forced : mix.pick(pickAt, quiet, allowed)
      if (!id) {
        mix.later(now, ALIVE_RETRY_MS)
        forced = null
        return null
      }
      // one mascot at a time, then the decoration budget (not while typing / scrolling, ≤ 3 a minute)
      registerMascot(sid, member, false)
      if (!requestStage(sid, 'decoration')) {
        unregisterMascot(sid)
        mix.later(now, ALIVE_RETRY_MS)
        return null
      }
      if (!forced && !momentBudget.claim('decoration')) {
        releaseStage(sid)
        unregisterMascot(sid)
        mix.later(now, ALIVE_RETRY_MS)
        return null
      }
      forced = null
      const rig = rigOf(loan.puppet)
      const started = playAlive(rig, authorAlive(id, rig), {
        onEnd: () => {
          run = null
          momentBudget.end()
          mix.played(id, clock.now())
          releaseStage(sid)
          unregisterMascot(sid)
          loan.giveBack?.()
        },
      })
      run = started
      return started
    },
    get running() {
      return run
    },
    clock: () => clock.now(),
    get seen() {
      return clock.seen
    },
    get nextAt() {
      return mix.nextAt
    },
    touched() {
      lastTouch = realNow()
      run?.stop()
    },
    later(ms) {
      mix.later(clock.now(), ms)
    },
    restart() {
      mix.restart(clock.now())
    },
    force(id) {
      forced = id ?? 'any'
    },
    stop() {
      run?.stop()
    },
    destroy() {
      if (destroyed) return
      run?.stop()
      destroyed = true
      o.touch?.removeEventListener('pointerdown', onDown, { capture: true })
      clock.destroy()
      stopActivity()
      unregisterMascot(sid)
    },
  }
  return life
}

export interface AliveHost extends AliveLifeOptions {
  /** his puppet for a moment right now — null = not now (asleep, mid-scene, busy) */
  borrow(): AliveLoan | null
}

/** While the place says "nothing now" (asleep, still poses, hidden), it is asked again only this often (ms seen). */
export const ALIVE_QUIET_RETRY_MS = 15_000

export interface AliveAttachment {
  /** the moment that runs now */
  readonly running: AliveRun | null
  /** starts over (he woke up): the next one ≈ 12 s from now */
  restart(): void
  /** the end: a running moment ends (the rest pose), no timer is left */
  stop(): void
}

/**
 * A place whose mascot simply rests (the Start corner, the list header): the moments come by themselves. One timer,
 * armed only while he can be seen.
 */
export function attachAlive(h: AliveHost): AliveAttachment {
  let timer: ReturnType<typeof setTimeout> | undefined
  let gone = false
  // (the clock reports "seen" while it is being made: nothing to arm before the life exists)
  let ready = false
  const arm = (): void => {
    clearTimeout(timer)
    if (gone || !ready || !life.seen || life.running) return
    timer = setTimeout(tick, Math.max(250, life.nextAt - life.clock()))
  }
  const tryNow = (): boolean => {
    if (gone || life.running || !life.due()) return false
    const loan = h.borrow()
    if (!loan) return false
    const run = life.play(loan)
    if (!run) {
      loan.giveBack?.()
      return false
    }
    void run.done.then(arm)
    return true
  }
  const tick = (): void => {
    if (gone || tryNow() || life.running) return
    // overdue but not now: the place said "nothing now" (asleep, still) → ask rarely; else (busy, the stage) soon
    if (life.clock() >= life.nextAt) life.later(h.quiet() ? ALIVE_QUIET_RETRY_MS : ALIVE_RETRY_MS)
    arm()
  }
  const life = createAliveLife({
    ...h,
    onSeen: (seen) => {
      h.onSeen?.(seen)
      if (seen) arm()
      else clearTimeout(timer)
    },
  })
  ready = true
  const entry = { life, kick: tryNow }
  lives.add(entry)
  installDevHook()
  arm()
  return {
    get running() {
      return life.running
    },
    restart() {
      life.restart()
      arm()
    },
    stop() {
      if (gone) return
      gone = true
      clearTimeout(timer)
      lives.delete(entry)
      life.destroy()
    },
  }
}

/** The Lists buddy's living moments (his brain asks `due`, he lends his puppet to `play`). */
export function buddyAlive(o: AliveLifeOptions): { alive: { due(): boolean; play(puppet: Bunny | Hamster, ctx: { quietMs: number }): AliveRun | null }; destroy(): void } {
  const life = createAliveLife(o)
  // (dev) the buddy plays it as his very next deed
  const entry = { life, kick: () => true }
  lives.add(entry)
  installDevHook()
  return {
    alive: {
      due: () => life.due(),
      play: (puppet, ctx) => life.play({ puppet }, ctx.quietMs),
    },
    destroy: () => {
      lives.delete(entry)
      life.destroy()
    },
  }
}

/** Tests only. */
export function resetAliveLives(): void {
  for (const l of lives) l.life.destroy()
  lives.clear()
}
