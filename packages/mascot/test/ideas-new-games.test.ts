import { afterEach, describe, expect, it, vi } from 'vitest';
import CATALOG_RAW from '../../../workers/edge/src/giftIdeas/catalog.de.json?raw';
import { freezeAt } from '../demo/parade/kit';
import { newGamesGallery } from '../demo/ideas/newgallery';
import { NEW_ARCHETYPES, NEW_GAMES } from '../demo/ideas/newgames';
import { NEW_VARIANTS, newSceneFor } from '../demo/ideas/newscenes';
import { PLAYS } from '../demo/ideas/plays';
import { ARCHETYPES, sceneSvg } from '../demo/ideas/scenes';

// «Neue Spiele 30.10» (approved by Felix on 30.10, ported to apps/web/src/features/gifts/plays/newscenes.ts): 17 new
// game animations — the 7 Kosmos games and the 10 iconic games, all by their catalogue ids (Jenga and Scrabble joined the
// catalogue last: docs/handoffs/2026-10-30-iconic-games.md).
// Every scene follows the motion rules of the old ones: ≤ 2 s, plays once, only transform / opacity, deterministic,
// the end pose = the last frame (reduced motion shows it without animate()), our own drawing (no images, no links,
// no trademarked words), animated parts carry no transform attribute.

const catalog = JSON.parse(CATALOG_RAW) as { items: Array<{ id: string; game?: { name: string } }> };
const ALLOWED = ['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity'];

const KOSMOS = ['cat:kosmos-sky-team', 'cat:kosmos-die-crew', 'cat:kosmos-flip-7', 'cat:kosmos-catan-big-box', 'cat:kosmos-cities', 'cat:kosmos-wildwuchs', 'cat:kosmos-happy-holiday'];
const ICONIC = ['cat:hasbro-monopoly', 'cat:mattel-uno', 'cat:schmidt-mensch-aergere-dich-nicht', 'cat:mattel-scrabble', 'cat:hasbro-cluedo', 'cat:schmidt-kniffel', 'cat:hasbro-jenga', 'cat:jumbo-rummikub', 'cat:zygomatic-dobble', 'cat:piatnik-activity'];
/** Names that must never be written INTO a drawing (they may be the game's label, never its artwork). */
const TRADEMARKS = /\b(uno|monopoly|scrabble|jenga|kniffel|yahtzee|cluedo|clue|dobble|spot it|activity|rummikub|catan|kosmos|hasbro|mattel)\b/i;

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.head.replaceChildren();
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['ready'];
});

describe('the list of the new games', () => {
  it('17 games: the 7 Kosmos games + the 10 iconic ones, all by their catalogue id', () => {
    expect(NEW_GAMES.map((g) => g.key)).toEqual([...KOSMOS, ...ICONIC]);
    expect(new Set(NEW_GAMES.map((g) => g.key)).size).toBe(17);
    expect(NEW_GAMES.filter((g) => g.inCatalog)).toHaveLength(17);
  });

  it('all 17 are in the live catalogue (with facts) and had no animation in the gallery before', () => {
    const ids = new Set(catalog.items.map((i) => i.id));
    for (const g of NEW_GAMES.filter((x) => x.inCatalog)) {
      expect(ids.has(g.key), g.key).toBe(true);
      expect(catalog.items.find((i) => i.id === g.key)?.game?.name, g.key).toBeTruthy();
      expect(PLAYS[g.key], g.key).toBeUndefined();
    }
  });

  it('no provisional "new:…" key is left (every game is in the catalogue)', () => {
    expect(NEW_GAMES.filter((x) => !x.inCatalog || x.key.startsWith('new:'))).toEqual([]);
  });

  it('every game has its own scene (one variant each), a Russian + German name, a group and one line', () => {
    expect(NEW_GAMES.map((g) => g.variant).sort()).toEqual([...NEW_VARIANTS].sort());
    for (const g of NEW_GAMES) {
      expect(g.ru.length, g.key).toBeGreaterThan(2);
      expect(g.de.length, g.key).toBeGreaterThan(2);
      expect(g.archetype in ARCHETYPES || g.archetype in NEW_ARCHETYPES, g.key).toBe(true);
      expect(g.line.length, g.key).toBeGreaterThan(30);
    }
  });
});

