/**
 * Lists buddy (gallery prototype, Felix 25.10) — the brain: picks what he does next. Pure and seeded, so a
 * test (and a screenshot) can replay the same day of his life. No DOM, no timers.
 *
 * Not a script: a small utility choice. Every behaviour has a base weight, a cooldown and a context factor
 * (cards to look at, an avatar to admire, how grumpy he is after being thrown, how long nobody touched him).
 * The controller asks for one decision, plays it, and asks again.
 */

export type ActionKind =
  | 'idle'
  | 'wander'
  | 'sniff'
  | 'sit'
  | 'scratch'
  | 'lookAround'
  | 'inspect'
  | 'admire'
  | 'stuff'
  | 'nap'
  | 'sulk'
  // (the app, 31.10 «Живые анимации») a living moment of the host (@bunprise/mascot/alive) as one of his deeds
  | 'alive';

export type BuddyKind = 'hamster' | 'bunny';

export interface BrainContext {
  /** ms (any clock; the same one as the timestamps below) */
  now: number;
  kind: BuddyKind;
  /** Reduced motion: he does not wander — he sits and stays. */
  reduced: boolean;
  /** How many wishlist cards there are to inspect. */
  cards: number;
  hasAvatar: boolean;
  /** Floors he can walk on (the stats row, the cards, the ground). */
  floors: number;
  /** Index of the floor he stands on. */
  floor: number;
  /** Last time a person touched, tapped or threw him (ms). */
  lastInteraction: number;
  /** When he was thrown (ms), newest last. */
  throwTimes: readonly number[];
  /** When each behaviour last ended (ms). */
  lastDone: Partial<Record<ActionKind, number>>;
  /** The behaviour he just did (not repeated right away, except wandering and resting). */
  last: ActionKind | null;
  /** The card he inspected last (he picks another one next time). */
  lastCard: number | null;
  /** (the app) A living moment of the host is due now (its own mix: 30–60 s apart) — then it is his next deed. */
  alive?: boolean;
}

export interface Decision {
  kind: ActionKind;
  /** How long it lasts (ms) — for the behaviours that simply hold a pose. */
  duration: number;
  /** wander: which floor and where on it (0..1 of its usable width). */
  floor?: number;
  at?: number;
  /** inspect: which card. */
  card?: number;
}

/** ms a behaviour waits before it may come again. */
export const COOLDOWN: Record<ActionKind, number> = {
  idle: 0,
  wander: 0,
  sniff: 6000,
  sit: 9000,
  scratch: 8000,
  lookAround: 7000,
  inspect: 11000,
  admire: 14000,
  stuff: 24000,
  nap: 60000,
  sulk: 12000,
  // (the host's mix spaces them)
  alive: 0,
};

const BASE: Record<ActionKind, number> = {
  idle: 2.4,
  wander: 4,
  sniff: 1.4,
  sit: 1,
  scratch: 0.9,
  lookAround: 1.2,
  inspect: 2.3,
  admire: 1.9,
  stuff: 1.3,
  nap: 0,
  sulk: 0,
  alive: 0,
};

/** Nobody touched him for this long → he gets sleepy. */
export const NAP_AFTER = 45000;
/** Throws within this window count towards his mood. */
export const GRUDGE_WINDOW = 60000;

/** Seeded random numbers (mulberry32): the same seed gives the same life. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0..1: how grumpy recent throws made him (newer throws weigh more; after a minute he has forgiven). */
export function grumpiness(throwTimes: readonly number[], now: number): number {
  let g = 0;
  for (const t of throwTimes) {
    const age = now - t;
    if (age < 0 || age > GRUDGE_WINDOW) continue;
    g += 0.34 * (1 - age / GRUDGE_WINDOW);
  }
  return Math.min(1, g);
}

/** How long he glares after a tumbling landing: longer the more often he was thrown lately (ms). */
export function angerMs(throwTimes: readonly number[], now: number): number {
  const recent = throwTimes.filter((t) => now - t >= 0 && now - t <= 30000).length;
  return Math.min(4200, 1300 + 750 * Math.max(0, recent - 1));
}

