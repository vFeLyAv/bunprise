/**
 * The promo film, scene by scene (docs/design/2026-10-25-promo-video-plan.md §3; storyboard: promo-storyboard.ts).
 * Times are seconds of the whole film. Here: the backdrop, scene 1 (hook) and scene 2 (occasion); scenes 3–6 in
 * scenes-b.ts. `film.cue(t, …)` = a sound at that moment (sound.ts); taps, confetti and hop landings cue their own.
 */
import { GIFT_BOX } from '../welcome-screens';
import { DROP, MOUTH_CARD, WORRIED } from '../promo-storyboard';
import { icon } from '../welcome-screens';
import { EZ, Film, actor, blinks, caption, confetti, happy, hop, look, tap } from './film';
import { buildFilmB } from './scenes-b';

/** Where an element sits on the stage (centre and size, px), measured before anything moves. */
function box(film: Film, el: HTMLElement): { x: number; y: number; w: number; h: number } {
  // offsets, not client rects: the preview may show the stage scaled (a transform on a wrapper)
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== film.root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2, w: el.offsetWidth, h: el.offsetHeight };
}

// ---- backdrop: the app's night page — warm charcoal with four dim colour fields that drift a little.
// Felix chose the dark variant 25.10 («оставляем только тёмную тему»; the light ones did not look like the app).

export type FilmTheme = 'dark';

const BACKDROP = {
  base: 'linear-gradient(180deg, #211914 0%, #1A1410 55%, #15100D 100%)',
  glows: [
    'radial-gradient(78% 36% at -4% -2%, rgba(255,150,84,.20) 0%, transparent 72%)',
    'radial-gradient(70% 34% at 104% 30%, rgba(232,118,124,.15) 0%, transparent 72%)',
    'radial-gradient(84% 34% at 4% 98%, rgba(236,172,82,.13) 0%, transparent 72%)',
    'radial-gradient(72% 30% at 102% 80%, rgba(150,132,226,.15) 0%, transparent 72%)',
  ],
  grain: 0.6,
};
const DRIFT = [{ dx: 14, dy: 10, p: 9 }, { dx: -12, dy: 14, p: 11 }, { dx: 12, dy: -12, p: 12 }, { dx: -14, dy: -8, p: 10 }];

/** The film's night backdrop (also used by the install clips, install.ts). */
export function backdrop(film: Film, until: number): void {
  film.root.style.backgroundImage = BACKDROP.base;
  BACKDROP.glows.forEach((g, i) => {
    const f = DRIFT[i] ?? { dx: 10, dy: 10, p: 10 };
    const el = film.node('', `left:-24px;top:-24px;right:-24px;bottom:-24px;background:${g};z-index:0`, 'pf');
    film.loop(el, 0, f.p, [[0, { x: 0, y: 0 }, EZ.inOut], [0.5, { x: f.dx, y: f.dy }, EZ.inOut], [1, { x: 0, y: 0 }]], Math.ceil(until / f.p));
  });
  // a very fine grain (the app's paper grain, kit.css) over the colour fields: keeps the video free of banding
  film.node('', `inset:0;background-image:var(--pf-grain);opacity:${BACKDROP.grain};z-index:1`, 'pf');
}

// ---- scene 1 · the hook (0 – 3.4 s): two identical gifts -------------------------------------------------

const BOX_BODY = GIFT_BOX.replace(/<g class="ws-lid">[\s\S]*?<\/g>\s*<\/g>$/, '</g>');
const LID = /<g class="ws-lid">[\s\S]*?<\/g>/.exec(GIFT_BOX)?.[0] ?? '';
const HEADPHONES = '<g transform="translate(-21 -100) scale(1.75)" class="pf-hp" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13.5" width="4.5" height="7" rx="2" fill="#6C8CFF"/><rect x="16.5" y="13.5" width="4.5" height="7" rx="2" fill="#6C8CFF"/></g>';
const GIFT_VIEW = 'viewBox="-45 -104 90 106" width="160" height="188"';

