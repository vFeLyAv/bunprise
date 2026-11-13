/**
 * The three «Переел» shows (23.10.2026), all on the same sitting puppet (overfed-rig.ts). Times in seconds;
 * only transform / opacity; every show ends in a calm pose that is also the reduced-motion still.
 *
 *  a — «Хватит»: cheeks full, eyes ^ ^, chews; one more carrot drops next to him — he looks at it, closes
 *      his eyes and slowly shakes his head "no more", sighs. Still: content, the carrot lies beside him.
 *  b — «Последний кусочек»: holds a bitten carrot, tries one more nibble, the cheeks are too full; lowers
 *      the carrot into his lap, yawns, drowsy blinks, nods off — a little "z". Still: asleep, carrot in lap.
 *  c — «Ик!»: stuffed and content — a hiccup makes him hop, eyes round, paws to his mouth; he giggles,
 *      a smaller second hiccup, then a contented sigh. Still: content, crumbs at his feet.
 */

import { SPRING } from './core';
import { DROP_REST_Y, EASE, type OverfedRig, type PropSet } from './overfed-rig';
import { splitEase } from './timeline';

export type OverfedVariant = 'a' | 'b' | 'c';

export interface OverfedShow {
  props: PropSet;
  /** Authors the show on the rig; returns the second the calm end pose is reached. */
  author(rig: OverfedRig): number;
  /** The calm life after the show (illustration only), from `end`. */
  rest(rig: OverfedRig, end: number): void;
}

// ---------- a: «Хватит» ----------

/** Where the extra carrot comes to rest next to him (bunny units: centre x, floor). */
export const A_CARROT = { x: 113, y: DROP_REST_Y, r: 0 } as const;

const showA: OverfedShow = {
  props: { floorCrumbs: true, mouthCrumbs: true, drop: true },
  author(r) {
    const cheeks = r.part('cheeks', { s: 1.3 });
    r.part('eyes', { o: 0 });
    r.part('happy', { o: 1 });
    // 0.1–0.9 still chewing (only the cheeks, the nose and the paws work), then a gulp: the cheeks a bit smaller
    r.chew(0.1, 6, 0.12);
    r.part('paws').path(0.1, [[0.34, { y: -3 }], [0.58, { y: 0 }], [0.8, { y: -2 }], [0.98, { y: 0 }]]);
    cheeks.path(0.92, [[1.3, { s: 1.22 }, SPRING]]);
    r.part('squash').path(0.9, [[1.0, { sx: 1.015, sy: 0.982 }, 'ease-out'], [1.3, { sx: 1, sy: 1 }, SPRING]]);

    // 1.0 one more carrot falls in from above, to his right; it fades in while still above the picture
    const drop = r.part('drop', { x: 128, y: -320, r: -34, o: 0 });
    const land = 1.46;
    const [k, e1, e2] = splitEase(EASE.fall, 0.25);
    const t1 = 1.0 + (land - 1.0) * k;
    drop.path(1.0, [
      [t1, { x: 127.5, y: -320 + (DROP_REST_Y + 320) * 0.25, r: -26, o: 1 }, e1],
      [land, { x: 126, y: DROP_REST_Y, r: -4, o: 1 }, e2],
      // two soft bounces, then it rolls a little toward him and lies still
      [1.6, { x: 123, y: DROP_REST_Y - 9, r: -13 }, EASE.out],
      [1.74, { x: 120.5, y: DROP_REST_Y, r: -2 }, EASE.in],
      [1.82, { x: 119, y: DROP_REST_Y - 2.4, r: -5 }, EASE.out],
      [1.9, { x: 118, y: DROP_REST_Y, r: 1 }, EASE.in],
      [2.25, { x: A_CARROT.x, y: DROP_REST_Y, r: A_CARROT.r }, 'cubic-bezier(.25,.8,.3,1)'],
    ]);

    // 1.5 he hears it: the ears flick, the eyes open, he looks down at it
    r.part('earL').path(1.48, [[1.58, { r: 6 }, 'ease-out'], [1.95, { r: 0 }, SPRING]]);
    r.part('earR').path(1.5, [[1.6, { r: -6 }, 'ease-out'], [1.97, { r: 0 }, SPRING]]);
    r.eyesTo(1.52, 'normal');
    r.part('eye').path(1.52, [[1.62, { s: 1.1 }, 'ease-out'], [1.85, { s: 1 }, EASE.inOut]]);
    r.turn(1.58, [[1.92, 0.45, EASE.face], [2.32, 0.45], [2.62, 0, EASE.inOut]]);
    r.part('face').path(1.6, [[1.9, { x: 1.5, y: 2.4 }, EASE.face], [2.35, { x: 1.5, y: 2.4 }], [2.6, { x: 0, y: 0 }, EASE.face]]);
    r.blink(2.12);

    // 2.45 "no more": the eyes squeeze shut (^ ^) and he slowly shakes his head (a small turn left, right,
    // left — the approved quarter turn, only part of the way); the body sways with it, the ears swing after it
    r.eyesTo(2.45, 'happy');
    const shake: ReadonlyArray<readonly [number, number]> = [[2.8, -1], [3.1, 1], [3.38, -0.65], [3.62, 0]];
    r.turn(2.62, shake.map(([t, s]) => [t, 0.42 * s] as const));
    r.part('body').path(2.62, shake.map(([t, s]) => [t, { r: 1.2 * s }, EASE.inOut] as const));
    r.part('earL').path(2.66, shake.map(([t, s]) => [t + 0.08, { r: -5 * s }, EASE.inOut] as const));
    r.part('earR').path(2.68, shake.map(([t, s]) => [t + 0.1, { r: -5 * s }, EASE.inOut] as const));

    // 3.55 a deep sigh: in (he rises a little, the ears lift) … and a long, slow out; then he rests
    const inhale = 3.55;
    const peak = 4.05;
    const end = 4.75;
    r.part('squash').path(inhale, [[peak, { sx: 0.99, sy: 1.035 }, EASE.inOut], [4.55, { sx: 1.012, sy: 0.988 }, EASE.settle], [end, { sx: 1, sy: 1 }, EASE.inOut]]);
    cheeks.path(inhale, [[peak, { s: 1.25 }, EASE.inOut], [end, { s: 1.2 }, EASE.settle]]);
    r.part('earL').path(inhale + 0.05, [[peak, { r: 4 }, EASE.inOut], [4.55, { r: -1.5 }, EASE.settle], [end, { r: 0 }, EASE.inOut]]);
    r.part('earR').path(inhale + 0.07, [[peak + 0.02, { r: -4 }, EASE.inOut], [4.57, { r: 1.5 }, EASE.settle], [end, { r: 0 }, EASE.inOut]]);
    return end;
  },
  rest(r, end) {
    r.breathe(end);
  },
};

