import { afterEach, describe, expect, it, vi } from 'vitest';
import { ListsBuddy, type FootingEvent } from '../src/buddy/index';
import type { Body, Floor, Pendulum } from '../src/buddy/physics';
import { FirmGround } from '../demo/firmground/firmground';
import { firmGroundGallery } from '../demo/firmground/gallery';
import {
  BEATS,
  COOLDOWN_MS,
  DURATION,
  HOLD,
  LEAN,
  PHI_MAX,
  REACH_U,
  TOUCH_LIFT_U,
  allowed,
  endPose,
  feetForTouch,
  footGap,
  footWorld,
  nearEdge,
  outlineY,
  plan,
  poseAt,
  safeX,
  springKick,
  springStep,
  unitPx,
  type FloorShape,
  type Plan,
  type Pose,
} from '../src/buddy/footing';

// «Твёрдая почва» (idea 1.9; Felix 26.10 «нравится», in the app since 27.10 as ListsBuddy option `footing`): set down softly near a card's rounded end, Pompon touches the card with
// the foot on the edge side, shifts his weight and steps inward. The choreography is a pure function of time, so the
// "ideal" bar is checked numerically: exact contact, no foot sliding, no pops, a seamless hand-over to the engine.

/** A wishlist card of the app's grid (Paper, radius 24) at phone width. */
const CARD: FloorShape = { id: 'card', y: 500, x0: 16, x1: 189, rL: 24, rR: 24 };
const SIZES = [96, 128, 160];
const DEG = Math.PI / 180;

/** The gallery's reproducible set-downs, on both ends: on the flat start of the rounding, a little round, far round, the brink. */
function placements(width: number): { name: string; x: number }[] {
  const brink = 0.54 * ((84 * 1.2 * width) / 400);
  return [
    { name: 'left φ0', x: feetForTouch(CARD, -1, 0, width) },
    { name: 'left φ4', x: feetForTouch(CARD, -1, 4 * DEG, width) },
    { name: 'left φ20', x: feetForTouch(CARD, -1, 20 * DEG, width) },
    { name: 'right φ8', x: feetForTouch(CARD, 1, 8 * DEG, width) },
    { name: 'right φ20', x: feetForTouch(CARD, 1, 20 * DEG, width) },
    { name: 'left brink', x: CARD.x0 + brink },
    { name: 'right brink', x: CARD.x1 - brink },
  ];
}

function plans(): { name: string; p: Plan }[] {
  const out: { name: string; p: Plan }[] = [];
  for (const w of SIZES) {
    for (const pl of placements(w)) {
      const edge = nearEdge(CARD, pl.x, w);
      if (!edge) throw new Error(`no edge for ${pl.name} @${w}`);
      out.push({ name: `${pl.name} @${w}`, p: plan(CARD, pl.x, w, edge) });
    }
  }
  return out;
}

const STEP = 0.0005;
const END = DURATION + HOLD;
function samples(): number[] {
  const ts: number[] = [];
  for (let t = 0; t <= END + 1e-9; t += STEP) ts.push(t);
  return ts;
}

describe('firm ground — the app springs', () => {
  it('step responses start at 0 and settle at 1; the landing kick starts at 0 and peaks at 1', () => {
    for (const s of ['snappy', 'smooth', 'bouncy'] as const) {
      expect(springStep(s, 0)).toBe(0);
      expect(springStep(s, 1.5)).toBeCloseTo(1, 4);
    }
    expect(springKick('bouncy', 0)).toBe(0);
    let peak = 0;
    for (let t = 0; t < 0.5; t += 0.0005) peak = Math.max(peak, springKick('bouncy', t));
    expect(peak).toBeCloseTo(1, 3);
  });
});

