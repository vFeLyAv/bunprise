import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  angerMs,
  COOLDOWN,
  decide,
  grumpiness,
  mulberry32,
  NAP_AFTER,
  shouldSulk,
  weights,
  type ActionKind,
  type BrainContext,
} from '../src/buddy/brain';
import {
  allFloors,
  floorBelow,
  GRAVITY,
  hopPoint,
  hopVelocity,
  landingKind,
  MAX_THROW,
  pendulumAngle,
  pendulumAt,
  releaseVelocity,
  roomyFloors,
  route,
  simulateFlight,
  stepFlight,
  stepPendulum,
  stepRoll,
  uprightAngle,
  type Body,
  type World,
} from '../src/buddy/physics';
import { listsBuddyGallery } from '../demo/lists-buddy/gallery';
import { createBuddy, type ListsBuddy } from '../src/buddy/index';

// The Lists buddy (src/buddy, in the app since Felix approved it 25.10): his brain is seeded and pure, his physics too —
// so a day of his life and every throw can be replayed exactly.

// a phone-wide content box: the stats row, four wishlist cards, the ground
const WORLD: World = {
  width: 390,
  top: 0,
  bottom: 1250,
  gravity: GRAVITY,
  floors: [
    { id: 'stats', y: 300, x0: 16, x1: 374 },
    { id: 'card-0', y: 520, x0: 16, x1: 374, card: 0 },
    { id: 'card-1', y: 700, x0: 16, x1: 374, card: 1 },
    { id: 'card-2', y: 880, x0: 16, x1: 374, card: 2 },
    { id: 'card-3', y: 1060, x0: 16, x1: 374, card: 3 },
  ],
};

function ctx(over: Partial<BrainContext> = {}): BrainContext {
  return {
    now: 100000,
    kind: 'hamster',
    reduced: false,
    cards: 4,
    hasAvatar: true,
    floors: 6,
    floor: 0,
    lastInteraction: 100000,
    throwTimes: [],
    lastDone: {},
    last: null,
    lastCard: null,
    ...over,
  };
}

/** Plays `n` decisions on a fake clock (each behaviour takes its duration, at least 1.5 s). */
function life(seed: number, n: number, over: Partial<BrainContext> = {}): { kind: ActionKind; at: number }[] {
  const rng = mulberry32(seed);
  const c = ctx(over);
  const out: { kind: ActionKind; at: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = decide(c, rng);
    c.now += Math.max(1500, d.duration);
    out.push({ kind: d.kind, at: c.now });
    c.lastDone = { ...c.lastDone, [d.kind]: c.now };
    c.last = d.kind;
    if (d.card !== undefined) c.lastCard = d.card;
    if (d.floor !== undefined) c.floor = d.floor;
  }
  return out;
}

describe('lists buddy — brain', () => {
  it('lives the same life for the same seed, another one for another seed', () => {
    expect(life(7, 40)).toEqual(life(7, 40));
    expect(life(7, 40).map((d) => d.kind)).not.toEqual(life(8, 40).map((d) => d.kind));
  });

  it('is free, not a script: over a long life he does a bit of everything', () => {
    const kinds = new Set(life(3, 300).map((d) => d.kind));
    for (const k of ['idle', 'wander', 'sniff', 'sit', 'scratch', 'lookAround', 'inspect', 'admire', 'stuff'] as ActionKind[]) expect(kinds.has(k)).toBe(true);
  });

  it('respects the cooldowns (no list inspected twice in a row within 11 s, no admiring twice within 14 s)', () => {
    const days = life(11, 400);
    for (const k of ['inspect', 'admire', 'stuff', 'scratch'] as ActionKind[]) {
      const at = days.filter((d) => d.kind === k).map((d) => d.at);
      for (let i = 1; i < at.length; i++) expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThanOrEqual(COOLDOWN[k]);
    }
  });

  it('picks another card than the one he just looked at', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 50; i++) {
      const d = decide(ctx({ lastDone: {}, lastCard: 2 }), () => (i % 2 ? rng() : 0.5));
      if (d.kind === 'inspect') expect(d.card).not.toBe(2);
    }
  });

  it('gets sleepy only when nobody touched him for a while', () => {
    expect(weights(ctx({ lastInteraction: 100000 })).nap).toBe(0);
    expect(weights(ctx({ lastInteraction: 100000 - NAP_AFTER - 1 })).nap).toBeGreaterThan(0);
  });

  it('only the hamster stuffs his cheeks; no cards = nothing to inspect; no avatar = nothing to admire', () => {
    expect(weights(ctx({ kind: 'bunny' })).stuff).toBe(0);
    expect(weights(ctx({ cards: 0 })).inspect).toBe(0);
    expect(weights(ctx({ hasAvatar: false })).admire).toBe(0);
  });

  it('under reduced motion he stays put: only resting and sitting', () => {
    const kinds = new Set(life(9, 200, { reduced: true }).map((d) => d.kind));
    expect([...kinds].sort()).toEqual(['idle', 'sit']);
  });

  it('holds a grudge: every recent throw makes him grumpier and the glare longer; three in 30 s = he sulks; after a minute he forgave', () => {
    const now = 1_000_000;
    expect(grumpiness([], now)).toBe(0);
    const one = [now - 1000];
    const two = [now - 9000, now - 1000];
    const three = [now - 20000, now - 9000, now - 1000];
    expect(grumpiness(two, now)).toBeGreaterThan(grumpiness(one, now));
    expect(angerMs(three, now)).toBeGreaterThan(angerMs(two, now));
    expect(angerMs(two, now)).toBeGreaterThan(angerMs(one, now));
    expect(shouldSulk(two, now)).toBe(false);
    expect(shouldSulk(three, now)).toBe(true);
    expect(decide(ctx({ now, throwTimes: three }), mulberry32(1)).kind).toBe('sulk');
    expect(grumpiness(three, now + 61000)).toBe(0);
    // grumpy: no heart eyes for you
    expect(weights(ctx({ now, throwTimes: three })).admire).toBeLessThan(weights(ctx({ now })).admire * 0.3);
  });
});

