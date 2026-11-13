/**
 * «Твёрдая почва» — the gallery's tools (the moment itself is the buddy's own since 27.10: `footing: true`,
 * src/buddy/buddy.ts + src/buddy/footing.ts). Nothing here changes how he behaves; this file only adds what a
 * gallery page needs on top of a buddy built with `footing: true`:
 *   freeze(id, x, t)  — one still frame of the moment (he stands at x on floor id in the pose of time t): the scrubber,
 *                       `&t=` and the frame strip;
 *   dropAt(id, x)     — a reproducible "set him down here": a real hold through the engine (synthetic pointer events
 *                       on his body), carried to above x, calmed and let go — the engine's own soft landing happens there;
 *   force             — the gallery buttons skip the 20 s pause.
 * It reaches into the buddy's (TypeScript-)private members — gallery-only, never in the app.
 */

import type { ListsBuddy } from '../../src/buddy/index';
import * as P from '../../src/buddy/physics';
import type { Floor, Pendulum, World } from '../../src/buddy/physics';
import type { Geometry, Point } from '../../src/buddy/rig';
import * as M from '../../src/buddy/footing';

export type { FootingEvent as FirmEvent } from '../../src/buddy/index';

/** The buddy's private members the gallery tools read or wrap (runtime-public). */
interface Internals {
  cancel(): void;
  resetPose(): void;
  startLife(): void;
  setAction(name: string): void;
  render(): void;
  footingShape(f: Floor): M.FloorShape | null;
  footingParts(p: M.Plan): unknown;
  footingApply(run: unknown, pose: M.Pose): void;
  footingRun: { frozen: boolean } | null;
  lastFooting: number;
  mode: string;
  feet: Point;
  floor: Floor;
  world: World;
  pend: Pendulum;
  pivot: Point;
  rig: { puppet: { root: ShadowRoot; stopIdle(): void; startIdle(): void }; eyes(mode: string): void };
  g: Geometry;
  stage: HTMLElement;
  hit: HTMLElement;
}

