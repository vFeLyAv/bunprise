// «Потянуть за ушко» and «Встряхнуть телефон» on EVERY Pompon of the app (Felix 31.10: «везде, где есть Помпон»;
// approved in the gallery ?screens=listplay, docs/design/2026-10-31-list-play.md §9–10) — a lazy chunk, loaded by a
// place only once a Pompon puppet stands there (Mascot.tsx: the new-wish peek and every other fawn bunny, nightMount.ts:
// the Start corner / Lists sleeper once awake, lists/ListsBuddy.tsx: the buddy, wishes/listPlay.ts: the list header).
//   - the ear: a press on an ear tip (beside his head) and a pull — "ай" > <, the ear follows the finger with soft
//     limits, springs back, a giggle and a little shake (@bunprise/mascot/listplay). Anywhere else on him the place's
//     own answer stays (a tap, a drag). Haptics: one 'tap' (lib/haptics only);
//   - the shake: ONE devicemotion listener for the whole app (≈ 1.4 g, three peaks within 0.7 s, at most every 10 s —
//     the package's rule); only the newest Pompon that is on screen and gets the stage answers (dizzy, no haptics). On
//     an iPhone the motion events come only after «Bewegung erlauben» (Einstellungen → Bewegung,
//     motion/MotionSettingsSection.tsx); a desktop has no sensor (dev / demo: `__bunpriseShake()` in the console);
//   - one mascot animates at a time (./stage.ts: a moment here asks for the stage as a 'response' under its own id);
//     paused while off screen / the tab is hidden (the package's Watch); still poses («Weniger», battery saver, the
//     system) or no mascots («Kaninchen zeigen» off, «Aus»): nothing — the place does not even mount a Pompon then.
// Nothing here knows anything about wishes or reservations: it only sees a puppet and a finger.
import type { Bunny } from '@bunprise/mascot'
import {
  authorDizzy, authorGrab, authorRelease, createShakeDetector, dressPompon, earFollow, earTipAt, Player, poseAt, unitOf, Watch,
  type Ctx, type Dress, type Haptic, type Pose, type Shot, type Side,
} from '@bunprise/mascot/listplay'
import { DEMO_MODE } from '../../lib/app'
import { haptic } from '../../lib/haptics'
import { playsInApp } from './inGallery'
import { registerMascot, releaseStage, requestStage, unregisterMascot, type StageMember } from './stage'

// ---------------------------------------------------------------------------------------------------- the shake

export interface ShakeTarget {
  /** on screen right now (and awake: a sleeping Pompon is not shaken up) */
  visible(): boolean
  /** plays the dizzy moment; false = could not (busy, still poses, the stage refused) */
  shake(): boolean
}

const targets: ShakeTarget[] = []
let stopListening: (() => void) | null = null

declare global {
  // dev / demo only: a shake without a sensor (the desktop browser) — `__bunpriseShake()` in the console
  var __bunpriseShake: (() => boolean) | undefined
}

/** The phone was shaken: the newest Pompon that is on screen and gets the stage turns dizzy. True = one did. */
export function shaken(): boolean {
  if (typeof document !== 'undefined' && document.hidden) return false
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i]
    if (t?.visible() && t.shake()) return true
  }
  return false
}

function listen(): void {
  if (stopListening || typeof window === 'undefined') return
  if (import.meta.env.DEV || DEMO_MODE) globalThis.__bunpriseShake = shaken
  // a phone or a tablet (a desktop browser only warns about a sensor it does not have)
  if (typeof DeviceMotionEvent === 'undefined' || !(navigator.maxTouchPoints > 0)) {
    stopListening = () => undefined
    return
  }
  const detector = createShakeDetector()
  const onMotion = (e: DeviceMotionEvent) => {
    if (detector.feed(e, performance.now())) shaken()
  }
  window.addEventListener('devicemotion', onMotion)
  stopListening = () => window.removeEventListener('devicemotion', onMotion)
}

/** A Pompon on a screen answers the shake (until the returned stop). The listener lives while one is there. */
export function onShake(target: ShakeTarget): () => void {
  targets.push(target)
  listen()
  return () => {
    const i = targets.indexOf(target)
    if (i >= 0) targets.splice(i, 1)
    if (targets.length === 0 && stopListening) {
      stopListening()
      stopListening = null
    }
  }
}

/** Tests only. */
export function resetShakeTargets(): void {
  targets.length = 0
  stopListening?.()
  stopListening = null
}

// ---------------------------------------------------------------------------------------------------- a Pompon of a place

export interface PomponLoan {
  puppet: Bunny
  /** the place gets him back (the Lists buddy goes on with his own life) */
  giveBack?: () => void
}

