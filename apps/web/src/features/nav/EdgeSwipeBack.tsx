import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { haptic, useLayerRoot, useReducedMotionPref } from '../../ui'
import {
  classifyMove,
  followOffset,
  releaseVelocity,
  shouldComplete,
  swipeProgress,
  underlayDim,
  underlayOffset,
  type MoveSample,
} from './edgeSwipe'
import { captureGhost, clearGhosts, ghostFor, screenParts, storeGhost, type Ghost } from './ghost'
import { appRootElement, appScroller } from './scroller'
import { settleTo } from './settle'
import './swipe.css'

// Interactive edge-swipe-back on pushed screens (K11), in the installed PWA only (swipeEnv.ts): start
// within 24 px of the left edge, the screen follows the finger, the previous screen peeks underneath with
// a slight parallax and dim; release decides by distance and speed (edgeSwipe.ts); the finish is the
// smooth spring carrying the finger's speed, a cancel springs back. Completing = history back (the same
// as the screens' own "Zurück", which go back in history when they can) without a view transition.
// Reduced motion: no parallax, a plain short slide. Vertical moves stay scrolling (touch-action: pan-y
// on the edge zone); a tap on the zone is handed to what lies under it.

interface Gesture {
  pointerId: number
  startX: number
  startY: number
  /** visual px per CSS px (the dev phone frame is zoomed) */
  scale: number
  state: 'pending' | 'dragging'
  samples: MoveSample[]
  offset: number
}

interface Scene {
  width: number
  parts: HTMLElement[]
  paper: HTMLElement
  ghost: Ghost | null
  dim: HTMLElement | null
  reduced: boolean
}

function setX(el: HTMLElement, x: number): void {
  el.style.transform = `translate3d(${x}px, 0, 0)`
}

/** History index of the entry on display (TanStack history state). */
function currentIndex(state: unknown): number {
  const index = (state as { __TSR_index?: unknown } | null)?.__TSR_index
  return typeof index === 'number' ? index : 0
}

