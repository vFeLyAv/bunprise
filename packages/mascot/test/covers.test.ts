import { afterEach, describe, expect, it } from 'vitest';
import { CROPS, coverMarkup, coverSvg } from '../demo/covers/art';
import { BLOCKED, RULES, easterSunday, explainTheme, holidayOf, nearlyContains, normalizeTitle, oneSlip, themeOf } from '../demo/covers/detect';
import { coversGallery, feedCard } from '../demo/covers/gallery';
import { PALETTE, PALETTE_KEYS, paletteCss } from '../demo/covers/palette';
import { SAMPLE_TITLES } from '../demo/covers/samples';
import { THEMES, THEME_IDS, THEME_PRIORITY, isThemeId } from '../demo/covers/themes';

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  delete document.documentElement.dataset.theme;
});

/** gzip size through the platform's CompressionStream (null when the environment has none). */
async function gzipSize(text: string): Promise<number | null> {
  if (typeof CompressionStream !== 'function' || typeof Response !== 'function') return null;
  const stream = new Response(text).body?.pipeThrough(new CompressionStream('gzip'));
  return stream ? (await new Response(stream).arrayBuffer()).byteLength : null;
}

// Occasion covers (26.10, gallery-only prototype, demo/covers/): the title → motif detection (on the device only),
// our own SVG pictures, and the gallery page.

describe('the motif list', () => {
  it('has 12–16 motifs, each once, each in the priority order', () => {
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(12);
    expect(THEME_IDS.length).toBeLessThanOrEqual(16);
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
    expect([...THEME_PRIORITY].sort()).toEqual([...THEME_IDS].sort());
  });

  it('every motif has a word list, names in DE / EN / RU and a sample title that finds it', () => {
    for (const id of THEME_IDS) {
      expect(RULES.find((r) => r.theme === id)?.words.length ?? 0, id).toBeGreaterThan(0);
      const meta = THEMES[id];
      expect(meta.id).toBe(id);
      for (const lang of ['de', 'en', 'ru'] as const) expect(meta.name[lang].length, `${id} ${lang}`).toBeGreaterThan(0);
      expect(themeOf(meta.sample), meta.sample).toBe(id);
    }
  });

  it('isThemeId is the allow-list', () => {
    expect(isThemeId('birthday')).toBe(true);
    expect(isThemeId('Birthday')).toBe(false);
    expect(isThemeId('none')).toBe(false);
    expect(isThemeId(3)).toBe(false);
  });
});

describe('themeOf: the detection table', () => {
  it.each(SAMPLE_TITLES.map((s) => [s.title, s.date ?? '', s.expect] as const))('%s %s → %s', (title, date, expected) => {
    expect(themeOf(title, date ? { date } : {})).toBe(expected);
  });

  it('the table is big enough and has traps', () => {
    expect(SAMPLE_TITLES.length).toBeGreaterThanOrEqual(60);
    expect(SAMPLE_TITLES.filter((s) => s.expect === null).length).toBeGreaterThanOrEqual(20);
    expect(SAMPLE_TITLES.filter((s) => s.trap).length).toBeGreaterThanOrEqual(25);
    // every motif is in the table at least once
    for (const id of THEME_IDS) expect(SAMPLE_TITLES.some((s) => s.expect === id), id).toBe(true);
  });

  it('an empty or blank title has no motif', () => {
    expect(themeOf('')).toBeNull();
    expect(themeOf('   ')).toBeNull();
    expect(themeOf('🎉🎉')).toBeNull();
  });

  it('a sad or medical word blocks every motif, also on a holiday', () => {
    expect(explainTheme('Geburtstag im Krankenhaus')).toMatchObject({ theme: null, via: 'blocked' });
    expect(themeOf('Trauerfeier', { date: '2026-12-24' })).toBeNull();
    expect(BLOCKED.length).toBeGreaterThan(10);
  });

  it('is pure: the same title gives the same answer, case and accents do not matter', () => {
    expect(themeOf('GEBURTSTAG')).toBe('birthday');
    expect(themeOf('Wohnungs-Einweihung')).toBe('housewarming');
    expect(themeOf('Fussball')).toBe('sport');
    expect(themeOf('Fußball')).toBe('sport');
    expect(themeOf('Ёлка и Новый год')).toBe('newyear');
    for (let i = 0; i < 3; i += 1) expect(themeOf('Spieleabend bei Mila')).toBe('gamenight');
  });

  it('explains why (the gallery shows it)', () => {
    expect(explainTheme('Geburstag Oma')).toEqual({ theme: 'birthday', via: 'word', pattern: '~geburtstag', matched: 'geburstag' });
    expect(explainTheme('Party', { date: '2026-12-31' })).toMatchObject({ theme: 'newyear', via: 'date' });
    expect(explainTheme('Юбилей бабушки')).toMatchObject({ theme: 'birthday', via: 'weak' });
    expect(explainTheme('Treffen mit Jo')).toEqual({ theme: null, via: 'none', pattern: null, matched: null });
  });
});

