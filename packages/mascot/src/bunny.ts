/**
 * Bunny — the main Bunprise mascot. Faithful port of bunny-v1.html:
 * same shapes, same CSS states, same scene choreography and timings.
 */

import { EASINGS, fxAnimate, SPRING } from './core';
import { earLifts } from './ear-lift';
import { MascotBase, type MascotSpec } from './mascot';
import { BODY, cookieMarkup, star } from './shapes';
import type { ChannelInput } from './timeline';
import type { BunnyCoat, BunnyOptions, BunnyPose, BunnyScene, Coat, EarStyle } from './types';

// ---------- the surprise timeline (wave 3, idea 11 «Уши торчком») ----------
// One set of keys for both the puppet's 'surprise' scene (Web Animations here) and the welcome stage's
// surprise beat (tracks, welcome-actors Peeker): [seconds from the start, values, easing of the segment that
// starts there]. sx / sy = scale, o = opacity, y = px (hop). The original ear paths unfold and
// straighten using EarLift; their gradient and inner-ear colour stay on the same SVG nodes.
const S_OUT = 'cubic-bezier(.2,.7,.3,1)';
export type SurpriseKey = readonly [number, ChannelInput, string?];
export type SurprisePart = 'hop' | 'squash' | 'shadow' | 'eyes' | 'mouth' | 'mouthOpen';
/** Seconds the surprise takes (the ears are back down and still). */
export const SURPRISE_S = 1.76;
/** The original ears held up (the static pose 'surprise'; also the peak of the scene). */
export const SURPRISE_PEAK = 0.62;
export const SURPRISE: Readonly<Record<SurprisePart, readonly SurpriseKey[]>> = {
  hop: [
    [0, { y: 0 }, 'ease-out'],
    [0.05, { y: 1.5 }, S_OUT],
    [0.16, { y: -9 }, EASINGS.jumpDown],
    [0.3, { y: 0 }],
    [0.36, { y: 1 }],
    [0.42, { y: 0 }],
    [SURPRISE_S, { y: 0 }],
  ],
  squash: [
    [0, { sx: 1, sy: 1 }],
    [0.05, { sx: 1.04, sy: 0.95 }, S_OUT],
    [0.16, { sx: 0.96, sy: 1.05 }],
    [0.3, { sx: 1.05, sy: 0.95 }],
    [0.45, { sx: 1, sy: 1 }],
    [SURPRISE_S, { sx: 1, sy: 1 }],
  ],
  shadow: [
    [0, { sx: 1, sy: 1 }],
    [0.05, { sx: 1.05, sy: 1.05 }, S_OUT],
    [0.16, { sx: 0.82, sy: 0.82 }],
    [0.3, { sx: 1.06, sy: 1.06 }],
    [0.45, { sx: 1, sy: 1 }],
    [SURPRISE_S, { sx: 1, sy: 1 }],
  ],
  // round eyes from the start of the pop until the ears fall, then one blink once they are down
  eyes: [
    [0, { sx: 1, sy: 1 }, S_OUT],
    [0.08, { sx: 1.3, sy: 1.12 }],
    [1.12, { sx: 1.3, sy: 1.12 }, 'ease-in-out'],
    [1.24, { sx: 1, sy: 1 }],
    [1.5, { sx: 1, sy: 1 }, 'ease-in'],
    [1.55, { sx: 1, sy: 0.12 }, 'ease-out'],
    [1.63, { sx: 1, sy: 1 }],
    [SURPRISE_S, { sx: 1, sy: 1 }],
  ],
  // a little "o" instead of the smile while the ears shoot up
  mouth: [
    [0, { o: 1 }],
    [0.03, { o: 1 }],
    [0.05, { o: 0 }],
    [0.5, { o: 0 }],
    [0.53, { o: 1 }],
    [SURPRISE_S, { o: 1 }],
  ],
  mouthOpen: [
    [0, { o: 0, sx: 0.85, sy: 1.25 }],
    [0.03, { o: 0, sx: 0.85, sy: 1.25 }],
    [0.05, { o: 1, sx: 0.85, sy: 1.25 }],
    [0.5, { o: 1, sx: 0.85, sy: 1.25 }],
    [0.53, { o: 0, sx: 0.85, sy: 1.25 }],
    [SURPRISE_S, { o: 0, sx: 1, sy: 1 }],
  ],
};

/** Upright rabbits perk their own ears; they never switch to the separate tall-ear shapes either. */
const SHORT_UPRIGHT: readonly SurpriseKey[] = [
  [0, { sx: 1, sy: 1 }, S_OUT],
  [0.22, { sx: 0.98, sy: 1.12 }, 'ease-in-out'],
  [0.4, { sx: 1, sy: 1.08 }],
  [1.02, { sx: 1, sy: 1.08 }, 'ease-in-out'],
  [1.43, { sx: 1.01, sy: 0.97 }, 'ease-in-out'],
  [1.6, { sx: 1, sy: 1.02 }, 'ease-in-out'],
  [SURPRISE_S, { sx: 1, sy: 1 }],
];

const n3 = (v: number) => String(Math.round(v * 1000) / 1000);
/** Surprise keys -> Web Animation keyframes (translate, rotate, scale — the order the tracks use). */
function surpriseFrames(keys: readonly SurpriseKey[], baseR = 0): Keyframe[] {
  return keys.map(([t, v, e]) => {
    const parts: string[] = [];
    if (v.y !== undefined || v.x !== undefined) parts.push(`translate(${n3(v.x ?? 0)}px, ${n3(v.y ?? 0)}px)`);
    if (v.r !== undefined) parts.push(`rotate(${n3(baseR + v.r)}deg)`);
    if (v.sx !== undefined || v.sy !== undefined) parts.push(`scale(${n3(v.sx ?? 1)}, ${n3(v.sy ?? 1)})`);
    const f: Keyframe = { offset: Math.min(1, t / SURPRISE_S) };
    if (parts.length) f.transform = parts.join(' ');
    if (v.o !== undefined) f.opacity = n3(v.o);
    if (e) f.easing = e;
    return f;
  });
}

export const BUNNY_SCENES: readonly BunnyScene[] = ['greet', 'eat', 'walk', 'jump', 'alert', 'sleep', 'angry', 'surprise', 'idle'];

