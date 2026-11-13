/**
 * Flummi v2 — the drawing (31.10, GALLERY-ONLY). Felix rejected v1 (our Pompon puppet reshaped): «Флумми мне вообще
 * не нравится … Может, в стиле Дуолинго? Типа и проработано, но в то же время не прям реалистично.»
 *
 * A NEW drawing, not the Pompon puppet: flat fills, no black outlines, every colour in 2–3 flat tones (base, a
 * hard-edged shadow shape, a highlight shape), chunky rounded forms, a big head on a compact loaf body, big eyes with
 * eyelids and small brows, mouth shapes with buck teeth, geometric fur tufts (cheeks, chest, tail), inner-ear tones,
 * paw pads. Three views drawn separately: front, 3/4 (facing right) and side profile (facing right).
 *
 * Coordinates: "bunny units" like the package puppet — the stage is a 400 × 260 viewBox and the character stands on
 * (200, 246) at scale 1.2, exactly like Pompon / Tapsi, so the same `size` gives the same scale next to them.
 * Floor = y 0, up = negative y.
 *
 * Shading trick (no gradients, no filters): a shape is clipped to itself; inside the clip it is painted in its shadow
 * tone and then again in its base tone shifted by a few units — the uncovered sliver is a crisp shadow crescent.
 */

export type ViewId = 'front' | 'q' | 'side';
export const VIEW_IDS: readonly ViewId[] = ['front', 'q', 'side'];

/** Style variants shown side by side. */
export type StyleId = 'a' | 'b' | 'c';
export const STYLE_IDS: readonly StyleId[] = ['a', 'b', 'c'];

export interface StyleSpec {
  /** thin outline in a darker shade of each fill (never black) */
  line: boolean;
  /** body scale (about the floor) */
  body: number;
  /** head scale (about the neck) */
  head: number;
}

export const STYLES: Readonly<Record<StyleId, StyleSpec>> = {
  a: { line: false, body: 1, head: 1 },
  b: { line: true, body: 1, head: 1 },
  c: { line: false, body: 0.86, head: 1.13 },
};

/** The ginger coat from Felix's photos: every colour as flat tones. */
export interface Palette {
  coat: string;
  coatSh: string;
  coatDeep: string;
  coatHi: string;
  coatLine: string;
  white: string;
  whiteSh: string;
  whiteLine: string;
  pink: string;
  pinkSh: string;
  nose: string;
  noseHi: string;
  noseLine: string;
  eye: string;
  sclera: string;
  mouth: string;
  tongue: string;
  tooth: string;
  toothSh: string;
  brow: string;
  blush: string;
}

export const GINGER: Palette = {
  coat: '#F3A65F',
  coatSh: '#E08A49',
  coatDeep: '#C97237',
  coatHi: '#FABB7C',
  coatLine: '#BA622B',
  white: '#FFF8EE',
  whiteSh: '#F0DCC5',
  whiteLine: '#D7B697',
  pink: '#FFB2A6',
  pinkSh: '#F28F86',
  nose: '#F07C8E',
  noseHi: '#FFC0C9',
  noseLine: '#C85A6B',
  eye: '#33201C',
  sclera: '#FFFFFF',
  mouth: '#7A3A2E',
  tongue: '#F5807C',
  tooth: '#FFFFFF',
  toothSh: '#E6D5C4',
  brow: '#B5602A',
  blush: '#FF8467',
};

// ---- small geometry helpers ---------------------------------------------------------------------------------------

const n = (v: number): string => String(Math.round(v * 100) / 100);

