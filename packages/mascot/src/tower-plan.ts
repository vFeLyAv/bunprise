/**
 * «Парад» v2 — «Бременская башня» (approved by Felix 26.10, in the app since 27.10: the Profil easter egg): the pure
 * choreography, no DOM.
 *
 * The friends hop in from alternating sides and jump onto each other's heads (broken at the bottom, then chocolate,
 * then himalayan); every landing squashes everybody below it, a little later the lower it is (the push travels
 * down). Pompon comes last, looks up at the tower, takes a big leap to the top, turns to you with star eyes and does
 * a binky (the rabbit joy jump with a twist). He lands a little off-centre — the tower tips over its bottom
 * bunny's foot, and the four bail out top-down in alternating directions, land and hop off.
 *
 * Everything that places a bunny (feet position, lean, squash) is ONE function of time, poseAt(): the stacked
 * bunnies stand on the head of the one below — they follow its squash and lean exactly, because their pose is
 * computed from it. The stage samples poseAt() into keyframes (bake()); the puppet's own parts (ears, feet, eyes,
 * the approved hop cycle on the ground) are authored keys on top of it (tower-actor.ts).
 *
 * Units: host px; "units" = bunny units (the mascot's coordinates: feet at 0, top of the head at -163).
 */

import { easing } from './timeline';
import type { Hop } from './welcome-actors';
import type { BunnyCoat } from './types';

/** The edge strip: the stage reaches this many px below the card's top edge (WelcomeStage edgeInset). */
export const EDGE_INSET = 16;
/** Stage height (px): the tower and Pompon's binky above it fit (≈ 310 px of bunnies on a 390 px phone). */
export const HOST_H = 390;
/** Outline half-width of a bunny (ears / cheeks, units). */
export const HALF_WIDTH = 80;
/** The upper bunny's feet stand this far above the lower one's feet (units of the lower one): on the crown of its head, between the ear bases. */
export const STACK = 160;
/** The bottom bunny's feet edge (units from its centre): the tower tips over it. */
export const FOOT_EDGE = 50;
/** Top of the head incl. the ear bases (units). */
export const HEAD_TOP = 167;

/** px per bunny unit (v1, also the reduced-motion heads): ≈ 0.66 on a 390 px phone. */
export function paradeUnit(W: number): number {
  return Math.min(0.72, Math.max(0.46, W * 0.0017));
}
/** Pompon in the tower, against paradeUnit (the tower has to fit above the card). */
export const TOWER_SCALE = 0.85;

export interface CastSpec {
  coat: BunnyCoat;
  /** size against Pompon */
  scale: number;
  /** travel direction coming in (1 = from the left) and going out */
  inDir: 1 | -1;
  outDir: 1 | -1;
}

/** Bottom to top. Pompon (fawn) is the biggest and comes last — the tower is top-heavy, that is the joke. */
export const CAST: readonly CastSpec[] = [
  { coat: 'broken', scale: 0.86, inDir: 1, outDir: -1 },
  { coat: 'choc', scale: 0.8, inDir: -1, outDir: 1 },
  { coat: 'himalayan', scale: 0.74, inDir: 1, outDir: -1 },
  { coat: 'fawn', scale: 1, inDir: -1, outDir: 1 },
];
export const FRIENDS: readonly BunnyCoat[] = CAST.slice(0, 3).map((c) => c.coat);
/** Friends' size against Pompon in the reduced-motion still (v1). */
export const FRIEND_SCALE = 0.72;

/** The schedule (s). Positions scale with the stage, the times do not (a smaller world = the same motion, smaller). */
export const BEAT = {
  /** first hop of each bunny, bottom to top */
  in: [0.05, 0.15, 0.55, 0.95],
  /**
   * crouch before the jump up, takeoff, landing on the head below; the flight times give all three jumps the same
   * gravity (≈ 3200 px/s² on a 390 px phone, apex heights below in towerPlan)
   */
  jumps: [
    null,
    { crouch: 0.9, up: 1.02, land: 1.45 },
    { crouch: 1.44, up: 1.56, land: 2.05 },
    { crouch: 2.08, up: 2.27, land: 2.8 },
  ],
  /** Pompon: looks up at the tower (the hesitation) */
  look: 1.74,
  /** Pompon turns to you on top */
  front: 2.92,
  /** the binky: crouch, takeoff, landing (a little off-centre) */
  binky: { crouch: 3.2, up: 3.28, land: 3.6 },
  /** the friends notice the lean */
  uhOh: 3.72,
  /** bail out, top-down: Pompon, himalayan, chocolate; broken drops back on both feet when chocolate has left */
  sep: [0, 3.94, 3.9, 3.86],
  /** flight time down to the edge */
  fall: [0, 0.31, 0.4, 0.46],
  /** the bottom bunny falls back onto both feet (s) */
  settle: 0.16,
} as const;

