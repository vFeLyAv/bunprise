import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bunny, BUNNY_CSS, bunnyMarkup } from '../src/bunny';
import { Hamster } from '../src/hamster';
import { applyBinkyKit, BK_BODY_PTS, BK_COAT_IDS, BK_COATS, EAR_ROOT, EAR_VARIANTS, earShape, earTop, paintBinky, sample, type EarVariant } from '../demo/binky/kit';
import { authorBinky, BINKY_BEATS, BINKY_H, BINKY_PEAK, BINKY_S, BinkyShow, binkyOnPuppet, binkyParts, type BinkyFace } from '../demo/binky/binky';
import { binkyGallery, NAMES, ROLE } from '../demo/binky/gallery';
// the sources as text (Vite ?raw, declared in demo/splash/raw.d.ts)
import indexSrc from '../src/index.ts?raw';
import mainSrc from '../demo/main.ts?raw';

// «Бинки-кролик» (gallery prototype 31.10, from Felix's three photos of an orange rabbit). Everything is a reshape of
// the SAME puppet from outside (demo/binky/kit.ts) plus one timeline (demo/binky/binky.ts); packages/mascot/src is not
// touched: the app's default Pompon / Tapsi must stay byte-identical. The binky: ≤ 2 s, plays once, transform /
// opacity only, reduced motion = the mid-air pose as a still (no animate() at all).

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

/** FNV-1a of the markup with the instance id normalised — the same function and pins as test/costumes.test.ts
 *  (computed 31.10 with ONLY src/ loaded). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
function fingerprint(p: Bunny | Hamster): string {
  const norm = (s: string) => s.split(p.id).join('ID');
  return fnv(norm(p.root.innerHTML) + '|' + (p.host.getAttribute('style') ?? '') + '|' + p.host.className);
}
const PINS = { pompon: '8ad2402a', brokenUpright: '19ec646f', tapsi: '8051ce5d' } as const;

function svgOf(p: Bunny | Hamster): SVGSVGElement {
  const svg = p.root.querySelector('svg');
  if (!svg) throw new Error('no svg');
  return svg;
}

/** Every keyframe property a binky animation may touch. */
const ALLOWED = new Set(['transform', 'opacity', 'offset', 'easing', 'composite']);

describe('the default puppets stay exactly as they are (the app uses this package)', () => {
  it('default Pompon, a broken-coat upright bunny and Tapsi are byte-identical to the pins computed with only src/ loaded', () => {
    expect(fingerprint(new Bunny(mount()))).toBe(PINS.pompon);
    expect(fingerprint(new Bunny(mount(), { coat: 'broken', ears: 'upright' }))).toBe(PINS.brokenUpright);
    expect(fingerprint(new Hamster(mount()))).toBe(PINS.tapsi);
  });

  it('a plain puppet next to reshaped ones and a playing binky gets nothing; the shared CSS, markup and prototype are never patched', () => {
    const css = BUNNY_CSS;
    const markup = bunnyMarkup((n) => `x-${n}`);
    const animate = Element.prototype.animate;
    const reshaped = new Bunny(mount(), { idle: false, interactive: false, reducedMotion: 'force' });
    paintBinky(reshaped.host, 'ginger', svgOf(reshaped).querySelector('.hm'));
    applyBinkyKit(svgOf(reshaped), 'c');
    const show = new BinkyShow(mount(), { size: 160 });
    void show.play();
    const plain = new Bunny(mount());
    expect(fingerprint(plain)).toBe(PINS.pompon);
    expect(plain.root.querySelector('.bk-css, .bk-face, .bk-fluff')).toBeNull();
    expect(svgOf(plain).classList.contains('bk')).toBe(false);
    expect(BUNNY_CSS).toBe(css);
    expect(bunnyMarkup((n) => `x-${n}`)).toBe(markup);
    expect(Element.prototype.animate).toBe(animate);
    show.destroy();
  });

  it('the package source is not touched by this prototype (no binky import anywhere in src/, no new export)', () => {
    expect(indexSrc).not.toMatch(/binky/i);
    const main = mainSrc;
    // Felix dropped Flummi 31.10 («Не надо Флумми»): no link on the gallery start page, the page stays for the record
    expect(main).not.toContain("href = '?screens=binky'");
    expect(main).toContain("q.get('screens') === 'binky'");
  });
});

