import { afterEach, describe, expect, it } from 'vitest';
import { Bunny, BUNNY_CSS } from '../src/bunny';
import { Hamster } from '../src/hamster';
import { BODY } from '../src/shapes';
import { COSTUMES, COSTUME_IDS, lookOf, PHOTOS, type Costume } from '../demo/costumes/costumes';
import { ARCHIVED_BUNNIES, EXPERIMENTS, EXPERIMENT_IDS, experimentLook, FELIX_PICK, MODELS, NEW_BUNNIES, type ModelInfo } from '../demo/costumes/fur';
import { NEW_HAT_VARIANTS, NEW_HATS, RECOMMENDED } from '../demo/costumes/hats';
import { dress as sammlungDress, DEFAULT_HATS, OLD_HATS, seasonOutfit } from '../demo/sammlung/outfits';
import { sammlungGallery } from '../demo/sammlung/gallery';
import { COSTUME_CSS, ctxOf, dress, outfit, SLOTS, undress, type Ctx, type Kind, type Look } from '../demo/costumes/rig';
import { costumesGallery } from '../demo/costumes/gallery';

// Costumes from Felix's photos, new bunnies, experiments on Pompon (gallery prototype 31.10). Everything is put on
// the puppet from outside; the app's default Pompon / Tapsi must stay byte-identical, every costume must sit in its
// slot and follow his turn / hop, reduced motion must be completely still.

afterEach(() => {
  document.body.replaceChildren();
});

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

function puppet(m: ModelInfo, reduced: 'force' | 'off' = 'force'): Bunny | Hamster {
  const base = { idle: false, interactive: false, reducedMotion: reduced } as const;
  return m.kind === 'bunny' ? new Bunny(mount(), { ...base, coat: m.coat as 'fawn', ears: m.ears ?? 'lop' }) : new Hamster(mount(), { ...base, coat: m.coat as 'golden' });
}

/** FNV-1a of the markup with the instance id normalised (the same function computed the pins with NO costume code loaded). */
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

/** Every point of a drawing: path number pairs (end AND control points: a Bézier stays in their hull), ellipse / circle extremes. */
function points(markup: string): Array<[number, number]> {
  const m = markup.replace(/<mask[\s\S]*?<\/mask>/g, '').replace(/<clipPath[\s\S]*?<\/clipPath>/g, '');
  const out: Array<[number, number]> = [];
  for (const d of m.matchAll(/ d="([^"]+)"/g)) {
    const n = (d[1]?.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i] as number, n[i + 1] as number]);
  }
  for (const e of m.matchAll(/<(ellipse|circle)([^>]*)>/g)) {
    const a = (k: string) => Number(new RegExp(` ${k}="(-?[\\d.]+)"`).exec(e[2] ?? '')?.[1] ?? 0);
    const rx = e[1] === 'circle' ? a('r') : a('rx');
    const ry = e[1] === 'circle' ? a('r') : a('ry');
    out.push([a('cx') - rx, a('cy') - ry], [a('cx') + rx, a('cy') + ry]);
  }
  return out;
}
const fakeCtx = (kind: Kind, ears: 'lop' | 'upright' = 'lop'): Ctx => ({ kind, ears, clip: 'url(#t-clip-body)', gBody: 'url(#t-g-body)', gEar: 'url(#t-g-ear)', uid: 't', bodyD: BODY });

/** Every (costume, wearer) pair. */
function pairs(): Array<{ c: Costume; m: ModelInfo }> {
  return COSTUME_IDS.flatMap((id) => COSTUMES[id].who.map((w) => ({ c: COSTUMES[id], m: MODELS[w] })));
}

