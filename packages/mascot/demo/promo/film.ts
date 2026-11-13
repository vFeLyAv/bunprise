/**
 * The promo film's engine (docs/design/2026-10-25-promo-video-plan.md, stage 2) — GALLERY-ONLY.
 *
 * One stage of 360 × 640 CSS px (the 1080 × 1920 video at one third; the renderer screenshots it at
 * deviceScaleFactor 3). Every moving thing is a Track of the mascot timeline (src/timeline.ts): keys at absolute
 * seconds, compiled into Web Animations that a Playhead freezes at any time. seek(t) therefore gives the same
 * frame every time — the preview scrubs, the renderer steps frame by frame, nothing drifts. Only transform and
 * opacity move (the app's motion rules); the mascots are the app's own puppets (Bunny / Hamster) with idle,
 * scenes and timers off: their ears, eyes, cheeks, paws and breathing are driven by tracks here.
 */
import { Bunny, Hamster } from '../../src/index';
import { LoopTrack, Playhead, Track, type ChannelInput } from '../../src/timeline';
import { EASE } from '../welcome-screens';

export const W = 360;
export const H = 640;

/** Easings: the app's three springs (linear()) plus plain curves for arcs and fades. */
export const EZ = {
  snappy: EASE.snappy,
  smooth: EASE.smooth,
  bouncy: EASE.bouncy,
  out: 'cubic-bezier(.2,.8,.3,1)',
  in: 'cubic-bezier(.5,0,.8,.3)',
  inOut: 'cubic-bezier(.45,0,.25,1)',
  linear: 'linear',
} as const;

type AnyTrack = Track | LoopTrack;

/** A sound at a moment of the film (demo/promo/sound.ts plays it; `opts` tune the voice, e.g. pitch). */
export interface Cue {
  t: number;
  name: string;
  opts: { pitch?: number; gain?: number; seed?: number; pan?: number };
}

export class Film {
  readonly root: HTMLElement;
  /** everything that belongs to the picture (a gentle "camera" can move it as a whole) */
  readonly world: HTMLElement;
  private readonly tracks: AnyTrack[] = [];
  private readonly playhead = new Playhead();
  private readonly owned: { destroy(): void }[] = [];
  private names = 0;
  private readonly cueList: Cue[] = [];
  duration = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.world = this.node('', 'position:absolute;inset:0', 'pf-world', root);
  }

  /** A track for `el` (several elements move together when given an array). */
  track(el: Element | readonly Element[], base: ChannelInput = {}, name = 'part'): Track {
    const t = new Track(el, `${name}#${++this.names}`, base);
    this.tracks.push(t);
    return t;
  }

  /** A repeating track: `points` = [offset 0..1, value, easing of the segment starting there]. */
  loop(el: Element, start: number, period: number, points: ReadonlyArray<readonly [number, ChannelInput, string?]>, iterations = Infinity): LoopTrack {
    const l = new LoopTrack(el, `loop#${++this.names}`, start, period, points, iterations);
    this.tracks.push(l);
    return l;
  }

  /** An absolutely placed element (left/top in stage px through `style`). */
  node(html: string, style: string, cls = 'pf', parent: HTMLElement = this.world): HTMLElement {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    el.style.cssText = `position:absolute;${style}`;
    parent.append(el);
    return el;
  }

  own(thing: { destroy(): void }): void {
    this.owned.push(thing);
  }

  /** A sound at `t` seconds (sound.ts voices: tap, pop, whoosh, thump, chime, sparkle, type, gulp, swish, bling, success, fanfare). */
  cue(t: number, name: string, opts: Cue['opts'] = {}): void {
    this.cueList.push({ t, name, opts });
  }

  /** Every cue, in time order (sorted by build()). */
  get cues(): readonly Cue[] {
    return this.cueList;
  }

  /** Compiles every track (start values inline, then the animations), paused at 0. */
  build(): void {
    let end = 0;
    for (const tr of this.tracks) {
      const base = tr.baseStyle();
      if (base) {
        for (const el of tr.els) {
          const st = (el as HTMLElement | SVGElement).style;
          if (base.transform !== undefined) st.transform = base.transform;
          if (base.opacity !== undefined) st.opacity = base.opacity;
        }
      }
      for (const c of tr.compile()) {
        this.playhead.add(c, tr.name);
        // background loops (breathing, colour fields) never decide the length
        if (Number.isFinite(c.end) && tr instanceof Track) end = Math.max(end, c.end / 1000);
      }
    }
    if (!this.duration) this.duration = end;
    this.cueList.sort((a, b) => a.t - b.t);
    this.seek(0);
  }

  seek(seconds: number): void {
    this.playhead.seek(Math.max(0, seconds) * 1000);
  }

  destroy(): void {
    this.playhead.pause();
    for (const a of this.playhead.animations) a.cancel();
    this.owned.forEach((o) => o.destroy());
    this.root.replaceChildren();
  }
}

