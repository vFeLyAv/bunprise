import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

// Long press on an own wish tile → selection mode (Felix 30.10, request #4: "зажал → дрожат, кружки, вибро-отклик",
// like moving app icons on an iPhone). The press must never fight the other gestures of the screen:
//   - any movement beyond LONG_PRESS_SLOP_PX (the same slop as the tab swipe, tabSwipeRules.ts SLOP_PX) cancels it,
//     so a scroll, the edge swipe-back or a drag always wins — and a scroll of the page (the browser's pointercancel,
//     or a scroll event anywhere) cancels it too;
//   - nothing is prevented while the finger is down: the browser scrolls exactly as before;
//   - only after the press fired, the click that follows it is swallowed (the sheet does not open as well), and the
//     system's long-press menu ("Bild speichern …") is kept away from the tile.
// Pure DOM handlers, no React state: a tile that is never long-pressed costs nothing.

/** How long the finger rests on a tile before selection mode starts (ms; iOS uses ~500, Android ~400). */
export const LONG_PRESS_MS = 450
/** Movement (px) that turns a press into a scroll / swipe (= tabSwipeRules SLOP_PX). */
export const LONG_PRESS_SLOP_PX = 10

export interface LongPressHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  /** Call first in the element's onClick: true = this click ended a long press and must do nothing else. */
  consumeClick: () => boolean
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
}

interface Press {
  pointerId: number
  x: number
  y: number
  timer: ReturnType<typeof setTimeout>
  stopScroll: () => void
}

/**
 * Handlers for a long press. `onArm` runs when a press starts (e.g. to warm a lazy chunk); `onLongPress` when the
 * finger stayed still long enough. Undefined `onLongPress` = no long press (the friends' view; a tile already in
 * selection mode) — the handlers stay attached so the click that ends a press which just fired is still swallowed.
 */
export function useLongPress(onLongPress: (() => void) | undefined, onArm?: () => void): LongPressHandlers {
  const press = useRef<Press | null>(null)
  const fired = useRef(false)
  const latest = useRef(onLongPress)
  useEffect(() => {
    latest.current = onLongPress
  })

  function cancel(): void {
    const current = press.current
    if (!current) return
    clearTimeout(current.timer)
    current.stopScroll()
    press.current = null
  }

  useEffect(() => cancel, [])

  return {
    onPointerDown(event) {
      // a new touch: whatever the last one left behind is forgotten
      fired.current = false
      cancel()
      if (!onLongPress || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
      onArm?.()
      const onScroll = () => cancel()
      window.addEventListener('scroll', onScroll, { capture: true, passive: true })
      press.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        stopScroll: () => window.removeEventListener('scroll', onScroll, { capture: true }),
        timer: setTimeout(() => {
          cancel()
          fired.current = true
          latest.current?.()
        }, LONG_PRESS_MS),
      }
    },
    onPointerMove(event) {
      const current = press.current
      if (!current || current.pointerId !== event.pointerId) return
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > LONG_PRESS_SLOP_PX) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    consumeClick() {
      if (!fired.current) return false
      // the click that ends the long press: it already did its job (selection mode), no sheet / toggle on top
      fired.current = false
      return true
    },
    onContextMenu(event) {
      // the system's long-press menu would cover the tile just as selection mode starts
      if (press.current || fired.current) event.preventDefault()
    },
  }
}
