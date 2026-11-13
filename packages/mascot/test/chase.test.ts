import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChaseStage } from '../src/index';
import { EAR_MAX_DEG, EAR_ROOT, NEAR_EAR_OUT_MAX } from '../src/chase';
import type { FakeAnimation } from './setup';

function host(width = 390, height = 210) {
  const el = document.createElement('div');
  Object.defineProperties(el, { clientWidth: { value: width }, clientHeight: { value: height } });
  document.body.append(el);
  return el;
}
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const num = (s: string | undefined, re: RegExp): number => Number(re.exec(s ?? '')?.[1] ?? 0);
const rotate = (s: string | undefined) => num(s, /rotate\((-?[\d.]+)deg\)/);
const ty = (s: string | undefined) => num(s, /translate\([-\d.]+px, (-?[\d.]+)px\)/);
/** The two puppets: the one that runs after the celery and the one that comes back with it. */
function puppets(stage: ChaseStage) {
  const svgs = [...stage.root.querySelectorAll('.actor')].map((a) => a.shadowRoot?.querySelector('svg'));
  expect(svgs).toHaveLength(2);
  return svgs as SVGSVGElement[];
}
const times = (end: number, step = 0.005) => Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);

describe('ChaseStage ears (Felix 23.10: «кривая анимация ушей … нелепо»)', () => {
  for (const from of ['left', 'right'] as const) {
    it(`uses only the app bunny's lop ears, turned rigidly about their attachment (from ${from})`, () => {
      const stage = new ChaseStage(host(), { reducedMotion: 'off', from });
      for (const svg of puppets(stage)) {
        // the pivot is the line where the ear meets the head (the approved surprise rig), not a point off the base
        expect((svg.querySelector('.lop .ear-l') as SVGElement).style.transformOrigin).toBe(EAR_ROOT.l);
        expect((svg.querySelector('.lop .ear-r') as SVGElement).style.transformOrigin).toBe(EAR_ROOT.r);
        // the ear paths are the puppet's own (no inline geometry), the tall "surprise" ears never animate
        for (const path of svg.querySelectorAll('.lop path')) expect((path as SVGElement).style.getPropertyValue('d')).toBe('');
      }
      const tall = new Set(puppets(stage).flatMap((svg) => [...svg.querySelectorAll('.tall, .tall *')]));
      for (const a of stage.animations as unknown as FakeAnimation[]) expect(tall.has(a.effect.target)).toBe(false);
      for (const t of times(stage.duration, 0.02)) {
        const s = stage.sample(t);
        for (const name of ['bunny.ear-l', 'bunny.ear-r', 'back.ear-l', 'back.ear-r']) {
          const ear = s[name];
          // only a rotation: no stretching, no sliding, never hidden or cross-faded
          expect(ear?.transform).toMatch(/^rotate\(-?[\d.]+deg\)$/);
          expect(ear?.opacity).toBeUndefined();
        }
      }
      stage.destroy();
    });

    it(`keeps every ear turn small and never opens a gap at the near ear (from ${from})`, () => {
      const stage = new ChaseStage(host(), { reducedMotion: 'off', from });
      const [runner, back] = puppets(stage);
      // the near ear of the 3/4 turn is on the side the bunny looks to; outward = away from the face
      const near = (svg: SVGSVGElement | undefined) => (svg?.querySelector('.hm')?.classList.contains('turn-r') ? 'r' : 'l');
      expect(near(runner)).toBe(from === 'left' ? 'r' : 'l');
      expect(near(back)).toBe(from === 'left' ? 'l' : 'r');
      let maxAbs = 0;
      for (const t of times(stage.duration)) {
        const s = stage.sample(t);
        for (const [who, svg] of [['bunny', runner], ['back', back]] as const) {
          for (const side of ['l', 'r'] as const) {
            const r = rotate(s[`${who}.ear-${side}`]?.transform);
            maxAbs = Math.max(maxAbs, Math.abs(r));
            expect(Math.abs(r)).toBeLessThanOrEqual(EAR_MAX_DEG);
            // + rotate (clockwise) swings a hanging left ear out, a right ear in
            if (side === near(svg)) expect(side === 'l' ? r : -r).toBeLessThanOrEqual(NEAR_EAR_OUT_MAX + 0.05);
          }
        }
      }
      // ...and they do move (secondary motion, not frozen)
      expect(maxAbs).toBeGreaterThan(4);
      stage.destroy();
    });
  }

  it('lets the ears follow the head with a small lag in every hop of the chase', () => {
    const stage = new ChaseStage(host(), { reducedMotion: 'off' });
    const step = 0.002;
    const ts = times(stage.duration, step);
    const hop = ts.map((t) => ty(stage.sample(t)['bunny.hop']?.transform));
    const ear = ts.map((t) => rotate(stage.sample(t)['bunny.ear-r']?.transform));
    // tops of the big chase hops (≥ 30 units up)
    const apexes = ts.map((_, i) => i).filter((i) => (hop[i] ?? 0) < -30 && (hop[i] ?? 0) <= (hop[i - 1] ?? 0) && (hop[i] ?? 0) < (hop[i + 1] ?? 0));
    expect(apexes.length).toBeGreaterThanOrEqual(3);
    for (const i of apexes) {
      // the near (right) ear streams back (+ = clockwise when he looks right): its peak comes after the top
      const window = ts.map((_, j) => j).filter((j) => Math.abs(j - i) * step <= 0.14);
      const peak = window.reduce((best, j) => ((ear[j] ?? 0) > (ear[best] ?? 0) ? j : best), window[0] ?? i);
      const lag = (peak - i) * step;
      expect(lag).toBeGreaterThan(0);
      expect(lag).toBeLessThan(0.12);
      expect(ear[peak]).toBeGreaterThan(3);
    }
    stage.destroy();
  });

  it('moves the ears only with the head: no animated part sits between an ear and the head', () => {
    const stage = new ChaseStage(host(), { reducedMotion: 'off' });
    for (const svg of puppets(stage)) {
      const ears = [...svg.querySelectorAll('.lop .ear-l, .lop .ear-r')];
      const head = svg.querySelector('.tf');
      for (const a of stage.animations as unknown as FakeAnimation[]) {
        const el = a.effect.target;
        if (ears.includes(el)) continue;
        // anything that carries an ear also carries the face: ear and head always move together
        if (ears.some((ear) => el.contains(ear))) expect(el.contains(head)).toBe(true);
      }
    }
    stage.destroy();
  });
});

