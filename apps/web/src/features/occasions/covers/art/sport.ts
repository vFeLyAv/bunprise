// The "sport" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, circle, ellipse, rect, line, base, table, shadow, sparkle, C } from './kit'

export default function sport(): string {
  return (
    base(5) +
    sparkle(104, 80, 8, C.white) +
    sparkle(378, 70, 7, C.white) +
    line('M150 92C170 70 196 62 220 64', C.white, 4, { opacity: 0.7 }) +
    line('M330 92C310 70 284 62 260 64', C.white, 4, { opacity: 0.7 }) +
    circle(240, 96, 26, C.cream) +
    circle(240, 96, 20, C.white, { opacity: 0.6 }) +
    rect(234, 62, 12, 9, C.charcoal, 2) +
    line('M240 96V82M240 96L250 102', C.charcoal, 3) +
    table() +
    rect(150, T - 3, 180, 7, C.teal, 3.5, { opacity: 0.8 }) +
    shadow(138, 28) +
    line('M123 180C118 140 158 140 153 180', C.charcoal, 7) +
    circle(138, 188, 24, C.charcoal) +
    rect(116, 196, 44, 16, C.charcoal, 4) +
    ellipse(128, 180, 6, 9, C.white, { opacity: 0.22 }) +
    shadow(240, 56) +
    rect(198, T - 25, 84, 7, C.paper, 3) +
    rect(192, T - 33, 8, 23, C.charcoal, 2) +
    rect(280, T - 33, 8, 23, C.charcoal, 2) +
    rect(202, T - 46, 15, 46, C.blue, 4) +
    rect(263, T - 46, 15, 46, C.blue, 4) +
    rect(217, T - 38, 8, 30, C.lilac, 3) +
    rect(255, T - 38, 8, 30, C.lilac, 3) +
    rect(205, T - 42, 3, 36, C.white, 1.5, { opacity: 0.4 }) +
    rect(266, T - 42, 3, 36, C.white, 1.5, { opacity: 0.4 }) +
    shadow(322, 20) +
    rect(306, 132, 32, 80, C.blue, 11, { opacity: 0.85 }) +
    rect(312, 118, 20, 16, C.green, 4) +
    rect(306, 160, 32, 22, C.cream, 0) +
    rect(312, 140, 5, 64, C.white, 2.5, { opacity: 0.4 }) +
    shadow(394, 22) +
    circle(394, 188, 24, C.orange) +
    line('M394 164V212M370 188H418M377 171C388 180 388 196 377 205M411 171C400 180 400 196 411 205', C.charcoal, 1.8, { opacity: 0.55 })
  )
}