describe('his look (kit.ts): the same puppet, reshaped', () => {
  it('reshapes with attributes and one wrapper only; idempotent; another ear variant only swaps the ears', () => {
    const p = new Bunny(mount(), { idle: false, interactive: false, reducedMotion: 'force' });
    const svg = svgOf(p);
    const partsBefore = svg.querySelectorAll('g').length;
    applyBinkyKit(svg, 'b');
    const once = svg.innerHTML;
    applyBinkyKit(svg, 'b');
    expect(svg.innerHTML).toBe(once);
    // every part the scenes and the welcome stage use is still there
    for (const sel of ['.hm', '.mover', '.hop', '.body', '.squash', '.breathe', '.tf', '.face', '.eyes .eye', '.eyes-star', '.eyes-happy', '.mouth', '.mouth-open', '.nose', '.paws .paw-l', '.paw-r', '.foot-l', '.foot-r', '.tail-l', '.tail-r', '.cheek-l .cheek-j', '.up .ear-l', '.lop .ear-l', '.shadow', '.fx']) {
      expect(svg.querySelector(sel), sel).not.toBeNull();
    }
    expect(svg.querySelectorAll('g').length).toBe(partsBefore + 1); // + the face wrapper (.bk-face)
    expect(svg.querySelector('.hm')?.classList.contains('ears-up')).toBe(true);
    applyBinkyKit(svg, 'a');
    const a = svg.innerHTML;
    expect(a).not.toBe(once);
    // only the up-ears' inner markup and the data-bk-ears attribute differ
    const strip = (s: string) => s.replace(/<g class="ear-[lr]">[\s\S]*?<\/g><\/g>/g, '').replace(/data-bk-ears="[abc]"/, '');
    expect(strip(a)).toBe(strip(once));
    p.destroy();
  });

  it('the scope class survives a scene reset (resetPose clears every other class of .hm)', () => {
    const p = new Bunny(mount(), { idle: false, interactive: false, reducedMotion: 'force' });
    applyBinkyKit(svgOf(p), 'b');
    p.pose('alert');
    p.pose('idle');
    expect(svgOf(p).classList.contains('bk')).toBe(true);
    expect(svgOf(p).querySelector('.hm')?.classList.contains('ears-up')).toBe(true);
  });

  it('tiny ears, close together: A < B, all three far below the package\'s upright ears (tip -206) and Mila\'s', () => {
    expect(earTop('a')).toBeGreaterThan(earTop('b'));
    for (const v of EAR_VARIANTS) {
      expect(earTop(v), v).toBeGreaterThan(-185); // ≤ 35 units over the head top (-150)
      expect(earTop(v), v).toBeLessThan(-160);
      const e = earShape(v);
      const xs = [...sample(e.outer), ...(e.flap ? sample(e.flap) : [])].map((q) => q[0]);
      // the left ear stays left of the centre line and close to it (roots at ±13 instead of ±21)
      expect(Math.max(...xs), v).toBeLessThan(0);
      expect(Math.min(...xs), v).toBeGreaterThan(-42);
    }
    expect(EAR_ROOT[0]).toBe(-13);
  });

  it('a loaf: lower than Pompon (top -150 vs -163), widest in the middle, no waist', () => {
    const pts = sample(BK_BODY_PTS);
    const ys = pts.map((q) => q[1]);
    expect(Math.min(...ys)).toBeGreaterThan(-152);
    expect(Math.min(...ys)).toBeLessThan(-148);
    const halfWidthAt = (y: number) => Math.max(...pts.filter((q) => Math.abs(q[1] - y) < 4).map((q) => Math.abs(q[0])));
    // monotonic from the head down to the middle (no neck, no waist), then rounding in towards the floor
    expect(halfWidthAt(-105)).toBeLessThan(halfWidthAt(-70));
    expect(halfWidthAt(-70)).toBeLessThan(halfWidthAt(-47));
    expect(halfWidthAt(-47)).toBeGreaterThan(halfWidthAt(-10));
    expect(halfWidthAt(-47)).toBeGreaterThan(74);
  });

  it('two coats: the photo\'s orange (default) and a lighter apricot, seven colours each', () => {
    expect(BK_COAT_IDS).toEqual(['ginger', 'apricot']);
    for (const c of BK_COAT_IDS) expect(BK_COATS[c].colors).toHaveLength(7);
  });
});