// ---- captions ---------------------------------------------------------------------------------------------

/**
 * A caption whose words spring in one after the other (and leave together, upwards). `lines` = lines of the
 * big title; `sub` = the small line under it (fades in after the title).
 */
export function caption(film: Film, lines: string[], sub: string | null, t0: number, t1: number, opts: { size?: number; top?: number } = {}): void {
  const cap = film.node('', `left:22px;right:22px;top:${opts.top ?? 54}px;z-index:6;text-align:center`, 'pf-cap');
  if (opts.size) cap.style.fontSize = `${opts.size}px`;
  const words: HTMLElement[] = [];
  lines.forEach((line, i) => {
    if (i) cap.append(document.createElement('br'));
    line.split(' ').forEach((word, j) => {
      if (j) cap.append(' ');
      const w = document.createElement('span');
      w.className = 'pf-word';
      w.textContent = word;
      cap.append(w);
      words.push(w);
    });
  });
  words.forEach((w, i) => {
    const at = t0 + i * 0.075;
    film.track(w, { o: 0, y: 18, s: 0.9 })
      .move(at, at + 0.55, { o: 1, y: 0, s: 1 }, EZ.bouncy)
      .move(t1 + i * 0.015, t1 + i * 0.015 + 0.26, { o: 0, y: -14, s: 0.96 }, EZ.inOut);
  });
  if (sub) {
    const s = document.createElement('small');
    // a line break in `sub` breaks the line there (the install clips); the main film's subs have none
    sub.split('\n').forEach((line, i) => { if (i) s.append(document.createElement('br')); s.append(line); });
    cap.append(s);
    const at = t0 + words.length * 0.075 + 0.25;
    film.track(s, { o: 0, y: 8 }).move(at, at + 0.45, { o: 1, y: 0 }, EZ.out).move(t1, t1 + 0.25, { o: 0, y: -8 }, EZ.in);
  }
}

/** A finger tap: a soft dot presses in, a ring spreads and fades. Centre at (x, y). */
export function tap(film: Film, x: number, y: number, t: number): void {
  const dot = film.node('', `left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:0 4px 14px rgba(70,45,20,.25);z-index:8`, 'pf');
  const ring = film.node('', `left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;box-shadow:inset 0 0 0 3px rgba(240,160,75,.9);z-index:8`, 'pf');
  film.track(dot, { o: 0, s: 1.4 }).move(t - 0.22, t, { o: 1, s: 1 }, EZ.out).move(t + 0.05, t + 0.12, { s: 0.82 }, EZ.out).move(t + 0.12, t + 0.42, { o: 0, s: 1.05 }, EZ.out);
  film.track(ring, { o: 0, s: 0.6 }).set(t + 0.04, { o: 1, s: 0.7 }).move(t + 0.04, t + 0.55, { o: 0, s: 2.1 }, EZ.out);
  film.cue(t, 'tap', { pan: (x / W - 0.5) * 0.6 });
}

