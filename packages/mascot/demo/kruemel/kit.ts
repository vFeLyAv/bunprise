/**
 * Krümel's look, v2 — Pompon's little brother, a BABY LOP rabbit (ideas doc 2026-10-26 §2.1 / top-5 item 5).
 * GALLERY-ONLY prototype. v1 (archived in _codex_handoffs/archive-20261026/kruemel-v1) read "raw" to Felix:
 * thin pointed ears (kitten / fox), head and body as two stacked balls, a big belly circle.
 *
 * The SAME puppet (bunnyMarkup, coats, CSS); this module only reshapes its static shapes in the puppet's own
 * shadow DOM (attributes and a small <style> for the ear pivots — never a CSS transform an animation could
 * fight with), so he reads as a baby rabbit and not as "Pompon, smaller":
 *  - ONE soft silhouette: a big round head flowing into a small pear body, no waist; a fluff tuft on the
 *    forehead and baby fluff on the cheeks (all in the one outline, so the contour runs around it);
 *  - rabbit ears (spoon shape, round tip, pink inside) in the "airplane" phase of lop kits: lop babies are born
 *    with upright ears, which stick out sideways for a few weeks before they drop — one ear still up and out,
 *    the other already sideways with its outer half flopping down (one bent shape; the turned half a shade
 *    darker, the back of the ear). Both turn only about their roots in motion — never a shape change;
 *  - big eyes with a clear catch-light, a tiny nose and mouth low on the face (baby schema), rounder blush;
 *  - short legs: big hind feet with toe lines, tiny front paws, a small belly patch.
 *  Grown ("Krümel ist gewachsen"): Pompon's lop ears, a little smaller, on his head. Never an animated switch
 *  between the two (Felix rejected ears that change shape in motion): the ears are chosen when he is drawn.
 */

import { star } from '../../src/shapes';

export type KitEars = 'upright' | 'lop';
export type Pt = readonly [number, number];

const f = (v: number) => String(Math.round(v * 100) / 100);

function at(pts: readonly Pt[], i: number): Pt {
  const n = pts.length;
  return pts[((i % n) + n) % n] as Pt;
}

/** The cubic Bézier controls of a closed Catmull-Rom spline through `pts` (segment i: pts[i] -> pts[i+1]). */
function segments(pts: readonly Pt[]): Array<[Pt, Pt, Pt, Pt]> {
  return pts.map((_, i) => {
    const [p0, p1, p2, p3] = [at(pts, i - 1), at(pts, i), at(pts, i + 1), at(pts, i + 2)];
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    return [p1, c1, c2, p2];
  });
}

/** A soft closed shape through a few key points (Catmull-Rom as cubic Béziers). */
export function smoothPath(pts: readonly Pt[]): string {
  const p = at(pts, 0);
  return `M${f(p[0])} ${f(p[1])}${segments(pts).map(([, c1, c2, e]) => ` C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(e[0])} ${f(e[1])}`).join('')} Z`;
}

/** Points along that shape's outline (bounds checks in the tests). */
export function smoothSample(pts: readonly Pt[], k = 12): Pt[] {
  const out: Pt[] = [];
  for (const [a, b, c, d] of segments(pts)) {
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const u = 1 - t;
      const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
      out.push([w[0] * a[0] + w[1] * b[0] + w[2] * c[0] + w[3] * d[0], w[0] * a[1] + w[1] * b[1] + w[2] * c[1] + w[3] * d[1]]);
    }
  }
  return out;
}

/// ---------- the silhouette ----------

/**
 * Right half of his outline, top to bottom (bunny units, feet at y = 0): the head is an ellipse around
 * (0, -90), ±64 wide, top at -138 (rounder than tall: a baby); two soft fluff tufts on the cheek hide the step
 * to the small pear of a body (±51 under the cheeks, ±53 at the haunches — no snowman waist), a round bottom.
 */