const raf: (cb: FrameRequestCallback) => number =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const nextFrame = () => new Promise<void>((r) => raf(() => r()));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class FirmGround {
  private readonly inner: Internals;
  private readonly unwrap: (() => void)[] = [];
  private destroyed = false;
  private idleStopped = false;
  /** the frozen frame shown now (freeze()), kept across the engine's resets */
  private frozenAt: { id: string; x: number; t: number } | null = null;
  private freezing = false;
  private dropping = false;

  constructor(readonly buddy: ListsBuddy) {
    const inner = buddy as unknown as Internals;
    this.inner = inner;
    const cancel = inner.cancel;
    inner.cancel = () => {
      // a frozen frame stays frozen when the engine resets him (off screen, back on screen, a tap) — not when he is
      // picked up: then it is over
      const keep = this.frozenAt && !this.freezing ? this.frozenAt : null;
      cancel.call(buddy);
      if (keep) {
        queueMicrotask(() => {
          if (this.destroyed || this.frozenAt !== keep) return;
          if (inner.mode === 'stand') this.freeze(keep.id, keep.x, keep.t);
          else this.unfreeze(false);
        });
      }
    };
    this.unwrap.push(() => Reflect.deleteProperty(inner, 'cancel'));
  }

  /** When the moment last played (Date.now()); the 20 s pause counts from here. */
  get lastAt(): number {
    return this.inner.lastFooting;
  }

  /** Unhooks (the buddy behaves as before). */
  detach(): void {
    if (this.destroyed) return;
    this.unfreeze(false);
    this.destroyed = true;
    this.unwrap.forEach((u) => u());
  }

  /** The width of his puppet box (px). */
  get width(): number {
    return this.inner.g.w;
  }

  /** Where his feet are (content px). */
  get feet(): Point {
    return { ...this.inner.feet };
  }

  /** A floor of his world by id (stage px). */
  floor(id: string): Floor | undefined {
    return this.inner.world.floors.find((f) => f.id === id);
  }

  /** The floor as the eye sees it (its card's rounded top corners); null for the ground / the screen's edge. */
  shape(f: Floor): M.FloorShape | null {
    return this.inner.footingShape(f);
  }

  /**
   * One frozen frame of the moment: he stands at `feetX` on floor `id` as if he had just landed there, in the pose
   * of time `t` (s). Life and the puppet's idle stop (screenshots, the contact sheet, the scrubber).
   */
  freeze(id: string, feetX: number, t: number): M.Plan | null {
    const inner = this.inner;
    const f = this.floor(id);
    if (!f) return null;
    this.freezing = true;
    try {
      inner.cancel();
    } finally {
      this.freezing = false;
    }
    this.frozenAt = { id, x: feetX, t };
    inner.resetPose();
    inner.rig.puppet.stopIdle();
    this.idleStopped = true;
    inner.floor = f;
    inner.mode = 'stand';
    inner.feet = { x: feetX, y: f.y };
    inner.setAction('frozen');
    inner.render();
    const shape = this.shape(f);
    const edge = shape && M.nearEdge(shape, feetX, this.width);
    if (!shape || !edge) return null;
    const p = M.plan(shape, feetX, this.width, edge);
    if (this.buddy.reduced) {
      inner.feet = { x: M.safeX(p), y: f.y };
      inner.render();
      inner.rig.eyes('happy');
      return p;
    }
    const pose = M.poseAt(p, Math.min(t, M.DURATION + M.HOLD));
    const run = { plan: p, parts: inner.footingParts(p), pose: { ...pose, eyes: 'normal', startle: false }, raf: 0, frozen: true, resolve: () => undefined };
    inner.footingRun = run;
    inner.footingApply(run, pose);
    return p;
  }

  /** Back to life after freeze(); `life` = his own life starts again too (not while a hand holds him). */
  unfreeze(life = true): void {
    const was = this.frozenAt !== null || this.idleStopped;
    this.frozenAt = null;
    if (this.inner.footingRun?.frozen) this.inner.cancel();
    if (this.idleStopped) this.inner.rig.puppet.startIdle();
    this.idleStopped = false;
    if (was && life && !this.destroyed && this.inner.mode === 'stand') this.inner.startLife();
  }

  /**
   * The gallery's "set him down here": a real hold through the engine (synthetic pointer events on his body), carried
   * to above `feetX` on floor `id`, calmed, let go a little above the card — so the engine's own soft landing
   * happens exactly at `feetX`. `force` (default true) skips the 20 s pause. `onFinger` shows where the "finger" is.
   */
  async dropAt(id: string, feetX: number, options: { force?: boolean; onFinger?: (p: Point | null) => void } = {}): Promise<boolean> {
    // one hand at a time (a second click while he is being carried is ignored)
    if (this.dropping) return false;
    this.dropping = true;
    try {
      return await this.carry(id, feetX, options);
    } finally {
      this.dropping = false;
    }
  }

  private async carry(id: string, feetX: number, options: { force?: boolean; onFinger?: (p: Point | null) => void }): Promise<boolean> {
    const inner = this.inner;
    const f = this.floor(id);
    if (!f || this.destroyed) return false;
    this.unfreeze(false);
    const ready = () => inner.mode === 'stand' || inner.mode === 'walk';
    for (let i = 0; i < 40 && !ready(); i++) await wait(100);
    if (!ready()) return false;
    if (options.force ?? true) inner.lastFooting = -Infinity;
    const g = inner.g;
    const len = Math.hypot(g.center.x - g.scruff.x, g.center.y - g.scruff.y);
    const start = { x: inner.feet.x + g.scruff.x - g.foot.x, y: inner.feet.y + g.scruff.y - g.foot.y };
    // let go with his body's bottom this far above the card: a gentle set-down, never a throw
    const end = { x: feetX, y: f.y - 0.32 * g.w - g.radius - len };
    const id0 = 41;
    const fire = (type: 'pointerdown' | 'pointermove' | 'pointerup', p: Point) => {
      const r = inner.stage.getBoundingClientRect();
      const ev = new PointerEvent(type, {
        pointerId: id0, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        clientX: r.left + p.x, clientY: r.top + p.y, bubbles: true, cancelable: true, composed: true,
      });
      (type === 'pointerdown' ? inner.hit : window).dispatchEvent(ev);
      options.onFinger?.(type === 'pointerup' ? null : p);
    };
    fire('pointerdown', start);
    // The hand holds him gently: he hangs from it and only trails a little behind its sideways speed, like the
    // engine's swing at a calm pace. (The engine's pendulum alone winds up to its 75° stop when a finger moves down
    // faster than ~150 px/s — its pivot jumps once per frame and the Verlet step turns that into swing; a careful hand
    // setting him down never shows that.)
    let last = 0;
    let lastX = 0;
    let tilt = 0;
    const steady = (rate: number) => {
      const now = performance.now();
      if (!last) {
        // the first frame he hangs from the finger
        last = now - 16;
        lastX = inner.pivot.x;
        tilt = P.pendulumAngle(inner.pend, inner.pivot);
      }
      const dt = Math.max(0.001, Math.min(0.05, (now - last) / 1000));
      last = now;
      const want = Math.max(-0.3, Math.min(0.3, (-(inner.pivot.x - lastX) / dt) * 0.0011));
      lastX = inner.pivot.x;
      tilt += (want - tilt) * (1 - Math.exp(-rate * dt));
      const pd = inner.pend;
      const x = inner.pivot.x + Math.sin(tilt) * pd.len;
      const y = inner.pivot.y + Math.cos(tilt) * pd.len;
      inner.pend = { ...pd, x, y, px: x, py: y };
      return Math.abs(tilt);
    };
    // carry him over on a soft arc (smootherstep: the finger starts and stops without a jerk)
    const smoother = (k: number) => k * k * k * (k * (6 * k - 15) + 10);
    const mid = { x: (start.x + end.x) / 2, y: Math.min(start.y, end.y) - 24 };
    const ms = Math.min(1700, Math.max(900, 500 + Math.hypot(end.x - start.x, end.y - start.y) * 2.2));
    const t0 = performance.now();
    for (;;) {
      await nextFrame();
      if (inner.mode === 'held') steady(9);
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = smoother(k);
      fire('pointermove', {
        x: (1 - e) * (1 - e) * start.x + 2 * (1 - e) * e * mid.x + e * e * end.x,
        y: (1 - e) * (1 - e) * start.y + 2 * (1 - e) * e * mid.y + e * e * end.y,
      });
      if (k >= 1) break;
    }
    // he hangs still under the finger before it lets go (a gentle set-down)
    const t1 = performance.now();
    let calm = 0;
    while (inner.mode === 'held' && calm < 6 && performance.now() - t1 < 3000) {
      await nextFrame();
      calm = steady(14) < 0.01 && Math.abs(inner.pivot.x - end.x) < 0.05 ? calm + 1 : 0;
    }
    if (inner.mode !== 'held') {
      options.onFinger?.(null);
      return false;
    }
    // the last sub-pixel of swing out, so the landing is exactly where asked (reproducible)
    inner.pend = P.pendulumAt(inner.pivot, inner.pend.len);
    fire('pointerup', end);
    return true;
  }
}
