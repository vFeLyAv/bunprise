import { afterEach, describe, expect, it, vi } from 'vitest';
import { PSST, RESERVE, SCENE_BOX, buildScene, type Built, type SceneId } from '../demo/tapsi/scenes';
import { tapsiGallery } from '../demo/tapsi/gallery';
import type { Track } from '../src/timeline';
import type { FakeAnimation } from './setup';

// Tapsi's moments (26.10, gallery-only prototype, demo/tapsi/): «Psst» (the reservation moment's new ending),
// «Сегодня тот самый день» (the hidden star leaves) and «Пылинка на линзе» (binoculars, on tap only). Every scene
// is one timeline of transform / opacity tracks: frozen frames are deterministic, nothing loops, the still poses
// under reduced motion never call animate().

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  document.head.querySelectorAll('style').forEach((s) => s.remove());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function box(id: SceneId): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = `${SCENE_BOX[id].w}px`;
  el.style.height = `${SCENE_BOX[id].h}px`;
  document.body.append(el);
  return el;
}

const make = (id: SceneId, reduced = false): Built => buildScene(id, box(id), { reduced });
const track = (b: Built, name: string): Track => {
  const t = b.stage.tracks.find((x) => x.name === `tapsi.${name}`);
  if (!t) throw new Error(`no track ${name}`);
  return t;
};
const o = (b: Built, name: string, t: number): number => track(b, name).sample(t).o ?? 1;
const times = (from: number, to: number, step = 0.02): number[] => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
};

/**
 * Centre of a front paw (puppet units) from the tracks at time t: the paw's ellipse (rx 10, ry 12, turned ∓28°,
 * src/hamster.ts) turns about the bottom centre of its box (.paw: fill-box, 50% 100%), then its own offset and the
 * paws group's lift apply.
 */
function pawCentre(b: Built, side: 'L' | 'R', t: number): { x: number; y: number } {
  const rest = side === 'L' ? { x: -16, y: -46, turn: -28 } : { x: 16, y: -46, turn: 28 };
  const a = (rest.turn * Math.PI) / 180;
  const halfH = Math.sqrt((10 * Math.sin(a)) ** 2 + (12 * Math.cos(a)) ** 2);
  const p = track(b, `paw${side}`).sample(t);
  const r = ((p.r ?? 0) * Math.PI) / 180;
  const lift = track(b, 'paws').sample(t).y ?? 0;
  // the centre sits halfH above the pivot; rotate that arm by r
  return { x: rest.x + halfH * Math.sin(r) + (p.x ?? 0), y: rest.y + halfH - halfH * Math.cos(r) + (p.y ?? 0) + lift };
}

describe('every scene — the motion rules', () => {
  it('animates only transform and opacity, finitely (no loop), and every scene stays within 3 s (psst: the approved moment + 0.6 s)', () => {
    for (const id of ['before', 'psst', 'today', 'speck'] as const) {
      const b = make(id);
      const anims = b.stage.tracks.flatMap((t) => t.compile());
      expect(anims.length).toBeGreaterThan(5);
      for (const c of anims) {
        expect(c.timing.iterations ?? 1).toBe(1);
        for (const key of c.frames) {
          expect(Object.keys(key).every((k) => ['transform', 'opacity', 'offset', 'easing', 'composite'].includes(k))).toBe(true);
        }
      }
      // nothing moves after the scene (not even the breathing) — except, for the reservation moment, the cheeks that
      // settle 1.8 s later exactly like today (src/hamster.ts eat → timeout → setPuff(1))
      if (id === 'today' || id === 'speck') expect(b.stage.end).toBeCloseTo(b.duration, 5);
      if (id === 'today' || id === 'speck') expect(b.duration).toBeLessThanOrEqual(3);
      else expect(b.stage.end).toBeCloseTo(b.duration + 1.8 + 0.7, 5);
      b.destroy();
    }
  });

  it('gives the same frame every time: two builds sample identically (no Math.random, no timers)', () => {
    for (const id of ['psst', 'today', 'speck'] as const) {
      const a = make(id);
      const b = make(id);
      expect(a.stage.tracks.map((t) => t.name)).toEqual(b.stage.tracks.map((t) => t.name));
      for (const t of times(0, a.stage.end, 0.07)) {
        a.stage.tracks.forEach((tr, i) => expect(b.stage.tracks[i]?.styleAt(t)).toEqual(tr.styleAt(t)));
      }
    }
  });

  it('builds every animation paused at 0; seek(t) moves them all to the same time; destroy() leaves nothing', () => {
    const b = make('psst');
    const anims = () => b.rig.puppet.root.querySelector('svg')?.getAnimations({ subtree: true }) as unknown as FakeAnimation[];
    expect(anims().length).toBeGreaterThan(10);
    expect(anims().every((a) => a.playState === 'paused' && a.currentTime === 0)).toBe(true);
    b.stage.seek(4.6);
    expect(anims().every((a) => a.currentTime === 4600)).toBe(true);
    const root = b.rig.box.parentElement;
    b.destroy();
    expect(root?.childElementCount).toBe(0);
    expect(b.rig.puppet.root.childElementCount).toBe(0);
  });
});