describe('lists buddy — physics', () => {
  const body = (over: Partial<Body> = {}): Body => ({ x: 200, y: 260, vx: 0, vy: 0, angle: 0, spin: 0, r: 25, ...over });

  it('a throw always comes down on a floor and never leaves the screen on the way', () => {
    const rng = mulberry32(42);
    for (let k = 0; k < 60; k++) {
      let b = body({ vx: (rng() - 0.5) * 2 * MAX_THROW, vy: -rng() * MAX_THROW, spin: (rng() - 0.5) * 30 });
      let landed = null;
      for (let t = 0; t < 8 && !landed; t += 1 / 240) {
        const s = stepFlight(b, WORLD, 1 / 240);
        b = s.body;
        landed = s.landed;
        expect(b.x).toBeGreaterThanOrEqual(b.r - 1e-6);
        expect(b.x).toBeLessThanOrEqual(WORLD.width - b.r + 1e-6);
        expect(b.y).toBeGreaterThanOrEqual(WORLD.top + b.r - 1e-6);
      }
      expect(landed).not.toBeNull();
      expect(b.y + b.r).toBeCloseTo(landed?.y ?? 0, 5);
    }
  });

  it('floors are one-way: he flies up through a card and lands on it on the way down', () => {
    const up = simulateFlight(body({ x: 200, y: 560, vy: -700 }), WORLD);
    expect(up.landed.id).toBe('card-0');
    const drop = simulateFlight(body({ x: 200, y: 540, vy: 0 }), WORLD);
    expect(drop.landed.id).toBe('card-1');
  });

  it('a soft drop lands on his feet; a hard throw tumbles', () => {
    expect(landingKind(40, 300)).toBe('gentle');
    expect(landingKind(700, 900)).toBe('tumble');
    expect(landingKind(0, 1400)).toBe('tumble');
  });

  it('measures the throw from the last ~90 ms of the finger, clamped', () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }], 10)).toEqual({ vx: 0, vy: 0 });
    const v = releaseVelocity([{ t: 900, x: 100, y: 100 }, { t: 950, x: 120, y: 90 }, { t: 1000, x: 140, y: 80 }], 1000);
    expect(v.vx).toBeCloseTo(400, 5);
    expect(v.vy).toBeCloseTo(-200, 5);
    const fast = releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 20, x: 300, y: 0 }], 20);
    expect(Math.hypot(fast.vx, fast.vy)).toBeCloseTo(MAX_THROW, 5);
  });

  it('dangles behind the finger like a pendulum and calms down when the finger stops', () => {
    let p = pendulumAt({ x: 100, y: 100 }, 24);
    let pivot = { x: 100, y: 100 };
    for (let i = 0; i < 12; i++) {
      pivot = { x: pivot.x + 6, y: 100 };
      p = stepPendulum(p, pivot, 1500, 1 / 60);
    }
    // the finger moved right: the body lags behind, to the left
    expect(pendulumAngle(p, pivot)).toBeLessThan(-0.05);
    for (let i = 0; i < 60 * 5; i++) p = stepPendulum(p, pivot, 1500, 1 / 60);
    expect(Math.abs(pendulumAngle(p, pivot))).toBeLessThan((2 * Math.PI) / 180);
    expect(Math.hypot(p.x - pivot.x, p.y - pivot.y)).toBeCloseTo(24, 6);
  });

  it('a hop between floors lands exactly on its target', () => {
    const from = { x: 120, y: 520 };
    const to = { x: 200, y: 300 };
    const v = hopVelocity(from, to, GRAVITY);
    const end = hopPoint(from, v, GRAVITY, v.t);
    expect(end.x).toBeCloseTo(to.x, 6);
    expect(end.y).toBeCloseTo(to.y, 6);
  });

  it('climbs card by card instead of one giant jump', () => {
    const [stats, , , , card3] = WORLD.floors;
    if (!stats || !card3) throw new Error('world');
    expect(route(WORLD, card3, stats, 200).map((f) => f.id)).toEqual(['card-2', 'card-1', 'card-0', 'stats']);
    expect(route(WORLD, stats, stats, 200).map((f) => f.id)).toEqual(['stats']);
  });

  it('rolls to a stop on the floor, drops off the end of a card, stands up the short way round', () => {
    const card = WORLD.floors[1];
    if (!card) throw new Error('world');
    let roll = { x: 200, v: 300, angle: 0 };
    let stopped = false;
    for (let i = 0; i < 240 && !stopped; i++) {
      const s = stepRoll(roll, card, WORLD, 25, 1 / 60);
      roll = s.roll;
      stopped = s.stopped;
    }
    expect(stopped).toBe(true);
    expect(roll.angle).toBeGreaterThan(0); // rolled to the right = turned clockwise
    // a narrow shelf (the cards here span the screen, so the walls stop him first)
    const off = stepRoll({ x: 248, v: 400, angle: 0 }, { id: 'shelf', y: 520, x0: 100, x1: 250 }, WORLD, 25, 1 / 60);
    expect(off.offEdge).toBe(true);
    expect(uprightAngle(5.9)).toBeCloseTo(2 * Math.PI, 6);
    expect(uprightAngle(-0.4)).toBeCloseTo(0, 9);
  });

  it('finds the floor under a point (the ground at the latest)', () => {
    expect(floorBelow(WORLD, 200, 400).id).toBe('card-0');
    expect(floorBelow(WORLD, 5, 400).id).toBe('ground');
    expect(allFloors(WORLD).at(-1)?.id).toBe('ground');
  });

  it('never stands right under a ceiling (the sticky switch): such a floor is no floor; one far enough below is', () => {
    const floors = [
      { id: 'stats', y: 300, x0: 16, x1: 374 },
      { id: 'first-row', y: 540, x0: 16, x1: 187, card: 0 },
      { id: 'second-row', y: 760, x0: 16, x1: 187, card: 2 },
      { id: 'beside', y: 540, x0: 400, x1: 500 },
    ];
    const ceiling = { top: 470, bottom: 520, x0: 0, x1: 390 }; // the switch, 20 px above the first row
    expect(roomyFloors(floors, [ceiling], 110).map((f) => f.id)).toEqual(['stats', 'second-row', 'beside']);
    // without ceilings nothing changes; a ceiling BELOW a floor takes no room from it
    expect(roomyFloors(floors, [], 110)).toHaveLength(4);
    expect(roomyFloors(floors, [{ top: 560, bottom: 600, x0: 0, x1: 390 }], 110).map((f) => f.id)).toEqual(['stats', 'first-row', 'second-row', 'beside']);
  });
});

