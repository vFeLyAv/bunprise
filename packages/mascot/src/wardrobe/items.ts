/**
 * Wardrobe v2 (26.10, gallery; Felix: «больше креатива и масштаба»). A year of outfits for both mascots, each with
 * its own put-on moment (demo/wardrobe/update.ts). The drawings and the one helper that puts an item on ANY puppet
 * built from bunnyMarkup / hamsterMarkup: the mascot itself, a welcome-stage actor, the carrying bunny, the Lists
 * buddy. It works on the puppet's shadow root from outside: a puppet nobody dresses is exactly as before.
 * 31.10: moved here from demo/wardrobe/items.ts (which re-exports it) — the Sammlung outfits (./outfits.ts) reuse the
 * scarf and the party hat, and the app wears them (opt-in, `@bunprise/mascot/wardrobe`). The other items are still
 * gallery-only drawings (nothing in the app puts them on).
 * v1 (felt bat, Advent ribbon, the one generic drop) is archived in E:\BALLR\_codex_handoffs\archive-20261026\wardrobe-v1.
 *
 * Units: the puppet's own coordinates (x = 0 centre line, y = 0 feet; head top y = -163 for both mascots).
 *
 * Where an item sits in the puppet (inside `.breathe`, so it rides every hop, squash and breath, right before
 * `.tp` = drawn over the face, ears, cheeks and belly and UNDER the front paws):
 *
 *   .wr.wr-slot-<slot>         opacity of the moment's fade-in
 *     .wr-fall                 the moment's main motion (identity once worn)
 *       <g clip-path=body>     the scarf band, clipped to the body silhouette
 *         .wr-band             slides 9 units in the 3/4 turn, like the paws (.tp); the ring's stripes too
 *       .wr-front              what sits on the face: the same quarter turn as the face (.tf)
 *       .wr-head               head items: shift 11, squash .9 in the turn (between the ears' 7–16)
 *         .wr-m-*              parts only a moment moves (never a turn target: the turn would be overridden)
 *         .wr-wob              dangling parts (bobbles, the floppy tips): follow-through after HIS moves only
 *         .wr-fx               moment-only extras (party horn, confetti, petals): invisible at rest
 *
 * Rules (§0, §3.4): 1–2 flat colours from --mascot-wear-1 / --mascot-wear-2 (the theme may change them) plus
 * shades of them, the silhouette's own contour (--mascot-outline), nothing thinner than 7 units (2 px at 96 px).
 * An item never moves by itself; dangling parts only swing AFTER his own motion (a hop, a turn, walking).
 */

export type WearId = 'scarf' | 'beanie' | 'nikolaus' | 'wreath' | 'ring' | 'witch' | 'party';
export type WearKind = 'bunny' | 'hamster';
export type WearSlot = 'neck' | 'head' | 'waist';
export type WearTheme = 'light' | 'dark' | 'navy';

/** A day of the year as [day, month]. */
export type DayMonth = readonly [number, number];
export interface YearSpan {
  from: DayMonth;
  to: DayMonth;
}

export interface WearSpec {
  id: WearId;
  kind: WearKind;
  slot: WearSlot;
  /** Russian name for the gallery */
  label: string;
  /** German name (what the item is called in Germany) */
  de: string;
  /** when it is worn, as Felix reads it */
  season: string;
  /** the same as spans on the year strip (empty = not by date: an occasion item) */
  spans: readonly YearSpan[];
  /** an occasion item: shown on that occasion's page instead of the date */
  occasion?: string;
  /** --mascot-wear-1 / --mascot-wear-2 per theme */
  colors: Record<WearTheme, readonly [string, string]>;
  /** pivot of the moment's main motion (.wr-fall): where it lands (puppet units) */
  land: { x: number; y: number };
  /** the drawing; `clip` = this puppet's body clip, url(#…-clip-body) */
  markup: (clip: string) => string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Fill of colour 1 / 2, with the light value as the fallback (an app without the tokens still draws it). */
const W1 = (fallback: string) => `var(--mascot-wear-1, ${fallback})`;
const W2 = (fallback: string) => `var(--mascot-wear-2, ${fallback})`;
/** A deeper shade of a colour (the same hue: knit folds, the brim) — no third colour. */
const shade = (fill: string, k = 78) => `color-mix(in srgb, ${fill} ${k}%, #3A1F0A)`;
const o = 'class="wr-o"';
const f2 = (v: number) => String(Math.round(v * 100) / 100);
/** transform-origin of a moving part, in the puppet's units (with transform-box: view-box, see WEAR_CSS). */
const at = (x: number, y: number) => `style="transform-origin: ${f2(x)}px ${f2(y)}px"`;

/**
 * Moves a drawing made upright in its own frame onto the puppet: rotate by `deg` about the frame's origin, then
 * translate by (x, y). Paths here use only absolute M / L / C / Q / Z, so every number pair is a point.
 */
export function place(d: string, x: number, y: number, deg: number, k = 1): string {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r) * k;
  const s = Math.sin(r) * k;
  const nums = d.match(/-?\d*\.?\d+/g) ?? [];
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, () => {
    const k = i++;
    const px = Number(nums[k - (k % 2)]);
    const py = Number(nums[k - (k % 2) + 1]);
    return k % 2 === 0 ? f2(x + px * c - py * s) : f2(y + px * s + py * c);
  });
}
/** One point of a frame, placed like `place`. */
export function placePt(px: number, py: number, x: number, y: number, deg: number, k = 1): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [x + k * (px * Math.cos(r) - py * Math.sin(r)), y + k * (px * Math.sin(r) + py * Math.cos(r))];
}