const SIDE_R: readonly Pt[] = [
  [16, -136.5], [34, -130.7], [50, -120], [60, -106.7], [64, -90],
  [63.6, -80], [66.4, -73], [61.8, -69.4], [62.8, -62.4], [56.6, -57.6],
  [52.4, -47.5], [55, -31], [53.4, -15], [40, -3.2], [18, -1],
];
/** Left half: the same, the cheek fluff a little different (a living animal is never quite symmetric). */
const SIDE_L: readonly Pt[] = SIDE_R.map(([x, y], i): Pt => (i === 6 ? [-x - 0.4, y + 1.2] : i === 8 ? [-x + 0.4, y - 0.6] : [-x, y]));
/** The fluff tuft on his forehead (left to right across the top of the head): one curl and two soft wisps. */
const TUFT: readonly Pt[] = [[-10, -138.4], [-6.8, -143], [-3.2, -140.6], [1, -149.4], [5.2, -141.6], [8.8, -144.2], [11.6, -139.6]];

/** His outline as key points (closed): right side down, left side up, the tuft across the top. */
export const KIT_BODY_PTS: readonly Pt[] = [...SIDE_R, ...[...SIDE_L].reverse(), ...TUFT];
export const KIT_BODY = smoothPath(KIT_BODY_PTS);

/** Eyes: big, a little low and close (Pompon: ±29, -93, 6.2 × 7.4). */
export const KIT_EYE = { x: 25, y: -84, rx: 8.4, ry: 9.8 } as const;
/** Nose top / mouth: small and low on the face (Pompon's nose top is at -84). */
const NOSE_Y = -73.4;
const DY = NOSE_Y + 84;

// ---------- the ears ----------

/**
 * A rabbit's ear along a (bent) centre line, a quadratic curve root -> ctrl -> end: narrow root, widest past
 * the middle, a round tip — NOT a triangle (cat / fox), NOT a round hamster ear. `w` = widest width.
 */
export interface EarLine { root: Pt; ctrl: Pt; end: Pt; w: number }

/** Left ear: still up, turned out a little. */
export const KIT_EAR_L: EarLine = { root: [-24, -118], ctrl: [-40, -144], end: [-56.5, -170], w: 24 };
/** Right ear: already sideways ("airplane"), its outer half flopping down — the lop ear on its way. */
export const KIT_EAR_R: EarLine = { root: [25, -116], ctrl: [58, -140], end: [84, -110], w: 23 };

const OUTER: ReadonlyArray<readonly [number, number]> = [[0, 0.36], [0.24, 0.46], [0.52, 0.5], [0.76, 0.45], [0.9, 0.32], [0.975, 0.15]];
/** The pink inside, on the part that still faces forward (from `t0` to `t1` along the centre line). */
const INNER: ReadonlyArray<readonly [number, number]> = [[0, 0.2], [0.3, 0.26], [0.62, 0.25], [0.86, 0.17], [0.97, 0.08]];

function onLine(e: EarLine, t: number, h: number): Pt {
  const u = 1 - t;
  const x = u * u * e.root[0] + 2 * u * t * e.ctrl[0] + t * t * e.end[0];
  const y = u * u * e.root[1] + 2 * u * t * e.ctrl[1] + t * t * e.end[1];
  const dx = 2 * u * (e.ctrl[0] - e.root[0]) + 2 * t * (e.end[0] - e.ctrl[0]);
  const dy = 2 * u * (e.ctrl[1] - e.root[1]) + 2 * t * (e.end[1] - e.ctrl[1]);
  const len = Math.hypot(dx, dy) || 1;
  return [x - (dy / len) * h, y + (dx / len) * h];
}

/** The outline key points of an ear (or of its pink inside between t0 and t1). */
function earPts(e: EarLine, inner = false, t0 = 0, t1 = 1): Pt[] {
  const prof = inner ? INNER : OUTER;
  const at = (s: number) => t0 + s * (t1 - t0);
  return [
    ...prof.map(([s, h]) => onLine(e, at(s), -h * e.w)),
    onLine(e, at(1), 0),
    ...[...prof].reverse().map(([s, h]) => onLine(e, at(s), h * e.w)),
    onLine(e, at(-0.05), 0),
  ];
}

