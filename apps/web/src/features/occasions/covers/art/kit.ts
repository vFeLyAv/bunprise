// The drawing kit of the cover motifs (ported from the gallery prototype packages/mascot/demo/covers/art.ts): a tiny
// SVG writer, the shared pieces (sky, table, grass, garlands, confetti, presents …) and the two small guests, Pompon
// and Tapsi, peeking over an edge. One chunk, shared by the sixteen motif chunks (./<motif>.ts).
//
// Colours only through the palette: `C.<key>` = `var(--cv-<key>)`, defined light AND dark in ../covers.css
// (light-dark() pairs, so the dark, "Blau" and "Ozean" themes recolour every picture at once). No text in a picture
// (nothing to translate), no ids, no links, nothing loaded — the art test proves it.
//
// Geometry: one canvas 480 × 320 shown with preserveAspectRatio="xMidYMid slice", so ONE drawing serves both places:
// the Start card's cover (16 : 7, the lower third dissolves into the card) and the occasion screen's hero (1 : 1.08,
// photo/coverGeometry.ts). The motif lives in the middle (x 120–360, y 60–212) and stands on the table line y = T.

/** Every colour a picture may use (each one a --cv-<key> variable in ../covers.css). */
export const PALETTE_KEYS = [
  'bg1', 'bg2', 'bg3', 'bg4', 'bg5', 'bg6', 'bg7', 'glow', 'table', 'shade', 'cream', 'paper', 'apricot',
  'orange', 'deep', 'rose', 'berry', 'blue', 'butter', 'green', 'leaf', 'lilac', 'teal', 'wood', 'charcoal',
  'ink', 'flame', 'white', 'fur', 'ear', 'earIn', 'eye', 'nose', 'mouth', 'paw', 'pawLine', 'cheek', 'ham',
  'hamLight', 'hamIn',
] as const
export type PaletteKey = (typeof PALETTE_KEYS)[number]

/** `var(--cv-<key>)` for every key — the only way a picture names a colour. */
export const C = Object.fromEntries(PALETTE_KEYS.map((key) => [key, `var(--cv-${key})`])) as Readonly<Record<PaletteKey, string>>

/** The background family of a picture: 1 apricot · 2 blush · 3 blue · 4 butter · 5 sage · 6 night · 7 lilac. */
export type CoverTone = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const VIEW_W = 480
export const VIEW_H = 320
/** the table / ground line every motif stands on */
export const T = 212

// ---- tiny SVG writer -------------------------------------------------------------------------------------------------

export type Attrs = Record<string, string | number | undefined>

export function num(v: number): string {
  return String(Math.round(v * 10) / 10)
}

export function tag(name: string, attrs: Attrs, inner?: string): string {
  let a = ''
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) a += ` ${k}="${typeof v === 'number' ? num(v) : v}"`
  return inner === undefined ? `<${name}${a}/>` : `<${name}${a}>${inner}</${name}>`
}

export const circle = (cx: number, cy: number, r: number, fill: string, more: Attrs = {}) => tag('circle', { cx, cy, r, fill, ...more })
export const ellipse = (cx: number, cy: number, rx: number, ry: number, fill: string, more: Attrs = {}) => tag('ellipse', { cx, cy, rx, ry, fill, ...more })
export const rect = (x: number, y: number, width: number, height: number, fill: string, rx?: number, more: Attrs = {}) =>
  tag('rect', { x, y, width, height, rx, fill, ...more })