export interface PomponHost {
  /** the puppet's own box (the Bunny's host element: 400 × 260 viewBox, his feet at 246) — his geometry */
  box(): HTMLElement | null
  /** where a finger reaches him (pointer events): his host box, the night hit box, the buddy's body */
  target: HTMLElement
  /** the puppet for a moment right now — null = not now (asleep, mid-scene, the buddy busy) */
  borrow(): PomponLoan | null
  /** still poses («Weniger», battery saver, the system): no ear pull, no dizzy */
  still(): boolean
  /**
   * The place lets no touch through to him (pointer-events: none — the new-wish peek must never take a tap from the link
   * capsule under him): two small ear targets (44 × 44 px, over his ear tips, above his feet) go next to him into
   * `target`'s positioned parent. Only they catch a finger.
   */
  earTargets?: boolean
}

/** The ear targets' place next to a Pompon of `w` px (his host's top left = 0, 0): centred on each ear tip. */
export function earTargetAt(w: number, side: -1 | 1): { left: number; top: number } {
  const k = w / 96
  return { left: w / 2 + side * 22 * k - 22, top: (246 * w) / 400 - 38 * k - 22 }
}

/** On screen (between the edges of the viewport), drawn, the tab visible. */
export function onScreen(el: Element): boolean {
  if (!el.isConnected || (typeof document !== 'undefined' && document.hidden)) return false
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  if (r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) return false
  return typeof getComputedStyle !== 'function' || getComputedStyle(el).visibility !== 'hidden'
}

const hapticOf = (kind: Haptic) => haptic(kind)

interface Run {
  shot: Shot
  player: Player
  watch: Watch
}

/**
 * The ear pull and the dizzy shake on a Pompon a place already shows. Returns the stop (the place's puppet stays as
 * it was: the rig's parts go out of it again).
 */
