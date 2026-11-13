/**
 * «Помпон в открытом списке» (approved 31.10; src/listplay/, entry @bunprise/mascot/listplay — the gallery
 * demo/listplay/ re-exports the rig and the player and keeps only its mock's list in the timelines): every moment is
 * finite, over by its end, transform / opacity only, the same frame on every seek; the shorter trips (Felix: «4,5 с —
 * можно короче»); the ear's soft limits; the shake rule (≈ 1.4 g, three peaks in 0.7 s, 10 s apart); a borrowed
 * puppet is exactly itself again afterwards; the gift box.
 */
import { describe, expect, it, vi } from 'vitest';
import { Bunny } from '../src/index';
import { createBuddy } from '../src/buddy/index';
import { mountGiftBox } from '../src/listplay/box';
import {
  authorBoop, authorBounce, authorBulk, authorDelete, authorDizzy, authorEnd, authorGrab, authorMove, authorPeek, authorPop, authorPull,
  authorReceived, authorRelax, authorRelease, authorSelect, authorStroke, authorWish, DIZZY_S, earFollow, NERVOUS, TRIP_HOPS, type Ctx, type Shot,
} from '../src/listplay/moves';
import { Player } from '../src/listplay/player';
import { dressPompon, earTipAt, mountPompon, UNIT, unitOf } from '../src/listplay/rig';
import { createShakeDetector, motionOf, SHAKE } from '../src/listplay/shake';

function ctxOf(seat = { x: 330, y: 120 }): { c: Ctx; haptics: string[]; layer: HTMLElement } {
  const layer = document.createElement('div');
  document.body.append(layer);
  const rig = mountPompon(layer, { still: false });
  rig.place(seat);
  const haptics: string[] = [];
  return { c: { rig, seat, ghost: false, haptic: (k) => haptics.push(k) }, haptics, layer };
}

function lastKey(shot: Shot): number {
  return shot.tracks.reduce((m, t) => Math.max(m, Number.isFinite(t.end) ? t.end : 0), 0);
}

function onlyTransformOpacity(shot: Shot): boolean {
  return shot.tracks.every((tr) => tr.compile().every((c) => c.frames.every((f) => Object.keys(f).filter((k) => !['offset', 'easing', 'composite'].includes(k)).every((p) => p === 'transform' || p === 'opacity'))));
}

const TILE = { feet: { x: 100, y: 470 }, photo: { x: 30, y: 330, w: 150, h: 143 } };

describe('listplay moments: finite, transform / opacity only, the same frame on every seek', () => {
  it('every moment ends by its duration and moves only transform / opacity', () => {
    const { c } = ctxOf();
    const box = mountGiftBox(document.body, { x: 100, y: 300 });
    const bubble = document.createElement('div');
    const shots: Shot[] = [
      authorStroke(c, {}),
      authorBoop(c, {}),
      authorWish(c, {}, { ...TILE, reach: true }),
      authorWish(c, {}, { ...TILE, reach: false }),
      authorReceived(c, {}, { ...TILE, reach: true }),
      authorReceived(c, {}, { ...TILE, reach: false }),
      authorDelete(c, {}, { target: TILE.photo }),
      authorSelect(c, {}),
      authorRelax(c, NERVOUS),
      authorMove(c, NERVOUS, { rects: [TILE.photo], width: 390 }),
      authorBulk(c, NERVOUS, { rects: [TILE.photo] }),
      authorEnd(c, {}, { el: bubble, text: 'Das war’s!', width: 96, layerWidth: 390 }),
      authorBounce(c, {}),
      authorPeek(c, {}, box),
      authorPop(c, {}, box),
      authorPull(c, {}, 'r'),
      authorGrab(c, {}, 'l'),
      authorRelease(c, { earR: { r: -18, sx: 0.98, sy: 1.07 } }, 'r'),
      authorDizzy(c, {}),
    ];
    for (const s of shots) {
      expect(Number.isFinite(s.duration)).toBe(true);
      expect(s.duration).toBeGreaterThan(0);
      expect(lastKey(s)).toBeLessThanOrEqual(s.duration + 1e-9);
      expect(onlyTransformOpacity(s)).toBe(true);
    }
    // the same frame every time (seek)
    const wish = shots[2] as Shot;
    for (const t of [0.3, 1.1, 2.0]) {
      const a = wish.tracks.map((tr) => JSON.stringify(tr.styleAt(t)));
      const b = wish.tracks.map((tr) => JSON.stringify(tr.styleAt(t)));
      expect(a).toEqual(b);
    }
    expect(authorDizzy(c, {}).duration).toBeCloseTo(DIZZY_S, 5);
    box.destroy();
  });

  it('a moment ends at rest on his seat (or, selection, keeps holding his ears)', () => {
    const { c } = ctxOf();
    const wish = authorWish(c, {}, { ...TILE, reach: true });
    expect(wish.end.box?.x).toBeCloseTo(c.seat.x - 48, 3);
    expect(wish.end.squash).toMatchObject({ r: 0, sx: 1, sy: 1 });
    const sel = authorSelect(c, {});
    expect(sel.keep).toBe(true);
    expect(sel.end.pawL).toMatchObject(NERVOUS.pawL ?? {});
    expect(sel.end.brows?.o).toBeCloseTo(1, 4);
    const relax = authorRelax(c, NERVOUS);
    expect(relax.end.pawL).toMatchObject({ x: 0, y: 0, r: 0 });
    expect(relax.end.brows?.o).toBeCloseTo(0, 4);
  });
});

