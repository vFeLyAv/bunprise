import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComicView, COMIC_LANGS, COMIC_WIDTH, EPISODES, MANGA2_TEXTS, MANGA_TEXTS, type ComicLang } from '../src/comic';
import { ALT1, ALT2 } from '../src/comic/texts';
import type { FakeAnimation } from './setup';

// The comic «Pompon & Tapsi» as the package's opt-in module (src/comic/, 31.10): the app's reader builds on it.
// The gallery's own tests (story.test.ts) check the drawings, the one spot colour, the ink puppets and the pages.

const here = dirname(fileURLToPath(import.meta.url));
const views: ComicView[] = [];
afterEach(() => {
  views.splice(0).forEach((v) => v.destroy());
  document.body.replaceChildren();
  vi.useRealTimers();
});

function view(episode: 1 | 2, lang: ComicLang = 'de', motion = true): ComicView {
  const host = document.createElement('div');
  document.body.append(host);
  const v = new ComicView(host, { episode, lang, motion });
  views.push(v);
  return v;
}

describe('the texts: four languages, short, the names as the app spells them', () => {
  const all = [...MANGA_TEXTS, ...MANGA2_TEXTS];

  it('every text has DE, EN, RU and UK, none empty, each ≤ 70 characters', () => {
    expect([...COMIC_LANGS]).toEqual(['de', 'en', 'ru', 'uk']);
    for (const t of all) {
      for (const lang of COMIC_LANGS) {
        expect(t[lang].trim().length, `${lang}: ${t.de}`).toBeGreaterThan(0);
        expect(t[lang].length, `${lang}: ${t[lang]}`).toBeLessThanOrEqual(70);
      }
    }
  });

  it('Russian and Ukrainian are written in Cyrillic, with the names Тапси / Тапсі, Мила / Міла', () => {
    for (const t of all) {
      for (const lang of ['ru', 'uk'] as const) expect(/[A-Za-z]/.test(t[lang]), `${lang}: ${t[lang]}`).toBe(false);
    }
    const ru = all.map((t) => t.ru).join(' ');
    const uk = all.map((t) => t.uk).join(' ');
    expect(ru).toContain('Тапси');
    expect(ru).toContain('Милы');
    expect(uk).toContain('Тапсі');
    expect(uk).toContain('Міли');
    // Ukrainian, not Russian: no ы / э / ъ / ё
    expect(/[ыэъё]/i.test(uk)).toBe(false);
  });

  it('every screen-reader sentence exists in all four languages', () => {
    for (const alt of [...Object.values(ALT1), ...Object.values(ALT2)]) {
      for (const lang of COMIC_LANGS) expect(alt[lang].length, `${lang}: ${alt.de}`).toBeGreaterThan(20);
    }
  });

  it('episodes 1 and 2 build in English and Ukrainian with every one of their texts in the ribbon', () => {
    const norm = (x: string): string => x.toUpperCase().replace(/[\s-]+/g, '');
    for (const lang of ['en', 'uk'] as const) {
      for (const [ep, texts] of [[1, MANGA_TEXTS], [2, MANGA2_TEXTS]] as const) {
        const v = view(ep, lang, false);
        const text = norm(v.frame.textContent ?? '');
        for (const t of texts) expect(text, `${lang} ep ${ep}: ${t[lang]}`).toContain(norm(t[lang]));
        v.destroy();
      }
    }
  });
});

