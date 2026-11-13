/**
 * Episode 1 «Ein Wunsch rollt an» (26.10, GALLERY-ONLY storyboard) — the plot, panel by panel, drawn with the app's
 * puppets on the panel kit (kit.ts). Worked out with Codex (two rounds; docs/design/2026-10-26-manga-episode-1.md):
 *
 *   Pompon knows WHEN (his burrow has a door for every day, seven to a row like the app's calendar), Tapsi knows
 *   WHAT (he keeps the wishes; a chosen wish is swallowed = reserved, as in the app), and who gives what stays a
 *   secret for the one who wishes. One gag (the hiccup roll), heart (the "+1" on the invitation is for Tapsi).
 *
 * All names, dates and wishes are invented. Every text is real text (≤ 70 characters), German as in the app, with the
 * Russian translation for Felix. Panel 3 is the one that comes alive (1.6 s, transform / opacity only).
 */

import { EZ, PH, PW, type Panel } from './kit';
import {
  CAKE,
  CARD_FLAT,
  EMPTY_BOX,
  MOUTH_CARD,
  NIGHT,
  burrow,
  cheekGlow,
  dandelion,
  focusLines,
  ground,
  heart,
  rnd,
  sky,
  sparkle,
  tufts,
  wishStar,
  wishWithCan,
} from './props';
// The texts, the screen-reader sentences and the smooth-way helpers live in the package's comic module since 31.10
// (one source for the app's reader and this gallery; the texts there also have EN + UK)
import { ALT1, T } from '../../src/comic/texts';
import { onCubic, smoothPieces, type Pt } from '../../src/comic/util';
export { EPISODE_TITLE, T } from '../../src/comic/texts';
export { onCubic, smoothPieces } from '../../src/comic/util';
export type { Pt } from '../../src/comic/util';

export type Lang = 'de' | 'ru';

export interface PanelText {
  /** what it is, in Russian for Felix: плашка (narration box) / реплика / звук */
  kind: string;
  de: string;
  ru: string;
}

export interface PanelDef {
  n: number;
  /** a short Russian name for the contact sheet */
  title: string;
  texts: PanelText[];
  /** one sentence for screen readers (the reader's panel label) */
  alt: Record<Lang, string>;
  /** Russian: what to look at / why it is staged like this */
  note: string;
  /** the one panel that comes alive */
  alive?: boolean;
  build(panel: Panel, lang: Lang): void;
}

// ---- text in a panel (real text, drawn like a comic) ---------------------------------------------------------

const say = (t: PanelText, lang: Lang): string => (lang === 'ru' ? t.ru : t.de);

function box(p: Panel, text: string, style: string): HTMLElement {
  const e = p.node('', style, 'sp-box');
  e.textContent = text;
  return e;
}

/** A speech bubble; `tail` = where its tail sits along the bottom (or the top with `up`) and its turn. */
function bubble(p: Panel, text: string, style: string, tail: { x: string; r?: number; up?: boolean } = { x: '30%' }, cls = ''): HTMLElement {
  const e = p.node('', `${style};--tail-x:${tail.x};--tail-r:${tail.r ?? 45}deg`, `sp-bubble${tail.up ? ' up' : ''}${cls ? ` ${cls}` : ''}`);
  e.textContent = text;
  return e;
}

function sfx(p: Panel, text: string, style: string, r = -8): HTMLElement {
  const e = p.node('', `${style};--r:${r}deg`, 'sp-sfx');
  e.textContent = text;
  return e;
}

/** A small "?" thought bubble (language-neutral). */
function puzzled(p: Panel, x: number, y: number): void {
  const e = p.node('', `left:${x}px;top:${y}px;padding:4px 12px 6px;font-size:22px;font-weight:800;border-radius:50%`, 'sp-bubble');
  e.style.setProperty('--tail-x', '18%');
  e.textContent = '?';
}

// ---- the texts ----------------------------------------------------------------------------------------------

// ---- shared bits --------------------------------------------------------------------------------------------

/**
 * Mila's coat. 'broken' (white with ginger patches): the 'himalayan' of the concept read as a little ghost in the
 * night light (gallery check 26.10) — the patches give her a face and a shape on the dark page.
 */
const MILA = 'broken';

/** Small wish stars hanging in the night (other friends' wishes), deterministic. */
function floatingStars(p: Panel, spots: ReadonlyArray<readonly [number, number, number]>, z = 2): void {
  spots.forEach(([x, y, r], i) => p.prop(wishStar(r, true, `f${i}-${x}`), `${-r * 2.6} ${-r * 2.6} ${r * 5.2} ${r * 5.2}`, x, y, r * 5.2, r * 5.2, z));
}

