import type { Sampled, StyleOut } from '@bunprise/mascot/timeline'

// Running the tracks of a scene (scenes.ts) or of the die moment (motion.ts): either the frozen pose at a time
// (reduced motion, a card in the grid: the end pose, no animation at all) or ONE run from the start — Web Animations
// that only touch transform / opacity, finite, and at the end replaced by the end pose written inline (then the
// browser keeps nothing running). Without Element.animate (old browsers, tests) the end pose shows at once.

function apply(el: Element, v: StyleOut | null): void {
  if (!v) return
  const style = (el as HTMLElement | SVGElement).style
  if (v.transform !== undefined) style.transform = v.transform
  if (v.opacity !== undefined) style.opacity = v.opacity
}

/** Every part at its pose of time `t` (seconds), inline. */
export function freezeAt(tracks: readonly Sampled[], t: number): void {
  for (const track of tracks) {
    const v = track.styleAt(t)
    for (const el of track.els) apply(el, v)
  }
}

export interface Run {
  /** ends the run now: the end pose stays */
  stop(): void
}

/** Plays the tracks once from 0 to `duration` (seconds); `onEnd` once the end pose stands. */
export function playOnce(tracks: readonly Sampled[], duration: number, onEnd?: () => void): Run {
  const animations: Animation[] = []
  for (const track of tracks) {
    const v = track.baseStyle()
    for (const el of track.els) apply(el, v)
  }
  for (const track of tracks) {
    for (const compiled of track.compile()) {
      const el = compiled.el as Element & { animate?: Element['animate'] }
      if (typeof el.animate === 'function') animations.push(el.animate(compiled.frames, compiled.timing))
    }
  }
  let over = false
  const finish = () => {
    if (over) return
    over = true
    freezeAt(tracks, duration)
    for (const animation of animations) animation.cancel()
    onEnd?.()
  }
  if (animations.length === 0) {
    finish()
    return { stop: finish }
  }
  void Promise.all(animations.map((animation) => animation.finished)).then(finish, () => undefined)
  return { stop: finish }
}
