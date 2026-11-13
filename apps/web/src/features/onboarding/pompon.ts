import type { AnyMascotInstance } from '../mascot-ui/stage'

// Pompon's extras for the welcome screens (Felix 25.10, approved in the mascot gallery:
// packages/mascot/demo/welcome-screens.ts, docs/handoffs/2026-10-25-welcome-gallery.md). Pure keyframe builders
// and the drawings (in the puppet's own units: head top y = -163, centre x = 0, feet y = 0 — the same as
// apps/web/public/icons/icon.svg and the logo variants), plus the two DOM helpers that put a drawing into the
// puppet's breathing group. Motion: transform/opacity only, every animation finite.

/** The app's three springs as WAAPI easings (tokens.css --spring-*, design-system-motion.md §2). */
const LINEAR_OK = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transition-timing-function', 'linear(0, 1)')
export const EASE = LINEAR_OK
  ? {
      snappy: 'linear(0, 0.036, 0.123, 0.234, 0.352, 0.468, 0.573, 0.665, 0.744, 0.808, 0.860, 0.901, 0.932, 0.956, 0.973, 0.985, 0.994, 0.999, 1.003, 1.004, 1.005, 1.005, 1.005, 1.005, 1)',
      smooth: 'linear(0, 0.023, 0.081, 0.159, 0.248, 0.340, 0.429, 0.514, 0.591, 0.660, 0.721, 0.773, 0.818, 0.856, 0.887, 0.913, 0.934, 0.950, 0.964, 0.974, 0.982, 0.988, 0.993, 0.996, 1)',
      bouncy: 'linear(0, 0.069, 0.237, 0.449, 0.662, 0.849, 0.994, 1.092, 1.146, 1.163, 1.153, 1.127, 1.092, 1.057, 1.026, 1.002, 0.986, 0.977, 0.973, 0.975, 0.979, 0.985, 0.990, 0.995, 1)',
    }
  : { snappy: 'cubic-bezier(.25,.8,.3,1)', smooth: 'cubic-bezier(.2,.7,.3,1)', bouncy: 'cubic-bezier(.34,1.56,.64,1)' }
export const DUR = { snappy: 280, smooth: 350, bouncy: 480 }

// ---- keyframes -------------------------------------------------------------------------------------------

