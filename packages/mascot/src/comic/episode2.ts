/**
 * Episode 2 «Zweimal derselbe Schal» (31.10; approved by Felix 31.10, in the package since then: the app's reader and
 * the gallery build the same ribbon) in the v4 manga language of episode 1 (episode1.ts): black &
 * white ink + screen-tones, ONE spot colour (only the wish stars and the glowing birthday door 21), panels of different
 * shapes on one downward ribbon, manga balloons / sound effects / ink effects; every panel comes alive once when it
 * scrolls into view (≤ 2 s, transform / opacity only); reduced motion: everything still and readable.
 *
 * The story (concept §1.3, script: docs/design/2026-10-31-manga-episode-2.md) — where the secret reservation comes
 * from: Pompon and Mila bring Momo the SAME scarf → an awkward freeze → «Oh nein.» → Tapsi's idea → a year later Momo
 * gives Tapsi his wishes, Tapsi lays them out; a friend picks one and Tapsi hides it in his cheek (= reserved), the
 * other friend sees the empty place and picks another; Momo's own list looks exactly as before → two different gifts,
 * a happy binky → «Psst. Tapsi verrät nichts.» Momo (invented) is our approved lop-eared bunny: himalayan coat,
 * cross-hatched ears, a party hat. No upright ears anywhere.
 */

import type { Track } from '../timeline';
import { Beat, type Strip } from './beat';
import { blossomInk, cheekSpot } from './episode1';
import * as A from './ink';
import * as B from './ink2';
import { type Actor, EZ, type InkTone, Panel } from './kit';
import { ALT2 as ALT, SFX, T2, type ComicLang } from './texts';
import type { Pt } from './util';

export const M2W = 390;
export const M2H = 3660;
/** The tone patterns' id prefix (apart from episode 1's). */
const P = 'm5';

/** The panels, in reading order (world px). */
export const PANELS2: ReadonlyArray<{ id: string; pts: readonly Pt[] }> = [
  { id: 'e1', pts: [[12, 96], [378, 96], [378, 392], [12, 408]] },
  { id: 'e2a', pts: [[12, 418], [188, 418], [180, 630], [12, 630]] },
  { id: 'e2b', pts: [[198, 418], [378, 418], [378, 630], [190, 630]] },
  { id: 'e3', pts: [[12, 640], [378, 640], [378, 930], [12, 950]] },
  { id: 'e4a', pts: [[12, 960], [124, 960], [124, 1130], [12, 1130]] },
  { id: 'e4b', pts: [[134, 960], [256, 960], [256, 1130], [134, 1130]] },
  { id: 'e4c', pts: [[266, 960], [378, 960], [378, 1130], [266, 1130]] },
  { id: 'e5', pts: [[12, 1140], [378, 1140], [378, 1350], [12, 1366]] },
  { id: 'e6', pts: [[12, 1376], [196, 1376], [178, 1580], [12, 1580]] },
  { id: 'e7', pts: [[206, 1376], [378, 1376], [378, 1580], [188, 1580]] },
  { id: 'e8', pts: [[12, 1590], [378, 1590], [378, 1850], [12, 1870]] },
  { id: 'e9', pts: [[12, 1880], [378, 1860], [378, 2110], [12, 2110]] },
  { id: 'e10', pts: [[12, 2120], [378, 2120], [378, 2380], [12, 2400]] },
  { id: 'e11', pts: [[12, 2410], [378, 2390], [378, 2650], [12, 2650]] },
  { id: 'e12a', pts: [[12, 2660], [188, 2660], [188, 2880], [12, 2880]] },
  { id: 'e12b', pts: [[198, 2660], [378, 2660], [378, 2880], [198, 2880]] },
  { id: 'e13', pts: [[12, 2890], [378, 2890], [378, 3220], [12, 3240]] },
  { id: 'e14', pts: [[12, 3250], [378, 3230], [378, 3500], [12, 3500]] },
];

