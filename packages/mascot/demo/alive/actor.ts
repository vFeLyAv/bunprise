/**
 * «Живые анимации» (31.10, GALLERY-ONLY prototype) — one living mascot: plays a moment on ONE seekable timeline.
 *
 *   play(id)    the moment's tracks → one Driver (src/drive.ts: one Playhead, an empty animation as the end clock, no
 *               rAF, no timers); Watch pauses it while the mascot is off screen or the tab is hidden and resumes it on
 *               the same frame. At the end every animation is cancelled, every inline style goes, the puppet's own
 *               idle life goes on — nothing keeps ticking.
 *   freeze(id, t)  the exact frame at t, written inline (Track.styleAt — the same keys; no animate() at all)
 *   stop()      ends a running / frozen moment at once (back to the rest pose)
 *
 * Reduced motion: no moment ever plays (in the app idle life is off then); the puppet shows its calm still pose.
 */

import { Driver, freezeAt, Watch } from '../../src/drive';
import { authorMove, type MoveId, type Shot } from './moves';
import { mountAlive, NEUTRAL, type AliveRig, type PartName, type Pose, type RigOptions } from './rig';

export class AliveActor {
  readonly rig: AliveRig;
  private run: { shot: Shot; driver: Driver; watch: Watch; done: () => void } | null = null;
  private frozen = false;
  private destroyed = false;

  constructor(parent: HTMLElement, o: RigOptions) {
    this.rig = mountAlive(parent, o);
  }

  get busy(): boolean {
    return this.run !== null;
  }

  get current(): MoveId | null {
    return this.run?.shot.id ?? null;
  }

  /** Plays the moment from its start; resolves when it is over (or stopped). Reduced motion: resolves at once. */
  play(id: MoveId): Promise<void> {
    if (this.destroyed || this.rig.reduced) return Promise.resolve();
    this.stop();
    const shot = authorMove(id, this.rig);
    this.rig.takeOver();
    this.rig.setExtras(shot.extras ?? []);
    return new Promise<void>((resolve) => {
      const driver = new Driver(this.rig.box, shot.tracks, shot.duration, () => this.finish());
      const watch = new Watch(this.rig.box, driver);
      this.run = { shot, driver, watch, done: resolve };
      watch.start();
    });
  }

  /** The frame at `t` seconds, still (no animation). */
  freeze(id: MoveId, t: number): Shot | null {
    if (this.destroyed) return null;
    this.stop();
    const shot = authorMove(id, this.rig);
    if (this.rig.reduced) return shot;
    this.rig.takeOver();
    this.rig.setExtras(shot.extras ?? []);
    const rest: Pose = {};
    for (const n of Object.keys(NEUTRAL) as PartName[]) if (this.rig.has(n)) rest[n] = NEUTRAL[n];
    this.rig.apply(rest);
    freezeAt(shot.tracks, Math.max(0, Math.min(shot.duration, t)));
    this.frozen = true;
    return shot;
  }

  stop(): void {
    if (this.run) {
      const r = this.run;
      this.run = null;
      r.watch.destroy();
      r.driver.destroy();
      this.rig.release();
      r.done();
    } else if (this.frozen) {
      this.rig.release();
    }
    this.frozen = false;
  }

  private finish(): void {
    if (!this.run) return;
    const r = this.run;
    this.run = null;
    r.watch.destroy();
    r.driver.destroy();
    this.rig.release();
    r.done();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.rig.destroy();
  }
}
