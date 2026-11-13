/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMomentBudget } from './budget';
import { createDirector } from './director';
import { activeMascot, registerMascot, releaseStage, requestStage, resetStage, type StageMember } from './stage';
import { hasSeenHint, markHintSeen } from '../../lib/hints';
import { ACTIVE_STORAGE_PREFIX } from '../../lib/app';

afterEach(() => { resetStage(); localStorage.clear(); });
describe('mascot priority and optional decoration budget', () => {
  it('a paused offscreen scene yields to a visible response of the same priority', () => {
    const old = Symbol(), next = Symbol();
    const interrupt = vi.fn();
    registerMascot(old, { busy: true, suspended: true, isDestroyed: false, startIdle: vi.fn(), stopIdle: vi.fn(), interrupt }, false);
    expect(requestStage(old, 'response')).toBe(true);
    expect(requestStage(next, 'response')).toBe(true);
    expect(interrupt).toHaveBeenCalledOnce();
    expect(activeMascot()).toBe(next);
  });
  it('work freezes a busy decoration and an old onEnd cannot release its stage', () => {
    const decoration = Symbol(), work = Symbol();
    const interrupt = vi.fn(() => releaseStage(decoration));
    const member: StageMember = { busy: true, isDestroyed: false, startIdle: vi.fn(), stopIdle: vi.fn(), interrupt };
    registerMascot(decoration, member, false); registerMascot(work, { ...member, interrupt: vi.fn() }, false);
    expect(requestStage(decoration, 'decoration')).toBe(true);
    expect(requestStage(work, 'work')).toBe(true);
    expect(interrupt).toHaveBeenCalledOnce(); expect(activeMascot()).toBe(work);
    expect(requestStage(decoration, 'response')).toBe(false);
  });
  it('caps optional decorations, respects typing/scrolling, and leaves user responses and work available', () => {
    let time = 0; const budget = createMomentBudget(() => time);
    for (let i = 0; i < 3; i++) { expect(budget.claim('decoration')).toBe(true); budget.end(); time += 9000; }
    expect(budget.claim('decoration')).toBe(false);
    expect(budget.claim('work')).toBe(true); expect(budget.claim('response')).toBe(true); expect(budget.claim('illustration')).toBe(true);
    time = 61000;budget.typing();expect(budget.claim('decoration')).toBe(false);
    time += 1500;budget.scrolling();expect(budget.claim('illustration')).toBe(false);
    time += 600;expect(budget.claim('decoration')).toBe(true);
  });
});
describe('tab director', () => {
  it('does not count React StrictMode evaluation as a second menu opening', () => {
    const choose = createDirector(() => 0.62);
    const first = choose('create-menu', { requestKey: 'menu-1' });
    expect(choose('create-menu', { requestKey: 'menu-1' })).toBe(first);
    expect(first).toMatchObject({ preset: 'peek-once', special: 'jump-out' });
    expect(choose('create-menu', { requestKey: 'menu-2' })?.coat).toBe('choc');
  });
  it('never immediately repeats a variant, even with a constant random source', () => {
    const choose = createDirector(() => 0);
    const picks = Array.from({ length: 16 }, () => choose('create-menu', { tab: 'start', motion: 'full' }));
    for (let i = 1; i < picks.length; i++) expect(picks[i]?.preset).not.toBe(picks[i - 1]?.preset);
  });
  it('the "+" menu: every opening — the 5th, 6th, 40th too — is a lively moment over the panel’s own edge (Felix 22.10)', () => {
    // a reproducible varied source (a small LCG): later openings must still use the whole pool
    let seed = 7;
    const lcg = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const key = (pick: ReturnType<ReturnType<typeof createDirector>> | undefined) => `${pick?.preset}:${pick?.special ?? ''}`;
    const start = ['climb-left:', 'climb-right:', 'hop-across:', 'wave:', 'peek-once:jump-out', 'peek-sniff:calendar'];
    for (const random of [lcg, () => 0, () => 0.5, () => 0.99]) {
      const choose = createDirector(random);
      const picks = Array.from({ length: 40 }, (_, i) => choose('create-menu', { tab: 'start', motion: 'full', requestKey: `menu-${i}` }));
      for (const pick of picks) {
        expect(start).toContain(key(pick));
        // never the rejected ones: the tall ears (alone or shooting up), a bunny that is just there, a side peek
        // "out of nothing", the hamster
        expect(['ears-only', 'surprise', 'lift', 'corner-left', 'corner-right', 'meet']).not.toContain(pick?.preset);
        expect(pick?.special).not.toBe('hamster');
      }
      for (let i = 1; i < picks.length; i++) expect(key(picks[i])).not.toBe(key(picks[i - 1]));
    }
    // no downgrade after the 4th opening: openings 5–40 still play every moment of the pool, the jump included
    const choose = createDirector(lcg);
    const later = Array.from({ length: 40 }, (_, i) => choose('create-menu', { tab: 'start', requestKey: `again-${i}` })).slice(4);
    expect(new Set(later.map(key))).toEqual(new Set(start));
  });
  it('the "+" menu on Listen: the bunny sniffs without the calendar, and the hamster never comes into the menu', () => {
    for (const random of [() => 0, () => 0.3, () => 0.6, () => 0.99]) {
      const choose = createDirector(random);
      for (let i = 0; i < 12; i++) {
        const pick = choose('create-menu', { tab: 'lists', requestKey: `lists-${i}` });
        expect(pick?.special === undefined || pick.special === 'jump-out').toBe(true);
      }
    }
    expect(createDirector(() => 0.99)('create-menu', { tab: 'lists' })).toMatchObject({ preset: 'peek-sniff' });
    expect(createDirector(() => 0.99)('create-menu', { tab: 'lists' })?.special).toBeUndefined();
  });
  it('keeps independent family histories and emits nothing under reduced/off', () => {
    const choose = createDirector(() => 0.99);
    expect(choose('create-menu', { tab: 'start' })?.special).toBe('calendar');
    expect(choose('screen-host:lists')?.special).toBe('hamster');
    expect(choose('create-menu', { motion: 'reduced' })).toBeNull();
    expect(choose('create-menu', { motion: 'off' })).toBeNull();
  });
  it('rotates Start edges and coats while the Profile host stays one of Pompon’s friends', () => {
    const choose = createDirector(() => 0);
    const first = choose('screen-host:start', { requestKey: 'feed' });
    const second = choose('screen-host:start', { requestKey: 'month' });
    expect(first?.preset).toBe('corner-left');
    expect(second?.preset).toBe('corner-right');
    expect(second?.coat).not.toBe(first?.coat);
    expect(choose('screen-host:profile')?.coat).toBe('choc');
    expect(choose('screen-host:profile')?.coat).toBe('blue');
  });
  it('keeps illustrations on their card edge and visible after every rotating show', () => {
    const choose = createDirector(() => 0.99);
    const picks = Array.from({ length: 9 }, (_, i) => choose('screen-host:start', { requestKey: `empty-${i}`, placement: 'illustration' }));
    for (const pick of picks) expect(['peek-once', 'wave', 'lift']).toContain(pick?.preset);
    expect(new Set(picks.map(pick => pick?.preset)).size).toBeGreaterThan(1);
    expect(new Set(picks.map(pick => pick?.coat)).size).toBe(5);
  });
  it('never asks a card-top host to pretend it has a vertical door frame', () => {
    const choose = createDirector(() => 0);
    for (let i = 0; i < 8; i++) expect(['hop-across', 'pop-up', 'peek-sniff']).toContain(choose('screen-host:start', { placement: 'card-top' })?.preset);
  });
  it('keeps compact profile hosts free of runners, invisible side clips and the lone tall ears', () => {
    const choose = createDirector(() => 0.99);
    for (let i = 0; i < 8; i++) {
      const pick = choose('screen-host:profile', { placement: 'compact-edge' });
      expect(['pop-up', 'peek-sniff']).toContain(pick?.preset);
      expect(pick?.coat).not.toBe('fawn');
    }
  });
});
describe('hint memory', () => {
  it('stores fixed hint IDs and tolerates blocked or corrupt storage', () => {
    const key = `${ACTIVE_STORAGE_PREFIX}hintsSeen`;
    localStorage.setItem(key, '["person-secret-id","reserve-hint",17]');
    expect(hasSeenHint('reserve-hint')).toBe(true);
    markHintSeen('first-steps');markHintSeen('first-steps');
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(['reserve-hint', 'first-steps']);
    localStorage.setItem(key, 'broken');expect(hasSeenHint('first-steps')).toBe(false);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(hasSeenHint('first-steps')).toBe(false);get.mockRestore();
  });
});
