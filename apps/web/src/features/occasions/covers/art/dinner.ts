// The "dinner" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { VIEW_W, T, circle, ellipse, rect, path, line, base, table, shadow, sparkle, flame, C } from './kit'

export default function dinner(): string {
  const candle = (x: number) =>
    rect(x - 13, T - 10, 26, 10, C.butter, 3) + rect(x - 5, T - 72, 10, 62, C.cream, 3) + rect(x - 3, T - 70, 2.5, 50, C.white, 1, { opacity: 0.5 }) + flame(x, T - 82)
  const wine = (x: number) =>
    ellipse(x, T - 1, 12, 3, C.cream, { opacity: 0.9 }) +
    rect(x - 1.4, T - 34, 2.8, 33, C.cream, 1) +
    path(`M${x - 16} ${T - 80}H${x + 16}C${x + 17} ${T - 54} ${x + 10} ${T - 36} ${x} ${T - 34}C${x - 10} ${T - 36} ${x - 17} ${T - 54} ${x - 16} ${T - 80}Z`, C.cream, { opacity: 0.7 }) +
    path(`M${x - 15.6} ${T - 62}H${x + 15.6}C${x + 14} ${T - 46} ${x + 9} ${T - 37} ${x} ${T - 36}C${x - 9} ${T - 37} ${x - 14} ${T - 46} ${x - 15.6} ${T - 62}Z`, C.berry) +
    rect(x - 12, T - 78, 3, 30, C.white, 1.5, { opacity: 0.45 })
  const lamp = (x: number) =>
    line(`M${x} -10V44`, C.ink, 1.6, { opacity: 0.7 }) + circle(x, 66, 26, C.flame, { opacity: 0.22 }) + path(`M${x - 24} 64C${x - 24} 50 ${x - 13} 42 ${x} 42C${x + 13} 42 ${x + 24} 50 ${x + 24} 64Z`, C.deep) + ellipse(x, 65, 8, 4, C.flame)
  let scallops = ''
  for (let x = -12; x < VIEW_W + 16; x += 16) scallops += circle(x, T + 30, 8.5, C.cream)
  return (
    base(1) +
    lamp(150) +
    lamp(330) +
    line('M222 128C214 112 230 104 222 88S226 64 220 54', C.white, 5, { opacity: 0.55 }) +
    line('M246 124C238 108 254 100 246 84S250 60 244 46', C.white, 5, { opacity: 0.55 }) +
    line('M266 128C260 114 274 106 268 92', C.white, 4, { opacity: 0.45 }) +
    table() +
    rect(-20, T, VIEW_W + 40, 30, C.cream) +
    scallops +
    rect(-20, T, VIEW_W + 40, 3, C.white, 0, { opacity: 0.5 }) +
    shadow(240, 70, T + 1) +
    rect(180, 166, 18, 9, C.deep, 4) +
    rect(282, 166, 18, 9, C.deep, 4) +
    path(`M192 156H288V188C288 204 274 ${T} 260 ${T}H220C206 ${T} 192 204 192 188Z`, C.orange) +
    rect(200, 166, 6, 34, C.white, 3, { opacity: 0.3 }) +
    path('M188 158C188 142 212 130 240 130C268 130 292 142 292 158Z', C.deep) +
    rect(186, 154, 108, 7, C.deep, 3.5) +
    circle(240, 128, 7, C.cream) +
    candle(150) +
    candle(330) +
    wine(104) +
    wine(376) +
    sparkle(120, 104, 5, C.white, 0.8) +
    sparkle(362, 112, 5, C.white, 0.8)
  )
}