describe('the default puppet stays exactly as it is (the app uses this package)', () => {
  it('default Pompon, a broken-coat upright bunny (another option set) and Tapsi are byte-identical to before (pins computed with no costume code loaded)', () => {
    // pins: computed 31.10 in a separate test file that imported only src/ (then deleted) — see the design doc §tests
    expect(fingerprint(new Bunny(mount()))).toBe('8ad2402a');
    expect(fingerprint(new Bunny(mount(), { coat: 'broken', ears: 'upright' }))).toBe('19ec646f');
    expect(fingerprint(new Hamster(mount()))).toBe('8051ce5d');
  });

  it('dress → undress leaves EXACTLY the same markup (every costume × wearer, every experiment, the new bunnies\' fur)', () => {
    const check = (m: ModelInfo, looks: Array<Look | null | undefined>, label: string) => {
      const p = puppet(m);
      m.shape?.(p.root);
      const before = p.root.innerHTML;
      const boxes = dress(p.root, looks);
      expect(boxes.length, label).toBeGreaterThan(0);
      expect(p.root.querySelector('style[data-costume]'), label).not.toBeNull();
      undress(p.root);
      expect(p.root.innerHTML, label).toBe(before);
      p.destroy();
    };
    for (const { c, m } of pairs()) check(m, [lookOf(c, m.kind)], `${c.id} on ${m.id}`);
    for (const id of EXPERIMENT_IDS) check(MODELS.pompon, [experimentLook(id)], id);
    for (const id of NEW_BUNNIES) check(MODELS[id], [MODELS[id].fur], id);
  });

  it('a puppet nobody dresses gets nothing, even next to dressed ones; the shared prototype is never patched', () => {
    const animate = Element.prototype.animate;
    const dressed = puppet(MODELS.pompon);
    outfit(dressed.root, MODELS.pompon, lookOf(COSTUMES.knight, 'bunny'));
    const plain = new Bunny(mount());
    expect(plain.root.querySelector('.cs, style[data-costume]')).toBeNull();
    expect(fingerprint(plain)).toBe('8ad2402a');
    expect(Element.prototype.animate).toBe(animate);
  });
});

