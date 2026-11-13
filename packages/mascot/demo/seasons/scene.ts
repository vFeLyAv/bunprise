/**
 * Seasons v2 (26.10.2026): «Листопад» (autumn) and «Снегопад» (winter) — ideas doc 2026-10-26 §1.4 / top-5
 * item 4. GALLERY-ONLY prototype: nothing here is used by the app until Felix approves it on the gallery page
 * (?screens=seasons). v1 (one leaf / one flake) is archived in E:\BALLR\_codex_handoffs\archive-20261026\seasons-v1\.
 *
 * Pompon climbs over the card's top edge with the APPROVED peek (WelcomeStage, the same climb as `peek-once` /
 * `pop-up`: ear tips, paws, the pull, glances). Around him, on the same stage timeline:
 *   autumn  a few leaves come down from the top of the screen. Far ones (a small English-oak leaf, a yellow and a
 *           tiny orange Norway-maple leaf) drift slowly BEHIND him and go behind the card. The near one — a Norway
 *           maple leaf (props.ts: five lobes, round sinuses, palmate veins, long petiole) — falls on the approved
 *           pendulum arc and, like a thin sheet, rocks about its long axis: it is seen foreshortened and once shows
 *           its paler underside (the two faces swap at the zero crossing). It lands on his forehead; he blinks
 *           twice, tilts 5°, it slides over his ear and cheek behind the card edge; he looks at you and ducks.
 *   winter  a gentle snowfall (seven flakes at three depths: soft dots far away, small six-armed stars, one near
 *           star); one big soft flake floats down onto his nose. He looks at it cross-eyed, his nose twitches,
 *           "ah… ah…" (eyes squeeze, mouth opens, head rises a little), "choo!" — a tiny sneeze (a nod, eyes shut,
 *           three puffs) blows the flake up and away and it melts in the air; he looks at you and ducks.
 * Ears never change shape; no leaf ever covers an eye (test/seasons.test.ts checks every frame).
 *
 * How it hooks into the stage (demo only — see the design doc for the later src change):
 *  - two prop layers (<svg>, the puppet's own coordinates = bunny units) inside the bunny's head frame, OUTSIDE the
 *    climbing `.lift`: `far` before it (behind him), `near` after it (over him). The stage's edge clip hides both
 *    behind the card exactly like the bunny, and the climb does not drag them along;
 *  - wrapper groups in the puppet's shadow DOM (body, eyes, each eye, nose), so the extra motion never touches a
 *    part the stage animates itself; ONE track drives the body tilt and the near layer's copy of it (a leaf on his
 *    forehead tilts with his head exactly);
 *  - the extra tracks are compiled into the stage's own Playhead, so play / seek / pause / off-screen parking move
 *    everything as one timeline (seek(t) is exact). Every track is ONE animation (dense keys, no long holds).
 * Only transform and opacity animate (no filters); every animation is finite and ends before he is gone.
 * Reduced motion: decoration — nothing at all.
 */

import { WelcomeStage, stageUnit, type BunnyCoat, type LookStep, type PeekStep, type ReducedMotionMode } from '../../src/index';
import { ReducedMotion } from '../../src/core';
import { E, placePeek, rotate, type StageGeo, type Vec } from '../../src/welcome-actors';
import { easing, Track, type ChannelInput, type Channels, type Playhead } from '../../src/timeline';
import { FLAKE_R, flakeMarkup, LEAVES, leafMarkup, type FlakeKind, type LeafKind, type PaletteName } from './props';

export type Season = 'autumn' | 'winter';
/** After the leaf / flake: Pompon ducks back (Start: the slot of the daily `hop-across`, nothing stays) or stays. */
export type SeasonEnd = 'duck' | 'stay';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Keys per second of the sampled paths (falls, slide, the flake riding the face): linear in between. */
const FPS = 30;

// ---------- the props' sizes (bunny units) ----------

/** The leaf that lands on him: props.ts's maple × this (≈ 41 × 33 units + its petiole: about a third of his head). */
export const LEAF_SCALE = 1.15;
/** The flake that lands on his nose (≈ 23 units across: a big soft flake on a small nose). */
export const FLAKE_SCALE = 1.2;

const scaled = (pts: readonly Vec[], k: number): Vec[] => pts.map((p) => ({ x: p.x * k, y: p.y * k }));

/** A leaf's blade outline in bunny units around its middle (default: the landing maple leaf) — for the eye checks. */
export function leafOutline(kind: LeafKind = 'maple', k = LEAF_SCALE): Vec[] {
  return scaled(LEAVES[kind].outline, k);
}

/** Points along a leaf's petiole (bunny units, same frame as leafOutline) — it must not cross an eye either. */
export function leafStem(kind: LeafKind = 'maple', k = LEAF_SCALE): Vec[] {
  const [a, c, b] = LEAVES[kind].petiole;
  const out: Vec[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    out.push({ x: (u * u * a.x + 2 * u * t * c.x + t * t * b.x) * k, y: (u * u * a.y + 2 * u * t * c.y + t * t * b.y) * k });
  }
  return out;
}

/** Radius (bunny units) of a circle that holds the landing prop in any rotation — for the clip and eye checks. */
export const PROP_R: Record<Season, number> = { autumn: LEAVES.maple.radius * LEAF_SCALE, winter: FLAKE_R.hero * FLAKE_SCALE };

// ---------- geometry ----------

export interface SceneOptions {
  season?: Season;
  end?: SeasonEnd;
  coat?: BunnyCoat;
  /** where Pompon peeks along the card's top edge, 0..1 (default 0.7: clear of the section title at the left) */
  pos?: number;
  /** px between the host's bottom edge and the card's top edge (the app's peeks use 16) */
  inset?: number;
  /** the card's top corner radius, px */
  radius?: number;
  minSize?: number;
  maxSize?: number;
  reducedMotion?: ReducedMotionMode;
}

export interface SceneGeo {
  W: number;
  H: number;
  /** px per bunny unit */
  u: number;
  /** host px of the bunny's feet (its local origin) */
  pivot: Vec;
  /** host y of the card's top edge (the line he hides behind) */
  edgeY: number;
}