/** An ellipse as a path (two arcs, always the same winding — several of them in one `d` fill as a union). */
export function ell(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${n(cx - rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)} Z`;
}

/** A group that animates about the pivot (x, y): CSS transforms on `.cls` use transform-origin 0 0 = the pivot. */
function piv(cls: string, x: number, y: number, inner: string): string {
  return `<g transform="translate(${n(x)} ${n(y)})"><g class="${cls}"><g transform="translate(${n(-x)} ${n(-y)})">${inner}</g></g></g>`;
}

interface Ctx {
  /** unique id inside this instance */
  id: (name: string) => string;
  P: Palette;
  line: boolean;
}

/** Outline width (units; half of it shows outside the shape, the fill covers the inner half). */
const LW = 5;

/**
 * A flat shape with a hard-edged shadow crescent: clipped to itself, painted in `sh`, then in `base` shifted by `off`.
 * `extra` is painted inside the same clip (highlights, the belly, the muzzle …). Style B adds an outline in `line`.
 */
function solid(c: Ctx, name: string, d: string, base: string, sh: string, line: string, off: readonly [number, number], extra = ''): string {
  const id = c.id(name);
  const outline = c.line ? `<path d="${d}" fill="none" stroke="${line}" stroke-width="${LW}" stroke-linejoin="round"/>` : '';
  const shifted = off[0] || off[1] ? `<path d="${d}" fill="${base}" transform="translate(${n(off[0])} ${n(off[1])})"/>` : `<path d="${d}" fill="${base}"/>`;
  return `<clipPath id="${id}"><path d="${d}"/></clipPath>${outline}<g clip-path="url(#${id})"><path d="${d}" fill="${sh}"/>${shifted}${extra}</g>`;
}

// ---- face parts (shared by the views) -----------------------------------------------------------------------------

interface EyeSpec {
  side: 'l' | 'r';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** pupil offset (looking direction) */
  look: number;
}

/**
 * A big cartoon eye: white sclera, a big dark pupil with two highlights, an upper lid (blinks, half-lids) and a lower
 * lid (happy squint), both in the coat colour and clipped to the eye; `.eh` = the closed happy arc ^ (hidden by CSS).
 */
function eye(c: Ctx, e: EyeSpec): string {
  const { P } = c;
  const id = c.id(`eye-${e.side}`);
  const sclera = ell(e.cx, e.cy, e.rx, e.ry);
  const px = e.cx + e.look;
  const py = e.cy + e.ry * 0.06;
  const prx = e.rx * 0.8;
  const pry = e.ry * 0.82;
  const pupil = `<path d="${ell(px, py, prx, pry)}" fill="${P.eye}"/>`
    + `<path d="${ell(px - prx * 0.36, py - pry * 0.38, e.rx * 0.33, e.rx * 0.33)}" fill="#FFFFFF"/>`
    + `<path d="${ell(px + prx * 0.38, py + pry * 0.42, e.rx * 0.14, e.rx * 0.14)}" fill="#FFFFFF"/>`;
  const top = e.cy - e.ry - 1;
  const bot = e.cy + e.ry + 1;
  // upper lid: a coat rect over the whole eye, scaled from its top edge (sy 0 = open); a darker lash edge at its bottom
  const lid = piv(`lid lid-${e.side}`, e.cx, top,
    `<rect x="${n(e.cx - e.rx - 3)}" y="${n(top)}" width="${n(e.rx * 2 + 6)}" height="${n(bot - top)}" fill="${P.coat}"/>`
    + `<rect x="${n(e.cx - e.rx - 3)}" y="${n(bot - 3)}" width="${n(e.rx * 2 + 6)}" height="3" fill="${P.coatDeep}"/>`);
  // lower lid: a coat ellipse rising from below (convex top = a smiling cheek)
  const lidlo = piv(`lidlo lidlo-${e.side}`, e.cx, bot, `<path d="${ell(e.cx, bot, e.rx + 5, e.ry * 2)}" fill="${P.coat}"/>`);
  const open = `<g class="eo eo-${e.side}"><clipPath id="${id}"><path d="${sclera}"/></clipPath><path d="${sclera}" fill="${P.sclera}"/>`
    + `<g clip-path="url(#${id})">${piv(`pupil pupil-${e.side}`, px, py, pupil)}${lid}${lidlo}</g></g>`;
  const arc = `<path class="eh eh-${e.side}" d="M ${n(e.cx - e.rx * 0.85)} ${n(e.cy + e.ry * 0.25)} Q ${n(e.cx)} ${n(e.cy - e.ry * 0.95)} ${n(e.cx + e.rx * 0.85)} ${n(e.cy + e.ry * 0.25)}" fill="none" stroke="${P.eye}" stroke-width="4.6" stroke-linecap="round"/>`;
  return open + arc;
}

function brow(c: Ctx, side: 'l' | 'r', x: number, y: number, w = 7, tilt = 0): string {
  const d = `M ${n(x - w)} ${n(y + 1.6 + tilt)} Q ${n(x)} ${n(y - 2.2)} ${n(x + w)} ${n(y + 1.6 - tilt)}`;
  return piv(`brow brow-${side}`, x, y, `<path d="${d}" fill="none" stroke="${c.P.brow}" stroke-width="4.4" stroke-linecap="round"/>`);
}

function blush(c: Ctx, x: number, y: number, rx: number, ry: number): string {
  return `<path class="blush" d="${ell(x, y, rx, ry)}" fill="${c.P.blush}" opacity=".42"/>`;
}

/** The front / 3/4 nose: a soft rounded triangle with a highlight. */
function noseFront(c: Ctx, x: number, y: number, sx = 1): string {
  const { P } = c;
  const w = 7 * sx;
  const d = `M ${n(x - w)} ${n(y - 2.5)} C ${n(x - w)} ${n(y - 6)} ${n(x + w)} ${n(y - 6)} ${n(x + w)} ${n(y - 2.5)} C ${n(x + w)} ${n(y + 1)} ${n(x + 2.2 * sx)} ${n(y + 4)} ${n(x)} ${n(y + 4)} C ${n(x - 2.2 * sx)} ${n(y + 4)} ${n(x - w)} ${n(y + 1)} ${n(x - w)} ${n(y - 2.5)} Z`;
  const outline = c.line ? `<path d="${d}" fill="none" stroke="${P.noseLine}" stroke-width="3" stroke-linejoin="round"/>` : '';
  return piv('nose', x, y, `${outline}<path d="${d}" fill="${P.nose}"/><path d="${ell(x - 2.6 * sx, y - 3, 2.1 * sx, 1.2)}" fill="${P.noseHi}"/>`);
}

/** Two buck teeth hanging from y (front view), half-width `w` each. */
function teeth(c: Ctx, x: number, y: number, h = 4.6, w = 3.5, gap = 0.6): string {
  const t = (x0: number, x1: number) => `<path d="M ${n(x0)} ${n(y)} H ${n(x1)} V ${n(y + h - 1)} Q ${n(x1)} ${n(y + h)} ${n(x1 - 1)} ${n(y + h)} H ${n(x0 + 1)} Q ${n(x0)} ${n(y + h)} ${n(x0)} ${n(y + h - 1)} Z" fill="${c.P.tooth}"/>`;
  return t(x - gap - w, x - gap) + t(x + gap, x + gap + w);
}

/** Front / 3/4 mouths at (x, y) = the top of the mouth: rest (a small smile with buck teeth), open laugh, small "o". */
function mouthsFront(c: Ctx, x: number, y: number, sx = 1): string {
  const { P } = c;
  const m = P.mouth;
  const philtrum = `<path d="M ${n(x)} ${n(y - 5)} L ${n(x)} ${n(y - 0.6)}" stroke="${m}" stroke-width="1.9" stroke-linecap="round"/>`;
  const restD = `M ${n(x - 7 * sx)} ${n(y - 1)} Q ${n(x)} ${n(y + 1)} ${n(x + 7 * sx)} ${n(y - 1)} Q ${n(x + 6 * sx)} ${n(y + 6.6)} ${n(x)} ${n(y + 7)} Q ${n(x - 6 * sx)} ${n(y + 6.6)} ${n(x - 7 * sx)} ${n(y - 1)} Z`;
  const rest = `<g class="m-rest"><path d="${restD}" fill="${m}"/>${teeth(c, x, y - 0.4, 4.6, 3.4 * sx)}</g>`;
  const openD = `M ${n(x - 13 * sx)} ${n(y - 2)} Q ${n(x)} ${n(y + 1.5)} ${n(x + 13 * sx)} ${n(y - 2)} Q ${n(x + 12 * sx)} ${n(y + 16)} ${n(x)} ${n(y + 17)} Q ${n(x - 12 * sx)} ${n(y + 16)} ${n(x - 13 * sx)} ${n(y - 2)} Z`;
  const oid = c.id('mouth-open');
  const open = `<g class="m-open"><clipPath id="${oid}"><path d="${openD}"/></clipPath><path d="${openD}" fill="${m}"/>`
    + `<g clip-path="url(#${oid})"><path d="${ell(x, y + 15, 8.5 * sx, 6)}" fill="${P.tongue}"/></g>${teeth(c, x, y - 0.6, 5, 4.2 * sx, 0.7)}</g>`;
  const o = `<g class="m-o"><path d="${ell(x, y + 3.6, 4.6 * sx, 5.4)}" fill="${m}"/>${teeth(c, x, y - 1.5, 3, 2.4 * sx, 0.4)}</g>`;
  return philtrum + piv('mouth', x, y, rest + open + o);
}

/** A short rounded upright ear with a pink inner ear and a little white tuft at its base; root at (0, 0). */
function earArt(c: Ctx, name: string, far: boolean): string {
  const { P } = c;
  const outer = 'M -13 3 C -18.5 -14 -15 -38 0 -41.5 C 15 -38 18.5 -14 13 3 Z';
  if (far) return solid(c, name, outer, P.coatSh, P.coatDeep, P.coatLine, [-4, -1]);
  const inner = 'M -7 -3 C -9.5 -14 -7.6 -29.5 0 -32.5 C 7.6 -29.5 9.5 -14 7 -3 Z';
  const iid = c.id(`${name}-in`);
  const innerShaded = `<clipPath id="${iid}"><path d="${inner}"/></clipPath><g clip-path="url(#${iid})"><path d="${inner}" fill="${P.pinkSh}"/><path d="${inner}" fill="${P.pink}" transform="translate(-2.4 1.5)"/></g>`;
  const tuft = `<path d="M -7.5 -2 L -5 -11 L -2 -6 L 0.5 -13 L 3 -6 L 5.5 -10.5 L 7.5 -2 Z" fill="${P.white}"/>`;
  return solid(c, name, outer, P.coat, P.coatSh, P.coatLine, [-4, -1.5], innerShaded + tuft);
}

function ear(c: Ctx, side: 'l' | 'r', x: number, y: number, rot: number, scale = 1, far = false): string {
  return piv(`ear ear-${side}`, x, y, `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)}) scale(${n(scale)})">${earArt(c, `ear-${side}`, far)}</g>`);
}

