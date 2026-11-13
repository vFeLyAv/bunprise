/**
 * Inline SVG icons (own drawings, 24×24 grid, 2 px round strokes). No icon
 * library, nothing loaded from the network. Icons are decorative by default
 * (`aria-hidden`); give the surrounding control an accessible name.
 *
 * Every factory call is marked `@__PURE__` and nothing else runs at module level. Icons that an
 * INITIAL chunk needs live in files of their own and are re-exported here (iconGlobe: the shell,
 * iconLink: the invite landing); shell files and /i import those files directly, so this module stays
 * in lazy chunks (perf audit 2026-10-20 §6.1). Keep it that way when adding an icon.
 */
import { makeIcon as make } from './iconBase';
import { IconGlobe } from './iconGlobe';
import { IconLink } from './iconLink';
import type { IconProps } from './iconBase';

export type { IconProps } from './iconBase';
export { IconGlobe } from './iconGlobe';
export { IconLink } from './iconLink';

export const IconPlus = /* @__PURE__ */ make('plus', 'M12 5v14M5 12h14');
// 8 trapezoid teeth on a 7.6 / 10.2 radius ring + the hub (the earlier sun-like rays read as weather)
export const IconGear = /* @__PURE__ */ make(
  'gear',
  'M10.17 4.62L10.33 1.94A10.2 10.2 0 0 1 13.67 1.94L13.83 4.62A7.6 7.6 0 0 1 15.92 5.49L17.93 3.70A10.2 10.2 0 0 1 20.30 6.07L18.51 8.08A7.6 7.6 0 0 1 19.38 10.17L22.06 10.33A10.2 10.2 0 0 1 22.06 13.67L19.38 13.83A7.6 7.6 0 0 1 18.51 15.92L20.30 17.93A10.2 10.2 0 0 1 17.93 20.30L15.92 18.51A7.6 7.6 0 0 1 13.83 19.38L13.67 22.06A10.2 10.2 0 0 1 10.33 22.06L10.17 19.38A7.6 7.6 0 0 1 8.08 18.51L6.07 20.30A10.2 10.2 0 0 1 3.70 17.93L5.49 15.92A7.6 7.6 0 0 1 4.62 13.83L1.94 13.67A10.2 10.2 0 0 1 1.94 10.33L4.62 10.17A7.6 7.6 0 0 1 5.49 8.08L3.70 6.07A10.2 10.2 0 0 1 6.07 3.70L8.08 5.49A7.6 7.6 0 0 1 10.17 4.62ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
);
export const IconBack = /* @__PURE__ */ make('back', 'M15 5l-7 7 7 7');
export const IconForward = /* @__PURE__ */ make('forward', 'M9 5l7 7-7 7');
export const IconShare = /* @__PURE__ */ make('share', 'M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7');
export const IconGift = /* @__PURE__ */ make(
  'gift',
  'M20 12v9H4v-9M2 7h20v5H2zM12 7v14M12 7s-1.5-4-4-4a2 2 0 0 0 0 4M12 7s1.5-4 4-4a2 2 0 0 1 0 4',
);
export const IconCalendar = /* @__PURE__ */ make(
  'calendar',
  'M4 5h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 10h18M8 3v4M16 3v4',
);
export const IconMapPin = /* @__PURE__ */ make(
  'map-pin',
  'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
);
export const IconCheck = /* @__PURE__ */ make('check', 'M5 12.5l4.5 4.5L19 7.5');
export const IconX = /* @__PURE__ */ make('x', 'M6 6l12 12M18 6L6 18');
export const IconTrash = /* @__PURE__ */ make(
  'trash',
  'M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3',
);
export const IconEdit = /* @__PURE__ */ make('edit', 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM13.5 6.5l3 3');
export const IconLock = /* @__PURE__ */ make(
  'lock',
  'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4',
);
export const IconLogout = /* @__PURE__ */ make('logout', 'M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l5 4-5 4M20 12H9');
export const IconCopy = /* @__PURE__ */ make(
  'copy',
  'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
);
export const IconEyeOff = /* @__PURE__ */ make(
  'eye-off',
  'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10 10 0 0 1 12 5c5 0 9 4 10 7a11 11 0 0 1-2.7 3.9M6.6 6.6A11 11 0 0 0 2 12c1 3 5 7 10 7a9.7 9.7 0 0 0 4.3-1',
);

// wave 1: the motion settings rows (sparkle = animations, bunny = mascots, battery = saver) and RSVP "maybe"
export const IconSparkle = /* @__PURE__ */ make(
  'sparkle',
  'M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9zM18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
);
export const IconBunny = /* @__PURE__ */ make(
  'bunny',
  'M9 9.6C7.3 8.6 6.2 6.6 6.4 4.4c2.1.2 3.7 1.7 4.3 3.9M15 9.6c1.7-1 2.8-3 2.6-5.2-2.1.2-3.7 1.7-4.3 3.9M12 9c-3.9 0-7 2.7-7 6.2S8.1 21 12 21s7-2.3 7-5.8S15.9 9 12 9zM9.6 14.6h.01M14.4 14.6h.01M11.2 17.2h1.6',
);
export const IconBattery = /* @__PURE__ */ make(
  'battery',
  'M4 7.5h13a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V9A1.5 1.5 0 0 1 4 7.5zM21.5 10.5v3M6 10.5v3',
);
export const IconQuestion = /* @__PURE__ */ make('question', 'M9.2 9a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1.2-1.4 2.1v.5M12 17.8h.01');

/** "…" (more actions): three filled dots on the same 24 px grid. */
export function IconMore({ size = 24, className, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className={className} {...rest}>
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
  );
}

/** Name → component map, for data-driven places (e.g. settings rows). */
export const icons = {
  plus: IconPlus,
  gear: IconGear,
  back: IconBack,
  forward: IconForward,
  share: IconShare,
  gift: IconGift,
  calendar: IconCalendar,
  'map-pin': IconMapPin,
  check: IconCheck,
  x: IconX,
  trash: IconTrash,
  edit: IconEdit,
  link: IconLink,
  lock: IconLock,
  logout: IconLogout,
  globe: IconGlobe,
  copy: IconCopy,
  'eye-off': IconEyeOff,
  more: IconMore,
  sparkle: IconSparkle,
  bunny: IconBunny,
  battery: IconBattery,
  question: IconQuestion,
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name, ...rest }: IconProps & { name: IconName }) {
  const Cmp = icons[name];
  return <Cmp {...rest} />;
}