/** Where they land after bailing out (share of the stage width from the centre; signed = side). */
export const LAND_AT = [0, 0.22, -0.34, 0.47] as const;
/** Hop specs [share of the distance, duration s, height factor] (the approved run-in: slows down, the 2nd hop lower). */
type HopSpec = readonly [number, number, number?];
const ENTER: readonly HopSpec[] = [
  [1.15, 0.38],
  [0.85, 0.34, 0.6],
];
/** Going out: quick, every hop faster (the approved run-out) — by bottom-to-top index. */
const EXIT: ReadonlyArray<readonly HopSpec[]> = [
  [
    [1, 0.33],
    [1.15, 0.29],
  ],
  [
    [1, 0.29],
    [1.1, 0.25],
  ],
  [[1, 0.3]],
  [[1, 0.3]],
];
/** How long after its landing a bunny hops off (s), bottom to top. */
const EXIT_AFTER = [0.2, 0.13, 0.04, 0.04];

// ---------- small math ----------

export interface Pose {
  /** feet, host px */
  x: number;
  y: number;
  /** lean, degrees clockwise, about the feet */
  r: number;
  /** squash about the feet */
  sx: number;
  sy: number;
}

/** [time, value, easing of the segment arriving here]: holds the first value before and the last one after. */
export type Key = readonly [number, number, string?];

export function curve(keys: readonly Key[], t: number): number {
  const first = keys[0];
  if (!first) return 0;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    const a = keys[i - 1];
    if (!a || !b) continue;
    if (t > b[0]) continue;
    const span = b[0] - a[0];
    const p = span > 0 ? (t - a[0]) / span : 1;
    return a[1] + (b[1] - a[1]) * easing(b[2] ?? 'ease-in-out')(p);
  }
  return keys[keys.length - 1]?.[1] ?? 0;
}

const DEG = Math.PI / 180;
function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return { x: x * c - y * s, y: x * s + y * c };
}

/**
 * A landing: the springy squash response (a damped sine, first peak = A after ≈ 48 ms, one stretch back of ≈ 24 %,
 * settled in ≈ 0.4 s). 0 before t0 and after 0.7 s.
 */
const PULSE = { w: 24, decay: 11 } as const;
const PULSE_NORM = (() => {
  const tp = Math.atan(PULSE.w / PULSE.decay) / PULSE.w;
  return Math.exp(-PULSE.decay * tp) * Math.sin(PULSE.w * tp);
})();
export function pulse(t: number, t0: number, A: number): number {
  const tau = t - t0;
  if (tau <= 0 || tau > 0.7) return 0;
  return (A * Math.exp(-PULSE.decay * tau) * Math.sin(PULSE.w * tau)) / PULSE_NORM;
}

/** The tower's sway after a landing (degrees; first peak = A, period 0.48 s, mostly gone after one swing). */
const SWAY = { w: (2 * Math.PI) / 0.48, decay: 3.4 } as const;
const SWAY_NORM = (() => {
  const tp = Math.atan(SWAY.w / SWAY.decay) / SWAY.w;
  return Math.exp(-SWAY.decay * tp) * Math.sin(SWAY.w * tp);
})();
function swayAt(t: number, t0: number, A: number): number {
  const tau = t - t0;
  if (tau <= 0 || tau > 1.6) return 0;
  return (A * Math.exp(-SWAY.decay * tau) * Math.sin(SWAY.w * tau)) / SWAY_NORM;
}

/**
 * The parabola of a jump at share s of its time: from y0 to y1, its top `apex` px above the higher end
 * (a thrown body: x linear in time, y quadratic — gravity is constant within a jump).
 */
export function arcY(s: number, y0: number, y1: number, apex: number): number {
  const D = Math.abs(y0 - y1);
  const b = D / 2 + apex;
  const h = (b + Math.sqrt(Math.max(0, b * b - (D * D) / 4))) / 2;
  return (1 - s) * y0 + s * y1 - 4 * h * s * (1 - s);
}

