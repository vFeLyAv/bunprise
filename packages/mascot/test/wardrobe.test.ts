import { afterEach, describe, expect, it } from 'vitest';
import { Bunny, BUNNY_CSS } from '../src/bunny';
import { Hamster } from '../src/hamster';
import { BODY } from '../src/shapes';
import { easing } from '../src/timeline';
import {
  BEANIE_SHAPES,
  bodyClip,
  dayOfYear,
  puppetRoots,
  putOn,
  RING_IN,
  RING_OUT,
  SCARF_KNOT,
  SCARF_TAIL,
  takeOff,
  WEAR,
  WEAR_CSS,
  WEAR_IDS,
  WEAR_PALETTES,
  wearVars,
  wobbleFrames,
  wornOn,
  type WearId,
  type WearTheme,
} from '../demo/wardrobe/items';
import { BODY_REST, embed, hopFrames, MOMENTS, momentTotal, parseTf, REST, sampleOpacity, sampleTf, Update, UPDATE, updateFrames, type Tf } from '../demo/wardrobe/update';
import { buildCell, wardrobeGallery } from '../demo/wardrobe/gallery';

// The wardrobe v2 (gallery prototype 26.10, Felix: «больше креатива и масштаба»): seven items over the year for
// both mascots, put on any puppet from outside; they follow his turn exactly like his face / paws, never cover
// Tapsi's folded ear, stay where they belong; every item has its own put-on moment — one seekable timeline,
// transform / opacity only, finite, ≤ 1.6 s, deterministic, ending exactly at rest, eyes shut whenever the item
// covers them, reduced motion = no animation.

afterEach(() => {
  document.body.replaceChildren();
});

function mount(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

/** All "x y" number pairs of a path (end AND control points: a Bézier never leaves their hull). */
function points(d: string): Array<[number, number]> {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i] as number, n[i + 1] as number]);
  return out;
}