/** Coats of fancy rabbits; colours copied from the prototype. */
export const BUNNY_COATS: readonly Coat<BunnyCoat>[] = [
  { id: 'fawn', name: 'Кремовый', pattern: 'none', colors: ['#FCE7CC', '#EFC79B', '#FFF9F1', '#E9B784', '#D59B60', '#F5D6B0', '#F4B2A0'] },
  { id: 'choc', name: 'Шоколад', pattern: 'none', colors: ['#EBD3BF', '#CDA586', '#FBF1E8', '#B88563', '#9C6B4B', '#DCC0A6', '#E9A898'] },
  { id: 'blue', name: 'Голубой', pattern: 'none', colors: ['#F0F1F5', '#CDD1DA', '#FCFCFE', '#B4BAC6', '#9AA1AF', '#DDE0E6', '#F1B9C0'] },
  { id: 'himalayan', name: 'Гималайский', pattern: 'points', colors: ['#FFFFFF', '#F2EFEC', '#FFFFFF', '#6E5A55', '#574541', '#6E5A55', '#E6A9A9'] },
  { id: 'broken', name: 'Броукен', pattern: 'broken', colors: ['#FFFFFF', '#F3EFEA', '#FFFFFF', '#F2B47C', '#DF9D63', '#F9DDC3', '#F4B2A0'] },
];

// ---------- shapes ----------
// lop ears (like lop-eared fancy rabbits)
const LOP_L = 'M-24 -160 C-44 -170 -67 -155 -75 -128 C-81 -107 -77 -86 -66 -83 C-56 -81 -53 -96 -53 -111 C-53 -129 -44 -145 -29 -151 Z';
const LOP_R = 'M24 -160 C44 -170 67 -155 75 -128 C81 -107 77 -86 66 -83 C56 -81 53 -96 53 -111 C53 -129 44 -145 29 -151 Z';
const LOP_IN_L = 'M-29 -151 C-44 -145 -53 -129 -53 -111 C-53 -99 -55 -90 -61 -86 C-58 -95 -57.5 -108 -58 -118 C-58.5 -134 -50 -146 -37 -153 Z';
const LOP_IN_R = 'M29 -151 C44 -145 53 -129 53 -111 C53 -99 55 -90 61 -86 C58 -95 57.5 -108 58 -118 C58.5 -134 50 -146 37 -153 Z';

// ---------- the surprised ears (wave 3, Felix's idea 11 «Уши торчком») ----------
// Tall upright ears that only show during the surprise: as long as the head is high (base at y = -146 behind
// the head, tip at -265), narrow at the base, widest at mid height, a round tip. The RIGHT ear is two parts
// joined like an elbow at its joint (TALL_JOINT): the lower part ends in a dome, the tip starts with one, so
// the tip can fold over to the side around the joint centre without a gap (Felix's reference picture).
/** x of the tall ears' centre lines and y of their base / of the right ear's joint (bunny units). */
export const TALL_EAR = { x: 22, base: -146, joint: -222, tip: -265 } as const;
const f1 = (v: number) => String(Math.round(v * 10) / 10);
/** One tall ear, centre line x = cx (outer: w = 1; inner pink: smaller). */
function tallEar(cx: number, inner: boolean): string {
  const k = inner ? 0.55 : 1;
  const b = TALL_EAR.base - (inner ? 4 : 0);
  const t = TALL_EAR.tip + (inner ? 11 : 0);
  const p = (dx: number, y: number) => `${f1(cx + dx * k)} ${f1(y)}`;
  return `M${p(-9.5, b)} C${p(-14, b - 29)} ${p(-16, b - 69)} ${p(-12.5, t + 25)} C${p(-9.5, t + 7)} ${p(-5, t)} ${p(0, t)} C${p(5, t)} ${p(9.5, t + 7)} ${p(12.5, t + 25)} C${p(16, b - 69)} ${p(14, b - 29)} ${p(9.5, b)} Z`;
}
/** The right ear's lower part: from the base up to a dome around the joint. */
function tallLower(cx: number, inner: boolean): string {
  const k = inner ? 0.58 : 1;
  const b = TALL_EAR.base - (inner ? 4 : 0);
  const j = TALL_EAR.joint + (inner ? 2 : 0);
  const r = 14.5 * k;
  const p = (dx: number, y: number) => `${f1(cx + dx * k)} ${f1(y)}`;
  return `M${p(-9.5, b)} C${p(-14, b - 29)} ${p(-16, j + 17)} ${p(-14.5, j)} A${f1(r)} ${f1(r)} 0 0 1 ${p(14.5, j)} C${p(16, j + 17)} ${p(14, b - 29)} ${p(9.5, b)} Z`;
}
/** The right ear's tip: a dome under the joint, up to the round tip. */
function tallTip(cx: number, inner: boolean): string {
  const k = inner ? 0.58 : 1;
  const j = TALL_EAR.joint - (inner ? 2 : 0);
  const t = TALL_EAR.tip + (inner ? 10 : 0);
  const r = 14.5 * k;
  const p = (dx: number, y: number) => `${f1(cx + dx * k)} ${f1(y)}`;
  return `M${p(-14.5, j)} C${p(-14, j - 9)} ${p(-13.5, j - 14)} ${p(-12.5, t + 25)} C${p(-9.5, t + 7)} ${p(-5, t)} ${p(0, t)} C${p(5, t)} ${p(9.5, t + 7)} ${p(12.5, t + 25)} C${p(13.5, j - 14)} ${p(14, j - 9)} ${p(14.5, j)} A${f1(r)} ${f1(r)} 0 0 1 ${p(-14.5, j)} Z`;
}
const TALL_MARKUP = `<g class="tall">
        <g class="te te-l"><g class="tear tear-l"><path d="${tallEar(-TALL_EAR.x, false)}" fill="var(--mascot-accent)"/><path d="${tallEar(-TALL_EAR.x, true)}" fill="var(--mascot-ear-in)"/></g></g>
        <g class="te te-r"><g class="tear tear-r"><path d="${tallLower(TALL_EAR.x, false)}" fill="var(--mascot-accent)"/><path d="${tallLower(TALL_EAR.x, true)}" fill="var(--mascot-ear-in)"/><g class="tip"><path d="${tallTip(TALL_EAR.x, false)}" fill="var(--mascot-accent)"/><path class="tip-in" d="${tallTip(TALL_EAR.x, true)}" fill="var(--mascot-ear-in)"/></g></g></g>
      </g>`;