/** A burst of confetti from (x, y) at t (deterministic). */
export function confetti(film: Film, x: number, y: number, t: number, count = 14, spread = 1): void {
  film.cue(t, 'sparkle', { seed: Math.round(x * 7 + y), gain: Math.min(1, 0.4 + count / 24), pan: (x / W - 0.5) * 0.8 });
  const colors = ['#6C8CFF', '#FF7A9A', '#FFD166', '#7FD1AE', '#F0A04B'];
  for (let i = 0; i < count; i++) {
    const rnd = (n: number) => { const v = Math.sin((i + 1) * 9301 + n * 49297 + x) * 233280; return v - Math.floor(v); };
    const round = i % 3 === 0;
    const piece = film.node('', `left:${x - 4}px;top:${y - 3}px;width:${round ? 7 : 9}px;height:${round ? 7 : 5}px;border-radius:${round ? '50%' : '2px'};background:${colors[i % colors.length]};z-index:7`, 'pf');
    const angle = (-90 + (rnd(1) - 0.5) * 150) * (Math.PI / 180);
    const speed = (70 + rnd(2) * 70) * spread;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const spin = (rnd(3) - 0.5) * 720;
    const d = 0.9 + rnd(4) * 0.4;
    const at = (k: number) => ({ x: vx * k, y: vy * k + 150 * k * k, r: spin * k });
    film.track(piece, { o: 0, x: 0, y: 0, r: 0 })
      .set(t, { o: 1 })
      .path(t, [[t + d * 0.35, { ...at(0.35), o: 1 }, EZ.out], [t + d * 0.75, { ...at(0.75), o: 0.9 }, EZ.linear], [t + d, { ...at(1), o: 0 }, EZ.linear]]);
  }
}

// ---- mascots ----------------------------------------------------------------------------------------------

/** px per puppet unit and where the feet sit inside the puppet's viewBox (bunny.ts / hamster.ts markup). */
const RIG = {
  bunny: { scale: 1.2, feetY: 246, viewH: 260 },
  hamster: { scale: 1.25, feetY: 236, viewH: 250 },
} as const;

export interface Actor {
  kind: 'bunny' | 'hamster';
  /** the film the actor plays in (hops cue their landing sound there) */
  film: Film;
  puppet: Bunny | Hamster;
  size: number;
  /** placement: x/y in px from the start spot, o */
  travel: Track;
  /** hops (y) and tilt (r) about the feet */
  lift: Track;
  /** squash and stretch about the feet */
  squash: Track;
  earL: Track;
  earR: Track;
  eyes: Track;
  /** the round eyes group (faded out while the happy arcs show) */
  round: Track;
  happy: Track;
  face: Track;
  pawL: Track;
  pawR: Track;
  cheeks: Track;
  /** the start spot: feet at (x, y) on the stage */
  home: { x: number; y: number };
  /** stage px of a point given in puppet units, for the actor standing at its start spot (no travel) */
  at(ux: number, uy: number): { x: number; y: number };
  /** an extra drawing inside the puppet (moves and breathes with it); returns its group */
  wear(markup: string, where?: 'front' | 'back' | 'paws'): SVGGElement;
  /** the puppet's own part */
  part<T extends Element = SVGGElement>(selector: string): T;
}

