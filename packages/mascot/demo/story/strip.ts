/**
 * Episode 1 «Ein Wunsch rollt an», v2 (30.10, GALLERY-ONLY): ONE continuous vertical picture (a webtoon) instead of
 * seven framed panels — Felix 30.10: «Мангу я представлял себе как именно слитную картинку, которая листается».
 * Same story beats and texts as v1 (panels.ts T), drawn with the app's puppets on the kit (kit.ts), in one world of
 * W × H px that the page scales as a whole. The places flow into each other, top to bottom:
 *
 *   night sky + title → Pompon at his burrow (a door per day, 14 glows) → the sky full of wishes → the hilltop
 *   (Mila hands her star to Tapsi) → the slope runs down the strip, Tapsi rolls → the moss at the burrow (landing)
 *   → close-up (the choice) → the secret (Mila waves from a far ridge, «Psst») → door 14 («Kommst du mit?») → end.
 *
 * Timelines (all transform / opacity only, all Tracks of src/timeline.ts):
 *   'roll'     — scroll-linked: the reader's scroll position IS the time (rollProgress()), Tapsi's hiccup and roll;
 *   moments    — four small ones that come alive once when they come into view (≤ 2 s each);
 *   ''         — still poses.
 * Reduced motion: no timeline runs; the roll is told by three still Tapsis (on the hilltop, mid-slope, landed),
 * every moment shows its end — the whole story readable as one still picture.
 */

import type { Track } from '../../src/timeline';
// Beat / Strip, the roll's keys and the reading line, the title texts and Mila's hand-over pose live in the package's
// comic module since 31.10 (one source for the app's reader and this gallery); re-exported for the v2 / v3 pages
import { Beat, type Strip } from '../../src/comic/beat';
import { handover } from '../../src/comic/episode1';
import { STRIP_TEXT } from '../../src/comic/texts';
import { type RollKey, rollKeysFor } from '../../src/comic/util';
import { type Actor, EZ, Panel } from './kit';
export { Beat } from '../../src/comic/beat';
export type { Strip } from '../../src/comic/beat';
export { handover } from '../../src/comic/episode1';
export { STRIP_TEXT } from '../../src/comic/texts';
export { READ_AT, readLineY, rollKeysFor } from '../../src/comic/util';
export type { RollKey } from '../../src/comic/util';
import { EPISODE, EPISODE_TITLE, T, type Lang, type PanelText, type Pt } from './panels';
import { CAKE, CARD_FLAT, NIGHT, burrow, heart, wateringCan } from './props';
import {
  blossom,
  cheekSparks,
  cheekStar,
  dizzyRing,
  waveMarks,
  fadeBand,
  focusRays,
  foreMound,
  glitter,
  halo,
  hill,
  mossFloor,
  moon,
  nightSky,
  sampleWay,
  skyWish,
  speedArcs,
  starOnly,
  thought,
  wayPieces,
} from './strip-art';
import { FX_REGIONS, FX_SCENES, handoverFx, rollFx, sceneFx } from './strip-fx';

/** The strip's world: phone width; the page scales it as a whole (wider on a desktop). */
export const W = 390;
export const H = 3830;

/** Every text in the strip, in reading order (tests: ≤ 70 characters, German and Russian). */
export const STRIP_TEXTS: readonly PanelText[] = [
  STRIP_TEXT.folge, T.p1, T.p2, T.p3, T.p5, T.p6box, T.p6mila, T.p6psst, T.p7ask, T.p7box,
  { kind: 'конец', de: EPISODE_TITLE.end.de, ru: EPISODE_TITLE.end.ru }, STRIP_TEXT.end,
];

const say = (t: PanelText, lang: Lang): string => (lang === 'ru' ? t.ru : t.de);

// ---- the roll: scroll position → time -----------------------------------------------------------------------------

/**
 * The roll is the scroll. Time 0 … 1 of the 'roll' timeline follows the READING LINE (the world y at the reader's
 * eye line, READ_AT of the viewport height from its top) while it passes y0 → y1. A pure function of that line:
 * the same scroll offset (same viewport) always gives the same frame.
 */
export const ROLL2 = {
  y0: 1236,
  y1: 1980,
  /** the hiccup, the start and the end of the roll down the slope, on the 0 … 1 timeline */
  hic: 0.07,
  start: 0.16,
  end: 0.93,
  /** where the still (reduced) strip shows him mid-slope */
  mid: 0.5,
} as const;