/** Half-width of an ear at `t` (interpolated from the outline profile). */
function earH(e: EarLine, t: number): number {
  const prof = [...OUTER, [1, 0] as const];
  for (let i = 1; i < prof.length; i++) {
    const [s0, h0] = prof[i - 1] as readonly [number, number];
    const [s1, h1] = prof[i] as readonly [number, number];
    if (t <= s1) return (h0 + ((t - s0) / (s1 - s0)) * (h1 - h0)) * e.w;
  }
  return 0;
}

/** The flopped half of the right ear, a shade darker: you see the back of the ear where it turns down. */
function foldPts(): Pt[] {
  const e = KIT_EAR_R;
  const ts = [0.6, 0.7, 0.8, 0.9, 0.975];
  return [onLine(e, 0.57, 0), ...ts.map((t) => onLine(e, t, -earH(e, t) * 0.96)), onLine(e, 1, 0), ...[...ts].reverse().map((t) => onLine(e, t, earH(e, t) * 0.96))];
}

/** The outer shapes of both baby ears as key points (bounds checks: hidden line, paws, crop). */
export function kitEarPts(): { l: Pt[]; r: Pt[] } {
  return { l: earPts(KIT_EAR_L), r: earPts(KIT_EAR_R) };
}

/** Highest point of his ears / head / tuft (bunny units): must stay below the welcome stage's hidden line (y > -179). */
export function kitTop(ears: KitEars): number {
  const ys = smoothSample(KIT_BODY_PTS).map((q) => q[1]);
  if (ears === 'upright') {
    const e = kitEarPts();
    for (const pts of [e.l, e.r]) ys.push(...smoothSample(pts).map((q) => q[1]));
  }
  return Math.min(...ys);
}

// ---------- reshaping the puppet ----------

function attrs(el: Element | null | undefined, values: Record<string, number | string>): void {
  if (!el) return;
  for (const [k, v] of Object.entries(values)) el.setAttribute(k, typeof v === 'number' ? f(v) : v);
}

/** Ear pivots (they turn about their roots, for the stage's ear physics and his moments); scoped to the puppet. */
function kitCss(): string {
  const [lx, ly] = KIT_EAR_L.root;
  const [rx, ry] = KIT_EAR_R.root;
  return `.kit .up .ear-l { transform-box: view-box; transform-origin: ${f(lx)}px ${f(ly)}px; }
.kit .up .ear-r { transform-box: view-box; transform-origin: ${f(rx)}px ${f(ry)}px; }`;
}

const eyeStar = (x: number, y: number) =>
  `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(KIT_EYE.rx + 0.4)}" ry="${f(KIT_EYE.ry + 0.4)}" fill="var(--mascot-eye)"/><path d="${star(x + 2.6, y - 3, 4.6, 1.5, 4)}" fill="#fff"/><circle cx="${f(x - 3.2)}" cy="${f(y + 3.8)}" r="1.3" fill="#fff" opacity=".85"/>`;

