/**
 * Lists buddy (gallery prototype, Felix 25.10) — the pure physics: no DOM, no timers, deterministic.
 * Units: CSS px of the stage's content box and seconds. y grows downwards (like the screen).
 *
 * - Floors are ONE-WAY platforms (the top edges of the stats row and of the wishlist cards, plus the ground):
 *   the buddy passes them going up and lands on them only when he falls onto them from above.
 * - While held he is a point mass on a rod hanging from the finger (Verlet + a distance constraint), so he
 *   swings behind the finger like Google Maps' pegman without any noisy acceleration estimate.
 * - Thrown, his body is a circle (centre + radius) with gravity, a spin that follows the sideways speed, and
 *   soft bounces off the screen's sides and top.
 */

export interface Floor {
  /** 'ground', 'stats', 'card-0' … */
  id: string;
  /** y of the walking line (the top edge of the surface). */
  y: number;
  x0: number;
  x1: number;
  /** Index of the wishlist card this floor belongs to (inspect target), if any. */
  card?: number;
}

export interface World {
  width: number;
  /** Ceiling (usually 0 = the top of the content). */
  top: number;
  /** Ground line (the lowest floor; it always exists and spans the whole width). */
  bottom: number;
  floors: readonly Floor[];
  /** px / s² */
  gravity: number;
}

/** A flying body: centre, velocity, rotation (rad), spin (rad/s), radius. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  r: number;
}

export const GRAVITY = 2300;
/** How bouncy the screen's sides and top are (0 = dead, 1 = perfect). */
export const WALL_RESTITUTION = 0.48;
export const CEILING_RESTITUTION = 0.35;
/** Fastest throw we accept (px/s): faster flicks are clamped, so he never vanishes in one frame. */
export const MAX_THROW = 2400;

/** A box that covers what lies under it (the app's sticky "Meine · Freunde" switch), in content px. */
export interface Ceiling {
  top: number;
  bottom: number;
  x0: number;
  x1: number;
}

/**
 * The floors he can stand on: none where a ceiling hangs into his standing room (`room` px above the walking line)
 * — he would stand half hidden behind it (Felix 25.10: the switch covered the bunny on the first row of cards).
 * Such a floor is not a floor at all: he does not walk, land or inspect there.
 */
export function roomyFloors(floors: readonly Floor[], ceilings: readonly Ceiling[], room: number): Floor[] {
  return floors.filter((f) => !ceilings.some((c) => c.x0 < f.x1 && c.x1 > f.x0 && c.top < f.y && c.bottom > f.y - room));
}

export function groundFloor(world: Pick<World, 'width' | 'bottom'>): Floor {
  return { id: 'ground', y: world.bottom, x0: 0, x1: world.width };
}

/** Every floor including the ground, sorted from the top down. */
export function allFloors(world: World): Floor[] {
  const list = [...world.floors];
  if (!list.some((f) => f.id === 'ground')) list.push(groundFloor(world));
  return list.sort((a, b) => a.y - b.y);
}

/** The first floor at or below `y` whose span contains `x` (the ground at the latest). */
export function floorBelow(world: World, x: number, y: number): Floor {
  for (const f of allFloors(world)) if (f.y >= y - 0.5 && x >= f.x0 && x <= f.x1) return f;
  return groundFloor(world);
}

/** Keeps a walking target inside a floor (with a margin so he never stands half off its edge). */
export function clampToFloor(floor: Floor, x: number, margin: number): number {
  const lo = floor.x0 + margin;
  const hi = floor.x1 - margin;
  if (lo > hi) return (floor.x0 + floor.x1) / 2;
  return Math.min(hi, Math.max(lo, x));
}

// ---------- flight ----------

export interface FlightStep {
  body: Body;
  /** The floor he came down on during this step (his bottom is then exactly on it). */
  landed: Floor | null;
  /** He hit a side wall or the ceiling during this step (for a small sound / squash). */
  bumped: boolean;
}

/**
 * One step of a free flight. Floors are tested between the old and the new bottom of the circle, so a fast
 * fall never tunnels through a card. Sides and ceiling bounce; the spin flips (and loses some) on a wall.
 */
