/**
 * Small path helpers for things drawn ON the puppet (fur, worn items) in its own units (x = 0 centre line, y = 0
 * feet). Absolute M / L / C / Q / Z only, so every number pair of a path is a point (tests check bounds that way).
 * Moved from the gallery's costume rig (demo/costumes/rig.ts, 31.10) when the fluffy cheeks and the Sammlung outfits
 * came into the app; the gallery imports them from here. No DOM, no imports: safe for every chunk.
 */

export type Pt = readonly [number, number];

export const f = (v: number) => String(Math.round(v * 100) / 100);

/** An ellipse as four cubics, rotated by `rot` degrees about its centre. */
export function ell(cx: number, cy: number, rx: number, ry = rx, rot = 0): string {
  const k = 0.5523;
  const r = (rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const P = (x: number, y: number) => `${f(cx + x * c - y * s)} ${f(cy + x * s + y * c)}`;
  return `M${P(rx, 0)} C${P(rx, ry * k)} ${P(rx * k, ry)} ${P(0, ry)} C${P(-rx * k, ry)} ${P(-rx, ry * k)} ${P(-rx, 0)} C${P(-rx, -ry * k)} ${P(-rx * k, -ry)} ${P(0, -ry)} C${P(rx * k, -ry)} ${P(rx, -ry * k)} ${P(rx, 0)} Z`;
}

/** A rounded rectangle (corner radius r) as a path. */
export function rrect(x: number, y: number, w: number, h: number, r: number): string {
  const q = Math.min(r, w / 2, h / 2);
  const k = q * 0.4477;
  return `M${f(x + q)} ${f(y)} L${f(x + w - q)} ${f(y)} C${f(x + w - k)} ${f(y)} ${f(x + w)} ${f(y + k)} ${f(x + w)} ${f(y + q)} L${f(x + w)} ${f(y + h - q)} C${f(x + w)} ${f(y + h - k)} ${f(x + w - k)} ${f(y + h)} ${f(x + w - q)} ${f(y + h)} L${f(x + q)} ${f(y + h)} C${f(x + k)} ${f(y + h)} ${f(x)} ${f(y + h - k)} ${f(x)} ${f(y + h - q)} L${f(x)} ${f(y + q)} C${f(x)} ${f(y + k)} ${f(x + k)} ${f(y)} ${f(x + q)} ${f(y)} Z`;
}

/** A closed polygon. */
export function poly(pts: readonly Pt[]): string {
  return `M${pts.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L')} Z`;
}

function wrap(pts: readonly Pt[], i: number): Pt {
  const n = pts.length;
  return pts[((i % n) + n) % n] as Pt;
}

/** A soft closed shape through key points (Catmull-Rom as cubics, like Krümel's kit). */
export function smooth(pts: readonly Pt[]): string {
  const segs = pts.map((_, i) => {
    const [p0, p1, p2, p3] = [wrap(pts, i - 1), wrap(pts, i), wrap(pts, i + 1), wrap(pts, i + 2)];
    return ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  });
  const s = wrap(pts, 0);
  return `M${f(s[0])} ${f(s[1])}${segs.join('')} Z`;
}

/** An open soft line through points (Catmull-Rom, ends clamped) — for outline strokes of fur. */
export function line(pts: readonly Pt[]): string {
  const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))] as Pt;
  let d = `M${f(at(0)[0])} ${f(at(0)[1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

/** Mirrors points across the centre line (and reverses them, so a mirrored outline keeps its direction). */
export function mirror(pts: readonly Pt[]): Pt[] {
  return pts.map(([x, y]): Pt => [-x, y]).reverse();
}

/** Mirrors every x of a path (absolute commands only). */
export function flipX(d: string): string {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, (m) => (i++ % 2 === 0 ? f(-Number(m)) : m));
}

/** Moves a path (absolute commands only). */
export function shift(d: string, dx: number, dy: number): string {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, (m) => f(Number(m) + (i++ % 2 === 0 ? dx : dy)));
}

/** transform-origin of a moving part in puppet units (with transform-box: view-box). */
export const at = (x: number, y: number) => `style="transform-origin: ${f(x)}px ${f(y)}px"`;
