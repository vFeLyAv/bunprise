import { cn } from './cn';
import type { TileTone } from './tile';
// the .tile class and its tints (styles/tiles.css) come with tile.ts
import './tile';

export interface DateBadgeProps {
  /** The occasion's colour: tileTone(occasion.id) — the same as its tint everywhere. */
  tone: TileTone;
  /** "OKT" (short month, shown in small caps) */
  month: string;
  /** "23" */
  day: string;
  /** "Fr." (optional third line) */
  weekday?: string;
  /** md = 56 px wide (feed card) · lg = 68 px (occasion hero) */
  size?: 'md' | 'lg';
  className?: string;
}

/**
 * A little calendar page in the occasion's colour (wave 1): month on top, the day big, the weekday under it.
 * Tile tint + its own ink (≥ 5:1, docs/design/contrast-check.mjs TILES). Decorative: the full date is
 * always written out next to it for screen readers.
 */
export function DateBadge({ tone, month, day, weekday, size = 'md', className }: DateBadgeProps) {
  const lg = size === 'lg';
  return (
    <span
      aria-hidden="true"
      data-tile={tone}
      className={cn(
        'tile relative inline-flex shrink-0 select-none flex-col items-center justify-center overflow-hidden tabular-nums',
        lg ? 'h-19 w-17 rounded-lg' : 'h-16 w-14 rounded-md',
        className,
      )}
      style={{ boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--hl) 55%, transparent), inset 0 1px 0 color-mix(in srgb, var(--hl) 90%, transparent), 0 6px 14px -8px color-mix(in srgb, var(--shade) 35%, transparent)' }}
    >
      <span className="t-caption-2 font-bold uppercase leading-none tracking-wider">{month}</span>
      <span className={cn('font-extrabold leading-none tracking-tight', lg ? 'mt-1 text-title-1' : 'mt-0.5 text-title-2')}>{day}</span>
      {weekday ? <span className="mt-1 t-caption-2 font-semibold leading-none opacity-80">{weekday}</span> : null}
    </span>
  );
}