/** Proportion wrappers (style C): the body scales about the floor at x = cx, the head about its neck. */
function bodyProp(s: StyleSpec, cx: number, inner: string): string {
  if (s.body === 1) return inner;
  return `<g transform="translate(${n(cx)} 0) scale(${n(s.body)}) translate(${n(-cx)} 0)">${inner}</g>`;
}
function headProp(s: StyleSpec, cx: number, neck: readonly [number, number], inner: string): string {
  if (s.body === 1 && s.head === 1) return inner;
  const nx = cx + (neck[0] - cx) * s.body;
  const ny = neck[1] * s.body;
  return `<g transform="translate(${n(nx)} ${n(ny)}) scale(${n(s.head)}) translate(${n(-neck[0])} ${n(-neck[1])})">${inner}</g>`;
}

// ---- FRONT ----------------------------------------------------------------------------------------------------------

const F = {
  body: 'M -48 0 C -66 0 -70 -18 -66 -38 C -61 -64 -38 -86 0 -86 C 38 -86 61 -64 66 -38 C 70 -18 66 0 48 0 Z',
  belly: 'M -40 4 C -50 -16 -48 -38 -32 -47 C -26 -50 -19 -52 -13 -50 Q -6.5 -60 0 -50.5 Q 6.5 -60 13 -50 C 19 -52 26 -50 32 -47 C 48 -38 50 -16 40 4 Z',
  bodyHi: 'M -58 -42 C -56 -56 -46 -68 -33 -75 C -42 -65 -49 -55 -53 -41 Z',
  head:
    'M 0 -160 C 35 -160 61 -139 63 -110 C 64 -99 63 -91 60 -85 L 69 -77 L 56 -71 C 44 -61 24 -56 0 -56'
    + ' C -24 -56 -44 -61 -56 -71 L -69 -77 L -60 -85 C -63 -91 -64 -99 -63 -110 C -61 -139 -35 -160 0 -160 Z',
  headHi: 'M -46 -128 C -42 -145 -26 -155 -8 -155 C -24 -150 -37 -141 -42 -127 Z',
  neck: [0, -62] as const,
};

