import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'

// Intent preloading for the feed cards (docs/decisions/2026-10-20-guard-me-cache.md, "Предзагрузка").
// The router's `defaultPreload: 'intent'` waits `defaultPreloadDelay` (50 ms) for hover and focus, but
// TanStack's <Link> preloads on touchstart AT ONCE (react-router link.tsx handleTouchStart ignores the
// delay). A finger that starts scrolling the feed always touches a card first — every touched card ran
// the occasion loader, i.e. one get_occasion_screen (+ the guard) per card while scrolling.
// The cards therefore turn the router's preloading off (`preload={false}`) and use this hook: the same
// 50 ms intent for a mouse resting on a card or the keyboard focus, never touch. A tap opens the
// screen at once anyway; its loader starts the request on the click. On a phone the compatibility
// mouse events of a tap (mouseenter right before the click) start the timer, and the click cancels it.

/** Same as the router's defaultPreloadDelay (src/router.tsx). */
export const INTENT_DELAY_MS = 50

export interface IntentPreloadHandlers {
  onMouseEnter: () => void
  onMouseLeave: () => void
  onFocus: () => void
  onBlur: () => void
  /** call on click: the navigation loads the screen itself */
  cancel: () => void
}

export function useIntentPreload(occasionId: string): IntentPreloadHandlers {
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
  }, [])
  useEffect(() => cancel, [cancel])
  const start = useCallback(() => {
    if (timer.current !== undefined) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      void router.preloadRoute({ to: '/occasions/$occasionId', params: { occasionId } }).catch(() => undefined)
    }, INTENT_DELAY_MS)
  }, [router, occasionId])
  return { onMouseEnter: start, onMouseLeave: cancel, onFocus: start, onBlur: cancel, cancel }
}
