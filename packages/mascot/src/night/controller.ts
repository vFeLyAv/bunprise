/**
 * «Ночью маскоты спят» (approved 31.10) — one sleeping mascot: the rules as a small state machine. Moved here from
 * the gallery prototype (demo/night/controller.ts re-exports it); the options marked "(the app)" are new and optional
 * — without them it behaves exactly as the gallery prototype did.
 *
 *   awake ──(night starts, he is visible)──▶ falling (1.95 s) ──▶ asleep (the cheap loop: breath + "z")
 *   asleep ──(the person scrolls elsewhere)──▶ peek (0.85 s, at most every 20 s) ──▶ asleep
 *   asleep / peek / falling ──(tap)──▶ waking (2.0 s, from the frame on screen) ──▶ awake for AWAKE_MS ──▶ falling …
 *   asleep ──(07:00 / switch off)──▶ waking 'morning' (no startle) ──▶ awake
 *   a tap while waking: ignored (the wake-up plays on; never a restart or a jump). A tap while awake: a small hop
 *   (or the host's own answer, `onAwakeTap`) and the awake time starts again.
 *
 * Opened at night = already asleep (no falling-asleep moment: he slept before the screen opened). Not visible (tab
 * hidden, off screen, paused by the host) = every animation pauses where it is; a moment that would start unseen
 * jumps to its end pose. `still` (reduced motion, "Weniger", battery saver): not one animate() call — the sleeping
 * pose with a still "z"; awake = the puppet's own calm still pose (^ ^, the app's Weniger contract); a tap wakes him
 * at once.
 *
 * The app's rules on top (all optional): `gate` asks before a moment plays (one mascot animates at a time — a
 * refused falling-asleep / morning waits for the next update(), a refused peek is skipped, a refused wake-up wakes
 * him without the moment); `setPaused` = a sheet is open or another mascot holds the stage; `onTap` = the tap
 * feedback (haptics) — he never vibrates by himself.
 */

import { IdleScheduler } from '../core';
import { Driver } from '../drive';
import type { Channels, LoopTrack, StyleOut } from '../timeline';
import { AWAKE_MS, isNight, minuteOfDay, PEEK_GAP_MS, wantsSleep, type NightWindow } from './clock';
import { asleepPose, authorFall, authorPeek, authorWake, restPose, sleepLoops, type Shot } from './moves';
import { mountNightPuppet, NEUTRAL, STILL_Z, type NightRig, type PartName, type Pose, type RigOptions } from './rig';

export type NightState = 'awake' | 'falling' | 'asleep' | 'peek' | 'waking';
export type NightMoment = Shot['name'];

export interface NightOptions extends RigOptions {
  /** the clock (ms since epoch) — the gallery runs a simulated one */
  now: () => number;
  /** real time for the peek gap (default Date.now) */
  realNow?: () => number;
  /** Settings «Nachts schlafen» (default on) */
  enabled?: boolean;
  /** reduced motion / "Weniger" / battery saver: a still pose, never an animation */
  still?: boolean;
  /** the approved drip while asleep (it runs down; never a bubble) */
  drip?: boolean;
  awakeMs?: number;
  peekGapMs?: number;
  window?: NightWindow;
  onChange?: (state: NightState, m: NightMascot) => void;
  /**
   * (the app) Starts awake even at night: the night began while the screen was open — the host calls update() once
   * he is on screen, and he falls asleep in front of you. Default false: opened at night = already asleep.
   */
  startAwake?: boolean;
  /** (the app) Asked right before a moment plays; false = not now (see the header). */
  gate?: (moment: NightMoment) => boolean;
  /** (the app) A tap reached him (the host's tap feedback; never called by anything but a tap). */
  onTap?: () => void;
  /** (the app) A tap while he is awake: true = the host answered it (e.g. Tapsi's speck), no hop. */
  onAwakeTap?: () => boolean;
}

