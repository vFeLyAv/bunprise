import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarryStage, WelcomeStage, welcomeSteps, type CarryOptions, type WelcomePreset } from '../src/index';
import type { FakeAnimation } from './setup';

// Wave 1 (Felix's K8 / K10): the short bunny moments of the app and the carry ("the bunnies WORK").

function host(w = 390, h = 560): HTMLDivElement {
  const d = document.createElement('div');
  Object.defineProperty(d, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(d, 'clientHeight', { configurable: true, value: h });
  document.body.append(d);
  return d;
}

const fakes = (s: { animations: readonly Animation[] }) => s.animations as unknown as FakeAnimation[];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const MOMENTS: readonly WelcomePreset[] = ['hop-across', 'peek-side', 'pop-up', 'wave', 'lost', 'shrug', 'sleepy'];

describe('the short moments', () => {
  it('each is one bunny, short (≤ 5 s), and animates only transform and opacity', () => {
    for (const choreography of MOMENTS) {
      const s = new WelcomeStage(host(390, 180), { reducedMotion: 'off', choreography, edgeInset: { bottom: 16 } });
      expect(s.actorCount, choreography).toBe(1);
      expect(s.duration, choreography).toBeGreaterThan(1);
      expect(s.duration, choreography).toBeLessThan(5);
      const props = new Set<string>();
      for (const a of fakes(s)) for (const f of a.effect.getKeyframes()) for (const k of Object.keys(f)) if (!['offset', 'easing', 'composite'].includes(k)) props.add(k);
      expect([...props].every((k) => k === 'opacity' || k === 'transform'), choreography).toBe(true);
      s.destroy();
    }
  });

  it("'hop-across' crosses without a stop, from off-stage left to off-stage right", () => {
    const [step] = welcomeSteps('hop-across');
    expect(step).toMatchObject({ type: 'run', pause: null });
    const s = new WelcomeStage(host(390, 140), { reducedMotion: 'off', choreography: 'hop-across' });
    const x = (t: number) => {
      const tr = s.sample(t)['r0.frame']?.transform ?? '';
      const travel = s.sample(t)['r0.travel']?.transform ?? '';
      const n = (v: string) => Number(/translate\((-?[\d.]+)px/.exec(v)?.[1] ?? 0);
      return n(tr) + n(travel);
    };
    // x = the left edge of the bunny's frame: it starts left of the stage and ends right of it (off-stage)
    expect(x(0)).toBeLessThan(0);
    expect(x(s.duration)).toBeGreaterThanOrEqual(390);
    // never sits: the feet keep travelling between the first and the last hop
    let still = 0;
    for (let t = 0.3; t < s.duration - 0.3; t += 0.1) {
      if (Math.abs(x(t + 0.1) - x(t)) < 0.5) still += 1;
    }
    expect(still).toBeLessThanOrEqual(1);
    s.destroy();
  });

  it("'pop-up' and 'peek-side' duck back (the stage is empty at the end); the others stay", () => {
    for (const [choreography, stays] of [
      ['pop-up', false],
      ['peek-side', false],
      ['wave', true],
      ['lost', true],
      ['shrug', true],
      ['sleepy', true],
    ] as const) {
      const step = welcomeSteps(choreography)[0];
      expect(step?.type === 'peek' && Boolean(step.stay), choreography).toBe(stays);
    }
    const s = new WelcomeStage(host(390, 180), { reducedMotion: 'off', choreography: 'pop-up', edgeInset: { bottom: 16 } });
    s.seek(s.duration + 0.5);
    const lift = s.sample()['p0.lift']?.transform ?? '';
    // hidden again: lifted well out of the clip (positive y = behind the bottom edge)
    expect(Number(/translate\(-?[\d.]+px, (-?[\d.]+)px\)/.exec(lift)?.[1] ?? 0)).toBeGreaterThan(20);
    s.destroy();
  });

  it("'shrug': both paws leave the edge (contact shadows off) and slap back onto it", () => {
    const s = new WelcomeStage(host(390, 180), { reducedMotion: 'off', choreography: 'shrug', edgeInset: { bottom: 16 } });
    const shadows = (t: number) => [s.sample(t)['p0.shL']?.opacity, s.sample(t)['p0.shR']?.opacity];
    // the climb ends with both paws on the edge
    expect(shadows(1.0)).toEqual(['1', '1']);
    const mid = [1.6, 1.8, 2.0].map(shadows);
    expect(mid.some(([l, r]) => l === '0' && r === '0')).toBe(true);
    expect(shadows(s.duration + 1)).toEqual(['1', '1']);
    s.destroy();
  });

  it("'sleepy': it nods off — the eyes close (sleep arcs shown), then it sleeps (no blinking, a floating z)", async () => {
    const s = new WelcomeStage(host(390, 180), { reducedMotion: 'off', choreography: 'sleepy', edgeInset: { bottom: 16 } });
    s.seek(s.duration + 0.5);
    const f = s.sample();
    expect(f['p0.eyes']?.opacity).toBe('0');
    expect(f['p0.sleepEyes']?.opacity).toBe('1');
    s.play();
    await vi.advanceTimersByTimeAsync(s.duration * 1000 + 50);
    const running = fakes(s)
      .filter((a) => a.playState === 'running')
      .map((a) => a.id)
      .sort();
    expect(running).toEqual(['p0.breathe', 'p0.nod', 'p0.z']);
    s.destroy();
  });

  it('a staying bunny lives on: breathing, blinks, an ear twitch and a nose wiggle (loops)', async () => {
    const s = new WelcomeStage(host(390, 180), { reducedMotion: 'off', choreography: 'wave', edgeInset: { bottom: 16 } });
    s.play();
    await vi.advanceTimersByTimeAsync(s.duration * 1000 + 50);
    const loops = fakes(s).filter((a) => a.playState === 'running' && a.effect.getTiming().iterations === Infinity);
    expect(loops.map((a) => a.id).sort()).toEqual(['p0.blink0', 'p0.blink1', 'p0.breathe', 'p0.earTwitch', 'p0.noseWiggle']);
    s.destroy();
  });

  it('reduced motion: the moments show the calm static pose (no animate() calls)', () => {
    const animate = vi.spyOn(Element.prototype, 'animate');
    const s = new WelcomeStage(host(390, 180), { reducedMotion: 'force', choreography: 'lost' });
    expect(animate).not.toHaveBeenCalled();
    expect(s.actorCount).toBe(1);
    s.destroy();
  });
});

// ---------- carry ----------

function layer(): HTMLDivElement {
  return host(390, 844);
}

const REQUEST: CarryOptions = {
  from: { left: 160, top: 760, width: 70, height: 56 },
  to: { left: 30, top: 300, width: 330, height: 64 },
  item: 'card',
  tint: '#F7B27A',
};

describe('CarryStage', () => {
  it('hops along the way, lands the item on the target, then waves and hops away (transform + opacity only)', () => {
    const s = new CarryStage(layer(), { ...REQUEST, reducedMotion: 'off' });
    expect(s.reducedMotion).toBe(false);
    expect(s.landedAt).toBeGreaterThan(1);
    expect(s.landedAt).toBeLessThan(3);
    expect(s.duration).toBeGreaterThan(s.landedAt + 1);
    expect(s.duration).toBeLessThan(5);
    const props = new Set<string>();
    for (const a of fakes(s)) for (const f of a.effect.getKeyframes()) for (const k of Object.keys(f)) if (!['offset', 'easing', 'composite'].includes(k)) props.add(k);
    expect([...props].sort()).toEqual(['opacity', 'transform']);
    // the item's centre lies on the target's centre at the landing
    const at = s.sample(s.landedAt)['item.travel']?.transform ?? '';
    const [x, y] = (/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(at) ?? []).slice(1).map(Number);
    const item = s.root.querySelector<HTMLElement>('.item');
    const w = parseFloat(item?.style.width ?? '0');
    const h = parseFloat(item?.style.height ?? '0');
    expect((x ?? 0) + w / 2).toBeCloseTo(30 + 330 / 2, 0);
    expect((y ?? 0) + h / 2).toBeCloseTo(300 + 64 / 2, 0);
    // gone at the end: the bunny faded out off the layer, the item faded on its target
    expect(s.sample(s.duration)['bunny.frame']?.opacity).toBe('0');
    expect(s.sample(s.duration)['item.travel']?.opacity).toBe('0');
    s.destroy();
  });

  it('resolves `landed` at the landing and `done` at the end; skip() resolves both at once', async () => {
    const s = new CarryStage(layer(), { ...REQUEST, reducedMotion: 'off' });
    const order: string[] = [];
    void s.landed.then(() => order.push('landed'));
    void s.done.then(() => order.push('done'));
    s.play();
    await vi.advanceTimersByTimeAsync(s.landedAt * 1000 + 20);
    expect(order).toEqual(['landed']);
    await vi.advanceTimersByTimeAsync((s.duration - s.landedAt) * 1000 + 50);
    expect(order).toEqual(['landed', 'done']);
    s.destroy();

    const t = new CarryStage(layer(), { ...REQUEST, reducedMotion: 'off' });
    const seen: string[] = [];
    void t.landed.then(() => seen.push('landed'));
    void t.done.then(() => seen.push('done'));
    t.play();
    t.skip();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(['landed', 'done']);
    expect(t.busy).toBe(false);
    t.destroy();
  });

  it("reduced motion ('force'): no bunny — the item glides to the target and fades", () => {
    const s = new CarryStage(layer(), { ...REQUEST, item: 'gift', reducedMotion: 'force' });
    expect(s.reducedMotion).toBe(true);
    expect(s.root.querySelector('.frame')).toBeNull();
    expect(s.duration).toBeLessThan(1);
    const end = s.sample(s.landedAt)['item.travel']?.transform ?? '';
    expect(end).toMatch(/translate\(/);
    s.destroy();
  });

  it('destroy() resolves the promises and empties the shadow root', async () => {
    const s = new CarryStage(layer(), { ...REQUEST, reducedMotion: 'off' });
    s.play();
    s.destroy();
    await expect(s.landed).resolves.toBeUndefined();
    await expect(s.done).resolves.toBeUndefined();
    expect(s.root.innerHTML).toBe('');
    expect(s.animations).toHaveLength(0);
  });
});
