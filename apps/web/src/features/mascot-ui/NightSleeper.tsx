/**
 * <NightSleeper> — a mascot that sleeps at night (@bunprise/mascot/night, approved 31.10; rules in ./nightMount.ts):
 * the Start corner (Pompon on the first card) and Tapsi in the empty "Freunde" card. Lazy: the places import it with
 * React.lazy only at night, the night entry loads after it. The host box keeps its size from the first render (no
 * layout shift); the puppet fades in (--dur-s).
 *
 * Motion level (ui/motionMode): 'full' → moments + the sleeping loop; 'reduced' («Weniger», battery saver, the
 * system) → still poses only; 'off' / «Kaninchen zeigen» off → nothing. The caller decides that it is night
 * (./night.ts useSleepsNow) and keeps him mounted until the screen goes (he wakes up at 07:00 in front of you).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { BunnyCoat, HamsterCoat, HamsterScene } from '@bunprise/mascot'
import type { NightKind, NightMascot, NightState } from '@bunprise/mascot/night'
import { cn } from '../../ui/cn'
import { useBunniesShown, useMotionAttr, type MotionAttr } from '../../ui/motionMode'
import '../../styles/mascot.css'
import { loadNight, mountNight, type NightHandle } from './nightMount'
import type { AliveAttachment } from './alive'

/** Still poses: every level but 'full' ('auto' = no attribute: the system setting). */
export function nightStill(level: MotionAttr): boolean {
  if (level === 'full') return false
  if (level === 'auto') return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return true
}

export interface NightSleeperProps {
  kind: NightKind
  /** px width; with `fit` the host's laid-out width wins (the .mascot-box of Mascot.tsx) */
  size: number
  fit?: boolean
  coat?: BunnyCoat | HamsterCoat
  binoculars?: boolean
  /** the night began while the screen was open: he appears awake and falls asleep in front of you */
  live?: boolean
  /** an accessible name: his body is a button (Tapsi, as by day) — else decorative */
  label?: string
  /** Pompon wears today's outfit (Mascot.tsx's rule) */
  wear?: boolean
  /** wait this long after mount before he loads (a card that is still rising into place), ms */
  delay?: number
  /** places his box inside the host (left / top); called again when the host's size changes */
  place: (m: NightMascot, host: HTMLElement) => void
  /** a tap while he is awake plays this scene (Tapsi: 'speck', as by day) — else his small hop */
  awakeScene?: HamsterScene
  onAwakeTap?: (m: NightMascot) => boolean
  onState?: (state: NightState) => void
  className?: string
  style?: CSSProperties
  /** attributes of the host box (e.g. data-mascot-size for the .mascot-box scale) */
  sizeName?: 's' | 'm' | 'l'
}

export default function NightSleeper(props: NightSleeperProps) {
  const level = useMotionAttr()
  const shown = useBunniesShown()
  const hostRef = useRef<HTMLDivElement>(null)
  const handle = useRef<NightHandle | null>(null)
  const [ready, setReady] = useState(false)
  const still = nightStill(level)
  const latest = useRef({ props, still })
  useEffect(() => {
    latest.current = { props, still }
  })

  useEffect(() => {
    if (!shown) return
    let alive = true
    // «Живые анимации» (31.10, ./alive.ts): Pompon awake on the Start corner — his living moments (never asleep)
    let att: AliveAttachment | null = null
    let awake = false
    const timer = setTimeout(() => {
      loadNight()
        .then((mod) => {
          const host = hostRef.current
          if (!alive || !host) return
          const { props: p, still: s } = latest.current
          const width = p.fit ? parseFloat(getComputedStyle(host).width) : NaN
          handle.current = mountNight(mod, host, {
            kind: p.kind,
            size: Number.isFinite(width) && width > 0 ? width : p.size,
            ...(p.coat ? { coat: p.coat } : {}),
            binoculars: !!p.binoculars,
            still: s,
            ...(p.live ? { startAwake: true } : {}),
            ...(p.label ? { label: p.label } : {}),
            wear: p.wear ?? (p.kind === 'bunny' && (p.coat ?? 'fawn') === 'fawn'),
            place: (m) => latest.current.props.place(m, host),
            ...(p.awakeScene ? { awakeScene: p.awakeScene } : {}),
            ...(p.onAwakeTap ? { onAwakeTap: (m: NightMascot) => latest.current.props.onAwakeTap?.(m) ?? false } : {}),
            onChange: (state) => {
              // woke up (a tap, the morning): the first living moment ≈ 12 s later
              if (state === 'awake' && !awake) att?.restart()
              awake = state === 'awake'
              latest.current.props.onState?.(state)
            },
          })
          const m = handle.current.mascot
          awake = m.state === 'awake'
          // (Pompon only: Tapsi in "Freunde" holds his binoculars — his paws are busy; ./alive.ts its own lazy chunk)
          if (p.kind === 'bunny' && !p.binoculars) {
            import('./alive').then((a) => {
              if (!alive || handle.current?.mascot !== m) return
              att = a.attachAlive({
                kind: 'bunny',
                // (the design: on the 96 px card corner all but the loaf — it reads too thin there)
                moves: ['groom', 'periscope', 'stretch', 'sneeze', 'dig'],
                seen: m.rig.box,
                touch: m.rig.hit ?? m.rig.box,
                quiet: () => latest.current.still || m.state !== 'awake' || m.isDestroyed,
                borrow: () => (m.state !== 'awake' || m.busy || m.rig.driven || m.rig.puppet.busy || m.isDestroyed ? null : { puppet: m.rig.puppet }),
              })
            }, () => undefined)
          }
          setReady(true)
        })
        .catch(() => {
          /* decorative: the empty host stays */
        })
    }, latest.current.props.delay ?? 0)
    return () => {
      alive = false
      clearTimeout(timer)
      att?.stop()
      att = null
      handle.current?.destroy()
      handle.current = null
      setReady(false)
    }
    // the first values win (a different sleeper is a different component: key it)
  }, [shown])

  useEffect(() => {
    if (ready) handle.current?.setStill(still)
  }, [still, ready])

  if (!shown) return null
  return (
    <div
      ref={hostRef}
      data-night-host={props.kind}
      data-mascot-size={props.sizeName}
      className={cn('transition-opacity duration-(--dur-s) ease-(--ease-out)', ready ? 'opacity-100' : 'opacity-0', props.className)}
      style={props.style}
    />
  )
}
