import { afterEach, describe, expect, it, vi } from 'vitest';
import { BEATS, HomeIconStage, ICON, ICON_DEPTH, SHRINK, iconGeometry } from '../src/homeicon';
import { homeIconGallery, stepPhone } from '../demo/homeicon/gallery';

// «Здесь я буду жить» (26.10, gallery-only prototype, ideas doc §1.5): the icon frame slides up from behind the card,
// Pompon climbs onto its bar with the approved climb and freezes in EXACTLY the icon's pose, the frame shrinks.

const ALLOWED = ['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity'];

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.head.replaceChildren();
});

function stage(reduced = false, size = 176): HomeIconStage {
  const host = document.createElement('div');
  document.body.append(host);
  return new HomeIconStage(host, { reduced, size });
}

function parts(tr: string | undefined): { x: number; y: number; r: number; sx: number; sy: number } {
  const t = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(tr ?? '');
  const r = /rotate\((-?[\d.]+)deg\)/.exec(tr ?? '');
  const s = /scale\((-?[\d.]+), (-?[\d.]+)\)/.exec(tr ?? '');
  return { x: Number(t?.[1] ?? 0), y: Number(t?.[2] ?? 0), r: Number(r?.[1] ?? 0), sx: Number(s?.[1] ?? 1), sy: Number(s?.[2] ?? 1) };
}

describe('the icon geometry (apps/web/public/icons/icon.svg)', () => {
  it('the bunny at the icon scale, the bar under the edge line at 840 / 1024, 60 units between edge and feet', () => {
    const g = iconGeometry(1024);
    expect(g.u).toBeCloseTo(4.85, 5);
    expect(g.bar).toBeCloseTo(184, 5);
    expect(ICON_DEPTH).toBeCloseTo(60, 5);
    expect(ICON.eye).toBeCloseTo(1.3387, 3);
  });
});

describe('HomeIconStage (motion)', () => {
  it('≈ 2.4 s; only transform / opacity, every animation finite', () => {
    const s = stage();
    expect(s.duration).toBeGreaterThan(2.2);
    expect(s.duration).toBeLessThan(2.6);
    expect(s.animations.length).toBeGreaterThan(0);
    for (const a of s.animations) {
      const timing = (a.effect as KeyframeEffect).getTiming();
      expect(timing.iterations ?? 1).toBe(1);
      for (const k of (a.effect as KeyframeEffect).getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key))).toBe(true);
    }
  });

  it('the frame starts hidden behind the card (below the host) and slides up — never out of thin air', () => {
    const s = stage();
    const H = s.host.clientHeight || 300;
    expect(parts(s.sample(0)['icon.frame']?.transform).y).toBeGreaterThanOrEqual(H);
    expect(parts(s.sample(BEATS.rise + BEATS.riseDur)['icon.frame']?.transform).y).toBeCloseTo(s.rest.y, 3);
    // Pompon's head is behind the bar until his climb
    const lift = parts(s.sample(BEATS.climb)['p0.lift']?.transform).y;
    expect(lift).toBeGreaterThan(100 * iconGeometry(176).u);
  });

  it('freezes in EXACTLY the icon pose before the frame shrinks', () => {
    const s = stage();
    const { u } = iconGeometry(176);
    const at = s.sample(BEATS.shrink - 0.01);
    // the head 60 units above the feet like the icon (the peek leaves 56: it sank the last 4)
    expect(parts(at['p0.lift']?.transform)).toMatchObject({ x: 0 });
    expect(parts(at['p0.lift']?.transform).y).toBeCloseTo(4 * u, 3);
    // the face lifted 4 units, the eyes 1.34× with the icon's highlights
    expect(parts(at['icon.tf']?.transform).y).toBeCloseTo(ICON.faceY, 5);
    for (const i of [0, 1]) {
      expect(parts(at[`icon.eye${i}`]?.transform).sx).toBeCloseTo(ICON.eye, 3);
      expect(parts(at[`icon.hi${i}`]?.transform).y).toBeCloseTo(ICON.hiBig, 3);
    }
    // paws at ±25, their centre 1.5 units above the edge (bunny space, edge at −56 → origin −47.5), over the edge
    expect(parts(at['p0.pawL']?.transform)).toMatchObject({ x: -25, y: -47.5, r: 0, sx: 1, sy: 1 });
    expect(parts(at['p0.pawR']?.transform)).toMatchObject({ x: 25, y: -47.5, r: 0, sx: 1, sy: 1 });
    expect(at['p0.pawLf']?.opacity).toBe('1');
    expect(at['p0.pawRf']?.opacity).toBe('1');
    // nothing else is off its rest: ears, body, squash, the eye blink
    expect(parts(at['p0.earL']?.transform).r).toBeCloseTo(0, 5);
    expect(parts(at['p0.earR']?.transform).r).toBeCloseTo(0, 5);
    expect(parts(at['p0.body']?.transform).r).toBeCloseTo(0, 5);
    expect(parts(at['p0.squash']?.transform)).toMatchObject({ sx: 1, sy: 1 });
    expect(parts(at['p0.eyes']?.transform)).toMatchObject({ sx: 1, sy: 1 });
  });

  it('then nothing on Pompon moves (he IS the icon); only the frame shrinks and the name fades in', () => {
    const s = stage();
    const frozen = BEATS.climb + BEATS.settle + 0.06 + BEATS.settleDur;
    const a = s.sample(frozen + 0.02);
    const b = s.sample(s.duration);
    for (const k of Object.keys(a).filter((n) => n.startsWith('p0.') || (n.startsWith('icon.') && n !== 'icon.frame' && n !== 'icon.label'))) {
      expect(b[k], k).toEqual(a[k]);
    }
    expect(parts(b['icon.frame']?.transform).sx).toBeCloseTo(SHRINK, 5);
    expect(b['icon.label']?.opacity).toBe('1');
  });

  it('never points: after the paws land they stay on the edge (no paw leaves it again)', () => {
    const s = stage();
    for (let t = BEATS.climb + 0.6; t <= s.duration; t += 0.02) {
      const at = s.sample(t);
      for (const p of ['p0.pawL', 'p0.pawR']) {
        const v = parts(at[p]?.transform);
        expect(Math.abs(v.x)).toBeLessThanOrEqual(26);
        expect(v.y).toBeGreaterThan(-52);
        expect(v.y).toBeLessThan(-44);
      }
    }
  });
});