// ---------- b: «Последний кусочек» ----------

/** The carrot in his paws: held up at the chest, and lying across his lap at the end (paws group units). */
const HOLD = { x: 0, y: -50, r: 0 } as const;
const LAP = { x: 3, y: -31, r: 86 } as const;
/** The paws: holding the carrot at the chest, at the mouth (its bitten end just covers the mouth), in the lap. */
const PAWS = { hold: -1, mouth: -11, lap: 8 } as const;
/** The sleepy lean (deg; small: the body turns about its bottom, a bigger lean lifts one side off the floor). */
const LEAN = 3;
/** Where the "z" starts (bunny units: above the right ear's root). */
const Z0 = { x: 44, y: -170 } as const;

const showB: OverfedShow = {
  props: { floorCrumbs: true, held: true, z: true },
  author(r) {
    const cheeks = r.part('cheeks', { s: 1.26 });
    r.part('eyes', { o: 0 });
    r.part('happy', { o: 1 });
    const paws = r.part('paws', { y: PAWS.hold });
    const held = r.part('held', HOLD);
    // the paws grip the carrot from both sides
    const pawL = r.part('pawL', { x: 1.5 });
    const pawR = r.part('pawR', { x: -1.5 });

    // 0.15 one more nibble: the carrot to his mouth, three chews, the cheeks fill up even more
    paws.path(0.15, [[0.45, { y: PAWS.mouth }, EASE.lift]]);
    r.chew(0.45, 6, 0.13);
    const bob = PAWS.mouth + 1.5;
    paws.path(0.45, [[0.58, { y: bob }], [0.71, { y: PAWS.mouth }], [0.84, { y: bob }], [0.97, { y: PAWS.mouth }], [1.1, { y: bob }], [1.23, { y: PAWS.mouth }]]);
    cheeks.path(0.45, [[1.2, { s: 1.37 }, 'ease-out']]);

    // 1.3 too full: the eyes open, the cheeks bulge once more, he looks down at the carrot
    r.eyesTo(1.3, 'normal');
    r.part('eye').path(1.3, [[1.4, { s: 1.1 }, 'ease-out'], [1.6, { s: 1 }, EASE.inOut]]);
    cheeks.path(1.3, [[1.42, { s: 1.42 }, 'ease-out'], [1.72, { s: 1.36 }, SPRING]]);
    r.part('squash').path(1.3, [[1.42, { sx: 1.02, sy: 0.98 }, 'ease-out'], [1.7, { sx: 1, sy: 1 }, SPRING]]);
    r.part('face').path(1.45, [[1.7, { x: 0, y: 2.2 }, EASE.face], [2.4, { x: 0, y: 2.2 }], [2.65, { x: 0, y: 0 }, EASE.face]]);
    r.blink(1.95);

    // 1.75–2.5 slowly lowers the carrot into his lap; it turns to lie across
    paws.path(1.75, [[2.5, { y: PAWS.lap }, EASE.inOut]]);
    held.path(1.75, [[2.5, { ...LAP }, EASE.inOut]]);
    pawL.path(1.75, [[2.5, { x: 0 }, EASE.inOut]]);
    pawR.path(1.75, [[2.5, { x: 0 }, EASE.inOut]]);

    // 2.55 a yawn (eyes squeezed), then drowsy half-open eyes and slow blinks; he leans back a tiny bit
    r.step('mouth', 2.58, { o: 0 });
    r.part('yawn').path(2.55, [[2.6, { o: 1, sx: 1, sy: 1 }], [2.97, { sx: 2.1, sy: 2.6 }, EASE.out], [3.25, { sx: 2, sy: 2.4 }], [3.45, { sx: 1, sy: 1 }, EASE.in], [3.5, { o: 0 }]]);
    r.step('mouth', 3.5, { o: 1 });
    r.eyesTo(2.6, 'happy');
    r.eyesTo(3.45, 'normal', 0.45);
    const eyes = r.part('eyes');
    eyes.path(3.45, [[3.7, { sy: 0.5 }], [3.85, { sy: 0.12 }, 'ease-in'], [4.05, { sy: 0.4 }, 'ease-out'], [4.25, { sy: 0.32 }], [4.38, { sy: 0.12 }, 'ease-in']]);
    r.eyesTo(4.4, 'sleep');
    r.part('body').path(2.6, [[3.4, { r: 1.8 }, EASE.inOut]]);
    r.part('hop').path(2.6, [[3.4, { y: 1.2 }, EASE.inOut]]);

    // 4.2 asleep: the head nods a little further, the ears and the cheeks relax
    const end = 4.75;
    r.part('body').path(4.3, [[end, { r: LEAN }, EASE.inOut]]);
    r.part('face').path(4.3, [[end, { x: 0, y: 1.2 }, EASE.inOut]]);
    r.part('earL').path(4.2, [[end, { r: 6 }, EASE.inOut]]);
    r.part('earR').path(4.2, [[end, { r: -6 }, EASE.inOut]]);
    cheeks.path(4.2, [[end, { s: 1.3 }, EASE.inOut]]);
    r.part('z', { ...Z0, s: 0.7 });
    return end;
  },
  rest(r, end) {
    // asleep (the welcome «sleepy» hold): deep breathing, a slow nod, the "z" floating up
    r.breathe(end, true);
    r.loop('body', end, 6.8, [[0, { r: LEAN }, EASE.inOut], [0.5, { r: LEAN + 1.2 }, EASE.inOut], [1, { r: LEAN }]]);
    r.loop('z', Z_FROM, 2.8, [
      [0, { ...Z0, s: 0.7, o: 0 }, 'ease-out'],
      [0.18, { x: Z0.x + 2, y: Z0.y - 4, s: 0.85, o: 0.9 }, 'ease-out'],
      [0.8, { x: Z0.x + 10, y: Z0.y - 24, s: 1.15, o: 0 }],
      [1, { x: Z0.x + 10, y: Z0.y - 24, s: 1.15, o: 0 }],
    ]);
  },
};
/** The first "z" floats up once his eyes are closed (still inside the show). */
const Z_FROM = 4.45;

