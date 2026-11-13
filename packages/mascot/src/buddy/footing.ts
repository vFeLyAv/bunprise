/**
 * «Твёрдая почва» (idea 1.9 of docs/ideas/2026-10-26-mascot-ideas.md; Felix 26.10 «нравится», in the app since 27.10
 * as ListsBuddy option `footing`) — the pure part: no DOM, no timers, deterministic (moved from the gallery's
 * demo/firmground/moment.ts; the DOM side is in buddy.ts). Pompon is set down softly near the rounded end of a card: he touches the
 * surface with ONE foot (the one on the edge side), shifts his weight away from the edge and takes one small
 * step inward. 1.2 s; at most once per 20 s; reduced motion = straight to the safe spot.
 *
 * Coordinates: CSS px of the buddy's stage (y grows downwards) for the world, mascot units for the puppet's
 * parts (x = 0 centre line, y = 0 foot line; bunny.ts). `poseAt(plan, t)` is a pure function of time, so a
 * frozen frame, the contact sheet and the live playback show exactly the same picture.
 *
 * Exact contact: a touching or planted foot is the puppet's foot ellipse resting on the card's outline the way a
 * standing foot rests on the flat top (it sinks 2.8 units, like in bunny.ts) — on the rounding the foot turns
 * with the outline and touches it tangentially (an ellipse outside a convex shape: one contact point, never
 * inside). No sliding: a foot moves only while it is lifted; the body moves over planted feet.
 */

import { easing } from '../timeline';

/** The moment itself (s). */
export const DURATION = 1.2;
/** After the moment: the body's spring tail and the happy eyes run out, then the new spot is committed (s). */
export const HOLD = 0.4;
/** At most once per 20 s (real drops; the gallery buttons may force it). */
export const COOLDOWN_MS = 20000;

/** The bunny puppet in mascot units (bunny.ts markup: `.tfoot-l/-r` ellipses, `.hm` scale 1.2 in a 400 px viewBox). */
export const BUNNY = {
  scale: 1.2,
  /** foot ellipse centres at x = ±38, y = -4 */
  footX: 38,
  footCy: -4,
  /** foot ellipse radii */
  footA: 18,
  footB: 6.8,
} as const;

/** How far below the walking line a standing foot's sole goes (its ellipse bottom: -4 + 6.8). */
const SINK_U = BUNNY.footCy + BUNNY.footB;

/** px per mascot unit for a puppet box `width` px wide. */
export function unitPx(width: number): number {
  return (BUNNY.scale * width) / 400;
}

// ---------- the app's motion vocabulary (tokens.css §motion, design-system-motion.md §2) ----------

/** The app's three springs (mass 1). Only these. */
export const SPRINGS = {
  snappy: { stiffness: 630, damping: 43 },
  smooth: { stiffness: 250, damping: 28 },
  bouncy: { stiffness: 400, damping: 20 },
} as const;
export type SpringName = keyof typeof SPRINGS;

/** Step response of a spring (0 → 1), analytic (all three are under-damped). */
export function springStep(name: SpringName, t: number): number {
  if (t <= 0) return 0;
  const { stiffness: k, damping: c } = SPRINGS[name];
  const w0 = Math.sqrt(k);
  const z = c / (2 * w0);
  const wd = w0 * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
}

/** Impulse response of a spring, scaled to peak 1: a landing squash that rises and springs back (0 at t = 0). */
export function springKick(name: SpringName, t: number): number {
  if (t <= 0) return 0;
  const { stiffness: k, damping: c } = SPRINGS[name];
  const w0 = Math.sqrt(k);
  const z = c / (2 * w0);
  const wd = w0 * Math.sqrt(1 - z * z);
  const peakT = Math.atan(wd / (z * w0)) / wd;
  const f = (s: number) => Math.exp(-z * w0 * s) * Math.sin(wd * s);
  return f(t) / f(peakT);
}

/** tokens.css --ease-in-out: feet travel with it (they arrive without overshoot: a planted foot never slides). */
const EASE_IN_OUT = easing('cubic-bezier(.45,0,.2,1)');
/** The puppet's own face-glance curve (bunny.ts `.face` transition). */
const EASE_FACE = easing('cubic-bezier(.25,.8,.3,1)');

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const DEG = 180 / Math.PI;

