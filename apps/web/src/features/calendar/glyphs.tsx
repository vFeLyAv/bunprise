import type { ReactNode, SVGProps } from 'react'
import type { OccasionKind } from './people'

// The tiny filled glyphs of the month view's day chips (wave 2, K-cal): drawn on a 12 × 12 grid as solid shapes
// (strokes blur at 9–10 px), in the chip's ink (currentColor). Decorative: the day cell's label names the day.

type MiniProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number }

function Mini({ size = 10, className, children, ...rest }: MiniProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false" className={className} {...rest}>
      {children}
    </svg>
  )
}

/** Birthday: a cake with one candle and its flame. */
export function MiniCake(props: MiniProps) {
  return (
    <Mini {...props}>
      <path d="M6 .6c.9.9 1.2 1.6.9 2.15a1 1 0 0 1-1.8 0C4.8 2.2 5.1 1.5 6 .6z" />
      <rect x="5.45" y="3.2" width="1.1" height="2.4" rx=".45" />
      <path d="M2.1 6.1h7.8c.6 0 1.1.5 1.1 1.1v.65c-.62.5-1.25.5-1.86 0-.62.5-1.24.5-1.86 0-.62.5-1.24.5-1.86 0-.62.5-1.24.5-1.86 0-.62.5-1.25.5-1.86 0V7.2c0-.6.5-1.1 1.1-1.1z" />
      <path d="M1 8.95c.62.42 1.24.42 1.86 0 .62.42 1.24.42 1.86 0 .62.42 1.24.42 1.86 0 .62.42 1.24.42 1.86 0 .62.42 1.24.42 1.86 0v1.75c0 .55-.45 1-1 1H2c-.55 0-1-.45-1-1z" />
    </Mini>
  )
}

/** Any other occasion: a four-pointed sparkle. */
export function MiniSparkle(props: MiniProps) {
  return (
    <Mini {...props}>
      <path d="M6 .8c.5 2.75 1.45 3.7 4.2 4.2-2.75.5-3.7 1.45-4.2 4.2C5.5 6.45 4.55 5.5 1.8 5 4.55 4.5 5.5 3.55 6 .8z" />
      <path d="M10.2 8.3c.17.9.5 1.23 1.4 1.4-.9.17-1.23.5-1.4 1.4-.17-.9-.5-1.23-1.4-1.4.9-.17 1.23-.5 1.4-1.4z" />
    </Mini>
  )
}

export function KindGlyph({ kind, ...props }: MiniProps & { kind: OccasionKind }) {
  return kind === 'birthday' ? <MiniCake {...props} /> : <MiniSparkle {...props} />
}
