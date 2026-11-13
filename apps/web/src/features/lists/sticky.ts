import { useEffect, useState, type RefObject } from 'react'
import { useLayerRoot } from '../../ui'

// Is the sticky "Meine · Freunde" switch stuck under the top bar? Then it floats on its own glass capsule
// (lists.css .lt-segment[data-stuck]); at rest it lies on the page. One IntersectionObserver on the element,
// with the bar's height cut off the top of the root: the switch is stuck while it touches that line.

export function useStickySegment(ref: RefObject<HTMLElement | null>): boolean {
  const root = useLayerRoot()
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') return
    const cs = getComputedStyle(el)
    const bar = parseFloat(cs.getPropertyValue('--topbar-h')) || 52
    const sa = parseFloat(cs.getPropertyValue('--sa-top')) || 0
    // 1 px below the bar: at rest the element is fully below it (ratio 1); stuck, its top edge is cut (ratio < 1)
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry) setStuck(entry.intersectionRatio < 1 && entry.boundingClientRect.top <= (entry.rootBounds?.top ?? 0) + 1)
      },
      {
        root: root && root !== document.body ? root : null,
        rootMargin: `-${Math.round(bar + sa + 1)}px 0px 0px 0px`,
        threshold: [1],
      },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref, root])
  return stuck
}
