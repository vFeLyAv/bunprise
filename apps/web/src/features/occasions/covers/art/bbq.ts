// The "bbq" cover motif (ported from packages/mascot/demo/covers/art.ts): a lazy chunk of its own, loaded only
// where an occasion shows it (./index.ts).

import { T, circle, ellipse, rect, path, line, base, grass, shadow, bulbs, C } from './kit'

export default function bbq(): string {
  return (
    base(4) +
    circle(400, 64, 30, C.apricot, { opacity: 0.85 }) +
    circle(400, 64, 46, C.apricot, { opacity: 0.18 }) +
    bulbs(12, 18, [C.flame, C.butter, C.apricot], 12) +
    line('M222 132C210 112 232 102 220 82S228 54 218 38', C.white, 7, { opacity: 0.6 }) +
    line('M244 128C234 108 254 98 244 78S250 50 242 30', C.white, 7, { opacity: 0.55 }) +
    line('M266 132C258 116 274 106 266 88', C.white, 6, { opacity: 0.45 }) +
    grass() +
    shadow(240, 72, T + 3) +
    line(`M212 186L196 ${T + 4}M268 186L284 ${T + 4}M240 192V${T + 4}`, C.charcoal, 5) +
    path('M174 150H306C306 182 278 200 240 200C202 200 174 182 174 150Z', C.charcoal) +
    path('M184 156H200C202 176 214 188 230 194C204 192 186 178 184 156Z', C.white, { opacity: 0.16 }) +
    rect(170, 146, 140, 6, C.paper, 3) +
    rect(192, 134, 40, 12, C.berry, 6) +
    rect(236, 135, 36, 11, C.deep, 5.5) +
    line('M202 135l-4 10M214 135l-4 10M248 136l-4 10M260 136l-4 10', C.charcoal, 1.6, { opacity: 0.45 }) +
    ellipse(288, 139, 17, 7, C.butter) +
    path('M300 140C306 134 312 134 316 138C310 140 306 143 300 143Z', C.green) +
    shadow(126, 24) +
    path(`M108 150H146L144 ${T - 4}C144 ${T} 140 ${T} 138 ${T}H116C114 ${T} 110 ${T} 110 ${T - 4}Z`, C.cream, { opacity: 0.85 }) +
    path(`M110 168H144L143.5 ${T - 4}C143.5 ${T - 1} 140 ${T - 1} 138 ${T - 1}H116C114 ${T - 1} 110.5 ${T - 1} 110.5 ${T - 4}Z`, C.butter) +
    line('M146 160C160 160 160 192 145 192', C.cream, 5, { opacity: 0.9 }) +
    circle(122, 160, 7, C.butter) +
    circle(122, 160, 4, C.white, { opacity: 0.5 }) +
    shadow(362, 34) +
    circle(346, 182, 11, C.green) +
    circle(362, 176, 12, C.leaf) +
    circle(378, 184, 10, C.green) +
    circle(354, 178, 4, C.berry) +
    circle(372, 180, 4, C.berry) +
    path(`M326 186H398C398 202 384 ${T} 362 ${T}C340 ${T} 326 202 326 186Z`, C.cream)
  )
}