/** The stage's own placement of the peek (welcome.ts stageUnit + welcome-actors placePeek), recomputed. */
export function sceneGeo(W: number, H: number, o: Required<Pick<SceneOptions, 'pos' | 'inset' | 'radius' | 'minSize' | 'maxSize'>>): SceneGeo {
  const u = stageUnit(W, H, o.minSize, o.maxSize);
  const geo: StageGeo = { W, H, u0: u, inset: { bottom: o.inset, top: 0, left: 0, right: 0 }, radius: { bottom: Math.min(o.radius, W / 2), top: 0 } };
  const place = placePeek({ edge: 'bottom', pos: o.pos, tilt: 0, floor: false, reveal: 0, turn: true }, u, geo);
  return { W, H, u, pivot: place.pivot, edgeY: H - o.inset };
}

const toLocal = (g: SceneGeo, p: Vec): Vec => ({ x: (p.x - g.pivot.x) / g.u, y: (p.y - g.pivot.y) / g.u });
/** bunny units -> host px, with the body tilt (deg, about the feet) applied. */
export const toHost = (g: SceneGeo, p: Vec, tilt = 0): Vec => {
  const r = rotate(p, tilt);
  return { x: g.pivot.x + r.x * g.u, y: g.pivot.y + r.y * g.u };
};

// ---------- paths (pure, deterministic) ----------

export type Key = readonly [number, ChannelInput, string?];

const smoothstep = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

export interface DriftSpec {
  t0: number;
  t1: number;
  /** host px: the middle line of its path runs from `from` (above the screen) to `to` */
  from: Vec;
  to: Vec;
  /** px of its swing to each side */
  swing: number;
  /** half swings on the way (2 = right → left → back) */
  halves: number;
  /** rad: where in its swing it starts (π/2 = at the right end, swinging left first) */
  phase: number;
  /** 0..1: how much it hovers at the end of each swing (1 = stops falling there for a moment) */
  hover: number;
  /** deg: it rocks INTO its swing (leading edge down), at most this much — never a propeller */
  rock: number;
  /** deg when it arrives */
  rest: number;
  /** it lands on `to`: every swing and turn dies out there (else it just passes through) */
  settle: boolean;
  /** deg: it rocks about its long axis this much (over 90: it flips and shows its underside), `rollPhase` rad against the swing */
  roll: number;
  rollPhase: number;
  /** 0..0.4: foreshortened along its long axis at the ends of its swings (where it pitches up and stalls) */
  pitch: number;
  /** deg per second of a slow in-plane turn (snowflakes) */
  spin?: number;
  /** a passing leaf turns over once, completely, about its long axis: from this share of its way, taking flipLen of it */
  flipAt?: number;
  flipLen?: number;
}

export interface DriftKey {
  t: number;
  /** host px */
  p: Vec;
  /** in-plane rotation, deg */
  r: number;
  /** its width as seen (cos of the roll about its long axis; negative = mirrored: we see its underside) */
  sx: number;
  /** its length as seen (pitch) */
  sy: number;
  /** 0..1 opacity of the underside face */
  under: number;
  /** 0..1 opacity of the shade layer (darker while edge-on) */
  shade: number;
}

/**
 * A falling leaf / flake as a pendulum glide (host px): it swings to and fro, falls slowest at the end of each
 * swing (where it turns), rocks INTO the swing — leading edge down, at most `rock`° — and, like a thin sheet, rolls
 * about its long axis (seen as a narrower / mirrored shape: scaleX = cos roll; the faces swap where it is edge-on)
 * and pitches a little (scaleY). With `settle` it arrives on `to` with no speed and no turn left, face up.
 */
export function driftKeys(s: DriftSpec): DriftKey[] {
  const n = Math.max(1, Math.round((s.t1 - s.t0) * FPS));
  const h = s.halves;
  const span = s.t1 - s.t0;
  /** cos of the roll about the long axis at q (its sign = which face we see) */
  const cosRoll = (q: number): number => {
    const th = Math.PI * h * q + s.phase;
    // the roll grows from nothing and (landing) dies out before it touches down
    const amp = s.settle ? Math.sin(Math.PI * q) ** 0.7 : 1;
    // a passing leaf: a gentle wobble, and once a quick full turn over (tumbling) at its own moment
    const flip = s.flipAt === undefined ? 0 : 360 * smoothstep((q - s.flipAt) / (s.flipLen ?? 0.2));
    return Math.cos(((s.roll * amp * Math.sin(th + s.rollPhase) + flip) * Math.PI) / 180);
  };
  const at = (q: number, face?: 1 | -1): DriftKey => {
    const env = s.settle ? (1 - q) ** 1.6 : 1;
    const th = Math.PI * h * q + s.phase;
    // vertical progress: fastest mid-swing, slowest where a swing turns; never backwards while hover <= 1
    const g = q + (s.hover * (Math.sin(2 * th) - Math.sin(2 * s.phase))) / (2 * Math.PI * h);
    const smooth = q * q * (3 - 2 * q);
    // at a flip (face given) it is exactly edge-on: the thinnest sliver, the faces swap right there
    const c = face === undefined ? cosRoll(q) : 0;
    const side = face ?? (c < 0 ? -1 : 1);
    return {
      t: s.t0 + span * q,
      p: { x: s.from.x + (s.to.x - s.from.x) * q + s.swing * env * Math.sin(th), y: s.from.y + (s.to.y - s.from.y) * g },
      r: s.rock * Math.cos(th) * Math.sqrt(env) + s.rest * smooth + (s.spin ?? 0) * span * q,
      // never quite zero: a real leaf seen edge-on is still a thin curved sliver
      sx: side * (0.06 + 0.94 * Math.abs(c)),
      sy: 1 - s.pitch * Math.sin(th) ** 2 * env,
      under: side < 0 ? 1 : 0,
      shade: 0.3 * (1 - Math.abs(c)),
    };
  };
  const out: DriftKey[] = [];
  // the faces swap within 8 ms, at the exact moment it is edge-on (bisected), never spread over a key gap
  const half = 0.004 / Math.max(span, 1e-6);
  let prevQ = 0;
  let prevC = cosRoll(0);
  for (let i = 0; i <= n; i++) {
    const q = i / n;
    const c = cosRoll(q);
    if (i > 0 && c < 0 !== prevC < 0) {
      let lo = prevQ;
      let hi = q;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2;
        if (cosRoll(mid) < 0 === prevC < 0) lo = mid;
        else hi = mid;
      }
      const cross = (lo + hi) / 2;
      const a = Math.max(prevQ + half, cross - half);
      const b = Math.min(q - half, cross + half);
      if (b > a) {
        out.push(at(a, prevC < 0 ? -1 : 1));
        out.push(at(b, c < 0 ? -1 : 1));
      }
    }
    out.push(at(q));
    prevQ = q;
    prevC = c;
  }
  return out;
}