const eyeN = (x: number, y: number) =>
  `<g class="eye"><ellipse cx="${x}" cy="${y}" rx="6.2" ry="7.4" fill="var(--mascot-eye)"/><circle cx="${x + 2.2}" cy="${y - 2.7}" r="1.9" fill="#fff"/><circle cx="${x - 2.2}" cy="${y + 3}" r=".8" fill="#fff" opacity=".7"/></g>`;
const eyeS = (x: number, y: number) =>
  `<ellipse cx="${x}" cy="${y}" rx="6.8" ry="8" fill="var(--mascot-eye)"/><path d="${star(x + 1.9, y - 2.3, 3.8, 1.2, 4)}" fill="#fff"/><circle cx="${x - 2.7}" cy="${y + 3}" r="1" fill="#fff" opacity=".85"/>`;

/** The bunny puppet markup (defs + `.hm` group); also reused by the welcome stage actors. */
export function bunnyMarkup(id: (name: string) => string): string {
  const gBody = `url(#${id('g-body')})`;
  const gEar = `url(#${id('g-ear')})`;
  const gBelly = `url(#${id('g-belly')})`;
  const clipBody = `url(#${id('clip-body')})`;
  const BUNNY = `
  <ellipse class="shadow" cx="0" cy="1" rx="74" ry="7" fill="rgba(70,40,15,.12)"/>
  <g class="hop">
    <g class="tfoot tfoot-l"><g class="foot foot-l"><ellipse cx="-38" cy="-4" rx="18" ry="6.8" fill="var(--mascot-paw)"/></g></g>
    <g class="tfoot tfoot-r"><g class="foot foot-r"><ellipse cx="38" cy="-4" rx="18" ry="6.8" fill="var(--mascot-paw)"/></g></g>
    <g class="body"><g class="squash"><g class="breathe">
      <g class="tail tail-l"><circle cx="-73" cy="-22" r="9.5" fill="var(--mascot-belly)"/><circle cx="-73" cy="-22" r="9.5" fill="none" stroke="rgba(120,80,40,.12)" stroke-width="1.2"/></g>
      <g class="tail tail-r"><circle cx="73" cy="-22" r="9.5" fill="var(--mascot-belly)"/><circle cx="73" cy="-22" r="9.5" fill="none" stroke="rgba(120,80,40,.12)" stroke-width="1.2"/></g>
      <g class="up">
        <g class="te te-l"><g class="ear-l"><ellipse cx="-21" cy="-180" rx="11.5" ry="26" transform="rotate(-12 -21 -180)" fill="var(--mascot-accent)"/><ellipse cx="-21" cy="-178" rx="6" ry="18" transform="rotate(-12 -21 -178)" fill="var(--mascot-ear-in)"/></g></g>
        <g class="te te-r"><g class="ear-r"><ellipse cx="21" cy="-180" rx="11.5" ry="26" transform="rotate(12 21 -180)" fill="var(--mascot-accent)"/><ellipse cx="21" cy="-178" rx="6" ry="18" transform="rotate(12 21 -178)" fill="var(--mascot-ear-in)"/></g></g>
      </g>
      ${TALL_MARKUP}
      <path d="${BODY}" fill="${gBody}"/>
      <g class="tc tc-l"><g class="cheek cheek-l"><g class="cheek-j"><ellipse cx="-65" cy="-84" rx="12" ry="21" fill="${gBody}"/></g></g></g>
      <g class="tc tc-r"><g class="cheek cheek-r"><g class="cheek-j"><ellipse cx="65" cy="-84" rx="12" ry="21" fill="${gBody}"/></g></g></g>
      <ellipse cx="0" cy="-46" rx="56" ry="50" fill="${gBelly}"/>
      <g clip-path="${clipBody}"><g class="broken"><ellipse cx="-50" cy="-30" rx="11" ry="9" fill="var(--mascot-accent)" opacity=".9"/><ellipse cx="44" cy="-140" rx="16" ry="12" fill="var(--mascot-accent)" opacity=".9"/></g></g>
      <g class="tf">
        <g class="points"><ellipse cx="0" cy="-80" rx="11" ry="8.5" fill="var(--mascot-accent)" opacity=".9"/></g>
        <g class="broken"><g class="tpatch"><ellipse cx="-7" cy="-81" rx="8.4" ry="6.2" transform="rotate(-24 -7 -81)" fill="var(--mascot-accent)"/><ellipse cx="7" cy="-81" rx="8.4" ry="6.2" transform="rotate(24 7 -81)" fill="var(--mascot-accent)"/><path d="M17 -106 C27 -112 42 -108 44 -97 C46 -86 38 -80 29 -81 C19 -82 14 -91 15 -98 C15.5 -102 15.5 -104 17 -106 Z" fill="var(--mascot-accent)"/></g></g>
        <ellipse cx="-43" cy="-77" rx="9" ry="5.5" fill="var(--mascot-blush)" opacity=".3"/>
        <ellipse cx="43" cy="-77" rx="9" ry="5.5" fill="var(--mascot-blush)" opacity=".3"/>
        <g class="face">
          <g class="eyes">${eyeN(-29, -93)}${eyeN(29, -93)}</g>
          <g class="eyes-star">${eyeS(-29, -93)}${eyeS(29, -93)}</g>
          <g class="eyes-happy" fill="none" stroke="var(--mascot-eye)" stroke-width="2.8" stroke-linecap="round"><path d="M-35.5 -91 Q-29 -99 -22.5 -91"/><path d="M22.5 -91 Q29 -99 35.5 -91"/></g>
          <g class="eyes-sleep" fill="none" stroke="var(--mascot-eye)" stroke-width="2.6" stroke-linecap="round"><path d="M-35 -93 Q-29 -87.5 -23 -93"/><path d="M23 -93 Q29 -87.5 35 -93"/></g>
          <g class="angry-brows" fill="none" stroke="var(--mascot-eye)" stroke-width="2.6" stroke-linecap="round"><path d="M-38 -107 L-22 -101.5"/><path d="M22 -101.5 L38 -107"/></g>
          <ellipse cx="-4.6" cy="-76.6" rx="5.4" ry="4" fill="var(--mascot-belly)" opacity=".9"/>
          <ellipse cx="4.6" cy="-76.6" rx="5.4" ry="4" fill="var(--mascot-belly)" opacity=".9"/>
          <g class="nose"><path d="M-3.6 -84 Q0 -86 3.6 -84 Q2.8 -80.8 0 -79.8 Q-2.8 -80.8 -3.6 -84 Z" fill="var(--mascot-nose)"/></g>
          <path class="mouth" d="M0 -79.8 L0 -77.6 M0 -77.6 Q-2.2 -75.2 -4.6 -76.2 M0 -77.6 Q2.2 -75.2 4.6 -76.2" fill="none" stroke="var(--mascot-mouth)" stroke-width="1.4" stroke-linecap="round"/>
          <path class="pout" d="M-4 -75.6 Q0 -78.6 4 -75.6" fill="none" stroke="var(--mascot-mouth)" stroke-width="1.6" stroke-linecap="round"/>
          <ellipse class="mouth-open" cx="0" cy="-75.8" rx="2.6" ry="2.2" fill="#8C4A47"/>
          <g class="snot"><path d="M1.5 -80.6 C1.6 -78.2 4.2 -76.4 4.2 -73.6 C4.2 -71.6 3.1 -70.5 2.2 -70.5 C1.2 -70.5 .3 -71.8 .5 -73.5 C.7 -75.8 1.2 -78.4 1.5 -80.6 Z" fill="rgba(185,220,255,.75)" stroke="rgba(120,170,230,.55)" stroke-width=".6"/><path d="M1.6 -77 Q2.6 -75.5 2.5 -73.6" fill="none" stroke="#fff" stroke-width=".8" stroke-linecap="round" opacity=".9"/></g>
        </g>
      </g>
      <g class="lop">
        <g class="te te-l"><g class="ear-l"><path d="${LOP_L}" fill="${gEar}"/><path d="${LOP_IN_L}" fill="var(--mascot-ear-in)" opacity=".5"/></g></g>
        <g class="te te-r"><g class="ear-r"><path d="${LOP_R}" fill="${gEar}"/><path d="${LOP_IN_R}" fill="var(--mascot-ear-in)" opacity=".5"/></g></g>
      </g>
      <g class="tp"><g class="paws">
        ${cookieMarkup()}
        <g class="paw paw-l"><ellipse cx="-16" cy="-44" rx="9.5" ry="11.5" transform="rotate(-24 -16 -44)" fill="var(--mascot-paw)"/><path d="M-14.4 -37.8 l1.6 2 M-11.9 -39 l1.6 2" stroke="rgba(150,90,40,.3)" stroke-width="1.1" stroke-linecap="round"/></g>
        <g class="paw paw-r"><ellipse cx="16" cy="-44" rx="9.5" ry="11.5" transform="rotate(24 16 -44)" fill="var(--mascot-paw)"/><path d="M14.4 -37.8 l-1.6 2 M11.9 -39 l-1.6 2" stroke="rgba(150,90,40,.3)" stroke-width="1.1" stroke-linecap="round"/></g>
      </g></g>
      <g class="anger"><path d="M-46 -177 Q-46 -172 -51 -172 M-42 -177 Q-42 -172 -37 -172 M-46 -163 Q-46 -168 -51 -168 M-42 -163 Q-42 -168 -37 -168" fill="none" stroke="#E8505B" stroke-width="2.4" stroke-linecap="round"/></g>
    </g></g></g>
  </g>`;

  return `
    <defs>
      <linearGradient id="${id('g-body')}" gradientUnits="userSpaceOnUse" x1="0" y1="-165" x2="0" y2="0">
        <stop offset="0" style="stop-color: var(--mascot-base-top)"/><stop offset="1" style="stop-color: var(--mascot-base-bottom)"/>
      </linearGradient>
      <linearGradient id="${id('g-ear')}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color: var(--mascot-accent)"/><stop offset="1" style="stop-color: var(--mascot-accent-dark)"/>
      </linearGradient>
      <radialGradient id="${id('g-belly')}" gradientUnits="userSpaceOnUse" cx="0" cy="-44" r="56">
        <stop offset="0" style="stop-color: var(--mascot-belly); stop-opacity: .8"/><stop offset=".55" style="stop-color: var(--mascot-belly); stop-opacity: .45"/><stop offset="1" style="stop-color: var(--mascot-belly); stop-opacity: 0"/>
      </radialGradient>
      <clipPath id="${id('clip-body')}"><path d="${BODY}"/></clipPath>
    </defs>
    <g class="hm ears-lop" transform="translate(200 246) scale(1.2)">
      <g class="mover">${BUNNY}<g class="fx"></g></g>
    </g>`;
}

