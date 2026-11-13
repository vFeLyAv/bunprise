import { afterEach, describe, expect, it } from 'vitest';
import { Bunny } from '../src/bunny';
import { NEVER_SAY, SCENE_IDS, SCENES } from '../demo/sammlung/scenes';
import { DAISY_AT, dress, DROP_FRAMES, LEAF_AT, OUTFIT_IDS, OUTFITS, seasonOutfit, unlocked, wornNow, type OutfitId } from '../demo/sammlung/outfits';
import { HAT_VARIANTS, HATS, NA_CAP, NB_CAP, WA_BAND, WA_DOME, WA_FLAP, WA_TASSEL, WB_BAND, WB_DOME, WA_POM, WB_POM, NA_POM, type HatId } from '../demo/sammlung/hats';
import type { DayMonth } from '../demo/wardrobe/items';

// «Pompons Sammlung» (gallery prototype 27.10): the catalogue of hidden scenes (spoiler-free hints that never touch
// the reservation secret), the wardrobe of six outfits (by the date, earned by finds — options A / B) and the
// optional outfit layer (off by default: an undressed puppet is exactly the puppet as before).

afterEach(() => {
  document.body.replaceChildren();
});

function bunny(): Bunny {
  const host = document.createElement('div');
  document.body.append(host);
  return new Bunny(host, { size: 160, idle: false, interactive: false, reducedMotion: 'force' });
}

describe('scenes', () => {
  it('nine scenes, unique ids, every text in German and Russian', () => {
    expect(SCENE_IDS).toHaveLength(9);
    expect(new Set(SCENE_IDS).size).toBe(9);
    for (const s of SCENES) for (const t of [s.title, s.hint, s.where]) {
      expect(t.de.trim().length).toBeGreaterThan(2);
      expect(t.ru.trim().length).toBeGreaterThan(2);
    }
  });

  it('no title or hint ever speaks of reservations or of someone doing something with YOUR wishes', () => {
    for (const s of SCENES) for (const text of [s.title.de, s.title.ru, s.hint.de, s.hint.ru]) {
      for (const bad of NEVER_SAY) expect(text, `${s.id}: ${text}`).not.toMatch(bad);
    }
  });

  it('a hint never gives the scene away: it does not contain the title', () => {
    for (const s of SCENES) {
      for (const lang of ['de', 'ru'] as const) {
        const words = s.title[lang].toLowerCase().replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter((w) => w.length > 3);
        for (const w of words) expect(s.hint[lang].toLowerCase(), `${s.id}/${lang}: «${w}»`).not.toContain(w);
      }
    }
  });
});

describe('the wardrobe: dates', () => {
  const cases: [DayMonth, OutfitId | null][] = [
    [[22, 9], 'leaf'], [[28, 10], 'leaf'], [[31, 10], 'leaf'], [[1, 11], 'scarf'], [[5, 12], 'scarf'], [[6, 12], 'nikolaus'],
    [[26, 12], 'nikolaus'], [[27, 12], 'winterhat'], [[15, 1], 'winterhat'], [[28, 2], 'winterhat'], [[1, 3], 'daisy'],
    [[31, 5], 'daisy'], [[1, 6], null], [[15, 7], null], [[21, 9], null],
  ];
  it.each(cases)('%j → %s', (d, id) => {
    expect(seasonOutfit(d)).toBe(id);
  });

  it('a birthday occasion wins over the date; the party hat never comes by date', () => {
    expect(seasonOutfit([6, 12], true)).toBe('party');
    for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) expect(seasonOutfit([d, m])).not.toBe('party');
  });

  it('the seasons never overlap: at most one outfit per day', () => {
    const doy = ([d, m]: DayMonth) => [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][m - 1]! + d;
    const days = new Map<number, OutfitId>();
    for (const o of OUTFITS) for (const s of o.spans) for (let x = doy(s.from); x <= doy(s.to); x++) {
      expect(days.get(x), `day ${x}: ${days.get(x)} and ${o.id}`).toBeUndefined();
      days.set(x, o.id);
    }
  });

  it('at most six outfits, in the order of the year, the occasion hat last', () => {
    expect(OUTFIT_IDS.length).toBeLessThanOrEqual(6);
    expect(OUTFIT_IDS.at(-1)).toBe('party');
  });
});

describe('the wardrobe: earning (options A / B)', () => {
  it('n found scenes unlock the first n outfits (a counter, never which scene)', () => {
    expect(unlocked(0)).toEqual([]);
    expect(unlocked(2)).toEqual(['leaf', 'scarf']);
    expect(unlocked(99)).toEqual(OUTFIT_IDS);
  });

  it('A: the season outfit only once it is unlocked; B: the season outfit for everyone', () => {
    expect(wornNow('auto', [6, 12], 'A', 0)).toBeNull();
    expect(wornNow('auto', [6, 12], 'A', 3)).toBe('nikolaus');
    expect(wornNow('auto', [6, 12], 'B', 0)).toBe('nikolaus');
    expect(wornNow('auto', [15, 7], 'B', 9)).toBeNull();
  });

  it('a hand-picked outfit only when unlocked; «none» = nothing, whatever the date', () => {
    expect(wornNow('party', [15, 7], 'B', 5)).toBeNull();
    expect(wornNow('party', [15, 7], 'B', 6)).toBe('party');
    expect(wornNow('none', [6, 12], 'B', 9)).toBeNull();
  });
});

