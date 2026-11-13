/**
 * «Живые анимации», round 2 (31.10, GALLERY-ONLY) — Pompon lying on his side after a flop: his OWN drawing (Felix:
 * the sitting puppet turned 90° «очень странно выглядит и не натурально»).
 *
 * A long, low body on the floor, the head resting on its side (on the lower cheek, the floor clip presses that cheek
 * flat), both lop ears spread out on the floor beyond the head, the belly and the flank visible, the hind feet
 * stretched out behind, the front paws tucked under the chin, eyes ^ ^. Same style as the puppet: the head, ears,
 * cheeks (with Pompon's fluff) and face use the puppet's own shapes and coordinates (bunny.ts), only placed and turned;
 * the body is drawn new. Fills are the puppet's own gradients (url(#<instance>-g-body / -g-ear)), so every coat works.
 *
 * Puppet units (x = 0 centre of the sitting puppet, y = 0 floor). Moving parts (each a group with its own pivot):
 *   lf      the whole figure (turns about the head centre: the fall-in / the roll back)
 *   lfBody  body + belly + tail: breathes (scaleY about the floor)
 *   lfHead  head + face + cheeks: a tiny nod with the breath
 *   lfFeet  both hind feet (kick out, stretch); lfFootU the upper one alone (lifts with the hip)
 *   lfEarU / lfEarD  the upper / lower ear, each about its root (flop down on the landing, a twitch)
 *   lfPaws  the front paws under the chin
 */

import { cheekFluff } from '../../src/fur';

/** The puppet's right lop ear and its pink inside (bunny.ts LOP_R / LOP_IN_R); the root is at (26.5, -155.5). */
const LOP_R = 'M24 -160 C44 -170 67 -155 75 -128 C81 -107 77 -86 66 -83 C56 -81 53 -96 53 -111 C53 -129 44 -145 29 -151 Z';
const LOP_IN_R = 'M29 -151 C44 -145 53 -129 53 -111 C53 -99 55 -90 61 -86 C58 -95 57.5 -108 58 -118 C58.5 -134 50 -146 37 -153 Z';
const EAR_ROOT = { x: 26.5, y: -155.5 } as const;
/** The ear's own direction (root → tip), degrees from +x (y down). */
const EAR_DIR = (Math.atan2(-85 - EAR_ROOT.y, 64 - EAR_ROOT.x) * 180) / Math.PI;

/** The head: the puppet's head outline (its top is the BODY path's), closed by a round chin. Head centre (0, -106). */
const HEAD_D = 'M0 -163 C40 -163 64 -140 67 -112 C69 -96 68 -80 63 -69 C56 -55 34 -49 0 -49 C-34 -49 -56 -55 -63 -69 C-68 -80 -69 -96 -67 -112 C-64 -140 -40 -163 0 -163 Z';
const HEAD_C = { x: 0, y: -106 } as const;

/** Where the head lies and how far it is turned onto its side (the lower cheek on the floor). */
export const LF_HEAD = { x: 32, y: -73, deg: 60 } as const;