export function rollProgress(readY: number): number {
  const p = (readY - ROLL2.y0) / (ROLL2.y1 - ROLL2.y0);
  return Math.min(1, Math.max(0, p));
}

/** The roll's waypoints: Tapsi's feet, from the hilltop down the S of the slope to the moss in front of Pompon. */
const WAY: readonly Pt[] = [[268, 1190], [334, 1292], [302, 1410], [176, 1500], [92, 1620], [124, 1742], [262, 1836], [326, 1936], [262, 2050]];
const PIECES = wayPieces(WAY);
const ROAD = sampleWay(PIECES, 4);

export const ROLL_KEYS: readonly RollKey[] = rollKeysFor(ROAD, ROLL2.start, ROLL2.end);

// ---- small helpers -----------------------------------------------------------------------------------------------

function box(s: Panel, text: string, style: string): HTMLElement {
  const e = s.node('', style, 'sp-box');
  e.textContent = text;
  return e;
}

function bubble(s: Panel, text: string, style: string, tail: { x: string; r?: number; up?: boolean } = { x: '30%' }, cls = ''): HTMLElement {
  const e = s.node('', `${style};--tail-x:${tail.x};--tail-r:${tail.r ?? 45}deg`, `sp-bubble${tail.up ? ' up' : ''}${cls ? ` ${cls}` : ''}`);
  e.textContent = text;
  return e;
}

/** A sentence for screen readers, in story order (the picture itself is decoration). */
function told(s: Panel, text: string, y: number): void {
  const e = s.node('', `left:0;top:${y}px;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)`, 'sp2-sr');
  e.textContent = text;
}

/** A thin ink contour around a puppet (src/mascot.ts --mascot-outline): it keeps its shape on the night page. */
export function ink(a: Actor, color = 'rgba(48,30,18,.6)'): Actor {
  a.box.style.setProperty('--mascot-outline', color);
  a.box.style.setProperty('--mascot-outline-width', '1.4px');
  return a;
}

/** Mila: our approved lop-eared bunny, coat 'broken' (white with ginger patches) + a small pink blossom on her ear. */
export function mila(s: Panel, x: number, feetY: number, size: number, turn: 'l' | 'r', z = 6): Actor {
  const m = ink(s.actor('bunny', { x, feetY, size, coat: 'broken', ears: 'lop', turn, z, label: `mila-${Math.round(feetY)}` }));
  m.wearOn('.lop .te-l .ear-l', blossom(-34, -152, 10.5));
  // her own face: the coat's two muzzle spots off (at this size they read as a full mouth), the eye patch stays
  m.part('.tpatch ellipse', { o: 0 }, true);
  return m;
}

/** Mila's wish: the star with the watering can in it (crisp, no halo), centred on (0, 0). */
export function wishCan(r: number): string {
  return `${starOnly(r)}<g transform="translate(0 ${(r * 0.08).toFixed(2)})">${wateringCan(r * 0.42)}</g>`;
}

const alt = (n: number, lang: Lang): string => EPISODE.find((d) => d.n === n)?.alt[lang] ?? '';

// ---- the whole strip ---------------------------------------------------------------------------------------------

/**
 * Builds the strip into `root`. `motion` = false: reduced (everything still). With motion the roll waits at
 * time 0 and every moment at its start until the page drives them.
 */
