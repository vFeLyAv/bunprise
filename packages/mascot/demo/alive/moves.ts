/**
 * «Живые анимации» — the eight approved moments moved into the package (src/alive/moves.ts, entry
 * @bunprise/mascot/alive, 31.10: «Всё остальное хорошо»). The gallery page ?screens=alive keeps importing them from
 * here; this file keeps only the gallery's ARCHIVE — the two moments Felix dropped, shown only with &archive=1 and
 * never in the mix:
 *   flop   Флоп   — «ваще странно выглядит»: topples over and swaps to his own lying drawing (lying.ts)
 *   slump  Сполз  — «сполз убрать» (31.10, release 6): round 3's one continuous slump of the same puppet (no swap):
 *                   sleepy, leans, slowly slides down onto his side, ^ ^, slow breaths, pushes back up
 */

import { BODY } from '../../src/shapes';
import { ALIVE_MOVES, authorAlive, blink, Builder, EZ, toHappy, toOpen, yawn, type AliveId, type Key, type Shot as AliveShot } from '../../src/alive/moves';
import { ROLL_ORIGIN, type AliveKind, type AliveRig } from './rig';
import type { ChannelInput } from '../../src/timeline';

export * from '../../src/alive/moves';

export type MoveId = AliveId | 'flop' | 'slump';
export type Shot = AliveShot<MoveId>;

