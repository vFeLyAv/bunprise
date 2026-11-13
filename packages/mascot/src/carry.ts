/**
 * CarryStage — the bunny WORKS (Felix's K10, 2026-10-20): after you create an occasion it picks the new
 * card up in its mouth, hops along a curved path to where it belongs (the calendar day, the feed) and puts it
 * down there with a little bounce, waves, and hops away. The same for a new wish (a small gift box into the
 * list).
 *
 * - The SAME bunny puppet as the mascot and the welcome stage (bunnyMarkup in the approved 3/4 turn, the
 *   approved hop cycle: squash, tucked feet, ears, tail, shadow); the item is our own small SVG.
 * - One timeline (timeline.ts): every animated part is one Track compiled to Web Animations, no
 *   requestAnimationFrame, no timers; seek(t) is exact (tests, screenshots). Only transform and opacity.
 * - The host is a layer over the screen (the app gives a fixed, pointer-events: none element): it never
 *   blocks input. Coordinates (from / to) are in that layer's CSS px.
 * - `landed` resolves when the item lies on its target (show the real element then), `done` when the bunny
 *   is gone. skip() jumps to the end at once (the app calls it on any tap). destroy() resolves both.
 * - Reduced motion ('force', or the OS with 'auto'): no bunny — the item simply glides from `from` to `to`
 *   and fades out there (≈ 0.6 s).
 */

import { ReducedMotion } from './core';
import { applyCoat, E, frameBox, mountBunny, type FrameBox, type Mounted, type Vec } from './welcome-actors';
import { Playhead, Track, type ChannelInput } from './timeline';
import type { BunnyCoat, CarryBox, CarryItem, CarryOptions } from './types';
import { propMarkup } from './props';
import { gallop } from './gallop';

/**
 * The turned muzzle (3/4 turn: the face moves 13 units toward the front), in bunny units from the feet: the
 * held item's near edge is there, the item sticks out in front of it like a newspaper in a dog's mouth.
 */
const MUZZLE = { x: 14, y: -74 } as const;
/** Bunny height (feet to the ear tips) in bunny units. */
const BUNNY_UNITS_TALL = 170;
/** One hop along the way: seconds and height (bunny units) — the approved walk is ~0.5 s per hop. */
const HOP_S = 0.32;
const HOP_H = 32;
/** Item sizes in bunny units (width; the card is 48:34). */
const ITEM_W = { card: 62, gift: 46, letter: 58, none: 0 } as const;

const CARRY_CSS = `
:host { position: absolute; inset: 0; overflow: hidden; pointer-events: none; contain: layout paint; }
.layer { position: absolute; inset: 0; }
.frame, .item { position: absolute; left: 0; top: 0; }
.lift, .calm, .actor { position: absolute; inset: 0; }
.item-lift, .item-body { position: absolute; inset: 0; }
.item svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
`;

/** The item: a mini occasion card (tint body, light date band, two text lines) or a gift box with a bow. */
function itemMarkup(kind: CarryItem, tint: string): string {
  if (kind === 'none') return '';
  if (kind === 'letter') return propMarkup('letter', tint);
  if (kind === 'gift') {
    return `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <ellipse cx="20" cy="38.5" rx="14" ry="2" fill="rgba(70,40,15,.18)"/>
      <rect x="4" y="15" width="32" height="22" rx="4" fill="${tint}"/>
      <rect x="4" y="15" width="32" height="22" rx="4" fill="url(#gl)" />
      <rect x="2" y="10" width="36" height="8" rx="3" fill="${tint}"/>
      <rect x="2" y="10" width="36" height="8" rx="3" fill="rgba(255,255,255,.28)"/>
      <rect x="17.5" y="10" width="5" height="27" fill="#FFF7EC"/>
      <path d="M20 10c-3-6-10-7-10-2.5S17 10 20 10zM20 10c3-6 10-7 10-2.5S23 10 20 10z" fill="#FFF7EC" stroke="rgba(150,90,40,.35)" stroke-width="1"/>
      <circle cx="20" cy="10" r="2.2" fill="#FFF7EC" stroke="rgba(150,90,40,.35)" stroke-width="1"/>
      <defs><linearGradient id="gl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity=".06"/></linearGradient></defs>
    </svg>`;
  }
  return `<svg viewBox="0 0 48 34" aria-hidden="true" focusable="false">
    <ellipse cx="24" cy="33" rx="18" ry="1.8" fill="rgba(70,40,15,.18)"/>
    <rect x="1" y="1" width="46" height="30" rx="6" fill="${tint}"/>
    <rect x="1" y="1" width="46" height="30" rx="6" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="1.2"/>
    <path d="M7 1h34a6 6 0 0 1 6 6v3H1V7a6 6 0 0 1 6-6z" fill="rgba(255,255,255,.55)"/>
    <rect x="7" y="15" width="22" height="4" rx="2" fill="rgba(60,35,15,.38)"/>
    <rect x="7" y="22" width="14" height="3.5" rx="1.75" fill="rgba(60,35,15,.22)"/>
    <circle cx="38" cy="21" r="5" fill="rgba(255,255,255,.7)"/>
  </svg>`;
}

