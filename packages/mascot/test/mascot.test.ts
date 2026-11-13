import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bunny, COATS, createMascot, Hamster, SCENES } from '../src/index';

function host(): HTMLDivElement {
  const d = document.createElement('div');
  document.body.append(d);
  return d;
}

function hm(m: Bunny | Hamster): SVGGElement {
  const g = m.root.querySelector<SVGGElement>('.hm');
  if (!g) throw new Error('no .hm');
  return g;
}

/** Resolves to true once `p` has settled (checked after flushing microtasks). */
function settledFlag(p: Promise<unknown>): () => boolean {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  return () => done;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('floor shadow and contour tokens (app blocker 17)', () => {
  it("reads --mascot-shadow / --mascot-outline from the page: today's shadow and no contour by default", () => {
    for (const m of [new Bunny(host()), new Hamster(host())]) {
      const css = m.root.querySelector('style')?.textContent ?? '';
      expect(css).toContain('.shadow { fill: var(--mascot-shadow, rgba(70,40,15,.12)); }');
      // the contour is each silhouette shape's own stroke painted under its fill: body, ears, feet, tails
      expect(css).toContain('.breathe > path, .ear-l > :first-child, .ear-r > :first-child, .tear > :first-child, .tip > :first-child, .foot > ellipse, .tail > :first-child {');
      expect(css).toContain('stroke: var(--mascot-outline, none)');
      expect(css).toContain('paint-order: stroke fill');
      expect(css).toContain('vector-effect: non-scaling-stroke');
      // the cheeks are drawn over the body: no contour on them (it would show as arcs inside the face)
      expect(css).not.toContain('.cheek > ');
      expect(m.root.querySelectorAll('.breathe > path')).toHaveLength(1);
      m.destroy();
    }
  });
});

describe('mounting', () => {
  it('mounts an SVG puppet into an open shadow root with the coat on the host', () => {
    const h = host();
    const b = new Bunny(h);
    expect(h.shadowRoot).not.toBeNull();
    expect(b.root).toBe(h.shadowRoot);
    expect(b.root.querySelector('svg')).not.toBeNull();
    expect(b.root.querySelector('style')).not.toBeNull();
    expect(hm(b).classList.contains('ears-lop')).toBe(true);
    expect(h.style.getPropertyValue('--mascot-base-top')).toBe('#FCE7CC');
    expect(h.style.width).toBe('160px');
    b.destroy();
  });

  it('applies constructor options', () => {
    const h = host();
    const b = new Bunny(h, { coat: 'himalayan', ears: 'upright', size: 240, idle: false });
    expect(b.coat).toBe('himalayan');
    expect(b.ears).toBe('upright');
    expect(hm(b).classList.contains('ears-up')).toBe(true);
    expect(hm(b).classList.contains('pat-points')).toBe(true);
    expect(h.style.width).toBe('240px');
    expect(b.idleRunning).toBe(false);
    b.destroy();
  });

  it('createMascot picks the class by kind', () => {
    const a = createMascot(host(), { kind: 'hamster', coat: 'robo', idle: false });
    const b = createMascot(host(), { kind: 'bunny', ears: 'upright', idle: false });
    expect(a).toBeInstanceOf(Hamster);
    expect(b).toBeInstanceOf(Bunny);
    expect(a.coat).toBe('robo');
    expect(hm(a).classList.contains('pat-brows')).toBe(true);
    a.destroy();
    b.destroy();
  });
});

describe('API surface', () => {
  it('exposes scenes and coats', () => {
    expect(SCENES.bunny).toContain('alert');
    expect(SCENES.hamster).not.toContain('alert');
    expect(COATS.bunny.map((c) => c.id)).toEqual(['fawn', 'choc', 'blue', 'himalayan', 'broken']);
    expect(COATS.hamster.map((c) => c.id)).toEqual(['golden', 'cinnamon', 'sable', 'dwarf', 'robo', 'spot']);
    expect(COATS.hamster[0]?.colors).toEqual(['#FFF9F0', '#F6E3C9', '#FFFFFF', '#F8C68A', '#E9AC6C', '#F8C68A', '#F4A487']);
  });

  it('has the documented methods', () => {
    const b = new Bunny(host(), { idle: false });
    const ham = new Hamster(host(), { idle: false });
    for (const m of [b, ham]) {
      for (const k of ['play', 'setCoat', 'setEyes', 'setPuff', 'setSize', 'tap', 'hop', 'destroy', 'startIdle', 'stopIdle', 'pose', 'setReducedMotion'] as const) {
        expect(typeof (m as unknown as Record<string, unknown>)[k]).toBe('function');
      }
    }
    expect(typeof b.setEars).toBe('function');
    b.destroy();
    ham.destroy();
  });

  it('setCoat / setEars / setEyes / setPuff update the puppet', () => {
    const h = host();
    const b = new Bunny(h, { idle: false });
    b.setCoat('choc');
    expect(b.coat).toBe('choc');
    expect(h.style.getPropertyValue('--mascot-accent')).toBe('#B88563');
    b.setCoat('broken');
    expect(hm(b).classList.contains('pat-broken')).toBe(true);
    expect(hm(b).classList.contains('pat-points')).toBe(false);
    b.setCoat('nope' as never);
    expect(b.coat).toBe('fawn'); // unknown -> first coat, as in the prototype
    b.setEars('upright');
    expect(hm(b).classList.contains('ears-up')).toBe(true);
    expect(hm(b).classList.contains('ears-lop')).toBe(false);
    b.setEyes('star');
    expect(hm(b).classList.contains('m-star')).toBe(true);
    b.setEyes('normal');
    expect(hm(b).className.baseVal).not.toMatch(/m-(star|happy|sleep)/);
    b.setPuff(1.3);
    expect(hm(b).style.getPropertyValue('--puff')).toBe('1.3');
    b.destroy();
  });

  it('pose() sets a static state without timers', () => {
    const b = new Bunny(host(), { idle: false });
    b.pose('alert');
    expect(hm(b).classList.contains('lift-r')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    b.pose('idle');
    expect(hm(b).classList.contains('lift-r')).toBe(false);
    b.destroy();
  });
});

describe('unique ids', () => {
  it('two mascots on one page never share gradient / clipPath ids, and references point at their own defs', () => {
    const a = new Bunny(host(), { idle: false });
    const b = new Bunny(host(), { idle: false });
    const c = new Hamster(host(), { idle: false });
    const ids = (m: Bunny | Hamster) => [...m.root.querySelectorAll('[id]')].map((e) => e.id);
    const idsA = ids(a);
    const idsB = ids(b);
    const idsC = ids(c);
    expect(idsA.length).toBeGreaterThan(0);
    expect(idsA.some((id) => idsB.includes(id) || idsC.includes(id))).toBe(false);
    for (const m of [a, b, c]) {
      const own = ids(m);
      const refs = [...m.root.querySelectorAll('[fill^="url(#"], [clip-path^="url(#"]')].map(
        (e) => (e.getAttribute('fill') ?? e.getAttribute('clip-path') ?? '').slice(5, -1),
      );
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.every((r) => own.includes(r))).toBe(true);
    }
    a.destroy();
    b.destroy();
    c.destroy();
  });
});

describe('scenes', () => {
  it('play() resolves when the scene is over and resets state', async () => {
    const b = new Bunny(host(), { idle: false });
    const p = b.play('jump');
    const done = settledFlag(p);
    expect(b.busy).toBe(true);
    expect(b.scene).toBe('jump');
    expect(b.eyes).toBe('star');
    await vi.advanceTimersByTimeAsync(960 + 250 + 20);
    expect(done()).toBe(true);
    expect(b.busy).toBe(false);
    expect(b.scene).toBeNull();
    expect(b.eyes).toBe('normal');
    b.destroy();
  });

  it('ignores play() while another scene is running', async () => {
    const b = new Bunny(host(), { idle: false });
    const first = b.play('greet');
    const second = b.play('jump');
    const secondDone = settledFlag(second);
    await Promise.resolve();
    await Promise.resolve();
    expect(secondDone()).toBe(true);
    expect(b.scene).toBe('greet');
    await vi.runAllTimersAsync();
    await first;
    expect(b.busy).toBe(false);
    b.destroy();
  });

  it('dispatches mascot-scene-start / -end events on the host', async () => {
    const h = host();
    const ham = new Hamster(h, { idle: false });
    const log: string[] = [];
    h.addEventListener('mascot-scene-start', (e) => log.push(`start:${(e as CustomEvent).detail.scene}`));
    h.addEventListener('mascot-scene-end', (e) => log.push(`end:${(e as CustomEvent).detail.scene}`));
    const p = ham.play('jump');
    await vi.runAllTimersAsync();
    await p;
    expect(log).toEqual(['start:jump', 'end:jump']);
    ham.destroy();
  });

  it('sleep toggles and any other scene wakes him first', async () => {
    const ham = new Hamster(host(), { idle: false, reducedMotion: 'force' });
    const p = ham.play('sleep');
    await vi.advanceTimersByTimeAsync(400);
    await p;
    expect(ham.isSleeping).toBe(true);
    expect(ham.scene).toBe('sleep');
    expect(hm(ham).classList.contains('sleeping')).toBe(true);
    expect(ham.eyes).toBe('sleep');
    const p2 = ham.play('jump');
    await vi.advanceTimersByTimeAsync(2000);
    await p2;
    expect(ham.isSleeping).toBe(false);
    expect(hm(ham).classList.contains('sleeping')).toBe(false);
    expect(ham.busy).toBe(false);
    ham.destroy();
  });

  it('5 taps within 2.5 s make him angry once the running jump is over', async () => {
    const b = new Bunny(host(), { idle: false });
    for (let i = 0; i < 5; i++) void b.tap();
    expect(b.scene).toBe('jump');
    await vi.advanceTimersByTimeAsync(960 + 250 + 20);
    expect(b.scene).toBe('angry');
    expect(hm(b).classList.contains('m-angry')).toBe(true);
    expect(hm(b).style.getPropertyValue('--puff')).toBe('1.2');
    await vi.runAllTimersAsync();
    expect(b.busy).toBe(false);
    expect(hm(b).classList.contains('m-angry')).toBe(false);
    b.destroy();
  });
});

describe('reduced motion', () => {
  it('pauses an explicit scene and its waits while the document is hidden, then resumes the same run', async () => {
    const bunny = new Bunny(host(), { idle: false, reducedMotion: 'off' });
    const done = settledFlag(bunny.play('greet'));
    await vi.advanceTimersByTimeAsync(150);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const animations = bunny.root.querySelector('svg')!.getAnimations({ subtree: true });
    const times = animations.map((a) => a.currentTime);
    await vi.advanceTimersByTimeAsync(12000);
    expect(done()).toBe(false);
    expect(animations.map((a) => a.currentTime)).toEqual(times);
    expect(animations.some((a) => a.playState === 'running')).toBe(false);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(6000);
    expect(done()).toBe(true);
    bunny.destroy();
  });
  it('sleep is actually still: no floating z animations or repeating timers under reduced motion', async () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const ham = new Hamster(host(), { idle: false, reducedMotion: 'force' });
    const sleeping = ham.play('sleep');
    await vi.advanceTimersByTimeAsync(20000);
    await sleeping;
    expect(ham.isSleeping).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(ham.root.querySelector('.fx')?.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    ham.destroy();
  });

  it('a sleeping puppet stops its floating letters while another mascot owns the stage', async () => {
    const ham = new Hamster(host(), { idle: true, reducedMotion: 'off' });
    const sleeping = ham.play('sleep');
    await vi.advanceTimersByTimeAsync(3600);
    await sleeping;
    ham.stopIdle();
    const spy = vi.spyOn(Element.prototype, 'animate');
    await vi.advanceTimersByTimeAsync(12000);
    expect(spy).not.toHaveBeenCalled();
    expect(ham.root.querySelector('.fx')?.childElementCount).toBe(0);
    ham.destroy();
  });
  it("'force' skips Web Animations entirely and keeps scenes short", async () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const b = new Bunny(host(), { idle: false, reducedMotion: 'force' });
    expect(b.root.querySelector('svg')?.classList.contains('rm')).toBe(true);
    const p = b.play('jump');
    const done = settledFlag(p);
    await vi.advanceTimersByTimeAsync(260);
    expect(done()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    b.destroy();
  });

  it('without reduction the same scene takes the full choreography', async () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const b = new Bunny(host(), { idle: false, reducedMotion: 'off' });
    expect(b.root.querySelector('svg')?.classList.contains('rm')).toBe(false);
    const p = b.play('jump');
    const done = settledFlag(p);
    await vi.advanceTimersByTimeAsync(260);
    expect(done()).toBe(false);
    expect(spy).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(done()).toBe(true);
    b.destroy();
  });

  it('under reduction a scene keeps only its wait() pauses (eat: ~1.2 s instead of ~4 s)', async () => {
    const ham = new Hamster(host(), { idle: false, reducedMotion: 'force' });
    const p = ham.play('eat');
    const done = settledFlag(p);
    const cookie = ham.root.querySelector<SVGGElement>('.cookie');
    const paws = ham.root.querySelector<SVGGElement>('.paws');
    // the cookie drop is instant; the first wait(260) is still pending
    await vi.advanceTimersByTimeAsync(100);
    expect(cookie?.style.opacity).toBe('1');
    expect(ham.eyes).toBe('star');
    expect(paws?.style.transform).toBe('');
    // after wait(260) the whole chewing part snapped through: cheeks puffed, cookie gone, paws back down
    await vi.advanceTimersByTimeAsync(200);
    expect(hm(ham).style.getPropertyValue('--puff')).toBe('1.35');
    expect(cookie?.style.opacity).toBe('0');
    expect(hm(ham).classList.contains('chewing')).toBe(false);
    expect(paws?.style.transform).toBe('');
    expect(done()).toBe(false);
    await vi.advanceTimersByTimeAsync(950);
    expect(done()).toBe(true);
    expect(ham.eyes).toBe('normal');
    ham.destroy();
  });

  it('can be switched at runtime', () => {
    const b = new Bunny(host(), { idle: false, reducedMotion: 'off' });
    b.setReducedMotion('force');
    expect(b.reducedMotion).toBe(true);
    expect(b.root.querySelector('svg')?.classList.contains('rm')).toBe(true);
    b.destroy();
  });
});

