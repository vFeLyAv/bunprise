// The "birthday" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, circle, ellipse, rect, base, table, shadow, garland, confetti, flame, present, pompon, PARTY_COLORS, balloon, C } from './kit'

export default function birthday(): string {
  const guest = pompon(352, T, 0.42, 'party')
  const candles = [C.blue, C.butter, C.green, C.rose, C.lilac]
    .map((col, i) => {
      const x = 202 + i * 19
      return rect(x - 3.5, 120, 7, 30, col, 3.5) + rect(x - 3.5, 128, 7, 3, C.white, 0, { opacity: 0.45 }) + flame(x, 110, 0.8)
    })
    .join('')
  return (
    base(1) +
    garland(18, 26, PARTY_COLORS) +
    confetti(7, 26, [10, 50, 470, 175], PARTY_COLORS, [150, 90, 330, 212]) +
    balloon(80, 104, 27, C.rose, 96) +
    balloon(126, 78, 24, C.blue, 112) +
    balloon(404, 92, 26, C.butter, 392) +
    balloon(446, 128, 20, C.green, 430) +
    guest.back +
    table() +
    guest.front +
    present(112, 40, 30, C.blue, C.butter) +
    shadow(240, 92) +
    ellipse(240, T, 88, 7, C.cream) +
    rect(178, 158, 124, 54, C.cream, 10) +
    rect(178, 186, 124, 7, C.rose, 0, { opacity: 0.55 }) +
    rect(174, 148, 132, 18, C.rose, 9) +
    [188, 210, 234, 258, 282].map((x, i) => circle(x + (i % 2) * 3, 166, 6.5 + (i % 2), C.rose)).join('') +
    rect(184, 151, 40, 4, C.white, 2, { opacity: 0.4 }) +
    candles
  )
}