// ---------- the floor and its rounded ends ----------

/** A floor as the eye sees it: the walking line and the card's top corner radii (px). */
export interface FloorShape {
  id: string;
  y: number;
  x0: number;
  x1: number;
  /** radius of the top-left / top-right corner */
  rL: number;
  rR: number;
}

/** y of the card's top outline at x (the rounded corners included); Infinity beside the card. */
export function outlineY(f: FloorShape, x: number): number {
  if (x < f.x0 || x > f.x1) return Infinity;
  if (x < f.x0 + f.rL) {
    const dx = f.x0 + f.rL - x;
    return f.y + f.rL - Math.sqrt(Math.max(0, f.rL * f.rL - dx * dx));
  }
  if (x > f.x1 - f.rR) {
    const dx = x - (f.x1 - f.rR);
    return f.y + f.rR - Math.sqrt(Math.max(0, f.rR * f.rR - dx * dx));
  }
  return f.y;
}

/**
 * Signed gap between a point and the card's outline pushed in by `sink` (where a sole rests): > 0 outside
 * (above the flat top, or outside the rounding), < 0 inside the card.
 */
export function gapToSurface(f: FloorShape, x: number, y: number, sink: number): number {
  const left = x < f.x0 + f.rL;
  const right = x > f.x1 - f.rR;
  if ((left && f.rL > 0) || (right && f.rR > 0)) {
    const r = left ? f.rL : f.rR;
    const cx = left ? f.x0 + r : f.x1 - r;
    const cy = f.y + r;
    // below the corner's centre the side wall decides (a sole never gets there)
    if (y > cy) return left ? f.x0 + sink - x : x - (f.x1 - sink);
    return Math.hypot(x - cx, y - cy) - Math.max(0, r - sink);
  }
  return f.y + sink - y;
}

// ---------- when ----------

export interface Edge {
  /** -1 = the floor's left end, 1 = its right end */
  side: -1 | 1;
  radius: number;
  /** px between his feet point and that end */
  gap: number;
}

/**
 * Near an end: the outer foot's toe reaches within half a foot of where the card starts to round (or past it).
 * In the middle of a card — null, nothing happens.
 */
export function nearEdge(f: FloorShape, feetX: number, width: number): Edge | null {
  const u = unitPx(width);
  const reach = BUNNY.footX * u + 1.5 * BUNNY.footA * u;
  const found: Edge[] = [];
  const left = feetX - f.x0;
  const right = f.x1 - feetX;
  if (left >= 0 && left < f.rL + reach) found.push({ side: -1, radius: f.rL, gap: left });
  if (right >= 0 && right < f.rR + reach) found.push({ side: 1, radius: f.rR, gap: right });
  found.sort((p, q) => p.gap - p.radius - (q.gap - q.radius));
  return found[0] ?? null;
}

/** Whether the 20 s pause allows the moment now. */
export function allowed(lastAt: number, now: number): boolean {
  return now - lastAt >= COOLDOWN_MS;
}

// ---------- the plan ----------

/** A foot: centre (world px) + CSS rotation (deg, clockwise). */
export interface FootAt {
  x: number;
  y: number;
  r: number;
}

export interface Plan {
  /** the edge side (-1 left end, 1 right end) and the way in */
  side: -1 | 1;
  dir: -1 | 1;
  /** his feet point at landing (px) */
  x: number;
  y: number;
  /** px per mascot unit */
  u: number;
  /** how far he ends up inside (px, along dir) */
  step: number;
  /** the outer foot at the touch (world px, deg) */
  touch: FootAt;
  /** how far round the corner the touch is (rad; 0 = on the flat top) */
  phi: number;
  floor: FloorShape;
}

/** Furthest round the corner a foot may follow it (more would mean a stretched leg). */
export const PHI_MAX = (25 * Math.PI) / 180;
/**
 * The outer foot reaches this far out to feel the edge (units). 27.10 (Felix approved, the doc's question 3: "at 96 px
 * the touch is ≈ 2 px"): 8 → 12, and the foot lifts higher on its way (TOUCH_LIFT_U) — the touch reads at 96 px.
 */