export const path = (d: string, fill: string, more: Attrs = {}) => tag('path', { d, fill, ...more })
export const line = (d: string, color: string, width: number, more: Attrs = {}) =>
  tag('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...more })
export const group = (inner: string, transform?: string, more: Attrs = {}) => tag('g', { transform, ...more }, inner)
export const poly = (pts: readonly (readonly [number, number])[], fill: string, more: Attrs = {}) =>
  path(`M${pts.map(([x, y]) => `${num(x)} ${num(y)}`).join(' L')} Z`, fill, more)

/** A small deterministic random (mulberry32): the same picture every time. */
export function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- shared pieces ---------------------------------------------------------------------------------------------------

export function base(tone: CoverTone): string {
  // the evening sky gets only a faint light (a white glow would turn the navy grey)
  const night = tone === 6
  return rect(-20, -20, VIEW_W + 40, VIEW_H + 40, C[`bg${tone}` as PaletteKey]) + circle(110, 20, 200, C.glow, { opacity: night ? 0.18 : 1 }) + circle(450, 300, 160, C.glow, { opacity: night ? 0.1 : 0.6 })
}

export function table(): string {
  return rect(-20, T, VIEW_W + 40, VIEW_H - T + 20, C.table) + rect(-20, T, VIEW_W + 40, 2.5, C.glow)
}

export function grass(): string {
  let tufts = ''
  for (let x = -6; x < VIEW_W + 10; x += 23) {
    const h = 7 + ((x * 7) % 5)
    tufts += `M${num(x)} ${T + 2} l3 ${-h} l3 ${h} l3 ${-h + 2} l3 ${h - 2}`
  }
  return rect(-20, T, VIEW_W + 40, VIEW_H - T + 20, C.green, undefined, { opacity: 0.5 }) + path(tufts, C.green, { opacity: 0.9 })
}

export function shadow(cx: number, rx: number, y = T + 2): string {
  return ellipse(cx, y, rx, 5, C.shade)
}

export function sparkle(x: number, y: number, r: number, fill: string, opacity = 1): string {
  const s = r * 0.3
  return path(`M${num(x)} ${num(y - r)}L${num(x + s)} ${num(y - s)}L${num(x + r)} ${num(y)}L${num(x + s)} ${num(y + s)}L${num(x)} ${num(y + r)}L${num(x - s)} ${num(y + s)}L${num(x - r)} ${num(y)}L${num(x - s)} ${num(y - s)}Z`, fill, { opacity })
}

export function star5(cx: number, cy: number, r: number, fill: string): string {
  const pts: [number, number][] = []
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 === 0 ? r : r * 0.45
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  }
  return poly(pts, fill, { 'stroke-linejoin': 'round' })
}

export function heart(cx: number, cy: number, s: number, fill: string): string {
  return path(`M${num(cx)} ${num(cy + s)}C${num(cx - s * 1.6)} ${num(cy)} ${num(cx - s)} ${num(cy - s)} ${num(cx)} ${num(cy - s * 0.35)}C${num(cx + s)} ${num(cy - s)} ${num(cx + s * 1.6)} ${num(cy)} ${num(cx)} ${num(cy + s)}Z`, fill)
}

/** A rope from (-10, y0) to (490, y0) sagging by `sag` in the middle: the point and the slope at t. */
export function rope(y0: number, sag: number, t: number): { x: number; y: number; a: number } {
  const p0 = [-10, y0]
  const p1 = [240, y0 + 2 * sag]
  const p2 = [490, y0]
  const u = 1 - t
  const x = u * u * (p0[0] ?? 0) + 2 * u * t * (p1[0] ?? 0) + t * t * (p2[0] ?? 0)
  const y = u * u * (p0[1] ?? 0) + 2 * u * t * (p1[1] ?? 0) + t * t * (p2[1] ?? 0)
  const dx = 2 * u * ((p1[0] ?? 0) - (p0[0] ?? 0)) + 2 * t * ((p2[0] ?? 0) - (p1[0] ?? 0))
  const dy = 2 * u * ((p1[1] ?? 0) - (p0[1] ?? 0)) + 2 * t * ((p2[1] ?? 0) - (p1[1] ?? 0))
  return { x, y, a: Math.atan2(dy, dx) }
}

export function ropeLine(y0: number, sag: number): string {
  return line(`M-10 ${y0}Q240 ${y0 + 2 * sag} 490 ${y0}`, C.ink, 1.6, { opacity: 0.7 })
}

/** A pennant garland across the top. */
export function garland(y0: number, sag: number, colors: readonly string[], n = 13): string {
  let out = ropeLine(y0, sag)
  for (let i = 0; i < n; i += 1) {
    const { x, y, a } = rope(y0, sag, (i + 0.5) / n)
    const c = Math.cos(a)
    const s = Math.sin(a)
    const at = (px: number, py: number): [number, number] => [x + px * c - py * s, y + px * s + py * c]
    out += poly([at(-10, 0), at(10, 0), at(0, 21)], colors[i % colors.length] ?? C.rose)
  }
  return out
}