describe('HomeIconStage (reduced motion)', () => {
  it('the static icon composition (the end frame), no animate() call', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const s = stage(true);
    expect(spy).not.toHaveBeenCalled();
    const frame = s.root.querySelector<HTMLElement>('.frame');
    expect(parts(frame?.style.transform).sx).toBeCloseTo(SHRINK, 5);
    s.play();
    expect(s.root.querySelector('.stage')?.classList.contains('on')).toBe(true);
  });
});

describe('HomeIconStage in the app (27.10): lifecycle, pause when unseen, already played', () => {
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }
  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
  });

  it('busy while it plays, then done: nothing ticks afterwards', async () => {
    vi.useFakeTimers();
    const onEnd = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const s = new HomeIconStage(host, { reducedMotion: 'off', size: 176, onEnd });
    expect(s.isStatic).toBe(false);
    expect(s.busy).toBe(false);
    s.play();
    expect(s.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(s.duration * 1000 + 50);
    await s.done;
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(s.busy).toBe(false);
    expect(s.hasEnded).toBe(true);
    expect(s.animations.every((a) => a.playState !== 'running')).toBe(true);
  });

  it('pauses while the tab is hidden and goes on from the same frame', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.append(host);
    const s = new HomeIconStage(host, { reducedMotion: 'off', size: 176 });
    s.play();
    await vi.advanceTimersByTimeAsync(800);
    setHidden(true);
    expect(s.suspended).toBe(true);
    expect(s.busy).toBe(true);
    const at = s.time;
    expect(s.animations.some((a) => a.playState === 'running')).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.time).toBeCloseTo(at, 3);
    expect(s.hasEnded).toBe(false);
    setHidden(false);
    expect(s.suspended).toBe(false);
    expect(s.animations.some((a) => a.playState === 'running')).toBe(true);
    await vi.advanceTimersByTimeAsync(s.duration * 1000);
    expect(s.hasEnded).toBe(true);
  });

  it('a hidden tab at the start: it waits, parked, until it can be seen', () => {
    setHidden(true);
    const host = document.createElement('div');
    document.body.append(host);
    const s = new HomeIconStage(host, { reducedMotion: 'off', size: 176 });
    s.play();
    expect(s.suspended).toBe(true);
    expect(s.animations.some((a) => a.playState === 'running')).toBe(false);
    setHidden(false);
    expect(s.animations.some((a) => a.playState === 'running')).toBe(true);
  });

  it('still (already played on this device) = the end composition, no animate() call — like reduced motion', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const host = document.createElement('div');
    document.body.append(host);
    const s = new HomeIconStage(host, { reducedMotion: 'off', still: true, size: 176 });
    expect(spy).not.toHaveBeenCalled();
    expect(s.isStatic).toBe(true);
    expect(s.reduced).toBe(false);
    expect(parts(s.root.querySelector<HTMLElement>('.frame')?.style.transform).sx).toBeCloseTo(SHRINK, 5);
    expect(s.root.querySelector<HTMLElement>('.label')?.style.opacity).toBe('1');
    s.play();
    expect(s.root.querySelector('.stage')?.classList.contains('on')).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reducedMotion 'force' is the static composition; destroy() empties the shadow root and resolves done", async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const s = new HomeIconStage(host, { reducedMotion: 'force' });
    expect(s.reduced).toBe(true);
    expect(s.animations).toHaveLength(0);
    s.destroy();
    await s.done;
    expect(s.isDestroyed).toBe(true);
    expect(s.root.innerHTML).toBe('');
  });
});

describe('the gallery page', () => {
  it('mounts the onboarding step with the stage above the card', () => {
    const app = document.createElement('div');
    document.body.append(app);
    homeIconGallery(app, new URLSearchParams('screens=homeicon&autoplay=0&contact=0'));
    expect(app.textContent).toMatch(/Zum Home.Bildschirm/);
    expect((window as unknown as { homeicon: HomeIconStage }).homeicon.duration).toBeGreaterThan(2);
    const ph = stepPhone(document.body, 'dark');
    expect(ph.phone.classList.contains('dark')).toBe(true);
  });
});
