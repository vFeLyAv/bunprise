/**
 * "Das Spiel spielt sich kurz an" for the 30.10 games (Felix: «сделай анимации и картинки для новых игр. Добавь так же
 * монополию, уно и другие культовые»; approved 30.10 after «Монополию сделай в виде законченного круга»). Ported 1:1
 * from the gallery, packages/mascot/demo/ideas/newscenes.ts (the source of truth: change it there first, then here).
 *
 * The same rules as scenes.ts: a 240 × 132 viewBox, ≤ 2 s, plays once, only transform / opacity, every moving part ONE
 * Track of the mascot timeline (the same frame for the same time), the end pose = the last frame = the game's picture
 * (reduced motion shows only it). Our own flat drawings in the gift palette (--gift-*): they evoke the game (a pawn on
 * a ring of fields, coloured number cards, a wooden tower), never its box art, artwork, logo or trademarked words.
 *
 * Three groups are new beside the eight of scenes.ts: board (a pawn moves over a printed track), stack (a tower of
 * blocks), shed (get rid of your cards / tiles by colour or number); the rest are new variants of the old groups.
 */

import { Track } from '@bunprise/mascot/timeline';
import { die } from './art';
import { EASE } from './motion';
import { arrive, at, cardRect, flip, flipSvg, floor, FONT, hexPath, k, q, r1, sceneFor, spark, sparkIn, squash, type Archetype, type Look, type Scene } from './scenes';

export type NewVariant =
  | 'cockpit'
  | 'crew'
  | 'flip'
  | 'catan'
  | 'district'
  | 'garden'
  | 'planner'
  | 'street'
  | 'colors'
  | 'ludo'
  | 'letters'
  | 'detective'
  | 'yahtzee'
  | 'tower'
  | 'rummy'
  | 'spot'
  | 'activity';

// ---------------------------------------------------------------------------------------------- helpers

const txt = (x: number, y: number, size: number, fill: string, s: string, weight = 800) =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle">${s}</text>`;

/** A die (26 units, centred), its body in `color`. */
const dieAt = (color: string, face: number) => `<g transform="translate(-13 -13)">${die(face).replace('fill="var(--gift-die)"', `fill="${color}"`)}</g>`;

/** A thrown die: three nested groups (x / y / spin), drawn at its rest place. */
const thrownDie = (key: string, color: string, face: number) => k(`${key}-x`, k(`${key}-y`, k(`${key}-s`, dieAt(color, face), 'play-center')));

/** The die flies in from `from` (offset from its rest place), bounces once and lands at `land`. */
function throwDie(root: ParentNode, key: string, t0: number, land: number, from: { x: number; y: number }, turns = -360): Track[] {
  const x = new Track(q(root, `${key}-x`), `${key}-x`, { x: from.x });
  x.move(t0, land + 0.16, { x: 0 }, 'cubic-bezier(.3,.7,.4,1)');
  const y = new Track(q(root, `${key}-y`), `${key}-y`, { y: from.y });
  y.path(t0, [[land - 0.14, { y: 0 }, EASE.down], [land - 0.04, { y: -7 }, EASE.up], [land + 0.06, { y: 0 }, EASE.down]]);
  const s = new Track(q(root, `${key}-s`), `${key}-s`, { r: 0 });
  s.move(t0, land + 0.16, { r: turns }, 'cubic-bezier(.3,.7,.4,1)');
  return [x, y, s];
}

/** Hops over fields: `fields` = offsets from the rest place, the first = where the piece starts, the last = [0, 0]. */
function hops(tr: Track, t0: number, fields: ReadonlyArray<readonly [number, number]>, step: number, height = 13): number {
  let t = t0;
  for (let i = 1; i < fields.length; i++) {
    const [ax, ay] = fields[i - 1] ?? [0, 0];
    const [bx, by] = fields[i] ?? [0, 0];
    tr.path(t, [[t + step * 0.5, { x: (ax + bx) / 2, y: Math.min(ay, by) - height }, EASE.up], [t + step, { x: bx, y: by }, EASE.down]]);
    t += step;
  }
  return t;
}

/** A world offset seen from a group that is rotated by `rot` degrees (so a rotated piece flies in straight). */
function local(dx: number, dy: number, rot: number): { x: number; y: number } {
  const a = (-rot * Math.PI) / 180;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

/** Thrown in an arc from an offset (invisible at first, unless fade = false: it lies there visibly), lands at its place with a small squash. */
function toss(root: ParentNode, key: string, from: { x: number; y: number; r?: number }, t0: number, t1: number, lift = 16, amount = 0.08, fade = true): Track {
  const r = from.r ?? 0;
  const tr = new Track(q(root, key), key, { x: from.x, y: from.y, r, o: fade ? 0 : 1, sx: 1, sy: 1 });
  const mid = (t0 + t1) / 2;
  tr.path(t0, [
    [t0 + 0.05, { x: from.x * 0.92, y: from.y * 0.92 - 3, r: r * 0.9, o: 1 }, EASE.linear],
    [mid, { x: from.x * 0.45, y: from.y * 0.45 - lift, r: r * 0.4 }, EASE.up],
    [t1, { x: 0, y: 0, r: 0 }, EASE.down],
  ]);
  return squash(tr, t1, amount);
}

/** A generic pawn ("Spielfigur": cone + ball head), its feet at 0, 0. */
const pawn = (c: string, s = 1) =>
  `<g transform="scale(${s})"><ellipse cx="0" cy="-1.6" rx="8.4" ry="2.8" fill="${c}"/><path d="M-7.2 -1.6 C-6.4 -8 -3 -12 -3.4 -15 H3.4 C3 -12 6.4 -8 7.2 -1.6 Z" fill="${c}"/><circle cx="0" cy="-19.4" r="5.6" fill="${c}"/><path d="M-7.2 -1.6 C-6.4 -8 -3 -12 -3.4 -15 H3.4 C3 -12 6.4 -8 7.2 -1.6 Z M0 -25 A5.6 5.6 0 1 1 0 -13.8 A5.6 5.6 0 1 1 0 -25 Z" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1"/><circle cx="-2" cy="-21.2" r="1.7" fill="#fff" opacity=".5"/></g>`;

/** A five-point star centred on 0, 0. */
function star(r: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 ? r * 0.45 : r;
    pts.push(`${r1(rad * Math.cos(a))} ${r1(rad * Math.sin(a))}`);
  }
  return `<path d="M${pts.join(' L')} Z" fill="${fill}" stroke-linejoin="round"/>`;
}

/** A small rounded badge with a word in it ("+15"), centred on 0, -14 (feet at 0, 0). */
const badge = (label: string, w = 36) => `<rect x="${-w / 2}" y="-24" width="${w}" height="20" rx="10" fill="var(--gift-accent)"/>${txt(0, -9.5, 12, '#fff', label)}`;

// ---------------------------------------------------------------------------------------------- coop: Sky Team