/**
 * Along a polyline (Catmull-Rom through `pts`), timed by one easing over its arc length; `rot` = degrees at the
 * points (interpolated with the same progress). Bunny units.
 */
export function slideKeys(pts: readonly Vec[], rot: readonly number[], t0: number, t1: number, ease: string): Array<{ t: number; p: Vec; r: number }> {
  const curve = (i: number, f: number): Vec => {
    const p0 = pts[Math.max(0, i - 1)] ?? pts[0]!;
    const p1 = pts[i]!;
    const p2 = pts[Math.min(pts.length - 1, i + 1)]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    const f2 = f * f;
    const f3 = f2 * f;
    const c = (a: number, b: number, cc: number, d: number) => 0.5 * (2 * b + (-a + cc) * f + (2 * a - 5 * b + 4 * cc - d) * f2 + (-a + 3 * b - 3 * cc + d) * f3);
    return { x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) };
  };
  // a dense table: arc length -> (segment, fraction)
  const table: Array<{ len: number; i: number; f: number }> = [{ len: 0, i: 0, f: 0 }];
  let len = 0;
  let prev = pts[0]!;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 1; k <= 24; k++) {
      const p = curve(i, k / 24);
      len += Math.hypot(p.x - prev.x, p.y - prev.y);
      table.push({ len, i, f: k / 24 });
      prev = p;
    }
  }
  const ez = easing(ease);
  const n = Math.max(1, Math.round((t1 - t0) * FPS));
  const out: Array<{ t: number; p: Vec; r: number }> = [];
  for (let j = 0; j <= n; j++) {
    const target = ez(j / n) * len;
    let hit = table[table.length - 1]!;
    for (let k = 1; k < table.length; k++) {
      const b = table[k]!;
      if (b.len >= target) {
        const a = table[k - 1]!;
        const w = b.len > a.len ? (target - a.len) / (b.len - a.len) : 0;
        const fa = a.i === b.i ? a.f : 0;
        hit = { len: target, i: b.i, f: fa + (b.f - fa) * w };
        break;
      }
    }
    const pos = hit.i + hit.f;
    const ri = Math.min(rot.length - 2, Math.floor(pos));
    const rf = pos - ri;
    out.push({ t: t0 + ((t1 - t0) * j) / n, p: curve(hit.i, hit.f), r: (rot[ri] ?? 0) + ((rot[ri + 1] ?? 0) - (rot[ri] ?? 0)) * rf });
  }
  return out;
}

/** The approved blink (welcome-actors Peeker.blink) at `t`: shut in 50 ms, open in 80 ms. */
function blink(track: Track, t: number): void {
  track.path(t, [[t + 0.05, { sy: 0.1 }, E.in], [t + 0.13, { sy: 1 }, E.out]]);
}

/** The approved sniffle (idle nose wiggle): quick twitches, 94.5 ms per half. */
const TWITCH: ChannelInput = { y: 0.4, sx: 1.1, sy: 0.82 };
const CALM: ChannelInput = { y: 0, sx: 1, sy: 1 };
const TWITCH_HALF = 0.0945;

// ---------- the two scores ----------

/** Absolute times (s) of one season's beats; the peek starts at PEEK_AT. */
export interface Score {
  look: LookStep[];
  /** the landing prop is fully above the screen top here and starts to fall */
  enter: number;
  land: number;
  /** when the landing prop is gone (behind the card / melted) */
  gone: number;
  /** body tilt: [start, reached, back from, back at] and the angle (deg) */
  tilt: readonly [number, number, number, number] | null;
  tiltDeg: number;
}

const PEEK_AT = 0.1;
/** The first glance (and the stage's own first blink) comes this long after PEEK_AT: up and settled. */
const LOOK_FROM = 1.05;

export const SCORES: Record<Season, Score> = {
  autumn: {
    // 'up' while the leaf comes down and lies on his forehead (the double blink), then at you; he ducks after
    look: [['up', 1.27], ['viewer', 1.22]],
    enter: 0.62,
    land: 2.0,
    gone: 3.3,
    tilt: [2.3, 2.7, 3.3, 3.64],
    tiltDeg: 5,
  },
  winter: {
    // 'up' at the flake, 'down' at his nose while it sits there and through the sneeze, then at you
    look: [['up', 0.55], ['down', 1.33], ['viewer', 0.4]],
    enter: 0.5,
    land: 1.7,
    gone: 3.42,
    tilt: null,
    tiltDeg: 0,
  },
};

/** Winter's little story after the flake landed (absolute s). */
export const SNEEZE = {
  /** the nose twitches (the approved sniffle) */
  twitch: 1.8,
  /** the eyes cross: he looks at the flake on his nose */
  cross: 1.82,
  /** "ah… ah…": eyes squeeze, mouth opens, the head rises a little (two breaths) */
  ah: 2.32,
  /** "choo!": a quick nod, eyes shut, three puffs; the flake flies up and away */
  choo: 2.86,
} as const;

export function peekStep(season: Season, end: SeasonEnd, pos: number): PeekStep {
  return { type: 'peek', actor: 0, edge: 'bottom', at: PEEK_AT, pos, lookFrom: LOOK_FROM, look: SCORES[season].look, hold: 0, stay: end === 'stay' };
}

// ---------- the others: far leaves, the snowfall ----------

/** A prop that just passes through (top of the screen → behind the card edge). x as a share of the host width. */
export interface Drifter {
  x0: number;
  x1: number;
  t0: number;
  t1: number;
  /** × its props.ts size */
  scale: number;
  /** static opacity: farther = softer */
  fade: number;
  /** far = behind him; near = over him (never over his face) */
  depth: 'far' | 'near';
  swing: number;
  halves: number;
  phase: number;
  hover: number;
  rock: number;
  roll: number;
  rollPhase: number;
  pitch: number;
  spin?: number;
  flipAt?: number;
  flipLen?: number;
}

export interface LeafDrifter extends Drifter {
  kind: LeafKind;
  palette: PaletteName;
}

export interface FlakeDrifter extends Drifter {
  kind: FlakeKind;
}