/** An elliptical arc as cubic Béziers (no SVG `A`: every number pair stays a point). Angles in degrees, y down. */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): string {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
  const step = ((a1 - a0) / n) * (Math.PI / 180);
  const k = (4 / 3) * Math.tan(step / 4);
  let out = '';
  let a = (a0 * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const b = a + step;
    const p0 = [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    const p1 = [cx + rx * Math.cos(b), cy + ry * Math.sin(b)];
    const c1 = [p0[0]! - k * rx * Math.sin(a), p0[1]! + k * ry * Math.cos(a)];
    const c2 = [p1[0]! + k * rx * Math.sin(b), p1[1]! - k * ry * Math.cos(b)];
    out += ` C${f2(c1[0]!)} ${f2(c1[1]!)} ${f2(c2[0]!)} ${f2(c2[1]!)} ${f2(p1[0]!)} ${f2(p1[1]!)}`;
    a = b;
  }
  return out;
}
/** A full ellipse / circle as a path (outline + test geometry stay one kind of shape). */
function ellipse(cx: number, cy: number, rx: number, ry = rx): string {
  return `M${f2(cx + rx)} ${f2(cy)}${arc(cx, cy, rx, ry, 0, 360)} Z`;
}

// ---- Pompon: the winter scarf (v1 drawing, approved in spirit — unchanged) ----------------------------------
// The bun has no neck: the band lies right under the mouth (bottom of the mouth y = -75.6), over the cheeks'
// lower ends, and the front paws (top y ≈ -55) are drawn over it. It spans x ±96 so it still fills the clip
// after the 9-unit shift of the turn — and so the moment can slide it round his neck (.wr-m-wrap).

/** The scarf band: top edge y = -68 in the middle, -74 at the outline; 19 units thick (5.5 px at 96 px). */
export const SCARF_BAND = 'M-96 -80 Q0 -56 96 -80 L96 -61 Q0 -37 -96 -61 Z';
const SCARF_BAND_LOW = 'M-96 -70 Q0 -46 96 -70 L96 -61 Q0 -37 -96 -61 Z';
/** The end hanging from the knot on his right-hand side (viewer's right), beside the right paw. */
export const SCARF_TAIL = 'M24.5 -60 C31 -61.5 39 -62 45 -59.5 C46.2 -49 46.6 -38.5 46.2 -29.5 Q45.6 -24.2 41 -25.6 Q37 -21.6 33 -25.6 Q28.6 -21.8 26.6 -27 C25.4 -37.5 24.6 -48.6 24.5 -60 Z';
const SCARF_STRIPE = 'M25.6 -42.5 C32.4 -43.6 39.6 -43.8 46.4 -42.2 L46.5 -34.4 C39.6 -35.9 32.6 -35.8 26.1 -34.6 Z';
export const SCARF_KNOT = 'M21.5 -63 C22.5 -70 30 -73 37 -72 C44 -71 47.5 -65.5 46 -60 C44.6 -54 37.8 -51.2 31.2 -52 C24.6 -52.8 20.6 -57.2 21.5 -63 Z';
const SCARF_KNOT_LOW = 'M21.5 -60.5 C27 -56.5 38.6 -56 46.1 -60.8 C44.6 -54 37.8 -51.2 31.2 -52 C25 -52.8 21.4 -56.6 21.5 -60.5 Z';
/** where the knot sits (its swing pivot in the moment) */
export const SCARF_KNOT_AT = { x: 34, y: -62 } as const;

// ---- Pompon: the witch hat (Halloween) ----------------------------------------------------------------------
// A clear pointy silhouette: a big floppy hat, its brim a little wider than his head (so when it slides down over
// his eyes it reads as «too big», not as a hat stuck on his face), a cone, a pumpkin band, and a tip bent to his
// left (viewer's right) that flops on its own pivot (.wr-m-tip) when he pushes the hat up. Drawn 1:1 about the
// brim's centre (0, -158), placed 1.3× larger.

const WITCH_K = 1.3;
/** a 1:1 drawing about (0, -158) → its place, 1.3× */
const wp = (d: string) => place(d.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_m, a: string, b: string) => `${a} ${Math.round((Number(b) + 158) * 100) / 100}`), 0, -158, 0, WITCH_K);
export const WITCH_BRIM = wp(ellipse(0, -158.5, 50, 9.5));
export const WITCH_CONE = wp('M-22 -160.5 C-18 -180 -9 -199 -3.5 -214 L9.5 -212 C11.5 -196 17.5 -178 22 -160.5 Q0 -154.5 -22 -160.5 Z');
/** the band at the cone's foot (the second colour) */
const WITCH_BAND = wp('M-20.8 -169.5 Q0 -163.5 20.8 -169.5 L22 -160.5 Q0 -154.5 -22 -160.5 Z');
/** the bent tip; pivot at the bend */
export const WITCH_TIP = wp('M-3.5 -214 C1 -225 15 -229 26 -222 C31 -218.5 34 -212 33.5 -204.5 C29 -208.5 21 -213 9.5 -212 Z');
const WITCH_TIP_PT = placePt(3, -213 + 158, 0, -158, 0, WITCH_K);
export const WITCH_TIP_AT = { x: WITCH_TIP_PT[0], y: WITCH_TIP_PT[1] } as const;
/** a soft shade on the cone's right side (felt, not a stripe; ≥ 7 units) */
const WITCH_SHADE = wp('M5 -205 C9 -190 13 -176 15 -163 L22 -160.5 C17.5 -178 11.5 -196 9.5 -212 Z');

// ---- Pompon: the Nikolaus hat (6.12 – 26.12) — the onboarding's approved Santa hat, rebuilt with a floppy tip -----

/** the white fur rim across the ear roots (17 units) */
export const NIKO_RIM = 'M-45 -171.5 Q0 -178 45 -171.5 Q50 -170.8 50 -166 L50 -159.5 Q50 -154.6 45 -155 Q0 -149 -45 -155 Q-50 -154.6 -50 -159.5 L-50 -166 Q-50 -170.8 -45 -171.5 Z';
export const NIKO_CONE = 'M-40 -172 C-36 -199 -14 -225 15 -228 C25 -229 32 -224.5 33 -216 C34.5 -201 38.5 -186 42 -172 Z';
/** the floppy end falling to his left (viewer's right), drawn behind the cone; pivot near the top */
export const NIKO_SOCK = 'M12 -228.5 C29 -235.5 49 -228 58 -210 C61 -204 62.6 -197 62.4 -191 L51.6 -192.6 C50 -203 43.6 -213.5 30 -216.5 Z';
export const NIKO_SOCK_AT = { x: 22, y: -224 } as const;
export const NIKO_BOB = { cx: 57.5, cy: -186.5, r: 11 } as const;
const NIKO_SHADE = 'M-40 -172 C-36 -199 -14 -225 15 -228 C-4 -216 -18 -196 -22 -172 Z';

