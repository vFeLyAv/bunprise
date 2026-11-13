/**
 * «Корзинка» (docs/ideas/2026-10-26-mascot-ideas.md §1.1) — GALLERY-ONLY prototype, built from the carry machinery of
 * src/carry.ts without changing it: the same bunny puppet (mountBunny, 3/4 turn), the same hop (a copy of CarryStage's
 * private hop(): even speed in the air, the landing sticks, squash, tucked feet, ears, tail, shadow — gallop()), the
 * same item layering (travel > arc > swing). New here, all in this file:
 *   - the item `basket` (a small woven basket, held by its HANDLE in the mouth: it hangs and swings on that point);
 *   - a SHORT carry without the wave: pops out from behind the screen's right edge at the claimed row, 2 hops to the
 *     line "Du bringst: …", sets the basket down there (it melts into the line's highlight), eyes ^ ^, turns round
 *     (the approved quarter turn, driven by tracks so it can go l → r) and hops back behind the same edge.
 *   - `finale: 'binky'` (the last free item, 26.10): the same carry and set-down (a little further on the line, so
 *     the word is clear of him while he stays), but your item comes first: the basket melts into the line while he
 *     turns to face you; then he does ONE binky on the card's edge (the approved jump with the binky roll, see
 *     binky()), turns away and leaves the same way.
 * Later src change (Felix picked the basket on 26.10): `CarryItem` + 'basket' (BASKET_SVG, held by the handle), and a
 * CarryOptions flag `back: true` (no greet; turn round and leave the way it came) with an optional binky before it —
 * see docs/design/2026-10-26-mitbringen-moment.md.
 */

import { E, applyCoat, frameBox, mountBunny, type FrameBox, type Vec } from '../../src/welcome-actors';
import { Track, type ChannelInput } from '../../src/timeline';
import { gallop } from '../../src/gallop';
import { EASINGS } from '../../src/core';
import type { BunnyCoat } from '../../src/types';

/** The basket, ~10 lines in the style of the carry items (soft fills, a light warm stroke). viewBox 40×40, the handle's top at (20, 7.6). */
export const BASKET_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
  <ellipse class="bk-shadow" cx="20" cy="38.4" rx="14" ry="2" fill="rgba(70,40,15,.2)"/>
  <path d="M9.5 19C9.5 3.8 30.5 3.8 30.5 19" fill="none" stroke="#B57B43" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M9.5 19C9.5 3.8 30.5 3.8 30.5 19" fill="none" stroke="#E2B47A" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="2.2 2.6"/>
  <path d="M11.5 18.5q4-6.5 8.5-1.6q4.4-4.6 8.6 1.6z" fill="#FFF7EC" stroke="rgba(150,90,40,.3)" stroke-width=".8"/>
  <path d="M5 19.5h30l-3.4 15.6a3 3 0 0 1-2.9 2.4H11.3a3 3 0 0 1-2.9-2.4z" fill="#E3AE6C"/>
  <path d="M6.6 25.4h26.8M7.9 31.2h24.2" stroke="#C48A4E" stroke-width="1.5"/>
  <path d="M12.6 20.5v16.4M17.5 20.5v17M22.5 20.5v17M27.4 20.5v16.4" stroke="rgba(130,80,35,.32)" stroke-width="1.1" stroke-dasharray="2.6 3.2"/>
  <rect x="3.6" y="16.6" width="32.8" height="5" rx="2.5" fill="#EDC085" stroke="rgba(150,90,40,.35)" stroke-width=".9"/>
