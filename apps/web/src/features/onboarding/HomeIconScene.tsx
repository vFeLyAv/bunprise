import { useEffect, useRef } from 'react'
import type { HomeIconStage } from '@bunprise/mascot/homeicon'
import { useMascotMotion } from '../mascot-ui/mascotMotion'
import { registerMascot, requestStage, unregisterMascot } from '../mascot-ui/stage'
import { hasPlayedHomeIcon, markHomeIconPlayed } from './homeIconSeen'

// «Здесь я буду жить» (docs/design/2026-10-26-homeicon.md; Felix 27.10: «хорошо») on the onboarding step "Zum
// Home-Bildschirm" (iOS Safari only): above the card a frame in the shape of the app icon slides up from behind the
// card's top edge, Pompon climbs onto its bar and freezes in exactly the icon's pose, the frame shrinks to a
// home-screen icon with "Bunprise" under it (≈ 2.4 s, @bunprise/mascot/homeicon — a lazy chunk of this step only).
// - Once per device (homeIconSeen.ts): later visits of the step show the still icon (it fades in).
// - Motion level (mascotMotion.ts): "Weniger" → the still icon; "Aus" or "Kaninchen zeigen" off → nothing.
// - One mascot at a time (mascot-ui/stage.ts): an illustration; it keeps the stage until the step is left, so the
//   seated Pompon (faded out meanwhile, WelcomePage) does not start his idle life invisibly. When another mascot is
//   busy, the still icon instead of the show.
// - The show pauses off screen / in a hidden tab (the package's Watch). Decorative: aria-hidden, click-through.
// Geometry: the host fills the scene stage; its bottom edge is the card's top edge (the frame hides behind it).

type HomeIconModule = typeof import('@bunprise/mascot/homeicon')
let modulePromise: Promise<HomeIconModule> | null = null
function loadHomeIcon(): Promise<HomeIconModule> {
  // with Pompon's look (mascot-ui/pompon.ts) set before the puppet is built
  modulePromise ??= Promise.all([import('@bunprise/mascot/homeicon'), import('../mascot-ui/pompon')]).then(([mod]) => mod).catch((err: unknown) => {
    modulePromise = null
    throw err
  })
  return modulePromise
}

/** «Hier wohne ich» played: a find of «Pompons Sammlung» (sammlung/note.ts, loaded only now) */
function noteHomeIcon(): void {
  void import('../sammlung/note').then((m) => m.noteFind('homeicon'), () => undefined)
}

export interface HomeIconSceneProps {
  /** the scene is on screen (true) / gone (false): the seated Pompon steps aside meanwhile */
  onShown?: (shown: boolean) => void
}

export default function HomeIconScene({ onShown }: HomeIconSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const { shown, reducedMotion } = useMascotMotion()
  const onShownRef = useRef(onShown)
  useEffect(() => {
    onShownRef.current = onShown
  })

  useEffect(() => {
    const host = hostRef.current
    if (!shown || !host) return
    let cancelled = false
    let stage: HomeIconStage | null = null
    const id = Symbol('homeicon')
    void loadHomeIcon()
      .then((mod) => {
        if (cancelled) return
        const build = (still: boolean) => new mod.HomeIconStage(host, { reducedMotion, still, label: 'Bunprise' })
        const seen = hasPlayedHomeIcon()
        let s = build(seen)
        registerMascot(
          id,
          {
            get busy() { return stage?.busy ?? false },
            get isDestroyed() { return stage?.isDestroyed ?? true },
            get suspended() { return stage?.suspended ?? false },
            stopIdle: () => undefined,
            startIdle: () => undefined,
            // a more important moment needs the stage: the icon jumps to its end (nothing keeps moving)
            interrupt: () => { if (stage?.busy) stage.seek(stage.duration) },
          },
          false,
        )
        if (!requestStage(id, 'illustration') && !s.isStatic) {
          // another mascot is mid-scene: the still icon now, the show stays for the next visit
          s.destroy()
          s = build(true)
        } else if (!s.isStatic) {
          markHomeIconPlayed()
          noteHomeIcon() // the show plays: a find of «Pompons Sammlung»
        } else if (!seen) noteHomeIcon() // the first time, as the calm version of «Weniger»: seen too
        stage = s
        s.play()
        onShownRef.current?.(true)
      })
      .catch(() => {
        /* decorative: no icon, the seated Pompon stays */
      })
    return () => {
      cancelled = true
      unregisterMascot(id)
      stage?.destroy()
      stage = null
      onShownRef.current?.(false)
    }
  }, [shown, reducedMotion])

  if (!shown) return null
  return <div ref={hostRef} data-home-icon="" aria-hidden="true" className="wl-home-icon" />
}