export function buildStrip(root: HTMLElement, lang: Lang, motion: boolean): Strip {
  const s = new Panel(root, { w: W, h: H });
  root.classList.add('sp2-world');
  const regions: Record<string, { y0: number; y1: number }> = {
    still: { y0: 0, y1: H },
    thought: { y0: 120, y1: 560 },
    choice: { y0: 2200, y1: 2640 },
    wave: { y0: 2770, y1: 3200 },
    invite: { y0: 3330, y1: 3720 },
  };

  // ---- the background: one night for the whole strip, the places flowing into each other -------------------------
  const b1 = burrow(-20, 196, 430, 4, { lit: 14 });
  const b4 = burrow(-132, 1888, 364, 2, { first: 15 });
  const b7 = burrow(-44, 3394, 422, 2, { lit: 14, first: 8 });
  const summit = 'M-10 1238 C18 1210 52 1194 104 1191 C166 1187 244 1186 300 1190 C344 1194 372 1216 400 1252';
  s.layer(`${nightSky(W, H, [{ y: 260, warm: true }, { y: 900, x: W - 20, r: 300 }, { y: 1500, warm: true, x: 20 }, { y: 2900, x: W - 40 }, { y: 3420, warm: true, x: 360, r: 220 }])}
    ${moon(334, 66, 18)}
    ${b1.markup}${mossFloor(W, 466, 540, 120, 1)}
    ${hill(W, summit, 2120, ROAD, 1190, 2050)}
    ${b4.markup}${mossFloor(W, 2016, 2104, 110, 4)}
    <rect x="-10" y="2196" width="${W + 20}" height="460" fill="#1C1511"/>${fadeBand(W, 2108, 2198, '#1C1511', 'cu-in', true)}
    <defs><radialGradient id="sp2-cu"><stop offset="0" stop-color="rgba(255,190,110,.34)"/><stop offset="1" stop-color="rgba(255,190,110,0)"/></radialGradient></defs>
    <circle cx="196" cy="2520" r="230" fill="url(#sp2-cu)"/>
    ${fadeBand(W, 2656, 2740, '#1C1511', 'cu-out')}
    <path d="M-10 3010 C60 2992 150 2948 220 2912 C268 2888 318 2876 400 2876 L400 3220 L-10 3220 Z" fill="${NIGHT.far}"/>
    <path d="M-10 3010 C60 2992 150 2948 220 2912 C268 2888 318 2876 400 2876" fill="none" stroke="rgba(255,226,170,.2)" stroke-width="1.6"/>
    ${mossFloor(W, 3128, 3214, 100, 6)}
    ${b7.markup}${mossFloor(W, 3540, 3700, 110, 7)}`, 0);
  // the other friends' wishes, hanging in the sky over the hill (still)
  ([[40, 668, 4], [352, 700, 5], [292, 790, 3.5], [74, 830, 7], [196, 812, 3], [330, 874, 8], [140, 904, 4.5], [240, 862, 5.5], [30, 946, 5], [372, 970, 4], [100, 1000, 3.5], [196, 950, 7.5], [290, 940, 3], [52, 1078, 4.5], [362, 1052, 3.5], [176, 1040, 3], [140, 1094, 2.5]] as const)
    .forEach(([x, y, r], i) => s.prop(skyWish(r, `w${i}`), `${-r * 2.6} ${-r * 2.6} ${r * 5.2} ${r * 5.2}`, x, y, r * 5.2, r * 5.2, 2));
  // cakes in the lit doors 14
  for (const b of [b1, b7]) {
    const d = b.doorAt(14);
    s.prop(`<g transform="scale(.95)">${CAKE}</g>`, '-12 -12 24 24', d.x, d.y + 3, 24, 24, 2);
  }

  const beats: Beat[] = [];
  const scoped = (name: string, build: () => void): Track[] => {
    s.scope = name;
    build();
    s.scope = '';
    return s.tracksIn(name);
  };

  // ---- title ------------------------------------------------------------------------------------------------------
  const title = s.node('', 'left:0;top:24px;width:100%;text-align:center', 'sp2-title');
  title.innerHTML = '<b>Pompon &amp; Tapsi</b>';
  title.append(Object.assign(document.createElement('span'), { textContent: say(STRIP_TEXT.folge, lang) }));

  // ---- 1 · the burrow: Pompon knows WHEN; the "?" is his thought ------------------------------------------------
  told(s, alt(1, lang), 120);
  box(s, say(T.p1, lang), 'left:12px;top:118px;max-width:222px');
  const thoughtTracks = scoped('thought', () => {
    const p1 = ink(s.actor('bunny', { x: 112, feetY: 532, size: 262, turn: 'r', label: 'pompon-1' }));
    holdCard(s, p1, 'pompon-1');
    // the thought: little circles rising from his head to a cloud with a gift and "?"; he looks up a little
    const cloud = s.prop(thought(-78, 66), '-64 -44 128 120', 282, 330, 128, 120, 8);
    s.track(cloud, { o: 0, s: 0.4 }, 'thought.cloud').move(0.36, 0.62, { o: 1, s: 1.08 }, EZ.out).move(0.62, 0.9, { s: 1 }, EZ.bouncy);
    p1.lift.set(0, { r: 1 }).move(0.1, 0.5, { r: 5 }, EZ.inOut);
    p1.part('.face', { x: 0, y: 0 }).move(0.1, 0.5, { x: 1.5, y: -2.5 }, EZ.inOut);
  });
  beats.push(new Beat('thought', thoughtTracks, regions.thought ?? { y0: 0, y1: 0 }));

  // ---- 2 · the hilltop: Mila GIVES her wish to Tapsi -------------------------------------------------------------
  told(s, alt(2, lang), 690);
  box(s, say(T.p2, lang), 'left:12px;top:716px;max-width:230px');
  const m2 = mila(s, 98, 1194, 214, 'r');
  m2.lift.set(0, { r: 8 });
  // ---- 3 · Hicks! — the roll, and 4 · the landing in the moss next to Pompon ------------------------------------------
  const hic = s.node('', 'left:232px;top:1016px;--r:-10deg', 'sp-sfx');
  hic.textContent = say(T.p3, lang);
  const dizzy = s.prop(dizzyRing(), '-44 -18 88 36', 262, 1928, 88, 36, 8);

  let rollers = 0;
  let roll: Beat | null = null;
  if (motion) {
    const tracks = scoped('roll', () => {
      handover(m2);
      handoverFx(s, GIVE, 0.03);
      roller(s, 'tapsi');
      landing(s, { hic, dizzy, mila: m2 });
    });
    rollers = 1;
    roll = new Beat('roll', tracks, { y0: ROLL2.y0, y1: ROLL2.y1 }, 0);
    beats.push(roll);
  } else {
    // still: Mila handing over, then three Tapsis tell the roll (the hilltop, mid-slope, landed)
    beats.push(new Beat('hill', scoped('hill', () => {
      handover(m2);
      handoverFx(s, GIVE, 0.03);
    }), { y0: 0, y1: 0 }, 0));
    for (const [id, at] of [['tapsi-a', 0], ['tapsi-m', ROLL2.mid], ['tapsi-z', 1]] as const) {
      beats.push(new Beat(id, scoped(id, () => roller(s, id)), { y0: 0, y1: 0 }, at));
      rollers += 1;
    }
    beats.push(new Beat('rollfx', scoped('rollfx', () => landing(s, { hic, dizzy, mila: null })), { y0: 0, y1: 0 }, 1));
  }
  told(s, alt(3, lang), 1220);
  told(s, alt(4, lang), 1900);

  // ---- 5 · close-up: the choice ----------------------------------------------------------------------------------
  told(s, alt(5, lang), 2200);
  const choiceTracks = scoped('choice', () => {
    const rays = s.band(focusRays(W, 196, 2520, 120, 2196, 2660), 2196, 2660, 1);
    s.track(rays, { o: 0 }, 'choice.rays').move(0, 0.5, { o: 1 }, EZ.out);
  });
  const p5 = ink(s.actor('bunny', { x: 104, feetY: 2640, size: 420, turn: 'r', eyes: 'happy', label: 'pompon-5', z: 4 }));
  p5.lift.set(0, { r: 12 });
  const t5 = ink(s.actor('hamster', { x: 302, feetY: 2642, size: 352, turn: 'l', eyes: 'star', puff: 1.2, label: 'tapsi-5', z: 4 }));
  t5.lift.set(0, { r: -8 });
  s.layer(foreMound(W, 2612, 2700, 70, 'cu'), 7);
  s.prop(CARD_FLAT, '-36 -24 72 48', 206, 2598, 118, 79, 8).style.transform = 'rotate(5deg)';
  const star5 = s.prop(`${halo(64, 'cu', 0.26)}${wishCan(32)}`, '-80 -80 160 160', 204, 2532, 160, 160, 8);
  const say5 = bubble(s, say(T.p5, lang), 'left:16px;top:2214px;max-width:200px', { x: '58%', r: 30 });
  choiceTracks.push(
    s.track(star5, { o: 0.4, s: 0.7, y: 10 }, 'choice.star').move(0.12, 0.52, { o: 1, s: 1.1, y: -4 }, EZ.out).move(0.52, 0.86, { s: 1, y: 0 }, EZ.bouncy),
    s.track(say5, { o: 0, s: 0.7 }, 'choice.say').move(0.3, 0.6, { o: 1, s: 1.04 }, EZ.out).move(0.6, 0.9, { s: 1 }, EZ.bouncy),
  );
  beats.push(new Beat('choice', choiceTracks, regions.choice ?? { y0: 0, y1: 0 }));

  // ---- 6 · the secret: who gives what stays a secret for Mila --------------------------------------------------------
  told(s, alt(6, lang), 2770);
  box(s, say(T.p6box, lang), 'left:12px;top:2766px;max-width:206px');
  const m6 = mila(s, 298, 2890, 178, 'l', 3);
  const marks6 = m6.wear(waveMarks(-88, -112, -1));
  m6.puppet.setEyes('happy');
  bubble(s, say(T.p6mila, lang), 'left:196px;top:2742px;max-width:132px;font-size:14px;padding:6px 11px 7px', { x: '76%', r: 40 });
  const p6 = ink(s.actor('bunny', { x: 92, feetY: 3156, size: 246, turn: 'r', eyes: 'happy', label: 'pompon-6', z: 5 }));
  p6.lift.set(0, { r: 4 });
  const t6 = ink(s.actor('hamster', { x: 270, feetY: 3160, size: 276, puff: 1.22, label: 'tapsi-6', z: 5 }));
  t6.psst();
  t6.wearOn('.cheek-l .cheek-j', cheekStar('sp2-ck6'));
  const sparks6 = t6.wear(cheekSparks());
  t6.part('.cheek-l .cheek-j', { sx: 1.14, sy: 1.08 });
  bubble(s, say(T.p6psst, lang), 'left:300px;top:2972px;font-size:14px;padding:5px 10px 6px', { x: '22%', r: 60 }, 'whisper');
  const waveTracks = scoped('wave', () => {
    // Mila waves twice from the far ridge; the star in Tapsi's cheek twinkles once
    m6.part('.paw-l', { x: -60, y: -60, r: 34 }).path(0.1, [[0.4, { r: -6 }, EZ.inOut], [0.7, { r: 34 }, EZ.inOut], [1, { r: -6 }, EZ.inOut], [1.3, { r: 30 }, EZ.inOut]]);
    m6.part('.body', { r: 0 }).move(0.1, 0.4, { r: 4 }, EZ.out);
    s.track(marks6, { o: 0 }, 'wave.marks').move(0.15, 0.4, { o: 1 }, EZ.out);
    s.track(sparks6, { o: 0, s: 0.5 }, 'wave.sparks').move(0.5, 0.8, { o: 1, s: 1.15 }, EZ.out).move(0.8, 1.1, { s: 1 }, EZ.bouncy);
  });
  beats.push(new Beat('wave', waveTracks, regions.wave ?? { y0: 0, y1: 0 }));

  // ---- 7 · door 14: Kommst du mit? ---------------------------------------------------------------------------------
  told(s, alt(7, lang), 3340);
  const p7 = ink(s.actor('bunny', { x: 104, feetY: 3644, size: 254, turn: 'r', eyes: 'happy', label: 'pompon-7', z: 5 }));
  p7.lift.set(0, { r: 8 });
  const t7 = ink(s.actor('hamster', { x: 288, feetY: 3646, size: 250, turn: 'l', eyes: 'happy', puff: 1.22, label: 'tapsi-7', z: 5 }));
  t7.lift.set(0, { r: -4 });
  t7.wearOn('.cheek-l .cheek-j', cheekStar('sp2-ck7'));
  t7.part('.cheek-l .cheek-j', { sx: 1.12, sy: 1.06 });
  t7.part('.paw-l', { x: -58, y: -18, r: 46 });
  bubble(s, say(T.p7ask, lang), 'left:22px;top:3446px', { x: '62%', r: 40 });
  const inviteTracks = scoped('invite', () => {
    // Pompon holds the "+1" invitation out to Tapsi; a heart pops between them
    const card = offerCard(p7);
    s.track(card, { x: 72, y: -58, r: 8 }, 'invite.card').move(0.05, 0.45, { x: 102, y: -62, r: 12 }, EZ.out).move(0.45, 0.7, { x: 96, y: -60, r: 10 }, EZ.inOut);
    const love = s.prop(heart(10), '-16 -16 32 32', 200, 3524, 32, 32, 8);
    s.track(love, { o: 0, s: 0.2, y: 10 }, 'invite.heart').move(0.4, 0.7, { o: 1, s: 1.25, y: -4 }, EZ.out).move(0.7, 0.95, { s: 1, y: 0 }, EZ.bouncy);
  });
  beats.push(new Beat('invite', inviteTracks, regions.invite ?? { y0: 0, y1: 0 }));
  box(s, say(T.p7box, lang), 'left:50%;top:3688px;transform:translateX(-50%);width:max-content;max-width:330px;text-align:center;font-size:17px');
  const end = s.node('', 'left:0;top:3762px;width:100%;text-align:center', 'sp2-end');
  end.append(Object.assign(document.createElement('p'), { textContent: EPISODE_TITLE.end[lang] }), Object.assign(document.createElement('b'), { textContent: say(STRIP_TEXT.end, lang) }));

  // ---- the frozen effects (strip-fx.ts): their own layer, each scene shimmers once when it comes into view -------
  for (const scene of FX_SCENES) {
    const name = `fx-${scene}`;
    beats.push(new Beat(name, scoped(name, () => sceneFx(s, scene, { door1: b1.doorAt(14), door7: b7.doorAt(14) })), FX_REGIONS[scene]));
  }

  // still poses (everything not on a timeline)
  const stills = new Beat('still', s.tracksIn(''), regions.still ?? { y0: 0, y1: H }, 0);
  beats.unshift(stills);

  if (motion) {
    stills.still(0);
    for (const b of beats) if (b !== stills) b.seek(0);
  } else {
    for (const b of beats) b.still();
  }
  const moments = motion ? beats.filter((b) => b !== stills && b !== roll) : [];
  return {
    world: s,
    roll,
    moments,
    beats,
    rollers,
    destroy() {
      beats.forEach((b) => b.destroy());
      s.destroy();
    },
  };
}

