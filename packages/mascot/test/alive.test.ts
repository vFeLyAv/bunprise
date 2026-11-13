/**
 * «Живые анимации» (approved 31.10; src/alive/, entry @bunprise/mascot/alive — the gallery demo/alive/ re-exports it
 * and keeps the dropped flop / slump in its archive): every moment ends in the rest pose with nothing left running,
 * only transform / opacity, the parts on a host's own puppet, the mix (no repeat, calm only after 40 s of quiet), the
 * Lists buddy's brain deed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bunny } from '../src/bunny';
import { Hamster } from '../src/hamster';
import { ALIVE_IDS, ALIVE_MIX, ALIVE_MOVES, ALIVE_PAWS_FREE, ALIVE_RULES, AliveMix, alivePool, aliveRng, authorAlive, dressAlive, mountAlive, NEUTRAL, pickAlive, playAlive, SeenClock, wearsCostume, type AliveId, type AliveRig, type PartName } from '../src/alive/index';
import { decide, mulberry32, weights, type BrainContext } from '../src/buddy/brain';
import { MIX } from '../demo/alive/mix';
import { MOVES, moveInfo } from '../demo/alive/moves';

const rigs: AliveRig[] = [];
function rigFor(id: AliveId): AliveRig {
  const kind = ALIVE_MOVES.find((m) => m.id === id)?.kind ?? 'bunny';
  const parent = document.createElement('div');
  document.body.append(parent);
  const rig = mountAlive(parent, { kind, size: 96, idle: true });
  rigs.push(rig);
  return rig;
}

const PARTS = Object.keys(NEUTRAL) as PartName[];

/** Nothing of a moment is left: no animation, no inline style, the puppet's own classes. */
function expectRest(rig: AliveRig): void {
  for (const n of PARTS) {
    for (const e of rig.els(n)) {
      expect(e.getAnimations(), `${n} animations`).toHaveLength(0);
      const st = (e as HTMLElement).style;
      expect(st.transform, `${n} transform`).toBe('');
      expect(st.opacity, `${n} opacity`).toBe('');
    }
  }
  expect(rig.box.getAnimations()).toHaveLength(0);
  const hm = rig.puppet.root.querySelector('.hm');
  for (const c of ['al', 'al-x-rear', 'al-x-hips', 'al-x-lf']) expect(hm?.classList.contains(c)).toBe(false);
  expect(rig.puppet.root.querySelector('.al-floor')?.hasAttribute('clip-path')).toBe(false);
  expect(rig.puppet.root.querySelector('.al-pawclip')?.hasAttribute('clip-path') ?? false).toBe(false);
  expect(rig.driven).toBe(false);
}

afterEach(() => {
  rigs.splice(0).forEach((r) => r.destroy());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the eight approved moments', () => {
  it('eight, by Felix’s list: six of Pompon, two of Tapsi — no flop, no slump', () => {
    expect([...ALIVE_IDS].sort()).toEqual(['dig', 'groom', 'hwash', 'loaf', 'periscope', 'post', 'sneeze', 'stretch']);
    expect(ALIVE_MOVES.filter((m) => m.kind === 'bunny').map((m) => m.id)).toEqual(['groom', 'periscope', 'stretch', 'loaf', 'sneeze', 'dig']);
    expect(ALIVE_MOVES.filter((m) => m.kind === 'hamster').map((m) => m.id)).toEqual(['hwash', 'post']);
    for (const m of ALIVE_MOVES) expect(m.duration).toBeGreaterThan(2);
    for (const m of ALIVE_MOVES) expect(m.duration).toBeLessThanOrEqual(4.2);
  });

  it.each(ALIVE_IDS)('%s: every part starts and ends at rest; only transform / opacity; finite', (id) => {
    const warn = vi.spyOn(console, 'warn');
    const rig = rigFor(id);
    const shot = authorAlive(id, rig);
    expect(warn).not.toHaveBeenCalled();
    expect(shot.tracks.length).toBeGreaterThan(3);
    for (const tr of shot.tracks) {
      const part = tr.name.replace(/^alive\./, '') as PartName;
      const z = NEUTRAL[part];
      for (const t of [0, shot.duration]) {
        const v = tr.sample(t);
        for (const c of Object.keys(z) as (keyof typeof z)[]) expect(v[c] ?? 0, `${id} ${part}.${c} at ${t}`).toBeCloseTo(z[c] ?? 0, 3);
      }
      expect(tr.end).toBeLessThanOrEqual(shot.duration + 1e-6);
      for (const c of tr.compile()) {
        expect(c.timing.iterations ?? 1).toBe(1);
        for (const f of c.frames) for (const k of Object.keys(f)) expect(['offset', 'easing', 'transform', 'opacity', 'composite']).toContain(k);
      }
    }
  });

  it('the wrong puppet is refused (Tapsi does not groom like Pompon)', () => {
    expect(() => authorAlive('groom', rigFor('hwash'))).toThrow();
    expect(() => authorAlive('post', rigFor('groom'))).toThrow();
  });
});

