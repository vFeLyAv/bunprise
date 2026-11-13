/**
 * Episode 1 «Ein Wunsch rollt an», v4 / v4.1 (31.10; approved by Felix 31.10, in the package since then: the app's
 * reader and the gallery build the same ribbon) — a real manga ribbon. Felix 31.10, with two pages of a
 * published manga as a reference for the visual language only: «надо такое в манге, но наши персонажи, есть анимации».
 *
 *   - black & white: ink lines and dot screen-tones on white paper; ONE spot colour (our warm orange) only on the wish
 *     star and its glow, door 14, the "+1" and the heart at the end (manga-art.ts, data-spot);
 *   - our puppets in ink (kit.ts `ink`): the same shapes and poses, white with an ink contour, tone on ears / patches;
 *   - panels of different shapes on ONE ribbon downwards: angled borders, white gutters, a big establishing panel,
 *     face close-ups, a thought-cloud panel, a tiny chibi "…" panel, a tall diagonal panel for the roll, a balloon,
 *     a sound effect and Tapsi's head breaking out of their panels;
 *   - manga lettering: oval balloons with a tail, a spiky shout balloon, a dashed whisper balloon, small narration
 *     boxes, sound effects drawn into the art; ink effects (focus / speed lines, bursts, ✧, sweat, dust, orbit…);
 *   - every panel comes alive once when it scrolls into view (≤ 2 s, transform / opacity only); the roll follows the
 *     scroll inside its diagonal panel; reduced motion: everything still and readable.
 *
 * Same story beats and texts as v1–v3 (texts.ts T, in DE / EN / RU / UK). Our own drawings; only general manga
 * conventions are borrowed.
 */

import type { Track } from '../timeline';
import { Beat, type Strip } from './beat';
import * as A from './ink';
import { type Actor, EZ, type InkTone, Panel } from './kit';
import { ALT1, EPISODE_TITLE, IDEA, ROLLING, SFX, STRIP_TEXT, T, type ComicLang } from './texts';
import { type Pt, rollKeysFor, sampleWay, wayPieces } from './util';

/**
 * The last three panels (and the end) are drawn in their own coordinates and moved down as one block by SHIFT —
 * the room for the "MAMPF" beat that was added in the middle (31.10, Felix: «в середине чуть непонятно»).
 */
const SHIFT = 282;
export const MW = 390;
export const MH = 3700 + SHIFT;
/** The tone patterns' id prefix. */
const P = 'm4';

/**
 * The panels, in reading order: id → polygon (world px). P3 is a thought cloud (its path is built from CLOUD). `shift`:
 * the panel is drawn in the moved block (its own coordinates = world y − shift).
 */
const LOCAL: ReadonlyArray<{ id: string; pts: readonly Pt[]; moved?: boolean }> = [
  { id: 'p1', pts: [[12, 96], [378, 96], [378, 446], [12, 470]] },
  { id: 'p2', pts: [[12, 480], [222, 456], [204, 686], [12, 686]] },
  { id: 'p3', pts: [] },
  { id: 'p4', pts: [[12, 696], [378, 696], [378, 1004], [12, 1026]] },
  { id: 'p5', pts: [[12, 1036], [378, 1014], [378, 1156], [12, 1170]] },
  { id: 'p6', pts: [[12, 1180], [378, 1166], [378, 1328], [12, 1350]] },
  { id: 'p7', pts: [[12, 1360], [378, 1338], [358, 2196], [12, 2232]] },
  { id: 'p8', pts: [[12, 2242], [358, 2206], [378, 2206], [378, 2470], [12, 2470]] },
  { id: 'p9', pts: [[12, 2480], [140, 2480], [140, 2624], [12, 2634]] },
  { id: 'p9b', pts: [[150, 2480], [378, 2480], [378, 2620], [150, 2624]] },
  { id: 'p10', pts: [[12, 2644], [378, 2632], [378, 2900], [12, 2900]] },
  { id: 'p10b', pts: [[12, 2910], [378, 2910], [378, 3060], [12, 3072]] },
  { id: 'p11', pts: [[12, 2800], [378, 2800], [378, 2950], [12, 2966]], moved: true },
  { id: 'p12', pts: [[12, 2976], [378, 2960], [378, 3180], [12, 3180]], moved: true },
  { id: 'p13', pts: [[12, 3190], [378, 3190], [378, 3500], [12, 3522]], moved: true },
];
export const PANELS: ReadonlyArray<{ id: string; pts: readonly Pt[]; shift: number }> = LOCAL.map((p) => {
  const shift = p.moved ? SHIFT : 0;
  return { id: p.id, pts: p.pts.map(([x, y]) => [x, y + shift] as const), shift };
});
const CLOUD = { cx: 302, cy: 570, w: 150, h: 162 };

/** The roll: the reading line passes y0 → y1 while Tapsi rolls down the diagonal panel (time 0 … 1). */
export const ROLL4 = { y0: 1450, y1: 2130, mid: 0.52 } as const;
export function rollProgress4(readY: number): number {
  return Math.min(1, Math.max(0, (readY - ROLL4.y0) / (ROLL4.y1 - ROLL4.y0)));
}
const WAY4: readonly Pt[] = [[300, 1418], [348, 1500], [306, 1606], [168, 1696], [88, 1806], [128, 1924], [256, 2006], [304, 2096], [214, 2180]];
const ROAD4 = sampleWay(wayPieces(WAY4), 4);
export const ROLL4_KEYS = rollKeysFor(ROAD4, 0, 1, 30, 58);

export const MANGA_CSS = `
.m4 { background: #FFFFFF; color: #141414; }
.m4 .m4-panel { position: absolute; }
.m4 .m4-cap { position: absolute; z-index: 9; background: #FFFFFF; color: #141414; border: 1.6px solid #141414; padding: 5px 8px 6px;
  font-size: 12.5px; line-height: 1.22; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; }
.m4 .m4-bal { position: absolute; z-index: 9; box-sizing: border-box; background: #FFFFFF; color: #141414; border: 1.6px solid #141414; border-radius: 50%;
  padding: 13px 18px 14px; font-size: 12.5px; line-height: 1.18; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; text-align: center; text-wrap: balance; }
.m4 .m4-bal::before, .m4 .m4-bal::after { content: ''; position: absolute; left: var(--tx, 30%); }
.m4 .m4-bal::before { top: calc(100% - 5px); width: 18px; height: 24px; background: #141414; clip-path: polygon(0 0, 100% 0, 14% 100%); }
.m4 .m4-bal::after { top: calc(100% - 7px); margin-left: 3.5px; width: 11.5px; height: 20px; background: #FFFFFF; clip-path: polygon(0 0, 100% 0, 6% 100%); }
.m4 .m4-bal.r::before { clip-path: polygon(0 0, 100% 0, 86% 100%); }
.m4 .m4-bal.r::after { margin-left: 3px; clip-path: polygon(0 0, 100% 0, 94% 100%); }
.m4 .m4-bal.whisper { border-style: dashed; font-style: italic; }
.m4 .m4-bal.tiny { padding: 6px 12px 8px; font-size: 16px; letter-spacing: .1em; }
.m4 .m4-title { position: absolute; z-index: 9; text-align: center; color: #141414; }
.m4 .m4-title b { display: block; font-size: 34px; line-height: 1.05; font-weight: 900; font-style: italic; letter-spacing: .01em; text-transform: uppercase;
  color: #FFFFFF; -webkit-text-stroke: 7px #141414; paint-order: stroke fill; }
.m4 .m4-title span { display: block; margin-top: 6px; font-size: 12.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.m4 .m4-end { position: absolute; z-index: 9; text-align: center; color: #141414; }
.m4 .m4-end p { margin: 0 auto 6px; max-width: 300px; font-size: 14px; line-height: 1.3; font-weight: 700; }
.m4 .m4-end b { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; }
`;