/** The moss floor along the bottom (y = top of the moss). */
function moss(y: number, seed = 1): string {
  const d = `M0 ${PH} L0 ${y + 6} C${PW * 0.25} ${y - 4} ${PW * 0.6} ${y + 8} ${PW} ${y - 2} L${PW} ${PH} Z`;
  const pts = Array.from({ length: 14 }, (_, i) => [8 + i * 26 + rnd(i, seed) * 10, y + 8 + rnd(i, seed + 2) * 6] as const);
  return `${ground(d, NIGHT.moss)}${tufts(pts)}`;
}

/** A dizzy ring of three little sparkles above a head at (x, y). */
function dizzy(p: Panel, x: number, y: number): void {
  p.layer(`<ellipse cx="${x}" cy="${y}" rx="30" ry="8" fill="none" stroke="rgba(255,236,190,.45)" stroke-width="1.4" stroke-dasharray="3 4"/>
    ${[[-26, 2], [4, -7], [24, 4]].map(([dx = 0, dy = 0], i) => `<g transform="translate(${x + dx} ${y + dy}) rotate(${i * 20})">${sparkle(5.5 - i, '#FFE7A8')}</g>`).join('')}`, 6);
}

// ---- 1 · the burrow --------------------------------------------------------------------------------------------

function panel1(p: Panel, lang: Lang): void {
  const b = burrow(-24, 132, 408, 4, { lit: 14 });
  p.layer(`${sky({ moon: { x: 312, y: 52, r: 15 }, seed: 1 })}${b.markup}${moss(404, 1)}`, 0);
  // a cake in the glowing door 14: that's the day
  const d14 = b.doorAt(14);
  p.prop(`<g transform="scale(.9)">${CAKE}</g>`, '-12 -12 24 24', d14.x, d14.y + 3, 24, 24, 2);
  const pompon = p.actor('bunny', { x: 112, feetY: 440, size: 300, turn: 'r', label: 'pompon' });
  pompon.wear(MOUTH_CARD);
  pompon.lift.set(0, { r: 3 });
  p.prop(EMPTY_BOX, '-45 -60 100 66', 268, 412, 120, 79, 5);
  puzzled(p, 238, 318);
  box(p, say(T.p1, lang), 'left:12px;top:12px;max-width:214px');
}

// ---- 2 · Mila's wish -------------------------------------------------------------------------------------------

function panel2(p: Panel, lang: Lang): void {
  const far = `M0 300 C80 270 170 262 250 280 C300 290 340 286 360 280 L360 ${PH} L0 ${PH} Z`;
  const hill = `M0 ${PH} L0 402 C60 384 120 350 190 330 C240 316 290 314 360 330 L360 ${PH} Z`;
  p.layer(`${sky({ moon: { x: 300, y: 70, r: 18 }, seed: 2 })}${ground(far, NIGHT.far)}${ground(hill, NIGHT.near)}
    ${tufts([[30, 398], [96, 368], [160, 340], [318, 326], [344, 330]])}
    <g transform="translate(330 332)">${dandelion(46)}</g>`, 0);
  floatingStars(p, [[48, 200, 4.5], [118, 168, 3.5], [338, 196, 4], [292, 150, 3]]);
  const mila = p.actor('bunny', { x: 108, feetY: 364, size: 256, coat: MILA, ears: 'upright', turn: 'r', label: 'mila' });
  const tapsi = p.actor('hamster', { x: 264, feetY: 330, size: 236, turn: 'l', puff: 1.22, label: 'tapsi' });
  // Mila holds her wish out with both paws; Tapsi reaches for it with one
  mila.part('.paws', { y: -26 });
  mila.part('.paw-r', { x: 14, y: -4, r: -46 });
  mila.part('.paw-l', { x: 8, y: -2, r: -16 });
  mila.lift.set(0, { r: 6 });
  mila.puppet.setEyes('happy');
  tapsi.part('.paw-l', { x: -16, y: -28, r: 36 });
  tapsi.lift.set(0, { r: -4 });
  tapsi.hm().classList.add('perk');
  p.prop(wishWithCan(28, 'p2'), '-72 -72 144 144', 186, 258, 144, 144, 6);
  box(p, say(T.p2, lang), 'left:12px;top:12px;max-width:226px');
}

// ---- 3 · Hicks! (comes alive) ----------------------------------------------------------------------------------