describe('1 · «Psst» — the reservation moment gets a new ending', () => {
  it('"before" is today\'s moment keyframe for keyframe: jump 1.15 s, star drop 0.7, 0.26 + 0.28, nine bites of 0.17, paws down 0.32 + 0.9', () => {
    const b = make('before');
    expect(b.duration).toBeCloseTo(1.15 + 0.7 + 0.26 + 0.28 + 9 * 0.17 + 0.32 + 0.9, 5);
    expect(RESERVE.swallowed).toBeCloseTo(1.15 + 0.7 + 0.26 + 0.28 + 9 * 0.17, 5);
    // today's ending shows star eyes after the last bite
    expect(o(b, 'stars', RESERVE.swallowed + 0.5)).toBe(1);
    // details of the approved keyframes: the floor shadow already fades at the crouch (no opacity in that keyframe)
    expect(o(b, 'shadow', 0.18 * 0.9)).toBeCloseTo(1 - 0.5 * (0.18 / 0.52), 3);
    // the ear tip flicks twice: class on at 0 and 0.23 s, each change a 0.12 s transition
    expect(track(b, 'tip').sample(RESERVE.swallowed + 0.12).r).toBe(-12);
    expect(track(b, 'tip').sample(RESERVE.swallowed + 0.34).r).toBe(-12);
  });

  it('is at most 0.6 s longer, and its star eyes at the end are gone (^ ^ until the paws go down)', () => {
    const before = make('before');
    const psst = make('psst');
    expect(psst.duration - before.duration).toBeGreaterThan(0);
    expect(psst.duration - before.duration).toBeLessThanOrEqual(0.6);
    // everything up to the last bite is the same moment
    for (const t of times(0, RESERVE.swallowed - 0.01, 0.05)) {
      for (const name of ['hop', 'cookie', 'stars', 'happy', 'puff', 'paws']) expect(track(psst, name).styleAt(t)).toEqual(track(before, name).styleAt(t));
    }
    for (const t of times(RESERVE.swallowed, psst.stage.end, 0.02)) expect(o(psst, 'stars', t)).toBe(0);
    for (const t of times(RESERVE.swallowed, (psst.marks['release'] ?? 0) + 0.3)) {
      expect(o(psst, 'happy', t)).toBe(1);
      expect(o(psst, 'round', t)).toBe(0);
    }
  });

  it('both paws cover his mouth (two distinct paws, never one blob, never four), with a head tilt, a nod and full cheeks', () => {
    const b = make('psst');
    const sealed = b.marks['sealed'] ?? 0;
    for (const t of times(sealed, (b.marks['release'] ?? 0))) {
      const tilted = t >= (b.marks['tilted'] ?? 0);
      const l = pawCentre(b, 'L', t);
      const r = pawCentre(b, 'R', t);
      const mouth = { x: 0, y: -85 };
      expect(Math.hypot(l.x - mouth.x, l.y - mouth.y)).toBeLessThan(16);
      expect(Math.hypot(r.x - mouth.x, r.y - mouth.y)).toBeLessThan(16);
      expect(l.x).toBeLessThan(r.x);
      expect(r.x - l.x).toBeGreaterThan(8);
      if (tilted) expect(track(b, 'puff').sample(t).sx).toBeGreaterThan(1.3);
      if (tilted) expect(track(b, 'tf').sample(t).r).toBe(PSST.tf.r);
    }
    // the base stays on the feet: the body leans no more than 2°
    for (const t of times(0, b.stage.end, 0.05)) expect(Math.abs(track(b, 'body').sample(t).r ?? 0)).toBeLessThanOrEqual(2);
    // one small nod (a squash of everything above the feet), then still
    const nod = times(sealed, b.duration).map((t) => track(b, 'nod').sample(t).sy ?? 1);
    expect(Math.min(...nod)).toBeLessThan(0.98);
    expect(nod[nod.length - 1]).toBe(1);
    // only the puppet's own two front paws: the resting paws are the ones that move, nothing else is drawn
    expect(b.rig.parts('.paw').length).toBe(2);
    // after the moment the paws are back on his belly and his eyes are open
    const end = b.stage.end;
    expect(pawCentre(b, 'L', end)).toEqual({ x: -16, y: -46 });
    expect(o(b, 'round', end)).toBe(1);
  });

  it('reduced motion: the still pose «paws at the mouth + ^ ^» — and not a single animate() call', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const b = make('psst', true);
    expect(spy).not.toHaveBeenCalled();
    expect(b.reduced).toBe(true);
    expect(b.rig.part<SVGElement>('.eyes-happy').style.opacity).toBe('1');
    expect(b.rig.part<SVGElement>('.eyes').style.opacity).toBe('0');
    expect(b.rig.part<SVGElement>('.paws').style.transform).toContain(`${PSST.paws.y}px`);
    expect(b.rig.part<SVGElement>('.paw-l').style.transform).toContain(`rotate(${PSST.pawL.r}deg)`);
    expect(b.rig.part<SVGElement>('.cheek').style.transform).toContain('1.35');
  });
});

