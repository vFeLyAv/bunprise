// The "easter" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, circle, ellipse, path, line, group, base, grass, shadow, sparkle, pompon, C } from './kit'

export default function easter(): string {
  const guest = pompon(346, T, 0.44)
  const egg = (x: number, y: number, rx: number, ry: number, col: string, deco: string, a = 0) =>
    group(path(`M${x} ${y - ry}C${x + rx * 1.1} ${y - ry} ${x + rx} ${y + ry} ${x} ${y + ry}C${x - rx} ${y + ry} ${x - rx * 1.1} ${y - ry} ${x} ${y - ry}Z`, col) + deco, `rotate(${a} ${x} ${y})`)
  const tulip = (x: number, h: number, col: string) =>
    line(`M${x} ${T}V${T - h}`, C.leaf, 3) +
    ellipse(x - 6, T - h * 0.35, 4, 12, C.green, { transform: `rotate(-30 ${x - 6} ${T - h * 0.35})` }) +
    path(`M${x - 9} ${T - h - 14}L${x - 4} ${T - h - 6}L${x} ${T - h - 15}L${x + 4} ${T - h - 6}L${x + 9} ${T - h - 14}C${x + 10} ${T - h + 2} ${x - 10} ${T - h + 2} ${x - 9} ${T - h - 14}Z`, col)
  return (
    base(5) +
    circle(408, 52, 24, C.butter) +
    circle(408, 52, 38, C.butter, { opacity: 0.2 }) +
    sparkle(120, 70, 6, C.white) +
    sparkle(300, 46, 5, C.white) +
    guest.back +
    grass() +
    guest.front +
    tulip(100, 44, C.rose) +
    tulip(124, 58, C.butter) +
    tulip(146, 38, C.berry) +
    tulip(412, 50, C.rose) +
    tulip(436, 40, C.lilac) +
    shadow(228, 62, T + 6) +
    ellipse(228, T - 2, 58, 16, C.wood) +
    egg(204, T - 18, 14, 19, C.butter, line(`M190 ${T - 20}l5 -5l5 5l5 -5l5 5l5 -5l5 5`, C.rose, 2.2), -10) +
    egg(254, T - 18, 14, 19, C.rose, line(`M242 ${T - 24}H266M241 ${T - 14}H267`, C.white, 2.6, { opacity: 0.85 }), 10) +
    egg(229, T - 24, 15, 21, C.blue, circle(223, T - 30, 2.6, C.white) + circle(234, T - 26, 2.6, C.white) + circle(226, T - 16, 2.6, C.white) + circle(236, T - 12, 2, C.white)) +
    path(`M170 ${T - 2}C170 ${T + 10} 196 ${T + 16} 228 ${T + 16}C260 ${T + 16} 286 ${T + 10} 286 ${T - 2}C278 ${T + 4} 256 ${T + 6} 228 ${T + 6}C200 ${T + 6} 178 ${T + 4} 170 ${T - 2}Z`, C.wood) +
    line(`M178 ${T + 4}l12 3M198 ${T + 9}l14 1M240 ${T + 9}l14 -1M262 ${T + 6}l12 -4`, C.charcoal, 1.4, { opacity: 0.3 }) +
    egg(40, T + 6, 9, 12, C.lilac, '', -16) +
    egg(456, T + 4, 9, 12, C.teal, '', 14)
  )
}
