import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BunpriseWelcomeElement,
  defineWelcomeElement,
  MAX_ACTORS,
  stageUnit,
  WELCOME_DEFAULT_BUNNIES,
  WELCOME_PRESETS,
  WELCOME_TAG,
  WelcomeStage,
  welcomeSteps,
  type WelcomeOptions,
  type WelcomePartStyle,
  type WelcomeStep,
} from '../src/index';
import { FLOOR_TILT, frameBox, placePeek, rotate, runSchedule, type PeekPlace, type StageGeo, type Vec } from '../src/welcome-actors';
import { parseInset } from '../src/welcome-element';
import type { FakeAnimation } from './setup';

/** jsdom has no layout: the stage reads clientWidth / clientHeight. */
function host(w = 390, h = 560): HTMLDivElement {
  const d = document.createElement('div');
  Object.defineProperty(d, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(d, 'clientHeight', { configurable: true, value: h });
  document.body.append(d);
  return d;
}

const fakes = (s: WelcomeStage) => s.animations as unknown as FakeAnimation[];

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('WelcomeStage API', () => {
  it('exposes the documented surface and the built-in choreographies', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    for (const k of ['play', 'playWhenIdle', 'pause', 'stop', 'seek', 'destroy', 'sample', 'setReducedMotion'] as const) {
      expect(typeof (s as unknown as Record<string, unknown>)[k]).toBe('function');
    }
    expect(s.duration).toBeGreaterThan(6);
    expect(s.duration).toBeLessThan(8.5);
    expect(s.playing).toBe(false);
    expect(s.ended).toBe(false);
    expect(s.time).toBe(0);
    expect(s.actorCount).toBe(4);
    expect(s.root).toBe(s.host.shadowRoot);
    expect(WELCOME_PRESETS).toEqual([
      'welcome',
      'peek-once',
      'peek-bottom',
      'peek-left',
      'peek-right',
      'run',
      'hop-across',
      'peek-side',
      'pop-up',
      'wave',
      'lost',
      'shrug',
      'sleepy', 'corner-left', 'corner-right', 'meet', 'ears-only', 'lift', 'surprise', 'peek-sniff', 'climb-left', 'climb-right',
    ]);
    expect(WELCOME_DEFAULT_BUNNIES[0]).toBe('fawn');
    s.destroy();
  });

  it('animates only transform and opacity', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    const props = new Set<string>();
    for (const a of fakes(s)) {
      for (const f of a.effect.getKeyframes()) {
        for (const k of Object.keys(f)) if (k !== 'offset' && k !== 'easing' && k !== 'composite') props.add(k);
      }
    }
    expect([...props].sort()).toEqual(['opacity', 'transform']);
    s.destroy();
  });

  it('builds every animation paused at t = 0 and never asks for requestAnimationFrame', async () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    expect(fakes(s).length).toBeGreaterThan(20);
    expect(fakes(s).every((a) => a.playState === 'paused' && a.currentTime === 0)).toBe(true);
    s.play();
    await vi.advanceTimersByTimeAsync(3000);
    s.seek(1);
    expect(raf).not.toHaveBeenCalled();
    s.destroy();
  });

  it("'peek-once' is a single bunny that peeks from the bottom and stays", () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off', choreography: 'peek-once' });
    expect(s.actorCount).toBe(1);
    expect(s.duration).toBeLessThan(3);
    s.seek(s.duration + 5);
    const f = s.sample();
    expect(f['p0.lift']?.transform).toBe('translate(0px, 0px)');
    // calm hold: breathing and blinking loops are running after the end
    expect(f['p0.breathe']).toBeDefined();
    s.destroy();
  });

  it('welcomeSteps: the main bunny always ends the show; fewer bunnies, fewer roles', () => {
    for (const n of [1, 2, 3, 4]) {
      const steps = welcomeSteps('welcome', n);
      const last = steps[steps.length - 1];
      expect(last?.actor).toBe(0);
      expect(last?.type === 'peek' && last.stay === true && last.greet === true).toBe(true);
      expect(Math.max(...steps.map((s) => s.actor))).toBeLessThan(n);
    }
  });
});

describe('seek()', () => {
  it('is deterministic: the same t gives the same transforms, every animation frozen at t', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    s.seek(2.5);
    const a = s.sample();
    for (const x of fakes(s)) {
      expect(x.playState).toBe('paused');
      expect(x.currentTime).toBe(2500);
    }
    s.seek(6.2);
    const b = s.sample();
    s.seek(2.5);
    const c = s.sample();
    expect(Object.keys(a).length).toBeGreaterThan(20);
    expect(c).toEqual(a);
    expect(b).not.toEqual(a);
    expect(s.time).toBe(2.5);
    // no randomness: a second stage with the same options shows the same frame
    const s2 = new WelcomeStage(host(), { reducedMotion: 'off' });
    s2.seek(2.5);
    expect(s2.sample()).toEqual(a);
    s.destroy();
    s2.destroy();
  });

  it('t = 0 is an empty stage; at the end the main bunny peeks with both paws on the edge', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    s.seek(0);
    const start = s.sample();
    for (const slot of [0, 1, 2]) expect(start[`p${slot}.lift`]?.transform).not.toBe('translate(0px, 0px)');
    s.seek(s.duration);
    const end = s.sample();
    expect(end['p0.lift']?.transform).toBe('translate(0px, 0px)');
    // bottom edge, no inset: the bottom of each paw sits on the edge line (y = -56 + 0.6)
    expect(end['p0.pawL']?.transform).toBe('translate(-24px, -55.4px) rotate(0deg) scale(1, 1)');
    expect(end['p0.pawR']?.transform).toBe('translate(24px, -55.4px) rotate(0deg) scale(1, 1)');
    s.destroy();
  });

  it('sample() agrees with the keyframes the browser gets, at the start and the end of every run', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    const style = (k: Keyframe | undefined) => ({
      ...(typeof k?.transform === 'string' ? { transform: k.transform } : {}),
      ...(k?.opacity !== undefined && k.opacity !== null ? { opacity: String(k.opacity) } : {}),
    });
    let checked = 0;
    s.seek(10); // every actor has joined
    for (const a of [...fakes(s)]) {
      const timing = a.effect.getTiming();
      const frames = a.effect.getKeyframes();
      if (!a.id || !frames.length || timing.iterations === Infinity) continue;
      const start = Number(timing.delay ?? 0) / 1000;
      const end = start + Number(timing.duration ?? 0) / 1000;
      // at the start WAAPI shows the last keyframe at offset 0 (a step), at the end the last one
      const atStart = [...frames].reverse().find((f) => f.offset === 0);
      expect(s.sample(start)[a.id]).toEqual(style(atStart));
      expect(s.sample(end)[a.id]).toEqual(style(frames[frames.length - 1]));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(60);
    s.destroy();
  });

  it('a part that waits does not tick: tracks are split into runs of movement', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    const runs = fakes(s).filter((a) => a.id === 'p1.earL');
    expect(runs.length).toBeGreaterThanOrEqual(2); // climbing up, ducking away
    expect(runs.every((a) => a.effect.getTiming().fill === 'forwards')).toBe(true);
    // runs are replayed (loop, seek back): the browser must not drop the ones that a later run covers
    s.seek(10);
    expect(fakes(s).filter((a) => a.id).every((a) => a.replaceState === 'persisted')).toBe(true);
    s.destroy();
  });

  it('keeps switches that happen between two long holds (paw over the edge, open mouth)', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    s.seek(6.6);
    // the main bunny's front paw copy switches on when the paw lands, the mouth opens for the greeting
    expect(fakes(s).some((a) => a.id === 'p0.pawLf')).toBe(true);
    expect(fakes(s).some((a) => a.id === 'p0.mouthOpen')).toBe(true);
    const f = s.sample();
    expect(f['p0.pawLf']?.opacity).toBe('1');
    expect(f['p0.pawLb']?.opacity).toBe('0');
    expect(f['p0.mouthOpen']?.opacity).toBe('1');
    expect(f['p0.eyes']?.opacity).toBe('0');
    s.destroy();
  });
});