// ---------- CSS (states and keyframes exactly as in the prototype) ----------
/** Bunny pivots, states and keyframes; also reused (with motion switched off) by the welcome stage actors. */
export const BUNNY_CSS = `
/* bunny: pivots */
.hop, .body, .breathe, .squash { transform-box: fill-box; transform-origin: 50% 100%; }
.foot, .cookie, .shadow, .paws { transform-box: fill-box; transform-origin: center; }
.paw { transform-box: fill-box; transform-origin: 50% 100%; }
.ear-l, .ear-r { transform-box: fill-box; transition: transform .45s cubic-bezier(.34, 1.56, .64, 1); }
.ears-lop .ear-l { transform-origin: 80% 4%; }
.ears-lop .ear-r { transform-origin: 20% 4%; }
.ears-up .ear-l, .ears-up .ear-r { transform-origin: 50% 95%; }
/* The attachment is the midpoint of the original path's closing edge (±26.5,-155.5).
 * Percentages use that path's fill-box, so the pivot stays local in both SVG viewBoxes. */
.surprise-ears.ears-lop .ear-l { transform-origin: 95.352% 9.4816%; }
.surprise-ears.ears-lop .ear-r { transform-origin: 4.648% 9.4816%; }
.cheek { transform-box: fill-box; transform: scale(var(--puff, 1)); transition: transform .7s cubic-bezier(.34, 1.56, .64, 1); }
.cheek-l { transform-origin: 100% 50%; }
.cheek-r { transform-origin: 0% 50%; }
.cheek-j { transform-box: fill-box; transform-origin: center; }
.face { transition: transform .45s cubic-bezier(.25, .8, .3, 1); }
.eye { transform-box: fill-box; transform-origin: center; transition: transform .1s ease; }
.nose { transform-box: fill-box; transform-origin: 50% 0%; }
.cookie { opacity: 0; }
.lop, .up { display: none; }
.ears-lop .lop, .ears-up .up { display: inline; }

/* surprise (wave 3, idea 11): the tall ears show only during it; pivots at their base and at the right ear's joint */
.tall .tear { opacity: 0; }
.tall .tear-l { transform-box: view-box; transform-origin: -22px -146px; }
.tall .tear-r { transform-box: view-box; transform-origin: 22px -146px; }
.tall .tip { transform-box: view-box; transform-origin: 22px -222px; }
.m-round .eye { transform: scale(1.3, 1.12); }
.m-o .mouth-open { transform: scale(.85, 1.25); }

/* resting */
.breathe { animation: breathe 3.6s ease-in-out infinite; }
@keyframes breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(.994, 1.018); } }
.blink .eye { transform: scaleY(.12); }
.startle .eye { transform: scale(1.25); }
.look-l .face { transform: translateX(-2.4px); }
.look-r .face { transform: translateX(2.4px); }
.look-up .face { transform: translateY(-2.5px); }
.sway .ear-l { transform: rotate(5deg); }
.sway .ear-r { transform: rotate(-4deg); }
.perk .ear-l { transform: rotate(-12deg); }
.perk .ear-r { transform: rotate(12deg); }
.twitch .ear-l { transform: rotate(-14deg); }
.sniffle .nose { animation: nose .12s ease-in-out 4 alternate; }
@keyframes nose { to { transform: scale(1.1, .82) translateY(.4px); } }

/* alert: lifts an ear, looks around, sniffs */
.ears-lop.lift-r .ear-r { transform: rotate(-38deg); }
.ears-up.lift-r .ear-r { transform: rotate(9deg) translateY(-3px); }
.ears-up.lift-r .ear-l { transform: rotate(-4deg); }
.alert .eye { transform: scale(1.08); }
.look-far-l .face { transform: translate(-5px, -1px); }
.look-far-r .face { transform: translate(5px, -1px); }
.sniffing .nose { animation: nose .1s ease-in-out infinite alternate; }

/* quarter turn (same bunny) */
.tf, .tp, .te, .tc, .tfoot, .tpatch { transform-box: fill-box; transition: transform .28s cubic-bezier(.3, .7, .3, 1); }
.tf, .tpatch, .tfoot { transform-origin: center; }
.te { transform-origin: 50% 0%; }
.tc-l { transform-origin: 100% 50%; }
.tc-r { transform-origin: 0% 50%; }
.turn-r { --dir: 1; }
.turn-l { --dir: -1; }
.turn-r .tf, .turn-r .tpatch { transform: translateX(13px) scaleX(.88); }
.turn-l .tf, .turn-l .tpatch { transform: translateX(-13px) scaleX(.88); }
.turn-r .tp { transform: translateX(9px); }
.turn-l .tp { transform: translateX(-9px); }
.turn-r .te-l { transform: translateX(16px) scale(.86); }
.turn-r .te-r { transform: translateX(8px); }
.turn-l .te-l { transform: translateX(-8px); }
.turn-l .te-r { transform: translateX(-16px) scale(.86); }
.turn-r .tc-l, .turn-l .tc-r { transform: scale(.55); }
.turn-r .tc-r, .turn-l .tc-l { transform: scale(1.04); }
.turn-r .tfoot-l { transform: translateX(12px) scale(.9); }
.turn-r .tfoot-r { transform: translateX(5px); }
.turn-l .tfoot-r { transform: translateX(-12px) scale(.9); }
.turn-l .tfoot-l { transform: translateX(-5px); }
.tail { opacity: 0; transform-box: fill-box; transform-origin: center; transition: opacity .15s; }
.turn-r .tail-l, .turn-l .tail-r { opacity: 1; }

/* walking = hopping like a rabbit */
.walking .hop { animation: bunnyhop .52s cubic-bezier(.3, .6, .4, 1) infinite; }
@keyframes bunnyhop {
  0%, 70%, 100% { transform: translateY(0) rotate(0); }
  32% { transform: translateY(-15px) rotate(calc(var(--dir, 1) * 3deg)); }
}
.walking .squash { animation: hopsquash .52s ease-in-out infinite; }
@keyframes hopsquash { 0%, 100% { transform: scale(1.05, .95); } 32% { transform: scale(.96, 1.05); } 68% { transform: scale(1.06, .94); } }
.walking .foot { animation: tuck .52s ease-in-out infinite; }
@keyframes tuck { 0%, 70%, 100% { transform: none; } 32% { transform: translate(calc(var(--dir, 1) * -4px), -5px) rotate(calc(var(--dir, 1) * 14deg)) scale(.86); } }
.walking .ear-l, .walking .ear-r { animation: earhop .52s ease-in-out infinite; }
@keyframes earhop { 0%, 100% { transform: rotate(0); } 32% { transform: rotate(-9deg); } 66% { transform: rotate(6deg); } }
.walking .tail { animation: tailbob .26s ease-in-out infinite alternate; }
@keyframes tailbob { to { transform: translateY(-2px) scale(1.06); } }

/* eyes and mouth */
.eyes-star, .eyes-happy, .eyes-sleep { opacity: 0; }
.m-star .eyes, .m-happy .eyes, .m-sleep .eyes { opacity: 0; }
.m-star .eyes-star, .m-happy .eyes-happy, .m-sleep .eyes-sleep { opacity: 1; }
.mouth-open { opacity: 0; transform-box: fill-box; transform-origin: 50% 20%; transition: transform .25s ease, opacity .1s; }
.m-open .mouth-open, .m-yawn .mouth-open { opacity: 1; }
.m-open .mouth, .m-yawn .mouth { opacity: 0; }
.m-yawn .mouth-open { transform: scale(2.1, 2.7); }

/* eating */
.chewing .cheek-j { animation: chew .17s ease-in-out infinite alternate; }
@keyframes chew { to { transform: scale(1.07, .95); } }
.chewing .nose { animation: nose .12s ease-in-out infinite alternate; }

/* anger */
.angry-brows, .pout, .anger { opacity: 0; }
.m-angry .angry-brows, .m-angry .pout, .m-angry .anger { opacity: 1; }
.m-angry .mouth, .m-angry .mouth-open { opacity: 0; }
.m-angry .eye { transform: scaleY(.82); }
.anger { transform-box: fill-box; transform-origin: center; }
.m-angry .anger { animation: throb .35s ease-in-out infinite alternate; }
@keyframes throb { from { transform: scale(.9); } to { transform: scale(1.15); } }
.m-angry.ears-lop .ear-l { transform: rotate(-8deg); }
.m-angry.ears-lop .ear-r { transform: rotate(8deg); }

/* sleep */
.sleeping .breathe { animation: breathe-deep 3.4s ease-in-out infinite; }
@keyframes breathe-deep { 0%, 100% { transform: scale(1.03, .955); } 50% { transform: scale(1.045, .985); } }
.sleeping .ear-l { transform: rotate(7deg); }
.sleeping .ear-r { transform: rotate(-7deg); }
.snot { opacity: 0; transform-box: fill-box; transform-origin: 50% 0%; }
.sleeping .snot { opacity: 1; animation: drip 3.4s ease-in-out infinite; }
@keyframes drip { 0%, 100% { transform: scaleY(.35); } 50% { transform: scaleY(1.15); } }
.sniff .snot { animation: sniff .45s ease-in forwards; }
@keyframes sniff { to { transform: scaleY(.08); } }

/* coats: which markings are visible */
.points, .broken { display: none; }
.pat-points .points, .pat-broken .broken { display: inline; }

/* reduced motion (.rm is toggled on the svg by ReducedMotion) */
.rm .breathe, .rm .sleeping .breathe, .rm .walking .hop, .rm .walking .squash, .rm .walking .foot, .rm .walking .ear-l, .rm .walking .ear-r, .rm .walking .tail,
.rm .chewing .cheek-j, .rm .chewing .nose, .rm .sniffle .nose, .rm .sniffing .nose, .rm .sleeping .snot, .rm .m-angry .anger { animation: none; }
.rm .cheek, .rm .ear-l, .rm .ear-r, .rm .face, .rm .tf, .rm .tp, .rm .te, .rm .tc, .rm .tfoot, .rm .tpatch { transition: none; }
`;

