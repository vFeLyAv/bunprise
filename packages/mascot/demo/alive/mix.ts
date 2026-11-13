/**
 * «Живые анимации» (31.10, GALLERY-ONLY prototype) — the proposed mix for the app's idle life, and the gallery's live
 * mode that follows it ("как в приложении").
 *
 * Proposal (docs/design/2026-10-31-alive.md):
 *   - the puppet's own idle life stays as it is (blink, glance, ear sway, nose; the bunny's own sniff every 16–26 s);
 *   - on top of it ONE living moment at a time, the first ≥ 12 s after the screen opens, then every 30–60 s (≤ 2 a
 *     minute: inside the decoration budget of 3 starts a minute), never the same one twice in a row;
 *   - picked by weight; "calm" ones only after a quiet while, "special" ones at most once per 5 minutes;
 *   - the archive (the flop, and since 31.10 the slump: «сполз убрать») is never in the mix.
 *   - nothing while the person types or scrolls, offscreen / hidden tab = paused, reduced motion = none at all,
 *     only the one active mascot of the screen moves (the app's arbiter, stage.ts).
 */

import { IdleScheduler } from '../../src/core';
import type { AliveActor } from './actor';
import { moveInfo, type MoveId } from './moves';
import type { AliveKind } from './rig';

export type Tier = 'common' | 'calm' | 'special';

export interface MixRow {
  readonly id: MoveId;
  readonly weight: number;
  readonly tier: Tier;
  /** how it reads at 96 px on a card edge / at 148 px in a bigger picture (RU, short) */
  readonly at96: string;
  readonly at148: string;
  /** when it may come (RU) */
  readonly when: string;
}

export const MIX: readonly MixRow[] = [
  { id: 'groom', weight: 3, tier: 'common', at96: 'хорошо (язычок не виден)', at148: 'хорошо', when: 'обычное, чаще всех' },
  { id: 'sneeze', weight: 2, tier: 'common', at96: 'хорошо (лучики еле видны)', at148: 'хорошо', when: 'обычное' },
  { id: 'dig', weight: 2, tier: 'common', at96: 'тонко: лапки и пыль крошечные (по смыслу — копает край карточки)', at148: 'хорошо, пыль видна', when: 'обычное; только когда стоит на краю / полке' },
  { id: 'periscope', weight: 2, tier: 'common', at96: 'тонко: поднимается ≈ 3 px, видно лапки у груди', at148: 'хорошо', when: 'обычное; ещё — как ответ на новое на экране' },
  { id: 'loaf', weight: 1.5, tier: 'calm', at96: 'читается: лапки спрятаны, глаза полузакрыты', at148: 'лучше всего', when: 'спокойное: после ≥ 40 с без касаний (4,2 с)' },
  { id: 'stretch', weight: 1, tier: 'calm', at96: 'читается: лапки далеко вперёд, тело длиннее; лапки ≈ 26 px вправо от центра — в своей коробке', at148: 'хорошо', when: 'спокойное: первое после долгой тишины или при первом открытии за день' },
  { id: 'hwash', weight: 3, tier: 'common', at96: 'хорошо — очень «хомячье»', at148: 'хорошо', when: 'обычное (Тапси-дружок на «Списках»)' },
  { id: 'post', weight: 2, tier: 'common', at96: 'хорошо (≈ 7 px выше)', at148: 'хорошо', when: 'обычное; ещё — как ответ на новое на экране' },
];

export const RULES = {
  /** the first living moment after the screen opens (s) */
  firstAfterS: 12,
  /** pause between two moments (s) */
  gapS: [30, 60] as const,
  /** a special one at most this often (s) */
  specialCooldownS: 300,
  /** a calm one only after this long without a touch (s) */
  calmAfterS: 40,
} as const;

/** The gallery's fast live mode: one "app second" passes in 1/12 s (a 30–60 s gap → 2.5–5 s). */
export const FAST = 12;