/** Reshapes a mounted bunny puppet (its <svg>) into Krümel. Idempotent. */
export function applyKit(svg: SVGSVGElement, ears: KitEars): void {
  const hm = svg.querySelector('.hm');
  if (!hm) return;
  hm.classList.toggle('ears-up', ears === 'upright');
  hm.classList.toggle('ears-lop', ears !== 'upright');
  hm.classList.add('kit');
  if (svg.dataset['kit'] === '2') return;
  svg.dataset['kit'] = '2';

  const defs = svg.querySelector('defs');
  if (defs && !defs.querySelector('style.kit-css')) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.setAttribute('class', 'kit-css');
    style.textContent = kitCss();
    defs.append(style);
  }

  // one soft silhouette (+ the broken coat's clip, the same outline)
  for (const p of svg.querySelectorAll('.breathe > path, clipPath path')) p.setAttribute('d', KIT_BODY);
  // a small soft belly patch (its gradient shrinks with it, so it fades out at the edge)
  for (const e of svg.querySelectorAll('ellipse[cy="-46"][rx="56"]')) attrs(e, { cy: -28, rx: 27, ry: 24 });
  const belly = svg.querySelector('radialGradient[id$="g-belly"]');
  attrs(belly, { cy: -28, r: 24, gradientTransform: 'translate(0 -28) scale(1.12 1) translate(0 28)' });
  belly?.querySelectorAll('stop').forEach((st, i) => st.setAttribute('style', `stop-color: var(--mascot-belly); stop-opacity: ${['.85', '.62', '0'][i] ?? '0'}`));
  // the cheeks the puppet puffs: inside the outline (the fluff is drawn by the outline itself)
  svg.querySelectorAll('.cheek-j ellipse').forEach((e, i) => attrs(e, { cx: i ? 47 : -47, cy: -72, rx: 10, ry: 13 }));

  // eyes (normal, star, happy arcs, sleep arcs, brows): big, low, a clear catch-light
  for (const g of svg.querySelectorAll('.eyes .eye')) {
    const [eye, hi, lo] = [...g.children];
    const x = (Number(eye?.getAttribute('cx') ?? '0') < 0 ? -1 : 1) * KIT_EYE.x;
    const y = KIT_EYE.y;
    attrs(eye, { cx: x, cy: y, rx: KIT_EYE.rx, ry: KIT_EYE.ry });
    attrs(hi, { cx: x + 2.9, cy: y - 3.5, r: 3.1 });
    attrs(lo, { cx: x - 3, cy: y + 4.1, r: 1.35, opacity: 0.85 });
  }
  const star4 = svg.querySelector('.eyes-star');
  if (star4) star4.innerHTML = eyeStar(-KIT_EYE.x, KIT_EYE.y) + eyeStar(KIT_EYE.x, KIT_EYE.y);
  svg.querySelector('.eyes-happy')?.querySelectorAll('path').forEach((p, i) => {
    const x = (i ? 1 : -1) * KIT_EYE.x;
    p.setAttribute('d', `M${f(x - 7.6)} ${f(KIT_EYE.y + 2.5)} Q${f(x)} ${f(KIT_EYE.y - 7.5)} ${f(x + 7.6)} ${f(KIT_EYE.y + 2.5)}`);
  });
  svg.querySelector('.eyes-sleep')?.querySelectorAll('path').forEach((p, i) => {
    const x = (i ? 1 : -1) * KIT_EYE.x;
    p.setAttribute('d', `M${f(x - 7)} ${f(KIT_EYE.y)} Q${f(x)} ${f(KIT_EYE.y + 6.5)} ${f(x + 7)} ${f(KIT_EYE.y)}`);
  });
  svg.querySelector('.angry-brows')?.querySelectorAll('path').forEach((p, i) => {
    const s = i ? 1 : -1;
    p.setAttribute('d', `M${f(s * 34)} ${f(KIT_EYE.y - 15)} L${f(s * 17)} ${f(KIT_EYE.y - 10)}`);
  });

  // tiny nose, mouth and muzzle, low on the face; a rounder blush
  attrs(svg.querySelector('.nose path'), { d: `M-3 ${f(NOSE_Y)} Q0 ${f(NOSE_Y - 1.7)} 3 ${f(NOSE_Y)} Q2.3 ${f(NOSE_Y + 2.7)} 0 ${f(NOSE_Y + 3.5)} Q-2.3 ${f(NOSE_Y + 2.7)} -3 ${f(NOSE_Y)} Z` });
  const m = NOSE_Y + 3.5;
  attrs(svg.querySelector('.mouth'), { d: `M0 ${f(m)} L0 ${f(m + 1.9)} M0 ${f(m + 1.9)} Q-1.9 ${f(m + 4)} -4 ${f(m + 3.1)} M0 ${f(m + 1.9)} Q1.9 ${f(m + 4)} 4 ${f(m + 3.1)}` });
  attrs(svg.querySelector('.pout'), { d: `M-3.6 ${f(m + 4.6)} Q0 ${f(m + 2)} 3.6 ${f(m + 4.6)}` });
  attrs(svg.querySelector('.mouth-open'), { cy: m + 3.9, rx: 2.3, ry: 2 });
  svg.querySelectorAll('.face > ellipse:not(.mouth-open)').forEach((e, i) => attrs(e, { cx: i ? 4 : -4, cy: -76.6 + DY, rx: 4.7, ry: 3.5 }));
  for (const p of svg.querySelectorAll('.snot > path')) p.setAttribute('transform', `translate(0 ${f(DY)})`);
  svg.querySelectorAll('.tf > ellipse').forEach((e, i) => attrs(e, { cx: i ? 38 : -38, cy: -70.8, rx: 9.5, ry: 6.2, opacity: 0.36 }));
  // coat markings: the himalayan nose, the broken patches
  attrs(svg.querySelector('.points ellipse'), { cy: -70.4, rx: 9.5, ry: 7.4 });
  svg.querySelectorAll('.tpatch ellipse').forEach((e, i) => {
    const x = i ? 6 : -6;
    attrs(e, { cx: x, cy: -71.8, rx: 7.2, ry: 5.4, transform: `rotate(${i ? 24 : -24} ${x} -71.8)` });
  });
  attrs(svg.querySelector('.tpatch path'), { d: smoothPath([[13, -95], [22, -102], [35, -99], [40, -86], [36, -74], [25, -71.5], [16, -76], [12, -86]]) });
  svg.querySelectorAll('g[clip-path] .broken ellipse').forEach((e, i) => attrs(e, i ? { cx: 40, cy: -118, rx: 13, ry: 10 } : { cx: -34, cy: -24, rx: 10, ry: 8 }));

  // short legs: big hind feet with toes, tiny front paws held under the chin
  svg.querySelectorAll('.tfoot .foot').forEach((g, i) => {
    const s = i ? 1 : -1;
    const foot = g.querySelector('ellipse');
    attrs(foot, { cx: s * 39, cy: -5, rx: 17.5, ry: 8.6, transform: `rotate(${s * 8} ${s * 39} -5)` });
    if (!g.querySelector('.toes')) g.insertAdjacentHTML('beforeend', `<path class="toes" d="M${f(s * 33)} -1 l${f(s * 0.5)} -2.6 M${f(s * 38.5)} -0.2 l${f(s * 0.4)} -2.8" stroke="rgba(150,90,40,.3)" stroke-width="1.2" stroke-linecap="round" fill="none"/>`);
  });
  svg.querySelectorAll('.paws .paw').forEach((g, i) => {
    const s = i ? 1 : -1;
    attrs(g.querySelector('ellipse'), { cx: s * 11.5, cy: -45, rx: 7.4, ry: 8.4, transform: `rotate(${s * 18} ${s * 11.5} -45)` });
    attrs(g.querySelector('path'), { d: `M${f(s * 10.6)} -39.6 l${f(-s * 1.1)} 1.7 M${f(s * 13.2)} -40.4 l${f(-s * 1.1)} 1.7` });
  });
  svg.querySelectorAll('.tail circle').forEach((c) => attrs(c, { cx: Math.sign(Number(c.getAttribute('cx') ?? '0')) * 55, cy: -20, r: 8 }));
  attrs(svg.querySelector('.shadow'), { rx: 60, ry: 6.5 });

  // baby ears: one still up and out, one sideways with its outer half flopping (outer shape first: it gets the contour)
  const earL = svg.querySelector('.up .ear-l');
  if (earL) earL.innerHTML = `<path d="${smoothPath(earPts(KIT_EAR_L))}" fill="var(--mascot-accent)"/><path d="${smoothPath(earPts(KIT_EAR_L, true, 0.1, 0.86))}" fill="var(--mascot-ear-in)"/>`;
  const earR = svg.querySelector('.up .ear-r');
  if (earR) {
    earR.innerHTML = `<path d="${smoothPath(earPts(KIT_EAR_R))}" fill="var(--mascot-accent)"/><path d="${smoothPath(earPts(KIT_EAR_R, true, 0.12, 0.56))}" fill="var(--mascot-ear-in)"/>`
      + `<path class="kit-fold" d="${smoothPath(foldPts())}" fill="var(--mascot-accent-dark)" opacity=".38"/>`;
  }
  // grown: Pompon's lop ears, 10 % smaller, their roots moved down onto his head
  for (const [i, ear] of [...svg.querySelectorAll('.lop .ear-l, .lop .ear-r')].entries()) {
    const x = i ? 24 : -24;
    for (const p of ear.querySelectorAll('path')) p.setAttribute('transform', `translate(${x} -133) scale(.9) translate(${-x} 160)`);
  }
}