// ---------- c: «Ик!» ----------

/** One hiccup at `t`: a hop with squash and stretch, eyes round, ears flick, cheeks bulge, paws to the mouth. */
function hiccup(r: OverfedRig, t: number, k: number, cheeks: number): void {
  const up = 10 * k;
  r.part('squash').path(t, [
    [t + 0.06, { sx: 1 + 0.04 * k, sy: 1 - 0.05 * k }, 'ease-out'],
    [t + 0.18, { sx: 1 - 0.035 * k, sy: 1 + 0.06 * k }, EASE.out],
    [t + 0.32, { sx: 1 + 0.05 * k, sy: 1 - 0.05 * k }, EASE.in],
    [t + 0.5, { sx: 1, sy: 1 }, SPRING],
  ]);
  r.part('hop').path(t + 0.06, [[t + 0.19, { y: -up }, EASE.out], [t + 0.32, { y: 0 }, EASE.in]]);
  r.part('shadow').path(t + 0.06, [[t + 0.19, { sx: 0.86, sy: 0.86 }, EASE.out], [t + 0.32, { sx: 1.04, sy: 1.04 }, EASE.in], [t + 0.48, { sx: 1, sy: 1 }]]);
  r.part('footL').path(t + 0.08, [[t + 0.19, { y: -2.5 * k }, EASE.out], [t + 0.3, { y: 0 }, EASE.in]]);
  r.part('footR').path(t + 0.08, [[t + 0.19, { y: -2.5 * k }, EASE.out], [t + 0.3, { y: 0 }, EASE.in]]);
  r.eyesTo(t + 0.06, 'normal');
  r.part('eye').path(t + 0.06, [[t + 0.14, { s: 1 + 0.25 * k }, 'ease-out']]);
  // the ears fly out (a startle) and swing back; flying in they would bare the puffed cheeks as side lobes
  r.part('earL').path(t + 0.08, [[t + 0.2, { r: 9 * k }, EASE.out], [t + 0.4, { r: -4 * k }, EASE.inOut], [t + 0.7, { r: 0 }, SPRING]]);
  r.part('earR').path(t + 0.09, [[t + 0.21, { r: -9 * k }, EASE.out], [t + 0.41, { r: 4 * k }, EASE.inOut], [t + 0.71, { r: 0 }, SPRING]]);
  r.part('cheeks').path(t + 0.06, [[t + 0.18, { s: cheeks + 0.06 * k }, 'ease-out'], [t + 0.6, { s: cheeks }, SPRING]]);
  r.part('paws').path(t + 0.12, [[t + 0.3, { y: -22 }, EASE.lift]]);
}