describe('firm ground — when it plays', () => {
  it('near either rounded end of a card, never in its middle', () => {
    for (const w of SIZES) {
      expect(nearEdge(CARD, (CARD.x0 + CARD.x1) / 2, w)).toBeNull();
      for (const pl of placements(w)) expect(nearEdge(CARD, pl.x, w)?.side).toBe(pl.name.startsWith('left') ? -1 : 1);
    }
    // a wide card: nothing for most of it
    const wide: FloorShape = { ...CARD, x1: 374 };
    let quiet = 0;
    for (let x = wide.x0; x <= wide.x1; x += 1) if (!nearEdge(wide, x, 96)) quiet += 1;
    expect(quiet).toBeGreaterThan(250);
  });

  it('at most once per 20 s', () => {
    expect(COOLDOWN_MS).toBe(20000);
    expect(allowed(-Infinity, 0)).toBe(true);
    expect(allowed(1000, 20999)).toBe(false);
    expect(allowed(1000, 21000)).toBe(true);
  });

  it('the outline follows the rounded corners', () => {
    expect(outlineY(CARD, 100)).toBe(CARD.y);
    expect(outlineY(CARD, CARD.x0 + CARD.rL)).toBeCloseTo(CARD.y, 9);
    expect(outlineY(CARD, CARD.x0)).toBeCloseTo(CARD.y + CARD.rL, 9);
    expect(outlineY(CARD, CARD.x0 - 1)).toBe(Infinity);
  });
});

