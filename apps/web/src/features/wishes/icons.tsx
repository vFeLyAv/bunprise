import type { ReactNode, SVGProps } from 'react'

// Small icons of the wish screens (own drawings, 24 px grid, 2 px round strokes like ui/icons.tsx; decorative:
// the control around them carries the accessible name). Kept here so the kit's icon module stays as it is.

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function Svg({ size = 24, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
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

/** Clipboard with a link: "Einfügen". */
export function IconPaste(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z" />
      <path d="M8 5H6.5A1.5 1.5 0 0 0 5 6.5v13A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 17.5 5H16" />
      <path d="M10.5 13.5l3-3M11.6 15.6l-.8.8a1.9 1.9 0 0 1-2.7-2.7l.8-.8M12.4 9.4l.8-.8a1.9 1.9 0 0 1 2.7 2.7l-.8.8" />
    </Svg>
  )
}

/** Pencil: "Ohne Link hinzufügen" / editable field. */
export function IconPencil(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </Svg>
  )
}

/** Circular arrow: read the link again. */
export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </Svg>
  )
}

/** Sparkle: "from the link". */
export function IconSparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </Svg>
  )
}

/** A filled heart (rows, sheets, the meter's burst). */
export function IconHeart({ size = 24, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      <path d="M12 20.5s-8-5.1-8-11A4.5 4.5 0 0 1 12 6.6a4.5 4.5 0 0 1 8 2.9c0 5.9-8 11-8 11z" />
    </svg>
  )
}

/** Outward arrow: open the shop in a new tab. */
export function IconExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </Svg>
  )
}
