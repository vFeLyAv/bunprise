import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Bunny,
  BUNNY_SCENES,
  CarryStage,
  ChaseStage,
  Hamster,
  HAMSTER_SCENES,
  HamsterEdgeStage,
  NibbleStage,
  OverfedStage,
  WELCOME_PRESETS,
  WelcomeStage,
  type CarryItem,
  type WelcomeOptions,
} from '../src/index';
import { OVERFED_VARIANTS } from '../src/overfed';
import { Track } from '../src/timeline';

// 24.10.2026: no Web Animation of the package may have two keyframes at one offset. An instant change used to be
// written as two keys at one time (Track.set); Firefox computes such an animation correctly but its compositor
// sometimes did not PAINT it while later animations of the same part were pending (round eyes under ^ ^ in
// «Переел» c, a blink that never showed). Every instant change is now a 1 ms ramp (timeline.ts STEP).

/** Every animate() call while a stage is built and played: where, what it was named, its keyframes. */
interface Made {
  frames: Keyframe[];
  anim: Animation;
}
let made: Made[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  made = [];
  const original = Element.prototype.animate;
  vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, frames, options) {
    const anim = original.call(this, frames, options);
    made.push({ frames: Array.isArray(frames) ? (frames as Keyframe[]) : [], anim });
    return anim;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function host(w = 390, h = 560): HTMLDivElement {
  const d = document.createElement('div');
  Object.defineProperty(d, 'clientWidth', { configurable: true, value: w });
  Object.defineProperty(d, 'clientHeight', { configurable: true, value: h });
  document.body.append(d);
  return d;
}

/** Computed keyframe offsets (Web Animations: a missing first = 0, last = 1, the rest evenly between). */
export function computedOffsets(frames: readonly Keyframe[]): number[] {
  const out = frames.map((f) => (typeof f.offset === 'number' ? f.offset : null));
  if (out.length === 1 && out[0] === null) out[0] = 1;
  if (out.length > 1 && out[0] === null) out[0] = 0;
  if (out.length > 1 && out[out.length - 1] === null) out[out.length - 1] = 1;
  for (let i = 1; i < out.length; i++) {
    if (out[i] !== null) continue;
    let j = i;
    while (out[j] === null) j++;
    const a = out[i - 1] ?? 0;
    const b = out[j] ?? 1;
    for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  return out.map((v) => v ?? 0);
}

/** "<label>: <animation id> at offset <o>" for every animation made since the last call with a repeated offset. */
function duplicates(label: string): string[] {
  const bad: string[] = [];
  for (const { frames, anim } of made) {
    const o = computedOffsets(frames);
    for (let i = 1; i < o.length; i++) {
      if ((o[i] ?? 0) <= (o[i - 1] ?? 0)) {
        bad.push(`${label}: ${anim.id || '(no id)'} has two keyframes at offset ${o[i]}`);
        break;
      }
    }
  }
  made = [];
  return bad;
}

interface Playable {
  play(): void;
  destroy(): void;
  readonly duration: number;
}

/** Builds, plays to the end (+ `extra` s for loops) and destroys a stage; returns what repeated an offset. */
async function run(label: string, make: () => Playable, extra = 0.5): Promise<string[]> {
  const s = make();
  s.play();
  await vi.advanceTimersByTimeAsync((s.duration + extra) * 1000);
  s.destroy();
  return duplicates(label);
}

const BOXES = { from: { left: 24, top: 145, width: 44, height: 44 }, to: { left: 180, top: 115, width: 80, height: 45 } };

describe('no animation has two keyframes at one offset (Firefox did not paint such runs, 24.10)', () => {
  it('Track.set is a 1 ms ramp ending at its time; more changes at that moment join it', () => {
    const el = document.createElement('div');
    const t = new Track(el, 'probe', { o: 1 });
    t.set(1, { o: 0 });
    t.set(1, { x: 4 });
    t.move(0.9, 1, { x: 8 }); // a move whose time is already over is an instant change too
    // the switch is complete AT its time, as before (one ramp to the last value, no flicker through x = 4)
    expect(t.styleAt(1)).toEqual({ transform: 'translate(8px, 0px)', opacity: '0' });
    expect(t.styleAt(0.9995)).toEqual({ transform: 'translate(4px, 0px)', opacity: '0.5' });
    expect(t.styleAt(0.998)).toEqual({ transform: 'translate(0px, 0px)', opacity: '1' });
    expect(t.keyCount).toBe(2);
    // a switch right after a move that ends at the same time: 1 ms later; a switch "in the past": after the end
    t.move(1.2, 2, { x: 0 }).set(2, { o: 1 }).set(1.5, { x: 3 });
    expect(t.styleAt(2)).toEqual({ transform: 'translate(0px, 0px)', opacity: '0' });
    expect(t.styleAt(2.001)).toEqual({ transform: 'translate(3px, 0px)', opacity: '1' });
    const [c] = t.compile();
    const offsets = computedOffsets(c?.frames ?? []);
    for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeGreaterThan(offsets[i - 1] ?? 0);
    // a set at the very start (t = 0) is still the value at 0: its ramp starts 1 ms before the show
    const z = new Track(el, 'zero', { o: 0 });
    z.set(0, { o: 1 }).hold(1);
    expect(z.styleAt(0).opacity).toBe('1');
    const [zc] = z.compile();
    expect(zc?.timing).toMatchObject({ delay: -1, duration: 1 });
    expect(zc?.frames.map((f) => [f.offset, f.opacity])).toEqual([[0, '0'], [1, '1']]);
  });

  it('every welcome preset (full stage, gallery tile, app card, loop)', async () => {
    const bad: string[] = [];
    const variants: Array<[string, () => [number, number, WelcomeOptions]]> = [
      ['phone', () => [390, 560, { edgeInset: { bottom: 16 }, edgeRadius: { bottom: 22 } }]],
      ['gallery', () => [300, 210, { bunnies: ['fawn', 'choc'], minSize: 125, maxSize: 148, calmEyes: 'happy' }]],
      ['card', () => [358, 180, { edgeInset: { bottom: 12 } }]],
      ['loop', () => [390, 560, { loop: true }]],
    ];
    for (const choreography of WELCOME_PRESETS) {
      for (const [name, opts] of variants) {
        const [w, h, o] = opts();
        bad.push(...(await run(`welcome ${choreography} (${name})`, () => new WelcomeStage(host(w, h), { ...o, choreography, reducedMotion: 'off' }), o.loop ? 4 : 0.5)));
      }
    }
    bad.push(...(await run('welcome peek-sniff + calendar', () => new WelcomeStage(host(300, 210), { choreography: 'peek-sniff', item: 'calendar', reducedMotion: 'off' }))));
    expect(bad).toEqual([]);
  }, 20_000); // exhaustive: every preset × 4 places; under a full parallel run it needs more than the 5 s default

  it('carry (every item, onto a target and off each edge), chase, nibble, hamster edge', async () => {
    const bad: string[] = [];
    for (const item of ['card', 'gift', 'letter', 'none'] as CarryItem[]) {
      for (const away of [undefined, 'left', 'right'] as const) {
        bad.push(...(await run(`carry ${item} ${away ?? 'onto'}`, () => new CarryStage(host(390, 300), { ...BOXES, item, ...(away ? { away } : {}), reducedMotion: 'off' }))));
      }
    }
    for (const from of ['left', 'right'] as const) {
      for (const loop of [false, true]) bad.push(...(await run(`chase ${from}${loop ? ' loop' : ''}`, () => new ChaseStage(host(390, 210), { from, loop, reducedMotion: 'off' }), loop ? 6 : 0.5)));
    }
    for (const corner of ['left', 'right'] as const) {
      bad.push(...(await run(`nibble ${corner}`, () => new NibbleStage(host(390, 210), { target: { left: 50, top: 115, width: 295, height: 85 }, corner, reducedMotion: 'off' }))));
    }
    for (const edge of ['bottom', 'left', 'right'] as const) {
      for (const stay of [false, true]) {
        bad.push(...(await run(`hamster edge ${edge}${stay ? ' stay' : ''}`, () => new HamsterEdgeStage(host(390, 210), { edge, stay, illustration: true, cheeks: 1.35, reducedMotion: 'off' }))));
      }
    }
    expect(bad).toEqual([]);
  });

  it('overfed a / b / c (illustration and decoration)', async () => {
    const bad: string[] = [];
    for (const variant of OVERFED_VARIANTS) {
      for (const illustration of [true, false]) {
        bad.push(...(await run(`overfed ${variant}${illustration ? '' : ' deco'}`, () => new OverfedStage(host(358, 150), { variant, illustration, reducedMotion: 'off' }), 4)));
      }
    }
    expect(bad).toEqual([]);
  });

  it('the puppet scenes of the bunny (both ear styles) and the hamster (also holding binoculars), taps and hops', async () => {
    const bad: string[] = [];
    const puppets: Array<[string, () => Bunny | Hamster]> = [
      ['bunny lop', () => new Bunny(host(), { idle: true, reducedMotion: 'off' })],
      ['bunny upright', () => new Bunny(host(), { ears: 'upright', idle: true, reducedMotion: 'off' })],
      ['hamster', () => new Hamster(host(), { idle: true, reducedMotion: 'off' })],
      ['hamster binoculars', () => new Hamster(host(), { idle: true, reducedMotion: 'off', holding: 'binoculars' })],
    ];
    for (const [name, make] of puppets) {
      const m = make();
      const scenes: readonly string[] = m instanceof Bunny ? BUNNY_SCENES : HAMSTER_SCENES;
      for (const scene of scenes) {
        const p = (m as unknown as { play(s: string): Promise<void> }).play(scene);
        // 'secret' / 'speck' load their timeline module lazily (tapsi-moments.ts) before they start
        await vi.dynamicImportSettled();
        await vi.advanceTimersByTimeAsync(6000);
        await p;
        bad.push(...duplicates(`${name} ${scene}`));
      }
      const hop = m.hop();
      await vi.advanceTimersByTimeAsync(2000);
      await hop;
      for (let i = 0; i < 5; i++) void m.tap();
      await vi.advanceTimersByTimeAsync(12000);
      bad.push(...duplicates(`${name} hop / taps / idle`));
      m.destroy();
    }
    expect(bad).toEqual([]);
  });
});
