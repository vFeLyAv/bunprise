// Interactive edge-swipe-back on pushed screens (K11 "steered with the finger"): the numbers and the
// decisions, pure (no DOM), so they are tested on their own. The controller is EdgeSwipeBack.tsx.
//
// iOS behaviour: the gesture starts within ~24 px of the left edge; the screen follows the finger, the
// previous screen peeks underneath with a slight parallax and dim; on release, distance OR speed decide,
// a flick back to the left cancels; the finish is a spring that keeps the finger's speed.

/** A gesture only starts this close to the left edge (px). */
export const EDGE_ZONE_PX = 24
/** Movement before the direction is decided (px): below it, a touch is still a tap. */
export const START_SLOP_PX = 10
/** Horizontal must beat vertical by this factor, or the touch belongs to scrolling. */
export const DIRECTION_RATIO = 1.2
/** Released past this share of the width: back. */
export const COMPLETE_RATIO = 0.4
/** A flick to the right at least this fast (px/s) completes from any distance. */
export const FLING_VELOCITY = 500
/** A flick back to the left at least this fast (px/s) cancels even past the distance. */
export const CANCEL_VELOCITY = -300
/** The previous screen starts this share of the width to the left and slides in with the finger. */
export const PARALLAX = 0.28
/** Ink over the previous screen at the start of the gesture (opacity), fading to 0 at the end. */
export const DIM_MAX = 0.14
/** Samples younger than this (ms) count for the release velocity. */
export const VELOCITY_WINDOW_MS = 90

export type SwipeIntent = 'pending' | 'swipe' | 'scroll'

/** Did the pointer go down inside the edge zone of a screen whose left edge is at `left`? */
export function isEdgeStart(x: number, left = 0): boolean {
  const offset = x - left
  return offset >= 0 && offset <= EDGE_ZONE_PX
}

/** What a movement of (dx, dy) since the pointer went down means. Only a move to the RIGHT is a swipe-back. */
export function classifyMove(dx: number, dy: number): SwipeIntent {
  if (Math.hypot(dx, dy) < START_SLOP_PX) return 'pending'
  if (dx > 0 && Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO) return 'swipe'
  return 'scroll'
}

/** The screen's offset while it follows the finger: never left of its resting place. */
export function followOffset(dx: number): number {
  return Math.max(0, dx)
}

/** Release: back (true) or stay (false), from the offset (px), the velocity (px/s, + = right) and the width. */
export function shouldComplete(offset: number, velocity: number, width: number): boolean {
  if (width <= 0 || offset <= 0) return false
  if (velocity <= CANCEL_VELOCITY) return false
  if (velocity >= FLING_VELOCITY) return true
  return offset >= width * COMPLETE_RATIO
}

/** 0 … 1: how far the screen has been pulled away. */
export function swipeProgress(offset: number, width: number): number {
  if (width <= 0) return 0
  return Math.min(1, Math.max(0, offset / width))
}

/** X of the previous screen underneath (px): parallax from −PARALLAX·width to 0; none under reduced motion. */
export function underlayOffset(progress: number, width: number, reduced: boolean): number {
  if (reduced) return 0
  return -PARALLAX * width * (1 - Math.min(1, Math.max(0, progress)))
}

/** The dim over the previous screen (opacity). */
export function underlayDim(progress: number): number {
  return DIM_MAX * (1 - Math.min(1, Math.max(0, progress)))
}

export interface MoveSample {
  /** ms (event.timeStamp) */
  t: number
  /** px */
  x: number
}

/** Release velocity (px/s) from the samples of the last VELOCITY_WINDOW_MS; 0 with fewer than two. */
export function releaseVelocity(samples: readonly MoveSample[]): number {
  const last = samples[samples.length - 1]
  if (!last) return 0
  const recent = samples.filter((sample) => last.t - sample.t <= VELOCITY_WINDOW_MS)
  const first = recent[0]
  if (!first || first === last || last.t <= first.t) return 0
  return ((last.x - first.x) / (last.t - first.t)) * 1000
}
