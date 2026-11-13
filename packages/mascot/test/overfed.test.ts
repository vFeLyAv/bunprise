import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverfedStage } from '../src/index';
import { BUNNY_COATS, bunnyMarkup } from '../src/bunny';
import { BODY } from '../src/shapes';
import { OVERFED_DEFAULT, OVERFED_VARIANTS, OVERFED_VIEWBOX, type OverfedVariant } from '../src/overfed';
import { A_CARROT } from '../src/overfed-shows';
import { DROP_REST_Y } from '../src/overfed-rig';
import type { FakeAnimation } from './setup';

// «Переел», third drawing (23.10.2026): the SAME sitting puppet as the app mascot (no lying body any more),
// three variants for Felix — a «Хватит», b «Последний кусочек», c «Ик!».

function host(w = 358, h = 150) {
  const el = document.createElement('div');
  Object.defineProperties(el, { clientWidth: { value: w }, clientHeight: { value: h } });
  document.body.append(el);
  return el;
}
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const svgOf = (s: OverfedStage) => s.root.querySelector<SVGSVGElement>('svg.overfed');
const make = (variant: OverfedVariant, extra: Partial<ConstructorParameters<typeof OverfedStage>[1]> = {}) =>
  new OverfedStage(host(), { illustration: true, reducedMotion: 'off', variant, ...extra });
const n3 = (v: number) => String(Math.round(v * 1000) / 1000);
const keysOk = (s: OverfedStage) => {
  for (const a of s.animations as unknown as FakeAnimation[]) {
    for (const key of a.effect.getKeyframes()) {
      expect(Object.keys(key).every((k) => ['transform', 'opacity', 'offset', 'easing', 'composite'].includes(k))).toBe(true);
    }
  }
};
const loopsOf = (s: OverfedStage) => (s.animations as unknown as FakeAnimation[]).filter((a) => a.effect.getTiming().iterations === Infinity);

