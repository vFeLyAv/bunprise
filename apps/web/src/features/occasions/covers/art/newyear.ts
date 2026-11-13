// The "newyear" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, num, circle, rect, path, line, group, base, table, shadow, sparkle, star5, confetti, flute, C } from './kit'

export default function newyear(): string {
  const burst = (x: number, y: number, r: number, col: string) => {
    let d = ''
    let dots = ''
    for (let i = 0; i < 12; i += 1) {
      const a = (i * Math.PI) / 6 + 0.13
      d += `M${num(x + r * 0.32 * Math.cos(a))} ${num(y + r * 0.32 * Math.sin(a))}L${num(x + r * 0.82 * Math.cos(a))} ${num(y + r * 0.82 * Math.sin(a))}`
      dots += circle(x + r * Math.cos(a), y + r * Math.sin(a), 2.6, col)
    }
    return line(d, col, 3.4) + dots + circle(x, y, 4, col)
  }
  return (
    base(6) +
    burst(128, 86, 46, C.butter) +
    burst(352, 62, 40, C.rose) +
    burst(424, 146, 28, C.teal) +
    burst(58, 152, 24, C.blue) +
    sparkle(220, 40, 5, C.white) +
    sparkle(270, 22, 3.5, C.white, 0.8) +
    sparkle(30, 60, 3.5, C.white, 0.8) +
    sparkle(460, 70, 3, C.white, 0.7) +
    confetti(5, 18, [150, 60, 330, 190], [C.butter, C.rose, C.teal, C.white], [170, 100, 310, 212]) +
    table() +
    shadow(214, 22) +
    path(`M200 ${T}V156C200 144 206 136 208 128V108H220V128C222 136 228 144 228 156V${T}Z`, C.leaf) +
    rect(200, 164, 28, 26, C.butter, 2) +
    star5(214, 177, 7, C.deep) +
    rect(206, 100, 16, 20, C.butter, 2) +
    rect(204, 156, 4, 50, C.white, 2, { opacity: 0.22 }) +
    group(rect(0, 0, 10, 14, C.wood, 3), 'translate(232 64) rotate(30)') +
    line('M216 98C220 86 226 80 232 76M212 96C210 84 204 78 196 76', C.butter, 2, { opacity: 0.8, 'stroke-dasharray': '1 5' }) +
    shadow(282, 26) +
    flute(268, T, 10, C.butter) +
    flute(296, T, -10, C.butter) +
    sparkle(282, 132, 8, C.white)
  )
}