// ---- Pompon: the party hat (birthdays) — the logo's / onboarding's approved cone, tilted 10° -------------------

const PARTY_TILT = { x: 0, y: -160, r: 10 } as const;
const pt = (d: string) => place(d.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_m, a: string, b: string) => `${a} ${Number(b) + 160}`), PARTY_TILT.x, PARTY_TILT.y, PARTY_TILT.r);
export const PARTY_CONE = pt('M-27 -162 L0 -236 L27 -162 Z');
const PARTY_STRIPES = pt('M-20.4 -180 L-15.9 -192.4 L18.6 -180.9 L22.5 -170.5 Z M-11.2 -205 L-7.5 -215.2 L9.7 -207.9 L13.4 -197.7 Z');
const PARTY_RIM = pt(ellipse(0, -162, 28, 5).replace(/^M/, 'M'));
const PARTY_POM_C = placePt(0, -78, PARTY_TILT.x, PARTY_TILT.y, PARTY_TILT.r);
export const PARTY_POM = { cx: PARTY_POM_C[0], cy: PARTY_POM_C[1], r: 9 } as const;
/** The party blower (moment only): a paper tube from his mouth to his left, unrolling (scaleX about the mouth). */
export const HORN_AT = { x: 2.5, y: -77 } as const;
const HORN = 'M2.5 -81.5 L50 -77.5 C57.5 -77 59 -67.6 51.4 -67 L2.5 -72.5 Z';
const HORN_BANDS = 'M14 -80.5 L21.5 -79.9 L21.5 -70.4 L14 -71.2 Z M30 -79.2 L37.5 -78.6 L37.5 -68.8 L30 -69.6 Z';
const HORN_MOUTH = 'M-1 -82.4 L7 -81.8 L7 -71.8 L-1 -72.4 Z';
/** two confetti bits (moment only), at the horn's end */
export const CONF_A = { x: 54, y: -76 } as const;
export const CONF_B = { x: 55, y: -68 } as const;

// ---- Pompon: the spring flower wreath ---------------------------------------------------------------------------
// A ring of flowers on a green vine over his head, from ear root to ear root (lop ears hang from under it): three
// big ones (they still read as flowers at 64 px) and two buds between. Two loose petals (.wr-fx) only appear
// when he sneezes in the moment.

export const WREATH_VINE = `M-47 -151.5 C-41 -163.5 -24 -173.5 0 -174 C24 -173.5 41 -163.5 47 -151.5 L41.5 -148 C36 -157.5 21 -166.5 0 -167 C-21 -166.5 -36 -157.5 -41.5 -148 Z`;
export const WREATH_FLOWERS: readonly { x: number; y: number; r: number }[] = [
  { x: -36, y: -158, r: 11 },
  { x: -17.5, y: -169.5, r: 7.6 },
  { x: 0, y: -174, r: 13.5 },
  { x: 17.5, y: -169.5, r: 7.6 },
  { x: 36, y: -158, r: 11 },
];
const WREATH_LEAVES: readonly { x: number; y: number; a: number }[] = [
  { x: -25, y: -169, a: -125 },
  { x: -9, y: -182, a: -112 },
  { x: 9, y: -182, a: -68 },
  { x: 25, y: -169, a: -55 },
  { x: -47, y: -150, a: -160 },
  { x: 47, y: -150, a: -20 },
];
/** five round petals around a centre (the flower's own outline), radius ≈ r */
function flower(x: number, y: number, r: number): string {
  const pr = r * 0.46;
  const d = r - pr;
  let out = '';
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    out += ellipse(x + d * Math.cos(a), y + d * Math.sin(a), pr) + ' ';
  }
  return out.trim();
}
function leaf(x: number, y: number, a: number): string {
  return place('M0 0 C3 -4.4 9 -4.6 13 0 C9 4.6 3 4.4 0 0 Z', x, y, a, 1.25);
}
export const PETAL_A = { x: -41, y: -165 } as const;
export const PETAL_B = { x: 42, y: -164 } as const;

// ---- Tapsi: the swim ring (summer) ------------------------------------------------------------------------------
// A red-and-cream swim ring round his waist; the front paws rest on it. Seen a little from above: the outer
// ellipse and the hole, minus the back part that is behind his body. In the turn the stripes slide inside it.

export const RING_OUT = { cx: 0, cy: -38, rx: 100, ry: 26 } as const;
export const RING_IN = { cx: 0, cy: -40, rx: 76, ry: 8 } as const;
/** angle (deg, y down) on the outer ellipse where it goes behind his body (x = ±70) */
const RING_BACK = (Math.acos(70 / RING_OUT.rx) * 180) / Math.PI;
export const RING = `M${-RING_IN.rx} ${RING_IN.cy} L${f2(RING_OUT.cx - 70)} ${f2(RING_OUT.cy - RING_OUT.ry * Math.sin((RING_BACK * Math.PI) / 180))}`
  + arc(RING_OUT.cx, RING_OUT.cy, RING_OUT.rx, RING_OUT.ry, 180 + RING_BACK, -RING_BACK)
  + ` L${RING_IN.rx} ${RING_IN.cy}` + arc(RING_IN.cx, RING_IN.cy, RING_IN.rx, RING_IN.ry, 0, 180) + ' Z';