describe('ComicView: one episode in a scaled frame', () => {
  it('a labelled group in the language of its texts, scaled to the width it is given', () => {
    const v = view(1, 'ru');
    expect(v.frame.getAttribute('role')).toBe('group');
    expect(v.frame.getAttribute('aria-label')).toBe(`Pompon & Tapsi · ${EPISODES[1].folge.ru}`);
    expect(v.frame.lang).toBe('ru');
    expect(v.scale).toBe(1);
    expect(parseFloat(v.frame.style.width)).toBe(COMIC_WIDTH);
    v.fit(COMIC_WIDTH * 1.5);
    expect(v.scale).toBeCloseTo(1.5);
    expect(parseFloat(v.frame.style.height)).toBeCloseTo(v.height * 1.5, 1);
    v.fit(100);
    expect(v.scale).toBe(0.6);
  });

  it('the panels in reading order; the reading line maps to a panel and back', () => {
    for (const ep of [1, 2] as const) {
      const v = view(ep);
      expect(v.panels.length).toBeGreaterThanOrEqual(14);
      let prev = -Infinity;
      for (const [i, p] of v.panels.entries()) {
        expect(p.y1).toBeGreaterThan(p.y0);
        expect(p.y0 + 140).toBeGreaterThan(prev);
        prev = Math.max(prev, p.y0);
        expect(v.panelAt(p.y0 + 1)).toBeGreaterThanOrEqual(i - 1);
      }
      expect(v.panelAt(-100)).toBe(0);
      expect(v.panelAt(v.height)).toBe(v.panels.length - 1);
      expect(v.panelTop(0)).toBeGreaterThanOrEqual(0);
      expect(v.panelTop(5)).toBeGreaterThan(v.panelTop(1));
    }
  });

  it('reduced: not a single animate(), no moments, no roll', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    for (const ep of [1, 2] as const) {
      const v = view(ep, 'uk', false);
      expect(v.strip.moments).toHaveLength(0);
      expect(v.strip.roll).toBeNull();
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('driven by a scroller: the panel in view comes alive once; the page goes hidden → it freezes, visible → runs on', () => {
    vi.useFakeTimers();
    const scroller = document.createElement('div');
    document.body.append(scroller);
    const v = new ComicView(scroller, { episode: 2, lang: 'de', motion: true });
    views.push(v);
    // jsdom has no layout: the frame starts at the scroller's top, the view is 600 px tall
    Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });
    const seen: Array<{ share: number; panel: number; end: boolean }> = [];
    v.drive(scroller, (info) => seen.push(info));
    expect(seen.length).toBe(1);
    expect(seen[0]?.panel).toBe(0);
    expect(seen[0]?.end).toBe(false);
    const first = v.strip.moments.find((m) => m.name === 'e1');
    expect(first?.played).toBe(true);
    expect(first?.running).toBe(true);
    // hidden: the running moment pauses (its animations stop where they are)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(first?.running).toBe(false);
    for (const a of (first?.animations ?? []) as unknown as FakeAnimation[]) expect(a.playState).not.toBe('running');
    // visible again: it runs on to its end
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(first?.running).toBe(true);
    vi.advanceTimersByTime(2100);
    expect(first?.running).toBe(false);
    visibility.mockRestore();
    // stop(): nothing follows the scroller any more
    v.stop();
    const before = seen.length;
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(50);
    expect(seen.length).toBe(before);
  });

  it('destroy() removes the frame, its style and every puppet', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const v = new ComicView(host, { episode: 1, lang: 'en', motion: true });
    expect(host.querySelectorAll('.sp-actor').length).toBeGreaterThan(10);
    expect(host.querySelector('style')?.textContent).toContain('.m4-bal');
    v.destroy();
    expect(host.childElementCount).toBe(0);
  });
});

describe('opt-in: the comic is a module of its own', () => {
  it('nothing in src/comic imports the package index (no custom-element side effect, no welcome stage …)', () => {
    const dir = resolve(here, '../src/comic');
    for (const file of readdirSync(dir)) {
      const src = readFileSync(resolve(dir, file), 'utf8');
      expect(src, file).not.toMatch(/from '\.\.\/index'|from '\.\.\/element'|from '\.\.\/welcome/);
    }
  });

  it('the package exports it as @bunprise/mascot/comic', () => {
    const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { exports: Record<string, string> };
    expect(pkg.exports['./comic']).toBe('./src/comic/index.ts');
  });
});
