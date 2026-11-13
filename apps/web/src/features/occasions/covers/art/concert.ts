// The "concert" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { VIEW_W, T, circle, ellipse, rect, line, group, poly, base, table, shadow, sparkle, C } from './kit'

export default function concert(): string {
  const note = (x: number, y: number, col: string) => ellipse(x, y, 7, 5, col, { transform: `rotate(-20 ${x} ${y})` }) + line(`M${x + 6} ${y - 2}V${y - 28}l10 6`, col, 2.6)
  return (
    base(6) +
    poly([[148, -10], [168, -10], [214, T], [92, T]], C.butter, { opacity: 0.2 }) +
    poly([[232, -10], [248, -10], [312, T], [168, T]], C.rose, { opacity: 0.16 }) +
    poly([[318, -10], [338, -10], [392, T], [268, T]], C.blue, { opacity: 0.2 }) +
    sparkle(70, 40, 4, C.white, 0.8) +
    sparkle(420, 30, 5, C.white, 0.8) +
    sparkle(380, 92, 3, C.white, 0.7) +
    sparkle(104, 112, 3, C.white, 0.7) +
    note(172, 104, C.butter) +
    note(198, 66, C.cream) +
    note(302, 80, C.rose) +
    table() +
    rect(-20, T, VIEW_W + 40, 3, C.butter, 0, { opacity: 0.55 }) +
    shadow(140, 34) +
    rect(110, 140, 60, 72, C.lilac, 6) +
    circle(140, 162, 13, C.paper) +
    circle(140, 162, 6, C.lilac) +
    circle(140, 194, 9, C.paper) +
    circle(140, 194, 4, C.lilac) +
    shadow(240, 24) +
    ellipse(240, T - 2, 22, 5, C.paper) +
    rect(237.5, 124, 5, 86, C.paper, 2.5) +
    rect(226, 84, 28, 44, C.paper, 14) +
    line('M231 96H249M230 104H250M231 112H249', C.charcoal, 1.4, { opacity: 0.35 }) +
    rect(226, 116, 28, 6, C.deep, 0) +
    group(
      rect(335, T - 170, 10, 96, C.wood, 2) +
        rect(331, T - 190, 18, 22, C.wood, 4) +
        circle(340, T - 30, 28, C.orange) +
        circle(340, T - 72, 21, C.orange) +
        rect(326, T - 60, 28, 22, C.orange) +
        circle(340, T - 56, 8, C.charcoal) +
        rect(330, T - 26, 20, 5, C.charcoal, 2) +
        line(`M337 ${T - 26}V${T - 176}M343 ${T - 26}V${T - 176}`, C.cream, 0.8, { opacity: 0.7 }),
      `rotate(-22 340 ${T})`,
    )
  )
}