export function stepFlight(b: Body, world: World, dt: number): FlightStep {
  let { x, y, vx, vy, angle, spin } = b;
  const { r } = b;
  const prevBottom = y + r;
  vy += world.gravity * dt;
  x += vx * dt;
  y += vy * dt;
  angle += spin * dt;
  let bumped = false;
  if (x - r < 0) {
    x = r;
    vx = Math.abs(vx) * WALL_RESTITUTION;
    spin = -spin * 0.7;
    bumped = true;
  } else if (x + r > world.width) {
    x = world.width - r;
    vx = -Math.abs(vx) * WALL_RESTITUTION;
    spin = -spin * 0.7;
    bumped = true;
  }
  if (y - r < world.top) {
    y = world.top + r;
    vy = Math.abs(vy) * CEILING_RESTITUTION;
    bumped = true;
  }
  let landed: Floor | null = null;
  const bottom = y + r;
  if (vy > 0) {
    for (const f of allFloors(world)) {
      if (prevBottom <= f.y + 0.5 && bottom >= f.y && x >= f.x0 && x <= f.x1) {
        landed = f;
        y = f.y - r;
        break;
      }
    }
  }
  return { body: { x, y, vx, vy, angle, spin, r }, landed, bumped };
}

/** Runs a flight to its landing (tests, and the gallery's "where will he land" check). */
export function simulateFlight(start: Body, world: World, maxSeconds = 6, dt = 1 / 120): { body: Body; landed: Floor; seconds: number } {
  let body = start;
  for (let t = 0; t < maxSeconds; t += dt) {
    const step = stepFlight(body, world, dt);
    body = step.body;
    if (step.landed) return { body: { ...body, vx: body.vx, vy: body.vy }, landed: step.landed, seconds: t + dt };
  }
  const ground = groundFloor(world);
  return { body: { ...body, y: ground.y - body.r }, landed: ground, seconds: maxSeconds };
}

/** Spin for a throw: the faster sideways, the faster he tumbles (a rolling ball would spin vx / r). */
export function throwSpin(vx: number, r: number): number {
  return (vx / Math.max(1, r)) * 0.55;
}

/** How he comes down: softly on his feet, or tumbling (somersault, dizzy, angry). */
export type LandingKind = 'gentle' | 'tumble';

export function landingKind(vx: number, vy: number): LandingKind {
  return Math.hypot(vx, vy) < 640 && Math.abs(vx) < 300 ? 'gentle' : 'tumble';
}

// ---------- rolling after a tumble ----------

export interface Roll {
  x: number;
  /** signed speed along the floor (px/s) */
  v: number;
  angle: number;
}

export const ROLL_DECEL = 950;

/** Speed of the roll right after a tumbling landing (keeps the throw's direction; a straight drop picks one). */
export function rollStart(vx: number, fallback: 1 | -1): number {
  const dir = Math.abs(vx) > 20 ? Math.sign(vx) : fallback;
  return dir * Math.min(560, Math.max(140, Math.abs(vx) * 0.6));
}

export interface RollStep {
  roll: Roll;
  /** He rolled past the end of a card: he drops off and flies again with this speed. */
  offEdge: boolean;
  stopped: boolean;
}

/** One step of rolling along `floor`: friction, rotation = distance / radius, a soft stop at the screen's sides. */
export function stepRoll(roll: Roll, floor: Floor, world: World, r: number, dt: number): RollStep {
  const dir = Math.sign(roll.v);
  let v = roll.v - dir * ROLL_DECEL * dt;
  if (Math.sign(v) !== dir) v = 0;
  let x = roll.x + v * dt;
  if (x - r < 0) { x = r; v = 0; }
  if (x + r > world.width) { x = world.width - r; v = 0; }
  const angle = roll.angle + ((x - roll.x) / Math.max(1, r));
  const offEdge = floor.id !== 'ground' && (x < floor.x0 || x > floor.x1);
  return { roll: { x, v, angle }, offEdge, stopped: v === 0 && !offEdge };
}

/** Distance a roll covers before it stops (no edges). */
export function rollDistance(v: number): number {
  return (v * v) / (2 * ROLL_DECEL);
}

/** The nearest upright angle (a multiple of 2π) to stand up to — the shorter way round. */
export function uprightAngle(angle: number): number {
  return Math.round(angle / (2 * Math.PI)) * 2 * Math.PI;
}

// ---------- release ----------

