/**
 * The plumbing of the small authored scenes that are their own package entries (the tower `./tower`, the home
 * icon `./homeicon`; moved here from the gallery's demo/parade/kit.ts on 27.10.2026, unchanged in behaviour):
 *
 *   Driver      — one Playhead (timeline.ts) over authored tracks with play / pause / seek / stop and an end clock:
 *                 the same mechanics as WelcomeStage (no rAF, no timers while animating; seek(t) gives the same
 *                 frame every time; at the end every animation is finished, nothing ticks — finite, no loops).
 *   CssFade     — the reduced-motion fade: a CSS opacity animation (never an animate() call) with the same controls.
 *   Watch       — pauses a running scene while its host is off screen or the tab is hidden, and resumes it where it
 *                 stopped (IdleScheduler: the same observer every mascot uses).
 *   LAYER_CSS   — the actor layers of the welcome stage (frames placed by transform, composited lift / calm).
 */

import { IdleScheduler } from './core';
import { Playhead, type Sampled, type StyleOut } from './timeline';

/** The welcome stage's actor layers (welcome.ts STAGE_CSS): frames placed by transform, composited lift / calm. */
export const LAYER_CSS = `
:host { display: block; position: relative; overflow: hidden; contain: layout paint; pointer-events: none; user-select: none; -webkit-user-select: none; }
.stage { position: absolute; inset: 0; overflow: hidden; }
.clip { position: absolute; overflow: hidden; }
.layer { position: absolute; inset: 0; }
.frame { position: absolute; left: 0; top: 0; }
.lift, .calm, .actor { position: absolute; inset: 0; }
.grip-svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; overflow: visible; }
.grip { transform-box: view-box; transform-origin: 0 0; }
.clip .grip-sh { display: none; }
`;

export function applyStyle(target: Element, s: StyleOut | null): void {
  if (!s) return;
  const st = (target as HTMLElement).style;
  if (s.transform !== undefined) st.transform = s.transform;
  if (s.opacity !== undefined) st.opacity = s.opacity;
}

/** The static pose of authored tracks at `t` (reduced motion: no animate() at all, like WelcomeStage). */
export function freezeAt(tracks: readonly Sampled[], t: number): void {
  for (const s of tracks) {
    const v = s.styleAt(t);
    for (const target of s.els) applyStyle(target, v);
  }
}

/** Styles of every animated part at `seconds` (from the same keys as the animations; tests and frame tools). */
export function sampleTracks(tracks: readonly Sampled[], seconds: number): Record<string, StyleOut> {
  const out: Record<string, StyleOut> = {};
  for (const s of tracks) {
    const v = s.styleAt(seconds);
    if (v && (v.transform !== undefined || v.opacity !== undefined)) out[s.name] = { ...v };
  }
  return out;
}

/** What Watch drives: a Driver or a CssFade. */
export interface Playable {
  readonly playing: boolean;
  play(): void;
  pause(): void;
}

type Mode = 'idle' | 'playing' | 'paused';

/**
 * One timeline over authored tracks: every track compiles into Web Animations on ONE Playhead, an empty
 * animation is the end clock. play() from 0 (or from where pause() / seek() left it), seek(t) freezes the exact
 * frame; at the end every animation is finished (fill: forwards) — nothing ticks afterwards: finite, no loops.
 */
export class Driver implements Playable {
  readonly duration: number;
  private readonly playhead = new Playhead();
  private readonly clock: Animation | null;
  private mode: Mode = 'idle';
  private held = 0;
  private gen = 0;
  private ended = false;
  private destroyed = false;

  constructor(
    clockEl: HTMLElement,
    tracks: readonly Sampled[],
    duration: number,
    private readonly onEnd?: () => void,
  ) {
    this.duration = duration;
    for (const s of tracks) {
      const v = s.baseStyle();
      for (const target of s.els) applyStyle(target, v);
    }
    for (const s of tracks) for (const c of s.compile()) this.playhead.add(c, s.name);
    const host = clockEl as HTMLElement & { animate?: HTMLElement['animate'] };
    this.clock = typeof host.animate === 'function' ? this.playhead.adopt(host.animate([], { duration: duration * 1000 }), duration * 1000) : null;
  }

  get time(): number {
    if (this.mode === 'playing' && this.clock) {
      const ct = this.clock.currentTime;
      if (typeof ct === 'number') return Math.min(this.duration, ct / 1000);
    }
    return this.held;
  }

  get playing(): boolean {
    return this.mode === 'playing';
  }

  get hasEnded(): boolean {
    return this.ended;
  }

  get animations(): readonly Animation[] {
    return this.playhead.animations;
  }