describe('2 · «Сегодня тот самый день» — the hidden star leaves', () => {
  it('≈ 2.9 s (livelier v2, Felix 26.10): springs up with full cheeks, glad hops with claps, a breath in, "pff!" — the star shoots up and melts, one glint', () => {
    const b = make('today');
    expect(b.duration).toBeGreaterThan(2.4);
    expect(b.duration).toBeLessThanOrEqual(3);
    const out = b.marks['out'] ?? 0;
    const inhale = b.marks['inhale'] ?? 0;
    expect(inhale).toBeLessThan(out);
    // up from behind the card, at rest before the glad hops
    const lift = (t: number) => track(b, 'lift').sample(t).y ?? 0;
    expect(lift(0)).toBeGreaterThan(50);
    expect(lift(0.75)).toBeCloseTo(0, 1);
    // two glad hops, the paws meet at the top of each (a clap: the left paw turns in, the right one mirrors it)
    const glad = b.marks['glad'] ?? 0;
    for (const t of [glad + 0.09, glad + 0.29]) {
      expect(lift(t)).toBeLessThan(-5);
      expect(track(b, 'pawL').sample(t).r ?? 0).toBeGreaterThan(15);
      expect(track(b, 'pawR').sample(t).r ?? 0).toBeLessThan(-15);
    }
    const puff = (t: number) => track(b, 'puff').sample(t).sx ?? 1;
    expect(puff(0)).toBeCloseTo(1.35, 5);
    // the breath in swells the cheeks even more; after "pff!" they are empty (a wobble below 1), and back to 1 at the end
    expect(puff(out - 0.02)).toBeGreaterThan(1.45);
    expect(Math.min(...times(out, out + 0.4, 0.01).map(puff))).toBeLessThan(0.97);
    expect(puff(b.duration)).toBeCloseTo(1, 5);
    // the puff throws him back: squashed right after it
    expect(track(b, 'body').sample(out + 0.08).sy ?? 1).toBeLessThan(0.95);
    // the star: hidden until it leaves his mouth, up fast, a whole turn, gone at the end (it melts: opacity)
    const star = track(b, 'star');
    expect(star.sample(out - 0.05).o).toBe(0);
    expect(star.sample(out + 0.2).o).toBe(1);
    expect(star.sample(out + 0.2).y ?? 0).toBeLessThan((star.sample(out + 0.02).y ?? 0) - 40);
    expect(star.sample(out + 0.5).r ?? 0).toBeGreaterThanOrEqual(330);
    expect(star.sample(b.stage.end).o).toBe(0);
    // ^ ^ from the look at the card until the star is gone
    for (const t of times(0.7, b.marks['melted'] ?? 0)) expect(o(b, 'happy', t)).toBe(1);
    // exactly one glint, once; no crumbs or other particles
    const glint = track(b, 'glint');
    const lit = times(0, b.stage.end, 0.01).filter((t) => (glint.sample(t).sx ?? 0) > 0.05 && (glint.sample(t).o ?? 0) > 0);
    expect(lit.length).toBeGreaterThan(5);
    expect((lit[lit.length - 1] ?? 0) - (lit[0] ?? 0)).toBeLessThan(0.5);
    expect(b.rig.part('.fx').childElementCount).toBe(0);
  });

  it('his lower body is clipped at the card\'s top edge (never seen through the glass card)', () => {
    const b = make('today');
    const edge = b.rig.box.parentElement as HTMLElement;
    expect(edge.className).toBe('tm-edge');
    expect(edge.style.overflow).toBe('hidden');
    const card = edge.parentElement?.querySelector<HTMLElement>('.tm-card');
    expect(edge.style.height).toBe(card?.style.top);
  });

  it('reduced motion: still Tapsi with ^ ^ and the star beside him, no animate()', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const b = make('today', true);
    expect(spy).not.toHaveBeenCalled();
    expect(b.rig.part<SVGElement>('.eyes-happy').style.opacity).toBe('1');
    const starEl = track(b, 'star').els[0] as HTMLElement;
    expect(starEl.style.opacity).toBe('1');
  });
});