/** A wish bubble's flight from its place into the box: a little lift, an arc, shrinking into the opening. */
export function flightKeyframes(dx: number, dy: number): Keyframe[] {
  const lift = Math.min(-40, dy * 0.35 - 30)
  return [
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0, easing: 'ease-out' },
    { transform: 'translate(0px, -6px) scale(1.08)', opacity: 1, offset: 0.12, easing: 'ease-in-out' },
    { transform: `translate(${(dx * 0.55).toFixed(1)}px, ${(dy * 0.4 + lift).toFixed(1)}px) scale(0.85)`, opacity: 1, offset: 0.55, easing: 'ease-in' },
    { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.22)`, opacity: 0, offset: 1 },
  ]
}

/** One confetti piece: thrown up and out, falls back with "gravity", spins and fades. Deterministic per seed. */
export function confettiKeyframes(seed: number): Keyframe[] {
  const rnd = (n: number) => {
    const x = Math.sin(seed * 9301 + n * 49297) * 233280
    return x - Math.floor(x)
  }
  const angle = (-90 + (rnd(1) - 0.5) * 120) * (Math.PI / 180)
  const speed = 70 + rnd(2) * 60
  const vx = Math.cos(angle) * speed
  const vy = Math.sin(angle) * speed
  const spin = (rnd(3) - 0.5) * 540
  const at = (t: number) => `translate(${(vx * t).toFixed(1)}px, ${(vy * t + 120 * t * t).toFixed(1)}px) rotate(${(spin * t).toFixed(0)}deg)`
  return [
    { transform: 'translate(0px, 0px) rotate(0deg) scale(0.6)', opacity: 1, offset: 0 },
    { transform: `${at(0.35)} scale(1)`, opacity: 1, offset: 0.35 },
    { transform: `${at(0.7)} scale(1)`, opacity: 0.9, offset: 0.7 },
    { transform: `${at(1)} scale(0.9)`, opacity: 0, offset: 1 },
  ]
}

/** A heart floating up from the head: drifts sideways, grows a little, fades. */
export function heartKeyframes(index: number): Keyframe[] {
  const drift = [-26, 8, 30][index % 3] ?? 0
  return [
    { transform: 'translate(0px, 0px) scale(0.4)', opacity: 0, offset: 0 },
    { transform: `translate(${(drift * 0.3).toFixed(0)}px, -18px) scale(1)`, opacity: 1, offset: 0.25 },
    { transform: `translate(${drift}px, -70px) scale(1.1)`, opacity: 0, offset: 1 },
  ]
}

/** An ear swinging around its own pivot and settling (bouncy). */
export function earWiggleKeyframes(deg: number): Keyframe[] {
  return [
    { transform: 'rotate(0deg)' },
    { transform: `rotate(${deg}deg)`, offset: 0.25 },
    { transform: `rotate(${-deg * 0.6}deg)`, offset: 0.55 },
    { transform: `rotate(${deg * 0.25}deg)`, offset: 0.8 },
    { transform: 'rotate(0deg)' },
  ]
}

/** The box lid pops up and settles. */
export const LID_KEYFRAMES: Keyframe[] = [
  { transform: 'translateY(0px) rotate(0deg)' },
  { transform: 'translateY(-16px) rotate(-7deg)', offset: 0.3 },
  { transform: 'translateY(0px) rotate(0deg)' },
]

// ---- drawings (the puppet's units) ----------------------------------------------------------------------

/** The gift box Pompon holds on the wish step (the lid is its own group: it bounces when a wish lands). */
const GIFT_BOX = `<g class="pp-gift">
  <ellipse cx="0" cy="-1" rx="36" ry="4.5" fill="rgba(70,40,15,.12)"/>
  <rect x="-31" y="-44" width="62" height="43" rx="6" fill="#F28C7A"/>
  <rect x="-31" y="-44" width="62" height="9" rx="5" fill="#000" opacity=".06"/>
  <rect x="-6" y="-44" width="12" height="43" fill="#FFE08A"/>
  <g class="pp-lid">
    <rect x="-35" y="-54" width="70" height="13" rx="5" fill="#F6A291"/>
    <rect x="-6.5" y="-54" width="13" height="13" fill="#FFE08A"/>
    <path d="M0 -54 C-6 -66 -20 -66 -17 -58.5 C-15 -54 -6 -54 0 -54 Z M0 -54 C6 -66 20 -66 17 -58.5 C15 -54 6 -54 0 -54 Z" fill="#FFD166"/>
    <circle cx="0" cy="-55" r="3.6" fill="#F7C04A"/>
  </g>
</g>`

/** Paws that hold the box's (or the envelope's) upper corners; the puppet's own paws hide meanwhile. */
const HOLDING_PAWS = `<g class="pp-paws" fill="var(--mascot-paw)">
  <ellipse cx="-29" cy="-34" rx="8.5" ry="10"/><ellipse cx="29" cy="-34" rx="8.5" ry="10"/>
  <path d="M-32 -29 l1 2.4 M-27.5 -28 l.6 2.6 M32 -29 l-1 2.4 M27.5 -28 l-.6 2.6" stroke="rgba(150,90,40,.3)" stroke-width="1.1" stroke-linecap="round"/>
</g>`

export type Costume = 'birthday' | 'christmas' | 'justbecause' | 'invite'
/** What Pompon wears or holds on a step. */
export type Outfit = 'none' | 'box' | Costume

interface Drawing {
  markup: string
  /** held in the paws (drawn before the puppet's own paws, which hide) — otherwise worn on top */
  held: boolean
}

export const OUTFITS: Readonly<Record<Exclude<Outfit, 'none'>, Drawing>> = {
  box: { markup: GIFT_BOX + HOLDING_PAWS, held: true },
  // party hat (logo variant "birthday"), a touch smaller: the puppet's head is narrower at the top than the icon's
  birthday: {
    held: false,
    markup: `<g transform="rotate(10 0 -160)">
    <path d="M-27 -162 L0 -236 L27 -162 Z" fill="#6C8CFF"/>
    <path d="M-20.4 -180 L-15.9 -192.4 L18.6 -180.9 L22.5 -170.5 Z M-11.2 -205 L-7.5 -215.2 L9.7 -207.9 L13.4 -197.7 Z" fill="#FFF9F1"/>
    <circle cx="0" cy="-238" r="9" fill="#FF7A9A"/>
    <ellipse cx="0" cy="-162" rx="28" ry="5" fill="#4E6AD6"/></g>`,
  },
  // Santa hat (logo variant "christmas")
  christmas: {
    held: false,
    markup: `<g transform="rotate(-6 0 -160)">
    <path d="M-40 -166 C-34 -200 -6 -226 30 -222 C52 -220 62 -204 66 -186 C56 -196 44 -202 32 -200 C26 -186 30 -176 40 -166 Z" fill="#D64545"/>
    <path d="M-40 -166 C-34 -200 -6 -226 30 -222 C10 -214 -10 -196 -14 -166 Z" fill="#FFFFFF" opacity=".08"/>
    <rect x="-50" y="-174" width="100" height="18" rx="9" fill="#FFF9F1"/>
    <rect x="-50" y="-174" width="100" height="6" rx="3" fill="#FFFFFF"/>
    <circle cx="66" cy="-184" r="11" fill="#FFF9F1"/></g>`,
  },
  // "einfach so": a small flower behind the left ear
  justbecause: {
    held: false,
    markup: `<g transform="translate(-40 -150) rotate(-15)">
    ${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-10" rx="7" ry="10" fill="#FFB3C7" transform="rotate(${a})"/>`).join('')}
    <circle r="6.5" fill="#FFD166"/><circle r="2.4" cx="-1.6" cy="-1.6" fill="#fff" opacity=".6"/></g>`,
  },
  // an invitation: an envelope held in both paws
  invite: {
    held: true,
    markup: `<g class="pp-envelope">
    <rect x="-30" y="-66" width="60" height="40" rx="5" fill="#FFF9F1" stroke="#E4CDB0" stroke-width="1.5"/>
    <path d="M-29 -64 L0 -44 L29 -64" fill="none" stroke="#E4CDB0" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="0" cy="-44" r="5.5" fill="#F28C7A"/>
    <path d="M-2.2 -45 a1.6 1.6 0 0 1 2.2 -1 a1.6 1.6 0 0 1 2.2 1 q0 1.6 -2.2 3 q-2.2 -1.4 -2.2 -3 Z" fill="#fff"/>
  </g>${HOLDING_PAWS}`,
  },
}

// ---- DOM helpers ---------------------------------------------------------------------------------------

/** Puts a drawing into the puppet's breathing group (it then moves with his hops and breathing). */
export function dress(mascot: AnyMascotInstance, outfit: Exclude<Outfit, 'none'>): SVGGElement | null {
  const breathe = mascot.root.querySelector('.breathe')
  if (!breathe) return null
  const drawing = OUTFITS[outfit]
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('class', 'pp-extra')
  group.setAttribute('data-outfit', outfit)
  group.innerHTML = drawing.markup
  if (drawing.held) breathe.insertBefore(group, breathe.querySelector('.tp'))
  else breathe.append(group)
  return group
}

/** The puppet's own paws (`.tp`, at the belly) hide while other paws hold something: never four paws. */
export function ownPaws(mascot: AnyMascotInstance, shown: boolean): void {
  const paws = mascot.root.querySelector<SVGGElement>('.tp')
  if (paws) paws.style.visibility = shown ? '' : 'hidden'
}

/** Runs `done` once the animation finished or was cancelled (`finished` rejects on cancel). */
export function settle(animation: Animation, done: () => void): void {
  animation.finished.then(done, done)
}