describe('the costumes', () => {
  it('17 costumes from the 18 photos: names (RU + DE), photo numbers, a note; every photo became something', () => {
    expect(COSTUME_IDS.length).toBeGreaterThanOrEqual(12);
    expect(COSTUME_IDS.length).toBe(17);
    for (const id of COSTUME_IDS) {
      const c = COSTUMES[id];
      expect(c.ru.length, id).toBeGreaterThan(2);
      expect(c.de.length, id).toBeGreaterThan(2);
      expect(c.photos.length, id).toBeGreaterThan(0);
      expect(c.who.length, id).toBeGreaterThan(0);
    }
    expect(PHOTOS.map((x) => x.n)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    const used = new Set(COSTUME_IDS.flatMap((id) => COSTUMES[id].photos));
    for (const ph of PHOTOS) expect(used.has(ph.n), `photo ${ph.n}`).toBe(true);
  });

  it('no text, no images, no logos — our own flat drawings only', () => {
    for (const { c, m } of pairs()) {
      const svg = lookOf(c, m.kind).layers.map((l) => l.draw(fakeCtx(m.kind, m.ears))).join('');
      expect(svg, c.id).not.toMatch(/<text|<image|<use|href=|<foreignObject/i);
    }
  });

  it('every layer goes into its slot: the container sits exactly at the slot\'s place in THIS puppet', () => {
    for (const { c, m } of pairs()) {
      const p = puppet(m);
      outfit(p.root, m, lookOf(c, m.kind));
      const breathe = p.root.querySelector('.breathe') as Element;
      const kids = Array.from(breathe.children);
      for (const box of Array.from(p.root.querySelectorAll('.cs'))) {
        const slot = box.getAttribute('class')?.match(/cs-slot-([\w-]+)/)?.[1] ?? '';
        const label = `${c.id} on ${m.id}: ${slot}`;
        expect(SLOTS as readonly string[], label).toContain(slot);
        const next = box.nextElementSibling;
        switch (slot) {
          case 'behind':
            expect(kids[0], label).toBe(box);
            break;
          case 'fur': {
            const prev = box.previousElementSibling;
            expect(prev?.tagName.toLowerCase(), label).toBe('path');
            break;
          }
          case 'body':
            expect(next?.classList.contains('tf'), label).toBe(true);
            break;
          case 'under-ears':
            expect(next?.classList.contains(m.kind === 'bunny' ? 'lop' : 'tp'), label).toBe(true);
            break;
          case 'over':
            expect(next?.classList.contains('tp'), label).toBe(true);
            break;
          case 'face':
            expect(box.parentElement?.classList.contains('face'), label).toBe(true);
            expect(next, label).toBeNull();
            break;
          case 'face-under':
            expect(box.parentElement?.classList.contains('face'), label).toBe(true);
            expect(box.previousElementSibling, label).toBeNull();
            break;
          case 'paws':
            expect(box.parentElement?.classList.contains('paws'), label).toBe(true);
            expect(next?.classList.contains('paw-l'), label).toBe(true);
            break;
          case 'front':
            // in front of him and NOT in his hop group: a sibling after .hop, right before his fx layer
            expect(box.parentElement?.classList.contains('mover'), label).toBe(true);
            expect(next?.classList.contains('fx'), label).toBe(true);
            break;
          default:
            expect(box.parentElement?.closest(slot.startsWith('ear') ? '.ear-l, .ear-r' : '.cheek-j'), label).not.toBeNull();
        }
        // a layer's look id is on its group (the costume's, or the bunny's own fur: Leo's mane)
        expect(box.querySelector(`[data-look="${c.id}"]${m.fur ? `, [data-look="${m.fur.id}"]` : ''}`), label).not.toBeNull();
      }
      p.destroy();
    }
  });

  it('each piece stays where it belongs: held props between the paws, face items on the face, hats above the eyes, Tapsi\'s folded ear free', () => {
    const HATS = new Set(['pancake', 'knight', 'bandana', 'lily', 'samurai', 'spa', 'strawberry']);
    for (const { c, m } of pairs()) {
      const ctx = fakeCtx(m.kind, m.ears);
      const eyeTop = m.kind === 'bunny' ? -93 - 7.4 : -96 - 7.4;
      for (const layer of lookOf(c, m.kind).layers) {
        const pts = points(layer.draw(ctx));
        const label = `${c.id} on ${m.id}: ${layer.slot}`;
        expect(pts.length, label).toBeGreaterThan(0);
        for (const [x, y] of pts) {
          // nothing far off the puppet (hood ears are the tallest: up to -240). Only the strawberry bush (its floor layer
          // `front`, `cs-floor`) may reach further: Felix 31.10, 3rd review — «Поэкспериментируй с деревцем, сделай
          // пышнее», 4th — the wide bush (B) beside him; still inside the tile, which shows ±166
          expect(Math.abs(x), label).toBeLessThanOrEqual(c.id === 'strawberry' && layer.slot === 'front' ? 165 : 112);
          expect(y, label).toBeGreaterThanOrEqual(-245);
          expect(y, label).toBeLessThanOrEqual(12);
          if (layer.slot === 'paws') {
            // held props stay between the paws (±50); the groom's sleeves are clothing and stay inside his body (±67 there)
            expect(Math.abs(x), label).toBeLessThanOrEqual(c.id === 'groom' ? 66 : 50);
            expect(y, label).toBeGreaterThanOrEqual(-80);
          }
          if (layer.slot === 'face') {
            expect(Math.abs(x), label).toBeLessThanOrEqual(62);
            // (the spa mask also covers the forehead, up to -122.5)
            expect(y, label).toBeGreaterThanOrEqual(c.id === 'spa' ? -124 : -112);
            expect(y, label).toBeLessThanOrEqual(-56);
          }
          if (layer.slot === 'over' && HATS.has(c.id)) expect(y, `${label}: never down to the eyes`).toBeLessThan(eyeTop);
          if (m.kind === 'hamster') {
            // the folded ear (hamster.ts:79-86, his signature) and a margin around it
            const inFold = x > 34 && x < 76 && y > -160 && y < -124;
            expect(inFold, `${label}: covers the folded ear at (${x}, ${y})`).toBe(false);
          }
        }
      }
    }
  });

  it('glasses, sunglasses and cucumber slices are centred on THIS mascot\'s eyes', () => {
    for (const id of ['reading', 'sunglasses', 'spa'] as const) {
      for (const kind of ['bunny', 'hamster'] as const) {
        const face = lookOf(COSTUMES[id], kind).layers.find((l) => l.slot === 'face');
        const pts = points(face?.draw(fakeCtx(kind)) ?? '');
        const right = pts.filter(([x]) => x > 0);
        const cx = (Math.min(...right.map((p) => p[0])) + Math.max(...right.map((p) => p[0]))) / 2;
        const eye = kind === 'bunny' ? 29 : 32;
        // the temples reach out to the head side, so the centre of the lens sits within a few units of the eye
        expect(Math.abs(cx - eye), `${id} ${kind}`).toBeLessThan(9);
      }
    }
  });

  it('hoods frame the face (eyes, nose, mouth inside the opening — straight and in both turns); his own ears and tail hide while worn', () => {
    const inside = (x: number, y: number, dx: number) => ((x - dx) / 53) ** 2 + ((y + 91) / 44) ** 2 < 1;
    for (const dir of [0, 1, -1]) {
      // the face moves 13 and narrows to .88 in the turn, the hood (cs-band) moves 9
      const fx = (x: number) => (dir ? x * 0.88 + 13 * dir : x);
      for (const [x, y] of [[-29 - 6.2, -93], [29 + 6.2, -93], [-29, -100.4], [29, -100.4], [0, -84], [0, -75.6], [-4.6, -72.6], [4.6, -72.6]] as const) {
        expect(inside(fx(x), y, 9 * dir), `turn ${dir}: (${x}, ${y})`).toBe(true);
      }
    }
    for (const id of ['bunnyhood', 'shark'] as const) {
      const p = puppet(MODELS.pompon);
      outfit(p.root, MODELS.pompon, lookOf(COSTUMES[id], 'bunny'));
      const hide = p.root.querySelector('style[data-costume-hide]')?.textContent ?? '';
      expect(hide, id).toContain('.lop');
      expect(hide, id).toContain('.tail');
      undress(p.root);
      expect(p.root.querySelector('style[data-costume-hide]'), id).toBeNull();
    }
  });

  it('the 3/4 turn: the same numbers as the face (.tf) and paws (.tp); a turning group is never inside another turning part', () => {
    expect(BUNNY_CSS).toContain('.turn-r .tf, .turn-r .tpatch { transform: translateX(13px) scaleX(.88); }');
    expect(BUNNY_CSS).toContain('.turn-r .tp { transform: translateX(9px); }');
    expect(COSTUME_CSS).toContain('.turn-r .cs-front { transform: translateX(13px) scaleX(.88); }');
    expect(COSTUME_CSS).toContain('.turn-r .cs-band { transform: translateX(9px); }');
    expect(COSTUME_CSS).toContain('.turn-l .cs-band { transform: translateX(-9px); }');
    const TURNING = '.cs-head, .cs-front, .cs-band, .cs-back';
    for (const { c, m } of pairs()) {
      const p = puppet(m);
      outfit(p.root, m, lookOf(c, m.kind), [m.fur ?? null]);
      for (const g of Array.from(p.root.querySelectorAll(TURNING))) {
        expect(g.parentElement?.closest(`${TURNING}, .tf, .tp, .te, .tc`), `${c.id} on ${m.id}`).toBeNull();
      }
      p.destroy();
    }
  });

  it('garments over the body are clipped to THIS puppet\'s body (two puppets, two clips)', () => {
    const a = puppet(MODELS.pompon);
    const b = puppet(MODELS.pompon);
    outfit(a.root, MODELS.pompon, lookOf(COSTUMES.groom, 'bunny'));
    outfit(b.root, MODELS.pompon, lookOf(COSTUMES.groom, 'bunny'));
    const clipOf = (p: Bunny | Hamster) => p.root.querySelector('.cs-slot-body g[clip-path]')?.getAttribute('clip-path');
    expect(clipOf(a)).toBe(`url(#${a.root.querySelector('clipPath[id$="clip-body"]')?.id})`);
    expect(clipOf(b)).toBe(`url(#${b.root.querySelector('clipPath[id$="clip-body"]')?.id})`);
    expect(clipOf(a)).not.toBe(clipOf(b));
    expect(ctxOf(a.root)?.uid).not.toBe(ctxOf(b.root)?.uid);
  });
});

describe('motion', () => {
  it('reduced motion: nothing moves — no CSS animation, transitions off, and his jump with any costume starts no animation', async () => {
    expect(COSTUME_CSS).not.toMatch(/animation|@keyframes/);
    expect(COSTUME_CSS).toMatch(/\.rm \.cs-head, \.rm \.cs-front, \.rm \.cs-band, \.rm \.cs-back, \.rm \.cs \.wr-wob \{ transition: none; \}/);
    for (const { c, m } of pairs()) {
      const p = puppet(m, 'force');
      outfit(p.root, m, lookOf(c, m.kind), [m.fur ?? null]);
      void p.play('jump');
      await Promise.resolve();
      expect(p.root.querySelector('svg')?.getAnimations({ subtree: true }).length, `${c.id} on ${m.id}`).toBe(0);
      p.destroy();
    }
  });

  it('full motion: his jump with a costume animates only transform / opacity; dangling parts swing once and end at rest', () => {
    for (const id of ['bride', 'knight', 'bandana', 'bunnyhood', 'shark'] as const) {
      const m = MODELS[COSTUMES[id].who[0] as 'pompon' | 'mila'];
      const p = puppet(m, 'off');
      outfit(p.root, m, lookOf(COSTUMES[id], m.kind));
      void p.play('jump');
      const anims = p.root.querySelector('svg')?.getAnimations({ subtree: true }) ?? [];
      expect(anims.length, id).toBeGreaterThan(0);
      for (const a of anims) {
        for (const k of (a.effect as KeyframeEffect).getKeyframes()) {
          const keys = Object.keys(k).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x));
          for (const key of keys) expect(['transform', 'opacity'], `${id}: ${key}`).toContain(key);
        }
      }
      const swings = anims.filter((a) => ((a.effect as KeyframeEffect).target as Element | null)?.classList.contains('wr-wob'));
      expect(swings.length, `${id}: its dangling parts swing`).toBeGreaterThan(0);
      for (const s of swings) {
        expect(s.effect?.getTiming().iterations ?? 1, id).toBe(1);
        const frames = (s.effect as KeyframeEffect).getKeyframes();
        expect(frames[frames.length - 1]?.transform, id).toBe('rotate(0deg)');
      }
      p.destroy();
    }
  });
});