describe('firm ground — the moment (1.2 s), every placement and size', () => {
  const all = plans();

  it('is short and finite: every beat inside 1.2 s, the pose is final after the hold', () => {
    expect(DURATION).toBe(1.2);
    for (const v of Object.values(BEATS)) for (const t of Array.isArray(v) ? v : [v]) expect(t).toBeLessThanOrEqual(DURATION);
    for (const { p } of all) expect(poseAt(p, END + 5)).toEqual(poseAt(p, END + 10));
  });

  it('the touch is exact: the edge-side foot rests on the card outline like a standing foot (no gap, never inside)', () => {
    for (const { name, p } of all) {
      const touch = footWorld(p, 'outer', poseAt(p, BEATS.touch[1]));
      expect(Math.abs(footGap(p, touch)), name).toBeLessThan(0.01);
      // within the reach of a foot: never further round the corner than PHI_MAX
      expect(p.phi, name).toBeLessThanOrEqual(PHI_MAX + 1e-9);
    }
  });

  it('feet never sink into the card, and they move only while lifted (no sliding)', () => {
    let deepest = { gap: Infinity, at: '' };
    let lowestWhileMoving = { gap: Infinity, at: '' };
    for (const { name, p } of all) {
      const prevGap = { outer: 0, inner: 0 };
      let prev: Pose | null = null;
      for (let t = 0; t <= END + 1e-9; t += 0.001) {
        const pose = poseAt(p, t);
        for (const which of ['outer', 'inner'] as const) {
          const f = footWorld(p, which, pose);
          const gap = footGap(p, f);
          if (gap < deepest.gap) deepest = { gap, at: `${name} ${which} t=${t.toFixed(3)}` };
          if (prev) {
            const before = footWorld(p, which, prev);
            const moved = Math.abs(f.x - before.x) > 1e-7 || Math.abs(f.r - before.r) > 1e-6;
            const g = Math.min(gap, prevGap[which]);
            if (moved && g < lowestWhileMoving.gap) lowestWhileMoving = { gap: g, at: `${name} ${which} t=${t.toFixed(3)}` };
          }
          prevGap[which] = gap;
        }
        prev = pose;
      }
    }
    // a planted or touching foot rests exactly on the surface (gap 0); it never goes in
    expect(deepest.gap, deepest.at).toBeGreaterThan(-0.01);
    // and whenever it moves sideways or turns, it is off the surface
    expect(lowestWhileMoving.gap, lowestWhileMoving.at).toBeGreaterThan(0.005);
  }, 20000);

  it('planted feet stay exactly where they are: the outer one while he shifts his weight, the inner one until its step', () => {
    for (const { name, p } of all) {
      const touch = footWorld(p, 'outer', poseAt(p, BEATS.touch[1]));
      for (let t = BEATS.touch[1]; t <= BEATS.step1[0]; t += 0.01) expect(footWorld(p, 'outer', poseAt(p, t)), name).toEqual(touch);
      const inner = footWorld(p, 'inner', poseAt(p, 0));
      for (let t = 0; t <= BEATS.step2[0]; t += 0.01) expect(footWorld(p, 'inner', poseAt(p, t)), name).toEqual(inner);
    }
  });

  it('nothing pops: every part moves continuously (≤ 1 unit / 1.5° / 0.004 scale per 0.5 ms)', () => {
    for (const { name, p } of all) {
      let prev = poseAt(p, 0);
      for (const t of samples().slice(1)) {
        const now = poseAt(p, t);
        const d = (a: number, b: number) => Math.abs(a - b);
        const move = Math.max(d(now.outer.x, prev.outer.x), d(now.outer.y, prev.outer.y), d(now.inner.x, prev.inner.x), d(now.inner.y, prev.inner.y),
          d(now.body.x, prev.body.x), d(now.body.y, prev.body.y), d(now.look.x, prev.look.x), d(now.look.y, prev.look.y));
        const turn = Math.max(d(now.outer.r, prev.outer.r), d(now.body.r, prev.body.r));
        const scale = Math.max(d(now.body.sx, prev.body.sx), d(now.body.sy, prev.body.sy));
        expect(move, `${name} t=${t.toFixed(4)}`).toBeLessThan(1);
        expect(turn, `${name} t=${t.toFixed(4)}`).toBeLessThan(1.5);
        expect(scale, `${name} t=${t.toFixed(4)}`).toBeLessThan(0.004);
        prev = now;
      }
      // it starts from the landing pose: nothing moved yet at t = 0
      const zero = poseAt(p, 0);
      expect([zero.outer, zero.inner, zero.body.x, zero.body.y, zero.body.r, zero.body.sx, zero.body.sy, zero.look]).toEqual([
        { x: 0, y: 0, r: 0 }, { x: 0, y: 0, r: 0 }, 0, 0, 0, 1, 1, { x: 0, y: 0 },
      ]);
    }
  });

  it('ends exactly on the engine’s standing pose at the new spot (the hand-over is invisible)', () => {
    for (const { name, p } of all) {
      const last = poseAt(p, END);
      const end = endPose(p);
      for (const [a, b] of [[last.outer.x, end.outer.x], [last.inner.x, end.inner.x], [last.body.x, end.body.x], [last.shadowX, end.shadowX]] as const) {
        expect(Math.abs(a - b), name).toBeLessThan(1e-9);
      }
      for (const v of [last.outer.y, last.outer.r, last.inner.y, last.inner.r, last.body.y, last.body.r, last.look.x, last.look.y]) expect(Math.abs(v), name).toBeLessThan(1e-9);
      expect(Math.abs(last.body.sx - 1) + Math.abs(last.body.sy - 1), name).toBeLessThan(1e-9);
      expect(last.eyes).toBe('happy');
      expect(safeX(p)).toBeCloseTo(p.x + p.dir * p.step, 9);
    }
  });

  it('one small step inward, away from the edge, never past the other end', () => {
    for (const { name, p } of all) {
      const u = p.u;
      expect(p.step, name).toBeGreaterThanOrEqual(14 * u - 1e-9);
      expect(p.step, name).toBeLessThanOrEqual(40 * u + 1e-9);
      expect(p.dir, name).toBe(-p.side);
      const end = safeX(p);
      expect(Math.abs(end - (p.side < 0 ? CARD.x0 : CARD.x1)), name).toBeGreaterThan(Math.abs(p.x - (p.side < 0 ? CARD.x0 : CARD.x1)));
      // the edge-side foot ends on the card (at most the rounding's very start under its toe)
      const outer = footWorld(p, 'outer', endPose(p));
      expect(outer.x - 18 * u, name).toBeGreaterThan(CARD.x0);
      expect(outer.x + 18 * u, name).toBeLessThan(CARD.x1);
    }
    expect(unitPx(96)).toBeCloseTo(0.288, 9);
  });
});