export interface PointerSample {
  /** ms */
  t: number;
  x: number;
  y: number;
}

/** Velocity of the finger over its last ~90 ms (px/s), clamped to MAX_THROW. One sample = no throw. */
export function releaseVelocity(samples: readonly PointerSample[], now: number, windowMs = 90): { vx: number; vy: number } {
  const recent = samples.filter((s) => now - s.t <= windowMs);
  const first = recent[0];
  const last = recent[recent.length - 1];
  if (!first || !last || last.t - first.t < 8) return { vx: 0, vy: 0 };
  const dt = (last.t - first.t) / 1000;
  let vx = (last.x - first.x) / dt;
  let vy = (last.y - first.y) / dt;
  const speed = Math.hypot(vx, vy);
  if (speed > MAX_THROW) {
    vx *= MAX_THROW / speed;
    vy *= MAX_THROW / speed;
  }
  return { vx, vy };
}

// ---------- hopping between floors ----------

/** Take-off velocity for a hop from `from` to `to` (feet points) that lands there after `t` seconds. */
export function hopVelocity(from: { x: number; y: number }, to: { x: number; y: number }, gravity: number, t?: number): { vx: number; vy: number; t: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dur = t ?? Math.min(0.78, 0.4 + Math.abs(dx) / 900 + Math.max(0, -dy) / 700);
  return { vx: dx / dur, vy: (dy - 0.5 * gravity * dur * dur) / dur, t: dur };
}

/** Where a hop is after `s` seconds (feet point). */
export function hopPoint(from: { x: number; y: number }, v: { vx: number; vy: number }, gravity: number, s: number): { x: number; y: number } {
  return { x: from.x + v.vx * s, y: from.y + v.vy * s + 0.5 * gravity * s * s };
}

/**
 * The floors to hop through from `from` to `to` (both included, in order): a tiny hamster does not jump
 * 300 px up in one go, he climbs card by card. Only floors between them whose span holds `x` count.
 */
export function route(world: World, from: Floor, to: Floor, x: number, maxStep = 150): Floor[] {
  if (from.id === to.id) return [to];
  const down = to.y > from.y;
  const between = allFloors(world)
    .filter((f) => f.id !== from.id && f.id !== to.id && (down ? f.y > from.y && f.y < to.y : f.y < from.y && f.y > to.y))
    .filter((f) => x >= f.x0 && x <= f.x1)
    .sort((a, b) => (down ? a.y - b.y : b.y - a.y));
  const path: Floor[] = [];
  let at = from;
  for (const f of between) {
    if (Math.abs(f.y - at.y) >= maxStep * 0.45) {
      path.push(f);
      at = f;
    }
  }
  path.push(to);
  return path;
}

// ---------- held: the pendulum ----------

/** The body's centre of mass while held: current and previous position (Verlet) and the rod length. */
export interface Pendulum {
  x: number;
  y: number;
  px: number;
  py: number;
  len: number;
}

export function pendulumAt(pivot: { x: number; y: number }, len: number): Pendulum {
  return { x: pivot.x, y: pivot.y + len, px: pivot.x, py: pivot.y + len, len };
}

/**
 * One Verlet step: gravity pulls the mass down, the rod keeps it `len` from the finger, damping calms the
 * swing. The finger moving sideways drags the mass behind it — the swing comes out of the constraint alone.
 */
export function stepPendulum(p: Pendulum, pivot: { x: number; y: number }, gravity: number, dt: number, damping = 2.6): Pendulum {
  const keep = Math.max(0, 1 - damping * dt);
  let x = p.x + (p.x - p.px) * keep;
  let y = p.y + (p.y - p.py) * keep + gravity * dt * dt;
  const dx = x - pivot.x;
  const dy = y - pivot.y;
  const d = Math.hypot(dx, dy) || 1;
  x = pivot.x + (dx / d) * p.len;
  y = pivot.y + (dy / d) * p.len;
  return { x, y, px: p.x, py: p.y, len: p.len };
}

/** Angle of the rod from straight down (rad, positive = the body swings to the right). */
export function pendulumAngle(p: Pendulum, pivot: { x: number; y: number }): number {
  return Math.atan2(p.x - pivot.x, p.y - pivot.y);
}

export const MAX_SWING = (75 * Math.PI) / 180;
