import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bunny, WelcomeStage, type BunnyCoat, type EarStyle } from '../src/index';
import type { FakeAnimation } from './setup';
import { liftedEarPath } from '../src/ear-lift';

const mounted: Array<Bunny | WelcomeStage> = [];

function host(): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperties(el, { clientWidth: { value: 390 }, clientHeight: { value: 560 } });
  document.body.append(el);
  return el;
}

function bunny(ears: EarStyle = 'lop', coat: BunnyCoat = 'fawn'): Bunny {
  const actor = new Bunny(host(), { ears, coat, idle: false, reducedMotion: 'off' });
  mounted.push(actor);
  return actor;
}

function animations(actor: Bunny): FakeAnimation[] {
  return actor.root.querySelector('svg')!.getAnimations({ subtree: true }) as unknown as FakeAnimation[];
}

function visibleEars(actor: Bunny): SVGGElement[] {
  return [...actor.root.querySelectorAll<SVGGElement>(`${actor.ears === 'upright' ? '.up' : '.lop'} .ear-l, ${actor.ears === 'upright' ? '.up' : '.lop'} .ear-r`)];
}

function angle(transform: unknown): number {
  return Number(typeof transform === 'string' ? /rotate\((-?[\d.]+)deg\)/.exec(transform)?.[1] ?? 0 : 0);
}