describe('firm ground — a little more visible than the gallery prototype (Felix 27.10, the doc’s question 3)', () => {
  it('at 96 px the touching foot reaches and lifts clearly, the weight shift leans clearly', () => {
    expect(REACH_U).toBeGreaterThan(8);
    expect(TOUCH_LIFT_U).toBeGreaterThan(6);
    expect(LEAN.away).toBeGreaterThan(4);
    const x = feetForTouch(CARD, 1, 0, 96);
    const edge = nearEdge(CARD, x, 96);
    if (!edge) throw new Error('no edge');
    const p = plan(CARD, x, 96, edge);
    const rest = footWorld(p, 'outer', poseAt(p, 0));
    const touch = footWorld(p, 'outer', poseAt(p, BEATS.touch[1]));
    // the foot goes out ≥ 3 px (the prototype: ≈ 2.3 px) and lifts ≥ 2.5 px on the way (the prototype: ≈ 1.7 px)
    expect(Math.abs(touch.x - rest.x)).toBeGreaterThan(3);
    let lift = 0;
    for (let t = BEATS.touch[0]; t <= BEATS.touch[1]; t += 0.005) lift = Math.max(lift, rest.y - footWorld(p, 'outer', poseAt(p, t)).y);
    expect(lift).toBeGreaterThan(2.5);
    // the lean away from the edge reaches ≥ 4°
    let lean = 0;
    for (let t = 0; t <= DURATION; t += 0.005) lean = Math.max(lean, Math.abs(poseAt(p, t).body.r));
    expect(lean).toBeGreaterThan(4);
  });
});

// ---------- the buddy's own hook (BuddyOptions.footing; jsdom: the layout is stubbed) ----------

interface Peek {
  land(f: Floor, b: Body): void;
  release(v: { vx: number; vy: number }): void;
  feet: { x: number; y: number };
  floor: Floor;
  mode: string;
  action: string;
  world: { floors: Floor[] };
  pend: Pendulum;
  pivot: { x: number; y: number };
  footingRun: unknown;
  rig: { puppet: { root: ShadowRoot; eyes: string } };
}

function rect(el: Element, x: number, y: number, w: number, h: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => new DOMRect(x, y, w, h), configurable: true });
}

function world(o: { reduced?: boolean; footing?: boolean } = {}): { b: ListsBuddy; peek: Peek; events: FootingEvent[]; card: Floor; haptics: string[] } {
  const stage = document.createElement('div');
  stage.style.position = 'relative';
  stage.innerHTML = '<ul><li data-buddy-floor="card" data-buddy-card="0"><article style="border-top-left-radius:24px;border-top-right-radius:24px"></article></li></ul>';
  document.body.append(stage);
  rect(stage, 0, 0, 390, 900);
  Object.defineProperty(stage, 'clientWidth', { value: 390, configurable: true });
  const li = stage.querySelector('li');
  if (li) rect(li, CARD.x0, CARD.y, CARD.x1 - CARD.x0, 168);
  const events: FootingEvent[] = [];
  const haptics: string[] = [];
  const b = new ListsBuddy({
    stage, scroller: null, kind: 'bunny', width: 96, reducedMotion: o.reduced ? 'force' : 'off', autonomous: false,
    footing: o.footing ?? true, onFooting: (e) => events.push(e), haptics: (k) => haptics.push(k),
  });
  const peek = b as unknown as Peek;
  const card = peek.world.floors.find((f) => f.id === 'card');
  if (!card) throw new Error('no card floor');
  return { b, peek, events, card, haptics };
}