describe('the helpers', () => {
  it('normalizeTitle: lower case, ß → ss, accents off, punctuation = space', () => {
    expect(normalizeTitle('Größe & Fußball-Spiel!')).toBe('grosse fussball spiel');
    expect(normalizeTitle('  Ёлка, йога  ')).toBe('елка иога');
    expect(normalizeTitle("Max's B-Day")).toBe('max s b day');
  });

  it('oneSlip: one missing, extra or swapped letter — never a wrong one', () => {
    expect(oneSlip('geburstag', 'geburtstag')).toBe(true); // missing
    expect(oneSlip('geburtsstag', 'geburtstag')).toBe(true); // extra
    expect(oneSlip('gebrutstag', 'geburtstag')).toBe(true); // swapped
    expect(oneSlip('geburtstsg', 'geburtstag')).toBe(false); // wrong letter
    expect(oneSlip('weinnacht', 'weihnacht')).toBe(false);
  });

  it('nearlyContains: only for stems of 8+ letters', () => {
    expect(nearlyContains('weinachtsfeier', 'weihnacht')).toBe(true);
    expect(nearlyContains('kinoabend', 'kino')).toBe(true);
    expect(nearlyContains('kio', 'kino')).toBe(false);
  });

  it('Easter Sunday and the holidays of a day', () => {
    expect(easterSunday(2026)).toEqual([4, 5]);
    expect(easterSunday(2027)).toEqual([3, 28]);
    expect(easterSunday(2025)).toEqual([4, 20]);
    expect(holidayOf('2026-04-06')).toBe('easter');
    expect(holidayOf('2026-04-07')).toBeNull();
    expect(holidayOf('2026-12-26')).toBe('christmas');
    expect(holidayOf('2027-01-01')).toBe('newyear');
    expect(holidayOf('2026-10-31')).toBe('halloween');
    expect(holidayOf('not a date')).toBeNull();
  });
});

