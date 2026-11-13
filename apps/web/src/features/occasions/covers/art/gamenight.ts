// The "gamenight" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, circle, rect, path, line, group, poly, base, table, shadow, sparkle, star5, heart, tapsi, C } from './kit'

export default function gamenight(): string {
  const guest = tapsi(270, 112, 0.4)
  const pawn = (x: number, col: string) =>
    shadow(x, 12) + path(`M${x - 10} ${T}C${x - 10} ${T - 8} ${x - 5} ${T - 14} ${x - 4} ${T - 24}H${x + 4}C${x + 5} ${T - 14} ${x + 10} ${T - 8} ${x + 10} ${T}Z`, col) + circle(x, T - 30, 8, col) + circle(x - 2.5, T - 33, 2.4, C.white, { opacity: 0.5 })
  const pip = (x: number, y: number) => circle(x, y, 2.4, C.charcoal)
  const die1 = group(rect(312, T - 30, 30, 30, C.cream, 6) + pip(320, T - 22) + pip(334, T - 22) + pip(327, T - 15) + pip(320, T - 8) + pip(334, T - 8), `rotate(10 327 ${T})`)
  const die2 = group(rect(348, T - 22, 22, 22, C.cream, 5) + pip(353.5, T - 16.5) + pip(359, T - 11) + pip(364.5, T - 5.5), `rotate(-12 359 ${T})`)
  const card = (angle: number, mark: string) =>
    group(rect(392, T - 50, 30, 42, C.cream, 4) + rect(392, T - 50, 30, 42, 'none', 4, { stroke: C.ink, 'stroke-width': 0.8, opacity: 0.35 }) + mark, `rotate(${angle} 407 ${T - 4})`)
  return (
    base(7) +
    line('M240 -10V30', C.ink, 2, { opacity: 0.7 }) +
    poly([[198, 58], [282, 58], [380, T], [100, T]], C.glow, { opacity: 0.85 }) +
    path('M214 32H266L284 58H196Z', C.butter) +
    circle(240, 60, 6, C.flame) +
    sparkle(128, 64, 7, C.white, 0.8) +
    sparkle(360, 52, 6, C.white, 0.8) +
    table() +
    shadow(232, 84) +
    rect(52, T - 26, 58, 26, C.blue, 4) + rect(52, T - 26, 58, 6, C.white, 3, { opacity: 0.25 }) +
    rect(58, T - 46, 48, 20, C.green, 4) + rect(58, T - 46, 48, 5, C.white, 3, { opacity: 0.25 }) +
    guest.back +
    rect(158, 112, 148, T - 112, C.orange, 7) +
    rect(158, 112, 148, 20, C.deep, 7) +
    rect(158, 124, 148, 8, C.deep) +
    rect(166, 116, 60, 4, C.white, 2, { opacity: 0.3 }) +
    circle(232, 170, 29, C.cream) +
    star5(232, 171, 20, C.deep) +
    circle(176, 196, 4, C.butter) +
    circle(288, 196, 4, C.butter) +
    guest.front +
    pawn(126, C.rose) +
    pawn(148, C.teal) +
    shadow(330, 22) +
    die1 +
    die2 +
    card(-20, heart(407, T - 29, 6, C.berry)) +
    card(0, path(`M407 ${T - 38}L414 ${T - 29}L407 ${T - 20}L400 ${T - 29}Z`, C.blue)) +
    card(20, circle(407, T - 29, 6, C.green))
  )
}