function gift(film: Film, cx: number, bottom: number, t: number, side: -1 | 1, exit: number): void {
  const wrap = film.node('', `left:${cx - 80}px;top:${bottom - 182}px;width:160px;height:188px;z-index:3`, 'pf');
  const sq = film.node('', 'position:absolute;inset:0;transform-origin:50% 96%', 'pf', wrap);
  const layer = (markup: string, origin = '50% 50%') => film.node(`<svg ${GIFT_VIEW} aria-hidden="true">${markup}</svg>`, `inset:0;transform-origin:${origin}`, 'pf', sq);
  const phones = layer(HEADPHONES, '50% 40%');
  layer(BOX_BODY);
  const lid = layer(LID, '50% 46%');
  // drops in from above, lands with a squash
  film.track(wrap, { y: -460 }).move(t, t + 0.5, { y: 0 }, 'cubic-bezier(.55,0,.85,.35)').move(exit, exit + 0.35, { y: 70, o: 0 }, EZ.in);
  film.track(sq, { sx: 1, sy: 1 }).path(t + 0.5, [[t + 0.58, { sx: 1.16, sy: 0.84 }, EZ.out], [t + 0.95, { sx: 1, sy: 1 }, EZ.bouncy]]);
  // the lid pops off and spins out of the picture, the headphones spring up
  const open = t + 0.75;
  film.track(lid, { x: 0, y: 0, r: 0 }).move(open, open + 0.55, { x: side * 150, y: -250, r: side * 200 }, EZ.out);
  film.track(phones, { o: 0, y: 34, s: 0.4 }).set(open, { o: 1 }).path(open, [[open + 0.28, { y: -16, s: 1.12 }, EZ.out], [open + 0.75, { y: 0, s: 1 }, EZ.bouncy]]);
  // the box lands, the lid pops (the same pop twice: the same gift twice), the lid flies off
  film.cue(t + 0.5, 'thump', { gain: 0.9, pitch: 0.9, pan: side * 0.4 });
  film.cue(open, 'pop', { pitch: 1, pan: side * 0.4 });
  film.cue(open + 0.03, 'whoosh', { gain: 0.45, pitch: 1.3, pan: side * 0.6, seed: side + 2 });
}

function sceneHook(film: Film): void {
  const exit = 3.05;
  caption(film, ['The same gift.'], null, 0.02, exit);
  caption(film, ['Twice?'], 'Anna’s birthday, last year …', 1.55, exit, { top: 85 });
  gift(film, 92, 412, 0.05, -1, exit);
  gift(film, 268, 412, 0.25, 1, exit + 0.05);
  const eq = film.node('<b class="pf-accent" style="font-size:32px">=</b>', 'left:171px;top:330px;z-index:3', 'pf');
  film.track(eq, { o: 0, s: 0.3 }).move(1.35, 1.75, { o: 1, s: 1 }, EZ.bouncy).move(exit, exit + 0.25, { o: 0 }, EZ.in);

  // Tapsi pops up from below, looks at one gift, at the other, gets worried, covers his eyes
  const tapsi = actor(film, 'hamster', 180, 585, 200);
  tapsi.travel.set(0, { y: 270 }).move(0.55, 1.0, { y: 0 }, EZ.out).move(exit + 0.05, exit + 0.4, { y: 280 }, EZ.in);
  tapsi.squash.path(0.95, [[1.02, { sx: 1.12, sy: 0.88 }, EZ.out], [1.35, { sx: 1, sy: 1 }, EZ.bouncy]]);
  look(tapsi, 1.15, -6, 1);
  look(tapsi, 1.55, 6, 1);
  tapsi.face.move(1.95, 2.15, { x: 0, y: 0 }, EZ.inOut);
  blinks(tapsi, [1.42, 1.85]);
  const brows = tapsi.wear(WORRIED);
  film.track(brows, { o: 0 }).move(1.95, 2.1, { o: 1 }, EZ.out);
  film.track(tapsi.part('.pout'), { o: 0 }).set(1.98, { o: 1 });
  film.track(tapsi.part('.mouth'), { o: 1 }).set(1.98, { o: 0 });
  const dropAt = tapsi.at(64, -128);
  const drop = film.node(DROP, `left:${dropAt.x - 9}px;top:${dropAt.y - 12}px;z-index:5`, 'pf');
  film.track(drop, { o: 0, y: -8, s: 0.6 }).move(2.0, 2.2, { o: 1, y: 0, s: 1 }, EZ.out).move(2.2, 2.95, { y: 16 }, EZ.in).move(2.95, 3.1, { o: 0 }, EZ.linear);
  // paws up to the eyes ("I can't look"), a little shiver
  tapsi.pawL.move(2.3, 2.5, { x: -15, y: -50, r: -10 }, EZ.out);
  tapsi.pawR.move(2.34, 2.54, { x: 15, y: -50, r: 10 }, EZ.out);
  tapsi.lift.path(2.5, [[2.58, { r: 2 }], [2.66, { r: -2 }], [2.74, { r: 2 }], [2.82, { r: -1.5 }], [2.9, { r: 0 }]]);
  tapsi.cheeks.move(2.3, 2.6, { s: 1.12 }, EZ.bouncy);
  // sound: "=", Tapsi pops up and lands, "oh no", the drop, paws up, everything leaves
  film.cue(1.35, 'pop', { pitch: 0.75, gain: 0.5 });
  film.cue(0.55, 'whoosh', { gain: 0.35, pitch: 0.8, seed: 3 });
  film.cue(1.0, 'thump', { gain: 0.4, pitch: 1.25 });
  film.cue(1.98, 'oops', {});
  film.cue(2.02, 'pop', { pitch: 2.3, gain: 0.25, pan: 0.3 });
  film.cue(2.3, 'swish', { gain: 0.5 });
  film.cue(exit, 'whoosh', { gain: 0.55, seed: 4 });
}