/** The body silhouette's half width at height y (sampled from BODY's right half: four cubics). */
function halfWidth(y: number): number {
  const p = points(BODY).slice(0, 13); // M + 4 × C (3 points each) = the right half, top to bottom
  let best = 0;
  for (let s = 0; s < 4; s++) {
    const at = (i: number): [number, number] => p[i] ?? [0, 0];
    const [p0, c1, c2, p1] = [at(s * 3), at(s * 3 + 1), at(s * 3 + 2), at(s * 3 + 3)];
    for (let k = 0; k <= 200; k++) {
      const t = k / 200;
      const m = 1 - t;
      const by = m * m * m * p0[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * p1[1];
      const bx = m * m * m * p0[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * p1[0];
      if (Math.abs(by - y) < 0.6) best = Math.max(best, bx);
    }
  }
  return best;
}

/** A path (absolute M / L / C / Q / Z only) as polygons, one per subpath, Béziers flattened. */
function polygons(d: string): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  let pen: [number, number] = [0, 0];
  for (const m of d.matchAll(/([MLCQZ])([^MLCQZ]*)/g)) {
    const nums = (m[2]?.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const pt = (i: number): [number, number] => [nums[i] ?? 0, nums[i + 1] ?? 0];
    switch (m[1]) {
      case 'M':
        if (cur.length) out.push(cur);
        pen = pt(0);
        cur = [pen];
        break;
      case 'L':
        for (let i = 0; i < nums.length; i += 2) cur.push((pen = pt(i)));
        break;
      case 'C':
        for (let i = 0; i + 5 < nums.length; i += 6) {
          const [a, b, c] = [pt(i), pt(i + 2), pt(i + 4)];
          const p0 = pen;
          for (let k = 1; k <= 10; k++) {
            const t = k / 10;
            const u = 1 - t;
            cur.push([u * u * u * p0[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * c[0], u * u * u * p0[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * c[1]]);
          }
          pen = c;
        }
        break;
      case 'Q':
        for (let i = 0; i + 3 < nums.length; i += 4) {
          const [a, c] = [pt(i), pt(i + 2)];
          const p0 = pen;
          for (let k = 1; k <= 8; k++) {
            const t = k / 8;
            const u = 1 - t;
            cur.push([u * u * p0[0] + 2 * u * t * a[0] + t * t * c[0], u * u * p0[1] + 2 * u * t * a[1] + t * t * c[1]]);
          }
          pen = c;
        }
        break;
      case 'Z':
        if (cur.length) out.push(cur);
        cur = [];
        break;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function inside([x, y]: [number, number], poly: Array<[number, number]>): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as [number, number];
    const b = poly[j] as [number, number];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}

/** The inverse of a canonical transform (translate, rotate, scale about an origin): where a point was before it. */
function unapply(tf: Tf, origin: [number, number], [x, y]: [number, number]): [number, number] {
  const r = (-tf.r * Math.PI) / 180;
  const qx = x - origin[0] - tf.x;
  const qy = y - origin[1] - tf.y;
  return [origin[0] + (qx * Math.cos(r) - qy * Math.sin(r)) / tf.sx, origin[1] + (qx * Math.sin(r) + qy * Math.cos(r)) / tf.sy];
}

const NEUTRAL = new Set(['none', REST, BODY_REST, 'translateY(0px)', 'scale(1,1)', 'translate(0px, 0px)']);
const restOpacity = (part: string) => (part === 'happy' || part === 'star' || part === 'mouthOpen' || part.startsWith('wr-fx') ? 0 : 1);
const puppetOf = (id: WearId) => (WEAR[id].kind === 'bunny' ? new Bunny(mount(), { idle: false, reducedMotion: 'off' }) : new Hamster(mount(), { idle: false, reducedMotion: 'off' }));

describe('items', () => {
  it('seven items over the year, both mascots; each uses only its two colour tokens (and shades of them), with the contour', () => {
    expect(WEAR_IDS.length).toBe(7);
    expect(new Set(WEAR_IDS.map((id) => WEAR[id].kind))).toEqual(new Set(['bunny', 'hamster']));
    expect(WEAR_IDS).not.toContain('bat' as WearId);
    expect(WEAR_IDS).not.toContain('advent' as WearId);
    for (const id of WEAR_IDS) {
      const markup = WEAR[id].markup('url(#x-clip-body)');
      const fills = Array.from(markup.matchAll(/fill="([^"]+)"/g), (m) => m[1] ?? '');
      expect(fills.length).toBeGreaterThan(0);
      for (const f of fills) expect(f === 'none' || f === '#FFFFFF' || /^(color-mix\(in srgb, )?var\(--mascot-wear-[12], #[0-9A-F]{6}\)/.test(f), `${id}: ${f}`).toBe(true);
      expect(markup).toContain('class="wr-o"');
      expect(markup).not.toMatch(/--mascot-wear-[3-9]/);
    }
    expect(WEAR_CSS).toContain('stroke: var(--mascot-outline, none)');
    expect(WEAR_CSS).toContain('paint-order: stroke fill');
  });

  it('nothing moves by itself: the only loops are HIS (binocular head motion, the walk), both off under reduced motion', () => {
    const animations = WEAR_CSS.match(/animation:\s*[^;]+;/g) ?? [];
    expect(animations).toEqual([
      'animation: bino-ears 16s cubic-bezier(.45, 0, .2, 1) infinite;',
      'animation: wr-wob-walk .5s ease-in-out infinite;',
      'animation: none;',
    ]);
    expect(WEAR_CSS).toContain('.hold-binoculars .wr-head { animation: bino-ears');
    expect(WEAR_CSS).toContain('.walking .wr-wob { animation: wr-wob-walk');
    expect(WEAR_CSS).toContain('.rm .hold-binoculars .wr-head, .rm .walking .wr-wob { animation: none; }');
    expect(WEAR_CSS.match(/@keyframes [\w-]+/g)).toEqual(['@keyframes wr-wob-walk']);
    // moment-only extras are invisible at rest
    expect(WEAR_CSS).toContain('.wr-fx { opacity: 0; }');
  });

  it('items on the face / neck turn exactly like the face (.tf) and the paws (.tp) of BUNNY_CSS', () => {
    const rule = (css: string, sel: string) => css.match(new RegExp(`${sel.replace(/\./g, '\\.')}(?=[\\s,{])[^{]*\\{\\s*transform:\\s*([^;]+);`))?.[1];
    for (const dir of ['r', 'l']) {
      expect(rule(WEAR_CSS, `.turn-${dir} .wr-front`)).toBe(rule(BUNNY_CSS, `.turn-${dir} .tf`));
      expect(rule(WEAR_CSS, `.turn-${dir} .wr-band`)).toBe(rule(BUNNY_CSS, `.turn-${dir} .tp`));
    }
    expect(WEAR_CSS).toContain('transition: transform .28s cubic-bezier(.3, .7, .3, 1)');
    expect(BUNNY_CSS).toContain('transition: transform .28s cubic-bezier(.3, .7, .3, 1)');
    expect(WEAR_CSS).toContain('.wr-front { transform-origin: 0px 0px; }');
  });

  it("the scarf's tail and knot stay inside Pompon's outline, straight and in both 3/4 turns", () => {
    for (const [dx, sx] of [[0, 1], [13, 0.88], [-13, 0.88]] as const) {
      for (const [x, y] of [...points(SCARF_TAIL), ...points(SCARF_KNOT)]) {
        const turned = dx + sx * x;
        expect(Math.abs(turned), `x ${turned.toFixed(1)} at y ${y}`).toBeLessThan(halfWidth(y) - 2);
      }
    }
  });

  it("Tapsi's beanie never comes near his folded ear (≥ 12 units), straight and in both turns, and sits on his head", () => {
    const placed = BEANIE_SHAPES.flatMap((d) => points(d));
    // the folded ear: ellipse (55, -142.6) 16.5 × 10.4 rotated 34° (hamster.ts), its fill-box
    const a = (34 * Math.PI) / 180;
    const hw = Math.hypot(16.5 * Math.cos(a), 10.4 * Math.sin(a));
    const earLeft = 55 - hw;
    const cases: Array<{ name: string; hat: (x: number) => number; ear: number }> = [
      { name: 'front', hat: (x) => x, ear: earLeft },
      // .turn-r .wr-head translateX(11) scaleX(.9) about x = 0; .turn-r .te-r translateX(7)
      { name: 'turn-r', hat: (x) => 11 + 0.9 * x, ear: earLeft + 7 },
      // .turn-l .te-r translateX(-15) scale(.86) about its fill-box 50% 100%
      { name: 'turn-l', hat: (x) => -11 + 0.9 * x, ear: 55 + (earLeft - 55) * 0.86 - 15 },
    ];
    for (const c of cases) {
      const right = Math.max(...placed.map(([x]) => c.hat(x)));
      expect(c.ear - right, c.name).toBeGreaterThanOrEqual(12);
    }
    // the brim's lower edge is inside the head (it sits ON him, not above), the cheeks (puff 1.35 → y ≈ -120) far below
    const lowest = Math.max(...placed.map(([, y]) => y));
    expect(lowest).toBeGreaterThan(-140);
    expect(lowest).toBeLessThan(-120);
  });

  it("the swim ring goes round Tapsi's waist: the hole is wider than his body, the ring stays above his feet", () => {
    expect(RING_IN.rx).toBeGreaterThanOrEqual(halfWidth(RING_IN.cy));
    expect(RING_OUT.cy + RING_OUT.ry).toBeLessThan(-8.8); // the feet's top (hamster.ts foot ellipse cy -3, ry 5.8)
    // his front paws (y -58 … -34) rest on its front edge
    expect(RING_IN.cy + RING_IN.ry).toBeGreaterThan(-46);
  });

  it('colours: every item × theme has two colours; another palette replaces them, a night theme lifts them', () => {
    const themes: WearTheme[] = ['light', 'dark', 'navy'];
    for (const id of WEAR_IDS) {
      for (const t of themes) {
        const v = wearVars(id, t);
        expect(v['--mascot-wear-1']).toMatch(/^#[0-9A-F]{6}$/i);
        expect(v['--mascot-wear-2']).toMatch(/^#[0-9A-F]{6}$/i);
      }
      const alt = WEAR_PALETTES[id][1];
      expect(alt, id).toBeDefined();
      if (alt) {
        expect(wearVars(id, 'light', 1)['--mascot-wear-1']).toBe(alt.c[0]);
        expect(wearVars(id, 'dark', 1)['--mascot-wear-1']).not.toBe(alt.c[0]);
      }
    }
  });

  it('the year (Germany): one item at a time per mascot, the special days win over the season, the birthday over the date', () => {
    for (const kind of ['bunny', 'hamster'] as const) {
      const seasonal = WEAR_IDS.filter((id) => WEAR[id].kind === kind && WEAR[id].spans.length);
      for (const id of seasonal) for (const s of WEAR[id].spans) expect(dayOfYear(s.to)).toBeGreaterThanOrEqual(dayOfYear(s.from));
    }
    const bunny: Array<[number, number, WearId | null]> = [
      [15, 1, 'scarf'], [28, 2, 'scarf'], [10, 3, null], [20, 3, 'wreath'], [31, 5, 'wreath'], [15, 7, null],
      [24, 10, 'witch'], [26, 10, 'witch'], [31, 10, 'witch'], [1, 11, 'scarf'], [5, 12, 'scarf'], [6, 12, 'nikolaus'],
      [24, 12, 'nikolaus'], [26, 12, 'nikolaus'], [27, 12, 'scarf'],
    ];
    for (const [d, m, want] of bunny) expect(wornOn('bunny', [d, m]), `${d}.${m}`).toBe(want);
    const hamster: Array<[number, number, WearId | null]> = [[1, 1, 'beanie'], [1, 4, null], [1, 6, 'ring'], [31, 8, 'ring'], [1, 10, null], [1, 12, 'beanie']];
    for (const [d, m, want] of hamster) expect(wornOn('hamster', [d, m]), `${d}.${m}`).toBe(want);
    expect(wornOn('bunny', [10, 12], 'birthday')).toBe('party');
    expect(WEAR.party.occasion).toBeTruthy();
  });
});

describe('putOn', () => {
  it('puts the item into the breathing group, right before the front paws, clipped to THIS puppet; one at a time', () => {
    const bunny = new Bunny(mount(), { idle: false, reducedMotion: 'force' });
    const g = putOn(bunny.root, 'scarf');
    expect(g).not.toBeNull();
    const breathe = bunny.root.querySelector('.breathe');
    expect(g?.parentElement).toBe(breathe);
    expect(g?.nextElementSibling?.classList.contains('tp')).toBe(true);
    const clip = bodyClip(bunny.root);
    expect(clip).toMatch(/^url\(#[\w-]*bunny-\d+-clip-body\)$/);
    expect(g?.innerHTML).toContain(`clip-path="${clip}"`);
    expect(g?.querySelector('.wr-fall .wr-front')).not.toBeNull();
    putOn(bunny.root, 'witch');
    expect(bunny.root.querySelectorAll('.wr').length).toBe(1);
    expect(bunny.root.querySelector('.wr')?.getAttribute('data-wear')).toBe('witch');
    expect(bunny.root.querySelectorAll('style[data-wardrobe]').length).toBe(1);
    takeOff(bunny.root);
    expect(bunny.root.querySelectorAll('.wr').length).toBe(0);
    bunny.destroy();
  });

  it('every item: exactly ONE element per turn target it uses (a second would get the turn twice), none on the slot wrapper', () => {
    for (const id of WEAR_IDS) {
      const p = puppetOf(id);
      const worn = putOn(p.root, id);
      expect(worn, id).not.toBeNull();
      for (const cls of ['wr-front', 'wr-band', 'wr-head']) {
        expect(worn?.classList.contains(cls), `${id} wrapper`).toBe(false);
        expect(p.root.querySelectorAll(`.${cls}`).length, `${id} .${cls}`).toBeLessThanOrEqual(1);
      }
      expect(p.root.querySelectorAll('.wr-front, .wr-band, .wr-head').length, id).toBeGreaterThan(0);
      p.destroy();
    }
  });

  it("two puppets keep their own clips (the ring's own clip too); stages are searched for puppets", () => {
    const a = new Hamster(mount(), { idle: false, reducedMotion: 'force' });
    const b = new Hamster(mount(), { idle: false, reducedMotion: 'force' });
    putOn(a.root, 'ring');
    putOn(b.root, 'ring');
    const ida = a.root.querySelector('.wr clipPath')?.id;
    const idb = b.root.querySelector('.wr clipPath')?.id;
    expect(ida).toBeTruthy();
    expect(ida).not.toBe(idb);
    a.destroy();
    b.destroy();
    const stage = mount();
    const root = stage.attachShadow({ mode: 'open' });
    const actor = document.createElement('div');
    root.append(actor);
    const bunny = new Bunny(actor, { idle: false, reducedMotion: 'force' });
    expect(puppetRoots(stage)).toEqual([bunny.root]);
    bunny.destroy();
  });

  it('follow-through: after HIS hop the dangling parts swing once (added to the turn lean) and settle; never under reduced motion', () => {
    const bunny = new Bunny(mount(), { idle: false, reducedMotion: 'off' });
    putOn(bunny.root, 'nikolaus');
    const wob = bunny.root.querySelector('.wr-wob');
    expect(wob?.getAnimations().length).toBe(0);
    void bunny.hop();
    const swing = wob?.getAnimations()[0];
    if (!swing) throw new Error('no swing after the hop');
    // (the test shim keeps the options it was given: composite: 'add' = on top of the turn lean)
    const timing = swing.effect?.getTiming() as KeyframeAnimationOptions;
    expect(timing.duration).toBe(560 + 560);
    expect(timing.composite).toBe('add');
    const frames = (swing.effect as KeyframeEffect).getKeyframes();
    expect(frames[0]?.transform).toBe('rotate(0deg)');
    expect(frames[frames.length - 1]?.transform).toBe('rotate(0deg)');
    expect(wobbleFrames(14, 560).frames.every((f) => Number.isFinite(parseTf(f.transform as string).r))).toBe(true);
    bunny.destroy();
    const calm = new Bunny(mount(), { idle: false, reducedMotion: 'force' });
    putOn(calm.root, 'nikolaus');
    void calm.hop();
    expect(calm.root.querySelector('.wr-wob')?.getAnimations().length).toBe(0);
    calm.destroy();
  });
});

describe('the moments (each item its own «Обновка»)', () => {
  it('every moment: ≤ 1.6 s, transform / opacity only, finite numbers, offsets 0 → 1, deterministic', () => {
    for (const id of WEAR_IDS) {
      const total = momentTotal(id);
      expect(total, id).toBeGreaterThan(0.8);
      expect(total, id).toBeLessThanOrEqual(UPDATE.max);
      expect(UPDATE.max).toBe(1.6);
      const frames = updateFrames(id);
      expect(updateFrames(id), `${id} deterministic`).toEqual(frames);
      for (const [part, list] of Object.entries(frames)) {
        let last = -1;
        for (const f of list ?? []) {
          for (const k of Object.keys(f)) expect(['transform', 'opacity', 'offset', 'easing'], `${id}.${part}: ${k}`).toContain(k);
          const off = Number(f.offset);
          expect(off, `${id}.${part}`).toBeGreaterThanOrEqual(last);
          last = off;
          for (const num of String(f.transform ?? '').match(/-?\d*\.?\d+(e-?\d+)?/g) ?? []) expect(Number.isFinite(Number(num)), `${id}.${part} ${f.transform}`).toBe(true);
          expect(String(f.transform ?? '')).not.toMatch(/NaN|Infinity|undefined/);
          if (f.opacity !== undefined) expect(Number(f.opacity)).toBeGreaterThanOrEqual(0);
        }
        expect(list?.[0]?.offset, `${id}.${part}`).toBe(0);
        expect(list?.[list.length - 1]?.offset, `${id}.${part}`).toBe(1);
      }
    }
  });

  it('every part ends exactly at rest (no jump when the puppet is handed back); the item ends exactly in its place', () => {
    for (const id of WEAR_IDS) {
      const frames = updateFrames(id);
      for (const [part, list] of Object.entries(frames)) {
        const end = list?.[list.length - 1];
        if (end?.transform !== undefined) expect(NEUTRAL.has(String(end.transform)), `${id}.${part} ends ${String(end.transform)}`).toBe(true);
        if (end?.opacity !== undefined) expect(Number(end.opacity), `${id}.${part}`).toBe(restOpacity(part));
      }
      // the item comes from somewhere and lands exactly in its place
      expect(frames.fall?.[0]?.transform, id).not.toBe(REST);
      expect(frames.fall?.[frames.fall.length - 1]?.transform, id).toBe(REST);
      expect(frames.wear?.[0]?.opacity, id).toBe(0);
      const atEnd = sampleTf(frames.fall, 1, easing);
      expect(atEnd).toEqual(parseTf(REST));
    }
  });

  it('a moment-only extra (horn, confetti, petals) never pops in still: it appears while it moves out of something', () => {
    for (const id of WEAR_IDS) {
      for (const [part, list] of Object.entries(updateFrames(id))) {
        if (!part.startsWith('wr-fx') || !list) continue;
        const i = list.findIndex((f) => Number(f.opacity ?? 0) > 0);
        expect(i, `${id}.${part}`).toBeGreaterThan(0);
        expect(list[i]?.transform, `${id}.${part}`).not.toBe(list[i - 1]?.transform);
      }
    }
  });

  it('its hop (ring, beanie) IS the approved hop(): the same keyframes the puppet itself plays (jumpMotion(10, 560))', () => {
    const bunny = new Bunny(mount(), { idle: false, reducedMotion: 'off' });
    void bunny.hop();
    const mine = hopFrames('bunny');
    const norm = (list: Keyframe[] | undefined) => list?.map((f, i) => ({ ...f, offset: f.offset ?? (i === 0 ? 0 : i === list.length - 1 ? 1 : f.offset) }));
    const real = (sel: string) => norm((bunny.root.querySelector(sel)?.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes());
    expect(real('.hop')).toEqual(mine.hop);
    expect(real('.body')).toEqual(mine.body);
    expect(real('.foot-l')).toEqual(mine.footL);
    expect(real('.paws')).toEqual(mine.paws);
    expect(real('.lop .ear-l')).toEqual(mine.earL);
    bunny.destroy();
    const ham = new Hamster(mount(), { idle: false, reducedMotion: 'off' });
    void ham.hop();
    const hm = hopFrames('hamster');
    const realH = (sel: string) => norm((ham.root.querySelector(sel)?.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes());
    expect(realH('.body')).toEqual(hm.body);
    expect(realH('.ear-tip')).toEqual(hm.tip);
    ham.destroy();
    // spliced into the ring's and the beanie's moments unchanged: the same transforms at the same times
    for (const [id, start] of [['ring', 0.84], ['beanie', 0.44]] as const) {
      const total = momentTotal(id);
      const hop = updateFrames(id).hop ?? [];
      const want = embed(hm.hop ?? [], start, UPDATE.hopS, total);
      expect(hop.map((f) => f.transform), id).toEqual(want.map((f) => f.transform));
      expect(hop.map((f) => f.offset), id).toEqual(want.map((f) => f.offset));
    }
  });

  it('embed() places a sub-animation in the moment and holds its ends', () => {
    const out = embed([{ transform: 'a', offset: 0 }, { transform: 'b', offset: 1, easing: 'ease' }], 0.5, 0.25, 1);
    expect(out).toEqual([
      { transform: 'a', offset: 0 },
      { transform: 'a', offset: 0.5 },
      { transform: 'b', offset: 0.75, easing: 'ease' },
      { transform: 'b', offset: 1 },
    ]);
  });

  it('his eyes are shut whenever any part of the item covers them (every item, every 4 ms)', () => {
    // where the item passes over his face: the scarf and the ring fall past it, the witch hat sinks over his eyes
    const covers: Partial<Record<WearId, number>> = {};
    for (const id of WEAR_IDS) {
      const spec = WEAR[id];
      const p = puppetOf(id);
      const worn = putOn(p.root, id);
      if (!worn) throw new Error('no item');
      const frames = updateFrames(id);
      const total = momentTotal(id);
      // every visible shape of the item with the chain of its moving groups (innermost first)
      const shapes = Array.from(worn.querySelectorAll('path'))
        .filter((el) => el.getAttribute('fill') !== 'none' && !el.closest('.wr-fx') && !el.closest('clipPath'))
        .map((el) => {
          const chain: Array<{ part: string; origin: [number, number] }> = [];
          for (let g: Element | null = el.parentElement; g && g !== worn; g = g.parentElement) {
            const cls = Array.from(g.classList).find((c) => c === 'wr-fall' || c.startsWith('wr-m-'));
            if (!cls) continue;
            const o = (g.getAttribute('style') ?? '').match(/transform-origin:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/);
            chain.push({ part: cls === 'wr-fall' ? 'fall' : cls, origin: [Number(o?.[1] ?? 0), Number(o?.[2] ?? 0)] });
          }
          const polys = polygons(el.getAttribute('d') ?? '');
          const xs = polys.flat().map(([x]) => x);
          const ys = polys.flat().map(([, y]) => y);
          return { polys, chain, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const };
        });
      const eye = spec.kind === 'bunny' ? { x: 29, y: -93, rx: 6.2, ry: 7.4 } : { x: 32, y: -96, rx: 5.8, ry: 7.2 };
      const samples: Array<[number, number]> = [];
      for (const sx of [-1, 1]) {
        samples.push([sx * eye.x, eye.y]);
        for (let k = 0; k < 8; k++) samples.push([sx * eye.x + 0.9 * eye.rx * Math.cos((k * Math.PI) / 4), eye.y + 0.9 * eye.ry * Math.sin((k * Math.PI) / 4)]);
      }
      let covered = 0;
      for (let t = 0; t <= total + 1e-9; t += 0.004) {
        const pr = t / total;
        const face = sampleTf(frames.face, pr, easing);
        const eyes = samples.map(([x, y]): [number, number] => [x + face.x, y + face.y]);
        // the eyes taken back into the item's own (resting) space: outermost moving group first
        const hit = shapes.some(({ polys, chain, box }) => {
          const local = eyes.map((e) => chain.reduceRight((q, c) => unapply(sampleTf(frames[c.part as keyof typeof frames], pr, easing), c.origin, q), e));
          return local.some((e) => e[0] >= box[0] && e[0] <= box[2] && e[1] >= box[1] && e[1] <= box[3] && polys.some((poly) => inside(e, poly)));
        });
        if (hit) {
          covered++;
          expect(sampleOpacity(frames.eyes, pr, easing), `${id}: eyes open under the item at t = ${t.toFixed(3)}`).toBeLessThan(0.001);
        }
      }
      covers[id] = covered;
      p.destroy();
    }
    expect(covers.scarf).toBeGreaterThan(0);
    expect(covers.ring).toBeGreaterThan(0);
    expect(covers.witch).toBeGreaterThan(20);
  }, 30000);

  it('runs on the puppet: one animation per part, seekable, cancelled at the end; reduced = nothing at all', async () => {
    for (const id of WEAR_IDS) {
      const p = puppetOf(id);
      const worn = putOn(p.root, id);
      if (!worn) throw new Error('no item');
      const u = new Update(p.root, id, worn);
      expect(u.animations.length, id).toBeGreaterThanOrEqual(Object.keys(updateFrames(id)).length);
      for (const a of u.animations) {
        const timing = a.effect?.getTiming();
        expect(timing?.duration).toBe(momentTotal(id) * 1000);
        expect(timing?.fill).toBe('both');
        expect(timing?.iterations ?? 1).toBe(1);
      }
      u.seek(0.4);
      for (const a of u.animations) expect(a.currentTime).toBe(400);
      u.seek(99);
      for (const a of u.animations) expect(a.currentTime).toBe(momentTotal(id) * 1000);
      // the moment does not trigger the follow-through (it moves the dangling parts itself)
      for (const w of Array.from(p.root.querySelectorAll('.wr-wob'))) expect(w.getAnimations().length).toBe(0);
      const done = u.play();
      u.cancel();
      await done;
      expect(u.animations.length).toBe(0);
      const calm = new Update(p.root, id, worn, true);
      expect(calm.animations.length, id).toBe(0);
      expect(calm.duration).toBe(0);
      p.destroy();
    }
    expect(Object.keys(MOMENTS).sort()).toEqual([...WEAR_IDS].sort());
  });
});

describe('gallery page', () => {
  it('builds the year strip, the item cards, the stage, a frozen frame and the contact sheet; cells dress their puppet', () => {
    const app = mount();
    wardrobeGallery(app, new URLSearchParams('screens=wardrobe&grid=0'));
    // the year strip: every dated span of every item, the birthday chip
    const spans = WEAR_IDS.reduce((n, id) => n + WEAR[id].spans.length, 0);
    expect(app.querySelectorAll('.wr-year .wr-span').length).toBe(spans);
    expect(app.querySelector('.wr-year .wr-occ button')?.textContent).toContain('колпак');
    // one card per item, each with a 96 px and a 64 px puppet wearing it
    expect(app.querySelectorAll('.wr-card2').length).toBe(7);
    for (const card of Array.from(app.querySelectorAll('.wr-card2'))) {
      const hosts = Array.from(card.querySelectorAll('.wr-host'));
      expect(hosts.length).toBe(2);
      for (const h of hosts) expect(h.shadowRoot?.querySelector('.wr')).not.toBeNull();
    }
    expect(app.querySelector('.wr-stage-box .wr-host')?.shadowRoot?.querySelector('.wr[data-wear="scarf"]')).not.toBeNull();

    const frame = mount();
    wardrobeGallery(frame, new URLSearchParams('screens=wardrobe&item=witch&t=0.5'));
    expect(frame.querySelectorAll('.wr-cell').length).toBe(1);

    const sheet = mount();
    wardrobeGallery(sheet, new URLSearchParams('screens=wardrobe&contact=1&frames=4'));
    expect(sheet.querySelectorAll('.wr-sheet').length).toBe(7);
    expect(sheet.querySelectorAll('.wr-sheet .wr-cell').length).toBe(28);

    const calm = mount();
    wardrobeGallery(calm, new URLSearchParams('screens=wardrobe&grid=0&reduced=1&item=ring'));
    expect(calm.querySelector('.wr-stage-box .wr-host')?.shadowRoot?.querySelector('.wr[data-wear="ring"]')).not.toBeNull();

    for (const id of WEAR_IDS) {
      for (const pose of ['front', 'left', 'right', 'sniff'] as const) {
        const cell = buildCell(WEAR[id].kind, id, pose, 96);
        document.body.append(cell);
        const root = cell.querySelector('.wr-host')?.shadowRoot;
        expect(root?.querySelector(`.wr[data-wear="${id}"]`), `${id} ${pose}`).not.toBeNull();
      }
    }
    const left = buildCell('hamster', 'beanie', 'left', 64);
    expect(left.querySelector('.wr-host')?.shadowRoot?.querySelector('.hm')?.classList.contains('turn-l')).toBe(true);
  });
});
