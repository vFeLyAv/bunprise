import type { ReactNode, SVGProps } from 'react'

// Own line glyphs of the tab bar, the create menu and the settings rows: 24 × 24 grid, 1.75 px round
// strokes (a touch lighter than the kit's 2 px: they sit small in tabs and in 28 px icon tiles).
// Decorative (aria-hidden): the control around them carries the name. `active` adds a soft duotone fill
// (the iOS "filled when selected" cue without a second drawing).

export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
  /** a soft fill inside the outline (selected tab) */
  active?: boolean
  strokeWidth?: number
}

function Svg({ size = 24, strokeWidth = 1.75, active: _active, className, children, ...rest }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  )
}

const DUOTONE = { fill: 'currentColor', fillOpacity: 0.16, stroke: 'none' } as const

/** Start: a soft house with a heart-shaped window — "your occasions". */
export function GlyphHome(props: GlyphProps) {
  return (
    <Svg {...props}>
      {props.active ? <path d="M4.5 10.6 12 4.4l7.5 6.2v8.1a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8z" {...DUOTONE} /> : null}
      <path d="M4.5 10.6 12 4.4l7.5 6.2v8.1a1.8 1.8 0 0 1-1.8 1.8H6.3a1.8 1.8 0 0 1-1.8-1.8z" />
      <path d="M12 17.2s-2.6-1.5-2.6-3.3a1.35 1.35 0 0 1 2.6-.5 1.35 1.35 0 0 1 2.6.5c0 1.8-2.6 3.3-2.6 3.3z" />
    </Svg>
  )
}

/** Kalender: a page with rings and two dots. */
export function GlyphCalendar(props: GlyphProps) {
  return (
    <Svg {...props}>
      {props.active ? <rect x="3.75" y="5" width="16.5" height="15.25" rx="3.2" {...DUOTONE} /> : null}
      <rect x="3.75" y="5" width="16.5" height="15.25" rx="3.2" />
      <path d="M3.75 9.75h16.5M8.25 3.25v3.5M15.75 3.25v3.5" />
      <path d="M8.4 13.6h.01M12 13.6h.01M15.6 13.6h.01M8.4 16.9h.01M12 16.9h.01" strokeWidth={2.4} />
    </Svg>
  )
}

/** Listen (Wunschlisten, wave 2): a wish note — a card with a heart and two lines. */
export function GlyphLists(props: GlyphProps) {
  return (
    <Svg {...props}>
      {props.active ? <rect x="4.75" y="3.25" width="14.5" height="17.5" rx="3.4" {...DUOTONE} /> : null}
      <rect x="4.75" y="3.25" width="14.5" height="17.5" rx="3.4" />
      <path d="M12 12.1s-2.65-1.5-2.65-3.35a1.38 1.38 0 0 1 2.65-.52 1.38 1.38 0 0 1 2.65.52c0 1.85-2.65 3.35-2.65 3.35z" />
      <path d="M8.6 15.4h6.8M8.6 17.9h4.3" />
    </Svg>
  )
}

/** Ideen (Find Gift, wave 2): a gift box with its bow and a little sparkle — "an idea for a present". */
export function GlyphGift(props: GlyphProps) {
  return (
    <Svg {...props}>
      {props.active ? <rect x="4.75" y="11.1" width="13.9" height="9.15" rx="2.2" {...DUOTONE} /> : null}
      <rect x="3.75" y="7.6" width="15.9" height="3.5" rx="1.4" />
      <path d="M4.75 11.1v6.95a2.2 2.2 0 0 0 2.2 2.2h9.5a2.2 2.2 0 0 0 2.2-2.2V11.1M11.7 7.6v12.65" />
      <path d="M11.7 7.6c-.9-2.2-4.35-3.05-4.35-.95 0 .95 1.45.95 4.35.95zM11.7 7.6c.9-2.2 4.35-3.05 4.35-.95 0 .95-1.45.95-4.35.95z" />
      <path d="M20.1 2.6c.18.92.56 1.3 1.48 1.48-.92.18-1.3.56-1.48 1.48-.18-.92-.56-1.3-1.48-1.48.92-.18 1.3-.56 1.48-1.48z" strokeWidth={1.4} />
    </Svg>
  )
}

/** Start's "Liste" view (the switch next to the title): three rows with bullets. */
export function GlyphListView(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M9.25 6.75h10.5M9.25 12h10.5M9.25 17.25h10.5" />
      <path d="M4.75 6.75h.01M4.75 12h.01M4.75 17.25h.01" strokeWidth={2.6} />
    </Svg>
  )
}

/** The create button: a plus (rotated 45° it is the close "×"). */
export function GlyphPlus(props: GlyphProps) {
  return (
    <Svg strokeWidth={2.25} {...props}>
      <path d="M12 5.25v13.5M5.25 12h13.5" />
    </Svg>
  )
}

export function GlyphChevronLeft(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M14.75 5.5 8.25 12l6.5 6.5" />
    </Svg>
  )
}

export function GlyphChevronRight(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="m9.25 5.5 6.5 6.5-6.5 6.5" />
    </Svg>
  )
}

/** A person (the avatar placeholder while the profile loads; the "Name" row). */
export function GlyphPerson(props: GlyphProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.6" r="3.6" />
      <path d="M5.2 19.4c.9-3.3 3.6-5.1 6.8-5.1s5.9 1.8 6.8 5.1" />
    </Svg>
  )
}