/** red stripes (they slide ±9 in the turn, clipped to the ring): both sides and the middle of the front */
const RING_STRIPES = 'M-120 -72 L-64 -72 L-60 -2 L-120 -2 Z M-21 -72 L21 -72 L19.5 -2 L-19.5 -2 Z M64 -72 L120 -72 L120 -2 L60 -2 Z';
const RING_SHINE = 'M-46 -29.6 C-24 -25.6 24 -25.6 46 -29.6 L45 -26 C24 -21.8 -24 -21.8 -45 -26 Z';

// ---- Tapsi: the bobble beanie v2 ----------------------------------------------------------------------------
// Cosier and more alive (Felix: «ок, но не идеально»): a thick ribbed brim pulled down on the side of his
// UPRIGHT ear (his left, viewer's left, hamster.ts .te-l), the ear coming out between the brim and the dome —
// through the hat; the bobble sits on a little knitted spring (.wr-wob) that swings after his hops, turns and
// steps. The folded ear (his signature, hamster.ts:79-86) stays completely free, ≥ 12 units, also in both turns.
// Drawn upright in its own frame (origin = middle of the brim's lower edge) and placed by BEANIE_PLACE.

export const BEANIE_PLACE = { x: -15, y: -139.5, r: -14 } as const;
const bp = (d: string) => place(d, BEANIE_PLACE.x, BEANIE_PLACE.y, BEANIE_PLACE.r);
const bpt = (x: number, y: number) => placePt(x, y, BEANIE_PLACE.x, BEANIE_PLACE.y, BEANIE_PLACE.r);
/** the thick turned-up brim (19 units = 5.5 px at 96 px), a gentle curve over the head, rounded ends */
export const BEANIE_BRIM = bp('M-42 -19 Q0 -14.5 37.6 -19 Q42 -19.4 42 -15 L42 -3.5 Q42 1 37.6 0.8 Q0 5.5 -42 0.8 Q-46.4 1 -46.4 -3.5 L-46.4 -15 Q-46.4 -19.4 -42 -19 Z');
/** knit ribs on the brim: darker bars 4 units wide (texture only, half transparent) */
const BEANIE_RIBS = bp(Array.from({ length: 10 }, (_v, i) => {
  const x = -38 + i * 8.4;
  const top = (u: number) => f2(-19 + 2.25 * (1 - (u / 42) ** 2) + 2.4);
  const bot = (u: number) => f2(0.8 + 2.35 * (1 - (u / 42) ** 2) - 2.4);
  return `M${f2(x - 2)} ${top(x - 2)} L${f2(x + 2)} ${top(x + 2)} L${f2(x + 2)} ${bot(x + 2)} L${f2(x - 2)} ${bot(x - 2)} Z`;
}).join(' '));
/** the soft dome over the right two thirds of the brim; its left side hugs the ear that comes out of the hat */
export const BEANIE_DOME = bp('M-12 -17 C-15 -36 -4 -58 16 -60 C36 -61.5 47 -42 42 -17 Z');
const BEANIE_SHADE = bp('M31 -57 C43 -50 47 -36 42 -17 L32 -17 C35 -30 35 -45 31 -57 Z');
/** three soft knit ribs down the dome (texture, half transparent; ≥ 3.6 units) */
const BEANIE_KNIT = bp('M4.6 -58.4 C1.4 -46 0.6 -30 2 -18 L5.6 -18 C4.4 -30 5.2 -46 8.2 -59 Z M16.2 -59.6 C15 -46 15 -30 16.4 -18 L20 -18 C18.8 -30 18.8 -46 19.8 -59.6 Z M27.4 -58.2 C29 -46 29.6 -30 29 -18 L32.6 -18 C33.2 -30 32.6 -46 31 -56.8 Z');
/** the hole the upright ear comes through: a knitted edge along the dome's left side and a lip on the brim */
const BEANIE_HOLE = bp('M-12.6 -17 C-15.4 -31 -11 -45 -2.6 -53 C-4.6 -43.6 -7.2 -31 -5.2 -17 Z M-41.5 -15.6 C-37 -27 -15 -28 -9.5 -16.4 C-15.5 -21.8 -35.4 -21.4 -41.5 -15.6 Z');
/** the little knitted spring under the bobble: two thick coils, bottom to top */
const BEANIE_COIL: readonly string[] = [bp(ellipse(16, -62.5, 5.6, 3.3)), bp(ellipse(16.4, -68.2, 5.6, 3.3))];
const BEANIE_BOB_C = bpt(17, -81);
export const BEANIE_BOB = { cx: BEANIE_BOB_C[0], cy: BEANIE_BOB_C[1], r: 13 } as const;
export const BEANIE_WOB_AT = { x: bpt(16, -60)[0], y: bpt(16, -60)[1] } as const;
/** every shape of the beanie (tests: clearance of the folded ear) */
export const BEANIE_SHAPES: readonly string[] = [BEANIE_BRIM, BEANIE_DOME, BEANIE_HOLE, ellipse(BEANIE_BOB.cx, BEANIE_BOB.cy, BEANIE_BOB.r), ...BEANIE_COIL];
export const BEANIE_LAND = { x: bpt(0, -8)[0], y: bpt(0, -8)[1] } as const;

// ---- the specs ------------------------------------------------------------------------------------------------