describe('ChaseStage scene', () => {
  it('stays a short, finite, transform/opacity-only timeline that seeks deterministically', () => {
    for (const [w, h] of [[390, 210], [320, 210], [390, 120]] as const) {
      const stage = new ChaseStage(host(w, h), { reducedMotion: 'off' });
      expect(stage.duration).toBeGreaterThan(3);
      expect(stage.duration).toBeLessThanOrEqual(5);
      for (const a of stage.animations as unknown as FakeAnimation[]) {
        expect(Number.isFinite(Number(a.effect.getTiming().duration))).toBe(true);
        for (const key of a.effect.getKeyframes()) expect(Object.keys(key).every((k) => ['transform', 'opacity', 'offset', 'easing', 'composite'].includes(k))).toBe(true);
      }
      stage.seek(2.1);
      const frame = stage.sample(2.1);
      stage.seek(0);
      stage.seek(2.1);
      expect(stage.sample(2.1)).toEqual(frame);
      stage.destroy();
    }
  });

  it('fits a low host: the hopping bunny never leaves the top of a 120 px stage', () => {
    const stage = new ChaseStage(host(390, 120), { reducedMotion: 'off' });
    const actor = stage.root.querySelector('.frame') as HTMLElement;
    const frameH = Number.parseFloat(actor.style.height);
    for (const t of times(stage.duration, 0.01)) {
      const s = stage.sample(t);
      // feet at frame y + oy; the head with ears is ≈ 172 units above them, a hop lifts it ≤ 34 units more
      const y = ty(s['bunny.travel']?.transform);
      const lift = -ty(s['bunny.hop']?.transform);
      const u = frameH / 225; // frameBox: h = 270 * u / 1.2
      const top = y + 246 * (u / 1.2) - (172 + lift) * u;
      if ((s['bunny.travel']?.opacity ?? '1') !== '0') expect(top).toBeGreaterThanOrEqual(0);
    }
    stage.destroy();
  });

  it('comes back with the celery bit, chews it up and leaves the stage empty for the loop pause', () => {
    const stage = new ChaseStage(host(), { reducedMotion: 'off', loop: true });
    const [, back] = puppets(stage);
    expect(back?.querySelector('.tf .bite path')).toBeTruthy();
    const d = stage.duration;
    const end = stage.sample(d);
    expect(end['bunny.travel']?.opacity).toBe('0');
    expect(end['back.travel']?.opacity).toBe('0');
    expect(end['celery.travel']?.opacity).toBe('0');
    expect(end['back.bite']?.opacity).toBe('0');
    // loop mode: still empty 1.4 s later (the pause between two runs is ≥ 1.5 s)
    const pause = stage.sample(d + 1.4);
    expect(pause['bunny.travel']?.opacity).toBe('0');
    expect(pause['back.travel']?.opacity).toBe('0');
    stage.stop(false);
    stage.destroy();
  });

  it('keeps the public API: coat, loop, from, reducedMotion, onEnd', () => {
    const onEnd = vi.fn();
    const stage = new ChaseStage(host(), { coat: 'choc', from: 'right', loop: false, reducedMotion: 'off', onEnd });
    stage.play();
    stage.skip();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(stage.ended).toBe(true);
    stage.destroy();
  });

  it('under reduced motion shows a calm still: bunny and celery, no animations, no loop', () => {
    const stage = new ChaseStage(host(), { reducedMotion: 'force', loop: true });
    expect(stage.reducedMotion).toBe(true);
    expect(stage.empty).toBe(false);
    expect(stage.animations).toHaveLength(0);
    const still = stage.sample(0);
    expect(still['bunny.travel']?.opacity).toBe('1');
    expect(still['celery.travel']?.opacity).toBe('1');
    // the still is written inline and the ears are at rest
    const runner = stage.root.querySelector('.actor')?.shadowRoot?.querySelector('svg');
    const ear = runner?.querySelector<SVGElement>('.lop .ear-r');
    expect(ear).toBeTruthy();
    expect(ear?.style.transform).toBe('');
    stage.destroy();
  });
});
