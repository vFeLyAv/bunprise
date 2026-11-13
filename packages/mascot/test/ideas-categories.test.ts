import { afterEach, describe, expect, it, vi } from 'vitest';
import DRAFT_RAW from '../../../docs/research/2026-10-26-board-games.catalog-draft.json?raw';
import CATALOG_RAW from '../../../workers/edge/src/giftIdeas/catalog.de.json?raw';
import CATALOG_TS from '../../../workers/edge/src/giftIdeas/catalog.ts?raw';
import CATALOG_TEST from '../../../workers/edge/test/giftIdeas.catalog.test.ts?raw';
import { CATALOG_GAMES, CATEGORIES, DRAFT_COUNT, DRAFT_PRICE_SPAN, FILTER_STEPS, fits, GAMES, NO_FILTER, priceLabel, type Filters } from '../demo/ideas/games';
import { BEATS, FACES, openTracks } from '../demo/ideas/motion';
import { ideasGallery } from '../demo/ideas/gallery';
import { categoryPhone } from '../demo/ideas/phone';
import { PHOTO_BASE, PHOTOS, PLAYS, photoUrl } from '../demo/ideas/plays';
import { ARCHETYPES, sceneFor, sceneSvg, type Archetype } from '../demo/ideas/scenes';
import { gameSheetPhone } from '../demo/ideas/sheet';
import { mountScene } from '../demo/ideas/anims';

// "Ideen → Kategorien" (26.10, gallery-only prototype + a DRAFT of catalogue entries for Felix to approve):
// - the draft (docs/research/2026-10-26-board-games.catalog-draft.json) has the shape of the Worker's catalogue
//   (workers/edge/src/giftIdeas/catalog.de.json) and passes the same data rules as its test — the rules are mirrored
//   here; the vocabularies (interests, drawings) and the tracking blacklist are READ from the Worker's files as text,
//   so they cannot drift (no Worker code is imported: it pulls a JSON module this package's tsconfig does not allow);
// - every game says players / minutes / price; no id twice; since 27.10 each is in the live catalogue (same data);
// - the gallery's ten cards are entries of the draft with the same numbers;
// - the die moment: only transform / opacity, finite, deterministic, reduced motion = no animation;
// - every game has "So wird gespielt" (≤ 300 characters, 2–4 sentences) = the gallery's text, an animation archetype
//   whose scene follows the same motion rules (≤ 2 s), and a photo only where the draft names one (credit = its shop);
// - the game sheet's carousel: animation → photo by arrows / dots / keys, no second slide without a photo.

interface DraftOffer { shop: string; url: string; price_cents: number; checked_at: string }
interface DraftItem {
  id: string;
  interests: string[];
  art: string;
  rank: number;
  title: { de: string; en: string };
  offers: DraftOffer[];
  image_source?: string;
  shelf: string;
  game: { publisher: string; players_min: number; players_max: number; minutes_min: number; minutes_max: number; age_min: number; award: string | null };
  blurb: { de: string; en: string };
  how_to_play: { de: string };
  review?: string;
}
interface Draft { version: number; note: string; items: DraftItem[] }

const draft = JSON.parse(DRAFT_RAW) as Draft;
const catalog = JSON.parse(CATALOG_RAW) as { items: Array<{ id: string; rank: number }> };

/** `export const NAME = [ 'a', 'b', … ] as const` of the Worker's catalog.ts, read as text. */
function constList(name: string): string[] {
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(CATALOG_TS);
  if (!m?.[1]) throw new Error(`no ${name} in catalog.ts`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1] ?? '');
}
const INTERESTS = constList('GIFT_INTERESTS');
const ART_IDS = constList('GIFT_ART_IDS');

/** The Worker test's own blacklist of partner / tracking parameters (`const TRACKING = /…/i`). */
function trackingRegex(): RegExp {
  const m = /const TRACKING = \/(.+)\/i\n/.exec(CATALOG_TEST);
  if (!m?.[1]) throw new Error('no TRACKING in giftIdeas.catalog.test.ts');
  return new RegExp(m[1], 'i');
}
const TRACKING = trackingRegex();
const REDIRECTORS = /(awin1|tradedoubler|rover\.ebay|amzn\.to|adcell|partners\.webmasterplan|clk\.tradedoubler)/;