/** The roll: where his feet are at each beat (panel px, on the slope) and when, with the spin so far. */
export const ROLL = {
  hic: 0.04,
  start: 0.34,
  end: 1.5,
  /** [time, feet x, feet y, spin degrees] */
  path: [
    [0.34, 78, 190, 0],
    [0.66, 142, 228, 85],
    [1.02, 204, 296, 235],
    [1.5, 258, 380, 400],
  ] as ReadonlyArray<readonly [number, number, number, number]>,
} as const;

const f1 = (v: number): string => v.toFixed(1);

function panel3(p: Panel, lang: Lang): void {
  const slope = `M0 ${PH} L0 194 C44 186 84 186 114 202 C170 234 214 304 250 366 C266 392 300 402 360 406 L360 ${PH} Z`;
  p.layer(`${sky({ moon: { x: 298, y: 66, r: 17 }, seed: 3 })}${ground(slope, NIGHT.near)}
    ${tufts([[18, 192], [52, 188], [182, 262], [282, 402], [334, 406]])}`, 0);
  const [first, ...rest] = ROLL.path;
  const [, x0 = 78, y0 = 190] = first ?? [];
  const tapsi = p.actor('hamster', { x: x0, feetY: y0, size: 228, puff: 1.5, z: 5, label: 'tapsi' });
  // the star stays in his paws all the way down (worn: it turns with him)
  tapsi.wear(`<g transform="translate(-30 -58)">${wishWithCan(21, 'p3', false)}</g>`);
  tapsi.part('.paw-l', { x: -8, y: -16, r: 28 });
  tapsi.part('.paw-r', { x: -4, y: -8, r: -18 });
  const eyes = tapsi.part('.eyes .eye', { sy: 1 }, true);
  const mouth = tapsi.part('.mouth', { o: 1 });
  const oh = tapsi.part('.mouth-open', { o: 0, s: 1 });

  // the trail along the way of his body's centre: a soft band (two strokes) and a dotted arc, in pieces that join
  // without a kink; each piece grows out of its start (scale about that point, on his own easing) while he rolls
  // along it, so the trail is only ever BEHIND him. Sparkles light up one after the other as he passes. The still
  // keeps all of it, so the roll reads without any motion.
  const lift = 84 * tapsi.unit;
  const pts = ROLL.path.map(([, x, y]) => [x, y - lift] as const);
  const pieces = smoothPieces(pts);
  const ease = [EZ.in, EZ.linear, EZ.out];
  pieces.forEach((piece, i) => {
    const [a, b, c, e] = piece;
    const d = `M${f1(a[0])} ${f1(a[1])} C${f1(b[0])} ${f1(b[1])} ${f1(c[0])} ${f1(c[1])} ${f1(e[0])} ${f1(e[1])}`;
    // butt ends between pieces (round ones overlapped: lighter blobs at the joints); where the trail starts, a
    // half-disc behind the start rounds it off (a round cap would round BOTH ends of the piece)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const half = (r: number, fill: string): string => i === 0
      ? `<path d="M${f1(a[0] - uy * r)} ${f1(a[1] + ux * r)} A${r} ${r} 0 0 1 ${f1(a[0] + uy * r)} ${f1(a[1] - ux * r)} Z" fill="${fill}"/>`
      : '';
    const band = p.layer(`<path d="${d}" fill="none" stroke="rgba(255,206,120,.13)" stroke-width="58"/>${half(29, 'rgba(255,206,120,.13)')}
      <path d="${d}" fill="none" stroke="rgba(255,214,140,.12)" stroke-width="26"/>${half(13, 'rgba(255,214,140,.12)')}
      <path d="${d}" fill="none" stroke="rgba(255,240,200,.55)" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="2 9" transform="translate(-8 -30)"/>`, 3);
    band.style.transformOrigin = `${f1(a[0])}px ${f1(a[1])}px`;
    const t0 = ROLL.path[i]?.[0] ?? ROLL.start;
    const t1 = ROLL.path[i + 1]?.[0] ?? ROLL.end;
    p.track(band, { o: 0, s: 0.02 }, `p3.trail${i}`).set(t0 + 0.02, { o: 1 }).move(t0 + 0.02, t1, { s: 1 }, ease[i] ?? EZ.linear);
  });
  rest.forEach(([t], i) => {
    const piece = pieces[i];
    if (!piece) return;
    const t0 = (ROLL.path[i]?.[0] ?? ROLL.start) + 0.06;
    // two or three sparkles on this piece, lighting up as he goes by
    const n = i === 0 ? 2 : 3;
    for (let j = 0; j < n; j++) {
      const k = (j + 0.5) / n;
      const [sx, sy] = onCubic(piece, k);
      const id = i * 3 + j;
      const off = (id % 2 ? -1 : 1) * (16 + rnd(id, 41) * 14);
      const at = t0 + (t - t0) * k;
      const r = 6 + rnd(id, 43) * 5;
      const s = p.prop(sparkle(r, id % 3 ? '#FFE7A8' : '#FFFFFF'), '-12 -12 24 24', sx + off * 0.5, sy - Math.abs(off), 24, 24, 4);
      p.track(s, { o: 0, s: 0.3, r: 0 }, `p3.spark${id}`)
        .move(at, at + 0.14, { o: 1, s: 1.2, r: 25 }, EZ.out)
        .move(at + 0.14, at + 0.42, { o: 0.85, s: 0.9, r: 40 }, EZ.out);
    }
  });
  // rolling arcs on his trailing side at the end: ")))" turned the way he came from
  const pe = pts[pts.length - 1] ?? [x0, y0];
  const pb = pts[pts.length - 2] ?? pe;
  const back = Math.atan2(pb[1] - pe[1], pb[0] - pe[0]);
  const arcs = [80, 92, 104].map((r, i) => {
    const span = 0.62 - i * 0.12;
    const at = (a: number) => `${(pe[0] + Math.cos(a) * r).toFixed(1)} ${(pe[1] + Math.sin(a) * r).toFixed(1)}`;
    return `<path d="M${at(back - span)} A${r} ${r} 0 0 1 ${at(back + span)}" fill="none" stroke="rgba(255,240,210,${(0.7 - i * 0.18).toFixed(2)})" stroke-width="${(3 - i * 0.6).toFixed(1)}" stroke-linecap="round"/>`;
  }).join('');
  const lines = p.layer(arcs, 4);
  p.track(lines, { o: 0 }, 'p3.arcs').move(1.16, 1.46, { o: 1 }, EZ.out);
  // his floor shadow belongs to standing, not to rolling (it would turn with him)
  tapsi.part('.shadow', { o: 1 }).move(ROLL.start, ROLL.start + 0.12, { o: 0 }, EZ.linear);

  // "Hicks!": pops up next to him at the top of the hill
  const hic = sfx(p, say(T.p3, lang), 'left:166px;top:70px', -10);
  p.track(hic, { o: 0, s: 0.4 }, 'p3.hic').move(ROLL.hic, ROLL.hic + 0.12, { o: 1, s: 1.18 }, EZ.out).move(ROLL.hic + 0.12, ROLL.hic + 0.34, { s: 1 }, EZ.bouncy);

  // the hiccup: the eyes squeeze, a squash and a little hop; then round eyes and an "oh!" mouth all the way down
  tapsi.squash.path(ROLL.hic, [[ROLL.hic + 0.07, { sx: 1.12, sy: 0.86 }, EZ.out], [ROLL.hic + 0.2, { sx: 0.94, sy: 1.08 }, EZ.out], [ROLL.start, { sx: 1, sy: 1 }, EZ.inOut]]);
  tapsi.lift.path(ROLL.hic + 0.07, [[ROLL.hic + 0.18, { y: -16, r: 6 }, EZ.out], [ROLL.start, { y: 0, r: 10 }, EZ.in]]);
  eyes.path(ROLL.hic, [[ROLL.hic + 0.06, { sy: 0.15 }, EZ.in], [ROLL.hic + 0.2, { sy: 1 }, EZ.out]]);
  mouth.set(ROLL.hic + 0.18, { o: 0 });
  oh.set(ROLL.hic + 0.18, { o: 1, s: 1.5 });
  tapsi.travel.path(ROLL.start, rest.map(([t, x, y], i) => [t, { x: x - x0, y: y - y0 }, ease[i]] as const));
  tapsi.spin.path(ROLL.start, rest.map(([t, , , r], i) => [t, { r }, ease[i]] as const));
  tapsi.lift.move(ROLL.start, ROLL.start + 0.2, { r: 0 }, EZ.out);
  // the moment comes to rest when the last sparkle has settled (a little after he stops): the still is that frame
  p.duration = p.end;
}

