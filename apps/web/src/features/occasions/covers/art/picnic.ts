// The "picnic" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, num, circle, rect, path, line, group, poly, base, grass, shadow, tapsi, C } from './kit'

export default function picnic(): string {
  const guest = tapsi(242, 166, 0.36)
  // the blanket in perspective: a trapezoid with gingham bands
  const back = T - 2
  const front = 268
  const xl = (y: number) => 168 - ((y - back) / (front - back)) * 48
  const xr = (y: number) => 312 + ((y - back) / (front - back)) * 48
  let gingham = ''
  for (let k = 0; k < 8; k += 2) {
    const a = k / 8
    const b = (k + 1) / 8
    gingham += poly([[168 + 144 * a, back], [168 + 144 * b, back], [120 + 240 * b, front], [120 + 240 * a, front]], C.berry, { opacity: 0.35 })
  }
  for (let k = 0; k < 6; k += 2) {
    const y0 = back + ((front - back) * k) / 6
    const y1 = back + ((front - back) * (k + 1)) / 6
    gingham += poly([[xl(y0), y0], [xr(y0), y0], [xr(y1), y1], [xl(y1), y1]], C.berry, { opacity: 0.35 })
  }
  let rays = ''
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4
    rays += `M${num(400 + 36 * Math.cos(a))} ${num(58 + 36 * Math.sin(a))}L${num(400 + 46 * Math.cos(a))} ${num(58 + 46 * Math.sin(a))}`
  }
  const cloud = (x: number, y: number, s: number) => group(circle(0, 0, 16, C.cream) + circle(18, -8, 20, C.cream) + circle(38, 0, 15, C.cream) + rect(-14, 0, 64, 15, C.cream, 7.5), `translate(${x} ${y}) scale(${s})`)
  return (
    base(3) +
    circle(400, 58, 26, C.butter) +
    line(rays, C.butter, 4) +
    cloud(96, 52, 1) +
    cloud(280, 30, 0.7) +
    grass() +
    rect(62, 118, 15, T - 116, C.wood, 6) +
    circle(70, 104, 34, C.green) +
    circle(44, 126, 24, C.leaf) +
    circle(98, 122, 26, C.leaf) +
    circle(72, 78, 24, C.green) +
    circle(60, 96, 10, C.white, { opacity: 0.18 }) +
    poly([[168, back], [312, back], [360, front], [120, front]], C.cream) +
    gingham +
    shadow(240, 50, T + 12) +
    line('M206 170C206 132 274 132 274 170', C.wood, 7) +
    guest.back +
    path(`M198 168H282L274 ${T + 10}C273 ${T + 14} 270 ${T + 16} 266 ${T + 16}H214C210 ${T + 16} 207 ${T + 14} 206 ${T + 10}Z`, C.wood) +
    line(`M202 184H278M204 198H276M206 ${T + 8}H274`, C.charcoal, 1.4, { opacity: 0.25 }) +
    rect(192, 162, 96, 11, C.wood, 5.5) +
    rect(196, 164, 60, 3, C.white, 1.5, { opacity: 0.3 }) +
    guest.front +
    circle(318, T + 8, 9, C.berry) +
    path(`M318 ${T - 1}C320 ${T - 7} 325 ${T - 8} 327 ${T - 6}C324 ${T - 3} 321 ${T - 2} 318 ${T - 1}Z`, C.green) +
    circle(334, T + 16, 8, C.butter)
  )
}
