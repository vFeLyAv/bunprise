/**
 * «Ночью маскоты спят» (approved 31.10; src/night/, entries @bunprise/mascot/night + /night-clock — the gallery
 * demo/night/ re-exports them): the time rules, the sleeping loop (cheap, paused when unseen, none when still), the
 * wake-up (≤ 2 s, from the frame on screen, a second tap changes nothing), that the app's puppet is exactly itself
 * again afterwards — and the app's options (gate, host pause, tap feedback, hit box, startAwake).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bunny } from '../src/index';
import { AWAKE_MS, atMinute, fmtTime, isNight, minuteOfDay, minutesToChange, NIGHT, parseTime, PEEK_GAP_MS, wantsSleep } from '../src/night/clock';
import { NightMascot, type NightOptions } from '../src/night/controller';
import { asleepPose, authorFall, authorPeek, authorWake, FALL_S, PEEK_S, restPose, sleepLoops, WAKE_S, type Shot } from '../src/night/moves';
import { mountNightPuppet, type PartName } from '../src/night/rig';

const DAY0 = new Date(2026, 9, 31, 12, 0, 0).getTime();
const at = (h: number, m: number, s = 0) => atMinute(DAY0, h * 60 + m + s / 60);

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

function make(o: Partial<NightOptions> & { clock: { ms: number } }): NightMascot {
  const parent = document.createElement('div');
  document.body.append(parent);
  const { clock, ...rest } = o;
  return new NightMascot(parent, { kind: 'bunny', size: 96, idle: false, drip: true, now: () => clock.ms, ...rest });
}

const partOf = (name: string) => name.replace(/^night\./, '') as PartName;

/** Every key of every track ends by the shot's duration (nothing moves on after a moment). */
function lastKey(shot: Shot): number {
  return shot.tracks.reduce((m, t) => Math.max(m, Number.isFinite(t.end) ? t.end : 0), 0);
}