const BUNNY_SPEC: MascotSpec<BunnyCoat> = {
  kind: 'bunny',
  viewBox: '0 0 400 260',
  css: BUNNY_CSS,
  markup: bunnyMarkup,
  coats: BUNNY_COATS,
  patternClasses: ['pat-points', 'pat-broken'],
  zOrigin: { x: 36, y: -160 },
  crumbY: -74,
};

export class Bunny extends MascotBase<BunnyScene, BunnyCoat, BunnyPose> {
  constructor(host: HTMLElement, options: BunnyOptions = {}) {
    super(host, options, BUNNY_SPEC);
    this.setEars(options.ears ?? 'lop');
    this.finishSetup(options);
  }

  get ears(): EarStyle {
    return this.hm.classList.contains('ears-up') ? 'upright' : 'lop';
  }

  setEars(style: EarStyle): void {
    const up = style === 'upright';
    this.hm.classList.toggle('ears-up', up);
    this.hm.classList.toggle('ears-lop', !up);
  }

  /** The ears currently shown (lop or upright). */
  private visibleEars(): { l: SVGGElement; r: SVGGElement } {
    const sel = this.hm.classList.contains('ears-up') ? '.up' : '.lop';
    return { l: this.$(`${sel} .ear-l`), r: this.$(`${sel} .ear-r`) };
  }