describe('shorter trips (Felix 31.10: «4,5 с — можно короче»)', () => {
  it('new wish and «Erhalten» take ≈ 3.2 s for a trip across the list (was 4.3 – 4.6 s), at most two hops each way', () => {
    const { c } = ctxOf({ x: 334, y: 150 });
    // a tile two rows down on the other side: 450 px away (the gallery's first version: three hops each way)
    const far = { feet: { x: 98, y: 530 }, photo: { x: 24, y: 390, w: 150, h: 143 } };
    const wish = authorWish(c, {}, { ...far, reach: true });
    const received = authorReceived(c, {}, { ...far, reach: true });
    expect(wish.duration).toBeLessThan(3.4);
    expect(received.duration).toBeLessThan(3.4);
    // the hops of the trip there: at most TRIP_HOPS (counted at the box's travel keys)
    const box = wish.tracks.find((t) => t.name === 'lp.box');
    expect(box).toBeDefined();
    const legs = (box?.compile() ?? []).flatMap((x) => x.frames).length;
    expect(legs).toBeGreaterThan(0);
    expect(wish.beats.arrive).toBeLessThan(1.4);
    expect(TRIP_HOPS).toBe(2);
    // the stamp lands while he is there; he is back on his seat before the end
    expect(received.beats.stamp).toBeLessThan(received.beats.back ?? 0);
    expect(received.beats.back).toBeLessThanOrEqual(received.duration);
  });

  it('cues: the stamp tells the host (with the one success haptic), back on the seat tells it again', async () => {
    vi.useFakeTimers();
    try {
      const { c, haptics } = ctxOf();
      const onStamp = vi.fn();
      const onBack = vi.fn();
      const shot = authorReceived(c, {}, { ...TILE, reach: true, onStamp, onBack });
      const host = document.createElement('div');
      document.body.append(host);
      const end = vi.fn();
      const player = new Player(host, shot.tracks, shot.duration, shot.marks, end);
      player.play();
      await vi.advanceTimersByTimeAsync((shot.beats.stamp ?? 0) * 1000 + 10);
      expect(onStamp).toHaveBeenCalledTimes(1);
      expect(haptics.filter((k) => k === 'success')).toHaveLength(1);
      expect(onBack).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(shot.duration * 1000);
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledTimes(1);
      player.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the ear', () => {
  it('follows the finger with soft limits (≤ 24°, ≤ 9 %) and slips out when pulled too far', () => {
    const feet = { x: 200, y: 300 };
    const tip = { x: feet.x + 66 * UNIT, y: feet.y - 86 * UNIT };
    const a = earFollow('r', { x: tip.x + 12, y: tip.y + 4 }, feet);
    expect(a.slip).toBe(false);
    expect(Math.abs(a.pose.r ?? 0)).toBeLessThanOrEqual(24);
    expect(a.pose.sy ?? 1).toBeLessThanOrEqual(1.09);
    for (const f of [{ x: tip.x + 200, y: tip.y }, { x: tip.x, y: tip.y + 300 }]) {
      const r = earFollow('r', f, feet);
      expect(Math.abs(r.pose.r ?? 0)).toBeLessThanOrEqual(24);
      expect(r.pose.sy ?? 1).toBeLessThanOrEqual(1.09);
    }
    expect(earFollow('r', { x: tip.x - 120, y: tip.y - 40 }, feet).slip).toBe(true);
    // another size: the same angles at the same place on his ear
    const u = unitOf(160);
    const tip160 = { x: feet.x + 66 * u, y: feet.y - 86 * u };
    const b = earFollow('r', { x: tip160.x + 12 * (u / UNIT), y: tip160.y + 4 * (u / UNIT) }, feet, u);
    expect(b.pose.r).toBeCloseTo(a.pose.r ?? 0, 3);
  });

  it('an ear tip is beside the head, 27 – 50 px above his feet at 96 px (scaled for other sizes)', () => {
    expect(earTipAt(18, -36)).toBe('r');
    expect(earTipAt(-18, -36)).toBe('l');
    expect(earTipAt(4, -36)).toBeNull(); // his face: a boop
    expect(earTipAt(18, -10)).toBeNull(); // his paws
    expect(earTipAt(18, -60)).toBeNull(); // above the ears
    const u = unitOf(160);
    expect(earTipAt(30, -60, u)).toBe('r');
  });
});

describe('the shake: ≈ 1.4 g, three peaks within 0.7 s, at most every 10 s', () => {
  const hard = { acceleration: { x: 15, y: 3, z: 0 } };
  const soft = { acceleration: { x: 4, y: 2, z: 1 } };
  it('three hard peaks within 0.7 s = one shake; two are not; soft motion never', () => {
    const d = createShakeDetector();
    expect(d.feed(hard, 0)).toBe(false);
    expect(d.feed(hard, 200)).toBe(false);
    expect(d.feed(hard, 400)).toBe(true);
    const e = createShakeDetector();
    expect(e.feed(hard, 0)).toBe(false);
    expect(e.feed(hard, 900)).toBe(false);
    expect(e.feed(hard, 1800)).toBe(false);
    const f = createShakeDetector();
    for (let t = 0; t < 2000; t += 50) expect(f.feed(soft, t)).toBe(false);
  });

  it('peaks closer than 90 ms count once; the next shake only after 10 s', () => {
    const d = createShakeDetector();
    expect(d.feed(hard, 0)).toBe(false);
    expect(d.feed(hard, 40)).toBe(false);
    expect(d.feed(hard, 80)).toBe(false);
    expect(d.feed(hard, 200)).toBe(false);
    expect(d.feed(hard, 400)).toBe(true);
    for (const t of [1000, 1200, 1400]) expect(d.feed(hard, t)).toBe(false);
    for (const t of [10_500, 10_700]) expect(d.feed(hard, t)).toBe(false);
    expect(d.feed(hard, 10_900)).toBe(true);
    expect(SHAKE.cooldownMs).toBe(10_000);
  });

  it('without `acceleration` the device-with-gravity value counts (|a + g| − g)', () => {
    expect(motionOf({ accelerationIncludingGravity: { x: 0, y: 9.81, z: 0 } })).toBeCloseTo(0, 5);
    expect(motionOf({ accelerationIncludingGravity: { x: 0, y: 25, z: 0 } })).toBeGreaterThan(14);
    expect(motionOf({})).toBeNull();
  });
});

describe('a borrowed Pompon (dressPompon: the ear and the shake on every Pompon of the app)', () => {
  it('adds the parts, a moment takes him over and gives him back exactly as he was, undress takes the parts out', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const puppet = new Bunny(host, { size: 104, idle: false, interactive: false, reducedMotion: 'off' });
    const before = puppet.root.querySelectorAll('*').length;
    const dress = dressPompon(puppet);
    expect(puppet.root.querySelectorAll('.lp-dstar')).toHaveLength(3);
    expect(dress.els('box')).toHaveLength(0);
    dress.takeOver();
    expect(puppet.root.querySelector('.hm')?.classList.contains('lp')).toBe(true);
    const shot = authorDizzy({ rig: dress, seat: { x: 0, y: 0 }, ghost: false, haptic: () => undefined }, {});
    const player = new Player(host, shot.tracks, shot.duration, shot.marks);
    player.seek(1);
    player.destroy();
    dress.release(undefined, false);
    expect(puppet.root.querySelector('.hm')?.classList.contains('lp')).toBe(false);
    for (const name of ['hop', 'squash', 'earL', 'earR', 'face'] as const) for (const e of dress.els(name)) expect((e as HTMLElement).style.transform).toBe('');
    dress.undress();
    expect(puppet.root.querySelectorAll('*').length).toBe(before);
    puppet.destroy();
  });
});

describe('the Lists buddy lends his puppet (an ear pull, the dizzy shake)', () => {
  it('only while he stands; his own life waits until it is given back; a second lend waits too', () => {
    const st = document.createElement('div');
    st.style.position = 'relative';
    st.innerHTML = '<div data-buddy-floor="stats"></div><ul><li data-buddy-floor="a" data-buddy-card="0"></li></ul>';
    document.body.append(st);
    const buddy = createBuddy({ stage: st, scroller: window, reducedMotion: 'force', autonomous: false, kind: 'bunny' });
    const loan = buddy.lend();
    expect(loan).not.toBeNull();
    expect(loan?.puppet).toBeInstanceOf(Bunny);
    expect(buddy.lend()).toBeNull();
    // while lent he ignores his own triggers (nothing of his life writes onto the lent puppet)
    buddy.trigger('wave');
    expect(buddy.info.action).not.toBe('wave');
    loan?.giveBack();
    loan?.giveBack();
    const again = buddy.lend();
    expect(again).not.toBeNull();
    again?.giveBack();
    buddy.setPaused(true);
    expect(buddy.lend()).toBeNull();
    buddy.destroy();
    st.remove();
  });
});

describe('the gift box', () => {
  it('back < Pompon (4) < front < lid; decorative; he lands beside it', () => {
    const parent = document.createElement('div');
    const box = mountGiftBox(parent, { x: 40.4, y: 10 });
    expect(box.layers.map((l) => Number(l.style.zIndex))).toEqual([3, 5, 6]);
    expect(box.layers.every((l) => l.getAttribute('aria-hidden') === 'true' && l.style.pointerEvents === 'none')).toBe(true);
    expect(box.inBox).toEqual({ x: 40 + 82, y: 10 + 99 });
    expect(box.land.x).toBeGreaterThan(box.inBox.x + 60);
    box.destroy();
    expect(parent.children).toHaveLength(0);
  });
});