export function attachPompon(h: PomponHost): () => void {
  let dress: Dress | null = null
  let dressed: Bunny | null = null
  let loan: PomponLoan | null = null
  let run: Run | null = null
  let pose: Pose = {}
  let grab: { side: Side; pointer: number; unit: number; el: HTMLElement } | null = null
  let restoreIdle = false
  let detached = false
  const id = Symbol('pompon-play')
  const state = { busy: false }
  const member: StageMember = {
    get busy() {
      return state.busy
    },
    get isDestroyed() {
      return detached
    },
    stopIdle: () => undefined,
    startIdle: () => undefined,
    // a 'work' moment of another mascot needs the stage: his moment jumps to its end
    interrupt: () => finish(),
  }

  const dressOf = (p: Bunny): Dress => {
    if (dressed !== p || !dress) {
      dress?.undress()
      dress = dressPompon(p)
      dressed = p
    }
    return dress
  }
  const ctxOf = (d: Dress): Ctx => ({ rig: d, seat: { x: 0, y: 0 }, ghost: false, haptic: hapticOf })

  /** The stage first (one mascot animates at a time), then the place lends him. */
  function claim(): Dress | null {
    if (detached || state.busy || h.still()) return null
    registerMascot(id, member, false)
    if (!requestStage(id, 'response')) {
      unregisterMascot(id)
      return null
    }
    const l = h.borrow()
    if (!l || l.puppet.isDestroyed) {
      releaseStage(id)
      unregisterMascot(id)
      return null
    }
    state.busy = true
    loan = l
    restoreIdle = l.puppet.idleRunning
    const d = dressOf(l.puppet)
    d.takeOver()
    pose = {}
    return d
  }

  function start(shot: Shot): void {
    const host = loan?.puppet.host
    if (!host) return
    const player = new Player(host, shot.tracks, shot.duration, shot.marks, () => ended(shot))
    const watch = new Watch(host, player)
    run = { shot, player, watch }
    watch.start()
  }

  function stopRun(): void {
    const r = run
    run = null
    if (!r) return
    r.watch.destroy()
    r.player.destroy()
  }

  function ended(shot: Shot): void {
    if (!run || run.shot !== shot) return
    dress?.apply(shot.end)
    stopRun()
    // the finger still holds the ear: he stays driven, the "ай" face stays
    if (shot.name === 'grab') {
      const end = { ...shot.end }
      delete end.box
      pose = { ...pose, ...end }
      return
    }
    finish()
  }

  /** The moment is over (or cut short): the puppet is the place's own again, exactly as before. */
  function finish(): void {
    stopRun()
    if (grab) endListeners()
    grab = null
    pose = {}
    if (!state.busy) return
    dress?.release(undefined, restoreIdle && !h.still())
    const l = loan
    loan = null
    state.busy = false
    releaseStage(id)
    unregisterMascot(id)
    l?.giveBack?.()
  }

  const currentPose = (): Pose => (run ? poseAt(run.shot, run.player.time, pose) : { ...pose })

  // ---- the ear
  const feetOf = (): { feet: { x: number; y: number }; unit: number } | null => {
    const b = h.box()
    if (!b) return null
    const r = b.getBoundingClientRect()
    if (!(r.width > 0)) return null
    return { feet: { x: r.left + r.width / 2, y: r.top + (246 * r.width) / 400 }, unit: unitOf(r.width) }
  }

  let eatClickUntil = 0
  const onClick = (e: MouseEvent) => {
    // the release of an ear pull is no tap of the place (no hop, no wake-up)
    if (performance.now() < eatClickUntil) {
      e.stopImmediatePropagation()
      e.stopPropagation()
      e.preventDefault()
    }
  }

  const onDown = (e: PointerEvent) => {
    if (detached || state.busy || (e.pointerType === 'mouse' && e.button !== 0) || !playsInApp('list-ear')) return
    const geo = feetOf()
    if (!geo) return
    const side = earTipAt(e.clientX - geo.feet.x, e.clientY - geo.feet.y, geo.unit)
    if (!side) return
    const d = claim()
    if (!d) return
    // his ear: not the place's own tap / drag
    e.stopImmediatePropagation()
    e.stopPropagation()
    eatClickUntil = performance.now() + 1500
    const capture = e.currentTarget instanceof HTMLElement ? e.currentTarget : h.target
    try {
      capture.setPointerCapture(e.pointerId)
    } catch {
      /* no capture (a synthetic event) */
    }
    grab = { side, pointer: e.pointerId, unit: geo.unit, el: capture }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    start(authorGrab(ctxOf(d), {}, side))
    follow(e)
  }

  function follow(e: PointerEvent): void {
    const g = grab
    const geo = feetOf()
    if (!g || !geo || !dress) return
    const { pose: ear, slip } = earFollow(g.side, { x: e.clientX, y: e.clientY }, geo.feet, g.unit)
    const part = g.side === 'r' ? 'earR' : 'earL'
    dress.apply({ [part]: ear })
    pose = { ...pose, [part]: ear }
    if (slip) {
      // pulled too far: the ear slips out by itself
      haptic('tap')
      letGo()
    }
  }

  const onMove = (e: PointerEvent) => {
    if (grab && e.pointerId === grab.pointer) follow(e)
  }
  const onUp = (e: PointerEvent) => {
    if (grab && e.pointerId === grab.pointer) letGo()
  }

  function endListeners(): void {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  /** The finger let go (or the ear slipped out): it springs back from the pose on screen. */
  function letGo(): void {
    const g = grab
    if (!g || !dress) return
    grab = null
    endListeners()
    try {
      g.el.releasePointerCapture(g.pointer)
    } catch {
      /* already released */
    }
    eatClickUntil = performance.now() + 400
    const from = currentPose()
    stopRun()
    dress.apply(from)
    pose = from
    start(authorRelease(ctxOf(dress), from, g.side))
  }

  // ---- the shake
  const offShake = onShake({
    visible: () => {
      const b = h.box()
      return !!b && onScreen(b)
    },
    shake: () => {
      if (!playsInApp('shake')) return false
      const d = claim()
      if (!d) return false
      start(authorDizzy(ctxOf(d), {}))
      return true
    },
  })

  // where a finger reaches him: the place's own target, or (earTargets) two small ones over his ear tips
  const targets: HTMLElement[] = []
  let ro: ResizeObserver | null = null
  const parent = h.target.parentElement
  if (h.earTargets && parent && typeof getComputedStyle === 'function' && getComputedStyle(parent).position !== 'static') {
    const ears = ([-1, 1] as const).map((side) => {
      const d = document.createElement('div')
      d.className = 'pp-ear'
      d.setAttribute('aria-hidden', 'true')
      d.setAttribute('data-drag-own', '')
      d.style.cssText = 'position:absolute;width:44px;height:44px;pointer-events:auto;touch-action:pan-y;-webkit-tap-highlight-color:transparent;'
      parent.append(d)
      targets.push(d)
      return { d, side }
    })
    const place = () => {
      const b = h.box()?.getBoundingClientRect()
      const p = parent.getBoundingClientRect()
      if (!b || !(b.width > 0)) return
      for (const { d, side } of ears) {
        const at = earTargetAt(b.width, side)
        d.style.left = `${Math.round(b.left - p.left - parent.clientLeft + at.left)}px`
        d.style.top = `${Math.round(b.top - p.top - parent.clientTop + at.top)}px`
      }
    }
    place()
    ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
    ro?.observe(h.target)
  } else if (!h.earTargets) targets.push(h.target)
  for (const t of targets) {
    t.addEventListener('pointerdown', onDown, { capture: true })
    t.addEventListener('click', onClick, { capture: true })
  }

  return () => {
    if (detached) return
    finish()
    detached = true
    offShake()
    ro?.disconnect()
    for (const t of targets) {
      t.removeEventListener('pointerdown', onDown, { capture: true })
      t.removeEventListener('click', onClick, { capture: true })
      if (t !== h.target) t.remove()
    }
    dress?.undress()
    dress = null
  }
}
