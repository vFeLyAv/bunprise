import type { SVGProps } from 'react'

// Icons of the occasion form (own drawings on the kit's 24 px grid, 2 px round strokes). They live here,
// not in ui/icons.tsx, because only this lazy chunk needs them. Decorative: the control carries the name.

export interface FormIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function make(d: string, filled = false) {
  return function FormIcon({ size = 24, className, ...rest }: FormIconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={className}
        {...rest}
      >
        <path d={d} />
      </svg>
    )
  }
}

export const IconSun = /* @__PURE__ */ make(
  'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
)
export const IconSunrise = /* @__PURE__ */ make('M3.5 18.5h17M7 18.5a5 5 0 0 1 10 0M12 4v6.5M9.5 6.5 12 4l2.5 2.5M5.7 12.2l1.4 1.4M18.3 12.2l-1.4 1.4')
export const IconSparkle = /* @__PURE__ */ make('M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7zM18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z')
export const IconClock = /* @__PURE__ */ make('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2')
// the end time row: a moon (an evening that goes on), so the two clock rows do not look alike
export const IconMoon = /* @__PURE__ */ make('M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z')
export const IconPin = /* @__PURE__ */ make('M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z')
export const IconNotes = /* @__PURE__ */ make('M5 6.5h14M5 11.5h14M5 16.5h9')
export const IconCalendarGlyph = /* @__PURE__ */ make('M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8.5 3v4M15.5 3v4')
export const IconSearch = /* @__PURE__ */ make('M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8')
export const IconQuote = /* @__PURE__ */ make('M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3')
export const IconRecent = /* @__PURE__ */ make('M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v4h4M12 8v4.2l2.8 1.8')
export const IconInfo = /* @__PURE__ */ make('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5.5M12 7.6v.1')
export const IconCloudOff = /* @__PURE__ */ make('M3 3l18 18M8.4 8.4A5 5 0 0 0 7 18h10M20.3 16.6A4 4 0 0 0 17 10h-.6A6 6 0 0 0 10.4 6.1')
export const IconChevronLeft = /* @__PURE__ */ make('M14.5 5.5 8 12l6.5 6.5')
export const IconChevronRight = /* @__PURE__ */ make('M9.5 5.5 16 12l-6.5 6.5')
export const IconChevron = /* @__PURE__ */ make('M9.5 6 15.5 12l-6 6')
export const IconClose = /* @__PURE__ */ make('M7 7l10 10M17 7 7 17')
// the cover photo row: a picture with a hill and the sun
export const IconPhoto = /* @__PURE__ */ make(
  'M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5zM3.5 16.5l4.6-4.6a1.4 1.4 0 0 1 2 0l5.4 5.4M13.5 15.3l1.7-1.7a1.4 1.4 0 0 1 2 0l3.3 3.3M17 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
)
export const IconUndo = /* @__PURE__ */ make('M9 14 4.5 9.5 9 5M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3')

// kinds of place suggestions (GET /api/places)
export const IconCafe = /* @__PURE__ */ make('M5 9h11v3.5A5.5 5.5 0 0 1 10.5 18h0A5.5 5.5 0 0 1 5 12.5zM16 10.5h1.2a2.4 2.4 0 0 1 0 4.8H15.5M5 21h11M9 3.5v2.5M12 3.5v2.5')
export const IconRestaurant = /* @__PURE__ */ make('M6.5 3v6a2 2 0 0 0 4 0V3M8.5 11v10M17.5 21V3c-2 1.4-3 4-3 7.5h3')
export const IconBar = /* @__PURE__ */ make('M7 3.5h10l-1.2 5.8a3.9 3.9 0 0 1-7.6 0zM12 13.5v7M8.5 20.5h7')
export const IconPark = /* @__PURE__ */ make('M12 3l5 7h-2.8l3.8 5.5H6l3.8-5.5H7zM12 15.5V21')
export const IconVenue = /* @__PURE__ */ make('M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.4l-5.1 2.7 1-5.6-4.1-4 5.7-.8z')
export const IconAddress = /* @__PURE__ */ make('M4 11.5 12 4.5l8 7M6.5 9.8V20h11V9.8M10.2 20v-5.5h3.6V20')
export const IconCity = /* @__PURE__ */ make('M4 20.5V9l5.5-2.8v14.3M9.5 20.5V4l10 3.6v12.9M3 20.5h18M13 10.5h3M13 14h3M13 17.5h3M6 12.5h1M6 16h1')