function muzzle(c: Ctx, pads: ReadonlyArray<readonly [number, number, number, number]>): string {
  const d = pads.map(([x, y, rx, ry]) => ell(x, y, rx, ry)).join(' ');
  return solid(c, 'muzzle', d, c.P.white, c.P.whiteSh, c.P.whiteLine, [0, -3.6]);
}

function front(c: Ctx, s: StyleSpec): string {
  const { P } = c;
  const belly = solid(c, 'belly-f', F.belly, P.white, P.whiteSh, P.whiteLine, [-4, 5]);
  const bodyExtra = `<path d="${F.bodyHi}" fill="${P.coatHi}"/>${belly}`;
  const body = piv('body', 0, 0, solid(c, 'body-f', F.body, P.coat, P.coatSh, P.coatLine, [-6, -4], bodyExtra));
  const foot = (side: 'l' | 'r', x: number) => {
    const toes = [-6, 5].map((dx) => `<path d="M ${n(x + dx)} -3.2 L ${n(x + dx)} -8" stroke="${P.coatSh}" stroke-width="2.4" stroke-linecap="round"/>`).join('');
    return piv(`foot foot-${side}`, x, -4, solid(c, `foot-${side}`, ell(x, -8, 21, 11), P.coat, P.coatSh, P.coatLine, [-3, -4], `<path d="${ell(x - 8, -13, 7, 3)}" fill="${P.coatHi}"/>`) + toes);
  };
  const paw = (side: 'l' | 'r', x: number) => piv(`paw paw-${side}`, x, -28, solid(c, `paw-${side}`, ell(x, -20, 10, 12.5), P.coat, P.coatSh, P.coatLine, [-2.5, -3]));
  const head = solid(c, 'head-f', F.head, P.coat, P.coatSh, P.coatLine, [-5, -7], `<path d="${F.headHi}" fill="${P.coatHi}"/>`);
  const face = blush(c, -43, -90, 8.5, 5) + blush(c, 43, -90, 8.5, 5)
    + muzzle(c, [[-13, -80, 16, 12.5], [13, -80, 16, 12.5], [0, -68, 10.5, 8]])
    + mouthsFront(c, 0, -82) + noseFront(c, 0, -91)
    + eye(c, { side: 'l', cx: -24, cy: -111, rx: 13.5, ry: 16.5, look: 1.2 })
    + eye(c, { side: 'r', cx: 24, cy: -111, rx: 13.5, ry: 16.5, look: -1.2 })
    + brow(c, 'l', -24, -137) + brow(c, 'r', 24, -137);
  const headG = piv('head', F.neck[0], F.neck[1], ear(c, 'l', -19, -148, -14) + ear(c, 'r', 19, -148, 14) + head + face);
  return bodyProp(s, 0, body + foot('l', -30) + foot('r', 30) + paw('l', -16) + paw('r', 16)) + headProp(s, 0, F.neck, headG);
}

