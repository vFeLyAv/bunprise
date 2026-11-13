import { useEffect, useState } from 'react'
import { cn } from '../../../ui'
import { CROPS, cachedCoverMarkup, loadCoverMarkup, type CoverCrop } from './art'
import type { ThemeId } from './themes'
import './covers.css'

// One cover motif as an inline <svg>: decorative (the occasion's title says what it is), filling its box like a
// cover photo. The drawing is our own code (art/<motif>.ts — no text, no links, no ids, nothing loaded from
// anywhere), so it can be put into the DOM as markup. It fades in once its chunk is there; `data-state="loading"`
// until then (the launch screen waits for such boxes, lib/splash.ts — like for a cover photo).

export function CoverArt({ theme, crop = 'cover', className }: { theme: ThemeId; crop?: CoverCrop; className?: string }) {
  const [drawn, setDrawn] = useState<{ theme: ThemeId; markup: string | null } | null>(null)
  const markup = drawn?.theme === theme ? drawn.markup : (cachedCoverMarkup(theme) ?? null)
  // offline before the chunk was cached: the box keeps its tint and stops counting as "loading"
  const failed = drawn?.theme === theme && drawn.markup === null
  useEffect(() => {
    if (markup !== null || failed) return
    let live = true
    loadCoverMarkup(theme).then(
      (next) => {
        if (live) setDrawn({ theme, markup: next })
      },
      () => {
        if (live) setDrawn({ theme, markup: null })
      },
    )
    return () => {
      live = false
    }
  }, [theme, markup, failed])
  return (
    <svg
      className={cn('cv-art', className)}
      viewBox={CROPS[crop]}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      data-cover={theme}
      data-state={markup !== null ? 'ready' : failed ? 'unavailable' : 'loading'}
      // our own drawing (art/kit.ts writes every attribute itself; art.test.ts: no text, links, ids or handlers)
      dangerouslySetInnerHTML={{ __html: markup ?? '' }}
    />
  )
}