  protected registerIdleLoops(): void {
    this.addIdleLoop(() => {
      this.pulse('blink', 140);
      if (Math.random() < 0.25) this.timeout(() => this.pulse('blink', 130), 300);
    }, 2400, 3200);
    this.addIdleLoop(() => this.pulse(Math.random() < 0.5 ? 'look-l' : 'look-r', 1200), 5000, 4000);
    this.addIdleLoop(() => this.pulse('sniffle', 520), 1800, 2600);
    this.addIdleLoop(() => this.pulse(this.hm.classList.contains('ears-up') ? 'twitch' : 'sway', 520), 4200, 4800);
    // its own sniff now and then: idle life, so any scene the app asks for interrupts it (wave 3, I-01)
    this.addIdleLoop(() => void this.playOwn('alert'), 16000, 10000);
  }

  protected runScene(scene: BunnyScene): Promise<void> {
    switch (scene) {
      case 'greet':
        return this.greet();
      case 'eat':
        return this.eat();
      case 'walk':
        return this.walk();
      case 'jump':
        return this.jump();
      case 'alert':
        return this.alert();
      case 'angry':
        return this.angry();
      case 'surprise':
        return this.surprise();
      default:
        return Promise.resolve();
    }
  }

  // ---------- surprise: the ears shoot up (wave 3, Felix's idea 11 «Уши торчком») ----------
  /**
   * The same lop ears lift at their roots, settle briefly and fall back with a soft follow-through.
   * Outline and colour never switch. Decoration: under reduced motion nothing happens.
   */
  private async surprise(): Promise<void> {
    if (this.isReduced) return;
    const upright = this.ears === 'upright';
    const short = this.visibleEars();
    this.hm.classList.add('surprise-ears');
    const run = (el: SVGElement, frames: Keyframe[]) => fxAnimate(el, frames, { duration: SURPRISE_S * 1000, fill: 'forwards' });
    // every part is one Web Animation over the whole surprise (no timers): seekable for frame checks
    const anims: Array<Animation | undefined> = [
      ...(upright ? [run(short.l, surpriseFrames(SHORT_UPRIGHT)), run(short.r, surpriseFrames(SHORT_UPRIGHT))]
        : earLifts(short.l, short.r).flatMap(lift => lift.compile().map(c => fxAnimate(lift.el, c.frames, c.timing)))),
      run(this.hopG, surpriseFrames(SURPRISE.hop)),
      run(this.body, surpriseFrames(SURPRISE.squash)),
      run(this.shadow, surpriseFrames(SURPRISE.shadow)),
      ...this.$$('.eyes .eye').map((e) => run(e, surpriseFrames(SURPRISE.eyes))),
      run(this.$('.mouth'), surpriseFrames(SURPRISE.mouth)),
      run(this.$('.mouth-open'), surpriseFrames(SURPRISE.mouthOpen)),
    ];
    try {
      await this.wait(SURPRISE_S * 1000);
    } finally {
      for (const a of anims) a?.cancel();
      this.clearSurprise();
    }
  }