describe('play() and onEnd', () => {
  it('fires onEnd once per run: not again later, not on stop() or destroy()', async () => {
    const onEnd = vi.fn();
    const h = host();
    const ev = vi.fn();
    h.addEventListener('welcome-end', ev);
    const s = new WelcomeStage(h, { reducedMotion: 'off', onEnd });
    s.play();
    expect(s.playing).toBe(true);
    await vi.advanceTimersByTimeAsync(s.duration * 1000 - 100);
    expect(onEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(ev).toHaveBeenCalledTimes(1);
    expect(s.ended).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    s.stop();
    s.destroy();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('resumeCalm(): the paused calm end pose breathes on without restarting the show or firing onEnd again', async () => {
    const onEnd = vi.fn();
    const s = new WelcomeStage(host(), { choreography: 'sleepy', reducedMotion: 'off', onEnd });
    s.resumeCalm(); // before the show: nothing to resume
    expect(s.playing).toBe(false);
    s.play();
    await vi.advanceTimersByTimeAsync(s.duration * 1000 + 100);
    expect(onEnd).toHaveBeenCalledTimes(1);
    s.pause(); // another mascot takes the stage
    expect(s.playing).toBe(false);
    s.resumeCalm(); // the stage is free again
    expect(s.playing).toBe(true);
    expect(s.ended).toBe(true);
    await vi.advanceTimersByTimeAsync(20000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it('after the show only the calm loops keep running; seek() brings the rest back', async () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    s.play();
    await vi.advanceTimersByTimeAsync(s.duration * 1000 + 50);
    const left = fakes(s);
    // what still runs: the staying bunny's idle life — breathing, two blinking eyes, an ear twitch and a
    // nose wiggle now and then (clocks are finished)
    const running = left.filter((a) => a.playState === 'running');
    expect(running.map((a) => a.id).sort()).toEqual(['p0.blink0', 'p0.blink1', 'p0.breathe', 'p0.earTwitch', 'p0.noseWiggle']);
    expect(left.filter((a) => a.id && a.effect.getTiming().iterations !== Infinity)).toHaveLength(0);
    // the settled parts keep their final pose inline; actors that are done are not rendered
    const lift = s.root.querySelectorAll<HTMLElement>('.clip .lift');
    expect([...lift].some((l) => l.style.transform === 'translate(0px, 0px)')).toBe(true);
    expect([...s.root.querySelectorAll<HTMLElement>('.frame')].filter((f) => f.style.display !== 'none')).toHaveLength(3);
    s.seek(2);
    expect(s.animations.length).toBeGreaterThan(40);
    expect(fakes(s).every((a) => a.currentTime === 2000)).toBe(true);
    s.destroy();
  });

  it('actors join a moment before their part (hidden and without animations until then)', async () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    const ids = () => new Set(fakes(s).map((a) => a.id.split('.')[0]).filter(Boolean));
    expect([...ids()]).toEqual(['p1']); // only the first bunny (bottom left, starts at 0.25 s)
    const hidden = () => [...s.root.querySelectorAll<HTMLElement>('.frame')].filter((f) => f.style.display === 'none').length;
    expect(hidden()).toBe(3 + 1 + 3); // the right-edge bunny (3 frames), runner (1), main bunny (3)
    s.play();
    await vi.advanceTimersByTimeAsync(2100);
    expect(ids().has('p2')).toBe(true); // the right-edge bunny joined at 0.5 s
    expect(ids().has('r3')).toBe(true); // the runner at 1.95 s
    expect(ids().has('p0')).toBe(false); // the main bunny joins at 3.7 s
    // whoever joined late runs in step with the others
    const t = s.time * 1000;
    expect(fakes(s).every((a) => a.playState !== 'running' || Math.abs((a.currentTime ?? 0) - t) < 1)).toBe(true);
    s.seek(5);
    expect(ids().has('p0')).toBe(true);
    s.destroy();
  });

  it('with loop it fires once and keeps restarting', async () => {
    const onEnd = vi.fn();
    const s = new WelcomeStage(host(), { reducedMotion: 'off', loop: true, onEnd });
    s.play();
    await vi.advanceTimersByTimeAsync(60000);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(s.playing).toBe(true);
    expect(s.time).toBeLessThan(15);
    s.destroy();
  });

  it('stop() rewinds to the empty start; play() again is a new run', async () => {
    const onEnd = vi.fn();
    const s = new WelcomeStage(host(), { reducedMotion: 'off', onEnd, choreography: 'peek-bottom' });
    s.play();
    await vi.advanceTimersByTimeAsync(1000);
    s.stop();
    expect(s.playing).toBe(false);
    expect(s.time).toBe(0);
    expect(fakes(s).every((a) => a.playState === 'paused' && a.currentTime === 0)).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(onEnd).not.toHaveBeenCalled();
    s.play();
    await vi.advanceTimersByTimeAsync(s.duration * 1000 + 50);
    expect(onEnd).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it('pauses while the page is hidden and resumes where it was', async () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    s.play();
    await vi.advanceTimersByTimeAsync(1000);
    setHidden(true);
    expect(fakes(s).every((a) => a.playState === 'paused')).toBe(true);
    const t = s.time;
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.time).toBe(t);
    setHidden(false);
    expect(fakes(s).some((a) => a.playState === 'running')).toBe(true);
    expect(fakes(s).every((a) => a.currentTime === t * 1000)).toBe(true);
    s.destroy();
  });
});

describe('reduced motion', () => {
  it("'force': a static composition, no animate() calls, a fade-in and onEnd once", async () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const onEnd = vi.fn();
    const s = new WelcomeStage(host(), { reducedMotion: 'force', onEnd });
    s.play();
    expect(spy).not.toHaveBeenCalled();
    expect(s.animations).toHaveLength(0);
    expect(s.actorCount).toBe(1);
    expect(s.root.querySelector('.stage')?.classList.contains('rm-in')).toBe(true);
    // the main bunny is up, paws on the bottom edge — as inline styles
    expect(s.root.querySelector<HTMLElement>('.clip .lift')?.style.transform).toBe('translate(0px, 0px)');
    // paws: the front copies (over the edge) show, the back copies (behind it) are hidden
    const front = [...s.root.querySelectorAll<SVGGElement>('.paws .grip')];
    const back = [...s.root.querySelectorAll<SVGGElement>('.clip .grip')];
    expect(front.map((g) => g.style.transform)).toEqual([
      'translate(-24px, -55.4px) rotate(0deg) scale(1, 1)',
      'translate(24px, -55.4px) rotate(0deg) scale(1, 1)',
    ]);
    expect(front.map((g) => g.style.opacity)).toEqual(['1', '1']);
    expect(back.map((g) => g.style.opacity)).toEqual(['0', '0']);
    await vi.advanceTimersByTimeAsync(600);
    expect(onEnd).toHaveBeenCalledTimes(1);
    s.play();
    s.seek(3);
    await vi.advanceTimersByTimeAsync(600);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    s.destroy();
  });

  it('switching to reduced motion mid-show settles on the static pose and ends', async () => {
    const onEnd = vi.fn();
    const s = new WelcomeStage(host(), { reducedMotion: 'off', onEnd });
    s.play();
    await vi.advanceTimersByTimeAsync(2000);
    const anims = fakes(s);
    s.setReducedMotion('force');
    expect(anims.every((a) => a.playState === 'idle')).toBe(true);
    expect(s.animations).toHaveLength(0);
    expect(s.actorCount).toBe(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    s.destroy();
  });
});

describe('limits and cleanup', () => {
  it('never builds more than 4 actors', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const steps: WelcomeStep[] = Array.from({ length: 7 }, (_, i) => ({ type: 'peek', actor: i, edge: 'bottom', at: i * 0.3, pos: (i + 1) / 8 }));
    steps.push({ type: 'run', actor: 5, at: 1 });
    const s = new WelcomeStage(host(), {
      reducedMotion: 'off',
      bunnies: ['fawn', 'choc', 'blue', 'himalayan', 'broken', 'fawn'],
      choreography: steps,
    });
    expect(s.actorCount).toBe(MAX_ACTORS);
    expect(s.root.querySelectorAll('.frame').length).toBeLessThanOrEqual(MAX_ACTORS * 3); // head + back paws + front paws
    expect(s.root.querySelectorAll('.actor').length).toBe(MAX_ACTORS);
    expect(warn).toHaveBeenCalledTimes(1);
    s.destroy();
  });

  it('destroy() cancels every animation, clears timers, disconnects observers and empties the shadow root', () => {
    class MockIO {
      static instances: MockIO[] = [];
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(public cb: IntersectionObserverCallback) {
        MockIO.instances.push(this);
      }
    }
    class MockRO {
      static instances: MockRO[] = [];
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(public cb: ResizeObserverCallback) {
        MockRO.instances.push(this);
      }
    }
    vi.stubGlobal('IntersectionObserver', MockIO);
    vi.stubGlobal('ResizeObserver', MockRO);
    const h = host();
    const s = new WelcomeStage(h, { reducedMotion: 'off' });
    s.play();
    const anims = fakes(s);
    expect(anims.length).toBeGreaterThan(20);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(MockIO.instances[0]?.observe).toHaveBeenCalledWith(h);
    expect(MockRO.instances[0]?.observe).toHaveBeenCalledWith(h);
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    s.destroy();
    expect(anims.every((a) => a.playState === 'idle')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(MockIO.instances[0]?.disconnect).toHaveBeenCalled();
    expect(MockRO.instances[0]?.disconnect).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(h.shadowRoot?.innerHTML).toBe('');
    expect(s.isDestroyed).toBe(true);
    s.play();
    s.seek(2);
    s.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a resize rebuilds the stage at the same time', () => {
    let roCallback: ResizeObserverCallback | null = null;
    class MockRO {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(cb: ResizeObserverCallback) {
        roCallback = cb;
      }
    }
    vi.stubGlobal('ResizeObserver', MockRO);
    const h = host(390, 560);
    const s = new WelcomeStage(h, { reducedMotion: 'off' });
    s.seek(3.2);
    const before = s.sample();
    const old = fakes(s);
    Object.defineProperty(h, 'clientWidth', { configurable: true, value: 600 });
    Object.defineProperty(h, 'clientHeight', { configurable: true, value: 800 });
    (roCallback as ResizeObserverCallback | null)?.([], {} as ResizeObserver);
    expect(old.every((a) => a.playState === 'idle')).toBe(true);
    expect(s.time).toBe(3.2);
    expect(fakes(s).every((a) => a.currentTime === 3200)).toBe(true);
    expect(Object.keys(s.sample())).toEqual(Object.keys(before));
    expect(s.sample()).not.toEqual(before); // new geometry
    s.destroy();
  });
});

// ---------- the round-1 review (docs/mascot/welcome-frames/round1) ----------

const num = (re: RegExp, s: string | undefined, i = 1) => Number(re.exec(s ?? '')?.[i]);
const tx = (s?: string) => num(/translate\(([-\d.e]+)px, ([-\d.e]+)px\)/, s, 1);
const ty = (s?: string) => num(/translate\(([-\d.e]+)px, ([-\d.e]+)px\)/, s, 2);
const rot = (s?: string) => num(/rotate\(([-\d.e]+)deg\)/, s);

describe('choreography (round-1 review)', () => {
  it('climbs out with its paws: both paws grip the edge before the head comes up', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off', choreography: 'peek-bottom' });
    const t0 = 0.2; // peek-bottom starts here
    const rest = ty(s.sample(t0 + 1.5)['p0.pawL']?.transform); // resting on the edge while it looks around
    expect(ty(s.sample(t0 + 0.5)['p0.pawL']?.transform)).toBeCloseTo(rest, 3); // left paw on the edge
    expect(ty(s.sample(t0 + 0.58)['p0.pawR']?.transform)).toBeCloseTo(rest, 3); // right paw on the edge
    expect(ty(s.sample(t0 + 0.58)['p0.lift']?.transform)).toBeGreaterThan(100); // the head is still down: only the ear tips show
    expect(ty(s.sample(t0 + 1.0)['p0.lift']?.transform)).toBeLessThan(0); // pulled itself up (overshoot)
    expect(s.sample(t0 + 1.25)['p0.lift']?.transform).toBe('translate(0px, 0px)'); // settled
    s.destroy();
  });

  it('ducks head first: the head is already dropping while the paws still hold the edge', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off', choreography: 'peek-bottom' });
    const d = 3.2; // peek-bottom ducks here
    const rest = ty(s.sample(d)['p0.pawL']?.transform);
    expect(ty(s.sample(d + 0.11)['p0.lift']?.transform)).toBeGreaterThan(0);
    expect(ty(s.sample(d + 0.11)['p0.pawL']?.transform)).toBeCloseTo(rest, 3);
    expect(s.sample(d + 0.3)['p0.pawLf']?.opacity).toBe('0'); // the paws are behind the edge a moment later
    expect(ty(s.sample(d + 0.3)['p0.lift']?.transform)).toBeGreaterThan(150); // gone in ≈ 0.3 s
    s.destroy();
  });

  it('ears follow through within ±14° of their resting angle (one ear physics for the whole stage)', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    // p1 (bottom left), p0 (main, incl. the greeting) and the runner; p2 sniffs (the approved lifted-ear pose)
    const parts = ['p1.earL', 'p1.earR', 'p0.earL', 'p0.earR', 'r3.earL', 'r3.earR'];
    const rest = Object.fromEntries(parts.map((k) => [k, rot(s.sample(0)[k]?.transform) || 0]));
    let worst = 0;
    for (let t = 0; t <= s.duration + 0.5; t += 0.02) {
      const f = s.sample(t);
      for (const k of parts) worst = Math.max(worst, Math.abs((rot(f[k]?.transform) || 0) - (rest[k] ?? 0)));
    }
    expect(worst).toBeGreaterThan(10); // they do swing
    expect(worst).toBeLessThanOrEqual(14.5);
    s.destroy();
  });

  it("'at:N' glances: the first bunny looks at the one behind the right edge, which climbs up looking back", () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    expect(welcomeSteps('welcome', 4).find((x) => x.actor === 1 && x.type === 'peek')).toMatchObject({ look: [['at:2', 0.75], ['viewer', 0.25], ['left', 0.1]] });
    expect(tx(s.sample(1.7)['p1.face']?.transform)).toBeGreaterThan(2); // bottom left -> looks right, at [2]
    // right edge -> looks into the stage, at [1]; turned 3/4 behind a door frame the face moves only 1.5 units (round 2)
    const side = tx(s.sample(1.9)['p2.face']?.transform);
    expect(side).toBeLessThan(-1);
    expect(side).toBeGreaterThanOrEqual(-1.5);
    s.destroy();
  });

  it('side peeks: the approved 3/4 turn into the stage, no wedge of the far ear, no contact shadow on a door frame', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off', choreography: 'peek-right' });
    s.seek(2);
    const f = s.sample();
    expect(f['p0.turn.tf']?.transform).toBe('translate(-13px, 0px) scale(0.88, 1)');
    expect(f['p0.turn.teR']?.opacity).toBe('0');
    for (let t = 0; t < s.duration; t += 0.05) expect(s.sample(t)['p0.shL']?.opacity).toBe('0');
    // a bottom peek is not turned
    const b = new WelcomeStage(host(), { reducedMotion: 'off', choreography: 'peek-bottom' });
    expect(Object.keys(b.sample(2)).some((k) => k.includes('.turn.'))).toBe(false);
    s.destroy();
    b.destroy();
  });

  it('the contact shadow of a paw is there only while the paw rests on the edge', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    expect(s.sample(4.8)['p0.shR']?.opacity).toBe('0'); // still coming up
    expect(s.sample(5.6)['p0.shR']?.opacity).toBe('1'); // on the edge
    expect(s.sample(6.5)['p0.shR']?.opacity).toBe('0'); // waving
    expect(s.sample(7.6)['p0.shR']?.opacity).toBe('1'); // back on the edge
    s.destroy();
  });

  it('greeting: the star eyes come in a blink, full size; the waving paw sticks out past the cheek', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    const g = 6.03; // the greeting starts (round 2: the main bunny comes up after the runner is gone)
    expect(s.sample(g + 0.04)['p0.star']?.opacity).toBe('0'); // the eyes are closing
    const star = s.sample(g + 0.1)['p0.star'];
    expect(star?.opacity).toBe('1');
    expect(num(/scale\(([-\d.e]+), ([-\d.e]+)\)/, star?.transform)).toBe(1); // full width at once, only the lids open
    // up at eye level beside the cheek: (80 ∓ 3, -86) on the bunny turned with its -4° lean, swinging 3 units sideways
    const lean = (x: number, y: number) => ({ x: x * Math.cos((-4 * Math.PI) / 180) - y * Math.sin((-4 * Math.PI) / 180), y: x * Math.sin((-4 * Math.PI) / 180) + y * Math.cos((-4 * Math.PI) / 180) });
    const swungIn = s.sample(g + 0.28)['p0.pawR']?.transform;
    expect(tx(swungIn)).toBeCloseTo(lean(77, -86).x, 1);
    expect(ty(swungIn)).toBeCloseTo(lean(77, -86).y, 1);
    expect(rot(swungIn)).toBeCloseTo(-20, 5);
    const swungOut = s.sample(g + 0.47)['p0.pawR']?.transform;
    expect(tx(swungOut)).toBeCloseTo(lean(83, -86).x, 1);
    expect(rot(swungOut)).toBeCloseTo(18, 5);
    s.destroy();
  });

  it('the runner hops (not glides): high hops, slowing down before the stop, faster and faster after it', () => {
    const plan = { at: 0, dir: 1 as const, x0: -100, xp: 140, x1: 490, ground: 500, speed: 1 };
    const { hops, sit, end } = runSchedule(plan, 1);
    expect(hops).toHaveLength(5);
    expect(sit?.t).toBeCloseTo(0.86, 5);
    expect(sit?.d).toBe(0.5);
    expect(end).toBeCloseTo(2.29, 5); // round 2: out a little faster (0.34 / 0.31 / 0.28 s)
    const speed = hops.map((h) => Math.abs(h.dx) / h.d);
    expect(speed[0]).toBeGreaterThan(speed[1] ?? Infinity);
    expect(speed[2]).toBeLessThan(speed[3] ?? 0);
    expect(speed[3]).toBeLessThan(speed[4] ?? 0);
    // about a third as high as it is long (the approved hop is ~1.3 : 1), 24–44 units; the steering hop is lower
    expect((hops[0]?.h ?? 0) / Math.abs(hops[0]?.dx ?? 1)).toBeGreaterThan(0.25);
    expect(hops[1]?.h).toBeCloseTo(0.6 * Math.max(24, Math.min(44, 0.3 * Math.abs(hops[1]?.dx ?? 0))), 5);
    for (const h of [hops[0], hops[2], hops[3], hops[4]]) {
      expect(h?.h).toBeGreaterThanOrEqual(24);
      expect(h?.h).toBeLessThanOrEqual(44);
    }
    // on the stage: the approved hopsquash, stronger (stretch ≈ 1.07; squash ≈ 0.91 just after touch-down, round 2)
    const s = new WelcomeStage(host(), { reducedMotion: 'off', choreography: 'run' });
    let lo = 1;
    let hi = 1;
    for (let t = 0; t < s.duration; t += 0.005) {
      const sy = num(/scale\(([-\d.e]+), ([-\d.e]+)\)/, s.sample(t)['r0.squash']?.transform, 2);
      lo = Math.min(lo, sy);
      hi = Math.max(hi, sy);
    }
    expect(lo).toBeCloseTo(0.88, 2);
    expect(hi).toBeCloseTo(1.09, 2);
    s.destroy();
  });

  it('never freezes while on stage: some part of the bunny always moves between climbing up and ducking', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    for (const [id, from, to] of [
      ['p1', 1.3, 2.4],
      ['p2', 2.1, 3.9],
    ] as const) {
      let still = 0;
      let longest = 0;
      let prev = '';
      for (let t = from; t <= to; t += 0.02) {
        const f = s.sample(t);
        const pose = Object.keys(f)
          .filter((k) => k.startsWith(`${id}.`) && /\.(face|body|earL|earR|eyes|nose|hop|squash)$/.test(k))
          .map((k) => `${f[k]?.transform}|${f[k]?.opacity}`)
          .join(';');
        still = pose === prev ? still + 0.02 : 0;
        longest = Math.max(longest, still);
        prev = pose;
      }
      expect(longest).toBeLessThan(0.5);
    }
    s.destroy();
  });

  it('draws the paws over the edge and the runners over everything', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    const layers = [...(s.root.querySelector('.stage')?.children ?? [])].map((e) => e.className);
    expect(layers).toEqual(['clip', 'layer paws', 'layer runners']);
    s.destroy();
  });

  it('edgeRadius: the edge follows the rounded top corners of the card', () => {
    const s = new WelcomeStage(host(390, 560), { reducedMotion: 'off', edgeInset: { bottom: 16 }, edgeRadius: { bottom: 30 } });
    const clip = s.root.querySelector<HTMLElement>('.clip');
    expect(clip?.style.getPropertyValue('clip-path')).toBe("path('M0 0 H390 V574 A30 30 0 0 0 360 544 H30 A30 30 0 0 0 0 574 Z')");
    // without a card (no inset) a radius changes nothing
    const flat = new WelcomeStage(host(390, 560), { reducedMotion: 'off', edgeRadius: 30 });
    expect(flat.root.querySelector<HTMLElement>('.clip')?.style.getPropertyValue('clip-path')).toBe('');
    s.destroy();
    flat.destroy();
  });

  it("autoplay: 'idle' starts once the page is idle; stop() or destroy() before that cancels it", async () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off', autoplay: 'idle' });
    expect(s.playing).toBe(false);
    await vi.advanceTimersByTimeAsync(250); // no requestIdleCallback in jsdom: a short timeout
    expect(s.playing).toBe(true);
    s.destroy();
    const stopped = new WelcomeStage(host(), { reducedMotion: 'off', autoplay: 'idle' });
    stopped.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(stopped.playing).toBe(false);
    stopped.destroy();
    const gone = new WelcomeStage(host(), { reducedMotion: 'off', autoplay: 'idle' });
    gone.destroy();
    expect(vi.getTimerCount()).toBe(0);
    // with requestIdleCallback: it waits for it (at most 600 ms)
    const ric = vi.fn((cb: () => void, _opts?: { timeout: number }) => {
      setTimeout(cb, 50);
      return 7;
    });
    const cic = vi.fn();
    vi.stubGlobal('requestIdleCallback', ric);
    vi.stubGlobal('cancelIdleCallback', cic);
    const idle = new WelcomeStage(host(), { reducedMotion: 'off', autoplay: 'idle' });
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 600 });
    await vi.advanceTimersByTimeAsync(60);
    expect(idle.playing).toBe(true);
    idle.destroy();
    const cancelled = new WelcomeStage(host(), { reducedMotion: 'off', autoplay: 'idle' });
    cancelled.destroy();
    expect(cic).toHaveBeenCalledWith(7);
  });
});