  play(): void {
    if (this.destroyed || this.mode === 'playing') return;
    let from = this.mode === 'idle' ? 0 : this.held;
    if (from >= this.duration) from = 0;
    this.ended = false;
    this.mode = 'playing';
    this.held = from;
    const gen = ++this.gen;
    this.playhead.playFrom(from * 1000);
    this.clock?.finished.then(
      () => {
        if (gen !== this.gen || this.mode !== 'playing') return;
        // no settle() here: committing + cancelling every animation at once cost one 85 ms frame in Edge (measured
        // 26.10, the first run of the parade). Finished animations do not tick; destroy() cancels them.
        this.mode = 'paused';
        this.held = this.duration;
        this.ended = true;
        this.onEnd?.();
      },
      () => undefined,
    );
  }

  pause(): void {
    if (this.destroyed || this.mode !== 'playing') return;
    this.held = this.time;
    this.gen += 1;
    this.mode = 'paused';
    this.playhead.pause();
  }

  seek(seconds: number): void {
    if (this.destroyed) return;
    const t = Math.max(0, Math.min(this.duration, Number.isFinite(seconds) ? seconds : 0));
    this.gen += 1;
    this.mode = 'paused';
    this.held = t;
    this.ended = t >= this.duration;
    this.playhead.seek(t * 1000);
  }

  stop(): void {
    if (this.destroyed) return;
    this.gen += 1;
    this.mode = 'idle';
    this.held = 0;
    this.ended = false;
    this.playhead.seek(0);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gen += 1;
    this.playhead.cancel();
  }
}

/**
 * The reduced-motion fade: a CSS opacity animation (class `cls` on `target`) — never an animate() call — with the
 * same controls. Every change restarts the CSS animation (class off, reflow, class on) with a negative delay, so
 * the shown moment is always exactly `time`: seek / pause / play from there / stop.
 */
export class CssFade implements Playable {
  private from = 0;
  private started = 0;
  private running = false;

  constructor(
    private readonly target: HTMLElement,
    private readonly cls: string,
    readonly duration: number,
    private readonly onEnd?: () => void,
  ) {
    target.addEventListener('animationend', (e) => {
      if (e.target !== target || !this.running) return;
      this.running = false;
      this.from = this.duration;
      this.onEnd?.();
    });
  }

  get time(): number {
    return this.running ? Math.min(this.duration, this.from + (performance.now() - this.started) / 1000) : this.from;
  }

  get playing(): boolean {
    return this.running;
  }

  play(): void {
    if (this.running) return;
    const from = this.from >= this.duration ? 0 : this.from;
    this.from = from;
    this.started = performance.now();
    this.running = true;
    this.restart(from, true);
  }

  pause(): void {
    if (!this.running) return;
    const t = this.time;
    this.running = false;
    this.from = t;
    this.restart(t, false);
  }

  seek(seconds: number): void {
    this.running = false;
    this.from = Math.max(0, Math.min(this.duration, Number.isFinite(seconds) ? seconds : 0));
    this.restart(this.from, false);
  }

  /** Back to before the start: hidden, no animation. */
  stop(): void {
    this.running = false;
    this.from = 0;
    this.target.classList.remove(this.cls);
    this.target.style.animationDelay = '0s';
    this.target.style.animationPlayState = '';
  }

  private restart(at: number, run: boolean): void {
    const t = this.target;
    t.classList.remove(this.cls);
    void t.offsetWidth;
    t.style.animationDelay = `${-at}s`;
    t.style.animationPlayState = run ? 'running' : 'paused';
    t.classList.add(this.cls);
  }
}

/**
 * Pauses a running scene while its host is off screen or its tab is hidden, and resumes it exactly where it stopped
 * (the rule every mascot keeps). `start()` when the show starts (it waits, parked, until the host can be seen),
 * `stop()` when it is over, seeked or stopped.
 */
export class Watch {
  private readonly idle: IdleScheduler;
  private parked = false;
  private armed = false;

  constructor(
    host: Element,
    private readonly target: Playable,
  ) {
    this.idle = new IdleScheduler(
      () => true,
      (active) => this.onActive(active),
    );
    this.idle.observe(host);
  }

  /** The show waits (parked) while it cannot be seen. */
  get suspended(): boolean {
    return this.parked;
  }

  start(): void {
    this.armed = true;
    this.idle.start();
    if (this.idle.active) {
      this.parked = false;
      this.target.play();
    } else this.parked = true;
  }

  stop(): void {
    this.armed = false;
    this.parked = false;
    this.idle.stop();
  }

  destroy(): void {
    this.armed = false;
    this.idle.destroy();
  }

  private onActive(active: boolean): void {
    if (!this.armed) return;
    if (!active && this.target.playing) {
      this.parked = true;
      this.target.pause();
    } else if (active && this.parked) {
      this.parked = false;
      this.target.play();
    }
  }
}
