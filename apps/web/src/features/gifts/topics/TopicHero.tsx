import { useLayoutEffect, useRef } from 'react'
import type { GiftTopic } from '../../../lib/api/giftIdeas'
import { categoryArt, CATEGORY_TONE, headerScene } from '../plays/art'
import { BEATS, openTracks } from '../plays/motion'
import { playOnce } from '../plays/run'

// The head of a topic screen: our drawing, the name, a line and "31 Spiele · ca. 6–70 €". "Brettspiele" has its
// own scene with the moment «Кубик» (motion.ts): once when the screen opens, a die rolls in and lands on a six,
// the meeples hop, the cards that are already there rise into place. Reduced motion: the resting scene, no
// animation. Every other topic shows its tile drawing, larger and still.

export interface TopicHeroProps {
  topic: GiftTopic
  title: string
  sub: string
  meta: string | null
  reduced: boolean
}

export function TopicHero({ topic, title, sub, meta, reduced }: TopicHeroProps) {
  const art = useRef<HTMLDivElement>(null)
  // read once: a later change of the reduced setting keeps the scene as it is (the moment belongs to the opening)
  const reducedAtOpen = useRef(reduced)
  const scene = topic === 'brettspiele'
  // the drawing is our own static markup; written once, the moment then only moves its parts
  useLayoutEffect(() => {
    const el = art.current
    if (!el) return undefined
    const withScene = topic === 'brettspiele'
    el.innerHTML = withScene ? headerScene() : categoryArt(topic)
    if (!withScene || reducedAtOpen.current) return undefined
    // the cards of the screen rise with it (those that are there when it opens)
    const screen = el.closest('[data-topic-screen]') ?? el
    const run = playOnce(openTracks(screen), BEATS.end)
    return () => run.stop()
  }, [topic])
  return (
    <section className="topic-hero" data-tone={CATEGORY_TONE[topic]}>
      <div ref={art} className="topic-hero-art" data-plain={scene ? undefined : ''} aria-hidden="true" />
      <div className="topic-hero-text">
        <h1>{title}</h1>
        <p>{sub}</p>
        {meta ? <p className="topic-meta">{meta}</p> : null}
      </div>
    </section>
  )
}