// ---- scene 2 · the occasion (3.4 – 10 s): a tap, a card, Pompon carries it to the 14th -------------------

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function sceneOccasion(film: Film): void {
  const t0 = 3.4;
  const exit = 9.55;
  caption(film, ['Plan the occasion', 'in seconds.'], null, t0 + 0.05, exit);

  // the phone: March 2027 (the 1st is a Monday), a "New occasion" row
  const phone = film.node(`<div class="ps-bar"></div><div class="ps-ph"><h4>March</h4>
    <div class="ps-card ps-cal"><b>2027</b><div class="ps-days">${DAYS.map((d) => `<i class="hd">${d}</i>`).join('')}
      ${Array.from({ length: 31 }, (_, i) => `<i data-day="${i + 1}">${i + 1}</i>`).join('')}</div></div>
    <div class="pf-slot"><div class="ps-card ps-occ pf-new"><i>${icon('plus')}</i><b>New occasion</b></div>
      <div class="ps-card ps-occ pf-event"><i>${icon('cake')}</i><b>Anna’s birthday<small>Sun, 14 March</small></b></div></div></div>`,
  'left:34px;top:178px', 'ps-phone');
  const day = phone.querySelector('[data-day="14"]') as HTMLElement;
  const newRow = phone.querySelector('.pf-new') as HTMLElement;
  const eventRow = phone.querySelector('.pf-event') as HTMLElement;
  const dayAt = box(film, day);
  const rowAt = box(film, newRow);

  film.track(phone, { y: 520 }).move(t0 + 0.1, t0 + 0.75, { y: 0 }, EZ.smooth).move(exit + 0.05, exit + 0.45, { y: 540 }, EZ.in);

  // tap "New occasion": the row presses, a card grows out of it
  const tapAt = t0 + 1.15;
  tap(film, rowAt.x - 40, rowAt.y, tapAt);
  const newRowTrack = film.track(newRow, { s: 1, o: 1, y: 0 });
  newRowTrack.path(tapAt, [[tapAt + 0.08, { s: 0.95 }, EZ.out], [tapAt + 0.45, { s: 1 }, EZ.bouncy]]);

  // Pompon gallops in from the right with two hops
  const pompon = actor(film, 'bunny', 270, 600, 210);
  pompon.travel.set(0, { x: 260 });
  hop(pompon, t0 + 1.05, -130, 0, { h: 38, d: 0.44 });
  hop(pompon, t0 + 1.55, -130, 0, { h: 30, d: 0.42 });
  blinks(pompon, [t0 + 2.2, 9.3]);

  // the new card: grows from the row, sails to Pompon's mouth, he catches it
  const mouthAt = pompon.at(7, -56);
  const k = 1.2 * (210 / 400); // px per puppet unit
  const card = film.node(`<svg viewBox="-36 -2 72 48" width="${72 * k}" height="${48 * k}" aria-hidden="true">${MOUTH_CARD.replace('<g transform="translate(4 -78) rotate(-8)">', '<g>')}</svg>`,
    `left:${-36 * k}px;top:${-24 * k}px;z-index:6`, 'pf');
  const grown = 2.4;
  const fly0 = tapAt + 0.35;
  const cardTrack = film.track(card, { o: 0, x: rowAt.x, y: rowAt.y, s: 0.6, r: 0 })
    .set(tapAt + 0.12, { o: 1 })
    .move(tapAt + 0.12, fly0, { s: grown, y: rowAt.y - 34 }, EZ.bouncy)
    .path(fly0 + 0.25, [
      [fly0 + 0.6, { x: (rowAt.x + mouthAt.x) / 2 + 20, y: rowAt.y - 120, s: 2, r: 6 }, EZ.out],
      [fly0 + 0.95, { x: mouthAt.x, y: mouthAt.y, s: 1, r: -8 }, EZ.in],
    ])
    .set(fly0 + 0.96, { o: 0 });
  const held = pompon.wear(MOUTH_CARD);
  const catchAt = fly0 + 0.96;
  const heldTrack = film.track(held, { o: 0 }).set(catchAt, { o: 1 });
  pompon.squash.path(catchAt, [[catchAt + 0.07, { sx: 1.06, sy: 0.94 }, EZ.out], [catchAt + 0.4, { sx: 1, sy: 1 }, EZ.bouncy]]);
  happy(pompon, [[catchAt + 0.05, catchAt + 0.75]]);
  pompon.earL.path(catchAt, [[catchAt + 0.12, { r: -10 }, EZ.out], [catchAt + 0.5, { r: 0 }, EZ.bouncy]]);
  pompon.earR.path(catchAt, [[catchAt + 0.12, { r: 10 }, EZ.out], [catchAt + 0.5, { r: 0 }, EZ.bouncy]]);

  // up onto the phone, next to the calendar, and the card goes onto the 14th
  const up = catchAt + 0.75;
  hop(pompon, up, -46, -112, { h: 44, d: 0.5 });
  const throwAt = up + 0.75;
  const mouthUp = { x: mouthAt.x - 46, y: mouthAt.y - 112 };
  heldTrack.set(throwAt, { o: 0 });
  pompon.lift.path(throwAt - 0.18, [[throwAt - 0.02, { r: 8 }, EZ.out], [throwAt + 0.14, { r: -10 }, EZ.out], [throwAt + 0.5, { r: 0 }, EZ.bouncy]]);
  cardTrack.set(throwAt, { o: 1, x: mouthUp.x, y: mouthUp.y, s: 1, r: -8 }).path(throwAt, [
    [throwAt + 0.22, { x: (mouthUp.x + dayAt.x) / 2, y: Math.min(mouthUp.y, dayAt.y) - 50, s: 0.9, r: -40 }, EZ.out],
    [throwAt + 0.45, { x: dayAt.x, y: dayAt.y, s: 0.35, r: -70 }, EZ.in],
  ]).set(throwAt + 0.46, { o: 0 });
  // the 14th lights up
  const lit = throwAt + 0.46;
  const mark = film.node('', `left:${dayAt.x - dayAt.w / 2}px;top:${dayAt.y - dayAt.h / 2}px;width:${dayAt.w}px;height:${dayAt.h}px;border-radius:7px;background:#F0A04B;box-shadow:0 0 0 3px rgba(240,160,75,.3);z-index:3;display:grid;place-items:center;font-size:10px;font-weight:800;color:#2A1A0B`, 'pf');
  mark.textContent = '14';
  film.track(mark, { o: 0, s: 1.9 }).move(lit, lit + 0.45, { o: 1, s: 1 }, EZ.bouncy).move(exit + 0.05, exit + 0.45, { y: 540 }, EZ.in);
  const ring = film.node('', `left:${dayAt.x - 16}px;top:${dayAt.y - 16}px;width:32px;height:32px;border-radius:50%;box-shadow:inset 0 0 0 2.5px #F0A04B;z-index:3`, 'pf');
  film.track(ring, { o: 0, s: 0.5 }).set(lit, { o: 1 }).move(lit, lit + 0.6, { o: 0, s: 2.4 }, EZ.out);
  confetti(film, dayAt.x, dayAt.y, lit + 0.02, 10, 0.55);

  // back down; the occasion is in the list
  const down = lit + 0.35;
  hop(pompon, down, 56, 112, { h: 40, d: 0.48 });
  happy(pompon, [[lit, lit + 1.4]]);
  const shown = down + 0.4;
  newRowTrack.move(shown, shown + 0.3, { o: 0, y: 10, s: 0.96 }, EZ.in);
  film.track(eventRow, { o: 0, y: -14, s: 0.9 }).move(shown + 0.15, shown + 0.65, { o: 1, y: 0, s: 1 }, EZ.bouncy);
  // a look at the viewer, then off to the right
  look(pompon, shown + 0.2, 0, 3, exit - 0.15);
  hop(pompon, exit, 150, 0, { h: 36, d: 0.45 });
  pompon.travel.move(exit + 0.45, exit + 0.46, { o: 0 }, EZ.linear);
  // sound: the phone slides up, the card grows and sails, the catch, the throw, the 14th rings, the row appears
  film.cue(t0 + 0.1, 'whoosh', { gain: 0.45, pitch: 0.9, seed: 5 });
  film.cue(tapAt + 0.12, 'pop', { pitch: 1.15 });
  film.cue(fly0 + 0.25, 'whoosh', { gain: 0.35, pitch: 1.2, pan: 0.3, seed: 6 });
  film.cue(catchAt, 'pop', { pitch: 0.8, gain: 0.8, pan: 0.4 });
  film.cue(throwAt, 'whoosh', { gain: 0.45, pitch: 1.4, pan: 0.1, seed: 7 });
  film.cue(lit, 'chime', { pitch: 1 });
  film.cue(shown + 0.15, 'chime', { pitch: 1.5, gain: 0.5 });
  film.cue(exit + 0.05, 'whoosh', { gain: 0.45, pitch: 0.8, seed: 8 });
}

/** The whole main film: backdrop + scenes 1–2 (here) and 3–6 (scenes-b.ts). */
export function buildFilm(film: Film): void {
  const length = 36.2;
  backdrop(film, length);
  sceneHook(film);
  sceneOccasion(film);
  buildFilmB(film);
  film.duration = length;
}

