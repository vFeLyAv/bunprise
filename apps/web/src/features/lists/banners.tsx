import type { ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { cn, fade } from '../../ui'
import { BANNER_KEYS, type BannerKey } from '../../lib/api/lists.types'

// The profile banner (follows-design §2.2, M1: `profiles.banner` = one of eight keys, no upload): five soft
// gradients of the Paper palette and three patterns (bunnies, carrots, confetti) — CSS and inline SVG only
// (lists.css), nothing is loaded. No banner chosen → one is derived from the profile id, like the tint of an
// avatar, so every person has a stable banner from the first day. Reduced transparency → one solid colour.
// Since 20261024120000 a person may also show their OWN banner photo: it lies over the preset (the `photo` slot,
// features/profilePhotos) and the preset stays the fallback underneath.

export const GRADIENT_BANNERS: readonly BannerKey[] = ['sunrise', 'meadow', 'sky', 'berry', 'dusk']
export const PATTERN_BANNERS: readonly BannerKey[] = ['bunnies', 'carrots', 'confetti']

/** FNV-1a over the id → one of the eight presets (stable on every device). */
export function derivedBanner(profileId: string): BannerKey {
  let hash = 0x811c9dc5
  for (let i = 0; i < profileId.length; i += 1) {
    hash ^= profileId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return BANNER_KEYS[(hash >>> 0) % BANNER_KEYS.length] ?? 'sunrise'
}

/** The banner a person shows: the chosen one, else the derived one. */
export function bannerOf(chosen: BannerKey | null, profileId: string): BannerKey {
  return chosen ?? derivedBanner(profileId)
}

export interface BannerArtProps {
  banner: BannerKey
  /** a new banner fades in over the old one (the header after a choice); swatches stay still */
  animate?: boolean
  className?: string
  /**
   * the person's own banner photo over the preset (features/profilePhotos BannerPhoto, 20261024120000): it lies over
   * the art, under the banner's own children (the edit button)
   */
  photo?: ReactNode
  children?: ReactNode
}

/** The banner surface (decorative): gradient or pattern by data attribute, styled in lists.css. */
export function BannerArt({ banner, animate = false, className, photo, children }: BannerArtProps) {
  return (
    <div className={cn('lb-banner', className)}>
      {animate ? (
        <AnimatePresence initial={false}>
          <m.span
            key={banner}
            aria-hidden="true"
            data-banner={banner}
            className="lb-art"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            // the old banner stays under the new one until it has faded in, then it goes
            exit={{ opacity: 1, transition: { duration: 0.24 } }}
            transition={{ ...fade, duration: 0.24 }}
          />
        </AnimatePresence>
      ) : (
        <span aria-hidden="true" data-banner={banner} className="lb-art" />
      )}
      {photo}
      {children}
    </div>
  )
}