// ---- 4 · the landing (silent) ----------------------------------------------------------------------------------

function panel4(p: Panel): void {
  const b = burrow(-210, 150, 330, 3, { first: 1 });
  const slope = `M150 ${PH} C210 300 270 220 360 170 L360 ${PH} Z`;
  p.layer(`${sky({ seed: 4, stars: 16 })}${ground(slope, NIGHT.near)}${b.markup}${moss(392, 4)}`, 0);
  const pompon = p.actor('bunny', { x: 104, feetY: 436, size: 292, turn: 'r', label: 'pompon' });
  pompon.hm().classList.add('perk', 'm-round');
  pompon.lift.set(0, { r: 7 });
  const tapsi = p.actor('hamster', { x: 266, feetY: 440, size: 236, turn: 'l', puff: 1.3, eyes: 'sleep', label: 'tapsi' });
  tapsi.lift.set(0, { r: -9 });
  tapsi.wear(`<g transform="translate(-40 -52)">${wishWithCan(19, 'p4', false)}</g>`);
  tapsi.part('.paw-l', { x: -12, y: -12, r: 26 });
  dizzy(p, 270, 298);
  p.prop(CARD_FLAT, '-36 -24 72 48', 186, 418, 72, 48, 6).style.transform = 'rotate(-10deg)';
  // a few sparkles still settling from the roll
  [[318, 352], [338, 330], [300, 380]].forEach(([x = 0, y = 0], i) => p.prop(sparkle(5 - i), '-8 -8 16 16', x, y, 16, 16, 3));
}