describe('OverfedStage — the drawing is the app puppet', () => {
  it('renders the puppet markup itself (same body silhouette, lop ears, face) in the mascot viewBox, standing on the bottom edge', () => {
    const s = make('a');
    const svg = svgOf(s)!;
    const { x, y, w, h } = OVERFED_VIEWBOX;
    expect(`${x} ${y} ${w} ${h}`).toBe('0 0 400 260');
    expect(svg.getAttribute('viewBox')).toBe('0 0 400 260');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMax meet');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    // the puppet's own group with its own placement (feet at 200,246, scale 1.2) — like the Bunny mascot
    expect(svg.querySelector('.hm')!.getAttribute('transform')).toBe('translate(200 246) scale(1.2)');
    expect(svg.querySelector(`path[d="${BODY}"]`)).not.toBeNull();
    // every path of the puppet is there unchanged (the overfed svg only adds props)
    const puppet = document.createElement('div');
    puppet.innerHTML = `<svg>${bunnyMarkup((name) => `t-${name}`)}</svg>`;
    const ds = (root: ParentNode) => [...root.querySelectorAll('.hm path')].map((p) => p.getAttribute('d'));
    const mine = new Set(ds(svg));
    for (const d of ds(puppet)) expect(mine.has(d)).toBe(true);
    for (const sel of ['.lop .ear-l', '.lop .ear-r', '.cheek-l', '.cheek-r', '.paw-l', '.paw-r', '.eyes', '.eyes-happy', '.eyes-sleep', '.nose', '.mouth', '.tf', '.breathe']) {
      expect(svg.querySelector(sel)).not.toBeNull();
    }
    s.destroy();
  });

  it('ids are unique per stage and every url(#…) points into its own svg', () => {
    const a = make('b');
    const b = new OverfedStage(host(288), { illustration: true, reducedMotion: 'off', variant: 'b' });
    const ids = (svg: SVGSVGElement) => [...svg.querySelectorAll('[id]')].map((el) => el.id);
    expect(ids(svgOf(a)!).length).toBeGreaterThanOrEqual(5);
    expect(ids(svgOf(a)!).filter((id) => ids(svgOf(b)!).includes(id))).toEqual([]);
    for (const svg of [svgOf(a)!, svgOf(b)!]) {
      for (const el of svg.querySelectorAll('[fill^="url(#"], [clip-path^="url(#"]')) {
        const ref = /url\(#([^)]+)\)/.exec(el.getAttribute('fill') ?? el.getAttribute('clip-path') ?? '')?.[1];
        expect(ref && svg.querySelector(`[id="${ref}"]`)).toBeTruthy();
      }
    }
    a.destroy();
    b.destroy();
  });

  it('wears the coat of the puppet (colours as custom properties, markings by pattern)', () => {
    for (const coat of BUNNY_COATS) {
      const s = new OverfedStage(host(), { illustration: true, reducedMotion: 'off', coat: coat.id });
      const svg = svgOf(s)!;
      expect(svg.style.getPropertyValue('--mascot-base-top')).toBe(coat.colors[0]);
      expect(svg.querySelector('.hm')!.classList.contains('pat-points')).toBe(coat.pattern === 'points');
      expect(svg.querySelector('.hm')!.classList.contains('pat-broken')).toBe(coat.pattern === 'broken');
      s.destroy();
    }
  });
});

describe('OverfedStage — variants', () => {
  it('has three variants; the default is OVERFED_DEFAULT, an unknown one falls back to it', () => {
    expect(OVERFED_VARIANTS).toEqual(['a', 'b', 'c']);
    const d = new OverfedStage(host(), { illustration: true, reducedMotion: 'off' });
    expect(d.variant).toBe(OVERFED_DEFAULT);
    const odd = new OverfedStage(host(), { illustration: true, reducedMotion: 'off', variant: 'x' as OverfedVariant });
    expect(odd.variant).toBe(OVERFED_DEFAULT);
    d.destroy();
    odd.destroy();
  });

  it('each variant brings only its own props: a — the extra carrot + crumbs at the mouth, b — the carrot in the paws + "z", c — crumbs', () => {
    const has = (s: OverfedStage, sel: string) => svgOf(s)!.querySelector(sel) !== null;
    const a = make('a');
    const b = make('b');
    const c = make('c');
    expect([has(a, '.ov-drop'), has(a, '.ov-mouth-crumbs'), has(a, '.ov-held'), has(a, '.ov-z')]).toEqual([true, true, false, false]);
    expect([has(b, '.ov-drop'), has(b, '.ov-held'), has(b, '.ov-z')]).toEqual([false, true, true]);
    // the held carrot is inside the paws (it moves with them), behind the paw shapes
    expect(svgOf(b)!.querySelector('.paws > .ov-held')).not.toBeNull();
    expect([has(c, '.ov-drop'), has(c, '.ov-held'), has(c, '.ov-z'), has(c, '.ov-crumbs')]).toEqual([false, false, false, true]);
    for (const s of [a, b, c]) s.destroy();
  });

  for (const v of OVERFED_VARIANTS) {
    it(`variant ${v}: a 3–5 s show, only transform/opacity, deterministic seeking, calm loops after the show`, () => {
      const s = make(v);
      expect(s.duration).toBeGreaterThanOrEqual(3);
      expect(s.duration).toBeLessThanOrEqual(5);
      expect(s.animations.length).toBeGreaterThan(10);
      keysOk(s);
      for (const t of [0.7, 1.6, 2.9, 4.2]) {
        s.seek(t);
        const first = s.sample(t);
        s.seek(0);
        s.seek(t);
        expect(s.sample(t)).toEqual(first);
      }
      // after the show: loops only, starting at (or for the "z": just before) the end of the show
      const loops = loopsOf(s);
      const names = loops.map((a) => a.id).sort();
      expect(names).toEqual(v === 'b' ? ['overfed.bodyLoop', 'overfed.breathe', 'overfed.zLoop'] : ['overfed.breathe']);
      for (const a of loops) {
        expect(Number(a.effect.getTiming().delay)).toBeGreaterThanOrEqual((s.duration - 0.5) * 1000);
        expect(Number(a.effect.getTiming().duration)).toBeGreaterThanOrEqual(2800);
      }
      // the end pose: eyes closed (content ^ ^, or asleep for b), the figure fully there
      const end = s.sample(s.duration);
      expect(end['overfed.eyes']?.opacity).toBe('0');
      expect(end[v === 'b' ? 'overfed.sleep' : 'overfed.happy']?.opacity).toBe('1');
      expect(end['overfed.fig']).toBeUndefined();
      s.destroy();
    });
  }

  it('no animation has two keyframes at one offset (Firefox did not paint such a run: round eyes under ^ ^ in c, 23.10)', () => {
    for (const v of OVERFED_VARIANTS) {
      for (const illustration of [true, false]) {
        const s = new OverfedStage(host(), { illustration, reducedMotion: 'off', variant: v });
        for (const a of s.animations as unknown as FakeAnimation[]) {
          const offsets = a.effect.getKeyframes().map((k) => Number(k.offset));
          for (let i = 1; i < offsets.length; i++) {
            if (!(offsets[i]! > offsets[i - 1]!)) throw new Error(`${v}: ${a.id} has keyframes at offset ${offsets[i]} twice`);
          }
        }
        s.destroy();
      }
    }
  });

  it('exactly one set of eyes is visible at any moment (open, ^ ^ or asleep), never two at once', () => {
    for (const v of OVERFED_VARIANTS) {
      const s = make(v);
      const switches: string[] = [];
      let last = '';
      for (let ms = 0; ms <= (s.duration + 4) * 1000; ms += 5) {
        const f = s.sample(ms / 1000);
        const shown = (['eyes', 'happy', 'sleep'] as const).filter((n) => Number(f[`overfed.${n}`]?.opacity ?? (n === 'eyes' ? 1 : 0)) > 0.02);
        if (shown.length !== 1) throw new Error(`${v} at ${ms} ms: eyes visible = [${shown.join(', ')}]`);
        if (shown[0] !== last) switches.push(`${ms}:${shown[0]}`);
        last = shown[0]!;
      }
      // the switches the story needs (a: ^ ^ → open → ^ ^; b: ^ ^ → open → ^ ^ (yawn) → open → asleep; c: ^ ^ → open → ^ ^ → open → ^ ^)
      expect(switches.map((x) => x.split(':')[1])).toEqual(
        { a: ['happy', 'eyes', 'happy'], b: ['happy', 'eyes', 'happy', 'eyes', 'sleep'], c: ['happy', 'eyes', 'happy', 'eyes', 'happy'] }[v],
      );
      s.destroy();
    }
  });

  it('a «Хватит»: one more carrot falls in from above and lands beside him; he looks, shakes his head, closes his eyes', () => {
    const s = make('a');
    const drop = (t: number) => s.sample(t)['overfed.drop'];
    const y = (t: number) => Number(/translate\([^,]+, ([-\d.]+)px\)/.exec(drop(t)?.transform ?? '')?.[1]);
    expect(drop(0.5)?.opacity).toBe('0');
    // above the picture while it fades in (the viewBox top is 205 bunny units above the floor)
    expect(y(1.05)).toBeLessThan(-205);
    expect(y(1.46)).toBeCloseTo(DROP_REST_Y, 2);
    expect(y(1.6)).toBeLessThan(DROP_REST_Y - 5);
    expect(drop(s.duration)).toEqual({ transform: `translate(${n3(A_CARROT.x)}px, ${n3(DROP_REST_Y)}px) rotate(0deg)`, opacity: '1' });
    // the eyes open when it lands, he turns toward it (right), then — eyes shut — turns left / right
    expect(s.sample(1.9)['overfed.eyes']?.opacity).toBe('1');
    const headX = (t: number) => Number(/translate\(([-\d.]+)px/.exec(s.sample(t)['overfed.head']?.transform ?? '')?.[1]);
    expect(headX(2.0)).toBeGreaterThan(4);
    expect(headX(2.8)).toBeLessThan(-4);
    expect(headX(3.1)).toBeGreaterThan(4);
    expect(headX(s.duration)).toBe(0);
    expect(s.sample(2.8)['overfed.happy']?.opacity).toBe('1');
    s.destroy();
  });

  it('b «Последний кусочек»: carrot to the mouth, cheeks fuller, into the lap, yawn, asleep with a "z"', () => {
    const s = make('b');
    const f = (t: number) => s.sample(t);
    expect(f(0.71)['overfed.paws']?.transform).toBe('translate(0px, -11px)');
    expect(f(0)['overfed.cheeks']?.transform).toBe('scale(1.26, 1.26)');
    expect(f(1.42)['overfed.cheeks']?.transform).toBe('scale(1.42, 1.42)');
    expect(f(1.9)['overfed.eyes']?.opacity).toBe('1');
    expect(f(s.duration)['overfed.held']?.transform).toBe('translate(3px, -31px) rotate(86deg)');
    expect(f(s.duration)['overfed.paws']?.transform).toBe('translate(0px, 8px)');
    expect(f(3.0)['overfed.yawn']?.opacity).toBe('1');
    expect(f(3.0)['overfed.mouth']?.opacity).toBe('0');
    expect(f(s.duration)['overfed.yawn']?.opacity).toBe('0');
    // the first "z" floats up once the eyes are shut, before the show ends
    expect(Number(f(4.7)['overfed.zLoop']?.opacity)).toBeGreaterThan(0);
    s.destroy();
  });

  it('c «Ик!»: two hiccups (hop, round eyes, paws to the mouth), a giggle, back to rest', () => {
    const s = make('c');
    const hop = (t: number) => s.sample(t)['overfed.hop']?.transform;
    expect(hop(1.19)).toBe('translate(0px, -10px)');
    expect(hop(1.32)).toBe('translate(0px, 0px)');
    expect(hop(2.94)).toBe('translate(0px, -6px)');
    expect(s.sample(1.3)['overfed.paws']?.transform).toBe('translate(0px, -22px)');
    expect(s.sample(1.3)['overfed.eyes']?.opacity).toBe('1');
    expect(s.sample(2.2)['overfed.happy']?.opacity).toBe('1');
    expect(s.sample(s.duration)['overfed.paws']?.transform).toBe('translate(0px, 0px)');
    expect(hop(s.duration)).toBe('translate(0px, 0px)');
    s.destroy();
  });
});

describe('OverfedStage — decoration, reduced motion, cleanup', () => {
  it('as a decoration every variant fades out at the end (≤ 5 s) and does not loop', () => {
    for (const v of OVERFED_VARIANTS) {
      const s = new OverfedStage(host(), { reducedMotion: 'off', variant: v });
      expect(s.duration).toBeLessThanOrEqual(5);
      expect(s.sample(s.duration)['overfed.fig']?.opacity).toBe('0');
      expect(loopsOf(s)).toHaveLength(0);
      keysOk(s);
      s.destroy();
    }
  });

  it('reduced motion: the illustration is the calm end pose (no animate() call), fading in; the decoration is nothing', async () => {
    vi.useFakeTimers();
    const animate = vi.spyOn(Element.prototype, 'animate');
    for (const v of OVERFED_VARIANTS) {
      const onEnd = vi.fn();
      const s = new OverfedStage(host(), { illustration: true, reducedMotion: 'force', variant: v, onEnd });
      const motion = make(v);
      expect(s.reducedMotion).toBe(true);
      expect(s.empty).toBe(false);
      expect(s.animations).toHaveLength(0);
      const svg = svgOf(s)!;
      // the inline styles are the animated show's end pose
      const end = motion.sample(motion.duration);
      for (const [sel, name] of [['.eyes', 'eyes'], ['.eyes-happy', 'happy'], ['.eyes-sleep', 'sleep'], ['.paws', 'paws'], ['.cheek', 'cheeks']] as const) {
        const el = svg.querySelector(sel) as SVGElement;
        const want = end[`overfed.${name}`];
        if (want?.opacity !== undefined) expect(el.style.opacity).toBe(want.opacity);
        if (want?.transform !== undefined) expect(el.style.transform).toBe(want.transform);
      }
      if (v === 'a') expect((svg.querySelector('.ov-drop') as SVGElement).style.opacity).toBe('1');
      if (v === 'b') {
        expect((svg.querySelector('.ov-held') as SVGElement).style.transform).toBe('translate(3px, -31px) rotate(86deg)');
        expect((svg.querySelector('.eyes-sleep') as SVGElement).style.opacity).toBe('1');
        // no "z" in the still (effects are not created under reduced motion)
        expect((svg.querySelector('.ov-z') as SVGElement).style.opacity).toBe('0');
      }
      motion.destroy();
      animate.mockClear();
      s.play();
      expect(animate).not.toHaveBeenCalled();
      expect(s.root.querySelector('.stage')!.classList.contains('rm-in')).toBe(true);
      await vi.advanceTimersByTimeAsync(460);
      expect(onEnd).toHaveBeenCalledTimes(1);
      s.destroy();
    }
    const deco = new OverfedStage(host(), { reducedMotion: 'force', variant: 'b' });
    expect(deco.empty).toBe(true);
    expect(svgOf(deco)).toBeNull();
    deco.destroy();
  });

  it('switching reduced motion on mid-show jumps to the calm still and ends', async () => {
    vi.useFakeTimers();
    for (const v of OVERFED_VARIANTS) {
      const onEnd = vi.fn();
      const s = new OverfedStage(host(), { illustration: true, reducedMotion: 'off', variant: v, onEnd });
      s.play();
      await vi.advanceTimersByTimeAsync(1500);
      s.setReducedMotion('force');
      expect(s.animations).toHaveLength(0);
      expect(onEnd).toHaveBeenCalledTimes(1);
      expect(svgOf(s)).not.toBeNull();
      s.destroy();
    }
  });

  it('destroy() cancels every animation (the endless loops too) and empties the shadow root; stop() hides it', async () => {
    vi.useFakeTimers();
    for (const v of OVERFED_VARIANTS) {
      const s = make(v);
      s.play();
      await vi.advanceTimersByTimeAsync(5200);
      const anims = [...(s.animations as unknown as FakeAnimation[])];
      expect(anims.some((a) => a.playState === 'running' && a.effect.getTiming().iterations === Infinity)).toBe(true);
      s.destroy();
      expect(anims.every((a) => a.playState === 'idle')).toBe(true);
      expect(s.root.innerHTML).toBe('');
      expect(s.isDestroyed).toBe(true);
      await s.done;

      const t = make(v);
      t.play();
      await vi.advanceTimersByTimeAsync(800);
      t.stop(false);
      await t.done;
      expect(t.root.querySelector('.stage')!.classList.contains('rm-hidden')).toBe(true);
      expect(t.animations.filter((a) => a.playState === 'running')).toHaveLength(0);
      t.destroy();
    }
  });
});
