// Swipe between the main tabs (Felix 2026-10-26: «свайп пальцем между вкладками … start и listen»): the numbers
// and the decisions, pure (no React), so they are tested on their own. The controller is TabSwipe.tsx (a lazy
// chunk); the tab bar's pill follows through tabDrag.ts.
//
// Only the four main tabs (Start · Listen · Ideen · Profil), never the segments inside a tab ("Liste · Monat",
// "Meine · Freunde" stay tap-only) and never a pushed screen (there the system's back gesture stays).
// Like a pager: the page follows the finger 1:1, the neighbour tab slides in beside it; past the first and the
// last tab a rubber band; on release distance OR speed decide, a flick back cancels.
// Whatever has its own sideways gesture wins where the touch starts (the Ideen deck, the month swipe, rails that
// scroll sideways, fields, sliders, the Lists buddy one picks up) — the deck and the month grid with a margin around them (OWN_MARGIN_PX), so a
// card swipe that starts a little beside the card never turns the tab (Felix 26.10); the outer 20 px on both
// sides belong to the system (iOS / Android back, Telegram).
//
// v2 (Felix 26.10 «случайно перелистнуться … листаешь вниз»): the direction is decided ONCE, after SLOP_PX, by
// the angle of that first move, and kept for the whole touch. Measured in Edge (touch-action: pan-y): the
// browser scrolls a touch whose first move is steeper than 45° and never scrolls one that is flatter — so a cone
// of 40° leaves only the thin 40–45° band to nobody (before: 37.6–45°), and a swipe once decided is never also
// scrolled (TabSwipe.tsx cancels the touchmove for WebKit, which would otherwise scroll its vertical part).

import type { TabDrag } from './tabDrag'
import { TABS, tabPlace, type TabId } from './tabs'

/** Left and right this close to the screen edge (px) belong to the system (back gestures). */
export const EDGE_GUARD_PX = 20
/** Movement before the direction is decided (px): below it a touch is still a tap. */
export const SLOP_PX = 10
/**
 * The widest angle from the horizontal (degrees) that is still a sideways swipe: 20° and 35° switch tabs, 50° is a
 * scroll. 40° = horizontal ≥ 1.19 × vertical, the same line as the edge swipe-back (edgeSwipe.ts, 1.2).
 */
export const SWIPE_MAX_ANGLE = 40
/** Around the deck / the month grid (`[data-swipe-own]`) this much (px) is theirs too: a swipe starting there never turns the tab. */
export const OWN_MARGIN_PX = 24
/** Released past this share of the width: the neighbour tab. */
export const COMMIT_RATIO = 0.3
/** A flick toward the neighbour at least this fast (px/s) switches from any distance. */
export const FLICK_VELOCITY = 500
/** A flick back at least this fast (px/s) stays, even past the distance. */
export const BACK_VELOCITY = 300
/** Rubber band past the first and the last tab (the iOS constant). */
export const RUBBER = 0.55
/** Reduced motion: the page does not slide, it only dims this much at the commit distance. */
export const CALM_DIM = 0.4

/**
 * Something that drags itself: the Lists buddy Pompon (@bunprise/mascot/buddy marks his `.bd-actor`). A touch that
 * starts on him is his — picked up and carried sideways he never turns the tab (Felix 27.10). Exactly him, no
 * OWN_MARGIN_PX around (he walks about; a swipe beside him still turns the tab). His puppet lives in a shadow root:
 * a touch inside it reaches the document retargeted to the shadow host, which lies inside the marked element too.
 */
export const DRAG_OWN_SELECTOR = '[data-drag-own]'

/** Things with their own sideways gesture or input: a swipe that starts on them is theirs. */
export const OWN_SELECTOR = `[data-swipe-own], ${DRAG_OWN_SELECTOR}, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], video, audio, iframe`

export type Axis = 'pending' | 'swipe' | 'scroll'