/** `breathe` = seconds per breath (default 3.2 bunny / 2.6 hamster); a looping clip picks one that divides its length. */
export function actor(film: Film, kind: 'bunny' | 'hamster', x: number, feetY: number, size: number, z = 4, breathe?: number): Actor {
  const rig = RIG[kind];
  const k = size / 400;
  const feetPx = rig.feetY * k;
  const wrap = film.node('', `left:${x - size / 2}px;top:${feetY - feetPx}px;width:${size}px;height:${rig.viewH * k}px;z-index:${z}`, 'pf-actor');
  const lift = film.node('', `position:absolute;inset:0;transform-origin:50% ${feetPx}px`, 'pf', wrap);
  const sq = film.node('', `position:absolute;inset:0;transform-origin:50% ${feetPx}px`, 'pf', lift);
  const host = film.node('', 'position:absolute;inset:0', 'pf', sq);
  const puppet = kind === 'bunny'
    ? new Bunny(host, { coat: 'fawn', ears: 'lop', size, idle: false, reducedMotion: 'off', interactive: false })
    : new Hamster(host, { coat: 'golden', size, idle: false, reducedMotion: 'off', interactive: false });
  film.own(puppet);
  const part = <T extends Element = SVGGElement>(sel: string): T => {
    const el = puppet.root.querySelector<T & Element>(sel);
    if (!el) throw new Error(`[film] missing part ${sel}`);
    return el;
  };
  const all = (sel: string) => [...puppet.root.querySelectorAll(sel)];
  const a: Actor = {
    kind,
    film,
    puppet,
    size,
    travel: film.track(wrap, { x: 0, y: 0, o: 1 }, `${kind}.travel`),
    lift: film.track(lift, { y: 0, r: 0 }, `${kind}.lift`),
    squash: film.track(sq, { sx: 1, sy: 1 }, `${kind}.squash`),
    earL: film.track(part('.ear-l'), { r: 0 }, `${kind}.earL`),
    earR: film.track(part('.ear-r'), { r: 0 }, `${kind}.earR`),
    eyes: film.track(all('.eyes .eye'), { sy: 1 }, `${kind}.eyes`),
    round: film.track(part('.eyes'), { o: 1 }, `${kind}.round`),
    happy: film.track(part('.eyes-happy'), { o: 0 }, `${kind}.happy`),
    face: film.track(part('.tf'), { x: 0, y: 0 }, `${kind}.face`),
    pawL: film.track(part('.paw-l'), { x: 0, y: 0, r: 0 }, `${kind}.pawL`),
    pawR: film.track(part('.paw-r'), { x: 0, y: 0, r: 0 }, `${kind}.pawR`),
    cheeks: film.track(all('.cheek-j'), { s: 1 }, `${kind}.cheeks`),
    home: { x, y: feetY },
    at: (ux, uy) => ({ x: x - size / 2 + (200 + rig.scale * ux) * k, y: feetY - feetPx + (rig.feetY + rig.scale * uy) * k }),
    wear: (markup, where = 'front') => {
      const breathe = part('.breathe');
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = markup;
      if (where === 'back') breathe.prepend(g);
      else if (where === 'paws') breathe.insertBefore(g, breathe.querySelector('.tp'));
      else breathe.append(g);
      return g;
    },
    part,
  };
  // always alive: breathing and a slow ear sway (loops of their own; the tracks above move on top of them)
  film.loop(part('.breathe'), 0, breathe ?? (kind === 'bunny' ? 3.2 : 2.6), [[0, { sy: 1 }, EZ.inOut], [0.5, { sy: 1.025 }, EZ.inOut], [1, { sy: 1 }]]);
  return a;
}

/** Blinks at each time (a quick close and open of both eyes). */
export function blinks(a: Actor, times: readonly number[]): void {
  for (const t of times) a.eyes.path(t, [[t + 0.06, { sy: 0.1 }, EZ.in], [t + 0.15, { sy: 1 }, EZ.out]]);
}

/** Happy eyes (^ ^) from t0 to t1. */
export function happy(a: Actor, spans: ReadonlyArray<readonly [number, number]>): void {
  for (const [t0, t1] of spans) {
    a.round.move(t0, t0 + 0.08, { o: 0 }, EZ.linear).move(t1, t1 + 0.08, { o: 1 }, EZ.linear);
    a.happy.move(t0, t0 + 0.08, { o: 1 }, EZ.linear).move(t1, t1 + 0.08, { o: 0 }, EZ.linear);
  }
}

/**
 * A hop from where the actor is to (dx, dy) further (stage px), starting at t, `d` long, `h` px high:
 * a crouch before, stretch in the air, a squash on landing that settles on the bouncy spring, ears lagging.
 * Returns the landing time. Author hops of one actor in time order.
 */