function coordinates(path: string): number[] { return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number); }
function minY(path: string): number { return Math.min(...coordinates(path).filter((_, index) => index % 2 === 1)); }
function area(path: string): number {
  const n = coordinates(path);
  const points: Array<readonly [number, number]> = [[n[0]!, n[1]!]];
  let x = n[0]!, y = n[1]!;
  for (let i = 2; i < n.length; i += 6) {
    for (let step = 1; step <= 24; step++) {
      const t = step / 24, u = 1 - t;
      points.push([
        u ** 3 * x + 3 * u * u * t * n[i]! + 3 * u * t * t * n[i + 2]! + t ** 3 * n[i + 4]!,
        u ** 3 * y + 3 * u * u * t * n[i + 1]! + 3 * u * t * t * n[i + 3]! + t ** 3 * n[i + 5]!,
      ]);
    }
    x = n[i + 4]!; y = n[i + 5]!;
  }
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]!;
    return sum + point[0] * next[1] - point[1] * next[0];
  }, 0)) / 2;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const actor of mounted.splice(0)) actor.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('surprise keeps the bunny’s own pair of ears', () => {
  it.each(['lop', 'upright'] as const)('moves the original %s ears without fading them or introducing another pair', async (ears) => {
    const actor = bunny(ears);
    const original = visibleEars(actor);
    const shapes = original.map((ear) => ear.innerHTML);
    const done = actor.play('surprise');
    const active = animations(actor);
    expect(active.filter((animation) => animation.effect.target.closest('.tall'))).toHaveLength(0);
    for (const ear of original) {
      const target = ears === 'lop' ? ear.querySelector('path') : ear;
      const property = ears === 'lop' ? 'd' : 'transform';
      const motion = active.find((animation) => animation.effect.target === target);
      expect(motion, 'the same visible ear must move').toBeDefined();
      const frames = motion!.effect.getKeyframes();
      expect(frames.some((frame) => frame[property] !== frames[0]?.[property])).toBe(true);
      expect(frames.every((frame) => frame.opacity === undefined || Number(frame.opacity) === 1)).toBe(true);
      expect(frames.at(-1)?.[property]).toBe(frames[0]?.[property]);
    }
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    visibleEars(actor).forEach((ear, index) => expect(ear).toBe(original[index]));
    expect(original.map((ear) => ear.innerHTML)).toEqual(shapes);
    expect(animations(actor)).toHaveLength(0);
  });

  it('holds the same shaped and coloured lop ears upright for every coat, then restores them', () => {
    for (const coat of ['fawn', 'choc', 'blue', 'himalayan', 'broken'] as const) {
      const actor = bunny('lop', coat);
      const ears = visibleEars(actor);
      const paths = ears.flatMap(ear => [...ear.querySelectorAll('path')]);
      const shapes = paths.map(path => [path.getAttribute('d'), path.getAttribute('fill')]);
      actor.pose('surprise');
      expect(paths.every(path => minY(path.style.getPropertyValue('d')) < -210)).toBe(true);
      expect(ears.every((ear) => ear.style.opacity === '' || Number(ear.style.opacity) === 1)).toBe(true);
      expect(paths.map(path => [path.getAttribute('d'), path.getAttribute('fill')])).toEqual(shapes);
      for (const tall of actor.root.querySelectorAll<SVGElement>('.tall .tear')) {
        expect(tall.style.opacity === '' || Number(tall.style.opacity) === 0).toBe(true);
      }
      actor.pose('idle');
      expect(paths.every(path => path.style.getPropertyValue('d') === '')).toBe(true);
      expect(ears.every((ear) => ear.style.transform === '' && ear.style.opacity === '')).toBe(true);
    }
  });

  it('cleans up an interrupted lift and can replay on the same original nodes', async () => {
    const actor = bunny();
    const ears = visibleEars(actor);
    const first = actor.play('surprise');
    await vi.advanceTimersByTimeAsync(300);
    await actor.interrupt();
    await first;
    expect(actor.busy).toBe(false);
    expect(animations(actor)).toHaveLength(0);
    expect(ears.every((ear) => ear.style.transform === '' && ear.style.opacity === '')).toBe(true);
    const second = actor.play('surprise');
    expect(animations(actor).filter(animation => ears.some(ear => ear.contains(animation.effect.target)))).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(3000);
    await second;
    visibleEars(actor).forEach((ear, index) => expect(ear).toBe(ears[index]));
    expect(actor.busy).toBe(false);
  });

  it('keeps the resting pair still under reduced motion', async () => {
    const actor = bunny();
    actor.setReducedMotion('force');
    const ears = visibleEars(actor);
    const shapes = ears.map((ear) => ear.outerHTML);
    const animate = vi.spyOn(Element.prototype, 'animate');
    await actor.play('surprise');
    expect(animate).not.toHaveBeenCalled();
    expect(visibleEars(actor).map((ear) => ear.outerHTML)).toEqual(shapes);
  });

  it('raises the welcome actor’s original ears continuously and never activates replacement ears', () => {
    const stage = new WelcomeStage(host(), { choreography: 'surprise', reducedMotion: 'off' });
    mounted.push(stage);
    const samples = Array.from({ length: Math.ceil(stage.duration / 0.02) + 1 }, (_, index) => stage.sample(index * 0.02));
    const previous = [0, 0];
    for (const sample of samples) {
      expect(Object.keys(sample).some((part) => /tall|earTips/.test(part))).toBe(false);
      for (const [index, side] of ['L', 'R'].entries()) {
        const ear = sample[`p0.ear${side}`];
        expect(ear).toBeDefined();
        expect(ear?.opacity === undefined || Number(ear.opacity) === 1).toBe(true);
        const rotation = angle(ear?.transform);
        // A clamped, already-occupied track must not turn the whole lift into a one-frame jump.
        expect(Math.abs(rotation - previous[index]!)).toBeLessThan(45);
        previous[index] = rotation;
      }
    }
    const lifted = samples.findIndex(sample => minY(sample['p0.earShape00']?.d ?? '') < -210);
    expect(lifted).toBeGreaterThan(0);
    for (const sample of samples) {
      for (const [side, x] of [[0, -26.5], [1, 26.5]] as const) {
        const n = coordinates(sample[`p0.earShape${side}0`]?.d ?? '');
        expect((n[0]! + n.at(-2)!) / 2).toBeCloseTo(x, 2);
        expect((n[1]! + n.at(-1)!) / 2).toBeCloseTo(-155.5, 2);
      }
    }
    const peak = lifted * 0.02;
    stage.seek(peak);
    const first = stage.sample();
    stage.seek(0);
    stage.seek(peak);
    expect(stage.sample()).toEqual(first);
    for (const side of ['L', 'R']) expect(angle(stage.sample(stage.duration)[`p0.ear${side}`]?.transform)).toBe(0);
    expect((stage.animations as unknown as FakeAnimation[]).some((animation) => animation.effect.target.closest('.tall'))).toBe(false);
  });

  it('keeps the ear volume and root attached throughout the lift instead of squeezing a flat leaf', () => {
    const restingArea = area(liftedEarPath(0, false, false));
    for (let step = 0; step <= 100; step++) {
      for (const right of [false, true]) {
        const path = liftedEarPath(step / 100, false, right);
        expect(area(path) / restingArea).toBeGreaterThan(.9);
        expect(area(path) / restingArea).toBeLessThan(1.1);
        const n = coordinates(path);
        expect((n[0]! + n.at(-2)!) / 2).toBeCloseTo(right ? 26.5 : -26.5, 2);
        expect((n[1]! + n.at(-1)!) / 2).toBeCloseTo(-155.5, 2);
      }
    }
  });
});