/** Autumn: far leaves — smaller, softer, slower on screen (parallax), behind him; each flips at its own moment. */
export const FAR_LEAVES: readonly LeafDrifter[] = [
  { kind: 'oak', palette: 'russet', depth: 'far', scale: 0.95, fade: 0.9, t0: 0.05, t1: 3.3, x0: 0.25, x1: 0.33, swing: 22, halves: 3, phase: 0.4, hover: 0.5, rock: 20, roll: 42, rollPhase: 1.1, pitch: 0.2, flipAt: 0.42, flipLen: 0.2 },
  { kind: 'maple', palette: 'gold', depth: 'far', scale: 0.74, fade: 0.92, t0: 0.3, t1: 3.85, x0: 0.86, x1: 0.83, swing: 14, halves: 2, phase: 2.2, hover: 0.6, rock: 18, roll: 38, rollPhase: -0.6, pitch: 0.18, flipAt: 0.6, flipLen: 0.18 },
  { kind: 'maple', palette: 'amber', depth: 'far', scale: 0.56, fade: 0.82, t0: 0.85, t1: 4.0, x0: 0.11, x1: 0.18, swing: 11, halves: 3, phase: -0.8, hover: 0.45, rock: 16, roll: 45, rollPhase: 0.5, pitch: 0.2, flipAt: 0.25, flipLen: 0.2 },
];

/** Winter: a gentle snowfall at three depths (soft dots far away, small stars, one near star). */
export const SNOW: readonly FlakeDrifter[] = [
  { kind: 'dot', depth: 'far', scale: 1.5, fade: 0.8, t0: 0, t1: 3.5, x0: 0.17, x1: 0.2, swing: 8, halves: 3, phase: 0.3, hover: 0.3, rock: 0, roll: 0, rollPhase: 0, pitch: 0 },
  { kind: 'star', depth: 'far', scale: 1, fade: 0.8, t0: 0.12, t1: 3.35, x0: 0.88, x1: 0.85, swing: 9, halves: 2, phase: 1.4, hover: 0.35, rock: 10, roll: 30, rollPhase: 0.6, pitch: 0.1, spin: 25 },
  { kind: 'dot', depth: 'far', scale: 1.8, fade: 0.75, t0: 0.3, t1: 3.75, x0: 0.42, x1: 0.45, swing: 9, halves: 3, phase: 2.5, hover: 0.3, rock: 0, roll: 0, rollPhase: 0, pitch: 0 },
  { kind: 'dot', depth: 'far', scale: 1.4, fade: 0.7, t0: 0.7, t1: 3.8, x0: 0.62, x1: 0.66, swing: 7, halves: 2, phase: 0.9, hover: 0.3, rock: 0, roll: 0, rollPhase: 0, pitch: 0 },
  { kind: 'star', depth: 'far', scale: 1.3, fade: 0.9, t0: 0.45, t1: 3.4, x0: 0.3, x1: 0.27, swing: 11, halves: 3, phase: 1.9, hover: 0.35, rock: 12, roll: 30, rollPhase: -0.4, pitch: 0.1, spin: -30 },
  { kind: 'star', depth: 'near', scale: 1.8, fade: 1, t0: 0.75, t1: 3.05, x0: 0.1, x1: 0.15, swing: 11, halves: 2, phase: -1.2, hover: 0.35, rock: 14, roll: 35, rollPhase: 0.3, pitch: 0.12, spin: 40 },
  { kind: 'dot', depth: 'near', scale: 2.2, fade: 0.95, t0: 1.15, t1: 3.7, x0: 0.44, x1: 0.48, swing: 8, halves: 2, phase: 0.2, hover: 0.3, rock: 0, roll: 0, rollPhase: 0, pitch: 0 },
];

// ---------- the scene ----------

interface Rig {
  frame: HTMLElement;
  /** wraps .body: the season's body motion (autumn tilt, winter sneeze), about the feet */
  tilt: SVGGElement;
  eyes: SVGGElement;
  /** wrap each eye (screen-left, screen-right): cross-eyed */
  eyeL: SVGGElement;
  eyeR: SVGGElement;
  nose: SVGGElement;
  mouth: SVGElement;
  /** behind him (bunny units) */
  far: SVGGElement;
  /** over him (bunny units) */
  near: SVGGElement;
  /** over him, riding his body tilt */
  nearTilt: SVGGElement;
}

interface PropInfo {
  name: string;
  kind: LeafKind | FlakeKind | 'puff';
  layer: 'far' | 'near';
  move: Track;
  under: Track | null;
  /** bunny units, its own scale included */
  radius: number;
  /** it rides the body tilt (the landed leaf) */
  rides: boolean;
}

export interface PropState {
  name: string;
  kind: PropInfo['kind'];
  layer: 'far' | 'near';
  /** host px (tilt applied) */
  p: Vec;
  /** bunny units */
  local: Vec;
  r: number;
  sx: number;
  sy: number;
  o: number;
  under: number;
  radius: number;
  tilt: number;
}

function wrap(el: Element, cls: string, style: string): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', cls);
  g.setAttribute('style', style);
  el.parentNode?.insertBefore(g, el);
  g.append(el);
  return g;
}

let uid = 0;

type StageInternals = { built: { playhead: Playhead } | null };

export class SeasonScene {
  readonly host: HTMLElement;
  readonly season: Season;
  readonly end: SeasonEnd;
  /** the decoration is off (reduced motion): no bunny, no prop */
  readonly off: boolean;
  private place: SceneGeo;
  private readonly opts: Required<Pick<SceneOptions, 'pos' | 'inset' | 'radius' | 'minSize' | 'maxSize'>>;
  private stage: WelcomeStage | null = null;
  /** the stage build the season is installed in (the stage rebuilds itself on a resize: new actors, new timeline) */
  private installedIn: unknown = null;
  private ro: ResizeObserver | null = null;
  private tracks: Track[] = [];
  private props: PropInfo[] = [];
  private hero: PropInfo | null = null;
  private tilt: Track | null = null;
  private sneeze: Track | null = null;
  private eyes: Track | null = null;
  private cross: Track | null = null;
  private destroyed = false;

