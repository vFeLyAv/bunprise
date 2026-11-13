import { afterEach, describe, expect, it } from 'vitest';
import { authorBasket, BASKET_W, BINKY, BODY_REACH, FRONT_REACH, turnPose } from '../demo/mitbringen/basket';
import { PRE } from '../demo/mitbringen/mock';
import { MitbringenScene, type SceneOptions } from '../demo/mitbringen/scene';
import type { FakeAnimation } from './setup';

// The Mitbringen moment (26.10, gallery-only prototype, demo/mitbringen/): «Корзинка» (Felix's pick) and the last
// free item (the same basket + one binky facing you). jsdom has no layout: the mock falls back to its nominal
// geometry (mock.ts measure()).

const scenes: MitbringenScene[] = [];
function scene(o: Partial<SceneOptions> & Pick<SceneOptions, 'variant'>): MitbringenScene {
  const s = new MitbringenScene(document.body, { theme: 'light', reduced: false, ...o });
  scenes.push(s);
  return s;
}
afterEach(() => {
  scenes.splice(0).forEach((s) => s.destroy());
  document.body.replaceChildren();
});

const num = (v: string | undefined, fallback = 1) => (v === undefined ? fallback : Number(v));
/** "translate(x, y) …" → x */
const tx = (transform: string | undefined) => Number(/translate\(([-\d.]+)px/.exec(transform ?? '')?.[1] ?? NaN);
/** "translate(x, y) …" → y */
const ty = (transform: string | undefined) => Number(/translate\([-\d.]+px, ([-\d.]+)px/.exec(transform ?? '')?.[1] ?? NaN);
/** "… rotate(r deg) …" → r */
const rot = (transform: string | undefined) => Number(/rotate\(([-\d.]+)deg/.exec(transform ?? '')?.[1] ?? 0);

function onlyTransformAndOpacity(s: MitbringenScene): void {
  expect(s.animations.length).toBeGreaterThan(0);
  for (const a of s.animations as unknown as FakeAnimation[]) {
    const iterations = a.effect.getTiming().iterations ?? 1;
    expect(Number.isFinite(iterations)).toBe(true);
    for (const key of a.effect.getKeyframes())
      for (const prop of Object.keys(key)) expect(['transform', 'opacity', 'offset', 'easing', 'composite']).toContain(prop);
  }
}

describe('«Корзинка» — the short carry with a basket', () => {
  it('is ≈ 2.6 s, finite, transform/opacity only, and seeks deterministically', () => {
    const s = scene({ variant: 'basket' });
    expect(s.duration).toBeGreaterThan(2.3);
    expect(s.duration).toBeLessThanOrEqual(2.8);
    onlyTransformAndOpacity(s);
    s.seek(1.1);
    const a = s.sample(1.1);
    s.seek(0);
    s.seek(1.1);
    expect(s.sample(1.1)).toEqual(a);
  });

  it('comes from behind the right edge at the claimed row and goes back behind it (never out of thin air)', () => {
    const s = scene({ variant: 'basket' });
    const b = s.basket!;
    const half = 80 * b.u; // the widest part (ears / cheeks), bunny units
    expect(b.start.x - half).toBeGreaterThanOrEqual(s.geo.W);
    expect(b.exit.x - half).toBeGreaterThanOrEqual(s.geo.W);
    expect(b.start.y).toBeGreaterThan(s.geo.claim.top);
    expect(b.start.y).toBeLessThanOrEqual(s.geo.claim.top + s.geo.claim.height);
    // standing on the card's top edge while it sets the basket down
    expect(b.stop.y).toBeCloseTo(s.geo.card.top + 1, 0);
    expect(b.goneAt).toBeLessThan(s.duration + PRE);
  });

  it('sets the basket down after the text: the bunny never covers the word it brings', () => {
    const s = scene({ variant: 'basket' });
    const b = s.basket!;
    const end = s.geo.you.left + s.geo.you.width;
    expect(b.drop.x - b.basket.w / 2).toBeGreaterThan(end);
    expect(b.drop.x).toBeCloseTo(end + BODY_REACH * b.u + 2, 5);
    expect(b.basket.w).toBeCloseTo(BASKET_W * b.u, 5);
    // stands on the line; the word appears as the basket melts, the basket is gone after
    const st = s.sample(b.landedAt - PRE + 0.3);
    expect(num(st['basket.travel']?.opacity)).toBe(1);
    expect(num(s.sample(b.meltedAt - PRE + 0.01)['basket.travel']?.opacity)).toBe(0);
    expect(num(s.sample(b.landedAt - PRE)['ui.word']?.opacity, 0)).toBe(0);
    expect(num(s.sample(b.meltedAt - PRE + 0.06)['ui.word']?.opacity, 0)).toBe(1);
    // the basket melts only after the bunny's first hop away has uncovered it
    expect(b.meltedAt).toBeGreaterThan(b.landedAt + 0.6);
  });

  it('turns round through the front with the approved quarter-turn values', () => {
    const s = scene({ variant: 'basket' });
    const l = turnPose('l');
    const r = turnPose('r');
    expect(l.tf).toEqual({ x: -13, sx: 0.88, sy: 1 });
    expect(r.tf).toEqual({ x: 13, sx: 0.88, sy: 1 });
    const t0 = s.sample(0)['bunny.turn.tf']?.transform;
    const t1 = s.sample(s.duration)['bunny.turn.tf']?.transform;
    expect(tx(t0)).toBe(-13);
    expect(tx(t1)).toBe(13);
    // exactly one tail shows at the start and at the end (the one behind the bunny)
    expect(num(s.sample(0)['bunny.tailR.o']?.opacity)).toBe(1);
    expect(num(s.sample(0)['bunny.tailL.o']?.opacity)).toBe(0);
    expect(num(s.sample(s.duration)['bunny.tailL.o']?.opacity)).toBe(1);
    expect(num(s.sample(s.duration)['bunny.tailR.o']?.opacity)).toBe(0);
  });

  it('authors from a plain plan too (the carry without the scene)', () => {
    const layer = document.createElement('div');
    document.body.append(layer);
    const show = authorBasket(layer, { W: 390, rowY: 400, ledge: 300, line: { end: 220, bottom: 288 }, at: 0 });
    expect(show.tracks.every((t) => Number.isFinite(t.end))).toBe(true);
    expect(show.goneAt).toBeGreaterThan(show.meltedAt - 0.5);
    expect(layer.querySelector('.item svg')).not.toBeNull();
    // the plain basket has no binky and never rolls the body
    expect(show.binky).toBeNull();
    expect(show.tracks.some((t) => t.name === 'bunny.body')).toBe(false);
  });

  it('reduced motion: no bunny — the item fades into "Du bringst" in 0.35 s', () => {
    const s = scene({ variant: 'basket', reduced: true });
    expect(s.basket).toBeNull();
    expect(s.refs.layer.childElementCount).toBe(0);
    expect(num(s.sample(0.05)['ui.word']?.opacity, 0)).toBe(0);
    expect(num(s.sample(0.4)['ui.word']?.opacity, 0)).toBe(1);
    expect(s.duration).toBeLessThan(0.8);
  });
});

describe('the last free item — the same basket, then ONE binky facing you', () => {
  it('is ≤ 3.2 s, finite, transform/opacity only, and seeks deterministically; the counter says "4 von 4"', () => {
    const s = scene({ variant: 'last' });
    expect(s.duration).toBeGreaterThan(2.6);
    expect(s.duration).toBeLessThanOrEqual(3.2);
    onlyTransformAndOpacity(s);
    expect(s.refs.q('prog-old').textContent).toBe('3 von 4 verteilt');
    expect(s.refs.q('prog-new').textContent).toBe('4 von 4 verteilt');
    const top = s.basket!.binky!.top - PRE;
    s.seek(top);
    const a = s.sample(top);
    s.seek(0);
    s.seek(top);
    expect(s.sample(top)).toEqual(a);
  });

  it('brings the basket like the basket moment: the same entrance and set-down, a little further on the line', () => {
    const b = scene({ variant: 'basket' }).basket!;
    const l = scene({ variant: 'last' }).basket!;
    expect(l.start).toEqual(b.start);
    expect(l.stop.y).toBe(b.stop.y);
    expect(l.drop.y).toBe(b.drop.y);
    expect(l.landedAt).toBeCloseTo(b.landedAt, 6);
    // the same first hop (out from behind the edge onto the list) …
    const [sb, sl] = scenes.slice(-2) as [MitbringenScene, MitbringenScene];
    for (const t of [-0.3, 0, 0.1, 0.2, 0.3]) {
      for (const name of ['bunny.frame', 'bunny.lift', 'basket.travel']) expect(sl.sample(t)[name]).toEqual(sb.sample(t)[name]);
    }
    // … and he sets it down (FRONT_REACH − BODY_REACH) units further on: facing you, the word is already there
    expect(l.drop.x - b.drop.x).toBeCloseTo((FRONT_REACH - BODY_REACH) * l.u, 6);
    expect(l.stop.x - b.stop.x).toBeCloseTo((FRONT_REACH - BODY_REACH) * l.u, 6);
  });

  it('your item first, then "everything is done": the basket melts and «, Kuchen» appears before the binky', () => {
    const s = scene({ variant: 'last' });
    const show = s.basket!;
    const b = show.binky!;
    const at = (name: string, t: number) => num(s.sample(t - PRE)[name]?.opacity, 0);
    // the basket melts into the line right after it lands, while he turns to you; gone before he takes off
    expect(show.meltedAt).toBeGreaterThan(show.landedAt);
    expect(show.meltedAt - show.landedAt).toBeLessThanOrEqual(0.45 + 1e-9);
    expect(show.meltedAt).toBeLessThan(b.up);
    expect(at('basket.travel', show.landedAt + 0.05)).toBe(1);
    for (const t of [b.up, b.top, b.end]) expect(at('basket.travel', t)).toBe(0);
    // «, Kuchen» comes in as it melts, the done line only with the binky (after the word has started and is ~there)
    expect(at('ui.word', show.landedAt)).toBe(0);
    expect(at('ui.word', show.meltedAt + 0.06)).toBe(1);
    const wordFrom = show.meltedAt - 0.3;
    expect(at('ui.done', wordFrom + 0.2)).toBe(0);
    expect(at('ui.word', b.up)).toBeGreaterThan(0.9);
    expect(at('ui.done', b.up)).toBe(0);
    // while the word is there and he stands by it facing you, his widest part (±81 units in the squash) clears it
    expect(show.stop.x - 81 * show.u).toBeGreaterThan(s.geo.you.left + s.geo.you.width);
  });

  it('the binky happens facing you, on the ledge where he set the basket down, between the set-down and the turn away', () => {
    const s = scene({ variant: 'last' });
    const show = s.basket!;
    const b = show.binky!;
    const m = (t: number) => t - PRE;
    // the order of the beats
    expect(b.front[0]).toBeGreaterThan(show.landedAt);
    expect(b.at).toBeGreaterThanOrEqual(b.front[0]);
    expect(b.up).toBeGreaterThan(b.at);
    expect(b.top).toBeGreaterThan(b.up);
    expect(b.down).toBeGreaterThan(b.top);
    expect(b.end).toBeGreaterThan(b.down);
    expect(b.front[1]).toBeGreaterThanOrEqual(b.end);
    expect(show.awayAt).toBeGreaterThan(b.front[1]);
    expect(b.end - b.at).toBeCloseTo(BINKY.s, 6);
    // facing you before and after the jump (the head only flicks a little in the air)
    for (const t of [b.front[0], b.at, b.end, b.front[1]]) expect(tx(s.sample(m(t))['bunny.turn.tf']?.transform)).toBe(0);
    for (let t = b.at; t <= b.end; t += 0.02) expect(Math.abs(tx(s.sample(m(t))['bunny.turn.tf']?.transform))).toBeLessThanOrEqual(13 * 0.45 + 1e-9);
    // on the spot: the feet stay where he set the basket down; only the lift takes him up — 40 units at the top
    const feet = s.sample(m(b.at))['bunny.frame']?.transform;
    for (const t of [b.up, b.top, b.down, b.end]) expect(s.sample(m(t))['bunny.frame']?.transform).toBe(feet);
    expect(ty(s.sample(m(b.at))['bunny.lift']?.transform)).toBe(0);
    expect(ty(s.sample(m(b.top))['bunny.lift']?.transform)).toBeCloseTo(-BINKY.h * show.u, 2);
    expect(ty(s.sample(m(b.down))['bunny.lift']?.transform)).toBe(0);
    // the binky roll of the approved jump: 14° at .48, −8° at .66, upright again on the landing
    const roll = (f: number) => rot(s.sample(m(b.at + f * BINKY.s))['bunny.body']?.transform);
    expect(roll(0.48)).toBeCloseTo(14, 5);
    expect(roll(0.66)).toBeCloseTo(-8, 5);
    expect(roll(0)).toBe(0);
    expect(roll(1)).toBe(0);
    // ears flung up and out in the air (the left lop ear turns out with +, the right one with −)
    expect(rot(s.sample(m(b.top))['bunny.earL']?.transform)).toBeGreaterThan(15);
    expect(rot(s.sample(m(b.top))['bunny.earR']?.transform)).toBeLessThan(-15);
    // eyes ^ ^ the whole time
    for (let t = b.front[0]; t <= b.end; t += 0.05) {
      expect(num(s.sample(m(t))['bunny.happy']?.opacity, 0)).toBe(1);
      expect(num(s.sample(m(t))['bunny.eyes']?.opacity)).toBe(0);
    }
  });

  it('"Alles ist verteilt. Danke!" appears as his feet leave the edge', () => {
    const s = scene({ variant: 'last' });
    const b = s.basket!.binky!;
    const done = (t: number) => num(s.sample(t - PRE)['ui.done']?.opacity, 0);
    expect(done(b.at)).toBe(0);
    expect(done(b.up)).toBe(0);
    expect(done(b.top)).toBeGreaterThan(0.5);
    expect(done(b.up + 0.36)).toBe(1);
  });

  it('then the quarter turn away and back behind the right edge', () => {
    const s = scene({ variant: 'last' });
    const show = s.basket!;
    const half = 80 * show.u;
    expect(show.exit.x - half).toBeGreaterThanOrEqual(s.geo.W);
    expect(show.goneAt).toBeLessThan(s.duration + PRE);
    const end = s.sample(s.duration);
    // the feet are at the exit (behind the edge), turned right, the left tail shows
    expect(tx(end['bunny.frame']?.transform)).toBeCloseTo(tx(s.sample(show.goneAt - PRE)['bunny.frame']?.transform), 6);
    expect(tx(end['bunny.turn.tf']?.transform)).toBe(13);
    expect(num(end['bunny.tailL.o']?.opacity)).toBe(1);
    expect(num(end['bunny.tailR.o']?.opacity)).toBe(0);
    expect(num(end['bunny.eyes']?.opacity)).toBe(1);
    // the line is calm by then: the word and the done line stay, the highlight is gone
    expect(num(end['ui.word']?.opacity, 0)).toBe(1);
    expect(num(end['ui.done']?.opacity, 0)).toBe(1);
    expect(num(end['ui.highlight']?.opacity, 0)).toBe(0);
  });

  it('reduced motion: no bunny — the item fades into "Du bringst", "Alles ist verteilt. Danke!" just appears', () => {
    const s = scene({ variant: 'last', reduced: true });
    expect(s.basket).toBeNull();
    expect(s.refs.layer.childElementCount).toBe(0);
    expect(num(s.sample(0)['ui.word']?.opacity, 0)).toBe(0);
    expect(num(s.sample(0)['ui.done']?.opacity, 0)).toBe(0);
    expect(num(s.sample(0.4)['ui.word']?.opacity, 0)).toBe(1);
    expect(num(s.sample(0.4)['ui.done']?.opacity, 0)).toBe(1);
    expect(s.duration).toBeLessThan(0.8);
  });
});

describe('the gallery phone', () => {
  it('the basket is not the last item: 3 → 4 von 5, no "Alles ist verteilt"', () => {
    const s = scene({ variant: 'basket' });
    expect(s.refs.q('prog-old').textContent).toBe('3 von 5 verteilt');
    expect(s.refs.q('prog-new').textContent).toBe('4 von 5 verteilt');
    expect(s.sample(s.duration)['ui.done']).toBeUndefined();
  });

  it('destroy() removes the phone and cancels every animation', () => {
    const s = scene({ variant: 'last' });
    const anims = [...s.animations] as unknown as FakeAnimation[];
    expect(anims.length).toBeGreaterThan(0);
    s.destroy();
    expect(document.body.querySelector('.mbx-phone')).toBeNull();
    expect(anims.every((a) => a.playState === 'idle')).toBe(true);
  });
});
