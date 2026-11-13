import { afterEach, describe, expect, it, vi } from 'vitest';
import { PH, PW, Panel } from '../demo/story/kit';
import { EPISODE, EPISODE_TITLE, ROLL, T, type PanelDef } from '../demo/story/panels';
// the v4 manga (episodes 1 + 2) lives in the package since 31.10 (src/comic/, the app's reader and the gallery)
import { PANELS, ROLL4, ROLL4_KEYS, buildManga, rollProgress4 } from '../src/comic/episode1';
import { PANELS2, buildManga2 } from '../src/comic/episode2';
import { IDEA, MANGA2_TEXTS, MANGA_TEXTS, ROLLING, SFX, T2 } from '../src/comic/texts';
import { storyGallery } from '../demo/story/gallery';
import { H, READ_AT, ROLL2, ROLL_KEYS, STRIP_TEXTS, W, buildStrip, readLineY, rollProgress, type Strip } from '../demo/story/strip';
import { FX_REGIONS, FX_SCENES } from '../demo/story/strip-fx';
import { LOC_STYLES, SAMPLE_SAY, SAMPLE_TEXTS, STYLE_NAMES, TEXT_STYLES, buildSample } from '../demo/story/strip-styles';
import type { FakeAnimation } from './setup';

// The comic, episode 1 «Ein Wunsch rollt an» (26.10, gallery-only storyboard, demo/story/): 7 panels drawn with the
// app's own puppets, real text (≤ 70 characters, German + Russian), ONE panel that comes alive (transform / opacity
// only, finite, deterministic under seek), stills without any animation (contact sheet, «Weniger»).
// v2 (30.10, strip.ts): the same story as ONE continuous scroll strip; the roll follows the scroll position.

const ALLOWED = ['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity'];

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  vi.restoreAllMocks();
});

function make(def: PanelDef, lang: 'de' | 'ru' = 'de'): Panel {
  const root = document.createElement('div');
  document.body.append(root);
  const p = new Panel(root);
  def.build(p, lang);
  return p;
}

const living = (): PanelDef => {
  const d = EPISODE.find((x) => x.alive);
  if (!d) throw new Error('no living panel');
  return d;
};

describe('episode 1: the plot as data', () => {
  it('6–7 panels, numbered in order, exactly one comes alive', () => {
    expect(EPISODE.length).toBeGreaterThanOrEqual(6);
    expect(EPISODE.length).toBeLessThanOrEqual(7);
    EPISODE.forEach((d, i) => expect(d.n).toBe(i + 1));
    expect(EPISODE.filter((d) => d.alive)).toHaveLength(1);
  });

  it('every text is short (≤ 70 characters) and has German and Russian', () => {
    const all = EPISODE.flatMap((d) => d.texts);
    expect(all.length).toBeGreaterThan(5);
    for (const t of all) {
      expect(t.de.trim().length).toBeGreaterThan(0);
      expect(t.ru.trim().length).toBeGreaterThan(0);
      expect(t.de.length).toBeLessThanOrEqual(70);
      expect(t.ru.length).toBeLessThanOrEqual(70);
    }
    for (const s of [EPISODE_TITLE.de, EPISODE_TITLE.ru, EPISODE_TITLE.end.de, EPISODE_TITLE.end.ru]) expect(s.length).toBeLessThanOrEqual(70);
  });

  it('the roles: WHEN (Pompon), WHAT (Tapsi), the secret, and the tagline at the end', () => {
    const de = EPISODE.map((d) => d.texts.map((t) => t.de).join(' '));
    expect(de[0]).toMatch(/Pompon weiß, wann/);
    expect(de[1]).toMatch(/Tapsi hütet die Wünsche/);
    expect(de.join(' ')).toMatch(/geheim/);
    expect(de[de.length - 1]).toMatch(/Pompon weiß, wann\. Tapsi weiß, was\./);
  });

  it('every panel has a one-sentence label for screen readers (de + ru) and a note for Felix', () => {
    for (const d of EPISODE) {
      expect(d.alt.de.length).toBeGreaterThan(20);
      expect(d.alt.ru.length).toBeGreaterThan(20);
      expect(d.note.length).toBeGreaterThan(20);
    }
  });
});

