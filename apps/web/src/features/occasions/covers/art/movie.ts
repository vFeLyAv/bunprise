// The "movie" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, circle, rect, path, line, group, poly, base, table, shadow, sparkle, star5, C } from './kit'

export default function movie(): string {
  let holes = ''
  for (let x = -20; x < 520; x += 22) holes += rect(x, 20, 9, 6, C.cream, 1.5) + rect(x, 46, 9, 6, C.cream, 1.5)
  let frames = ''
  for (let x = -14; x < 520; x += 66) frames += rect(x, 29, 54, 14, C.blue, 2, { opacity: 0.5 })
  const stripe = (k: number) => {
    const t0 = k / 6
    const t1 = (k + 1) / 6
    return poly([[200 + 80 * t0, 124], [200 + 80 * t1, 124], [214 + 52 * t1, T], [214 + 52 * t0, T]], C.berry)
  }
  const corn = [
    [210, 114, 12], [227, 104, 13], [246, 106, 14], [264, 112, 12], [220, 92, 10], [238, 88, 11], [255, 94, 10], [232, 76, 8], [276, 120, 8], [204, 122, 8],
  ]
    .map(([x, y, r], i) => circle(x ?? 0, y ?? 0, r ?? 0, i % 3 === 2 ? C.butter : C.cream))
    .join('')
  const clap =
    group(rect(118, 160, 66, 52, C.charcoal, 4) + rect(124, 176, 54, 3, C.cream, 1, { opacity: 0.35 }) + rect(124, 186, 34, 3, C.cream, 1, { opacity: 0.35 }) + rect(118, 148, 66, 12, C.charcoal, 2) + path('M126 148h10l-6 12h-10zM146 148h10l-6 12h-10zM166 148h10l-6 12h-10z', C.cream) , `rotate(-6 150 ${T})`)
  const clapTop = group(rect(118, 136, 66, 12, C.charcoal, 2) + path('M128 136h10l-6 12h-10zM148 136h10l-6 12h-10zM168 136h10l-6 12h-10z', C.cream), 'rotate(-22 118 146)')
  const ticket = (x: number, y: number, a: number) =>
    group(rect(x, y, 58, 28, C.butter, 4) + line(`M${x + 40} ${y + 4}V${y + 24}`, C.deep, 1.6, { 'stroke-dasharray': '2 3', opacity: 0.7 }) + star5(x + 20, y + 14, 7, C.deep), `rotate(${a} ${x + 29} ${y + 14})`)
  return (
    base(3) +
    group(rect(-30, 14, 540, 44, C.charcoal, 0, { opacity: 0.85 }) + frames + holes, 'rotate(-4 240 36)') +
    sparkle(98, 104, 7, C.butter) +
    sparkle(392, 98, 8, C.butter) +
    sparkle(360, 140, 5, C.white) +
    table() +
    shadow(240, 46) +
    corn +
    poly([[200, 124], [280, 124], [266, T], [214, T]], C.cream) +
    stripe(0) + stripe(2) + stripe(4) +
    rect(196, 118, 88, 10, C.cream, 4) +
    rect(196, 118, 88, 3, C.white, 1.5, { opacity: 0.6 }) +
    shadow(150, 40) +
    clap +
    clapTop +
    ticket(310, 150, 14) +
    ticket(330, 178, -8)
  )
}