/** Share of a hop's length covered at progress p (0..1) — Runner.hopOnce's travel keys (push off, even flight, the landing sticks). */
export function hopTravel(p: number): number {
  return curve(
    [
      [0, 0],
      [0.1, 0.06, 'cubic-bezier(.5,0,1,1)'],
      [0.7, 0.98, 'linear'],
      [1, 1, 'cubic-bezier(0,0,.2,1)'],
    ],
    p,
  );
}

function hops(t: number, from: number, to: number, specs: readonly HopSpec[], u: number): Hop[] {
  const out: Hop[] = [];
  const total = specs.reduce((a, s) => a + s[0], 0);
  const D = to - from;
  let x = from;
  for (const [w, d, k = 1] of specs) {
    const dx = (D * w) / total;
    // a real hop, not a glide: about a third as high as it is long, 24–44 units (as runSchedule)
    const h = Math.max(24, Math.min(44, (0.3 * Math.abs(dx)) / u)) * k;
    out.push({ t, d, x, dx, h });
    t += d;
    x += dx;
  }
  return out;
}

function hopsEnd(list: readonly Hop[], t: number): number {
  const last = list[list.length - 1];
  return last ? last.t + last.d : t;
}

/** Feet x along a list of ground hops (from `x0` before the first one). */
export function alongHops(list: readonly Hop[], x0: number, t: number): number {
  let x = x0;
  for (const h of list) {
    if (t <= h.t) break;
    x = t >= h.t + h.d ? h.x + h.dx : h.x + h.dx * hopTravel((t - h.t) / h.d);
  }
  return x;
}

// ---------- the plan ----------

export interface Jump {
  /** crouch from, takeoff, landing (s) */
  crouch: number;
  up: number;
  land: number;
  /** takeoff x (ground), the apex above the landing point (px) */
  x0: number;
  apex: number;
}

export interface Fall {
  t0: number;
  t1: number;
  x1: number;
  /** px above the start (the push off) */
  apex: number;
}

export interface Member extends CastSpec {
  level: number;
  /** px per bunny unit */
  u: number;
  /** start (off-stage) */
  x0: number;
  enter: Hop[];
  /** where it waits on the ground after the hops in */
  standX: number;
  /** onto the head of the one below (null for the bottom bunny) */
  jump: Jump | null;
  /** leaves the tower (bottom bunny: chocolate has left, it drops back on both feet) */
  sep: number;
  fall: Fall | null;
  /** feet back on the edge (s) and where */
  ground: number;
  groundX: number;
  exit: Hop[];
  /** off-stage again (s) */
  end: number;
  /** squash impulses: its own landings and the ones above it */
  pulses: Array<{ t: number; A: number }>;
}

export interface TowerPlan {
  W: number;
  H: number;
  inset: number;
  /** feet line (px) */
  G: number;
  /** the tower's foot (px) */
  xc: number;
  /** Pompon's px per unit */
  u0: number;
  members: Member[];
  /** tower sway impulses (deg, + = to the right) */
  sways: Array<{ t: number; A: number }>;
  /** the binky: Pompon's lift above the head below, his twist, where he lands (px right of the crown) */
  binky: { crouch: number; up: number; land: number; apex: number; off: number };
  duration: number;
}

/** Bend of each level against the one below (share of the base lean) and its lag (s): the top follows through. */
const BEND = 0.3;
const LAG = 0.05;
/** The fall: lean = C·sinh(K·(t − binky landing)) (an inverted pendulum: slow, then quicker). */
const FALL_C = 1.1;
const FALL_K = 9.5;