describe('night clock (23:00 – 07:00)', () => {
  it('22:59 is day, 23:00 is night, 06:59 is night, 07:00 is day — over midnight', () => {
    expect(isNight(22 * 60 + 59)).toBe(false);
    expect(isNight(23 * 60)).toBe(true);
    expect(isNight(0)).toBe(true);
    expect(isNight(3 * 60 + 30)).toBe(true);
    expect(isNight(6 * 60 + 59)).toBe(true);
    expect(isNight(7 * 60)).toBe(false);
    expect(isNight(12 * 60)).toBe(false);
    // seconds count: 22:59:59 is still day, 06:59:59 still night
    expect(isNight(minuteOfDay(at(22, 59, 59)))).toBe(false);
    expect(isNight(minuteOfDay(at(23, 0, 0)))).toBe(true);
    expect(isNight(minuteOfDay(at(6, 59, 59)))).toBe(true);
    expect(isNight(minuteOfDay(at(7, 0, 0)))).toBe(false);
  });

  it('other windows: not over midnight, and from === to = never night', () => {
    expect(isNight(13 * 60, { from: 12 * 60, to: 14 * 60 })).toBe(true);
    expect(isNight(14 * 60, { from: 12 * 60, to: 14 * 60 })).toBe(false);
    expect(isNight(5, { from: 300, to: 300 })).toBe(false);
    expect(minutesToChange(5, { from: 300, to: 300 })).toBe(Infinity);
  });

  it('minutes until the next change', () => {
    expect(minutesToChange(22 * 60 + 59)).toBe(1);
    expect(minutesToChange(23 * 60)).toBe(8 * 60);
    expect(minutesToChange(6 * 60 + 30)).toBe(30);
    expect(minutesToChange(7 * 60)).toBe(16 * 60);
  });

  it('wants to sleep: night, the switch on, and not inside the awake time after a tap', () => {
    const now = at(23, 30);
    expect(wantsSleep({ now, enabled: true, awakeUntil: -Infinity })).toBe(true);
    expect(wantsSleep({ now, enabled: false, awakeUntil: -Infinity })).toBe(false);
    expect(wantsSleep({ now, enabled: true, awakeUntil: now + AWAKE_MS })).toBe(false);
    expect(wantsSleep({ now: now + AWAKE_MS, enabled: true, awakeUntil: now + AWAKE_MS })).toBe(true);
    expect(wantsSleep({ now: at(12, 0), enabled: true, awakeUntil: -Infinity })).toBe(false);
    expect(AWAKE_MS).toBe(10 * 60_000);
    expect(NIGHT).toEqual({ from: 23 * 60, to: 7 * 60 });
  });

  it('formats and parses times', () => {
    expect(fmtTime(23 * 60)).toBe('23:00');
    expect(fmtTime(7 * 60 + 5.9)).toBe('07:05');
    expect(fmtTime(-1)).toBe('23:59');
    expect(parseTime('23:30')).toBe(23 * 60 + 30);
    expect(parseTime('7:05')).toBe(7 * 60 + 5);
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

describe('night moments: ≤ 2 s, transform / opacity only, from any pose', () => {
  const rigOf = (kind: 'bunny' | 'hamster') => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const rig = mountNightPuppet(parent, { kind, size: 96, binoculars: kind === 'hamster', idle: false });
    rig.takeOver();
    return rig;
  };

  for (const kind of ['bunny', 'hamster'] as const) {
    it(`${kind}: fall ${FALL_S} s, wake / morning ${WAKE_S} s, peek ${PEEK_S} s — every one-shot ≤ 2 s and over by its end`, () => {
      const rig = rigOf(kind);
      const shots = [
        authorFall(rig, restPose(rig), true),
        authorWake(rig, asleepPose(rig, true), 'tap'),
        authorWake(rig, asleepPose(rig, true), 'morning'),
        authorPeek(rig, asleepPose(rig, true)),
      ];
      for (const s of shots) {
        expect(s.duration).toBeLessThanOrEqual(2);
        expect(lastKey(s)).toBeLessThanOrEqual(s.duration + 1e-9);
        for (const tr of s.tracks) {
          for (const c of tr.compile()) {
            for (const f of c.frames) {
              const props = Object.keys(f).filter((k) => !['offset', 'easing', 'composite'].includes(k));
              expect(props.every((p) => p === 'transform' || p === 'opacity')).toBe(true);
            }
          }
        }
      }
      rig.destroy();
    });

    it(`${kind}: the fall ends in the sleeping pose, the wake-up in the awake rest pose`, () => {
      const rig = rigOf(kind);
      const fall = authorFall(rig, restPose(rig), true);
      const asleep = asleepPose(rig, true);
      for (const [name, v] of Object.entries(asleep)) {
        if (name === 'breath' || name === 'z') continue;
        const got = fall.end[name as PartName] ?? {};
        for (const [ch, val] of Object.entries(v)) expect(got[ch as keyof typeof got]).toBeCloseTo(val as number, 4);
      }
      const wake = authorWake(rig, asleep, 'tap');
      const rest = restPose(rig);
      for (const [name, v] of Object.entries(rest)) {
        const got = wake.end[name as PartName] ?? {};
        for (const [ch, val] of Object.entries(v)) expect(got[ch as keyof typeof got]).toBeCloseTo(val as number, 4);
      }
      rig.destroy();
    });
  }

  it('the sleeping loop: slow (≥ 4.6 s), transform / opacity only, breath and "z" on HTML wrappers (outside the SVG)', () => {
    const rig = rigOf('bunny');
    const loops = sleepLoops(rig, false);
    expect(loops).toHaveLength(2);
    for (const l of loops) {
      expect(l.period).toBeGreaterThanOrEqual(4.6);
      const el = l.els[0] as Element;
      expect(el.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
      expect(el.closest('svg')).toBeNull();
      for (const c of l.compile()) {
        expect(c.timing.iterations).toBe(Infinity);
        for (const f of c.frames) expect(Object.keys(f).every((k) => ['offset', 'easing', 'transform', 'opacity'].includes(k))).toBe(true);
      }
    }
    // the drip (approved: it runs down) adds one tiny loop inside the SVG, in step with the breath
    expect(sleepLoops(rig, true)).toHaveLength(3);
    rig.destroy();
  });
});

describe('NightMascot: falls asleep, sleeps cheaply, wakes on a tap', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('opened at night: already asleep — no falling-asleep moment, only the loop', () => {
    const clock = { ms: at(23, 30) };
    const m = make({ clock });
    expect(m.state).toBe('asleep');
    expect(m.moment).toBeNull();
    expect(m.loopAnimations.length).toBe(3);
    expect(m.loopAnimations.every((a) => a.playState === 'running')).toBe(true);
    m.destroy();
  });

  it('by day awake; when the clock reaches 23:00 he falls asleep (1.95 s), then only the loop runs', async () => {
    const clock = { ms: at(22, 59, 58) };
    const m = make({ clock });
    expect(m.state).toBe('awake');
    m.update();
    expect(m.state).toBe('awake');
    clock.ms = at(23, 0, 0);
    m.update();
    expect(m.state).toBe('falling');
    expect(m.moment?.name).toBe('fall');
    await vi.advanceTimersByTimeAsync(FALL_S * 1000 + 60);
    expect(m.state).toBe('asleep');
    expect(m.moment).toBeNull();
    // the moment's own animations are gone: only the loop ticks
    expect(m.animations).toEqual(m.loopAnimations);
    m.destroy();
  });

  it('the sleeping loop pauses while the tab is hidden and goes on afterwards (the same animations)', () => {
    const clock = { ms: at(0, 30) };
    const m = make({ clock });
    const loops = m.loopAnimations;
    expect(loops.length).toBeGreaterThan(0);
    setHidden(true);
    expect(m.suspended).toBe(true);
    expect(loops.every((a) => a.playState === 'paused')).toBe(true);
    setHidden(false);
    expect(m.suspended).toBe(false);
    expect(m.loopAnimations).toEqual(loops);
    expect(loops.every((a) => a.playState === 'running')).toBe(true);
    m.destroy();
  });

  it('the sleeping loop pauses while he is off screen (IntersectionObserver)', () => {
    const observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          observers.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    const clock = { ms: at(1, 0) };
    const m = make({ clock });
    const loops = m.loopAnimations;
    expect(loops.every((a) => a.playState === 'running')).toBe(true);
    observers.forEach((cb) => cb([{ isIntersecting: false }]));
    expect(loops.every((a) => a.playState === 'paused')).toBe(true);
    observers.forEach((cb) => cb([{ isIntersecting: true }]));
    expect(loops.every((a) => a.playState === 'running')).toBe(true);
    m.destroy();
  });

  it('a falling-asleep that would start unseen jumps to the sleeping pose (no moment plays hidden)', () => {
    const clock = { ms: at(22, 59, 59) };
    const m = make({ clock });
    setHidden(true);
    clock.ms = at(23, 0, 1);
    m.update();
    expect(m.state).toBe('asleep');
    expect(m.moment).toBeNull();
    expect(m.loopAnimations.every((a) => a.playState === 'paused')).toBe(true);
    m.destroy();
  });

  it('a tap wakes him (2.0 s); a second tap during the wake-up changes nothing; then awake for 10 min, then asleep again', async () => {
    const clock = { ms: at(23, 40) };
    const m = make({ clock });
    expect(m.state).toBe('asleep');
    const tappedAt = clock.ms;
    m.tap();
    expect(m.state).toBe('waking');
    const shot = m.moment;
    expect(shot?.name).toBe('wake');
    expect(shot?.duration).toBeLessThanOrEqual(2);
    // the loop stopped at once (its frame is where the wake-up starts)
    expect(m.loopAnimations).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(700);
    const t = m.time;
    expect(t).toBeGreaterThan(0.6);
    m.tap();
    m.tap();
    expect(m.state).toBe('waking');
    expect(m.moment).toBe(shot);
    expect(m.time).toBeCloseTo(t, 3);
    await vi.advanceTimersByTimeAsync(WAKE_S * 1000 - 700 + 60);
    expect(m.state).toBe('awake');
    expect(m.animations).toHaveLength(0);
    expect(m.awakeUntil).toBe(tappedAt + AWAKE_MS);
    // 9 minutes later still awake
    clock.ms = tappedAt + 9 * 60_000;
    m.update();
    expect(m.state).toBe('awake');
    // a tap while awake: the awake time starts again
    m.tap();
    expect(m.awakeUntil).toBe(clock.ms + AWAKE_MS);
    clock.ms += AWAKE_MS;
    m.update();
    expect(m.state).toBe('falling');
    m.destroy();
  });

  it('a tap during the falling-asleep wakes him from exactly that frame (no jump)', async () => {
    const clock = { ms: at(22, 59, 59) };
    const m = make({ clock });
    clock.ms = at(23, 0, 1);
    m.update();
    const fall = m.moment;
    expect(fall?.name).toBe('fall');
    await vi.advanceTimersByTimeAsync(900);
    const t = m.time;
    expect(t).toBeGreaterThan(0.85);
    m.tap();
    expect(m.state).toBe('waking');
    const wake = m.moment;
    expect(wake?.name).toBe('wake');
    if (!fall || !wake) throw new Error('no moments');
    const fallAt = new Map(fall.tracks.map((tr) => [partOf(tr.name), tr.sample(t)]));
    let compared = 0;
    for (const tr of wake.tracks) {
      const was = fallAt.get(partOf(tr.name));
      if (!was) continue;
      const now = tr.sample(0);
      for (const [ch, v] of Object.entries(was)) expect(now[ch as keyof typeof now]).toBeCloseTo(v as number, 5);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(8);
    m.destroy();
  });

  it('the person scrolls elsewhere: one sleepy peek (0.85 s), at most every 20 s; the loop never stops for it', async () => {
    const clock = { ms: at(2, 0) };
    let real = 1_000_000;
    const m = make({ clock, realNow: () => real });
    const loops = m.loopAnimations;
    m.nudge();
    expect(m.state).toBe('peek');
    expect(m.moment?.name).toBe('peek');
    await vi.advanceTimersByTimeAsync(PEEK_S * 1000 + 60);
    expect(m.state).toBe('asleep');
    expect(m.loopAnimations).toEqual(loops);
    expect(loops.every((a) => a.playState === 'running')).toBe(true);
    real += PEEK_GAP_MS - 1000;
    m.nudge();
    expect(m.state).toBe('asleep');
    real += 1000;
    m.nudge();
    expect(m.state).toBe('peek');
    m.destroy();
  });

  it('07:00: wakes up by himself (no startle), then stays awake', async () => {
    const clock = { ms: at(6, 59, 58) };
    const m = make({ clock });
    expect(m.state).toBe('asleep');
    clock.ms = at(7, 0, 0);
    m.update();
    expect(m.state).toBe('waking');
    expect(m.moment?.name).toBe('morning');
    expect(m.moment?.marks.startle).toBeUndefined();
    await vi.advanceTimersByTimeAsync(WAKE_S * 1000 + 60);
    expect(m.state).toBe('awake');
    m.update();
    expect(m.state).toBe('awake');
    m.destroy();
  });

  it('the switch «Nachts schlafen» off: he never sleeps', () => {
    const clock = { ms: at(23, 30) };
    const m = make({ clock, enabled: false });
    expect(m.state).toBe('awake');
    m.update();
    expect(m.state).toBe('awake');
    m.destroy();
  });

  it('reduced motion / battery saver (still): not one animate() call — a still sleeping pose with a still "z"; a tap wakes him at once', () => {
    const spy = vi.spyOn(Element.prototype, 'animate');
    const clock = { ms: at(23, 30) };
    const m = make({ clock, still: true });
    expect(m.state).toBe('asleep');
    expect(m.animations).toHaveLength(0);
    const z = m.rig.els('z')[0] as HTMLElement;
    expect(Number(z.style.opacity)).toBeGreaterThan(0.5);
    const sleepArc = m.rig.els('sleepL')[0] as SVGElement;
    expect(sleepArc.style.opacity).toBe('1');
    m.nudge();
    expect(m.state).toBe('asleep');
    m.tap();
    expect(m.state).toBe('awake');
    expect(m.awakeUntil).toBe(clock.ms + AWAKE_MS);
    clock.ms += AWAKE_MS;
    m.update();
    expect(m.state).toBe('asleep');
    expect(spy).not.toHaveBeenCalled();
    m.destroy();
  });

  it('battery saver switched on while he sleeps: the loop stops at once, the still pose stays', () => {
    const clock = { ms: at(23, 30) };
    const m = make({ clock });
    const loops = m.loopAnimations;
    expect(loops.length).toBeGreaterThan(0);
    m.setStill(true);
    expect(m.state).toBe('asleep');
    expect(m.animations).toHaveLength(0);
    expect(loops.every((a) => a.playState === 'idle')).toBe(true);
    m.setStill(false);
    expect(m.loopAnimations.length).toBe(loops.length);
    m.destroy();
  });

  it("after a night the app's puppet is exactly itself again (no class, no inline style, same markup as a fresh one)", async () => {
    const clock = { ms: at(22, 59, 59) };
    const m = make({ clock });
    clock.ms = at(23, 0, 1);
    m.update();
    await vi.advanceTimersByTimeAsync(FALL_S * 1000 + 60);
    expect(m.state).toBe('asleep');
    m.tap();
    await vi.advanceTimersByTimeAsync(WAKE_S * 1000 + 60);
    expect(m.state).toBe('awake');
    const host = document.createElement('div');
    document.body.append(host);
    const fresh = new Bunny(host, { size: 96, idle: false, interactive: false, reducedMotion: 'off', coat: 'fawn' });
    // the rig resets him with the puppet's own pose('idle') before a night moment (it writes the default --puff: 1)
    fresh.pose('idle');
    const clean = (html: string) => html.replace(/bp-bunny-\d+/g, 'ID').replace(/ style=""/g, '').replace(/<style>[^<]*\.hm\.nn[^<]*<\/style>/, '');
    expect(clean(m.rig.puppet.root.innerHTML)).toBe(clean(fresh.root.innerHTML));
    expect(m.rig.puppet.root.querySelector('.hm')?.classList.contains('nn')).toBe(false);
    fresh.destroy();
    m.destroy();
  });
});

describe('the gallery keeps working from the package (demo/night re-exports src/night)', () => {
  it('the gallery modules are the package modules', async () => {
    const [gClock, gCtl, gMoves, gRig, sClock, sCtl, sMoves, sRig, entry] = await Promise.all([
      import('../demo/night/clock'), import('../demo/night/controller'), import('../demo/night/moves'), import('../demo/night/rig'),
      import('../src/night/clock'), import('../src/night/controller'), import('../src/night/moves'), import('../src/night/rig'),
      import('../src/night/index'),
    ]);
    expect(gClock.isNight).toBe(sClock.isNight);
    expect(gCtl.NightMascot).toBe(sCtl.NightMascot);
    expect(gMoves.authorWake).toBe(sMoves.authorWake);
    expect(gRig.mountNightPuppet).toBe(sRig.mountNightPuppet);
    expect(entry.NightMascot).toBe(sCtl.NightMascot);
    expect(entry.AWAKE_MS).toBe(10 * 60_000);
  });
});

describe('NightMascot: the app options (gate, host pause, tap feedback, hit box, startAwake)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setHidden(false);
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('the clock: 22:59 awake, 23:00 asleep, 06:59 asleep, 07:00 awake — each opened fresh, across midnight', () => {
    const open = (h: number, m: number) => {
      const mm = make({ clock: { ms: at(h, m) } });
      const s = mm.state;
      mm.destroy();
      return s;
    };
    expect(open(22, 59)).toBe('awake');
    expect(open(23, 0)).toBe('asleep');
    expect(open(0, 0)).toBe('asleep');
    expect(open(6, 59)).toBe('asleep');
    expect(open(7, 0)).toBe('awake');
  });

  it('startAwake: the night began while the screen was open — awake first, the next update() falls asleep in view', () => {
    const clock = { ms: at(23, 0, 0) };
    const m = make({ clock, startAwake: true });
    expect(m.state).toBe('awake');
    m.update();
    expect(m.state).toBe('falling');
    expect(m.busy).toBe(true);
    m.destroy();
  });

  it('gate refuses the falling-asleep: he stays awake and asks again on the next update()', () => {
    const clock = { ms: at(22, 59, 59) };
    let allow = false;
    const asked: string[] = [];
    const m = make({ clock, gate: (moment) => (asked.push(moment), allow) });
    clock.ms = at(23, 0, 1);
    m.update();
    expect(m.state).toBe('awake');
    expect(m.animations).toHaveLength(0);
    allow = true;
    m.update();
    expect(m.state).toBe('falling');
    expect(asked).toEqual(['fall', 'fall']);
    m.destroy();
  });

  it('gate refuses the peek: no peek; refuses the morning: asleep until it may; refuses a tap wake: awake at once, no moment', () => {
    const clock = { ms: at(3, 0) };
    let allow = false;
    const m = make({ clock, gate: () => allow, realNow: () => 5_000_000 });
    m.nudge();
    expect(m.state).toBe('asleep');
    clock.ms = at(7, 0, 1);
    m.update();
    expect(m.state).toBe('asleep');
    allow = true;
    m.update();
    expect(m.state).toBe('waking');
    expect(m.moment?.name).toBe('morning');
    m.destroy();

    const clock2 = { ms: at(1, 0) };
    const m2 = make({ clock: clock2, gate: (moment) => moment !== 'wake' });
    m2.tap();
    expect(m2.state).toBe('awake');
    expect(m2.moment).toBeNull();
    expect(m2.awakeUntil).toBe(clock2.ms + AWAKE_MS);
    m2.destroy();
  });

  it('setPaused (a sheet open / another mascot on stage): the loop and a moment pause where they are, then go on', async () => {
    const clock = { ms: at(23, 30) };
    const m = make({ clock });
    const loops = m.loopAnimations;
    m.setPaused(true);
    expect(loops.every((a) => a.playState === 'paused')).toBe(true);
    expect(m.suspended).toBe(true);
    // a peek while paused is not shown (nobody would see it)
    m.nudge();
    expect(m.state).toBe('asleep');
    m.setPaused(false);
    expect(loops.every((a) => a.playState === 'running')).toBe(true);
    m.tap();
    await vi.advanceTimersByTimeAsync(500);
    const t = m.time;
    m.setPaused(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(m.state).toBe('waking');
    expect(m.time).toBeCloseTo(t, 3);
    m.setPaused(false);
    await vi.advanceTimersByTimeAsync(WAKE_S * 1000);
    expect(m.state).toBe('awake');
    m.destroy();
  });

  it('a falling-asleep that would start while paused jumps to the sleeping pose', () => {
    const clock = { ms: at(22, 59, 59) };
    const m = make({ clock });
    m.setPaused(true);
    clock.ms = at(23, 0, 1);
    m.update();
    expect(m.state).toBe('asleep');
    expect(m.moment).toBeNull();
    m.destroy();
  });

  it('onTap only for real taps (never for the falling-asleep, the peek or the morning); onAwakeTap replaces the hop', async () => {
    const clock = { ms: at(22, 59, 59) };
    const taps: number[] = [];
    let answered = 0;
    const m = make({ clock, onTap: () => taps.push(clock.ms), onAwakeTap: () => (answered += 1, true), realNow: () => 9_000_000 });
    const hop = vi.spyOn(m.rig.puppet, 'hop');
    clock.ms = at(23, 0, 1);
    m.update();
    await vi.advanceTimersByTimeAsync(FALL_S * 1000 + 60);
    m.nudge();
    await vi.advanceTimersByTimeAsync(PEEK_S * 1000 + 60);
    expect(taps).toHaveLength(0);
    m.tap();
    expect(taps).toHaveLength(1);
    // a tap during the wake-up: ignored, no feedback
    m.tap();
    expect(taps).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(WAKE_S * 1000 + 60);
    m.tap();
    expect(taps).toHaveLength(2);
    expect(answered).toBe(1);
    expect(hop).not.toHaveBeenCalled();
    m.destroy();
  });

  it('hit: the box lets touches through, only his body (down to his feet) catches them; a click on it wakes him', () => {
    const clock = { ms: at(23, 30) };
    const m = make({ clock, hit: true });
    expect(m.rig.box.style.pointerEvents).toBe('none');
    const hit = m.rig.hit as HTMLElement;
    expect(hit).not.toBeNull();
    expect(hit.style.pointerEvents).toBe('auto');
    const bottom = parseFloat(hit.style.top) + parseFloat(hit.style.height);
    expect(bottom).toBeCloseTo(m.rig.feet, 5);
    // ≥ 44 px wide and high at the app's 96 px
    expect(parseFloat(hit.style.width)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(hit.style.height)).toBeGreaterThanOrEqual(44);
    hit.click();
    expect(m.state).toBe('waking');
    m.destroy();
  });

  it('the switch turned off while he sleeps: he wakes up like in the morning (no startle)', () => {
    const clock = { ms: at(0, 30) };
    const m = make({ clock });
    m.setEnabled(false);
    expect(m.state).toBe('waking');
    expect(m.moment?.name).toBe('morning');
    m.destroy();
  });
});
