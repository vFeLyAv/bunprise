import type { ReactNode, SVGProps } from 'react'

// Line glyphs of the people screens and the "Privatsphäre" group, drawn like features/nav/glyphs.tsx (24 × 24,
// 1.75 px round strokes). Decorative (aria-hidden): the control around them carries the name.

export interface PeopleGlyphProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function Svg({ size = 24, className, children, ...rest }: PeopleGlyphProps & { children: ReactNode }) {
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
      className={className}
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Mein Folgen-Link: two chain links. */
export function GlyphFollowLink(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.9-2.9a3.6 3.6 0 0 0-5.1-5.1l-.9.9" />
      <path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.9 2.9a3.6 3.6 0 0 0 5.1 5.1l.9-.9" />
    </Svg>
  )
}

/** Follower & Anfragen: two people. */
export function GlyphPeople(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8.7" r="3.2" />
      <path d="M3.4 18.9c.8-2.9 3-4.5 5.6-4.5s4.8 1.6 5.6 4.5" />
      <path d="M15.2 5.8a3 3 0 0 1 0 5.8M17.1 14.6c1.7.5 3 1.9 3.5 4.3" />
    </Svg>
  )
}

/** Blockierte Personen: a circle with a bar. */
export function GlyphBlock(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="7.75" />
      <path d="m6.6 17.4 10.8-10.8" />
    </Svg>
  )
}

/** In Vorschlägen erscheinen: a small spark over a person. */
export function GlyphSuggest(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="9.6" r="3.3" />
      <path d="M4.2 19.4c.8-3 3.1-4.7 5.8-4.7 1.6 0 3 .5 4.1 1.5" />
      <path d="M18 4.6v4.2M15.9 6.7h4.2" />
    </Svg>
  )
}

/** Wer sieht was?: an eye. */
export function GlyphEye(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <path d="M2.9 12s3.3-6 9.1-6 9.1 6 9.1 6-3.3 6-9.1 6-9.1-6-9.1-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </Svg>
  )
}

/** A friendly check inside a soft circle ("Angefragt", "Du folgst"). */
export function GlyphCheckCircle(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.4 12.3 2.5 2.5 4.8-5.2" />
    </Svg>
  )
}

/** "Mit deiner Anfrage sieht … deinen Namen": a name tag. */
export function GlyphNameTag(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="6.5" width="17" height="11" rx="2.6" />
      <circle cx="8.6" cy="11.2" r="1.7" />
      <path d="M6.3 15c.5-1 1.3-1.6 2.3-1.6s1.8.6 2.3 1.6M13.5 10.5h4M13.5 13.5h2.8" />
    </Svg>
  )
}

/** "Erst wenn … zustimmt": a closed lock. */
export function GlyphLockSmall(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2.4" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Svg>
  )
}

/** "Du kannst jederzeit aufhören": an arrow leaving a door. */
export function GlyphLeave(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <path d="M10 4.5H6.6a2.1 2.1 0 0 0-2.1 2.1v10.8a2.1 2.1 0 0 0 2.1 2.1H10" />
      <path d="m15 8 4 4-4 4M19 12H9.5" />
    </Svg>
  )
}

/** Mein Code: a QR code's three corner squares and a few modules (add-friends-design §2.1). */
export function GlyphQr(props: PeopleGlyphProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1.2" />
      <rect x="14" y="4" width="6" height="6" rx="1.2" />
      <rect x="4" y="14" width="6" height="6" rx="1.2" />
      <path d="M14 14h2.5v2.5M20 14v.01M14 20h.01M17 20h3v-3" />
    </Svg>
  )
}
