/**
 * «Помпон в открытом списке» (approved 31.10) — the player of one moment. Moved here from the gallery prototype
 * (demo/listplay/player.ts re-exports it).
 *
 * The same mechanics as src/drive.ts Driver (one Playhead over authored Tracks, an empty animation as the end clock,
 * play / pause / seek / destroy, seek(t) = the same frame every time, nothing ticks after the end), plus MARKS: a
 * callback at a second of the timeline (a haptic, "hold here while the finger still strokes"). A mark is its own empty
 * Web Animation on the same Playhead, so it pauses and resumes with the moment (hidden tab, off screen) — never a
 * setTimeout. A mark fires once per pass, only while playing (a seek over it does not fire it).
 */

import { Playhead, type Sampled } from '../timeline';
import { applyStyle } from '../drive';

export interface Mark {
  t: number;
  fn: () => void;
}

type Mode = 'idle' | 'playing' | 'paused';

export class Player {
  readonly duration: number;
  private readonly playhead = new Playhead();
  private readonly clock: Animation | null;
  private readonly marks: Array<{ m: Mark; a: Animation }> = [];
  private mode: Mode = 'idle';
  private held = 0;
  private gen = 0;
  private destroyed = false;

  constructor(
    clockEl: HTMLElement,
    tracks: readonly Sampled[],
    duration: number,
    marks: readonly Mark[] = [],
    private readonly onEnd?: () => void,
  ) {
    this.duration = duration;
    // the start pose inline first (what shows before a part's first run)
    for (const s of tracks) {
      const v = s.baseStyle();
      for (const target of s.els) applyStyle(target, v);
    }
    for (const s of tracks) for (const c of s.compile()) this.playhead.add(c, s.name);
    const host = clockEl as HTMLElement & { animate?: HTMLElement['animate'] };
    const can = typeof host.animate === 'function';
    this.clock = can ? this.playhead.adopt(host.animate([], { duration: duration * 1000 }), duration * 1000) : null;
    if (can) {
      for (const m of marks) {
        const ms = Math.max(1, Math.min(duration, m.t) * 1000);
        this.marks.push({ m, a: this.playhead.adopt(host.animate([], { duration: ms }), ms) });
      }
    }
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

  get animations(): readonly Animation[] {
    return this.playhead.animations;
  }

  play(): void {
    if (this.destroyed || this.mode === 'playing') return;
    let from = this.mode === 'idle' ? 0 : this.held;
    if (from >= this.duration) from = 0;
    this.mode = 'playing';
    this.held = from;
    const gen = ++this.gen;
    this.playhead.playFrom(from * 1000);
    for (const { m, a } of this.marks) {
      // a mark already behind us stays paused at its end (Playhead.playFrom): its promise never settles this pass
      if (m.t * 1000 <= from * 1000) continue;
      a.finished.then(
        () => {
          if (gen === this.gen && this.mode === 'playing') m.fn();
        },
        () => undefined,
      );
    }
    this.clock?.finished.then(
      () => {
        if (gen !== this.gen || this.mode !== 'playing') return;
        this.mode = 'paused';
        this.held = this.duration;
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
    this.playhead.seek(t * 1000);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gen += 1;
    this.playhead.cancel();
  }
}