describe('new bunnies and the experiments on Pompon', () => {
  it('new bunnies of the same puppet (31.10: only Leo shown, Knopf + Hasel archived): names, breed, role; each wears every costume', () => {
    expect([...NEW_BUNNIES]).toEqual(['leo']);
    expect([...ARCHIVED_BUNNIES]).toEqual(['knopf', 'hasel']);
    // Leo stays as Felix reviewed him (31.10): no ear tufts yet — they are an unassigned option
    const leo = puppet(MODELS.leo);
    outfit(leo.root, MODELS.leo);
    expect(leo.root.querySelectorAll('.up .ear-l .cs, .up .ear-r .cs').length).toBe(0);
    for (const id of [...NEW_BUNNIES, ...ARCHIVED_BUNNIES]) {
      const m = MODELS[id];
      expect(m.kind).toBe('bunny');
      expect(m.de.length * m.ru.length, id).toBeGreaterThan(0);
      expect(m.breed, id).toBeTruthy();
      expect(m.role, id).toBeTruthy();
      for (const cid of COSTUME_IDS) {
        const p = puppet(m);
        const boxes = outfit(p.root, m, lookOf(COSTUMES[cid], 'bunny'));
        expect(boxes.length, `${cid} on ${id}`).toBeGreaterThan(0);
        p.destroy();
      }
    }
    // Knopf is Krümel's round baby body (demo/kruemel/kit.ts) with two short upright ears of his own
    const k = puppet(MODELS.knopf);
    outfit(k.root, MODELS.knopf);
    expect(k.root.querySelector('.hm')?.classList.contains('kit')).toBe(true);
    expect(k.root.querySelector('.hm')?.classList.contains('ears-up')).toBe(true);
    expect(k.root.querySelectorAll('.up .ear-l path, .up .ear-r path').length).toBe(4);
  });

  it('Mila is the comic\'s lop-eared Mila everywhere (Felix 30.10: no upright ears): broken coat, blossom inside her left lop ear', () => {
    expect(MODELS.mila.ears).toBe('lop');
    const p = puppet(MODELS.mila);
    outfit(p.root, MODELS.mila, lookOf(COSTUMES.bride, 'bunny'));
    const hm = p.root.querySelector('.hm');
    expect(hm?.classList.contains('ears-lop')).toBe(true);
    expect(hm?.classList.contains('ears-up')).toBe(false);
    expect(hm?.classList.contains('pat-broken')).toBe(true);
    expect(p.root.querySelector('.lop .ear-l .cs [data-look="mila-blossom"] .blossom')).not.toBeNull();
    // and on the page: every puppet wearing her blossom (bride card, groom's pair, family row) is lop-eared
    const app = mount();
    costumesGallery(app, new URLSearchParams('screens=costumes&only=groom,bride'));
    const fam = mount();
    costumesGallery(fam, new URLSearchParams('screens=costumes&tab=bunnies'));
    const milas = [...app.querySelectorAll('.cs-host'), ...fam.querySelectorAll('.cs-host')].filter((h) => h.shadowRoot?.querySelector('[data-look="mila-blossom"]'));
    expect(milas.length).toBeGreaterThan(4);
    for (const h of milas) expect(h.shadowRoot?.querySelector('.hm')?.classList.contains('ears-lop')).toBe(true);
  });

  it('Felix\'s pick (31.10) is the cheek fluff ALONE, shown first and marked', () => {
    expect(FELIX_PICK).toBe('cheeks');
    expect(EXPERIMENT_IDS[0]).toBe('cheeks');
    expect(EXPERIMENTS.cheeks.ru).toContain('выбор Кирилла');
    expect(EXPERIMENTS.cheeks.layers.map((l) => l.slot).sort()).toEqual(['cheek-l', 'cheek-r']);
    // the tuft-like ones are marked as close to the rejected tuft
    for (const id of ['tuft', 'curl', 'tuft-chest'] as const) expect(EXPERIMENTS[id].what, id).toContain('хохолк');
  });

  it('6 experiments + 2 combinations, drawn in his own coat colours (fur, not a costume)', () => {
    expect(EXPERIMENT_IDS.filter((id) => !id.includes('-')).length).toBe(6);
    expect(EXPERIMENT_IDS.filter((id) => id.includes('-')).length).toBe(2);
    const ctx = fakeCtx('bunny');
    for (const id of EXPERIMENT_IDS) {
      const svg = EXPERIMENTS[id].layers.map((l) => l.draw(ctx)).join('');
      const fills = [...svg.matchAll(/ fill="([^"]+)"/g)].map((x) => x[1]).filter((v) => v !== 'none' && v !== '#000' && v !== '#fff');
      for (const fill of fills) expect(['url(#t-g-body)', 'url(#t-g-ear)', 'var(--mascot-belly)'], `${id}: ${fill}`).toContain(fill);
      expect(svg, id).not.toMatch(/animation|<animate/);
    }
  });
});