/** "translate(1px, 2px) rotate(3deg) scale(1, 1)" + opacity → channels (to continue from a loop's frame). */
export function channelsOf(s: StyleOut | null): Channels {
  const out: Channels = {};
  if (!s) return out;
  const t = s.transform ?? '';
  const tr = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(t);
  if (tr) {
    out.x = Number(tr[1]);
    out.y = Number(tr[2]);
  }
  const ro = /rotate\(([-\d.e]+)deg\)/.exec(t);
  if (ro) out.r = Number(ro[1]);
  const sc = /scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(t);
  if (sc) {
    out.sx = Number(sc[1]);
    out.sy = Number(sc[2]);
  }
  if (s.opacity !== undefined) out.o = Number(s.opacity);
  return out;
}

const partOf = (trackName: string): PartName => trackName.replace(/^night\./, '').replace(/Loop$/, '') as PartName;

export class NightMascot {
  readonly rig: NightRig;
  private st: NightState = 'awake';
  private shot: { s: Shot; d: Driver } | null = null;
  private loops: Array<{ track: LoopTrack; a: Animation }> = [];
  /** the pose last written inline (what shows when nothing animates) */
  private pose: Pose = {};
  private wakeUntil = -Infinity;
  private lastPeek = -Infinity;
  /** on screen and the tab visible (the IdleScheduler) */
  private seen = true;
  /** paused by the host (a sheet is open, another mascot holds the stage) */
  private hostPaused = false;
  private visible = true;
  private parked = false;
  private isStill: boolean;
  private enabled: boolean;
  private destroyed = false;
  private readonly watch: IdleScheduler;
  private readonly onClick = () => this.tap();

  constructor(
    parent: HTMLElement,
    private readonly o: NightOptions,
  ) {
    this.rig = mountNightPuppet(parent, o);
    this.isStill = !!o.still;
    this.enabled = o.enabled ?? true;
    this.applyStillToPuppet();
    this.watch = new IdleScheduler(
      () => true,
      (active) => {
        this.seen = active;
        this.sync();
      },
    );
    this.watch.observe(this.rig.box);
    this.watch.start();
    this.seen = this.watch.active;
    this.visible = this.seen;
    this.rig.box.addEventListener('click', this.onClick);
    // opened at night: he already sleeps (no falling-asleep moment — he fell asleep before the screen opened)
    if (this.wantsSleep() && !o.startAwake) this.enterAsleep();
    else this.st = 'awake';
  }

  // ---------- state ----------

  get state(): NightState {
    return this.st;
  }

  get still(): boolean {
    return this.isStill;
  }

  /** awake after a tap until this moment (clock ms) */
  get awakeUntil(): number {
    return this.wakeUntil;
  }

  /** the moment that is playing ('fall' | 'wake' | 'morning' | 'peek') */
  get moment(): Shot | null {
    return this.shot?.s ?? null;
  }

  /** a moment is playing (the app's stage: nobody else may start now) */
  get busy(): boolean {
    return this.shot !== null;
  }

  /** seconds into the moment */
  get time(): number {
    return this.shot?.d.time ?? 0;
  }

  get suspended(): boolean {
    return this.parked || (!this.visible && this.loops.length > 0);
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** every Web Animation this mascot owns right now (the moment + the sleeping loop) */
  get animations(): Animation[] {
    return [...(this.shot?.d.animations ?? []), ...this.loops.map((l) => l.a)];
  }

  get loopAnimations(): Animation[] {
    return this.loops.map((l) => l.a);
  }

  private get now(): number {
    return this.o.now();
  }

  private wantsSleep(): boolean {
    return wantsSleep({ now: this.now, enabled: this.enabled, awakeUntil: this.wakeUntil, ...(this.o.window ? { window: this.o.window } : {}) });
  }

  // ---------- inputs ----------

  /** Re-reads the clock: night started → falls asleep; morning (or the switch is off) → wakes up by himself. */
  update(): void {
    if (this.destroyed) return;
    const sleep = this.wantsSleep();
    if (this.st === 'awake' && sleep) this.fallAsleep();
    else if ((this.st === 'asleep' || this.st === 'peek') && !sleep) this.wake('morning');
  }

  /** A tap on him. */
  tap(): void {
    if (this.destroyed) return;
    switch (this.st) {
      case 'asleep':
      case 'peek':
      case 'falling':
        this.o.onTap?.();
        this.wake('tap');
        break;
      case 'waking':
        // ignored: the wake-up plays on (≤ 2 s) — never a restart, never a jump
        break;
      case 'awake':
        if (isNight(minuteOfDay(this.now), this.o.window)) this.wakeUntil = this.now + (this.o.awakeMs ?? AWAKE_MS);
        this.o.onTap?.();
        if (this.o.onAwakeTap?.()) break;
        if (!this.isStill) void this.rig.puppet.hop();
        break;
    }
  }

  /** The person does something elsewhere on the screen (scrolls, types): asleep → one sleepy peek, then sleeps on. */
  nudge(): void {
    if (this.destroyed || this.st !== 'asleep' || this.isStill || !this.seen) return;
    const real = (this.o.realNow ?? Date.now)();
    if (real - this.lastPeek < (this.o.peekGapMs ?? PEEK_GAP_MS)) return;
    // (the host's gate may lift its own pause when it hands him the stage)
    if ((this.o.gate && !this.o.gate('peek')) || !this.visible) return;
    this.lastPeek = real;
    const from = this.currentPose();
    delete from.breath;
    delete from.z;
    delete from.snot;
    this.st = 'peek';
    this.run(authorPeek(this.rig, from));
  }

  /** Settings «Nachts schlafen» (off → he wakes up like in the morning). */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.update();
  }

