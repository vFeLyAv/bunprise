import type { ReactNode, SVGProps } from 'react'
import { cn, tileTone, type TileTone } from '../../ui'
import type { CoverIcon, CoverTone } from '../../lib/api/lists.types'

// A list's cover (follows-design §2.3, M1): one of the kit's four tile tones (ui/tile.ts) + one of twelve
// symbols — keys from a fixed list, no text, no picture (P13: nothing is loaded from anywhere). A list without
// a chosen tone takes the tone of its id, like a gift tile; an occasion list takes its occasion's tone (the
// same colour as its feed card). Own line drawings on the 24 grid, 1.75 px round strokes (like features/nav).

/** The tone a cover shows: the chosen one, else derived from `seed` (the list's or the occasion's id). */
export function coverToneOf(tone: CoverTone | null, seed: string): TileTone {
  return tone ?? tileTone(seed)
}

function Glyph({ size = 24, children, ...rest }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

const PATHS: Record<CoverIcon, ReactNode> = {
  gift: (
    <>
      <path d="M4.5 10.5h15V20h-15z" />
      <path d="M3.5 7.5h17v3h-17zM12 7.5V20" />
      <path d="M12 7.5c-1.2-2.6-4.6-3.3-4.6-1.1 0 1.2 1.6 1.1 4.6 1.1zM12 7.5c1.2-2.6 4.6-3.3 4.6-1.1 0 1.2-1.6 1.1-4.6 1.1z" />
    </>
  ),
  cake: (
    <>
      <path d="M4 20h16M5.5 20v-5.5h13V20M7.5 14.5v-3h9v3" />
      <path d="M5.5 17c1.2 0 1.2-1 2.5-1s1.3 1 2.6 1 1.3-1 2.6-1 1.3 1 2.6 1 1.2-1 2.7-1" />
      <path d="M12 11.5V9M12 5.6c.9 1 .9 1.8 0 2.4-.9-.6-.9-1.4 0-2.4z" />
    </>
  ),
  tree: (
    <>
      <path d="M12 3.5l4.5 5.5h-2.6l3.6 4.6h-2.7l3.2 4.4H6l3.2-4.4H6.5L10.1 9H7.5z" />
      <path d="M12 18v2.5" />
    </>
  ),
  home: (
    <>
      <path d="M4 11.2L12 4.5l8 6.7" />
      <path d="M6.2 9.6V20h11.6V9.6" />
      <path d="M10.2 20v-4.6h3.6V20" />
    </>
  ),
  ring: (
    <>
      <circle cx="12" cy="14.6" r="5.6" />
      <path d="M9.4 5.6l1.3-2.1h2.6l1.3 2.1L12 8.6z" />
    </>
  ),
  star: <path d="M12 3.8l2.5 5.1 5.6.8-4.05 3.95.95 5.6L12 16.6l-5 2.65.95-5.6L3.9 9.7l5.6-.8z" />,
  book: (
    <>
      <path d="M12 6.4c-2.1-1.5-5-2-8-1.6v13.7c3-.4 5.9.1 8 1.6 2.1-1.5 5-2 8-1.6V4.8c-3-.4-5.9.1-8 1.6z" />
      <path d="M12 6.4v13.7" />
    </>
  ),
  game: (
    <>
      <path d="M7.5 8.5h9a4.2 4.2 0 0 1 4.1 5.1l-.6 2.6a2.1 2.1 0 0 1-3.6.9L14.6 15H9.4l-1.8 2.1a2.1 2.1 0 0 1-3.6-.9l-.6-2.6a4.2 4.2 0 0 1 4.1-5.1z" />
      <path d="M8.2 10.6v3M6.7 12.1h3" />
      <path d="M15.6 11.2h.01M17.4 13h.01" strokeWidth={2.4} />
    </>
  ),
  plant: (
    <>
      <path d="M7.2 14h9.6l-1.3 6.2H8.5z" />
      <path d="M12 14V8.6" />
      <path d="M12 10.6C9 10.8 7.4 8.9 7.6 6.2c2.6-.2 4.5 1.4 4.4 4.4zM12 9.2c.1-3 2-4.6 4.6-4.4.2 2.7-1.6 4.5-4.6 4.4z" />
    </>
  ),
  plane: (
    <>
      <path d="M20.5 3.5L3.5 10.6l6.7 2.6 2.6 6.8z" />
      <path d="M10.2 13.2l10.3-9.7" />
    </>
  ),
  music: (
    <>
      <path d="M9 17.6V6.3l10.5-2.2v11.4" />
      <circle cx="6.6" cy="17.6" r="2.4" />
      <circle cx="17.1" cy="15.5" r="2.4" />
    </>
  ),
  heart: <path d="M12 19.6s-7.2-4.3-7.2-9.9a4.1 4.1 0 0 1 7.2-2.7 4.1 4.1 0 0 1 7.2 2.7c0 5.6-7.2 9.9-7.2 9.9z" />,
}

export function CoverGlyph({ icon, size = 24, className }: { icon: CoverIcon | null; size?: number; className?: string }) {
  return (
    <Glyph size={size} className={className}>
      {PATHS[icon ?? 'gift']}
    </Glyph>
  )
}

export interface CoverTileProps {
  tone: TileTone
  icon: CoverIcon | null
  /** px of the square */
  size?: number
  className?: string
}

/** The small square of a cover (rows, the create sheet, the list screen's header): tone + symbol. */
export function CoverTile({ tone, icon, size = 44, className }: CoverTileProps) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn('lc-tile inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.32) }}
    >
      <CoverGlyph icon={icon} size={Math.round(size * 0.56)} />
    </span>
  )
}