  /** Back to the resting ears (the surprise leaves nothing inline). */
  private clearSurprise(): void {
    for (const path of this.$$('.lop .ear-l > path, .lop .ear-r > path')) path.style.removeProperty('d');
    for (const el of this.$$('.lop .ear-l, .lop .ear-r, .up .ear-l, .up .ear-r')) {
      el.style.removeProperty('transform');
      el.style.removeProperty('opacity');
    }
    this.hm.classList.remove('m-round', 'm-o', 'surprise-ears');
  }

  protected override resetPose(): void {
    super.resetPose();
    this.clearSurprise();
  }

  protected jumpBodyFrames(binky: boolean): Keyframe[] {
    return [
      { transform: 'scale(1,1)', offset: 0 },
      { transform: 'scale(1.08,.88)', offset: 0.18 },
      { transform: 'scale(.95,1.07)', offset: 0.3 },
      { transform: binky ? 'rotate(14deg) scale(1,1)' : 'scale(1,1)', offset: 0.48 },
      { transform: binky ? 'rotate(-8deg) scale(.98,1.02)' : 'scale(.97,1.04)', offset: 0.66 },
      { transform: 'scale(1.07,.9)', offset: 0.84 },
      { transform: 'scale(.98,1.02)', offset: 0.93 },
      { transform: 'scale(1,1)', offset: 1 },
    ];
  }

  protected jumpEars(o: KeyframeAnimationOptions): void {
    const e = this.visibleEars();
    e.l.animate([{ transform: 'none' }, { transform: 'rotate(10deg)', offset: 0.3 }, { transform: 'rotate(-14deg)', offset: 0.55 }, { transform: 'rotate(12deg)', offset: 0.86 }, { transform: 'none' }], o);
    e.r.animate([{ transform: 'none' }, { transform: 'rotate(-10deg)', offset: 0.3 }, { transform: 'rotate(14deg)', offset: 0.55 }, { transform: 'rotate(-12deg)', offset: 0.86 }, { transform: 'none' }], o);
  }

  // ---------- jump with a binky (happy twist in the air) ----------
  private async jump(): Promise<void> {
    this.setEyes('star');
    await this.jumpMotion(40, 960, true);
    await this.wait(250);
    this.setEyes('normal');
  }

  // ---------- greet ----------
  private async greet(): Promise<void> {
    this.setEyes('star');
    this.mouthOpen(true);
    this.hm.classList.add('perk');
    const d = 2100;
    void this.anim(this.body, [{ transform: 'none' }, { transform: 'rotate(-4deg)', offset: 0.18 }, { transform: 'rotate(-4deg)', offset: 0.8 }, { transform: 'none' }], { duration: d, easing: 'ease-in-out' });
    await this.anim(
      this.pawR,
      [
        { transform: 'none' },
        { transform: 'translate(40px,-26px) rotate(-22deg)', offset: 0.16 },
        { transform: 'translate(40px,-26px) rotate(16deg)', offset: 0.3 },
        { transform: 'translate(40px,-26px) rotate(-22deg)', offset: 0.44 },
        { transform: 'translate(40px,-26px) rotate(16deg)', offset: 0.58 },
        { transform: 'translate(40px,-26px) rotate(-22deg)', offset: 0.72 },
        { transform: 'none', offset: 1 },
      ],
      { duration: d, easing: 'ease-in-out' },
    );
    this.mouthOpen(false);
    this.hm.classList.remove('perk');
    await this.jumpMotion(12, 620);
    this.setEyes('normal');
  }

  // ---------- eat ----------
  private async eat(): Promise<void> {
    this.cookie.style.opacity = '1';
    this.hm.classList.add('look-up');
    await this.anim(this.cookie, [{ transform: 'translateY(-210px) rotate(-60deg)' }, { transform: 'none' }], { duration: 700, easing: SPRING });
    this.hm.classList.remove('look-up');
    this.setEyes('star');
    void this.anim(this.body, [{ transform: 'none' }, { transform: 'scale(1.05,.95)' }, { transform: 'none' }], { duration: 280 });
    await this.wait(260);
    await this.anim(this.paws, [{ transform: 'none' }, { transform: 'translateY(-24px)' }], { duration: 280, easing: EASINGS.lift });
    this.setEyes('happy');
    this.hm.classList.add('chewing');
    for (let i = 0; i < 9; i++) {
      this.mouthOpen(i % 2 === 0);
      if (i % 2 === 1) {
        this.crumb();
        this.crumb();
        this.cookie.style.transform = `scale(${(1 - (i + 1) * 0.09).toFixed(2)}) rotate(${i * 6}deg)`;
      }
      await this.anim(this.body, [{ transform: 'none' }, { transform: 'translateY(1.6px) rotate(1.5deg) scale(1.012,.985)' }, { transform: 'none' }], { duration: 170, easing: 'ease-in-out' });
    }
    this.mouthOpen(false);
    this.hm.classList.remove('chewing');
    this.cookie.style.opacity = '0';
    this.cookie.style.transform = '';
    this.setPuff(1.25);
    this.setEyes('star');
    this.pulse('perk', 400);
    await this.anim(this.paws, [{ transform: 'translateY(-24px)' }, { transform: 'none' }], { duration: 320, easing: SPRING });
    await this.wait(900);
    this.setEyes('normal');
    this.timeout(() => this.setPuff(1), 1800);
  }

  // ---------- walk: quarter turn and hops like a rabbit ----------
  private async walk(): Promise<void> {
    const dist = 70;
    const dur = 1820;
    this.hm.classList.add('turn-r');
    await this.jumpMotion(12, 520);
    this.hm.classList.add('walking');
    await this.anim(this.mover, [{ transform: 'translateX(0px)' }, { transform: `translateX(${dist}px)` }], { duration: dur, easing: 'linear' });
    this.hm.classList.remove('walking');
    await this.wait(140);
    this.hm.classList.replace('turn-r', 'turn-l');
    await this.jumpMotion(10, 480);
    this.hm.classList.add('walking');
    await this.anim(this.mover, [{ transform: `translateX(${dist}px)` }, { transform: 'translateX(0px)' }], { duration: dur, easing: 'linear' });
    this.hm.classList.remove('walking', 'turn-l');
    await this.jumpMotion(10, 480);
    this.setEyes('star');
    await this.wait(600);
    this.setEyes('normal');
  }

