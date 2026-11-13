// The "halloween" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, num, circle, ellipse, rect, path, line, group, base, table, shadow, sparkle, C } from './kit'

export default function halloween(): string {
  let web = ''
  for (let i = 0; i < 5; i += 1) {
    const a = (i * Math.PI) / 8
    web += `M-4 -4L${num(-4 + 120 * Math.cos(a))} ${num(-4 + 120 * Math.sin(a))}`
  }
  for (const r of [34, 62, 90]) {
    let d = ''
    for (let i = 0; i <= 4; i += 1) {
      const a = (i * Math.PI) / 8
      d += `${i ? 'L' : 'M'}${num(-4 + r * Math.cos(a))} ${num(-4 + r * Math.sin(a))}`
    }
    web += d
  }
  const bat = (x: number, y: number, s: number) =>
    group(path('M0 0C-6 -8 -14 -10 -26 -6C-20 -2 -20 4 -22 8C-16 4 -10 6 -6 10C-4 6 -2 4 0 4C2 4 4 6 6 10C10 6 16 4 22 8C20 4 20 -2 26 -6C14 -10 6 -8 0 0Z', C.lilac) + circle(0, 0, 4, C.lilac), `translate(${x} ${y}) scale(${s})`)
  return (
    base(6) +
    circle(352, 76, 70, C.butter, { opacity: 0.1 }) +
    circle(352, 76, 40, C.butter) +
    circle(338, 66, 7, C.deep, { opacity: 0.16 }) +
    circle(364, 88, 10, C.deep, { opacity: 0.14 }) +
    circle(366, 60, 4.5, C.deep, { opacity: 0.16 }) +
    line(web, C.cream, 1.2, { opacity: 0.4 }) +
    bat(152, 66, 1) +
    bat(198, 96, 0.7) +
    bat(420, 132, 0.6) +
    sparkle(440, 40, 3.5, C.white, 0.8) +
    sparkle(100, 130, 3, C.white, 0.7) +
    table() +
    shadow(240, 62) +
    path('M238 140C236 128 242 120 250 118C248 126 246 132 246 140Z', C.leaf) +
    ellipse(214, 178, 27, 34, C.orange) +
    ellipse(266, 178, 27, 34, C.orange) +
    ellipse(240, 176, 30, 37, C.orange) +
    line('M226 146C218 166 218 192 226 210M254 146C262 166 262 192 254 210', C.deep, 2, { opacity: 0.5 }) +
    path('M218 166L232 166L225 154Z', C.flame) +
    path('M248 166L262 166L255 154Z', C.flame) +
    path('M236 176L244 176L240 169Z', C.flame) +
    path('M214 186L222 194L230 187L240 195L250 187L258 194L266 186C262 200 218 200 214 186Z', C.flame) +
    shadow(168, 26) +
    ellipse(168, 194, 23, 18, C.deep) +
    line('M160 178C156 188 156 202 160 210M176 178C180 188 180 202 176 210', C.orange, 1.6, { opacity: 0.6 }) +
    rect(166, 172, 4, 8, C.leaf, 1.5) +
    shadow(322, 18, T + 4) +
    path('M304 186V150C304 132 314 122 322 122C330 122 340 132 340 150V186L334 180L328 186L322 180L316 186L310 180Z', C.cream) +
    ellipse(315, 146, 3.4, 4.6, C.charcoal) +
    ellipse(329, 146, 3.4, 4.6, C.charcoal) +
    ellipse(322, 158, 3, 3.8, C.charcoal, { opacity: 0.6 })
  )
}