describe('destroy()', () => {
  it('clears timers, disconnects observers and empties the shadow root', () => {
    class MockIO {
      static instances: MockIO[] = [];
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(public cb: IntersectionObserverCallback) {
        MockIO.instances.push(this);
      }
    }
    vi.stubGlobal('IntersectionObserver', MockIO);
    const h = host();
    const b = new Bunny(h); // idle loop on -> timers armed
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(MockIO.instances).toHaveLength(1);
    expect(MockIO.instances[0]?.observe).toHaveBeenCalledWith(h);
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    b.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(MockIO.instances[0]?.disconnect).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(h.shadowRoot?.innerHTML).toBe('');
    expect(h.style.getPropertyValue('--mascot-base-top')).toBe('');
    expect(b.isDestroyed).toBe(true);
    vi.unstubAllGlobals();
  });

  it('is safe mid-scene: pending scene resolves, later calls are no-ops', async () => {
    const b = new Bunny(host(), { idle: false });
    const p = b.play('greet');
    const done = settledFlag(p);
    b.destroy();
    await vi.runAllTimersAsync();
    expect(done()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const again = settledFlag(b.play('jump'));
    await Promise.resolve();
    expect(again()).toBe(true);
    expect(b.busy).toBe(false);
  });
});

describe('hamster holding binoculars (2026-10-22, the empty "Freunde" card)', () => {
  it('holds them in his own two paws: the resting paws are hidden, exactly two paws are drawn on the barrels', () => {
    const a = new Hamster(host(), { idle: false, holding: 'binoculars' });
    const b = new Hamster(host(), { idle: false });
    expect(a.holding).toBe('binoculars');
    expect(hm(a).classList.contains('hold-binoculars')).toBe(true);
    expect(b.holding).toBeNull();
    expect(hm(b).classList.contains('hold-binoculars')).toBe(false);
    // the binoculars sit in front of the face, behind the (hidden) resting paws, and carry two paws of their own
    const bino = a.root.querySelector('.bino');
    expect(bino?.previousElementSibling?.classList.contains('tf')).toBe(true);
    expect(bino?.nextElementSibling?.classList.contains('tp')).toBe(true);
    expect(bino?.querySelectorAll('.bino-paw ellipse[fill="var(--mascot-paw)"]')).toHaveLength(2);
    const css = a.root.querySelector('style')?.textContent ?? '';
    expect(css).toContain('.bino { display: none;');
    expect(css).toContain('.hold-binoculars .paw-l, .hold-binoculars .paw-r { display: none; }');
    // the lens clip is per instance (two hamsters on a page never share it)
    const clipA = a.root.querySelector('.bino [clip-path]')?.getAttribute('clip-path');
    const clipB = b.root.querySelector('.bino [clip-path]')?.getAttribute('clip-path');
    expect(clipA).toMatch(/^url\(#bp-hamster-\d+-clip-lens\)$/);
    expect(clipA).not.toBe(clipB);
    expect(a.root.querySelector(clipA!.slice(4, -1))).not.toBeNull();
    a.destroy();
    b.destroy();
  });

  it('is a lasting state: poses and interrupted scenes keep it, setHolding(null) puts them away', async () => {
    const ham = new Hamster(host(), { idle: false, holding: 'binoculars', reducedMotion: 'off' });
    ham.pose('wave');
    expect(hm(ham).classList.contains('hold-binoculars')).toBe(true);
    const scene = ham.play('jump');
    await vi.advanceTimersByTimeAsync(100);
    await ham.interrupt();
    await scene;
    expect(hm(ham).classList.contains('hold-binoculars')).toBe(true);
    ham.setHolding(null);
    expect(ham.holding).toBeNull();
    expect(hm(ham).classList.contains('hold-binoculars')).toBe(false);
    ham.setHolding('binoculars');
    expect(hm(ham).classList.contains('hold-binoculars')).toBe(true);
    ham.destroy();
  });

  it('its loop owns the blinks and glances; the ears still twitch; reduced motion stills it; paused with idle', async () => {
    const ham = new Hamster(host(), { idle: true, holding: 'binoculars', reducedMotion: 'off' });
    const added = new Set<string>();
    const observer = new MutationObserver(() => hm(ham).classList.forEach((c) => added.add(c)));
    observer.observe(hm(ham), { attributes: true, attributeFilter: ['class'] });
    await vi.advanceTimersByTimeAsync(40000);
    observer.disconnect();
    expect([...added].filter((c) => ['blink', 'look-l', 'look-r'].includes(c))).toEqual([]);
    expect([...added].some((c) => c === 'twitch' || c === 'flick')).toBe(true);
    const css = ham.root.querySelector('style')?.textContent ?? '';
    for (const part of ['.bino', '.tf', '.te', '.wiggle', '.eye', '.bino-glint']) {
      const rule = css.split('\n').find((line) => line.startsWith(`.hold-binoculars ${part} {`) && line.includes('animation: bino-'));
      expect(rule).toMatch(/animation: bino-[a-z]+ 16s .* infinite; \}$/);
      expect(css).toContain(`.rm .hold-binoculars ${part}`);
    }
    // the loop is CSS: the shared pause rules (another mascot owns the stage, offscreen, hidden tab) freeze it
    ham.stopIdle();
    expect(ham.root.querySelector('svg')?.classList.contains('idle-paused')).toBe(true);
    expect(css).toContain('.idle-paused *, .visibility-paused * { animation-play-state: paused !important; }');
    ham.destroy();
  });
});
