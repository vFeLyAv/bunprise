import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BEAT,
  CAST,
  FRIENDS,
  HALF_WIDTH,
  HOST_H,
  STACK,
  bake,
  breakpoints,
  hopTravel,
  minGap,
  onGround,
  onStage,
  poseAt,
  silhouette,
  towerLean,
  towerPlan,
  inTower,
  visible,
  type TowerPlan,
} from '../src/tower-plan';
import { EAR_MAX } from '../src/tower-actor';
import { ParadeStage, RM, TowerStage } from '../src/tower';
import { CssFade, Driver } from '../src/drive';
import { Track } from '../src/timeline';
import { paradeGallery, profilPhone } from '../demo/parade/gallery';

// «Парад» v2 — «Бременская башня» (26.10, gallery-only prototype, ideas doc §1.6): the friends stack up on each
// other's heads, Pompon leaps to the top, turns to you, does a binky, the tower tips and they bail out.
// Only transform / opacity, finite; reduced motion = four still heads (as v1).

const ALLOWED = ['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity'];

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.head.replaceChildren();
});

function stage(reduced = false): ParadeStage {
  const host = document.createElement('div');
  document.body.append(host);
  return new ParadeStage(host, { reduced });
}

/** translate / rotate / scale numbers of a track's transform string. */
function parts(tr: string | undefined): { x: number; y: number; r: number; sx: number; sy: number } {
  const t = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(tr ?? '');
  const r = /rotate\((-?[\d.]+)deg\)/.exec(tr ?? '');
  const s = /scale\((-?[\d.]+), (-?[\d.]+)\)/.exec(tr ?? '');
  return { x: Number(t?.[1] ?? 0), y: Number(t?.[2] ?? 0), r: Number(r?.[1] ?? 0), sx: Number(s?.[1] ?? 1), sy: Number(s?.[2] ?? 1) };
}

/** The crown of level k−1 at t (where level k's feet must be while it stands in the tower), off-centre by `off` px. */
function crown(p: TowerPlan, k: number, t: number, off = 0): { x: number; y: number } {
  const lo = poseAt(p, k - 1, t);
  const u = p.members[k - 1]?.u ?? 0;
  const a = (lo.r * Math.PI) / 180;
  const cx = off * lo.sx;
  const cy = -STACK * u * lo.sy;
  return { x: lo.x + cx * Math.cos(a) - cy * Math.sin(a), y: lo.y + cx * Math.sin(a) + cy * Math.cos(a) };
}

const times = (p: TowerPlan, step = 0.01) => Array.from({ length: Math.floor(p.duration / step) + 1 }, (_, i) => i * step);

