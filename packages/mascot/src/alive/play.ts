/**
 * «Живые анимации» — playing one moment, and the clock the mix counts in.
 *
 *   playAlive(rig, shot)  the moment's tracks → one Driver (src/drive.ts: one Playhead, an empty animation as the end
 *                         clock, no rAF, no timers); Watch pauses it while the mascot is off screen or the tab is
 *                         hidden and resumes it on the same frame. At the end (or stop()) every animation is cancelled,
 *                         every inline style goes, the puppet's own idle life goes on — nothing keeps ticking.
 *   SeenClock             milliseconds the mascot could be seen (on screen, the tab visible): a gap of the mix waits
 *                         while nobody sees him.
 */

import { IdleScheduler } from '../core';
import { Driver, Watch } from '../drive';
import type { Shot } from './moves';
import type { AliveRig } from './rig';

export interface AliveRun<I extends string = string> {
  readonly id: I;
  readonly shot: Shot<I>;
  /** resolves when it is over (played to the end or stopped) */
  readonly done: Promise<void>;
  readonly over: boolean;
  /** seconds into the moment */
  readonly time: number;
  /** waiting unseen (off screen, the tab hidden) */
  readonly suspended: boolean;
  /** ends it at once: the rest pose, nothing left running */
  stop(): void;
}

export interface PlayOptions {
  /** the puppet's idle life after it (default: as before the moment) — the host of a lent puppet decides */
  idle?: boolean;
  /** called once when it is over (before `done` resolves) */
  onEnd?: (stopped: boolean) => void;
}

/** Plays a moment on the rig (reduced motion: the caller never asks). */
export function playAlive<I extends string>(rig: AliveRig, shot: Shot<I>, o: PlayOptions = {}): AliveRun<I> {
  rig.takeOver();
  rig.setExtras(shot.extras ?? []);
  let over = false;
  let resolve: () => void = () => undefined;
  const done = new Promise<void>((r) => {
    resolve = r;
  });
  // (the Driver's end calls end(false): declared before it can run — the clock resolves a task later at the earliest)
  const driver: Driver = new Driver(rig.box, shot.tracks, shot.duration, () => end(false));
  const watch = new Watch(rig.box, driver);
  function end(stopped: boolean): void {
    if (over) return;
    over = true;
    watch.destroy();
    driver.destroy();
    rig.release(o.idle);
    o.onEnd?.(stopped);
    resolve();
  }
  watch.start();
  return {
    id: shot.id,
    shot,
    done,
    get over() {
      return over;
    },
    get time() {
      return over ? shot.duration : driver.time;
    },
    get suspended() {
      return !over && watch.suspended;
    },
    stop: () => end(true),
  };
}

/** Milliseconds the element could be seen (on screen, its tab visible) since the clock started. */
export class SeenClock {
  private acc = 0;
  private since: number | null = null;
  private readonly watch: IdleScheduler;
  private gone = false;

  constructor(
    el: Element,
    private readonly realNow: () => number = () => performance.now(),
    onChange?: (seen: boolean) => void,
  ) {
    this.watch = new IdleScheduler(
      () => true,
      (active) => {
        this.set(active);
        onChange?.(active);
      },
    );
    this.watch.observe(el);
    this.watch.start();
    this.set(this.watch.active);
  }

  get seen(): boolean {
    return this.since !== null;
  }

  now(): number {
    return this.acc + (this.since !== null ? this.realNow() - this.since : 0);
  }

  destroy(): void {
    if (this.gone) return;
    this.gone = true;
    this.set(false);
    this.watch.destroy();
  }

  private set(seen: boolean): void {
    if (this.gone && seen) return;
    if (seen && this.since === null) this.since = this.realNow();
    else if (!seen && this.since !== null) {
      this.acc += this.realNow() - this.since;
      this.since = null;
    }
  }
}