/** String lights across the top: round bulbs with a soft halo. */
export function bulbs(y0: number, sag: number, colors: readonly string[], n = 11): string {
  let out = ropeLine(y0, sag)
  for (let i = 0; i < n; i += 1) {
    const { x, y } = rope(y0, sag, (i + 0.5) / n)
    const col = colors[i % colors.length] ?? C.butter
    out += circle(x, y + 9, 13, col, { opacity: 0.22 }) + rect(x - 2.5, y, 5, 4, C.ink, 1, { opacity: 0.7 }) + circle(x, y + 9, 5.5, col)
  }
  return out
}

export type Box = readonly [number, number, number, number]

/** Confetti in a box, never over the motif's own middle (`keep`); `dotsOnly` = round flakes (snow). */
export function confetti(seed: number, count: number, box: Box, colors: readonly string[], keep?: Box, dotsOnly = false): string {
  const rnd = random(seed)
  let out = ''
  let placed = 0
  for (let guard = 0; placed < count && guard < count * 6; guard += 1) {
    const x = box[0] + rnd() * (box[2] - box[0])
    const y = box[1] + rnd() * (box[3] - box[1])
    const col = colors[Math.floor(rnd() * colors.length)] ?? C.rose
    const kind = rnd()
    const angle = Math.round(rnd() * 180)
    if (keep && x > keep[0] && x < keep[2] && y > keep[1] && y < keep[3]) continue
    placed += 1
    if (dotsOnly) out += circle(x, y, 1.6 + kind * 2.4, col, { opacity: 0.9 })
    else out += kind < 0.62 ? rect(x - 4, y - 1.6, 8, 3.2, col, 1.2, { transform: `rotate(${angle} ${num(x)} ${num(y)})` }) : circle(x, y, 2.6, col)
  }
  return out
}

export function flame(x: number, y: number, s = 1): string {
  const d = (k: number) =>
    `M${num(x)} ${num(y - 11 * s * k)}C${num(x + 6 * s * k)} ${num(y - 4 * s * k)} ${num(x + 5 * s * k)} ${num(y + 3 * s * k)} ${num(x)} ${num(y + 4 * s * k)}C${num(x - 5 * s * k)} ${num(y + 3 * s * k)} ${num(x - 6 * s * k)} ${num(y - 4 * s * k)} ${num(x)} ${num(y - 11 * s * k)}Z`
  return circle(x, y - 3 * s, 12 * s, C.flame, { opacity: 0.28 }) + path(d(1), C.flame) + path(d(0.55), C.butter)
}

/** A wrapped present standing on the table, its centre at x. */
export function present(x: number, w: number, h: number, box: string, ribbon: string, base = T): string {
  const top = base - h
  return (
    shadow(x, w * 0.6, base + 2) +
    rect(x - w / 2, top, w, h, box, 3) +
    rect(x - w / 2 - 2, top - 7, w + 4, 9, box, 3) +
    rect(x - w / 2 - 2, top - 7, w + 4, 3, C.white, 1.5, { opacity: 0.25 }) +
    rect(x - 3.5, top - 7, 7, h + 7, ribbon) +
    path(`M${num(x)} ${num(top - 7)}C${num(x - 6)} ${num(top - 19)} ${num(x - 17)} ${num(top - 17)} ${num(x - 14)} ${num(top - 10)}C${num(x - 12)} ${num(top - 6)} ${num(x - 5)} ${num(top - 7)} ${num(x)} ${num(top - 7)}Z`, ribbon) +
    path(`M${num(x)} ${num(top - 7)}C${num(x + 6)} ${num(top - 19)} ${num(x + 17)} ${num(top - 17)} ${num(x + 14)} ${num(top - 10)}C${num(x + 12)} ${num(top - 6)} ${num(x + 5)} ${num(top - 7)} ${num(x)} ${num(top - 7)}Z`, ribbon)
  )
}