// ---- 3/4 (facing right) -------------------------------------------------------------------------------------------

const Q = {
  body: 'M -60 0 C -80 0 -86 -20 -82 -40 C -76 -66 -46 -86 -6 -86 C 32 -86 58 -66 63 -40 C 66 -18 60 0 44 0 Z',
  bodyHi: 'M -72 -42 C -68 -60 -52 -74 -36 -79 C -48 -68 -58 -56 -64 -40 Z',
  neck: [6, -62] as const,
};

function tailArt(c: Ctx, name: string, x: number, y: number, s = 1): string {
  const { P } = c;
  // a white puff with three geometric tufts, drawn about (0, 0)
  const d = 'M 10 8 C 4 13 -6 13 -10 9 L -15 9 L -13 3 L -17 -2 L -11 -5 L -12 -12 L -5 -11 L -1 -16 L 3 -11 C 12 -12 16 0 10 8 Z';
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})">${solid(c, name, d, P.white, P.whiteSh, P.whiteLine, [-2.5, -3])}</g>`;
}

function threeQuarter(c: Ctx, s: StyleSpec): string {
  const { P } = c;
  const belly = `<g transform="translate(14 0) scale(.92 1)">${solid(c, 'belly-q', F.belly, P.white, P.whiteSh, P.whiteLine, [-4, 5])}</g>`;
  const bodyExtra = `<path d="${Q.bodyHi}" fill="${P.coatHi}"/>${belly}`;
  const tail = piv('tail', -80, -32, tailArt(c, 'tail-q', -88, -30, 0.95));
  const body = piv('body', 0, 0, solid(c, 'body-q', Q.body, P.coat, P.coatSh, P.coatLine, [-6, -4], bodyExtra));
  const farFoot = piv('foot foot-r', 34, -4, solid(c, 'foot-r', ell(36, -7, 18, 9.5), P.coatSh, P.coatDeep, P.coatLine, [-3, -3]));
  const nearFoot = piv('foot foot-l', -22, -4, solid(c, 'foot-l', ell(-20, -8, 25, 11), P.coat, P.coatSh, P.coatLine, [-3, -4], `<path d="${ell(-30, -13, 8, 3)}" fill="${P.coatHi}"/>`)
    + [-8, 2].map((dx) => `<path d="M ${n(dx)} -3.4 L ${n(dx)} -8.2" stroke="${P.coatSh}" stroke-width="2.4" stroke-linecap="round"/>`).join(''));
  const farPaw = piv('paw paw-r', 31, -28, solid(c, 'paw-r', ell(31, -19, 9, 11.5), P.coatSh, P.coatDeep, P.coatLine, [-2.5, -3]));
  const nearPaw = piv('paw paw-l', 7, -28, solid(c, 'paw-l', ell(7, -20, 10, 12.5), P.coat, P.coatSh, P.coatLine, [-2.5, -3]));
  const headD = F.head;
  const head = `<g transform="translate(5 0)">${solid(c, 'head-q', headD, P.coat, P.coatSh, P.coatLine, [-5, -7], `<path d="${F.headHi}" fill="${P.coatHi}"/>`)}</g>`;
  const fx = 26;
  const face = blush(c, -20, -90, 8, 5) + blush(c, 56, -91, 5.5, 4.5)
    + muzzle(c, [[fx - 12, -80, 15.5, 12.5], [fx + 11, -80, 12.5, 12], [fx, -68, 10, 8]])
    + mouthsFront(c, fx, -82, 0.92) + noseFront(c, fx + 1, -91, 0.92)
    + eye(c, { side: 'l', cx: 2, cy: -111, rx: 13.5, ry: 16.5, look: 2.6 })
    + eye(c, { side: 'r', cx: 45, cy: -111, rx: 10.5, ry: 15.8, look: 2 })
    + brow(c, 'l', 2, -137) + brow(c, 'r', 45, -137, 5.6);
  const headG = piv('head', Q.neck[0], Q.neck[1], ear(c, 'r', 25, -151, 10, 0.92) + ear(c, 'l', -14, -149, -17) + head + face);
  return bodyProp(s, 0, tail + body + farFoot + nearFoot + farPaw + nearPaw) + headProp(s, 0, Q.neck, headG);
}