export function towerPlan(W: number, H: number, inset = EDGE_INSET): TowerPlan {
  const u0 = paradeUnit(W) * TOWER_SCALE;
  const G = H - inset - 4 * u0;
  const xc = W / 2;
  const members: Member[] = CAST.map((c, level) => {
    const u = u0 * c.scale;
    const off = HALF_WIDTH * u + 4;
    const x0 = c.inDir === 1 ? -off : W + off;
    return { ...c, level, u, x0, enter: [], standX: xc, jump: null, sep: 0, fall: null, ground: 0, groundX: xc, exit: [], end: 0, pulses: [] };
  });
  const sways: Array<{ t: number; A: number }> = [];
  members.forEach((m, k) => {
    const below = members[k - 1];
    const jb = BEAT.jumps[k];
    // waits beside the tower (clear of the widest bunny below it) — the bottom one walks right to the foot
    m.standX = below && jb ? xc - m.inDir * (HALF_WIDTH * (members[0]?.u ?? u0) + HALF_WIDTH * m.u + 10) : xc;
    m.enter = hops(BEAT.in[k] ?? 0, m.x0, m.standX, ENTER, m.u);
    if (below && jb) {
      // a higher jump the higher the target: the arc clears the heads on its way up
      const apex = [0, 40, 36, 30][k] ?? 20;
      m.jump = { crouch: jb.crouch, up: jb.up, land: jb.land, x0: m.standX, apex };
      // the landing: a big squash for the jumper, smaller and later for every bunny below
      m.pulses.push({ t: jb.land, A: k === 3 ? 0.2 : 0.16 });
      for (let j = k - 1; j >= 0; j--) members[j]?.pulses.push({ t: jb.land + 0.035 * (k - j), A: (k === 3 ? 0.1 : 0.085) - 0.008 * (k - 1 - j) });
      // it was moving toward the tower: the tower sways away first (Pompon is heavy)
      sways.push({ t: jb.land + 0.02, A: m.inDir * (k === 3 ? 2.6 : 1.5) });
    }
  });
  const pompon = members[3];
  const binky = { crouch: BEAT.binky.crouch, up: BEAT.binky.up, land: BEAT.binky.land, apex: 24 * (u0 / 0.56), off: 7 * (u0 / 0.56) };
  // the binky lands: smaller squashes down the tower
  pompon?.pulses.push({ t: binky.land, A: 0.13 });
  for (let j = 2; j >= 0; j--) members[j]?.pulses.push({ t: binky.land + 0.035 * (3 - j), A: 0.07 - 0.006 * (2 - j) });
  // bail out (top-down), land, hop off
  members.forEach((m, k) => {
    if (k === 0) {
      m.sep = BEAT.sep[1];
      m.ground = m.sep + BEAT.settle;
      m.groundX = xc;
      m.pulses.push({ t: m.ground, A: 0.07 });
    } else {
      const t0 = BEAT.sep[k] ?? 4;
      const t1 = t0 + (BEAT.fall[k] ?? 0.4);
      m.sep = t0;
      m.fall = { t0, t1, x1: xc + (LAND_AT[k] ?? 0) * W, apex: [0, 8, 10, 12][k] ?? 10 };
      m.ground = t1;
      m.groundX = m.fall.x1;
      m.pulses.push({ t: t1, A: 0.15 });
    }
    const outX = m.outDir === 1 ? W + HALF_WIDTH * m.u + 4 : -(HALF_WIDTH * m.u + 4);
    m.exit = hops(m.ground + (EXIT_AFTER[k] ?? 0.05), m.groundX, outX, EXIT[k] ?? [[1, 0.3]], m.u);
    m.end = hopsEnd(m.exit, m.ground);
  });
  const duration = Math.round((Math.max(...members.map((m) => m.end)) + 0.05) * 1000) / 1000;
  return { W, H, inset, G, xc, u0, members, sways, binky, duration };
}

// ---------- the rig: where every bunny is at t ----------

/** The tower's base lean (deg) at t: the sways after the landings and, after the binky, the fall. */
export function towerLean(p: TowerPlan, t: number): number {
  let a = 0;
  for (const s of p.sways) a += swayAt(t, s.t, s.A);
  const tb = p.binky.land;
  if (t > tb) a += FALL_C * Math.sinh(FALL_K * (t - tb));
  return a;
}

/** Lean of level k while it stands in the tower (each level bends a little more, a little later). */
function levelLean(p: TowerPlan, k: number, t: number): number {
  let a = towerLean(p, t);
  for (let j = 1; j <= k; j++) a += BEND * towerLean(p, t - j * LAG);
  return a;
}

/** The jumper's own stretch / squash curve (sy) around a jump: crouch, stretch on takeoff, tuck, reach for the landing. */
function jumpSy(t: number, crouch: number, up: number, land: number, depth: number): number {
  if (t < crouch - 0.001 || t > land) return 1;
  const T = land - up;
  return curve(
    [
      [crouch, 1],
      [up, 1 - depth, 'ease-in-out'],
      [up + 0.07, 1 + depth * 0.55, 'cubic-bezier(.2,.7,.3,1)'],
      [up + 0.5 * T, 0.98, 'ease-in-out'],
      [land - 0.05, 1.03, 'ease-in-out'],
      [land, 1, 'linear'],
    ],
    t,
  );
}

