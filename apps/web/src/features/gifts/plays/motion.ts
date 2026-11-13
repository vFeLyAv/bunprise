/**
 * «Кубик» — the one motion moment of the "Brettspiele" screen (ported from the approved gallery prototype,
 * packages/mascot/demo/ideas/motion.ts): when the topic opens, a die rolls into the header from the right edge,
 * bounces three times (each contact shows another face), lands on a six; the three meeples on the board hop once,
 * startled; a small spark; meanwhile the idea cards rise into place one after the other. ≈ 1.7 s, only transform /
 * opacity, finite (no loops).
 *
 * Every moving part is ONE Track of the mascot timeline (@bunprise/mascot/timeline) — the same frame for the same t.
 * Reduced motion: no animation at all, the end pose is written inline (run.ts).
 */

import { Track } from '@bunprise/mascot/timeline';

/** The app's springs as CSS curves (apps/web/src/styles/tokens.css: the `linear()` fallbacks) + plain physics. */
export const EASE = {
  smooth: 'cubic-bezier(.2,.7,.3,1)',
  bouncy: 'cubic-bezier(.34,1.56,.64,1)',
  /** a thrown thing: rising slows down, falling speeds up */
  up: 'cubic-bezier(.2,.6,.4,1)',
  down: 'cubic-bezier(.6,0,.8,.4)',
  linear: 'linear',
} as const;

/** Seconds of the moment. */
export const BEATS = {
  /** the die is thrown in from beyond the header's right edge … */
  throwIn: 0,
  /** … and touches the board three times */
  contacts: [0.42, 0.7, 0.88] as const,
  /** at rest (a six) */
  rest: 1.02,
  /** the meeples hop, one after the other */
  hop: 0.9,
  /** the spark */
  spark: 1.04,
  /** the cards rise, one after the other */
  cards: 0.12,
  cardStep: 0.05,
  cardDur: 0.42,
  end: 1.7,
} as const;

/** The faces the die shows between contacts (before the 1st, … after the last = the six it lands on). */
export const FACES = [3, 5, 2, 6] as const;

function q(root: ParentNode, key: string): Element {
  const found = root.querySelector(`[data-k="${key}"]`);
  if (!found) throw new Error(`ideas motion: no [data-k="${key}"]`);
  return found;
}

/**
 * The tracks of the moment on one category screen (its header scene + its cards, `[data-k="card"]`).
 * Scene units: the die starts 150 units right of its rest place, 52 above it.
 */