describe('the panels (our puppets, still images)', () => {
  it('each panel builds with at least one of the app\'s puppets, and its text is real text in the chosen language', () => {
    for (const d of EPISODE) {
      const p = make(d);
      // actor box > lift > spin > squash > host (the puppet's shadow root)
      const puppets = [...p.root.querySelectorAll('.sp-actor')].filter((a) => a.querySelector(':scope > div > div > div > div')?.shadowRoot?.querySelector('.hm'));
      expect(puppets.length, `panel ${d.n}`).toBeGreaterThan(0);
      const text = p.root.textContent ?? '';
      for (const t of d.texts) expect(text, `panel ${d.n}`).toContain(t.de);
      p.destroy();
      const ru = make(d, 'ru');
      for (const t of d.texts) expect(ru.root.textContent ?? '', `panel ${d.n} ru`).toContain(t.ru);
      ru.destroy();
    }
  });

  it('a still never calls animate() (the contact sheet and «Weniger» are plain inline styles)', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    for (const d of EPISODE) {
      const p = make(d);
      p.still();
      expect(p.animations).toHaveLength(0);
      p.destroy();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('destroy() empties the panel (the puppets are gone)', () => {
    const p = make(EPISODE[0] as PanelDef);
    expect(p.root.querySelector('.sp-actor')).not.toBeNull();
    p.destroy();
    expect(p.root.childElementCount).toBe(0);
  });
});

describe('the panel that comes alive (Hicks!)', () => {
  it('1–2 s, transform / opacity only, every animation finite', () => {
    const p = make(living());
    expect(p.duration).toBeGreaterThanOrEqual(1);
    expect(p.duration).toBeLessThanOrEqual(2);
    expect(p.end).toBeLessThanOrEqual(2);
    p.build();
    expect(p.animations.length).toBeGreaterThan(5);
    for (const a of p.animations) {
      const timing = (a.effect as KeyframeEffect).getTiming();
      expect(timing.iterations ?? 1).toBe(1);
      for (const k of (a.effect as KeyframeEffect).getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key))).toBe(true);
    }
  });

  it('deterministic: the same time gives the same frame, and seek() moves every animation together', () => {
    const a = make(living());
    const b = make(living());
    for (const t of [0, 0.2, 0.7, 1.1, ROLL.end]) {
      a.tracks.forEach((tr, i) => expect(tr.styleAt(t)).toEqual(b.tracks[i]?.styleAt(t)));
    }
    a.build();
    a.seek(0.9);
    for (const anim of a.animations) expect((anim as unknown as FakeAnimation).currentTime).toBe(900);
  });

  it('the still (end pose) is where the motion ends; the start is a different, finished picture', () => {
    const p = make(living());
    const travel = p.tracks.find((t) => t.name === 'tapsi.travel');
    expect(travel).toBeDefined();
    const start = travel?.sample(0) ?? {};
    const end = travel?.sample(p.duration) ?? {};
    expect(start.x ?? 0).toBe(0);
    expect(end.x ?? 0).toBeGreaterThan(100);
    // he ends inside the panel, and the trail is fully there in the still
    const last = ROLL.path[ROLL.path.length - 1];
    expect(last?.[1]).toBeLessThan(PW);
    expect(last?.[2]).toBeLessThan(PH);
    for (const tr of p.tracks.filter((t) => t.name.startsWith('p3.trail'))) expect(tr.sample(p.duration)).toMatchObject({ o: 1, sx: 1, sy: 1 });
    p.still();
    const box = travel?.els[0] as HTMLElement | undefined;
    expect(box?.style.transform).toContain(`${end.x}px`);
  });

  it('the roll turns clockwise as he goes down and right (a roll, not a slide)', () => {
    const p = make(living());
    const spin = p.tracks.find((t) => t.name === 'tapsi.spin');
    let prev = -1;
    for (let t = ROLL.start; t <= ROLL.end + 1e-9; t += 0.1) {
      const r = spin?.sample(t).r ?? 0;
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
    expect(prev).toBeGreaterThan(300);
  });
});

describe('the v1 gallery page (?screens=story&v=1)', () => {
  function page(query: string): HTMLDivElement {
    const app = document.createElement('div');
    document.body.append(app);
    storyGallery(app, new URLSearchParams(query));
    return app;
  }

  it('the contact sheet shows every panel with German + Russian texts, and the phone reader every page + the end', () => {
    const app = page('screens=story&v=1');
    const cards = app.querySelectorAll('.sp-sheet .sp-card');
    expect(cards).toHaveLength(EPISODE.length);
    expect(app.querySelector('.sp-sheet')?.textContent).toContain(EPISODE[0]?.texts[0]?.ru ?? '—');
    const pages = app.querySelectorAll('.sp-phone .sp-page-p');
    expect(pages).toHaveLength(EPISODE.length + 1);
    expect(app.querySelector('.sp-count')?.textContent).toBe(`1 / ${EPISODE.length}`);
    expect(app.querySelector('.sp-close')?.getAttribute('aria-label')).toBe('Schließen');
    // the living panel has its own play button + slider on the sheet
    expect(app.querySelectorAll('.sp-sheet .sp-bar button')).toHaveLength(1);
  });

  it('the living panel: its end pose on the sheet, its first frame in the reader (it comes alive only there, later)', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    page('screens=story&v=1');
    const actors = spy.mock.results.map((r) => r.value as unknown as FakeAnimation).filter((a) => a.id === 'tapsi.travel');
    expect(actors).toHaveLength(2);
    const [sheet, reader] = actors;
    const p = make(living());
    expect(p.duration).toBe(p.end);
    expect(sheet?.currentTime).toBeCloseTo(p.end * 1000, 6);
    expect(reader?.currentTime).toBe(0);
    expect(reader?.playState).toBe('paused');
  });

  it('&panel=3 shows one panel large with its controls; &panel=1 has none', () => {
    const big = page(`screens=story&v=1&panel=${living().n}`);
    expect(big.querySelectorAll('.sp-frame')).toHaveLength(1);
    expect(big.querySelector('.sp-bar button')).not.toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    const still = page('screens=story&v=1&panel=1');
    expect(still.querySelectorAll('.sp-frame')).toHaveLength(1);
    expect(still.querySelector('.sp-bar')).toBeNull();
  });

  it('«Weniger» (&reduced=1): the whole page without a single animation', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const app = page('screens=story&v=1&reduced=1');
    expect(app.querySelectorAll('.sp-frame').length).toBe(EPISODE.length * 2);
    expect(spy).not.toHaveBeenCalled();
    expect(app.querySelector('.sp-sheet .sp-bar button')).toBeNull();
  });

  it('&lang=ru puts the Russian texts into the panels', () => {
    const app = page('screens=story&v=1&view=reader&lang=ru');
    expect(app.querySelector('.sp-phone')?.textContent).toContain(EPISODE[0]?.texts[0]?.ru ?? '—');
    expect(app.querySelector('.sp-close')?.getAttribute('aria-label')).toBe('Закрыть');
  });

  it('leaving the page tears every panel down', () => {
    const app = page('screens=story&v=1');
    expect(app.querySelectorAll('.sp-actor').length).toBeGreaterThan(0);
    window.dispatchEvent(new Event('pagehide'));
    expect(app.querySelectorAll('.sp-actor')).toHaveLength(0);
  });
});

// ---- v2: the continuous strip (30.10) ---------------------------------------------------------------------------

