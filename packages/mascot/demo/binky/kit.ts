/**
 * «Бинки-кролик» (31.10, Felix: «попробуй собрать персонажа в нашем стиле по этому кролику, чтобы его милость
 * осталась» — three photos of ONE real orange rabbit, a Netherland-dwarf type, mid-binky) — GALLERY-ONLY prototype.
 *
 * He is the SAME puppet as Pompon (bunnyMarkup: the same layers, CSS, eye style, blush, contour); this module only
 * reshapes its static shapes inside ONE puppet's own shadow DOM (attributes, a wrapper group, a small scoped <style>),
 * like Krümel's kit (demo/kruemel/kit.ts). packages/mascot/src is not touched: a puppet nobody reshapes stays
 * byte-identical (test/binky.test.ts pins it).
 *
 * What the photos give him (and what stays "ours"):
 *  - a compact loaf / potato: lower and wider than Pompon (head top -150 instead of -163, ±79 at the haunches instead of
 *    ±75), no neck — one soft silhouette like every one of ours;
 *  - TINY upright ears, close together (roots at ±13 instead of the package's ±21), soft and round, with a light fluffy
 *    tuft inside — three variants for Felix (A nubs, B soft ovals, C a folded tip);
 *  - big dark eyes (7.5 × 8.7 instead of 6.2 × 7.4, our highlights), a puffy white muzzle, fluffy cheeks (photo 3);
 *  - warm orange fur with a light underside and a white fluffy tail (photo 2; it shows in the 3/4 turn and the binky).
 *
 * Units: the puppet's own (x = 0 centre line, y = 0 feet, y up is negative).
 */

import { star } from '../../src/shapes';

export type Pt = readonly [number, number];
/** The three ear variants Felix picks from (A tiny round nubs, B slightly longer soft ovals, C a folded tip). */
export type EarVariant = 'a' | 'b' | 'c';
export const EAR_VARIANTS: readonly EarVariant[] = ['a', 'b', 'c'];
export type BkCoat = 'ginger' | 'apricot';
/** The seven coat colours in COAT_VARS order: base top, base bottom, belly, accent (ears), accent dark, paws, inner ear. */
export type CoatColors = readonly [string, string, string, string, string, string, string];

export const COAT_VAR_NAMES = ['--mascot-base-top', '--mascot-base-bottom', '--mascot-belly', '--mascot-accent', '--mascot-accent-dark', '--mascot-paw', '--mascot-ear-in'] as const;

/**
 * His coats: the photo's warm orange (default) and a lighter apricot (only to compare — between Pompon's cream and the
 * orange). The ears a shade deeper than the head (like the photo), light paws so they read in front of the fur.
 */
export const BK_COATS: Readonly<Record<BkCoat, { ru: string; de: string; colors: CoatColors }>> = {
  ginger: { ru: 'рыжий (как на фото)', de: 'Orange', colors: ['#F9BE7E', '#EC9752', '#FFF6EA', '#EE9C58', '#CF7A35', '#FCDDBA', '#F7A893'] },
  apricot: { ru: 'абрикосовый (светлее)', de: 'Aprikose', colors: ['#FCD8AC', '#F3B77D', '#FFF9F2', '#F2B079', '#DA9658', '#FDE7CF', '#F6B2A0'] },
};
export const BK_COAT_IDS: readonly BkCoat[] = ['ginger', 'apricot'];

// ---------- small geometry (absolute M / C / Z only) ----------

export const f = (v: number) => String(Math.round(v * 100) / 100);

function wrap(pts: readonly Pt[], i: number): Pt {
  const n = pts.length;
  return pts[((i % n) + n) % n] as Pt;
}

/** The cubic Bézier controls of a closed Catmull-Rom spline through `pts` (segment i: pts[i] -> pts[i+1]). */
function segments(pts: readonly Pt[]): Array<[Pt, Pt, Pt, Pt]> {
  return pts.map((_, i) => {
    const [p0, p1, p2, p3] = [wrap(pts, i - 1), wrap(pts, i), wrap(pts, i + 1), wrap(pts, i + 2)];
    return [p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2];
  });
}

/** A soft closed shape through key points. */
export function smooth(pts: readonly Pt[]): string {
  const s = wrap(pts, 0);
  return `M${f(s[0])} ${f(s[1])}${segments(pts).map(([, a, b, e]) => ` C${f(a[0])} ${f(a[1])} ${f(b[0])} ${f(b[1])} ${f(e[0])} ${f(e[1])}`).join('')} Z`;
}

