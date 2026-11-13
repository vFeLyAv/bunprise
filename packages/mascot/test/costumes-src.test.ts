import { afterEach, describe, expect, it } from 'vitest';
import { Bunny } from '../src/bunny';
import { echoMotion, hasEcho } from '../src/core';
import { ListsBuddy } from '../src/buddy/index';
import { COSTUME_CSS, ctxOf, SLOTS, type Ctx } from '../src/wardrobe/costume-rig';
import { COSTUMES, costumeLook } from '../src/wardrobe/costumes';
import { LaptopTyping, LAPTOP_ECHOES, STILL_T, TYPE_S } from '../src/wardrobe/laptop';
import { COSTUME_IDS, COSTUME_IN_FRAMES, dress, dropIn, isCostumeId, puppetRoots, wearing, wearNow, wornNow } from '../src/wardrobe/index';
import type { FakeAnimation } from './setup';

// The twelve approved costumes in the package (31.10, Felix: «Всё, что мне уже понравилось и подтвердилось, можешь
// добавлять в приложение»): the drawings copied from the gallery (demo/costumes), put on through src/wardrobe. A puppet
// nobody dresses stays byte-identical; every piece sits in its slot; one thing at a time; the laptop stands still in
// front of him and his twin paws echo his own; reduced motion = still.

afterEach(() => {
  document.body.replaceChildren();
});

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}
const still = { idle: false, interactive: false, reducedMotion: 'force' } as const;
const pompon = (reduced: 'force' | 'off' = 'force') => new Bunny(mount(), { ...still, reducedMotion: reduced, coat: 'fawn', ears: 'lop' });

/** FNV-1a of the markup with the instance id normalised (test/costumes.test.ts computed the pin with NO costume code). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
const fingerprint = (p: Bunny) => fnv(p.root.innerHTML.split(p.id).join('ID') + '|' + (p.host.getAttribute('style') ?? '') + '|' + p.host.className);

/** Every point of a drawing: path number pairs (end AND control points), ellipse / circle extremes. */
function points(markup: string): Array<[number, number]> {
  const m = markup.replace(/<clipPath[\s\S]*?<\/clipPath>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
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
const ctx: Ctx = { kind: 'bunny', ears: 'lop', clip: 'url(#t-clip-body)', uid: 't' };
const anims = (p: Bunny) => (p.root.querySelector('svg')?.getAnimations({ subtree: true }) ?? []) as unknown as FakeAnimation[];
const keysOf = (a: FakeAnimation) => a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x)));

