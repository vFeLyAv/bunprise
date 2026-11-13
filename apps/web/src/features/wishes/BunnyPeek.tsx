import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import type { Scene } from '@bunprise/mascot'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { cn, fade, useBunniesShown, useReducedMotionPref, useSpring } from '../../ui'
import { Mascot, type MascotHandle } from '../mascot-ui/Mascot'
import { playsInApp } from '../mascot-ui/inGallery'
import './wishes.css'

// Pompon sits on the top edge of the link capsule and WORKS with the link (K8, K10): he says in a small
// glass bubble what he is doing, and plays a moment at every key step — gentle idle life in between
// (blink, ear twitch: the package's idle loop):
//   hello → waves once when the new-wish screen opens ('greet')
//   sniff → sniffs at the link while it is read ('alert', again after a short breath while it lasts)
//   joy   → hops when the preview arrived ('jump'; after the scene still running, never skipped)
//   calm  → nothing new
// One mascot animates at a time (mascot-ui/stage.ts); the package arrives lazily (import() in the wrapper),
// pauses while hidden or off-screen and shows a static pose under reduced motion. Decorative (aria-hidden):
// the card's status line says the same for screen readers.

export type BunnyMood = 'hello' | 'sniff' | 'joy' | 'calm'

const SCENE: Record<BunnyMood, Scene | null> = { hello: 'greet', sniff: 'alert', joy: 'jump', calm: null }
/** pause between two sniffs while a link takes long */
const SNIFF_BREATH_MS = 450
/** the bunny's width in px (its feet sit at 95 % of its height, on the capsule's edge) */
const BUNNY_PX = 104
const MoveMoment = lazy(() => import('../mascot-ui/MoveMoment'))

export interface BunnyPeekProps {
  mood: BunnyMood
  /** what Pompon says right now (null = no bubble) */
  says?: string | null
  className?: string
  joyScene?: Scene
  /** the line goes by itself soon (a cheer): a copy of the screen (features/nav/tabCopies.ts) leaves it out */
  momentary?: boolean
}

export function BunnyPeek({ mood, says = null, className, joyScene = 'jump', momentary = false }: BunnyPeekProps) {
  const bunny = useRef<MascotHandle | null>(null)
  const moodRef = useRef(mood)
  const joySceneRef = useRef(joyScene)
  const chasingRef = useRef(false)
  const pending = useRef<Scene | null>(null)
  const requested = useRef<{ handle: MascotHandle; scene: Scene } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reduced = useReducedMotionPref()
  const bouncy = useSpring('bouncy')
  const shown = useBunniesShown()
  const [longLoading, setLongLoading] = useState(false)
  useEffect(() => {
    if (mood !== 'sniff') return
    const delay = setTimeout(() => setLongLoading(true), 1500)
    return () => { clearTimeout(delay); setLongLoading(false) }
  }, [mood])
  // the celery chase is still in the gallery (inGallery.ts): until then Pompon keeps sniffing while the link loads
  const chasing = playsInApp('chase') && mood === 'sniff' && longLoading && !reduced && shown

  useEffect(() => {
    moodRef.current = mood
    joySceneRef.current = joyScene
    chasingRef.current = chasing
  })

  const currentScene = () => moodRef.current === 'joy' ? joySceneRef.current : SCENE[moodRef.current]
  const requestCurrentScene = useCallback(() => {
    const scene = moodRef.current === 'joy' ? joySceneRef.current : SCENE[moodRef.current]
    if (!scene || chasingRef.current || !bunny.current?.instance) return
    if (requested.current?.handle === bunny.current && requested.current.scene === scene) return
    requested.current = { handle: bunny.current, scene }
    if (bunny.current?.instance?.busy) pending.current = scene
    else void bunny.current?.play(scene)
  }, [])

  useEffect(() => {
    // This controller is the only source of scene requests. A simultaneous `scene` prop
    // also used to play joy, and a queued joy could leak into a later calm/loading state.
    if (timer.current) clearTimeout(timer.current)
    pending.current = null
    if (!shown || reduced || chasing || mood === 'calm') { requested.current = null; return }
    requestCurrentScene()
  }, [mood, joyScene, chasing, shown, reduced, requestCurrentScene])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function onSceneEnd(ended: Scene) {
    if (timer.current) clearTimeout(timer.current)
    const next = pending.current
    pending.current = null
    if (chasingRef.current) return
    // the package reports the end while it still counts as busy: start the next one right after
    if (next && next === currentScene()) timer.current = setTimeout(() => {
      if (next === currentScene() && !chasingRef.current) void bunny.current?.play(next)
    }, 0)
    else if (ended === 'alert' && moodRef.current === 'sniff') {
      timer.current = setTimeout(() => {
        if (moodRef.current === 'sniff') void bunny.current?.play('alert')
      }, SNIFF_BREATH_MS)
    }
  }

  // "Kaninchen zeigen" off or animations off (Settings, src/motion/level.ts): no Pompon and no bubble
  if (!shown) return null
  if (reduced) return says ? <p data-bunny-status className={cn('t-subhead text-text-2', className)}>{says}</p> : null

  return (
    <div aria-hidden="true" data-bunny-peek={mood} className={cn('wish-seat relative flex items-end gap-1 pl-3', className)}>
      <div className="relative shrink-0" style={{ width: BUNNY_PX, height: Math.round(BUNNY_PX * 0.65) }}>
        {/* feet (y = 246 of the 260 viewBox) on the capsule's top edge */}
        {chasing ? <div className="absolute bottom-0 left-0 h-30 w-55 origin-bottom-left scale-[0.55]">
          <Suspense fallback={null}><MoveMoment kind="chase" loop momentClass="illustration" className="h-full w-full" /></Suspense>
        </div> : <Mascot kind="bunny" size={BUNNY_PX} ref={bunny} onReady={requestCurrentScene} onSceneEnd={onSceneEnd} earTargets className="absolute -bottom-[3px] left-0" />}
      </div>
      <div className="relative mb-5 min-w-0 flex-1">
        <AnimatePresence mode="popLayout" initial={false}>
          {says ? (
            <m.p
              key={says}
              data-copy-hide={momentary ? '' : undefined}
              className="wish-bubble glass-float relative inline-block max-w-full rounded-[18px] px-3.5 py-2 t-subhead font-semibold text-text"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduced ? { opacity: 0, transition: fade } : { opacity: 0, scale: 0.92, transition: fade }}
              transition={reduced ? fade : { ...bouncy, opacity: fade }}
            >
              {says}
            </m.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}