// ---- SIDE profile (facing right) ----------------------------------------------------------------------------------

const S = {
  body: 'M -60 0 C -78 0 -84 -26 -76 -50 C -68 -74 -46 -86 -16 -86 C 16 -86 40 -70 46 -46 C 50 -28 44 -10 34 -4 C 30 -1 26 0 20 0 Z',
  bodyHi: 'M -66 -50 C -60 -68 -44 -80 -22 -83 C -38 -76 -52 -66 -58 -48 Z',
  /** chest + underside (white) */
  chest: 'M 20 -74 C 30 -66 35 -58 35 -50 L 28 -45 L 35 -40 C 34 -24 26 -10 12 -2 C 6 2 0 4 -8 4 L 64 4 L 64 -74 Z',
  haunch: [-38, -31, 28, 26] as const,
  foot: 'M -60 0 C -67 0 -68 -11 -60 -13 L -8 -13 C 1 -13 5 -8 5 -4.5 C 5 -1 1 0 -3 0 Z',
  head:
    'M 30 -154 C 58 -154 80 -136 84 -112 C 94 -106 96 -90 90 -80 C 84 -66 68 -57 50 -57 C 38 -57 27 -59 18 -60 L 1 -58 L 3 -67 C -2 -70 -1 -73 -1 -75'
    + ' C -16 -88 -18 -120 -2 -140 C 6 -149 18 -154 30 -154 Z',
  headHi: 'M -7 -114 C -5 -133 9 -147 27 -150 C 13 -143 3 -131 -1 -112 Z',
  neck: [26, -64] as const,
  hip: [-38, -40] as const,
  heel: [-52, -6] as const,
};