  /** Reduced motion / battery saver changed: switches at once to the still poses (or back to motion). */
  setStill(still: boolean): void {
    if (this.destroyed || still === this.isStill) return;
    this.isStill = still;
    this.applyStillToPuppet();
    const asleep = this.st !== 'awake' && this.st !== 'waking';
    this.stopShot();
    this.stopLoops();
    if (asleep) this.enterAsleep();
    else this.enterAwake();
  }

  /** (the app) Paused by the host — a sheet is open, another mascot holds the stage: like being off screen. */
  setPaused(paused: boolean): void {
    if (this.destroyed || paused === this.hostPaused) return;
    this.hostPaused = paused;
    this.sync();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.rig.box.removeEventListener('click', this.onClick);
    this.watch.destroy();
    this.stopShot();
    this.stopLoops();
    this.rig.destroy();
  }

  // ---------- transitions ----------

  private fallAsleep(): void {
    if (this.isStill || !this.seen) {
      this.enterAsleep();
      return;
    }
    // not now (another mascot animates): he stays awake, the next update() asks again
    if (this.o.gate && !this.o.gate('fall')) return;
    // paused by the host (a sheet covers him): nobody would see the moment
    if (!this.visible) {
      this.enterAsleep();
      return;
    }
    const from: Pose = { ...restPose(this.rig), ...this.rig.readAwake() };
    this.rig.takeOver();
    this.write(from);
    this.st = 'falling';
    this.run(authorFall(this.rig, from, !!this.o.drip));
  }

  private wake(variant: 'tap' | 'morning'): void {
    const animate = !this.isStill && this.seen;
    // (the host's gate may lift its own pause when it hands him the stage)
    const refused = animate && !!this.o.gate && !this.o.gate(variant === 'tap' ? 'wake' : 'morning');
    // the morning may wait (asleep until the stage is free); a tap is answered at once — without the moment if need be
    if (refused && variant === 'morning') return;
    if (variant === 'tap') this.wakeUntil = this.now + (this.o.awakeMs ?? AWAKE_MS);
    if (!animate || refused || !this.visible) {
      this.stopShot();
      this.stopLoops();
      this.enterAwake();
      return;
    }
    // from exactly the frame on screen (a falling-asleep or a peek cut short, the loop wherever it is)
    const from = this.currentPose();
    this.stopShot();
    this.stopLoops();
    this.write(from);
    this.st = 'waking';
    this.run(authorWake(this.rig, from, variant));
  }

  /** Asleep without a moment: the sleeping pose; the loop (or, still, the still "z"). */
  private enterAsleep(): void {
    this.rig.takeOver();
    this.write(asleepPose(this.rig, !!this.o.drip));
    this.st = 'asleep';
    if (this.isStill) this.write({ z: { ...STILL_Z } });
    else this.startLoops();
    this.emit();
  }

