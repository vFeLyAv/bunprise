import { useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { WishPriority } from '../../lib/api/types'
import { cn, fade, haptic, useReducedMotionPref, useSpring } from '../../ui'
import { HeartGlyph } from './HeartGlyph'
import { IconHeart } from './icons'
import './wishes.css'

// "Wie sehr?" (K7) — the wish-o-meter: a chunky track with three detents (Kann · Gern · Unbedingt = priority
// 1 · 2 · 3, default 2) and a thumb that carries a little heart. The heart reacts to every level: calm and
// small (Kann), happy (Gern), big, hopping and bursting into tiny hearts (Unbedingt).
// - Finger / mouse: tap anywhere on the track (or a label) → the thumb springs to that detent; drag → the
//   thumb follows the finger 1:1, each detent it crosses ticks (haptic 'select') and the heart changes at
//   once; let go → it snaps to the nearest detent (bouncy spring). A vertical swipe that the browser turns
//   into a scroll (pointercancel) puts the level back. touch-action: pan-y keeps the page scrollable.
// - Keyboard + screen readers: a real <input type="range" min=1 max=3> under the track (visually hidden,
//   focusable, named by the visible "Wie sehr?" heading, aria-valuetext = the level word): arrows,
//   Home / End, Page Up / Down; VoiceOver / TalkBack adjust it with their own gestures.
// - Motion: CSS transforms with the spring tokens (thumb, fill), the heart's scale / hop and the burst with
//   the springs of src/motion/springs.ts; reduced motion → no hop, no burst, instant moves.

const LEVELS: readonly WishPriority[] = [1, 2, 3]
/** thumb radius + inset = the detents' distance to the ends (= --pad in wishes.css) */
const PAD_PX = 28
/** px a press may wander before it counts as a drag (a tap below that) */
const DRAG_SLOP_PX = 4

const position = (level: WishPriority) => (level - 1) / 2
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const toLevel = (t: number) => (Math.round(clamp01(t) * 2) + 1) as WishPriority

function stepped(level: WishPriority, step: number): WishPriority {
  return Math.min(3, Math.max(1, level + step)) as WishPriority
}

export interface WishOMeterProps {
  value: WishPriority
  onChange: (value: WishPriority) => void
  /** id of the visible heading that names the control ("Wie sehr?") */
  labelledBy: string
  className?: string
}

interface Press {
  pointerId: number
  startX: number
  startValue: WishPriority
  level: WishPriority
  moved: boolean
}

export function WishOMeter({ value, onChange, labelledBy, className }: WishOMeterProps) {
  const { t } = useTranslation('wishes')
  const reduced = useReducedMotionPref()
  const trackRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const press = useRef<Press | null>(null)
  /** the thumb's place while a finger drags it (0 … 1); null = at the detent of `value` */
  const [dragAt, setDragAt] = useState<number | null>(null)
  // the burst plays when "Unbedingt" is reached (not when a screen opens with it already set)
  const [burst, setBurst] = useState(0)
  const previous = useRef(value)
  useEffect(() => {
    if (value === 3 && previous.current !== 3 && !reduced) setBurst((n) => n + 1)
    previous.current = value
  }, [value, reduced])

  function choose(level: WishPriority) {
    if (level === value) return
    haptic('select')
    onChange(level)
  }

  /** Where on the track a pointer is (0 … 1). Works in the zoomed dev frame too (visual ÷ layout width). */
  function trackPosition(clientX: number): number {
    const track = trackRef.current
    if (!track) return position(value)
    const rect = track.getBoundingClientRect()
    const scale = track.offsetWidth > 0 ? rect.width / track.offsetWidth : 1
    const pad = PAD_PX * scale
    return clamp01((clientX - rect.left - pad) / Math.max(1, rect.width - 2 * pad))
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || press.current) return
    event.preventDefault() // no text selection, no focus jump; the range input takes the focus instead
    inputRef.current?.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    press.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value, level: value, moved: false }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = press.current
    if (!current || current.pointerId !== event.pointerId) return
    if (!current.moved && Math.abs(event.clientX - current.startX) < DRAG_SLOP_PX) return
    current.moved = true
    const at = trackPosition(event.clientX)
    setDragAt(at)
    const level = toLevel(at)
    if (level !== current.level) {
      current.level = level
      choose(level)
    }
  }

  function finish(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const current = press.current
    if (!current || current.pointerId !== event.pointerId) return
    press.current = null
    setDragAt(null)
    if (cancelled) {
      // the browser took the gesture (a scroll): the level the person had before
      if (current.moved && current.startValue !== value) onChange(current.startValue)
      return
    }
    if (!current.moved) choose(toLevel(trackPosition(event.clientX)))
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? stepped(value, 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? stepped(value, -1)
          : event.key === 'Home' || event.key === 'PageDown'
            ? 1
            : event.key === 'End' || event.key === 'PageUp'
              ? 3
              : null
    if (next === null) return
    event.preventDefault() // the same step everywhere (browsers differ in what a range input does natively)
    choose(next)
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    const next = Number(event.target.value)
    if (next === 1 || next === 2 || next === 3) choose(next)
  }

  const t01 = dragAt ?? position(value)
  const style = { '--t': String(t01) } as CSSProperties
  const word = t(`wish.priority_${value}`)

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        className="wish-meter relative"
        data-level={value}
        data-dragging={dragAt !== null ? '' : undefined}
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finish(event, false)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
      >
        <div ref={trackRef} className="wish-meter-track" data-meter-track="">
          <span aria-hidden="true" className="wish-meter-fill" />
          {LEVELS.map((level) => (
            <span
              key={level}
              aria-hidden="true"
              className="wish-meter-detent"
              style={{ left: `calc(${PAD_PX}px + ${position(level)} * (100% - ${2 * PAD_PX}px))` }}
            />
          ))}
        </div>
        <div aria-hidden="true" className="wish-meter-carrier" style={{ height: 56 }}>
          {burst > 0 ? <HeartBurst key={burst} /> : null}
          <span className="wish-meter-thumb">
            <HeartFace level={value} reduced={reduced} />
          </span>
        </div>
        <input
          ref={inputRef}
          type="range"
          min={1}
          max={3}
          step={1}
          value={value}
          aria-labelledby={labelledBy}
          aria-valuetext={word}
          aria-describedby={hintId}
          className="wish-meter-input"
          onKeyDown={onKeyDown}
          onChange={onInputChange}
        />
      </div>

      {/* pointer convenience: the words under the detents are tappable too (keyboard users have the slider) */}
      <div aria-hidden="true" className="relative flex justify-between px-1 t-subhead">
        {LEVELS.map((level) => (
          <span
            key={level}
            data-meter-label={level}
            className={cn(
              'hit-expand cursor-pointer select-none tr-colors',
              level === value ? 'font-semibold text-text' : 'text-text-2',
            )}
            onClick={() => choose(level)}
          >
            {t(`wish.priority_${level}`)}
          </span>
        ))}
      </div>
      <MeterHint id={hintId} level={value} reduced={reduced} />
    </div>
  )
}