/** A small seeded RNG (mulberry32): the gallery's live order is the same for the same seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LivePlace {
  readonly actor: AliveActor;
  readonly label: string;
}

export interface LiveOptions {
  fast: boolean;
  seed: number;
  onPick: (text: string) => void;
}

/**
 * The gallery's live mode: like the app would — one mascot of the screen at a time, a gap, a weighted pick. The gap is
 * an empty Web Animation (no setTimeout / setInterval): it pauses with the page (hidden tab, off screen) like the
 * moments do, and nothing ticks when the director is destroyed.
 */
export class LiveDirector {
  private gap: Animation | null = null;
  private readonly rand: () => number;
  private readonly watch: IdleScheduler;
  private last: MoveId | null = null;
  private lastPlace = -1;
  /** "app seconds" since start (gaps count in app time, also in the fast mode) */
  private appS = 0;
  private specialAt = -Infinity;
  private destroyed = false;
  private fast: boolean;

  constructor(
    private readonly host: HTMLElement,
    private readonly places: readonly LivePlace[],
    private readonly o: LiveOptions,
  ) {
    this.fast = o.fast;
    this.rand = rng(o.seed);
    this.watch = new IdleScheduler(
      () => true,
      (active) => {
        if (!this.gap) return;
        if (active) this.gap.play();
        else this.gap.pause();
      },
    );
    this.watch.observe(host);
  }

  start(): void {
    this.watch.start();
    this.wait(RULES.firstAfterS);
  }

  setFast(fast: boolean): void {
    this.fast = fast;
    // a long app-mode wait is cut short when switching to fast (and the other way round it simply waits longer next time)
    if (fast && this.gap) {
      this.gap.cancel();
      this.gap = null;
      this.wait(2);
    }
  }

  /** Waits `appSeconds` (shortened in the fast mode), then picks the next moment. */
  private wait(appSeconds: number): void {
    if (this.destroyed) return;
    const ms = (appSeconds * 1000) / (this.fast ? FAST : 1);
    const a = this.host.animate([], { duration: ms });
    this.gap = a;
    if (!this.watch.active) a.pause();
    a.finished.then(
      () => {
        if (this.gap !== a || this.destroyed) return;
        this.gap = null;
        this.appS += appSeconds;
        void this.next();
      },
      () => undefined,
    );
  }

  private pickPlace(): number {
    let i = Math.floor(this.rand() * this.places.length);
    if (i === this.lastPlace && this.places.length > 1 && this.rand() < 0.6) i = (i + 1) % this.places.length;
    return i;
  }

  private pickMove(kind: AliveKind): MoveId {
    const pool = MIX.filter((m) => {
      if (moveInfo(m.id).kind !== kind || moveInfo(m.id).archived || m.id === this.last) return false;
      if (m.tier === 'special' && this.appS - this.specialAt < RULES.specialCooldownS) return false;
      return true;
    });
    const total = pool.reduce((s, m) => s + m.weight, 0);
    let x = this.rand() * total;
    for (const m of pool) {
      x -= m.weight;
      if (x <= 0) return m.id;
    }
    return (pool[pool.length - 1] ?? MIX[0])?.id ?? 'groom';
  }

  private async next(): Promise<void> {
    if (this.destroyed) return;
    const pi = this.pickPlace();
    const place = this.places[pi];
    if (!place) return;
    this.lastPlace = pi;
    const id = this.pickMove(place.actor.rig.kind);
    this.last = id;
    const row = MIX.find((m) => m.id === id);
    if (row?.tier === 'special') this.specialAt = this.appS;
    const info = moveInfo(id);
    this.o.onPick(`${place.label}: ${info.ru}${row?.tier === 'special' ? ' (особое)' : row?.tier === 'calm' ? ' (спокойное)' : ''}`);
    await place.actor.play(id);
    this.appS += info.duration;
    if (this.destroyed) return;
    const [lo, hi] = RULES.gapS;
    this.wait(lo + this.rand() * (hi - lo));
  }

  destroy(): void {
    this.destroyed = true;
    this.gap?.cancel();
    this.gap = null;
    this.watch.destroy();
  }
}
