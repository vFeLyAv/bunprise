// The "baby" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { num, circle, rect, path, line, group, base, table, shadow, sparkle, star5, heart, rope, ropeLine, C } from './kit'

export default function baby(): string {
  const onesie = (t: number, col: string) => {
    const { x, y } = rope(28, 26, t)
    return (
      path(`M${num(x - 18)} ${num(y)}L${num(x - 8)} ${num(y)}Q${num(x)} ${num(y + 7)} ${num(x + 8)} ${num(y)}L${num(x + 18)} ${num(y)}L${num(x + 24)} ${num(y + 12)}L${num(x + 14)} ${num(y + 17)}L${num(x + 13)} ${num(y + 38)}Q${num(x + 6)} ${num(y + 44)} ${num(x)} ${num(y + 44)}Q${num(x - 6)} ${num(y + 44)} ${num(x - 13)} ${num(y + 38)}L${num(x - 14)} ${num(y + 17)}L${num(x - 24)} ${num(y + 12)}Z`, col) +
      rect(x - 15, y - 4, 4, 9, C.wood, 1) +
      rect(x + 11, y - 4, 4, 9, C.wood, 1)
    )
  }
  const block = (x: number, y: number, a: number, col: string, mark: string) =>
    group(rect(x, y, 40, 40, C.cream, 6) + rect(x + 4, y + 4, 32, 32, col, 4, { opacity: 0.35 }) + mark, `rotate(${a} ${x + 20} ${y + 40})`)
  const cloud = (x: number, y: number, s: number) => group(circle(0, 0, 14, C.cream) + circle(16, -7, 17, C.cream) + circle(33, 0, 13, C.cream) + rect(-12, 0, 56, 13, C.cream, 6.5), `translate(${x} ${y}) scale(${s})`)
  return (
    base(7) +
    cloud(26, 120, 1) +
    cloud(404, 110, 0.9) +
    ropeLine(28, 26) +
    onesie(0.16, C.butter) +
    onesie(0.38, C.rose) +
    onesie(0.62, C.blue) +
    onesie(0.84, C.cream) +
    sparkle(170, 96, 6, C.white) +
    sparkle(320, 104, 5, C.white) +
    table() +
    shadow(240, 50) +
    block(198, 172, 0, C.berry, heart(218, 192, 7, C.berry)) +
    block(242, 172, 0, C.butter, star5(262, 193, 11, C.butter)) +
    block(221, 132, 6, C.blue, path('M246 144A11 11 0 1 0 246 164A8 8 0 1 1 246 144Z', C.blue)) +
    shadow(140, 18) +
    rect(126, 150, 28, 62, C.cream, 9) +
    rect(126, 178, 28, 34, C.white, 9, { opacity: 0.85 }) +
    line('M130 162H138M130 172H138M130 182H138', C.lilac, 1.6) +
    rect(123, 140, 34, 11, C.lilac, 3) +
    path('M131 140C131 128 136 118 140 118C144 118 149 128 149 140Z', C.butter) +
    shadow(336, 26) +
    group(rect(330, 166, 10, 44, C.rose, 5) + circle(335, 214, 8, 'none', { stroke: C.rose, 'stroke-width': 4 }), `rotate(28 335 190)`) +
    circle(318, 160, 22, C.butter) +
    line('M300 152C310 158 326 158 336 150M302 168C312 174 326 174 336 166', C.rose, 3)
  )
}