describe('the new scenes (motion rules)', () => {
  it.each(NEW_GAMES.map((g) => [g.key, g] as const))('%s: ≤ 2 s, only transform / opacity, finite, deterministic, end pose = last frame, own drawing', (key, game) => {
    const scene = newSceneFor(game.variant);
    expect(scene.duration).toBeGreaterThan(0.8);
    expect(scene.duration).toBeLessThanOrEqual(2);
    // our own drawing: no images, no links, nothing external, no trademarked words
    expect(scene.svg).not.toMatch(/<image|href=|url\(|https?:/i);
    const words = [...scene.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1] ?? '').join(' ');
    expect(words, key).not.toMatch(TRADEMARKS);
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = sceneSvg(scene, game.de);
    const tracks = scene.tracks(host);
    expect(tracks.length).toBeGreaterThanOrEqual(3);
    for (const t of tracks) {
      // animated parts have no transform attribute (the track owns the transform)
      for (const e of t.els) expect(e.hasAttribute('transform'), `${key} ${t.name}`).toBe(false);
      for (const c of t.compile()) {
        expect(c.timing.iterations ?? 1).toBe(1);
        expect(c.end, `${key} ${t.name}`).toBeLessThanOrEqual(scene.duration * 1000 + 1);
        for (const kf of c.frames) expect(Object.keys(kf).every((p) => ALLOWED.includes(p)), `${key} ${t.name}`).toBe(true);
      }
      expect(JSON.stringify(t.styleAt(0.73))).toBe(JSON.stringify(t.styleAt(0.73)));
      // nothing moves after the end: the last frame is the picture
      expect(t.styleAt(scene.duration + 1)).toEqual(t.styleAt(scene.duration));
    }
    // two builds of the same scene are identical (no randomness)
    expect(newSceneFor(game.variant).svg).toBe(scene.svg);
  });

  it('the end pose: the frozen picture equals the last frame of every track, and every visible part ends opaque or hidden on purpose', () => {
    for (const game of NEW_GAMES) {
      const scene = newSceneFor(game.variant);
      const host = document.createElement('div');
      host.innerHTML = sceneSvg(scene, game.de);
      const tracks = scene.tracks(host);
      freezeAt(tracks, scene.duration);
      for (const t of tracks) {
        const want = t.styleAt(scene.duration);
        const el = t.els[0] as SVGElement;
        if (want.transform !== undefined) expect(el.style.transform, `${game.key} ${t.name}`).toBe(want.transform);
        if (want.opacity !== undefined) expect(el.style.opacity, `${game.key} ${t.name}`).toBe(want.opacity);
      }
    }
  });
});

describe('the gallery page ?screens=newgames', () => {
  const render = (search: string) => {
    const app = document.createElement('div');
    document.body.append(app);
    newGamesGallery(app, new URLSearchParams(search));
    return app;
  };

  it('17 cards, each in light and dark; names in Russian and German; no provisional key mark left', () => {
    const app = render('screens=newgames&reduced=1');
    const cards = app.querySelectorAll('.ng-card');
    expect(cards.length).toBe(17);
    for (const card of cards) expect(card.querySelectorAll('.ng-frame').length).toBe(2);
    expect(app.querySelectorAll('.ng-card .prov').length).toBe(0);
    expect(app.textContent).toContain('Монополия');
    expect(app.textContent).toContain('Mensch ärgere Dich nicht');
    expect(app.querySelector('h2')?.textContent).toContain('Neue Spiele 30.10');
  });

  it('all five themes (Hell, Dunkel, Blau, Ozean, Schwarz) in the picture table', () => {
    const app = render('screens=newgames&view=themes');
    const frames = app.querySelectorAll('.ng-themes .ng-frame');
    expect(frames.length).toBe(17 * 5);
    // 'dark' is also the token class of the three other dark themes (their tiles are the dark ones, like in the app)
    for (const theme of ['light', 'navy', 'ocean', 'black']) expect(app.querySelectorAll(`.ng-themes .ng-frame.${theme}`).length).toBe(17);
    expect(app.querySelectorAll('.ng-themes .ng-frame.dark:not(.navy):not(.ocean):not(.black)').length).toBe(17);
    expect(app.querySelectorAll('.ng-themes .ng-frame.navy.dark').length).toBe(17);
  });

  it('reduced motion: every scene is its end pose and nothing calls animate(), not even a tap', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const app = render('screens=newgames&reduced=1&theme=all');
    for (const b of app.querySelectorAll<HTMLElement>('.ng-card .ng-frame')) b.click();
    expect(spy).not.toHaveBeenCalled();
    expect(app.querySelectorAll('.ng-card .ng-frame').length).toBe(17 * 5);
  });

  it('&only= picks games by key or short name; &frames= makes frozen frames', () => {
    const app = render('screens=newgames&view=grid&only=sky-team,jenga,cat:mattel-uno,monopoly');
    expect([...app.querySelectorAll<HTMLElement>('.ng-card')].map((c) => c.dataset['game'])).toEqual(['cat:kosmos-sky-team', 'cat:hasbro-monopoly', 'cat:mattel-uno', 'cat:hasbro-jenga']);
    document.body.replaceChildren();
    const frames = render('screens=newgames&view=frames&frames=4&anim=monopoly');
    expect(frames.querySelectorAll('.ng-frames figure').length).toBe(4);
  });
});
