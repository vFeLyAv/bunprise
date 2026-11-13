import type { ReactNode } from 'react'
import type { GlyphProps } from '../nav/glyphs'

// The settings rows' own glyphs (moved out of ../nav/glyphs.tsx on 25.10: the tab bar ships with every first screen,
// these only with the settings screen — bundle budget of /soon). Same drawing rules: 24 × 24, 1.75 px round strokes,
// decorative (aria-hidden).

function Svg({ size = 24, strokeWidth = 1.75, active: _active, className, children, ...rest }: GlyphProps & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className} {...rest}>
      {children}
    </svg>
  )
}

/** Farbschema (Felix 25.10: light / dark theme): a crescent moon. */
export function GlyphMoon(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M19.4 14.6A7.9 7.9 0 0 1 9.4 4.6a7.9 7.9 0 1 0 10 10z" />
    </Svg>
  )
}

export function GlyphMail(props: GlyphProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5.75" width="17" height="12.5" rx="2.6" />
      <path d="m4.6 7.4 7.4 5.6 7.4-5.6" />
    </Svg>
  )
}

/** Sprache: a speech bubble with a letter. */
export function GlyphLanguage(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M5.6 4.75h12.8a2.1 2.1 0 0 1 2.1 2.1v8.1a2.1 2.1 0 0 1-2.1 2.1H11l-4.1 3.2v-3.2H5.6a2.1 2.1 0 0 1-2.1-2.1v-8.1a2.1 2.1 0 0 1 2.1-2.1z" />
      <path d="m9.1 14 2.9-6.6 2.9 6.6M10.1 11.8h3.8" />
    </Svg>
  )
}

/** Schnellstart (offline copy on this device): a lightning bolt. */
export function GlyphBolt(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M13.2 3.5 6.1 13.1h5.3l-1 7.4 7.5-9.9h-5.4z" />
    </Svg>
  )
}

export function GlyphDownload(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.25v10.5M7.6 10.6 12 15l4.4-4.4" />
      <path d="M4.75 15.5v1.9a2.35 2.35 0 0 0 2.35 2.35h9.8a2.35 2.35 0 0 0 2.35-2.35v-1.9" />
    </Svg>
  )
}

export function GlyphTrash(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M4.75 7.1h14.5M9.6 7.1V5.2a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v1.9" />
      <path d="m6.6 7.1.85 11.3a1.6 1.6 0 0 0 1.6 1.47h5.9a1.6 1.6 0 0 0 1.6-1.47l.85-11.3M10.2 10.9v5.2M13.8 10.9v5.2" />
    </Svg>
  )
}

/** Datenschutz: a shield with a check. */
export function GlyphShield(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.6 5.1 6.3v5.1c0 4.4 2.9 7.6 6.9 9 4-1.4 6.9-4.6 6.9-9V6.3z" />
      <path d="m9 12.1 2.1 2.1 4-4.2" />
    </Svg>
  )
}

/** Impressum: an info sign. */
export function GlyphInfo(props: GlyphProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v5.2M12 7.9h.01" strokeWidth={2.2} />
    </Svg>
  )
}

/** Nutzungsbedingungen: a page with lines. */
export function GlyphDocument(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M7.1 3.75h6.6l4.55 4.55v10.6a1.4 1.4 0 0 1-1.4 1.35H7.1a1.4 1.4 0 0 1-1.35-1.35V5.1A1.4 1.4 0 0 1 7.1 3.75z" />
      <path d="M13.4 3.9v4.6h4.6M9 12.6h6M9 16h4.2" />
    </Svg>
  )
}

/** Hilfe: a speech bubble with a question mark. */
export function GlyphHelp(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M12 20.2a8.2 8.2 0 1 0-7.1-4.1l-1.1 3.9 3.9-1a8.2 8.2 0 0 0 4.3 1.2z" />
      <path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.7c0 1.5-2.2 1.9-2.2 3.3M12 16.4h.01" />
    </Svg>
  )
}

export function GlyphLogout(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M10.2 4.75H7.1a2.35 2.35 0 0 0-2.35 2.35v9.8a2.35 2.35 0 0 0 2.35 2.35h3.1M14.6 8.1l3.9 3.9-3.9 3.9M18.4 12H9.6" />
    </Svg>
  )
}

export function GlyphPencil(props: GlyphProps) {
  return (
    <Svg {...props}>
      <path d="M4.75 19.25h3.6L18.6 9a2.55 2.55 0 0 0-3.6-3.6L4.75 15.65z" />
      <path d="m13.5 6.9 3.6 3.6" />
    </Svg>
  )
}
