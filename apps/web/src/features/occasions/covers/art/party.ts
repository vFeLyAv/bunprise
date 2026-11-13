// The "party" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, circle, ellipse, rect, path, line, group, base, table, shadow, sparkle, bulbs, confetti, flute, PARTY_COLORS, C } from './kit'

export default function party(): string {
  let facets = ''
  const colors = [C.blue, C.cream, C.lilac, C.blue, C.white]
  for (let i = -4; i <= 4; i += 1) {
    for (let j = -4; j <= 4; j += 1) {
      const fx = 240 + j * 10
      const fy = 106 + i * 10
      if (Math.hypot(fx - 240, fy - 106) > 36) continue
      facets += rect(fx - 4.2, fy - 4.2, 8.4, 8.4, colors[(i * 3 + j * 7 + 40) % colors.length] ?? C.blue, 1.5, { opacity: 0.85 })
    }
  }
  const popper = group(
    path('M296 212L280 160L318 154Z', C.orange) + path('M291.5 197L286 179L306 176Z', C.butter, { opacity: 0.9 }) + ellipse(299, 157, 19.5, 5, C.deep, { transform: 'rotate(-9 299 157)' }),
  )
  const burst = [
    [262, 120], [276, 108], [296, 100], [318, 106], [336, 120], [270, 136], [330, 140],
  ]
    .map(([x, y], i) => (i % 2 ? circle(x ?? 0, y ?? 0, 3, PARTY_COLORS[i % 6] ?? C.rose) : rect((x ?? 0) - 4, (y ?? 0) - 1.6, 8, 3.2, PARTY_COLORS[i % 6] ?? C.rose, 1.2, { transform: `rotate(${i * 37} ${x} ${y})` })))
    .join('')
  return (
    base(2) +
    bulbs(14, 22, [C.butter, C.rose, C.blue, C.green, C.lilac]) +
    line('M48 40C70 70 30 90 52 120S40 160 60 190', C.rose, 4) +
    line('M430 44C410 74 448 96 426 126S444 162 420 192', C.butter, 4) +
    confetti(3, 30, [10, 40, 470, 200], PARTY_COLORS, [170, 50, 340, 212]) +
    line('M240 -10V66', C.ink, 1.5, { opacity: 0.7 }) +
    rect(233, 62, 14, 8, C.charcoal, 2) +
    circle(240, 106, 38, C.blue) +
    facets +
    circle(226, 92, 9, C.white, { opacity: 0.65 }) +
    sparkle(188, 78, 9, C.butter) +
    sparkle(296, 88, 7, C.white) +
    sparkle(300, 140, 5, C.butter) +
    sparkle(180, 132, 5, C.white) +
    table() +
    shadow(186, 24) +
    flute(178, T, 9, C.butter) +
    flute(198, T, -9, C.butter) +
    shadow(298, 20) +
    popper +
    burst
  )
}