describe('3 · «Пылинка на линзе» — binoculars, a speck, on tap only', () => {
  it('1.6 s; he holds the binoculars throughout with his own two paws — the resting paws are never driven (never four paws)', () => {
    const b = make('speck');
    expect(b.duration).toBe(1.6);
    expect(b.rig.puppet.holding).toBe('binoculars');
    expect(b.rig.part('.hm').classList.contains('hold-binoculars')).toBe(true);
    expect(b.rig.parts('.bino-paw').length).toBe(2);
    const driven = new Set(b.stage.tracks.flatMap((t) => t.els));
    for (const paw of b.rig.parts('.paw')) expect(driven.has(paw)).toBe(false);
    // only the right binocular paw lets go, and it comes back
    const paw = track(b, 'binoPaw');
    expect(paw.els).toEqual([b.rig.parts('.bino-paw')[1]]);
    expect(paw.sample(0)).toEqual({ x: 0, y: 0, r: 0 });
    expect(paw.sample(b.duration)).toEqual({ x: 0, y: 0, r: 0 });
  });

  it('down, the speck shows, one paw sweeps it off (it falls away and fades), the glint crosses once, binoculars up again', () => {
    const b = make('speck');
    const bino = track(b, 'bino');
    expect(bino.sample(b.marks['down'] ?? 0).y).toBe(36);
    expect(bino.sample(b.duration)).toMatchObject({ y: 0, sx: 1, sy: 1, r: 0 });
    const speck = track(b, 'speck');
    expect(speck.sample(0).o).toBe(0);
    expect(speck.sample(0.4).o).toBe(1);
    expect(speck.sample(b.duration).o).toBe(0);
    // it leaves the lens outwards (right) and falls
    expect(speck.sample(1.05).x ?? 0).toBeGreaterThan(30);
    expect(speck.sample(1.05).y ?? 0).toBeGreaterThan(15);
    const glint = track(b, 'glint');
    const moving = times(0, b.duration, 0.01).filter((t) => { const x = glint.sample(t).x ?? 0; return x > 1 && x < 131; });
    expect(moving.length).toBeGreaterThan(5);
    expect((moving[moving.length - 1] ?? 0) - (moving[0] ?? 0)).toBeLessThan(0.4);
  });

  it('reduced motion: binoculars down, ^ ^ — still, no animate()', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const b = make('speck', true);
    expect(spy).not.toHaveBeenCalled();
    expect(b.rig.part<SVGElement>('.bino').style.transform).toContain('36px');
    expect(b.rig.part<SVGElement>('.eyes-happy').style.opacity).toBe('1');
  });
});

