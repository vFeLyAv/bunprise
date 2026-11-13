// The hero cover's geometry — ONE place for the CSS (HeroCover sets these as custom properties) and for the
// contrast proof (coverContrast.test.ts). The cover dissolves into the page over its last COVER_FADE_PX
// (a linear mask); the day pill and the title overlap the cover's lower edge by COVER_OVERLAP_PX. Their
// distances below decide how much photo can be under the text: the title's line box starts only
// TITLE_INTO_COVER_PX above the cover's end, where at most MAX_PHOTO_ALPHA_UNDER_TITLE of the photo is left —
// so even a black photo keeps the title above AA. The pill has its own near-opaque glass.

/**
 * The cover's crop (CSS --occ-cover-ratio on the hero, --of-photo-ratio on the form's preview): ONE value, so the
 * form shows the photo exactly as the occasion screen will cut it (a wide photo loses its sides in both).
 */
export const COVER_ASPECT_RATIO = '1 / 1.08'

/** px of the cover's lower part that the pill + title block overlaps (CSS --occ-cover-overlap). */
export const COVER_OVERLAP_PX = 88
/** px over which the cover fades out at the bottom (CSS --occ-cover-fade). */
export const COVER_FADE_PX = 140
/** The hero column's gap (OccasionHero: gap-5). */
export const HERO_GAP_PX = 20
/** The day pill's height (h-8). */
export const DAY_PILL_PX = 32
/** The title block's gap between pill and title (gap-3). */
export const TITLE_GAP_PX = 12

/** How far the title's line box reaches up into the cover. */
export const TITLE_INTO_COVER_PX = COVER_OVERLAP_PX - HERO_GAP_PX - DAY_PILL_PX - TITLE_GAP_PX
/** The pill's top edge, measured up from the cover's end. */
export const PILL_INTO_COVER_PX = COVER_OVERLAP_PX - HERO_GAP_PX

/** The photo's remaining opacity `px` above the cover's end (1 above the fade). */
export function photoAlphaAt(px: number): number {
  return Math.max(0, Math.min(1, px / COVER_FADE_PX))
}

/** The most photo there can be under the title text. */
export const MAX_PHOTO_ALPHA_UNDER_TITLE = photoAlphaAt(TITLE_INTO_COVER_PX)
/** The most photo there can be under the day pill. */
export const MAX_PHOTO_ALPHA_UNDER_PILL = photoAlphaAt(PILL_INTO_COVER_PX)
/** The share of --surface in the glass of the pills on the cover (CSS: color-mix … 88 %). */
export const COVER_PILL_SURFACE = 0.88
