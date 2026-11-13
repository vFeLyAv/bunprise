/**
 * A tiny keyframe timeline for the welcome stage.
 *
 * Every animated part gets ONE Track: keys at absolute times (seconds) with
 * numeric channels (x, y, r, sx, sy, o). A track compiles into ONE Web
 * Animation (delay = first key, duration = last - first, fill 'both'), so two
 * animations never fight over the same property and the whole stage is a single
 * timeline: seek(t) = "set currentTime = t on every animation" gives the same
 * frame every time. No requestAnimationFrame, no timers.
 *
 * The same keys can be evaluated in JS (Track.sample) — that is how the
 * reduced-motion stage builds its static pose without calling animate(), and
 * how tests check that a frame is deterministic.
 */

/** Animated channels. Translate is in px of the element's own coordinate system (user units inside SVG). */
export interface Channels {
  x?: number;
  y?: number;
  /** rotate, degrees */
  r?: number;
  sx?: number;
  sy?: number;
  /** opacity */
  o?: number;
}

/** Authoring input: Channels plus `s` = uniform scale shorthand. */
export type ChannelInput = Channels & { s?: number };

type Ch = keyof Channels;

const IDENTITY: Required<Channels> = { x: 0, y: 0, r: 0, sx: 1, sy: 1, o: 1 };
const ORDER: readonly Ch[] = ['x', 'y', 'r', 'sx', 'sy', 'o'];

export interface StyleOut {
  transform?: string;
  opacity?: string;
  /** SVG path deformation, used only by the four original surprise ear paths. */
  d?: string;
}

interface Key {
  t: number;
  v: Channels;
  /** Easing of the segment that STARTS at this key (WAAPI semantics). */
  e: string;
}

// ---------- easing ----------