// ---- 5 · the choice --------------------------------------------------------------------------------------------

function panel5(p: Panel, lang: Lang): void {
  p.layer(`<rect width="${PW}" height="${PH}" fill="#1D1612"/>
    <defs><radialGradient id="sp-p5"><stop offset="0" stop-color="rgba(255,190,110,.32)"/><stop offset="1" stop-color="rgba(255,190,110,0)"/></radialGradient></defs>
    <circle cx="206" cy="250" r="200" fill="url(#sp-p5)"/>${focusLines(206, 250, 130)}${moss(384, 5)}`, 0);
  const pompon = p.actor('bunny', { x: 108, feetY: 384, size: 420, turn: 'r', eyes: 'happy', label: 'pompon' });
  pompon.lift.set(0, { r: 16 });
  const tapsi = p.actor('hamster', { x: 308, feetY: 390, size: 350, turn: 'l', puff: 1.25, eyes: 'star', label: 'tapsi' });
  tapsi.lift.set(0, { r: -7 });
  tapsi.part('.paw-l', { x: -24, y: -30, r: 40 });
  // Mila's star rests against her invitation; Pompon's nose is right at it
  p.prop(CARD_FLAT, '-36 -24 72 48', 206, 380, 120, 80, 8).style.transform = 'rotate(6deg)';
  p.prop(wishWithCan(31, 'p5'), '-80 -80 160 160', 210, 262, 160, 160, 7);
  bubble(p, say(T.p5, lang), 'left:16px;top:22px;max-width:188px', { x: '62%', r: 30 });
}

// ---- 6 · the secret --------------------------------------------------------------------------------------------

function panel6(p: Panel, lang: Lang): void {
  const ridge = `M0 300 C70 290 150 268 230 252 C280 242 320 236 360 238 L360 ${PH} L0 ${PH} Z`;
  p.layer(`${sky({ moon: { x: 318, y: 120, r: 13 }, seed: 6 })}${ground(ridge, NIGHT.far)}${moss(398, 6)}`, 0);
  const mila = p.actor('bunny', { x: 300, feetY: 240, size: 118, coat: MILA, ears: 'upright', label: 'mila', z: 2 });
  mila.puppet.pose('wave');
  const pompon = p.actor('bunny', { x: 88, feetY: 444, size: 272, eyes: 'happy', label: 'pompon' });
  pompon.part('.face', { x: 2, y: -4 });
  pompon.lift.set(0, { r: -3 });
  const tapsi = p.actor('hamster', { x: 232, feetY: 446, size: 286, puff: 1.38, label: 'tapsi' });
  tapsi.psst();
  tapsi.wear(cheekGlow('p6'));
  tapsi.lift.set(0, { r: -2 });
  bubble(p, say(T.p6mila, lang), 'left:168px;top:150px;max-width:118px;font-size:13.5px;padding:6px 11px 7px', { x: '78%', r: 30 });
  bubble(p, say(T.p6psst, lang), 'left:292px;top:296px;font-size:14px;padding:5px 10px 6px', { x: '18%', r: 60 }, 'whisper');
  box(p, say(T.p6box, lang), 'left:12px;top:12px;max-width:200px');
}