describe('the approved costumes (src/wardrobe/costumes.ts)', () => {
  it('exactly the thirteen Felix approved (spa came last) — no noodles, strawberry, headphones, bride', () => {
    expect([...COSTUME_IDS].sort()).toEqual(['bandana', 'bunnyhood', 'groom', 'knight', 'laptop', 'lily', 'pancake', 'reading', 'samurai', 'shark', 'spa', 'sport', 'sunglasses']);
    expect(Object.keys(COSTUMES).sort()).toEqual([...COSTUME_IDS].sort());
    for (const id of ['noodles', 'strawberry', 'headphones', 'bride']) expect(isCostumeId(id), id).toBe(false);
    for (const id of COSTUME_IDS) {
      expect(COSTUMES[id].ru.length, id).toBeGreaterThan(2);
      expect(COSTUMES[id].de.length, id).toBeGreaterThan(2);
    }
  });

  it('a puppet nobody dresses is byte-identical (the pin computed with no costume code); dress → dress(null) gives the very same markup back', () => {
    expect(fingerprint(new Bunny(mount()))).toBe('8ad2402a');
    for (const id of COSTUME_IDS) {
      const p = pompon();
      const before = p.root.innerHTML;
      const g = dress(p.root, p.host, id);
      expect(g, id).not.toBeNull();
      expect(wearing(p.root), id).toBe(id);
      dress(p.root, p.host, null);
      expect(p.root.innerHTML, id).toBe(before);
      expect(wearing(p.root), id).toBeNull();
      p.destroy();
    }
  });

  it('one thing at a time: a costume takes the seasonal outfit off and the other way round', () => {
    const p = pompon();
    dress(p.root, p.host, 'scarf');
    dress(p.root, p.host, 'knight');
    expect(p.root.querySelectorAll('.wr[data-wear]')).toHaveLength(0);
    expect(wearing(p.root)).toBe('knight');
    dress(p.root, p.host, 'winterhat');
    expect(p.root.querySelectorAll('.cs, style[data-costume]')).toHaveLength(0);
    expect(wearing(p.root)).toBe('winterhat');
  });

  it('no text, no images, no logos — our own flat drawings only', () => {
    for (const id of COSTUME_IDS) {
      const svg = costumeLook(id).layers.map((l) => l.draw(ctx)).join('');
      expect(svg, id).not.toMatch(/<text|<image|<use|href=|<foreignObject/i);
    }
  });

  it('every layer goes into its slot: the container sits exactly at the slot\'s place in THIS puppet', () => {
    for (const id of COSTUME_IDS) {
      const p = pompon();
      dress(p.root, p.host, id);
      const breathe = p.root.querySelector('.breathe') as Element;
      const boxes = Array.from(p.root.querySelectorAll('.cs'));
      expect(boxes.length, id).toBeGreaterThan(0);
      for (const box of boxes) {
        const slot = box.getAttribute('class')?.match(/cs-slot-([\w-]+)/)?.[1] ?? '';
        const label = `${id}: ${slot}`;
        expect(SLOTS as readonly string[], label).toContain(slot);
        const next = box.nextElementSibling;
        if (slot === 'behind') expect(breathe.firstElementChild, label).toBe(box);
        if (slot === 'body') expect(next?.classList.contains('tf'), label).toBe(true);
        if (slot === 'under-ears') expect(next?.classList.contains('lop'), label).toBe(true);
        if (slot === 'over') expect(next?.classList.contains('tp'), label).toBe(true);
        if (slot === 'face') expect(box.parentElement?.classList.contains('face') && next === null, label).toBe(true);
        if (slot === 'face-under') expect(box.parentElement?.classList.contains('face') && box.previousElementSibling === null, label).toBe(true);
        if (slot === 'paws') expect(box.parentElement?.classList.contains('paws') && next?.classList.contains('paw-l'), label).toBe(true);
        if (slot === 'front') {
          // in front of him and NOT in his hop group: a sibling after .hop, right before his fx layer
          expect(box.parentElement?.classList.contains('mover'), label).toBe(true);
          expect(next?.classList.contains('fx'), label).toBe(true);
          expect(box.closest('.hop'), label).toBeNull();
        }
        expect(box.querySelector(`[data-look="${id}"]`), label).not.toBeNull();
      }
      p.destroy();
    }
  });

  it('each piece stays where it belongs: held props between the paws, face items on the face, hats above the eyes', () => {
    const HATS = new Set(['pancake', 'knight', 'bandana', 'lily', 'samurai', 'spa']);
    const eyeTop = -93 - 7.4;
    for (const id of COSTUME_IDS) {
      for (const layer of costumeLook(id).layers) {
        const pts = points(layer.draw(ctx));
        const label = `${id}: ${layer.slot}`;
        expect(pts.length, label).toBeGreaterThan(0);
        for (const [x, y] of pts) {
          // nothing far off the puppet (the hood's ears are the tallest: up to -240; the mug the farthest: -105)
          expect(Math.abs(x), label).toBeLessThanOrEqual(112);
          expect(y, label).toBeGreaterThanOrEqual(-245);
          expect(y, label).toBeLessThanOrEqual(12);
          if (layer.slot === 'paws') {
            // held props stay between the paws (±50); the groom's sleeves are clothing and stay inside his body
            expect(Math.abs(x), label).toBeLessThanOrEqual(id === 'groom' ? 66 : 50);
            expect(y, label).toBeGreaterThanOrEqual(-80);
          }
          if (layer.slot === 'face') {
            expect(Math.abs(x), label).toBeLessThanOrEqual(62);
            // (the spa mask also covers the forehead, up to -123.5)
            expect(y, label).toBeGreaterThanOrEqual(id === 'spa' ? -124 : -112);
            expect(y, label).toBeLessThanOrEqual(-56);
          }
          if (layer.slot === 'over' && HATS.has(id)) expect(y, `${label}: never down to the eyes`).toBeLessThan(eyeTop);
        }
      }
    }
  });

  it('glasses and sunglasses are centred on his eyes; hoods hide his own ears and tail and give them back', () => {
    for (const id of ['reading', 'sunglasses'] as const) {
      const face = costumeLook(id).layers.find((l) => l.slot === 'face');
      const right = points(face?.draw(ctx) ?? '').filter(([x]) => x > 0);
      const cx = (Math.min(...right.map((q) => q[0])) + Math.max(...right.map((q) => q[0]))) / 2;
      expect(Math.abs(cx - 29), id).toBeLessThan(9);
    }
    for (const id of ['bunnyhood', 'shark'] as const) {
      const p = pompon();
      dress(p.root, p.host, id);
      const hide = p.root.querySelector('style[data-costume-hide]')?.textContent ?? '';
      expect(hide, id).toContain('.lop');
      expect(hide, id).toContain('.tail');
      dress(p.root, p.host, null);
      expect(p.root.querySelector('style[data-costume-hide]'), id).toBeNull();
    }
  });

  it('spa: his eyes rest closed while worn (scoped CSS, no class on .hm), a scene\'s own eyes still win; taken off again', () => {
    const p = pompon();
    const before = p.root.innerHTML;
    dress(p.root, p.host, 'spa');
    const css = p.root.querySelector('style[data-costume-hide]')?.textContent ?? '';
    expect(css).toContain('.hm:not(.m-star):not(.m-happy):not(.m-sleep):not(.bd-m-heart):not(.bd-m-dizzy) .eyes { opacity: 0; }');
    expect(css).toContain('.eyes-sleep { opacity: 1; }');
    expect(p.root.querySelector('.hm')?.getAttribute('class')).not.toMatch(/m-sleep/);
    // the mask leaves his closed eyes visible: two holes right where his eyes are
    expect(costumeLook('spa').layers.find((l) => l.slot === 'face')?.draw(ctx)).toContain('M37.6 -93');
    dress(p.root, p.host, null);
    expect(p.root.innerHTML).toBe(before);
  });

  it('garments over the body are clipped to THIS puppet\'s body (two puppets, two clips)', () => {
    const a = pompon();
    const b = pompon();
    dress(a.root, a.host, 'groom');
    dress(b.root, b.host, 'groom');
    const clipOf = (p: Bunny) => p.root.querySelector('.cs-slot-body g[clip-path]')?.getAttribute('clip-path');
    expect(clipOf(a)).toBe(`url(#${a.root.querySelector('clipPath[id$="clip-body"]')?.id})`);
    expect(clipOf(a)).not.toBe(clipOf(b));
    expect(ctxOf(a.root)?.uid).not.toBe(ctxOf(b.root)?.uid);
  });
});