/** Point on the quadratic Bézier P0 → C → P1 at s. */
function bez(p0: Vec, c: Vec, p1: Vec, s: number): Vec {
  const a = (1 - s) * (1 - s);
  const b = 2 * (1 - s) * s;
  const d = s * s;
  return { x: a * p0.x + b * c.x + d * p1.x, y: a * p0.y + b * c.y + d * p1.y };
}

const centre = (b: CarryBox): Vec => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });

interface Built {
  playhead: Playhead;
  tracks: Track[];
  duration: number;
  landedAt: number;
  landClock: Animation | null;
  endClock: Animation | null;
}

export class CarryStage {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  /** Resolves when the item lies on its target. */
  readonly landed: Promise<void>;
  /** Resolves when the show is over (bunny gone), after skip() or destroy() too. */
  readonly done: Promise<void>;

  private readonly options: CarryOptions;
  private readonly reduced: ReducedMotion;
  private built: Built | null = null;
  private resolveLanded!: () => void;
  private resolveDone!: () => void;
  private destroyed = false;
  private finishedShow = false;
  private landedFired = false;

  constructor(host: HTMLElement, options: CarryOptions) {
    this.host = host;
    this.options = options;
    this.landed = new Promise((r) => {
      this.resolveLanded = r;
    });
    this.done = new Promise((r) => {
      this.resolveDone = r;
    });
    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${CARRY_CSS}</style>`;
    this.reduced = new ReducedMotion(options.reducedMotion ?? 'auto');
    this.build();
  }

  /** Seconds until the bunny is gone. */
  get duration(): number {
    return this.built?.duration ?? 0;
  }

  /** Seconds until the item lies on its target. */
  get landedAt(): number {
    return this.built?.landedAt ?? 0;
  }

  /** No bunny: the reduced-motion glide. */
  get reducedMotion(): boolean {
    return this.reduced.matches;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Mid-show (the app's one-mascot-at-a-time arbiter asks this). */
  get busy(): boolean {
    return !this.destroyed && !this.finishedShow;
  }

  /** The Web Animations of the show (read-only; tests and frame tools). */
  get animations(): readonly Animation[] {
    return this.built?.playhead.animations ?? [];
  }

  play(): void {
    const b = this.built;
    if (!b || this.destroyed) return;
    if (!b.endClock) {
      // no Web Animations: the item is simply there
      this.skip();
      return;
    }
    b.playhead.playFrom(0);
    b.landClock?.finished.then(
      () => this.fireLanded(),
      () => undefined,
    );
    b.endClock.finished.then(
      () => this.finish(),
      () => undefined,
    );
  }

  /** Jumps to the end at once (a tap, a hidden page): the item is placed, the bunny is gone. */
  skip(): void {
    const b = this.built;
    if (b) b.playhead.seek(b.duration * 1000);
    this.fireLanded();
    this.finish();
  }

  /** Freezes the show at `seconds` (deterministic; tests and screenshots). */
  seek(seconds: number): void {
    this.built?.playhead.seek(Math.max(0, seconds) * 1000);
  }

  /** Styles of every animated part at `seconds` (from the same keys as the animations). */
  sample(seconds: number): Record<string, { transform?: string; opacity?: string }> {
    const out: Record<string, { transform?: string; opacity?: string }> = {};
    for (const t of this.built?.tracks ?? []) out[t.name] = t.styleAt(seconds);
    return out;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.built?.playhead.cancel();
    this.built = null;
    this.reduced.destroy();
    this.root.innerHTML = '';
    this.fireLanded();
    this.finish();
  }

  // ---------- internals ----------

  private fireLanded(): void {
    if (this.landedFired) return;
    this.landedFired = true;
    this.resolveLanded();
  }

  private finish(): void {
    if (this.finishedShow) return;
    this.finishedShow = true;
    this.resolveDone();
  }

  private clock(playhead: Playhead, seconds: number): Animation | null {
    const el = this.host as HTMLElement & { animate?: HTMLElement['animate'] };
    if (typeof el.animate !== 'function') return null;
    return playhead.adopt(el.animate([], { duration: seconds * 1000 }), seconds * 1000);
  }

  private build(): void {
    const o = this.options;
    const kind: CarryItem = o.item ?? 'card';
    const tint = o.tint ?? '#F7B27A';
    const tracks: Track[] = [];
    const playhead = new Playhead();
    const from = centre(o.from);
    const to = o.away ? { x: o.away === 'right' ? (this.host.clientWidth || 390) + 150 : -150, y: from.y } : centre(o.to);
    const isStatic = this.reduced.matches;
    if (isStatic && (o.away || kind === 'none')) {
      this.built = { playhead, tracks, duration: 0, landedAt: 0, landClock: null, endClock: null };
      return;
    }

    // the bunny's size: from the target's height (a list row, a calendar cell), 84–120 px tall
    const tall = o.size ?? Math.max(84, Math.min(120, o.to.height * 1.6));
    const u = tall / BUNNY_UNITS_TALL;
    const itemW = ITEM_W[kind] * u;
    const itemH = kind === 'gift' ? itemW : (itemW * 34) / 48;

    // the item: frame (travel) > lift (hop arc) > body (swing, drop, squash) > svg
    const item = document.createElement('div');
    item.className = 'item';
    item.style.width = `${itemW}px`;
    item.style.height = `${itemH}px`;
    const itemLift = document.createElement('div');
    itemLift.className = 'item-lift';
    const itemBody = document.createElement('div');
    itemBody.className = 'item-body';
    // held at its near edge in the mouth: it swings about that point (set again below for the direction)
    itemBody.style.transformOrigin = '0% 30%';
    itemBody.innerHTML = itemMarkup(kind, tint);
    itemLift.append(itemBody);
    item.append(itemLift);

    /** item frame translate that puts its centre on p */
    const itemAt = (p: Vec): ChannelInput => ({ x: p.x - itemW / 2, y: p.y - itemH / 2 });

    if (isStatic) {
      // reduced motion: the item glides from `from` to `to` (no hops, no bounce) and fades out there
      this.root.append(item);
      const travel = new Track(item, 'item.travel', { ...itemAt(from), o: 0 });
      travel.path(0, [
        [0.12, { o: 1 }, 'ease-out'],
        [0.5, { ...itemAt(to) }, E.out],
        [0.62, { o: 1 }],
        [0.8, { o: 0 }, 'ease-in'],
      ]);
      tracks.push(travel);
      const landedAt = 0.5;
      const duration = 0.82;
      this.compile(playhead, tracks);
      const landClock = this.clock(playhead, landedAt);
      const endClock = this.clock(playhead, duration);
      this.built = { playhead, tracks, duration, landedAt, landClock, endClock };
      return;
    }

    // ---- the bunny ----
    const box: FrameBox = frameBox(u);
    const W = this.host.clientWidth || 390;
    // it faces the way it goes; straight up or down it faces the middle of the screen (and exits that way)
    const dir: 1 | -1 = Math.abs(to.x - from.x) > 24 ? (to.x > from.x ? 1 : -1) : to.x < W / 2 ? 1 : -1;
    const layer = document.createElement('div');
    layer.className = 'layer';
    this.root.append(layer);
    const mounted: Mounted = mountBunny(layer, box, 'run carry');
    // the pop-up grows about the feet, like the breathing
    mounted.lift.style.transformOrigin = `${box.ox}px ${box.oy}px`;
    const hm = mounted.q('.hm');
    applyCoat(mounted.host, hm, (o.coat ?? 'fawn') as BunnyCoat);
    hm.classList.add(dir === 1 ? 'turn-r' : 'turn-l');
    // the item in front of the bunny (it is held at the muzzle)
    layer.append(item);
    itemBody.style.transformOrigin = dir === 1 ? '0% 30%' : '100% 30%';

    /** the held item's centre, from the feet: its near edge at the muzzle, a little below the mouth line */
    const hold: Vec = { x: dir * (MUZZLE.x * u + itemW / 2 - 3 * u), y: MUZZLE.y * u + itemH * 0.3 };
    /** frame translate that puts the feet on p */
    const feetAt = (p: Vec): ChannelInput => ({ x: p.x - box.ox, y: p.y - box.oy });
    /** where the held item's centre is when the feet are on p */
    const heldAt = (p: Vec): Vec => ({ x: p.x + hold.x, y: p.y + hold.y });

    // feet positions: it pops up out of the `from` box; it stops ON the target's top edge, a little to the
    // side, so the held item is right above the target's centre (and drops onto it); the way out continues
    // forward off the layer
    const start: Vec = { x: from.x - hold.x, y: from.y + tall * 0.25 };
    const stop: Vec = { x: to.x - hold.x, y: o.away ? start.y : o.to.top + 4 };
    const dx = stop.x - start.x;
    const dy = stop.y - start.y;
    const dist = Math.hypot(dx, dy) || 1;
    // a curve: the middle of the way bulges sideways — to the side it faces — and a little up
    let nx = -dy / dist;
    let ny = dx / dist;
    if (Math.sign(nx) !== dir) {
      nx = -nx;
      ny = -ny;
    }
    const bulge = Math.max(30, dist * 0.2);
    const midX = (start.x + stop.x) / 2;
    const ctrl: Vec = { x: midX + nx * bulge, y: (start.y + stop.y) / 2 + ny * bulge - dist * 0.08 };
    const hops = Math.max(2, Math.min(5, Math.round(dist / (150 * u))));

    const frame = new Track(mounted.frame, 'bunny.frame', { ...feetAt(start), o: 0 });
    const lift = new Track(mounted.lift, 'bunny.lift', { y: 0, sx: 0.7, sy: 0.7 });
    const squash = new Track(mounted.q('.squash'), 'bunny.squash', { sx: 1, sy: 1 });
    const earL = new Track(mounted.q('.lop .ear-l'), 'bunny.earL', { r: 0 });
    const earR = new Track(mounted.q('.lop .ear-r'), 'bunny.earR', { r: 0 });
    const footL = new Track(mounted.q('.foot-l'), 'bunny.footL', { x: 0, y: 0, r: 0, s: 1 });
    const footR = new Track(mounted.q('.foot-r'), 'bunny.footR', { x: 0, y: 0, r: 0, s: 1 });
    const shadow = new Track(mounted.q<SVGElement>('.shadow'), 'bunny.shadow', { sx: 1, sy: 1, o: 1 });
    const pawL = new Track(mounted.q('.paw-l'), 'bunny.pawL', {});
    const tail = new Track(mounted.q(dir === 1 ? '.tail-l' : '.tail-r'), 'bunny.tail', {});
    const eyes = new Track(mounted.q('.eyes'), 'bunny.eyes', { o: 1, sx: 1, sy: 1 });
    const star = new Track(mounted.q('.eyes-star'), 'bunny.star', { o: 0 });
    const mouthOpen = new Track(mounted.q<SVGElement>('.mouth-open'), 'bunny.mouthOpen', { o: 0 });
    const paw = new Track(mounted.q('.paw-r'), 'bunny.paw', { x: 0, y: 0, r: 0 });
    const itemTravel = new Track(item, 'item.travel', { ...itemAt(heldAt(start)), o: 0 });
    const itemArc = new Track(itemLift, 'item.lift', { y: 0 });
    const itemSwing = new Track(itemBody, 'item.body', { r: 0, sx: 1, sy: 1 });
    tracks.push(frame, lift, squash, earL, earR, footL, footR, shadow, eyes, star, mouthOpen, paw, pawL, tail, itemTravel, itemArc, itemSwing);

    // A decorative jump from the + has no pickup, gift drop or success celebration.
    if (kind === 'none') {
      frame.set(0, { ...feetAt(from), o: 1 });
      frame.path(0, [[0.26, { ...feetAt(bez(from, ctrl, stop, 0.48)) }, E.out], [0.58, { ...feetAt(stop) }, E.in], [0.72, { ...feetAt({ x: stop.x + dir * 22, y: stop.y + 18 }), o: 0 }, E.in]]);
      lift.path(0, [[0.16, { y: -24 * u, sx: 1, sy: 1 }, E.out], [0.38, { y: -36 * u }], [0.58, { y: 0 }, E.in]]);
      gallop({ squash, earL, earR, footL, footR, shadow, pawL, pawR: paw, tail }, 0, 0.58, dir);
      this.compile(playhead, tracks);
      this.built = { playhead, tracks, duration: 0.76, landedAt: 0.58, landClock: this.clock(playhead, 0.58), endClock: this.clock(playhead, 0.76) };
      return;
    }

    // 0 – 0.3: it pops up out of the `from` box with the item in its mouth (a small jump, grows to size)
    const t0 = 0;
    const tPop = 0.3;
    frame.set(t0, { o: 1 });
    itemTravel.set(t0, { o: 1 });
    lift.path(t0, [
      [t0 + 0.16, { y: -26 * u, sx: 1.02, sy: 1.02 }, E.out],
      [tPop, { y: 0, sx: 1, sy: 1 }, E.in],
    ]);
    itemArc.path(t0, [
      [t0 + 0.16, { y: -26 * u }, E.out],
      [tPop, { y: 0 }, E.in],
    ]);
    squash.path(t0, [
      [t0 + 0.16, { sx: 0.95, sy: 1.06 }],
      [tPop, { sx: 1.08, sy: 0.92 }],
      [tPop + 0.08, { sx: 1, sy: 1 }],
    ]);

    // the way: hops along the curve (each hop: travel at an even speed, an arc up and down, squash on
    // touch-down, feet tucked, ears and the dangling item swing)
    let t = tPop + 0.05;
    let prev = start;
    for (let i = 1; i <= hops; i++) {
      const p = bez(start, ctrl, stop, i / hops);
      t = this.hop(t, prev, p, dir, u, { frame, lift, squash, earL, earR, footL, footR, shadow, pawL, pawR: paw, tail, itemTravel, itemArc, itemSwing }, feetAt, (q) => itemAt(heldAt(q)));
      prev = p;
    }

    if (o.away) {
      frame.move(t, t + 0.05, { o: 0 });
      itemTravel.move(t, t + 0.05, { o: 0 });
      this.compile(playhead, tracks);
      this.built = { playhead, tracks, duration: t + 0.1, landedAt: t, landClock: this.clock(playhead, t), endClock: this.clock(playhead, t + 0.1) };
      return;
    }

    // the stop: sits, then puts the item down onto the target with a little bounce
    const tStop = t;
    squash.path(tStop, [
      [tStop + 0.1, { sx: 1.06, sy: 0.94 }],
      [tStop + 0.22, { sx: 1, sy: 1 }, E.spring],
    ]);
    const tDrop = tStop + 0.12;
    const landedAt = tDrop + 0.3;
    itemTravel.path(tDrop, [
      [tDrop + 0.14, { ...itemAt({ x: to.x, y: Math.min(to.y, heldAt(stop).y) - 10 * u }) }, E.out],
      [landedAt, { ...itemAt(to) }, E.in],
    ]);
    itemSwing.path(Math.max(tDrop, itemSwing.end), [
      [tDrop + 0.14, { r: dir * -8, sx: 1, sy: 1 }, E.out],
      [landedAt, { r: 0 }, E.in],
      [landedAt + 0.06, { sx: 1.12, sy: 0.84 }, E.out],
      [landedAt + 0.16, { sx: 0.96, sy: 1.05 }],
      [landedAt + 0.26, { sx: 1, sy: 1 }],
    ]);

    // happy: star eyes, the mouth opens, ears perk, a little hop, and it waves with its paw
    const tHappy = landedAt + 0.05;
    eyes.set(tHappy, { o: 0 });
    star.set(tHappy, { o: 1 });
    mouthOpen.set(tHappy, { o: 1 });
    earL.path(Math.max(tHappy, earL.end), [
      [tHappy + 0.2, { r: -12 }, E.spring],
      [tHappy + 0.9, { r: -10 }],
      [tHappy + 1.1, { r: 0 }, E.spring],
    ]);
    earR.path(Math.max(tHappy, earR.end), [
      [tHappy + 0.2, { r: 12 }, E.spring],
      [tHappy + 0.9, { r: 10 }],
      [tHappy + 1.1, { r: 0 }, E.spring],
    ]);
    lift.path(Math.max(tHappy, lift.end), [
      [tHappy + 0.14, { y: -10 * u }, E.out],
      [tHappy + 0.28, { y: 0 }, E.in],
    ]);
    squash.path(Math.max(tHappy + 0.26, squash.end), [
      [tHappy + 0.32, { sx: 1.05, sy: 0.95 }],
      [tHappy + 0.42, { sx: 1, sy: 1 }],
    ]);
    // the approved greet wave (translate(40,-26) rotate −22° ↔ 16°), two swings
    const tw = tHappy + 0.26;
    paw.path(tw, [
      [tw + 0.14, { x: 40, y: -26, r: -22 }, E.out],
      [tw + 0.3, { x: 40, y: -26, r: 16 }, E.inOut],
      [tw + 0.46, { x: 40, y: -26, r: -22 }, E.inOut],
      [tw + 0.62, { x: 0, y: 0, r: 0 }, E.inOut],
    ]);
    const tCalm = tw + 0.64;
    star.set(tCalm, { o: 0 });
    eyes.set(tCalm, { o: 1 });
    mouthOpen.set(tCalm, { o: 0 });
    // the item stays on the target a moment (the real one appears under it), then fades away
    itemTravel.move(Math.max(landedAt + 0.5, itemTravel.end), landedAt + 0.75, { o: 0 }, 'ease-in');

    // hops away forward, off the layer, a little faster every hop
    t = Math.max(tCalm, lift.end, squash.end) + 0.05;
    prev = stop;
    const exitX = dir === 1 ? W + tall : -tall;
    const away = Math.max(2, Math.min(3, Math.ceil(Math.abs(exitX - stop.x) / (150 * u))));
    for (let i = 1; i <= away; i++) {
      const p = { x: stop.x + ((exitX - stop.x) * i) / away, y: stop.y };
      t = this.hop(t, prev, p, dir, u, { frame, lift, squash, earL, earR, footL, footR, shadow, pawL, pawR: paw, tail }, feetAt, null, 1 + i * 0.12);
      prev = p;
    }
    frame.move(t, t + 0.05, { o: 0 });
    const duration = Math.round((t + 0.1) * 1000) / 1000;

    this.compile(playhead, tracks);
    const landClock = this.clock(playhead, landedAt);
    const endClock = this.clock(playhead, duration);
    this.built = { playhead, tracks, duration, landedAt, landClock, endClock };
  }

  /**
   * One hop from feet position a to b (the approved hop cycle, see Runner.hopOnce): push off, an even
   * speed in the air, the landing sticks; the arc on the composited lift layer (the held item rides the
   * same arc), squash, tucked feet, ears; the item swings on the mouth. Returns when it has landed.
   */
  private hop(
    t: number,
    a: Vec,
    b: Vec,
    dir: 1 | -1,
    u: number,
    T: {
      frame: Track;
      lift: Track;
      squash: Track;
      earL: Track;
      earR: Track;
      footL: Track;
      footR: Track;
      shadow: Track;
      pawL?: Track;
      pawR?: Track;
      tail?: Track;
      itemTravel?: Track;
      itemArc?: Track;
      itemSwing?: Track;
    },
    feetAt: (p: Vec) => ChannelInput,
    itemAt: ((p: Vec) => ChannelInput) | null,
    speed = 1,
  ): number {
    const d = HOP_S / speed;
    const h = HOP_H * u;
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
      T.itemSwing.path(Math.max(t, T.itemSwing.end), [
        [t + 0.32 * d, { r: dir * -7 }, E.out],
        [t + 0.72 * d, { r: dir * 6 }, E.inOut],
        [t + d, { r: 0 }, E.out],
      ]);
    }
    gallop(T, t, d, dir);
    return t + d;
  }

  private compile(playhead: Playhead, tracks: Track[]): void {
    for (const tr of tracks) {
      const base = tr.baseStyle();
      for (const el of tr.els) {
        const st = (el as HTMLElement).style;
        if (base.transform !== undefined) st.transform = base.transform;
        if (base.opacity !== undefined) st.opacity = base.opacity;
      }
      for (const c of tr.compile()) playhead.add(c, tr.name);
    }
  }
}