const f1 = (v: number): string => v.toFixed(1);
const poly = (pts: readonly Pt[]): string => `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
const alt = (n: 1 | 2 | 3 | 4 | 5 | 6 | 7, lang: ComicLang): string => ALT1[n][lang];

/**
 * Builds the manga ribbon into `root`. `motion` = false: reduced (everything still). With motion the roll waits at
 * time 0 and every panel at its start until the page drives them (strip-gallery.ts drive()).
 */
export function buildManga(root: HTMLElement, lang: ComicLang, motion: boolean): Strip {
  const s = new Panel(root, { w: MW, h: MH });
  root.classList.add('m4');
  const say = (t: Readonly<Record<ComicLang, string>>): string => t[lang];
  const beats: Beat[] = [];
  /** each panel's border path in its own coordinates, and how far its block is moved down */
  const borders = new Map<string, { d: string; shift: number }>();
  const boxes: Record<string, { y0: number; y1: number }> = {};
  /** where panels go (the world, or the moved block at the end) and that block's offset */
  let page: HTMLElement = s.root;
  let shift = 0;

  // the tone patterns, once
  s.node(`<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>${A.toneDefs(P)}</defs></svg>`, 'left:0;top:0;width:0;height:0', 'sp');

  // ---- helpers ------------------------------------------------------------------------------------------------------
  /** Opens a panel: a clip container over the whole world (content in world px), its border drawn later. */
  const open = (id: string, clip?: string): HTMLElement => {
    const def = PANELS.find((p) => p.id === id);
    const pts = (def?.pts ?? []).map(([x, y]) => [x, y - shift] as const);
    const d = id === 'p3' ? A.cloudPath(CLOUD.cx, CLOUD.cy, CLOUD.w, CLOUD.h, 10) : poly(pts);
    const ys = id === 'p3' ? [CLOUD.cy - CLOUD.h / 2, CLOUD.cy + CLOUD.h / 2] : pts.map((p) => p[1]);
    boxes[id] = { y0: Math.min(...ys) + shift, y1: Math.max(...ys) + shift };
    borders.set(id, { d, shift });
    s.parent = page;
    const el = s.node('', `left:0;top:0;width:${MW}px;height:${MH}px;clip-path:${clip ?? (id === 'p3' ? `path('${d}')` : `polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(', ')})`)}`, 'sp m4-panel');
    el.dataset['panel'] = id;
    s.parent = el;
    return el;
  };
  const close = (): void => {
    s.parent = page;
  };
  const bg = (markup: string, id: string): HTMLElement => {
    const b = boxes[id] ?? { y0: 0, y1: MH };
    return s.band(`<rect x="0" y="${b.y0 - 2}" width="${MW}" height="${b.y1 - b.y0 + 4}" fill="${A.PAPER}"/>${markup}`, b.y0 - 2, b.y1 + 2, 0);
  };
  /** One drawing as its own element, centred on (x, y) (size × size px, viewBox the same). */
  const art = (markup: string, x: number, y: number, size: number, z = 6, view = size): HTMLElement => s.prop(markup, `${-view / 2} ${-view / 2} ${view} ${view}`, x, y, size, size, z);
  /** An ink effect, tagged with its panel (the effects layer, kept apart from the picture). */
  const fx = (panel: string, markup: string, x: number, y: number, size: number, z = 8): HTMLElement => {
    const e = art(markup, x, y, size, z);
    e.classList.add('sp4-fx');
    e.dataset['fx'] = panel;
    return e;
  };
  const cap = (t: Readonly<Record<ComicLang, string>>, style: string): HTMLElement => {
    const e = s.node('', style, 'm4-cap');
    say(t).split(/(?<=[.!?])\s+/).forEach((line, i) => {
      if (i) e.append(' ', document.createElement('br'));
      e.append(line);
    });
    return e;
  };
  const balloon = (text: string, style: string, tail: string, cls = ''): HTMLElement => {
    const e = s.node('', `${style};--tx:${tail}`, `m4-bal${cls ? ` ${cls}` : ''}`);
    e.textContent = text;
    return e;
  };
  const told = (n: 1 | 2 | 3 | 4 | 5 | 6 | 7, y: number): void => {
    const e = s.node('', `left:0;top:${y}px;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)`, 'sp2-sr');
    e.textContent = alt(n, lang);
  };
  const actor = (kind: 'bunny' | 'hamster', o: { x: number; feetY: number; size: number; tone: InkTone; turn?: 'l' | 'r'; z?: number; label: string; eyes?: 'happy' | 'star' | 'sleep'; puff?: number; coat?: 'broken' }): Actor =>
    s.actor(kind, { x: o.x, feetY: o.feetY, size: o.size, ink: o.tone, z: o.z ?? 5, label: o.label, ...(o.turn ? { turn: o.turn } : {}), ...(o.eyes ? { eyes: o.eyes } : {}), ...(o.puff ? { puff: o.puff } : {}), ...(o.coat ? { coat: o.coat, ears: 'lop' as const } : {}) });
  /** Mila in ink: our lop-eared bunny, coat 'broken' as tone patches, the blossom in ink on her ear, no muzzle spots. */
  const mila = (x: number, feetY: number, size: number, turn: 'l' | 'r', label: string, z = 6): Actor => {
    const m = actor('bunny', { x, feetY, size, tone: 'light', turn, label, z, coat: 'broken' });
    m.wearOn('.lop .te-l .ear-l', `<g class="m4-worn">${blossomInk(-34, -152, 10.5)}</g>`);
    m.part('.tpatch ellipse', { o: 0 }, true);
    return m;
  };
  const scoped = (name: string, build: () => void): Track[] => {
    s.scope = name;
    build();
    s.scope = '';
    return s.tracksIn(name);
  };
  const moment = (id: string, build: () => void): void => {
    const tracks = scoped(id, build);
    beats.push(new Beat(id, tracks, boxes[id] ?? { y0: 0, y1: 0 }));
  };
  /** The invitation held up in both paws (ink card, worn behind the paws). */
  const holdCard = (p: Actor, plus = false): SVGGElement => {
    p.part('.paws', { y: 0 });
    p.part('.paw-l', { x: -28, y: 20, r: -22 });
    p.part('.paw-r', { x: 24, y: 20, r: 22 });
    const g = p.wear(`<g class="m4-worn" transform="translate(4 -50) rotate(-5) scale(1.3)">${A.cardInk(P, plus)}</g>`, 'paws');
    return g;
  };

  // ---- title --------------------------------------------------------------------------------------------------------
  const title = s.node('', 'left:0;top:22px;width:100%', 'm4-title');
  title.innerHTML = '<b>Pompon &amp; Tapsi</b>';
  title.append(Object.assign(document.createElement('span'), { textContent: say(STRIP_TEXT.folge) }));
  s.band(`${[[44, 40, 7], [346, 34, 9], [362, 70, 5], [30, 76, 5]].map(([x = 0, y = 0, r = 5]) => `<g transform="translate(${x} ${y})">${A.sparkleInk(r)}</g>`).join('')}`, 0, 96, 2);

  // ---- p1 · the burrow at night: Pompon knows WHEN ---------------------------------------------------------------
  told(1, 100);
  open('p1');
  const door = (i: number, x0: number, y0: number, dx: number, dy: number) => ({ x: x0 + (i % 7) * dx, y: y0 + Math.floor(i / 7) * dy });
  const doors1 = Array.from({ length: 28 }, (_, i) => ({ day: i + 1, ...door(i, 40, 258, 51.6, 44) }));
  bg(`${A.nightTone(P, 0, 96, MW, 250, 1, 22)}${A.moonInk(P, 318, 152, 24)}
    <path d="M-10 470 L-10 246 C30 210 100 198 195 196 C290 198 360 210 400 246 L400 470 Z" fill="${A.PAPER}"/>
    <path d="M-10 470 L-10 246 C30 210 100 198 195 196 C290 198 360 210 400 246 L400 470 Z" fill="url(#${P}-t2)"/>
    <path d="M-10 246 C30 210 100 198 195 196 C290 198 360 210 400 246" fill="none" stroke="${A.INK}" stroke-width="2.4"/>
    ${A.grassInk(Array.from({ length: 15 }, (_, i) => [i * 28, 246 - 48 * Math.sin((Math.min(i * 28, 390) / 390) * Math.PI) + 2] as const))}
    ${doors1.filter((d) => d.day !== 14).map((d) => A.doorInk(d.x, d.y, 26, 30, d.day)).join('')}
    ${A.groundInk('M-10 414 C90 408 250 418 400 410', 470)}${A.grassInk(Array.from({ length: 13 }, (_, i) => [8 + i * 30, 413 + (i % 3)] as const))}
    ${A.hatch(200, 440, 170, 14, 3)}`, 'p1');
  const d14 = doors1[13] ?? { x: 349.6, y: 302 };
  const door14a = art(A.door14(P, 0, 0, 26, 30), d14.x, d14.y, 120, 2, 120);
  const sp1 = [fx('p1', A.sparkleInk(7), d14.x + 22, d14.y - 26, 18, 3), fx('p1', A.sparkleInk(6), 292, 128, 16, 3)];
  moment('p1', () => {
    const p1 = actor('bunny', { x: 104, feetY: 462, size: 196, tone: 'dark', turn: 'r', label: 'pompon-1' });
    holdCard(p1);
    p1.lift.set(0, { r: 1 }).move(0.2, 0.6, { r: 5 }, EZ.inOut);
    s.track(door14a, { o: 0.35, s: 0.82 }, 'p1.door').move(0.1, 0.5, { o: 1, s: 1.06 }, EZ.out).move(0.5, 0.85, { s: 1 }, EZ.bouncy);
    sp1.forEach((e, i) => s.track(e, { o: 0, s: 0.4 }, `p1.sp${i}`).move(0.4 + i * 0.2, 0.7 + i * 0.2, { o: 1, s: 1 }, EZ.out));
  });
  close();
  cap(T.p1, 'left:20px;top:104px;max-width:232px');

  // ---- p2 · close-up: what to give? --------------------------------------------------------------------------------
  open('p2');
  bg(`${A.toneRect(P, 0, 456, 230, 232, 't1')}<circle cx="110" cy="560" r="120" fill="url(#${P}-glowW)"/>${A.focusInk(110, 575, 110, 260, 46, 4)}`, 'p2');
  const sweat2 = fx('p2', A.sweatInk(P, 9, -24), 186, 518, 40, 8);
  moment('p2', () => {
    const p2 = actor('bunny', { x: 108, feetY: 718, size: 500, tone: 'dark', turn: 'r', label: 'pompon-2' });
    holdCard(p2);
    p2.part('.face', { x: 0, y: 0 }).move(0.1, 0.5, { x: 3, y: -3 }, EZ.inOut);
    s.track(sweat2, { o: 0, y: -10 }, 'p2.sweat').move(0.3, 0.8, { o: 1, y: 0 }, EZ.out);
  });
  close();

  // ---- p3 · his thought: a cloud-shaped panel with the empty gift box and "?" -------------------------------------
  open('p3');
  bg(`${A.toneRect(P, 220, 486, 170, 170, 't1')}<circle cx="${CLOUD.cx}" cy="${CLOUD.cy}" r="64" fill="url(#${P}-glowW)"/>`, 'p3');
  const thought = art(`<g transform="translate(-12 46)">${A.giftInk(P)}</g><text x="40" y="-6" text-anchor="middle" font-size="58" font-weight="900" fill="${A.INK}" font-family="system-ui, sans-serif">?</text>`, CLOUD.cx, CLOUD.cy, 150, 4);
  moment('p3', () => {
    s.track(thought, { o: 0, s: 0.55 }, 'p3.thought').move(0.2, 0.55, { o: 1, s: 1.08 }, EZ.out).move(0.55, 0.9, { s: 1 }, EZ.bouncy);
  });
  close();
  // the little circles of the thought, from his head across the gutter
  s.band(`${[[204, 548, 4], [216, 566, 6.5]].map(([x = 0, y = 0, r = 4]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${A.PAPER}" stroke="${A.INK}" stroke-width="1.8"/>`).join('')}`, 530, 590, 7);

  // ---- p4 · the hilltop: Tapsi keeps the wishes; Mila gives hers -------------------------------------------------
  told(2, 700);
  open('p4');
  const wishes = [[40, 760, 5], [96, 812, 4], [150, 744, 6], [222, 790, 4.5], [286, 752, 5.5], [344, 806, 4], [60, 880, 4], [330, 884, 5], [190, 862, 3.5], [256, 848, 4]] as const;
  bg(`${A.nightTone(P, 0, 696, MW, 260, 4, 12)}
    ${wishes.map(([x, y, r]) => `<g transform="translate(${x} ${y}) rotate(${(x * 7) % 30})"><path d="M0 ${-r} L${f1(r * 0.29)} ${f1(-r * 0.4)} L${f1(r * 0.95)} ${f1(-r * 0.31)} L${f1(r * 0.47)} ${f1(r * 0.15)} L${f1(r * 0.59)} ${f1(r * 0.81)} L0 ${f1(r * 0.5)} L${f1(-r * 0.59)} ${f1(r * 0.81)} L${f1(-r * 0.47)} ${f1(r * 0.15)} L${f1(-r * 0.95)} ${f1(-r * 0.31)} L${f1(-r * 0.29)} ${f1(-r * 0.4)} Z" fill="${A.PAPER}" stroke="${A.INK}" stroke-width="1.2" stroke-linejoin="round"/></g>`).join('')}
    <path d="M-10 930 C80 900 170 906 250 890 C320 878 370 892 400 884 L400 1030 L-10 1030 Z" fill="${A.PAPER}"/><path d="M-10 930 C80 900 170 906 250 890 C320 878 370 892 400 884 L400 1030 L-10 1030 Z" fill="url(#${P}-t1)"/>
    <path d="M-10 930 C80 900 170 906 250 890 C320 878 370 892 400 884" fill="none" stroke="${A.INK}" stroke-width="1.6"/>
    ${A.groundInk('M-10 1000 C30 980 70 972 120 970 C190 966 260 966 310 970 C350 974 380 990 400 1008', 1030)}
    ${A.grassInk([[30, 990], [70, 976], [150, 972], [222, 970], [300, 972], [352, 984]])}${A.hatch(280, 996, 100, 9, 5, 8)}`, 'p4');
  const star4 = art(A.starSpot(P, 22), 188, 934, 130, 7);
  const tw4 = [fx('p4', A.sparkleInk(8), 150, 744, 20, 3), fx('p4', A.sparkleInk(7), 286, 752, 18, 3), fx('p4', A.sparkleInk(6), 222, 900, 16, 8)];
  const m4 = mila(104, 974, 190, 'r', 'mila-4');
  m4.lift.set(0, { r: 8 });
  const t4 = actor('hamster', { x: 268, feetY: 970, size: 186, tone: 'mid', turn: 'l', eyes: 'star', puff: 1.15, label: 'tapsi-4' });
  t4.part('.paw-l', { x: -64, y: -14, r: 52 });
  moment('p4', () => {
    handover(m4);
    s.track(star4, { o: 0.5, s: 0.8 }, 'p4.star').move(0.15, 0.5, { o: 1, s: 1.12 }, EZ.out).move(0.5, 0.85, { s: 1 }, EZ.bouncy);
    tw4.forEach((e, i) => s.track(e, { o: 0, s: 0.4 }, `p4.tw${i}`).move(0.2 + i * 0.25, 0.5 + i * 0.25, { o: 1, s: 1 }, EZ.out));
  });
  close();
  cap(T.p2, 'left:20px;top:704px;max-width:240px');

  // ---- p5 · close-up of the hand-over: her paw, his paw, the star ----------------------------------------------------
  open('p5');
  bg(`<circle cx="196" cy="1094" r="150" fill="url(#${P}-glowW)"/>${A.focusInk(196, 1094, 78, 300, 64, 6)}`, 'p5');
  const pawM = art(A.pawInk(P, 62, 't1', 1.2), 120, 1112, 240, 4);
  const pawT = art(A.pawInk(P, -58, null, 1.2), 272, 1100, 240, 4);
  const star5 = art(A.starSpot(P, 38), 196, 1090, 210, 5);
  const sp5 = [fx('p5', A.sparkleInk(10), 248, 1050, 24), fx('p5', A.sparkleInk(8), 140, 1056, 20), fx('p5', A.sparkleInk(6), 236, 1136, 16)];
  moment('p5', () => {
    s.track(pawM, { x: -16, r: -4 }, 'p5.pawM').move(0.05, 0.55, { x: 0, r: 0 }, EZ.out);
    s.track(pawT, { x: 16, r: 4 }, 'p5.pawT').move(0.15, 0.65, { x: 0, r: 0 }, EZ.out);
    s.track(star5, { s: 0.85 }, 'p5.star').move(0.3, 0.6, { s: 1.08 }, EZ.out).move(0.6, 0.95, { s: 1 }, EZ.bouncy);
    sp5.forEach((e, i) => s.track(e, { o: 0, s: 0.3 }, `p5.sp${i}`).move(0.5 + i * 0.15, 0.8 + i * 0.15, { o: 1, s: 1 }, EZ.out));
  });
  close();

  // ---- p6 · Hicks! ----------------------------------------------------------------------------------------------------
  told(3, 1184);
  open('p6');
  bg(`${A.toneRect(P, 0, 1166, MW, 190, 't1')}<g transform="translate(262 1262)">${A.burstInk(92, 260, 30, 8)}</g><circle cx="262" cy="1262" r="96" fill="url(#${P}-glowW)"/>`, 'p6');
  const sweat6 = [fx('p6', A.sweatInk(P, 8, 24), 344, 1218, 36), fx('p6', A.sweatInk(P, 6, -30), 176, 1232, 30)];
  moment('p6', () => {
    const t6 = actor('hamster', { x: 262, feetY: 1364, size: 300, tone: 'mid', turn: 'l', puff: 1.2, label: 'tapsi-6' });
    const g = t6.wear(`<g class="m4-worn" transform="translate(-6 -62)">${A.starSpot(P, 22, false)}</g>`, 'paws');
    void g;
    t6.part('.paw-l', { x: -8, y: -16, r: 28 });
    t6.part('.paw-r', { x: -6, y: -10, r: -18 });
    t6.part('.eyes .eye', { sx: 1, sy: 0.15 }, true);
    t6.part('.mouth', { o: 0 });
    t6.part('.mouth-open', { o: 1, s: 1.6 });
    t6.squash.set(0, { sx: 1.12, sy: 0.88 }).move(0.1, 0.4, { sx: 0.95, sy: 1.06 }, EZ.out).move(0.4, 0.75, { sx: 1, sy: 1 }, EZ.bouncy);
    t6.lift.set(0, { y: 0, r: 0 }).move(0.1, 0.35, { y: -14, r: 5 }, EZ.out).move(0.35, 0.7, { y: 0, r: 4 }, EZ.in);
    const m6 = mila(62, 1352, 112, 'r', 'mila-6', 4);
    m6.part('.eyes .eye', { sx: 1.3, sy: 1.15 }, true);
    m6.part('.mouth', { o: 0 });
    m6.part('.mouth-open', { o: 1, s: 1.3 });
    const lines = fx('p6', A.surpriseInk(30, 44, -160, -20, 6), 66, 1300, 110, 6);
    s.track(lines, { o: 0, s: 0.8 }, 'p6.lines').move(0.45, 0.7, { o: 1, s: 1 }, EZ.out);
    sweat6.forEach((e, i) => s.track(e, { o: 0, y: -8 }, `p6.sweat${i}`).move(0.3 + i * 0.15, 0.6 + i * 0.15, { o: 1, y: 0 }, EZ.out));
  });
  close();
  // the shout balloon breaks out of the panel's top
  const shout = art(A.shoutInk(170, 84, say(T.p3).toUpperCase(), 30), 108, 1194, 190, 9, 190);
  shout.dataset['say'] = 'hicks';
  scoped('p6', () => s.track(shout, { o: 0, s: 0.4 }, 'p6.shout').move(0, 0.25, { o: 1, s: 1.15 }, EZ.out).move(0.25, 0.55, { s: 1 }, EZ.bouncy));
  const p6beat = beats.find((b) => b.name === 'p6');
  if (p6beat) beats.splice(beats.indexOf(p6beat), 1, new Beat('p6', s.tracksIn('p6'), boxes['p6'] ?? { y0: 0, y1: 0 }));

  // ---- p7 · the roll: a tall diagonal panel; Tapsi rolls down WITH the scroll ----------------------------------------
  open('p7');
  const ribbon = ROAD4.filter((_, i) => i % 2 === 0);
  const rib = (w0: number, w1: number) => {
    const y0 = ROAD4[0]?.y ?? 0;
    const y1 = ROAD4[ROAD4.length - 1]?.y ?? 1;
    const l: string[] = [];
    const r: string[] = [];
    for (const q of ribbon) {
      const w = (w0 + (w1 - w0) * ((q.y - y0) / (y1 - y0))) / 2;
      l.push(`${f1(q.x - q.ty * w)} ${f1(q.y + q.tx * w * 0.5 + 2)}`);
      r.push(`${f1(q.x + q.ty * w)} ${f1(q.y - q.tx * w * 0.5 + 2)}`);
    }
    return `M${l.join(' L')} L${r.reverse().join(' L')} Z`;
  };
  bg(`${A.nightTone(P, 0, 1338, MW, 200, 7, 10)}
    ${A.groundInk('M-10 1520 C80 1470 200 1430 296 1420 C336 1416 370 1404 400 1396', 2240)}
    <path d="M400 1396 C380 1600 300 1800 360 2240 L400 2240 Z" fill="url(#${P}-t1)"/><path d="M-10 1700 C40 1800 20 1980 70 2240 L-10 2240 Z" fill="url(#${P}-t1)"/>
    <path d="${rib(14, 46)}" fill="url(#${P}-t2)" stroke="${A.INK}" stroke-width="1.2"/>
    ${A.hatch(20, 1560, 80, 8, 11)}${A.hatch(230, 1760, 120, 9, 13)}${A.hatch(30, 2060, 100, 9, 17)}
    ${A.grassInk([[40, 1508], [120, 1468], [200, 1440], [24, 1640], [370, 1680], [356, 1880], [40, 2000], [360, 2140]], 1.1)}
    <path d="M-10 2240 L-10 2150 C24 2134 84 2130 118 2140 C136 2146 142 2180 144 2240 Z" fill="${A.PAPER}"/><path d="M-10 2240 L-10 2150 C24 2134 84 2130 118 2140 C136 2146 142 2180 144 2240 Z" fill="url(#${P}-t2)"/>
    <path d="M-10 2150 C24 2134 84 2130 118 2140 C136 2146 142 2180 144 2240" fill="none" stroke="${A.INK}" stroke-width="2"/>
    ${A.grassInk([[10, 2146], [52, 2134], [96, 2134]])}${A.doorInk(36, 2184, 24, 28, 15)}${A.doorInk(84, 2184, 24, 28, 16)}`, 'p7');
  cap(ROLLING, 'left:20px;top:1374px;max-width:206px');
  const words = say(SFX.roll).split(/(?<=-)|\s+/);
  const kuller = art(words.map((w, i) => `<g transform="translate(${i * 26} ${i * 52})">${A.sfxInk(w, 30, 21 + i, 6)}</g>`).join(''), 0, 0, 10, 4, 10);
  kuller.style.cssText += ';left:34px;top:1574px;width:10px;height:10px;transform-origin:0 0;rotate:18deg;overflow:visible';
  let rollers = 0;
  const rollerFx = (scope: string) => scoped(scope, () => {
    // glitter ✧ and speed lines, appearing behind him as he passes; the sound effect once he is rolling
    const y0 = ROAD4[0]?.y ?? 0;
    const y1 = ROAD4[ROAD4.length - 1]?.y ?? 1;
    const when = (y: number) => (y - y0) / (y1 - y0);
    // a trail of tiny ✧ and dots along the path, in short stretches (one element each), lit as he passes
    for (let i = 8; i < ROAD4.length - 8; i += 16) {
      const stretch = ROAD4.slice(i, i + 16);
      const ys = stretch.map((q) => q.y);
      const y0s = Math.min(...ys) - 24;
      const y1s = Math.max(...ys) + 24;
      const marks = stretch.map((q, j) => {
        const side = ((i + j) % 2 ? 1 : -1) * (13 + (j % 3) * 4);
        const x = q.x - q.ty * side;
        const y = q.y + q.tx * side * 0.6 - 6;
        return j % 4 === 0 ? `<g transform="translate(${f1(x)} ${f1(y)})">${A.sparkleInk(3.2 + (j % 8 === 0 ? 1.6 : 0))}</g>` : j % 2 === 0 ? `<circle cx="${f1(x)}" cy="${f1(y)}" r="1.3" fill="${A.INK}"/>` : '';
      }).join('');
      const e = s.band(marks, y0s, y1s, 4);
      e.classList.add('sp4-fx');
      e.dataset['fx'] = 'p7';
      const at = when(stretch[stretch.length - 1]?.y ?? y1);
      s.track(e, { o: 0 }, `roll.gl${i}`).move(at, at + 0.02, { o: 1 }, EZ.out);
    }
    [0.24, 0.44, 0.62, 0.8].forEach((k, i) => {
      const q = ROAD4[Math.round(k * (ROAD4.length - 1))];
      if (!q) return;
      const e = fx('p7', `<g transform="rotate(${f1((Math.atan2(q.ty, q.tx) * 180) / Math.PI)})">${A.speedInk(52, 30, 5, i + 3)}</g>`, q.x, q.y - 52, 130, 4);
      s.track(e, { o: 0 }, `roll.sp${i}`).move(when(q.y) + 0.02, when(q.y) + 0.04, { o: 1 }, EZ.out);
    });
    s.track(kuller, { o: 0 }, 'roll.sfx').move(0.12, 0.2, { o: 1 }, EZ.out);
  });
  /** The rolling Tapsi; `ghost` = a faint ink copy of him (still version: where he was / where he goes). */
  const roller = (scope: string, ghost?: number) => scoped(scope, () => {
    const [first] = ROLL4_KEYS;
    const x0 = first?.x ?? 300;
    const y0 = first?.y ?? 1418;
    const t = actor('hamster', { x: x0, feetY: y0, size: 192, tone: 'mid', turn: 'l', puff: 1.15, label: `tapsi-${scope}`, z: ghost ? 3 : 5 });
    if (ghost) {
      t.travel.set(0, { o: ghost });
      t.box.classList.add('m4-ghost');
    }
    t.wear(`<g class="m4-worn" transform="translate(-6 -62)">${A.starSpot(P, 22, false)}</g>`, 'paws');
    t.part('.paw-l', { x: -8, y: -16, r: 28 });
    t.part('.paw-r', { x: -6, y: -10, r: -18 });
    t.part('.eyes .eye', { sx: 1.18, sy: 1.18 }, true);
    t.part('.mouth', { o: 0 });
    t.part('.mouth-open', { o: 1, s: 1.4 });
    t.part('.shadow', { o: 0 });
    const keys = ROLL4_KEYS.slice(1);
    t.travel.path(0, keys.map((k) => [k.t, { x: k.x - x0, y: k.y - y0 }, EZ.linear] as const));
    t.spin.path(0, keys.map((k) => [k.t, { r: k.spin }, EZ.linear] as const));
    if (ghost) return;
    const centre = (236 / 400) * t.size - 90 * t.unit;
    const arcs = s.node(`<svg viewBox="-90 -90 180 180" width="180" height="180" aria-hidden="true" style="display:block;overflow:visible"><g transform="translate(-58 0)">${A.speedInk(46, 70, 6, 9)}</g></svg>`,
      `left:${t.size / 2 - 90}px;top:${centre - 90}px;width:180px;height:180px;pointer-events:none`, 'sp sp4-fx', t.box);
    arcs.dataset['fx'] = 'p7';
    s.track(arcs, { o: 0, r: first?.dir ?? 0 }, `${scope}.arcs`)
      .path(0, keys.map((k, i) => [k.t, { r: k.dir, o: i === 0 || i >= keys.length - 1 ? 0 : 1 }, EZ.linear] as const));
  });
  let roll: Beat | null = null;
  if (motion) {
    roller('roll');
    rollerFx('roll');
    rollers = 1;
    roll = new Beat('roll', s.tracksIn('roll'), { y0: ROLL4.y0, y1: ROLL4.y1 }, 0);
    beats.push(roll);
  } else {
    // still: Tapsi mid-roll, with two faint ink "ghosts" where he was and where he is heading
    beats.push(
      new Beat('rollG1', roller('rollG1', 0.26), { y0: 0, y1: 0 }, 0.16),
      new Beat('rollG2', roller('rollG2', 0.26), { y0: 0, y1: 0 }, 0.84),
      new Beat('rollM', roller('rollM'), { y0: 0, y1: 0 }, ROLL4.mid),
      new Beat('rollfx', rollerFx('rollfx'), { y0: 0, y1: 0 }),
    );
    rollers = 3;
  }
  close();

  // ---- p8 · PLUMPS! — the landing in the moss in front of Pompon --------------------------------------------------------
  told(4, 2250);
  open('p8');
  const doors8 = Array.from({ length: 4 }, (_, i) => ({ day: 15 + (i % 2) + Math.floor(i / 2) * 7, x: 24 + (i % 2) * 44, y: 2296 + Math.floor(i / 2) * 46 }));
  bg(`${A.toneRect(P, 0, 2206, MW, 270, 't1')}
    <path d="M-10 2420 L-10 2262 C20 2252 70 2250 96 2256 C112 2262 118 2300 120 2420 Z" fill="${A.PAPER}"/><path d="M-10 2420 L-10 2262 C20 2252 70 2250 96 2256 C112 2262 118 2300 120 2420 Z" fill="url(#${P}-t2)"/>
    <path d="M-10 2262 C20 2252 70 2250 96 2256 C112 2262 118 2300 120 2420" fill="none" stroke="${A.INK}" stroke-width="2"/>
    ${doors8.map((d) => A.doorInk(d.x, d.y, 24, 28, d.day)).join('')}
    <circle cx="276" cy="2380" r="120" fill="url(#${P}-glowW)"/><g transform="translate(276 2380)">${A.burstInk(104, 230, 16, 12, -105, 75)}</g><circle cx="100" cy="2372" r="96" fill="url(#${P}-glowW)"/>
    ${A.groundInk('M-10 2416 C90 2410 250 2420 400 2412', 2480)}${A.grassInk(Array.from({ length: 13 }, (_, i) => [8 + i * 30, 2415 + (i % 3)] as const))}`, 'p8');
  const dust8 = [fx('p8', A.dustInk(0.85), 230, 2462, 80, 7), fx('p8', `<g transform="scale(-1 1)">${A.dustInk(1)}</g>`, 340, 2448, 84, 7)];
  const orbit8 = fx('p8', A.orbitInk(), 276, 2318, 96, 8);
  const lines8 = fx('p8', A.surpriseInk(58, 88, -160, -20, 7), 100, 2378, 200, 8);
  const card8 = art(A.cardInk(P), 168, 2444, 84, 6, 84);
  card8.style.transform = 'rotate(10deg)';
  const holdTw = [fx('p8', A.sparkleInk(8), 232, 2398, 20, 8), fx('p8', A.sparkleInk(6), 320, 2392, 16, 8)];
  moment('p8', () => {
    const p8 = actor('bunny', { x: 96, feetY: 2458, size: 214, tone: 'dark', turn: 'r', label: 'pompon-8' });
    p8.part('.lop .ear-l', { r: -14 });
    p8.part('.lop .ear-r', { r: 14 });
    p8.part('.eyes .eye', { sx: 1.3, sy: 1.12 }, true);
    p8.part('.mouth', { o: 0 });
    p8.part('.mouth-open', { o: 1, s: 1.2 });
    p8.lift.set(0, { r: 0 }).move(0.05, 0.3, { r: -6 }, EZ.out);
    const t8 = actor('hamster', { x: 276, feetY: 2460, size: 206, tone: 'mid', turn: 'l', puff: 1.2, label: 'tapsi-8' });
    // he still HOLDS the star (not eaten yet): on his belly between his paws, well below his mouth
    t8.wear(`<g class="m4-worn" transform="translate(-2 -36) rotate(-6)">${A.starSpot(P, 27, false)}</g>`, 'paws');
    t8.part('.paw-l', { x: -15, y: 8, r: -14 });
    t8.part('.paw-r', { x: 13, y: 8, r: 14 });
    holdTw.forEach((e, i) => s.track(e, { o: 0, s: 0.3 }, `p8.hold${i}`).move(0.4 + i * 0.15, 0.7 + i * 0.15, { o: 1, s: 1 }, EZ.out));
    t8.part('.eyes', { o: 0 });
    t8.part('.eyes-sleep', { o: 1 });
    t8.part('.mouth', { o: 0 });
    t8.part('.mouth-open', { o: 1, s: 1 });
    t8.lift.set(0, { r: -9 });
    t8.squash.set(0, { sx: 1.16, sy: 0.84 }).move(0, 0.3, { sx: 1, sy: 1 }, EZ.bouncy);
    dust8.forEach((e, i) => s.track(e, { o: 0, s: 0.4 }, `p8.dust${i}`).move(0, 0.35, { o: 1, s: 1 }, EZ.out));
    s.track(orbit8, { o: 0, s: 0.6, r: -20 }, 'p8.orbit').move(0.3, 0.8, { o: 1, s: 1, r: 0 }, EZ.out);
    s.track(lines8, { o: 0, s: 0.8 }, 'p8.lines').move(0.1, 0.35, { o: 1, s: 1 }, EZ.out);
  });
  close();
  // the landing sound breaks out over the panel's top
  const plumps = art(A.sfxInk(say(SFX.land), 50, 31, 8), 0, 0, 10, 9, 10);
  plumps.style.cssText += ';left:124px;top:2266px;width:10px;height:10px;overflow:visible;rotate:-8deg';
  plumps.dataset['say'] = 'land';
  scoped('p8', () => s.track(plumps, { o: 0, s: 1.6 }, 'p8.plumps').move(0, 0.22, { o: 1, s: 1 }, EZ.in));
  {
    const b = beats.find((x) => x.name === 'p8');
    if (b) beats.splice(beats.indexOf(b), 1, new Beat('p8', s.tracksIn('p8'), boxes['p8'] ?? { y0: 0, y1: 0 }));
  }

  // ---- p9 · tiny chibi panel: «…» ---------------------------------------------------------------------------------------
  open('p9');
  bg(`${A.toneRect(P, 0, 2478, 150, 156, 't1')}${A.groundInk('M-10 2610 L150 2610', 2634)}`, 'p9');
  const dots = balloon('…', 'left:44px;top:2492px', '40%', 'tiny');
  moment('p9', () => {
    const cp = actor('bunny', { x: 46, feetY: 2618, size: 92, tone: 'dark', turn: 'r', label: 'pompon-9' });
    const ct = actor('hamster', { x: 106, feetY: 2618, size: 86, tone: 'mid', turn: 'l', label: 'tapsi-9' });
    void cp;
    void ct;
    s.track(dots, { o: 0, s: 0.5 }, 'p9.dots').move(0.3, 0.7, { o: 1, s: 1 }, EZ.bouncy);
  });
  close();

  // ---- p9b · still life: the star rests against her invitation — the idea --------------------------------------------------
  told(5, 2484);
  open('p9b');
  bg(`<circle cx="262" cy="2566" r="100" fill="url(#${P}-glowW)"/>${A.toneRect(P, 150, 2600, 240, 26, 't2')}${A.groundInk('M140 2600 C220 2596 300 2602 390 2598', 2626)}`, 'p9b');
  const card9 = art(A.cardInk(P), 308, 2580, 96, 5, 96);
  card9.style.transform = 'rotate(-4deg) scale(1.05)';
  const star9 = art(A.starSpot(P, 26), 234, 2578, 150, 6);
  const sp9 = [fx('p9b', A.sparkleInk(8), 190, 2540, 20), fx('p9b', A.sparkleInk(6), 360, 2536, 16)];
  moment('p9b', () => {
    s.track(star9, { s: 0.9, r: -20 }, 'p9b.star').move(0.1, 0.5, { s: 1.06, r: -8 }, EZ.out).move(0.5, 0.85, { s: 1, r: -12 }, EZ.bouncy);
    sp9.forEach((e, i) => s.track(e, { o: 0, s: 0.3 }, `p9b.sp${i}`).move(0.5 + i * 0.15, 0.8 + i * 0.15, { o: 1, s: 1 }, EZ.out));
  });
  close();
  cap(IDEA, 'left:158px;top:2486px;max-width:188px');

  // ---- p10 · close-up: the choice (Pompon says it, Tapsi's eyes shine) --------------------------------------------------------
  open('p10');
  bg(`<circle cx="226" cy="2800" r="170" fill="url(#${P}-glowW)"/>`, 'p10');
  const focus10 = s.band(A.focusInk(226, 2806, 116, 330, 74, 9), 2628, 2904, 1);
  focus10.classList.add('sp4-fx');
  focus10.dataset['fx'] = 'p10';
  const star10 = art(A.starSpot(P, 18), 224, 2858, 100, 7);
  moment('p10', () => {
    const p10 = actor('bunny', { x: 126, feetY: 2916, size: 420, tone: 'dark', turn: 'r', eyes: 'happy', label: 'pompon-10' });
    p10.lift.set(0, { r: 0 }).move(0.1, 0.5, { r: 8 }, EZ.out);
    const t10 = actor('hamster', { x: 322, feetY: 2934, size: 330, tone: 'mid', turn: 'l', eyes: 'star', puff: 1.15, label: 'tapsi-10', z: 4 });
    t10.lift.set(0, { r: -6 });
    s.track(focus10, { o: 0 }, 'p10.focus').move(0, 0.4, { o: 1 }, EZ.out);
    s.track(star10, { s: 0.7, o: 0.5 }, 'p10.star').move(0.2, 0.55, { s: 1.12, o: 1 }, EZ.out).move(0.55, 0.85, { s: 1 }, EZ.bouncy);
  });
  close();
  const b10 = balloon(say(T.p5), 'left:22px;top:2644px;max-width:220px', '34%');
  scoped('p10', () => s.track(b10, { o: 0, s: 0.6 }, 'p10.say').move(0.25, 0.55, { o: 1, s: 1.04 }, EZ.out).move(0.55, 0.85, { s: 1 }, EZ.bouncy));
  {
    const b = beats.find((x) => x.name === 'p10');
    if (b) beats.splice(beats.indexOf(b), 1, new Beat('p10', s.tracksIn('p10'), boxes['p10'] ?? { y0: 0, y1: 0 }));
  }

  // ---- p10b · MAMPF! — Tapsi tucks the star into his cheek (taken = reserved = a secret) -----------------------------------
  open('p10b');
  bg(`${A.toneRect(P, 0, 2908, MW, 168, 't1')}<circle cx="166" cy="3000" r="96" fill="url(#${P}-glowW)"/>`, 'p10b');
  // the way the star flew: speed lines and a dashed arc into the cheek
  const way10 = s.band(`<path d="M44 2950 Q108 2948 150 2994" fill="none" stroke="${A.INK}" stroke-width="1.6" stroke-dasharray="4 4"/>
    <g transform="translate(140 2986) rotate(30)">${A.speedInk(70, 34, 5, 13)}</g>`, 2908, 3076, 3);
  way10.classList.add('sp4-fx');
  way10.dataset['fx'] = 'p10b';
  const fly10 = art(A.starSpot(P, 15, false), 60, 2950, 60, 8);
  const tw10 = [fx('p10b', A.sparkleInk(8), 120, 3044, 20, 8), fx('p10b', A.sparkleInk(6), 196, 2934, 16, 8)];
  moment('p10b', () => {
    const t10b = actor('hamster', { x: 246, feetY: 3110, size: 380, tone: 'mid', turn: 'l', eyes: 'happy', puff: 1.25, label: 'tapsi-10b' });
    const ck = t10b.wearOn('.cheek-l .cheek-j', `<g class="m4-worn" data-spot="star">${cheekSpot('m4-ck10b')}</g>`);
    t10b.part('.cheek-l .cheek-j', { sx: 1.2, sy: 1.1 });
    s.track(ck, { o: 0 }, 'p10b.cheek').move(0.55, 0.75, { o: 1 }, EZ.out);
    s.track(fly10, { o: 1, x: 0, y: 0, s: 1 }, 'p10b.fly').move(0.1, 0.6, { x: 92, y: 52, s: 0.45 }, EZ.in).set(0.62, { o: 0 });
    tw10.forEach((e, i) => s.track(e, { o: 0, s: 0.3 }, `p10b.tw${i}`).move(0.7 + i * 0.12, 1 + i * 0.12, { o: 1, s: 1 }, EZ.out));
  });
  close();
  const mampf = art(A.sfxInk(say(SFX.eat), 34, 41, 6), 0, 0, 10, 9, 10);
  mampf.style.cssText += ';left:22px;top:3024px;width:10px;height:10px;overflow:visible;rotate:-10deg';
  mampf.dataset['say'] = 'eat';
  scoped('p10b', () => s.track(mampf, { o: 0, s: 1.4 }, 'p10b.mampf').move(0.55, 0.72, { o: 1, s: 1 }, EZ.in));
  {
    const b = beats.find((x) => x.name === 'p10b');
    if (b) beats.splice(beats.indexOf(b), 1, new Beat('p10b', s.tracksIn('p10b'), boxes['p10b'] ?? { y0: 0, y1: 0 }));
  }

  // everything below moves down as one block (room for the new beat above); its panels keep their own coordinates
  page = s.node('', `left:0;top:${SHIFT}px;width:${MW}px;height:${MH - SHIFT}px`, 'sp', s.root);
  shift = SHIFT;
  s.parent = page;

  // ---- p11 · far away on the ridge: Mila waves -------------------------------------------------------------------------
  told(6, 2804);
  open('p11');
  bg(`${A.nightTone(P, 0, 2800, MW, 170, 11, 12)}${A.groundInk('M-10 2952 C80 2936 180 2906 260 2888 C310 2878 350 2876 400 2878', 2970)}
    ${A.grassInk([[250, 2890], [300, 2880], [350, 2878], [150, 2918], [60, 2944]])}`, 'p11');
  const marks11 = fx('p11', A.waveInk(-1), 278, 2842, 50, 8);
  moment('p11', () => {
    const m11 = mila(322, 2884, 128, 'l', 'mila-11', 5);
    m11.puppet.setEyes('happy');
    m11.part('.paw-l', { x: -60, y: -60, r: 34 }).path(0.1, [[0.4, { r: -6 }, EZ.inOut], [0.7, { r: 34 }, EZ.inOut], [1, { r: -6 }, EZ.inOut], [1.3, { r: 30 }, EZ.inOut]]);
    s.track(marks11, { o: 0 }, 'p11.marks').move(0.15, 0.4, { o: 1 }, EZ.out);
  });
  close();
  cap(T.p6box, 'left:20px;top:2902px;max-width:230px');
  balloon(say(T.p6mila), 'left:112px;top:2810px;max-width:150px', '78%', 'r');

  // ---- p12 · Psst! — Tapsi's head breaks out over the panel's top ---------------------------------------------------------
  const clip12 = 'polygon(12px 2976px, 196px 2969px, 214px 2930px, 340px 2930px, 352px 2961px, 378px 2960px, 378px 3180px, 12px 3180px)';
  // above the border layer, so Tapsi's head covers the border of the panel above (its own border is drawn over it, with a gap)
  open('p12', clip12).style.zIndex = '7';
  const cheekTw = [fx('p12', A.sparkleInk(9), 176, 2998, 24, 8), fx('p12', A.sparkleInk(6), 170, 3062, 18, 8)];
  bg(`${A.toneRect(P, 0, 2960, MW, 222, 't1')}<circle cx="270" cy="3060" r="130" fill="url(#${P}-glowW)"/>`, 'p12');
  const hush12 = fx('p12', `<g fill="none" stroke="${A.INK}" stroke-width="2.2" stroke-linecap="round"><path d="M0 -8 q5 -5 10 0 t10 0"/><path d="M4 6 q5 -5 10 0 t10 0"/></g>`, 360, 3100, 40, 8);
  moment('p12', () => {
    const p12 = actor('bunny', { x: 86, feetY: 3214, size: 232, tone: 'dark', turn: 'r', eyes: 'happy', label: 'pompon-12', z: 4 });
    p12.lift.set(0, { r: 4 });
    const t12 = actor('hamster', { x: 270, feetY: 3128, size: 360, tone: 'mid', puff: 1.22, label: 'tapsi-12', z: 5 });
    t12.psst();
    t12.wearOn('.cheek-l .cheek-j', `<g class="m4-worn" data-spot="star">${cheekSpot('m4-ck12')}</g>`);
    t12.part('.cheek-l .cheek-j', { sx: 1.14, sy: 1.08 });
    cheekTw.forEach((e, i) => s.track(e, { o: 0, s: 0.4 }, `p12.cheek${i}`).move(0.4 + i * 0.15, 0.7 + i * 0.15, { o: 1, s: 1 }, EZ.out));
    s.track(hush12, { o: 0, x: -6 }, 'p12.hush').move(0.2, 0.5, { o: 1, x: 0 }, EZ.out);
  });
  close();
  balloon(say(T.p6psst), 'left:120px;top:2986px', '74%', 'r whisper');

  // ---- p13 · door 14: Kommst du mit? -------------------------------------------------------------------------------------
  told(7, 3194);
  open('p13');
  const doors13 = Array.from({ length: 14 }, (_, i) => ({ day: 8 + i, ...door(i, 40, 3296, 51.6, 46) }));
  bg(`${A.nightTone(P, 0, 3190, MW, 120, 13, 8)}
    <path d="M-10 3520 L-10 3262 C40 3248 120 3242 195 3242 C270 3242 350 3248 400 3262 L400 3520 Z" fill="${A.PAPER}"/><path d="M-10 3520 L-10 3262 C40 3248 120 3242 195 3242 C270 3242 350 3248 400 3262 L400 3520 Z" fill="url(#${P}-t2)"/>
    <path d="M-10 3262 C40 3248 120 3242 195 3242 C270 3242 350 3248 400 3262" fill="none" stroke="${A.INK}" stroke-width="2.2"/>
    ${A.grassInk(Array.from({ length: 14 }, (_, i) => [i * 30, 3256 - (i > 2 && i < 11 ? 10 : 4)] as const))}
    ${doors13.filter((d) => d.day !== 14).map((d) => A.doorInk(d.x, d.y, 26, 30, d.day)).join('')}
    ${A.groundInk('M-10 3420 C90 3414 250 3424 400 3416', 3530)}${A.grassInk(Array.from({ length: 13 }, (_, i) => [8 + i * 30, 3419 + (i % 3)] as const))}`, 'p13');
  const d14b = doors13.find((d) => d.day === 14) ?? { x: 349.6, y: 3296 };
  const rays13 = art(A.doorRays(16, 22, 92), d14b.x, d14b.y, 200, 1, 200);
  art(A.door14(P, 0, 0, 26, 30, 1.3), d14b.x, d14b.y, 140, 2, 140);
  const love = art(A.heartSpot(11), 196, 3376, 34, 8);
  const sp13 = [fx('p13', A.sparkleInk(8), d14b.x - 30, d14b.y - 34, 20, 3), fx('p13', A.sparkleInk(6), 222, 3360, 16), fx('p13', A.sparkleInk(5), 168, 3390, 14)];
  moment('p13', () => {
    const p13 = actor('bunny', { x: 104, feetY: 3496, size: 232, tone: 'dark', turn: 'r', eyes: 'happy', label: 'pompon-13' });
    p13.lift.set(0, { r: 8 });
    p13.part('.paws', { y: -10 });
    p13.part('.paw-l', { x: 62, y: -8, r: -28 });
    p13.part('.paw-r', { x: 68, y: -4, r: -56 });
    const card = p13.wear(`<g class="m4-worn"><g transform="scale(1.2)">${A.cardInk(P, true)}</g></g>`, 'paws');
    s.track(card, { x: 72, y: -58, r: 8 }, 'p13.card').move(0.05, 0.45, { x: 100, y: -62, r: 12 }, EZ.out).move(0.45, 0.7, { x: 96, y: -60, r: 10 }, EZ.inOut);
    const t13 = actor('hamster', { x: 286, feetY: 3498, size: 226, tone: 'mid', turn: 'l', eyes: 'happy', puff: 1.22, label: 'tapsi-13' });
    t13.wearOn('.cheek-l .cheek-j', `<g class="m4-worn" data-spot="star">${cheekSpot('m4-ck13')}</g>`);
    t13.part('.cheek-l .cheek-j', { sx: 1.12, sy: 1.06 });
    t13.part('.paw-l', { x: -58, y: -18, r: 46 });
    t13.lift.set(0, { r: -4 });
    s.track(love, { o: 0, s: 0.2, y: 10 }, 'p13.heart').move(0.4, 0.7, { o: 1, s: 1.25, y: -4 }, EZ.out).move(0.7, 0.95, { s: 1, y: 0 }, EZ.bouncy);
    s.track(rays13, { o: 0.3, s: 0.8, r: -8 }, 'p13.rays').move(0, 0.6, { o: 1, s: 1, r: 0 }, EZ.out);
    sp13.forEach((e, i) => s.track(e, { o: 0, s: 0.3 }, `p13.sp${i}`).move(0.5 + i * 0.15, 0.8 + i * 0.15, { o: 1, s: 1 }, EZ.out));
  });
  close();
  balloon(say(T.p7ask), 'left:22px;top:3266px', '62%', 'r');

  // ---- the end -----------------------------------------------------------------------------------------------------------
  cap(T.p7box, 'left:50%;top:3540px;transform:translateX(-50%);width:max-content;max-width:330px;text-align:center;font-size:14px');
  const end = s.node('', 'left:0;top:3604px;width:100%', 'm4-end');
  end.append(Object.assign(document.createElement('p'), { textContent: EPISODE_TITLE.end[lang] }), Object.assign(document.createElement('b'), { textContent: say(STRIP_TEXT.end) }));

  // ---- the panel borders (one ink layer over all panels; the gutters are the white paper) ----------------------------------
  // Tapsi's head breaks out over p12's top border: that border has a gap where his head is
  s.parent = s.root;
  const border = (d: string, dy: number): string => `<path d="${d}" fill="none" stroke="${A.INK}" stroke-width="2.6" stroke-linejoin="miter"${dy ? ` transform="translate(0 ${dy})"` : ''}/>`;
  s.layer([...borders].filter(([id]) => id !== 'p12').map(([, b]) => border(b.d, b.shift)).join(''), 6);
  s.layer(border('M196 2969 L12 2976 L12 3180 L378 3180 L378 2960 L352 2961', SHIFT), 8);
  // still poses (everything not on a timeline)
  const stills = new Beat('still', s.tracksIn(''), { y0: 0, y1: MH }, 0);
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
    rollAt: rollProgress4,
    destroy() {
      beats.forEach((b) => b.destroy());
      s.destroy();
    },
  };
}

/** Mila holds her star out to Tapsi with both paws (the star itself is Tapsi's: he takes it). Shared with v2 / v3. */
export function handover(m: Actor): void {
  m.part('.paws', { y: -4 });
  m.part('.paw-r', { x: 70, y: -8, r: -64 });
  m.part('.paw-l', { x: 58, y: -2, r: -34 });
  m.part('.eyes', { o: 0 });
  m.part('.eyes-happy', { o: 1 });
}

/** Mila's blossom in ink (puppet units): white petals with an ink line, a toned centre, a little leaf. */
export function blossomInk(x: number, y: number, r: number): string {
  const petals = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * r * 0.62;
    const py = y + Math.sin(a) * r * 0.62;
    return `<ellipse cx="${f1(px)}" cy="${f1(py)}" rx="${f1(r * 0.5)}" ry="${f1(r * 0.42)}" transform="rotate(${f1((a * 180) / Math.PI + 90)} ${f1(px)} ${f1(py)})" fill="#FFFFFF" stroke="#141414" stroke-width="1.3"/>`;
  }).join('');
  return `<g class="blossom">${petals}<circle cx="${x}" cy="${y}" r="${f1(r * 0.32)}" fill="#141414"/>
    <path d="M${f1(x + r * 0.6)} ${f1(y + r * 0.7)} q${f1(r * 0.9)} ${f1(r * 0.3)} ${f1(r * 1.2)} ${f1(r * 1.1)}" fill="none" stroke="#141414" stroke-width="1.6" stroke-linecap="round"/></g>`;
}

/** The swallowed star in Tapsi's cheek (spot colour, inside the cheek's own units: -66 -86, 15 × 25). */
export function cheekSpot(id: string): string {
  return `<defs><radialGradient id="${id}-g"><stop offset="0" stop-color="${A.SPOT}" stop-opacity=".5"/><stop offset="1" stop-color="${A.SPOT}" stop-opacity="0"/></radialGradient>
      <clipPath id="${id}-c"><ellipse cx="-66" cy="-86" rx="15" ry="25"/></clipPath></defs>
    <ellipse cx="-66" cy="-86" rx="15" ry="25" fill="url(#${id}-g)"/>
    <g clip-path="url(#${id}-c)"><path d="M-66 -97 L-62.8 -89.6 L-55 -89.4 L-61.1 -84.5 L-59 -77 L-66 -81.4 L-73 -77 L-70.9 -84.5 L-77 -89.4 L-69.2 -89.6 Z" fill="${A.SPOT}" stroke="#141414" stroke-width="1.2" stroke-linejoin="round"/></g>`;
}
