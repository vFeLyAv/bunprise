import { useEffect, useRef, useState } from 'react'
import { useLayerRoot } from '../../ui/layers'

// What scrolls the app: the window in production; inside the dev phone frame the simulated screen
// (.pf-app, which is also the overlay layer root — src/dev/PhoneFrame.tsx). Scroll-linked chrome (the
// compact tab bar, the collapsing profile header) listens here.

export interface AppScroller {
  target: Window | HTMLElement
  /** current scroll offset (px; negative while iOS rubber-bands at the top) */
  top: () => number
  /** the visible height (px) */
  height: () => number
}

export function appScroller(layerRoot: HTMLElement | null): AppScroller {
  if (layerRoot && typeof document !== 'undefined' && layerRoot !== document.body) {
    return { target: layerRoot, top: () => layerRoot.scrollTop, height: () => layerRoot.clientHeight }
  }
  return {
    target: window,
    top: () => window.scrollY,
    height: () => window.innerHeight,
  }
}

/** The element whose children are the routed screens (#root, or .pf-app in the dev frame). */
export function appRootElement(layerRoot: HTMLElement | null): HTMLElement | null {
  if (typeof document === 'undefined') return null
  if (layerRoot && layerRoot !== document.body) return layerRoot
  return document.getElementById('root')
}

/** Below this offset the page counts as "at the top": the bar is always expanded there. */
const TOP_ZONE_PX = 24
/** Scrolled down this far in one go (px): compact. */
const DOWN_PX = 18
/** Scrolled up this far in one go (px): expanded again. */
const UP_PX = 10

/**
 * iOS 26 tab bar: compact while the content scrolls down, expanded again on the way up and at the top.
 * One passive scroll listener, read once per frame; React re-renders only when the state flips.
 * `resetKey` (the screen) expands it again on every screen change; `hold` keeps it expanded.
 */
export function useScrollCompact(resetKey: string, hold = false): boolean {
  const root = useLayerRoot()
  // the state belongs to one screen: on another screen it reads as "expanded" until the next scroll
  const [state, setState] = useState({ key: resetKey, compact: false })
  // held (the create menu is open): expanded, and it stays expanded afterwards until the next scroll
  // down — the "+" never shrinks away right after the menu closed (iOS)
  if (hold && state.compact) setState({ key: state.key, compact: false })
  const key = useRef(resetKey)
  useEffect(() => {
    key.current = resetKey
  }, [resetKey])

  useEffect(() => {
    if (hold) return
    const setCompact = (compact: boolean) =>
      setState((current) => (current.key === key.current && current.compact === compact ? current : { key: key.current, compact }))
    const scroller = appScroller(root)
    let last = scroller.top()
    let run = 0
    let frame = 0
    const read = () => {
      frame = 0
      const top = scroller.top()
      const delta = top - last
      last = top
      if (top <= TOP_ZONE_PX) {
        run = 0
        setCompact(false)
        return
      }
      if (delta === 0) return
      // movement in one direction adds up; a change of direction starts a new run
      run = Math.sign(delta) === Math.sign(run) ? run + delta : delta
      if (run >= DOWN_PX) setCompact(true)
      else if (run <= -UP_PX) setCompact(false)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    scroller.target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.target.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [root, hold])

  return !hold && state.key === resetKey && state.compact
}
