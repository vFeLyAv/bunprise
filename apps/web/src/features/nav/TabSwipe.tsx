import { useEffect, useRef } from 'react'
import { useRouter, type RegisteredRouter } from '@tanstack/react-router'
import { haptic } from '../../ui/haptics'
import { useLayerRoot } from '../../ui/layers'
import { fade, useReducedMotionPref } from '../../ui/motion'
import { getMotionAttr } from '../../ui/motionMode'
import { lastStartView, whenIdle } from '../feed/session'
import { releaseVelocity, type MoveSample } from './edgeSwipe'
import { screenParts } from './ghost'
import { appRootElement } from './scroller'
import { settleTo } from './settle'
import { setTabDrag } from './tabDrag'
import { captureTab, tabLayer } from './tabCopies'
import { TABS, tabForPath, type TabId } from './tabs'
import {
  calmDim,
  DRAG_OWN_SELECTOR,
  inEdgeGuard,
  inOwnZone,
  lockAxis,
  modalOpen,
  neighbours,
  ownBoxes,
  ownsHorizontal,
  pageOffset,
  pillPoses,
  progressOf,
  rawFromOffset,
  releaseStep,
  textSelected,
  towards,
  type Neighbours,
} from './tabSwipeRules'
import './tabSwipe.css'

// Swipe between the main tabs (Felix 2026-10-26), a lazy chunk the signed-in layout loads once the first screen is
// idle. Like a pager: on Start · Listen · Ideen · Profil a sideways finger moves the page 1:1, the neighbour tab
// (the copy of its last look, tabCopies.ts, or a skeleton) slides in beside it and the tab bar's pill follows
// (tabDrag.ts); past the first and the last tab a rubber band. On release distance or speed decide (tabSwipeRules.ts);
// the finish is the smooth spring carrying the finger's speed, and the router switches to the tab once the page
// has arrived (a push, like a tap on the bar: same history, same scroll rules, no view transition). A new touch
// catches the moving page. Haptic 'select' when a switch commits.
// Reduced motion: the page does not slide — it dims a little while the finger pulls, a committed swipe switches at
// once and the new screen fades in (instant under the level 'off').
// Vertical scrolling stays the browser's: the tab screens get `touch-action: pan-y pinch-zoom` (tabSwipe.css) and a
// touch whose first move is steeper than the swipe cone never becomes a swipe (tabSwipeRules.ts lockAxis, decided
// once). The other way round, a touch that IS a swipe is never scrolled as well: from the moment it is decided its
// touchmoves are cancelled (WebKit would scroll the vertical part of a diagonal move — the page shook).
// v2 (Felix 26.10): the deck zone is never a handle for the page, not even to catch it mid-spring; the neighbour
// copy is placed only on the side it is pulled to; the neighbours' code loads when the tab is idle, not in the
// first frame of a drag; the page stops exactly at its place (no overshoot).

type Router = RegisteredRouter

interface Gesture {
  pointerId: number
  /** where the finger went down (client px) */
  downX: number
  /** where the page's travel counts from (the down point, then the point the swipe was decided at) */
  startX: number
  startY: number
  /** visual px per CSS px (the dev phone frame is zoomed) */
  scale: number
  state: 'pending' | 'dragging'
  /** where the touch went down: checked once the direction is clear (a tap stays cheap) */
  target: Element | null
  /** finger travel already in the page when this touch began (a catch mid-spring) */
  base: number
  raw: number
  offset: number
  samples: MoveSample[]
}

interface Scene {
  appRoot: HTMLElement
  width: number
  from: TabId
  n: Neighbours
  parts: HTMLElement[]
  /** the parts' own inline transform and opacity, given back at the end */
  saved: Array<[string, string]>
  prev: HTMLElement | null
  next: HTMLElement | null
  calm: boolean
  preloaded: Set<TabId>
}

interface Reads {
  tab: () => TabId | null
  calm: () => boolean
}

export interface TabSwipeControl {
  /** the screen changed (the layout's tab): a running gesture of the old screen ends */
  tabChanged: () => void
  dispose: () => void
}

function setX(el: HTMLElement, x: number): void {
  el.style.transform = `translate3d(${x}px, 0, 0)`
}

const FADE = { duration: fade.duration * 1000, easing: `cubic-bezier(${fade.ease.join(', ')})` }

function fadeOpacity(el: HTMLElement, from: string, to: string): void {
  if (typeof el.animate === 'function') el.animate([{ opacity: from }, { opacity: to }], FADE)
}

/** A click right after a tiny drag (or any mouse drag) is not a tap on what lay under the finger. */
function swallowNextClick(): void {
  const swallow = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400)
}