function hindLeg(c: Ctx, name: string, dx: number, far: boolean): string {
  const { P } = c;
  const base = far ? P.coatSh : P.coat;
  const sh = far ? P.coatDeep : P.coatSh;
  // the sole: a light strip with pink pads under the toes and the heel (shows when the foot kicks up)
  const sole = `<g class="sole"><path d="M -64 0 L 3 0 L 3 -3.2 L -64 -3.2 Z" fill="${far ? P.whiteSh : P.white}"/>`
    + `<path d="${ell(-4, -2.4, 7.5, 3.8)}" fill="${P.pink}"/><path d="${ell(-50, -1.8, 5.5, 2.6)}" fill="${P.pink}"/></g>`;
  const foot = piv(`foot ${name}-foot`, S.heel[0] + dx, S.heel[1], `<g transform="translate(${n(dx)} 0)">${solid(c, `${name}-foot`, S.foot, base, sh, P.coatLine, [0, -3], sole)}</g>`);
  const [hx, hy, hrx, hry] = S.haunch;
  const haunch = solid(c, `${name}-haunch`, ell(hx + dx, hy, hrx, hry), base, sh, P.coatLine, [-4, -4.5], '');
  return piv(`leg ${name}`, S.hip[0] + dx, S.hip[1], foot + haunch);
}

function side(c: Ctx, s: StyleSpec): string {
  const { P } = c;
  const chest = solid(c, 'chest-s', S.chest, P.white, P.whiteSh, P.whiteLine, [-4, -3]);
  const bodyExtra = `<path d="${S.bodyHi}" fill="${P.coatHi}"/>${chest}`;
  const tail = piv('tail', -74, -40, tailArt(c, 'tail-s', -80, -46));
  const farLeg = hindLeg(c, 'leg-far', 8, true);
  const farPaw = piv('paw paw-r', 40, -26, solid(c, 'paw-r', ell(42, -11, 8, 11.5), P.coatSh, P.coatDeep, P.coatLine, [-2.5, -3]));
  const body = piv('body', -14, 0, solid(c, 'body-s', S.body, P.coat, P.coatSh, P.coatLine, [-6, -4], bodyExtra));
  // chest fur: two little white tufts on the front edge
  const chestTufts = `<path d="M 43 -52 Q 49 -52 51 -48 Q 47 -47 46 -45 Q 51 -43 50 -39 Q 46 -38 43 -38 Z" fill="${P.white}"/>`;
  const nearLeg = hindLeg(c, 'leg-near', 0, false);
  const nearPaw = piv('paw paw-l', 31, -26, solid(c, 'paw-l', ell(32, -11, 8.5, 11.5), P.coat, P.coatSh, P.coatLine, [-2.5, -3]));
  const head = solid(c, 'head-s', S.head, P.coat, P.coatSh, P.coatLine, [-5, -6],
    `<path d="${S.headHi}" fill="${P.coatHi}"/>${solid(c, 'muzzle-s', `${ell(76, -84, 17, 14)} ${ell(63, -69, 13, 8.5)}`, P.white, P.whiteSh, P.whiteLine, [0, -3.5])}`);
  const noseD = 'M 86.5 -100 C 89.5 -102.6 95.5 -101.2 95.5 -97 C 95.5 -93.8 92 -92.4 89.5 -93.4 C 87.4 -94.4 85.4 -98.4 86.5 -100 Z';
  const nose = piv('nose', 91, -97, `${c.line ? `<path d="${noseD}" fill="none" stroke="${P.noseLine}" stroke-width="3" stroke-linejoin="round"/>` : ''}<path d="${noseD}" fill="${P.nose}"/><path d="${ell(90, -99, 1.9, 1.1)}" fill="${P.noseHi}"/>`);
  const m = P.mouth;
  const tooth = (x: number, y: number, h: number, w = 3.6) => `<path d="M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h - 1)} Q ${n(x + w)} ${n(y + h)} ${n(x + w - 1)} ${n(y + h)} H ${n(x + 1)} Q ${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - 1)} Z" fill="${P.tooth}"/>`;
  const restD = 'M 79.5 -87.6 Q 85.5 -86 90.6 -88.2 Q 89.6 -81 85 -80.4 Q 80.6 -81 79.5 -87.6 Z';
  const openD = 'M 75 -89.5 Q 84 -86 92.5 -90 Q 92.5 -75.5 84 -74 Q 76.5 -75 75 -89.5 Z';
  const oid = c.id('mouth-open-s');
  const mouths = `<path d="M 90 -93 Q 89.8 -90 88.4 -87.6" fill="none" stroke="${m}" stroke-width="1.9" stroke-linecap="round"/>`
    + piv('mouth', 85, -87, `<g class="m-rest"><path d="${restD}" fill="${m}"/>${tooth(84.6, -87.2, 4.4)}</g>`
      + `<g class="m-open"><clipPath id="${oid}"><path d="${openD}"/></clipPath><path d="${openD}" fill="${m}"/><g clip-path="url(#${oid})"><path d="${ell(84, -76, 7, 4)}" fill="${P.tongue}"/></g>${tooth(85, -88.6, 5, 4)}</g>`
      + `<g class="m-o"><path d="${ell(87, -83.6, 3.6, 4.6)}" fill="${m}"/>${tooth(85.6, -88.4, 2.6, 2.8)}</g>`);
  const face = blush(c, 60, -90, 8, 5) + mouths + nose
    + eye(c, { side: 'l', cx: 52, cy: -111, rx: 11.5, ry: 16, look: 2.6 })
    + brow(c, 'l', 53, -137, 6.4);
  const headG = piv('head', S.neck[0], S.neck[1], ear(c, 'r', 35, -146, -6, 0.9, true) + ear(c, 'l', 19, -145, -20, 0.95) + head + face);
  return bodyProp(s, -14, farLeg + tail + farPaw + body + chestTufts + nearLeg + nearPaw) + headProp(s, -14, S.neck, headG);
}

