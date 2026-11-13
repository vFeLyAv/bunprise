/**
 * Small pure helpers of the comic «Pompon & Tapsi» (moved here from the gallery prototype demo/story/, 31.10 — one
 * source of truth for the app and the gallery): deterministic randomness, star paths, smooth ways through points, the
 * roll's keys and the reading line. No DOM, no state.
 */

export type Pt = readonly [number, number];

/** Deterministic pseudo-random 0..1 (no Math.random: a still is the same every time). */
export function rnd(i: number, salt = 0): number {
  const v = Math.sin((i + 1) * 9301 + salt * 49297) * 233280;
  return v - Math.floor(v);
}

/** A five-point star path centred on (cx, cy). */
export function starPath(cx: number, cy: number, r: number, inner = r * 0.48, points = 5): string {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? inner : r;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    out.push(`${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${out.join(' L')} Z`;
}

/**
 * A smooth way through points (Catmull-Rom as cubic Béziers): piece i runs from pts[i] to pts[i + 1] with the same
 * tangent on both sides of every joint, so pieces drawn separately meet without a kink.
 */
export function smoothPieces(pts: readonly Pt[]): Array<[Pt, Pt, Pt, Pt]> {
  const at = (i: number): Pt => pts[Math.max(0, Math.min(pts.length - 1, i))] ?? [0, 0];
  const out: Array<[Pt, Pt, Pt, Pt]> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    out.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
  }
  return out;
}

/** A point on a cubic piece at k (0..1). */
export function onCubic([a, b, c, d]: readonly [Pt, Pt, Pt, Pt], k: number): [number, number] {
  const u = 1 - k;
  const w = [u * u * u, 3 * u * u * k, 3 * u * k * k, k * k * k] as const;
  return [w[0] * a[0] + w[1] * b[0] + w[2] * c[0] + w[3] * d[0], w[0] * a[1] + w[1] * b[1] + w[2] * c[1] + w[3] * d[1]];
}

/** The roll's way as smooth cubic pieces through the feet waypoints. */
export function wayPieces(points: readonly Pt[]): Array<[Pt, Pt, Pt, Pt]> {
  return smoothPieces(points);
}

/** Points along the way, evenly in arc length (dense sampling), each with its unit tangent. */
export function sampleWay(pieces: ReadonlyArray<readonly [Pt, Pt, Pt, Pt]>, step = 4): Array<{ x: number; y: number; tx: number; ty: number }> {
  const fine: Array<[number, number]> = [];
  pieces.forEach((piece, i) => {
    for (let j = i === 0 ? 0 : 1; j <= 40; j++) fine.push(onCubic(piece, j / 40));
  });
  const out: Array<{ x: number; y: number; tx: number; ty: number }> = [];
  let carry = 0;
  for (let i = 0; i < fine.length - 1; i++) {
    const [ax, ay] = fine[i] ?? [0, 0];
    const [bx, by] = fine[i + 1] ?? [0, 0];
    const len = Math.hypot(bx - ax, by - ay) || 1e-6;
    let d = i === 0 ? 0 : step - carry;
    while (d <= len) {
      const k = d / len;
      out.push({ x: ax + (bx - ax) * k, y: ay + (by - ay) * k, tx: (bx - ax) / len, ty: (by - ay) / len });
      d += step;
    }
    carry = len - (d - step);
  }
  return out;
}

export interface RollKey {
  t: number;
  x: number;
  y: number;
  spin: number;
  /** direction of travel (degrees, unwrapped) */
  dir: number;
}

/**
 * Keys of the roll: points along the way, evenly in HEIGHT (the reader scrolls in height, so he goes down at an
 * even pace on the page); the spin follows the distance rolled — clockwise going right, back going left — scaled
 * so that he lands upright.
 */
export function rollKeysFor(road: ReturnType<typeof sampleWay>, t0: number, t1: number, n = 28, radius = 64): RollKey[] {
  const ROAD = road;
  const [first] = ROAD;
  const last = ROAD[ROAD.length - 1];
  if (!first || !last) return [];
  // the spin rolled up to every dense sample
  const spins: number[] = [0];
  for (let i = 1; i < ROAD.length; i++) {
    const a = ROAD[i - 1];
    const b = ROAD[i];
    if (!a || !b) continue;
    const ds = Math.hypot(b.x - a.x, b.y - a.y);
    spins.push((spins[i - 1] ?? 0) + (Math.sign(b.tx) * ds * 180) / (Math.PI * radius));
  }
  const total = spins[spins.length - 1] ?? 0;
  const upright = Math.round(total / 360) * 360 || 360;
  const fit = upright / (total || 1);
  const out: RollKey[] = [];
  let j = 0;
  let prevDir = 0;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const y = first.y + (last.y - first.y) * u;
    while (j < ROAD.length - 1 && (ROAD[j + 1]?.y ?? Infinity) <= y) j++;
    const s = ROAD[j] ?? last;
    let dir = (Math.atan2(s.ty, s.tx) * 180) / Math.PI;
    while (dir - prevDir > 180) dir -= 360;
    while (dir - prevDir < -180) dir += 360;
    prevDir = dir;
    out.push({ t: t0 + (t1 - t0) * u, x: i === n ? last.x : s.x, y: i === n ? last.y : s.y, spin: (spins[j] ?? 0) * fit, dir });
  }
  const end = out[out.length - 1];
  if (end) end.spin = upright;
  return out;
}

/** Where the reader's eye is, as a share of the viewport height from its top. */
export const READ_AT = 0.5;

/**
 * World y at the reading line: `stripTop` = the strip's top relative to the scroller's viewport top (CSS px,
 * negative once scrolled past), `viewH` = the viewport height, `k` = the page's scale of the world.
 */
export function readLineY(stripTop: number, viewH: number, k: number): number {
  return (viewH * READ_AT - stripTop) / k;
}