/** Three throws within 30 s: he turns his back on you for a while. */
export function shouldSulk(throwTimes: readonly number[], now: number): boolean {
  return throwTimes.filter((t) => now - t >= 0 && now - t <= 30000).length >= 3;
}

/** The weight of each behaviour right now (0 = not possible). Exported for tests and the gallery's debug line. */
export function weights(ctx: BrainContext): Record<ActionKind, number> {
  const w = { ...BASE };
  if (ctx.reduced) {
    // reduced motion: he stays where he is — rests and sits, nothing that moves him around
    return { idle: 1, wander: 0, sniff: 0, sit: 1, scratch: 0, lookAround: 0, inspect: 0, admire: 0, stuff: 0, nap: 0, sulk: 0, alive: 0 };
  }
  const g = grumpiness(ctx.throwTimes, ctx.now);
  const quiet = ctx.now - ctx.lastInteraction;
  if (ctx.cards <= 0) w.inspect = 0;
  if (!ctx.hasAvatar) w.admire = 0;
  if (ctx.kind !== 'hamster') w.stuff = 0;
  if (ctx.floors <= 1) w.wander *= 0.7;
  w.admire *= 1 - g;
  w.inspect *= 1 - 0.5 * g;
  w.stuff *= 1 - 0.6 * g;
  w.sit *= 1 + 2 * g;
  w.nap = quiet >= NAP_AFTER && g < 0.3 ? 6 : 0;
  w.sulk = shouldSulk(ctx.throwTimes, ctx.now) ? 9 : 0;
  // a due living moment comes next — unless he is grumpy (thrown lately) or sulks
  w.alive = ctx.alive && g < 0.3 && w.sulk === 0 ? 12 : 0;
  for (const k of Object.keys(w) as ActionKind[]) {
    const done = ctx.lastDone[k];
    if (done !== undefined && ctx.now - done < COOLDOWN[k]) w[k] = 0;
    if (k === ctx.last && k !== 'wander' && k !== 'idle') w[k] *= 0.15;
  }
  return w;
}

const between = (rng: () => number, lo: number, hi: number) => Math.round(lo + rng() * (hi - lo));

/** One decision: a weighted random pick, then its parameters (where to walk, which card, how long). */
export function decide(ctx: BrainContext, rng: () => number): Decision {
  const w = weights(ctx);
  const kinds = (Object.keys(w) as ActionKind[]).filter((k) => w[k] > 0);
  const total = kinds.reduce((s, k) => s + w[k], 0);
  let pick: ActionKind = 'idle';
  if (total > 0) {
    let r = rng() * total;
    for (const k of kinds) {
      r -= w[k];
      if (r <= 0) { pick = k; break; }
    }
  }
  switch (pick) {
    case 'wander': {
      // mostly along his own floor, now and then over to another one
      const other = ctx.floors > 1 && rng() < 0.3;
      let floor = ctx.floor;
      if (other) {
        floor = Math.floor(rng() * (ctx.floors - 1));
        if (floor >= ctx.floor) floor += 1;
      }
      return { kind: 'wander', duration: 0, floor, at: rng() };
    }
    case 'inspect': {
      let card = Math.floor(rng() * ctx.cards);
      if (ctx.cards > 1 && card === ctx.lastCard) card = (card + 1 + Math.floor(rng() * (ctx.cards - 1))) % ctx.cards;
      return { kind: 'inspect', duration: between(rng, 3600, 4600), card };
    }
    case 'idle': return { kind: 'idle', duration: ctx.reduced ? between(rng, 5000, 9000) : between(rng, 1200, 3400) };
    case 'sit': return { kind: 'sit', duration: between(rng, 3000, 6000) };
    case 'nap': return { kind: 'nap', duration: between(rng, 9000, 15000) };
    case 'sulk': return { kind: 'sulk', duration: between(rng, 5000, 8000) };
    case 'sniff': return { kind: 'sniff', duration: 1300 };
    case 'scratch': return { kind: 'scratch', duration: 1500 };
    case 'lookAround': return { kind: 'lookAround', duration: 2600 };
    case 'admire': return { kind: 'admire', duration: between(rng, 3200, 4200) };
    case 'stuff': return { kind: 'stuff', duration: 3800 };
    case 'alive': return { kind: 'alive', duration: 0 };
  }
}