/** A champagne flute standing at (x, base), tilted by `tilt` degrees around its foot. */
export function flute(x: number, base: number, tilt: number, drink: string): string {
  const g =
    ellipse(x, base - 1, 9, 2.6, C.cream, { opacity: 0.95 }) +
    rect(x - 1.2, base - 30, 2.4, 29, C.cream, 1) +
    path(`M${num(x - 9)} ${num(base - 76)}L${num(x + 9)} ${num(base - 76)}L${num(x + 6)} ${num(base - 34)}Q${num(x)} ${num(base - 28)} ${num(x - 6)} ${num(base - 34)}Z`, C.cream, { opacity: 0.7 }) +
    path(`M${num(x - 8.2)} ${num(base - 62)}L${num(x + 8.2)} ${num(base - 62)}L${num(x + 5.6)} ${num(base - 35)}Q${num(x)} ${num(base - 30)} ${num(x - 5.6)} ${num(base - 35)}Z`, drink) +
    circle(x - 2, base - 50, 1.3, C.white, { opacity: 0.8 }) +
    circle(x + 2.5, base - 42, 1, C.white, { opacity: 0.8 }) +
    rect(x - 6, base - 74, 2.5, 30, C.white, 1.2, { opacity: 0.4 })
  return group(g, `rotate(${tilt} ${num(x)} ${num(base)})`)
}

// ---- the small guests ---------------------------------------------------------------------------------------------

export interface Peek {
  /** drawn BEFORE the edge (the head behind it) */
  back: string
  /** drawn AFTER the edge (the paws gripping it) */
  front: string
}

/**
 * Pompon peeking over an edge at y = `edge` (the app icon's pose, in the mascot's own units: x = 0 the middle, the
 * edge line at y = −60; only the part of the head above the edge is drawn, so any edge colour works).
 */
export function pompon(x: number, edge: number, s: number, hat: 'party' | 'santa' | null = null): Peek {
  const at = `translate(${num(x)} ${num(edge + 60 * s)}) scale(${s})`
  const head =
    path('M-67 -60C-66 -72 -70 -92 -67 -112C-64 -140 -40 -163 0 -163C40 -163 64 -140 67 -112C70 -92 66 -72 67 -60Z', C.fur) +
    ellipse(-65, -82, 12, 19, C.fur) +
    ellipse(65, -82, 12, 19, C.fur) +
    ellipse(0, -70, 50, 14, C.white, { opacity: 0.35 }) +
    ellipse(-43, -81, 9, 5.5, C.cheek) +
    ellipse(43, -81, 9, 5.5, C.cheek) +
    ellipse(-29, -97, 8.3, 9.9, C.eye) +
    circle(-26, -101.8, 2.6, C.white) +
    circle(-32, -93.6, 1.1, C.white, { opacity: 0.7 }) +
    ellipse(29, -97, 8.3, 9.9, C.eye) +
    circle(32, -101.8, 2.6, C.white) +
    circle(26, -93.6, 1.1, C.white, { opacity: 0.7 }) +
    ellipse(-4.6, -80.6, 5.4, 4, C.white, { opacity: 0.9 }) +
    ellipse(4.6, -80.6, 5.4, 4, C.white, { opacity: 0.9 }) +
    path('M-3.6 -88Q0 -90 3.6 -88Q2.8 -84.8 0 -83.8Q-2.8 -84.8 -3.6 -88Z', C.nose) +
    line('M0 -83.8L0 -81.6M0 -81.6Q-2.2 -79.2 -4.6 -80.2M0 -81.6Q2.2 -79.2 4.6 -80.2', C.mouth, 1.4) +
    path('M-24 -160C-44 -170 -67 -155 -75 -128C-81 -107 -77 -86 -66 -83C-56 -81 -53 -96 -53 -111C-53 -129 -44 -145 -29 -151Z', C.ear) +
    path('M-29 -151C-44 -145 -53 -129 -53 -111C-53 -99 -55 -90 -61 -86C-58 -95 -57.5 -108 -58 -118C-58.5 -134 -50 -146 -37 -153Z', C.earIn, { opacity: 0.6 }) +
    path('M24 -160C44 -170 67 -155 75 -128C81 -107 77 -86 66 -83C56 -81 53 -96 53 -111C53 -129 44 -145 29 -151Z', C.ear) +
    path('M29 -151C44 -145 53 -129 53 -111C53 -99 55 -90 61 -86C58 -95 57.5 -108 58 -118C58.5 -134 50 -146 37 -153Z', C.earIn, { opacity: 0.6 })
  let cap = ''
  if (hat === 'party') {
    cap = group(
      path('M-24 -152L26 -152L4 -226Z', C.blue) +
        path('M-16.8 -176L18.6 -176L14 -190.5L-12.4 -190.5Z', C.butter) +
        path('M-7.7 -207L12 -207L8.6 -218L-4.5 -218Z', C.butter) +
        ellipse(1, -152, 26, 6, C.blue) +
        circle(4, -228, 9, C.berry),
      'rotate(10 0 -152)',
    )
  } else if (hat === 'santa') {
    cap = group(
      path('M-42 -150C-40 -196 -6 -214 30 -204C48 -199 60 -184 62 -168C52 -178 40 -184 30 -182C30 -170 34 -160 36 -150Z', C.berry) +
        rect(-50, -160, 92, 18, C.cream, 9) +
        circle(64, -164, 11, C.cream),
      'rotate(-8 0 -152)',
    )
  }
  const paws =
    ellipse(-25, -56, 13.3, 6.2, C.shade) +
    ellipse(-25, -61.5, 13, 10, C.paw) +
    line('M-30.5 -59.5v5.5M-25 -59.5v5.5M-19.5 -59.5v5.5', C.pawLine, 1.3) +
    ellipse(25, -56, 13.3, 6.2, C.shade) +
    ellipse(25, -61.5, 13, 10, C.paw) +
    line('M19.5 -59.5v5.5M25 -59.5v5.5M30.5 -59.5v5.5', C.pawLine, 1.3)
  return { back: group(head + cap, at), front: group(paws, at) }
}