export const WEAR: Readonly<Record<WearId, WearSpec>> = {
  scarf: {
    id: 'scarf',
    kind: 'bunny',
    slot: 'neck',
    label: 'Зимний шарф',
    de: 'Schal',
    season: '1.11 – 5.12 и 27.12 – 28.02',
    spans: [{ from: [1, 1], to: [28, 2] }, { from: [1, 11], to: [5, 12] }, { from: [27, 12], to: [31, 12] }],
    // the app's accent (marmalade, tokens --accent-400) and a deeper knit shade; at night the lighter accent ink
    colors: { light: ['#EE9443', '#C4661F'], dark: ['#F2A25A', '#C9752F'], navy: ['#F2A25A', '#C9752F'] },
    land: { x: 0, y: -50 },
    markup: (clip) => `<g clip-path="${clip}"><g class="wr-band"><g class="wr-m-wrap" ${at(0, -60)}>
      <path ${o} d="${SCARF_BAND}" fill="${W1('#EE9443')}"/>
      <path d="${SCARF_BAND_LOW}" fill="${W2('#C4661F')}" opacity=".55"/>
    </g></g></g>
    <g class="wr-front"><g class="wr-m-knot" ${at(SCARF_KNOT_AT.x, SCARF_KNOT_AT.y)}>
      <path ${o} d="${SCARF_TAIL}" fill="${W1('#EE9443')}"/>
      <path d="${SCARF_STRIPE}" fill="${W2('#C4661F')}"/>
      <path ${o} d="${SCARF_KNOT}" fill="${W1('#EE9443')}"/>
      <path d="${SCARF_KNOT_LOW}" fill="${W2('#C4661F')}" opacity=".55"/>
    </g></g>`,
  },
  beanie: {
    id: 'beanie',
    kind: 'hamster',
    slot: 'head',
    label: 'Шапочка с помпоном',
    de: 'Bommelmütze',
    season: '1.12 – 28.02',
    spans: [{ from: [1, 1], to: [28, 2] }, { from: [1, 12], to: [31, 12] }],
    colors: { light: ['#D44D61', '#FFF4E4'], dark: ['#DF6175', '#FFF4E4'], navy: ['#DF6175', '#FFF4E4'] },
    land: BEANIE_LAND,
    markup: () => `<g class="wr-head">
      <g class="wr-wob" data-wob="12" ${at(BEANIE_WOB_AT.x, BEANIE_WOB_AT.y)}><g class="wr-m-bob" ${at(BEANIE_WOB_AT.x, BEANIE_WOB_AT.y)}>
        ${BEANIE_COIL.map((d, i) => `<path ${o} d="${d}" fill="${shade(W1('#D44D61'), i % 2 ? 86 : 74)}"/>`).reverse().join('')}
        <path ${o} d="${ellipse(BEANIE_BOB.cx, BEANIE_BOB.cy, BEANIE_BOB.r)}" fill="${W2('#FFF4E4')}"/>
        <path d="${ellipse(BEANIE_BOB.cx + 3.6, BEANIE_BOB.cy + 4, 8, 7)}" fill="color-mix(in srgb, ${W2('#FFF4E4')} 80%, ${W1('#D44D61')})" opacity=".45"/>
      </g></g>
      <path ${o} d="${BEANIE_DOME}" fill="${W1('#D44D61')}"/>
      <path d="${BEANIE_KNIT}" fill="${shade(W1('#D44D61'), 84)}" opacity=".35"/>
      <path d="${BEANIE_SHADE}" fill="${shade(W1('#D44D61'), 84)}" opacity=".7"/>
      <path ${o} d="${BEANIE_BRIM}" fill="${shade(W1('#D44D61'), 86)}"/>
      <path d="${BEANIE_RIBS}" fill="${shade(W1('#D44D61'), 66)}" opacity=".45"/>
      <path ${o} d="${BEANIE_HOLE}" fill="${shade(W1('#D44D61'), 76)}"/>
    </g>`,
  },
  nikolaus: {
    id: 'nikolaus',
    kind: 'bunny',
    slot: 'head',
    label: 'Шапка Николауса',
    de: 'Nikolausmütze',
    season: '6.12 – 26.12',
    spans: [{ from: [6, 12], to: [26, 12] }],
    colors: { light: ['#D64545', '#FFF9F1'], dark: ['#E05858', '#FFF9F1'], navy: ['#E05858', '#FFF9F1'] },
    land: { x: 0, y: -163 },
    markup: () => `<g class="wr-head">
      <g class="wr-wob" data-wob="14" ${at(NIKO_SOCK_AT.x, NIKO_SOCK_AT.y)}><g class="wr-m-tip" ${at(NIKO_SOCK_AT.x, NIKO_SOCK_AT.y)}>
        <path ${o} d="${NIKO_SOCK}" fill="${shade(W1('#D64545'), 90)}"/>
        <g class="wr-m-bob" ${at(NIKO_BOB.cx - 4, NIKO_BOB.cy - 6)}>
          <path ${o} d="${ellipse(NIKO_BOB.cx, NIKO_BOB.cy, NIKO_BOB.r)}" fill="${W2('#FFF9F1')}"/>
          <path d="${ellipse(NIKO_BOB.cx + 3, NIKO_BOB.cy + 3.4, 6.6, 5.6)}" fill="color-mix(in srgb, ${W2('#FFF9F1')} 82%, ${W1('#D64545')})" opacity=".35"/>
        </g>
      </g></g>
      <path ${o} d="${NIKO_CONE}" fill="${W1('#D64545')}"/>
      <path d="${NIKO_SHADE}" fill="#FFFFFF" opacity=".1"/>
      <path ${o} d="${NIKO_RIM}" fill="${W2('#FFF9F1')}"/>
      <path d="M-44 -158 Q0 -152 44 -158 L44 -155.2 Q0 -149.4 -44 -155.2 Z" fill="${shade(W2('#FFF9F1'), 88)}" opacity=".8"/>
    </g>`,
  },
  wreath: {
    id: 'wreath',
    kind: 'bunny',
    slot: 'head',
    label: 'Весенний венок',
    de: 'Blumenkranz',
    season: '20.03 – 31.05',
    spans: [{ from: [20, 3], to: [31, 5] }],
    colors: { light: ['#F2879F', '#6FAA5C'], dark: ['#F599AE', '#7DBA69'], navy: ['#F599AE', '#7DBA69'] },
    land: { x: 0, y: -160 },
    markup: () => `<g class="wr-head">
      <path ${o} d="${WREATH_VINE}" fill="${W2('#6FAA5C')}"/>
      ${WREATH_LEAVES.map((l) => `<path ${o} d="${leaf(l.x, l.y, l.a)}" fill="${W2('#6FAA5C')}"/>`).join('')}
      ${WREATH_FLOWERS.map((fl) => `<path ${o} d="${flower(fl.x, fl.y, fl.r)}" fill="${W1('#F2879F')}"/><path d="${ellipse(fl.x, fl.y, fl.r * 0.36)}" fill="${shade(W1('#F2879F'), 62)}"/>`).join('')}
      <g class="wr-fx wr-fx-petal-a" ${at(PETAL_A.x, PETAL_A.y)}><path ${o} d="${ellipse(PETAL_A.x, PETAL_A.y, 4.6, 3.4)}" fill="${W1('#F2879F')}"/></g>
      <g class="wr-fx wr-fx-petal-b" ${at(PETAL_B.x, PETAL_B.y)}><path ${o} d="${ellipse(PETAL_B.x, PETAL_B.y, 4.6, 3.4)}" fill="${W1('#F2879F')}"/></g>
    </g>`,
  },
  ring: {
    id: 'ring',
    kind: 'hamster',
    slot: 'waist',
    label: 'Надувной круг',
    de: 'Schwimmring',
    season: '1.06 – 31.08',
    spans: [{ from: [1, 6], to: [31, 8] }],
    colors: { light: ['#E8505B', '#FFF6EA'], dark: ['#EE6670', '#FFF6EA'], navy: ['#EE6670', '#FFF6EA'] },
    land: { x: 0, y: -38 },
    markup: (clip) => {
      const id = `${clip.slice(5, -1)}-ring`;
      return `<clipPath id="${id}"><path d="${RING}"/></clipPath>
      <path ${o} d="${RING}" fill="${W2('#FFF6EA')}"/>
      <g clip-path="url(#${id})"><g class="wr-band"><path d="${RING_STRIPES}" fill="${W1('#E8505B')}"/></g>
        <path d="${RING_SHINE}" fill="#FFFFFF" opacity=".5"/>
        <path d="${ellipse(-84, -47, 7, 3.4)}" fill="#FFFFFF" opacity=".45"/><path d="${ellipse(84, -47, 7, 3.4)}" fill="#FFFFFF" opacity=".45"/>
      </g>
      <path class="wr-edge" d="${RING}" fill="none" style="stroke: ${shade(W1('#E8505B'), 70)}"/>`;
    },
  },
  witch: {
    id: 'witch',
    kind: 'bunny',
    slot: 'head',
    label: 'Шляпа ведьмы',
    de: 'Hexenhut',
    season: '24.10 – 31.10',
    spans: [{ from: [24, 10], to: [31, 10] }],
    // plum felt (lifted at night so it does not sink into the dark card) and a pumpkin band
    colors: { light: ['#5B4A78', '#F08A3C'], dark: ['#7C69A3', '#F49A50'], navy: ['#8170AA', '#F49A50'] },
    land: { x: 0, y: -158 },
    markup: () => `<g class="wr-head">
      <path ${o} d="${WITCH_BRIM}" fill="${shade(W1('#5B4A78'), 88)}"/>
      <g class="wr-wob" data-wob="10" ${at(WITCH_TIP_AT.x, WITCH_TIP_AT.y)}><g class="wr-m-tip" ${at(WITCH_TIP_AT.x, WITCH_TIP_AT.y)}>
        <path ${o} d="${WITCH_TIP}" fill="${W1('#5B4A78')}"/>
      </g></g>
      <path ${o} d="${WITCH_CONE}" fill="${W1('#5B4A78')}"/>
      <path d="${WITCH_SHADE}" fill="${shade(W1('#5B4A78'), 80)}" opacity=".6"/>
      <path ${o} d="${WITCH_BAND}" fill="${W2('#F08A3C')}"/>
    </g>`,
  },
  party: {
    id: 'party',
    kind: 'bunny',
    slot: 'head',
    label: 'Праздничный колпак',
    de: 'Partyhut',
    season: 'в день рождения',
    spans: [],
    occasion: 'страница дня рождения (Geburtstag) — в любой день года',
    colors: { light: ['#6C8CFF', '#FF7A9A'], dark: ['#7D99FF', '#FF8BA7'], navy: ['#7D99FF', '#FF8BA7'] },
    land: { x: 0, y: -160 },
    markup: () => `<g class="wr-head">
      <path ${o} d="${PARTY_CONE}" fill="${W1('#6C8CFF')}"/>
      <path d="${PARTY_STRIPES}" fill="${W2('#FF7A9A')}"/>
      <path ${o} d="${PARTY_RIM}" fill="${shade(W1('#6C8CFF'), 80)}"/>
      <path ${o} d="${ellipse(PARTY_POM.cx, PARTY_POM.cy, PARTY_POM.r)}" fill="${W2('#FF7A9A')}"/>
    </g>
    <g class="wr-front">
      <g class="wr-fx wr-fx-horn" ${at(HORN_AT.x, HORN_AT.y)}>
        <path ${o} d="${HORN}" fill="${W1('#6C8CFF')}"/>
        <path d="${HORN_BANDS}" fill="${W2('#FF7A9A')}"/>
        <path d="${HORN_MOUTH}" fill="${shade(W1('#6C8CFF'), 70)}"/>
      </g>
      <g class="wr-fx wr-fx-conf-a" ${at(CONF_A.x, CONF_A.y)}><path ${o} d="M${CONF_A.x - 6} ${CONF_A.y - 4} L${CONF_A.x + 6} ${CONF_A.y - 4} L${CONF_A.x + 6} ${CONF_A.y + 4} L${CONF_A.x - 6} ${CONF_A.y + 4} Z" fill="${W2('#FF7A9A')}"/></g>
      <g class="wr-fx wr-fx-conf-b" ${at(CONF_B.x, CONF_B.y)}><path ${o} d="M${CONF_B.x} ${CONF_B.y - 6} L${CONF_B.x + 6} ${CONF_B.y} L${CONF_B.x} ${CONF_B.y + 6} L${CONF_B.x - 6} ${CONF_B.y} Z" fill="${W1('#6C8CFF')}"/></g>
    </g>`,
  },
};