/** Points along that closed shape (bounds checks in the tests). */
export function sample(pts: readonly Pt[], k = 10): Pt[] {
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

/** An open soft line through points (ends clamped): the contour of fluff that sticks out. */
export function line(pts: readonly Pt[]): string {
  const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))] as Pt;
  let d = `M${f(at(0)[0])} ${f(at(0)[1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** Points of an ellipse (centre, radii, rotation in degrees), `n` of them, clockwise from the right. */
export function ellPts(cx: number, cy: number, rx: number, ry: number, rot = 0, n = 16): Pt[] {
  const r = (rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return Array.from({ length: n }, (_, i): Pt => {
    const a = (i / n) * Math.PI * 2;
    const x = rx * Math.cos(a);
    const y = ry * Math.sin(a);
    return [cx + x * c - y * s, cy + x * s + y * c];
  });
}

export const mirror = (pts: readonly Pt[]): Pt[] => pts.map(([x, y]): Pt => [-x, y]);

// ---------- the silhouette: a loaf ----------

/**
 * Right half of his outline, top to bottom: a round dome of a head (top -150) that flows straight into a round,
 * low body — a potato / loaf, widest in the middle (±75.5 at y -47), not a bell; no neck, no waist; the bottom rounds
 * in so his big hind feet peek out under it.
 */
const SIDE_R: readonly Pt[] = [
  [15, -149.6], [34, -145.4], [50, -136], [61, -121], [67, -103], [70, -85],
  [73.4, -66], [75.5, -47], [74.2, -28], [68.4, -12.4], [56, -3.4], [34, -0.6], [12, -0.1],
];
export const BK_BODY_PTS: readonly Pt[] = [...SIDE_R, ...mirror(SIDE_R).reverse()];
export const BK_BODY = smooth(BK_BODY_PTS);

/** The face sits this much lower than Pompon's (his head is 13 units lower; big forehead, baby schema). */
export const FACE_DY = 5;
/** Eyes before FACE_DY (Pompon: ±29, -93, 6.2 × 7.4): bigger and a little wider apart — a rabbit's eyes are on the sides. */
export const BK_EYE = { x: 29.5, y: -92.5, rx: 8.2, ry: 9.4 } as const;

// ---------- ears ----------

/** Ear roots (pivots): close together, hidden behind the top of the head. */
export const EAR_ROOT: Pt = [-13, -141];

export interface EarShape {
  /** outer shape (gets the contour) */
  outer: Pt[];
  /** the pink inside */
  inner: Pt[];
  /** C: the folded-over tip (the back of the ear, a shade darker) */
  flap?: Pt[];
  /** C: the fold line */
  crease?: Pt[];
  /** the light fluffy tuft at the bottom of the pink */
  tuft: Pt[];
}

/** C: the joint of the floppy tip (left ear; the right one is mirrored). */
const BENT_JOINT: Pt = [-16.6, -164];

/** Left ear of each variant (the right one is mirrored). */
export function earShape(v: EarVariant): EarShape {
  switch (v) {
    case 'a':
      // tiny round nubs: barely taller than wide, ≈ 17 units over the head
      return {
        outer: ellPts(-15, -154, 11.4, 15.2, -12),
        inner: ellPts(-15, -153.4, 5.9, 9.8, -12),
        tuft: [[-18.4, -145.6], [-17.6, -149.6], [-15.2, -150.6], [-12.8, -149.4], [-11.6, -145.6]],
      };
    case 'b':
      // slightly longer soft ovals: the photo's proportion (≈ 30 units over the head, a third of his head)
      return {
        outer: ellPts(-15.6, -160, 11.6, 21.5, -10),
        inner: ellPts(-15.6, -158.6, 6.2, 14.6, -10),
        tuft: [[-19.4, -145.4], [-18.6, -150.6], [-16.4, -152.6], [-13.8, -151.8], [-12.2, -148.6], [-11.8, -145]],
      };
    case 'c': {
      // B's soft oval, but its top part is FLOPPED outward at a joint (one floppy tip, like the package's surprise ear):
      // the lower part ends in a dome round the joint, the tip starts with one, so the tip turns about the joint
      // without a gap; the pink only on the lower part, the tip shows the back of the ear (a touch darker)
      const [jx, jy] = BENT_JOINT;
      const r = 10.4;
      const dome = (from: number, to: number, n: number, rr = r): Pt[] =>
        Array.from({ length: n + 1 }, (_, i) => {
          const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
          return [jx + rr * Math.cos(a), jy + rr * Math.sin(a)] as Pt;
        });
      const lower: Pt[] = [[-6.6, -151], [-7.8, -143], [-11.6, -138.4], [-16.4, -137.2], [-21.2, -138.6], [-25, -143.4], [-26.4, -151], [-26.6, -158.6], ...dome(180, 360, 6)];
      const tipUp: Pt[] = [...dome(0, 180, 6), [-26.2, -172], [-23.4, -178.6], [-18, -181.6], [-12.4, -180.6], [-8.4, -176], [-6.6, -170]];
      const rot = (pts: readonly Pt[], deg: number): Pt[] => {
        const a = (deg * Math.PI) / 180;
        return pts.map(([x, y]): Pt => [jx + (x - jx) * Math.cos(a) - (y - jy) * Math.sin(a), jy + (x - jx) * Math.sin(a) + (y - jy) * Math.cos(a)]);
      };
      return {
        outer: lower,
        inner: ellPts(-16.4, -152.6, 6, 10.2),
        flap: rot(tipUp, -52),
        tuft: [[-19.4, -145.4], [-18.6, -150.6], [-16.4, -152.6], [-13.8, -151.8], [-12.2, -148.6], [-11.8, -145]],
      };
    }
  }
}

/** Highest point of the ears of a variant (y, bunny units). */
export function earTop(v: EarVariant): number {
  const e = earShape(v);
  return Math.min(...[...sample(e.outer), ...(e.flap ? sample(e.flap) : [])].map((p) => p[1]));
}

function earMarkup(v: EarVariant, side: 'l' | 'r'): string {
  const e = earShape(v);
  const m = (pts: readonly Pt[]) => (side === 'l' ? pts : mirror(pts));
  // C folds only the RIGHT ear's tip (a living animal is never quite symmetric); the left one is B's soft oval
  if (v === 'c' && side === 'l') return earMarkup('b', 'l');
  let s = `<path d="${smooth(m(e.outer))}" fill="var(--mascot-accent)"/>`;
  s += `<path d="${smooth(m(e.inner))}" fill="var(--mascot-ear-in)"/>`;
  s += `<path class="bk-tuft" d="${smooth(m(e.tuft))}" fill="var(--mascot-belly)" opacity=".85"/>`;
  if (e.flap) {
    // the back of the bent tip: the same fur as the ear, only a touch darker (never a separate "cap")
    s += `<path class="bk-flap bk-outl" d="${smooth(m(e.flap))}" fill="var(--mascot-accent)"/>`;
    s += `<path class="bk-flap-shade" d="${smooth(m(e.flap))}" fill="var(--mascot-accent-dark)" opacity=".16"/>`;
    if (e.crease) s += `<path class="bk-ln bk-crease" d="${line(m(e.crease))}"/>`;
  }
  return s;
}

// ---------- cheeks, tail ----------

/** Fluffy cheeks (photo 3): two soft round tufts on the cheek's outer lower edge — fluff, not whiskers; right cheek,
 *  the left one mirrored. */
const CHEEK_C: Pt = [63, -80];
export const CHEEK_FLUFF: readonly Pt[] = [[58, -90], [69, -95], [76.4, -88.6], [80.6, -81.6], [78.8, -76.2], [80.2, -70.2], [74.6, -64.6], [65, -62], [56.6, -70]];

/** The white fluffy tail (photo 2): a little cloud at the side of his bottom; shows in the 3/4 turn and the binky. */
export function tailCloud(cx: number, cy: number, r: number): string {
  // a round puff with six tiny soft lobes (enough points that the spline stays round, never a polygon)
  const pts: Pt[] = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.035 * Math.cos(6 * a + 0.6);
    pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return smooth(pts);
}
export const TAIL = { x: 80, y: -27, r: 12 } as const;

// ---------- reshaping the puppet ----------

const SVG_NS = 'http://www.w3.org/2000/svg';

function attrs(el: Element | null | undefined, values: Record<string, number | string>): void {
  if (!el) return;
  for (const [k, v] of Object.entries(values)) el.setAttribute(k, typeof v === 'number' ? f(v) : v);
}

/** Scoped to this puppet: ear pivots at their roots, the fluff contours. */
const KIT_CSS = `
.bk .up .ear-l { transform-box: view-box; transform-origin: ${EAR_ROOT[0]}px ${EAR_ROOT[1]}px; }
.bk .up .ear-r { transform-box: view-box; transform-origin: ${-EAR_ROOT[0]}px ${EAR_ROOT[1]}px; }
.bk-ln { fill: none; stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round; }
.bk-outl { stroke: var(--mascot-outline, rgba(150,90,40,.28)); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke; paint-order: stroke fill; }
/* his sniff (the approved alert): the tiny ears turn more than the package's long upright ones, or nobody sees it */
.bk .ears-up.lift-r .ear-r { transform: rotate(17deg); }
.bk .ears-up.lift-r .ear-l { transform: rotate(-7deg); }
.bk-crease { stroke: var(--mascot-accent-dark); stroke-opacity: .55; stroke-width: 1.2px; }
`;

const eyeStar = (x: number, y: number) =>
  `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(BK_EYE.rx + 0.5)}" ry="${f(BK_EYE.ry + 0.5)}" fill="var(--mascot-eye)"/><path d="${star(x + 2.2, y - 2.7, 4.4, 1.4, 4)}" fill="#fff"/><circle cx="${f(x - 3)}" cy="${f(y + 3.4)}" r="1.1" fill="#fff" opacity=".85"/>`;