const softBody = (x: number, f: Floor): Body => ({ x, y: f.y - 24.2, vx: 0, vy: 300, angle: 0, spin: 0, r: 24.2 });
const fake = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });

describe('firm ground — the Lists buddy’s own hook (BuddyOptions.footing)', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('off by default: a soft landing at a card’s end is the usual sigh, nothing else', () => {
    fake();
    const { peek, events, card } = world({ footing: false });
    const x = feetForTouch(CARD, 1, 20 * DEG, 96);
    peek.land(card, softBody(x, card));
    expect(peek.action).toBe('landed softly');
    expect(events).toEqual([]);
    vi.advanceTimersByTime(3000);
    expect(peek.feet.x).toBeCloseTo(x, 6);
  });

  it('a soft landing in the middle keeps the usual sigh; near the end the moment plays, then the engine stands him on the safe spot', async () => {
    fake();
    const { peek, events, card, haptics } = world();
    peek.land(card, softBody((card.x0 + card.x1) / 2, card));
    expect(peek.action).toBe('landed softly');
    expect(events.at(-1)?.kind).toBe('middle');
    vi.advanceTimersByTime(3000);

    const x = feetForTouch(CARD, 1, 20 * DEG, 96);
    peek.land(card, softBody(x, card));
    expect(peek.action).toBe('firm ground');
    expect(events.at(-1)).toMatchObject({ kind: 'play', side: 1 });
    const edge = nearEdge(CARD, x, 96);
    if (!edge) throw new Error('no edge');
    const target = safeX(plan(CARD, x, 96, edge));
    vi.advanceTimersByTime(800);
    // mid-moment: the engine still has him at the landing spot, the hook moves the puppet's parts
    expect(peek.feet.x).toBeCloseTo(x, 6);
    const body = peek.rig.puppet.root.querySelector<SVGGElement>('.hop > .body');
    expect(body?.style.transform).toContain('translate(');
    // the touch is felt once (the app's haptics wrapper)
    expect(haptics.filter((k) => k === 'select')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(peek.feet.x).toBeCloseTo(target, 9);
    expect(body?.style.transform).toBe('');
    expect(peek.footingRun).toBeNull();
    expect(events.map((e) => e.kind)).toContain('done');
  });

  it('at most once per 20 s', () => {
    fake();
    const { peek, events, card } = world();
    const x = feetForTouch(CARD, -1, 4 * DEG, 96);
    peek.land(card, softBody(x, card));
    expect(events.at(-1)?.kind).toBe('play');
    vi.advanceTimersByTime(3000);
    peek.land(card, softBody(x, card));
    expect(events.at(-1)?.kind).toBe('pause');
    expect(peek.action).toBe('landed softly');
    vi.advanceTimersByTime(20000);
    peek.land(card, softBody(x, card));
    expect(events.at(-1)?.kind).toBe('play');
  });

  it('interrupted (paused, hidden) it stops at once, and the engine takes over from where his body is', () => {
    fake();
    const { b, peek, events, card } = world();
    const x = feetForTouch(CARD, 1, 20 * DEG, 96);
    peek.land(card, softBody(x, card));
    vi.advanceTimersByTime(1000);
    b.setPaused(true);
    expect(events.at(-1)?.kind).toBe('stopped');
    expect(peek.footingRun).toBeNull();
    const root = peek.rig.puppet.root;
    for (const sel of ['.hop > .body', '.tfoot-l', '.tfoot-r']) expect(root.querySelector<SVGGElement>(sel)?.style.transform).toBe('');
    // between the landing spot and the safe spot: where his body was (his feet point absorbed the shift)
    expect(peek.feet.x).toBeLessThan(x);
    expect(peek.feet.x).toBeGreaterThan(x - 40 * 0.288 - 0.01);
  });

  it('reduced motion switched on mid-moment stops it too', () => {
    fake();
    const { b, peek, events, card } = world();
    peek.land(card, softBody(feetForTouch(CARD, -1, 4 * DEG, 96), card));
    vi.advanceTimersByTime(500);
    b.setReducedMotion('force');
    expect(events.at(-1)?.kind).toBe('stopped');
    expect(peek.footingRun).toBeNull();
  });

  it('a throw mid-moment starts where his body is (not where he landed)', () => {
    fake();
    const { b, peek, card } = world();
    const x = feetForTouch(CARD, 1, 20 * DEG, 96);
    peek.land(card, softBody(x, card));
    vi.advanceTimersByTime(1000);
    b.trigger('throw');
    const thrown = (b as unknown as { body: Body }).body;
    expect(peek.mode).toBe('fly');
    expect(thrown.x).toBeCloseTo(peek.feet.x, 6);
    expect(thrown.x).toBeLessThan(x - 1);
  });

  it('destroyed mid-moment: nothing is left running', () => {
    fake();
    const { b, peek, card } = world();
    peek.land(card, softBody(feetForTouch(CARD, 1, 20 * DEG, 96), card));
    vi.advanceTimersByTime(600);
    b.destroy();
    expect(peek.footingRun).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('.bd-layer')).toBeNull();
  });

  it('Weniger: set down near the end, he is straight on the safe spot with eyes ^ ^ (no frame loop)', async () => {
    fake();
    const { peek, events, card } = world({ reduced: true });
    const x = feetForTouch(CARD, -1, 20 * DEG, 96);
    // held right above the card's end, then let go (reduced: the engine sets him down at once)
    peek.mode = 'held';
    peek.pivot = { x, y: card.y - 80 };
    peek.pend = { x, y: card.y - 60, px: x, py: card.y - 60, len: 20 };
    peek.release({ vx: 0, vy: 0 });
    const engineX = Math.min(Math.max(x, card.x0 + 21.8), card.x1 - 21.8);
    const edge = nearEdge(CARD, engineX, 96);
    if (!edge) throw new Error('no edge');
    expect(events.at(-1)?.kind).toBe('reduced');
    expect(peek.feet.x).toBeCloseTo(safeX(plan(CARD, engineX, 96, edge)), 9);
    expect(peek.action).toBe('firm ground');
    expect(peek.rig.puppet.eyes).toBe('happy');
    expect(peek.footingRun).toBeNull();
    expect(peek.rig.puppet.root.querySelector<SVGGElement>('.hop > .body')?.style.transform).toBe('');
    await vi.advanceTimersByTimeAsync(DURATION * 1000 + 50);
    expect(peek.rig.puppet.eyes).toBe('normal');
  });
});