/** Two pilots' dice go into the cockpit, the attitude gauge levels out, the plane touches down. */
function cockpitScene(): Scene {
  const slot = (x: number, c: string) =>
    `<rect x="${x - 16}" y="80" width="32" height="32" rx="8" fill="#fff" opacity=".14"/><rect x="${x - 16}" y="80" width="32" height="32" rx="8" fill="none" stroke="var(--gift-cream)" stroke-width="1.6" stroke-dasharray="4 3" opacity=".8"/><rect x="${x - 10}" y="114" width="20" height="3.5" rx="1.75" fill="${c}"/>`;
  const gauge = `<circle r="12.5" fill="var(--gift-sky-light)"/><path d="M-12.5 0 A12.5 12.5 0 0 0 12.5 0 Z" fill="var(--gift-leaf)"/><path d="M-12.5 0 H12.5" stroke="var(--gift-cream)" stroke-width="1.4"/>`;
  const plane = `<path d="M-19 -4.6 L-23.5 -16 H-18 L-10 -7 Z" fill="var(--gift-clay)"/>
    <path d="M-21 -3 C-21 -6 -15 -7 -7 -7 H12 C18.5 -7 23 -4 23 -1 C23 2 18.5 3 12 3 H-15 C-19 3 -21 1 -21 -3 Z" fill="var(--gift-cream)"/>
    <path d="M-21 -3 C-21 -6 -15 -7 -7 -7 H12 C18.5 -7 23 -4 23 -1 C23 2 18.5 3 12 3 H-15 C-19 3 -21 1 -21 -3 Z" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="1"/>
    <path d="M14.5 -5.6 L20 -3 H14.5 Z" fill="var(--gift-sky-dark)"/>${[-9, -4.5, 0, 4.5, 9].map((x) => `<circle cx="${x}" cy="-3" r="1.2" fill="var(--gift-sky-dark)"/>`).join('')}
    <path d="M-5 -0.5 L6 -0.5 L-1 8 H-8 Z" fill="var(--gift-steel-dark)"/>
    <path d="M-6 3 V6 M12 3 V6" stroke="var(--gift-charcoal)" stroke-width="1.4"/><circle cx="-6" cy="6.6" r="1.9" fill="var(--gift-charcoal)"/><circle cx="12" cy="6.6" r="1.9" fill="var(--gift-charcoal)"/>`;
  const cloud = (x: number, y: number, s: number) => at(x, y, `<g transform="scale(${s})" opacity=".85"><circle cx="-8" cy="0" r="6" fill="var(--gift-cream)"/><circle cx="1" cy="-4" r="8" fill="var(--gift-cream)"/><circle cx="10" cy="1" r="5.5" fill="var(--gift-cream)"/><rect x="-12" y="0" width="26" height="6" rx="3" fill="var(--gift-cream)"/></g>`);
  const svg = `${floor(120, 124, 106)}${cloud(176, 30, 1)}${cloud(222, 54, 0.7)}
    <rect x="14" y="64" width="124" height="58" rx="11" fill="var(--gift-sky-dark)"/><rect x="14" y="64" width="124" height="9" rx="4.5" fill="#fff" opacity=".16"/>
    ${slot(42, 'var(--gift-sky)')}${slot(110, 'var(--gift-clay)')}
    ${at(76, 96, `${k('axis', gauge, 'play-center')}<circle r="12.5" fill="none" stroke="var(--gift-charcoal)" stroke-width="2"/><path d="M-8 0 H-2.5 L0 2.6 L2.5 0 H8" stroke="var(--gift-clay-dark)" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)}
    <rect x="146" y="114" width="90" height="8" rx="3" fill="var(--gift-steel-dark)"/>${[156, 174, 192, 210].map((x) => `<rect x="${x}" y="117" width="10" height="2" rx="1" fill="var(--gift-cream)"/>`).join('')}
    ${at(42, 96, thrownDie('blue', 'var(--gift-sky)', 4))}${at(110, 96, thrownDie('orange', 'var(--gift-clay)', 4))}
    ${at(190, 107, k('plane', plane, 'play-center'))}
    ${at(222, 92, k('spark', spark(7), 'play-center'))}`;
  return {
    svg,
    duration: 1.9,
    tracks(root) {
      const axis = new Track(q(root, 'axis'), 'axis', { r: -30 });
      axis.path(0.66, [[0.86, { r: 7 }, EASE.smooth], [1.08, { r: 0 }, EASE.bouncy]]);
      const plane = new Track(q(root, 'plane'), 'plane', { x: -70, y: -76, r: 13, sx: 1, sy: 1 });
      plane.path(0.3, [[1.24, { x: -10, y: -6, r: 3 }, EASE.smooth], [1.42, { x: 0, y: 0, r: 0 }, EASE.down]]);
      squash(plane, 1.42, 0.06);
      return [
        ...throwDie(root, 'blue', 0.02, 0.42, { x: -80, y: -64 }),
        ...throwDie(root, 'orange', 0.18, 0.6, { x: 60, y: -70 }, -450),
        axis,
        plane,
        sparkIn(root, 'spark', 1.5),
      ];
    },
  };
}

// ---------------------------------------------------------------------------------------------- coop: Die Crew

/** A trick played together: the heli (trump) wins it, the task gets its tick, the crew marker moves on. */
function crewScene(): Scene {
  const face = (c: string, ink: string, n: string) => `${cardRect(30, 42, 'var(--gift-card)', 'var(--gift-card-rim)', 4)}<rect x="-11" y="-17" width="22" height="34" rx="3" fill="${c}" opacity=".3"/>${txt(0, 7, 18, ink, n)}`;
  const heli = `${cardRect(30, 42, 'var(--gift-sky-dark)', 'rgba(0,0,0,.15)', 4)}<g transform="translate(0 2)"><path d="M-11 -9 H11 M0 -9 V-5" stroke="var(--gift-butter)" stroke-width="2" stroke-linecap="round"/><ellipse cx="-2" cy="0" rx="7.5" ry="5.4" fill="var(--gift-butter)"/><path d="M4 -1 H12 L13 -4" stroke="var(--gift-butter)" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M-5 -2 C-5 -4 -1 -4 -1 -2 Z" fill="var(--gift-sky-light)"/><path d="M-9 8 H5 M-6 5.4 V8 M2 5.4 V8" stroke="var(--gift-butter)" stroke-width="1.6" stroke-linecap="round"/></g>`;
  const spots: Array<[number, number, number, string]> = [
    [84, 62, -14, face('var(--gift-leaf)', 'var(--gift-leaf-dark)', '7')],
    [106, 54, 6, face('var(--gift-rose)', 'var(--gift-rose-dark)', '4')],
    [124, 68, 16, face('var(--gift-butter-dark)', 'var(--gift-wood-dark)', '9')],
    [102, 76, -3, heli],
  ];
  const from: Array<[number, number, number]> = [[-36, 70, -40], [104, -50, 0], [276, 70, 40], [104, 190, 0]];
  const task = `${cardRect(34, 46, 'var(--gift-card)', 'var(--gift-card-rim)', 5)}<rect x="-12" y="-18" width="24" height="24" rx="3" fill="var(--gift-leaf)" opacity=".3"/>${txt(0, 0, 14, 'var(--gift-leaf-dark)', '7')}<path d="M-9 13 h18" stroke="var(--gift-steel-dark)" stroke-width="2" stroke-linecap="round" opacity=".6"/>`;
  const tick = `<circle r="9" fill="var(--gift-leaf)"/><path d="M-4.4 0.2 L-1.2 3.4 L4.6 -3" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dots = [158, 176, 194, 212].map((x, i) => `<circle cx="${x}" cy="${118 - i * 2}" r="3" fill="var(--gift-wood-light)"/>`).join('');
  const goal = `<path d="M-8 0 L8 -3 L2 -0.6 L4 5 L1 5 L-2 0 L-7 1.6 Z" fill="var(--gift-steel-dark)"/>`;
  const svg = `${floor(116, 122, 90)}<path d="M158 118 C176 116 196 114 228 108" stroke="var(--gift-wood-light)" stroke-width="1.6" stroke-dasharray="3 4" fill="none"/>${dots}${at(229, 106, goal, -10)}
    ${spots.map(([x, y, rot, s], i) => at(x, y, k(`t${i}`, s, 'play-center'), rot)).join('')}
    ${at(196, 44, task, 6)}${at(208, 26, k('tick', tick, 'play-center'))}
    ${at(176, 115, k('crew', `<circle cx="0" cy="-5" r="5.5" fill="var(--gift-clay)"/><circle cx="0" cy="-5" r="5.5" fill="none" stroke="rgba(0,0,0,.2)"/><circle cx="-1.6" cy="-6.6" r="1.6" fill="#fff" opacity=".55"/>`, 'play-feet'))}`;
  return {
    svg,
    duration: 1.85,
    tracks(root) {
      const out: Track[] = spots.map(([x, y, rot], i) => {
        const [fx, fy, fr] = from[i] ?? [104, 190, 0];
        const t0 = 0.04 + i * 0.18;
        const off = local(fx - x, fy - y, rot);
        const tr = new Track(q(root, `t${i}`), `t${i}`, { x: off.x, y: off.y, r: fr - rot, s: 1 });
        tr.move(t0, t0 + 0.34, { x: 0, y: 0, r: 0 }, 'cubic-bezier(.25,.8,.35,1)');
        return tr;
      });
      // the heli (trump) takes the trick
      out[3]?.path(1.0, [[1.14, { s: 1.18, y: -8 }, EASE.up], [1.4, { s: 1.12, y: -6 }, EASE.bouncy]]);
      out.push(sparkIn(root, 'tick', 1.18));
      const crew = new Track(q(root, 'crew'), 'crew', { x: -18, y: 2, sx: 1, sy: 1 });
      const landed = hops(crew, 1.3, [[-18, 2], [0, 0]], 0.24, 12);
      squash(crew, landed, 0.12);
      out.push(crew);
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------- luck: Flip 7

/** «Noch eine!» — seven different numbers flip over in a row, the row jumps, +15. */
function flipScene(): Scene {
  const xs = [30, 60, 90, 120, 150, 180, 210];
  const nums: Array<[string, string]> = [['3', 'var(--gift-sky-dark)'], ['8', 'var(--gift-leaf-dark)'], ['1', 'var(--gift-rose-dark)'], ['12', 'var(--gift-clay-dark)'], ['5', 'var(--gift-wood-dark)'], ['10', 'var(--gift-sky-dark)'], ['7', 'var(--gift-rose-dark)']];
  const back = `${cardRect(26, 36, 'var(--gift-rose-dark)', 'rgba(0,0,0,.15)', 4)}<circle r="7" fill="none" stroke="var(--gift-cream)" stroke-width="1.6" opacity=".6"/><circle r="2.4" fill="var(--gift-cream)" opacity=".6"/>`;
  const front = (n: string, c: string) => `${cardRect(26, 36, 'var(--gift-card)', 'var(--gift-card-rim)', 4)}${txt(0, 6, n.length > 1 ? 15 : 18, c, n)}<circle cx="-8" cy="-12" r="1.8" fill="${c}"/>`;
  const deck = [2, 1, 0].map((i) => at(120 + i * 1.5, 26 - i * 2, back)).join('');
  const svg = `${floor(120, 112, 104)}${deck}
    ${xs.map((x, i) => at(x, 88, k(`m${i}`, flipSvg(`f${i}`, back, front(nums[i]?.[0] ?? '', nums[i]?.[1] ?? '')), 'play-center'))).join('')}
    ${at(206, 42, k('bonus', badge('+15', 40), 'play-feet'))}`;
  return {
    svg,
    duration: 1.95,
    tracks(root) {
      const out: Track[] = [];
      xs.forEach((x, i) => {
        const t0 = 0.04 + i * 0.13;
        const m = new Track(q(root, `m${i}`), `m${i}`, { x: 120 - x, y: 26 - 88, r: -8 + i * 3, o: 0 });
        m.path(t0, [[t0 + 0.04, { x: (120 - x) * 0.96, y: -58, o: 1 }, EASE.linear], [t0 + 0.28, { x: 0, y: 0, r: 0 }, 'cubic-bezier(.25,.8,.35,1)']]);
        // seven different: the row jumps once, one card after the other
        const tj = 1.38 + i * 0.03;
        m.path(tj, [[tj + 0.1, { y: -9 }, EASE.up], [tj + 0.22, { y: 0 }, EASE.down]]);
        out.push(m, ...flip(root, `f${i}`, t0 + 0.2, 0.24));
      });
      const bonus = new Track(q(root, 'bonus'), 'bonus', { y: 16, s: 0.5, o: 0 });
      bonus.path(1.42, [[1.5, { y: 12, s: 0.7, o: 1 }, EASE.linear], [1.86, { y: 0, s: 1 }, EASE.bouncy]]);
      out.push(bonus);
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------- dice: CATAN

/** The dice say 6: the field with the 6 yields grain, a settlement and a road are built. */
function catanScene(): Scene {
  const R = 21;
  const W = R * 1.732;
  const hex = (x: number, y: number, fill: string, detail: string, n: number, key?: string) => {
    const chip = `<circle r="7.4" fill="var(--gift-cream)"/><circle r="7.4" fill="none" stroke="rgba(0,0,0,.18)"/>${txt(0, 3.6, 9.5, n === 6 || n === 8 ? 'var(--gift-rose-dark)' : 'var(--gift-charcoal)', String(n))}`;
    return at(x, y, `<path d="${hexPath(R)}" fill="${fill}"/>${detail}<path d="${hexPath(R)}" fill="none" stroke="var(--gift-cream)" stroke-width="1.6" opacity=".8"/>${at(0, 8, key ? k(key, chip, 'play-center') : chip)}`);
  };
  const wheat = `<path d="M-9 1 V-11 M-4 2 V-13 M1 1 V-12 M6 2 V-10" stroke="var(--gift-wood)" stroke-width="1.8" stroke-linecap="round"/><path d="M-9 -11 l-2 -3 M-9 -11 l2 -3 M-4 -13 l-2 -3 M-4 -13 l2 -3 M1 -12 l-2 -3 M1 -12 l2 -3" stroke="var(--gift-wood)" stroke-width="1.4" stroke-linecap="round"/>`;
  const trees = `<path d="M-10 0 L-5 -13 L0 0 Z M2 0 L7 -12 L12 0 Z" fill="var(--gift-leaf-dark)"/><path d="M-5 -2 L-1 -14 L3 -2 Z" fill="var(--gift-leaf)"/>`;
  const rocks = `<path d="M-12 1 L-4 -12 L1 -5 L5 -10 L12 1 Z" fill="var(--gift-steel-dark)"/><path d="M-4 -12 L-1.5 -7 L-6.5 -7 Z" fill="#fff" opacity=".7"/>`;
  const bricks = `<path d="M-9 -9 h8 v4 h-8 Z M1 -9 h8 v4 h-8 Z M-5 -4 h8 v4 h-8 Z" fill="var(--gift-clay-dark)"/>`;
  const sheep = `<ellipse cx="-2" cy="-6" rx="6" ry="4" fill="var(--gift-cream)"/><circle cx="4.6" cy="-7" r="2.4" fill="var(--gift-charcoal)"/><path d="M-5 -2.5 V0 M1 -2.5 V0" stroke="var(--gift-charcoal)" stroke-width="1.4"/>`;
  const y0 = 38;
  const y1 = y0 + R * 1.5;
  const x0 = 58;
  const svg = `${floor(108, 104, 84)}
    <ellipse cx="108" cy="58" rx="86" ry="50" fill="var(--gift-sky)" opacity=".45"/>
    ${hex(x0, y0, 'var(--gift-butter)', wheat, 6, 'chip6')}${hex(x0 + W, y0, 'var(--gift-leaf)', trees, 9)}${hex(x0 + 2 * W, y0, 'var(--gift-steel)', rocks, 4)}
    ${hex(x0 + W / 2, y1, 'var(--gift-clay)', bricks, 8)}${hex(x0 + W * 1.5, y1, 'var(--gift-leaf-light)', sheep, 5)}${hex(x0 + W * 2.5, y1, 'var(--gift-butter)', wheat, 10)}
    ${at(x0 + W / 2 + W / 4, y1 - R + R / 4, k('road', `<rect x="-10" y="-2.6" width="20" height="5.2" rx="2" fill="var(--gift-sky-dark)"/><rect x="-10" y="-2.6" width="20" height="5.2" rx="2" fill="none" stroke="rgba(0,0,0,.25)"/>`, 'play-center'), 30)}
    ${at(x0 + W / 2, y1 - R + 4, k('house', `<path d="M-6.5 0 V-8 L0 -14 L6.5 -8 V0 Z" fill="var(--gift-sky-dark)"/><path d="M-6.5 0 V-8 L0 -14 L6.5 -8 V0 Z" fill="none" stroke="rgba(0,0,0,.25)"/><rect x="-2" y="-5" width="4" height="5" fill="var(--gift-cream)" opacity=".8"/>`, 'play-feet'))}
    ${at(194, 34, thrownDie('d1', 'var(--gift-die)', 2))}${at(222, 40, thrownDie('d2', 'var(--gift-die)', 4))}
    ${at(208, 98, k('res', `${cardRect(28, 38, 'var(--gift-card)', 'var(--gift-card-rim)', 4)}<rect x="-10" y="-14" width="20" height="22" rx="3" fill="var(--gift-butter)"/><g transform="translate(1 5) scale(.8)">${wheat}</g>`, 'play-center'), 8)}`;
  return {
    svg,
    duration: 1.95,
    tracks(root) {
      const chip = new Track(q(root, 'chip6'), 'chip6', { s: 1 });
      chip.path(0.66, [[0.8, { s: 1.5 }, EASE.up], [1.06, { s: 1 }, EASE.bouncy]]);
      const res = arrive(root, 'res', { ...local(x0 - 208, y0 - 98, 8), s: 0.4, r: -24, o: 0 }, 0.86, 1.32, EASE.smooth);
      const house = new Track(q(root, 'house'), 'house', { y: -40, o: 0, sx: 1, sy: 1 });
      house.path(1.08, [[1.13, { y: -34, o: 1 }, EASE.linear], [1.34, { y: 0 }, EASE.down]]);
      squash(house, 1.34, 0.14);
      const road = arrive(root, 'road', { x: 26, y: -10, r: 30, o: 0 }, 1.36, 1.72, EASE.bouncy);
      return [...throwDie(root, 'd1', 0, 0.44, { x: 90, y: -60 }), ...throwDie(root, 'd2', 0.06, 0.5, { x: 70, y: -66 }, -450), chip, res, house, road];
    },
  };
}

// ---------------------------------------------------------------------------------------------- tiles: Cities

/** A figure goes into a row, the row's city tile completes the 3 × 3 quarter, a building grows on its lot. */
function districtScene(): Scene {
  const C = 24;
  const cx = (c: number) => 78 + c * 26;
  const cy = (r: number) => 34 + r * 26;
  const cell = (kind: 'park' | 'water' | 'houses' | 'plaza' | 'lot') => {
    const base = (fill: string) => `<rect x="${-C / 2}" y="${-C / 2}" width="${C}" height="${C}" rx="3" fill="${fill}"/>`;
    switch (kind) {
      case 'park':
        return `${base('var(--gift-leaf-light)')}<circle cx="-4" cy="-3" r="5" fill="var(--gift-leaf-dark)"/><circle cx="5" cy="4" r="4" fill="var(--gift-leaf)"/>`;
      case 'water':
        return `${base('var(--gift-sky)')}<path d="M-8 -2 C-5 -5 -2 1 1 -2 C4 -5 7 1 9 -2 M-8 5 C-5 2 -2 8 1 5 C4 2 7 8 9 5" stroke="var(--gift-cream)" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;
      case 'houses':
        return `${base('var(--gift-steel)')}<path d="M-9 7 V-1 L-4.5 -6 L0 -1 V7 Z" fill="var(--gift-rose-dark)"/><path d="M1 7 V-3 L5 -8 L9 -3 V7 Z" fill="var(--gift-clay)"/>`;
      case 'plaza':
        return `${base('var(--gift-butter)')}<circle r="6" fill="var(--gift-sky)"/><circle r="6" fill="none" stroke="var(--gift-wood)" stroke-width="1.4"/>`;
      case 'lot':
        return `${base('var(--gift-clay)')}<rect x="-8" y="-8" width="16" height="16" rx="2" fill="none" stroke="var(--gift-cream)" stroke-width="1.3" stroke-dasharray="3 2" opacity=".8"/>`;
    }
  };
  const layout: Array<'park' | 'water' | 'houses' | 'plaza' | 'lot'> = ['park', 'water', 'houses', 'plaza', 'houses', 'park', 'water', 'lot'];
  const cells = layout.map((kind, i) => at(cx(i % 3), cy(Math.floor(i / 3)), cell(kind))).join('');
  const block = (c: string, top: string) => `<rect x="-9" y="-9" width="18" height="9" rx="1.5" fill="${c}"/><rect x="-9" y="-9" width="18" height="2.4" rx="1" fill="${top}"/><rect x="-6" y="-5.4" width="3" height="3" fill="var(--gift-cream)" opacity=".8"/><rect x="-1.5" y="-5.4" width="3" height="3" fill="var(--gift-cream)" opacity=".8"/><rect x="3" y="-5.4" width="3" height="3" fill="var(--gift-cream)" opacity=".8"/>`;
  const rows = [0, 1, 2, 3].map((i) => `<rect x="168" y="${20 + i * 22}" width="58" height="18" rx="5" fill="var(--gift-card)"/><rect x="168" y="${20 + i * 22}" width="58" height="18" rx="5" fill="none" stroke="var(--gift-card-rim)"/><rect x="200" y="${23 + i * 22}" width="22" height="12" rx="2" fill="${['var(--gift-leaf-light)', 'var(--gift-sky)', 'var(--gift-steel)', 'var(--gift-butter)'][i] ?? ''}" opacity=".9"/>`).join('');
  const svg = `${floor(118, 122, 100)}<rect x="62" y="18" width="80" height="80" rx="7" fill="var(--gift-wood-light)"/>${cells}${rows}
    ${at(182, 50, k('worker', pawn('var(--gift-rose-dark)', 0.62), 'play-feet'))}
    ${at(cx(2), cy(2), k('tile', cell('park'), 'play-center'))}
    ${[0, 1, 2].map((i) => at(cx(1), cy(2) + 10 - i * 9, k(`b${i}`, block(i === 1 ? 'var(--gift-clay-dark)' : 'var(--gift-clay)', 'var(--gift-butter)'), 'play-feet'))).join('')}
    ${at(152, 28, k('spark', spark(7), 'play-center'))}`;
  return {
    svg,
    duration: 1.95,
    tracks(root) {
      const worker = new Track(q(root, 'worker'), 'worker', { y: -34, o: 0, sx: 1, sy: 1 });
      worker.path(0.04, [[0.09, { y: -28, o: 1 }, EASE.linear], [0.3, { y: 0 }, EASE.down]]);
      squash(worker, 0.3, 0.14);
      // the tile comes out of the row the figure stands in
      const tile = new Track(q(root, 'tile'), 'tile', { x: 211 - cx(2), y: 51 - cy(2), r: 20, s: 0.7, sx: 1, sy: 1 });
      tile.path(0.42, [[0.66, { x: 30, y: -14, r: 10, s: 1.08 }, EASE.up], [0.88, { x: 0, y: 0, r: 0, s: 1 }, EASE.down]]);
      const out: Track[] = [worker, tile];
      [0, 1, 2].forEach((i) => {
        const t = 1.0 + i * 0.18;
        const b = new Track(q(root, `b${i}`), `b${i}`, { y: -36, o: 0, sx: 1, sy: 1 });
        b.path(t, [[t + 0.05, { y: -30, o: 1 }, EASE.linear], [t + 0.24, { y: 0 }, EASE.down]]);
        squash(b, t + 0.24, 0.1);
        out.push(b);
      });
      out.push(sparkIn(root, 'spark', 1.58));
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------- pattern: Wildwuchs

/** A seed goes into the bed, the flowers of one colour grow, the bee sets off a combo. */
function gardenScene(): Scene {
  const flower = (c: string, h: number) =>
    `<path d="M0 0 V${-h}" stroke="var(--gift-leaf-dark)" stroke-width="3" stroke-linecap="round"/><ellipse cx="-5" cy="${-h * 0.42}" rx="5" ry="2.4" fill="var(--gift-leaf)" transform="rotate(-30 -5 ${-h * 0.42})"/><ellipse cx="5" cy="${-h * 0.62}" rx="5" ry="2.4" fill="var(--gift-leaf)" transform="rotate(30 5 ${-h * 0.62})"/>
     ${[0, 72, 144, 216, 288].map((a) => `<circle cx="${r1(Math.cos((a * Math.PI) / 180) * 5.6)}" cy="${r1(-h + Math.sin((a * Math.PI) / 180) * 5.6)}" r="4.6" fill="${c}"/>`).join('')}<circle cx="0" cy="${-h}" r="3.4" fill="var(--gift-butter-dark)"/>`;
  const plants: Array<[number, string, number]> = [[44, 'var(--gift-rose)', 40], [80, 'var(--gift-butter-dark)', 34], [116, 'var(--gift-sky)', 28], [152, 'var(--gift-rose)', 46], [190, 'var(--gift-sky)', 24]];
  const bee = `<ellipse cx="-2" cy="-7" rx="4" ry="5" fill="var(--gift-cream)" opacity=".9" transform="rotate(-20 -2 -7)"/><ellipse cx="3" cy="-7" rx="4" ry="5" fill="var(--gift-cream)" opacity=".9" transform="rotate(20 3 -7)"/><ellipse cx="0" cy="0" rx="7" ry="5" fill="var(--gift-butter-dark)"/><path d="M-2 -4.6 V4.6 M2.4 -4.4 V4.4" stroke="var(--gift-charcoal)" stroke-width="1.8"/><circle cx="6.4" cy="-1" r="2.4" fill="var(--gift-charcoal)"/>`;
  const svg = `${floor(120, 124, 104)}<rect x="20" y="98" width="200" height="22" rx="10" fill="var(--gift-wood-dark)"/><rect x="20" y="98" width="200" height="6" rx="3" fill="var(--gift-wood)"/>
    ${plants.map(([x, c, h], i) => at(x, 102, i === 4 ? flower(c, h) : k(`fl${i}`, flower(c, h), 'play-feet'))).join('')}
    ${at(116, 102, k('seed', `<ellipse cx="0" cy="-3" rx="3.2" ry="4.4" fill="var(--gift-wood)"/><ellipse cx="-0.8" cy="-4" rx="1" ry="1.8" fill="#fff" opacity=".4"/>`, 'play-center'))}
    ${at(92, 60, k('bee', bee, 'play-center'))}
    ${at(212, 40, k('spark', spark(7), 'play-center'))}`;
  return {
    svg,
    duration: 1.95,
    tracks(root) {
      const seed = new Track(q(root, 'seed'), 'seed', { y: -78, o: 0, s: 1 });
      seed.path(0.04, [[0.09, { y: -70, o: 1 }, EASE.linear], [0.36, { y: 0 }, EASE.down], [0.5, { y: 4, o: 0, s: 0.6 }, EASE.smooth]]);
      const grow = (i: number, t: number, from: { sx: number; sy: number; o?: number }) => {
        const tr = new Track(q(root, `fl${i}`), `fl${i}`, { ...from });
        const to = from.o === undefined ? { sx: 1, sy: 1 } : { sx: 1, sy: 1, o: 1 };
        tr.path(t, [[t + 0.36, to, EASE.bouncy]]);
        return tr;
      };
      // the new sky flower sprouts; the roses grow; the bee lands at the yellow one and it grows too
      const sprout = new Track(q(root, 'fl2'), 'fl2', { sx: 0.2, sy: 0.05, o: 0 });
      sprout.path(0.42, [[0.46, { sx: 0.3, sy: 0.12, o: 1 }, EASE.linear], [0.84, { sx: 1, sy: 1 }, EASE.bouncy]]);
      const bee = new Track(q(root, 'bee'), 'bee', { x: -96, y: -40, r: -12, o: 0 });
      bee.path(0.9, [[0.96, { x: -86, y: -40, o: 1 }, EASE.linear], [1.16, { x: -50, y: -18, r: 8 }, EASE.smooth], [1.34, { x: -20, y: -34, r: -6 }, EASE.smooth], [1.52, { x: 0, y: 0, r: 0 }, EASE.smooth]]);
      return [seed, sprout, grow(0, 0.72, { sx: 0.6, sy: 0.4 }), grow(3, 0.8, { sx: 0.6, sy: 0.36 }), bee, grow(1, 1.42, { sx: 0.6, sy: 0.4 }), sparkIn(root, 'spark', 1.56)];
    },
  };
}

// ---------------------------------------------------------------------------------------------- pattern: Happy Holiday

/** A city tile goes into the holiday planner next to the same city, suitcases are packed, the days bring stars. */
function plannerScene(): Scene {
  const beach = `<rect x="-14" y="-16" width="28" height="32" rx="4" fill="var(--gift-sky)"/><path d="M-14 4 C-6 0 6 0 14 3 V12 C14 14 12 16 10 16 H-10 C-12 16 -14 14 -14 12 Z" fill="var(--gift-butter)"/><circle cx="6" cy="-8" r="4.6" fill="var(--gift-butter-dark)"/><path d="M-6 6 V-6 M-6 -6 C-10 -8 -12 -5 -12 -4 M-6 -6 C-2 -8 0 -5 0 -4" stroke="var(--gift-leaf-dark)" stroke-width="1.8" fill="none" stroke-linecap="round"/><rect x="-14" y="-16" width="28" height="32" rx="4" fill="none" stroke="rgba(0,0,0,.14)"/>`;
  const hills = `<rect x="-14" y="-16" width="28" height="32" rx="4" fill="var(--gift-sky-light)"/><path d="M-14 8 L-4 -8 L3 2 L7 -3 L14 6 V12 C14 14 12 16 10 16 H-10 C-12 16 -14 14 -14 12 Z" fill="var(--gift-steel-dark)"/><path d="M-4 -8 L-1.4 -4 L-6.4 -4 Z" fill="#fff"/><path d="M-14 10 H14 V12 C14 14 12 16 10 16 H-10 C-12 16 -14 14 -14 12 Z" fill="var(--gift-leaf)"/><rect x="-14" y="-16" width="28" height="32" rx="4" fill="none" stroke="rgba(0,0,0,.14)"/>`;
  const sx = (i: number) => 36 + i * 34;
  const slots = [0, 1, 2, 3, 4, 5].map((i) => at(sx(i), 94, `${i > 2 ? `<rect x="-14" y="-16" width="28" height="32" rx="4" fill="none" stroke="var(--gift-wood-light)" stroke-width="1.4" stroke-dasharray="3 3"/>` : ''}${txt(0, 30, 7.5, 'var(--gift-wood-dark)', String(i + 1), 700)}`)).join('');
  const suitcase = (c: string) => `<path d="M-4 -12 V-15 H4 V-12" stroke="var(--gift-charcoal)" stroke-width="1.8" fill="none"/><rect x="-9" y="-12" width="18" height="12" rx="2.5" fill="${c}"/><path d="M-4 -12 V0 M4 -12 V0" stroke="rgba(0,0,0,.18)" stroke-width="1.4"/>`;
  const svg = `${floor(120, 128, 104)}<rect x="14" y="70" width="212" height="56" rx="9" fill="var(--gift-card)"/><rect x="14" y="70" width="212" height="56" rx="9" fill="none" stroke="var(--gift-card-rim)"/>
    ${slots}${at(sx(0), 94, hills)}${at(sx(1), 94, beach)}
    ${at(sx(2), 94, k('tile', beach, 'play-center'))}
    <path d="M168 46 H232" stroke="var(--gift-wood)" stroke-width="2.4" stroke-linecap="round"/>${at(176, 46, suitcase('var(--gift-clay)'))}
    ${at(198, 46, k('s0', suitcase('var(--gift-leaf)'), 'play-feet'))}${at(220, 46, k('s1', suitcase('var(--gift-sky-dark)'), 'play-feet'))}
    ${[0, 1, 2].map((i) => at((sx(1) + sx(2)) / 2 + (i - 1) * 18, i === 1 ? 56 : 61, k(`st${i}`, star(i === 1 ? 7.5 : 6, 'var(--gift-butter-dark)'), 'play-center'))).join('')}`;
  return {
    svg,
    duration: 1.8,
    tracks(root) {
      const tile = new Track(q(root, 'tile'), 'tile', { x: 40 - sx(2), y: 24 - 94, r: -16, sx: 1, sy: 1 });
      tile.path(0.04, [[0.3, { x: (40 - sx(2)) * 0.4, y: -52, r: -6 }, EASE.up], [0.56, { x: 0, y: 0, r: 0 }, EASE.down]]);
      squash(tile, 0.56, 0.07);
      return [
        tile,
        toss(root, 's0', { x: 40 - 198, y: 26 - 46, r: -20 }, 0.5, 0.86, 14, 0.12),
        toss(root, 's1', { x: 40 - 220, y: 26 - 46, r: -20 }, 0.64, 1.0, 14, 0.12),
        sparkIn(root, 'st0', 1.08),
        sparkIn(root, 'st1', 1.2),
        sparkIn(root, 'st2', 1.32),
      ];
    },
  };
}

// ---------------------------------------------------------------------------------------------- board: Monopoly

/**
 * A CLOSED square ring of fields (Felix 30.10: «в виде законченного круга — по кругу идёшь»): four corners (the start
 * corner with its arrow), streets with a colour band on the inner edge, the middle free. Roll 1 + 3: the pawn walks
 * four fields round the corner, the street's card comes up in the middle, a little house is built on the street.
 */
function streetScene(): Scene {
  const B = 120;
  const bx = 112;
  const by = 6;
  const C = 22;
  const W = (B - 2 * C) / 4;
  type Side = 'bottom' | 'left' | 'top' | 'right' | 'corner';
  /** Centre of field n, clockwise from the start corner (bottom right) — the way the pawn walks. */
  const field = (n: number): [number, number, Side] => {
    if (n === 0) return [bx + B - C / 2, by + B - C / 2, 'corner'];
    if (n < 5) return [bx + B - C - W * (n - 1) - W / 2, by + B - C / 2, 'bottom'];
    if (n === 5) return [bx + C / 2, by + B - C / 2, 'corner'];
    if (n < 10) return [bx + C / 2, by + B - C - W * (n - 6) - W / 2, 'left'];
    if (n === 10) return [bx + C / 2, by + C / 2, 'corner'];
    if (n < 15) return [bx + C + W * (n - 11) + W / 2, by + C / 2, 'top'];
    if (n === 15) return [bx + B - C / 2, by + C / 2, 'corner'];
    return [bx + B - C / 2, by + C + W * (n - 16) + W / 2, 'right'];
  };
  // streets in groups of three (our own colours), "?" = a card field
  const SKY = 'var(--gift-sky)';
  const ROSE = 'var(--gift-rose-dark)';
  const BUTTER = 'var(--gift-butter-dark)';
  const LEAF = 'var(--gift-leaf)';
  const bands: Record<number, string> = { 1: SKY, 3: SKY, 4: SKY, 2: '?', 6: ROSE, 7: ROSE, 9: ROSE, 8: '?', 11: BUTTER, 13: BUTTER, 14: BUTTER, 12: '?', 16: LEAF, 17: LEAF, 19: LEAF, 18: '?' };
  const cell = (n: number) => {
    const [x, y, side] = field(n);
    const w = side === 'left' || side === 'right' || side === 'corner' ? C : W;
    const h = side === 'top' || side === 'bottom' || side === 'corner' ? C : W;
    const base = `<rect x="${r1(-w / 2)}" y="${r1(-h / 2)}" width="${r1(w)}" height="${r1(h)}" fill="var(--gift-card)" stroke="var(--gift-card-rim)" stroke-width="1"/>`;
    let inner = '';
    if (n === 0) inner = `<path d="M7 0 H-6 M-1.5 -4.6 L-6.4 0 L-1.5 4.6" stroke="var(--gift-rose-dark)" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if (n === 5) inner = `<rect x="-5" y="-5" width="10" height="10" fill="none" stroke="var(--gift-steel-dark)" stroke-width="1.4"/><path d="M-1.7 -5 V5 M1.7 -5 V5" stroke="var(--gift-steel-dark)" stroke-width="1.4"/>`;
    else if (n === 10) inner = `<circle r="4.4" fill="none" stroke="var(--gift-sky-dark)" stroke-width="1.6"/>`;
    else if (n === 15) inner = `<path d="M-4 -4 L4 4 M4 -4 L-4 4" stroke="var(--gift-steel-dark)" stroke-width="1.6" stroke-linecap="round"/>`;
    else {
      const b = bands[n] ?? '';
      if (b === '?') inner = txt(0, 3.6, 10, 'var(--gift-clay-dark)', '?');
      else {
        const band =
          side === 'bottom' ? `<rect x="${r1(-w / 2)}" y="${r1(-h / 2)}" width="${r1(w)}" height="6" fill="${b}"/>`
          : side === 'top' ? `<rect x="${r1(-w / 2)}" y="${r1(h / 2 - 6)}" width="${r1(w)}" height="6" fill="${b}"/>`
          : side === 'left' ? `<rect x="${r1(w / 2 - 6)}" y="${r1(-h / 2)}" width="6" height="${r1(h)}" fill="${b}"/>`
          : `<rect x="${r1(-w / 2)}" y="${r1(-h / 2)}" width="6" height="${r1(h)}" fill="${b}"/>`;
        inner = band;
      }
    }
    return at(x, y, `${base}${inner}`);
  };
  const ring = Array.from({ length: 20 }, (_, n) => cell(n)).join('');
  /** Where the pawn stands on field n (its feet). */
  const stand = (n: number): [number, number] => {
    const [x, y, side] = field(n);
    return side === 'left' ? [x - 3, y + 6] : side === 'bottom' ? [x, y + 7] : [x, y + 6];
  };
  const [rx, ry] = stand(7);
  const [fx, fy] = field(7);
  const deed = `${cardRect(36, 46, 'var(--gift-card)', 'var(--gift-card-rim)', 4)}<rect x="-14" y="-19" width="28" height="11" rx="2" fill="${ROSE}"/><path d="M-8 -13.5 h16" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>${[-2, 4, 10, 16].map((y) => `<path d="M-11 ${y} h16" stroke="var(--gift-steel-dark)" stroke-width="1.6" stroke-linecap="round" opacity=".55"/><circle cx="10" cy="${y}" r="1.3" fill="var(--gift-steel-dark)" opacity=".55"/>`).join('')}`;
  const house = `<path d="M-4.6 0 V-5 L0 -9 L4.6 -5 V0 Z" fill="var(--gift-leaf)"/><path d="M-4.6 0 V-5 L0 -9 L4.6 -5 V0 Z" fill="none" stroke="var(--gift-leaf-dark)" stroke-width="1.1"/>`;
  const svg = `${floor(142, 128, 110)}<rect x="${bx}" y="${by}" width="${B}" height="${B}" rx="3" fill="var(--gift-leaf-light)" opacity=".4"/>${ring}
    <rect x="${bx}" y="${by}" width="${B}" height="${B}" rx="3" fill="none" stroke="var(--gift-card-rim)" stroke-width="1.4"/>
    ${at(bx + B / 2, by + B / 2, k('deed', deed, 'play-center'), -6)}
    ${at(fx + C / 2 - 3, fy + 4, k('house', house, 'play-feet'))}
    ${at(rx, ry, k('pawn', pawn('var(--gift-sky-dark)', 0.6), 'play-feet'))}
    ${at(46, 46, thrownDie('d1', 'var(--gift-die)', 1))}${at(74, 74, thrownDie('d2', 'var(--gift-die)', 3))}`;
  return {
    svg,
    duration: 1.95,
    tracks(root) {
      const path = [3, 4, 5, 6, 7].map((n) => {
        const [x, y] = stand(n);
        return [x - rx, y - ry] as const;
      });
      const first = path[0] ?? [0, 0];
      const p = new Track(q(root, 'pawn'), 'pawn', { x: first[0], y: first[1], sx: 1, sy: 1 });
      const landed = hops(p, 0.56, path, 0.17, 10);
      squash(p, landed, 0.12);
      const deed = arrive(root, 'deed', { ...local(fx - (bx + B / 2), fy - (by + B / 2), -6), s: 0.25, r: -14, o: 0 }, landed - 0.04, landed + 0.36, EASE.bouncy);
      const h = new Track(q(root, 'house'), 'house', { y: -26, o: 0, sx: 1, sy: 1 });
      h.path(1.4, [[1.45, { y: -22, o: 1 }, EASE.linear], [1.62, { y: 0 }, EASE.down]]);
      squash(h, 1.62, 0.14);
      return [...throwDie(root, 'd1', 0, 0.4, { x: -90, y: -40 }, 360), ...throwDie(root, 'd2', 0.06, 0.46, { x: -110, y: -50 }, 450), p, deed, h];
    },
  };
}

// ---------------------------------------------------------------------------------------------- shed: UNO-like colour cards

/** Same colour, same number, same colour again — the last card in the hand (a colour change) calls out. */
function colorsScene(): Scene {
  const card = (bg: string, n: string) => `${cardRect(34, 50, bg, 'rgba(0,0,0,.16)', 5)}<rect x="-13" y="-21" width="26" height="42" rx="4" fill="none" stroke="#fff" stroke-width="1.4" opacity=".55"/><circle r="11" fill="#fff"/>${txt(0, 6, 16, bg, n)}${txt(-10, -12, 8, '#fff', n)}`;
  const wild = `${cardRect(34, 50, 'var(--gift-charcoal)', 'rgba(0,0,0,.2)', 5)}<rect x="-13.5" y="-21.5" width="27" height="43" rx="4" fill="none" stroke="#fff" stroke-width="1.2" opacity=".4"/><path d="M0 0 V-12 A12 12 0 0 1 12 0 Z" fill="var(--gift-rose-dark)"/><path d="M0 0 H12 A12 12 0 0 1 0 12 Z" fill="var(--gift-sky-dark)"/><path d="M0 0 V12 A12 12 0 0 1 -12 0 Z" fill="var(--gift-leaf)"/><path d="M0 0 H-12 A12 12 0 0 1 0 -12 Z" fill="var(--gift-butter-dark)"/><circle r="12" fill="none" stroke="#fff" stroke-width="1.6"/>`;
  const back = `${cardRect(34, 50, 'var(--gift-charcoal)', 'rgba(0,0,0,.2)', 5)}<rect x="-13.5" y="-21.5" width="27" height="43" rx="4" fill="none" stroke="#fff" stroke-width="1.2" opacity=".4"/>${['var(--gift-rose-dark)', 'var(--gift-butter-dark)', 'var(--gift-leaf)', 'var(--gift-sky-dark)'].map((c, i) => `<circle cx="${i % 2 ? 5 : -5}" cy="${i < 2 ? -5 : 5}" r="3.6" fill="${c}"/>`).join('')}`;
  // the discard pile fans out to the right, so every played card stays visible (its corner number)
  const pile: Array<[number, number, number, string]> = [
    [104, 63, -6, card('var(--gift-rose-dark)', '2')],
    [118, 62, 5, card('var(--gift-sky-dark)', '2')],
    [132, 64, 16, card('var(--gift-sky-dark)', '5')],
  ];
  const svg = `${floor(116, 112, 76)}${at(30, 40, back, -8)}${at(34, 37, back, -4)}
    ${at(90, 66, card('var(--gift-rose-dark)', '7'), -16)}
    ${pile.map(([x, y, rot, s], i) => at(x, y, k(`c${i}`, s, 'play-center'), rot)).join('')}
    ${at(196, 108, k('last', wild, 'play-feet'), 8)}
    ${at(206, 48, k('call', `<path d="M-15 -14 H15 C18 -14 20 -12 20 -9 V5 C20 8 18 10 15 10 H-2 L-8 17 L-7 10 H-15 C-18 10 -20 8 -20 5 V-9 C-20 -12 -18 -14 -15 -14 Z" fill="var(--gift-cream)"/><path d="M-15 -14 H15 C18 -14 20 -12 20 -9 V5 C20 8 18 10 15 10 H-2 L-8 17 L-7 10 H-15 C-18 10 -20 8 -20 5 V-9 C-20 -12 -18 -14 -15 -14 Z" fill="none" stroke="rgba(0,0,0,.18)"/><rect x="-12" y="-9" width="10" height="14" rx="2" fill="var(--gift-rose-dark)"/>${txt(-7, 1, 8, '#fff', '1')}${txt(8, 4.5, 15, 'var(--gift-accent)', '!')}`, 'play-center'))}`;
  return {
    svg,
    duration: 1.75,
    tracks(root) {
      const out: Track[] = pile.map(([x, y, rot], i) => {
        const t0 = 0.05 + i * 0.3;
        const off = local(192 - x, 96 - y, rot);
        const tr = new Track(q(root, `c${i}`), `c${i}`, { x: off.x, y: off.y, r: 20 - rot, sx: 1, sy: 1 });
        tr.path(t0, [[t0 + 0.14, { x: off.x * 0.5, y: off.y * 0.5 - 10, r: (20 - rot) * 0.4 }, EASE.up], [t0 + 0.3, { x: 0, y: 0, r: 0 }, EASE.down]]);
        squash(tr, t0 + 0.3, 0.05);
        return tr;
      });
      const last = new Track(q(root, 'last'), 'last', { r: 0, y: 0 });
      last.path(1.04, [[1.14, { r: -8, y: -6 }, EASE.up], [1.42, { r: 0, y: 0 }, EASE.bouncy]]);
      const call = new Track(q(root, 'call'), 'call', { s: 0.3, o: 0, r: -14 });
      call.path(1.12, [[1.2, { s: 0.6, o: 1, r: -8 }, EASE.linear], [1.5, { s: 1, r: 0 }, EASE.bouncy]]);
      return [...out, last, call];
    },
  };
}

// ---------------------------------------------------------------------------------------------- board: Mensch ärgere Dich nicht

/**
 * The cross-shaped track (a closed loop of 40 fields), four coloured home corners and the coloured goal lanes. A four:
 * the red pawn walks four fields round the corner — onto the yellow one, which flies back into its home.
 */
function ludoScene(): Scene {
  const G = 11;
  const cx = (c: number) => 140 + (c - 5) * G;
  const cy = (r: number) => 66 + (r - 5) * G;
  const LOOP: ReadonlyArray<readonly [number, number]> = [
    [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [10, 5],
    [10, 6], [9, 6], [8, 6], [7, 6], [6, 6], [6, 7], [6, 8], [6, 9], [6, 10], [5, 10], [4, 10], [4, 9], [4, 8], [4, 7], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 5],
  ];
  const RED = 'var(--gift-rose-dark)';
  const YELLOW = 'var(--gift-butter-dark)';
  const GREEN = 'var(--gift-leaf)';
  const BLUE = 'var(--gift-sky-dark)';
  // each player: colour, start field, goal lane, home corner
  const players: Array<{ c: string; start: [number, number]; lane: Array<[number, number]>; home: Array<[number, number]> }> = [
    { c: RED, start: [0, 4], lane: [[1, 5], [2, 5], [3, 5], [4, 5]], home: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    { c: YELLOW, start: [6, 0], lane: [[5, 1], [5, 2], [5, 3], [5, 4]], home: [[9, 0], [10, 0], [9, 1], [10, 1]] },
    { c: GREEN, start: [10, 6], lane: [[9, 5], [8, 5], [7, 5], [6, 5]], home: [[9, 9], [10, 9], [9, 10], [10, 10]] },
    { c: BLUE, start: [4, 10], lane: [[5, 9], [5, 8], [5, 7], [5, 6]], home: [[0, 9], [1, 9], [0, 10], [1, 10]] },
  ];
  const dot = (c: number, r: number, fill: string, ring = 'var(--gift-wood)') => `<circle cx="${cx(c)}" cy="${cy(r)}" r="4.5" fill="${fill}"/><circle cx="${cx(c)}" cy="${cy(r)}" r="4.5" fill="none" stroke="${ring}" stroke-width="1"/>`;
  const startOf = new Map(players.map((p) => [`${p.start[0]},${p.start[1]}`, p.c]));
  const loop = LOOP.map(([c, r]) => dot(c, r, startOf.get(`${c},${r}`) ?? 'var(--gift-card)')).join('');
  const lanes = players.map((p) => p.lane.map(([c, r]) => dot(c, r, p.c)).join('')).join('');
  const homes = players.map((p) => p.home.map(([c, r]) => `<circle cx="${cx(c)}" cy="${cy(r)}" r="4.8" fill="${p.c}" opacity=".35"/><circle cx="${cx(c)}" cy="${cy(r)}" r="4.8" fill="none" stroke="${p.c}" stroke-width="1.2"/>`).join('')).join('');
  const mini = (c: string) => pawn(c, 0.4);
  const feet = (c: number, r: number): [number, number] => [cx(c), cy(r) + 3];
  // who sits at home: red has one out (the mover), yellow's free slot (9, 1) is where the knocked pawn returns
  const sitting: Array<[number, number, string]> = [
    [0, 0, RED], [1, 0, RED], [0, 1, RED],
    [9, 0, YELLOW], [10, 0, YELLOW], [10, 1, YELLOW],
    ...players[2]?.home.map(([c, r]): [number, number, string] => [c, r, GREEN]) ?? [],
    ...players[3]?.home.map(([c, r]): [number, number, string] => [c, r, BLUE]) ?? [],
  ];
  const [hx, hy] = feet(9, 1);
  const [lx, ly] = feet(4, 1);
  const svg = `${floor(140, 128, 80)}<rect x="${cx(0) - 8}" y="${cy(0) - 8}" width="${10 * G + 16}" height="${10 * G + 16}" rx="10" fill="var(--gift-wood-light)" opacity=".45"/>
    ${homes}${loop}${lanes}<circle cx="${cx(5)}" cy="${cy(5)}" r="3" fill="var(--gift-wood)"/>
    ${sitting.map(([c, r, col]) => at(...feet(c, r), mini(col))).join('')}
    ${at(hx, hy, k('yellow', mini(YELLOW), 'play-feet'))}
    ${at(lx, ly, k('red', mini(RED), 'play-feet'))}
    ${at(44, 44, thrownDie('d', 'var(--gift-die)', 4))}
    ${at(lx + 12, ly - 6, k('spark', spark(5), 'play-center'))}`;
  return {
    svg,
    duration: 1.85,
    tracks(root) {
      // red: from field 3 of the loop four fields on, round the corner, to (4, 1)
      const path = [3, 4, 5, 6, 7].map((i) => {
        const [c, r] = LOOP[i] ?? [0, 0];
        const [x, y] = feet(c, r);
        return [x - lx, y - ly] as const;
      });
      const first = path[0] ?? [0, 0];
      const red = new Track(q(root, 'red'), 'red', { x: first[0], y: first[1], sx: 1, sy: 1 });
      const landed = hops(red, 0.5, path, 0.16, 9);
      squash(red, landed, 0.12);
      // the yellow pawn stood there — it tumbles back into its home
      const dx = lx - hx;
      const dy = ly - hy;
      const yellow = new Track(q(root, 'yellow'), 'yellow', { x: dx, y: dy, r: 0, sx: 1, sy: 1 });
      yellow.path(landed - 0.02, [[landed + 0.16, { x: dx * 0.5, y: dy * 0.5 - 22, r: -180 }, EASE.up], [landed + 0.36, { x: 0, y: 0, r: -360 }, EASE.down]]);
      squash(yellow, landed + 0.36, 0.14);
      return [...throwDie(root, 'd', 0, 0.4, { x: -80, y: -40 }, 360), red, yellow, sparkIn(root, 'spark', landed + 0.02)];
    },
  };
}

// ---------------------------------------------------------------------------------------------- words: Scrabble-like letters

/** Three letter tiles leave the rack and cross a word on the board: BAUM through HAUS, +8. */
function lettersScene(): Scene {
  const S = 15;
  const cx = (c: number) => 40 + c * S + S / 2;
  const cy = (r: number) => 8 + r * S + S / 2;
  const premium: Record<string, string> = { '0,0': 'var(--gift-rose)', '7,0': 'var(--gift-sky)', '2,5': 'var(--gift-sky)', '8,4': 'var(--gift-rose)', '1,3': 'var(--gift-sky)', '9,2': 'var(--gift-rose)' };
  let cells = '';
  for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) cells += `<rect x="${40 + c * S + 0.75}" y="${8 + r * S + 0.75}" width="${S - 1.5}" height="${S - 1.5}" rx="1.5" fill="${premium[`${c},${r}`] ?? 'var(--gift-cream)'}" opacity="${premium[`${c},${r}`] ? 0.75 : 0.6}"/>`;
  const tile = (l: string, v: number) => `<rect x="-6.8" y="-6.8" width="13.6" height="13.6" rx="2.4" fill="var(--gift-butter)"/><rect x="-6.8" y="-6.8" width="13.6" height="13.6" rx="2.4" fill="none" stroke="var(--gift-wood)" stroke-width="1"/>${txt(-0.8, 3.6, 9.5, 'var(--gift-charcoal)', l)}${txt(4.2, 5, 4.2, 'var(--gift-charcoal)', String(v), 700)}`;
  const haus: Array<[string, number]> = [['H', 2], ['A', 1], ['U', 1], ['S', 1]];
  const word = haus.map(([l, v], i) => at(cx(3 + i), cy(2), i === 1 ? k('a', tile(l, v), 'play-center') : tile(l, v))).join('');
  const moving: Array<[string, number, number, number]> = [['B', 3, 4, 1], ['U', 1, 4, 3], ['M', 3, 4, 4]];
  const rackX = [188, 204, 220];
  const svg = `${floor(116, 126, 104)}<rect x="38" y="6" width="154" height="94" rx="6" fill="var(--gift-leaf)" opacity=".55"/>${cells}${word}
    <path d="M128 116 H236 L232 128 H132 Z" fill="var(--gift-wood)"/><path d="M128 116 H236" stroke="var(--gift-wood-dark)" stroke-width="2"/>
    ${[['E', 1], ['R', 1], ['N', 1]].map(([l, v], i) => at(140 + i * 16, 109, tile(String(l), Number(v)))).join('')}
    ${moving.map(([l, v, c, r], i) => at(cx(c), cy(r), k(`l${i}`, tile(l, v), 'play-center'))).join('')}
    ${at(214, 50, k('score', badge('+8', 34), 'play-feet'))}`;
  return {
    svg,
    duration: 1.8,
    tracks(root) {
      const out: Track[] = moving.map(([, , c, r], i) => {
        const t0 = 0.05 + i * 0.24;
        return toss(root, `l${i}`, { x: (rackX[i] ?? 200) - cx(c), y: 109 - cy(r) }, t0, t0 + 0.42, 14, 0.1, false);
      });
      // the new word jumps once, letter by letter (B, A, U, M)
      const keys = ['l0', 'a', 'l1', 'l2'];
      const tracksOf: Record<string, Track | undefined> = { l0: out[0], l1: out[1], l2: out[2] };
      const a = new Track(q(root, 'a'), 'a', { y: 0, sx: 1, sy: 1 });
      tracksOf['a'] = a;
      keys.forEach((key, i) => {
        const t = 1.14 + i * 0.06;
        tracksOf[key]?.path(t, [[t + 0.1, { y: -6 }, EASE.up], [t + 0.22, { y: 0 }, EASE.down]]);
      });
      const score = new Track(q(root, 'score'), 'score', { y: 16, s: 0.5, o: 0 });
      score.path(1.3, [[1.38, { y: 12, s: 0.7, o: 1 }, EASE.linear], [1.72, { y: 0, s: 1 }, EASE.bouncy]]);
      return [...out, a, score];
    },
  };
}

// ---------------------------------------------------------------------------------------------- board: Cluedo-like detective

/** Out of the secret envelope: who, with what, where — and the magnifying glass. */
function detectiveScene(): Scene {
  const back = `${cardRect(32, 46, 'var(--gift-rose-dark)', 'rgba(0,0,0,.18)', 4)}<rect x="-11" y="-18" width="22" height="36" rx="3" fill="none" stroke="var(--gift-cream)" stroke-width="1.2" opacity=".5"/>${txt(0, 6, 16, 'var(--gift-cream)', '?')}`;
  const face = (inner: string, tint: string) => `${cardRect(32, 46, 'var(--gift-card)', 'var(--gift-card-rim)', 4)}<rect x="-12" y="-19" width="24" height="30" rx="3" fill="${tint}" opacity=".35"/>${inner}<path d="M-9 16 h18" stroke="var(--gift-steel-dark)" stroke-width="2" stroke-linecap="round" opacity=".6"/>`;
  const who = face(`<circle cx="0" cy="-10" r="5.4" fill="var(--gift-clay-dark)"/><path d="M-10 8 C-10 -1 10 -1 10 8 Z" fill="var(--gift-clay-dark)"/><path d="M-7 -13 H7 L5 -16 H-5 Z" fill="var(--gift-charcoal)"/>`, 'var(--gift-clay)');
  const what = face(`<rect x="-7" y="5" width="14" height="3" rx="1.2" fill="var(--gift-butter-dark)"/><path d="M-1.6 5 V-4 H1.6 V5 Z" fill="var(--gift-butter-dark)"/><rect x="-3" y="-13" width="6" height="9" rx="1" fill="var(--gift-cream)"/><path d="M0 -13 C-3 -16 -1 -19 0 -21 C1 -19 3 -16 0 -13 Z" fill="var(--gift-accent)"/>`, 'var(--gift-butter)');
  const where = face(`<rect x="-10" y="-14" width="20" height="22" fill="none" stroke="var(--gift-wood-dark)" stroke-width="2"/><rect x="-4" y="-4" width="8" height="12" fill="var(--gift-wood)"/><circle cx="2" cy="2" r="1" fill="var(--gift-cream)"/><path d="M-10 -14 L0 -20 L10 -14" stroke="var(--gift-wood-dark)" stroke-width="2" fill="none"/>`, 'var(--gift-sky)');
  const xs: Array<[number, number, string]> = [[104, -6, who], [146, 0, what], [188, 6, where]];
  const envelope = `<rect x="-26" y="-17" width="52" height="34" rx="3" fill="var(--gift-wood)"/><path d="M-26 -17 L0 4 L26 -17" fill="var(--gift-wood-dark)"/><path d="M-26 -17 L0 4 L26 -17" fill="none" stroke="rgba(0,0,0,.15)"/><circle cx="0" cy="3" r="4.6" fill="var(--gift-rose-dark)"/>`;
  const glass = `<path d="M7 7 L18 18" stroke="var(--gift-wood-dark)" stroke-width="5" stroke-linecap="round"/><circle r="11" fill="var(--gift-sky-light)" opacity=".55"/><circle r="11" fill="none" stroke="var(--gift-charcoal)" stroke-width="3"/><path d="M-6 -4 A7 7 0 0 1 -2 -7.4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".9"/>`;
  const svg = `${floor(124, 122, 104)}${at(46, 96, envelope)}
    ${xs.map(([x, rot, front], i) => at(x, 60, k(`m${i}`, flipSvg(`f${i}`, back, front), 'play-center'), rot)).join('')}
    ${at(112, 52, k('glass', glass, 'play-center'))}`;
  return {
    svg,
    duration: 1.9,
    tracks(root) {
      const out: Track[] = [];
      xs.forEach(([x, rot], i) => {
        const t0 = 0.05 + i * 0.14;
        const off = local(46 - x, 92 - 60, rot);
        out.push(arrive(root, `m${i}`, { x: off.x, y: off.y, r: -rot - 10, s: 0.6, o: 0 }, t0, t0 + 0.4, 'cubic-bezier(.25,.8,.35,1.1)'));
        out.push(...flip(root, `f${i}`, 0.62 + i * 0.2, 0.3));
      });
      const glass = new Track(q(root, 'glass'), 'glass', { x: 110, y: 60, r: 30, o: 0 });
      glass.path(1.18, [[1.23, { x: 100, y: 54, o: 1 }, EASE.linear], [1.56, { x: -4, y: 4, r: -6 }, EASE.smooth], [1.78, { x: 0, y: 0, r: 0 }, EASE.bouncy]]);
      out.push(glass);
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------- dice: Kniffel-like

/** Five dice out of the cup — five sixes; the 50 on the score pad. */
function yahtzeeScene(): Scene {
  const xs = [76, 104, 132, 160, 188];
  const cup = `<path d="M-20 -11 L14 -16 L14 16 L-20 11 Z" fill="var(--gift-wood-dark)"/><path d="M-20 -11 L14 -16 L14 -10 L-20 -6 Z" fill="#fff" opacity=".12"/><ellipse cx="14" cy="0" rx="4.4" ry="16" fill="var(--gift-wood)"/><ellipse cx="14" cy="0" rx="2.6" ry="12.6" fill="var(--gift-charcoal)" opacity=".7"/>`;
  const pad = `${cardRect(42, 50, 'var(--gift-card)', 'var(--gift-card-rim)', 4)}${[-16, -8, 0, 8].map((y) => `<path d="M-15 ${y} h16 M6 ${y} h8" stroke="var(--gift-steel-dark)" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>`).join('')}<rect x="-17" y="12" width="34" height="10" rx="2" fill="var(--gift-butter)"/><path d="M-14 17 h12" stroke="var(--gift-charcoal)" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>`;
  const svg = `${floor(124, 120, 104)}${at(34, 50, k('cup', cup, 'play-center'), 18)}
    ${at(210, 34, pad)}${at(219, 51, k('fifty', txt(0, 0, 8.5, 'var(--gift-rose-dark)', '50'), 'play-center'))}
    ${xs.map((x, i) => at(x, 92, thrownDie(`d${i}`, 'var(--gift-die)', 6))).join('')}
    ${at(176, 52, k('spark', spark(6), 'play-center'))}`;
  return {
    svg,
    duration: 1.85,
    tracks(root) {
      const cup = new Track(q(root, 'cup'), 'cup', { r: -70, y: -6 });
      cup.path(0, [[0.22, { r: 6, y: 0 }, EASE.up], [0.5, { r: 0 }, EASE.bouncy]]);
      const out: Track[] = [cup];
      xs.forEach((x, i) => {
        const t0 = 0.12 + i * 0.05;
        const land = 0.52 + i * 0.06;
        const tr = throwDie(root, `d${i}`, t0, land, { x: 52 - x, y: -38 }, i % 2 ? -450 : -360);
        // five of a kind: they jump once together, one after the other
        const tj = 1.04 + i * 0.05;
        tr[1]?.path(tj, [[tj + 0.1, { y: -8 }, EASE.up], [tj + 0.22, { y: 0 }, EASE.down]]);
        out.push(...tr);
      });
      out.push(sparkIn(root, 'fifty', 1.32), sparkIn(root, 'spark', 1.42));
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------- stack: Jenga-like tower

/** A block slides out of the tower, the tower wobbles — and stands; the block goes on top. */
function towerScene(): Scene {
  const X = 112;
  const H = 9;
  const bottom = 118;
  const layerY = (i: number) => bottom - H * (i + 1);
  const long = `<rect x="-22" y="0" width="44" height="${H}" rx="1.6" fill="var(--gift-wood-light)"/><rect x="-22" y="0" width="44" height="${H}" rx="1.6" fill="none" stroke="var(--gift-wood)" stroke-width="1"/><path d="M-16 3.4 C-8 2.4 2 4.6 14 3.2" stroke="var(--gift-wood)" stroke-width=".9" fill="none" opacity=".7"/>`;
  const ends = [-15, 0, 15].map((dx) => `<rect x="${dx - 7}" y="0" width="14" height="${H}" rx="1.6" fill="var(--gift-wood-light)"/><rect x="${dx - 7}" y="0" width="14" height="${H}" rx="1.6" fill="none" stroke="var(--gift-wood)" stroke-width="1"/><circle cx="${dx}" cy="${H / 2}" r="2" fill="none" stroke="var(--gift-wood)" stroke-width=".8" opacity=".7"/>`).join('');
  const PULL = 3;
  const layers = [0, 1, 2, 3, 4, 5, 6, 7]
    .map((i) => {
      // the gap: the front block is gone, the middle one is seen deeper inside, in shadow
      if (i === PULL) return at(X, layerY(i), `<rect x="-22" y="0" width="44" height="${H}" fill="var(--gift-charcoal)" opacity=".55"/><rect x="-18" y="2.4" width="36" height="${H - 2.4}" rx="1" fill="var(--gift-wood)" opacity=".75"/>`);
      return at(X, layerY(i), i % 2 ? long : ends);
    })
    .join('');
  const topY = layerY(8);
  const svg = `${floor(X, bottom + 2, 60)}${at(X, bottom, k('tower', at(-X, -bottom, layers), 'play-feet'))}
    ${at(X, topY, k('block', long))}
    ${at(170, 30, k('spark', spark(7), 'play-center'))}`;
  return {
    svg,
    duration: 1.85,
    tracks(root) {
      const dy = layerY(PULL) - topY;
      const block = new Track(q(root, 'block'), 'block', { x: 0, y: dy });
      block.path(0.08, [[0.56, { x: 60, y: dy }, 'cubic-bezier(.4,0,.3,1)'], [0.96, { x: 56, y: -12 }, EASE.up], [1.24, { x: 4, y: -10 }, EASE.smooth], [1.38, { x: 0, y: 0 }, EASE.down]]);
      // the tower wobbles while the block comes out — and stands
      const tower = new Track(q(root, 'tower'), 'tower', { r: 0 });
      tower.path(0.44, [[0.6, { r: 2.6 }, EASE.smooth], [0.78, { r: -2 }, EASE.smooth], [0.94, { r: 1.2 }, EASE.smooth], [1.1, { r: -0.5 }, EASE.smooth], [1.24, { r: 0 }, EASE.smooth]]);
      return [block, tower, sparkIn(root, 'spark', 1.44)];
    },
  };
}

// ---------------------------------------------------------------------------------------------- shed: Rummikub-like tiles

/** From the rack onto the table: a blue 6 extends the run, three 9s make a group. */
function rummyScene(): Scene {
  const tile = (n: string, c: string) => `<rect x="-9" y="-12" width="18" height="24" rx="3" fill="var(--gift-cream)"/><rect x="-9" y="-12" width="18" height="24" rx="3" fill="none" stroke="var(--gift-wood-light)" stroke-width="1.2"/>${txt(0, 3, 11, c, n)}<circle cx="0" cy="8" r="1.6" fill="${c}" opacity=".7"/>`;
  const BLUE = 'var(--gift-sky-dark)';
  const run = [['3', 60], ['4', 80], ['5', 100]].map(([n, x]) => at(Number(x), 30, tile(String(n), BLUE))).join('');
  const moving: Array<[string, string, number, number, number]> = [
    ['6', BLUE, 120, 30, 120],
    ['9', 'var(--gift-rose-dark)', 104, 62, 140],
    ['9', 'var(--gift-charcoal)', 124, 62, 160],
    ['9', 'var(--gift-clay-dark)', 144, 62, 180],
  ];
  const svg = `${floor(120, 126, 104)}<rect x="40" y="12" width="160" height="70" rx="10" fill="var(--gift-leaf)" opacity=".28"/>${run}
    <path d="M30 108 H210 L204 126 H36 Z" fill="var(--gift-wood)"/><path d="M30 108 H210" stroke="var(--gift-wood-dark)" stroke-width="2.4"/>
    ${at(56, 98, tile('2', 'var(--gift-rose-dark)'))}${at(76, 98, tile('11', 'var(--gift-sky-dark)'))}
    ${moving.map(([n, c, x, y], i) => at(x, y, k(`r${i}`, tile(n, c), 'play-center'))).join('')}
    ${at(186, 40, k('spark', spark(7), 'play-center'))}`;
  return {
    svg,
    duration: 1.75,
    tracks(root) {
      const out: Track[] = moving.map(([, , x, y, rx], i) => {
        const t0 = 0.05 + i * 0.2;
        return toss(root, `r${i}`, { x: rx - x, y: 98 - y }, t0, t0 + 0.4, 12, 0.08, false);
      });
      // the group of 9s closes up: a little jump together
      [1, 2, 3].forEach((i, j) => {
        const t = 1.12 + j * 0.05;
        out[i]?.path(t, [[t + 0.1, { y: -6 }, EASE.up], [t + 0.22, { y: 0 }, EASE.down]]);
      });
      out.push(sparkIn(root, 'spark', 1.3));
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------- words: Dobble-like spot it

/** Two round cards slide in; exactly one picture is on both — found! */
function spotScene(): Scene {
  const sym: Record<string, (s: number) => string> = {
    heart: (s) => `<path transform="scale(${s})" d="M0 6 C-8 0 -9 -6 -5 -8 C-2.6 -9 -1 -7.6 0 -5.6 C1 -7.6 2.6 -9 5 -8 C9 -6 8 0 0 6 Z" fill="var(--gift-rose-dark)"/>`,
    drop: (s) => `<path transform="scale(${s})" d="M0 -9 C4 -3 6 0 6 3 C6 6.6 3.4 9 0 9 C-3.4 9 -6 6.6 -6 3 C-6 0 -4 -3 0 -9 Z" fill="var(--gift-sky-dark)"/>`,
    sun: (s) => `<g transform="scale(${s})"><circle r="4.6" fill="var(--gift-butter-dark)"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M0 -6.6 V-9" stroke="var(--gift-butter-dark)" stroke-width="2" stroke-linecap="round" transform="rotate(${a})"/>`).join('')}</g>`,
    leaf: (s) => `<path transform="scale(${s})" d="M-7 6 C-7 -3 0 -8 8 -7 C8 2 2 8 -7 6 Z M-7 6 L3 -3" fill="var(--gift-leaf)" stroke="var(--gift-leaf-dark)" stroke-width="1.2"/>`,
    moon: (s) => `<path transform="scale(${s})" d="M3 -8 A8 8 0 1 0 6 6 A6.4 6.4 0 1 1 3 -8 Z" fill="var(--gift-clay)"/>`,
    bolt: (s) => `<path transform="scale(${s})" d="M2 -9 L-5 1 H0 L-2 9 L5 -1 H0 Z" fill="var(--gift-butter-dark)"/>`,
    cloud: (s) => `<g transform="scale(${s})"><circle cx="-4" cy="1" r="4" fill="var(--gift-steel-dark)"/><circle cx="2" cy="-2" r="5" fill="var(--gift-steel-dark)"/><rect x="-8" y="1" width="15" height="4.4" rx="2.2" fill="var(--gift-steel-dark)"/></g>`,
    note: (s) => `<g transform="scale(${s})"><path d="M-2 5 V-8 L6 -10 V3" stroke="var(--gift-sky-dark)" stroke-width="2" fill="none" stroke-linejoin="round"/><circle cx="-4.6" cy="5" r="3" fill="var(--gift-sky-dark)"/><circle cx="3.4" cy="3" r="3" fill="var(--gift-sky-dark)"/></g>`,
    fish: (s) => `<g transform="scale(${s})"><path d="M-7 0 C-3 -6 4 -6 7 0 C4 6 -3 6 -7 0 Z M-7 0 L-11 -4 V4 Z" fill="var(--gift-leaf)"/><circle cx="3.4" cy="-1" r="1.2" fill="var(--gift-charcoal)"/></g>`,
    apple: (s) => `<g transform="scale(${s})"><path d="M0 -4 C-4 -7 -8 -4 -7 1 C-6 6 -3 8 0 7 C3 8 6 6 7 1 C8 -4 4 -7 0 -4 Z" fill="var(--gift-rose)"/><path d="M0 -4 C0 -7 1 -8 2 -9" stroke="var(--gift-wood-dark)" stroke-width="1.4" fill="none"/></g>`,
  };
  const disc = (items: Array<[string, number, number, number, number]>, starAt: [number, number, number], key: string) =>
    `<circle r="42" fill="var(--gift-card)"/><circle r="42" fill="none" stroke="var(--gift-card-rim)" stroke-width="1.4"/><circle r="38" fill="none" stroke="var(--gift-card-rim)" stroke-width="1" stroke-dasharray="2 3"/>
     ${items.map(([name, x, y, rot, s]) => at(x, y, sym[name]?.(s) ?? '', rot)).join('')}
     ${at(starAt[0], starAt[1], k(key, `${k(`${key}-ring`, `<circle r="13" fill="var(--gift-butter)" opacity=".6"/>`)}${star(starAt[2], 'var(--gift-accent)')}`, 'play-center'))}`;
  const left = disc([['heart', -16, -20, -10, 1.15], ['drop', -24, 8, 12, 1], ['sun', 2, 22, 0, 1.1], ['leaf', 22, 16, 20, 1], ['moon', -2, -4, -20, 0.9]], [18, -14, 11], 'sa');
  // exactly one picture in common (the star), like the real deck
  const right = disc([['cloud', -10, -22, 0, 1.1], ['bolt', 18, -14, 14, 1.1], ['apple', 20, 14, -10, 1], ['note', 0, 24, 8, 1], ['fish', 4, -2, -16, 0.9]], [-20, 10, 9], 'sb');
  const svg = `${floor(120, 118, 100)}
    ${at(74, 62, k('L', left, 'play-center'))}
    ${at(166, 62, k('R', right, 'play-center'))}
    ${k('link', `<path d="M92 48 C110 34 132 50 146 72" stroke="var(--gift-accent)" stroke-width="2.4" fill="none" stroke-dasharray="4 4" stroke-linecap="round"/>`)}`;
  return {
    svg,
    duration: 1.6,
    tracks(root) {
      const L = new Track(q(root, 'L'), 'L', { x: -130, r: -160 });
      L.move(0.04, 0.56, { x: 0, r: 0 }, 'cubic-bezier(.25,.8,.35,1.08)');
      const R = new Track(q(root, 'R'), 'R', { x: 130, r: 160 });
      R.move(0.14, 0.66, { x: 0, r: 0 }, 'cubic-bezier(.25,.8,.35,1.08)');
      const pulse = (key: string, t: number) => {
        const tr = new Track(q(root, key), key, { s: 1 });
        tr.path(t, [[t + 0.14, { s: 1.45 }, EASE.up], [t + 0.42, { s: 1.15 }, EASE.bouncy]]);
        const ring = new Track(q(root, `${key}-ring`), `${key}-ring`, { o: 0 });
        ring.move(t, t + 0.2, { o: 1 }, EASE.smooth);
        return [tr, ring];
      };
      const link = new Track(q(root, 'link'), 'link', { o: 0 });
      link.move(1.14, 1.4, { o: 1 }, EASE.smooth);
      return [L, R, ...pulse('sa', 0.8), ...pulse('sb', 0.86), link];
    },
  };
}

// ---------------------------------------------------------------------------------------------- words: Activity-like

/** The timer turns, the card says: draw it! — a little house appears on the pad, the team moves on. */
function activityScene(): Scene {
  const hourglass = `<rect x="-12" y="-24" width="24" height="4" rx="2" fill="var(--gift-wood-dark)"/><rect x="-12" y="20" width="24" height="4" rx="2" fill="var(--gift-wood-dark)"/>
    <path d="M-9 -20 H9 C9 -10 2 -4 2 0 C2 4 9 10 9 20 H-9 C-9 10 -2 4 -2 0 C-2 -4 -9 -10 -9 -20 Z" fill="var(--gift-sky-light)" opacity=".8"/>
    <path d="M-7 -16 H7 C6 -10 1 -6 0 -4 C-1 -6 -6 -10 -7 -16 Z" fill="var(--gift-butter-dark)"/>
    <path d="M-9 -20 H9 C9 -10 2 -4 2 0 C2 4 9 10 9 20 H-9 C-9 10 -2 4 -2 0 C-2 -4 -9 -10 -9 -20 Z" fill="none" stroke="var(--gift-wood)" stroke-width="1.4"/>`;
  const stream = `<path d="M0 -3 V17" stroke="var(--gift-butter-dark)" stroke-width="1.4"/><path d="M-4 20 C-2 16 2 16 4 20 Z" fill="var(--gift-butter-dark)"/>`;
  const back = `${cardRect(50, 68, 'var(--gift-accent)', 'rgba(0,0,0,.14)', 6)}${txt(0, 10, 30, '#fff', '?')}`;
  const pencil = `<g transform="rotate(-35)"><rect x="-9" y="-2.6" width="15" height="5.2" fill="var(--gift-butter-dark)"/><path d="M6 -2.6 L11 0 L6 2.6 Z" fill="var(--gift-wood-light)"/><path d="M9.4 -0.8 L11 0 L9.4 0.8 Z" fill="var(--gift-charcoal)"/><rect x="-11" y="-2.6" width="2.4" height="5.2" fill="var(--gift-rose)"/></g>`;
  const talk = `<path d="M-8 -6 H8 C9.6 -6 10 -5 10 -4 V3 C10 4 9.6 5 8 5 H-2 L-6 9 V5 H-8 C-9.6 5 -10 4 -10 3 V-4 C-10 -5 -9.6 -6 -8 -6 Z" fill="var(--gift-sky-dark)"/>`;
  const mime = `<circle cx="0" cy="-6" r="3" fill="var(--gift-leaf-dark)"/><path d="M0 -3 V3 M0 3 L-4 9 M0 3 L4 9 M-6 -4 L0 -1 L6 -6" stroke="var(--gift-leaf-dark)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const front = `${cardRect(50, 68, 'var(--gift-card)', 'var(--gift-card-rim)', 6)}${k('pick', `<rect x="-20" y="-31" width="40" height="20" rx="10" fill="var(--gift-butter)"/>`)}${at(0, -21, pencil)}${at(0, 0, talk)}${at(0, 21, mime)}`;
  const pad = `${cardRect(58, 64, 'var(--gift-card)', 'var(--gift-card-rim)', 4)}${[-16, -6, 4, 14].map((x) => `<circle cx="${x}" cy="-29" r="2" fill="var(--gift-steel-dark)"/>`).join('')}`;
  const sketch = [
    `<path d="M-13 18 V2 H13 V18 Z" fill="none" stroke="var(--gift-charcoal)" stroke-width="2" stroke-linejoin="round"/><path d="M-3 18 V9 H3 V18" fill="none" stroke="var(--gift-charcoal)" stroke-width="1.8"/>`,
    `<path d="M-16 3 L0 -11 L16 3" fill="none" stroke="var(--gift-charcoal)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<circle cx="16" cy="-17" r="4.4" fill="none" stroke="var(--gift-butter-dark)" stroke-width="2"/>`,
  ];
  const fields = [86, 106, 126, 146, 166].map((x, i) => `<circle cx="${x}" cy="118" r="5" fill="${['var(--gift-sky)', 'var(--gift-butter)', 'var(--gift-leaf-light)', 'var(--gift-rose)', 'var(--gift-sky)'][i] ?? ''}"/>`).join('');
  const svg = `${floor(124, 126, 104)}${at(30, 62, k('glass', hourglass, 'play-center'))}${at(30, 62, k('stream', stream))}
    ${at(92, 58, k('card', flipSvg('flip', back, front), 'play-center'))}
    ${at(180, 56, `${pad}${sketch.map((s, i) => k(`sk${i}`, s, 'play-center')).join('')}`)}
    <path d="M80 118 H172" stroke="var(--gift-wood-light)" stroke-width="2"/>${fields}
    ${at(146, 121, k('team', pawn('var(--gift-clay-dark)', 0.55), 'play-feet'))}`;
  return {
    svg,
    duration: 1.95,
    tracks(root) {
      const glass = new Track(q(root, 'glass'), 'glass', { r: -180 });
      glass.move(0.04, 0.46, { r: 0 }, EASE.bouncy);
      const stream = new Track(q(root, 'stream'), 'stream', { o: 0 });
      stream.move(0.44, 0.6, { o: 1 }, EASE.smooth);
      const card = arrive(root, 'card', { y: 44, r: 8, o: 0 }, 0.08, 0.44, EASE.smooth);
      const pick = new Track(q(root, 'pick'), 'pick', { y: 42, o: 0 });
      pick.path(0.84, [[0.88, { y: 40, o: 1 }, EASE.linear], [1.06, { y: 20 }, EASE.smooth], [1.3, { y: 0 }, EASE.bouncy]]);
      const sk = [0, 1, 2].map((i) => {
        const t = 1.2 + i * 0.13;
        const tr = new Track(q(root, `sk${i}`), `sk${i}`, { s: 0.5, o: 0 });
        tr.path(t, [[t + 0.06, { s: 0.7, o: 1 }, EASE.linear], [t + 0.26, { s: 1 }, EASE.bouncy]]);
        return tr;
      });
      const team = new Track(q(root, 'team'), 'team', { x: -40, y: 0, sx: 1, sy: 1 });
      const landed = hops(team, 1.34, [[-40, 0], [-20, 0], [0, 0]], 0.15, 9);
      squash(team, landed, 0.12);
      return [glass, stream, card, ...flip(root, 'flip', 0.48, 0.32), pick, ...sk, team];
    },
  };
}

// ---------------------------------------------------------------------------------------------- entry

const BUILDERS: Record<NewVariant, () => Scene> = {
  cockpit: cockpitScene,
  crew: crewScene,
  flip: flipScene,
  catan: catanScene,
  district: districtScene,
  garden: gardenScene,
  planner: plannerScene,
  street: streetScene,
  colors: colorsScene,
  ludo: ludoScene,
  letters: lettersScene,
  detective: detectiveScene,
  yahtzee: yahtzeeScene,
  tower: towerScene,
  rummy: rummyScene,
  spot: spotScene,
  activity: activityScene,
};

export const NEW_VARIANTS = Object.keys(BUILDERS) as NewVariant[];

export function newSceneFor(variant: NewVariant): Scene {
  return BUILDERS[variant]();
}

// ---------------------------------------------------------------------------------------------- the app's looks

/** The three groups that are new on 30.10 (the eight old ones: scenes.ts). */
export type NewArchetype = 'board' | 'stack' | 'shed';

/** A game drawn by one of these scenes: its group (the tile tint, looks.ts) and its scene. */
export interface NewLook {
  archetype: Archetype | NewArchetype;
  scene: NewVariant;
}

/** Every game's look: one of the eight archetype builders (scenes.ts) or one of the 30.10 scenes. */
export type GameLook = Look | NewLook;

export function gameSceneFor(look: GameLook): Scene {
  return 'scene' in look ? newSceneFor(look.scene) : sceneFor(look);
}