describe('playing one: back to the rest pose, nothing left running', () => {
  beforeEach(() => vi.useFakeTimers());

  it.each(ALIVE_IDS)('%s played to the end', async (id) => {
    const rig = rigFor(id);
    expect(rig.puppet.idleRunning).toBe(true);
    let ended = 0;
    const run = playAlive(rig, authorAlive(id, rig), { onEnd: () => (ended += 1) });
    expect(rig.driven).toBe(true);
    expect(rig.puppet.idleRunning).toBe(false);
    expect(rig.puppet.root.querySelector('.hm')?.classList.contains('al')).toBe(true);
    let done = false;
    void run.done.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(run.shot.duration * 1000 + 80);
    expect(done).toBe(true);
    expect(run.over).toBe(true);
    expect(ended).toBe(1);
    expectRest(rig);
    // its own idle life goes on, as before the moment
    expect(rig.puppet.idleRunning).toBe(true);
  });

  it('stopped half way (a tap): at once the rest pose, nothing ticks', async () => {
    for (const id of ['stretch', 'loaf', 'post'] as const) {
      const rig = rigFor(id);
      const run = playAlive(rig, authorAlive(id, rig));
      await vi.advanceTimersByTimeAsync(1200);
      expect(run.over).toBe(false);
      run.stop();
      expect(run.over).toBe(true);
      expectRest(rig);
      run.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expectRest(rig);
    }
  });

  it('idle: false — a lent puppet stays still afterwards (its host decides)', async () => {
    const rig = rigFor('sneeze');
    const run = playAlive(rig, authorAlive('sneeze', rig), { idle: false });
    await vi.advanceTimersByTimeAsync(3000);
    expect(run.over).toBe(true);
    expect(rig.puppet.idleRunning).toBe(false);
  });

  it('unseen (the tab hidden): it waits on its frame, then goes on', async () => {
    const rig = rigFor('groom');
    const run = playAlive(rig, authorAlive('groom', rig));
    await vi.advanceTimersByTimeAsync(500);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(run.suspended).toBe(true);
    const t = run.time;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run.over).toBe(false);
    expect(run.time).toBeCloseTo(t, 2);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(run.over).toBe(true);
    expectRest(rig);
  });
});

