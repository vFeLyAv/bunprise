import { afterEach, describe, expect, it } from 'vitest';
import { Bunny } from '../src/bunny';
import { Hamster } from '../src/hamster';
import { ChaseStage } from '../src/chase';
import { OverfedStage } from '../src/overfed';
import { TowerStage } from '../src/tower';
import { HomeIconStage } from '../src/homeicon';
import { WelcomeStage } from '../src/welcome';
import { ListsBuddy } from '../src/buddy/index';
import { CHEEK_LN, CHEEK_PTS, cheekFluff, furOf, setBunnyFur } from '../src/fur';
import { line, mirror, smooth } from '../src/geometry';
import { DEFAULT_HATS, dress, dropIn, OUTFIT_IDS, puppetRoots, wearing, wornNow } from '../src/wardrobe/index';
import { seasonOutfit, unlocked } from '../src/wardrobe/rules';
import { sammlungGallery } from '../demo/sammlung/gallery';
import { costumesGallery } from '../demo/costumes/gallery';
import { EXPERIMENTS } from '../demo/costumes/fur';

// 31.10 «внедряй в приложение»: the fluffy cheeks (src/fur.ts) and the Sammlung outfits (src/wardrobe/) moved from the
// gallery into the package as OPT-IN features. The pins below were computed BEFORE the move (a temporary test with the
// same fingerprint, on the code as it was, then deleted): every default puppet, every stage and the gallery pages that
// use the moved code are byte-identical after it — the gallery imports the moved code from src now.

afterEach(() => {
  setBunnyFur({});
  document.body.replaceChildren();
});

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
const norm = (s: string) => s.replace(/bp-[a-z]+-\d+/g, 'ID').replace(/\bcs\d+/g, 'CS').replace(/-out\d+/g, '-OUT').replace(/sm-leaf-\d+/g, 'LEAF');
/** The whole DOM under a node, every shadow root included. */
function deep(node: Element | ShadowRoot): string {
  let out = node instanceof ShadowRoot ? node.innerHTML : node.outerHTML;
  if (!(node instanceof ShadowRoot) && node.shadowRoot) out += `|HOST(${deep(node.shadowRoot)})`;
  for (const e of Array.from(node.querySelectorAll('*'))) if (e.shadowRoot) out += `|SR(${deep(e.shadowRoot)})`;
  return out;
}
const fp = (node: Element | ShadowRoot) => fnv(norm(deep(node)));
function mount(w = 390, h = 300): HTMLElement {
  const d = document.createElement('div');
  Object.defineProperty(d, 'clientWidth', { value: w });
  Object.defineProperty(d, 'clientHeight', { value: h });
  document.body.append(d);
  return d;
}

const still = { idle: false, interactive: false, reducedMotion: 'force' } as const;

/** Every puppet / stage of the package, built with default options (the app's places). */
function builds(): Record<string, () => HTMLElement> {
  return {
    bunny: () => new Bunny(mount(), still).host,
    hamster: () => new Hamster(mount(), still).host,
    'chase-fawn': () => { const h = mount(390, 120); new ChaseStage(h, { reducedMotion: 'force', coat: 'fawn' }); return h; },
    'chase-choc': () => { const h = mount(390, 120); new ChaseStage(h, { reducedMotion: 'force', coat: 'choc' }); return h; },
    'chase-broken': () => { const h = mount(390, 120); new ChaseStage(h, { reducedMotion: 'force', coat: 'broken' }); return h; },
    'overfed-a': () => { const h = mount(358, 150); new OverfedStage(h, { reducedMotion: 'force', coat: 'fawn', illustration: true, variant: 'a' }); return h; },
    'overfed-b': () => { const h = mount(358, 150); new OverfedStage(h, { reducedMotion: 'force', coat: 'fawn', illustration: true, variant: 'b' }); return h; },
    'overfed-c': () => { const h = mount(358, 150); new OverfedStage(h, { reducedMotion: 'force', coat: 'fawn', illustration: true, variant: 'c' }); return h; },
    tower: () => { const h = mount(390, 220); new TowerStage(h, { reduced: true, card: { left: 16, width: 358, radius: 22 } }); return h; },
    homeicon: () => { const h = mount(390, 300); new HomeIconStage(h, { reduced: true, still: true, label: 'Bunprise' }); return h; },
    welcome: () => { const h = mount(390, 300); new WelcomeStage(h, { preset: 'climb-left', reducedMotion: 'off' } as never); return h; },
  };
}