/** In the order of the year (the year strip and the gallery), the occasion item last. */
export const WEAR_IDS: readonly WearId[] = ['scarf', 'beanie', 'wreath', 'ring', 'witch', 'nikolaus', 'party'];

/** Optional colour sets for Felix to compare (gallery chips); [0] = the default above. Light theme values. */
export const WEAR_PALETTES: Readonly<Record<WearId, readonly { name: string; c: readonly [string, string] }[]>> = {
  scarf: [
    { name: 'Мармелад (акцент)', c: ['#EE9443', '#C4661F'] },
    { name: 'Брусника', c: ['#C8424F', '#93283A'] },
    { name: 'Ёлка', c: ['#3F8A6B', '#2B6550'] },
    { name: 'Горчица', c: ['#D9A63A', '#AE7C1E'] },
  ],
  beanie: [
    { name: 'Малина', c: ['#D44D61', '#FFF4E4'] },
    { name: 'Мармелад', c: ['#EE9443', '#FFF4E4'] },
    { name: 'Ёлка', c: ['#3F8A6B', '#FFF4E4'] },
    { name: 'Небо', c: ['#5C8FD6', '#FFF4E4'] },
  ],
  nikolaus: [
    { name: 'Красная', c: ['#D64545', '#FFF9F1'] },
    { name: 'Брусника', c: ['#B23A4A', '#FFF9F1'] },
  ],
  wreath: [
    { name: 'Розовые цветы', c: ['#F2879F', '#6FAA5C'] },
    { name: 'Жёлтые цветы', c: ['#F2C14E', '#6FAA5C'] },
    { name: 'Сирень', c: ['#B48BE0', '#6FAA5C'] },
  ],
  ring: [
    { name: 'Красный + сливки', c: ['#E8505B', '#FFF6EA'] },
    { name: 'Бирюза + сливки', c: ['#2FA7B5', '#FFF6EA'] },
  ],
  witch: [
    { name: 'Слива + тыква', c: ['#5B4A78', '#F08A3C'] },
    { name: 'Ночь + тыква', c: ['#3F4660', '#F08A3C'] },
  ],
  party: [
    { name: 'Синий + розовый (логотип)', c: ['#6C8CFF', '#FF7A9A'] },
    { name: 'Мармелад + синий', c: ['#EE9443', '#6C8CFF'] },
  ],
};