// ---------- the round-2 review (docs/mascot/welcome-frames/round2) ----------
//
// jsdom has no layout, so these tests rebuild the picture from sample(): the puppet's own outline
// (the body and lop-ear paths read from the rendered shadow DOM) pushed through the sampled
// transforms of each part — the same chain the browser applies.

/** A phone like the demo's: a 390 x 563 stage whose bottom edge is the top of a card (17 px in, 30 px corners). */
const PHONE = { W: 390, H: 563, inset: 17, radius: 30 } as const;
const EDGE_Y = PHONE.H - PHONE.inset;
const phoneGeo: StageGeo = {
  W: PHONE.W,
  H: PHONE.H,
  u0: stageUnit(PHONE.W, PHONE.H),
  inset: { bottom: PHONE.inset, top: 0, left: 0, right: 0 },
  radius: { bottom: PHONE.radius },
};
const phoneStage = (opts: WelcomeOptions = {}) =>
  new WelcomeStage(host(PHONE.W, PHONE.H), { reducedMotion: 'off', edgeInset: { bottom: PHONE.inset }, edgeRadius: { bottom: PHONE.radius }, ...opts });

interface TF {
  x: number;
  y: number;
  r: number;
  sx: number;
  sy: number;
}
function tf(s?: string): TF {
  const t = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(s ?? '');
  const r = /rotate\(([-\d.e]+)deg\)/.exec(s ?? '');
  const k = /scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(s ?? '');
  return { x: t ? Number(t[1]) : 0, y: t ? Number(t[2]) : 0, r: r ? Number(r[1]) : 0, sx: k ? Number(k[1]) : 1, sy: k ? Number(k[2]) : 1 };
}