describe('dressAlive: the parts on a puppet the host already shows', () => {
  it('adds its parts once; at rest the puppet is as before (hidden helpers, no classes); destroy keeps the puppet', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const puppet = new Bunny(host, { size: 96, idle: false, interactive: false });
    const a = dressAlive(puppet);
    const b = dressAlive(puppet);
    expect(a.kind).toBe('bunny');
    expect(a.box).toBe(puppet.host);
    expect(puppet.root.querySelectorAll('style[data-alive]')).toHaveLength(1);
    expect(puppet.root.querySelectorAll('.al-floor')).toHaveLength(1);
    expect(puppet.root.querySelectorAll('.al-lf')).toHaveLength(0);
    expect(b.has('lidL')).toBe(true);
    expect(puppet.root.querySelector('.hm')?.classList.contains('al')).toBe(false);
    a.destroy();
    expect(puppet.isDestroyed).toBe(false);
    puppet.destroy();
  });

  it('Tapsi: a hamster puppet gets the hamster rig', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const puppet = new Hamster(host, { size: 96, idle: false, interactive: false });
    const rig = dressAlive(puppet);
    expect(rig.kind).toBe('hamster');
    expect(rig.has('tip')).toBe(true);
    expect(() => authorAlive('post', rig)).not.toThrow();
    puppet.destroy();
  });

  it('a costume: only the paw-free sneeze', () => {
    expect(ALIVE_PAWS_FREE).toEqual(['sneeze']);
    const host = document.createElement('div');
    document.body.append(host);
    const puppet = new Bunny(host, { size: 96, idle: false, interactive: false });
    expect(wearsCostume(puppet.root)).toBe(false);
    const s = document.createElement('style');
    s.dataset['costume'] = 'laptop';
    puppet.root.append(s);
    expect(wearsCostume(puppet.root)).toBe(true);
    puppet.destroy();
  });
});

describe('the mix', () => {
  const ctx = { kind: 'bunny' as const, last: null, quietMs: 0 };

  it('the design’s weights without the flop and the slump; calm = loaf, stretch', () => {
    expect(ALIVE_MIX.map((m) => [m.id, m.weight, m.tier])).toEqual([
      ['groom', 3, 'common'], ['sneeze', 2, 'common'], ['dig', 2, 'common'], ['periscope', 2, 'common'], ['loaf', 1.5, 'calm'], ['stretch', 1, 'calm'],
      ['hwash', 3, 'common'], ['post', 2, 'common'],
    ]);
    expect(ALIVE_RULES).toEqual({ firstAfterMs: 12_000, gapMs: [30_000, 60_000], calmAfterMs: 40_000 });
  });

  it('calm ones only after 40 s without a touch', () => {
    expect(alivePool({ ...ctx, quietMs: 39_999 }).map((m) => m.id)).toEqual(['groom', 'sneeze', 'dig', 'periscope']);
    expect(alivePool({ ...ctx, quietMs: 40_000 }).map((m) => m.id)).toEqual(['groom', 'sneeze', 'dig', 'periscope', 'loaf', 'stretch']);
    const rng = aliveRng(3);
    for (let i = 0; i < 400; i++) expect(['loaf', 'stretch']).not.toContain(pickAlive({ ...ctx, quietMs: 20_000 }, rng));
  });

  it('never the same one twice in a row (a long seeded run, both mascots), each one comes', () => {
    for (const kind of ['bunny', 'hamster'] as const) {
      const rng = aliveRng(11);
      let last: AliveId | null = null;
      const seen = new Set<AliveId>();
      for (let i = 0; i < 600; i++) {
        const id = pickAlive({ kind, last, quietMs: i % 2 ? 60_000 : 0 }, rng);
        expect(id).not.toBeNull();
        expect(id).not.toBe(last);
        if (id) seen.add(id);
        last = id;
      }
      expect(seen.size).toBe(kind === 'bunny' ? 6 : 2);
    }
  });

  it('a place’s own moments only (allowed); none fits = null', () => {
    const rng = aliveRng(5);
    for (let i = 0; i < 50; i++) expect(pickAlive({ ...ctx, allowed: ['sneeze', 'loaf'] }, rng)).toBe('sneeze');
    expect(pickAlive({ ...ctx, last: 'sneeze', allowed: ['sneeze', 'loaf'] }, rng)).toBeNull();
    expect(pickAlive({ ...ctx, kind: 'hamster', allowed: ['groom'] }, rng)).toBeNull();
  });

  it('the schedule: the first after 12 s, then 30–60 s after each end; later() waits; restart()', () => {
    const mix = new AliveMix({ kind: 'bunny', now: 1000, rng: aliveRng(2) });
    expect(mix.due(12_999)).toBe(false);
    expect(mix.pick(12_999, 99_000)).toBeNull();
    expect(mix.due(13_000)).toBe(true);
    let at = 13_000;
    let last: AliveId | null = null;
    for (let i = 0; i < 40; i++) {
      const id = mix.pick(at, 99_000);
      expect(id).not.toBeNull();
      expect(id).not.toBe(last);
      last = id;
      const end = at + 3000;
      mix.played(id as AliveId, end);
      expect(mix.last).toBe(id);
      expect(mix.nextAt - end).toBeGreaterThanOrEqual(30_000);
      expect(mix.nextAt - end).toBeLessThanOrEqual(60_000);
      expect(mix.pick(mix.nextAt - 1, 99_000)).toBeNull();
      at = mix.nextAt;
    }
    mix.later(at, 4000);
    expect(mix.due(at + 3999)).toBe(false);
    expect(mix.due(at + 4000)).toBe(true);
    mix.restart(at + 5000);
    expect(mix.nextAt).toBe(at + 5000 + 12_000);
  });

  it('SeenClock: counts only while the element can be seen (the tab hidden: it stops)', () => {
    let t = 0;
    const el = document.createElement('div');
    document.body.append(el);
    const clock = new SeenClock(el, () => t);
    expect(clock.seen).toBe(true);
    t = 5000;
    expect(clock.now()).toBe(5000);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    t = 50_000;
    expect(clock.seen).toBe(false);
    expect(clock.now()).toBe(5000);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    t = 52_000;
    expect(clock.now()).toBe(7000);
    clock.destroy();
    t = 90_000;
    expect(clock.now()).toBe(7000);
  });
});