const NAMED: Record<string, readonly [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

function bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - p;
      if (Math.abs(err) < 1e-7) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = p;
    for (let i = 0; i < 48; i++) {
      const x = sx(t);
      if (Math.abs(x - p) < 1e-7) break;
      if (x < p) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

const easeCache = new Map<string, (p: number) => number>();

/** Control points of a named / cubic-bezier CSS easing; null for linear and unknown strings. */
function controlPoints(css: string): readonly [number, number, number, number] | null {
  const named = NAMED[css];
  if (named) return named;
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(css.trim());
  if (!m?.[1]) return null;
  const n = m[1].split(',').map((s) => Number(s));
  if (n.length !== 4 || !n.every((v) => Number.isFinite(v))) return null;
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 1, n[3] ?? 1];
}

/** CSS easing string -> function (linear, ease*, cubic-bezier). Unknown strings act as linear. */
export function easing(css: string): (p: number) => number {
  const hit = easeCache.get(css);
  if (hit) return hit;
  const c = controlPoints(css);
  const fn: (p: number) => number = c ? bezier(...c) : (p) => p;
  easeCache.set(css, fn);
  return fn;
}

/**
 * ONE easing over a path through a waypoint. The waypoint is `frac` of the way; returns
 * [k, ease1, ease2]: arrive at the waypoint after k of the duration with ease1, go on to the end
 * with ease2 — together exactly the motion of `css` over the whole path (the curve is split at
 * that point, de Casteljau), so the speed does not jump at the waypoint, only the direction turns.
 */
export function splitEase(css: string, frac: number): [number, string, string] {
  const f = Math.min(0.98, Math.max(0.02, frac));
  const c = controlPoints(css);
  if (!c) return [f, 'linear', 'linear'];
  const [x1, y1, x2, y2] = c;
  const yAt = (s: number) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (yAt(mid) < f) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  const L = (a: number, b: number) => a + (b - a) * s;
  const a = { x: L(0, x1), y: L(0, y1) };
  const b = { x: L(x1, x2), y: L(y1, y2) };
  const d = { x: L(x2, 1), y: L(y2, 1) };
  const ab = { x: L(a.x, b.x), y: L(a.y, b.y) };
  const bd = { x: L(b.x, d.x), y: L(b.y, d.y) };
  const X = L(ab.x, bd.x);
  const Y = L(ab.y, bd.y);
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  const first = `cubic-bezier(${r(a.x / X)},${r(a.y / Y)},${r(ab.x / X)},${r(ab.y / Y)})`;
  const rest = `cubic-bezier(${r((bd.x - X) / (1 - X))},${r((bd.y - Y) / (1 - Y))},${r((d.x - X) / (1 - X))},${r((d.y - Y) / (1 - Y))})`;
  return [X, first, rest];
}

// ---------- formatting ----------

const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Channels -> CSS, always with the same function list for one track (translate, rotate, scale). */
export function formatStyles(used: ReadonlySet<Ch>, v: Channels): StyleOut {
  const parts: string[] = [];
  if (used.has('x') || used.has('y')) parts.push(`translate(${num(v.x ?? 0)}px, ${num(v.y ?? 0)}px)`);
  if (used.has('r')) parts.push(`rotate(${num(v.r ?? 0)}deg)`);
  if (used.has('sx') || used.has('sy')) parts.push(`scale(${num(v.sx ?? 1)}, ${num(v.sy ?? 1)})`);
  const out: StyleOut = {};
  if (parts.length) out.transform = parts.join(' ');
  if (used.has('o')) out.opacity = num(v.o ?? 1);
  return out;
}

function expand(v: ChannelInput): Channels {
  const out: Channels = {};
  for (const k of ORDER) if (v[k] !== undefined) out[k] = v[k];
  if (v.s !== undefined) {
    out.sx = v.s;
    out.sy = v.s;
  }
  return out;
}

function lerp(a: Channels, b: Channels, q: number, used: ReadonlySet<Ch>): Channels {
  const out: Channels = {};
  for (const k of used) {
    const va = a[k] ?? IDENTITY[k];
    const vb = b[k] ?? IDENTITY[k];
    out[k] = va + (vb - va) * q;
  }
  return out;
}

/** What a compiled track hands to Element.animate(). */
export interface Compiled {
  el: Element;
  name: string;
  frames: Keyframe[];
  timing: KeyframeAnimationOptions;
  /** ms after which the animation has nothing left to do (Infinity for loops). */
  end: number;
  /** the track's start value (the inline style before its first run) */
  base: StyleOut | null;
}

/** Shared by Track and LoopTrack. */
export interface Sampled {
  /** Every element this track drives (the same values for all of them). */
  readonly els: readonly Element[];
  readonly name: string;
  /** Styles at time t (seconds), or null when the track has no effect at t. */
  styleAt(t: number): StyleOut | null;
  /** Styles to write inline when nothing animates (start pose). */
  baseStyle(): StyleOut | null;
  /** One animation per driven element (empty when the track never changes). */
  compile(): Compiled[];
}

// ---------- Track ----------

/** A part that holds still longer than this (s) stops ticking until it moves again. */
const SPLIT_HOLD = 0.25;

/**
 * An instant change (Track.set) is a linear ramp this long (s), ending at its time; and no two keys of a track
 * ever share a time. Why (24.10.2026): a step used to be two keys at one time, i.e. two keyframes at one offset.
 * Firefox computes such an animation correctly (getComputedStyle, screenshots) but its compositor sometimes did
 * NOT paint it while later animations of the same part were still pending — in «Переел» c the round eyes stayed
 * under the ^ ^ arcs and a blink never showed. Only a real screencast showed it.
 */
export const STEP = 0.001;

export class Track implements Sampled {
  readonly els: readonly Element[];
  /** Strictly increasing times (push() keeps them apart by at least STEP when they would meet). */
  private readonly keys: Key[] = [];
  private readonly used = new Set<Ch>();
  private readonly base: Channels;
  private cur: Channels;
  /** The key that ends the latest set() ramp (a second set at that time joins it). */
  private stepEnd: Key | null = null;

  constructor(
    el: Element | readonly Element[],
    readonly name: string,
    base: ChannelInput = {},
  ) {
    this.els = Array.isArray(el) ? [...(el as readonly Element[])] : [el as Element];
    this.base = expand(base);
    this.cur = { ...this.base };
    this.mark(this.base);
  }

  /** Time of the last key (-Infinity when nothing is authored yet). */
  get end(): number {
    return this.keys[this.keys.length - 1]?.t ?? -Infinity;
  }

  /** Time of the first key (Infinity when nothing is authored yet). */
  get start(): number {
    return this.keys[0]?.t ?? Infinity;
  }

  /** The value at the end of what is authored so far. */
  get value(): Channels {
    return { ...this.cur };
  }

  get keyCount(): number {
    return this.keys.length;
  }

  /** Keep the current value until `t`. */
  hold(t: number): this {
    const at = Math.max(t, this.end);
    const last = this.keys[this.keys.length - 1];
    if (last && last.t === at) return this;
    this.keys.push({ t: at, v: { ...this.cur }, e: 'linear' });
    return this;
  }

  /**
   * Jump to `v` at `t` (a switch; use it while the part is hidden): a STEP-long linear ramp that is complete
   * at `t` (when the track already has a key after `t - STEP` it starts there and ends STEP later). Several
   * switches at one moment stay one ramp (a second set at that time joins it).
   */
  set(t: number, v: ChannelInput): this {
    const last = this.keys[this.keys.length - 1];
    if (last && last === this.stepEnd && t <= last.t) {
      this.apply(v);
      last.v = { ...this.cur };
      return this;
    }
    const from = Math.max(t - STEP, this.end);
    this.hold(from);
    const start = this.keys[this.keys.length - 1];
    if (start) start.e = 'linear';
    this.apply(v);
    this.push(from === t - STEP ? t : from + STEP);
    this.stepEnd = this.keys[this.keys.length - 1] ?? null;
    return this;
  }

  /** Hold until `t0`, then animate to `v`, arriving at `t1`, with `ease` for that segment. */
  move(t0: number, t1: number, v: ChannelInput, ease = 'ease-in-out'): this {
    this.hold(t0);
    const last = this.keys[this.keys.length - 1];
    if (last) last.e = ease;
    this.apply(v);
    this.push(t1);
    return this;
  }

  /**
   * Appends the current value at `t`. A key at or before the last one (a move of no length, e.g. a path whose
   * times are already over) is an instant change: one STEP-long ramp after the last key, and every further
   * such key joins that ramp — the same final value at (almost) the same time as before, never two keys at
   * one time and never a flicker through the values in between.
   */
  private push(t: number): void {
    const last = this.keys[this.keys.length - 1];
    if (!last || t > last.t) {
      this.keys.push({ t, v: { ...this.cur }, e: 'linear' });
      return;
    }
    if (last === this.stepEnd) {
      last.v = { ...this.cur };
      return;
    }
    const key: Key = { t: last.t + STEP, v: { ...this.cur }, e: 'linear' };
    this.keys.push(key);
    this.stepEnd = key;
  }

  /** Several moves in a row: [arrival time, value, easing of the segment arriving there]. Starts at `t0`. */
  path(t0: number, points: ReadonlyArray<readonly [number, ChannelInput, string?]>): this {
    let from = t0;
    for (const [t, v, e] of points) {
      this.move(from, t, v, e ?? 'ease-in-out');
      from = t;
    }
    return this;
  }

  /** Channel values at time t (seconds), WAAPI 'fill: both' semantics. */
  sample(t: number): Channels {
    const k = this.keys;
    if (!k.length) return { ...this.base };
    let i = -1;
    for (let j = 0; j < k.length; j++) {
      const key = k[j];
      if (key && key.t <= t) i = j;
      else break;
    }
    const first = k[0];
    if (i < 0) return { ...(first?.v ?? this.base) };
    const a = k[i];
    const b = k[i + 1];
    if (!a) return { ...this.base };
    if (!b) return { ...a.v };
    const span = b.t - a.t;
    const p = span > 0 ? (t - a.t) / span : 1;
    return lerp(a.v, b.v, easing(a.e)(p), this.used);
  }

  styleAt(t: number): StyleOut {
    return formatStyles(this.used, this.sample(t));
  }

  baseStyle(): StyleOut {
    return formatStyles(this.used, this.keys[0]?.v ?? this.base);
  }

  /**
   * Web Animations for the track: one per "run" of movement and per driven element (none
   * when it never changes). A hold longer than SPLIT_HOLD splits the track into runs, so an
   * actor that waits does not tick. Runs use fill 'forwards' and are created in time order:
   * a later run overrides an earlier one, the last run that has started wins — exactly the
   * track's value at any t (before the first run the inline base style shows the start).
   */
  compile(): Compiled[] {
    const k = this.keys;
    if (k.length < 2) return [];
    const same = (a: Key, b: Key) => ORDER.every((c) => (a.v[c] ?? IDENTITY[c]) === (b.v[c] ?? IDENTITY[c]));
    const runs: Key[][] = [];
    let run: Key[] = [];
    for (let i = 0; i < k.length; i++) {
      const key = k[i];
      if (!key) continue;
      run.push(key);
      const next = k[i + 1];
      if (next && same(key, next) && next.t - key.t > SPLIT_HOLD) {
        runs.push(run);
        run = [];
      }
    }
    runs.push(run);
    const out: Compiled[] = [];
    const base = this.baseStyle();
    for (const r of runs) {
      const first = r[0];
      const last = r[r.length - 1];
      if (!first || !last || r.length < 2) continue;
      if (r.every((key) => same(key, first))) continue;
      // keys strictly increase in time (push), so every keyframe of a run has its own offset
      const span = last.t - first.t;
      const frames: Keyframe[] = r.map((key) => ({
        offset: Math.min(1, Math.max(0, (key.t - first.t) / span)),
        easing: key.e,
        ...formatStyles(this.used, key.v),
      }));
      const timing: KeyframeAnimationOptions = { delay: first.t * 1000, duration: span * 1000, fill: 'forwards', easing: 'linear' };
      for (const el of this.els) out.push({ el, name: this.name, frames, timing, end: last.t * 1000, base });
    }
    return out;
  }

  private apply(v: ChannelInput): void {
    const e = expand(v);
    this.mark(e);
    Object.assign(this.cur, e);
  }

  /** New channels: remember them and back-fill earlier keys with the identity value. */
  private mark(v: Channels): void {
    for (const c of ORDER) {
      if (v[c] === undefined || this.used.has(c)) continue;
      this.used.add(c);
      if (this.cur && this.cur[c] === undefined) this.cur[c] = IDENTITY[c];
      for (const key of this.keys) if (key.v[c] === undefined) key.v[c] = IDENTITY[c];
    }
  }
}

// ---------- LoopTrack (idle breathing / blinking after the show) ----------

export class LoopTrack implements Sampled {
  readonly els: readonly Element[];
  private readonly used = new Set<Ch>();
  private readonly keys: Key[];

  /**
   * @param start   seconds on the stage timeline
   * @param period  seconds per cycle
   * @param points  [offset 0..1, value, easing of the segment starting there]
   */
  constructor(
    el: Element,
    readonly name: string,
    readonly start: number,
    readonly period: number,
    points: ReadonlyArray<readonly [number, ChannelInput, string?]>,
    readonly iterations = Infinity,
  ) {
    this.els = [el];
    this.keys = points.map(([o, v, e]) => {
      const c = expand(v);
      for (const k of ORDER) if (c[k] !== undefined) this.used.add(k);
      return { t: o, v: c, e: e ?? 'linear' };
    });
  }

  styleAt(t: number): StyleOut | null {
    const local = t - this.start;
    if (local < 0 || local >= this.period * this.iterations) return null;
    const p = (local % this.period) / this.period;
    const k = this.keys;
    let i = 0;
    for (let j = 0; j < k.length; j++) if ((k[j]?.t ?? 2) <= p) i = j;
    const a = k[i];
    const b = k[i + 1];
    if (!a) return null;
    if (!b) return formatStyles(this.used, a.v);
    const span = b.t - a.t;
    return formatStyles(this.used, lerp(a.v, b.v, easing(a.e)(span > 0 ? (p - a.t) / span : 1), this.used));
  }

  baseStyle(): null {
    return null;
  }

  compile(): Compiled[] {
    const frames = this.keys.map((k) => ({ offset: k.t, easing: k.e, ...formatStyles(this.used, k.v) }));
    const timing: KeyframeAnimationOptions = { delay: this.start * 1000, duration: this.period * 1000, iterations: this.iterations, fill: 'none', easing: 'linear' };
    const end = Number.isFinite(this.iterations) ? (this.start + this.period * this.iterations) * 1000 : Infinity;
    return this.els.map((el) => ({ el, name: this.name, frames, timing, end, base: null }));
  }
}

// ---------- Playhead: the Web Animations of one stage ----------

interface Item {
  a: Animation | null;
  end: number;
  /** what the animation was made from (to settle it and to make it again) */
  c: Compiled | null;
  /** actor / owner, for settle(group) */
  group: string;
}

function startPaused(a: Animation): Animation {
  a.pause();
  a.currentTime = 0;
  return a;
}

/**
 * Owns every Animation of a stage. All of them live on the document timeline
 * and are always moved together (same currentTime), so they never drift.
 *
 * settle(): an animation whose work is done is replaced by its final value as
 * an inline style and cancelled, so the browser can drop it (and the layer it
 * kept alive). restore() makes them again before any seek back in time.
 */
export class Playhead {
  private items: Item[] = [];
  private settledCount = 0;
  /** the latest time (ms) up to which animations were settled */
  private settledUpTo = -Infinity;

  get animations(): Animation[] {
    return this.items.flatMap((i) => (i.a ? [i.a] : []));
  }

  get hasSettled(): boolean {
    return this.settledCount > 0;
  }

  /** Creates the animation paused at t = 0 (its `id` is the track name). Returns false when WAAPI is missing. */
  add(c: Compiled, group = ''): boolean {
    const a = this.make(c);
    if (!a) return false;
    this.items.push({ a, end: c.end, c, group });
    return true;
  }

  /** Creates the animation in step with the others: at `ms`, running when `play` (an actor joining mid-show). */
  addAt(c: Compiled, group: string, ms: number, play: boolean): void {
    const a = this.make(c);
    if (!a) return;
    this.items.push({ a, end: c.end, c, group });
    a.currentTime = ms;
    if (play && ms < c.end) a.play();
  }

  private make(c: Compiled): Animation | null {
    const el = c.el as Element & { animate?: Element['animate'] };
    if (typeof el.animate !== 'function') return null;
    const a = el.animate(c.frames, c.timing);
    a.id = c.name;
    // Browsers drop a finished, filling animation once a later one on the same property covers it
    // ("replacing animations"). Our runs are replayed (loop, seek back), so keep them; settle() /
    // cancel() clean them up.
    (a as Animation & { persist?: () => void }).persist?.();
    return startPaused(a);
  }

  /** Takes over an animation created elsewhere (e.g. an empty-keyframe clock), paused at t = 0. Never settled. */
  adopt(a: Animation, end: number): Animation {
    this.items.push({ a: startPaused(a), end, c: null, group: '' });
    return a;
  }

  /** Freeze every animation at `ms` (settled ones that are still over at `ms` keep their inline end value). */
  seek(ms: number): void {
    this.restore(ms);
    for (const { a } of this.items) {
      if (!a) continue;
      a.pause();
      a.currentTime = ms;
    }
  }

  /** Run from `ms`. Animations already over stay paused at their end (play() would rewind them). */
  playFrom(ms: number): void {
    this.restore(ms);
    for (const { a, end } of this.items) {
      if (!a) continue;
      a.currentTime = ms;
      if (ms < end) a.play();
      else a.pause();
    }
  }

  pause(): void {
    for (const { a } of this.items) a?.pause();
  }

  /** The animation of `group` that ends last (to know when that actor is done). */
  lastOf(group: string): { a: Animation; end: number } | null {
    let best: { a: Animation; end: number } | null = null;
    for (const i of this.items) {
      if (i.group !== group || !i.a || !Number.isFinite(i.end)) continue;
      if (!best || i.end > best.end) best = { a: i.a, end: i.end };
    }
    return best;
  }

  /** Commit + cancel every finite animation (of `group`, or all) that is over by `ms` (in creation = time order). */
  settle(ms: number, group?: string): void {
    for (const i of this.items) {
      if (!i.a || !i.c || !Number.isFinite(i.end) || i.end > ms) continue;
      if (group !== undefined && i.group !== group) continue;
      const last = i.c.frames[i.c.frames.length - 1];
      const st = (i.c.el as HTMLElement).style;
      if (typeof last?.transform === 'string') st.transform = last.transform;
      if (last?.opacity !== undefined && last.opacity !== null) st.opacity = String(last.opacity);
      i.a.cancel();
      i.a = null;
      this.settledCount += 1;
      this.settledUpTo = Math.max(this.settledUpTo, ms);
    }
  }

  /**
   * Going back before what was settled: make every settled animation again (paused at 0)
   * and put the start values back inline — the state right after the stage was built.
   * Going forward needs nothing: settled parts already show their final values.
   */
  restore(ms = -Infinity): void {
    if (!this.settledCount || ms >= this.settledUpTo) return;
    for (const i of this.items) {
      if (i.a || !i.c) continue;
      const st = (i.c.el as HTMLElement).style;
      if (i.c.base?.transform !== undefined) st.transform = i.c.base.transform;
      if (i.c.base?.opacity !== undefined) st.opacity = i.c.base.opacity;
      i.a = this.make(i.c);
    }
    this.settledCount = 0;
    this.settledUpTo = -Infinity;
  }

  cancel(): void {
    for (const { a } of this.items) a?.cancel();
    this.items = [];
    this.settledCount = 0;
    this.settledUpTo = -Infinity;
  }
}