describe('Felix\'s review 31.10: the reworked costumes', () => {
  it('the laptop stands in front of him and does NOT hop with him; his paws lie on the lid\'s top edge', () => {
    const p = puppet(MODELS.pompon, 'off');
    outfit(p.root, MODELS.pompon, lookOf(COSTUMES.laptop, 'bunny'));
    const front = p.root.querySelector('.cs-slot-front');
    expect(front?.parentElement?.classList.contains('mover')).toBe(true);
    expect(front?.closest('.hop')).toBeNull();
    expect(p.root.querySelector('style[data-costume-hide]')?.textContent).toContain('.hm .paw');
    // the lid is wider than his whole body (his widest point: ±75)
    const xs = points(lookOf(COSTUMES.laptop, 'bunny').layers[0]?.draw(fakeCtx('bunny')) ?? '').map((q) => q[0]);
    expect(Math.max(...xs)).toBeGreaterThan(90);
    expect(Math.min(...xs)).toBeLessThan(-90);
  });

  it('the headphones: the band rests on the crown, the cups reach the band (nothing floats), dreamy eyes while worn and given back', () => {
    const p = puppet(MODELS.pompon);
    const before = p.root.innerHTML;
    outfit(p.root, MODELS.pompon, lookOf(COSTUMES.headphones, 'bunny'));
    expect(p.root.querySelector('.hm')?.classList.contains('m-happy')).toBe(true);
    undress(p.root);
    expect(p.root.innerHTML).toBe(before);
    const svg = lookOf(COSTUMES.headphones, 'bunny').layers[0]?.draw(fakeCtx('bunny')) ?? '';
    const band = points(svg.match(/<path class="cs-o" d="([^"]+)" fill="#F3B3C5"/)?.[0] ?? '');
    // the band's lowest inner point over the crown is within 9 units of the head top (-163): it rests on it
    expect(Math.max(...band.filter(([x]) => Math.abs(x) < 10).map((q) => q[1]))).toBeGreaterThan(-172);
    // its ends reach down into the cups (cups span y -153 … -105)
    expect(Math.max(...band.map((q) => q[1]))).toBeGreaterThan(-153);
  });

  it('the noodle cup: tall (its rim right under his cheeks), his paws drawn on the rim, his own paws hidden', () => {
    const svg = lookOf(COSTUMES.noodles, 'bunny').layers.map((l) => l.draw(fakeCtx('bunny'))).join('');
    expect(svg).toContain('M-74 -62 Q0 -44 74 -62');
    expect(COSTUMES.noodles.hide).toContain('paws');
    expect(svg).toContain('var(--mascot-paw)');
  });

  it('spa is white (towel and mask); the bride is simpler: one veil, no crown, a tiny bouquet; the groom has sleeves and cuffs', () => {
    const spa = lookOf(COSTUMES.spa, 'bunny').layers.map((l) => l.draw(fakeCtx('bunny'))).join('');
    expect(spa).toMatch(/d="M-62 -134[^"]+" fill="#FFFFFF"/);
    expect(COSTUMES.bride.layers('bunny').map((l) => l.slot)).toEqual(['behind', 'paws']);
    expect(COSTUMES.groom.layers('bunny').map((l) => l.slot)).toEqual(['body', 'paws']);
  });
});