// ---- the body outline (BODY, sampled) — the flop keeps it above the floor while he rolls ----
let OUTLINE: Array<[number, number]> | null = null;
function outline(): Array<[number, number]> {
  if (OUTLINE) return OUTLINE;
  const nums = (BODY.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const cmds = BODY.match(/[MCLZ]/g) ?? [];
  const pts: Array<[number, number]> = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  for (const c of cmds) {
    if (c === 'M' || c === 'L') {
      cx = nums[i++] ?? 0;
      cy = nums[i++] ?? 0;
      pts.push([cx, cy]);
    } else if (c === 'C') {
      const [x1, y1, x2, y2, x3, y3] = nums.slice(i, i + 6) as [number, number, number, number, number, number];
      i += 6;
      for (let s = 1; s <= 12; s++) {
        const u = s / 12;
        const v = 1 - u;
        pts.push([v * v * v * cx + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3, v * v * v * cy + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3]);
      }
      cx = x3;
      cy = y3;
    }
  }
  // the hind feet's outer bottoms (they turn with him)
  pts.push([52, 0], [-52, 0]);
  OUTLINE = pts;
  return pts;
}

/** How far up he must be lifted, rolled by r degrees about ROLL_ORIGIN, so nothing goes below the floor (y 0). */
function clearance(r: number): number {
  const a = (r * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  let low = -Infinity;
  for (const [x, y] of outline()) low = Math.max(low, ROLL_ORIGIN.y + (x - ROLL_ORIGIN.x) * s + (y - ROLL_ORIGIN.y) * c);
  return Math.max(0, low);
}

/**
 * The roll from r0 to r1 between ta and tb: a small hop (arc) that also always clears the floor. `fall` speeds up to
 * the end (a topple: fastest at the end — where the flop swaps to the lying drawing), `rise` starts fast and slows down.
 */
function rollKeys(b: Builder, ta: number, tb: number, r0: number, r1: number, arc: number, ease: 'soft' | 'fall' | 'rise' = 'soft'): void {
  const N = 10;
  const keys: Key[] = [];
  for (let i = 1; i <= N; i++) {
    const u = i / N;
    const e = ease === 'fall' ? u * u : ease === 'rise' ? 1 - (1 - u) * (1 - u) : 0.5 * u + 0.5 * u * u * (3 - 2 * u);
    const r = r0 + (r1 - r0) * e;
    const lift = Math.max(clearance(r), arc * 4 * u * (1 - u));
    keys.push([ta + (tb - ta) * u, { x: 0, y: -Math.round(lift * 100) / 100, r }, EZ.lin]);
  }
  b.p('roll', ta, keys);
}

export const FLOP_S = 3.1;
/** (round 2's «Сполз» with the drawing swap — archived with the flop; round 3's slump below swaps nothing) */
const SLUMP_V2_S = 3.9;

/**
 * Round 2 (Felix: the turned sitting puppet «очень странно выглядит и не натурально»): the sitting puppet topples
 * over — a roll that speeds up like a fall — and in its fastest moment, just before he hits the floor, it swaps to his
 * own lying drawing (lying.ts) over 30 ms; that one lands: a soft bounce of the BODY only (never the head), the hind
 * feet kick out, the ears flop down onto the floor. Getting up is the same in reverse: the rump lifts, swap at the
 * fastest moment, the sitting puppet rolls back up and lands.
 *   flop   the real flop: a little lean the other way, then he throws himself over, legs kick, bounce (3.1 s)
 *   slump  the gentle one: leans over slowly, sinks onto his side, settles softly, gets up slower (3.9 s)
 */
function authorFlopLike(b: Builder, v: 'flop' | 'slump'): Shot {
  const flop = v === 'flop';
  const D = flop ? FLOP_S : SLUMP_V2_S;
  const R = 74;
  // 1 · wind-up: ^ ^; flop — a small lean the other way (the throw), slump — a slow lean towards the side
  b.marks.wind = 0;
  toHappy(b, flop ? 0.04 : 0.12);
  const w1 = flop ? 0.28 : 0.62;
  b.p('body', 0.02, [[w1, { r: flop ? -5 : 9 }, flop ? EZ.out : EZ.inOut]]);
  b.p('earL', 0.04, [[w1, { r: flop ? 4 : 3 }, EZ.ease]]);
  b.p('earR', 0.04, [[w1, { r: flop ? -3 : 4 }, EZ.ease]]);
  b.p('shadow', 0, [[w1, { sx: 1.03 }, EZ.ease]]);

  // 2 · the topple (the sitting puppet) — speeding up to the end
  const t0 = w1;
  const t1 = t0 + (flop ? 0.2 : 0.3);
  b.marks.flop = t0;
  rollKeys(b, t0, t1, 0, R, flop ? 8 : 0, 'fall');
  b.p('body', t0, [[t0 + 0.1, { r: 0 }, EZ.out]]);
  b.p('earL', t0, [[t0 + 0.12, { r: -6 }, EZ.out]]);
  b.p('earR', t0, [[t0 + 0.12, { r: -9 }, EZ.out]]);
  for (const [n, s] of [['footL', -1], ['footR', 1]] as const) b.p(n, t0, [[t0 + 0.14, { x: -s * 3, y: -4, sx: 0.9, sy: 0.9 }, EZ.out]]);
  b.p('shadow', t0, [[t1, { x: 4, sx: 0.9, sy: 0.92 }, EZ.ease]]);

  // the swap, over 30 ms at the fastest moment: the sitting puppet goes (still turning), the lying one comes, mid-fall
  // (rump up, feet tucked, ears still in the air)
  const cross = t1 + 0.03;
  b.marks.swap = t1;
  b.p('roll', t1, [[cross, { y: -clearance(R + 6), r: R + 6, o: 0 }, EZ.lin]]);
  const lift = flop ? 16 : 11;
  b.set('lf', t1, { r: lift, y: -4, o: 0 });
  b.p('lf', t1, [[cross, { r: lift - 1.5, y: -4, o: 1 }, EZ.lin]]);
  b.set('lfFeet', t1, flop ? { x: 16, y: -2, r: 24 } : { x: 9, y: -1, r: 12 });
  b.set('lfEarU', t1, { r: flop ? -22 : -12 });
  b.set('lfEarD', t1, { r: flop ? -26 : -14 });
  b.set('lfPaws', t1, { x: 6, y: -2 });
  // (behind it, the hidden sitting puppet goes back to rest, still with ^ ^ for later)
  const hid = cross + 0.02;
  b.set('roll', hid, { o: 0 });
  b.set('body', hid, {});
  b.set('earL', hid, {});
  b.set('earR', hid, {});
  b.set('footL', hid, {});
  b.set('footR', hid, {});

  // 3 · the lying one lands: falls the last bit (flop: like a stone; slump: softly), the body (only) gives a little,
  //     the hind feet kick out, the ears flop down onto the floor
  const tl = t1 + (flop ? 0.1 : 0.2);
  b.marks.land = tl;
  b.p('lf', cross, [[tl, { o: 1 }, flop ? EZ.in : EZ.out]]);
  b.p('lfBody', tl - 0.01, [[tl + 0.05, { sx: 1.02, sy: flop ? 0.88 : 0.95 }, EZ.out], [tl + 0.28, {}, EZ.spring]]);
  b.p('lfHead', tl - 0.01, [[tl + 0.05, { y: flop ? 2.5 : 1.2 }, EZ.out], [tl + 0.24, {}, EZ.ease]]);
  if (flop) b.p('lfFeet', tl - 0.02, [[tl + 0.06, { x: -10, y: 1, r: -6 }, EZ.out], [tl + 0.2, { x: -1, r: 1 }, EZ.ease], [tl + 0.3, { x: -2 }, EZ.ease]]);
  else b.p('lfFeet', t1, [[tl + 0.12, { x: -2 }, EZ.out]]);
  b.p('lfEarU', t1, [[tl + 0.04, { r: 6 }, flop ? EZ.in : EZ.out], [tl + 0.16, { r: -2 }, EZ.ease], [tl + 0.26, { r: 0 }, EZ.ease]]);
  b.p('lfEarD', t1, [[tl + 0.02, { r: 4 }, flop ? EZ.in : EZ.out], [tl + 0.14, { r: -1.5 }, EZ.ease], [tl + 0.24, { r: 0 }, EZ.ease]]);
  b.p('lfPaws', t1, [[tl + 0.08, {}, EZ.out]]);
  b.p('shadow', t1, [[tl, { x: -14, sx: 1.5, sy: 0.95 }, EZ.out]]);

  // 4 · lies there blissfully: slow breaths (the body swells, the head rises a hair, the upper hind foot with the hip),
  //     the hind feet stretch once, the upper ear twitches
  const L0 = tl + 0.3;
  b.marks.lie = L0;
  const br = flop ? 0.62 : 0.7;
  for (let i = 0; i < 2; i++) {
    const tb = L0 + i * br;
    b.p('lfBody', tb, [[tb + br / 2, { sx: 1, sy: 1.035 }, EZ.ease], [tb + br, {}, EZ.ease]]);
    b.p('lfHead', tb, [[tb + br / 2, { y: -0.7 }, EZ.ease], [tb + br, {}, EZ.ease]]);
    b.p('lfFootU', tb, [[tb + br / 2, { y: -1.2 }, EZ.ease], [tb + br, {}, EZ.ease]]);
  }
  const fs = L0 + 0.15;
  b.p('lfFeet', fs, [[fs + 0.2, { x: -6 }, EZ.ease], [fs + 0.45, { x: -2 }, EZ.ease]]);
  const tw = L0 + br * 1.2;
  b.marks.twitch = tw;
  b.p('lfEarU', tw, [[tw + 0.06, { r: -10 }, 'ease-out'], [tw + 0.16, { r: 3 }, EZ.ease], [tw + 0.26, { r: 0 }, EZ.ease]]);

  // 5 · up again: the rump lifts (the lying one turns back), swap at the fastest moment, the sitting puppet rolls up
  const g0 = L0 + 2 * br + 0.04;
  const gs = g0 + (flop ? 0.12 : 0.16);
  const g1 = gs + (flop ? 0.24 : 0.34);
  b.marks.up = g0;
  b.p('lf', g0, [[gs, { r: flop ? 20 : 14, y: -4, o: 1 }, EZ.in], [gs + 0.03, { r: flop ? 22 : 15.5, y: -4, o: 0 }, EZ.lin]]);
  b.p('lfFeet', g0, [[gs, { x: 12, y: -2, r: 20 }, EZ.in]]);
  b.p('lfEarU', g0, [[gs, { r: -10 }, EZ.in]]);
  b.p('lfEarD', g0, [[gs, { r: -12 }, EZ.in]]);
  b.set('roll', gs - 0.001, { y: -clearance(70), r: 70, o: 0 });
  for (const [n, s] of [['footL', -1], ['footR', 1]] as const) b.set(n, gs - 0.001, { x: -s * 3, y: -4, sx: 0.9, sy: 0.9 });
  b.set('earL', gs - 0.001, { r: 6 });
  b.set('earR', gs - 0.001, { r: 10 });
  // (the roll's own keys carry o = 1: the sitting puppet fades in over its first key, 1/10 of the roll)
  rollKeys(b, gs, g1, 70, 0, flop ? 8 : 5, 'rise');
  // (behind it, the hidden lying one goes back to rest)
  const lh = gs + 0.06;
  for (const n of ['lf', 'lfFeet', 'lfEarU', 'lfEarD'] as const) b.set(n, lh, {});
  for (const n of ['footL', 'footR'] as const) b.p(n, gs, [[g1, {}, EZ.ease]]);
  b.p('earL', gs, [[g1 + 0.05, { r: -7 }, EZ.ease], [g1 + 0.17, { r: 3 }, EZ.ease], [g1 + 0.28, { r: 0 }, EZ.ease]]);
  b.p('earR', gs, [[g1 + 0.05, { r: -6 }, EZ.ease], [g1 + 0.17, { r: 3 }, EZ.ease], [g1 + 0.28, { r: 0 }, EZ.ease]]);
  b.p('shadow', g0, [[gs, { x: -4, sx: 1.2, sy: 0.92 }, EZ.in], [g1, { sx: 1.04 }, EZ.ease], [g1 + 0.2, {}, EZ.out]]);
  toOpen(b, g1 + 0.1);
  blink(b, D - 0.22, 0.14);
  return b.shot(v, D, ['floor', 'lf']);
}

export const SLUMP_S = 6.2;

/**
 * Round 3 «Сполз» (Felix: the swap to the lying drawing «будто персонаж вообще меняется» — the flop is dropped): one
 * continuous slump of the SAME puppet, nothing swapped, nothing drawn new. He gets sleepy (eyelids, a small yawn), leans
 * to his side and slowly slides down: the whole puppet tilts as one piece about the bottom edge on that side (64°), his
 * bottom slips out a little the other way, the lower ear hangs down to the floor, the upper one lies against his cheek,
 * eyes ^ ^, his front paws droop with gravity; slow breaths; then the lower paw pushes and he rises just as smoothly.
 * (Where his side presses on the floor, the floor clip flattens it: ≤ 6 units.)
 */
function authorSlump(b: Builder): Shot {
  const D = SLUMP_S;
  const TILT = 64;
  const SLIDE = -40;
  const PRESS = 6;
  // the pivot: the bottom edge on his left (viewer's right); `.al-roll` turns about ROLL_ORIGIN, so each key carries the
  // translation that keeps the pivot in place (plus the slide and the press)
  const P = { x: 58, y: -1 };
  const dx = P.x - ROLL_ORIGIN.x;
  const dy = P.y - ROLL_ORIGIN.y;
  const rollAt = (deg: number, slide: number, press: number): ChannelInput => {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return { x: r2(dx - (dx * c - dy * s) + slide), y: r2(dy - (dx * s + dy * c) + press), r: r2(deg) };
  };
  const smooth = (u: number) => u * u * (3 - 2 * u);
  /** many keys (the pivot stays put between them), from a to b, eased softly */
  const lean = (ta: number, tb: number, a: number, z: number) => {
    const keys: Key[] = [];
    const N = 14;
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const e = smooth(u);
      const k = (a + (z - a) * e) / TILT;
      keys.push([ta + (tb - ta) * u, rollAt(TILT * k, SLIDE * k, PRESS * k * k), EZ.lin]);
    }
    b.p('roll', ta, keys);
  };
  /** the lower ear hangs straight down whatever the tilt (it turns back by what the head turns past 27°) */
  const hang = (deg: number) => Math.min(0, 27 - deg);

  // 1 · sleepy: eyelids come down halfway, a small slow yawn, the ears relax
  b.marks.sleepy = 0;
  b.p('lidL', 0.1, [[0.8, { y: 7 }, EZ.inOut]]);
  b.p('lidR', 0.1, [[0.8, { y: 7 }, EZ.inOut]]);
  b.marks.yawn = 0.3;
  yawn(b, 0.3, 0.26, 0.2, 0.22, { sx: 1.4, sy: 1.7 });
  b.p('earL', 0.1, [[0.8, { r: 4 }, EZ.inOut]]);
  b.p('earR', 0.1, [[0.8, { r: -4 }, EZ.inOut]]);

  // 2 · leans and slowly slides down onto his side (1.5 s): eyes close (^ ^ behind the closed lids), ears and paws follow
  const s0 = 0.9;
  const s1 = 2.4;
  b.marks.slump = s0;
  lean(s0, s1, 0, TILT);
  b.p('lidL', s0, [[1.6, { y: 17 }, EZ.inOut]]);
  b.p('lidR', s0, [[1.6, { y: 17 }, EZ.inOut]]);
  b.set('eyesG', 1.62, { o: 0 });
  b.set('happy', 1.62, { o: 1 });
  b.set('lidL', 1.63, {});
  b.set('lidR', 1.63, {});
  const earKeys: Key[] = [];
  for (let i = 1; i <= 8; i++) {
    const u = i / 8;
    // a little behind the head (the ear follows), never past what hangs straight down
    const lag = smooth(Math.max(0, u - 0.08) / 0.92);
    earKeys.push([s0 + (s1 + 0.12 - s0) * u, { r: Math.min(-4 * (1 - lag), hang(TILT * lag)) }, EZ.lin]);
  }
  b.p('earR', s0, earKeys);
  b.p('earL', s0, [[s1 + 0.1, { r: -12 }, EZ.inOut]]);
  b.p('pawL', s0 + 0.2, [[s1 + 0.1, { x: 5, y: 3, r: 15 }, EZ.inOut]]);
  b.p('pawR', s0 + 0.2, [[s1 + 0.1, { x: 7, y: 3, r: 20 }, EZ.inOut]]);
  b.p('shadow', s0, [[s1, { x: 34, sx: 1.25, sy: 0.95 }, EZ.inOut]]);

  // 3 · lies on his side: two slow breaths (he rises a hair and settles), the cheeks with them; the upper ear twitches
  const L0 = s1 + 0.1;
  b.marks.lie = L0;
  for (let i = 0; i < 2; i++) {
    const tb = L0 + i * 1.0;
    b.p('roll', tb, [[tb + 0.5, rollAt(TILT - 1.4, SLIDE, PRESS), EZ.ease], [tb + 1.0, rollAt(TILT, SLIDE, PRESS), EZ.ease]]);
    b.p('cheekL', tb, [[tb + 0.5, { sx: 1.03, sy: 1.03 }, EZ.ease], [tb + 1.0, {}, EZ.ease]]);
    b.p('cheekR', tb, [[tb + 0.5, { sx: 1.03, sy: 1.03 }, EZ.ease], [tb + 1.0, {}, EZ.ease]]);
  }
  b.marks.ear = L0 + 1.2;
  b.p('earL', L0 + 1.2, [[L0 + 1.28, { r: -18 }, 'ease-out'], [L0 + 1.4, { r: -9 }, EZ.ease], [L0 + 1.52, { r: -12 }, EZ.ease]]);

  // 4 · pushes back up just as smoothly: the lower paw presses, the body rises, the ears come back with a little swing
  const g0 = L0 + 2.0;
  const g1 = g0 + 1.2;
  b.marks.up = g0;
  b.p('pawR', g0 - 0.2, [[g0 + 0.05, { x: 13, y: 1, r: 26 }, EZ.out]]);
  lean(g0, g1, TILT, 0);
  b.p('pawR', g0 + 0.3, [[g1, {}, EZ.inOut]]);
  b.p('pawL', g0 + 0.2, [[g1, {}, EZ.inOut]]);
  const upKeys: Key[] = [];
  for (let i = 1; i <= 8; i++) {
    const u = i / 8;
    upKeys.push([g0 + (g1 - g0) * u, { r: hang(TILT * (1 - smooth(u))) }, EZ.lin]);
  }
  b.p('earR', g0, [...upKeys, [g1 + 0.12, { r: 5 }, EZ.ease], [g1 + 0.26, { r: -2 }, EZ.ease], [g1 + 0.36, {}, EZ.ease]]);
  b.p('earL', g0, [[g1, { r: 4 }, EZ.inOut], [g1 + 0.14, { r: -2 }, EZ.ease], [g1 + 0.26, {}, EZ.ease]]);
  b.p('shadow', g0, [[g1, {}, EZ.inOut]]);
  toOpen(b, g1 + 0.02);
  return b.shot('slump', D, ['floor']);
}

// ------------------------------------------------------------------------------------------------ the catalogue

export interface MoveInfo {
  readonly id: MoveId;
  readonly kind: AliveKind;
  /** Russian title (as in Felix's list) and the German name */
  readonly ru: string;
  readonly de: string;
  readonly duration: number;
  /** one line for Felix (RU) */
  readonly line: string;
  /** dropped by Felix (31.10): only on the page with &archive=1, never in the mix */
  readonly archived?: boolean;
}

const ARCHIVE: readonly MoveInfo[] = [
  { id: 'flop', kind: 'bunny', archived: true, ru: 'Флоп (архив)', de: 'Plumps', duration: FLOP_S, line: 'Отклонён (31.10, «ваще странно выглядит»). Настоящий флоп: чуть качнулся — и бросился на бок; лежит длинный и плоский, голова на щеке, ушки раскинуты по полу, задние лапки вытянуты, ^ ^, медленно дышит; быстро перекатывается обратно.' },
  { id: 'slump', kind: 'bunny', archived: true, ru: 'Сполз (архив)', de: 'Hinplumpsen', duration: SLUMP_S, line: 'Отклонён (31.10, «сполз убрать»). Тот же Помпон, без подмен: засыпает (веки, маленький зевок), медленно клонится набок и сползает на бок, нижнее ушко свисает до пола, верхнее прилегает к щеке, ^ ^, медленно дышит; потом так же плавно поднимается, опираясь на лапку.' },
];

/** The page's catalogue: the archive first (as before), then the eight approved ones (from the package). */
export const MOVES: readonly MoveInfo[] = [...ARCHIVE, ...ALIVE_MOVES];

export const MOVE_IDS: readonly MoveId[] = MOVES.map((m) => m.id);

export function moveInfo(id: MoveId): MoveInfo {
  const m = MOVES.find((x) => x.id === id);
  if (!m) throw new Error(`[alive] unknown move ${id}`);
  return m;
}

/** The moment's timeline on this rig (pure: the same rig and id always give the same keys). */
export function authorMove(id: MoveId, rig: AliveRig): Shot {
  if (moveInfo(id).kind !== rig.kind) throw new Error(`[alive] ${id} is not for the ${rig.kind}`);
  if (id === 'flop') return authorFlopLike(new Builder(rig), 'flop');
  if (id === 'slump') return authorSlump(new Builder(rig));
  return authorAlive(id, rig);
}