  // ---------- angry: thumps a hind foot (like a real rabbit), then "don't touch!" ----------
  private async thump(): Promise<void> {
    this.shadow.animate([{ transform: 'none' }, { transform: 'scaleX(1.06)', offset: 0.7 }, { transform: 'none' }], { duration: 260 });
    await this.anim(
      this.footR,
      [
        { transform: 'none' },
        { transform: 'translate(-2px,-10px) rotate(-14deg)', offset: 0.5 },
        { transform: 'translateY(1px) scaleX(1.18)', offset: 0.75 },
        { transform: 'none' },
      ],
      { duration: 260, easing: 'ease-in' },
    );
  }

  private async angry(): Promise<void> {
    this.setEyes('normal');
    this.hm.classList.add('m-angry');
    this.setPuff(1.2);
    await this.thump();
    await this.thump();
    void this.anim(this.body, [{ transform: 'none' }, { transform: 'rotate(3deg)', offset: 0.15 }, { transform: 'rotate(3deg)', offset: 0.85 }, { transform: 'none' }], { duration: 1500, easing: 'ease-in-out' });
    await this.anim(
      this.pawR,
      [
        { transform: 'none' },
        { transform: 'translate(10px,-26px) scale(1.25)', offset: 0.15 },
        { transform: 'translate(14px,-26px) scale(1.25) rotate(14deg)', offset: 0.3 },
        { transform: 'translate(6px,-26px) scale(1.25) rotate(-14deg)', offset: 0.45 },
        { transform: 'translate(14px,-26px) scale(1.25) rotate(14deg)', offset: 0.6 },
        { transform: 'translate(6px,-26px) scale(1.25) rotate(-14deg)', offset: 0.75 },
        { transform: 'none', offset: 1 },
      ],
      { duration: 1500, easing: 'ease-in-out' },
    );
    this.hm.classList.remove('m-angry');
    this.setEyes('happy');
    await this.anim(this.body, [{ transform: 'none' }, { transform: 'scale(1.03,.97)', offset: 0.5 }, { transform: 'none' }], { duration: 700, easing: 'ease-in-out' });
    this.setPuff(1);
    this.setEyes('normal');
  }

  // ---------- alert: lifts an ear -> looks around -> sniffs ----------
  private sniffPuffs(): void {
    for (let k = 0; k < 3; k++) {
      this.timeout(() => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', 'M9 -86 q3 -1.5 5 0 M10 -81 q3 -1 5.5 .5');
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', 'var(--mascot-accent-dark)');
        p.setAttribute('stroke-width', '1.4');
        p.setAttribute('stroke-linecap', 'round');
        this.fx.appendChild(p);
        const done = () => p.remove();
        p.animate(
          [
            { opacity: 0, transform: 'translate(0px,0px)' },
            { opacity: 0.8, transform: 'translate(2px,-1px)', offset: 0.4 },
            { opacity: 0, transform: 'translate(6px,-3px)' },
          ],
          { duration: 420, easing: 'ease-out' },
        ).finished.then(done, done);
      }, k * 330);
    }
  }

  private async alert(): Promise<void> {
    this.hm.classList.add('lift-r');
    await this.wait(350);
    this.hm.classList.add('alert', 'look-far-l');
    await this.anim(this.body, [{ transform: 'none' }, { transform: 'rotate(-3deg)' }], { duration: 380, easing: 'ease-out' });
    await this.wait(450);
    this.hm.classList.replace('look-far-l', 'look-far-r');
    await this.anim(this.body, [{ transform: 'rotate(-3deg)' }, { transform: 'rotate(3deg)' }], { duration: 520, easing: 'ease-in-out' });
    await this.wait(450);
    this.hm.classList.remove('look-far-r');
    this.hm.classList.add('look-up', 'sniffing');
    await this.anim(this.body, [{ transform: 'rotate(3deg)' }, { transform: 'translateY(-3px) scale(.98,1.04)' }], { duration: 360, easing: 'ease-out' });
    this.sniffPuffs();
    await this.wait(1100);
    this.hm.classList.remove('sniffing', 'look-up');
    await this.anim(this.body, [{ transform: 'translateY(-3px) scale(.98,1.04)' }, { transform: 'none' }], { duration: 420, easing: SPRING });
    this.hm.classList.remove('lift-r', 'alert');
    this.pulse('blink', 140);
  }

  // ---------- static poses (prototype ?pose= params; wave/eat added for the demo) ----------
  pose(name: BunnyPose): void {
    this.resetPose();
    switch (name) {
      case 'turn':
        this.hm.classList.add('turn-r');
        break;
      case 'alert':
        this.hm.classList.add('lift-r', 'alert', 'look-far-r');
        break;
      case 'sleep':
        this.hm.classList.add('sleeping');
        this.setEyes('sleep');
        break;
      case 'angry':
        this.hm.classList.add('m-angry');
        this.setPuff(1.2);
        this.pawR.style.transform = 'translate(10px,-26px) scale(1.25)';
        break;
      case 'wave':
        this.pawR.style.transform = 'translate(40px,-26px) rotate(-22deg)';
        this.body.style.transform = 'rotate(-4deg)';
        this.hm.classList.add('perk');
        this.mouthOpen(true);
        break;
      case 'eat':
        this.cookie.style.opacity = '1';
        this.paws.style.transform = 'translateY(-24px)';
        this.setEyes('happy');
        this.mouthOpen(true);
        break;
      case 'surprise': {
        // The same visible pair as at rest, held at the peak of its own motion.
        this.hm.classList.add('surprise-ears');
        const short = this.visibleEars();
        if (this.ears === 'upright') {
          const k = surpriseFrames(SHORT_UPRIGHT).filter(frame => (frame.offset ?? 0) <= SURPRISE_PEAK / SURPRISE_S).pop();
          if (typeof k?.transform === 'string') for (const el of [short.l, short.r]) el.style.transform = k.transform;
        } else {
          for (const lift of earLifts(short.l, short.r)) lift.el.style.setProperty('d', lift.styleAt(SURPRISE_PEAK).d!);
        }
        this.hm.classList.add('m-round');
        break;
      }
      default:
        break;
    }
  }
}
