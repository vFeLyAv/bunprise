import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { haptic, IconBack, IconForward } from '../../../ui'

// The pictures of a game (design 26.10 §3, Felix: «заходишь, проигрывается анимация и ты можешь листнуть влево и
// там будет еще фотка настоящей игры»): slide 1 = our drawing / animation, slide 2 = the real photo. The track
// follows the finger 1:1 (a little resistance past the ends), a release past 40 px or a quick flick switches;
// also the arrows, the dots and ←/→. One slide: no arrows, no dots. Reduced motion: the spring tokens are 0 ms,
// so the switch is instant (topics.css). Only transform moves.

export interface CarouselSlide {
  key: string
  /** what the dot and the screen reader call it ("Zeichnung", "Foto") */
  label: string
  node: ReactNode
  kind: 'drawing' | 'photo'
}

const SWITCH_PX = 40
const FLICK_PX_PER_MS = 0.5

export function GameCarousel({ name, slides }: { name: string; slides: readonly CarouselSlide[] }) {
  const { t } = useTranslation('gifts')
  const [index, setIndex] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const down = useRef<{ x: number; t: number; id: number } | null>(null)
  const count = slides.length
  const at = Math.min(index, count - 1)
  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next))
    if (clamped !== at) haptic('select')
    setIndex(clamped)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') go(at + 1)
    else if (event.key === 'ArrowLeft') go(at - 1)
    else return
    event.preventDefault()
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (count < 2 || event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    down.current = { x: event.clientX, t: event.timeStamp, id: event.pointerId }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag(0)
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = down.current
    if (!start || event.pointerId !== start.id) return
    let dx = event.clientX - start.x
    if ((at === 0 && dx > 0) || (at === count - 1 && dx < 0)) dx *= 0.3
    setDrag(dx)
  }
  function release(event: PointerEvent<HTMLDivElement>) {
    const start = down.current
    if (!start || event.pointerId !== start.id) return
    const dx = event.clientX - start.x
    const fast = Math.abs(dx) / Math.max(1, event.timeStamp - start.t) > FLICK_PX_PER_MS
    down.current = null
    setDrag(null)
    if (dx < -SWITCH_PX || (fast && dx < -10)) go(at + 1)
    else if (dx > SWITCH_PX || (fast && dx > 10)) go(at - 1)
  }

  const transform = drag === null ? `translateX(${-at * 100}%)` : `translateX(calc(${-at * 100}% + ${drag}px))`
  return (
    <div className="flex flex-col">
      <div
        className="topic-carousel"
        role="group"
        aria-roledescription={t('topics.carousel_role')}
        aria-label={t('topics.carousel_label', { name })}
        tabIndex={count > 1 ? 0 : -1}
        data-dragging={drag === null ? undefined : ''}
        data-swipe-own=""
        onKeyDown={count > 1 ? onKeyDown : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <div className="topic-carousel-track" style={{ transform }}>
          {slides.map((slide, i) => (
            <div
              key={slide.key}
              className="topic-slide"
              data-kind={slide.kind}
              role="group"
              aria-roledescription={t('topics.slide_role')}
              aria-label={slide.label}
              aria-hidden={i !== at}
            >
              {slide.node}
            </div>
          ))}
        </div>
        {count > 1 ? (
          <>
            <button type="button" className="topic-carousel-btn" data-side="prev" data-off={at === 0 ? '' : undefined} aria-hidden={at === 0} tabIndex={at === 0 ? -1 : 0} aria-label={t('topics.slide_prev')} onClick={() => go(at - 1)}>
              <IconBack size={22} />
            </button>
            <button type="button" className="topic-carousel-btn" data-side="next" data-off={at >= count - 1 ? '' : undefined} aria-hidden={at >= count - 1} tabIndex={at >= count - 1 ? -1 : 0} aria-label={t('topics.slide_next')} onClick={() => go(at + 1)}>
              <IconForward size={22} />
            </button>
          </>
        ) : null}
      </div>
      {count > 1 ? (
        <div className="topic-dots" role="tablist" aria-label={t('topics.slides_label')}>
          {slides.map((slide, i) => (
            <button key={slide.key} type="button" role="tab" aria-selected={i === at} tabIndex={i === at ? 0 : -1} aria-label={slide.label} onClick={() => go(i)}>
              <i />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