/**
 * The wardrobe's CSS, added once to each puppet's shadow root. Selectors only use the puppet's own state
 * classes (.turn-r / .turn-l / .walking / .hold-binoculars / .rm on `.hm` or the svg), so an item follows every
 * pose the puppet already has. Nothing here moves by itself: the only loops are HIS — the hamster's binocular
 * head motion and the dangling parts swinging while he walks.
 */
export const WEAR_CSS = `
.wr { pointer-events: none; }
.wr-o { stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke;
  paint-order: stroke fill; stroke-linejoin: round; }
.wr-edge { stroke-width: 1.1px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.wr-fall, .wr-m-wrap, .wr-m-knot, .wr-m-tip, .wr-m-bob, .wr-wob, .wr-fx { transform-box: view-box; }
.wr-fx { opacity: 0; }
.wr-band, .wr-front, .wr-head { transform-box: view-box; transition: transform .28s cubic-bezier(.3, .7, .3, 1); }
.wr-front { transform-origin: 0px 0px; }
.wr-head { transform-origin: 0px -150px; }
.turn-r .wr-band { transform: translateX(9px); }
.turn-l .wr-band { transform: translateX(-9px); }
.turn-r .wr-front { transform: translateX(13px) scaleX(.88); }
.turn-l .wr-front { transform: translateX(-13px) scaleX(.88); }
.turn-r .wr-head { transform: translateX(11px) scaleX(.9); }
.turn-l .wr-head { transform: translateX(-11px) scaleX(.9); }
.hold-binoculars .wr-head { animation: bino-ears 16s cubic-bezier(.45, 0, .2, 1) infinite; }
.wr-wob { --wr-lean: 0deg; transform: rotate(var(--wr-lean)); transition: transform .6s cubic-bezier(.34, 1.56, .64, 1); }
.turn-r .wr-wob { --wr-lean: -8deg; }
.turn-l .wr-wob { --wr-lean: 8deg; }
.walking .wr-wob { animation: wr-wob-walk .5s ease-in-out infinite; }
@keyframes wr-wob-walk { 0%, 100% { transform: rotate(var(--wr-lean)); } 35% { transform: rotate(calc(var(--wr-lean) - 9deg)); } 70% { transform: rotate(calc(var(--wr-lean) + 6deg)); } }
.rm .wr-band, .rm .wr-front, .rm .wr-head, .rm .wr-wob { transition: none; }
.rm .hold-binoculars .wr-head, .rm .walking .wr-wob { animation: none; }
`;

/** The id of this puppet's body clip (every instance has its own: bunnyMarkup / hamsterMarkup `clip-body`). */
export function bodyClip(root: ParentNode): string | null {
  const clip = root.querySelector('clipPath[id$="clip-body"]');
  return clip ? `url(#${clip.id})` : null;
}

/** The direct child of `el` with this class (no `:scope >`: not every DOM implementation has it). */
export function childOf<T extends Element = SVGGElement>(el: Element, cls: string): T | null {
  return (Array.from(el.children).find((c) => c.classList.contains(cls)) as T | undefined) ?? null;
}

/** Takes off whatever this puppet wears (gallery: changing items). */
export function takeOff(root: ParentNode): void {
  for (const g of Array.from(root.querySelectorAll('.wr'))) g.remove();
}

/**
 * Puts `id` on the puppet whose shadow root is `root`: one group inside its `.breathe`, before the front paws,
 * plus the wardrobe CSS once and the follow-through of the dangling parts. Works for every puppet built from the
 * mascot markup. Returns the item's group (its first child `.wr-fall` is what the moment moves), or null when
 * this is not a puppet.
 */