describe('the new hats (31.10, Felix rejected all four of 28.10)', () => {
  const all = (['nikolaus', 'winterhat'] as const).flatMap((id) => NEW_HAT_VARIANTS.map((v) => [id, v] as const));

  it('three variants each, genuinely different placements; a hat never comes down to the eyes, the forehead stays free', () => {
    expect(all.length).toBe(6);
    for (const id of ['nikolaus', 'winterhat'] as const) {
      expect(NEW_HAT_VARIANTS.map((v) => NEW_HATS[id][v].layer)).toEqual(['under', 'over', 'over']);
      expect(RECOMMENDED[id]).toBe('2');
    }
    for (const [id, v] of all) {
      const pts = points(NEW_HATS[id][v].markup());
      const label = `${id} ${v}`;
      // ≥ 24 units above the eyes' top (-100.4) everywhere; over the middle of the forehead ≥ 40 units
      expect(Math.max(...pts.map((q) => q[1])), label).toBeLessThan(-124);
      expect(Math.max(...pts.filter(([x]) => Math.abs(x) < 30).map((q) => q[1])), label).toBeLessThan(-140);
      expect(Math.max(...pts.map((q) => Math.abs(q[0]))), label).toBeLessThan(112);
    }
  });

  it('on the rig: the right slot (between the ears = under them, else over them), turning like the head, a part that swings after his hop', () => {
    const cases = all.map(([id, v]) => ({ id, v, look: { id: `hat-${id}-${v}`, layers: [{ slot: NEW_HATS[id][v].layer === 'under' ? 'under-ears' as const : 'over' as const, draw: () => `<g class="cs-head">${NEW_HATS[id][v].markup()}</g>` }] } }));
    for (const { id, v, look } of cases) {
      const p = puppet(MODELS.pompon);
      outfit(p.root, MODELS.pompon, look);
      const box = p.root.querySelector('.cs');
      expect(box?.nextElementSibling?.classList.contains(NEW_HATS[id][v].layer === 'under' ? 'lop' : 'tp'), `${id} ${v}`).toBe(true);
      expect(box?.querySelector('.cs-head .wr-wob'), `${id} ${v}`).not.toBeNull();
      p.destroy();
    }
  });

  it('the Sammlung uses the new hats now (Felix 31.10: Nikolaus «2», winter «3»), the old ones stay reachable (&hats=old); the dates are unchanged', () => {
    expect(DEFAULT_HATS).toEqual({ nikolaus: '2', winterhat: '3' });
    expect(OLD_HATS).toEqual({ nikolaus: 'a', winterhat: 'a' });
    const b = new Bunny(mount(), { idle: false, interactive: false, reducedMotion: 'force' });
    expect(sammlungDress(b.root, b.host, 'nikolaus')?.dataset['variant']).toBe('2');
    expect(sammlungDress(b.root, b.host, 'winterhat')?.dataset['variant']).toBe('3');
    expect(sammlungDress(b.root, b.host, 'winterhat', 'light', OLD_HATS)?.dataset['variant']).toBe('a');
    expect(seasonOutfit([6, 12])).toBe('nikolaus');
    expect(seasonOutfit([26, 12])).toBe('nikolaus');
    expect(seasonOutfit([27, 12])).toBe('winterhat');
    expect(seasonOutfit([28, 2])).toBe('winterhat');
    const page = mount();
    sammlungGallery(page, new URLSearchParams('screens=sammlung&view=hats'));
    expect(page.querySelectorAll('[data-hat]').length).toBe(6);
    const old = mount();
    sammlungGallery(old, new URLSearchParams('screens=sammlung&view=hats&hats=old'));
    expect(old.querySelectorAll('[data-hat]').length).toBe(4);
  });
});

