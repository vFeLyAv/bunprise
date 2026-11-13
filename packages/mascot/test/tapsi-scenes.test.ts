import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hamster, HAMSTER_SCENES } from '../src/index';
import { authorSecret, authorSpeck, PSST, RESERVE, startScene, TapsiParts, type LoopPose } from '../src/tapsi-moments';
import { Track } from '../src/timeline';
import type { FakeAnimation } from './setup';

// The approved Tapsi moments in the puppet (27.10, Felix 26.10: «Psst … оставляем», «Пылинка … нравится"):
// hamster scenes 'secret' (the reservation moment with the «Psst» ending) and 'speck' (binoculars only).

function host(): HTMLDivElement {
  const d = document.createElement('div');
  document.body.append(d);
  return d;
}

const svgOf = (h: Hamster) => h.root.querySelector('svg')!;
const hmOf = (h: Hamster) => h.root.querySelector<SVGGElement>('.hm')!;
const anims = (h: Hamster) => svgOf(h).getAnimations({ subtree: true }) as unknown as FakeAnimation[];

/** The scene's tracks authored on a puppet without starting anything (to sample frames). */
function authored(h: Hamster, which: 'secret' | 'speck', from?: LoopPose): { tracks: Track[]; duration: number; marks: Record<string, number> } {
  const tracks: Track[] = [];
  const svg = svgOf(h);
  const parts = new TapsiParts({
    query: (sel) => [...svg.querySelectorAll(sel)],
    track: (els, base, name) => {
      const t = new Track(els, name, base);
      tracks.push(t);
      return t;
    },
    add: (markup, parent) => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = markup;
      svg.querySelector(parent)?.append(g);
      return g.firstElementChild ?? g;
    },
  });
  const res = which === 'secret' ? authorSecret(parts) : authorSpeck(parts, from);
  return { tracks, ...res };
}

const at = (tracks: Track[], name: string, t: number) => tracks.find((x) => x.name === `tapsi.${name}`)?.sample(t);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the scene list', () => {
  it("the hamster plays 'secret' and 'speck' (approved 26.10), the old scenes stay", () => {
    expect(HAMSTER_SCENES).toEqual(expect.arrayContaining(['greet', 'eat', 'walk', 'jump', 'sleep', 'angry', 'secret', 'speck', 'idle']));
  });
});