const poly = (pts: readonly Pt[]): string => `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;

export function buildManga2(root: HTMLElement, lang: ComicLang, motion: boolean): Strip {
  const s = new Panel(root, { w: M2W, h: M2H });
  root.classList.add('m4');
  root.dataset['ep'] = '2';
  const say = (t: Readonly<Record<ComicLang, string>>): string => t[lang];
  const beats: Beat[] = [];
  const borders: string[] = [];
  const boxes: Record<string, { y0: number; y1: number }> = {};
  s.node(`<svg width="0" height="0" aria-hidden="true" style="position:absolute"><defs>${A.toneDefs(P)}</defs></svg>`, 'left:0;top:0;width:0;height:0', 'sp');

  // ---- helpers (the same panel language as episode 1) -----------------------------------------------------------------
  const open = (id: string): HTMLElement => {
    const pts = PANELS2.find((p) => p.id === id)?.pts ?? [];
    const ys = pts.map((p) => p[1]);
    boxes[id] = { y0: Math.min(...ys), y1: Math.max(...ys) };
    borders.push(poly(pts));
    s.parent = s.root;
    const el = s.node('', `left:0;top:0;width:${M2W}px;height:${M2H}px;clip-path:polygon(${pts.map(([x, y]) => `${x}px ${y}px`).join(', ')})`, 'sp m4-panel');
    el.dataset['panel'] = id;
    s.parent = el;
    return el;
  };
  const close = (): void => {
    s.parent = s.root;
  };
  const bg = (markup: string, id: string): HTMLElement => {
    const b = boxes[id] ?? { y0: 0, y1: M2H };
    return s.band(`<rect x="0" y="${b.y0 - 2}" width="${M2W}" height="${b.y1 - b.y0 + 4}" fill="${A.PAPER}"/>${markup}`, b.y0 - 2, b.y1 + 2, 0);
  };
  const art = (markup: string, x: number, y: number, size: number, z = 6, view = size): HTMLElement => s.prop(markup, `${-view / 2} ${-view / 2} ${view} ${view}`, x, y, size, size, z);
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
  const told = (key: string, y: number): void => {
    const e = s.node('', `left:0;top:${y}px;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)`, 'sp2-sr');
    e.textContent = ALT[key]?.[lang] ?? '';
  };
  const actor = (kind: 'bunny' | 'hamster', o: { x: number; feetY: number; size: number; tone: InkTone; turn?: 'l' | 'r'; z?: number; label: string; eyes?: 'happy' | 'star' | 'sleep'; puff?: number; coat?: 'broken' | 'himalayan' }): Actor =>
    s.actor(kind, { x: o.x, feetY: o.feetY, size: o.size, ink: o.tone, z: o.z ?? 5, label: o.label, ...(o.turn ? { turn: o.turn } : {}), ...(o.eyes ? { eyes: o.eyes } : {}), ...(o.puff ? { puff: o.puff } : {}), ...(o.coat ? { coat: o.coat, ears: 'lop' as const } : {}) });
  const pompon = (x: number, feetY: number, size: number, label: string, turn: 'l' | 'r' = 'r', eyes?: 'happy'): Actor =>
    actor('bunny', { x, feetY, size, tone: 'dark', turn, label, ...(eyes ? { eyes } : {}) });
  const mila = (x: number, feetY: number, size: number, label: string, turn: 'l' | 'r' = 'l', eyes?: 'happy'): Actor => {
    const m = actor('bunny', { x, feetY, size, tone: 'light', turn, label, coat: 'broken', ...(eyes ? { eyes } : {}) });
    m.wearOn('.lop .te-l .ear-l', `<g class="m4-worn">${blossomInk(-34, -152, 10.5)}</g>`);
    m.part('.tpatch ellipse', { o: 0 }, true);
    return m;
  };
  /** Momo, the birthday friend: our lop-eared bunny, himalayan coat, cross-hatched ears, a party hat. */
  const momo = (x: number, feetY: number, size: number, label: string, turn?: 'l' | 'r', eyes?: 'happy' | 'star'): Actor => {
    const m = actor('bunny', { x, feetY, size, tone: 'hatch', label, coat: 'himalayan', ...(turn ? { turn } : {}), ...(eyes ? { eyes } : {}) });
    m.wear(`<g class="m4-worn">${B.partyHat(P)}</g>`);
    m.part('.points', { o: 0 });
    return m;
  };
  const tapsi = (x: number, feetY: number, size: number, label: string, turn?: 'l' | 'r', eyes?: 'happy' | 'star' | 'sleep', puff = 1.15): Actor =>
    actor('hamster', { x, feetY, size, tone: 'mid', label, puff, ...(turn ? { turn } : {}), ...(eyes ? { eyes } : {}) });
  /** Hold something in both paws in front of the chest (drawn behind the paws). */
  const hold = (p: Actor, markup: string, spread = 0): SVGGElement => {
    p.part('.paws', { y: 0 });
    p.part('.paw-l', { x: -28 - spread, y: 20 - spread / 3, r: -22 });
    p.part('.paw-r', { x: 24 + spread, y: 20 - spread / 3, r: 22 });
    return p.wear(`<g class="m4-worn">${markup}</g>`, 'paws');
  };
  const cheekStar = (t: Actor, side: 'l' | 'r', id: string): SVGGElement =>
    t.wearOn(`.cheek-${side} .cheek-j`, `<g class="m4-worn" data-spot="star">${side === 'l' ? cheekSpot(id) : `<g transform="scale(-1 1)">${cheekSpot(id)}</g>`}</g>`);
  const scoped = (name: string, build: () => void): Track[] => {
    s.scope = name;
    build();
    s.scope = '';
    return s.tracksIn(name);
  };
  const moment = (id: string, build: () => void): void => {
    const tracks = scoped(id, build);
    const old = beats.findIndex((b) => b.name === id);
    const beat = new Beat(id, old >= 0 ? s.tracksIn(id) : tracks, boxes[id] ?? { y0: 0, y1: 0 });
    if (old >= 0) beats.splice(old, 1, beat);
    else beats.push(beat);
  };
  const pop = (e: Element, name: string, t0: number, from = 0.4): Track => s.track(e, { o: 0, s: from }, name).move(t0, t0 + 0.3, { o: 1, s: 1.12 }, EZ.out).move(t0 + 0.3, t0 + 0.6, { s: 1 }, EZ.bouncy);
  /** A burrow wall of doors (ink), the birthday door 21 in the spot colour. */
  const doorWall = (days: readonly number[], cols: number, x0: number, y0: number, dx: number, dy: number, w: number, h: number, open = false): { markup: string; d21: { x: number; y: number } } => {
    let d21 = { x: 0, y: 0 };
    const doors = days.map((day, i) => {
      const x = x0 + (i % cols) * dx;
      const y = y0 + Math.floor(i / cols) * dy;
      if (day === 21) {
        d21 = { x, y };
        return '';
      }
      return A.doorInk(x, y, w, h, day);
    }).join('');
    return { markup: `${doors}<g>${B.doorSpot(P, d21.x, d21.y, w, h, 21, open)}</g>`, d21 };
  };

  // ---- title ----------------------------------------------------------------------------------------------------------
  const title = s.node('', 'left:0;top:22px;width:100%', 'm4-title');
  title.innerHTML = '<b>Pompon &amp; Tapsi</b>';
  title.append(Object.assign(document.createElement('span'), { textContent: say(T2.folge) }));
  s.band(`${[[44, 40, 7], [346, 34, 9], [362, 70, 5], [30, 76, 5]].map(([x = 0, y = 0, r = 5]) => `<g transform="translate(${x} ${y})">${A.sparkleInk(r)}</g>`).join('')}`, 0, 96, 2);

  // ---- e1 · the burrow: door 21 glows — Momo's birthday (Pompon knows WHEN) ----------------------------------------
  told('e1', 100);
  open('e1');
  const wall1 = doorWall(Array.from({ length: 21 }, (_, i) => 8 + i), 7, 40, 262, 51.6, 44, 26, 30);
  bg(`${A.nightTone(P, 0, 96, M2W, 160, 21, 18)}${A.moonInk(P, 318, 150, 22)}
    <path d="M-10 410 L-10 236 C30 202 100 192 195 190 C290 192 360 202 400 236 L400 410 Z" fill="${A.PAPER}"/><path d="M-10 410 L-10 236 C30 202 100 192 195 190 C290 192 360 202 400 236 L400 410 Z" fill="url(#${P}-t2)"/>
    <path d="M-10 236 C30 202 100 192 195 190 C290 192 360 202 400 236" fill="none" stroke="${A.INK}" stroke-width="2.4"/>
    ${A.grassInk(Array.from({ length: 15 }, (_, i) => [i * 28, 236 - 44 * Math.sin((Math.min(i * 28, 390) / 390) * Math.PI) + 2] as const))}
    ${wall1.markup}
    ${A.groundInk('M-10 380 C90 374 250 384 400 376', 410)}${A.grassInk(Array.from({ length: 13 }, (_, i) => [8 + i * 30, 379 + (i % 3)] as const))}`, 'e1');
  const tw1 = [fx('e1', A.sparkleInk(8), wall1.d21.x - 24, wall1.d21.y - 30, 20, 3), fx('e1', A.sparkleInk(6), wall1.d21.x + 2, wall1.d21.y + 34, 16, 3)];
  const glow1 = art(`<circle r="52" fill="url(#${P}-glowW)" opacity=".6"/>`, wall1.d21.x, wall1.d21.y, 110, 1);
  moment('e1', () => {
    const p = pompon(96, 398, 170, 'pompon-e1');
    p.part('.face', { x: 0, y: 0 }).move(0.1, 0.5, { x: 3, y: -3 }, EZ.inOut);
    p.lift.set(0, { r: 0 }).move(0.1, 0.5, { r: 5 }, EZ.inOut);
    s.track(glow1, { o: 0, s: 0.6 }, 'e1.glow').move(0.1, 0.6, { o: 1, s: 1 }, EZ.out);
    tw1.forEach((e, i) => pop(e, `e1.tw${i}`, 0.4 + i * 0.2));
  });
  close();
  cap(T2.e1, 'left:20px;top:104px;max-width:240px');

  // ---- e2a · e2b · two guests, two identical parcels -----------------------------------------------------------------
  told('e2', 420);
  for (const [id, x, turn, who] of [['e2a', 98, 'r', 'pompon'], ['e2b', 290, 'l', 'mila']] as const) {
    open(id);
    const x0 = id === 'e2a' ? 0 : 190;
    bg(`${A.nightTone(P, x0, 418, 200, 120, id === 'e2a' ? 23 : 25, 6)}${A.groundInk(`M${x0 - 10} 596 C${x0 + 60} 590 ${x0 + 130} 600 ${x0 + 200} 594`, 632, x0 - 10, x0 + 200)}
      ${A.grassInk([[x0 + 20, 596], [x0 + 90, 594], [x0 + 160, 596]])}`, id);
    const marks = fx(id, `<g transform="${turn === 'r' ? '' : 'scale(-1 1)'}">${A.speedInk(30, 34, 4, id === 'e2a' ? 3 : 5)}</g>`, turn === 'r' ? x - 60 : x + 60, 560, 70, 3);
    moment(id, () => {
      const a = who === 'pompon' ? pompon(x, 616, 176, `pompon-${id}`) : mila(x, 616, 176, `mila-${id}`);
      hold(a, `<g transform="translate(0 -20) scale(1.25)">${B.boxInk(P, 40)}</g>`);
      a.lift.set(0, { y: 0, r: 0 }).path(0.05, [[0.3, { y: -16, r: turn === 'r' ? 4 : -4 }, EZ.out], [0.6, { y: 0, r: 0 }, EZ.in]]);
      a.squash.set(0, { sx: 1, sy: 1 }).path(0.6, [[0.7, { sx: 1.08, sy: 0.92 }, EZ.out], [0.95, { sx: 1, sy: 1 }, EZ.bouncy]]);
      s.track(marks, { o: 0 }, `${id}.marks`).move(0.1, 0.4, { o: 1 }, EZ.out);
    });
    close();
  }

  // ---- e3 · the party: the SAME scarf twice ---------------------------------------------------------------------------
  told('e3', 650);
  open('e3');
  const wall3 = doorWall([19, 20, 21, 22, 23], 5, 59, 744, 68, 0, 34, 42, true);
  bg(`<rect x="0" y="640" width="${M2W}" height="250" fill="url(#${P}-t2)"/>
    <path d="M-10 676 C80 664 300 664 400 676" fill="none" stroke="${A.INK}" stroke-width="2"/>${A.grassInk(Array.from({ length: 13 }, (_, i) => [8 + i * 30, 676 - (i > 2 && i < 10 ? 3 : 0)] as const))}
    ${B.garland(P, 10, 380, 690, 11)}${wall3.markup}
    ${A.groundInk('M-10 880 C90 874 250 884 400 876', 952)}${A.grassInk(Array.from({ length: 13 }, (_, i) => [8 + i * 30, 879 + (i % 3)] as const))}`, 'e3');
  const huh = fx('e3', B.exclaim(), 236, 804, 60, 9);
  // the two scarves, big and identical, held out towards Momo from both sides
  const scarves = [s.prop(B.scarfInk(P), '-64 -30 128 74', 118, 866, 120, 69, 7), s.prop(`<g transform="scale(-1 1)">${B.scarfInk(P)}</g>`, '-64 -30 128 74', 272, 866, 120, 69, 7)];
  moment('e3', () => {
    const m = momo(195, 924, 160, 'momo-e3');
    m.part('.eyes .eye', { sx: 1.3, sy: 1.15 }, true);
    m.part('.mouth', { o: 0 });
    m.part('.mouth-open', { o: 1, s: 1.2 });
    const p = pompon(62, 916, 150, 'pompon-e3', 'r', 'happy');
    const ml = mila(328, 916, 150, 'mila-e3', 'l', 'happy');
    for (const [a, name, dir] of [[p, 'p', 1], [ml, 'm', -1]] as const) {
      a.part('.paws', { y: -10 });
      a.part('.paw-l', { x: dir > 0 ? 62 : -68, y: -8, r: dir > 0 ? -28 : 56 });
      a.part('.paw-r', { x: dir > 0 ? 68 : -62, y: -4, r: dir > 0 ? -56 : 28 });
      const sc = scarves[dir > 0 ? 0 : 1];
      if (!sc) continue;
      s.track(sc, { o: 0, s: 0.6 }, `e3.scarf${name}`).move(0.05, 0.4, { o: 1, s: 1.06 }, EZ.out).move(0.4, 0.7, { s: 1 }, EZ.bouncy);
    }
    pop(huh, 'e3.huh', 0.55, 0.3);
  });
  close();
  balloon(say(T2.e3), 'left:16px;top:650px;max-width:150px', '30%');
  balloon(say(T2.e3), 'left:224px;top:650px;max-width:150px', '70%', 'r');

  // ---- e4a · e4b · e4c · the freeze: three faces --------------------------------------------------------------------------
  told('e4', 962);
  for (const [id, x] of [['e4a', 68], ['e4b', 195], ['e4c', 322]] as const) {
    open(id);
    const x0 = x - 70;
    bg(`${A.toneRect(P, x0, 958, 140, 176, id === 'e4b' ? 't2' : 't1')}${B.gloom(x0, x0 + 140, 960, 40, 9, x)}`, id);
    const drop = fx(id, A.sweatInk(P, 8, id === 'e4c' ? 24 : -24), id === 'e4c' ? x - 40 : x + 40, 1030, 36, 8);
    moment(id, () => {
      const a = id === 'e4a' ? pompon(x, 1136, 300, 'pompon-e4') : id === 'e4b' ? momo(x, 1136, 300, 'momo-e4') : mila(x, 1136, 300, 'mila-e4', 'l');
      a.part('.eyes .eye', { sx: 0.85, sy: 0.85 }, true);
      a.part('.mouth', { o: 0 });
      a.part('.pout', { o: 1 });
      s.track(drop, { o: 0, y: -10 }, `${id}.drop`).move(0.2 + (x % 3) * 0.15, 0.8 + (x % 3) * 0.15, { o: 1, y: 0 }, EZ.out);
    });
    close();
  }
  balloon('…', 'left:140px;top:968px', '60%', 'tiny');

  // ---- e5 · Oh nein. — Tapsi covers his eyes ---------------------------------------------------------------------------------
  told('e5', 1144);
  open('e5');
  bg(`${A.toneRect(P, 0, 1140, M2W, 230, 't1')}<circle cx="195" cy="1260" r="110" fill="url(#${P}-glowW)"/>${B.gloom(110, 280, 1140, 70, 16, 9)}`, 'e5');
  moment('e5', () => {
    const t = tapsi(195, 1334, 250, 'tapsi-e5', undefined, 'sleep', 1.1);
    t.part('.paws', { y: 0 }).move(0.1, 0.5, { y: -44 }, EZ.out);
    t.part('.paw-l', { x: 0, y: 0, r: 0, s: 1 }).move(0.1, 0.5, { x: -2, y: 4, r: 22, s: 1.95 }, EZ.out);
    t.part('.paw-r', { x: 0, y: 0, r: 0, s: 1 }).move(0.1, 0.5, { x: 2, y: 4, r: -22, s: 1.95 }, EZ.out);
    t.part('.mouth', { o: 0 });
    t.part('.pout', { o: 1 });
    t.lift.set(0, { r: 0 }).move(0.4, 0.8, { r: -4 }, EZ.inOut);
  });
  close();
  balloon(say(T2.e5), 'left:24px;top:1166px;max-width:130px', '72%', 'r');

  // ---- e6 · the idea ---------------------------------------------------------------------------------------------------------
  open('e6');
  bg(`<circle cx="100" cy="1500" r="90" fill="url(#${P}-glowW)"/><g transform="translate(100 1500)">${A.burstInk(66, 180, 22, 6)}</g>`, 'e6');
  const bulb = fx('e6', B.bulbInk(P), 150, 1452, 70, 8);
  moment('e6', () => {
    const t = tapsi(96, 1590, 170, 'tapsi-e6', 'r', 'star', 1.15);
    t.part('.paw-r', { x: 0, y: 0, r: 0 }).move(0.1, 0.4, { x: 10, y: -46, r: -40 }, EZ.out);
    t.lift.set(0, { y: 0 }).path(0.1, [[0.3, { y: -10 }, EZ.out], [0.55, { y: 0 }, EZ.in]]);
    pop(bulb, 'e6.bulb', 0.3, 0.3);
  });
  close();
  balloon(say(T2.e6), 'left:18px;top:1384px;max-width:120px', '30%');

  // ---- e7 · a year later: door 21 again ---------------------------------------------------------------------------------------
  open('e7');
  const wall7 = doorWall([19, 20, 21, 26, 27, 28], 3, 236, 1488, 52, 62, 32, 38);
  bg(`<rect x="188" y="1376" width="200" height="206" fill="url(#${P}-t2)"/>${wall7.markup}`, 'e7');
  const glow7 = art(`<circle r="44" fill="url(#${P}-glowW)" opacity=".55"/>`, wall7.d21.x, wall7.d21.y, 92, 1);
  moment('e7', () => {
    s.track(glow7, { o: 0, s: 0.6 }, 'e7.glow').move(0.1, 0.6, { o: 1, s: 1 }, EZ.out);
  });
  close();
  cap(T2.e7, 'left:214px;top:1386px;max-width:156px');

  // ---- e8 · Momo gives Tapsi his wishes -----------------------------------------------------------------------------------------
  told('e8', 1594);
  open('e8');
  bg(`${A.nightTone(P, 0, 1590, M2W, 160, 27, 10)}${A.groundInk('M-10 1844 C90 1838 250 1848 400 1840', 1872)}${A.grassInk(Array.from({ length: 13 }, (_, i) => [8 + i * 30, 1843 + (i % 3)] as const))}`, 'e8');
  const wishes8 = [[204, 1746, 'book'], [250, 1708, 'plant'], [246, 1792, 'kite']] as const;
  const stars8 = wishes8.map(([x, y, k]) => art(B.wishSpot(P, 18, k), x, y, 96, 7));
  moment('e8', () => {
    const m = momo(108, 1856, 200, 'momo-e8', 'r', 'happy');
    m.part('.paws', { y: -16 });
    m.part('.paw-r', { x: 70, y: -16, r: -64 });
    m.part('.paw-l', { x: 58, y: -8, r: -30 });
    const t = tapsi(306, 1856, 180, 'tapsi-e8', 'l', 'star');
    t.part('.paw-l', { x: -40, y: -20, r: 40 });
    stars8.forEach((e, i) => s.track(e, { o: 0.2, x: -54, y: 30, s: 0.6 }, `e8.star${i}`).move(0.1 + i * 0.18, 0.6 + i * 0.18, { o: 1, x: 0, y: 0, s: 1 }, EZ.out));
  });
  close();
  cap(T2.e8, 'left:20px;top:1598px;max-width:220px');

  // ---- e9 · Tapsi lays them out on a leaf, for the friends ------------------------------------------------------------------------
  open('e9');
  bg(`${A.toneRect(P, 0, 1860, M2W, 252, 't1')}${A.groundInk('M-10 2016 C90 2010 250 2020 400 2012', 2112)}`, 'e9');
  art(B.leafInk(P, 230), 176, 2058, 260, 4);
  const stars9 = ([[116, 2050, 'book'], [176, 2040, 'plant'], [236, 2050, 'kite']] as const).map(([x, y, k]) => art(B.wishSpot(P, 20, k), x, y, 110, 6));
  const tw9 = [fx('e9', A.sparkleInk(8), 90, 1990, 20), fx('e9', A.sparkleInk(6), 262, 1984, 16)];
  moment('e9', () => {
    const t = tapsi(330, 2030, 150, 'tapsi-e9', 'l', 'happy');
    t.part('.paw-l', { x: -44, y: 0, r: 30 });
    stars9.forEach((e, i) => s.track(e, { o: 0, y: -26 }, `e9.star${i}`).move(0.1 + i * 0.2, 0.5 + i * 0.2, { o: 1, y: 0 }, EZ.out));
    tw9.forEach((e, i) => pop(e, `e9.tw${i}`, 0.9 + i * 0.2));
  });
  close();
  cap(T2.e9, 'left:20px;top:1884px;max-width:220px');

  // ---- e10 · Pompon picks the book — Tapsi hides it in his cheek (MAMPF) -------------------------------------------------------
  told('e10', 2124);
  open('e10');
  bg(`${A.toneRect(P, 0, 2120, M2W, 282, 't1')}${A.groundInk('M-10 2330 C90 2324 250 2334 400 2326', 2402)}`, 'e10');
  art(B.leafInk(P, 170), 196, 2356, 200, 4);
  art(B.takenSpot(15), 152, 2350, 40, 5);
  art(B.wishSpot(P, 15, 'plant'), 196, 2344, 84, 6);
  art(B.wishSpot(P, 15, 'kite'), 240, 2350, 84, 6);
  const way10 = s.band(`<path d="M152 2336 Q196 2236 262 2290" fill="none" stroke="${A.INK}" stroke-width="1.6" stroke-dasharray="4 4"/>`, 2120, 2400, 5);
  way10.classList.add('sp4-fx');
  way10.dataset['fx'] = 'e10';
  const fly10 = art(B.wishSpot(P, 15, 'book', false), 152, 2350, 60, 8);
  moment('e10', () => {
    const p = pompon(78, 2388, 170, 'pompon-e10');
    p.part('.paw-r', { x: 0, y: 0, r: 0 }).move(0.05, 0.3, { x: 48, y: -24, r: -76 }, EZ.out);
    const t = tapsi(316, 2382, 190, 'tapsi-e10', 'l', 'happy', 1.25);
    const ck = cheekStar(t, 'l', 'm5-ck10');
    s.track(ck, { o: 0 }, 'e10.cheek').move(0.75, 0.9, { o: 1 }, EZ.out);
    s.track(fly10, { o: 1, x: 0, y: 0, s: 1 }, 'e10.fly').path(0.3, [[0.55, { x: 40, y: -84, s: 0.9 }, EZ.out], [0.75, { x: 110, y: -46, s: 0.5 }, EZ.in]]).set(0.77, { o: 0 });
  });
  close();
  balloon(say(T2.e10), 'left:18px;top:2134px;max-width:150px', '40%');
  const mampf10 = art(A.sfxInk(say(SFX.eat), 30, 41, 6), 0, 0, 10, 9, 10);
  mampf10.style.cssText += ';left:226px;top:2238px;width:10px;height:10px;overflow:visible;rotate:-8deg';
  mampf10.dataset['say'] = 'eat';
  moment('e10', () => s.track(mampf10, { o: 0, s: 1.4 }, 'e10.mampf').move(0.75, 0.9, { o: 1, s: 1 }, EZ.in));

  // ---- e11 · Mila: already taken? then the plant ---------------------------------------------------------------------------------
  told('e11', 2414);
  open('e11');
  bg(`${A.toneRect(P, 0, 2390, M2W, 262, 't1')}${A.groundInk('M-10 2590 C90 2584 250 2594 400 2586', 2652)}`, 'e11');
  art(B.leafInk(P, 170), 196, 2614, 200, 4);
  art(B.takenSpot(15), 152, 2608, 40, 5);
  const gone11 = art(B.takenSpot(15), 196, 2602, 40, 5);
  art(B.wishSpot(P, 15, 'kite'), 240, 2608, 84, 6);
  const fly11 = art(B.wishSpot(P, 15, 'plant', false), 196, 2602, 60, 8);
  const look11 = fx('e11', A.surpriseInk(18, 30, -150, -30, 5), 152, 2600, 80, 7);
  moment('e11', () => {
    const m = mila(80, 2644, 170, 'mila-e11', 'r');
    m.part('.face', { x: 0, y: 0 }).move(0.05, 0.3, { x: 3, y: 3 }, EZ.out);
    const t = tapsi(316, 2636, 190, 'tapsi-e11', 'l', 'happy', 1.25);
    cheekStar(t, 'l', 'm5-ck11l');
    const ck = cheekStar(t, 'r', 'm5-ck11r');
    s.track(ck, { o: 0 }, 'e11.cheek').move(0.8, 0.95, { o: 1 }, EZ.out);
    pop(look11, 'e11.look', 0.05, 0.6);
    s.track(gone11, { o: 0 }, 'e11.gone').set(0.62, { o: 1 });
    s.track(fly11, { o: 1, x: 0, y: 0, s: 1 }, 'e11.fly').path(0.35, [[0.6, { x: 60, y: -90, s: 0.9 }, EZ.out], [0.8, { x: 150, y: -50, s: 0.5 }, EZ.in]]).set(0.82, { o: 0 });
  });
  close();
  balloon(say(T2.e11), 'left:18px;top:2420px;max-width:190px', '30%');
  const mampf11 = art(A.sfxInk(say(SFX.eat), 22, 43, 5), 0, 0, 10, 9, 10);
  mampf11.style.cssText += ';left:258px;top:2500px;width:10px;height:10px;overflow:visible;rotate:-6deg';
  moment('e11', () => s.track(mampf11, { o: 0, s: 1.4 }, 'e11.mampf').move(0.8, 0.95, { o: 1, s: 1 }, EZ.in));

  // ---- e12a · e12b · the same list, two views: what the friends see, what Momo sees -------------------------------------------------
  told('e12', 2664);
  open('e12a');
  bg(`${A.toneRect(P, 0, 2660, 200, 222, 't1')}`, 'e12a');
  moment('e12a', () => {
    pompon(58, 2800, 104, 'pompon-e12', 'r', 'happy');
    mila(144, 2800, 104, 'mila-e12', 'l', 'happy');
  });
  art(B.leafInk(P, 140), 100, 2852, 160, 7);
  art(B.takenSpot(13), 64, 2848, 34, 8);
  art(B.takenSpot(13), 100, 2842, 34, 8);
  art(B.wishSpot(P, 13, 'kite'), 136, 2848, 72, 8);
  close();
  cap(T2.e12a, 'left:20px;top:2668px;max-width:160px');
  open('e12b');
  bg(`<rect x="196" y="2660" width="190" height="222" fill="url(#${P}-t1)"/><circle cx="288" cy="2800" r="90" fill="url(#${P}-glowW)"/>`, 'e12b');
  const tw12 = [fx('e12b', A.sparkleInk(7), 226, 2774, 18), fx('e12b', A.sparkleInk(6), 352, 2770, 16)];
  moment('e12b', () => {
    momo(288, 2800, 110, 'momo-e12', undefined, 'happy');
    tw12.forEach((e, i) => pop(e, `e12b.tw${i}`, 0.3 + i * 0.25));
  });
  art(B.leafInk(P, 140), 288, 2852, 160, 7);
  ([[252, 2848, 'book'], [288, 2842, 'plant'], [324, 2848, 'kite']] as const).forEach(([x, y, k]) => art(B.wishSpot(P, 13, k), x, y, 72, 8));
  close();
  cap(T2.e12b, 'left:206px;top:2668px;max-width:160px');

  // ---- e13 · two different gifts, a happy binky ---------------------------------------------------------------------------------
  told('e13', 2894);
  open('e13');
  const wall13 = doorWall([19, 20, 21, 22, 23], 5, 59, 2990, 68, 0, 34, 42, true);
  bg(`<rect x="0" y="2890" width="${M2W}" height="250" fill="url(#${P}-t2)"/>
    <path d="M-10 2926 C80 2914 300 2914 400 2926" fill="none" stroke="${A.INK}" stroke-width="2"/>
    ${B.garland(P, 10, 380, 2940, 11)}${wall13.markup}
    ${A.groundInk('M-10 3170 C90 3164 250 3174 400 3166', 3242)}${A.grassInk(Array.from({ length: 13 }, (_, i) => [8 + i * 30, 3169 + (i % 3)] as const))}`, 'e13');
  art(B.bookGift(P), 140, 3214, 70, 6);
  art(B.plantGift(P), 252, 3212, 70, 6);
  const conf = [fx('e13', B.confetti(120, 150, 12, 5), 84, 3060, 160, 8), fx('e13', B.confetti(120, 150, 12, 9), 306, 3060, 160, 8)];
  const jump = fx('e13', `<g transform="rotate(90)">${A.speedInk(40, 60, 5, 11)}</g>`, 195, 3170, 90, 4);
  moment('e13', () => {
    const m = momo(195, 3150, 180, 'momo-e13', undefined, 'happy');
    m.part('.mouth', { o: 0 });
    m.part('.mouth-open', { o: 1, s: 1.3 });
    m.lift.set(0, { y: 0, r: 0 }).path(0.05, [[0.35, { y: -44, r: 12 }, EZ.out], [0.6, { y: -30, r: -6 }, EZ.inOut], [0.85, { y: -34, r: 8 }, EZ.inOut]]);
    const p = pompon(56, 3226, 140, 'pompon-e13', 'r', 'happy');
    p.part('.paw-l', { x: -10, y: -40, r: 30 });
    p.part('.paw-r', { x: 10, y: -40, r: -30 });
    const ml = mila(334, 3226, 140, 'mila-e13', 'l', 'happy');
    ml.part('.paw-l', { x: -10, y: -40, r: 30 });
    ml.part('.paw-r', { x: 10, y: -40, r: -30 });
    conf.forEach((c, i) => s.track(c, { o: 0, y: -20 }, `e13.conf${i}`).move(0.3 + i * 0.1, 0.9 + i * 0.1, { o: 1, y: 0 }, EZ.out));
    s.track(jump, { o: 0 }, 'e13.jump').move(0.2, 0.45, { o: 1 }, EZ.out);
  });
  close();
  balloon(say(T2.e13), 'left:18px;top:2898px;max-width:180px', '76%', 'r');

  // ---- e14 · Psst. — and one more star peeks out ---------------------------------------------------------------------------------
  told('e14', 3254);
  open('e14');
  bg(`${A.toneRect(P, 0, 3230, M2W, 272, 't1')}<circle cx="262" cy="3420" r="140" fill="url(#${P}-glowW)"/>`, 'e14');
  art(B.leafInk(P, 130), 82, 3470, 150, 6);
  ([[48, 3466], [82, 3460], [116, 3466]] as const).forEach(([x, y]) => art(B.takenSpot(11), x, y, 30, 7));
  const tw14 = [fx('e14', A.sparkleInk(9), 152, 3378, 24, 8), fx('e14', A.sparkleInk(6), 160, 3436, 18, 8)];
  const hush14 = fx('e14', `<g fill="none" stroke="${A.INK}" stroke-width="2.2" stroke-linecap="round"><path d="M0 -8 q5 -5 10 0 t10 0"/><path d="M4 6 q5 -5 10 0 t10 0"/></g>`, 362, 3440, 40, 8);
  moment('e14', () => {
    const t = tapsi(262, 3538, 330, 'tapsi-e14', undefined, 'happy', 1.05);
    t.psst();
    const ck = cheekStar(t, 'l', 'm5-ck14');
    s.track(ck, { o: 0 }, 'e14.cheek').move(0.4, 0.7, { o: 1 }, EZ.out);
    tw14.forEach((e, i) => pop(e, `e14.tw${i}`, 0.6 + i * 0.2));
    s.track(hush14, { o: 0, x: -6 }, 'e14.hush').move(0.2, 0.5, { o: 1, x: 0 }, EZ.out);
  });
  close();
  balloon(say(T2.e14), 'left:20px;top:3262px;max-width:170px', '80%', 'r whisper');

  // ---- the end --------------------------------------------------------------------------------------------------------------------
  cap(T2.tag, 'left:50%;top:3518px;transform:translateX(-50%);width:max-content;max-width:330px;text-align:center;font-size:14px');
  const end = s.node('', 'left:0;top:3600px;width:100%', 'm4-end');
  end.append(Object.assign(document.createElement('b'), { textContent: say(T2.end) }));

  // ---- panel borders (the gutters are the white paper) -----------------------------------------------------------------------------
  s.parent = s.root;
  s.layer(borders.map((d) => `<path d="${d}" fill="none" stroke="${A.INK}" stroke-width="2.6" stroke-linejoin="miter"/>`).join(''), 6);

  const stills = new Beat('still', s.tracksIn(''), { y0: 0, y1: M2H }, 0);
  beats.unshift(stills);
  if (motion) {
    stills.still(0);
    for (const b of beats) if (b !== stills) b.seek(0);
  } else {
    for (const b of beats) b.still();
  }
  const moments = motion ? beats.filter((b) => b !== stills) : [];
  return {
    world: s,
    roll: null,
    moments,
    beats,
    rollers: 0,
    destroy() {
      beats.forEach((b) => b.destroy());
      s.destroy();
    },
  };
}

