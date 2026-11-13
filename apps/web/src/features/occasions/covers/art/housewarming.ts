// The "housewarming" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, circle, ellipse, rect, path, line, group, base, table, shadow, sparkle, heart, C } from './kit'

export default function housewarming(): string {
  const key = group(
    circle(0, 0, 11, 'none', { stroke: C.butter, 'stroke-width': 6 }) + rect(10, -3, 40, 6, C.butter, 3) + rect(38, 2, 5, 9, C.butter, 1.5) + rect(46, 2, 4, 7, C.butter, 1.5) + path('M-6 -10C-18 -22 -26 -8 -12 -6Z', C.berry) + path('M-6 -10C-4 -26 -18 -26 -14 -12Z', C.berry),
    'translate(352 92) rotate(-28)',
  )
  const box = (x: number, y: number, w: number, h: number, a: number) =>
    group(rect(x, y, w, h, C.wood, 3) + rect(x, y, w, 6, C.white, 2, { opacity: 0.18 }) + rect(x + w / 2 - 4, y, 8, h, C.paper, 0, { opacity: 0.55 }), `rotate(${a} ${x + w / 2} ${y + h})`)
  return (
    base(4) +
    sparkle(132, 70, 7, C.white) +
    sparkle(420, 150, 5, C.white) +
    sparkle(160, 40, 4, C.white, 0.8) +
    table() +
    shadow(240, 74) +
    rect(268, 80, 16, 34, C.deep, 2) +
    rect(182, 128, 116, 84, C.cream) +
    path('M166 134L240 70L314 134Z', C.deep) +
    path('M176 134L240 80L304 134Z', C.orange) +
    rect(166, 130, 148, 7, C.deep, 3.5) +
    path(`M226 ${T}V182A14 14 0 0 1 254 182V${T}Z`, C.wood) +
    circle(249, 194, 2.4, C.butter) +
    rect(196, 148, 22, 22, C.butter, 3) +
    line('M207 148V170M196 159H218', C.cream, 2.4) +
    rect(262, 148, 22, 22, C.butter, 3) +
    line('M273 148V170M262 159H284', C.cream, 2.4) +
    circle(240, 106, 9, C.butter) +
    line('M240 97V115M231 106H249', C.cream, 2) +
    heart(240, 166, 5, C.berry) +
    shadow(118, 36) +
    box(88, T - 38, 58, 38, 0) +
    box(98, T - 66, 40, 28, -5) +
    shadow(354, 24) +
    path(`M338 ${T - 30}H370L366 ${T}H342Z`, C.orange) +
    rect(335, T - 34, 38, 7, C.deep, 3) +
    ellipse(346, T - 52, 7, 18, C.green, { transform: `rotate(-24 346 ${T - 52})` }) +
    ellipse(362, T - 54, 7, 18, C.leaf, { transform: `rotate(22 362 ${T - 54})` }) +
    ellipse(354, T - 62, 7, 20, C.green) +
    key
  )
}
