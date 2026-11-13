import type { ReactNode } from 'react';
import { cn } from './cn';
import { tileTone } from './tile';

/** "Anna Beispiel" → "AB"; single word → first letter; Unicode-safe. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

export interface AvatarProps {
  name: string;
  /** Stable key of the tint — the person's id (profile id), so a person has the same colour on every
   *  screen. Without it the name is hashed. */
  seed?: string;
  /** 24 (inline, feed card) · 32 (rows) · 40 */
  size?: 24 | 32 | 40;
  /** A light ring around it, for avatars that overlap in a stack. */
  ring?: boolean;
  className?: string;
  /** The person's own photo over the initials (features/profilePhotos AvatarPhoto; absolutely positioned). */
  children?: ReactNode;
}

const SIZE = {
  24: 'h-6 w-6 t-caption-2 font-bold',
  32: 'h-8 w-8 text-footnote font-semibold',
  40: 'h-10 w-10 text-subhead font-semibold',
} as const;

/**
 * Initials on a tinted circle; a person's own photo (20261024120000) can lie over them as `children`. The tint
 * (--tile-1…4 with its own ink, ≥ 5:1) comes from a stable hash of `seed` (blocker 20). Decorative: the name is shown
 * as text next to it.
 */
export function Avatar({ name, seed, size = 32, ring = false, className, children }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      data-tile={tileTone(seed ?? name)}
      className={cn(
        'tile relative inline-flex shrink-0 select-none items-center justify-center rounded-full',
        SIZE[size],
        ring && 'ring-2 ring-white',
        className,
      )}
    >
      {initials(name)}
      {children}
    </span>
  );
}