function ownSy(p: TowerPlan, m: Member, t: number): number {
  let sy = 1;
  if (m.jump) sy *= jumpSy(t, m.jump.crouch, m.jump.up, m.jump.land, m.level === 3 ? 0.17 : 0.12);
  if (m.level === 3) sy *= jumpSy(t, p.binky.crouch, p.binky.up, p.binky.land, 0.1);
  if (m.fall) sy *= jumpSy(t, m.fall.t0 - 0.09, m.fall.t0, m.fall.t1, 0.07);
  for (const q of m.pulses) sy -= pulse(t, q.t, q.A);
  return sy;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
function pose(x: number, y: number, r: number, sy: number): Pose {
  // keeps the volume roughly: wider when squashed, narrower when stretched
  return { x: r3(x), y: r3(y), r: r3(r), sx: r3(1 + 0.62 * (1 - sy)), sy: r3(sy) };
}

/** Pompon's binky on the head below: lift (px), twist (deg), sideways (px) — relative to the crown he stands on. */
function binkyRel(p: TowerPlan, t: number): { lift: number; twist: number; off: number } {
  const b = p.binky;
  if (t <= b.up) return { lift: 0, twist: 0, off: 0 };
  if (t >= b.land) return { lift: 0, twist: curve([[b.land, 4], [b.land + 0.16, 0, 'ease-out']], t), off: b.off };
  const s = (t - b.up) / (b.land - b.up);
  const twist = curve(
    [
      [0, 0],
      [0.38, 14, 'cubic-bezier(.2,.7,.3,1)'],
      [0.78, -9, 'ease-in-out'],
      [1, 4, 'ease-in-out'],
    ],
    s,
  );
  return { lift: -arcY(s, 0, 0, b.apex), twist, off: b.off * s };
}

/** Where the bunny of level k stands in the tower at t (on the crown of the one below). */
function stacked(p: TowerPlan, k: number, t: number): Pose {
  const below = p.members[k - 1];
  const m = p.members[k];
  if (!below || !m) return pose(p.xc, p.G, 0, 1);
  const lo = poseAt(p, k - 1, t);
  let r = levelLean(p, k, t);
  let lift = 0;
  let off = 0;
  if (k === 3) {
    const b = binkyRel(p, t);
    lift = b.lift;
    off = b.off;
    r += b.twist;
  }
  // the crown of the one below, in its own (leaning, squashed) frame
  const crown = rot(off * lo.sx, -STACK * below.u * lo.sy, lo.r);
  const up = rot(0, -lift, r);
  return pose(lo.x + crown.x + up.x, lo.y + crown.y + up.y, r, ownSy(p, m, t));
}

/** The pose of the bunny of level k (0 = bottom) at t. */
export function poseAt(p: TowerPlan, k: number, t: number): Pose {
  const m = p.members[k];
  if (!m) return pose(0, 0, 0, 1);
  // 1 — on its way in and waiting beside the tower
  const takeoff = m.jump?.up ?? Infinity;
  if (k === 0) {
    if (t < m.sep) {
      // the bottom bunny: in the tower it leans over the edge of a foot (the other one lifts)
      const lean = t >= hopsEnd(m.enter, 0) ? towerLean(p, t) : 0;
      const sx = Math.sign(lean) || 1;
      const pivot = p.xc + sx * FOOT_EDGE * m.u;
      const back = rot(-sx * FOOT_EDGE * m.u, 0, lean);
      const x = t >= hopsEnd(m.enter, 0) ? pivot + back.x : alongHops(m.enter, m.x0, t);
      return pose(x, p.G + (t >= hopsEnd(m.enter, 0) ? back.y : 0), lean, ownSy(p, m, t));
    }
    if (t < m.ground) {
      // the weight is gone: it falls back onto both feet
      const a0 = towerLean(p, m.sep);
      const lean = a0 * (1 - easing('cubic-bezier(.5,0,.9,.6)')((t - m.sep) / (m.ground - m.sep)));
      const sx = Math.sign(a0) || 1;
      const pivot = p.xc + sx * FOOT_EDGE * m.u;
      const back = rot(-sx * FOOT_EDGE * m.u, 0, lean);
      return pose(pivot + back.x, p.G + back.y, lean, ownSy(p, m, t));
    }
    return pose(alongHops(m.exit, m.groundX, t), p.G, 0, ownSy(p, m, t));
  }
  if (t < takeoff) return pose(alongHops(m.enter, m.x0, t), p.G, 0, ownSy(p, m, t));
  // 2 — the jump onto the crown below (lands exactly where that crown is at the landing)
  const j = m.jump;
  if (j && t < j.land) {
    const target = stacked(p, k, j.land);
    const s = (t - j.up) / (j.land - j.up);
    const x = j.x0 + (target.x - j.x0) * s;
    const y = arcY(s, p.G, target.y, j.apex);
    // leans into the jump, upright again for the landing
    const r = curve(
      [
        [0, 0],
        [0.25, m.inDir * 6, 'ease-out'],
        [0.8, 0, 'ease-in-out'],
      ],
      s,
    );
    return pose(x, y, r + target.r * s, ownSy(p, m, t));
  }
  // 3 — in the tower
  const f = m.fall;
  if (!f || t < f.t0) return stacked(p, k, t);
  // 4 — bails out: from where it stood to the edge
  if (t < f.t1) {
    const from = stacked(p, k, f.t0);
    const s = (t - f.t0) / (f.t1 - f.t0);
    const x = from.x + (f.x1 - from.x) * s;
    const y = arcY(s, from.y, p.G, f.apex);
    // rights itself in the air (a rabbit lands on its feet)
    const r = from.r * (1 - easing('cubic-bezier(.2,.7,.3,1)')(Math.min(1, s / 0.7))) + m.outDir * 5 * Math.sin(Math.PI * s);
    return pose(x, y, r, ownSy(p, m, t));
  }
  // 5 — on the edge again, off it goes
  return pose(alongHops(m.exit, m.groundX, t), p.G, 0, ownSy(p, m, t));
}

/** True while the bunny of level k stands on the one below (or is landing on it / leaving it). */
export function inTower(p: TowerPlan, k: number, t: number): boolean {
  const m = p.members[k];
  if (!m?.jump) return false;
  return t >= m.jump.land && t < m.sep;
}

/** True while its feet are on the edge (not in the air, not in the tower). */
export function onGround(p: TowerPlan, k: number, t: number): boolean {
  const m = p.members[k];
  if (!m) return false;
  if (k === 0) return true;
  return t < (m.jump?.up ?? Infinity) || t >= m.ground;
}

// ---------- baking: poseAt -> keyframes ----------

export interface BakedKey {
  t: number;
  pose: Pose;
}

const TOL = { x: 0.12, y: 0.12, r: 0.12, sx: 0.0025, sy: 0.0025 } as const;
const CHANNELS = ['x', 'y', 'r', 'sx', 'sy'] as const;

/**
 * Every moment the motion turns a corner (a takeoff, a landing, a hop, a push from above): bake() samples exactly
 * there too, so linear keys never cut a corner between two frames.
 */
export function breakpoints(p: TowerPlan): number[] {
  const out: number[] = [p.binky.crouch, p.binky.up, p.binky.land, ...p.sways.map((s) => s.t)];
  for (const m of p.members) {
    // a hop's travel turns its corners at 10 % (push off) and 70 % (touch down)
    for (const h of [...m.enter, ...m.exit]) out.push(h.t, h.t + 0.1 * h.d, h.t + 0.7 * h.d, h.t + h.d);
    if (m.jump) out.push(m.jump.crouch, m.jump.up, m.jump.land);
    if (m.fall) out.push(m.fall.t0 - 0.09, m.fall.t0, m.fall.t1);
    out.push(m.sep, m.ground, ...m.pulses.map((q) => q.t));
  }
  return out;
}

/**
 * Samples a pose function every `dt` s (and at the `exact` moments) and keeps only the keys linear interpolation
 * needs (every dropped sample stays within TOL of the line between its kept neighbours): long holds become two
 * keys (the track then stops ticking there), quick moves keep a key every frame.
 */
export function bake(fn: (t: number) => Pose, t0: number, t1: number, dt = 1 / 60, exact: readonly number[] = []): BakedKey[] {
  const n = Math.max(1, Math.ceil((t1 - t0) / dt));
  const at = new Set<number>();
  for (let i = 0; i <= n; i++) at.add(Math.round(Math.min(t1, t0 + i * dt) * 1e5) / 1e5);
  for (const t of exact) if (t > t0 && t < t1) at.add(Math.round(t * 1e5) / 1e5);
  const sorted = [...at].sort((a, b) => a - b);
  const s: BakedKey[] = [];
  for (const t of sorted) {
    // keys at least 2 ms apart (a timeline key never shares its time with another)
    const last = s[s.length - 1];
    if (last && t - last.t < 0.002) continue;
    s.push({ t, pose: fn(t) });
  }
  const out: BakedKey[] = [];
  let a = 0;
  const first = s[0];
  if (first) out.push(first);
  while (a < s.length - 1) {
    let b = a + 1;
    // extend b while every sample between a and b+1 stays on the line
    while (b + 1 < s.length && fits(s, a, b + 1)) b += 1;
    const kb = s[b];
    if (kb) out.push(kb);
    a = b;
  }
  return out;
}

function fits(s: readonly BakedKey[], a: number, b: number): boolean {
  const A = s[a];
  const B = s[b];
  if (!A || !B) return false;
  for (let i = a + 1; i < b; i++) {
    const M = s[i];
    if (!M) continue;
    const q = (M.t - A.t) / (B.t - A.t);
    for (const c of CHANNELS) {
      const v = A.pose[c] + (B.pose[c] - A.pose[c]) * q;
      if (Math.abs(v - M.pose[c]) > TOL[c]) return false;
    }
  }
  return true;
}

// ---------- checks (tests, gallery notes) ----------

/** A bunny's silhouette as circles [x, y, r] in units (feet at 0,0): head, cheeks, lop ears, body, hips. */
const SILHOUETTE: ReadonlyArray<readonly [number, number, number]> = [
  [0, -118, 47],
  [-62, -88, 19],
  [62, -88, 19],
  [-58, -132, 18],
  [58, -132, 18],
  [-66, -100, 15],
  [66, -100, 15],
  [0, -44, 44],
  [-44, -24, 24],
  [44, -24, 24],
];

/** The silhouette circles of level k at t, in host px. */
export function silhouette(p: TowerPlan, k: number, t: number): Array<{ x: number; y: number; r: number }> {
  const m = p.members[k];
  if (!m) return [];
  const ps = poseAt(p, k, t);
  return SILHOUETTE.map(([x, y, r]) => {
    const v = rot(x * m.u * ps.sx, y * m.u * ps.sy, ps.r);
    return { x: ps.x + v.x, y: ps.y + v.y, r: r * m.u * Math.max(ps.sx, ps.sy) };
  });
}

/** Is level k (partly) on the stage at t? */
export function visible(p: TowerPlan, k: number, t: number): boolean {
  const m = p.members[k];
  if (!m) return false;
  const x = poseAt(p, k, t).x;
  return x + HALF_WIDTH * m.u > 0 && x - HALF_WIDTH * m.u < p.W;
}

export function onStage(p: TowerPlan, t: number): number {
  return p.members.filter((_, k) => visible(p, k, t)).length;
}

/**
 * The closest two silhouettes standing on the edge ever come (px; negative = they overlap), sampled every 10 ms:
 * on the edge nobody walks through anybody. (In the air a jumper passes in front of the tower — it is drawn over
 * the ones below — and in the tower they stand on each other on purpose; neither counts here.)
 */
export function minGap(p: TowerPlan): { gap: number; at: number; pair: [number, number] } {
  let best = { gap: Infinity, at: 0, pair: [0, 0] as [number, number] };
  for (let t = 0; t <= p.duration; t += 0.01) {
    const sil = p.members.map((_, k) => (visible(p, k, t) && onGround(p, k, t) ? silhouette(p, k, t) : []));
    for (let a = 0; a < sil.length; a++) {
      for (let b = a + 1; b < sil.length; b++) {
        for (const ca of sil[a] ?? []) {
          for (const cb of sil[b] ?? []) {
            const g = Math.hypot(ca.x - cb.x, ca.y - cb.y) - ca.r - cb.r;
            if (g < best.gap) best = { gap: g, at: Math.round(t * 100) / 100, pair: [a, b] };
          }
        }
      }
    }
  }
  return best;
}