/**
 * Tapsi (the golden hamster, coat "golden": a cream face with an apricot cap and apricot ears, like the puppet)
 * peeking over an edge at y = `edge`, the same units as Pompon.
 */
export function tapsi(x: number, edge: number, s: number): Peek {
  const at = `translate(${num(x)} ${num(edge + 60 * s)}) scale(${s})`
  const head =
    circle(-42, -128, 16, C.ham) +
    circle(-42, -128, 8.5, C.hamIn) +
    circle(42, -128, 16, C.ham) +
    circle(42, -128, 8.5, C.hamIn) +
    path('M-62 -60C-64 -104 -40 -140 0 -140C40 -140 64 -104 62 -60Z', C.hamLight) +
    path('M-56 -96C-50 -124 -28 -140 0 -140C28 -140 50 -124 56 -96C44 -110 30 -116 16 -112C10 -120 -10 -120 -16 -112C-30 -116 -44 -110 -56 -96Z', C.ham) +
    ellipse(-37, -78, 9, 6, C.cheek) +
    ellipse(37, -78, 9, 6, C.cheek) +
    ellipse(-23, -102, 6.6, 7.8, C.eye) +
    circle(-21, -105.5, 2.1, C.white) +
    ellipse(23, -102, 6.6, 7.8, C.eye) +
    circle(25, -105.5, 2.1, C.white) +
    ellipse(0, -88, 4.6, 3.4, C.hamIn) +
    line('M0 -84.6V-82M0 -82Q-3 -79 -6 -80.5M0 -82Q3 -79 6 -80.5', C.mouth, 1.5)
  const paws =
    ellipse(-21, -56, 11, 5.5, C.shade) +
    ellipse(-21, -61, 11, 8.5, C.hamLight) +
    line('M-25 -59.5v4M-21 -59.5v4M-17 -59.5v4', C.pawLine, 1.2) +
    ellipse(21, -56, 11, 5.5, C.shade) +
    ellipse(21, -61, 11, 8.5, C.hamLight) +
    line('M17 -59.5v4M21 -59.5v4M25 -59.5v4', C.pawLine, 1.2)
  return { back: group(head, at), front: group(paws, at) }
}

// ---- the sixteen pictures ---------------------------------------------------------------------------------------------

export const PARTY_COLORS = [C.rose, C.blue, C.butter, C.green, C.orange, C.lilac]

export function balloon(x: number, y: number, r: number, fill: string, toX: number): string {
  const knot = y + r * 1.18
  return (
    line(`M${num(x)} ${num(knot)}C${num(x - 8)} ${num(knot + 40)} ${num(toX + 10)} ${num(T - 50)} ${num(toX)} ${num(T)}`, C.ink, 1.3, { opacity: 0.6 }) +
    ellipse(x, y, r, r * 1.18, fill) +
    ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.34, C.white, { opacity: 0.45, transform: `rotate(28 ${num(x - r * 0.38)} ${num(y - r * 0.42)})` }) +
    path(`M${num(x)} ${num(knot - 2)}L${num(x - 4)} ${num(knot + 5)}L${num(x + 4)} ${num(knot + 5)}Z`, fill)
  )
}
