import type { ReactNode } from 'react';
import { cn } from './cn';
import '../styles/icontile.css';

export type IconTileTone = 'apricot' | 'rose' | 'sage' | 'lilac' | 'sky' | 'honey' | 'ink';

export interface IconTileProps {
  tone: IconTileTone;
  /** A 24 px kit icon (drawn at 18 px, white). Decorative: the row's label carries the meaning. */
  children: ReactNode;
  className?: string;
}

/**
 * The small coloured rounded-square icon of a grouped settings row (Telegram / iOS Settings, Felix's K11):
 * 30 × 30, radius 8, one of the Paper hues (--icon-*) with a soft top light and a white glyph.
 */
export function IconTile({ tone, children, className }: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-7.5 shrink-0 items-center justify-center rounded-xs text-white [&>svg]:size-4.5',
        className,
      )}
      style={{
        backgroundColor: `var(--icon-${tone})`,
        backgroundImage: 'linear-gradient(180deg, color-mix(in srgb, var(--hl) 28%, transparent), rgba(255,255,255,0) 60%)',
        boxShadow: 'inset 0 0 0 .5px rgba(0,0,0,.06), 0 1px 2px color-mix(in srgb, var(--shade) 14%, transparent)',
      }}
    >
      {children}
    </span>
  );
}