describe('motion', () => {
  it('reduced motion: nothing moves — no CSS animation in the costumes, his jump with any costume starts no animation, no put-on', async () => {
    expect(COSTUME_CSS).not.toMatch(/animation|@keyframes/);
    for (const id of COSTUME_IDS) {
      const p = pompon('force');
      const g = dress(p.root, p.host, id);
      expect(dropIn(g, true), id).toBeNull();
      void p.play('jump');
      await Promise.resolve();
      expect(anims(p).length, id).toBe(0);
      p.destroy();
    }
  });

  it('full motion: the put-on and his jump animate only transform / opacity; dangling parts swing once and end at rest', () => {
    for (const k of COSTUME_IN_FRAMES) for (const key of Object.keys(k).filter((x) => !['offset', 'easing'].includes(x))) expect(['transform', 'opacity']).toContain(key);
    for (const id of COSTUME_IDS) {
      const p = pompon('off');
      const g = dress(p.root, p.host, id);
      expect(dropIn(g, false), id).not.toBeNull();
      void p.play('jump');
      const list = anims(p);
      expect(list.length, id).toBeGreaterThan(0);
      for (const a of list) for (const key of keysOf(a)) expect(['transform', 'opacity'], `${id}: ${key}`).toContain(key);
      if (['knight', 'bandana', 'bunnyhood', 'shark'].includes(id)) {
        const swings = list.filter((a) => a.effect.target.classList.contains('wr-wob'));
        expect(swings.length, `${id}: its dangling parts swing`).toBeGreaterThan(0);
        for (const s of swings) {
          expect(s.effect.getTiming().iterations ?? 1, id).toBe(1);
          const frames = s.effect.getKeyframes();
          expect(frames[frames.length - 1]?.transform, id).toBe('rotate(0deg)');
        }
      }
      p.destroy();
    }
  });

  it('the shared prototype is never patched; a plain puppet next to a dressed one gets nothing', () => {
    const animate = Element.prototype.animate;
    const a = pompon('off');
    dress(a.root, a.host, 'laptop');
    void a.play('jump');
    const plain = new Bunny(mount());
    expect(plain.root.querySelector('.cs, style[data-costume]')).toBeNull();
    expect(fingerprint(plain)).toBe('8ad2402a');
    expect(Element.prototype.animate).toBe(animate);
  });
});

