import type { CSSProperties } from 'react'
import type { TileTone } from '../../../ui'
import { COVER_ASPECT_RATIO, COVER_FADE_PX, COVER_OVERLAP_PX } from '../photo/coverGeometry'
import type { ThemeId } from './themes'
import { CoverArt } from './CoverArt'

// The occasion screen's hero with a motif instead of a photo (a lazy chunk of OccasionHero): the same box as the
// photo (.occ-cover, photo/photo.css — full bleed, dissolving into the paper under the day pill and the title), the
// same geometry (photo/coverGeometry.ts), our own picture in it. A photo always wins (OccasionHero asks only without).

const STYLE = {
  '--occ-cover-overlap': `${COVER_OVERLAP_PX}px`,
  '--occ-cover-fade': `${COVER_FADE_PX}px`,
  '--occ-cover-ratio': COVER_ASPECT_RATIO,
} as CSSProperties

export default function HeroMotif({ theme, tone }: { theme: ThemeId; tone: TileTone }) {
  return (
    <div aria-hidden="true" className="occ-cover occ-motif" data-tint={tone} data-cover={theme} style={STYLE}>
      <CoverArt theme={theme} className="cv-fill" />
    </div>
  )
}