export const REACH_U = 12;
/** How high the touching foot lifts on its way out (units; the gallery prototype: 6). */
export const TOUCH_LIFT_U = 10;
/**
 * The weight shift (27.10, a little clearer than the gallery prototype): the body moves this far away from the edge
 * before the step (units; was 3), leans towards the edge to peek and away from it to shift (deg; were 2 and 4).
 */
export const LEAN = { shift: 4.5, peek: 3, away: 6 } as const;
/** The "oh!" (27.10): a small flinch of the body (units up, stretch) and wider eyes (the rig's .bd-oh) — was the eyes only. */
export const FLINCH = { up: 2.2, stretch: 0.03 } as const;
/** The step, in units: never less (it is a step), never more (the feet would cross). */
const STEP_MIN_U = 14;
const STEP_MAX_U = 40;
/** Where he feels safe: the outer toe no further than ¾ of a foot past the start of the rounding. */
const COMFORT = 0.25;

/** Where the touching foot can rest on the outline near `cx` (centre x): centre y, rotation and corner angle. */
function restOnOutline(f: FloorShape, side: -1 | 1, cx: number, u: number): { y: number; r: number; phi: number } {
  const b = BUNNY.footB * u;
  const sink = SINK_U * u;
  const R = side < 0 ? f.rL : f.rR;
  const start = side < 0 ? f.x0 + R : f.x1 - R;
  const into = side * (cx - start);
  if (into <= 0 || R <= 0) return { y: f.y + sink - b, r: 0, phi: 0 };
  const reach = Math.max(0, R - sink) + b;
  const phi = Math.asin(clamp(into / reach, 0, 1));
  return { y: f.y + R - reach * Math.cos(phi), r: side * phi * DEG, phi };
}

/** Plans the moment for a landing at `feetX` near `edge` of floor `f`, for a puppet `width` px wide. */
export function plan(f: FloorShape, feetX: number, width: number, edge: Edge): Plan {
  const u = unitPx(width);
  const e = edge.side;
  const d = (-e) as -1 | 1;
  const F = BUNNY.footX * u;
  const a = BUNNY.footA * u;
  const b = BUNNY.footB * u;
  const sink = SINK_U * u;
  const R = edge.radius;
  const start = e < 0 ? f.x0 + R : f.x1 - R;
  // the touch: a little out from where the foot is, never further round than PHI_MAX (then it reaches in)
  const limit = start + e * (Math.max(0, R - sink) + b) * Math.sin(PHI_MAX);
  let cx = feetX + e * (F + REACH_U * u);
  if (e * (cx - limit) > 0) cx = limit;
  const rest = restOnOutline(f, e, cx, u);
  // the step: the outer foot to where it is comfortable, within one small step
  const want = e * (feetX - start) + F + COMFORT * a;
  const room = Math.max(0, (e < 0 ? f.x1 - feetX : feetX - f.x0) - F - a - 4 * u);
  const step = Math.min(clamp(want, STEP_MIN_U * u, STEP_MAX_U * u), room);
  return { side: e, dir: d, x: feetX, y: f.y, u, step, touch: { x: cx, y: rest.y, r: rest.r }, phi: rest.phi, floor: f };
}

/** Where to set him down so his touch lands `phi` (rad) round the corner — the gallery's reproducible drops. */
export function feetForTouch(f: FloorShape, side: -1 | 1, phi: number, width: number): number {
  const u = unitPx(width);
  const R = side < 0 ? f.rL : f.rR;
  const start = side < 0 ? f.x0 + R : f.x1 - R;
  const cx = start + side * (Math.max(0, R - SINK_U * u) + BUNNY.footB * u) * Math.sin(phi);
  return cx - side * (BUNNY.footX + REACH_U) * u;
}

/** The spot he ends up on (px): reduced motion goes straight there. */
export function safeX(p: Plan): number {
  return p.x + p.dir * p.step;
}

// ---------- the pose at time t ----------

