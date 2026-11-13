/**
 * «Живые анимации» — the mix of the app's idle life (docs/design/2026-10-31-alive.md «Как смешать», Felix 31.10:
 * flop and slump dropped). Pure: no DOM, no timers — the host gives the clock (`now`: the milliseconds the mascot could
 * be seen, so a gap waits while he is off screen or the tab is hidden) and the random numbers (tests: seeded).
 *
 *   - the puppet's own idle life stays as it is (blink, glance, ear sway, nose; Pompon's own sniff);
 *   - on top of it ONE living moment at a time per mascot: the first ≈ 12 s after the place opens, then every 30–60 s
 *     (≤ 2 a minute, inside the app's decoration budget of 3 starts a minute);
 *   - picked by weight, never the same one twice in a row;
 *   - the calm ones (loaf, stretch) only after 40 s without a touch.
 * Everything else (not while asleep, not under reduced motion, not while the person types or scrolls, one mascot at a
 * time, paused unseen) is the host's: it simply does not ask, or does not play what was picked.
 */

import type { AliveId } from './moves';
import type { AliveKind } from './rig';

export type AliveTier = 'common' | 'calm';

export interface AliveMixRow {
  readonly id: AliveId;
  readonly kind: AliveKind;
  readonly weight: number;
  readonly tier: AliveTier;
}

/** The design's weights (31.10), without the dropped flop and slump. */
export const ALIVE_MIX: readonly AliveMixRow[] = [
  { id: 'groom', kind: 'bunny', weight: 3, tier: 'common' },
  { id: 'sneeze', kind: 'bunny', weight: 2, tier: 'common' },
  { id: 'dig', kind: 'bunny', weight: 2, tier: 'common' },
  { id: 'periscope', kind: 'bunny', weight: 2, tier: 'common' },
  { id: 'loaf', kind: 'bunny', weight: 1.5, tier: 'calm' },
  { id: 'stretch', kind: 'bunny', weight: 1, tier: 'calm' },
  { id: 'hwash', kind: 'hamster', weight: 3, tier: 'common' },
  { id: 'post', kind: 'hamster', weight: 2, tier: 'common' },
];

export interface AliveRules {
  /** the first moment this long after the place opens (ms of being seen) */
  readonly firstAfterMs: number;
  /** the pause between two moments, from the end of one to the start of the next (ms) */
  readonly gapMs: readonly [number, number];
  /** a calm one only after this long without a touch (ms) */
  readonly calmAfterMs: number;
}

export const ALIVE_RULES: AliveRules = { firstAfterMs: 12_000, gapMs: [30_000, 60_000], calmAfterMs: 40_000 };

export interface AlivePickContext {
  kind: AliveKind;
  /** the moment he played last (never twice in a row) */
  last: AliveId | null;
  /** ms since the last touch of him */
  quietMs: number;
  /** the moments this place may show now (default: all of his kind) */
  allowed?: readonly AliveId[] | undefined;
  rules?: AliveRules;
  /** (dev only) the same one again is fine */
  repeat?: boolean;
}

/** What may come now, with its weight. */
export function alivePool(ctx: AlivePickContext): AliveMixRow[] {
  const rules = ctx.rules ?? ALIVE_RULES;
  return ALIVE_MIX.filter((m) => {
    if (m.kind !== ctx.kind) return false;
    if (ctx.allowed && !ctx.allowed.includes(m.id)) return false;
    if (!ctx.repeat && m.id === ctx.last) return false;
    if (m.tier === 'calm' && ctx.quietMs < rules.calmAfterMs) return false;
    return true;
  });
}

/** A weighted pick (null: nothing fits now). */
export function pickAlive(ctx: AlivePickContext, rng: () => number): AliveId | null {
  const pool = alivePool(ctx);
  const total = pool.reduce((s, m) => s + m.weight, 0);
  if (!(total > 0)) return null;
  let x = rng() * total;
  for (const m of pool) {
    x -= m.weight;
    if (x <= 0) return m.id;
  }
  return pool[pool.length - 1]?.id ?? null;
}

/** A small seeded RNG (mulberry32): the same seed gives the same order (tests, screenshots). */
export function aliveRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AliveMixOptions {
  kind: AliveKind;
  /** the host's clock at the start (ms of being seen) */
  now: number;
  allowed?: readonly AliveId[];
  rules?: AliveRules;
  rng?: () => number;
  /** (dev only) the same one again is fine */
  repeat?: boolean;
}

/** One mascot's schedule: when the next moment is due and which one it is. */
export class AliveMix {
  private next: number;
  private prev: AliveId | null = null;
  private readonly rules: AliveRules;
  private readonly rng: () => number;

  constructor(private readonly o: AliveMixOptions) {
    this.rules = o.rules ?? ALIVE_RULES;
    this.rng = o.rng ?? Math.random;
    this.next = o.now + this.rules.firstAfterMs;
  }

  /** when the next one is due (host clock ms) */
  get nextAt(): number {
    return this.next;
  }

  get last(): AliveId | null {
    return this.prev;
  }

  due(now: number): boolean {
    return now >= this.next;
  }

  /** The moment for now (null: none is due, or none fits — e.g. only calm ones are left before 40 s of quiet). */
  pick(now: number, quietMs: number, allowed?: readonly AliveId[]): AliveId | null {
    if (!this.due(now)) return null;
    const only = allowed && this.o.allowed ? allowed.filter((id) => this.o.allowed?.includes(id)) : (allowed ?? this.o.allowed);
    return pickAlive({ kind: this.o.kind, last: this.prev, quietMs, allowed: only, rules: this.rules, ...(this.o.repeat ? { repeat: true } : {}) }, this.rng);
  }

  /** It played (`now` = its end): the next one 30–60 s later. */
  played(id: AliveId, now: number): void {
    this.prev = id;
    const [lo, hi] = this.rules.gapMs;
    this.next = now + lo + this.rng() * (hi - lo);
  }

  /** Starts over (he woke up, the place opened again): the next one ≈ 12 s from `now`. */
  restart(now: number): void {
    this.next = now + this.rules.firstAfterMs;
  }

  /** Not now (the stage or the budget said no, he was busy): ask again in `ms`. */
  later(now: number, ms: number): void {
    this.next = Math.max(this.next, now + ms);
  }
}
