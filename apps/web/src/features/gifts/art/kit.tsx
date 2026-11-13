import type { ReactNode } from 'react'

// Shared bits of the demo drawings (features/gifts/art): one square canvas (0 0 120 120), the soft floor
// shadow every object stands on, and little sparkles. Colours are tokens only (tokens.css, tiles.css and the
// --gift-* feature tokens in gifts.css), so a theme recolours them. Decorative: the card says what it is.

export function Canvas({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" aria-hidden="true" focusable="false" data-art={label} className="block">
      {children}
    </svg>
  )
}

/** The object's shadow on the "studio floor". */
export function Floor({ cx = 60, rx = 34, y = 104 }: { cx?: number; rx?: number; y?: number }) {
  return <ellipse cx={cx} cy={y} rx={rx} ry={4.6} fill="var(--gift-shadow)" />
}

/** A four-point sparkle. */
export function Sparkle({ x, y, r = 4, fill = 'var(--surface)', opacity = 0.9 }: { x: number; y: number; r?: number; fill?: string; opacity?: number }) {
  const s = r * 0.32
  return (
    <path
      d={`M${x} ${y - r} L${x + s} ${y - s} L${x + r} ${y} L${x + s} ${y + s} L${x} ${y + r} L${x - s} ${y + s} L${x - r} ${y} L${x - s} ${y - s} Z`}
      fill={fill}
      opacity={opacity}
    />
  )
}
