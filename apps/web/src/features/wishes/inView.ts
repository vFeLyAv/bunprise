import { useEffect, useState, type RefObject } from 'react'

// "Is this element (nearly) on screen?" — ONE shared IntersectionObserver for every picture of the wish screens
// (wish photos, shop icons). Moved out of wishPhotos.ts so the shop tile can use it without pulling the photo API
// into every screen that shows a shop; wishPhotos.ts re-exports it.

const ROOT_MARGIN = '240px 0px'
let observer: IntersectionObserver | null = null
const watchers = new Map<Element, () => void>()

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver !== 'function') return null
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const seen = watchers.get(entry.target)
        if (!seen) continue
        watchers.delete(entry.target)
        observer?.unobserve(entry.target)
        seen()
      }
    },
    { rootMargin: ROOT_MARGIN },
  )
  return observer
}

/**
 * true once the element came within ROOT_MARGIN of the viewport (and stays true: a picture that was loaded is not
 * dropped while scrolling). Without IntersectionObserver (very old browsers) everything counts as visible.
 */
export function useInView(ref: RefObject<Element | null>, enabled = true): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver !== 'function')
  useEffect(() => {
    const el = ref.current
    if (!enabled || seen || !el) return
    const io = sharedObserver()
    if (!io) return // (then `seen` started true)
    watchers.set(el, () => setSeen(true))
    io.observe(el)
    return () => {
      watchers.delete(el)
      io.unobserve(el)
    }
  }, [ref, enabled, seen])
  return seen
}

/** Tests only. */
export function resetInViewForTests(): void {
  observer?.disconnect()
  observer = null
  watchers.clear()
}