/**
 * Reshapes a mounted bunny puppet (its <svg>: a Bunny's, a welcome-stage actor's, or our own BinkyShow's) into the
 * binky bunny with ears `ears`. Ears are chosen when he is drawn (never an animated shape change). Idempotent; a second
 * call only swaps the ears.
 */
export function applyBinkyKit(svg: SVGSVGElement, ears: EarVariant = 'b'): void {
  const hm = svg.querySelector('.hm');
  if (!hm) return;
  // the scope class sits on the <svg>: a Bunny's resetPose() clears every other class of `.hm` but its ears-*
  svg.classList.add('bk');
  hm.classList.add('ears-up');
  hm.classList.remove('ears-lop');
  hm.setAttribute('data-bk-ears', ears);
  const gBodyId = svg.querySelector('linearGradient[id$="g-body"]')?.id;
  const gBody = gBodyId ? `url(#${gBodyId})` : 'var(--mascot-base-top)';
  const earL = svg.querySelector('.up .ear-l');
  const earR = svg.querySelector('.up .ear-r');
  if (earL) earL.innerHTML = earMarkup(ears, 'l');
  if (earR) earR.innerHTML = earMarkup(ears, 'r');
  if (svg.dataset['bk'] === '1') return;
  svg.dataset['bk'] = '1';

  const defs = svg.querySelector('defs');
  if (defs && !defs.querySelector('style.bk-css')) {
    const style = document.createElementNS(SVG_NS, 'style');
    style.setAttribute('class', 'bk-css');
    style.textContent = KIT_CSS;
    defs.append(style);
  }

  // the loaf (+ the broken coat's clip: the same outline)
  for (const p of svg.querySelectorAll('.breathe > path, clipPath path')) p.setAttribute('d', BK_BODY);
  // a light underside, lower and a little smaller than Pompon's belly
  for (const e of svg.querySelectorAll('ellipse[cy="-46"][rx="56"]')) attrs(e, { cy: -32, rx: 50, ry: 34 });
  attrs(svg.querySelector('radialGradient[id$="g-belly"]'), { cy: -30, r: 50 });

  // cheeks a little lower and inside, with fluff along their outer edge (inside .cheek-j: it puffs and chews with them)
  svg.querySelectorAll('.cheek-j').forEach((g, i) => {
    const s = i ? 1 : -1;
    attrs(g.querySelector('ellipse'), { cx: s * CHEEK_C[0], cy: CHEEK_C[1], rx: 13, ry: 19.5 });
    const pts = s > 0 ? CHEEK_FLUFF : mirror(CHEEK_FLUFF);
    g.insertAdjacentHTML('beforeend', `<path class="bk-fluff" d="${smooth(pts)}" fill="${gBody}"/>`);
  });

  // blush a touch rounder; then the whole face moves down FACE_DY in one wrapper (the 3/4 turn and the glances
  // still move .tf / .face themselves)
  svg.querySelectorAll('.tf > ellipse').forEach((e, i) => attrs(e, { cx: i ? 44 : -44, cy: -76.5, rx: 9.6, ry: 5.9, opacity: 0.34 }));
  const tf = svg.querySelector('.tf');
  if (tf && !Array.from(tf.children).some((c) => c.classList.contains('bk-face'))) {
    const w = document.createElementNS(SVG_NS, 'g');
    w.setAttribute('class', 'bk-face');
    w.setAttribute('transform', `translate(0 ${FACE_DY})`);
    while (tf.firstChild) w.append(tf.firstChild);
    tf.append(w);
  }

  // big dark eyes with our highlights; star, happy, sleep eyes and brows follow them
  for (const g of svg.querySelectorAll('.eyes .eye')) {
    const [eye, hi, lo] = [...g.children];
    const x = (Number(eye?.getAttribute('cx') ?? '0') < 0 ? -1 : 1) * BK_EYE.x;
    const y = BK_EYE.y;
    attrs(eye, { cx: x, cy: y, rx: BK_EYE.rx, ry: BK_EYE.ry });
    attrs(hi, { cx: x + 2.8, cy: y - 3.4, r: 2.6 });
    attrs(lo, { cx: x - 2.8, cy: y + 3.9, r: 1.1 });
  }
  const st = svg.querySelector('.eyes-star');
  if (st) st.innerHTML = eyeStar(-BK_EYE.x, BK_EYE.y) + eyeStar(BK_EYE.x, BK_EYE.y);
  svg.querySelector('.eyes-happy')?.querySelectorAll('path').forEach((p, i) => {
    const x = (i ? 1 : -1) * BK_EYE.x;
    p.setAttribute('d', `M${f(x - 7.4)} ${f(BK_EYE.y + 2)} Q${f(x)} ${f(BK_EYE.y - 7)} ${f(x + 7.4)} ${f(BK_EYE.y + 2)}`);
  });
  svg.querySelector('.eyes-sleep')?.querySelectorAll('path').forEach((p, i) => {
    const x = (i ? 1 : -1) * BK_EYE.x;
    p.setAttribute('d', `M${f(x - 7)} ${f(BK_EYE.y)} Q${f(x)} ${f(BK_EYE.y + 6)} ${f(x + 7)} ${f(BK_EYE.y)}`);
  });

  // a puffy white muzzle (the photo's pale muzzle tip)
  svg.querySelectorAll('.face > ellipse:not(.mouth-open)').forEach((e, i) => attrs(e, { cx: i ? 5.6 : -5.6, cy: -76, rx: 7, ry: 5.3, opacity: 1 }));

  // light front paws, a little smaller (tucked under the chest of a loaf); big soft hind feet a little wider apart
  svg.querySelectorAll('.paws .paw').forEach((g, i) => {
    const s = i ? 1 : -1;
    attrs(g.querySelector('ellipse'), { cx: s * 15, cy: -38.5, rx: 8.8, ry: 10.6, transform: `rotate(${s * 22} ${s * 15} -38.5)` });
    attrs(g.querySelector('path'), { d: `M${f(s * 13.6)} -32.6 l${f(-s * 1.5)} 1.9 M${f(s * 11.2)} -33.8 l${f(-s * 1.5)} 1.9` });
  });
  svg.querySelectorAll('.tfoot .foot').forEach((g, i) => attrs(g.querySelector('ellipse'), { cx: (i ? 1 : -1) * 44, cy: -4, rx: 19.5, ry: 7.2 }));

  // the white fluffy tail
  svg.querySelectorAll('.tail').forEach((g) => {
    const s = g.classList.contains('tail-r') ? 1 : -1;
    g.innerHTML = `<path d="${tailCloud(s * TAIL.x, TAIL.y, TAIL.r)}" fill="var(--mascot-belly)"/>`;
  });
  attrs(svg.querySelector('.shadow'), { rx: 80, ry: 7 });
}

/** Sets his colours on a puppet host (a Bunny's host or a stage actor's host): custom properties, no pattern. */
export function paintBinky(host: HTMLElement, coat: BkCoat = 'ginger', hm?: Element | null): void {
  BK_COATS[coat].colors.forEach((v, i) => host.style.setProperty(COAT_VAR_NAMES[i] as string, v));
  hm?.classList.remove('pat-points', 'pat-broken');
}