describe('the binky (binky.ts)', () => {
  const faces: BinkyFace[] = ['front', 'r', 'l'];

  it('is ≤ 2 s, finite, plays once: every track ends by BINKY_S, no loops, the beats in order', () => {
    expect(BINKY_S).toBeLessThanOrEqual(2);
    const b = BINKY_BEATS;
    expect([0, b.crouch, b.leave, b.top, b.land, b.bounce, b.settled, b.end]).toEqual([0, b.crouch, b.leave, b.top, b.land, b.bounce, b.settled, b.end].sort((x, y) => x - y));
    for (const face of faces) {
      const show = new BinkyShow(mount(), { size: 160, face });
      for (const tr of show.tracks) expect(tr.end, tr.name).toBeLessThanOrEqual(BINKY_S);
      for (const a of show.animations) {
        const t = a.effect?.getTiming();
        expect(t?.iterations ?? 1).toBe(1);
        expect(Number(t?.delay ?? 0) + Number(t?.duration ?? 0)).toBeLessThanOrEqual(BINKY_S * 1000 + 1);
      }
      show.destroy();
    }
  });

  it('animates only transform and opacity (every keyframe of every face and eye option)', () => {
    for (const face of faces) {
      for (const eyes of ['photo', 'star'] as const) {
        const svg = new BinkyShow(mount(), { size: 160, face, eyes }).svg;
        const tracks = authorBinky(binkyParts(svg), { face, eyes });
        for (const tr of tracks) {
          for (const c of tr.compile()) {
            for (const k of c.frames) for (const prop of Object.keys(k)) expect(ALLOWED.has(prop), `${tr.name}: ${prop}`).toBe(true);
            expect(c.timing.fill).toBe('forwards');
          }
        }
      }
    }
  });

  it('the ears only turn about their roots (rotation, never a shape change)', () => {
    const show = new BinkyShow(mount(), { size: 160 });
    for (const name of ['binky.earL', 'binky.earR']) {
      const tr = show.tracks.find((t) => t.name === name);
      expect(tr, name).toBeDefined();
      for (let t = 0; t <= BINKY_S; t += 0.05) expect(tr?.styleAt(t).transform ?? '', name).toMatch(/^rotate\(-?[\d.]+deg\)$/);
    }
  });

  it('in the air he is a loaf: up BINKY_H units, hind feet tucked, paws under the chest, shadow half and faint; at rest before and after', () => {
    for (const face of faces) {
      const show = new BinkyShow(mount(), { size: 160, face });
      const top = show.sample(BINKY_PEAK);
      expect(top['binky.hop']?.transform).toBe(`translate(0px, ${-BINKY_H}px)`);
      const sc = (s?: string) => Number(/scale\(([\d.]+)/.exec(s ?? '')?.[1] ?? 'NaN');
      expect(sc(top['binky.footL']?.transform)).toBeLessThan(0.8);
      expect(sc(top['binky.pawL']?.transform)).toBeLessThan(0.9);
      expect(sc(top['binky.shadow']?.transform)).toBeLessThan(0.7);
      expect(sc(top['binky.squash']?.transform)).toBeGreaterThan(1.05); // wider than tall
      const rest = (t: number) => show.sample(t);
      for (const t of [0, BINKY_S]) {
        expect(rest(t)['binky.hop']?.transform, `${face} t=${t}`).toBe('translate(0px, 0px)');
        expect(rest(t)['binky.squash']?.transform, `${face} t=${t}`).toBe('scale(1, 1)');
        expect(rest(t)['binky.shadow']?.opacity, `${face} t=${t}`).toBe('1');
      }
      show.destroy();
    }
  });

  it('seek(t) freezes every animation at t (deterministic frames)', () => {
    const show = new BinkyShow(mount(), { size: 160, face: 'r' });
    show.seek(0.66);
    expect(show.animations.length).toBeGreaterThan(10);
    for (const a of show.animations) {
      expect(a.playState).toBe('paused');
      expect(a.currentTime).toBe(660);
    }
    expect(show.sample(0.66)).toEqual(show.sample(0.66));
  });

  it('every part it moves exists on a plain puppet, a reshaped one and a welcome-stage-like actor', () => {
    const plain = new Bunny(mount(), { idle: false, interactive: false });
    expect(() => binkyParts(svgOf(plain))).not.toThrow();
    const reshaped = new Bunny(mount(), { idle: false, interactive: false });
    applyBinkyKit(svgOf(reshaped), 'c');
    expect(() => binkyParts(svgOf(reshaped))).not.toThrow();
  });
});

describe('reduced motion = the mid-air pose as a still', () => {
  it('BinkyShow: no animate() at all; the parts hold the pose at BINKY_PEAK inline; play() is over at once', async () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    for (const face of ['front', 'r'] as const) {
      const show = new BinkyShow(mount(), { size: 160, reduced: true, face });
      expect(show.animations).toHaveLength(0);
      const peak = show.sample(BINKY_PEAK);
      for (const tr of show.tracks) {
        for (const el of tr.els) {
          const st = (el as HTMLElement).style;
          if (peak[tr.name]?.transform) expect(st.transform, tr.name).toBe(peak[tr.name]?.transform);
          if (peak[tr.name]?.opacity) expect(st.opacity, tr.name).toBe(peak[tr.name]?.opacity);
        }
      }
      expect((binkyParts(show.svg).hop as HTMLElement).style.transform).toBe(`translate(0px, ${-BINKY_H}px)`);
      show.seek(1.2); // nothing moves
      expect((binkyParts(show.svg).hop as HTMLElement).style.transform).toBe(`translate(0px, ${-BINKY_H}px)`);
      await show.play();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('on a real puppet (the live cards): nothing happens', async () => {
    const p = new Bunny(mount(), { idle: false, interactive: false, reducedMotion: 'force' });
    applyBinkyKit(svgOf(p), 'b');
    const spy = vi.spyOn(Element.prototype, 'animate');
    const r = binkyOnPuppet(svgOf(p), { reduced: true });
    await r.done;
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('on a real puppet (binkyOnPuppet)', () => {
  it('plays once over his own CSS state and leaves nothing behind (animations cancelled, no inline styles)', async () => {
    vi.useFakeTimers();
    const p = new Bunny(mount(), { idle: false, interactive: false, reducedMotion: 'off' });
    const svg = svgOf(p);
    applyBinkyKit(svg, 'b');
    const before = svg.innerHTML;
    const r = binkyOnPuppet(svg, { face: 'front' });
    expect(svg.getAnimations({ subtree: true }).length).toBeGreaterThan(10);
    await vi.advanceTimersByTimeAsync(BINKY_S * 1000 + 50);
    await r.done;
    expect(svg.getAnimations({ subtree: true }).filter((a) => a.playState !== 'idle')).toHaveLength(0);
    expect(svg.innerHTML).toBe(before);
  });
});

describe('the gallery page (?screens=binky)', () => {
  function page(query: string): HTMLElement {
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
    binkyGallery(app, new URLSearchParams(query));
    return app;
  }

  it('shows him live, the three ear variants, the frames next to the photo slot, poses at 148 / 96 / 64 in light + dark, five themes, the family, names', () => {
    const app = page('screens=binky');
    expect(app.querySelectorAll('[data-ears]')).toHaveLength(3);
    expect(app.querySelector('[data-live]')).not.toBeNull();
    expect(app.querySelector('[data-compare] [data-ref]')).not.toBeNull();
    expect(app.querySelectorAll('[data-compare] [data-face]')).toHaveLength(2);
    const poses = app.querySelectorAll('[data-pose]');
    expect(poses.length).toBeGreaterThan(30);
    const themes = new Set([...app.querySelectorAll<HTMLElement>('.bk-panel')].map((p) => p.dataset['theme']));
    expect(themes.has('light') && themes.has('dark')).toBe(true);
    expect(app.textContent).toContain('Blau');
    expect(app.textContent).toContain('Ozean');
    expect(app.textContent).toContain('Schwarz');
    expect(app.textContent).toContain('Помпон');
    expect(app.textContent).toContain('Тапси');
    expect(NAMES).toHaveLength(3);
    for (const n of NAMES) expect(app.textContent).toContain(n.de);
    expect(app.textContent).toContain(ROLE);
  });

  it('every ear variant can be shown (&ears=a|b|c) and is the one the puppets wear', () => {
    for (const v of EAR_VARIANTS as readonly EarVariant[]) {
      document.body.replaceChildren();
      const app = page(`screens=binky&view=poses&ears=${v}`);
      const hosts = [...app.querySelectorAll<HTMLElement>('.bk-host')].filter((h) => h.shadowRoot?.querySelector('.hm'));
      expect(hosts.length).toBeGreaterThan(10);
      for (const h of hosts) expect(h.shadowRoot?.querySelector('.hm')?.getAttribute('data-bk-ears')).toBe(v);
    }
  });

  it('reduced motion: nobody runs — the binky cells are stills, nothing is playing', () => {
    const app = page('screens=binky&reduced=1&view=poses');
    const running = [...app.querySelectorAll<HTMLElement>('.bk-host')].flatMap((h) => h.shadowRoot?.querySelector('svg')?.getAnimations({ subtree: true }) ?? []).filter((a) => a.playState === 'running');
    expect(running).toHaveLength(0);
  });
});
