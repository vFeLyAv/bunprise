/**
 * One timeline of a comic ribbon (a panel's "comes alive" moment, the scroll-linked roll, the still poses) and the
 * built ribbon itself (`Strip`). Moved from the gallery prototype (demo/story/strip.ts) on 31.10; pause() / resume()
 * are new (the app's reader pauses a running moment while the page is hidden).
 */

import { Playhead, type Track } from '../timeline';
import type { Panel } from './kit';

/** A timeline over some of the strip's tracks: built into Web Animations on its own Playhead, or written as a still. */
export class Beat {
  readonly name: string;
  readonly tracks: readonly Track[];
  /** the part of the strip it belongs to (world y): a moment plays once when this comes into view */
  readonly region: { y0: number; y1: number };
  /** the moment it shows when nothing runs (a still, reduced motion) */
  readonly rest: number;
  played = false;
  private ph: Playhead | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** while playing: when (performance.now, ms) time 0 was; while paused: the paused time (ms) */
  private startedAt = 0;
  private pausedAt: number | null = null;
  private done: (() => void) | null = null;

  constructor(name: string, tracks: readonly Track[], region: { y0: number; y1: number }, rest?: number) {
    this.name = name;
    this.tracks = tracks;
    this.region = region;
    this.rest = rest ?? this.end;
  }

  /** The last key of any of its tracks (s). */
  get end(): number {
    return this.tracks.reduce((m, t) => Math.max(m, Number.isFinite(t.end) ? t.end : 0), 0);
  }

  /** Every value at `t` written inline, no animation at all. */
  still(t = this.rest): void {
    for (const tr of this.tracks) inline(tr.els, tr.styleAt(t));
  }

  build(): void {
    if (this.ph) return;
    const ph = new Playhead();
    this.ph = ph;
    for (const tr of this.tracks) {
      inline(tr.els, tr.baseStyle());
      for (const c of tr.compile()) ph.add(c, tr.name);
    }
  }

  seek(t: number): void {
    this.stopTimer();
    this.build();
    this.ph?.seek(Math.max(0, t) * 1000);
  }

  /** Runs once to its end (a moment). */
  play(): Promise<void> {
    this.stopTimer();
    this.build();
    this.played = true;
    this.ph?.playFrom(0);
    this.startedAt = now();
    return new Promise<void>((resolve) => {
      this.done = resolve;
      this.arm(this.end * 1000 + 40);
    });
  }

  /** True while a play() runs (not paused, not over). */
  get running(): boolean {
    return this.timer !== null;
  }

  /** Freezes a running moment where it is (the page went hidden); nothing happens when it does not run. */
  pause(): void {
    if (this.timer === null || !this.ph) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.pausedAt = Math.max(0, now() - this.startedAt);
    this.ph.seek(this.pausedAt);
  }

  /** Runs a paused moment on from where it stopped. */
  resume(): void {
    if (this.pausedAt === null || !this.ph) return;
    const at = this.pausedAt;
    this.pausedAt = null;
    this.ph.playFrom(at);
    this.startedAt = now() - at;
    this.arm(Math.max(0, this.end * 1000 - at) + 40);
  }

  get animations(): Animation[] {
    return this.ph?.animations ?? [];
  }

  destroy(): void {
    this.stopTimer();
    this.ph?.cancel();
    this.ph = null;
  }

  private arm(ms: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const done = this.done;
      this.done = null;
      done?.();
    }, ms);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pausedAt = null;
    // an interrupted play() still resolves (nobody waits forever)
    const done = this.done;
    this.done = null;
    done?.();
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function inline(els: readonly Element[], st: { transform?: string; opacity?: string } | null): void {
  if (!st) return;
  for (const el of els) {
    const s = (el as HTMLElement | SVGElement).style;
    if (st.transform !== undefined) s.transform = st.transform;
    if (st.opacity !== undefined) s.opacity = st.opacity;
  }
}

export interface Strip {
  world: Panel;
  /** the scroll-linked roll (null under reduced motion) */
  roll: Beat | null;
  /** moments that come alive once in view (empty under reduced motion) */
  moments: Beat[];
  /** every timeline of the strip (stills included) */
  beats: Beat[];
  /** how many Tapsis tell the roll (1 moving, or 3 stills) */
  rollers: number;
  /** reading line (world y) → the roll's time; default rollProgress (v2) */
  rollAt?: (readY: number) => number;
  destroy(): void;
}