/** The angle of a move from the horizontal: 0° sideways … 90° straight up or down (any direction). */
export function moveAngle(dx: number, dy: number): number {
  return (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI
}

/**
 * What a movement of (dx, dy) since the touch went down means: undecided inside the slop, then — once, the caller
 * keeps the answer for the rest of the touch — a swipe within SWIPE_MAX_ANGLE of the horizontal, else a scroll.
 */
export function lockAxis(dx: number, dy: number): Axis {
  if (Math.hypot(dx, dy) < SLOP_PX) return 'pending'
  return moveAngle(dx, dy) <= SWIPE_MAX_ANGLE ? 'swipe' : 'scroll'
}

/** Did the touch go down in the system's strip along the left or the right edge? */
export function inEdgeGuard(x: number, left: number, width: number): boolean {
  return x - left < EDGE_GUARD_PX || left + width - x < EDGE_GUARD_PX
}

export interface Neighbours {
  prev: TabId | null
  next: TabId | null
}

/** The tabs left and right of a tab in the bar's order. */
export function neighbours(tab: TabId): Neighbours {
  const index = TABS.findIndex((item) => item.id === tab)
  if (index < 0) return { prev: null, next: null }
  return { prev: TABS[index - 1]?.id ?? null, next: TABS[index + 1]?.id ?? null }
}

/** Rubber band: a pull of `pull` px shows as less and less, never past `width`. */
export function rubberBand(pull: number, width: number): number {
  if (width <= 0 || pull <= 0) return 0
  return (1 - 1 / ((pull * RUBBER) / width + 1)) * width
}

/** The pull that shows as `shown` px (the inverse of rubberBand). */
export function unrubberBand(shown: number, width: number): number {
  if (width <= 0 || shown <= 0) return 0
  const ratio = Math.min(shown / width, 0.999)
  return ((1 / (1 - ratio) - 1) * width) / RUBBER
}

/** The page's offset (px, + = to the right) for a finger travel `raw`: 1:1 toward a neighbour, rubber band where there is none. */
export function pageOffset(raw: number, width: number, n: Neighbours): number {
  if (raw > 0 && !n.prev) return rubberBand(raw, width)
  if (raw < 0 && !n.next) return -rubberBand(-raw, width)
  return Math.max(-width, Math.min(width, raw))
}

/** Back from a shown offset to the finger travel: a touch that catches the moving page continues without a jump. */
export function rawFromOffset(offset: number, width: number, n: Neighbours): number {
  if (offset > 0 && !n.prev) return unrubberBand(offset, width)
  if (offset < 0 && !n.next) return -unrubberBand(-offset, width)
  return offset
}

/** The tab the page is being pulled toward: moved left → the next tab, moved right → the previous one. */
export function towards(offset: number, n: Neighbours): TabId | null {
  if (offset < 0) return n.next
  if (offset > 0) return n.prev
  return null
}

/** 0 … 1: how far the page has moved. */
export function progressOf(offset: number, width: number): number {
  if (width <= 0) return 0
  return Math.min(1, Math.abs(offset) / width)
}

/**
 * Release: +1 (the next tab), −1 (the previous one) or 0 (stay), from the offset (px), the finger's velocity
 * (px/s, + = to the right) and the width.
 */
export function releaseStep(offset: number, velocity: number, width: number, n: Neighbours): -1 | 0 | 1 {
  if (width <= 0 || offset === 0) return 0
  const step = offset < 0 ? 1 : -1
  if ((step === 1 && !n.next) || (step === -1 && !n.prev)) return 0
  // the speed toward the neighbour (a finger moving left pulls the next tab in)
  const toward = step === 1 ? -velocity : velocity
  if (toward <= -BACK_VELOCITY) return 0
  if (toward >= FLICK_VELOCITY) return step
  return Math.abs(offset) >= width * COMMIT_RATIO ? step : 0
}

/**
 * Where the tab bar's pills are while the finger moves from `from` toward `to` (progress 0 … 1): inside one capsule
 * the pill slides between the two slots; across the "+" the leaving pill shrinks and fades while the arriving one
 * grows in — at 1 exactly the end state of a tap. A capsule that takes no part is left out.
 */
export function pillPoses(from: TabId, to: TabId, progress: number): TabDrag {
  const a = tabPlace(from)
  const b = tabPlace(to)
  const p = Math.min(1, Math.max(0, progress))
  if (a.group === b.group) return { [a.group]: { slot: a.slot + (b.slot - a.slot) * p, opacity: 1, scale: 1 } }
  return {
    [a.group]: { slot: a.slot, opacity: 1 - p, scale: 1 - 0.45 * p },
    [b.group]: { slot: b.slot, opacity: p, scale: 0.55 + 0.45 * p },
  }
}

/** Reduced motion: how much the page dims while the finger pulls (0 … CALM_DIM at the commit distance). */
export function calmDim(offset: number, width: number): number {
  if (width <= 0) return 0
  return CALM_DIM * Math.min(1, Math.abs(offset) / (width * COMMIT_RATIO))
}

/** An element that really scrolls sideways (a rail, a chips row that is too long for the screen). */
export function scrollsSideways(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false
  const overflow = getComputedStyle(el).overflowX
  return overflow === 'auto' || overflow === 'scroll'
}

/** Does the touch start on something with its own sideways gesture (between `target` and `stop`)? */
export function ownsHorizontal(target: Element, stop: Element | null): boolean {
  if (target.closest(OWN_SELECTOR)) return true
  for (let el: Element | null = target; el && el !== stop; el = el.parentElement) {
    if (scrollsSideways(el)) return true
  }
  return false
}

/** A box on screen (a DOMRect fits). */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Is the point (client px) inside one of the boxes, grown by `margin` on every side? A box without a size (not laid
 * out) counts for nothing.
 */
export function inOwnZone(x: number, y: number, boxes: readonly Box[], margin = OWN_MARGIN_PX): boolean {
  return boxes.some(
    (box) => box.right > box.left && box.bottom > box.top && x >= box.left - margin && x <= box.right + margin && y >= box.top - margin && y <= box.bottom + margin,
  )
}

/** The zones with their own sideways gesture: the deck / the month grid, and the row under the Ideen deck (undo, "3 von 8"). */
export const OWN_ZONE_SELECTOR = '[data-swipe-own], [data-deck-controls]'

/** Where the things with their own sideways gesture are right now, inside `scopes` (a screen's parts, a neighbour's copy). */
export function ownBoxes(scopes: ReadonlyArray<Element | null>): Box[] {
  return scopes.flatMap((scope) => (scope ? Array.from(scope.querySelectorAll(OWN_ZONE_SELECTOR), (el) => el.getBoundingClientRect()) : []))
}

/** A sheet, the create menu or a dialog is open (or still closing): the page under it does not swipe. */
export function modalOpen(doc: Document): boolean {
  return doc.querySelector('[aria-modal="true"], dialog[open], [data-menu-layer]') !== null
}

/** Text is selected: a sideways move belongs to the selection handles. */
export function textSelected(doc: Document): boolean {
  const selection = doc.getSelection?.()
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim())
}
