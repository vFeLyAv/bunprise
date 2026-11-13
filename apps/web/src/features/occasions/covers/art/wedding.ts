// The "wedding" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, num, circle, ellipse, path, line, base, table, shadow, sparkle, heart, confetti, flute, C } from './kit'

export default function wedding(): string {
  const cx = 240
  const rx = 108
  const ry = 150
  let leaves = ''
  let flowers = ''
  const n = 26
  for (let i = 0; i <= n; i += 1) {
    const a = Math.PI - (i / n) * Math.PI
    const x = cx + rx * Math.cos(a)
    const y = T - ry * Math.sin(a)
    const tangent = (Math.atan2(-ry * Math.cos(a), -rx * Math.sin(a)) * 180) / Math.PI
    const side = i % 2 ? 1 : -1
    leaves += ellipse(x + side * 6, y, 10, 4.5, i % 3 ? C.green : C.leaf, { transform: `rotate(${num(tangent + side * 35)} ${num(x + side * 6)} ${num(y)})` })
    if (i % 3 === 1) {
      const col = [C.rose, C.cream, C.butter, C.berry][Math.floor(i / 3) % 4] ?? C.rose
      flowers += circle(x, y, 9, col) + circle(x, y, 3.5, i % 2 ? C.butter : C.deep)
    }
  }
  const petals = confetti(11, 16, [20, 20, 460, 190], [C.rose, C.white, C.rose], [120, 50, 360, 212])
  return (
    base(2) +
    petals +
    table() +
    line(`M${cx - rx} ${T}A${rx} ${ry} 0 0 1 ${cx + rx} ${T}`, C.cream, 7, { opacity: 0.85 }) +
    leaves +
    flowers +
    heart(240, 102, 10, C.berry) +
    circle(226, 150, 21, 'none', { stroke: C.butter, 'stroke-width': 6.5 }) +
    circle(254, 150, 21, 'none', { stroke: C.butter, 'stroke-width': 6.5 }) +
    path('M244.5 132.5A21 21 0 0 1 247 145', 'none', { stroke: C.butter, 'stroke-width': 6.5 }) +
    path('M226 121L233 129L226 135L219 129Z', C.white) +
    path('M226 125L229.5 129L226 132L222.5 129Z', C.blue, { opacity: 0.7 }) +
    sparkle(206, 122, 5, C.white) +
    sparkle(276, 176, 4, C.white) +
    shadow(96, 22) +
    flute(90, T, 6, C.butter) +
    shadow(388, 22) +
    flute(392, T, -6, C.butter)
  )
}