describe('gallery page', () => {
  it('builds the tabs: cards with Russian names and a motion button, the pose grid, the contact sheets', () => {
    const app = mount();
    costumesGallery(app, new URLSearchParams('screens=costumes&only=sport,noodles'));
    const cards = Array.from(app.querySelectorAll('.cs-card'));
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual(['Спорт Sportler', 'В стаканчике лапши Im Nudelbecher']);
    for (const c of cards) expect(c.querySelector('button')?.textContent).toContain('прыгнуть');
    // Tapsi's version shows in the noodle card
    expect(cards[1]?.textContent).toContain('Тапси');

    const bunnies = mount();
    costumesGallery(bunnies, new URLSearchParams('screens=costumes&tab=bunnies&view=grid'));
    expect(bunnies.querySelectorAll('.cs-cell').length).toBe(NEW_BUNNIES.length * 7);

    const exp = mount();
    costumesGallery(exp, new URLSearchParams('screens=costumes&tab=experiments'));
    expect(exp.querySelectorAll('.cs-card').length).toBe(EXPERIMENT_IDS.length + 1);
    expect(exp.querySelector('.cs-card h3')?.textContent).toContain('Помпон сегодня');

    const motion = mount();
    costumesGallery(motion, new URLSearchParams('screens=costumes&view=motion&only=knight&frames=4'));
    expect(motion.querySelectorAll('.cs-cell').length).toBe(4);

    const calm = mount();
    costumesGallery(calm, new URLSearchParams('screens=costumes&reduced=1&only=lily'));
    expect((calm.querySelector('.cs-card button') as HTMLButtonElement).disabled).toBe(true);
    const host = calm.querySelector('.cs-card .cs-host') as HTMLElement;
    expect(host.shadowRoot?.querySelector('svg')?.classList.contains('rm')).toBe(true);
    expect(host.shadowRoot?.querySelector('.cs [data-look="lily"]')).not.toBeNull();

    // the new hats tab (31.10): six cards, Felix's old-hats link
    const hats = mount();
    costumesGallery(hats, new URLSearchParams('screens=costumes&tab=hats&reduced=1'));
    expect(hats.querySelectorAll('.cs-card').length).toBe(6);
    expect(hats.querySelector('a[href*="hats=old"]')).not.toBeNull();
  }, 30000);
});
