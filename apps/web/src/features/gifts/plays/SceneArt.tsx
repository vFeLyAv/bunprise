import { useLayoutEffect, useMemo, useRef } from 'react'
import { VIEW } from './scenes'
import { gameSceneFor, type GameLook } from './newscenes'
import { freezeAt, playOnce } from './run'

// One game's drawing (scenes.ts, or newscenes.ts for the games of 30.10): its end pose (a card of the grid), or its short animation played ONCE when it
// mounts with `play` (the first slide of the game's sheet). Reduced motion: always the end pose, never animate().
// The SVG is our own static markup (no data in it), written once per look; the tracks then only set transform /
// opacity on its parts. Decorative: the card / the slide says what it shows.

export interface SceneArtProps {
  look: GameLook
  /** play the animation once on mount (else: the end pose) */
  play?: boolean
  reduced: boolean
  className?: string
}

export function SceneArt({ look, play = false, reduced, className }: SceneArtProps) {
  const host = useRef<HTMLDivElement>(null)
  const scene = useMemo(() => gameSceneFor(look), [look])
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return undefined
    el.innerHTML = `<svg class="gift-play" viewBox="0 0 ${VIEW.w} ${VIEW.h}" aria-hidden="true" focusable="false">${scene.svg}</svg>`
    const tracks = scene.tracks(el)
    if (!play || reduced) {
      freezeAt(tracks, scene.duration)
      return undefined
    }
    const run = playOnce(tracks, scene.duration)
    return () => run.stop()
  }, [scene, play, reduced])
  return <div ref={host} className={className} aria-hidden="true" data-archetype={look.archetype} />
}
