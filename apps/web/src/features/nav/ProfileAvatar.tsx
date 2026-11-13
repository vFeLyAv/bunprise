import type { CSSProperties, ReactNode } from 'react'
import { cn, initials, tileTone } from '../../ui'
import { GlyphPerson } from './glyphs'

export interface ProfileAvatarProps {
  /** the person's id: the tint is a stable hash of it (the same colour on every screen, ui/tile.ts) */
  seed: string
  /** display name; null while unknown → a person glyph on the same tint */
  name: string | null
  /** px */
  size: number
  className?: string
  style?: CSSProperties
  /** the person's own photo over the initials (features/profilePhotos AvatarPhoto; absolutely positioned) */
  children?: ReactNode
}

/**
 * The initials tile of a person at any size (the kit's Avatar has 32 / 40 only): the tab bar's Profil icon, the
 * headers, people rows. With a profile photo (20261024120000) the photo lies over the initials (children) and fades in;
 * the initials stay underneath, so nothing moves. Decorative — the text next to it names the person.
 */
export function ProfileAvatar({ seed, name, size, className, style, children }: ProfileAvatarProps) {
  const letters = name ? initials(name) : ''
  return (
    <span
      aria-hidden="true"
      data-tile={tileTone(seed)}
      className={cn('tile relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * (letters.length > 1 ? 0.38 : 0.44)), letterSpacing: '-0.01em', ...style }}
    >
      {letters || <GlyphPerson size={Math.round(size * 0.62)} />}
      {children}
    </span>
  )
}