const rad = (d: number) => (d * Math.PI) / 180;
/** A point of the head's own coordinates → the floor's. */
function headPt(x: number, y: number): { x: number; y: number } {
  const a = rad(LF_HEAD.deg);
  const dx = x - HEAD_C.x;
  const dy = y - HEAD_C.y;
  return { x: LF_HEAD.x + dx * Math.cos(a) - dy * Math.sin(a), y: LF_HEAD.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** The ears' roots on the floor (upper = the bunny's right ear, on top; lower = his left one, nearer the floor). */
export const LF_EAR_U = headPt(-EAR_ROOT.x, EAR_ROOT.y);
export const LF_EAR_D = headPt(EAR_ROOT.x, EAR_ROOT.y);
/** Where each ear's tip lies (spread out beyond the head, the lower one on the floor). */
const EAR_U_TIP = { x: 134, y: -84 } as const;
const EAR_D_TIP = { x: 146, y: -7 } as const;

/** Pivots of the moving groups (CSS view-box origins, puppet units). */
export const LF_PIVOT = {
  lf: { x: LF_HEAD.x, y: LF_HEAD.y },
  lfBody: { x: -50, y: 0 },
  lfHead: { x: LF_HEAD.x, y: 0 },
  lfFeet: { x: -112, y: -14 },
  lfFootU: { x: -112, y: -21 },
  lfEarU: LF_EAR_U,
  lfEarD: LF_EAR_D,
  lfPaws: { x: -16, y: 0 },
} as const;

/** The figure's extent on the floor (puppet units): for the shadow. */
export const LF_SPAN = { left: -149, right: 146 } as const;

const OUTLINE = 'stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke; paint-order: stroke fill';
const EDGE = 'fill: none; stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round';
const f = (v: number) => String(Math.round(v * 100) / 100);

/** One ear lying from its root towards `tip` (the puppet's ear shape, turned; never reshaped). */
function ear(cls: string, root: { x: number; y: number }, tip: { x: number; y: number }, gEar: string, mirror: boolean): string {
  const dir = (Math.atan2(tip.y - root.y, tip.x - root.x) * 180) / Math.PI;
  // right ear: root to the origin, turn its own direction onto `dir`, root to its place;
  // left ear: the same shape mirrored first (its own direction is then 180° − EAR_DIR)
  const tr = mirror
    ? `translate(${f(root.x)} ${f(root.y)}) rotate(${f(dir - (180 - EAR_DIR))}) translate(${f(EAR_ROOT.x)} ${f(-EAR_ROOT.y)}) scale(-1 1)`
    : `translate(${f(root.x)} ${f(root.y)}) rotate(${f(dir - EAR_DIR)}) translate(${f(-EAR_ROOT.x)} ${f(-EAR_ROOT.y)})`;
  return `<g class="${cls}"><g transform="${tr}"><path d="${LOP_R}" fill="${gEar}" style="${OUTLINE}"/><path d="${LOP_IN_R}" fill="var(--mascot-ear-in)" opacity=".5"/></g></g>`;
}

/** The lying Pompon (hidden until a flop shows it: `.al-lf { opacity: 0 }`). */
export function lyingMarkup(id: (n: string) => string): string {
  const gBody = `url(#${id('g-body')})`;
  const gEar = `url(#${id('g-ear')})`;
  const gBelly = `url(#${id('al-lf-belly')})`;
  const fl = cheekFluff('l');
  const fr = cheekFluff('r');
  const toes = 'stroke="rgba(150,90,40,.3)" stroke-width="1.1" stroke-linecap="round"';
  const head = `<g transform="translate(${LF_HEAD.x} ${LF_HEAD.y}) rotate(${LF_HEAD.deg}) translate(${-HEAD_C.x} ${-HEAD_C.y})">
      <path d="${HEAD_D}" fill="${gBody}" style="${OUTLINE}"/>
      <g><ellipse cx="-65" cy="-84" rx="12" ry="21" fill="${gBody}"/><g class="al-lf-fur"><path d="${fl.fill}" fill="${gBody}"/><path d="${fl.edge}" style="${EDGE}"/></g></g>
      <g><ellipse cx="65" cy="-84" rx="12" ry="21" fill="${gBody}"/><g class="al-lf-fur"><path d="${fr.fill}" fill="${gBody}"/><path d="${fr.edge}" style="${EDGE}"/></g></g>
      <ellipse cx="-43" cy="-77" rx="9" ry="5.5" fill="var(--mascot-blush)" opacity=".3"/>
      <ellipse cx="43" cy="-77" rx="9" ry="5.5" fill="var(--mascot-blush)" opacity=".3"/>
      <g fill="none" stroke="var(--mascot-eye)" stroke-width="2.8" stroke-linecap="round"><path d="M-35.5 -91 Q-29 -99 -22.5 -91"/><path d="M22.5 -91 Q29 -99 35.5 -91"/></g>
      <ellipse cx="-4.6" cy="-76.6" rx="5.4" ry="4" fill="var(--mascot-belly)" opacity=".9"/>
      <ellipse cx="4.6" cy="-76.6" rx="5.4" ry="4" fill="var(--mascot-belly)" opacity=".9"/>
      <path d="M-3.6 -84 Q0 -86 3.6 -84 Q2.8 -80.8 0 -79.8 Q-2.8 -80.8 -3.6 -84 Z" fill="var(--mascot-nose)"/>
      <path d="M0 -79.8 L0 -77.6 M0 -77.6 Q-2.2 -75.2 -4.6 -76.2 M0 -77.6 Q2.2 -75.2 4.6 -76.2" fill="none" stroke="var(--mascot-mouth)" stroke-width="1.4" stroke-linecap="round"/>
    </g>`;
  // the body: long and low, the hip highest, its front end tucked under the head; the belly light along the bottom
  const body = 'M-122 -27 C-124 -56 -99 -74 -64 -74 C-32 -74 -6 -68 14 -56 C30 -46 34 -20 26 -1 L-98 -1 C-113 -1 -121 -12 -122 -27 Z';
  return `
    <defs><radialGradient id="${id('al-lf-belly')}" cx=".5" cy=".55" r=".55"><stop offset="0" style="stop-color: var(--mascot-belly); stop-opacity: .8"/><stop offset=".6" style="stop-color: var(--mascot-belly); stop-opacity: .4"/><stop offset="1" style="stop-color: var(--mascot-belly); stop-opacity: 0"/></radialGradient></defs>
    <g class="al-lf-feet">
      <g class="al-lf-footu"><ellipse cx="-126" cy="-21" rx="20" ry="6.6" transform="rotate(-9 -126 -21)" fill="var(--mascot-paw)" style="${OUTLINE}"/></g>
      <ellipse cx="-128" cy="-7" rx="21" ry="6.8" fill="var(--mascot-paw)" style="${OUTLINE}"/>
    </g>
    <g class="al-lf-body">
      <path d="${body}" fill="${gBody}" style="${OUTLINE}"/>
      <ellipse cx="-46" cy="-15" rx="58" ry="15" fill="${gBelly}"/>
      <g><circle cx="-117" cy="-50" r="9.5" fill="var(--mascot-belly)" style="${OUTLINE}"/><circle cx="-117" cy="-50" r="9.5" fill="none" stroke="rgba(120,80,40,.12)" stroke-width="1.2"/></g>
    </g>
    ${ear('al-lf-earu', LF_EAR_U, EAR_U_TIP, gEar, true)}
    ${ear('al-lf-eard', LF_EAR_D, EAR_D_TIP, gEar, false)}
    <g class="al-lf-paws">
      <g><ellipse cx="-30" cy="-8" rx="10" ry="7.4" transform="rotate(-14 -30 -8)" fill="var(--mascot-paw)" style="${OUTLINE}"/><path d="M-38 -6 l-1.8 1.6 M-37 -2.6 l-2 1" ${toes}/></g>
      <g><ellipse cx="-14" cy="-6.6" rx="10" ry="7.2" transform="rotate(8 -14 -6.6)" fill="var(--mascot-paw)" style="${OUTLINE}"/><path d="M-22.4 -4.8 l-1.8 1.4 M-21.8 -1.6 l-2 .9" ${toes}/></g>
    </g>
    <g class="al-lf-head">${head}</g>`;
}

/** CSS of the lying figure (inside the puppet's shadow root). */
export function lyingCss(): string {
  const o = (cls: string, p: { x: number; y: number }) => `.${cls} { transform-box: view-box; transform-origin: ${f(p.x)}px ${f(p.y)}px; }`;
  return [
    '.al-lf { opacity: 0; }',
    o('al-lf', LF_PIVOT.lf),
    o('al-lf-body', LF_PIVOT.lfBody),
    o('al-lf-head', LF_PIVOT.lfHead),
    o('al-lf-feet', LF_PIVOT.lfFeet),
    o('al-lf-footu', LF_PIVOT.lfFootU),
    o('al-lf-earu', LF_PIVOT.lfEarU),
    o('al-lf-eard', LF_PIVOT.lfEarD),
    o('al-lf-paws', LF_PIVOT.lfPaws),
  ].join('\n');
}
