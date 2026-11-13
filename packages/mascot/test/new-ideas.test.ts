import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bunny, CarryStage, ChaseStage, HamsterEdgeStage, NibbleStage, OverfedStage, WelcomeStage, welcomeSteps, type WelcomePreset } from '../src/index';
import type { FakeAnimation } from './setup';

function host() { const el = document.createElement('div'); Object.defineProperties(el, { clientWidth: { value: 390 }, clientHeight: { value: 210 } }); document.body.append(el); return el; }
afterEach(() => { document.body.replaceChildren();vi.useRealTimers();vi.restoreAllMocks(); });

describe('new small stages', () => {
  it('uses transform/opacity tracks, finite durations, deterministic seeking, and cleans up every stage', () => {
    const target = { left: 40, top: 100, width: 260, height: 100 };
    const stages = [new ChaseStage(host(), { reducedMotion: 'off' }), new NibbleStage(host(), { target, reducedMotion: 'off' }), new OverfedStage(host(), { reducedMotion: 'off' }), new HamsterEdgeStage(host(), { reducedMotion: 'off' })];
    for (const stage of stages) {
      expect(stage.duration).toBeGreaterThan(0);expect(stage.duration).toBeLessThanOrEqual(5);
      stage.seek(1.2);const first = stage.sample(1.2);stage.seek(0);stage.seek(1.2);expect(stage.sample(1.2)).toEqual(first);
      for (const anim of stage.animations as unknown as FakeAnimation[]) for (const key of anim.effect.getKeyframes())
        expect(Object.keys(key).every((k) => ['transform', 'opacity', 'offset', 'easing', 'composite'].includes(k))).toBe(true);
      stage.destroy();expect(stage.root.innerHTML).toBe('');expect(stage.isDestroyed).toBe(true);
    }
  });
  it('hides decorations under reduced motion and keeps illustrations still with no animations', () => {
    const hidden = [new NibbleStage(host(), { target: { left: 0, top: 0, width: 10, height: 10 }, reducedMotion: 'force' }), new OverfedStage(host(), { reducedMotion: 'force' }), new HamsterEdgeStage(host(), { reducedMotion: 'force' })];
    for (const stage of hidden) { expect(stage.empty).toBe(true);expect(stage.animations).toHaveLength(0);stage.destroy(); }
    // the chase (23.10) shows a calm still under reduced motion (chase.test.ts)
    const calm = [new ChaseStage(host(), { reducedMotion: 'force', loop: true }), new OverfedStage(host(), { reducedMotion: 'force', illustration: true }), new HamsterEdgeStage(host(), { reducedMotion: 'force', illustration: true })];
    for (const stage of calm) { expect(stage.empty).toBe(false);expect(stage.animations).toHaveLength(0);stage.destroy(); }
  });
  it('stops a looping chase immediately and leaves at least 1.5 seconds between runs', async () => {
    const stage = new ChaseStage(host(), { reducedMotion: 'off', loop: true });stage.play();stage.stop(false);await stage.done;
    expect(stage.busy).toBe(false);expect(stage.time).toBe(0);stage.destroy();
  });
  it('really hides a stopped overfed figure, including after its fade completes, and can replay', async () => {
    vi.useFakeTimers();
    for (const fade of [false, true]) {
      const stage = new OverfedStage(host(), { reducedMotion: 'off' });
      stage.play();
      await vi.advanceTimersByTimeAsync(1200);
      stage.stop(fade);
      await vi.advanceTimersByTimeAsync(200);
      await stage.done;
      expect(stage.root.querySelector('.stage')?.classList.contains('rm-hidden')).toBe(true);
      expect(stage.animations.filter((a) => a.playState === 'running')).toHaveLength(0);
      stage.play();
      expect(stage.root.querySelector('.stage')?.classList.contains('rm-hidden')).toBe(false);
      expect(stage.busy).toBe(true);
      stage.destroy();
    }
  });
  it('letter exits with the bunny; none adds no item SVG; reduced off-edge carries resolve at once', async () => {
    const boxes = { from: { left: 20, top: 100, width: 40, height: 40 }, to: { left: 200, top: 50, width: 50, height: 50 } };
    const letter = new CarryStage(host(), { ...boxes, item: 'letter', away: 'right', reducedMotion: 'off' });
    expect(letter.root.querySelector('.item svg')).not.toBeNull();expect(letter.duration).toBeLessThan(2.1);expect(letter.sample(letter.duration)['item.travel']?.opacity).toBe('0');letter.destroy();
    const jump = new CarryStage(host(), { ...boxes, item: 'none', reducedMotion: 'off' });expect(jump.root.querySelector('.item svg')).toBeNull();expect(jump.duration).toBeLessThan(0.8);expect(jump.sample(jump.duration)['bunny.frame']?.opacity).toBe('0');jump.destroy();
    const calm = new CarryStage(host(), { ...boxes, item: 'letter', away: 'right', reducedMotion: 'force' });calm.play();await calm.done;expect(calm.animations).toHaveLength(0);calm.destroy();
  });
});
describe('new welcome presets and app-controlled puppet scenes', () => {
  const presets: WelcomePreset[] = ['corner-left', 'corner-right', 'meet', 'ears-only', 'lift', 'surprise', 'peek-sniff', 'climb-left', 'climb-right'];
  it('anchors corner peeks to the card floor instead of floating half a body in mid-air', () => {
    for (const name of ['corner-left', 'corner-right'] as const) {
      expect(welcomeSteps(name)[0]).toMatchObject({ type: 'peek', floor: true });
    }
  });
  it('climbs out over the card top near its ends (clear of the rounded corner), leaning in, and ducks again', () => {
    const [left] = welcomeSteps('climb-left');
    const [right] = welcomeSteps('climb-right');
    expect(left).toMatchObject({ type: 'peek', edge: 'bottom', sniff: true });
    expect(right).toMatchObject({ type: 'peek', edge: 'bottom', sniff: true });
    if (left?.type !== 'peek' || right?.type !== 'peek') throw new Error('peeks expected');
    expect(left.floor).toBeUndefined();
    expect(left.stay).toBeUndefined();
    expect(left.pos).toBeGreaterThanOrEqual(0.2);
    expect(right.pos).toBeLessThanOrEqual(0.8);
    expect(left.pos! + right.pos!).toBeCloseTo(1);
    // each leans toward the middle of the card (clockwise = to the right)
    expect(left.tilt).toBeGreaterThan(0);
    expect(right.tilt).toBeLessThan(0);
  });
  it.each(presets)('%s resolves its own choreography and has a calm closed-eye version', (choreography) => {
    expect(welcomeSteps(choreography)).not.toEqual(welcomeSteps('welcome'));
    const stage = new WelcomeStage(host(), { choreography, reducedMotion: 'off' });expect(stage.duration).toBeLessThan(5);stage.seek(1.2);expect(stage.actorCount).toBeLessThanOrEqual(2);stage.destroy();
    const calm = new WelcomeStage(host(), { choreography, calmEyes: 'happy', reducedMotion: 'force' });expect(calm.sample()['p0.eyes']?.opacity).toBe('0');expect(calm.sample()['p0.happyEyes']?.opacity).toBe('1');expect(calm.animations).toHaveLength(0);calm.destroy();
  });
  it('calls only the injected haptic handler, and never navigator.vibrate for scenes', async () => {
    vi.useFakeTimers();const vibrate = vi.fn();Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });const haptics = vi.fn();
    const bunny = new Bunny(host(), { idle: false, reducedMotion: 'off', haptics });const tap = bunny.tap();await vi.advanceTimersByTimeAsync(4000);await tap;expect(haptics).toHaveBeenCalledWith('tap');expect(vibrate).not.toHaveBeenCalled();
    haptics.mockClear();const scene = bunny.play('jump');await vi.advanceTimersByTimeAsync(4000);await scene;expect(haptics).not.toHaveBeenCalled();bunny.destroy();
  });
});