  /** Awake: the puppet is his own again (its idle life; still: its calm pose). */
  private enterAwake(): void {
    this.rig.release(this.idleWanted());
    this.pose = {};
    this.st = 'awake';
    this.emit();
  }

  private idleWanted(): boolean {
    return !this.isStill && (this.o.idle ?? true) && !this.hostPaused;
  }

  // ---------- moments ----------

  private run(shot: Shot): void {
    this.stopShot();
    const d = new Driver(this.rig.box, shot.tracks, shot.duration, () => this.ended(shot));
    this.shot = { s: shot, d };
    if (this.visible) d.play();
    else this.parked = true;
    this.emit();
  }

  private ended(shot: Shot): void {
    if (this.destroyed || this.shot?.s !== shot) return;
    const d = this.shot.d;
    this.shot = null;
    this.parked = false;
    const end: Pose = { ...shot.end };
    if (shot.name === 'peek') {
      delete end.breath;
      delete end.z;
      delete end.snot;
    }
    // the end pose inline first, then the animations go: the same frame, nothing keeps ticking
    this.write(end);
    d.destroy();
    if (shot.name === 'fall' || shot.name === 'peek') {
      this.st = 'asleep';
      this.startLoops();
      this.emit();
    } else {
      this.enterAwake();
      this.update();
    }
  }

  private stopShot(): void {
    if (!this.shot) return;
    this.shot.d.destroy();
    this.shot = null;
    this.parked = false;
  }

  /** The pose on screen right now: what is inline + the running moment's frame + the loop's frame. */
  private currentPose(): Pose {
    const out: Pose = { ...this.pose };
    if (this.shot) {
      const t = this.shot.d.time;
      for (const tr of this.shot.s.tracks) out[partOf(tr.name)] = { ...NEUTRAL[partOf(tr.name)], ...tr.sample(t) };
    }
    for (const { track, a } of this.loops) {
      const ms = typeof a.currentTime === 'number' ? a.currentTime : 0;
      const part = partOf(track.name);
      out[part] = { ...(out[part] ?? NEUTRAL[part]), ...channelsOf(track.styleAt(ms / 1000)) };
    }
    return out;
  }

  private write(p: Pose): void {
    this.rig.apply(p);
    this.pose = { ...this.pose, ...p };
  }

  // ---------- the sleeping loop ----------

  private startLoops(): void {
    if (this.isStill || this.loops.length || this.destroyed) return;
    for (const track of sleepLoops(this.rig, !!this.o.drip)) {
      for (const c of track.compile()) {
        const el = c.el as Element & { animate?: Element['animate'] };
        if (typeof el.animate !== 'function') continue;
        const a = el.animate(c.frames, c.timing);
        a.id = c.name;
        if (!this.visible) a.pause();
        this.loops.push({ track, a });
      }
    }
  }

  private stopLoops(): void {
    for (const { a } of this.loops) a.cancel();
    this.loops = [];
  }

  // ---------- visibility (tab hidden, off screen, paused by the host): everything pauses where it is ----------

  private sync(): void {
    if (this.destroyed) return;
    const active = this.seen && !this.hostPaused;
    const changed = active !== this.visible;
    this.visible = active;
    // awake, the puppet's own idle life follows the host's pause (off screen / hidden it pauses by itself)
    if (this.st === 'awake' && !this.rig.driven) {
      if (this.hostPaused) this.rig.puppet.stopIdle();
      else if (this.idleWanted() && !this.rig.puppet.idleRunning) this.rig.puppet.startIdle();
    }
    if (!changed) return;
    if (!active) {
      if (this.shot?.d.playing) {
        this.shot.d.pause();
        this.parked = true;
      }
      for (const { a } of this.loops) a.pause();
    } else {
      if (this.parked && this.shot) {
        this.parked = false;
        this.shot.d.play();
      }
      for (const { a } of this.loops) a.play();
    }
    this.emit();
  }

  private applyStillToPuppet(): void {
    this.rig.puppet.setReducedMotion(this.isStill ? 'force' : 'off');
    this.rig.puppet.setCalmEyes(this.isStill ? 'happy' : null);
  }

  private emit(): void {
    this.o.onChange?.(this.st, this);
  }
}