describe("'secret' — the reservation moment with the «Psst» ending", () => {
  it('runs one timeline (only transform / opacity, finite) in the driven mode, ≈ 5.65 s, then lets go cleanly', async () => {
    const h = new Hamster(host(), { idle: false, reducedMotion: 'off' });
    const events: string[] = [];
    h.host.addEventListener('mascot-scene-start', (e) => events.push(`start:${(e as CustomEvent).detail.scene}`));
    h.host.addEventListener('mascot-scene-end', (e) => events.push(`end:${(e as CustomEvent).detail.scene}`));
    let done = false;
    const p = h.play('secret').then(() => (done = true));
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(10);
    expect(h.busy).toBe(true);
    expect(hmOf(h).classList.contains('driven')).toBe(true);
    const list = anims(h);
    expect(list.length).toBeGreaterThan(20);
    for (const a of list) {
      const timing = a.effect.getTiming();
      expect(Number.isFinite(Number(timing.iterations ?? 1))).toBe(true);
      for (const k of a.effect.getKeyframes()) {
        const props = Object.keys(k).filter((key) => !['offset', 'easing', 'composite', 'computedOffset'].includes(key));
        expect(props.every((key) => key === 'transform' || key === 'opacity')).toBe(true);
      }
    }
    await vi.advanceTimersByTimeAsync(5500);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    await p;
    expect(events).toEqual(['start:secret', 'end:secret']);
    expect(h.busy).toBe(false);
    expect(hmOf(h).classList.contains('driven')).toBe(false);
    expect(anims(h)).toHaveLength(0);
    // nothing the scene wrote stays inline; the crumbs are gone; full cheeks (CSS), normal eyes
    for (const sel of ['.paws', '.paw-l', '.paw-r', '.tf', '.te', '.body', '.cheek', '.eyes', '.eyes-happy', '.cookie', '.wiggle']) {
      for (const el of h.root.querySelectorAll<SVGElement>(sel)) {
        expect(el.style.transform, sel).toBe('');
        expect(el.style.opacity, sel).toBe('');
      }
    }
    expect(h.root.querySelector('.fx')?.childElementCount).toBe(0);
    expect(h.eyes).toBe('normal');
    expect(hmOf(h).style.getPropertyValue('--puff')).toBe('1.35');
    await vi.advanceTimersByTimeAsync(1800);
    expect(hmOf(h).style.getPropertyValue('--puff')).toBe('1');
    h.destroy();
  });

  it('frame by frame: jump, the star, nine bites — then both paws over his mouth, ^ ^, a head tilt, full cheeks; the star eyes of the old ending are gone', () => {
    const h = new Hamster(host(), { idle: false, reducedMotion: 'off' });
    const { tracks, duration, marks } = authored(h, 'secret');
    expect(duration).toBeCloseTo(5.65, 2);
    expect(duration - (RESERVE.swallowed + 0.32 + 0.9)).toBeLessThanOrEqual(0.6);
    const sealed = (marks['tilted'] ?? 0) + 0.1;
    expect(at(tracks, 'paws', sealed)?.y).toBeCloseTo(PSST.paws.y, 3);
    expect(at(tracks, 'pawL', sealed)).toMatchObject(PSST.pawL);
    expect(at(tracks, 'pawR', sealed)).toMatchObject(PSST.pawR);
    expect(at(tracks, 'tf', sealed)?.r).toBeCloseTo(PSST.tf.r, 3);
    expect(at(tracks, 'te', sealed)?.r).toBeCloseTo(PSST.te.r, 3);
    expect(at(tracks, 'happy', sealed)?.o).toBe(1);
    expect(at(tracks, 'stars', sealed)?.o).toBe(0);
    expect(at(tracks, 'puff', sealed)?.sx).toBeGreaterThan(1.3);
    // never star eyes after the swallow
    for (let t = RESERVE.swallowed + 0.01; t <= duration; t += 0.05) expect(at(tracks, 'stars', t)?.o).toBe(0);
    // the end is the rest pose (the eyes open again), nothing moves after it
    for (const name of ['paws', 'pawL', 'pawR', 'tf', 'te', 'body', 'nod']) {
      const end = at(tracks, name, duration)!;
      for (const [k, v] of Object.entries(end)) expect(v, `${name}.${k}`).toBeCloseTo(k === 'sx' || k === 'sy' ? 1 : 0, 3);
    }
    expect(at(tracks, 'round', duration)?.o).toBe(1);
    for (const t of tracks) if (!t.name.startsWith('tapsi.crumb')) expect(t.end, t.name).toBeLessThanOrEqual(duration + 1e-9);
    // two distinct paws over the mouth, never four (the binocular paws are not part of this scene)
    expect(tracks.some((t) => t.name === 'tapsi.binoPaw')).toBe(false);
    h.destroy();
  });

  it('the same frame every time (no Math.random): two builds sample identically', () => {
    const a = authored(new Hamster(host(), { idle: false, reducedMotion: 'off' }), 'secret');
    const b = authored(new Hamster(host(), { idle: false, reducedMotion: 'off' }), 'secret');
    for (const t of [0.4, 1.9, 2.6, 4.2, 4.6, 5.2]) {
      expect(a.tracks.map((x) => x.styleAt(t))).toEqual(b.tracks.map((x) => x.styleAt(t)));
    }
  });

  it('reduced motion: the still «Psst» pose (paws at the mouth, ^ ^, tilt, full cheeks) — not a single animate() call, and it stays', async () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const h = new Hamster(host(), { idle: false, reducedMotion: 'force' });
    await h.play('secret');
    await vi.advanceTimersByTimeAsync(5000);
    expect(spy).not.toHaveBeenCalled();
    expect(h.eyes).toBe('happy');
    expect(hmOf(h).style.getPropertyValue('--puff')).toBe('1.35');
    expect(h.root.querySelector<SVGElement>('.paws')?.style.transform).toBe('translateY(-30px)');
    expect(h.root.querySelector<SVGElement>('.paw-l')?.style.transform).toContain('rotate(20deg)');
    expect(h.root.querySelector<SVGElement>('.paw-r')?.style.transform).toContain('rotate(-36deg)');
    expect(h.root.querySelector<SVGElement>('.tf')?.style.transform).toBe('rotate(-8deg)');
    // pose() of anything else undoes it completely
    h.pose('idle');
    for (const sel of ['.paws', '.paw-l', '.paw-r', '.tf', '.te', '.body']) expect(h.root.querySelector<SVGElement>(sel)?.style.transform, sel).toBe('');
    h.destroy();
  });

  it('pauses while the tab is hidden and goes on from the same frame; interrupt() ends it at once without leftovers', async () => {
    const h = new Hamster(host(), { idle: false, reducedMotion: 'off' });
    let done = false;
    void h.play('secret').then(() => (done = true));
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(1000);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const list = anims(h);
    const times = list.map((a) => a.currentTime);
    await vi.advanceTimersByTimeAsync(10000);
    expect(done).toBe(false);
    expect(list.map((a) => a.currentTime)).toEqual(times);
    expect(list.some((a) => a.playState === 'running')).toBe(false);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toBe(false);
    await h.interrupt();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(h.busy).toBe(false);
    expect(anims(h)).toHaveLength(0);
    expect(hmOf(h).classList.contains('driven')).toBe(false);
    for (const sel of ['.paws', '.paw-l', '.tf', '.body', '.cookie']) expect(h.root.querySelector<SVGElement>(sel)?.style.transform, sel).toBe('');
    expect(h.root.querySelector('.fx')?.childElementCount).toBe(0);
    h.destroy();
  });

  it('destroy() mid-scene leaves nothing running', async () => {
    const h = new Hamster(host(), { idle: false, reducedMotion: 'off' });
    const p = h.play('secret');
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(800);
    const list = anims(h);
    expect(list.length).toBeGreaterThan(0);
    h.destroy();
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(list.every((a) => a.playState === 'idle')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("'speck' — «Пылинка на линзе» (binoculars only)", () => {
  it('without the binoculars or under reduced motion nothing moves', async () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const plain = new Hamster(host(), { idle: false, reducedMotion: 'off' });
    await plain.play('speck');
    const calm = new Hamster(host(), { idle: false, reducedMotion: 'force', holding: 'binoculars', calmEyes: 'happy' });
    await calm.play('speck');
    await vi.advanceTimersByTimeAsync(2000);
    expect(spy).not.toHaveBeenCalled();
    // Weniger: the binoculars rest lowered (CSS of the reduced puppet), the calm eyes show
    const css = calm.root.querySelector('style')?.textContent ?? '';
    expect(css).toContain('.rm .hold-binoculars .bino { transform: translate(0px, 36px) scale(.97); }');
    expect(calm.eyes).toBe('normal');
    expect(hmOf(calm).classList.contains('m-happy')).toBe(true);
    plain.destroy();
    calm.destroy();
  });

  it('1.6 s: the binoculars come down, the speck shows and is swept off by ONE paw on the binoculars (never four paws), the glint crosses, up again', async () => {
    const h = new Hamster(host(), { idle: false, reducedMotion: 'off', holding: 'binoculars' });
    const { tracks, duration, marks } = authored(h, 'speck');
    expect(duration).toBe(1.6);
    expect(at(tracks, 'bino', marks['down']!)).toMatchObject({ y: 36 });
    expect(at(tracks, 'speck', marks['sweep']!)?.o).toBe(1);
    expect(at(tracks, 'speck', 1.2)?.o).toBe(0);
    expect(at(tracks, 'binoPaw', marks['sweep']!)?.x).toBeLessThan(-20);
    expect(at(tracks, 'glint', marks['clean']! + 0.3)?.x).toBe(132);
    expect(at(tracks, 'bino', duration)).toMatchObject({ x: 0, y: 0, r: 0, sx: 1, sy: 1 });
    // the resting paws are never driven; only the right binocular paw moves
    expect(tracks.some((t) => ['tapsi.paws', 'tapsi.pawL', 'tapsi.pawR'].includes(t.name))).toBe(false);
    expect(tracks.find((t) => t.name === 'tapsi.binoPaw')?.els).toHaveLength(1);
    h.destroy();
  });

  it('a tap mid look-around starts from where the loop is and glides back to the middle (no jump)', () => {
    const h = new Hamster(host(), { idle: false, reducedMotion: 'off', holding: 'binoculars' });
    const from: LoopPose = { bino: { x: -10, y: 0.5, r: -5, sx: 0.95, sy: 1 }, tf: -6, te: -3, lean: -2, eye: 1, glint: 0 };
    const { tracks } = authored(h, 'speck', from);
    expect(at(tracks, 'bino', 0)).toMatchObject(from.bino);
    expect(at(tracks, 'tf', 0)?.x).toBe(-6);
    expect(at(tracks, 'lean', 0)?.r).toBe(-2);
    expect(at(tracks, 'tf', 0.3)?.x).toBeCloseTo(0, 6);
    expect(at(tracks, 'te', 0.3)?.x).toBeCloseTo(0, 6);
    expect(at(tracks, 'lean', 0.3)?.r).toBeCloseTo(0, 6);
    expect(at(tracks, 'bino', 0.32)).toMatchObject({ x: 0, y: 36, r: 0 });
    h.destroy();
  });

  it('plays through the puppet: busy for 1.6 s, then the loop takes over again (no driven mode, no inline styles)', async () => {
    const h = new Hamster(host(), { idle: true, reducedMotion: 'off', holding: 'binoculars' });
    let done = false;
    void h.play('speck').then(() => (done = true));
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(20);
    expect(hmOf(h).classList.contains('driven')).toBe(true);
    expect(h.root.querySelector<SVGElement>('.bino-speck')?.style.opacity).not.toBe('');
    await vi.advanceTimersByTimeAsync(1700);
    expect(done).toBe(true);
    expect(hmOf(h).classList.contains('driven')).toBe(false);
    for (const sel of ['.bino', '.bino-paw', '.bino-speck', '.bino-glint', '.tf', '.te', '.wiggle']) {
      for (const el of h.root.querySelectorAll<SVGElement>(sel)) expect(el.style.transform, sel).toBe('');
    }
    expect(h.holding).toBe('binoculars');
    h.destroy();
  });
});

describe('startScene (the runner the puppet uses)', () => {
  it('writes the start values inline, starts every animation together and removes everything on cleanup', () => {
    const h = new Hamster(host(), { idle: false, reducedMotion: 'off' });
    const run = startScene(svgOf(h), 'secret');
    expect(run.clock).not.toBeNull();
    expect(run.duration).toBeCloseTo(5.65, 2);
    expect(anims(h).every((a) => a.playState === 'running')).toBe(true);
    run.cleanup();
    expect(anims(h)).toHaveLength(0);
    expect(h.root.querySelector<SVGElement>('.cheek')?.style.transform).toBe('');
    expect(h.root.querySelector('.fx')?.childElementCount).toBe(0);
    h.destroy();
  });
});