describe('the laptop, composition A «Экраном к нему»', () => {
  it('stands on the floor in front of him (never hops), the screen towards him: his own paws and tail hidden, turned to the screen', () => {
    const p = pompon();
    dress(p.root, p.host, 'laptop');
    const front = p.root.querySelector('.cs-slot-front');
    expect(front?.querySelector('.lt-root')?.getAttribute('data-variant')).toBe('a');
    expect(front?.querySelector('.lt-mug')).not.toBeNull();
    expect(front?.querySelectorAll('.lt-key').length).toBeGreaterThan(30);
    expect(front?.querySelectorAll('.lt-word')).toHaveLength(9);
    expect(p.root.querySelector('style[data-costume-hide]')?.textContent).toContain('.hm .paw');
    // the turn is on the svg (his own scenes clear `.hm`, never the svg) and goes again with the laptop
    const svg = p.root.querySelector('svg');
    expect(svg?.classList.contains('turn-r')).toBe(true);
    expect(p.root.querySelector('.hm')?.classList.contains('turn-r')).toBe(false);
    dress(p.root, p.host, 'reading');
    expect(svg?.classList.contains('turn-r')).toBe(false);
  });

  it('the twin paws echo his .hop, .body and .paws: his jump plays the same keyframes on them; taking it off ends the echo', () => {
    const p = pompon('off');
    dress(p.root, p.host, 'laptop');
    for (const [src] of LAPTOP_ECHOES) expect(hasEcho(p.root.querySelector(src) as Element), src).toBe(true);
    void p.play('jump');
    const list = anims(p);
    for (const [src, dst] of LAPTOP_ECHOES) {
      const own = list.filter((a) => a.effect.target === p.root.querySelector(src));
      const twin = list.filter((a) => a.effect.target === p.root.querySelector(dst));
      expect(own.length, src).toBeGreaterThan(0);
      expect(twin.length, dst).toBe(own.length);
      expect(JSON.stringify(twin.map((a) => a.effect.getKeyframes())), dst).toBe(JSON.stringify(own.map((a) => a.effect.getKeyframes())));
      expect(twin.map((a) => a.effect.getTiming().duration), dst).toEqual(own.map((a) => a.effect.getTiming().duration));
    }
    dress(p.root, p.host, null);
    for (const [src] of LAPTOP_ECHOES) expect(hasEcho(p.root.querySelector(src) as Element), src).toBe(false);
  });

  it('an echo also keeps the inline transform (a committed pose, a reset) — and ends when it is told to', async () => {
    const a = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const b = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    echoMotion(a, () => b);
    a.style.transform = 'translateY(-24px)';
    await Promise.resolve();
    expect(b.style.transform).toBe('translateY(-24px)');
    a.style.transform = '';
    await Promise.resolve();
    expect(b.style.transform).toBe('');
    echoMotion(a, null);
    a.style.transform = 'translateY(-5px)';
    await Promise.resolve();
    expect(b.style.transform).toBe('');
  });

  it('on the Lists buddy (carried about, walking) the desk is not drawn: he is away from it, his own paws show', () => {
    const host = mount();
    const card = document.createElement('div');
    card.dataset['buddyFloor'] = 'c';
    host.append(card);
    const buddy = new ListsBuddy({ stage: host, scroller: null, kind: 'bunny', width: 96, reducedMotion: 'force', autonomous: false } as never);
    const root = host.querySelector('.bd-host')?.shadowRoot ?? null;
    expect(root && puppetRoots(root).includes(root)).toBe(true);
    if (!root) return;
    dress(root, root.host as HTMLElement, 'laptop');
    expect(wearing(root)).toBe('laptop');
    expect(root.querySelector('.lt-root, .cs, style[data-costume-hide]')).toBeNull();
    expect(root.querySelector('svg')?.classList.contains('turn-r')).toBe(false);
    dress(root, root.host as HTMLElement, 'knight');
    expect(root.querySelector('.cs-slot-over')).not.toBeNull();
    buddy.destroy();
  });

  it('typing: one finite timeline of transform / opacity; destroy() takes back every inline style', () => {
    const p = pompon('off');
    dress(p.root, p.host, 'laptop');
    // (a style attribute written and emptied again serialises with a trailing «;» — the same style)
    const html = () => p.root.innerHTML.replace(/;"/g, '"');
    const before = html();
    const t = new LaptopTyping(p.root, p.host, false);
    expect(t.duration).toBe(TYPE_S);
    t.seek(1.0);
    const list = anims(p);
    expect(list.length).toBeGreaterThan(20);
    for (const a of list) {
      expect(a.effect.getTiming().iterations ?? 1).toBe(1);
      for (const key of keysOf(a)) expect(['transform', 'opacity'], key).toContain(key);
    }
    t.destroy();
    for (const el of Array.from(p.root.querySelectorAll('.lt-paw, .lt-key, .lt-word, .lt-heart, .eyes, .squash'))) {
      expect((el as SVGElement).style.transform, el.getAttribute('class') ?? '').toBe('');
      expect((el as SVGElement).style.opacity, el.getAttribute('class') ?? '').toBe('');
    }
    expect(html()).toBe(before);
  });

  it('typing under reduced motion: no animate() at all — the still typing pose (tongue out, words on the screen)', () => {
    const p = pompon('force');
    dress(p.root, p.host, 'laptop');
    const t = new LaptopTyping(p.root, p.host, true);
    expect(anims(p)).toHaveLength(0);
    expect(t.time).toBe(STILL_T);
    expect((p.root.querySelector('.lt-tongue') as SVGElement).style.opacity).toBe('1');
    const shown = Array.from(p.root.querySelectorAll<SVGElement>('.lt-word')).filter((w) => w.style.opacity === '1');
    expect(shown.length).toBeGreaterThan(3);
    t.play();
    expect(anims(p)).toHaveLength(0);
    t.destroy();
  });
});

describe('the rules with the costumes (src/wardrobe/rules.ts)', () => {
  it('a costume is worn only when chosen AND the person\'s; the seasonal outfits are exactly as before', () => {
    expect(wearNow('knight', [31, 10], 0, ['knight'])).toBe('knight');
    expect(wearNow('knight', [31, 10], 9, [])).toBeNull();
    expect(wearNow('auto', [31, 10], 0, ['knight'])).toBe('leaf');
    expect(wearNow('none', [31, 10], 0, ['knight'])).toBeNull();
    expect(wearNow('daisy', [15, 1], 5, [])).toBe('daisy');
    // wornNow (outfits only) never returns a costume
    expect(wornNow('knight', [31, 10], 'B', 9)).toBeNull();
    expect(wornNow('auto', [15, 7], 'B', 9)).toBeNull();
  });
});