export function startTabSwipe(router: Router, layerRoot: HTMLElement, read: Reads, mouse: boolean): TabSwipeControl {
  let gesture: Gesture | null = null
  let scene: Scene | null = null
  let stopSettle: (() => void) | null = null
  let landing = false
  let listening = false
  let disposed = false
  /** the page's offset on screen right now (px) */
  let shown = 0

  const appRoot = () => appRootElement(layerRoot)

  function listen(on: boolean): void {
    if (on === listening) return
    listening = on
    if (on) {
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerup', onUp, { passive: true })
      window.addEventListener('pointercancel', onUp, { passive: true })
    } else {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }

  function drop(): void {
    gesture = null
    listen(false)
  }

  function onDown(event: PointerEvent): void {
    if (!read.tab() || landing || gesture || !event.isPrimary || event.button !== 0) return
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen' && !mouse) return
    const root = appRoot()
    if (!root) return
    const box = root.getBoundingClientRect()
    const layout = root.offsetWidth || root.clientWidth || window.innerWidth
    const visual = box.width || layout
    const fresh: Gesture = {
      pointerId: event.pointerId,
      downX: event.clientX,
      startX: event.clientX,
      startY: event.clientY,
      scale: visual / layout || 1,
      state: 'pending',
      target: event.target instanceof Element ? event.target : null,
      base: 0,
      raw: 0,
      offset: 0,
      samples: [],
    }
    if (inEdgeGuard(event.clientX, box.left, visual)) return
    if (scene && stopSettle) {
      // the tab bar, an open layer and the buddy stay theirs while the page springs (<html> carries data-tabbar too)
      if (fresh.target?.closest(`nav[data-tabbar], [aria-modal="true"], ${DRAG_OWN_SELECTOR}`)) return
      // a finger on the deck — of the moving page or of the neighbour sliding in — is meant for a card, never a
      // handle for the page: the spring finishes (Felix 26.10 «случайно перелистнуться»)
      if (inOwnZone(event.clientX, event.clientY, ownBoxes([...scene.parts, scene.prev, scene.next]))) return
      // a touch catches the moving page: it follows this finger from where it is now
      stopSettle()
      stopSettle = null
      const raw = rawFromOffset(shown, scene.width, scene.n)
      gesture = { ...fresh, state: 'dragging', base: raw, raw, offset: shown, samples: [{ t: event.timeStamp, x: raw }] }
      listen(true)
      return
    }
    gesture = fresh
    listen(true)
  }

  function onMove(event: PointerEvent): void {
    const g = gesture
    if (!g || event.pointerId !== g.pointerId) return
    const dx = (event.clientX - g.startX) / g.scale
    if (g.state === 'pending') {
      // decided once, here, and kept for the whole touch
      const axis = lockAxis(dx, (event.clientY - g.startY) / g.scale)
      if (axis === 'pending') return
      if (axis === 'scroll' || !mayStart(g) || !begin()) {
        drop()
        return
      }
      g.state = 'dragging'
      // count from here: the page does not jump by the slop
      g.startX = event.clientX
      g.samples = [{ t: event.timeStamp, x: 0 }]
      if (mouse) document.getSelection?.()?.removeAllRanges()
      return
    }
    const s = scene
    if (!s) return
    g.raw = g.base + dx
    g.offset = pageOffset(g.raw, s.width, s.n)
    // every finger sample since the last frame (the browser hands one pointermove per frame): on a busy phone a
    // flick keeps its real speed instead of looking like a finger that stopped
    const points = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
    for (const point of points.length > 0 ? points : [event]) g.samples.push({ t: point.timeStamp, x: g.base + (point.clientX - g.startX) / g.scale })
    if (g.samples.length > 24) g.samples.splice(0, g.samples.length - 24)
    render(s, g.offset)
  }

  function onUp(event: PointerEvent): void {
    const g = gesture
    if (!g || event.pointerId !== g.pointerId) return
    drop()
    const s = scene
    if (g.state !== 'dragging' || !s) return
    if (mouse || Math.abs(g.raw - g.base) < 8) swallowNextClick()
    // the browser took the touch (a pinch, the system): back to rest
    if (event.type === 'pointercancel') return finish(s, 0, 0)
    // the release itself is a sample: a finger that stopped and then lifts is no flick
    g.samples.push({ t: event.timeStamp, x: g.raw })
    const velocity = releaseVelocity(g.samples)
    finish(s, releaseStep(g.offset, velocity, s.width, s.n), velocity)
  }

  /**
   * Is the touch the page's? (checked once it is clearly sideways): it started on the screen, not on something with
   * its own sideways gesture (nor within OWN_MARGIN_PX of the deck / the month grid), no sheet open, no selection.
   */
  function mayStart(g: Gesture): boolean {
    const root = appRoot()
    const target = g.target
    if (!root || !target) return false
    const parts = screenParts(root)
    if (!parts.some((part) => part.contains(target))) return false
    if (ownsHorizontal(target, root) || inOwnZone(g.downX, g.startY, ownBoxes(parts))) return false
    return !modalOpen(document) && !textSelected(document)
  }

  function begin(): boolean {
    const root = appRoot()
    const from = read.tab()
    if (!root || !from) return false
    const parts = screenParts(root)
    if (parts.length === 0) return false
    scene = {
      appRoot: root,
      width: root.clientWidth || window.innerWidth,
      from,
      n: neighbours(from),
      parts,
      saved: parts.map((part) => [part.style.transform, part.style.opacity]),
      prev: null,
      next: null,
      calm: read.calm(),
      preloaded: new Set(),
    }
    document.documentElement.setAttribute('data-tab-swiping', '')
    render(scene, 0)
    return true
  }

  /**
   * The neighbour on the side the page is pulled to, the first time it is needed (half the work in the first frame
   * of a drag). It lies before the screen's own parts (never over it: side by side).
   */
  function place(s: Scene, side: 'prev' | 'next'): void {
    const tab = s.n[side]
    if (s.calm || s[side] || !tab) return
    const node = tabLayer(tab)
    s.appRoot.insertBefore(node, s.appRoot.firstChild)
    s[side] = node
  }

  function render(s: Scene, offset: number): void {
    shown = offset
    const to = towards(offset, s.n)
    if (s.calm) {
      // dims only toward a tab that is there (past the first and the last tab nothing answers)
      const opacity = String(1 - (to ? calmDim(offset, s.width) : 0))
      for (const part of s.parts) part.style.opacity = opacity
    } else {
      if (offset > 0) place(s, 'prev')
      else if (offset < 0) place(s, 'next')
      for (const part of s.parts) setX(part, offset)
      if (s.prev) setX(s.prev, offset - s.width)
      if (s.next) setX(s.next, offset + s.width)
    }
    setTabDrag(to ? pillPoses(s.from, to, progressOf(offset, s.width)) : null)
    // the neighbour's code and data start loading as soon as it peeks in: it renders at once on arrival
    if (to && !s.preloaded.has(to)) {
      s.preloaded.add(to)
      const def = TABS.find((item) => item.id === to)
      if (def) void router.preloadRoute({ to: def.to }).catch(() => undefined)
    }
  }

  function finish(s: Scene, step: -1 | 0 | 1, velocity: number): void {
    const target = step === 1 ? s.n.next : step === -1 ? s.n.prev : null
    if (target) haptic('select')
    if (s.calm) {
      if (target) land(s, target)
      else calmBack(s)
      return
    }
    // a rubber band springs back without the finger's speed (it would overshoot the edge); the page stops exactly
    // at its place (clamp: no swing past it)
    const speed = towards(shown, s.n) ? velocity : 0
    stopSettle = settleTo(shown, target ? -step * s.width : 0, speed, false, (x) => render(s, x), () => {
      stopSettle = null
      if (target) land(s, target)
      else teardown()
    }, true)
  }

  /** The page has arrived: switch the route; the copy stays until the real screen is rendered in its place. */
  function land(s: Scene, target: TabId): void {
    landing = true
    setTabDrag(pillPoses(s.from, target, 1))
    let done = false
    const arrived = () => {
      if (done) return
      done = true
      stopRendered()
      clearTimeout(timer)
      if (disposed) return
      teardown()
      if (s.calm && getMotionAttr() !== 'off') for (const part of screenParts(s.appRoot)) fadeOpacity(part, '0', '1')
    }
    const stopRendered = router.subscribe('onRendered', arrived)
    // a safety net only (the neighbour was preloaded while it peeked in): a slow chunk keeps the copy in place
    const timer = setTimeout(arrived, 5000)
    const def = TABS.find((item) => item.id === target)
    if (!def) return arrived()
    // the gesture already was the animation: no crossfade on top of it
    const go =
      def.id === 'start' && lastStartView() === 'month'
        ? router.navigate({ to: '/soon', search: { view: 'month' }, viewTransition: false })
        : router.navigate({ to: def.to, viewTransition: false })
    void go.catch(arrived)
  }

  /** Reduced motion, not far enough: the page brightens again (a short fade; instant under 'off'). */
  function calmBack(s: Scene): void {
    const from = s.parts.map((part) => part.style.opacity || '1')
    teardown()
    if (getMotionAttr() === 'off') return
    s.parts.forEach((part, index) => fadeOpacity(part, from[index] ?? '1', '1'))
  }

  function teardown(): void {
    stopSettle?.()
    stopSettle = null
    drop()
    landing = false
    shown = 0
    const s = scene
    scene = null
    document.documentElement.removeAttribute('data-tab-swiping')
    setTabDrag(null)
    if (!s) return
    s.parts.forEach((part, index) => {
      const [transform, opacity] = s.saved[index] ?? ['', '']
      part.style.transform = transform
      part.style.opacity = opacity
    })
    s.prev?.remove()
    s.next?.remove()
  }

  /**
   * Once the page follows the finger, the browser must not scroll it as well: the touchmove is cancelled. (Chromium
   * already keeps a pan-y page still for a sideways touch; WebKit scrolls the vertical part of a diagonal move.)
   * The listener sits on the app root for as long as a tab screen is shown — one added at touchstart would come too
   * late, the browser decides then whether it waits for the page. It is a flag check: the browser waits for it only
   * at the first move of a touch.
   */
  function onTouchMove(event: TouchEvent): void {
    if (gesture?.state === 'dragging' && event.cancelable) event.preventDefault()
  }
  let guarded: HTMLElement | null = null
  function guard(on: boolean): void {
    const root = on ? appRoot() : null
    if (root === guarded) return
    guarded?.removeEventListener('touchmove', onTouchMove)
    guarded = root
    guarded?.addEventListener('touchmove', onTouchMove, { passive: false })
  }

  // a copy of every tab screen that is left (its DOM is still the old screen while the history notifies)
  const stopHistory = router.history.subscribe(({ location }) => {
    const tab = read.tab()
    const root = appRoot()
    if (!tab || !root || tabForPath(location.pathname) === tab) return
    try {
      captureTab(tab, root)
    } catch {
      /* a copy is a nicety: without it the neighbour slides in as a skeleton */
    }
  })
  document.addEventListener('pointerdown', onDown, { capture: true, passive: true })
  guard(read.tab() !== null)

  return {
    tabChanged: () => {
      guard(read.tab() !== null)
      if (!landing) teardown()
    },
    dispose: () => {
      disposed = true
      stopHistory()
      document.removeEventListener('pointerdown', onDown, { capture: true })
      guard(false)
      teardown()
    },
  }
}

/**
 * The neighbours' code (their route chunks) loads while the tab is idle — not in the first frame of a drag, where
 * parsing a screen's chunk froze the page for a moment (measured 26.10). Their data still loads when they peek in.
 */
function preloadNeighbourCode(router: Router, tab: TabId): void {
  const n = neighbours(tab)
  for (const id of [n.prev, n.next]) {
    const def = TABS.find((item) => item.id === id)
    const route = def ? router.routesByPath[def.to] : undefined
    if (route) void Promise.resolve(router.loadRouteChunk(route)).catch(() => undefined)
  }
}

/** Dev only: inside the desktop phone frame the mouse may swipe too (production: fingers and pens). */
function mouseAllowed(layerRoot: HTMLElement): boolean {
  return import.meta.env.DEV && typeof document !== 'undefined' && layerRoot !== document.body
}

export default function TabSwipe({ tab }: { tab: TabId | null }) {
  const router = useRouter()
  const layerRoot = useLayerRoot()
  const reduced = useReducedMotionPref()
  const tabRef = useRef(tab)
  const calmRef = useRef(reduced)
  const control = useRef<TabSwipeControl | null>(null)

  useEffect(() => {
    calmRef.current = reduced
  }, [reduced])

  useEffect(() => {
    if (!layerRoot) return
    const c = startTabSwipe(router, layerRoot, { tab: () => tabRef.current, calm: () => calmRef.current }, mouseAllowed(layerRoot))
    control.current = c
    return () => {
      c.dispose()
      control.current = null
    }
  }, [router, layerRoot])

  // the tab screens let a sideways move reach the gesture (tabSwipe.css); pushed screens keep the browser's own
  useEffect(() => {
    tabRef.current = tab
    control.current?.tabChanged()
    if (!tab) return
    const html = document.documentElement
    html.setAttribute('data-tab-swipe', '')
    return () => html.removeAttribute('data-tab-swipe')
  }, [tab])

  useEffect(() => {
    if (!tab) return
    return whenIdle(() => preloadNeighbourCode(router, tab), 4000)
  }, [router, tab])

  return null
}