/** A puppet part relative to its rest pose: translate in units, rotation in deg (CSS, clockwise). */
export interface PartPose {
  x: number;
  y: number;
  r: number;
}

export interface Pose {
  /** the foot on the edge side (`.tfoot-l` for a left end) and the other one */
  outer: PartPose;
  inner: PartPose;
  /** the body group above the feet (`.body`, pivot = its bottom centre) */
  body: PartPose & { sx: number; sy: number };
  /** the floor shadow under him follows his body */
  shadowX: number;
  /** face shift (units, like BuddyRig.look) */
  look: { x: number; y: number };
  eyes: 'normal' | 'happy';
  /** a short "oh!" — wider eyes (the rig's `.bd-oh`, a little wider than the puppet's own startle) */
  startle: boolean;
}

/** Beat times (s). */
export const BEATS = {
  look: 0.06,
  touch: [0.08, 0.38] as const,
  peek: 0.1,
  startle: [0.38, 0.58] as const,
  shift: 0.4,
  lookIn: 0.46,
  rise: 0.54,
  step1: [0.6, 0.84] as const,
  travel: 0.8,
  step2: [0.94, 1.14] as const,
  upright: 0.98,
  happy: 1.0,
  settle: 1.04,
} as const;

/** Lift a foot, carry it, set it down: up first, sideways (and turning) in the middle, down last. */
function footMove(from: PartPose, to: PartPose, span: readonly [number, number], lift: number, t: number): PartPose {
  if (t <= span[0]) return from;
  if (t >= span[1]) return to;
  const p = (t - span[0]) / (span[1] - span[0]);
  const q = EASE_IN_OUT(clamp((p - 0.12) / 0.76, 0, 1));
  const up = lift * Math.sin(Math.PI * p);
  return { x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q - up, r: from.r + (to.r - from.r) * q };
}

/** A value made of spring moves: each starts at its time and adds its delta. */
function springs(moves: readonly (readonly [number, number, SpringName])[], t: number): number {
  let v = 0;
  for (const [at, delta, s] of moves) v += delta * springStep(s, t - at);
  return v;
}

/** Glances: hold, then move to the next target with the face curve in `ms`. */
function glance(keys: readonly (readonly [number, number, number])[], t: number, dur = 0.3): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const [at, kx, ky] of keys) {
    if (t <= at) break;
    const k = EASE_FACE(clamp((t - at) / dur, 0, 1));
    x += (kx - x) * k;
    y += (ky - y) * k;
  }
  return { x, y };
}

/** The touching foot's rest-relative pose (units, deg). */
export function touchPose(p: Plan): PartPose {
  const restX = p.x + p.side * BUNNY.footX * p.u;
  const restY = p.y + BUNNY.footCy * p.u;
  return { x: (p.touch.x - restX) / p.u, y: (p.touch.y - restY) / p.u, r: p.touch.r };
}