/** Computed before the move (see the header). */
const PINS: Record<string, string> = {
  bunny: '6fcbdc6e', hamster: '4e11236f', 'chase-fawn': '62b9918c', 'chase-choc': '0d584dfe', 'chase-broken': '4c532b57',
  'overfed-a': '75df33db', 'overfed-b': 'bf4817d8', 'overfed-c': '0ca06cc7', tower: 'c6ab23e9', homeicon: '5bc52893', welcome: '57cfa460',
};
// The page right after it was built (synchronously: the Sammlung's scene posters mount one frame later — their stages
// are pinned above). costumes + the hat view: the same numbers as the before-pins; the Sammlung phones were compared
// before / after WITH their posters by the temporary test (identical) and are pinned here without them.
const GALLERY_PINS: ReadonlyArray<[string, string]> = [
  ['screens=sammlung&found=all&date=6.12', '7669b178'],
  ['screens=sammlung&date=15.1&theme=dark', '73435170'],
  ['screens=sammlung&view=hats', 'af2c568e'],
  ['screens=sammlung&hats=old&found=all&date=15.1', '4676a4fa'],
  // re-pinned 31.10 after Felix's costume rounds 2–4 (headphones archived; noodles, spa, strawberry, laptop redrawn) —
  // an intended change of the page itself; the other costume tabs still match their before-pins
  ['screens=costumes', '6a753b79'],
  // re-pinned 31.10: the only difference to the before-pins is the costume rig's new `.carry .cs-floor { display: none; }`
  // rule (the strawberry bush stays out of the carry pose) in every puppet's style — diffed DOM against b0af035; with
  // that rule stripped the three tabs give exactly the old pins aa069971 / 1d65cc90 / 1f1373d7
  ['screens=costumes&tab=experiments', 'fa9a90b9'],
  ['screens=costumes&tab=bunnies', 'd0e767b7'],
  ['screens=costumes&tab=hats', 'bccd21e1'],
];

describe('default output is byte-identical after the move to src (nobody opts in)', () => {
  it('every puppet and stage', () => {
    for (const [name, build] of Object.entries(builds())) expect(fp(build()), name).toBe(PINS[name]);
  });

  it('the Lists buddy', () => {
    const host = mount(390, 600);
    const card = document.createElement('div');
    card.dataset['buddyFloor'] = 'c';
    host.append(card);
    const b = new ListsBuddy({ stage: host, scroller: null, kind: 'bunny', width: 96, reducedMotion: 'force', autonomous: false } as never);
    expect(fp(host)).toBe('88cb7bb2');
    b.destroy();
  });

  it('the gallery pages that now import the moved code (Sammlung, costumes)', () => {
    for (const [qs, pin] of GALLERY_PINS) {
      const app = document.createElement('div');
      document.body.append(app);
      if (qs.includes('costumes')) costumesGallery(app, new URLSearchParams(qs));
      else sammlungGallery(app, new URLSearchParams(qs));
      expect(fp(app), qs).toBe(pin);
      app.remove();
    }
  }, 60_000);

  it('the moved drawings themselves (wardrobe v2 items, leaves and flakes, the six new hats)', async () => {
    const P = await import('../src/wardrobe/leaves');
    let s = '';
    for (const k of ['maple', 'oak'] as const) for (const pal of Object.keys(P.PALETTES)) s += P.leafMarkup(k, pal as never, 'x');
    for (const k of ['hero', 'star', 'dot'] as const) s += P.flakeMarkup(k, 'y');
    expect(fnv(s + JSON.stringify(P.MAPLE) + JSON.stringify(P.OAK))).toBe('a51d657b');
    const W = await import('../src/wardrobe/items');
    let w = '';
    for (const id of W.WEAR_IDS) w += W.WEAR[id].markup('url(#c)') + JSON.stringify(W.wearVars(id, 'dark'));
    expect(fnv(w + W.WEAR_CSS)).toBe('af5b6d9b');
    const H = await import('../src/wardrobe/hats');
    let hs = '';
    for (const id of ['nikolaus', 'winterhat'] as const) for (const v of ['1', '2', '3'] as const) hs += H.NEW_HATS[id][v].markup() + JSON.stringify(H.NEW_HATS[id][v].colors);
    expect(fnv(hs)).toBe('01c0722c');
  });
});