const ALLOWED = ['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity'];

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.head.replaceChildren();
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['ready'];
});

describe('the vocabularies read from the Worker', () => {
  it('found the 18 interests, the drawings and the tracking rule', () => {
    expect(INTERESTS).toHaveLength(18);
    expect(INTERESTS).toContain('games');
    expect(ART_IDS).toEqual(expect.arrayContaining(['boardgame', 'cards', 'puzzle']));
    expect(TRACKING.test('utm_source')).toBe(true);
    expect(TRACKING.test('awc')).toBe(true);
    expect(TRACKING.test('variant')).toBe(false);
  });
});

describe('the board-game draft (catalogue shape)', () => {
  it('parses: version 1, a note that says DRAFT, 20–30 games', () => {
    expect(draft.version).toBe(1);
    expect(draft.note).toMatch(/ENTWURF|DRAFT/);
    expect(draft.items.length).toBeGreaterThanOrEqual(20);
    expect(draft.items.length).toBeLessThanOrEqual(30);
    expect(DRAFT_COUNT).toBe(draft.items.length);
    const cents = draft.items.flatMap((i) => i.offers.map((o) => o.price_cents));
    expect(DRAFT_PRICE_SPAN).toEqual([Math.min(...cents), Math.max(...cents)]);
    expect(CATALOG_GAMES).toBe(7);
  });

  // 27.10 (Felix's «ок»): the draft went into the live catalogue — each entry once, with the same rank, prices,
  // photo and "So wird gespielt" (docs/handoffs/2026-10-27-ideas-categories.md); before that: none of them in it
  const CHECKED_DE_30_10 = [
    'cat:hig-carcassonne', 'cat:cge-codenames', 'cat:nextmove-azul', 'cat:pegasus-kingdomino', 'cat:kosmos-cascadia',
    'cat:cocktail-hanabi', 'cat:kosmos-exit-verlassene-huette', 'cat:pegasus-bomb-busters',
  ];
  it('no id twice; each is in the live catalogue once, with the same rank, offers, photo and rules text', () => {
    const ids = draft.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    const ranks = draft.items.map((i) => i.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    const liveRanks = catalog.items.map((i) => i.rank);
    expect(new Set(liveRanks).size).toBe(liveRanks.length);
    for (const item of draft.items) {
      const live = catalog.items.filter((i) => i.id === item.id) as Array<DraftItem & { topic?: string; how_to_play?: { de: string } }>;
      expect(live, item.id).toHaveLength(1);
      expect(live[0]?.rank, item.id).toBe(item.rank);
      expect(live[0]?.offers, item.id).toEqual(item.offers);
      expect(live[0]?.image_source, item.id).toBe(item.image_source);
      expect(live[0]?.topic, item.id).toBe('brettspiele');
      // 30.10: the texts written from EN/FR rules were checked against the German rulebooks in the live
      // catalogue (docs/handoffs/2026-10-30-ideas-games-facts.md); the live text is the source now
      if (!CHECKED_DE_30_10.includes(item.id)) expect(live[0]?.how_to_play?.de, item.id).toBe(item.how_to_play.de);
      else expect(live[0]?.how_to_play?.de.length, item.id).toBeGreaterThan(0);
    }
  });

  it('no game twice under another id (titles)', () => {
    const names = draft.items.map((i) => i.title.de.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(draft.items.map((item) => [item.id, item] as const))('%s follows the catalogue rules', (_id, item) => {
    // the Worker's rules (workers/edge/test/giftIdeas.catalog.test.ts)
    expect(item.id).toMatch(/^cat:[a-z0-9-]{1,60}$/);
    expect(item.interests.length).toBeGreaterThan(0);
    for (const interest of item.interests) expect(INTERESTS).toContain(interest);
    expect(item.interests).toContain('games');
    expect(ART_IDS).toContain(item.art);
    expect(Number.isInteger(item.rank)).toBe(true);
    for (const title of [item.title.de, item.title.en]) {
      expect(title.trim()).toBe(title);
      expect([...title].length).toBeGreaterThan(3);
      expect([...title].length).toBeLessThanOrEqual(120);
    }
    expect(item.offers.length).toBeGreaterThan(0);
    for (const offer of item.offers) {
      expect([...offer.shop].length).toBeLessThanOrEqual(40);
      expect(Number.isInteger(offer.price_cents)).toBe(true);
      expect(offer.price_cents).toBeGreaterThan(0);
      expect(offer.price_cents).toBeLessThanOrEqual(25_000);
      expect(offer.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Date.parse(`${offer.checked_at}T00:00:00Z`)).toBeLessThanOrEqual(Date.now());
      const url = new URL(offer.url);
      expect(url.protocol).toBe('https:');
      expect(url.username + url.password).toBe('');
      expect(url.hash).toBe('');
      expect(url.hostname).not.toMatch(/(^|\.)(example|test|invalid|localhost)$/);
      for (const key of url.searchParams.keys()) expect(key, offer.url).not.toMatch(TRACKING);
      expect(url.hostname).not.toMatch(REDIRECTORS);
      // price comparison sites are research, never an offer
      expect(url.hostname).not.toMatch(/(^|\.)(idealo|geizhals|billiger|guenstiger)\./);
    }
    // the photo the cheapest offer's page names (closed-pilot rule): https, no tracking parameters
    if (item.image_source !== undefined) {
      const img = new URL(item.image_source);
      expect(img.protocol).toBe('https:');
      expect(img.username + img.password).toBe('');
      for (const key of img.searchParams.keys()) expect(key, item.image_source).not.toMatch(TRACKING);
    }
  });

  it.each(draft.items.map((item) => [item.id, item] as const))('%s says players, minutes, age, price and a short blurb', (_id, item) => {
    expect(item.shelf).toBe('brettspiele');
    const g = item.game;
    expect(g.publisher.length).toBeGreaterThan(1);
    expect(Number.isInteger(g.players_min) && Number.isInteger(g.players_max)).toBe(true);
    expect(g.players_min).toBeGreaterThanOrEqual(1);
    expect(g.players_max).toBeGreaterThanOrEqual(g.players_min);
    expect(g.players_max).toBeLessThanOrEqual(20);
    expect(g.minutes_min).toBeGreaterThanOrEqual(5);
    expect(g.minutes_max).toBeGreaterThanOrEqual(g.minutes_min);
    expect(g.minutes_max).toBeLessThanOrEqual(240);
    expect(g.age_min).toBeGreaterThanOrEqual(6);
    expect(g.age_min).toBeLessThanOrEqual(18);
    // the budget of the selection: ≈ 10–60 € (Wizard ≈ 6 €, Everdell up to 70 € on purpose)
    for (const offer of item.offers) {
      expect(offer.price_cents).toBeGreaterThanOrEqual(500);
      expect(offer.price_cents).toBeLessThanOrEqual(7000);
    }
    expect([...item.blurb.de].length).toBeGreaterThan(20);
    expect([...item.blurb.de].length).toBeLessThanOrEqual(140);
    expect([...item.blurb.en].length).toBeLessThanOrEqual(160);
  });

  it('mixes the player counts, the lengths and the budgets', () => {
    const items = draft.items.map((i) => i.game);
    expect(items.some((g) => g.players_min === 2 && g.players_max === 2)).toBe(true);
    expect(items.some((g) => g.players_max >= 7)).toBe(true);
    expect(items.some((g) => g.players_min === 1)).toBe(true);
    expect(items.some((g) => g.minutes_max <= 20)).toBe(true);
    expect(items.some((g) => g.minutes_max >= 60)).toBe(true);
    const cheapest = draft.items.map((i) => Math.min(...i.offers.map((o) => o.price_cents)));
    expect(cheapest.some((c) => c <= 1500)).toBe(true);
    expect(cheapest.some((c) => c >= 4000)).toBe(true);
  });
});

describe('the gallery cards = draft entries', () => {
  it('8–10 cards, every one an entry of the draft with the same numbers and offers', () => {
    expect(GAMES.length).toBeGreaterThanOrEqual(8);
    expect(GAMES.length).toBeLessThanOrEqual(10);
    for (const card of GAMES) {
      const item = draft.items.find((i) => i.id === card.id);
      expect(item, card.id).toBeDefined();
      if (!item) continue;
      expect(card.players).toEqual([item.game.players_min, item.game.players_max]);
      expect(card.minutes).toEqual([item.game.minutes_min, item.game.minutes_max]);
      expect(card.age).toBe(item.game.age_min);
      expect(card.publisher).toBe(item.game.publisher);
      expect(card.award).toBe(item.game.award);
      expect(card.blurb).toBe(item.blurb.de);
      const cents = item.offers.map((o) => o.price_cents);
      expect(card.price).toEqual([Math.min(...cents), Math.max(...cents)]);
      expect(card.offers).toEqual(item.offers.map((o) => ({ shop: o.shop, cents: o.price_cents })));
    }
    expect(new Set(GAMES.map((g) => g.id)).size).toBe(GAMES.length);
  });

  it('the category row: Brettspiele first and new, counted as the draft + the 7 games already in the catalogue', () => {
    expect(CATEGORIES[0]?.id).toBe('brettspiele');
    expect(CATEGORIES[0]?.count).toBe(draft.items.length + 7);
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(6);
  });

  it('price labels like the app ("ca. 25–30 €")', () => {
    expect(priceLabel([2499, 2999])).toBe('ca. 25–30 €');
    expect(priceLabel([999, 999])).toBe('ca. 10 €');
  });
});

describe('filters', () => {
  const g = (players: [number, number], minutes: [number, number], cents: number) => ({ players, minutes, price: [cents, cents] as const });
  const f = (patch: Partial<Filters>): Filters => ({ ...NO_FILTER, ...patch });

  it('players: the box allows two / four; party = six and more', () => {
    expect(fits(g([2, 2], [30, 30], 2000), f({ players: 'two' }))).toBe(true);
    expect(fits(g([3, 7], [20, 20], 2000), f({ players: 'two' }))).toBe(false);
    expect(fits(g([2, 5], [30, 30], 2000), f({ players: 'four' }))).toBe(true);
    expect(fits(g([2, 8], [15, 15], 2000), f({ players: 'party' }))).toBe(true);
    expect(fits(g([2, 5], [15, 15], 2000), f({ players: 'party' }))).toBe(false);
  });

  it('duration: by the longest printed time; price: by the cheapest offer', () => {
    expect(fits(g([2, 4], [15, 30], 2000), f({ time: 'short' }))).toBe(true);
    expect(fits(g([2, 4], [30, 60], 2000), f({ time: 'short' }))).toBe(false);
    expect(fits(g([2, 4], [30, 60], 2000), f({ time: 'mid' }))).toBe(true);
    expect(fits(g([1, 5], [40, 70], 2000), f({ time: 'long' }))).toBe(true);
    expect(fits(g([2, 4], [20, 20], 999), f({ price: 'low' }))).toBe(true);
    expect(fits(g([2, 4], [20, 20], 2999), f({ price: 'mid' }))).toBe(true);
    expect(fits(g([2, 4], [20, 20], 4999), f({ price: 'high' }))).toBe(true);
    expect(fits(g([2, 4], [20, 20], 4999), f({ price: 'mid' }))).toBe(false);
  });

  it('every pill step keeps at least one of the ten cards (no dead end in the prototype)', () => {
    for (const key of ['players', 'time', 'price'] as const) {
      for (const step of FILTER_STEPS[key]) {
        expect(GAMES.some((card) => fits(card, f({ [key]: step } as Partial<Filters>))), `${key}=${step}`).toBe(true);
      }
    }
  });

  it('the screen hides what does not fit and says how many are left', () => {
    const c = categoryPhone('light', GAMES, fits);
    document.body.append(c.phone);
    c.setFilters(f({ players: 'two', price: 'low' }));
    const shown = [...c.phone.querySelectorAll<HTMLLIElement>('.ix-grid > li')].filter((li) => !li.hidden);
    const expected = GAMES.filter((card) => fits(card, f({ players: 'two', price: 'low' })));
    expect(shown.map((li) => li.dataset['game'])).toEqual(expected.map((card) => card.id));
    expect(c.phone.querySelector('.ix-count')?.textContent).toBe(`${expected.length} von ${GAMES.length} passen`);
    expect(c.phone.querySelector('[data-filter="players"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(c.phone.querySelector('[data-filter="time"]')?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the die moment (motion)', () => {
  function screen(): HTMLElement {
    const c = categoryPhone('light', GAMES, fits);
    document.body.append(c.phone);
    return c.screen;
  }

  it('only transform / opacity, every animation finite, ends by BEATS.end', () => {
    const tracks = openTracks(screen());
    for (const t of tracks) {
      for (const c of t.compile()) {
        expect(c.timing.iterations ?? 1).toBe(1);
        expect(c.end).toBeLessThanOrEqual(BEATS.end * 1000 + 1);
        for (const k of c.frames) expect(Object.keys(k).every((key) => ALLOWED.includes(key))).toBe(true);
      }
    }
  });

  it('deterministic: the same frame every time; the die rests at its place on a six', () => {
    const tracks = openTracks(screen());
    const at = (t: number) => tracks.map((tr) => JSON.stringify(tr.styleAt(t)));
    expect(at(0.61)).toEqual(at(0.61));
    const byName = (n: string) => tracks.find((tr) => tr.name === n);
    expect(byName('die.x')?.styleAt(BEATS.end)?.transform).toBe('translate(0px, 0px)');
    expect(byName('die.y')?.styleAt(BEATS.end)?.transform).toBe('translate(0px, 0px)');
    // the die starts outside the header (to the right) and in the air
    expect(byName('die.x')?.styleAt(0)?.transform).toBe('translate(150px, 0px)');
    // an upright die at rest: a whole number of quarter turns
    const spin = /rotate\((-?[\d.]+)deg\)/.exec(byName('die.spin')?.styleAt(BEATS.end)?.transform ?? '');
    expect(Math.abs(Number(spin?.[1]) % 90)).toBe(0);
    const last = FACES[FACES.length - 1];
    expect(last).toBe(6);
    for (const face of FACES) expect(byName(`die.face${face}`)?.styleAt(BEATS.end)?.opacity).toBe(face === last ? '1' : '0');
    // only one face at a time, at any moment
    for (let t = 0; t <= BEATS.end; t += 0.05) {
      const visible = FACES.filter((face) => Number(byName(`die.face${face}`)?.styleAt(t)?.opacity) > 0.5);
      expect(visible.length, `t=${t}`).toBe(1);
    }
    // the cards end in place, fully visible
    for (const tr of tracks.filter((x) => x.name.startsWith('card'))) {
      expect(tr.styleAt(BEATS.end)).toEqual({ transform: 'translate(0px, 0px)', opacity: '1' });
    }
  });

  it('the gallery: three screens in both themes; reduced motion = no animation at all, the end pose', () => {
    const app = document.createElement('div');
    document.body.append(app);
    const spy = vi.spyOn(Element.prototype, 'animate');
    ideasGallery(app, new URLSearchParams('screens=ideas&reduced=1&frames=0'));
    expect(app.querySelectorAll('.ix-phone').length).toBe(6);
    expect(app.querySelectorAll('.ix-phone.dark').length).toBe(3);
    expect(app.querySelectorAll('.ix-tile').length).toBe(CATEGORIES.length * 2);
    expect(app.querySelectorAll('.ix-grid > li').length).toBeGreaterThanOrEqual(GAMES.length * 2);
    expect(spy).not.toHaveBeenCalled();
    const die = app.querySelector<SVGElement>('[data-k="die-x"]');
    expect(die?.style.transform).toBe('translate(0px, 0px)');
  });

  it('the gallery: full motion builds the moment and can be frozen at any second (&t=)', () => {
    const app = document.createElement('div');
    document.body.append(app);
    const spy = vi.spyOn(Element.prototype, 'animate');
    ideasGallery(app, new URLSearchParams('screens=ideas&view=category&theme=dark&t=0.5'));
    expect(app.querySelectorAll('.ix-phone').length).toBe(1);
    expect(spy).toHaveBeenCalled();
    const x = app.querySelector<SVGElement>('[data-k="die-x"]');
    expect(x?.getAnimations().length).toBeGreaterThan(0);
  });
});

describe('"So wird gespielt", the game animations and the photos', () => {
  const cheapestShop = (item: DraftItem) => [...item.offers].sort((a, b) => a.price_cents - b.price_cents)[0]?.shop;

  it.each(draft.items.map((item) => [item.id, item] as const))('%s: how to play in 2–4 sentences, ≤ 300 characters, = the gallery', (id, item) => {
    const text = item.how_to_play.de;
    expect(text.trim()).toBe(text);
    expect([...text].length).toBeGreaterThan(120);
    expect([...text].length).toBeLessThanOrEqual(300);
    const sentences = text.split(/(?<=[.!?])\s+/);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(4);
    expect(PLAYS[id]?.howTo).toBe(text);
  });

  it('every draft game has a play, and nothing else does', () => {
    expect(Object.keys(PLAYS).sort()).toEqual(draft.items.map((i) => i.id).sort());
  });

  it('6–8 archetypes, every one used', () => {
    const used = new Set(Object.values(PLAYS).map((p) => p.look.archetype));
    const all = Object.keys(ARCHETYPES) as Archetype[];
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(all.length).toBeLessThanOrEqual(8);
    for (const a of all) expect(used.has(a), a).toBe(true);
  });

  it.each(Object.entries(PLAYS))('%s: its scene ≤ 2 s, only transform / opacity, finite, deterministic, still at the end, own drawing', (id, play) => {
    const scene = sceneFor(play.look);
    expect(scene.duration).toBeGreaterThan(0.8);
    expect(scene.duration).toBeLessThanOrEqual(2);
    // our own drawing: no images, no links, nothing external
    const svg = sceneSvg(scene, play.name);
    expect(svg).not.toMatch(/<image|href=|url\(|https?:/i);
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = svg;
    const tracks = scene.tracks(host);
    expect(tracks.length).toBeGreaterThanOrEqual(3);
    for (const t of tracks) {
      for (const c of t.compile()) {
        expect(c.timing.iterations ?? 1).toBe(1);
        expect(c.end, `${id} ${t.name}`).toBeLessThanOrEqual(scene.duration * 1000 + 1);
        for (const k of c.frames) expect(Object.keys(k).every((key) => ALLOWED.includes(key))).toBe(true);
      }
      expect(JSON.stringify(t.styleAt(0.73))).toBe(JSON.stringify(t.styleAt(0.73)));
      expect(t.styleAt(scene.duration + 1)).toEqual(t.styleAt(scene.duration));
    }
  });

  it('reduced motion: a mounted scene is its end pose and never calls animate()', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const spy = vi.spyOn(Element.prototype, 'animate');
    const m = mountScene(host, 'cat:hig-carcassonne', { reduced: true });
    m.play();
    expect(spy).not.toHaveBeenCalled();
    expect(host.querySelector<SVGElement>('[data-k="t-x"]')?.style.transform).toBe('translate(0px, 0px) rotate(0deg)');
  });

  it('photos only where the draft names one; the credit is the shop of that page; served by the gallery, never by a shop', () => {
    for (const item of draft.items) {
      const photo = PHOTOS[item.id];
      expect(Boolean(photo), item.id).toBe(item.image_source !== undefined);
      if (!photo) continue;
      expect(photo.shop).toBe(cheapestShop(item));
      expect(photo.file).toMatch(new RegExp(`^${item.id.slice(4)}\\.(jpg|png|webp|gif|avif)$`));
      expect(photoUrl(item.id)?.startsWith(PHOTO_BASE)).toBe(true);
    }
    expect(PHOTO_BASE).toMatch(/\/photos\/$/);
    expect(PHOTO_BASE).not.toMatch(/mueller|mediamarkt|alternate|hugendubel/);
  });
});

describe('the game sheet: carousel and "So wird gespielt"', () => {
  const quacks = GAMES.find((g) => g.id === 'cat:schmidt-quacksalber');
  const train = GAMES.find((g) => g.id === 'cat:dow-zug-um-zug');

  it('animation first, the photo one swipe away: arrows, dots and ←/→ switch; "So wird gespielt" above the button', () => {
    if (!quacks) throw new Error('no Quacksalber');
    const sheet = gameSheetPhone('light', quacks, null, { reduced: false });
    document.body.append(sheet.phone);
    expect(sheet.slides).toBe(2);
    expect(sheet.slide).toBe(0);
    const track = sheet.phone.querySelector<HTMLElement>('.ix-car-track');
    expect(track?.style.transform).toBe('translateX(0%)');
    expect(sheet.phone.querySelector('.ix-car-btn.prev')?.getAttribute('aria-hidden')).toBe('true');
    sheet.phone.querySelector<HTMLElement>('.ix-car-btn.next')?.click();
    expect(sheet.slide).toBe(1);
    expect(track?.style.transform).toBe('translateX(-100%)');
    expect(sheet.phone.querySelector('.ix-credit')?.textContent).toBe(`Bild: ${PHOTOS[quacks.id]?.shop}`);
    sheet.phone.querySelector('.ix-car')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(sheet.slide).toBe(0);
    sheet.phone.querySelectorAll<HTMLElement>('.ix-dots [role="tab"]')[1]?.click();
    expect(sheet.slide).toBe(1);
    const howto = sheet.phone.querySelector('.ix-howto');
    expect(howto?.querySelector('h3')?.textContent).toBe('So wird gespielt');
    expect(howto?.querySelector('p')?.textContent).toBe(PLAYS[quacks.id]?.howTo);
    const cta = sheet.phone.querySelector('.ix-cta');
    expect(Boolean(howto && cta && howto.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    // the photo comes from the gallery's own folder, without a referrer
    const img = sheet.phone.querySelector('img');
    expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img?.getAttribute('src')).toBe(photoUrl(quacks.id));
  });

  it('a photo that fails to load leaves only the animation; reduced motion switches without a transition', () => {
    if (!quacks) throw new Error('no Quacksalber');
    const sheet = gameSheetPhone('dark', quacks, null, { reduced: true, slide: 1 });
    document.body.append(sheet.phone);
    expect(sheet.phone.querySelector('.ix-car')?.classList.contains('reduced')).toBe(true);
    expect(sheet.slide).toBe(1);
    sheet.phone.querySelector('img')?.dispatchEvent(new Event('error'));
    expect(sheet.slides).toBe(1);
    expect(sheet.slide).toBe(0);
    expect(sheet.phone.querySelector('.ix-dots')).toBeNull();
    expect(sheet.phone.querySelector('.ix-car-btn')).toBeNull();
  });

  it('a game without a photo has no second slide, no dots, no arrows', () => {
    if (!train) throw new Error('no Zug um Zug');
    expect(PHOTOS[train.id]).toBeUndefined();
    const sheet = gameSheetPhone('light', train, null, { reduced: false });
    expect(sheet.slides).toBe(1);
    expect(sheet.phone.querySelectorAll('.ix-car-slide').length).toBe(1);
    expect(sheet.phone.querySelector('.ix-dots')).toBeNull();
    expect(sheet.phone.querySelector('.ix-car-btn')).toBeNull();
  });
});