// ---- 7 · Kommst du mit? -------------------------------------------------------------------------------------------

function panel7(p: Panel, lang: Lang): void {
  const b = burrow(-60, 112, 480, 3, { lit: 14, first: 8 });
  p.layer(`${sky({ seed: 7, stars: 14 })}${b.markup}${moss(400, 7)}`, 0);
  const d14 = b.doorAt(14);
  p.prop(`<g transform="scale(1.1)">${CAKE}</g>`, '-14 -14 28 28', d14.x, d14.y + 4, 28, 28, 2);
  const pompon = p.actor('bunny', { x: 104, feetY: 440, size: 292, turn: 'r', eyes: 'happy', label: 'pompon' });
  pompon.lift.set(0, { r: 11 });
  const tapsi = p.actor('hamster', { x: 270, feetY: 442, size: 250, turn: 'l', eyes: 'happy', puff: 1.3, label: 'tapsi' });
  tapsi.wear(cheekGlow('p7'));
  tapsi.lift.set(0, { r: -3 });
  // the "+1" invitation, nudged under Tapsi's nose
  p.prop(CARD_FLAT, '-36 -24 72 48', 198, 404, 86, 57, 6).style.transform = 'rotate(-12deg)';
  p.prop(heart(9), '-14 -14 28 28', 190, 250, 28, 28, 6);
  bubble(p, say(T.p7ask, lang), 'left:30px;top:226px', { x: '70%', r: 40 });
  box(p, say(T.p7box, lang), 'left:12px;top:12px;max-width:246px;font-size:17px');
}

// ---- the episode -----------------------------------------------------------------------------------------------

export const EPISODE: readonly PanelDef[] = [
  {
    n: 1,
    title: 'Нора с дверцами',
    texts: [T.p1],
    alt: ALT1[1],
    note: 'Дверцы — по 7 в ряд, как месяц в календаре приложения: Помпон знает, КОГДА. На приглашении — тортик, «14» и «+1» (это «+1» станет концовкой). Пустая коробка и «?» — он не знает, ЧТО.',
    build: panel1,
  },
  {
    n: 2,
    title: 'Желание Милы',
    texts: [T.p2],
    alt: ALT1[2],
    note: 'Мила (крольчиха-«броукен», белая с рыжими пятнами) сама отдаёт своё желание Тапси — как в приложении: тот, кто желает, вносит желание в список. Звезда пока снаружи: её ещё никто не выбрал. Вокруг — чужие желания-звёздочки.',
    build: panel2,
  },
  {
    n: 3,
    title: 'Ик! — и покатился',
    texts: [T.p3],
    alt: ALT1[3],
    note: 'Единственный гэг (твоя идея «он катился»). Одна кукла, повёрнутая, без копий-призраков (совет Codex): движение показывают дорожка искорок и линии скорости. Этот кадр «оживает»: 1,6 с, только сдвиг/поворот/прозрачность.',
    alive: true,
    build: panel3,
  },
  {
    n: 4,
    title: 'Приземлился',
    texts: [],
    alt: ALT1[4],
    note: 'Кадр без слов — пауза. Помпон уронил приглашение от удивления (ушки приподняты, круглые глаза). Звёздочки над головой Тапси — «голова кружится». Звезду он не выпустил.',
    build: panel4,
  },
  {
    n: 5,
    title: 'Выбор',
    texts: [T.p5],
    alt: ALT1[5],
    note: 'Помпон (даритель) выбирает подарок — звезда рядом с приглашением связывает желание и день. Крупный план и «линии фокуса» вместо поворота в профиль (куклы смотрят на нас).',
    build: panel5,
  },
  {
    n: 6,
    title: 'Тайна',
    texts: [T.p6box, T.p6mila, T.p6psst],
    alt: ALT1[6],
    note: 'Тапси «съел» звезду — как в приложении при брони. Мила знает про свой день рождения и своё желание, но НЕ знает, кто что дарит (это и есть тайна, а не «тайная вечеринка» — поправка Codex). Поза «Psst» — та же, что ты одобрил.',
    build: panel6,
  },
  {
    n: 7,
    title: 'Пойдёшь со мной?',
    texts: [T.p7ask, T.p7box],
    alt: ALT1[7],
    note: 'Сердце серии: «+1» из первого кадра — это Тапси. Звезда остаётся в щеке, не на дверце (дверца видна всем — совет Codex). Финальная строка — обещание приложения.',
    build: panel7,
  },
];
