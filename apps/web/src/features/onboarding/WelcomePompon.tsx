import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { ACTIVE_STORAGE_PREFIX } from '../../lib/app'
import { haptic } from '../../lib/haptics'
import { cn } from '../../ui/cn'
import { useReducedMotionPref } from '../../ui/motion'
import { Mascot, type MascotHandle } from '../mascot-ui/Mascot'
import { useMascotMotion } from '../mascot-ui/mascotMotion'
import type { AnyMascotInstance } from '../mascot-ui/stage'
import {
  DUR,
  EASE,
  LID_KEYFRAMES,
  OUTFITS,
  confettiKeyframes,
  dress,
  earWiggleKeyframes,
  flightKeyframes,
  heartKeyframes,
  ownPaws,
  settle,
  type Outfit,
} from './pompon'
import './welcome.css'

// Pompon on the welcome screens (Felix 25.10; approved in the mascot gallery, docs/handoffs/2026-10-25-welcome-
// gallery.md). One puppet (fawn, lop ears) sits on the card's top edge for all steps and changes what he wears or
// holds: nothing (greeting), the gift box (wish step), a costume for the occasion card (party hat, Santa hat,
// flower, envelope). A lazy chunk of /welcome; the package itself loads through the Mascot wrapper.
// - Tap or Enter: "pet Pompon" — happy eyes, blush, ears wiggle, ≤ 3 hearts; one reaction per 0.65 s.
// - catchWish(): a copy of the tapped bubble flies into the box, the lid bounces, he hops, a little confetti.
// - Calm (reduced motion: OS or "Weniger Bewegung"): nothing flies, no confetti, no wiggle; one heart fades in place.
// - "Kaninchen zeigen" off / motion level off: no Pompon at all (the steps work without him).
// Effects are drawn in a fixed, click-through layer on <body>, so no transformed ancestor can shift them.

export interface PomponHandle {
  /** the same as a tap on Pompon */
  pet: () => void
  /** a wish bubble goes into the box; resolves when it landed (at once when calm or without Pompon) */
  catchWish: (from: HTMLElement) => Promise<void>
  /** the end of the onboarding: a happy hop and confetti from above his head */
  celebrate: () => void
}

export interface WelcomePomponProps {
  outfit: Outfit
  /** the puppet's width in px */
  size: number
  /** accessible name of the tap target ("Pompon streicheln") */
  label: string
  /** a pet reaction started (the hint "psst …" goes away) */
  onPet?: () => void
  className?: string
  style?: CSSProperties
  ref?: Ref<PomponHandle>
}

/** The greeting wave plays once per visit (same flag as the welcome show before: docs/storage-registry.md). */
const GREETED_KEY = `${ACTIVE_STORAGE_PREFIX}welcomeSeen.onboarding`
const PET_GAP_MS = 650
const MAX_HEARTS = 3
const MAX_BURSTS = 2
const CONFETTI = ['#6C8CFF', '#FF7A9A', '#FFD166', '#7FD1AE', '#F0A04B']
const HEART = 'M12 21C5 15 1 11 1 6.5 1 3.4 3.4 1 6.5 1c2.1 0 4.1 1.2 5.5 3 1.4-1.8 3.4-3 5.5-3C20.6 1 23 3.4 23 6.5 23 11 19 15 12 21Z'

function greetedThisVisit(): boolean {
  try {
    if (window.sessionStorage.getItem(GREETED_KEY) === '1') return true
    window.sessionStorage.setItem(GREETED_KEY, '1')
  } catch {
    /* storage blocked: he simply waves again next time */
  }
  return false
}

const centre = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })

export default function WelcomePompon({ outfit, size, label, onPet, className, style, ref }: WelcomePomponProps) {
  const { shown } = useMascotMotion()
  const calm = useReducedMotionPref()
  const mascot = useRef<MascotHandle | null>(null)
  const fx = useRef<HTMLDivElement>(null)
  const [readyCount, setReadyCount] = useState(0)
  const live = useRef(new Set<Animation>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const lastPet = useRef(-Infinity)
  const hearts = useRef(0)
  const bursts = useRef(0)
  const seed = useRef(1)
  const worn = useRef<{ puppet: AnyMascotInstance | null; group: SVGGElement | null; outfit: Outfit }>({ puppet: null, group: null, outfit: 'none' })
  const onPetRef = useRef(onPet)
  useEffect(() => {
    onPetRef.current = onPet
  })

  useEffect(() => {
    const running = live.current
    const pending = timers.current
    return () => {
      running.forEach((animation) => animation.cancel())
      pending.forEach(clearTimeout)
    }
  }, [])

  const puppet = (): AnyMascotInstance | null => {
    const instance = mascot.current?.instance ?? null
    return instance && !instance.isDestroyed ? instance : null
  }
  const track = (animation: Animation): Animation => {
    live.current.add(animation)
    settle(animation, () => live.current.delete(animation))
    return animation
  }
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      run()
    }, ms)
    timers.current.add(timer)
  }
  const happy = (ms: number) => {
    const b = puppet()
    if (!b) return
    b.setEyes('happy')
    later(() => puppet()?.setEyes('normal'), ms)
  }

  function confetti(at: { x: number; y: number }) {
    const layer = fx.current
    if (calm || !layer || bursts.current >= MAX_BURSTS) return
    bursts.current += 1
    const pieces: Animation[] = []
    const burst = seed.current++
    for (let i = 0; i < 14; i++) {
      const piece = document.createElement('i')
      const round = i % 3 === 0
      piece.style.cssText = `position:absolute;left:${at.x - 4}px;top:${at.y - 3}px;width:${round ? 7 : 9}px;height:${round ? 7 : 5}px;border-radius:${round ? '50%' : '2px'};background:${CONFETTI[i % CONFETTI.length]}`
      layer.append(piece)
      const animation = track(piece.animate(confettiKeyframes(burst * 31 + i), { duration: 900 + (i % 4) * 60, easing: 'linear', fill: 'forwards' }))
      settle(animation, () => piece.remove())
      pieces.push(animation)
    }
    void Promise.allSettled(pieces.map((piece) => piece.finished)).then(() => {
      bursts.current -= 1
    })
  }

  function pet() {
    const now = performance.now()
    if (now - lastPet.current < PET_GAP_MS) return // one reaction at a time, never stacked
    lastPet.current = now
    onPetRef.current?.()
    haptic('tap')
    const b = puppet()
    if (!b) return
    b.setEyes('happy')
    b.setPuff(1.12)
    later(() => {
      const still = puppet()
      still?.setEyes('normal')
      still?.setPuff(1)
    }, 1100)
    // the blush deepens and fades back (opacity only)
    for (const blush of b.root.querySelectorAll('.tf > ellipse')) {
      track(blush.animate([{ opacity: 0.3 }, { opacity: 0.85, offset: 0.3 }, { opacity: 0.85, offset: 0.7 }, { opacity: 0.3 }], { duration: 1300, easing: 'ease-in-out' }))
    }
    if (!calm) {
      const left = b.root.querySelector('.lop .ear-l')
      const right = b.root.querySelector('.lop .ear-r')
      if (left) track(left.animate(earWiggleKeyframes(9), { duration: 700, easing: 'ease-in-out' }))
      if (right) track(right.animate(earWiggleKeyframes(-9), { duration: 700, easing: 'ease-in-out', delay: 60 }))
    }
    // hearts from his head: at most three alive; calm = one heart fading in place
    const head = b.root.querySelector('.tf')
    const layer = fx.current
    if (!head || !layer) return
    const at = centre(head.getBoundingClientRect())
    const count = calm ? 1 : 3
    for (let i = 0; i < count && hearts.current < MAX_HEARTS; i++) {
      hearts.current += 1
      const heart = document.createElement('div')
      const w = 18 + (i % 2) * 6
      heart.style.cssText = `position:absolute;left:${at.x - 10 + (i - 1) * 18}px;top:${at.y - 70}px`
      heart.innerHTML = `<svg viewBox="0 0 24 22" width="${w}" height="${w - 2}"><path d="${HEART}" fill="${i === 1 ? '#FF7A9A' : '#FF9EB0'}"/></svg>`
      layer.append(heart)
      const frames: Keyframe[] = calm ? [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }] : heartKeyframes(i)
      const animation = track(heart.animate(frames, { duration: calm ? 1200 : 1300 + i * 120, delay: calm ? 0 : i * 110, easing: EASE.smooth, fill: 'backwards' }))
      settle(animation, () => {
        heart.remove()
        hearts.current -= 1
      })
    }
  }

  function landed(lid: SVGGElement | null) {
    haptic('select')
    happy(900)
    if (calm || !lid) return
    // the lid pops up and settles on the bouncy spring (restarts when another wish lands meanwhile)
    lid.getAnimations().forEach((animation) => animation.cancel())
    track(lid.animate(LID_KEYFRAMES, { duration: 560, easing: EASE.bouncy }))
    void mascot.current?.hop()
    const at = centre(lid.getBoundingClientRect())
    confetti({ x: at.x, y: at.y - 6 })
  }

  async function catchWish(from: HTMLElement): Promise<void> {
    const b = puppet()
    const lid = b?.root.querySelector<SVGGElement>('.pp-lid') ?? null
    const layer = fx.current
    if (calm || !lid || !layer) {
      landed(lid)
      return
    }
    const start = from.getBoundingClientRect()
    const end = centre(lid.getBoundingClientRect())
    // a copy of the bubble flies; the bubble itself stays (it shows the check)
    const ghost = from.cloneNode(true) as HTMLElement
    ghost.removeAttribute('id')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.setAttribute('tabindex', '-1')
    ghost.style.cssText = `position:absolute;left:${start.left}px;top:${start.top}px;width:${start.width}px;height:${start.height}px;margin:0;transform-origin:center`
    layer.append(ghost)
    const from0 = centre(start)
    const flight = track(ghost.animate(flightKeyframes(end.x - from0.x, end.y - from0.y - 6), { duration: 720, fill: 'forwards' }))
    const done = await flight.finished.then(() => true, () => false)
    ghost.remove()
    if (done) landed(lid)
  }

  function celebrate() {
    haptic('success')
    if (calm) return
    void mascot.current?.hop()
    const head = puppet()?.root.querySelector('.tf')
    // from above his head, so the confetti never covers his face
    if (head) {
      const at = centre(head.getBoundingClientRect())
      confetti({ x: at.x, y: at.y - 58 })
    }
  }

  useImperativeHandle(ref, () => ({ pet, catchWish, celebrate }))

  // ---- what he wears / holds: the old thing pops off (snappy), the new one drops on (bouncy) -------------
  useEffect(() => {
    const b = puppet()
    if (!b) return
    const state = worn.current
    if (state.puppet !== b) {
      // a new puppet (first mount, or mounted again after "Kaninchen zeigen"): nothing is worn yet
      worn.current = { puppet: b, group: null, outfit: 'none' }
      if (outfit === 'none' && !calm && !greetedThisVisit()) void mascot.current?.play('greet')
    }
    if (outfit === worn.current.outfit) return
    const old = worn.current.group
    const holds = (o: Outfit) => o !== 'none' && OUTFITS[o].held
    // paws: the holding paws replace his own at once; his own come back once the held thing has left
    if (holds(outfit)) ownPaws(b, false)
    const pawsBack = () => {
      if (puppet() === b && !holds(worn.current.outfit)) ownPaws(b, true)
    }
    const group = outfit === 'none' ? null : dress(b, outfit)
    worn.current = { puppet: b, group, outfit }
    if (old) {
      if (calm) {
        old.remove()
        pawsBack()
      } else {
        const off = track(old.animate([{ transform: 'translateY(0px)', opacity: 1 }, { transform: 'translateY(-26px) scale(.9)', opacity: 0 }], { duration: DUR.snappy, easing: EASE.snappy, fill: 'forwards' }))
        settle(off, () => {
          old.remove()
          pawsBack()
        })
      }
    } else {
      pawsBack()
    }
    if (group) {
      group.style.transformBox = 'fill-box'
      group.style.transformOrigin = '50% 100%'
      track(
        group.animate(
          calm
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ transform: 'translateY(-46px) scale(.9)', opacity: 0 }, { transform: 'translateY(-46px) scale(.9)', opacity: 1, offset: 0.15 }, { transform: 'translateY(0px) scale(1)', opacity: 1 }],
          { duration: calm ? 250 : 620, easing: calm ? 'ease-out' : EASE.bouncy },
        ),
      )
    }
    // a costume is the person's choice: he is happy about it and hops
    if (outfit !== 'none' && outfit !== 'box') {
      happy(800)
      if (!calm) later(() => void mascot.current?.hop(), 280)
    }
    // puppet() and the helpers read refs only; a new puppet arrives with readyCount
  }, [outfit, readyCount, calm])

  if (!shown) return null
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        data-testid="welcome-pompon"
        data-outfit={outfit}
        className={cn('wl-pompon', className)}
        style={style}
        onClick={pet}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            pet()
          }
        }}
      >
        {/* wear={false}: here he wears the step's own costume (party hat, Santa hat …), never the season's outfit too */}
        <Mascot ref={mascot} kind="bunny" coat="fawn" ears="lop" size={size} momentClass="illustration" wear={false} onReady={() => setReadyCount((count) => count + 1)} />
      </div>
      {createPortal(<div ref={fx} aria-hidden="true" className="wl-fx" />, document.body)}
    </>
  )
}