describe('v2: one continuous strip (?screens=story)', () => {
  const made: Strip[] = [];
  afterEach(() => {
    made.forEach((s) => s.destroy());
    made.length = 0;
  });
  function strip(lang: 'de' | 'ru' = 'de', motion = true): Strip {
    const root = document.createElement('div');
    document.body.append(root);
    const s = buildStrip(root, lang, motion);
    made.push(s);
    return s;
  }
  /** Every puppet's shadow root in the strip (actor box > lift > spin > squash > host). */
  const puppets = (s: Strip): ShadowRoot[] => [...s.world.root.querySelectorAll('.sp-actor')]
    .map((a) => a.querySelector(':scope > div > div > div > div')?.shadowRoot)
    .filter((r): r is ShadowRoot => !!r);
  const page = (query: string): HTMLDivElement => {
    const app = document.createElement('div');
    document.body.append(app);
    storyGallery(app, new URLSearchParams(query));
    return app;
  };

  it('every text is short (≤ 70 characters), in German and Russian, and the same story beats as v1', () => {
    for (const t of STRIP_TEXTS) {
      expect(t.de.trim().length).toBeGreaterThan(0);
      expect(t.ru.trim().length).toBeGreaterThan(0);
      expect(t.de.length, t.de).toBeLessThanOrEqual(70);
      expect(t.ru.length, t.ru).toBeLessThanOrEqual(70);
    }
    // every text of the seven panels is in the strip
    for (const t of EPISODE.flatMap((d) => d.texts)) expect(STRIP_TEXTS).toContain(t);
    const de = strip('de').world.root.textContent ?? '';
    const ru = strip('ru').world.root.textContent ?? '';
    for (const t of STRIP_TEXTS) {
      expect(de, t.de).toContain(t.de);
      expect(ru, t.ru).toContain(t.ru);
    }
  });

  it('one picture: a single world of phone width, no frames, the puppets inside it', () => {
    const s = strip();
    expect(W).toBe(390);
    expect(H).toBeGreaterThan(3000);
    expect(s.world.root.style.width).toBe(`${W}px`);
    expect(s.world.root.style.height).toBe(`${H}px`);
    expect(s.world.root.querySelector('.sp-frame')).toBeNull();
    expect(puppets(s).length).toBeGreaterThanOrEqual(10);
  });

  it('the roll is the scroll: a pure function of the reading line, clamped to 0 … 1 and never going back', () => {
    expect(rollProgress(ROLL2.y0 - 300)).toBe(0);
    expect(rollProgress(ROLL2.y1 + 300)).toBe(1);
    let prev = -1;
    for (let y = ROLL2.y0 - 50; y <= ROLL2.y1 + 50; y += 7) {
      const p = rollProgress(y);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(rollProgress(y)).toBe(p);
      prev = p;
    }
    // the reading line: strip top 1000 px above the viewport, 844 px tall viewport, scale 1 → world y 1000 + 422
    expect(readLineY(-1000, 844, 1)).toBeCloseTo(1000 + 844 * READ_AT, 6);
    // a wider page scales the world: the same place in the story needs k times the scroll
    expect(readLineY(-1000 * 1.4, 844 * 1.4, 1.4)).toBeCloseTo(readLineY(-1000, 844, 1), 6);
  });

  it('deterministic: the same scroll offset gives the same frame, and seek() moves every roll animation together', () => {
    const a = strip();
    const b = strip();
    const ra = a.roll;
    const rb = b.roll;
    if (!ra || !rb) throw new Error('no roll');
    expect(ra.tracks.length).toBe(rb.tracks.length);
    for (const offset of [-900, -1100, -1300, -1500, -1700, -1900]) {
      const p = rollProgress(readLineY(offset, 844, 1));
      ra.tracks.forEach((tr, i) => expect(tr.styleAt(p)).toEqual(rb.tracks[i]?.styleAt(p)));
      ra.seek(p);
      expect(ra.animations.length).toBeGreaterThan(20);
      for (const anim of ra.animations) expect((anim as unknown as FakeAnimation).currentTime).toBeCloseTo(p * 1000, 6);
    }
  });

  it('he really rolls: from the hilltop down the slope to the moss in front of Pompon, landing upright', () => {
    const s = strip();
    const travel = s.roll?.tracks.find((t) => t.name === 'tapsi.travel');
    const spin = s.roll?.tracks.find((t) => t.name === 'tapsi.spin');
    expect(travel?.sample(0)).toMatchObject({ x: 0, y: 0 });
    expect(travel?.sample(1).y ?? 0).toBeGreaterThan(800);
    // going down all the way (the reader scrolls down, he goes down)
    let prev = -Infinity;
    for (const k of ROLL_KEYS) {
      expect(k.y).toBeGreaterThan(prev);
      prev = k.y;
    }
    const last = ROLL_KEYS[ROLL_KEYS.length - 1];
    expect(Math.abs((last?.spin ?? 1) % 360)).toBe(0);
    expect(Math.abs(spin?.sample(0.5).r ?? 0)).toBeGreaterThan(0);
    // he stays inside the strip's width the whole way
    for (const k of ROLL_KEYS) {
      expect(k.x).toBeGreaterThan(40);
      expect(k.x).toBeLessThan(W - 40);
    }
  });

  it('only transform / opacity, every animation finite; the moments last ≤ 2 s', () => {
    const s = strip();
    expect(s.moments.length).toBeGreaterThanOrEqual(3);
    for (const m of s.moments) expect(m.end).toBeLessThanOrEqual(2);
    const all = s.beats.flatMap((b) => b.animations);
    expect(all.length).toBeGreaterThan(30);
    for (const a of all) {
      const effect = a.effect as KeyframeEffect;
      expect(effect.getTiming().iterations ?? 1).toBe(1);
      for (const k of effect.getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key)), JSON.stringify(k)).toBe(true);
    }
  });

  it('reduced: nothing animates, the roll is told by three still Tapsis, every moment at its end', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const s = strip('de', false);
    expect(spy).not.toHaveBeenCalled();
    expect(s.roll).toBeNull();
    expect(s.moments).toHaveLength(0);
    expect(s.rollers).toBe(3);
    expect(strip('de', true).rollers).toBe(1);
    // "Hicks!" and the glitter trail are fully there in the still
    const hic = [...s.world.root.querySelectorAll<HTMLElement>('.sp-sfx')].find((e) => e.textContent === 'Hicks!');
    expect(hic?.style.opacity).toBe('1');
  });

  it('Mila is the approved lop-eared bunny (white with ginger patches) with a blossom — no upright ears anywhere', () => {
    const s = strip();
    const roots = puppets(s);
    const milas = roots.filter((r) => r.querySelector('.blossom'));
    expect(milas).toHaveLength(2);
    for (const r of milas) {
      expect(r.querySelector('.hm')?.classList.contains('ears-lop')).toBe(true);
      expect(r.querySelector('.hm')?.classList.contains('pat-broken')).toBe(true);
    }
    for (const r of roots) expect(r.querySelector('.hm')?.classList.contains('ears-up')).toBe(false);
  });

  it('the page: &v=2 is the strip (&v=1 the seven panels), &lang=ru, «Weniger» without a single animation', () => {
    const app = page('screens=story&v=2');
    expect(app.querySelectorAll('.sp2-frame')).toHaveLength(1);
    expect(app.querySelector('.sp-sheet')).toBeNull();
    expect(app.querySelector('a[href*="v=1"]')).not.toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    expect(page('screens=story&v=1').querySelectorAll('.sp-sheet .sp-card')).toHaveLength(EPISODE.length);
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    const ru = page('screens=story&v=2&lang=ru&view=reader');
    expect(ru.querySelector('.sp2-phone')?.textContent).toContain(EPISODE[0]?.texts[0]?.ru ?? '—');
    expect(ru.querySelector('.sp2-close')?.getAttribute('aria-label')).toBe('Закрыть');
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    const spy = vi.spyOn(Element.prototype, 'animate');
    page('screens=story&v=2&reduced=1');
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaving the page tears the strip down', () => {
    const app = page('screens=story&v=2');
    expect(app.querySelectorAll('.sp-actor').length).toBeGreaterThan(0);
    window.dispatchEvent(new Event('pagehide'));
    expect(app.querySelectorAll('.sp-actor')).toHaveLength(0);
  });
});