describe('firm ground — the gallery tools', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('reads the card’s rounded corners from the page; detach() gives the buddy back as it was', () => {
    const { b, card } = world();
    const fg = new FirmGround(b);
    expect(fg.shape(card)).toMatchObject({ x0: CARD.x0, x1: CARD.x1, y: CARD.y, rL: 24, rR: 24 });
    expect(Object.prototype.hasOwnProperty.call(b, 'cancel')).toBe(true);
    fg.detach();
    expect(Object.prototype.hasOwnProperty.call(b, 'cancel')).toBe(false);
  });

  it('the gallery page builds the mock Listen tab, the controls and the contact sheet', async () => {
    const app = document.createElement('main');
    document.body.append(app);
    firmGroundGallery(app, new URLSearchParams('screens=firmground&auto=0&autoplay=0&frames=5'));
    await new Promise((r) => setTimeout(r, 60));
    expect(app.querySelectorAll('.fg-phone [data-buddy-card]')).toHaveLength(5);
    expect(app.querySelectorAll('.fg-controls button[data-at]')).toHaveLength(5);
    expect(app.querySelectorAll('.fg-cell')).toHaveLength(5);
    expect(app.querySelector('.fg-phone .bd-layer')?.getAttribute('aria-hidden')).toBe('true');
    window.dispatchEvent(new Event('pagehide'));
  });
});
