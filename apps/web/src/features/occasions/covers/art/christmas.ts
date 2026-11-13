// The "christmas" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, circle, rect, path, line, base, shadow, star5, confetti, present, pompon, C } from './kit'

export default function christmas(): string {
  const guest = pompon(350, T - 2, 0.4, 'santa')
  const snow = confetti(23, 30, [0, 0, 480, 200], [C.white, C.white, C.cream], [176, 56, 304, 212], true)
  return (
    base(3) +
    snow +
    guest.back +
    path(`M-20 ${T}C40 ${T - 10} 100 ${T + 4} 170 ${T - 2}S300 ${T - 8} 360 ${T}S450 ${T - 6} 500 ${T}V340H-20Z`, C.cream) +
    guest.front +
    shadow(240, 70, T + 1) +
    rect(232, 190, 16, 22, C.wood, 2) +
    path('M176 198Q240 186 304 198L240 128Z', C.leaf) +
    path('M190 164Q240 152 290 164L240 98Z', C.green) +
    path('M204 128Q240 118 276 128L240 70Z', C.leaf) +
    line('M196 184Q240 170 284 160', C.cream, 2.4, { 'stroke-dasharray': '1 6', opacity: 0.95 }) +
    line('M206 152Q240 142 270 132', C.cream, 2.4, { 'stroke-dasharray': '1 6', opacity: 0.95 }) +
    circle(214, 186, 6, C.berry) +
    circle(262, 182, 6, C.butter) +
    circle(240, 172, 5.5, C.blue) +
    circle(226, 150, 5.5, C.butter) +
    circle(256, 150, 5, C.berry) +
    circle(242, 120, 4.5, C.blue) +
    circle(228, 108, 4, C.berry) +
    star5(240, 66, 14, C.butter) +
    present(194, 36, 28, C.berry, C.butter, T + 2) +
    present(286, 30, 22, C.butter, C.berry, T + 4)
  )
}