// ---- v3: frozen effects on the strip + the style samples (31.10) --------------------------------------------------

describe('v3: the frozen manga effects (strip-fx.ts)', () => {
  const made: Strip[] = [];
  afterEach(() => {
    made.forEach((s) => s.destroy());
    made.length = 0;
  });
  function strip(motion = true): Strip {
    const root = document.createElement('div');
    document.body.append(root);
    const s = buildStrip(root, 'de', motion);
    made.push(s);
    return s;
  }

  it('every scene has its own effects, in a layer apart from the picture (class sp2-fx, data-fx = scene)', () => {
    for (const motion of [true, false]) {
      const s = strip(motion);
      for (const scene of FX_SCENES) {
        const els = s.world.root.querySelectorAll(`.sp2-fx[data-fx="${scene}"]`);
        expect(els.length, `${scene} (${motion ? 'motion' : 'reduced'})`).toBeGreaterThanOrEqual(2);
      }
      // nothing else in the picture carries the class: the effects can be lifted out for the restyle
      for (const e of s.world.root.querySelectorAll('.sp2-fx')) expect(FX_SCENES).toContain((e as HTMLElement).dataset['fx']);
    }
  });

  it('with motion: each scene shimmers once (≤ 2 s), only transform / opacity, every animation finite', () => {
    const s = strip(true);
    for (const scene of FX_SCENES) {
      const beat = s.moments.find((m) => m.name === `fx-${scene}`);
      expect(beat, scene).toBeDefined();
      expect(beat?.end ?? 9).toBeLessThanOrEqual(2);
      expect(beat?.region).toEqual(FX_REGIONS[scene]);
    }
    const fxAnims = s.beats.filter((b) => b.name.startsWith('fx-') || b.name === 'roll').flatMap((b) => b.animations);
    expect(fxAnims.length).toBeGreaterThan(20);
    for (const a of fxAnims) {
      const effect = a.effect as KeyframeEffect;
      expect(effect.getTiming().iterations ?? 1).toBe(1);
      for (const k of effect.getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key)), JSON.stringify(k)).toBe(true);
    }
    // the roll's effects follow the scroll: speed lines appear only after he has passed
    const speed = s.roll?.tracks.find((t) => t.name === 'fx.speed0');
    expect(speed?.sample(0).o).toBe(0);
    expect(speed?.sample(1).o).toBe(1);
  });

  it('reduced: no animate() at all, every effect fully there (the shimmer at its end, the roll effects drawn)', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const s = strip(false);
    expect(spy).not.toHaveBeenCalled();
    const timed = [...s.world.root.querySelectorAll<HTMLElement>('.sp2-fx')].filter((e) => e.style.opacity !== '');
    expect(timed.length).toBeGreaterThan(10);
    // still pictures: the hand-over glints (Mila still holds the star out) and everything after the roll are visible
    for (const e of timed) expect(e.style.opacity, e.dataset['fx']).toBe('1');
  });
});

describe('v3: the style samples (?screens=story&view=styles)', () => {
  const page = (query: string): HTMLDivElement => {
    const app = document.createElement('div');
    document.body.append(app);
    storyGallery(app, new URLSearchParams(query));
    return app;
  };

  it('3 location styles × 3 text styles = 9 samples, labelled A1 … C3, each with our three puppets and the texts', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const app = page('screens=story&view=styles');
    const cards = [...app.querySelectorAll<HTMLElement>('.sp3-card')];
    expect(cards.map((c) => c.dataset['style'])).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3']);
    for (const c of cards) {
      const world = c.querySelector<HTMLElement>('.sp3-sample');
      expect(world?.classList.contains(`loc${c.dataset['style']?.[0]}`)).toBe(true);
      expect(world?.classList.contains(`tx${c.dataset['style']?.[1]}`)).toBe(true);
      expect(c.querySelectorAll('.sp-actor')).toHaveLength(3);
      // captions are set one sentence per line (<br>), so compare without whitespace
      for (const t of SAMPLE_TEXTS) expect(c.textContent?.replace(/\s+/g, ''), t.de).toContain(t.de.replace(/\s+/g, ''));
      expect(c.querySelectorAll('.cap')).toHaveLength(2);
      // the first caption is set as two lines: «wann» / «was»
      expect(c.querySelector('.cap br')).not.toBeNull();
      expect(c.querySelectorAll('.bub')).toHaveLength(1);
    }
    // still pictures only
    expect(spy).not.toHaveBeenCalled();
    // every line of the legend is there
    for (const k of [...LOC_STYLES, ...TEXT_STYLES.map((n) => `${n}` as const)]) expect(app.textContent).toContain(STYLE_NAMES[k]);
  });

  it('the three location styles are really different pictures, the texts ≤ 70 characters in German and Russian', () => {
    const backgrounds = LOC_STYLES.map((loc) => {
      const root = document.createElement('div');
      document.body.append(root);
      const smp = buildSample(root, loc, 1, 'de');
      const svg = root.querySelector('svg')?.innerHTML ?? '';
      smp.destroy();
      return svg;
    });
    expect(new Set(backgrounds).size).toBe(3);
    for (const b of backgrounds) expect(b.length).toBeGreaterThan(2000);
    for (const t of SAMPLE_TEXTS) {
      expect(t.de.length).toBeLessThanOrEqual(70);
      expect(t.ru.length).toBeLessThanOrEqual(70);
    }
    const ru = page('screens=story&view=styles&lang=ru');
    expect(ru.querySelector('.sp3-card')?.textContent).toContain(SAMPLE_SAY.ru);
  });

  it('the story page links to the samples; leaving the samples page tears them down', () => {
    const story = page('screens=story');
    expect(story.querySelector('a[href*="view=styles"]')).not.toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    const app = page('screens=story&view=styles');
    expect(app.querySelectorAll('.sp-actor').length).toBe(27);
    window.dispatchEvent(new Event('pagehide'));
    expect(app.querySelectorAll('.sp-actor')).toHaveLength(0);
  });
});