/** One line that says what the level means; it crossfades (and rises a little) when the level changes. */
function MeterHint({ id, level, reduced }: { id: string; level: WishPriority; reduced: boolean }) {
  const { t } = useTranslation('wishes')
  const smooth = useSpring('smooth')
  return (
    <p id={id} className="relative min-h-(--lh-subhead) t-subhead text-text-2">
      <m.span
        key={level}
        className="block"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? fade : { ...smooth, opacity: fade }}
      >
        {t(`wish.meter_hint_${level}`)}
      </m.span>
    </p>
  )
}

const SCALE: Record<WishPriority, number> = { 1: 0.84, 2: 1, 3: 1.14 }

/** The heart in the thumb: its face (and size) is the level. Decorative (the slider says the level). */
function HeartFace({ level, reduced }: { level: WishPriority; reduced: boolean }) {
  const bouncy = useSpring('bouncy')
  return (
    <m.span
      className="grid place-items-center"
      animate={{ scale: SCALE[level] }}
      transition={reduced ? { duration: 0 } : bouncy}
    >
      <m.span
        key={level}
        className="grid place-items-center"
        // a little wiggle on every change; "Unbedingt" hops
        initial={reduced ? false : level === 3 ? { y: -12, rotate: -8 } : { rotate: level === 1 ? -10 : 10 }}
        animate={{ y: 0, rotate: 0 }}
        transition={reduced ? { duration: 0 } : bouncy}
      >
        {/* colours: data-part rules in wishes.css (presentation attributes cannot read tokens) */}
        <HeartGlyph level={level} size={34} />
      </m.span>
    </m.span>
  )
}

/** Where the tiny hearts fly (px from the thumb's centre) and how big they are. */
const SPARKS: ReadonlyArray<{ x: number; y: number; size: number; rotate: number }> = [
  { x: -38, y: -30, size: 12, rotate: -20 },
  { x: -16, y: -48, size: 10, rotate: -8 },
  { x: 10, y: -52, size: 14, rotate: 6 },
  { x: 34, y: -36, size: 11, rotate: 18 },
  { x: 46, y: -8, size: 9, rotate: 24 },
  { x: -48, y: -6, size: 9, rotate: -24 },
]

/** "Unbedingt": a handful of tiny hearts jumps out of the thumb and fades (transform + opacity only). */
function HeartBurst() {
  const bouncy = useSpring('bouncy')
  return (
    <span className="wish-burst" data-burst="">
      {SPARKS.map((spark, index) => (
        <m.span
          key={index}
          className="absolute left-0 top-0 block"
          style={{ marginLeft: -spark.size / 2, marginTop: -spark.size / 2 }}
          initial={{ x: 0, y: 0, scale: 0.3, opacity: 1, rotate: 0 }}
          animate={{ x: spark.x, y: spark.y, scale: 1, opacity: 0, rotate: spark.rotate }}
          transition={{ ...bouncy, delay: index * 0.02, opacity: { ...fade, duration: 0.42, delay: 0.32 + index * 0.02 } }}
        >
          <IconHeart size={spark.size} />
        </m.span>
      ))}
    </span>
  )
}