/** Points along an absolute SVG path with M / L / C / Z (the puppet's body and lop-ear outlines). */
function pathPoints(d: string, per = 16): Vec[] {
  const tok = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: Vec[] = [];
  let i = 0;
  let cmd = 'M';
  let cur: Vec = { x: 0, y: 0 };
  let start: Vec = cur;
  const n = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/^[MLCZ]$/i.test(tok[i] ?? '')) {
      cmd = (tok[i++] ?? 'M').toUpperCase();
      if (cmd === 'Z') {
        cur = start;
        continue;
      }
    }
    if (cmd === 'M') {
      cur = { x: n(), y: n() };
      start = cur;
      out.push(cur);
      cmd = 'L';
    } else if (cmd === 'L') {
      const p = { x: n(), y: n() };
      for (let k = 1; k <= per; k++) out.push({ x: cur.x + ((p.x - cur.x) * k) / per, y: cur.y + ((p.y - cur.y) * k) / per });
      cur = p;
    } else if (cmd === 'C') {
      const a = { x: n(), y: n() };
      const b = { x: n(), y: n() };
      const p = { x: n(), y: n() };
      for (let k = 1; k <= per; k++) {
        const t = k / per;
        const m = 1 - t;
        out.push({
          x: m * m * m * cur.x + 3 * m * m * t * a.x + 3 * m * t * t * b.x + t * t * t * p.x,
          y: m * m * m * cur.y + 3 * m * m * t * a.y + 3 * m * t * t * b.y + t * t * t * p.y,
        });
      }
      cur = p;
    } else i++;
  }
  return out;
}

interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}
const boxOf = (ps: readonly Vec[]): Box => ({
  l: Math.min(...ps.map((p) => p.x)),
  r: Math.max(...ps.map((p) => p.x)),
  t: Math.min(...ps.map((p) => p.y)),
  b: Math.max(...ps.map((p) => p.y)),
});
const distToBox = (p: Vec, b: Box) => Math.hypot(Math.max(b.l - p.x, 0, p.x - b.r), Math.max(b.t - p.y, 0, p.y - b.b));
/** Point in polygon (ray casting). */
function inside(p: Vec, poly: readonly Vec[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** The bunny's outline (body + both lop ears) in bunny units, read from the rendered puppet. */
function outline(s: WelcomeStage): { body: Vec[]; earL: Vec[]; earR: Vec[] } {
  const svg = s.root.querySelector('.actor')?.shadowRoot?.querySelector('svg');
  const d = (sel: string) => svg?.querySelector(sel)?.getAttribute('d') ?? '';
  return { body: pathPoints(d('.body > .squash > .breathe > path')), earL: pathPoints(d('.lop .ear-l path')), earR: pathPoints(d('.lop .ear-r path')) };
}

/**
 * Host px of the outline of a peeking (not turned) bunny at the sampled frame `f`: each lop ear turns
 * about its pivot (80 % / 20 %, 4 % of its box), the bunny squashes and leans about the bottom centre
 * of its box (the belly reaches y = 4), bounces (hop), rides on the lift and sits in the edge frame.
 */
function peekOutline(f: Record<string, WelcomePartStyle>, id: string, place: PeekPlace, u: number, o: ReturnType<typeof outline>): Vec[] {
  const lift = tf(f[`${id}.lift`]?.transform);
  const sq = tf(f[`${id}.squash`]?.transform);
  const body = tf(f[`${id}.body`]?.transform);
  const hop = tf(f[`${id}.hop`]?.transform);
  const all = boxOf([...o.body, ...o.earL, ...o.earR]);
  const origin = { x: (all.l + all.r) / 2, y: Math.max(all.b, 4) };
  const ear = (pts: Vec[], ox: number, r: number) => {
    const b = boxOf(pts);
    const pv = { x: b.l + (b.r - b.l) * ox, y: b.t + (b.b - b.t) * 0.04 };
    return pts.map((q) => {
      const v = rotate({ x: q.x - pv.x, y: q.y - pv.y }, r);
      return { x: pv.x + v.x, y: pv.y + v.y };
    });
  };
  const pts = [...o.body, ...ear(o.earL, 0.8, tf(f[`${id}.earL`]?.transform).r), ...ear(o.earR, 0.2, tf(f[`${id}.earR`]?.transform).r)];
  return pts.map((q) => {
    const s = { x: origin.x + (q.x - origin.x) * sq.sx, y: origin.y + (q.y - origin.y) * sq.sy };
    const r = rotate({ x: s.x - origin.x, y: s.y - origin.y }, body.r);
    const h = rotate({ x: (origin.x + r.x) * u + lift.x, y: (origin.y + r.y + hop.y) * u + lift.y }, place.theta);
    return { x: place.pivot.x + h.x, y: place.pivot.y + h.y };
  });
}

/** Host px of the outline of one gripping paw of a peeker, and whether its copy over the edge shows. */
function pawOutline(f: Record<string, WelcomePartStyle>, id: string, side: 'L' | 'R', place: PeekPlace, u: number): { pts: Vec[]; front: boolean } {
  const p = tf(f[`${id}.paw${side}`]?.transform);
  const pts: Vec[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const q = rotate({ x: 13 * Math.cos(a) * p.sx, y: (-10 + 10 * Math.sin(a)) * p.sy }, p.r);
    const h = rotate({ x: (p.x + q.x) * u, y: (p.y + q.y) * u }, place.theta);
    pts.push({ x: place.pivot.x + h.x, y: place.pivot.y + h.y });
  }
  return { pts, front: f[`${id}.paw${side}f`]?.opacity === '1' };
}

/** A box around the hopping runner (moving right: tail behind, the turned face and near ear in front), shadow included. */
function runnerBox(f: Record<string, WelcomePartStyle>, id: string, u: number): Box {
  const fb = frameBox(u);
  const fr = tf(f[`${id}.frame`]?.transform);
  const x = fr.x + fb.ox + tf(f[`${id}.travel`]?.transform).x;
  const y = fr.y + fb.oy;
  return { l: x - 85 * u, r: x + 90 * u, t: y + (tf(f[`${id}.hop`]?.transform).y - 176) * u, b: y + 8 * u };
}

describe('choreography (round-2 review)', () => {
  it('1 · the main bunny comes up after the runner is gone: never closer than 12 px, its first paw ≥ 120 ms later', () => {
    for (const [bunnies, runner] of [
      [[...WELCOME_DEFAULT_BUNNIES], 'r3'],
      [['fawn', 'choc'], 'r1'],
    ] as const) {
      const s = phoneStage({ bunnies: [...bunnies] });
      const o = outline(s);
      const main = welcomeSteps('welcome', bunnies.length).find((x) => x.actor === 0);
      const at = main?.at ?? 0;
      const u = phoneGeo.u0;
      const place = placePeek({ edge: 'bottom', pos: 0.5, tilt: 0, floor: false, reveal: 0, turn: true }, u, phoneGeo);
      let wasIn = false;
      let gone = Number.NaN;
      let earTips = Number.NaN;
      let firstPaw = Number.NaN;
      let closest = Infinity;
      for (let t = at - 0.6; t <= at + 1; t += 0.005) {
        const f = s.sample(t);
        const rb = runnerBox(f, runner, u * 0.62);
        const inFrame = rb.r > 0 && rb.l < PHONE.W;
        if (inFrame) wasIn = true;
        else if (wasIn && Number.isNaN(gone)) gone = t;
        const seen = peekOutline(f, 'p0', place, u, o).filter((p) => p.y < EDGE_Y);
        if (seen.length && Number.isNaN(earTips)) earTips = t;
        for (const side of ['L', 'R'] as const) {
          const paw = pawOutline(f, 'p0', side, place, u);
          const shown = paw.front ? paw.pts : paw.pts.filter((p) => p.y < EDGE_Y);
          if (shown.length && Number.isNaN(firstPaw)) firstPaw = t;
          seen.push(...shown);
        }
        if (inFrame) for (const p of seen) closest = Math.min(closest, distToBox(p, rb));
      }
      expect(gone).toBeGreaterThan(at); // the runner is still leaving while the ear tips come up …
      expect(earTips).toBeLessThan(gone);
      expect(closest).toBeGreaterThanOrEqual(12); // … but far from them
      expect(firstPaw - gone).toBeGreaterThanOrEqual(0.12); // the paws grip a calm screen
      s.destroy();
    }
  });

  it('2 · the wind-up never hides the bunny (an ear tip stays ≥ 3 px above the edge, beside the paws); the paws press, then push off', () => {
    const s = phoneStage();
    const o = outline(s);
    const u0 = phoneGeo.u0;
    const startOf = (actor: number) => welcomeSteps('welcome', 4).find((x) => x.actor === actor && x.type === 'peek')?.at ?? 0;
    for (const c of [
      { id: 'p0', t0: startOf(0), u: u0, pos: 0.5, tilt: 0 },
      { id: 'p1', t0: startOf(1), u: u0 * 0.8, pos: 0.24, tilt: 8 },
    ]) {
      const place = placePeek({ edge: 'bottom', pos: c.pos, tilt: c.tilt, floor: false, reveal: 0, turn: true }, c.u, phoneGeo);
      const tUp = c.t0 + 0.66;
      let lowest = Infinity;
      for (let t = c.t0 + 0.56; t <= tUp + 0.05; t += 0.005) {
        const f = s.sample(t);
        // what the viewer sees of the bunny: its outline above the edge, minus what the paws (in front) cover
        const paws = (['L', 'R'] as const).map((side) => pawOutline(f, c.id, side, place, c.u)).filter((p) => p.front);
        const seen = peekOutline(f, c.id, place, c.u, o).filter((p) => p.y < EDGE_Y && !paws.some((paw) => inside(p, paw.pts)));
        lowest = Math.min(lowest, seen.length ? EDGE_Y - Math.min(...seen.map((p) => p.y)) : 0);
      }
      expect(lowest).toBeGreaterThanOrEqual(3);
      const paw = (t: number, k: 'pawL' | 'pawR') => tf(s.sample(t)[`${c.id}.${k}`]?.transform);
      for (const k of ['pawL', 'pawR'] as const) {
        expect(paw(tUp, k)).toMatchObject({ sx: 1.08, sy: 0.9 }); // pressed flat on the edge: the wind-up
        expect(paw(tUp + 0.06, k)).toMatchObject({ sx: 0.97, sy: 1.04 }); // pushing off
        expect(paw(tUp + 0.16, k)).toMatchObject({ sx: 1, sy: 1 });
      }
      // the left paw lands, bounces and presses a second time; each paw reaches up in an arc (4 units out along the edge)
      expect(paw(c.t0 + 0.58, 'pawL')).toMatchObject({ sx: 0.97, sy: 1.03 });
      const along = (t: number, k: 'pawL' | 'pawR') => place.t.x * paw(t, k).x + place.t.y * paw(t, k).y;
      expect(along(c.t0 + 0.42, 'pawL') - along(c.t0 + 0.5, 'pawL')).toBeCloseTo(-4, 3);
      expect(along(c.t0 + 0.5, 'pawR') - along(c.t0 + 0.58, 'pawR')).toBeCloseTo(4, 3);
    }
    s.destroy();
  });

  it('3 · the bunny behind the right edge sniffs in answer to the runner, and ducks well after it set off its way', () => {
    const s = phoneStage();
    const u = phoneGeo.u0;
    const ur = u * 0.62;
    const run = welcomeSteps('welcome', 4).find((x) => x.type === 'run');
    const plan = { at: run?.at ?? 0, dir: 1 as const, x0: -100 * ur, xp: 0.36 * PHONE.W, x1: PHONE.W + 100 * ur, ground: EDGE_Y - 4 * ur, speed: 1 };
    const { sit } = runSchedule(plan, ur);
    const setOff = (sit?.t ?? 0) + (sit?.d ?? 0);
    const first = (from: number, ok: (f: Record<string, WelcomePartStyle>) => boolean) => {
      for (let t = from; t < 8; t += 0.005) if (ok(s.sample(t))) return t;
      return Number.NaN;
    };
    const runnerIn = first(2, (f) => runnerBox(f, 'r3', ur).r > 0);
    const rest = rot(s.sample(2.3)['p2.earL']?.transform);
    const sniff = first(2.3, (f) => Math.abs(rot(f['p2.earL']?.transform) - rest) > 5);
    // the himalayan bunny at the bottom left is gone before that (one big move at a time)
    const o = outline(s);
    const p1 = placePeek({ edge: 'bottom', pos: 0.24, tilt: 8, floor: false, reveal: 0, turn: true }, u * 0.8, phoneGeo);
    const p1Gone = first(2.4, (f) => peekOutline(f, 'p1', p1, u * 0.8, o).every((p) => p.y >= EDGE_Y));
    const duck = first(3.5, (f) => Math.abs(tx(f['p2.lift']?.transform)) > 0.5);
    expect(sniff - runnerIn).toBeGreaterThanOrEqual(0.15);
    expect(sniff).toBeGreaterThan(p1Gone);
    expect(duck - setOff).toBeGreaterThanOrEqual(0.15);
    s.destroy();
  });

  it('4 · a resize while paused keeps every bunny that is on stage (the frame a fresh stage of that size shows)', () => {
    const callbacks: ResizeObserverCallback[] = [];
    class MockRO {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(cb: ResizeObserverCallback) {
        callbacks.push(cb);
      }
    }
    vi.stubGlobal('ResizeObserver', MockRO);
    const shown = (st: WelcomeStage) => [...st.root.querySelectorAll<HTMLElement>('.frame')].filter((f) => f.style.display !== 'none').length;
    for (const t of [2.64, 6.3]) {
      const h = host(PHONE.W, PHONE.H);
      const s = new WelcomeStage(h, { reducedMotion: 'off' });
      const resize = callbacks[callbacks.length - 1];
      s.seek(t);
      const before = shown(s);
      Object.defineProperty(h, 'clientWidth', { configurable: true, value: PHONE.W - 10 });
      resize?.([], {} as ResizeObserver);
      const fresh = new WelcomeStage(host(PHONE.W - 10, PHONE.H), { reducedMotion: 'off' });
      fresh.seek(t);
      expect(shown(s)).toBe(before);
      expect(shown(s)).toBe(shown(fresh));
      expect(s.animations.length).toBe(fresh.animations.length);
      expect(fakes(s).every((a) => a.playState === 'paused' && a.currentTime === t * 1000)).toBe(true);
      expect(s.sample()).toEqual(fresh.sample());
      s.destroy();
      fresh.destroy();
    }
  });

  it('5 · the waving paw is up at eye level beside the head, swinging sideways as well (see the greeting test)', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off' });
    const g = 6.03;
    const xs: number[] = [];
    for (let t = g + 0.28; t <= g + 1.04; t += 0.01) xs.push(tx(s.sample(t)['p0.pawR']?.transform));
    // beyond the cheek's centre (65) the whole time, its own width (≈ 6 units) of sideways swing
    expect(Math.min(...xs)).toBeGreaterThan(65);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(5.5);
    s.destroy();
  });

  it('6 · the runner\'s "oops, seen": face to you at once, held with open wide eyes; it blinks on the turn back', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off', choreography: 'run' });
    const t = 0.1 + 0.46 + 0.4; // the 'run' preset sits here
    const face = (x: number) => tx(s.sample(x)['r0.face']?.transform);
    const eyes = (x: number) => tf(s.sample(x)['r0.eyes']?.transform);
    expect(face(t + 0.12)).toBeCloseTo(-5, 3);
    for (let x = t + 0.12; x <= t + 0.36 + 1e-9; x += 0.01) {
      expect(face(x)).toBeCloseTo(-5, 3);
      expect(eyes(x).sy).toBeCloseTo(1.08, 3);
    }
    let closed = Infinity;
    for (let x = t + 0.36; x <= t + 0.44; x += 0.005) closed = Math.min(closed, eyes(x).sy);
    expect(closed).toBeLessThan(0.2);
    expect(face(t + 0.44)).toBeCloseTo(0, 3);
    expect(eyes(t + 0.44)).toMatchObject({ sx: 1, sy: 1 });
    s.destroy();
  });

  it('7 · side paws: turned around (toes into the stage), the tip 11 units inside the edge, never drawn over the edge', () => {
    for (const edge of ['right', 'left'] as const) {
      const s = new WelcomeStage(host(), { reducedMotion: 'off', choreography: edge === 'right' ? 'peek-right' : 'peek-left' });
      const geo: StageGeo = { W: 390, H: 560, u0: stageUnit(390, 560), inset: { bottom: 0, top: 0, left: 0, right: 0 } };
      const place = placePeek({ edge, pos: 0.5, tilt: FLOOR_TILT[edge], floor: true, reveal: -4.4, turn: true }, geo.u0, geo);
      const f = s.sample(2);
      for (const side of ['L', 'R'] as const) {
        const p = tf(f[`p0.paw${side}`]?.transform);
        expect(p.r).toBeCloseTo(place.pawTilt + 180, 2);
        expect(place.m.x * p.x + place.m.y * p.y - place.d).toBeCloseTo(11, 2);
      }
      for (let t = 0; t < s.duration; t += 0.02) {
        expect(s.sample(t)['p0.pawLf']?.opacity).toBe('0');
        expect(s.sample(t)['p0.pawRf']?.opacity).toBe('0');
      }
      s.destroy();
    }
  });

  it('8 · behind a door frame the face keeps still: muzzle ≥ 2.5 px inside, far eye ≥ 2 px behind the edge, ≤ 2.5 px of movement', () => {
    const s = phoneStage();
    const u = phoneGeo.u0 * 0.8;
    const step = welcomeSteps('welcome', 4).find((x) => x.actor === 2 && x.type === 'peek');
    const reveal = step?.type === 'peek' ? (step.reveal ?? 0) : 0;
    const place = placePeek({ edge: 'right', pos: 0.5, tilt: FLOOR_TILT.right, floor: true, reveal, turn: true }, u, phoneGeo);
    // the local boxes of the right muzzle pad and the far (right) eye, mapped like getBoundingClientRect does
    const corners = (cx: number, cy: number, rx: number, ry: number): Vec[] => [
      { x: cx - rx, y: cy - ry },
      { x: cx + rx, y: cy - ry },
      { x: cx - rx, y: cy + ry },
      { x: cx + rx, y: cy + ry },
    ];
    const box = (f: Record<string, WelcomePartStyle>, pts: Vec[], inEyes: boolean): Box => {
      const face = tf(f['p2.face']?.transform);
      const turn = tf(f['p2.turn.tf']?.transform);
      const eyes = tf(f['p2.eyes']?.transform);
      const sq = tf(f['p2.squash']?.transform);
      const hop = tf(f['p2.hop']?.transform);
      const lift = tf(f['p2.lift']?.transform);
      const origin = { x: -7, y: 4 }; // bottom centre of the turned bunny's box
      return boxOf(
        pts.map((q0) => {
          let q = inEyes ? { x: q0.x * eyes.sx, y: -93 + (q0.y + 93) * eyes.sy } : q0;
          q = { x: q.x + face.x, y: q.y + face.y };
          q = { x: q.x * turn.sx + turn.x, y: q.y };
          q = { x: origin.x + (q.x - origin.x) * sq.sx, y: origin.y + (q.y - origin.y) * sq.sy + hop.y };
          const h = rotate({ x: q.x * u + lift.x, y: q.y * u + lift.y }, place.theta);
          return { x: place.pivot.x + h.x, y: place.pivot.y + h.y };
        }),
      );
    };
    const at = step?.at ?? 0;
    const up = at + 0.66 + 0.28; // pulled itself up
    let padMin = Infinity;
    let padMax = -Infinity;
    let eyeMin = Infinity;
    for (let t = up; t <= 4.1; t += 0.01) {
      const f = s.sample(t);
      const pad = PHONE.W - box(f, corners(4.6, -76.6, 5.4, 4), false).r;
      padMin = Math.min(padMin, pad);
      padMax = Math.max(padMax, pad);
      eyeMin = Math.min(eyeMin, box(f, corners(29, -93, 6.2, 7.4), true).l - PHONE.W);
    }
    expect(padMin).toBeGreaterThanOrEqual(2.5);
    expect(eyeMin).toBeGreaterThanOrEqual(2);
    expect(padMax - padMin).toBeLessThanOrEqual(2.5);
    // no lean in the glances, no overshoot past the frame on the pull
    for (let t = at; t <= 4.1; t += 0.01) expect(Math.abs(rot(s.sample(t)['p2.body']?.transform) || 0)).toBe(0);
    s.destroy();
  });

  it('9 · the landing sticks: after touch-down the runner moves ≤ 2 % of the hop (≤ 3 px), the squash peaks just after', () => {
    const s = new WelcomeStage(host(), { reducedMotion: 'off', choreography: 'run' });
    const ur = stageUnit(390, 560) * 0.62;
    const { hops } = runSchedule({ at: 0.1, dir: 1, x0: -100 * ur, xp: 0.42 * 390, x1: 390 + 100 * ur, ground: 560 - 4 * ur, speed: 1 }, ur);
    const travel = (t: number) => tx(s.sample(t)['r0.travel']?.transform);
    const sy = (t: number) => num(/scale\(([-\d.e]+), ([-\d.e]+)\)/, s.sample(t)['r0.squash']?.transform, 2);
    for (const h of hops) {
      const touch = h.t + 0.7 * h.d;
      expect(ty(s.sample(touch)['r0.hop']?.transform)).toBeCloseTo(0, 3); // the feet are on the ground
      const slide = Math.abs(travel(h.t + h.d - 1e-6) - travel(touch));
      expect(slide).toBeLessThanOrEqual(Math.min(3, 0.0201 * Math.abs(h.dx)));
      expect(sy(h.t + 0.72 * h.d)).toBeLessThan(sy(touch - 0.05 * h.d)); // squashed most right after touching down
    }
    s.destroy();
  });

  it('10 · next to a rounded card corner a side bunny stands lower, behind the card; both paws stay above it, under the muzzle', () => {
    const geo = (R: number, inset = 17): StageGeo => ({ W: 390, H: 563, u0: 1.25, inset: { bottom: inset, top: 0, left: 0, right: 0 }, radius: { bottom: R } });
    for (const edge of ['right', 'left'] as const) {
      const spot = { edge, pos: 0.5, tilt: FLOOR_TILT[edge], floor: true, reveal: -4.4, turn: true };
      expect(placePeek(spot, 1, geo(0)).pivot.y).toBeCloseTo(546, 6); // square card: on the line
      expect(placePeek(spot, 1, geo(30)).drop).toBeCloseTo(20, 6); // capped at 20 units (here 1 px each)
      expect(placePeek(spot, 1, geo(30)).pivot.y).toBeCloseTo(566, 6);
      expect(placePeek(spot, 2, geo(30)).drop).toBeCloseTo(30, 6); // capped at 30 px
      expect(placePeek(spot, 1, geo(14)).drop).toBeCloseTo(14, 6); // the corner's own radius
      expect(placePeek(spot, 1, geo(30, 0)).drop).toBe(0); // no card under the stage
      for (const [R, u] of [
        [30, 1],
        [30, 0.5],
        [14, 0.47],
        [0, 1],
      ] as const) {
        const p = placePeek(spot, u, geo(R));
        for (const k of [p.kL, p.kR]) {
          const tip = { x: p.A.x + p.t.x * k + p.m.x * 11, y: p.A.y + p.t.y * k + p.m.y * 11 };
          const height = -rotate(tip, p.theta).y; // bunny units above the feet; the paw is 26 units wide
          expect(height - 13).toBeGreaterThanOrEqual(p.drop / u - 1e-6);
          expect(height + 13).toBeLessThanOrEqual(69);
        }
      }
    }
  });
});