// ---- poses -------------------------------------------------------------------------------------------------------

/**
 * The invitation held up in both paws in front of the chest (behind the paws; puppet units). The worn group carries
 * the pose; its child can still be moved (dropped) on top of it. Returns that child.
 */
export function holdCard(s: Panel, p: Actor, name: string): SVGGElement {
  p.part('.paws', { y: 0 });
  p.part('.paw-l', { x: -28, y: 20, r: -22 });
  p.part('.paw-r', { x: 24, y: 20, r: 22 });
  const card = p.wear(`<g class="sp2-drop"><g transform="scale(1.32)">${CARD_FLAT}</g></g>`, 'paws');
  s.track(card, { x: 4, y: -50, r: -5 }, `${name}.card`);
  const drop = card.firstElementChild;
  if (!(drop instanceof SVGGElement)) throw new Error('[strip] card markup');
  return drop;
}

/** Pompon holds the invitation out to the right, towards Tapsi (both paws forward). Returns the card. */
function offerCard(p: Actor): SVGGElement {
  p.part('.paws', { y: -10 });
  p.part('.paw-l', { x: 62, y: -8, r: -28 });
  p.part('.paw-r', { x: 68, y: -4, r: -56 });
  return p.wear(`<g transform="scale(1.18)">${CARD_FLAT}</g>`, 'paws');
}