export function putOn(root: ShadowRoot, id: WearId): SVGGElement | null {
  const breathe = root.querySelector('.breathe');
  const clip = bodyClip(root);
  if (!breathe || !clip) return null;
  takeOff(root);
  if (!root.querySelector('style[data-wardrobe]')) {
    const style = document.createElement('style');
    style.dataset['wardrobe'] = '';
    style.textContent = WEAR_CSS;
    root.append(style);
  }
  const spec = WEAR[id];
  const g = document.createElementNS(SVG_NS, 'g');
  // the slot wrapper's own class must not be one of the turn targets (.wr-head / .wr-front / .wr-band): they would apply twice
  g.setAttribute('class', `wr wr-slot-${spec.slot}`);
  g.setAttribute('data-wear', id);
  g.innerHTML = `<g class="wr-fall" style="transform-origin: ${spec.land.x}px ${spec.land.y}px">${spec.markup(clip)}</g>`;
  breathe.insertBefore(g, childOf(breathe, 'tp'));
  followThrough(root);
  return g;
}

/** Every puppet shadow root under `node` (a mascot host, or a stage whose actors have their own shadow roots). */
export function puppetRoots(node: Element | ShadowRoot): ShadowRoot[] {
  const out: ShadowRoot[] = [];
  const visit = (n: Element | ShadowRoot) => {
    const root = n instanceof ShadowRoot ? n : n.shadowRoot;
    if (root) {
      if (root.querySelector('.breathe') && bodyClip(root)) out.push(root);
      for (const el of Array.from(root.querySelectorAll('*'))) if (el.shadowRoot) visit(el);
    }
  };
  visit(node);
  return out;
}

// ---- follow-through: the dangling parts swing AFTER his hop ------------------------------------------------------
// Gallery-only wiring: the puppet's every hop / jump runs one Web Animation on its `.hop` group (MascotBase
// jumpMotion). We listen to exactly that call on this one element (an own property, the prototype is untouched)
// and give every `.wr-wob` a damped swing timed to his take-off and landing. In the package this becomes one line
// in jumpMotion. The swing is added on top of the turn lean (composite: add) and ends at rest.

const hooked = new WeakSet<Element>();
const swings = new WeakMap<Element, Animation>();

/** The swing of one dangling part for a hop of `d` ms (offsets over d + 560 ms: it settles after the landing). */
export function wobbleFrames(amp: number, d: number): { frames: Keyframe[]; duration: number } {
  const total = d + 560;
  const k = (ms: number) => Math.round((ms / total) * 1000) / 1000;
  const rot = (a: number) => `rotate(${Math.round(a * 10) / 10}deg)`;
  const land = d * 0.84;
  return {
    duration: total,
    frames: [
      { transform: rot(0), offset: 0, easing: 'ease-in-out' },
      { transform: rot(-0.35 * amp), offset: k(d * 0.3), easing: 'ease-in-out' },
      { transform: rot(0.25 * amp), offset: k(d * 0.6), easing: 'ease-in' },
      { transform: rot(amp), offset: k(land + 60), easing: 'ease-in-out' },
      { transform: rot(-0.6 * amp), offset: k(land + 190), easing: 'ease-in-out' },
      { transform: rot(0.32 * amp), offset: k(land + 320), easing: 'ease-in-out' },
      { transform: rot(-0.12 * amp), offset: k(land + 440), easing: 'ease-in-out' },
      { transform: rot(0), offset: 1 },
    ],
  };
}

/** Wires the follow-through once per puppet (putOn does it). */
export function followThrough(root: ShadowRoot): void {
  const hop = root.querySelector('.hop');
  if (!hop || hooked.has(hop) || typeof hop.animate !== 'function') return;
  hooked.add(hop);
  const own = hop.animate;
  Object.defineProperty(hop, 'animate', {
    configurable: true,
    value(this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
      const a = own.call(this, frames, options);
      const d = typeof options === 'number' ? options : Number(options?.duration ?? 0);
      const reduced = !!root.querySelector('svg.rm');
      if (d > 0 && Number.isFinite(d) && !reduced) {
        for (const el of Array.from(root.querySelectorAll('.wr-wob'))) {
          swings.get(el)?.cancel();
          const w = wobbleFrames(Number((el as SVGElement).dataset['wob']) || 10, d);
          const s = Element.prototype.animate.call(el, w.frames, { duration: w.duration, composite: 'add' });
          swings.set(el, s);
        }
      }
      return a;
    },
  });
}

/** The custom properties a cell sets for an item in a theme (optionally another palette's light colours). */
export function wearVars(id: WearId, theme: WearTheme, palette = 0): Record<string, string> {
  const spec = WEAR[id];
  const alt = WEAR_PALETTES[id][palette];
  // a chosen palette replaces the light colours; the night themes lift it the same way the default is lifted
  const [c1, c2] = palette > 0 && alt ? (theme === 'light' ? alt.c : alt.c.map((c) => lift(c)) as unknown as [string, string]) : spec.colors[theme];
  return { '--mascot-wear-1': c1, '--mascot-wear-2': c2 };
}

/** A night version of a light colour: a little lighter (like the accent's night ink). */
function lift(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * 0.12));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ---- the year (Germany) ---------------------------------------------------------------------------------------

/** Day of the year (1 … 365, not a leap year) for the strip. */
export function dayOfYear([d, m]: DayMonth): number {
  const before = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return (before[m - 1] ?? 0) + d;
}

/** What each mascot wears on a date (an occasion item wins over the date; null = nothing). */
export function wornOn(kind: WearKind, date: DayMonth, occasion: 'birthday' | null = null): WearId | null {
  if (occasion === 'birthday' && kind === 'bunny') return 'party';
  const day = dayOfYear(date);
  // the special days first (witch, Nikolaus), then the seasons
  const order: WearId[] = ['witch', 'nikolaus', 'scarf', 'wreath', 'beanie', 'ring'];
  for (const id of order) {
    const spec = WEAR[id];
    if (spec.kind !== kind) continue;
    if (spec.spans.some((s) => day >= dayOfYear(s.from) && day <= dayOfYear(s.to))) return id;
  }
  return null;
}