describe('the pictures', () => {
  const COLOR_ATTR = /\s(fill|stroke|stop-color)="([^"]*)"/g;

  it('every motif has its own picture, drawn the same every time', () => {
    const seen = new Set<string>();
    for (const id of THEME_IDS) {
      const markup = coverMarkup(id);
      expect(markup.length, id).toBeGreaterThan(400);
      expect(coverMarkup(id)).toBe(markup);
      seen.add(markup);
    }
    expect(seen.size).toBe(THEME_IDS.length);
  });

  it('colours only through the palette (var(--cv-…)), every token defined light AND dark', () => {
    const used = new Set<string>();
    for (const id of THEME_IDS) {
      const markup = coverMarkup(id);
      // no colour written by hand anywhere in a picture
      expect(markup, id).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
      for (const m of markup.matchAll(COLOR_ATTR)) {
        const value = m[2] ?? '';
        if (value === 'none') continue;
        const token = /^var\(--cv-([a-zA-Z0-9]+)\)$/.exec(value);
        expect(token, `${id}: ${m[0]}`).not.toBeNull();
        if (token?.[1]) used.add(token[1]);
      }
    }
    for (const key of used) expect(PALETTE_KEYS as readonly string[], key).toContain(key);
    for (const key of PALETTE_KEYS) {
      const [light, dark] = PALETTE[key];
      expect(light, key).toMatch(/^(#[0-9A-F]{6}|rgba\([\d,.]+\))$/);
      expect(dark, key).toMatch(/^(#[0-9A-F]{6}|rgba\([\d,.]+\))$/);
    }
    const css = paletteCss('.a', '.b');
    expect(css.match(/--cv-/g)?.length).toBe(PALETTE_KEYS.length * 2);
  });

  it('safe to put anywhere: no text, no links, no ids, no scripts, nothing loaded', () => {
    for (const id of THEME_IDS) {
      const markup = coverMarkup(id);
      expect(markup, id).not.toMatch(/<text|<image|<script|<foreignObject|href|url\(|\sid=|\son[a-z]+=/i);
    }
  });

  it('decorative and filling its box like a cover photo', () => {
    const host = document.createElement('div');
    host.innerHTML = coverSvg('birthday');
    const svg = host.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    expect(svg?.getAttribute('viewBox')).toBe(CROPS.cover);
    expect(svg?.dataset.cover).toBe('birthday');
    host.innerHTML = coverSvg('birthday', 'thumb');
    expect(host.querySelector('svg')?.getAttribute('viewBox')).toBe(CROPS.thumb);
  });

  it('the small guests: Pompon or Tapsi exactly where the list says', () => {
    for (const id of THEME_IDS) {
      const markup = coverMarkup(id);
      const guest = THEMES[id].guest;
      expect(markup.includes('var(--cv-fur)'), `${id} Pompon`).toBe(guest === 'pompon');
      expect(markup.includes('var(--cv-ham)'), `${id} Tapsi`).toBe(guest === 'tapsi');
    }
  });

  it('small: ≤ 14 KB raw and ≤ 3.5 KB gzip each (a lazy chunk per motif)', async () => {
    let total = 0;
    for (const id of THEME_IDS) {
      const svg = coverSvg(id);
      expect(svg.length, id).toBeLessThanOrEqual(14 * 1024);
      const gz = await gzipSize(svg);
      if (gz !== null) {
        expect(gz, id).toBeLessThanOrEqual(3.5 * 1024);
        total += gz;
      }
    }
    if (total) expect(total).toBeLessThanOrEqual(40 * 1024);
  });
});

describe('the gallery page', () => {
  it('renders every part: 2 × 16 cards, 3 heroes, the playground, the full table, 6 form states', () => {
    const app = document.createElement('main');
    document.body.append(app);
    coversGallery(app, new URLSearchParams('screens=covers'));
    for (const part of ['cards', 'hero', 'play', 'table', 'picker', 'before']) expect(app.querySelector(`#cv-${part}`), part).not.toBeNull();
    expect(app.querySelectorAll('#cv-cards .cv-card[data-cover]').length).toBe(THEME_IDS.length * 2);
    expect(app.querySelectorAll('#cv-hero .cv-phone').length).toBe(3);
    expect(app.querySelectorAll('#cv-table tbody tr').length).toBe(SAMPLE_TITLES.length);
    expect(app.querySelector('#cv-table .cv-sum')?.textContent).toContain(`${SAMPLE_TITLES.length} из ${SAMPLE_TITLES.length} ✓`);
    expect(app.querySelectorAll('#cv-table td.bad').length).toBe(0);
    expect(app.querySelectorAll('#cv-picker .cv-form').length).toBe(6);
    // the automatic state suggests the motif of its title and marks it
    const auto = app.querySelector('#cv-picker .cv-form[data-state="auto"]');
    expect(auto?.querySelector('.cv-opt[aria-checked="true"] svg')?.getAttribute('data-cover')).toBe('birthday');
    expect(auto?.textContent).toContain('Automatisch');
    // switched off: "Kein Motiv" is the chosen option
    const off = app.querySelector('#cv-picker .cv-form[data-state="off"] .cv-opt[aria-checked="true"]');
    expect(off?.textContent).toContain('Kein Motiv');
  });

  it('the playground follows the typed title', () => {
    const app = document.createElement('main');
    document.body.append(app);
    coversGallery(app, new URLSearchParams('screens=covers&part=play&title=Grillen'));
    expect(app.querySelector('#cv-play .cv-card')?.getAttribute('data-cover')).toBe('bbq');
    const input = app.querySelector<HTMLInputElement>('#cv-play input[type=text]');
    if (!input) throw new Error('no input');
    input.value = 'Trauerfeier für Opa';
    input.dispatchEvent(new Event('input'));
    expect(app.querySelector('#cv-play .cv-card')?.hasAttribute('data-cover')).toBe(false);
    expect(app.querySelector('#cv-play .cv-why')?.textContent).toContain('Пусто');
    const date = app.querySelector<HTMLInputElement>('#cv-play input[type=date]');
    if (!date) throw new Error('no date');
    input.value = 'Familientreffen';
    date.value = '2026-12-24';
    date.dispatchEvent(new Event('input'));
    expect(app.querySelector('#cv-play .cv-card')?.getAttribute('data-cover')).toBe('christmas');
  });

  it('?part= shows one part only; ?theme=dark darkens the page', () => {
    const app = document.createElement('main');
    document.body.append(app);
    coversGallery(app, new URLSearchParams('screens=covers&part=hero&theme=dark'));
    expect(app.querySelector('#cv-hero')).not.toBeNull();
    expect(app.querySelector('#cv-cards')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('a card without a motif looks like today: no cover box', () => {
    const card = feedCard('Treffen mit Jo', null, 1);
    expect(card.querySelector('.cv-cover')).toBeNull();
    expect(card.hasAttribute('data-cover')).toBe(false);
  });
});