</svg>`;
/** Where the handle's top is in BASKET_SVG (fractions of its box): the point held in the mouth, the swing pivot. */
const HANDLE = { x: 0.5, y: 7.6 / 40 } as const;
/** The basket's bottom (fraction of its box): it stands on the line there. */
const BOTTOM = 37.5 / 40;

/** The turned mouth (3/4 turn: the face moves 13 units to the front), bunny units from the feet. */
const MOUTH = { x: 13, y: -76.5 } as const;
/** Bunny height (feet to the ear tips) in bunny units. */
const BUNNY_UNITS_TALL = 170;
/** Half the widest part (ears / cheeks), bunny units + a margin: behind the edge when the feet are this far out. */
const HALF_W = 86;
/** The carry's hop: seconds and height (bunny units). */
const HOP_S = 0.32;
const HOP_H = 32;
/** The approved quarter turn l → r through the front (s), and one half of it (side ↔ front) when the binky splits it. */
const TURN_S = 0.28;
const HALF_TURN_S = 0.16;
/**
 * The binky: src/mascot.ts jumpMotion(40, 960, binky) for the bunny — 40 units high; 0.72 s instead of 0.96 s (a
 * quarter quicker, like the carry's own quick hops; the key fractions stay the same).
 */
export const BINKY = { s: 0.72, h: 40, up: 0.18 } as const;
/** The basket melts into the line's highlight in this long (s). */
const MELT_S = 0.34;
/** Basket width in bunny units (gift 46, letter 58, card 62): at the smallest carry size (84 px) ≈ 30 px, readable. */
export const BASKET_W = 60;
/**
 * The turned body's near side reaches this far past the mouth at the height of the line (bunny units): the basket is
 * set down at least this far after the end of the text, so the bunny never covers the word the basket brings.
 */
export const BODY_REACH = 47;
/**
 * The same for the binky finale: there the new word is in the line while he still stands by it, facing you, so his
 * body's widest part (±75 units, ±81 in the crouch / landing squash) must clear the text — 68 units past the mouth.
 */
export const FRONT_REACH = 68;

export interface BasketPlan {
  /** Width of the layer (px): its right edge is the edge the bunny comes from and goes back behind (the screen's). */
  W: number;
  /** Feet line where it pops out: the claimed row (px). */
  rowY: number;
  /** The card's top edge (px): it stands on it while it sets the basket down. */
  ledge: number;
  /** The line "Du bringst: …" (px): where its text ends (with the new word) and its bottom. The basket is set down on
   *  the line just after the text — so far after it that the bunny's body never covers the new word. */
  line: { end: number; bottom: number };
  /** Timeline second at which it starts. */
  at: number;
  /** Bunny height in px (feet to ear tips). Default 84 (CarryStage's smallest). */
  tall?: number;
  coat?: BunnyCoat;
  /** 'binky': the last free item — after the set-down he faces you and does one binky before he leaves. */
  finale?: 'binky';
}

/** Timeline seconds of the binky finale. */
export interface BinkyBeats {
  /** he faces you from front[0] (the first half of the turn is done) until front[1] (the turn away starts) */
  front: [number, number];
  /** the crouch starts */
  at: number;
  /** the feet leave the edge */
  up: number;
  /** the top of the jump */
  top: number;
  /** the feet are back on the edge */
  down: number;
  /** settled after the landing */
  end: number;
}

export interface BasketShow {
  tracks: Track[];
  /** the basket stands on the line (timeline s) */
  landedAt: number;
  /** the first hop away starts */
  awayAt: number;
  /** the basket has melted into the highlight */
  meltedAt: number;
  /** the bunny is behind the edge again */
  goneAt: number;
  /** the binky finale's beats (null without it) */
  binky: BinkyBeats | null;
  /** px per bunny unit (tests) */
  u: number;
  /** feet where it stops on the ledge (tests) */
  stop: Vec;
  /** feet where it starts and ends, behind the edge (tests) */
  start: Vec;
  exit: Vec;
  /** basket box size, px */
  basket: { w: number; h: number };
  /** where the basket stands: the middle of its bottom (px) */
  drop: Vec;
}

type TurnSide = 'l' | 'r';
type TurnKey = 'tf' | 'tpatch' | 'tp' | 'teL' | 'teR' | 'tcL' | 'tcR' | 'tfootL' | 'tfootR';
const TURN_SEL: Record<TurnKey, string> = {
  tf: '.tf', tpatch: '.tpatch', tp: '.tp', teL: '.lop .te-l', teR: '.lop .te-r', tcL: '.tc-l', tcR: '.tc-r', tfootL: '.tfoot-l', tfootR: '.tfoot-r',
};
/**
 * The approved quarter turn (BUNNY_CSS .turn-l / .turn-r) as track values; null = facing you. Driven by tracks (not
 * the classes) so the bunny can turn round on the timeline (the classes would switch it in one frame).
 * `k` < 1 = only that part of the way from the front (the binky's quick head flick).
 */
export function turnPose(side: TurnSide | null, k = 1): Record<TurnKey, ChannelInput> {
  const id: ChannelInput = { x: 0, sx: 1, sy: 1 };
  if (!side) return { tf: id, tpatch: id, tp: id, teL: id, teR: id, tcL: id, tcR: id, tfootL: id, tfootR: id };
  const r = side === 'r';
  const face: ChannelInput = { x: r ? 13 : -13, sx: 0.88, sy: 1 };
  const full: Record<TurnKey, ChannelInput> = {
    tf: face,
    tpatch: face,
    tp: { x: r ? 9 : -9, sx: 1, sy: 1 },
    teL: r ? { x: 16, sx: 0.86, sy: 0.86 } : { x: -8, sx: 1, sy: 1 },
    teR: r ? { x: 8, sx: 1, sy: 1 } : { x: -16, sx: 0.86, sy: 0.86 },
    tcL: r ? { x: 0, sx: 0.55, sy: 0.55 } : { x: 0, sx: 1.04, sy: 1.04 },
    tcR: r ? { x: 0, sx: 1.04, sy: 1.04 } : { x: 0, sx: 0.55, sy: 0.55 },
    tfootL: r ? { x: 12, sx: 0.9, sy: 0.9 } : { x: -5, sx: 1, sy: 1 },
    tfootR: r ? { x: 5, sx: 1, sy: 1 } : { x: -12, sx: 0.9, sy: 0.9 },
  };
  if (k === 1) return full;
  const part = (v: ChannelInput): ChannelInput => ({ x: (v.x ?? 0) * k, sx: 1 + ((v.sx ?? 1) - 1) * k, sy: 1 + ((v.sy ?? 1) - 1) * k });
  return Object.fromEntries((Object.keys(full) as TurnKey[]).map((key) => [key, part(full[key])])) as Record<TurnKey, ChannelInput>;
}

interface HopParts {
  frame: Track;
  lift: Track;
  squash: Track;
  earL: Track;
  earR: Track;
  footL: Track;
  footR: Track;
  shadow: Track;
  pawL: Track;
  pawR: Track;
  tail: Track;
  itemTravel?: Track;
  itemArc?: Track;
  itemSwing?: Track;
}

/**
 * One hop from feet a to b — CarryStage.hop() (src/carry.ts) unchanged except for the arc height `k` (a hop that
 * also climbs goes a little higher): push off, an even speed in the air, the landing sticks; the arc on the
 * composited lift layer (the held basket rides it), squash, tucked feet, ears, the basket swings on its handle.
 */
function hop(t: number, a: Vec, b: Vec, dir: 1 | -1, u: number, T: HopParts, feetAt: (p: Vec) => ChannelInput, itemAt: ((p: Vec) => ChannelInput) | null, speed = 1, k = 1): number {
  const d = HOP_S / speed;
  const h = HOP_H * u * k;
  const mid: Vec = { x: a.x + (b.x - a.x) * 0.06, y: a.y + (b.y - a.y) * 0.06 };
  const late: Vec = { x: a.x + (b.x - a.x) * 0.98, y: a.y + (b.y - a.y) * 0.98 };
  const travel = (tr: Track, at: (p: Vec) => ChannelInput) =>
    tr.path(Math.max(t, tr.end), [
      [t + 0.1 * d, at(mid), 'cubic-bezier(.5,0,1,1)'],
      [t + 0.7 * d, at(late), 'linear'],
      [t + d, at(b), 'cubic-bezier(0,0,.2,1)'],
    ]);
  travel(T.frame, feetAt);
  const arc = (tr: Track) =>
    tr.path(Math.max(t, tr.end), [
      [t + 0.32 * d, { y: -h }, E.out],
      [t + 0.7 * d, { y: 0 }, E.in],
    ]);
  arc(T.lift);
  if (itemAt && T.itemTravel && T.itemArc) {
    travel(T.itemTravel, itemAt);
    arc(T.itemArc);
  }
  if (T.itemSwing) {
    // a basket on its handle swings back as the head goes forward, then forward on the landing (like the card)
    T.itemSwing.path(Math.max(t, T.itemSwing.end), [
      [t + 0.32 * d, { r: dir * 9 }, E.out],
      [t + 0.72 * d, { r: dir * -7 }, E.inOut],
      [t + d, { r: 0 }, E.out],
    ]);
  }
  gallop(T, t, d, dir);
  return t + d;
}

type TurnTracks = ReadonlyArray<readonly [TurnKey, Track]>;

/**
 * The little hop on the spot that carries the approved quarter turn (d = the turn's length): up `h` units, squash on
 * the push-off and the landing, the ears swing with it. The turn values themselves are authored by the caller.
 */
function hopTurn(t: number, d: number, h: number, u: number, T: { lift: Track; squash: Track; earL: Track; earR: Track }): void {
  T.lift.path(Math.max(t, T.lift.end), [
    [t + d * 0.45, { y: -h * u }, E.out],
    [t + d, { y: 0 }, E.in],
  ]);
  T.squash.path(Math.max(t, T.squash.end), [
    [t + 0.06, { sx: 1.05, sy: 0.95 }],
    [t + d * 0.5, { sx: 0.97, sy: 1.03 }],
    [t + d, { sx: 1.05, sy: 0.95 }],
    [t + d + 0.08, { sx: 1, sy: 1 }],
  ]);
  T.earL.path(Math.max(t, T.earL.end), [
    [t + d * 0.5, { r: -12 }, E.inOut],
    [t + d + 0.12, { r: 0 }, E.spring],
  ]);
  T.earR.path(Math.max(t, T.earR.end), [
    [t + d * 0.5, { r: 4 }, E.inOut],
    [t + d + 0.12, { r: 0 }, E.spring],
  ]);
}

interface BinkyParts {
  lift: Track;
  body: Track;
  squash: Track;
  earL: Track;
  earR: Track;
  footL: Track;
  footR: Track;
  pawL: Track;
  pawR: Track;
  shadow: Track;
  turn: TurnTracks;
}

/**
 * ONE binky on the spot, facing you — the APPROVED jump with the binky roll: src/mascot.ts jumpMotion(40, 960, true) +
 * src/bunny.ts jumpBodyFrames(true), the same key fractions and values (BINKY: a quarter quicker). Crouch (.18), up
 * 40 units (the top at .52), the body rolls 14° at .48 and −8° at .66, feet down at .82, squash, settle.
 * The real rabbit's joy jump on top of that (inside the same keys): the head flicks against the roll (a part of the
 * quarter turn), the lop ears are flung up and out in the air and flop down on the landing, the hind feet kick out
 * once between the tucks, the front paws fly up a little.
 */
function binky(t0: number, u: number, P: BinkyParts): Omit<BinkyBeats, 'front'> {
  const d = BINKY.s;
  const at = (f: number) => t0 + f * d;
  const keys = (tr: Track, ks: ReadonlyArray<readonly [number, ChannelInput, string?]>) =>
    tr.path(Math.max(t0, tr.end), ks.map(([f, v, e]) => [at(f), v, e ?? E.inOut] as const));
  // up and down: still while it crouches, the top at .52 (the take-off curve), the feet down at .82 (the fall)
  keys(P.lift, [[BINKY.up, { y: 0 }, 'linear'], [0.52, { y: -BINKY.h * u }, E.out], [0.82, { y: 0 }, E.in]]);
  // the binky roll (on .body, about its feet) and the squash / stretch (on .squash) of jumpBodyFrames(true)
  keys(P.body, [[0.3, { r: 0 }], [0.48, { r: 14 }], [0.66, { r: -8 }], [0.84, { r: 0 }]]);
  keys(P.squash, [
    [0.18, { sx: 1.08, sy: 0.88 }],
    [0.3, { sx: 0.95, sy: 1.07 }],
    [0.48, { sx: 1, sy: 1 }],
    [0.66, { sx: 0.98, sy: 1.02 }],
    [0.84, { sx: 1.07, sy: 0.9 }],
    [0.93, { sx: 0.98, sy: 1.02 }],
    [1, { sx: 1, sy: 1 }],
  ]);
  // the twist: the head flicks against the roll — a part of the quarter turn to the left, then to the right
  const front = turnPose(null);
  const flickL = turnPose('l', 0.45);
  const flickR = turnPose('r', 0.3);
  for (const [k, tr] of P.turn) keys(tr, [[0.3, front[k]], [0.48, flickL[k]], [0.66, flickR[k]], [0.84, front[k]]]);
  // the lop ears: they drop in the crouch, are flung up and out in the air (both alike against the head — the roll
  // already tilts them), flop down on the landing, spring back
  keys(P.earL, [[0.18, { r: -6 }], [0.46, { r: 28 }], [0.66, { r: 22 }], [0.86, { r: -10 }], [1, { r: 0 }, E.spring]]);
  keys(P.earR, [[0.18, { r: 6 }], [0.46, { r: -26 }], [0.66, { r: -22 }], [0.86, { r: 10 }], [1, { r: 0 }, E.spring]]);
  // hind feet (jumpMotion's: push off, tucked, spread on the landing) with one kick out between the tucks
  for (const [tr, s, ph] of [[P.footL, 1, 0], [P.footR, -1, 0.03]] as const) {
    keys(tr, [
      [0.18, { x: -2 * s, y: 0, r: 0, sx: 1.12, sy: 1 }],
      [0.4, { x: 2 * s, y: -8, r: 18 * s, s: 0.8 }],
      [0.55 + ph, { x: -7 * s, y: -12, r: -24 * s, s: 0.88 }],
      [0.7 + ph, { x: 2 * s, y: -7, r: 14 * s, s: 0.84 }],
      [0.84, { x: -3 * s, y: 0, r: 0, sx: 1.18, sy: 1 }],
      [1, { x: 0, y: 0, r: 0, s: 1 }],
    ]);
  }
  // front paws (jumpMotion's: +2, −7, −4, +3 units) fly up a little and outward
  for (const [tr, s] of [[P.pawL, 1], [P.pawR, -1]] as const) {
    keys(tr, [
      [0.18, { x: 0, y: 2, r: 0 }],
      [0.4, { x: -2 * s, y: -7, r: -16 * s }],
      [0.66, { x: -1 * s, y: -4, r: -6 * s }],
      [0.84, { x: 0, y: 3, r: 0 }],
      [1, { x: 0, y: 0, r: 0 }],
    ]);
  }
  // the shadow on the edge: wide in the crouch, small and faint under the top, wide on the landing
  keys(P.shadow, [
    [0.18, { sx: 1.06, sy: 1.06, o: 1 }],
    [0.52, { sx: 0.62, sy: 0.62, o: 0.5 }],
    [0.84, { sx: 1.08, sy: 1.08, o: 1 }],
    [1, { sx: 1, sy: 1, o: 1 }],
  ]);
  return { at: t0, up: at(BINKY.up), top: at(0.52), down: at(0.82), end: at(1) };
}

/**
 * Builds the bunny and the basket in `layer` (absolute, inset 0, overflow clipped by the screen) and authors the
 * show from `plan.at`. Returns the tracks (to compile on the caller's Playhead) and the beats.
 */
export function authorBasket(layer: HTMLElement, plan: BasketPlan): BasketShow {
  const tall = plan.tall ?? 84;
  const u = tall / BUNNY_UNITS_TALL;
  const box: FrameBox = frameBox(u);
  const coat = plan.coat ?? 'fawn';

  const mounted = mountBunny(layer, box, 'run carry');
  mounted.lift.style.transformOrigin = `${box.ox}px ${box.oy}px`;
  const hm = mounted.q('.hm');
  applyCoat(mounted.host, hm, coat);
  const broken = coat === 'broken';

  // the basket: travel (frame) > arc (lift) > swing (about the handle's top) > settle (about its bottom) > svg
  const bw = BASKET_W * u;
  const bh = bw;
  const item = document.createElement('div');
  item.className = 'item';
  item.style.cssText = `position:absolute;left:0;top:0;width:${bw}px;height:${bh}px`;
  const itemLift = document.createElement('div');
  const itemSwing = document.createElement('div');
  const itemSettle = document.createElement('div');
  for (const d of [itemLift, itemSwing, itemSettle]) d.style.cssText = 'position:absolute;inset:0';
  itemSwing.style.transformOrigin = `${HANDLE.x * 100}% ${HANDLE.y * 100}%`;
  itemSettle.style.transformOrigin = `50% ${BOTTOM * 100}%`;
  itemSettle.innerHTML = BASKET_SVG;
  const svg = itemSettle.querySelector('svg');
  if (svg) svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
  itemSwing.append(itemSettle);
  itemLift.append(itemSwing);
  item.append(itemLift);
  layer.append(item);
  const basketShadow = itemSettle.querySelector<SVGElement>('.bk-shadow');

  // ---- geometry ----
  const dirIn: -1 = -1; // it comes from the right edge, so it faces left on the way in
  const drop: Vec = { x: plan.line.end + (plan.finale === 'binky' ? FRONT_REACH : BODY_REACH) * u + 2, y: plan.line.bottom };
  const mouth = (dir: 1 | -1): Vec => ({ x: dir * MOUTH.x * u, y: MOUTH.y * u });
  /** frame translate that puts the feet on p */
  const feetAt = (p: Vec): ChannelInput => ({ x: p.x - box.ox, y: p.y - box.oy });
  /** item frame translate that puts the handle's top in the mouth when the feet are on p */
  const heldAt = (p: Vec): ChannelInput => {
    const m = mouth(dirIn);
    return { x: p.x + m.x - HANDLE.x * bw, y: p.y + m.y - HANDLE.y * bh };
  };
  /** item frame translate that stands the basket's bottom middle on q */
  const standAt = (q: Vec): ChannelInput => ({ x: q.x - bw / 2, y: q.y - BOTTOM * bh });

  // feet: behind the right edge on the claimed row → one hop out onto the right part of the list → one hop up onto
  // the card's top edge, so the held basket hangs right above `drop` (it is set straight down) → back behind the edge
  const start: Vec = { x: plan.W + HALF_W * u, y: plan.rowY };
  const stop: Vec = { x: drop.x - mouth(dirIn).x, y: plan.ledge + 1 };
  const mid: Vec = { x: Math.min(plan.W - 62, (start.x + stop.x) / 2 + 30), y: plan.ledge + (plan.rowY - plan.ledge) * 0.72 };
  const exitMid: Vec = { x: stop.x + Math.max(56, (plan.W - stop.x) * 0.62), y: plan.ledge + 1 };
  const exit: Vec = { x: plan.W + HALF_W * u, y: plan.ledge + 1 };

  // ---- tracks ----
  const frame = new Track(mounted.frame, 'bunny.frame', { ...feetAt(start) });
  const lift = new Track(mounted.lift, 'bunny.lift', { y: 0 });
  const squash = new Track(mounted.q('.squash'), 'bunny.squash', { sx: 1, sy: 1 });
  const earL = new Track(mounted.q('.lop .ear-l'), 'bunny.earL', { r: 0 });
  const earR = new Track(mounted.q('.lop .ear-r'), 'bunny.earR', { r: 0 });
  const footL = new Track(mounted.q('.foot-l'), 'bunny.footL', { x: 0, y: 0, r: 0, s: 1 });
  const footR = new Track(mounted.q('.foot-r'), 'bunny.footR', { x: 0, y: 0, r: 0, s: 1 });
  const shadow = new Track(mounted.q<SVGElement>('.shadow'), 'bunny.shadow', { sx: 1, sy: 1, o: 1 });
  const pawL = new Track(mounted.q('.paw-l'), 'bunny.pawL', { x: 0, y: 0, r: 0 });
  const pawR = new Track(mounted.q('.paw-r'), 'bunny.pawR', { x: 0, y: 0, r: 0 });
  const tailLx = new Track(mounted.q('.tail-l'), 'bunny.tailL', { y: 0, r: 0, s: 1 });
  const tailRx = new Track(mounted.q('.tail-r'), 'bunny.tailR', { y: 0, r: 0, s: 1 });
  // which tail shows: the one behind (BUNNY_CSS: .turn-l .tail-r, .turn-r .tail-l)
  const tailLo = new Track(mounted.q('.tail-l'), 'bunny.tailL.o', { o: 0 });
  const tailRo = new Track(mounted.q('.tail-r'), 'bunny.tailR.o', { o: 1 });
  const eyes = new Track(mounted.q('.eyes'), 'bunny.eyes', { sx: 1, sy: 1, o: 1 });
  const happy = new Track(mounted.q('.eyes-happy'), 'bunny.happy', { o: 0 });
  const startPose = turnPose('l');
  const turn = (Object.keys(TURN_SEL) as TurnKey[])
    .filter((k) => k !== 'tpatch' || broken)
    .map((k) => [k, new Track(mounted.q(TURN_SEL[k]), `bunny.turn.${k}`, startPose[k])] as const);
  const itemTravel = new Track(item, 'basket.travel', { ...heldAt(start), o: 1 });
  const itemArc = new Track(itemLift, 'basket.lift', { y: 0 });
  const itemSwingT = new Track(itemSwing, 'basket.swing', { r: 0 });
  const itemSettleT = new Track(itemSettle, 'basket.settle', { sx: 1, sy: 1 });
  const bShadow = basketShadow ? new Track(basketShadow, 'basket.shadow', { o: 0 }) : null;
  // the binky roll turns the whole body about its feet (BUNNY_CSS .body: 50% 100%); only the finale moves it
  const body = plan.finale === 'binky' ? new Track(mounted.q('.body'), 'bunny.body', { r: 0 }) : null;
  const tracks: Track[] = [frame, lift, squash, earL, earR, footL, footR, shadow, pawL, pawR, tailLx, tailRx, tailLo, tailRo, eyes, happy, ...turn.map(([, tr]) => tr), itemTravel, itemArc, itemSwingT, itemSettleT];
  if (bShadow) tracks.push(bShadow);
  if (body) tracks.push(body);

  const parts = (dir: 1 | -1, withItem: boolean): HopParts => ({
    frame, lift, squash, earL, earR, footL, footR, shadow, pawL, pawR, tail: dir === -1 ? tailRx : tailLx,
    ...(withItem ? { itemTravel, itemArc, itemSwing: itemSwingT } : {}),
  });

  // ---- in: two hops, the second one climbs onto the card's top edge ----
  let t = plan.at;
  t = hop(t, start, mid, dirIn, u, parts(dirIn, true), feetAt, (p) => heldAt(p), 1.02, 1);
  // a short stick on the landing, then the climb (a hop that goes up starts from a slightly deeper crouch)
  t = hop(t + 0.02, mid, stop, dirIn, u, parts(dirIn, true), feetAt, (p) => heldAt(p), 0.94, 1.25);

  // ---- set it down: it settles, lets go, the basket drops onto the line ----
  const tStop = t;
  squash.path(Math.max(tStop, squash.end), [
    [tStop + 0.1, { sx: 1.06, sy: 0.94 }],
    [tStop + 0.24, { sx: 1, sy: 1 }, E.spring],
  ]);
  const tDrop = tStop + 0.06;
  const landedAt = tDrop + 0.16;
  const stand = standAt(drop);
  itemTravel.path(Math.max(tDrop, itemTravel.end), [
    // it is let go: a short fall (it hangs right above the drop point), the landing sticks
    [landedAt, { x: stand.x ?? 0, y: stand.y ?? 0 }, E.in],
  ]);
  itemSwingT.path(Math.max(tDrop, itemSwingT.end), [[landedAt, { r: 0 }, E.out]]);
  itemSettleT.path(landedAt, [
    [landedAt + 0.06, { sx: 1.1, sy: 0.86 }, E.out],
    [landedAt + 0.16, { sx: 0.97, sy: 1.04 }],
    [landedAt + 0.26, { sx: 1, sy: 1 }],
  ]);
  bShadow?.path(tDrop, [[landedAt, { o: 1 }, 'ease-in']]);

  // happy: a blink into eyes ^ ^ (no star, no wave — the short carry)
  const tHappy = landedAt + 0.02;
  eyes.move(tHappy, tHappy + 0.05, { sy: 0.12 }, 'ease-in');
  eyes.set(tHappy + 0.05, { o: 0, sy: 1 });
  happy.set(tHappy + 0.05, { o: 1 });

  const front = turnPose(null);
  const back = turnPose('r');
  /** the eyes open again (the end of a blink) and the turn is over */
  let tOpen: number;
  let turned: number;
  let binkyBeats: BinkyBeats | null = null;
  /** when the basket starts to melt into the line (null: after his first hop away, set below) */
  let meltFrom: number | null = null;
  if (body) {
    // ---- the last free item: he turns to face you (the first half of the approved turn), ONE binky, turns away ----
    // your thing first, then "everything is done": the basket melts into the line while he turns to you, and he
    // jumps only once it is gone (it no longer stands in front of him in the binky)
    meltFrom = landedAt + 0.1;
    const tFace = tHappy + 0.03;
    const tFront = tFace + HALF_TURN_S;
    for (const [k, tr] of turn) tr.path(tFace, [[tFront, front[k], EASINGS.turn]]);
    // facing you no tail shows (BUNNY_CSS shows a tail only in a turn): the one behind goes as he comes round
    tailRo.move(tFace + 0.04, tFace + 0.1, { o: 0 }, 'linear');
    earL.path(Math.max(tFace, earL.end), [[tFront, { r: -6 }, E.inOut]]);
    earR.path(Math.max(tFace, earR.end), [[tFront, { r: 3 }, E.inOut]]);
    const takeOff = meltFrom + MELT_S + 0.02;
    const b = binky(Math.max(tFront + 0.02, takeOff - BINKY.up * BINKY.s), u, { lift, body, squash, earL, earR, footL, footR, pawL, pawR, shadow, turn });
    // the second half of the turn (front → r), with its little hop
    const tTurn = b.end + 0.02;
    for (const [k, tr] of turn) tr.path(Math.max(tTurn, tr.end), [[tTurn + HALF_TURN_S, back[k], EASINGS.turn]]);
    tailLo.move(tTurn + 0.06, tTurn + 0.12, { o: 1 }, 'linear');
    hopTurn(tTurn, HALF_TURN_S, 7, u, { lift, squash, earL, earR });
    binkyBeats = { front: [tFront, tTurn], ...b };
    tOpen = tTurn + 0.05;
    turned = tTurn + HALF_TURN_S;
  } else {
    // the ears perk once
    earL.path(Math.max(tHappy, earL.end), [
      [tHappy + 0.2, { r: -11 }, E.spring],
      [tHappy + 0.32, { r: -9 }],
    ]);
    earR.path(Math.max(tHappy, earR.end), [
      [tHappy + 0.2, { r: 11 }, E.spring],
      [tHappy + 0.32, { r: 9 }],
    ]);
    // ---- turn round (a little hop on the spot, the approved quarter turn through the front) ----
    const tTurn = Math.max(tHappy + 0.32, earL.end) + 0.02;
    for (const [k, tr] of turn) {
      tr.path(tTurn, [
        [tTurn + TURN_S / 2, front[k], 'cubic-bezier(.5,0,.9,.6)'],
        [tTurn + TURN_S, back[k], EASINGS.turn],
      ]);
    }
    // the tails swap while the bunny faces you (both are behind the body then)
    tailRo.move(tTurn + TURN_S * 0.42, tTurn + TURN_S * 0.5, { o: 0 }, 'linear');
    tailLo.move(tTurn + TURN_S * 0.5, tTurn + TURN_S * 0.58, { o: 1 }, 'linear');
    hopTurn(tTurn, TURN_S, 9, u, { lift, squash, earL, earR });
    // in the middle of the turn
    tOpen = tTurn + TURN_S * 0.4;
    turned = tTurn + TURN_S;
  }
  happy.set(tOpen, { o: 0 });
  eyes.set(tOpen, { o: 1, sy: 0.12 });
  eyes.move(tOpen, tOpen + 0.06, { sy: 1 }, 'ease-out');

  // ---- out: two hops along the card's top edge, a little faster, back behind the right edge ----
  t = Math.max(turned + 0.04, squash.end - 0.04, earL.end - 0.1);
  const tAway = t;
  t = hop(t, stop, exitMid, 1, u, parts(1, false), feetAt, null, 1.08);
  t = hop(t, exitMid, exit, 1, u, parts(1, false), feetAt, null, 1.18);
  const goneAt = t;

  // the basket melts into the line's highlight: fades and sinks a little into it — the plain basket stays on the
  // line while he leaves (it stood in front of him) and melts once his first hop has uncovered it
  const melt = meltFrom ?? tAway + 0.14;
  const meltedAt = melt + MELT_S;
  itemSettleT.move(Math.max(melt, itemSettleT.end), meltedAt, { sx: 0.82, sy: 0.82 }, 'ease-in');
  itemTravel.move(Math.max(melt, itemTravel.end), meltedAt, { o: 0 }, 'ease-in');
  bShadow?.move(Math.max(melt, bShadow.end), meltedAt, { o: 0 }, 'ease-in');

  return { tracks, landedAt, awayAt: tAway, meltedAt, goneAt, binky: binkyBeats, u, stop, start, exit, basket: { w: bw, h: bh }, drop };
}