export function hop(a: Actor, t: number, dx: number, dy: number, opts: { h?: number; d?: number; tilt?: number } = {}): number {
  const d = opts.d ?? 0.42;
  const h = opts.h ?? 34;
  const tilt = opts.tilt ?? Math.sign(dx) * 6;
  const from = a.travel.value;
  const to = { x: (from.x ?? 0) + dx, y: (from.y ?? 0) + dy };
  // a hop right after a landing starts from wherever the settle has got to (never a jump back in time)
  pathAfter(a.squash, t - 0.12, [
    [t, { sx: 1.1, sy: 0.88 }, EZ.out],
    [t + d * 0.3, { sx: 0.93, sy: 1.08 }, EZ.out],
    [t + d * 0.85, { sx: 1, sy: 1 }, EZ.inOut],
    [t + d, { sx: 1.14, sy: 0.84 }, EZ.out],
    [t + d + 0.32, { sx: 1, sy: 1 }, EZ.bouncy],
  ]);
  a.travel.move(t, t + d, to, EZ.inOut);
  a.lift.path(t, [
    [t + d * 0.45, { y: -h, r: tilt }, EZ.out],
    [t + d, { y: 0, r: 0 }, EZ.in],
  ]);
  // ears fly up a little in the air and flop past their rest on landing
  for (const [ear, dir] of [[a.earL, 1], [a.earR, -1]] as const) {
    pathAfter(ear, t, [
      [t + d * 0.4, { r: dir * -16 }, EZ.out],
      [t + d, { r: dir * 6 }, EZ.inOut],
      [t + d + 0.35, { r: 0 }, EZ.bouncy],
    ]);
  }
  // a soft landing (quiet: hops come in twos and threes)
  a.film.cue(t + d, 'thump', { gain: a.kind === 'bunny' ? 0.55 : 0.45, pitch: a.kind === 'bunny' ? 1 : 1.25 });
  return t + d;
}

/** track.path from max(t0, where the track ends), keeping only the points still ahead of that start. */
function pathAfter(track: Track, t0: number, points: ReadonlyArray<readonly [number, ChannelInput, string?]>): void {
  const start = Math.max(t0, track.end);
  const ahead = points.filter(([t]) => t > start + 0.01);
  if (ahead.length) track.path(start, ahead);
}

/** Looks towards (dx, dy) (px of the face, a few px) from t0 until t1, then back. */
export function look(a: Actor, t0: number, dx: number, dy: number, t1?: number): void {
  a.face.move(t0, t0 + 0.22, { x: dx, y: dy }, EZ.out);
  if (t1 !== undefined) a.face.move(t1, t1 + 0.25, { x: 0, y: 0 }, EZ.inOut);
}

const winkParts = new WeakMap<Actor, { eyeR: Track; arcL: Track }>();

/** A wink from t0 to t1: the right eye becomes a happy arc, the left one stays round. */
export function wink(film: Film, a: Actor, t0: number, t1: number): void {
  let w = winkParts.get(a);
  if (!w) {
    const eyes = [...a.puppet.root.querySelectorAll('.eyes .eye')];
    const arcs = [...a.puppet.root.querySelectorAll('.eyes-happy path')];
    const eyeR = eyes[1];
    const arcL = arcs[0];
    if (!eyeR || !arcL) return;
    w = { eyeR: film.track(eyeR, { o: 1 }, `${a.kind}.winkEye`), arcL: film.track(arcL, { o: 1 }, `${a.kind}.winkArc`) };
    winkParts.set(a, w);
  }
  w.eyeR.move(t0, t0 + 0.06, { o: 0 }, EZ.linear).move(t1, t1 + 0.06, { o: 1 }, EZ.linear);
  w.arcL.move(t0, t0 + 0.06, { o: 0 }, EZ.linear).move(t1, t1 + 0.06, { o: 1 }, EZ.linear);
  a.happy.move(t0, t0 + 0.06, { o: 1 }, EZ.linear).move(t1, t1 + 0.06, { o: 0 }, EZ.linear);
}

/** Where an element sits on the stage (centre and size, px), from offsets: the preview may scale the stage. */
export function measure(film: Film, el: HTMLElement): { x: number; y: number; w: number; h: number } {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== film.root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2, w: el.offsetWidth, h: el.offsetHeight };
}