/** The whole puppet at time t (0 = the landing frame; ≥ DURATION + HOLD = the end, ready to commit). */
export function poseAt(p: Plan, t: number): Pose {
  const e = p.side;
  const d = p.dir;
  const S = p.step / p.u;
  const zero: PartPose = { x: 0, y: 0, r: 0 };
  const touch = touchPose(p);
  const end: PartPose = { x: d * S, y: 0, r: 0 };

  const outer = t < BEATS.step1[0] ? footMove(zero, touch, BEATS.touch, TOUCH_LIFT_U, t) : footMove(touch, end, BEATS.step1, 3.5, t);
  const inner = footMove(zero, end, BEATS.step2, 3, t);

  // weight: a peek towards the edge (a lean; only the inner foot carries him), then away from it — the lean lifts
  // the edge side of his bottom off the card. For the step he rises a little on his feet (his round bottom sits on
  // the card: moving it sideways there would look like sliding), carries the body over the new footing in the air
  // and sits back down onto both planted feet.
  const W = LEAN.shift;
  const bx = springs([[BEATS.shift, d * W, 'smooth'], [BEATS.travel, d * (S - W), 'smooth']], t);
  // the "oh!": a small flinch up (a spring kick, 0 at its start: no pop), then the shift
  const flinch = springKick('snappy', t - BEATS.startle[0]);
  const by = springs([[BEATS.shift, -1.5, 'smooth'], [BEATS.rise, -5, 'smooth'], [BEATS.settle, 6.5, 'smooth']], t) - FLINCH.up * flinch;
  const br = springs([[BEATS.peek, e * LEAN.peek, 'smooth'], [BEATS.shift, d * LEAN.away - e * LEAN.peek, 'smooth'], [BEATS.upright, -d * LEAN.away, 'snappy']], t);
  // the soft landing and sitting back down: the body settles on its feet (bouncy)
  const kick = springKick('bouncy', t) * (t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.2));
  const sit = springKick('bouncy', t - (BEATS.settle + 0.1));
  const body = { x: bx, y: by, r: br, sx: 1 + 0.04 * kick + 0.025 * sit - 0.5 * FLINCH.stretch * flinch, sy: 1 - 0.06 * kick - 0.035 * sit + FLINCH.stretch * flinch };

  const look = glance([[BEATS.look, e * 3, 2.8], [BEATS.lookIn, d * 2.6, -0.3], [BEATS.happy, 0, 0]], t);
  // the springs' last hundredths of a pixel ease into the exact end pose, so the hand-over to the engine is exact
  const k = clamp((t - (DURATION + HOLD - 0.2)) / 0.2, 0, 1);
  const s = k * k * (3 - 2 * k);
  const to = (v: number, end: number) => v + (end - v) * s;
  body.x = to(body.x, d * S);
  body.y = to(body.y, 0);
  body.r = to(body.r, 0);
  body.sx = to(body.sx, 1);
  body.sy = to(body.sy, 1);
  return {
    outer,
    inner,
    body,
    shadowX: body.x,
    look: { x: to(look.x, 0), y: to(look.y, 0) },
    eyes: t >= BEATS.happy ? 'happy' : 'normal',
    startle: t >= BEATS.startle[0] && t < BEATS.startle[1],
  };
}

/** The final pose (everything at rest, the body over the new spot) — what the commit turns into "standing at safeX". */
export function endPose(p: Plan): Pose {
  const S = (p.dir * p.step) / p.u;
  return {
    outer: { x: S, y: 0, r: 0 },
    inner: { x: S, y: 0, r: 0 },
    body: { x: S, y: 0, r: 0, sx: 1, sy: 1 },
    shadowX: S,
    look: { x: 0, y: 0 },
    eyes: 'happy',
    startle: false,
  };
}

// ---------- world geometry (tests, the gallery's guides) ----------

/** A foot of the pose in the world: centre (px) and rotation (deg). */
export function footWorld(p: Plan, which: 'outer' | 'inner', pose: Pose): FootAt {
  const side = which === 'outer' ? p.side : p.dir;
  const part = which === 'outer' ? pose.outer : pose.inner;
  return { x: p.x + (side * BUNNY.footX + part.x) * p.u, y: p.y + (BUNNY.footCy + part.y) * p.u, r: part.r };
}

/** Points of a foot ellipse in the world (for gap checks). */
export function footOutline(f: FootAt, u: number, n = 180): { x: number; y: number }[] {
  const a = BUNNY.footA * u;
  const b = BUNNY.footB * u;
  const c = Math.cos(f.r / DEG);
  const s = Math.sin(f.r / DEG);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const lx = a * Math.cos(t);
    const ly = b * Math.sin(t);
    pts.push({ x: f.x + lx * c - ly * s, y: f.y + lx * s + ly * c });
  }
  return pts;
}

/** Smallest gap between a foot and the surface it would rest on (px; 0 = touching like a standing foot). */
export function footGap(p: Plan, f: FootAt): number {
  const sink = SINK_U * p.u;
  let min = Infinity;
  for (const q of footOutline(f, p.u)) {
    if (q.x < p.floor.x0 - 0.01 || q.x > p.floor.x1 + 0.01) continue;
    min = Math.min(min, gapToSurface(p.floor, q.x, q.y, sink));
  }
  return min;
}