describe('lists buddy — gallery page', () => {
  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    document.head.replaceChildren();
    vi.useRealTimers();
  });

  it('builds the mock Lists screen with a decorative buddy that only catches the finger on his body', async () => {
    const app = document.createElement('main');
    document.body.append(app);
    listsBuddyGallery(app, new URLSearchParams('screens=buddy&reduced=1&auto=0'));
    await new Promise((r) => setTimeout(r, 40));
    expect(app.querySelectorAll('[data-buddy-card]')).toHaveLength(4);
    const layer = app.querySelector('.bd-layer');
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect(app.querySelectorAll('.bd-hit')).toHaveLength(1);
    const buddy = (window as unknown as { listsBuddy: ListsBuddy }).listsBuddy;
    expect(buddy.reduced).toBe(true);
    // calm: a behaviour leaves no flying effects behind
    buddy.trigger('admire');
    buddy.trigger('wish');
    expect(app.querySelectorAll('.bd-fx > *')).toHaveLength(0);
  });
});

describe('lists buddy — package API (createBuddy, used by the app)', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  function stage(): HTMLDivElement {
    const st = document.createElement('div');
    st.style.position = 'relative';
    st.innerHTML = '<div data-buddy-avatar></div><div data-buddy-floor="stats"></div><ul><li data-buddy-floor="a" data-buddy-card="0"></li><li data-buddy-floor="b" data-buddy-card="1"></li></ul>';
    document.body.append(st);
    return st;
  }

  it('mounts a decorative layer, pauses and hides on request, and removes everything on destroy', () => {
    const st = stage();
    const haptics = vi.fn();
    const buddy = createBuddy({ stage: st, scroller: window, reducedMotion: 'force', autonomous: false, haptics, restPuff: 1.2 });
    const layer = st.querySelector<HTMLElement>('.bd-layer');
    expect(layer?.getAttribute('aria-hidden')).toBe('true');
    expect(st.querySelectorAll('.bd-hit')).toHaveLength(1);
    buddy.setPaused(true);
    buddy.setHidden(true);
    expect(layer?.style.visibility).toBe('hidden');
    buddy.setHidden(false);
    expect(layer?.style.visibility).toBe('');
    buddy.setRestPuff(1.3);
    buddy.destroy();
    expect(st.querySelector('.bd-layer')).toBeNull();
    // a destroyed buddy ignores late calls from the host
    expect(() => { buddy.setPaused(false); buddy.setHidden(false); buddy.trigger('wish'); }).not.toThrow();
  });

  it('marks himself as his own drag for the host’s page gestures: his body and the puppet’s shadow host inside, nothing else', () => {
    const st = stage();
    const buddy = createBuddy({ stage: st, scroller: window, reducedMotion: 'force', autonomous: false });
    const marked = st.querySelectorAll<HTMLElement>('[data-drag-own]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.classList.contains('bd-actor')).toBe(true);
    expect(st.querySelector('.bd-hit')?.closest('[data-drag-own]')).toBe(marked[0]);
    expect(st.querySelector('.bd-host')?.closest('[data-drag-own]')).toBe(marked[0]);
    expect(st.querySelector('[data-buddy-floor="stats"]')?.closest('[data-drag-own]')).toBeNull();
    buddy.destroy();
    expect(st.querySelector('[data-drag-own]')).toBeNull();
  });

  it('start: he begins where the host says (the app: where he slept at night), else 62 % along the stats row as before', () => {
    const st = stage();
    const rects: Record<string, [number, number, number]> = { stats: [16, 200, 358], a: [16, 400, 170], b: [204, 400, 170] };
    st.getBoundingClientRect = () => new DOMRect(0, 0, 390, 900);
    for (const [id, [x, y, w]] of Object.entries(rects)) {
      const el = st.querySelector<HTMLElement>(`[data-buddy-floor="${id}"]`);
      if (el) el.getBoundingClientRect = () => new DOMRect(x, y, w, 120);
    }
    const plain = createBuddy({ stage: st, scroller: window, reducedMotion: 'force', autonomous: false });
    expect(plain.position).toMatchObject({ floor: 'stats', y: 200 });
    expect(plain.position.x).toBeCloseTo(16 + 0.62 * 358, 5);
    plain.destroy();
    const placed = createBuddy({ stage: st, scroller: window, reducedMotion: 'force', autonomous: false, start: { floor: 'b', x: 280 } });
    expect(placed.position).toMatchObject({ floor: 'b', x: 280, y: 400 });
    placed.destroy();
    // an unknown floor (the list was deleted meanwhile): home as before
    const lost = createBuddy({ stage: st, scroller: window, reducedMotion: 'force', autonomous: false, start: { floor: 'gone', x: 5 } });
    expect(lost.position.floor).toBe('stats');
    expect(lost.position.x).toBeCloseTo(16 + 0.62 * 358, 5);
    lost.destroy();
  });

  it('a calm buddy started by the host only reacts (no wandering) and never vibrates by itself', () => {
    vi.useFakeTimers();
    const st = stage();
    const haptics = vi.fn();
    const buddy = createBuddy({ stage: st, scroller: window, reducedMotion: 'force', haptics });
    const start = buddy.position;
    vi.advanceTimersByTime(20000);
    expect(buddy.position.x).toBe(start.x);
    expect(haptics).not.toHaveBeenCalled();
    buddy.destroy();
  });
});