describe('the gallery page (?screens=tapsi)', () => {
  const page = (query: string): HTMLElement => {
    const app = document.createElement('main');
    document.body.append(app);
    tapsiGallery(app, new URLSearchParams(query));
    return app;
  };

  it('shows the three tiles (psst as «было / стало»), each with a play button, a scrubber and a contact sheet', () => {
    const app = page('screens=tapsi');
    const tiles = [...app.querySelectorAll<HTMLElement>('.tm-tile')];
    expect(tiles.map((t) => t.dataset['scene'])).toEqual(['psst', 'today', 'speck']);
    expect(tiles[0]?.querySelectorAll('.tm-sheet').length).toBe(2);
    for (const t of tiles) {
      expect(t.querySelector('.tm-bar button.main')).not.toBeNull();
      expect(t.querySelector('.tm-bar input[type=range]')).not.toBeNull();
      expect(t.querySelector('details.tm-frames')).not.toBeNull();
    }
  });

  it('&scene=speck&t=0.7: one tile, frozen at 0.7 s; a tap / Enter plays it once (a tap while busy is ignored)', () => {
    vi.useFakeTimers();
    const app = page('screens=tapsi&scene=speck&t=0.7');
    expect(app.querySelectorAll('.tm-tile').length).toBe(1);
    const stageBox = app.querySelector<HTMLElement>('.tm-row .tm-box');
    if (!stageBox) throw new Error('no stage box');
    expect(stageBox.getAttribute('role')).toBe('button');
    expect(stageBox.tabIndex).toBe(0);
    const host = stageBox.querySelector('.tm-actor div div div') as HTMLElement;
    const anims = () => host.shadowRoot?.querySelector('svg')?.getAnimations({ subtree: true }) as unknown as FakeAnimation[];
    expect(anims().every((a) => a.playState === 'paused' && a.currentTime === 700)).toBe(true);
    stageBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(anims().some((a) => a.playState === 'running')).toBe(true);
    const running = anims().filter((a) => a.playState === 'running').map((a) => a.currentTime);
    vi.advanceTimersByTime(300);
    stageBox.click();
    // still the same run (not restarted at 0)
    expect(Math.min(...anims().filter((a) => a.playState === 'running').map((a) => a.currentTime ?? 0))).toBeGreaterThanOrEqual(Math.min(...running.map((v) => v ?? 0)));
  });

  it('&reduced=1: still poses, no play buttons, no scrubber, no contact sheets, no animations', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const app = page('screens=tapsi&reduced=1');
    expect(app.querySelectorAll('.tm-tile').length).toBe(3);
    expect(app.querySelector('.tm-bar button')).toBeNull();
    expect(app.querySelector('details.tm-frames')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaving the page tears everything down; a page kept in the back/forward cache stays as it is', () => {
    const app = page('screens=tapsi&scene=today');
    const shadowRoot = () => app.querySelector<HTMLElement>('.tm-actor div div div')?.shadowRoot;
    const kept = new Event('pagehide') as Event & { persisted?: boolean };
    Object.defineProperty(kept, 'persisted', { value: true });
    window.dispatchEvent(kept);
    expect(shadowRoot()?.childElementCount).toBeGreaterThan(0);
    window.dispatchEvent(new Event('pagehide'));
    expect(app.querySelector('.tm-actor')).toBeNull();
  });

  it('a contact sheet still being built stops when the page is left (no puppets made afterwards)', async () => {
    const app = page('screens=tapsi&scene=psst&frames=1');
    await new Promise((r) => setTimeout(r, 0));
    window.dispatchEvent(new Event('pagehide'));
    const n = app.querySelectorAll('.tm-cell').length;
    expect(n).toBeLessThan(42);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 20));
    expect(app.querySelectorAll('.tm-cell').length).toBe(n);
    expect(app.querySelectorAll('.tm-cell .tm-actor').length).toBe(0);
  });

  it('&frames=1: the contact sheets build frozen cells (psst: «было» over «стало» at each time)', async () => {
    const app = page('screens=tapsi&scene=psst&frames=1');
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    await vi.waitFor(() => expect(app.querySelectorAll('.tm-cell').length).toBe(21 + 21), { timeout: 4000 });
    const first = app.querySelector('.tm-cell');
    expect(first?.querySelectorAll('.tm-crop').length).toBe(2);
    expect(first?.querySelector('figcaption')?.textContent).toBe('3,80 с');
  });
});