describe('the tower plan (390 px phone)', () => {
  const p = towerPlan(390, HOST_H);

  it('broken at the bottom, chocolate, himalayan — Pompon last, on top, the biggest; ≈ 5 s', () => {
    expect(p.members.map((m) => m.coat)).toEqual(['broken', 'choc', 'himalayan', 'fawn']);
    expect(FRIENDS).toEqual(['broken', 'choc', 'himalayan']);
    const [b, c, h, pp] = p.members;
    if (!b || !c || !h || !pp) throw new Error('cast');
    expect(pp.u).toBeGreaterThan(Math.max(b.u, c.u, h.u));
    // each one jumps onto the one below after that one has arrived / landed
    const arrived = (m: typeof b) => (m.enter[m.enter.length - 1]?.t ?? 0) + (m.enter[m.enter.length - 1]?.d ?? 0);
    expect(c.jump?.up).toBeGreaterThan(arrived(b));
    expect(h.jump?.up).toBeGreaterThan(c.jump?.land ?? Infinity);
    expect(pp.jump?.up).toBeGreaterThan(h.jump?.land ?? Infinity);
    // alternating sides: in from left, right, left, right
    expect(CAST.map((x) => x.inDir)).toEqual([1, -1, 1, -1]);
    expect(p.duration).toBeGreaterThan(4.5);
    expect(p.duration).toBeLessThanOrEqual(5);
  });

  it('never out of thin air: everybody comes in from beyond a side and leaves beyond one', () => {
    p.members.forEach((m, k) => {
      const a = poseAt(p, k, 0).x;
      const z = poseAt(p, k, p.duration).x;
      expect(a + HALF_WIDTH * m.u <= 0 || a - HALF_WIDTH * m.u >= p.W).toBe(true);
      expect(z + HALF_WIDTH * m.u <= 0 || z - HALF_WIDTH * m.u >= p.W).toBe(true);
    });
  });

  it('nothing jumps: every bunny moves continuously (no step bigger than a fast fall / the binky twist in 10 ms)', () => {
    p.members.forEach((_, k) => {
      let prev = poseAt(p, k, 0);
      for (const t of times(p).slice(1)) {
        const cur = poseAt(p, k, t);
        expect(Math.hypot(cur.x - prev.x, cur.y - prev.y)).toBeLessThan(16);
        // the binky's twist is the quickest turn: ≈ 380°/s
        expect(Math.abs(cur.r - prev.r)).toBeLessThan(4.5);
        prev = cur;
      }
    });
  });

  it('in the tower the feet stand on the crown below — through every squash and sway of the ones below', () => {
    for (let k = 1; k < 4; k++) {
      let checked = 0;
      for (const t of times(p, 0.005)) {
        if (!inTower(p, k, t)) continue;
        // Pompon's binky lifts him off the crown and lands him a little off-centre — checked separately
        if (k === 3 && t > p.binky.up) continue;
        const me = poseAt(p, k, t);
        const c = crown(p, k, t);
        expect(Math.hypot(me.x - c.x, me.y - c.y)).toBeLessThan(0.01);
        checked += 1;
      }
      expect(checked).toBeGreaterThan(50);
    }
    // after the binky: on the crown again, off-centre by the planned amount
    const t = p.binky.land + 0.1;
    const me = poseAt(p, 3, t);
    const c = crown(p, 3, t, p.binky.off);
    expect(Math.hypot(me.x - c.x, me.y - c.y)).toBeLessThan(0.01);
  });

  it('a jump lands exactly on the crown (no snap at the landing)', () => {
    for (let k = 1; k < 4; k++) {
      const j = p.members[k]?.jump;
      if (!j) throw new Error('no jump');
      const before = poseAt(p, k, j.land - 1e-4);
      const at = crown(p, k, j.land);
      expect(Math.hypot(before.x - at.x, before.y - at.y)).toBeLessThan(0.5);
    }
  });

  it('every landing squashes everybody below it, the lower ones a little later (the push travels down)', () => {
    const pp = p.members[3];
    const land = pp?.jump?.land ?? 0;
    const peakAt = (k: number) => {
      let best = { sy: 1, t: 0 };
      for (let t = land; t < land + 0.25; t += 0.002) {
        const sy = poseAt(p, k, t).sy;
        if (sy < best.sy) best = { sy, t };
      }
      return best;
    };
    const peaks = [3, 2, 1, 0].map(peakAt);
    for (const q of peaks) expect(q.sy).toBeLessThan(0.95);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]?.t ?? 0).toBeGreaterThan(peaks[i - 1]?.t ?? 0);
    // and it springs back: (almost) no squash left a third of a second later, before Pompon crouches for the binky
    expect(land + 0.34).toBeLessThan(p.binky.crouch);
    for (let k = 0; k < 4; k++) expect(Math.abs(poseAt(p, k, land + 0.34).sy - 1)).toBeLessThan(0.03);
  });

  it('the binky: up off the crown with a twist, lands off-centre — and the tower tips to that side', () => {
    const b = p.binky;
    const mid = (b.up + b.land) / 2;
    expect(poseAt(p, 3, mid).y).toBeLessThan(crown(p, 3, mid).y - 10);
    const twist = Math.max(...Array.from({ length: 40 }, (_, i) => Math.abs(poseAt(p, 3, b.up + ((b.land - b.up) * i) / 40).r)));
    expect(twist).toBeGreaterThan(10);
    expect(b.off).toBeGreaterThan(0);
    expect(towerLean(p, BEAT.uhOh)).toBeGreaterThan(0.5);
    expect(towerLean(p, BEAT.sep[3])).toBeGreaterThan(towerLean(p, BEAT.uhOh));
    // the bottom bunny tips over the edge of its right foot: its left side lifts, nothing sinks into the card
    expect(poseAt(p, 0, BEAT.sep[1] - 0.01).y).toBeLessThan(p.G);
  });

  it('they bail out top-down in alternating directions and land on the edge before hopping off', () => {
    const [b, c, h, pp] = p.members;
    if (!b || !c || !h || !pp) throw new Error('cast');
    expect(pp.sep).toBeLessThan(h.sep);
    expect(h.sep).toBeLessThan(c.sep);
    expect(b.sep).toBe(c.sep);
    expect([pp.outDir, h.outDir, c.outDir, b.outDir]).toEqual([1, -1, 1, -1]);
    for (const m of [c, h, pp]) {
      expect(Math.sign((m.fall?.x1 ?? p.xc) - p.xc)).toBe(m.outDir);
      expect(poseAt(p, m.level, m.ground + 0.01).y).toBeCloseTo(p.G, 2);
    }
  });

  it('peaks at 4 bunnies on the screen; on the edge nobody walks through anybody (390 and 320 px)', () => {
    for (const W of [390, 320]) {
      const q = towerPlan(W, HOST_H);
      expect(Math.max(...times(q).map((t) => onStage(q, t)))).toBe(4);
      for (const t of times(q)) {
        for (let a = 0; a < 4; a++) {
          for (let c = a + 1; c < 4; c++) {
            if (!onGround(q, a, t) || !onGround(q, c, t) || !visible(q, a, t) || !visible(q, c, t)) continue;
            const sa = silhouette(q, a, t);
            const sc = silhouette(q, c, t);
            let gap = Infinity;
            for (const x of sa) for (const y of sc) gap = Math.min(gap, Math.hypot(x.x - y.x, x.y - y.y) - x.r - y.r);
            expect(gap, `W ${W}, t ${t.toFixed(2)}: ${a} / ${c}`).toBeGreaterThanOrEqual(0);
          }
        }
      }
      // the helper the gallery shows reports a number
      expect(Number.isFinite(minGap(q).gap)).toBe(true);
    }
  });

  it('the tower and the binky fit the stage (nothing cut off at the top) on 320 / 390 / 430 px phones', () => {
    for (const W of [320, 390, 430]) {
      const q = towerPlan(W, HOST_H);
      let top = Infinity;
      for (const t of times(q, 0.02)) for (let k = 0; k < 4; k++) for (const c of silhouette(q, k, t)) top = Math.min(top, c.y - c.r);
      expect(top, `W ${W}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('the hop model is the authored hop (push off, even flight to 98 % at 70 %, the landing sticks)', () => {
    expect(hopTravel(0)).toBe(0);
    expect(hopTravel(0.1)).toBeCloseTo(0.06, 5);
    expect(hopTravel(0.7)).toBeCloseTo(0.98, 5);
    expect(hopTravel(1)).toBe(1);
  });

  it('baking keeps the motion: the keys reproduce the rig within a px (sampled at every corner too)', () => {
    for (let k = 0; k < 4; k++) {
      const fn = (t: number) => poseAt(p, k, t);
      const keys = bake(fn, 0, p.duration, 1 / 60, breakpoints(p));
      expect(keys.length).toBeLessThan(p.duration * 60);
      for (const t of times(p, 0.0037)) {
        const i = keys.findIndex((q) => q.t >= t);
        if (i <= 0) continue;
        const b = keys[i];
        const a = keys[i - 1];
        if (!a || !b) continue;
        const q = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        const x = a.pose.x + (b.pose.x - a.pose.x) * q;
        const y = a.pose.y + (b.pose.y - a.pose.y) * q;
        const ref = fn(t);
        expect(Math.hypot(x - ref.x, y - ref.y)).toBeLessThan(1);
      }
    }
  });
});

describe('ParadeStage (motion)', () => {
  it('builds 4 bunnies; only transform / opacity, every animation finite, nothing loops', () => {
    const s = stage();
    expect(s.actorCount).toBe(4);
    expect(s.duration).toBeLessThanOrEqual(5);
    expect(s.animations.length).toBeGreaterThan(0);
    for (const a of s.animations) {
      const timing = (a.effect as KeyframeEffect).getTiming();
      expect(timing.iterations ?? 1).toBe(1);
      expect(Number.isFinite(Number(timing.duration))).toBe(true);
      for (const k of (a.effect as KeyframeEffect).getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key))).toBe(true);
    }
  });

  it('seek is deterministic, and the frames follow the rig', () => {
    const s = stage();
    for (const t of [0.4, 1.3, 2.6, 3.4, 4.1]) expect(s.sample(t)).toEqual(s.sample(t));
    s.seek(2.6);
    expect(s.time).toBeCloseTo(2.6, 5);
    expect(s.playing).toBe(false);
    // the frame of the bottom bunny: its feet where the rig says (frame origin = feet)
    const t = 2.9;
    const f = parts(s.sample(t)['t0.frame']?.transform);
    const ref = poseAt(s.plan, 0, t);
    const ox = f.x - ref.x;
    const oy = f.y - ref.y;
    for (const tt of [1.5, 3.0, 3.9]) {
      const g = parts(s.sample(tt)['t0.frame']?.transform);
      const r = poseAt(s.plan, 0, tt);
      expect(g.x - r.x).toBeCloseTo(ox, 0);
      expect(g.y - r.y).toBeCloseTo(oy, 0);
    }
  });

  it('ears only rotate, never more than 14° from rest (one ear physics, no shape change)', () => {
    const s = stage();
    expect(EAR_MAX).toBe(14);
    const ears = s.animations.filter((a) => /\.ear[LR]$/.test(a.id));
    expect(ears.length).toBeGreaterThan(0);
    for (const a of ears) {
      for (const k of (a.effect as KeyframeEffect).getKeyframes()) {
        const q = parts(k.transform as string);
        expect(Math.abs(q.r)).toBeLessThanOrEqual(14.001);
        expect([q.x, q.y, q.sx, q.sy]).toEqual([0, 0, 1, 1]);
      }
    }
  });

  it('Pompon on top: turns to you, star eyes for the binky, normal (wide) eyes again before he bails out', () => {
    const s = stage();
    const front = s.sample(BEAT.front + 0.3);
    expect(parts(front['t3.turn.tf']?.transform)).toMatchObject({ x: 0, sx: 1 });
    const mid = s.sample((s.plan.binky.up + s.plan.binky.land) / 2);
    expect(mid['t3.star']?.opacity).toBe('1');
    expect(mid['t3.eyes']?.opacity).toBe('0');
    const out = s.sample(BEAT.sep[3]);
    expect(out['t3.star']?.opacity).toBe('0');
    expect(out['t3.eyes']?.opacity).toBe('1');
    // and he faces where he goes: the 3/4 turn to the right when he lands on the edge
    expect(parts(s.sample(s.plan.members[3]?.ground ?? 4.4)['t3.turn.tf']?.transform)).toMatchObject({ x: 13, sx: 0.88 });
  });

  it('being landed on: the eyes below squeeze shut a moment (and open again)', () => {
    const s = stage();
    const land = s.plan.members[3]?.jump?.land ?? 0;
    for (const k of [0, 1, 2]) {
      const shut = Math.min(...Array.from({ length: 30 }, (_, i) => parts(s.sample(land + i * 0.01)[`t${k}.eyes`]?.transform).sy));
      expect(shut).toBeLessThan(0.3);
      expect(parts(s.sample(land + 0.6)[`t${k}.eyes`]?.transform).sy).toBeGreaterThan(0.95);
    }
  });

  it('the shadow never flies: off while in the air or in the tower, back on the edge', () => {
    const s = stage();
    const c = s.plan.members[1];
    if (!c?.jump) throw new Error('no jump');
    expect(s.sample(c.jump.land + 0.5)['t1.shadow']?.opacity).toBe('0');
    expect(s.sample(c.ground + 0.04)['t1.shadow']?.opacity).toBe('1');
  });

  it('plays to its end once (onEnd), then nothing is left ticking', async () => {
    vi.useFakeTimers();
    try {
      const onEnd = vi.fn();
      const host = document.createElement('div');
      document.body.append(host);
      const s = new ParadeStage(host, { reduced: false, onEnd });
      s.play();
      expect(s.playing).toBe(true);
      await vi.advanceTimersByTimeAsync(s.duration * 1000 + 50);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(s.playing).toBe(false);
      expect(s.animations.filter((a) => a.playState === 'running')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TowerStage (the app entry @bunprise/mascot/tower)', () => {
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('is busy while it plays, done + onEnd at its end; ParadeStage is the same class', async () => {
    expect(ParadeStage).toBe(TowerStage);
    vi.useFakeTimers();
    try {
      const onEnd = vi.fn();
      const host = document.createElement('div');
      document.body.append(host);
      const s = new TowerStage(host, { reduced: false, onEnd });
      let done = false;
      void s.done.then(() => (done = true));
      expect(s.busy).toBe(false);
      s.play();
      expect(s.busy).toBe(true);
      expect(s.suspended).toBe(false);
      await vi.advanceTimersByTimeAsync(s.duration * 1000 + 50);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(done).toBe(true);
      expect(s.busy).toBe(false);
      s.destroy();
      expect(s.isDestroyed).toBe(true);
      expect(s.root.innerHTML).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a hidden tab parks it at its exact frame; visible again, it goes on from there', async () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement('div');
      document.body.append(host);
      const s = new TowerStage(host, { reduced: false });
      s.play();
      await vi.advanceTimersByTimeAsync(1000);
      setHidden(true);
      expect(s.suspended).toBe(true);
      expect(s.busy).toBe(true);
      const held = s.time;
      expect(held).toBeGreaterThan(0.9);
      expect(s.animations.filter((a) => a.playState === 'running')).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(3000);
      expect(s.time).toBeCloseTo(held, 5);
      setHidden(false);
      expect(s.suspended).toBe(false);
      expect(s.animations.some((a) => a.playState === 'running')).toBe(true);
      s.destroy();
    } finally {
      setHidden(false);
      vi.useRealTimers();
    }
  });

  it('starting in a hidden tab waits (parked) until it can be seen', () => {
    try {
      setHidden(true);
      const host = document.createElement('div');
      document.body.append(host);
      const s = new TowerStage(host, { reduced: false });
      s.play();
      expect(s.suspended).toBe(true);
      expect(s.animations.filter((a) => a.playState === 'running')).toHaveLength(0);
      setHidden(false);
      expect(s.suspended).toBe(false);
      expect(s.animations.some((a) => a.playState === 'running')).toBe(true);
      s.destroy();
    } finally {
      setHidden(false);
    }
  });

  it('reduced: no animate() at all, and it still ends (done) after the fade', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const host = document.createElement('div');
    document.body.append(host);
    const onEnd = vi.fn();
    const s = new TowerStage(host, { reduced: true, onEnd });
    s.play();
    expect(s.busy).toBe(true);
    const rm = s.root.querySelector<HTMLElement>('.rm');
    rm?.dispatchEvent(new Event('animationend'));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(s.busy).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('ParadeStage (reduced motion)', () => {
  it('four still heads over the edge, no animate() call, 2 s held between the fades (as v1)', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const s = stage(true);
    expect(spy).not.toHaveBeenCalled();
    expect(s.actorCount).toBe(4);
    expect(s.duration).toBeCloseTo(RM.fadeIn + RM.hold + RM.fadeOut, 5);
    expect(RM.hold).toBe(2);
    expect(s.root.querySelectorAll('.rm .clip .frame').length).toBeGreaterThanOrEqual(4);
    const css = s.root.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/@keyframes pr-rm/);
    // only opacity in the fade
    const keyframes = /@keyframes pr-rm \{(.*)\}\s*$/m.exec(css)?.[1] ?? '';
    expect(keyframes).not.toMatch(/transform/);
    s.play();
    expect(s.playing).toBe(true);
    s.seek(1);
    expect(s.time).toBe(1);
  });
});

describe('the reduced-motion fade and the driver (controls)', () => {
  it('CssFade: seek shows exactly that moment, pause keeps it, stop + play starts from 0 (no stale delay)', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const fade = new CssFade(target, 'on', 2.9);
    fade.play();
    expect(target.style.animationDelay).toBe('0s');
    expect(target.style.animationPlayState).toBe('running');
    fade.seek(0.2);
    expect(fade.time).toBe(0.2);
    expect(target.style.animationDelay).toBe('-0.2s');
    expect(target.style.animationPlayState).toBe('paused');
    fade.play();
    fade.pause();
    expect(target.style.animationPlayState).toBe('paused');
    expect(fade.playing).toBe(false);
    fade.seek(2.9);
    fade.stop();
    expect(target.classList.contains('on')).toBe(false);
    fade.play();
    expect(target.style.animationDelay).toBe('0s');
  });

  it('Driver: seeking back before the end clears "ended"', async () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement('div');
      document.body.append(host);
      const track = new Track(host, 'x', { o: 0 }).move(0, 0.5, { o: 1 });
      const d = new Driver(host, [track], 0.5);
      d.play();
      await vi.advanceTimersByTimeAsync(600);
      expect(d.hasEnded).toBe(true);
      d.seek(0.2);
      expect(d.hasEnded).toBe(false);
      d.play();
      expect(d.hasEnded).toBe(false);
      d.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the gallery page', () => {
  it('mounts the Profil bottom; 5 taps on the version line start the show', () => {
    const app = document.createElement('div');
    document.body.append(app);
    paradeGallery(app, new URLSearchParams('screens=parade&autoplay=0&contact=0'));
    const parade = (window as unknown as { parade: ParadeStage }).parade;
    expect(parade.playing).toBe(false);
    const version = app.querySelector<HTMLElement>('[data-version]');
    expect(version?.textContent).toMatch(/Version/);
    for (let i = 0; i < 4; i++) version?.click();
    expect(parade.playing).toBe(false);
    version?.click();
    expect(parade.playing).toBe(true);
  });

  it('the stage ends 16 px below the card top (the edge they stand on); &w=320 makes a narrow phone', () => {
    const ph = profilPhone(document.body, 'light');
    expect(Number.parseFloat(ph.host.style.top) + Number.parseFloat(ph.host.style.height)).toBe(478 + 16);
    const narrow = profilPhone(document.body, 'light', 320);
    expect(narrow.phone.style.width).toBe('320px');
    expect(narrow.card.width).toBe(288);
  });
});