describe('fluffy cheeks (src/fur.ts) — opt-in per coat', () => {
  const cheeks = (root: ParentNode) => Array.from(root.querySelectorAll('.fur-cheeks'));

  it('off by default: no setting, no fur', () => {
    expect(furOf('fawn')).toEqual([]);
    expect(cheeks(new Bunny(mount(), still).root)).toHaveLength(0);
  });

  it('setBunnyFur({ fawn: [cheeks] }): Pompon gets two tufts INSIDE his cheeks, in his own coat gradient; other coats none', () => {
    setBunnyFur({ fawn: ['cheeks'] });
    const p = new Bunny(mount(), still);
    const tufts = cheeks(p.root);
    expect(tufts).toHaveLength(2);
    for (const side of ['l', 'r'] as const) {
      const g = p.root.querySelector(`.cheek-${side} .cheek-j > .fur-cheeks`);
      expect(g, side).not.toBeNull();
      const own = p.root.querySelector(`.cheek-${side} .cheek-j > ellipse`)?.getAttribute('fill');
      expect(g?.querySelector('path')?.getAttribute('fill')).toBe(own);
      expect(own).toBe(`url(#${p.id}-g-body)`);
    }
    expect(cheeks(new Bunny(mount(), { ...still, coat: 'choc' }).root)).toHaveLength(0);
    expect(cheeks(new Hamster(mount(), still).root)).toHaveLength(0);
  });

  it('follows the coat: choc takes them off, fawn puts them back (once), and the bare puppet equals the pin again', () => {
    setBunnyFur({ fawn: ['cheeks'] });
    const p = new Bunny(mount(), still);
    p.setCoat('choc');
    expect(cheeks(p.root)).toHaveLength(0);
    p.setCoat('fawn');
    p.setCoat('fawn');
    expect(cheeks(p.root)).toHaveLength(2);
    setBunnyFur({});
    p.setCoat('fawn');
    expect(cheeks(p.root)).toHaveLength(0);
    expect(fp(p.host)).toBe(PINS['bunny']);
  });

  it('every stage actor of that coat gets them (the chase, the tower, «Переел», the home icon, the welcome peeks)', () => {
    setBunnyFur({ fawn: ['cheeks'] });
    const b = builds();
    for (const name of ['chase-fawn', 'overfed-a', 'homeicon', 'welcome', 'tower'] as const) {
      const host = b[name]!();
      const n = puppetRoots(host).reduce((sum, r) => sum + cheeks(r).length, 0) + cheeks(host.shadowRoot ?? host).length;
      expect(n, name).toBeGreaterThanOrEqual(2);
    }
    const choc = b['chase-choc']!();
    expect(puppetRoots(choc).reduce((sum, r) => sum + cheeks(r).length, 0), 'chase-choc').toBe(0);
  });

  it('the same geometry as the gallery experiment Felix picked (demo/costumes/fur.ts «Пушистые щёчки»)', () => {
    expect(cheekFluff('r')).toEqual({ fill: smooth(CHEEK_PTS), edge: line(CHEEK_LN) });
    expect(cheekFluff('l')).toEqual({ fill: smooth(mirror(CHEEK_PTS)), edge: line(mirror(CHEEK_LN)) });
    const layer = EXPERIMENTS.cheeks.layers.find((l) => l.slot === 'cheek-r');
    expect(layer?.draw({ gBody: 'url(#g)' } as never)).toContain(cheekFluff('r').fill);
    // inside the cheek's reach: never near the eyes (y < -100) or the mouth (|x| < 50)
    for (const [x, y] of CHEEK_PTS) {
      expect(y).toBeGreaterThan(-100);
      expect(Math.abs(x)).toBeGreaterThan(50);
    }
  });
});

describe('the Sammlung outfits (src/wardrobe) — opt-in', () => {
  it('rules: variant B — the season for everyone, finds unlock outfits in the year order; Felix\'s hats', () => {
    expect(DEFAULT_HATS).toEqual({ nikolaus: '2', winterhat: '3' });
    expect(wornNow('auto', [31, 10], 'B', 0)).toBe('leaf');
    expect(wornNow('auto', [1, 11], 'B', 0)).toBe('scarf');
    expect(wornNow('auto', [6, 12], 'B', 0)).toBe('nikolaus');
    expect(wornNow('auto', [26, 12], 'B', 0)).toBe('nikolaus');
    expect(wornNow('auto', [27, 12], 'B', 0)).toBe('winterhat');
    expect(wornNow('auto', [15, 1], 'B', 0)).toBe('winterhat');
    expect(wornNow('auto', [15, 7], 'B', 9)).toBeNull();
    expect(wornNow('none', [15, 1], 'B', 9)).toBeNull();
    expect(wornNow('daisy', [15, 1], 'B', 4)).toBeNull();
    expect(wornNow('daisy', [15, 1], 'B', 5)).toBe('daisy');
    expect(unlocked(9)).toEqual([...OUTFIT_IDS]);
    expect(seasonOutfit([15, 7], true)).toBe('party');
  });

  it('dress → wears it (the chosen hat variant), dress(null) → the puppet is exactly as before', () => {
    const p = new Bunny(mount(), still);
    const g = dress(p.root, p.host, 'winterhat', 'light');
    expect(g?.getAttribute('data-variant')).toBe('3');
    expect(wearing(p.root)).toBe('winterhat');
    expect(p.host.style.getPropertyValue('--mascot-wear-1')).not.toBe('');
    expect(dress(p.root, p.host, 'nikolaus', 'dark')?.getAttribute('data-variant')).toBe('2');
    expect(p.root.querySelectorAll('.wr[data-wear]')).toHaveLength(1);
    dress(p.root, p.host, null);
    expect(wearing(p.root)).toBeNull();
    expect(p.root.querySelectorAll('.wr')).toHaveLength(0);
    expect(p.host.style.getPropertyValue('--mascot-wear-1')).toBe('');
  });

  it('reduced motion: the outfit is simply there (no drop)', () => {
    const p = new Bunny(mount(), still);
    expect(dropIn(dress(p.root, p.host, 'scarf'), true)).toBeNull();
  });
});