/** Where the star is held between Mila's paws and Tapsi's (world px). */
const GIVE = { x: 186, y: 1158 } as const;

/** Feet height in the hamster's box (kit.ts RIG.hamster: feet at 236 of the 400-wide viewBox). */
const HAMSTER_FEET = 236 / 400;

/**
 * Tapsi from the hilltop down to the moss: one puppet on the 'roll' timeline (or a still copy of it). He takes the
 * star from Mila, hiccups, tips over the edge, rolls down the S of the slope holding it, and lands dizzy in front of
 * Pompon.
 */
function roller(s: Panel, id: string): Actor {
  const [first] = ROLL_KEYS;
  const x0 = first?.x ?? 268;
  const y0 = first?.y ?? 1190;
  const t = ink(s.actor('hamster', { x: x0, feetY: y0, size: 208, turn: 'l', puff: 1.15, z: 5, label: id }));
  const u = t.unit;
  // the star: 40 units, held out between Mila's paws and his; then hugged to his chest (smaller), the glow behind him
  const glow = t.wear(halo(70, id, 0.34), 'back');
  const star = t.wear(wishCan(44), 'paws');
  const give = { x: (GIVE.x - x0) / u, y: (GIVE.y - y0) / u };
  s.track([star, glow], { x: give.x, y: give.y }, `${id}.star`).move(0.03, 0.075, { x: -6, y: -62, s: 0.5 }, EZ.inOut);
  t.part('.paw-l', { x: -64, y: -14, r: 52 }).move(0.03, 0.075, { x: -8, y: -16, r: 28 }, EZ.inOut);
  t.part('.paw-r', { x: 0, y: 0, r: 0 }).move(0.03, 0.075, { x: -6, y: -10, r: -18 }, EZ.inOut);
  // the hiccup: eyes squeeze, a squash and a little hop; round eyes and an "oh!" all the way down
  const h = ROLL2.hic;
  t.part('.eyes-star', { o: 1 }).set(h, { o: 0 });
  const open = t.part('.eyes', { o: 0 }).set(h, { o: 1 });
  t.part('.eyes .eye', { sx: 1, sy: 1 }, true).path(h, [[h + 0.012, { sy: 0.15 }, EZ.in], [h + 0.04, { sx: 1.15, sy: 1.15 }, EZ.out]]);
  t.part('.mouth', { o: 1 }).set(h + 0.03, { o: 0 });
  const oh = t.part('.mouth-open', { o: 0, s: 1 }).set(h + 0.03, { o: 1, s: 1.5 });
  t.squash.path(h, [[h + 0.015, { sx: 1.12, sy: 0.86 }, EZ.out], [h + 0.04, { sx: 0.94, sy: 1.08 }, EZ.out], [ROLL2.start - 0.02, { sx: 1, sy: 1 }, EZ.inOut]]);
  t.lift.path(h + 0.015, [[h + 0.04, { y: -18, r: 8 }, EZ.out], [ROLL2.start, { y: 0, r: 16 }, EZ.in], [ROLL2.start + 0.04, { r: 0 }, EZ.out]]);
  t.part('.shadow', { o: 1 }).move(ROLL2.start, ROLL2.start + 0.02, { o: 0 }, EZ.linear).move(ROLL2.end, ROLL2.end + 0.02, { o: 1 }, EZ.linear);
  // the way down: feet along the way, the spin rolled, speed arcs behind him (they turn with the way, not with him)
  const keys = ROLL_KEYS.slice(1);
  t.travel.path(ROLL2.start, keys.map((k) => [k.t, { x: k.x - x0, y: k.y - y0 }, EZ.linear] as const));
  t.spin.path(ROLL2.start, keys.map((k) => [k.t, { r: k.spin }, EZ.linear] as const));
  const centre = HAMSTER_FEET * t.size - 90 * u;
  const arcs = s.node(`<svg viewBox="-80 -80 160 160" width="160" height="160" style="display:block;overflow:visible">${speedArcs(84 * u)}</svg>`,
    `left:${t.size / 2 - 80}px;top:${centre - 80}px;width:160px;height:160px;pointer-events:none`, 'sp', t.box);
  s.track(arcs, { o: 0, r: first?.dir ?? 0 }, `${id}.arcs`)
    .path(ROLL2.start, keys.map((k, i) => [k.t, { r: k.dir, o: i === 0 || i >= keys.length - 2 ? 0 : 1 }, EZ.linear] as const));
  // the landing: a squash, dizzy (eyes closed), tilted, the star still in his paws
  const e = ROLL2.end;
  t.squash.path(e, [[e + 0.02, { sx: 1.14, sy: 0.86 }, EZ.out], [e + 0.05, { sx: 1, sy: 1 }, EZ.bouncy]]);
  t.lift.move(e + 0.01, e + 0.05, { r: -9 }, EZ.out);
  open.set(e + 0.02, { o: 0 });
  t.part('.eyes-sleep', { o: 0 }).set(e + 0.02, { o: 1 });
  oh.move(e + 0.02, e + 0.05, { s: 1 }, EZ.out);
  return t;
}