describe('<bunprise-welcome>', () => {
  it('is not registered on import (tree-shakable), defineWelcomeElement() registers it', () => {
    expect(customElements.get(WELCOME_TAG)).toBeUndefined();
    defineWelcomeElement();
    defineWelcomeElement(); // safe twice
    expect(customElements.get(WELCOME_TAG)).toBe(BunpriseWelcomeElement);
  });

  it('wraps a WelcomeStage', () => {
    defineWelcomeElement();
    expect(customElements.get(WELCOME_TAG)).toBe(BunpriseWelcomeElement);
    const el = document.createElement(WELCOME_TAG) as BunpriseWelcomeElement;
    el.setAttribute('choreography', 'peek-once');
    el.setAttribute('autoplay', 'false');
    el.setAttribute('reduced-motion', 'off');
    el.setAttribute('bunnies', 'choc, nope, blue');
    document.body.append(el);
    const stage = el.stage;
    expect(stage).toBeInstanceOf(WelcomeStage);
    expect(stage?.actorCount).toBe(1);
    expect(stage?.playing).toBe(false);
    el.play();
    expect(stage?.playing).toBe(true);
    el.setAttribute('choreography', 'welcome');
    expect(stage?.isDestroyed).toBe(true);
    expect(el.stage?.actorCount).toBe(2); // two valid coats -> the 2-bunny show
    const second = el.stage;
    el.remove();
    expect(el.stage).toBeNull();
    expect(second?.isDestroyed).toBe(true);
  });

  it('reads edge-inset like a CSS margin', () => {
    expect(parseInset('16')).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
    expect(parseInset('0 0 16 0')).toEqual({ top: 0, right: 0, bottom: 16, left: 0 });
    expect(parseInset('0 12')).toEqual({ top: 0, right: 12, bottom: 0, left: 12 });
    expect(parseInset(null)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(parseInset('-5 x')).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('autoplays by default', () => {
    defineWelcomeElement();
    document.body.innerHTML = `<${WELCOME_TAG} reduced-motion="off"></${WELCOME_TAG}>`;
    const el = document.querySelector(WELCOME_TAG) as BunpriseWelcomeElement;
    expect(el.stage?.playing).toBe(true);
    expect(el.stage?.actorCount).toBe(4);
  });

  it('autoplay="idle" waits for an idle moment; edge-radius reaches the stage', async () => {
    defineWelcomeElement();
    document.body.innerHTML = `<${WELCOME_TAG} reduced-motion="off" autoplay="idle" edge-inset="0 0 16 0" edge-radius="0 0 30 0"></${WELCOME_TAG}>`;
    const el = document.querySelector(WELCOME_TAG) as BunpriseWelcomeElement;
    expect(el.stage?.playing).toBe(false);
    expect(el.stage?.root.querySelector<HTMLElement>('.clip')?.style.getPropertyValue('clip-path')).toContain('A30 30');
    await vi.advanceTimersByTimeAsync(250);
    expect(el.stage?.playing).toBe(true);
  });
});