export function openTracks(screen: ParentNode): Track[] {
  const tracks: Track[] = [];
  const [c1, c2, c3] = BEATS.contacts;

  // the die: x (linear, slowing at the end), y (three bounces), spin (≈ 1¼ turns, rolling to the left), shadow
  const x = new Track(q(screen, 'die-x'), 'die.x', { x: 150 });
  x.path(BEATS.throwIn, [
    [c1, { x: 64 }, EASE.linear],
    [c2, { x: 22 }, EASE.linear],
    [c3, { x: 5 }, 'cubic-bezier(.3,.6,.5,1)'],
    [BEATS.rest, { x: 0 }, EASE.smooth],
  ]);
  tracks.push(x);

  const y = new Track(q(screen, 'die-y'), 'die.y', { y: -52 });
  y.path(BEATS.throwIn, [
    [c1, { y: 0 }, EASE.down],
    [(c1 + c2) / 2, { y: -20 }, EASE.up],
    [c2, { y: 0 }, EASE.down],
    [(c2 + c3) / 2, { y: -6 }, EASE.up],
    [c3, { y: 0 }, EASE.down],
  ]);
  tracks.push(y);

  const spin = new Track(q(screen, 'die-spin'), 'die.spin', { r: 0, sx: 1, sy: 1 });
  spin.path(BEATS.throwIn, [
    [c1, { r: -250, sx: 1, sy: 1 }, EASE.linear],
    // a squash on the first contact (the die is soft only for a frame)
    [c1 + 0.05, { r: -268, sx: 1.08, sy: 0.92 }, EASE.linear],
    [c2, { r: -380, sx: 1, sy: 1 }, EASE.linear],
    [c3, { r: -435, sx: 1, sy: 1 }, 'cubic-bezier(.3,.6,.5,1)'],
    [BEATS.rest, { r: -450, sx: 1, sy: 1 }, EASE.bouncy],
  ]);
  tracks.push(spin);

  // the shadow: small and faint while the die is high, full when it touches
  const shadow = new Track(q(screen, 'die-shadow'), 'die.shadow', { sx: 0.45, sy: 0.45, o: 0.35 });
  shadow.path(BEATS.throwIn, [
    [c1, { sx: 1, sy: 1, o: 1 }, EASE.down],
    [(c1 + c2) / 2, { sx: 0.72, sy: 0.72, o: 0.6 }, EASE.up],
    [c2, { sx: 1, sy: 1, o: 1 }, EASE.down],
    [(c2 + c3) / 2, { sx: 0.9, sy: 0.9, o: 0.85 }, EASE.up],
    [c3, { sx: 1, sy: 1, o: 1 }, EASE.down],
  ]);
  tracks.push(shadow);

  // the faces: a switch at every contact (the die is mid-turn there, so the change reads as a roll)
  const contacts: readonly number[] = BEATS.contacts;
  FACES.forEach((face, i) => {
    const el = screen.querySelector(`[data-k="die-spin"] [data-face="${face}"]`);
    if (!el) return;
    const t = new Track(el, `die.face${face}`, { o: i === 0 ? 1 : 0 });
    const on = i === 0 ? null : contacts[i - 1];
    const off = contacts[i];
    if (on !== null && on !== undefined) t.set(on, { o: 1 });
    if (off !== undefined) t.set(off, { o: 0 });
    tracks.push(t);
  });

  // the meeples hop once, startled by the landing die (feet stay on the board: origin = the feet)
  for (let i = 0; i < 3; i++) {
    const el = screen.querySelector(`[data-k="meeple-${i}"]`);
    if (!el) continue;
    const t0 = BEATS.hop + i * 0.07;
    const m = new Track(el, `meeple${i}`, { y: 0, sx: 1, sy: 1 });
    m.path(t0, [
      [t0 + 0.06, { y: 0, sx: 1.1, sy: 0.88 }, EASE.smooth],
      [t0 + 0.2, { y: -9, sx: 0.94, sy: 1.08 }, EASE.up],
      [t0 + 0.34, { y: 0, sx: 1, sy: 1 }, EASE.down],
      [t0 + 0.4, { y: 0, sx: 1.07, sy: 0.92 }, EASE.linear],
      [t0 + 0.62, { y: 0, sx: 1, sy: 1 }, EASE.bouncy],
    ]);
    tracks.push(m);
  }

  // the spark beside the six: in with a bounce, then gone again
  const spark = new Track(q(screen, 'spark'), 'spark', { s: 0.2, o: 0, r: -30 });
  spark.path(BEATS.spark, [
    [BEATS.spark + 0.26, { s: 1, o: 1, r: 0 }, EASE.bouncy],
    [BEATS.end - 0.18, { s: 1, o: 1, r: 8 }, EASE.linear],
    [BEATS.end, { s: 0.6, o: 0, r: 14 }, EASE.smooth],
  ]);
  tracks.push(spark);

  // the cards rise into place (the first rows only differ in their start; filtered-out cards just do it unseen)
  screen.querySelectorAll('[data-k="card"]').forEach((el, i) => {
    const t0 = BEATS.cards + Math.min(i, 7) * BEATS.cardStep;
    const c = new Track(el, `card${i}`, { y: 16, o: 0 });
    c.move(t0, t0 + BEATS.cardDur, { y: 0, o: 1 }, EASE.smooth);
    tracks.push(c);
  });

  return tracks;
}