/**
 * Around the roll: "Hicks!", the glitter trail, Mila's "oh!", and the landing place — Pompon in the moss in front
 * of his burrow, who drops the invitation when Tapsi rolls up to his feet; the dizzy ring.
 */
function landing(s: Panel, o: { hic: HTMLElement; dizzy: HTMLElement; mila: Actor | null }): void {
  const h = ROLL2.hic;
  s.track(o.hic, { o: 0, s: 0.4 }, 'roll.hic').move(h, h + 0.025, { o: 1, s: 1.18 }, EZ.out).move(h + 0.025, h + 0.06, { s: 1 }, EZ.bouncy);
  // the glitter trail on the path, lighting up behind him as he passes
  const t0 = ROLL2.start;
  const t1 = ROLL2.end;
  const first = ROAD[0];
  const last = ROAD[ROAD.length - 1];
  if (first && last) {
    for (let i = 4; i < ROAD.length - 6; i += 7) {
      const p = ROAD[i];
      if (!p) continue;
      const at = t0 + (t1 - t0) * ((p.y - first.y) / (last.y - first.y));
      const g = s.band(glitter(p.x, p.y - 6, i), p.y - 40, p.y + 30, 3);
      s.track(g, { o: 0 }, `roll.glitter${i}`).move(at + 0.004, at + 0.014, { o: 1 }, EZ.out);
    }
  }
  // Mila: a little "oh!" when he hiccups (her paws come down, her eyes open)
  const m = o.mila;
  if (m) {
    m.part('.paws').move(h - 0.03, h, { y: 0 }, EZ.out);
    m.part('.paw-r').move(h - 0.03, h, { x: 34, y: -10, r: -30 }, EZ.out);
    m.part('.paw-l').move(h - 0.03, h, { x: 24, y: -6, r: -12 }, EZ.out);
    m.part('.eyes').set(h + 0.01, { o: 1 });
    m.part('.eyes-happy').set(h + 0.01, { o: 0 });
    m.part('.eyes .eye', { sx: 1, sy: 1 }, true).move(h + 0.01, h + 0.03, { sx: 1.25, sy: 1.15 }, EZ.out);
  }
  // Pompon drops the invitation in surprise when Tapsi rolls up to his feet
  const e = ROLL2.end;
  const p = ink(s.actor('bunny', { x: 94, feetY: 2058, size: 250, turn: 'r', label: 'pompon-4', z: 5 }));
  const card = holdCard(s, p, 'pompon-4');
  s.track(card, { x: 0, y: 0, r: 0 }, 'roll.carddrop').move(e - 0.02, e + 0.03, { x: 66, y: 34, r: 14 }, EZ.in);
  p.part('.paws').move(e - 0.02, e + 0.01, { y: 0 }, EZ.out);
  p.part('.paw-l').move(e - 0.02, e + 0.01, { x: 0, y: 0, r: 0 }, EZ.out);
  p.part('.paw-r').move(e - 0.02, e + 0.01, { x: 0, y: 0, r: 0 }, EZ.out);
  p.part('.lop .ear-l', { r: 0 }).move(e - 0.02, e + 0.01, { r: -14 }, EZ.out);
  p.part('.lop .ear-r', { r: 0 }).move(e - 0.02, e + 0.01, { r: 14 }, EZ.out);
  p.part('.eyes .eye', { sx: 1, sy: 1 }, true).move(e - 0.02, e, { sx: 1.3, sy: 1.12 }, EZ.out);
  p.part('.mouth', { o: 1 }).set(e, { o: 0 });
  p.part('.mouth-open', { o: 0 }).set(e, { o: 1 });
  p.lift.move(e - 0.02, e + 0.02, { r: -5 }, EZ.out);
  // dizzy: the ring over his head once he has landed
  s.track(o.dizzy, { o: 0, s: 0.6 }, 'roll.dizzy').move(e + 0.03, e + 0.06, { o: 1, s: 1 }, EZ.out);
  // the frozen effects along the roll (strip-fx.ts): speed lines and rustling grass where he passes, dust, surprise
  if (!first || !last) return;
  const when = (y: number): number => t0 + (t1 - t0) * ((y - first.y) / (last.y - first.y));
  const centre = 58;
  const passes = [0.2, 0.42, 0.62, 0.8].map((k) => {
    const p = ROAD[Math.round(k * (ROAD.length - 1))] ?? first;
    return [when(p.y), p.x, p.y - centre, (Math.atan2(p.ty, p.tx) * 180) / Math.PI] as const;
  });
  const turn = (wx: number, wy: number, side: 1 | -1) => {
    const p = ROAD.reduce((best, q) => (Math.hypot(q.x - wx, q.y - wy) < Math.hypot(best.x - wx, best.y - wy) ? q : best), first);
    return [when(p.y), p.x + side * 22, p.y - 4, side] as const;
  };
  rollFx(s, {
    hic: h,
    passes,
    rustles: [turn(334, 1292, 1), turn(92, 1620, -1), turn(326, 1936, 1)],
    land: e,
    feet: { x: last.x, y: last.y },
    pomponHead: { x: 102, y: 1980 },
    card: { x: 176, y: 2026 },
  });
}