  constructor(host: HTMLElement, options: SceneOptions = {}) {
    this.host = host;
    this.season = options.season ?? 'autumn';
    this.end = options.end ?? 'duck';
    // 104 px: the size Pompon has over the first feed card in the app (StartSurprise: a 132 px host clamps him
    // to minSize 104), so his head stays inside the band between the title row and the card
    this.opts = { pos: options.pos ?? 0.7, inset: options.inset ?? 16, radius: options.radius ?? 24, minSize: options.minSize ?? 104, maxSize: options.maxSize ?? 104 };
    this.place = this.measure();
    const rm = new ReducedMotion(options.reducedMotion ?? 'auto');
    this.off = rm.matches || typeof (host as HTMLElement & { animate?: unknown }).animate !== 'function';
    rm.destroy();
    if (this.off) return;
    this.stage = new WelcomeStage(host, {
      bunnies: [options.coat ?? 'fawn'],
      choreography: [peekStep(this.season, this.end, this.opts.pos)],
      edgeInset: { bottom: this.opts.inset },
      edgeRadius: { bottom: this.opts.radius },
      minSize: this.opts.minSize,
      maxSize: this.opts.maxSize,
      reducedMotion: 'off',
    });
    this.install();
    // created after the stage's own observer, so this runs after the stage rebuilt itself for a new size
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.install());
      this.ro.observe(host);
    }
  }

  /** Where the peek is (host px), from the current host size — exactly what the stage computes. */
  get geo(): SceneGeo {
    return this.place;
  }

  /** Seconds until the stage is over (he ducked, or settled when he stays); 0 when nothing plays. */
  get duration(): number {
    return this.stage?.duration ?? 0;
  }

  get time(): number {
    return this.stage?.time ?? 0;
  }

  get playing(): boolean {
    return this.stage?.playing ?? false;
  }

  /** The stage's animations (its own and the season's): for frame tools and tests. */
  get animations(): readonly Animation[] {
    return this.stage?.animations ?? [];
  }

  play(): void {
    this.stage?.play();
  }

  pause(): void {
    this.stage?.pause();
  }

  seek(seconds: number): void {
    this.stage?.seek(seconds);
  }

  /** The landing prop (leaf / flake) at `t`: centre in host px (tilt applied), rotation, opacity. Null when nothing plays. */
  propAt(t: number): { p: Vec; local: Vec; r: number; sx: number; sy: number; o: number; under: number; tilt: number } | null {
    if (!this.hero) return null;
    const s = this.state(this.hero, t);
    return { p: s.p, local: s.local, r: s.r, sx: s.sx, sy: s.sy, o: s.o, under: s.under, tilt: s.tilt };
  }

  /** Every prop at `t` (the landing one, the far leaves / the snowfall, the sneeze puffs). */
  propsAt(t: number): PropState[] {
    return this.props.map((p) => this.state(p, t));
  }

  /** Body tilt (deg) at `t`. */
  tiltAt(t: number): number {
    return this.tilt?.sample(t).r ?? 0;
  }

  /** Winter: the body's sneeze offset (bunny units, down = +) at `t`. */
  sneezeAt(t: number): number {
    return this.sneeze?.sample(t).y ?? 0;
  }

  /** The face offset (bunny units) the stage gives at `t` (its glances), for following it. */
  faceAt(t: number): Vec {
    const tr = this.stage?.sample(t)['p0.face']?.transform ?? '';
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(tr);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
  }

  /** The stage's own body lean (deg) at `t` (glances, the climb's arc). */
  bodyAt(t: number): number {
    const tr = this.stage?.sample(t)['p0.body']?.transform ?? '';
    const m = /rotate\((-?[\d.]+)deg\)/.exec(tr);
    return m ? Number(m[1]) : 0;
  }

  /** The season's extra eye motion at `t`: shift (bunny units), blink / squint (sy) and the cross-eyed shift of each eye. */
  eyesAt(t: number): { x: number; y: number; sy: number; cross: number } {
    const v = this.eyes?.sample(t);
    return { x: v?.x ?? 0, y: v?.y ?? 0, sy: v?.sy ?? 1, cross: this.cross?.sample(t).x ?? 0 };
  }

  /** The season's own tracks (read-only; tests). */
  get seasonTracks(): readonly Track[] {
    return this.tracks;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ro?.disconnect();
    this.ro = null;
    this.stage?.destroy();
    this.stage = null;
    this.installedIn = null;
    this.reset();
  }

  // ---------- building ----------

  private reset(): void {
    this.tracks = [];
    this.props = [];
    this.hero = null;
    this.tilt = null;
    this.sneeze = null;
    this.eyes = null;
    this.cross = null;
  }

  private state(p: PropInfo, t: number): PropState {
    const v: Channels = p.move.sample(t);
    const tilt = p.rides ? this.tiltAt(t) : 0;
    const local = { x: v.x ?? 0, y: v.y ?? 0 };
    return {
      name: p.name, kind: p.kind, layer: p.layer, p: toHost(this.geo, local, tilt), local,
      r: v.r ?? 0, sx: v.sx ?? 1, sy: v.sy ?? 1, o: v.o ?? 1, under: p.under?.sample(t).o ?? 0, radius: p.radius, tilt,
    };
  }

  private measure(): SceneGeo {
    // the stage measures the host the same way (and falls back to 360 × 560 without layout)
    const sized = this.host.clientWidth > 0 && this.host.clientHeight > 0;
    return sceneGeo(sized ? this.host.clientWidth : 360, sized ? this.host.clientHeight : 560, this.opts);
  }

  /**
   * Puts the season into the stage's current build — once, and again whenever the stage rebuilt itself (a new
   * host size replaces its actors and its timeline): the props, the wrappers and the tracks join it at the moment
   * the stage is at, playing or paused like it.
   */
  private install(): void {
    const built = (this.stage as unknown as StageInternals | null)?.built;
    if (this.destroyed || !built || built === this.installedIn) return;
    this.installedIn = built;
    this.place = this.measure();
    this.reset();
    const rig = this.rig();
    if (!rig) return;
    // everything is over (behind the card / melted) a little before he is gone: the stage hides his frame then
    const end = Math.max(1, this.duration - 0.12);
    if (this.season === 'autumn') this.autumn(rig, end);
    else this.winter(rig, end);
    this.inject(built.playhead);
  }

  private rig(): Rig | null {
    const root = this.stage?.root;
    const lift = root?.querySelector<HTMLElement>('.clip .frame .lift');
    const frame = lift?.parentElement;
    const svg = lift?.querySelector('.actor')?.shadowRoot?.querySelector('svg');
    const body = svg?.querySelector('.body');
    const eyes = svg?.querySelector('.eyes');
    const each = svg ? [...svg.querySelectorAll('.eyes .eye')] : [];
    const nose = svg?.querySelector('.nose');
    const mouth = svg?.querySelector<SVGElement>('.mouth-open');
    const hm = svg?.querySelector('.hm');
    const [eyeA, eyeB] = each;
    if (!lift || !frame || !svg || !body || !eyes || !eyeA || !eyeB || !nose || !mouth || !hm) return null;
    const tilt = wrap(body, 's-tilt', 'transform-box: view-box; transform-origin: 0 0');
    const eyesW = wrap(eyes, 's-eyes', 'transform-box: fill-box; transform-origin: center');
    const eyeL = wrap(eyeA, 's-eye', 'transform-box: fill-box; transform-origin: center');
    const eyeR = wrap(eyeB, 's-eye', 'transform-box: fill-box; transform-origin: center');
    const noseW = wrap(nose, 's-nose', 'transform-box: fill-box; transform-origin: 50% 0%');
    // the prop layers: the puppet's own viewBox and .hm transform, so 1 user unit = 1 bunny unit
    const layer = (cls: string): { svg: SVGSVGElement; space: SVGGElement } => {
      const l = document.createElementNS(SVG_NS, 'svg');
      l.setAttribute('viewBox', svg.getAttribute('viewBox') ?? '80 0 240 270');
      l.setAttribute('aria-hidden', 'true');
      l.setAttribute('class', `s-layer ${cls}`);
      l.setAttribute('style', 'position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none');
      const space = document.createElementNS(SVG_NS, 'g');
      space.setAttribute('transform', hm.getAttribute('transform') ?? 'translate(200 246) scale(1.2)');
      l.append(space);
      return { svg: l, space };
    };
    const far = layer('s-far');
    const near = layer('s-near');
    frame.insertBefore(far.svg, lift);
    frame.append(near.svg);
    const nearTilt = document.createElementNS(SVG_NS, 'g');
    nearTilt.setAttribute('style', 'transform-box: view-box; transform-origin: 0 0');
    near.space.append(nearTilt);
    return { frame, tilt, eyes: eyesW, eyeL, eyeR, nose: noseW, mouth, far: far.space, near: near.space, nearTilt };
  }

  private track(el: Element | readonly Element[], name: string, base: ChannelInput): Track {
    const t = new Track(el, `season.${name}`, base);
    this.tracks.push(t);
    return t;
  }

  /** Path samples -> linear keys on `track`, in bunny units. */
  private keys(track: Track, from: number, keys: ReadonlyArray<{ t: number; v: ChannelInput }>): void {
    track.path(from, keys.map((k) => [k.t, k.v, 'linear'] as const));
  }

  /** A prop: an outer group (its motion, about its own middle) around the markup at scale `k` and opacity `fade`. */
  private addProp(parent: SVGGElement, cls: string, inner: string, k: number, fade = 1): SVGGElement {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', `s-prop ${cls}`);
    g.setAttribute('style', 'transform-box: view-box; transform-origin: 0 0');
    const s = document.createElementNS(SVG_NS, 'g');
    s.setAttribute('transform', `scale(${k})`);
    if (fade < 1) s.setAttribute('opacity', String(fade));
    s.innerHTML = inner;
    g.append(s);
    parent.append(g);
    return g;
  }

  /** A drifting prop's tracks from its keys (host px -> bunny units): its motion and (a leaf) its two faces. */
  private driftTracks(el: SVGGElement, name: string, keys: readonly DriftKey[], faces: boolean): { move: Track; under: Track | null } {
    const g = this.geo;
    const first = keys[0]!;
    const at = (k: DriftKey): ChannelInput => ({ ...toLocal(g, k.p), r: k.r, sx: k.sx, sy: k.sy });
    const move = this.track(el, name, at(first));
    this.keys(move, first.t, keys.slice(1).map((k) => ({ t: k.t, v: at(k) })));
    const under = el.querySelector('.face-under');
    const shade = el.querySelector('.shade');
    if (!faces || !under || !shade) return { move, under: null };
    const u = this.track(under, `${name}.under`, { o: first.under });
    this.keys(u, first.t, keys.slice(1).map((k) => ({ t: k.t, v: { o: k.under } })));
    const sh = this.track(shade, `${name}.shade`, { o: first.shade });
    this.keys(sh, first.t, keys.slice(1).map((k) => ({ t: k.t, v: { o: k.shade } })));
    return { move, under: u };
  }

  /** A prop that passes through: from above the screen top to below the card edge, over by `end`. */
  private pass(f: Drifter, radius: number, end: number): DriftSpec {
    const g = this.geo;
    const rpx = radius * g.u;
    return {
      t0: f.t0, t1: Math.min(f.t1, end), from: { x: f.x0 * g.W, y: -rpx - 3 }, to: { x: f.x1 * g.W, y: g.edgeY + rpx + 2 },
      swing: f.swing, halves: f.halves, phase: f.phase, hover: f.hover, rock: f.rock, rest: 0, settle: false,
      roll: f.roll, rollPhase: f.rollPhase, pitch: f.pitch, spin: f.spin, flipAt: f.flipAt, flipLen: f.flipLen,
    };
  }

  private autumn(rig: Rig, end: number): void {
    const s = SCORES.autumn;
    const g = this.geo;
    const R = PROP_R.autumn;
    const id = `s${++uid}`;
    // the far leaves (behind him): each its own species, colour, depth, speed and moment to flip
    FAR_LEAVES.forEach((f, i) => {
      const radius = LEAVES[f.kind].radius * f.scale;
      const el = this.addProp(rig.far, `s-leaf s-${f.kind}`, leafMarkup(f.kind, f.palette, `${id}-f${i}`), f.scale, f.fade);
      const { move, under } = this.driftTracks(el, `far${i}`, driftKeys(this.pass(f, radius, end)), true);
      this.props.push({ name: `far${i}`, kind: f.kind, layer: 'far', move, under, radius, rides: false });
    });
    // the near leaf: he lies on the forehead between the ear roots, clear of both eyes even while they look up
    const rest: Vec = { x: 4, y: -134 };
    const restR = -12;
    const to = toHost(g, rest);
    const fall = driftKeys({
      t0: s.enter, t1: s.land, from: { x: to.x, y: -(R * g.u) - 3 }, to, swing: Math.min(36, g.W - to.x - R * g.u - 10), halves: 2, phase: Math.PI / 2,
      hover: 0.78, rock: 24, rest: restR, settle: true, roll: 150, rollPhase: 0, pitch: 0.2,
    });
    const el = this.addProp(rig.nearTilt, 's-leaf s-maple s-hero', leafMarkup('maple', 'amber', `${id}-h`), LEAF_SCALE);
    const { move: prop, under } = this.driftTracks(el, 'leaf', fall, true);
    this.hero = { name: 'leaf', kind: 'maple', layer: 'near', move: prop, under, radius: R, rides: true };
    this.props.push(this.hero);
    // touch-down: it flattens onto the fur a little and rocks into its resting angle
    prop.path(s.land, [
      [s.land + 0.1, { y: rest.y + 0.8, r: restR + 2.5, sx: 1, sy: 0.93 }, E.out],
      [s.land + 0.26, { y: rest.y, r: restR, sy: 1 }, E.spring],
    ]);
    // he tilts (his right side down); once the slope is steep enough it slides over the ear and the cheek,
    // faster and faster, and goes behind the card edge (fully below the edge line at `gone`).
    // No track ever holds still for long: a hold is a slow drift (the approved "living hold") — so every track is
    // ONE animation, and a seek back after the stage settled finished animations cannot mix up their order.
    const [a, b, c, d] = s.tilt ?? [0, 0, 0, 0];
    this.tilt = this.track([rig.tilt, rig.nearTilt], 'tilt', { r: 0 });
    this.tilt.path(a, [[b, { r: s.tiltDeg * 0.9 }, E.inOut], [c, { r: s.tiltDeg }, E.inOut], [d, { r: 0 }, E.inOut]]);
    const slideFrom = a + 0.22;
    // while he starts to tilt, the leaf already creeps a little (it has not let go yet)
    const creep: Vec = { x: rest.x + 1, y: rest.y - 0.2 };
    prop.path(s.land + 0.26, [[slideFrom, { x: creep.x, y: creep.y, r: restR + 1 }, E.inOut]]);
    const pts: Vec[] = [creep, { x: 30, y: -135 }, { x: 52, y: -123 }, { x: 64, y: -104 }, { x: 68, y: -82 }, { x: 70, y: -58 }, { x: 72, y: -30 }, { x: 73, y: -6 }];
    const rot = [restR + 1, -2, 16, 32, 44, 52, 58, 60];
    const slide = slideKeys(pts, rot, slideFrom, s.gone, 'cubic-bezier(.45,0,.8,.6)');
    this.keys(prop, slideFrom, slide.slice(1).map((k) => ({ t: k.t, v: { x: k.p.x, y: k.p.y, r: k.r, sx: 1, sy: 1 } })));
    // two blinks right after it lands ("huh?"), then the eyes follow it down to the side, and back to you
    const eyes = this.track(rig.eyes, 'eyes', { x: 0, y: 0, sy: 1 });
    this.eyes = eyes;
    blink(eyes, s.land + 0.08);
    blink(eyes, s.land + 0.3);
    eyes.path(slideFrom + 0.1, [[slideFrom + 0.36, { x: 2, y: 1.6 }, E.face], [s.gone - 0.1, { x: 2.6, y: 3 }, E.inOut], [d - 0.05, { x: 0, y: 0 }, E.face]]);
  }

  private winter(rig: Rig, end: number): void {
    const s = SCORES.winter;
    const z = SNEEZE;
    const g = this.geo;
    const R = PROP_R.winter;
    const id = `s${++uid}`;
    // the snowfall: far flakes behind him, near ones over him (on the left, never over his face)
    SNOW.forEach((f, i) => {
      const radius = FLAKE_R[f.kind] * f.scale;
      const el = this.addProp(f.depth === 'far' ? rig.far : rig.near, `s-flake s-${f.kind}`, flakeMarkup(f.kind, `${id}-s${i}`), f.scale, f.fade);
      const { move } = this.driftTracks(el, `snow${i}`, driftKeys(this.pass(f, radius, end)), false);
      this.props.push({ name: `snow${i}`, kind: f.kind, layer: f.depth, move, under: null, radius, rides: false });
    });

    // his body: "ah… ah…" (rises a little, twice), "choo!" (a quick nod down), back with a spring
    const body = this.track(rig.tilt, 'sneeze', { y: 0 });
    this.sneeze = body;
    body.path(z.ah, [
      [z.ah + 0.2, { y: -1.6 }, E.inOut],
      [z.ah + 0.29, { y: -1.1 }, E.inOut],
      [z.choo, { y: -3 }, E.inOut],
      [z.choo + 0.07, { y: 5.5 }, E.in],
      [z.choo + 0.5, { y: 0 }, E.spring],
    ]);
    const bodyY = (t: number) => body.sample(t).y ?? 0;

    // the flake: floats down onto his nose (the nose: y -86 … -80; its lower half shows through the arms, so
    // the twitch reads), riding along with the face's glances
    const nose: Vec = { x: 1.2, y: -87.4 };
    const face = (t: number) => this.faceAt(t);
    const landFace = face(s.land);
    const restR = 8;
    const to = toHost(g, { x: nose.x + landFace.x, y: nose.y + landFace.y });
    const fall = driftKeys({
      t0: s.enter, t1: s.land, from: { x: to.x, y: -(R * g.u) - 3 }, to, swing: 12, halves: 3, phase: Math.PI / 2,
      hover: 0.35, rock: 14, rest: restR, settle: true, roll: 28, rollPhase: 0.7, pitch: 0.12,
    });
    const el = this.addProp(rig.near, 's-flake s-hero', flakeMarkup('hero', `${id}-h`), FLAKE_SCALE);
    const first = fall[0]!;
    const prop = this.track(el, 'flake', { ...toLocal(g, first.p), r: first.r, sx: first.sx, sy: first.sy, o: 1 });
    this.hero = { name: 'flake', kind: 'hero', layer: 'near', move: prop, under: null, radius: R, rides: false };
    this.props.push(this.hero);
    this.keys(prop, s.enter, fall.slice(1).map((k) => ({ t: k.t, v: { ...toLocal(g, k.p), r: k.r, sx: k.sx, sy: k.sy, o: 1 } })));

    // the nose: the approved sniffle under it, then wrinkled for "ah… ah…", one sharp twitch on "choo!"
    const noseT = this.track(rig.nose, 'nose', CALM);
    const tw: Key[] = [];
    for (let i = 1; i <= 6; i++) tw.push([z.twitch + i * TWITCH_HALF, i % 2 ? TWITCH : CALM, 'ease-in-out']);
    noseT.path(z.twitch, tw);
    noseT.path(z.ah, [
      [z.ah + 0.16, { y: 0.3, sx: 1.06, sy: 0.86 }, E.inOut],
      [z.choo - 0.02, { y: 0.36, sx: 1.08, sy: 0.83 }, E.inOut],
      [z.choo + 0.05, { y: 0.5, sx: 1.12, sy: 0.78 }, E.in],
      [z.choo + 0.24, CALM, E.out],
    ]);

    // it rides his nose (each twitch hops it a little and rocks it, left / right in turn) and his nod
    const ride: Array<{ t: number; v: ChannelInput }> = [];
    const n = Math.round((z.choo - s.land) * FPS * 2);
    for (let i = 1; i <= n; i++) {
      const t = s.land + ((z.choo - s.land) * i) / n;
      const f = face(t);
      const k = (1 - (noseT.sample(t).sy ?? 1)) / (1 - (TWITCH.sy ?? 0.82));
      const side = Math.floor((t - z.twitch) / (2 * TWITCH_HALF)) % 2 ? -1 : 1;
      const rock = t < z.ah ? side * 6 * k : 2 * k;
      ride.push({ t, v: { x: nose.x + f.x, y: nose.y + f.y - 1.1 * k + bodyY(t), r: restR + rock, sx: 1, sy: 1, o: 1 } });
    }
    this.keys(prop, s.land, ride);
    // "choo!": blown up and away (fast, then floating), turning, melting in the air (opacity only)
    const p0 = ride[ride.length - 1]?.v ?? { x: nose.x, y: nose.y, r: restR };
    const away: Array<{ t: number; v: ChannelInput }> = [];
    const m = Math.round((s.gone - z.choo) * FPS * 2);
    for (let i = 1; i <= m; i++) {
      const q = i / m;
      const e1 = 1 - (1 - q) ** 2;
      const e2 = 1 - (1 - q) ** 3;
      away.push({
        t: z.choo + (s.gone - z.choo) * q,
        v: { x: (p0.x ?? 0) + 34 * e1 + 3 * Math.sin(q * Math.PI * 1.5), y: (p0.y ?? 0) - 100 * e2, r: (p0.r ?? 0) + 140 * e1, sx: 1 + 0.12 * q, sy: 1 + 0.12 * q, o: 1 - smoothstep((q - 0.4) / 0.6) },
      });
    }
    this.keys(prop, z.choo, away);

    // three little puffs from the nose on "choo!"
    // tinted, with a rim: white puffs vanish on his cream muzzle
    const puff = '<circle r="3.3" fill="#EEF5FC" stroke="#7FA6CF" stroke-opacity=".9" stroke-width=".8"/>';
    const fc = face(z.choo);
    const from: Vec = { x: nose.x + fc.x, y: nose.y + fc.y + 4 + bodyY(z.choo + 0.07) };
    [{ x: -15, y: 5 }, { x: 0.5, y: 12 }, { x: 15.5, y: 4 }].forEach((dlt, i) => {
      const pel = this.addProp(rig.near, 's-puff', puff, 1);
      const pt = this.track(pel, `puff${i}`, { x: from.x, y: from.y, s: 0.4, o: 0 });
      pt.path(z.choo + 0.02 + i * 0.015, [
        [z.choo + 0.09 + i * 0.015, { x: from.x + dlt.x * 0.3, y: from.y + dlt.y * 0.3, s: 0.85, o: 0.95 }, E.out],
        [z.choo + 0.42 + i * 0.02, { x: from.x + dlt.x, y: from.y + dlt.y, s: 1.5, o: 0 }, E.out],
      ]);
      this.props.push({ name: `puff${i}`, kind: 'puff', layer: 'near', move: pt, under: null, radius: 3.7, rides: false });
    });

    // the eyes: cross-eyed at the flake on his nose; squeeze on "ah… ah…", shut on "choo!", open again
    const cross = 3.2;
    const eyeL = this.track(rig.eyeL, 'eyeL', { x: 0, y: 0 });
    const eyeR = this.track(rig.eyeR, 'eyeR', { x: 0, y: 0 });
    this.cross = eyeL;
    for (const [tr, sg] of [[eyeL, 1], [eyeR, -1]] as const) {
      tr.path(z.cross, [
        [z.cross + 0.24, { x: sg * cross, y: 1.2 }, E.face],
        [z.choo, { x: sg * (cross + 0.4), y: 1.4 }, E.inOut],
        [z.choo + 0.34, { x: 0, y: 0 }, E.inOut],
      ]);
    }
    const eyes = this.track(rig.eyes, 'eyes', { x: 0, y: 0, sy: 1 });
    this.eyes = eyes;
    eyes.path(z.ah, [
      [z.ah + 0.18, { sy: 0.6 }, E.inOut],
      [z.ah + 0.29, { sy: 0.74 }, E.inOut],
      [z.choo - 0.02, { sy: 0.4 }, E.inOut],
      [z.choo + 0.05, { sy: 0.1 }, E.in],
      [z.choo + 0.2, { sy: 0.12 }, 'linear'],
      [z.choo + 0.32, { sy: 1 }, E.out],
    ]);
    // the mouth opens a little for "ah… ah…" and shuts on "choo!"
    const mouth = this.track(rig.mouth, 'mouth', { o: 0 });
    mouth.path(z.ah + 0.04, [[z.ah + 0.14, { o: 0.9 }, E.out], [z.choo - 0.03, { o: 1 }, 'linear'], [z.choo + 0.03, { o: 0 }, E.in]]);
  }

  /**
   * The season's tracks join the stage's own timeline (start pose inline), at the moment the stage is at and
   * running when it runs — so play / seek / pause / parking off-screen move everything as one.
   */
  private inject(playhead: Playhead): void {
    const ms = this.time * 1000;
    const run = this.playing && !(this.stage?.suspended ?? false);
    for (const t of this.tracks) {
      const base = t.baseStyle();
      for (const el of t.els) {
        const st = (el as SVGElement).style;
        if (base.transform !== undefined) st.transform = base.transform;
        if (base.opacity !== undefined) st.opacity = base.opacity;
      }
      for (const c of t.compile()) playhead.addAt(c, 'season', ms, run);
    }
  }
}