describe('the outfit layer', () => {
  it('off by default: a puppet nobody dresses has no outfit layer', () => {
    const b = bunny();
    expect(b.root.querySelector('.wr')).toBeNull();
    expect(b.root.querySelector('style[data-wardrobe]')).toBeNull();
  });

  it.each(OUTFIT_IDS)('%s: one group inside .breathe, under the front paws; null takes it off again', (id) => {
    const b = bunny();
    const host = b.host;
    const g = dress(b.root, host, id);
    expect(g).not.toBeNull();
    expect(b.root.querySelectorAll('.wr:not(.wr-flap)')).toHaveLength(1);
    expect(g?.parentElement?.classList.contains('breathe')).toBe(true);
    expect(g?.nextElementSibling?.classList.contains('tp')).toBe(true);
    expect(host.style.getPropertyValue('--mascot-wear-1')).not.toBe('');
    dress(b.root, host, 'scarf');
    expect(b.root.querySelectorAll('.wr:not(.wr-flap)')).toHaveLength(1);
    dress(b.root, host, null);
    expect(b.root.querySelector('.wr')).toBeNull();
    expect(host.style.getPropertyValue('--mascot-wear-1')).toBe('');
  });

  it('the new drawings stay on the head: never down to the eyes (y -93 ± 9)', () => {
    const ys = (d: string) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number).filter((_, i) => i % 2 === 1);
    for (const d of [NA_CAP, NB_CAP, WA_BAND, WA_DOME, WB_BAND, WB_DOME]) expect(Math.max(...ys(d))).toBeLessThan(-138);
    for (const pom of [WA_POM, WB_POM]) expect(pom.cy + pom.r).toBeLessThan(-180);
    // the Nikolaus pompom hangs beside his ear, well above the eyes
    expect(NA_POM.cy + NA_POM.r).toBeLessThan(-115);
    expect(NA_POM.cx - NA_POM.r).toBeGreaterThan(40);
    expect(DAISY_AT.y + DAISY_AT.r).toBeLessThan(-140);
    expect(LEAF_AT.y + LEAF_AT.r).toBeLessThan(-130);
  });

  it('the new drawings use only the two outfit tokens (the leaf keeps its own autumn palette)', () => {
    for (const id of ['winterhat', 'daisy', 'nikolaus'] as const) {
      const b = bunny();
      const g = dress(b.root, b.host, id);
      const vars = new Set((g?.innerHTML.match(/--[a-z0-9-]+/g) ?? []).filter((v) => v.startsWith('--mascot-wear')));
      expect([...vars].sort()).toEqual(['--mascot-wear-1', '--mascot-wear-2']);
    }
  });
});

// 28.10: Felix — the two hats "look not good": redrawn, two variants each (hats.ts)
describe('the redrawn hats (two variants each)', () => {
  const all: [HatId, 'a' | 'b'][] = (['nikolaus', 'winterhat'] as const).flatMap((id) => HAT_VARIANTS.map((v) => [id, v] as [HatId, 'a' | 'b']));

  it.each(all)('%s %s: over the ears = before the paws, behind the ears = before the lop ears', (id, v) => {
    const b = bunny();
    const g = dress(b.root, b.host, id, 'light', { nikolaus: 'a', winterhat: 'a', [id]: v });
    expect(g?.dataset['variant']).toBe(v);
    const next = g?.nextElementSibling;
    expect(next?.classList.contains(HATS[id][v].layer === 'over' ? 'tp' : 'lop')).toBe(true);
    expect(g?.querySelector('.wr-wob')).not.toBeNull(); // the pompom swings after his hop
  });

  it('the ear flaps sit inside each lop ear (they swing with it), and come off with the hat', () => {
    const b = bunny();
    dress(b.root, b.host, 'winterhat', 'light', { nikolaus: 'a', winterhat: 'a' });
    expect(b.root.querySelectorAll('.lop .ear-l > .wr-flap, .lop .ear-r > .wr-flap')).toHaveLength(2);
    dress(b.root, b.host, 'nikolaus');
    expect(b.root.querySelector('.wr-flap')).toBeNull();
    dress(b.root, b.host, null);
    expect(b.root.querySelector('.wr')).toBeNull();
  });

  it("a flap (with its tassel) stays inside the ear's own box, so the ear's pivot (fill-box) does not move", () => {
    const nums = (WA_FLAP.match(/-?d*.?d+/g) ?? []).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    // the lop ear LOP_L spans x ≈ -78.5 … -24, y ≈ -165 … -82
    expect(Math.min(...xs)).toBeGreaterThan(-78);
    expect(Math.max(...xs)).toBeLessThanOrEqual(-24);
    expect(Math.min(...ys)).toBeGreaterThan(-165);
    expect(WA_TASSEL.cy + WA_TASSEL.r).toBeLessThan(-82);
    expect(WA_TASSEL.cx - WA_TASSEL.r).toBeGreaterThan(-78);
  });

  it('the put-on bounce: transform only, falls, squashes on landing, rebounds once, ends exactly at rest', () => {
    for (const f of DROP_FRAMES) expect(Object.keys(f).filter((k) => !['offset', 'easing'].includes(k))).toEqual(['transform']);
    expect(DROP_FRAMES[0]?.transform).toContain('translate(0px, -30px)');
    expect(DROP_FRAMES.some((f) => String(f.transform).includes('scale(1.06, .9)'))).toBe(true);
    expect(DROP_FRAMES.at(-1)?.transform).toBe('translate(0px, 0px) scale(1, 1)');
  });
});