const showC: OverfedShow = {
  props: { floorCrumbs: true, mouthCrumbs: true },
  author(r) {
    r.part('cheeks', { s: 1.3 });
    r.part('eyes', { o: 0 });
    r.part('happy', { o: 1 });
    // 0.1 content: a slow sway and a last chew
    r.part('body').path(0.1, [[0.5, { r: -1.5 }, EASE.inOut], [0.92, { r: 0 }, EASE.inOut]]);
    r.chew(0.15, 4, 0.14);

    // 1.0 hic! — he hops, eyes round, paws to his mouth; holds them there, blinks
    hiccup(r, 1.0, 1, 1.3);
    r.part('eye').path(1.4, [[1.65, { s: 1.1 }, EASE.inOut]]);
    r.blink(1.72);
    // 1.95 he giggles behind his paws (eyes ^ ^, two little shakes), the paws come down
    r.eyesTo(1.98, 'happy');
    r.step('eye', 1.98, { s: 1 });
    r.part('squash').path(2.0, [[2.1, { sx: 1.012, sy: 0.985 }], [2.2, { sx: 1, sy: 1 }], [2.3, { sx: 1.012, sy: 0.985 }], [2.42, { sx: 1, sy: 1 }]]);
    r.part('paws').path(2.15, [[2.5, { y: 0 }, SPRING]]);

    // 2.75 hic! — a smaller one
    hiccup(r, 2.75, 0.6, 1.3);
    r.eyesTo(3.3, 'happy');
    r.step('eye', 3.3, { s: 1 });
    r.part('paws').path(3.35, [[3.72, { y: 0 }, SPRING]]);

    // 3.7 a contented sigh, then he rests
    const end = 4.75;
    r.part('squash').path(3.72, [[4.15, { sx: 0.99, sy: 1.03 }, EASE.inOut], [4.55, { sx: 1.01, sy: 0.988 }, EASE.settle], [end, { sx: 1, sy: 1 }, EASE.inOut]]);
    r.part('cheeks').path(3.72, [[4.15, { s: 1.33 }, EASE.inOut], [end, { s: 1.26 }, EASE.settle]]);
    r.part('earL').path(3.76, [[4.15, { r: 3 }, EASE.inOut], [end, { r: 0 }, EASE.settle]]);
    r.part('earR').path(3.78, [[4.17, { r: -3 }, EASE.inOut], [end, { r: 0 }, EASE.settle]]);
    return end;
  },
  rest(r, end) {
    r.breathe(end);
  },
};

export const OVERFED_SHOWS: Readonly<Record<OverfedVariant, OverfedShow>> = { a: showA, b: showB, c: showC };