// ---- the whole stage ----------------------------------------------------------------------------------------------

/** Floor shadows per view (they live outside the hop, so they stay on the floor). */
const SHADOWS: Readonly<Record<ViewId, string>> = {
  front: ell(0, 1, 64, 7),
  q: ell(-4, 1, 70, 7),
  side: ell(-12, 1, 74, 7),
};

/** Pivot of the whole-body tilt (the binky's mid-air roll): the middle of the body. */
export const TILT_PIVOT = [-10, -48] as const;

export interface ArtOptions {
  style: StyleId;
  /** the views drawn into this stage (each is a `.vw-<id>` group; only `shown` is visible) */
  views: readonly ViewId[];
  shown: ViewId;
  palette?: Palette;
}

/**
 * The SVG inner markup: `.move` (x, flip) > the floor shadows + `.hop` (y) > `.squash` (about the floor) > `.tilt`
 * (about the body middle) > one `.vw-<view>` group per view.
 */
export function flummiMarkup(id: (name: string) => string, o: ArtOptions): string {
  const s = STYLES[o.style];
  const P = o.palette ?? GINGER;
  const views = o.views.map((v) => {
    const c: Ctx = { id: (nm) => id(`${v}-${nm}`), P, line: s.line };
    const art = v === 'front' ? front(c, s) : v === 'q' ? threeQuarter(c, s) : side(c, s);
    return `<g class="vw vw-${v}" style="opacity:${v === o.shown ? 1 : 0}">${art}</g>`;
  }).join('');
  const shadows = o.views.map((v) => `<path class="shv shv-${v}" d="${SHADOWS[v]}" style="opacity:${v === o.shown ? 1 : 0}"/>`).join('');
  const [tx, ty] = TILT_PIVOT;
  return `<g transform="translate(200 246) scale(1.2)"><g class="move">${piv('sh', -6, 1, shadows)}<g class="hop"><g class="squash">`
    + `<g transform="translate(${tx} ${ty})"><g class="tilt"><g transform="translate(${-tx} ${-ty})">${views}</g></g></g>`
    + '</g></g></g></g>';
}

/** CSS inside the stage's shadow root: pivots at 0 0 (the wrappers carry the pivot), hidden defaults. */
export const FLUMMI_CSS = `
:host { display: inline-block; line-height: 0; -webkit-tap-highlight-color: transparent; }
svg { display: block; width: 100%; height: auto; overflow: visible; }
g { transform-box: view-box; transform-origin: 0 0; }
.shv { fill: var(--mascot-shadow, rgba(70,40,15,.16)); }
.lid, .lidlo { transform: scale(1, 0); }
.m-open, .m-o, .eh, .sole { opacity: 0; }
`;