export default function EdgeSwipeBack({ pushed }: { pushed: boolean }) {
  const router = useRouter()
  const layerRoot = useLayerRoot()
  // = useCanGoBack(), read from the router state (one hook less in the lazy chunks' shared code)
  const canGoBack = useRouterState({ select: (state) => currentIndex(state.location.state) !== 0 })
  const reduced = useReducedMotionPref()
  const gesture = useRef<Gesture | null>(null)
  const scene = useRef<Scene | null>(null)
  const running = useRef<(() => void) | null>(null)
  const finishing = useRef(false)

  // 1. a copy of every screen that gets covered by a push (the old screen is still in the document now)
  useEffect(() => {
    if (!layerRoot) return
    const stop = router.history.subscribe(({ action, location }) => {
      if (action.type !== 'PUSH') return
      const appRoot = appRootElement(layerRoot)
      if (!appRoot) return
      const index = currentIndex(location.state) - 1
      if (index < 0) return
      try {
        storeGhost(index, captureGhost(appRoot, layerRoot, appScroller(layerRoot).top()))
      } catch {
        /* a copy is a nicety: without it the gesture shows plain paper underneath */
      }
    })
    return () => {
      stop()
      clearGhosts()
    }
  }, [router, layerRoot])

  // unmount mid-gesture (sign-out, account switch): leave the document as it was
  useEffect(() => () => teardown(), [])

  function teardown(): void {
    running.current?.()
    running.current = null
    const s = scene.current
    scene.current = null
    gesture.current = null
    finishing.current = false
    if (!s) return
    for (const part of s.parts) part.style.removeProperty('transform')
    s.paper.remove()
    s.ghost?.node.remove()
  }

  function begin(g: Gesture): Scene | null {
    const appRoot = appRootElement(layerRoot)
    if (!appRoot || !layerRoot) return null
    const parts = screenParts(appRoot)
    if (parts.length === 0) return null
    const width = appRoot.clientWidth || window.innerWidth
    const ghost = ghostFor(currentIndex(router.history.location.state) - 1)
    const paper = document.createElement('div')
    paper.className = 'swipe-paper'
    paper.setAttribute('aria-hidden', 'true')
    // paint order: the ghost, the moving screen's paper, then the screen itself (all before <main>)
    const first = appRoot.firstChild
    if (ghost) appRoot.insertBefore(ghost.node, first)
    appRoot.insertBefore(paper, ghost ? ghost.node.nextSibling : first)
    const dim = ghost?.node.querySelector<HTMLElement>('.swipe-ghost-dim') ?? null
    const s: Scene = { width, parts, paper, ghost, dim, reduced }
    scene.current = s
    g.state = 'dragging'
    render(s, 0)
    return s
  }

  function render(s: Scene, offset: number): void {
    const progress = swipeProgress(offset, s.width)
    for (const part of s.parts) setX(part, offset)
    setX(s.paper, offset)
    if (s.ghost) setX(s.ghost.node, underlayOffset(progress, s.width, s.reduced))
    if (s.dim) s.dim.style.opacity = String(underlayDim(progress))
  }

  function settle(s: Scene, complete: boolean, velocity: number): void {
    finishing.current = true
    const from = gesture.current?.offset ?? 0
    const to = complete ? s.width : 0
    running.current = settleTo(from, to, velocity, s.reduced, (value) => render(s, value), () => {
      running.current = null
      if (complete) goBack(s)
      else teardown()
    })
  }

  function goBack(s: Scene): void {
    haptic('select')
    const scrollTop = s.ghost?.scrollTop ?? null
    let done = false
    const finish = () => {
      if (done) return
      done = true
      stopRendered()
      clearTimeout(timer)
      requestAnimationFrame(() => {
        // the real previous screen is rendered (into the same <header>/<main> elements or new ones)
        if (scrollTop !== null && layerRoot) {
          const scroller = appScroller(layerRoot)
          if (scroller.target === window) window.scrollTo(0, scrollTop)
          else (scroller.target as HTMLElement).scrollTop = scrollTop
        }
        const appRoot = appRootElement(layerRoot)
        if (appRoot) for (const part of screenParts(appRoot)) part.style.removeProperty('transform')
        teardown()
      })
    }
    const stopRendered = router.subscribe('onRendered', finish)
    const timer = setTimeout(finish, 1500)
    // the gesture already was the animation: no crossfade on top of it (consumed by the next load)
    router.shouldViewTransition = false
    router.history.back()
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!event.isPrimary || event.button !== 0 || finishing.current || gesture.current) return
    if (document.querySelector('[aria-modal="true"]')) return
    const rect = event.currentTarget.getBoundingClientRect()
    const layout = event.currentTarget.offsetWidth || rect.width || 1
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scale: rect.width / layout || 1,
      state: 'pending',
      samples: [{ t: event.timeStamp, x: 0 }],
      offset: 0,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* capture is best effort */
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    const dx = (event.clientX - g.startX) / g.scale
    const dy = (event.clientY - g.startY) / g.scale
    if (g.state === 'pending') {
      const intent = classifyMove(dx, dy)
      if (intent === 'pending') return
      if (intent === 'scroll' || !begin(g)) {
        gesture.current = null
        return
      }
    }
    const s = scene.current
    if (!s) return
    g.offset = followOffset(dx)
    g.samples.push({ t: event.timeStamp, x: g.offset })
    if (g.samples.length > 12) g.samples.shift()
    render(s, g.offset)
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    const s = scene.current
    if (g.state === 'pending' || !s) {
      gesture.current = null
      forwardTap(event.currentTarget, event.clientX, event.clientY)
      return
    }
    const velocity = releaseVelocity(g.samples)
    settle(s, shouldComplete(g.offset, velocity, s.width), velocity)
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    const s = scene.current
    if (s && g.state === 'dragging') settle(s, false, 0)
    else gesture.current = null
  }

  if (!pushed || !canGoBack || !layerRoot) return null
  return createPortal(
    <div
      aria-hidden="true"
      className="swipe-edge"
      data-swipe-edge=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />,
    layerRoot,
  )
}

/** A tap on the edge zone belongs to what lies under it (a row, a field, a link). */
function forwardTap(zone: HTMLElement, x: number, y: number): void {
  const previous = zone.style.pointerEvents
  zone.style.pointerEvents = 'none'
  const target = document.elementFromPoint(x, y)
  zone.style.pointerEvents = previous
  if (!(target instanceof HTMLElement)) return
  const field = target.closest<HTMLElement>('input, textarea, select, [contenteditable="true"]')
  if (field) {
    field.focus()
    return
  }
  const control = target.closest<HTMLElement>('a[href], button, [role="button"], label, summary') ?? target
  control.click()
}