describe('the Lists buddy: a due living moment is one of his deeds', () => {
  const base = (over: Partial<BrainContext> = {}): BrainContext => ({
    now: 100_000, kind: 'bunny', reduced: false, cards: 3, hasAvatar: true, floors: 3, floor: 0,
    lastInteraction: 99_000, throwTimes: [], lastDone: {}, last: null, lastCard: null, ...over,
  });

  it('only when the host says it is due; never under reduced motion, never when he is grumpy or sulks', () => {
    expect(weights(base()).alive).toBe(0);
    expect(weights(base({ alive: true })).alive).toBeGreaterThan(5);
    expect(weights(base({ alive: true, reduced: true })).alive).toBe(0);
    expect(weights(base({ alive: true, throwTimes: [99_500, 99_600] })).alive).toBe(0);
    expect(weights(base({ alive: true, throwTimes: [99_000, 99_500, 99_900] })).alive).toBe(0);
  });

  it('due → it comes within a few decisions; without it his seeded life is exactly as before', () => {
    const rng = mulberry32(7);
    const picks = Array.from({ length: 6 }, () => decide(base({ alive: true }), rng).kind);
    expect(picks).toContain('alive');
    // (no `alive` in the context: the same seed gives the same life as a context without the field at all)
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) expect(decide(base({ alive: false }), a)).toEqual(decide(base(), b));
  });
});

describe('the gallery archive (demo/alive)', () => {
  it('the flop and the slump: archived (only with &archive=1), never in the mix', () => {
    expect(moveInfo('flop').archived).toBe(true);
    expect(moveInfo('slump').archived).toBe(true);
    expect(MOVES.filter((m) => !m.archived).map((m) => m.id)).toEqual([...ALIVE_IDS]);
    expect(MIX.map((m) => m.id)).not.toContain('slump');
    expect(MIX.map((m) => m.id)).not.toContain('flop');
    // the gallery's weights are the package's
    for (const m of ALIVE_MIX) expect(MIX.find((x) => x.id === m.id)?.weight).toBe(m.weight);
  });
});