// ---- v4: the black-and-white manga ribbon with one spot colour (31.10) -------------------------------------------

describe('v4: the manga ribbon (?screens=story, manga.ts)', () => {
  const made: Strip[] = [];
  afterEach(() => {
    made.forEach((s) => s.destroy());
    made.length = 0;
  });
  function manga(lang: 'de' | 'ru' = 'de', motion = true): Strip {
    const root = document.createElement('div');
    document.body.append(root);
    const s = buildManga(root, lang, motion);
    made.push(s);
    return s;
  }
  const page = (query: string): HTMLDivElement => {
    const app = document.createElement('div');
    document.body.append(app);
    storyGallery(app, new URLSearchParams(query));
    return app;
  };
  /** Every puppet's shadow root (actor box > lift > spin > squash > host). */
  const puppets = (s: Strip): ShadowRoot[] => [...s.world.root.querySelectorAll('.sp-actor')]
    .map((a) => a.querySelector(':scope > div > div > div > div')?.shadowRoot)
    .filter((r): r is ShadowRoot => !!r);
  /** A colour literal → is it a neutral grey (r = g = b)? */
  const neutral = (c: string): boolean => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (hex?.[1]) {
      const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
      return h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6);
    }
    const rgb = /rgba?\(([^)]*)\)/.exec(c);
    if (rgb?.[1]) {
      const [r, g, b] = rgb[1].split(',').map((v) => Number(v.trim()));
      return r === g && g === b;
    }
    return true;
  };
  const COLOUR = /#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\)/g;

  it('every text: ≤ 70 characters, German and Russian, all of them in the ribbon (same beats as before)', () => {
    for (const t of MANGA_TEXTS) {
      expect(t.de.length, t.de).toBeLessThanOrEqual(70);
      expect(t.ru.length, t.ru).toBeLessThanOrEqual(70);
      expect(t.de.trim().length * t.ru.trim().length).toBeGreaterThan(0);
    }
    for (const t of EPISODE.flatMap((d) => d.texts)) expect(MANGA_TEXTS).toContain(t);
    const norm = (x: string): string => x.toUpperCase().replace(/[\s-]+/g, '');
    for (const lang of ['de', 'ru'] as const) {
      const text = norm(manga(lang).world.root.textContent ?? '');
      for (const t of MANGA_TEXTS) expect(text, `${lang}: ${t[lang]}`).toContain(norm(t[lang]));
    }
  });

  it('panels of different shapes on one ribbon: clipped panels in reading order, a cloud, a tall diagonal one, break-outs', () => {
    const s = manga();
    const els = [...s.world.root.querySelectorAll<HTMLElement>('.m4-panel')];
    expect(els.map((e) => e.dataset['panel'])).toEqual(PANELS.map((p) => p.id));
    for (const e of els) expect(e.style.clipPath).toMatch(/^(polygon|path)\(/);
    expect(els.find((e) => e.dataset['panel'] === 'p3')?.style.clipPath).toMatch(/^path\(/);
    // angled borders: most panels are not plain rectangles
    const slanted = PANELS.filter((p) => p.pts.length && new Set(p.pts.map(([, y]) => y)).size > 2);
    expect(slanted.length).toBeGreaterThanOrEqual(8);
    // the roll's panel: tall and diagonal
    const p7 = PANELS.find((p) => p.id === 'p7')?.pts ?? [];
    const ys = p7.map(([, y]) => y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(800);
    expect(new Set(p7.map(([x]) => x)).size).toBeGreaterThan(2);
    // reading order: each panel starts no higher than the one before (side-by-side panels share a row)
    let prev = -Infinity;
    for (const p of PANELS.filter((x) => x.pts.length)) {
      const top = Math.min(...p.pts.map(([, y]) => y));
      expect(top + 140).toBeGreaterThan(prev);
      prev = Math.max(prev, top);
    }
    // break-outs: the shout and the landing sound sit outside any panel; Tapsi's panel is clipped above its border
    expect(s.world.root.querySelector('[data-say="hicks"]')?.closest('.m4-panel')).toBeNull();
    expect(s.world.root.querySelector('[data-say="land"]')?.closest('.m4-panel')).toBeNull();
    expect(els.find((e) => e.dataset['panel'] === 'p12')?.style.clipPath).toContain('2930px');
  });

  it('black and white + ONE spot colour: every colour sits in a data-spot group (star, door 14, +1, heart)', () => {
    const s = manga();
    const spots = new Set<string>();
    const check = (scope: ParentNode): void => {
      for (const el of scope.querySelectorAll('*')) {
        const attrs = ['fill', 'stroke', 'stop-color', 'flood-color', 'style'].map((a) => el.getAttribute(a) ?? '').join(' ');
        const colours = attrs.match(COLOUR) ?? [];
        const coloured = colours.filter((c) => !neutral(c));
        if (!coloured.length) continue;
        const spot = el.closest<HTMLElement | SVGElement>('[data-spot]');
        expect(spot, `${el.tagName} ${coloured.join(',')}`).not.toBeNull();
        spots.add(spot?.getAttribute('data-spot') ?? '');
      }
    };
    check(s.world.root);
    // the drawings worn by the puppets (inside their shadow roots) follow the same rule
    for (const r of puppets(s)) for (const w of r.querySelectorAll('.m4-worn')) check(w);
    expect([...spots].sort()).toEqual(['door14', 'heart', 'plus1', 'star']);
  });

  it('our puppets in ink: every one is the app puppet with the ink style (white, contour filter, tone)', () => {
    const s = manga();
    const roots = puppets(s);
    expect(roots.length).toBeGreaterThanOrEqual(15);
    for (const r of roots) {
      const css = [...r.querySelectorAll('style')].map((x) => x.textContent ?? '').find((x) => x.includes('#ink-e')) ?? '';
      expect(css).toMatch(/\.hop \{ filter: url\(#ink-e\d+\)/);
      for (const c of css.match(COLOUR) ?? []) expect(neutral(c), c).toBe(true);
      expect(r.querySelector('.hm')?.classList.contains('ears-up')).toBe(false);
    }
    // Mila: lop ears, coat 'broken' (patches as tone), an ink blossom
    const milas = roots.filter((r) => r.querySelector('.blossom'));
    expect(milas.length).toBeGreaterThanOrEqual(3);
    for (const r of milas) expect(r.querySelector('.hm')?.classList.contains('pat-broken')).toBe(true);
  });

  it('with motion: every panel comes alive once (≤ 2 s), only transform / opacity, every animation finite', () => {
    const s = manga();
    expect(s.moments.length).toBeGreaterThanOrEqual(10);
    for (const m of s.moments) {
      expect(m.end, m.name).toBeLessThanOrEqual(2);
      expect(m.region.y1).toBeGreaterThan(m.region.y0);
    }
    const all = s.beats.flatMap((b) => b.animations);
    expect(all.length).toBeGreaterThan(40);
    for (const a of all) {
      const effect = a.effect as KeyframeEffect;
      expect(effect.getTiming().iterations ?? 1).toBe(1);
      for (const k of effect.getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key)), JSON.stringify(k)).toBe(true);
    }
  });

  it('the roll follows the scroll inside its diagonal panel: pure, clamped, deterministic', () => {
    expect(rollProgress4(ROLL4.y0 - 100)).toBe(0);
    expect(rollProgress4(ROLL4.y1 + 100)).toBe(1);
    let prev = -1;
    for (let y = ROLL4.y0 - 20; y <= ROLL4.y1 + 20; y += 9) {
      expect(rollProgress4(y)).toBeGreaterThanOrEqual(prev);
      prev = rollProgress4(y);
    }
    const a = manga();
    const b = manga();
    expect(a.rollAt).toBe(rollProgress4);
    const ra = a.roll;
    const rb = b.roll;
    if (!ra || !rb) throw new Error('no roll');
    for (const offset of [-1100, -1400, -1700]) {
      const p = rollProgress4(readLineY(offset, 844, 1));
      ra.tracks.forEach((tr, i) => expect(tr.styleAt(p)).toEqual(rb.tracks[i]?.styleAt(p)));
      ra.seek(p);
      for (const anim of ra.animations) expect((anim as unknown as FakeAnimation).currentTime).toBeCloseTo(p * 1000, 6);
    }
    // the rolling Tapsi lives inside the diagonal panel and ends upright at its bottom
    const box = ra.tracks.find((t) => t.name.endsWith('.travel'))?.els[0] as HTMLElement | undefined;
    expect(box?.closest<HTMLElement>('.m4-panel')?.dataset['panel']).toBe('p7');
    expect(Math.abs((ROLL4_KEYS[ROLL4_KEYS.length - 1]?.spin ?? 1) % 360)).toBe(0);
  });

  it('reduced: not a single animate(), every panel and effect still there and fully visible', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const s = manga('de', false);
    expect(spy).not.toHaveBeenCalled();
    expect(s.roll).toBeNull();
    expect(s.moments).toHaveLength(0);
    expect(s.world.root.querySelectorAll('.m4-panel')).toHaveLength(PANELS.length);
    const fxEls = [...s.world.root.querySelectorAll<HTMLElement>('.sp4-fx')];
    expect(fxEls.length).toBeGreaterThan(15);
    for (const e of fxEls) if (e.style.opacity !== '') expect(e.style.opacity, e.dataset['fx']).toBe('1');
  });

  it('a clearer middle (31.10): roll narration, a ✧ trail, ghosts in the still, the star held, the idea, MAMPF', () => {
    const panelOf = (s: Strip, id: string): HTMLElement | null => s.world.root.querySelector<HTMLElement>(`.m4-panel[data-panel="${id}"]`);
    const still = manga('de', false);
    const text = (still.world.root.textContent ?? '').replace(/\s+/g, ' ');
    for (const t of [ROLLING, IDEA]) expect(text).toContain(t.de.toUpperCase() === t.de ? t.de : t.de.split(' ')[0]);
    // the roll panel: a dense trail of ✧ along the path, the burrow wall at its bottom (doors 15, 16), two faint ghosts
    const p7 = panelOf(still, 'p7');
    expect(p7?.querySelectorAll('.sp4-fx[data-fx="p7"]').length).toBeGreaterThanOrEqual(10);
    expect(p7?.textContent).toMatch(/15[\s\S]*16/);
    const ghosts = [...(p7?.querySelectorAll<HTMLElement>('.m4-ghost') ?? [])];
    expect(ghosts).toHaveLength(2);
    for (const g of ghosts) expect(Number(g.style.opacity)).toBeLessThan(0.4);
    expect(still.rollers).toBe(3);
    // the landing: Tapsi still HOLDS the star on his belly (well below his mouth at y ≈ -83 units), the card lies next to him
    const p8 = panelOf(still, 'p8');
    const tapsi8 = [...(p8?.querySelectorAll('.sp-actor') ?? [])]
      .map((a) => a.querySelector(':scope > div > div > div > div')?.shadowRoot)
      .find((r) => r?.querySelector('.m4-worn [data-spot="star"]'));
    const held = tapsi8?.querySelector<SVGGElement>('.m4-worn');
    const y = Number(/translate\(\S+ (-?[\d.]+)\)/.exec(held?.getAttribute('transform') ?? '')?.[1]);
    expect(y).toBeGreaterThan(-50);
    expect(p8?.querySelector('[data-spot="star"]') ?? held).not.toBeNull();
    // the idea and MAMPF: their own beats between the choice and the secret, the star going into the cheek
    const ids = PANELS.map((p) => p.id);
    expect(ids.indexOf('p9b')).toBeLessThan(ids.indexOf('p10'));
    expect(ids.indexOf('p10b')).toBe(ids.indexOf('p10') + 1);
    expect(ids.indexOf('p10b')).toBeLessThan(ids.indexOf('p12'));
    expect(still.world.root.querySelector('[data-say="eat"]')?.textContent).toContain(SFX.eat.de);
    const p10b = panelOf(still, 'p10b');
    const cheek = [...(p10b?.querySelectorAll('.sp-actor') ?? [])].some((a) => a.querySelector(':scope > div > div > div > div')?.shadowRoot?.querySelector('.cheek-l [data-spot="star"]'));
    expect(cheek).toBe(true);
    // with motion the MAMPF beat comes alive once (≤ 2 s): the star flies into the cheek
    const moving = manga('de', true);
    const beat = moving.moments.find((m) => m.name === 'p10b');
    expect(beat?.end ?? 9).toBeLessThanOrEqual(2);
    const fly = beat?.tracks.find((t) => t.name === 'p10b.fly');
    expect(fly?.sample(0).o).toBe(1);
    expect(fly?.sample(beat?.end ?? 2).o).toBe(0);
  });

  it('no cramped panels on a 390 px phone: every panel at least 110 px wide and 110 px tall, gutters between rows', () => {
    for (const p of PANELS.filter((x) => x.pts.length)) {
      const xs = p.pts.map(([x]) => x);
      const ys = p.pts.map(([, y]) => y);
      expect(Math.max(...xs) - Math.min(...xs), p.id).toBeGreaterThanOrEqual(110);
      expect(Math.max(...ys) - Math.min(...ys), p.id).toBeGreaterThanOrEqual(110);
      for (const [x] of p.pts) expect(x >= 12 && x <= 378, p.id).toBe(true);
    }
  });

  it('the page: ?screens=story is the manga (v4); &v=2 the strip, &view=styles the samples, &v=1 the panels', () => {
    const app = page('screens=story');
    expect(app.querySelector('.sp2-frame.m4f .m4')).not.toBeNull();
    for (const href of ['v=2', 'view=styles', 'v=1']) expect(app.querySelector(`a[href*="${href}"]`), href).not.toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    const v2 = page('screens=story&v=2');
    expect(v2.querySelector('.sp2-world')).not.toBeNull();
    expect(v2.querySelector('.m4')).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    const ru = page('screens=story&view=reader&lang=ru');
    expect(ru.querySelector('.sp2-phone.m4f')?.textContent).toContain(T.p1.ru);
    window.dispatchEvent(new Event('pagehide'));
    expect(ru.querySelectorAll('.sp-actor')).toHaveLength(0);
  });
});

// ---- episode 2 «Zweimal derselbe Schal» (31.10, manga2.ts) ---------------------------------------------------------

describe('episode 2: the manga (?screens=story&ep=2)', () => {
  const made: Strip[] = [];
  afterEach(() => {
    made.forEach((s) => s.destroy());
    made.length = 0;
  });
  function ep2(lang: 'de' | 'ru' = 'de', motion = true): Strip {
    const root = document.createElement('div');
    document.body.append(root);
    const s = buildManga2(root, lang, motion);
    made.push(s);
    return s;
  }
  const page = (query: string): HTMLDivElement => {
    const app = document.createElement('div');
    document.body.append(app);
    storyGallery(app, new URLSearchParams(query));
    return app;
  };
  const shadow = (a: Element): ShadowRoot | null | undefined => a.querySelector(':scope > div > div > div > div')?.shadowRoot;
  const neutral = (c: string): boolean => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
    if (hex?.[1]) {
      const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
      return h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6);
    }
    const rgb = /rgba?\(([^)]*)\)/.exec(c);
    if (rgb?.[1]) {
      const [r, g, b] = rgb[1].split(',').map((v) => Number(v.trim()));
      return r === g && g === b;
    }
    return true;
  };
  const COLOUR = /#[0-9a-fA-F]{3,6}\b|rgba?\([^)]*\)/g;

  it('every text: ≤ 70 characters, German and Russian, all of them in the ribbon', () => {
    for (const t of MANGA2_TEXTS) {
      expect(t.de.length, t.de).toBeLessThanOrEqual(70);
      expect(t.ru.length, t.ru).toBeLessThanOrEqual(70);
      expect(t.de.trim().length * t.ru.trim().length).toBeGreaterThan(0);
    }
    const norm = (x: string): string => x.toUpperCase().replace(/[\s-]+/g, '');
    for (const lang of ['de', 'ru'] as const) {
      const text = norm(ep2(lang).world.root.textContent ?? '');
      for (const t of MANGA2_TEXTS) expect(text, `${lang}: ${t[lang]}`).toContain(norm(t[lang]));
    }
  });

  it('the beats of the secret reservation are there in order: same scarf twice, the freeze, the idea, MAMPF, two views', () => {
    const s = ep2('de', false);
    const ids = [...s.world.root.querySelectorAll<HTMLElement>('.m4-panel')].map((e) => e.dataset['panel']);
    expect(ids).toEqual(PANELS2.map((p) => p.id));
    // the two guests carry the SAME parcel and give the SAME scarf
    const e3 = s.world.root.querySelector('.m4-panel[data-panel="e3"]');
    const scarves = [...(e3?.querySelectorAll('svg') ?? [])].map((x) => x.innerHTML).filter((h) => h.includes('stroke-dasharray') === false && h.includes('url(#m5-t4)') && h.includes('C-28 26 28 26 56 -24'));
    expect(scarves.length).toBe(2);
    // the comparison: the friends see two taken places, Momo sees all three wishes
    const stars = (id: string): number => s.world.root.querySelectorAll(`.m4-panel[data-panel="${id}"] [data-spot="star"]`).length;
    const taken = (id: string): number => [...s.world.root.querySelectorAll(`.m4-panel[data-panel="${id}"] svg`)].filter((x) => x.innerHTML.includes('stroke-dasharray="3.5 3"')).length;
    expect(stars('e12a')).toBe(1);
    expect(taken('e12a')).toBe(2);
    expect(stars('e12b')).toBe(3);
    expect(taken('e12b')).toBe(0);
    // MAMPF twice, and the stars end up in Tapsi's cheeks
    expect(s.world.root.querySelectorAll('[data-say="eat"]').length).toBeGreaterThanOrEqual(1);
    const cheeks = [...s.world.root.querySelectorAll('.sp-actor')].filter((a) => shadow(a)?.querySelector('.cheek-l [data-spot="star"], .cheek-r [data-spot="star"]'));
    expect(cheeks.length).toBeGreaterThanOrEqual(3);
  });

  it('black and white + ONE spot colour: only the wish stars and the birthday door 21', () => {
    const s = ep2();
    const spots = new Set<string>();
    const check = (scope: ParentNode): void => {
      for (const el of scope.querySelectorAll('*')) {
        const attrs = ['fill', 'stroke', 'stop-color', 'flood-color', 'style'].map((a) => el.getAttribute(a) ?? '').join(' ');
        const coloured = (attrs.match(COLOUR) ?? []).filter((c) => !neutral(c));
        if (!coloured.length) continue;
        const spot = el.closest('[data-spot]');
        expect(spot, `${el.tagName} ${coloured.join(',')}`).not.toBeNull();
        spots.add(spot?.getAttribute('data-spot') ?? '');
      }
    };
    check(s.world.root);
    for (const a of s.world.root.querySelectorAll('.sp-actor')) for (const w of shadow(a)?.querySelectorAll('.m4-worn') ?? []) check(w);
    expect([...spots].sort()).toEqual(['door', 'star']);
  });

  it('no upright ears anywhere; Momo is our lop-eared bunny with a party hat and cross-hatched ears', () => {
    const s = ep2();
    const roots = [...s.world.root.querySelectorAll('.sp-actor')].map(shadow).filter((r): r is ShadowRoot => !!r);
    expect(roots.length).toBeGreaterThanOrEqual(25);
    for (const r of roots) expect(r.querySelector('.hm')?.classList.contains('ears-up')).toBe(false);
    const momos = roots.filter((r) => r.querySelector('.m4-worn path[d^="M-18 -158"]'));
    expect(momos.length).toBeGreaterThanOrEqual(5);
    for (const r of momos) {
      expect(r.querySelector('.hm')?.classList.contains('ears-lop')).toBe(true);
      expect([...r.querySelectorAll('pattern')].some((p) => p.innerHTML.includes('M0 0 V4 M0 0 H4'))).toBe(true);
    }
  });

  it('every panel comes alive once (≤ 2 s), only transform / opacity, finite; no scroll-linked roll here', () => {
    const s = ep2();
    expect(s.roll).toBeNull();
    expect(s.moments.length).toBeGreaterThanOrEqual(15);
    for (const m of s.moments) {
      expect(m.end, m.name).toBeLessThanOrEqual(2);
      expect(m.region.y1, m.name).toBeGreaterThan(m.region.y0);
    }
    const all = s.beats.flatMap((b) => b.animations);
    expect(all.length).toBeGreaterThan(40);
    for (const a of all) {
      const effect = a.effect as KeyframeEffect;
      expect(effect.getTiming().iterations ?? 1).toBe(1);
      for (const k of effect.getKeyframes()) expect(Object.keys(k).every((key) => ALLOWED.includes(key)), JSON.stringify(k)).toBe(true);
    }
  });

  it('reduced: not a single animate(), every panel there, every effect fully visible', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const s = ep2('ru', false);
    expect(spy).not.toHaveBeenCalled();
    expect(s.moments).toHaveLength(0);
    expect(s.world.root.querySelectorAll('.m4-panel')).toHaveLength(PANELS2.length);
    for (const e of s.world.root.querySelectorAll<HTMLElement>('.sp4-fx')) if (e.style.opacity !== '') expect(e.style.opacity, e.dataset['fx']).toBe('1');
  });

  it('no cramped panels on a 390 px phone: every panel ≥ 110 × 110 px, inside the gutters', () => {
    for (const p of PANELS2) {
      const xs = p.pts.map(([x]) => x);
      const ys = p.pts.map(([, y]) => y);
      expect(Math.max(...xs) - Math.min(...xs), p.id).toBeGreaterThanOrEqual(110);
      expect(Math.max(...ys) - Math.min(...ys), p.id).toBeGreaterThanOrEqual(110);
      for (const [x] of p.pts) expect(x >= 12 && x <= 378, p.id).toBe(true);
    }
  });

  it('routing: &ep=2 shows episode 2, episode 1 stays the default; the switch and the «Weiter: Folge 2 →» link', () => {
    const one = page('screens=story');
    expect(one.querySelector('.m4')?.getAttribute('data-ep')).toBeNull();
    expect(one.querySelector('.sp2-eps b')?.textContent).toBe('Folge 1');
    expect(one.querySelector('.sp2-eps a')?.getAttribute('href')).toContain('ep=2');
    expect(one.querySelector('.sp2-foot a.main')?.getAttribute('href')).toContain('ep=2');
    expect(one.querySelector('.sp2-foot a.main')?.textContent).toBe('Weiter: Folge 2 →');
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    const two = page('screens=story&ep=2&lang=ru');
    expect(two.querySelector('.m4')?.getAttribute('data-ep')).toBe('2');
    expect(two.querySelector('.sp2-eps b')?.textContent).toBe('Серия 2');
    expect(two.querySelector('.sp2-eps a')?.getAttribute('href')).not.toContain('ep=2');
    expect(two.querySelector('.sp2-foot button.main')?.hasAttribute('disabled')).toBe(true);
    expect(two.textContent).toContain(T2.e1.ru.split('.')[0] ?? '—');
    window.dispatchEvent(new Event('pagehide'));
    expect(two.querySelectorAll('.sp-actor')).toHaveLength(0);
    document.body.replaceChildren();
    const reader = page('screens=story&ep=2&view=reader');
    expect(reader.querySelector('.sp2-phone .m4')?.getAttribute('data-ep')).toBe('2');
    expect(reader.querySelector('.sp2-top small')?.textContent).toBe(T2.folge.de);
  });
});
