/**
 * "Das Spiel spielt sich kurz an" — one short animation OF THE GAME when its sheet opens (26.10, Felix: «при открытии
 * вкладки можно сделать анимацию самой игры»). GALLERY-ONLY prototype. To scale to every game, the games are grouped by
 * what you DO in them into eight archetypes; each archetype is one builder and every game passes its own look (colours,
 * tile shape, token, …):
 *
 *   tiles   — a tile slides in, snaps to the others, a token hops onto it      (Carcassonne, Kingdomino, Cascadia, …)
 *   route   — little trains fill a route between two cities                    (Zug um Zug)
 *   pattern — pieces travel from a source into a row; the row completes        (Azul, Flügelschlag, Everdell, 7 Wonders Duel)
 *   words   — word / picture cards turn over, clues match                      (Codenames, Dixit, Just One, Dito!)
 *   dice    — dice roll in, boxes get ticked                                   (Ganz schön clever)
 *   coop    — together: cards stack into a firework, a wire is cut, a lock opens (Hanabi, The Mind, Bomb Busters, EXIT)
 *   luck    — push your luck, bluff, duel: chips into the cauldron, a disc flips (Quacksalber, Skull, Wizard, Challengers!)
 *   music   — a song card lands in the right place of a timeline               (Hitster)
 *
 * Our own flat drawings in the gift palette (--g-*): they evoke the game, never copy its box, artwork or logo.
 * Every scene ≤ 2 s, plays once, only transform / opacity; every part is ONE Track of the mascot timeline
 * (src/timeline.ts), so seek(t) gives the same frame every time; reduced motion = the end pose written inline.
 * Animated parts are inner <g data-k="…"> without a transform attribute (positions live on outer groups).
 */

import type { ChannelInput } from '../../src/timeline';
import { Track } from '../../src/timeline';
import { die, MEEPLE } from './art';
import { EASE } from './motion';

export type Archetype = 'tiles' | 'route' | 'pattern' | 'words' | 'dice' | 'coop' | 'luck' | 'music';

/** German name (the app would show it nowhere — it is our grouping) and the Russian one for Felix. */
export const ARCHETYPES: Record<Archetype, { de: string; ru: string }> = {
  tiles: { de: 'Legen', ru: 'Выкладывание плиток' },
  route: { de: 'Strecken', ru: 'Маршруты и поезда' },
  pattern: { de: 'Muster & Auslage', ru: 'Узор / раскладка' },
  words: { de: 'Wörter & Bilder', ru: 'Слова и картинки' },
  dice: { de: 'Würfeln', ru: 'Кубики' },
  coop: { de: 'Gemeinsam', ru: 'Кооператив' },
  luck: { de: 'Zocken & Bluffen', ru: 'Риск, блеф, дуэли' },
  music: { de: 'Musik', ru: 'Музыка / викторина' },
};

export type TileDetail = 'road' | 'city' | 'tree' | 'wave' | 'wheat' | 'house' | 'field' | 'rock';
export type Look =
  | { archetype: 'tiles'; shape: 'square' | 'hex'; tiles: readonly [TileSpec, TileSpec, TileSpec, TileSpec]; token: 'meeple' | 'crown' | 'animal' | 'flag' | 'house'; tokenColor: string }
  | { archetype: 'route'; wagon: string; cards: readonly [string, string, string] }
  | { archetype: 'pattern'; variant: 'azul' | 'birds' | 'city' | 'wonders' }
  | { archetype: 'words'; variant: 'codenames' | 'dixit' | 'justone' | 'dito' }
  | { archetype: 'dice'; variant: 'clever' }
  | { archetype: 'coop'; variant: 'hanabi' | 'mind' | 'wires' | 'lock' }
  | { archetype: 'luck'; variant: 'cauldron' | 'discs' | 'trick' | 'duel' }
  | { archetype: 'music'; variant: 'timeline' };
export interface TileSpec { color: string; detail: TileDetail }

export interface Scene {
  /** inner SVG markup for a 240 × 132 viewBox */
  svg: string;
  /** seconds (≤ 2) */
  duration: number;
  /** the tracks of the scene, looking into `root` (the element that holds the svg) */
  tracks(root: ParentNode): Track[];
}

export const VIEW = { w: 240, h: 132 } as const;

// ---------------------------------------------------------------------------------------------- helpers

const FONT = 'font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"';

/** An animated group (no transform attribute: the track owns it). */
const k = (key: string, inner: string, cls = '') => `<g data-k="${key}"${cls ? ` class="${cls}"` : ''}>${inner}</g>`;
/** A placed group (static position). */
const at = (x: number, y: number, inner: string, rot = 0) =>
  `<g transform="translate(${r1(x)} ${r1(y)})${rot ? ` rotate(${r1(rot)})` : ''}">${inner}</g>`;
const r1 = (v: number) => Math.round(v * 10) / 10;

function q(root: ParentNode, key: string): Element {
  const found = root.querySelector(`[data-k="${key}"]`);
  if (!found) throw new Error(`scene: no [data-k="${key}"]`);
  return found;
}

const floor = (cx: number, cy: number, rx: number) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${r1(rx * 0.14)}" fill="var(--g-shadow)"/>`;

function spark(r: number, fill = 'var(--g-butter-dark)'): string {
  const c = r * 0.18;
  return `<path d="M0 ${-r} C${c} ${-c} ${c} ${-c} ${r} 0 C${c} ${c} ${c} ${c} 0 ${r} C${-c} ${c} ${-c} ${c} ${-r} 0 C${-c} ${-c} ${-c} ${-c} 0 ${-r} Z" fill="${fill}"/>`;
}

/** A card face: a rounded rectangle with a rim. */
const cardRect = (w: number, h: number, fill: string, rim = 'var(--g-card-rim)', rx = 5) =>
  `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="${rim}" stroke-width="1.1"/>`;

/** Something arrives: from an offset (and maybe invisible) to its place, between t0 and t1. */
function arrive(root: ParentNode, key: string, from: ChannelInput, t0: number, t1: number, ease: string = EASE.smooth): Track {
  const tr = new Track(q(root, key), key, from);
  const to: ChannelInput = {};
  if (from.x !== undefined) to.x = 0;
  if (from.y !== undefined) to.y = 0;
  if (from.r !== undefined) to.r = 0;
  if (from.s !== undefined) to.s = 1;
  if (from.sx !== undefined) to.sx = 1;
  if (from.sy !== undefined) to.sy = 1;
  if (from.o !== undefined) to.o = 1;
  // invisible things become visible in the first fifth of their way (they move, they do not pop)
  if (from.o !== undefined && from.o < 1) {
    const mid = t0 + (t1 - t0) * 0.2;
    tr.path(t0, [[mid, { ...lerpInput(from, to, 0.2), o: 1 }, EASE.linear], [t1, to, ease]]);
  } else tr.move(t0, t1, to, ease);
  return tr;
}

function lerpInput(a: ChannelInput, b: ChannelInput, p: number): ChannelInput {
  const out: ChannelInput = {};
  for (const key of ['x', 'y', 'r', 's', 'sx', 'sy'] as const) {
    const va = a[key];
    const vb = b[key];
    if (va !== undefined && vb !== undefined) out[key] = va + (vb - va) * p;
  }
  return out;
}

/** A landing: a short squash and a bouncy settle (feet / centre origin come from the element's class). */
function squash(tr: Track, t: number, amount = 0.1): Track {
  tr.path(t, [
    [t + 0.07, { sx: 1 + amount, sy: 1 - amount }, EASE.smooth],
    [t + 0.3, { sx: 1, sy: 1 }, EASE.bouncy],
  ]);
  return tr;
}

/** A card turning over: the flipper narrows to 0, the faces swap, it widens again. */
const flipSvg = (key: string, back: string, front: string) => k(key, `${k(`${key}-b`, back)}${k(`${key}-f`, front)}`, 'ix-center');
function flip(root: ParentNode, key: string, t: number, dur = 0.32): Track[] {
  const half = t + dur / 2;
  const f = new Track(q(root, key), key, { sx: 1 });
  f.path(t, [[half, { sx: 0.02 }, EASE.down], [t + dur, { sx: 1 }, EASE.up]]);
  const b = new Track(q(root, `${key}-b`), `${key}-b`, { o: 1 });
  b.set(half, { o: 0 });
  const fr = new Track(q(root, `${key}-f`), `${key}-f`, { o: 0 });
  fr.set(half, { o: 1 });
  return [f, b, fr];
}

/** A spark that pops in with a bounce and stays (it is part of the end pose). */
function sparkIn(root: ParentNode, key: string, t: number): Track {
  const tr = new Track(q(root, key), key, { s: 0.2, o: 0, r: -40 });
  tr.path(t, [[t + 0.08, { s: 0.5, o: 1, r: -25 }, EASE.linear], [t + 0.34, { s: 1, o: 1, r: 0 }, EASE.bouncy]]);
  return tr;
}

const meeple = (fill: string, s = 1) => `<g transform="translate(${-10 * s} ${-22 * s}) scale(${s})"><path d="${MEEPLE}" fill="${fill}"/></g>`;

// ---------------------------------------------------------------------------------------------- tiles

const SQ = 36;
const HEX_R = 20;
function hexPath(rad: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(`${r1(rad * Math.cos(a))} ${r1(rad * Math.sin(a))}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** One tile, centred on 0,0. */
function tileFace(shape: 'square' | 'hex', spec: TileSpec): string {
  const base = shape === 'square' ? `<rect x="${-SQ / 2}" y="${-SQ / 2}" width="${SQ}" height="${SQ}" rx="3" fill="${spec.color}"/>` : `<path d="${hexPath(HEX_R)}" fill="${spec.color}"/>`;
  const rim = shape === 'square' ? `<rect x="${-SQ / 2}" y="${-SQ / 2}" width="${SQ}" height="${SQ}" rx="3" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="1"/>` : `<path d="${hexPath(HEX_R)}" fill="none" stroke="rgba(0,0,0,.12)" stroke-width="1"/>`;
  const d = {
    road: `<path d="M-18 2 H18" stroke="var(--g-cream)" stroke-width="4.5"/><path d="M-18 2 H18" stroke="var(--g-wood-light)" stroke-width="1" stroke-dasharray="3 3"/>`,
    city: `<path d="M-18 -18 H18 L10 -6 C4 -10 -4 -10 -10 -6 Z" fill="var(--g-wood-light)"/><path d="M-8 -18 v4 h3 v-4 M4 -18 v4 h3 v-4" fill="var(--g-clay-dark)" opacity=".6"/>`,
    tree: `<path d="M-8 6 L-2 -8 L4 6 Z" fill="var(--g-leaf-dark)"/><path d="M2 9 L7 -2 L12 9 Z" fill="var(--g-leaf-dark)" opacity=".85"/>`,
    wave: `<path d="M-14 -2 C-9 -7 -4 3 1 -2 C6 -7 11 3 15 -2" stroke="var(--g-cream)" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M-12 6 C-7 1 -2 11 3 6 C8 1 12 9 14 6" stroke="var(--g-cream)" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>`,
    wheat: `<path d="M-8 8 V-6 M-2 8 V-8 M4 8 V-6 M10 8 V-4" stroke="var(--g-butter-dark)" stroke-width="2" stroke-linecap="round"/>`,
    house: `<path d="M-7 6 V-2 L0 -9 L7 -2 V6 Z" fill="var(--g-clay)"/><rect x="-2" y="1" width="4" height="5" fill="var(--g-cream)"/>`,
    field: `<circle cx="-6" cy="-4" r="2" fill="var(--g-cream)" opacity=".7"/><circle cx="6" cy="5" r="2" fill="var(--g-cream)" opacity=".7"/>`,
    rock: `<path d="M-12 8 L-4 -8 L2 0 L6 -5 L13 8 Z" fill="var(--g-steel-dark)"/><path d="M-4 -8 L-1 -2 L-6 -2 Z" fill="#fff" opacity=".7"/>`,
  }[spec.detail];
  return `${base}${d}${rim}`;
}

function tokenSvg(token: 'meeple' | 'crown' | 'animal' | 'flag' | 'house', color: string): string {
  switch (token) {
    case 'meeple':
      return meeple(color, 0.95);
    case 'crown':
      return `<path d="M-10 -2 L-10 -16 L-5 -9 L0 -18 L5 -9 L10 -16 L10 -2 Z" fill="${color}"/><rect x="-10" y="-4" width="20" height="4" rx="1" fill="${color}"/><circle cx="0" cy="-10" r="1.8" fill="var(--g-rose-dark)"/>`;
    case 'animal':
      // a round wooden token with a fox head
      return `<circle cx="0" cy="-10" r="10" fill="var(--g-cream)"/><circle cx="0" cy="-10" r="10" fill="none" stroke="var(--g-wood)" stroke-width="1.4"/><path d="M-6 -12 L-6 -18 L-2 -14 L2 -14 L6 -18 L6 -12 L0 -5 Z" fill="${color}"/><circle cx="-2.4" cy="-12" r="1" fill="var(--g-charcoal)"/><circle cx="2.4" cy="-12" r="1" fill="var(--g-charcoal)"/>`;
    case 'flag':
      return `<path d="M-1 0 V-22" stroke="var(--g-charcoal)" stroke-width="2"/><path d="M0 -22 L13 -18 L0 -13 Z" fill="${color}"/>`;
    case 'house':
      return `<path d="M-8 0 V-9 L0 -17 L8 -9 V0 Z" fill="${color}"/><rect x="-2.5" y="-6" width="5" height="6" fill="var(--g-cream)"/>`;
  }
}

function tilesScene(look: Extract<Look, { archetype: 'tiles' }>): Scene {
  const sq = look.shape === 'square';
  // three placed tiles and the place of the new one (centres)
  const cells: Array<[number, number]> = sq
    ? [[96, 48], [96 + SQ, 48], [96, 48 + SQ], [96 + SQ, 48 + SQ]]
    : [[92, 50], [92 + HEX_R * 1.732, 50], [92 + HEX_R * 0.866, 50 + HEX_R * 1.5], [92 + HEX_R * 2.598, 50 + HEX_R * 1.5]];
  const [a, b, c, d] = cells as [[number, number], [number, number], [number, number], [number, number]];
  const placed = [a, b, c].map(([x, y], i) => at(x, y, tileFace(look.shape, look.tiles[i] ?? look.tiles[0]))).join('');
  const svg = `${floor(120, 116, 74)}${placed}
    ${at(d[0], d[1], `${k('t-x', k('t-lift', k('t-new', `<ellipse cx="0" cy="${sq ? 20 : 21}" rx="16" ry="2.4" fill="var(--g-shadow)"/>${tileFace(look.shape, look.tiles[3])}`, 'ix-center')))}`)}
    ${at(d[0], d[1] + 6, k('token', tokenSvg(look.token, look.tokenColor), 'ix-feet'))}
    ${at(d[0] + 30, d[1] - 30, k('spark', spark(7), 'ix-center'))}
    ${at(52, 96, `<g opacity=".9">${tileFace(look.shape, look.tiles[1])}</g>`, -8)}`;
  return {
    svg,
    duration: 1.9,
    tracks(root) {
      const x = new Track(q(root, 't-x'), 't-x', { x: 118, r: 32 });
      x.move(0, 0.62, { x: 0, r: 0 }, 'cubic-bezier(.25,.7,.35,1)');
      const lift = new Track(q(root, 't-lift'), 't-lift', { y: -34 });
      lift.path(0, [[0.3, { y: -14 }, EASE.up], [0.62, { y: 0 }, EASE.down]]);
      const tile = new Track(q(root, 't-new'), 't-new', { sx: 1, sy: 1 });
      squash(tile, 0.62, 0.07);
      const token = new Track(q(root, 'token'), 'token', { y: -46, o: 0, sx: 1, sy: 1 });
      token.path(0.86, [[0.92, { y: -40, o: 1 }, EASE.linear], [1.16, { y: 0 }, EASE.down]]);
      squash(token, 1.16, 0.12);
      return [x, lift, tile, token, sparkIn(root, 'spark', 1.42)];
    },
  };
}

// ---------------------------------------------------------------------------------------------- route

function routeScene(look: Extract<Look, { archetype: 'route' }>): Scene {
  const P0 = [34, 94] as const;
  const P1 = [118, 124] as const;
  const P2 = [204, 38] as const;
  const point = (t: number): [number, number, number] => {
    const u = 1 - t;
    const x = u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0];
    const y = u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1];
    const dx = 2 * u * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]);
    const dy = 2 * u * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]);
    return [x, y, (Math.atan2(dy, dx) * 180) / Math.PI];
  };
  const slots = [0.16, 0.3, 0.44, 0.58, 0.72, 0.86].map(point);
  const slotSvg = slots.map(([x, y, a]) => at(x, y, `<rect x="-11" y="-5" width="22" height="10" rx="2.5" fill="var(--g-cream)" stroke="var(--g-wood-light)" stroke-width="1.4"/>`, a)).join('');
  const wagons = slots
    .map(([x, y, a], i) => at(x, y, k(`w${i}`, `<rect x="-10.5" y="-6" width="21" height="10" rx="2.5" fill="${look.wagon}"/><rect x="-8" y="-4" width="6" height="4" rx="1" fill="#fff" opacity=".35"/><circle cx="-6" cy="4.6" r="2" fill="var(--g-charcoal)"/><circle cx="6" cy="4.6" r="2" fill="var(--g-charcoal)"/>`), a))
    .join('');
  const city = (key: string, [x, y]: readonly [number, number]) => at(x, y, k(key, `<circle r="9" fill="var(--g-charcoal)"/><circle r="4" fill="var(--g-cream)"/>`, 'ix-center'));
  const hand = look.cards.map((c, i) => at(20 + i * 12, 30, `<g transform="rotate(${-14 + i * 12} 0 20)">${cardRect(18, 26, c, 'rgba(0,0,0,.15)', 3)}<path d="M-5 2 h10" stroke="#fff" stroke-width="2" opacity=".55"/></g>`)).join('');
  const svg = `${floor(120, 120, 96)}
    <path d="M${P0[0]} ${P0[1]} Q${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}" stroke="var(--g-wood-light)" stroke-width="16" fill="none" stroke-linecap="round" opacity=".55"/>
    ${slotSvg}${wagons}${city('city-a', P0)}${city('city-b', P2)}${hand}
    ${at(196, 98, k('ticket', `${cardRect(40, 26, 'var(--g-card)')}<path d="M-14 -4 L-4 -4 M-14 3 L2 3" stroke="var(--g-steel-dark)" stroke-width="2" stroke-linecap="round"/><path d="M6 -2 L10 3 L17 -7" stroke="var(--g-leaf-dark)" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`, 'ix-center'))}`;
  return {
    svg,
    duration: 1.85,
    tracks(root) {
      const out: Track[] = [];
      slots.forEach((_, i) => {
        const t0 = 0.08 + i * 0.13;
        const tr = arrive(root, `w${i}`, { x: -26, y: -30, r: -20, o: 0 }, t0, t0 + 0.34, 'cubic-bezier(.25,.8,.35,1.15)');
        out.push(tr);
      });
      const ca = new Track(q(root, 'city-a'), 'city-a', { s: 1 });
      ca.path(1.0, [[1.12, { s: 1.35 }, EASE.up], [1.36, { s: 1 }, EASE.bouncy]]);
      const cb = new Track(q(root, 'city-b'), 'city-b', { s: 1 });
      cb.path(1.08, [[1.2, { s: 1.35 }, EASE.up], [1.44, { s: 1 }, EASE.bouncy]]);
      out.push(ca, cb, arrive(root, 'ticket', { y: 34, r: 10, o: 0 }, 1.3, 1.78, EASE.bouncy));
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------- pattern

interface Piece { svg: string; from: [number, number, number]; to: [number, number, number] }

/** Pieces travel one after the other from where they lie to their places; then the finale. */
function piecesScene(backdrop: string, pieces: readonly Piece[], finale: { svg: string; at: [number, number]; kind: 'drop' | 'rise' }, sparkAt: [number, number], step = 0.2): Scene {
  const pieceSvg = pieces.map((p, i) => at(p.to[0], p.to[1], k(`p${i}`, p.svg, 'ix-center'), p.to[2])).join('');
  const svg = `${backdrop}${pieceSvg}${at(finale.at[0], finale.at[1], k('fin', finale.svg, 'ix-feet'))}${at(sparkAt[0], sparkAt[1], k('spark', spark(7), 'ix-center'))}`;
  const n = pieces.length;
  const end = 0.12 + (n - 1) * step + 0.46;
  return {
    svg,
    duration: Math.min(2, end + 0.75),
    tracks(root) {
      const out: Track[] = pieces.map((p, i) => {
        const t0 = 0.08 + i * step;
        // the offset is in the piece's own (rotated) frame: rotate the world offset back
        const a = (-p.to[2] * Math.PI) / 180;
        const dx = p.from[0] - p.to[0];
        const dy = p.from[1] - p.to[1];
        const lx = dx * Math.cos(a) - dy * Math.sin(a);
        const ly = dx * Math.sin(a) + dy * Math.cos(a);
        const tr = new Track(q(root, `p${i}`), `p${i}`, { x: lx, y: ly, r: p.from[2] - p.to[2], sx: 1, sy: 1 });
        tr.path(t0, [[t0 + 0.18, { x: lx * 0.45, y: ly * 0.45 - 12, r: (p.from[2] - p.to[2]) * 0.4, sx: 1.08, sy: 1.08 }, EASE.up], [t0 + 0.4, { x: 0, y: 0, r: 0, sx: 1, sy: 1 }, EASE.down]]);
        squash(tr, t0 + 0.4, 0.06);
        return tr;
      });
      const ft = end - 0.02;
      const fin = new Track(q(root, 'fin'), 'fin', finale.kind === 'drop' ? { y: -40, o: 0, sx: 1, sy: 1 } : { y: 14, o: 0, s: 0.6 });
      if (finale.kind === 'drop') {
        fin.path(ft, [[ft + 0.06, { y: -34, o: 1 }, EASE.linear], [ft + 0.3, { y: 0 }, EASE.down]]);
        squash(fin, ft + 0.3, 0.12);
      } else fin.path(ft, [[ft + 0.08, { y: 10, o: 1, s: 0.7 }, EASE.linear], [ft + 0.42, { y: 0, o: 1, s: 1 }, EASE.bouncy]]);
      out.push(fin, sparkIn(root, 'spark', Math.min(1.6, ft + 0.3)));
      return out;
    },
  };
}

function patternScene(look: Extract<Look, { archetype: 'pattern' }>): Scene {
  switch (look.variant) {
    case 'azul': {
      const colors = ['var(--g-sky-dark)', 'var(--g-butter-dark)', 'var(--g-rose-dark)', 'var(--g-charcoal)', 'var(--g-cream)'];
      const tile = (c: string) => `<rect x="-10" y="-10" width="20" height="20" rx="3.5" fill="${c}"/><path d="M-5 0 L0 -5 L5 0 L0 5 Z" fill="#fff" opacity=".35"/>`;
      const row = colors.map((c, i) => at(110 + i * 24, 66, `<rect x="-11" y="-11" width="22" height="22" rx="4" fill="${c}" opacity=".22"/>`)).join('');
      const backdrop = `${floor(122, 118, 100)}<rect x="94" y="40" width="132" height="52" rx="8" fill="var(--g-wood-light)"/>${row}
        <circle cx="46" cy="66" r="32" fill="var(--g-cream)"/><circle cx="46" cy="66" r="32" fill="none" stroke="var(--g-wood)" stroke-width="2"/><circle cx="46" cy="66" r="24" fill="none" stroke="var(--g-wood-light)" stroke-width="1.4" stroke-dasharray="3 3"/>`;
      const from: Array<[number, number, number]> = [[36, 56, -12], [56, 54, 14], [34, 76, 20], [56, 78, -8], [46, 66, 4]];
      const pieces = colors.map((c, i) => ({ svg: tile(c), from: from[i] ?? [46, 66, 0], to: [110 + i * 24, 66, 0] as [number, number, number] }));
      return piecesScene(backdrop, pieces, { svg: `<rect x="-17" y="-24" width="34" height="20" rx="10" fill="var(--g-accent)"/><text x="0" y="-9.5" ${FONT} font-size="12" font-weight="800" fill="#fff" text-anchor="middle">+5</text>`, at: [222, 66], kind: 'rise' }, [218, 30], 0.17);
    }
    case 'birds': {
      const bird = (body: string) => `${cardRect(30, 40, 'var(--g-card)')}<ellipse cx="0" cy="-2" rx="9" ry="8" fill="${body}"/><circle cx="-4" cy="-5" r="1.4" fill="var(--g-charcoal)"/><path d="M-9 -3 L-13 -1 L-9 0 Z" fill="var(--g-butter-dark)"/><path d="M-11 12 h22" stroke="var(--g-steel-dark)" stroke-width="2" stroke-linecap="round" opacity=".5"/>`;
      const backdrop = `${floor(124, 118, 102)}<rect x="66" y="26" width="166" height="62" rx="10" fill="var(--g-leaf-light)" opacity=".55"/><path d="M72 84 C120 76 170 80 226 72" stroke="var(--g-wood-dark)" stroke-width="3" fill="none" stroke-linecap="round" opacity=".5"/>
        ${[0, 1, 2, 3].map((i) => at(92 + i * 38, 56, `<rect x="-16" y="-21" width="32" height="42" rx="5" fill="none" stroke="var(--g-leaf-dark)" stroke-width="1.2" stroke-dasharray="3 3" opacity=".6"/>`)).join('')}`;
      const bodies = ['var(--g-sky)', 'var(--g-rose)', 'var(--g-butter-dark)'];
      const pieces = bodies.map((c, i) => ({ svg: bird(c), from: [30 + i * 8, 104, -18 + i * 14] as [number, number, number], to: [92 + i * 38, 56, 0] as [number, number, number] }));
      return piecesScene(backdrop, pieces, { svg: `<ellipse cx="0" cy="-7" rx="6" ry="7.5" fill="var(--g-cream)"/><ellipse cx="0" cy="-7" rx="6" ry="7.5" fill="none" stroke="var(--g-wood-light)" stroke-width="1"/><circle cx="-1.5" cy="-9" r="1.2" fill="var(--g-sky)"/>`, at: [130, 72], kind: 'drop' }, [208, 36], 0.22);
    }
    case 'city': {
      const card = (fill: string, glyph: string) => `${cardRect(30, 40, 'var(--g-card)')}<rect x="-12" y="-17" width="24" height="16" rx="3" fill="${fill}"/>${glyph}`;
      const leaf = `<path d="M-4 8 C-4 2 2 -2 6 0 C6 6 0 10 -4 8 Z" fill="var(--g-leaf)"/>`;
      const backdrop = `${floor(122, 120, 104)}
        <path d="M44 112 C40 80 34 60 40 44" stroke="var(--g-wood-dark)" stroke-width="12" fill="none" stroke-linecap="round"/><circle cx="40" cy="38" r="28" fill="var(--g-leaf)"/><circle cx="22" cy="48" r="16" fill="var(--g-leaf-dark)"/><circle cx="58" cy="50" r="15" fill="var(--g-leaf-dark)"/><circle cx="40" cy="26" r="6" fill="var(--g-rose)" opacity=".9"/>
        ${[0, 1, 2, 3].map((i) => at(104 + (i % 2) * 36 + Math.floor(i / 2) * 72, 62, `<rect x="-16" y="-21" width="32" height="42" rx="5" fill="none" stroke="var(--g-wood)" stroke-width="1.2" stroke-dasharray="3 3" opacity=".6"/>`)).join('')}`;
      const looks = [['var(--g-clay)', leaf], ['var(--g-sky)', leaf], ['var(--g-butter-dark)', leaf], ['var(--g-rose)', leaf]] as const;
      const pieces = looks.map(([c, g], i) => ({ svg: card(c, g), from: [150, -44, -10 + i * 6] as [number, number, number], to: [104 + (i % 2) * 36 + Math.floor(i / 2) * 72, 62, 0] as [number, number, number] }));
      return piecesScene(backdrop, pieces, { svg: meeple('var(--g-wood)', 0.85), at: [140, 100], kind: 'drop' }, [212, 30], 0.2);
    }
    case 'wonders': {
      const back = `${cardRect(22, 30, 'var(--g-sky-dark)', 'rgba(0,0,0,.15)', 3)}<rect x="-7" y="-11" width="14" height="22" rx="2" fill="none" stroke="#fff" stroke-opacity=".3"/>`;
      const pyramid = [[96, 24], [120, 24], [144, 24], [108, 44], [132, 44]].map(([x, y]) => at(x ?? 0, y ?? 0, back)).join('');
      const face = (c: string) => `${cardRect(22, 30, 'var(--g-card)', 'var(--g-card-rim)', 3)}<rect x="-9" y="-13" width="18" height="7" rx="2" fill="${c}"/>`;
      const backdrop = `${floor(122, 120, 104)}${pyramid}<path d="M30 92 H210" stroke="var(--g-wood-light)" stroke-width="2" stroke-dasharray="4 4"/>`;
      const pieces = (['var(--g-leaf)', 'var(--g-rose-dark)', 'var(--g-butter-dark)'] as const).map((c, i) => ({ svg: face(c), from: [[108, 64], [132, 64], [120, 44]][i] ? ([...([[108, 64], [132, 64], [120, 44]][i] as [number, number]), 0] as [number, number, number]) : ([120, 44, 0] as [number, number, number]), to: [44 + i * 28, 82, 0] as [number, number, number] }));
      const temple = `<path d="M-22 0 H22 V-5 H-22 Z" fill="var(--g-wood)"/>${[-15, -5, 5, 15].map((x) => `<rect x="${x - 2.5}" y="-24" width="5" height="19" fill="var(--g-cream)"/>`).join('')}<path d="M-24 -24 L0 -38 L24 -24 Z" fill="var(--g-butter-dark)"/>`;
      return piecesScene(backdrop, pieces, { svg: temple, at: [178, 92], kind: 'rise' }, [206, 44], 0.22);
    }
  }
}

// ---------------------------------------------------------------------------------------------- words

function wordsScene(look: Extract<Look, { archetype: 'words' }>): Scene {
  switch (look.variant) {
    case 'codenames': {
      const word = `${cardRect(40, 26, 'var(--g-card)', 'var(--g-card-rim)', 3)}<path d="M-12 2 h24" stroke="var(--g-steel-dark)" stroke-width="2.6" stroke-linecap="round"/>`;
      const agent = (c: string) => `${cardRect(40, 26, c, 'rgba(0,0,0,.15)', 3)}<circle cx="0" cy="-2" r="4.5" fill="#fff" opacity=".85"/><path d="M-7 9 C-7 3 7 3 7 9" fill="#fff" opacity=".85"/>`;
      const grid: Array<[number, number]> = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) grid.push([56 + c * 44, 30 + r * 30]);
      const flips: Record<number, string> = { 1: 'var(--g-rose-dark)', 6: 'var(--g-sky-dark)', 8: 'var(--g-rose-dark)' };
      const cells = grid.map(([x, y], i) => at(x, y, flips[i] ? flipSvg(`c${i}`, word, agent(flips[i] ?? '')) : word)).join('');
      const svg = `${floor(122, 124, 100)}${cells}${at(206, 112, k('clue', `${cardRect(44, 20, 'var(--g-butter)', 'rgba(0,0,0,.12)', 4)}<path d="M-12 1 h16" stroke="var(--g-charcoal)" stroke-width="2.6" stroke-linecap="round"/><text x="12" y="5" ${FONT} font-size="11" font-weight="800" fill="var(--g-charcoal)" text-anchor="middle">2</text>`, 'ix-center'), -6)}`;
      return {
        svg,
        duration: 1.8,
        tracks(root) {
          return [arrive(root, 'clue', { x: 40, y: 10, r: 12, o: 0 }, 0, 0.36, EASE.bouncy), ...flip(root, 'c1', 0.5), ...flip(root, 'c8', 0.88), ...flip(root, 'c6', 1.26)];
        },
      };
    }
    case 'dixit': {
      const back = `${cardRect(40, 60, 'var(--g-sky-dark)', 'rgba(0,0,0,.15)', 6)}<circle cx="0" cy="0" r="11" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.6"/><circle cx="0" cy="0" r="4" fill="#fff" opacity=".3"/>`;
      const dream = `${cardRect(40, 60, 'var(--g-card)', 'var(--g-card-rim)', 6)}<rect x="-16" y="-26" width="32" height="44" rx="3" fill="var(--g-sky)"/><circle cx="6" cy="-14" r="6" fill="var(--g-butter)"/><circle cx="9" cy="-16" r="5" fill="var(--g-sky)"/><path d="M-14 8 C-6 2 2 12 14 6 V18 H-14 Z" fill="var(--g-sky-dark)"/><path d="M-6 6 L2 6 L0 9 L-4 9 Z" fill="var(--g-clay)"/><path d="M-2 6 V-4 L4 4 Z" fill="var(--g-cream)"/><circle cx="-9" cy="-18" r="1" fill="#fff"/><circle cx="-3" cy="-10" r=".9" fill="#fff"/>`;
      const token = (c: string) => `<circle cx="0" cy="-6" r="6" fill="${c}"/><circle cx="0" cy="-6" r="6" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1"/>`;
      const svg = `${floor(120, 120, 80)}${at(78, 64, back, -12)}${at(162, 64, back, 12)}
        ${at(120, 60, k('lift', flipSvg('card', back, dream), 'ix-center'))}
        ${at(108, 26, k('v1', token('var(--g-rose-dark)'), 'ix-feet'))}${at(124, 24, k('v2', token('var(--g-leaf)'), 'ix-feet'))}
        ${at(150, 22, k('spark', spark(6), 'ix-center'))}`;
      return {
        svg,
        duration: 1.85,
        tracks(root) {
          const lift = new Track(q(root, 'lift'), 'lift', { y: 6, s: 1 });
          lift.move(0.05, 0.4, { y: -6, s: 1.1 }, EASE.smooth);
          const v1 = new Track(q(root, 'v1'), 'v1', { y: -36, o: 0, sx: 1, sy: 1 });
          v1.path(1.0, [[1.05, { y: -32, o: 1 }, EASE.linear], [1.26, { y: 0 }, EASE.down]]);
          squash(v1, 1.26, 0.14);
          const v2 = new Track(q(root, 'v2'), 'v2', { y: -36, o: 0, sx: 1, sy: 1 });
          v2.path(1.16, [[1.21, { y: -32, o: 1 }, EASE.linear], [1.42, { y: 0 }, EASE.down]]);
          squash(v2, 1.42, 0.14);
          return [lift, ...flip(root, 'card', 0.46, 0.4), v1, v2, sparkIn(root, 'spark', 1.5)];
        },
      };
    }
    case 'justone': {
      const stand = (c: string, line: string) => `<path d="M-16 14 L-11 -6 H11 L16 14 Z" fill="${c}"/><rect x="-11" y="-4" width="22" height="9" rx="2" fill="var(--g-cream)"/><path d="M-6 0.5 h12" stroke="${line}" stroke-width="2.2" stroke-linecap="round"/>`;
      const hidden = `${cardRect(40, 52, 'var(--g-accent)', 'rgba(0,0,0,.12)', 6)}<text x="0" y="10" ${FONT} font-size="30" font-weight="800" fill="#fff" text-anchor="middle">?</text>`;
      const solved = `${cardRect(40, 52, 'var(--g-card)', 'var(--g-card-rim)', 6)}<path d="M-12 -12 h24 M-8 -5 h16" stroke="var(--g-steel-dark)" stroke-width="2.4" stroke-linecap="round"/><path d="M-10 8 L-3 15 L12 0" stroke="var(--g-leaf-dark)" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
      const stands: Array<[string, number, string]> = [['var(--g-sky-dark)', 40, 'var(--g-charcoal)'], ['var(--g-clay)', 86, 'var(--g-rose-dark)'], ['var(--g-leaf)', 154, 'var(--g-rose-dark)'], ['var(--g-rose)', 200, 'var(--g-charcoal)']];
      const svg = `${floor(120, 124, 104)}${at(120, 40, flipSvg('mystery', hidden, solved))}${stands.map(([c, x, line], i) => at(x, 104, k(`s${i}`, stand(c, line), 'ix-feet'))).join('')}${at(148, 18, k('spark', spark(6), 'ix-center'))}`;
      return {
        svg,
        duration: 1.95,
        tracks(root) {
          const out: Track[] = stands.map((_, i) => arrive(root, `s${i}`, { y: 34, o: 0 }, 0.05 + i * 0.1, 0.4 + i * 0.1, EASE.bouncy));
          // the two equal clues go away (they move down and fade — nothing pops)
          for (const i of [1, 2]) {
            const tr = out[i];
            tr?.path(0.92, [[1.0, { y: -6 }, EASE.up], [1.3, { y: 26, o: 0 }, EASE.down]]);
          }
          return [...out, ...flip(root, 'mystery', 1.34, 0.34), sparkIn(root, 'spark', 1.6)];
        },
      };
    }
    case 'dito': {
      const hl = (key: string) => k(key, `<rect x="-21" y="-12" width="38" height="12" rx="6" fill="var(--g-butter)"/>`, 'ix-center');
      // three players' sheets; the second word of the first two sheets is the same (highlighted), the third differs
      const sheet = (i: number) => `${cardRect(56, 70, 'var(--g-card)', 'var(--g-card-rim)', 5)}${i < 2 ? hl(`h${i}`) : ''}${[0, 1, 2, 3].map((r) => `<path d="M-18 ${-20 + r * 14} h${r === 1 ? 30 : 24}" stroke="${r === 1 ? 'var(--g-charcoal)' : 'var(--g-steel-dark)'}" stroke-width="3" stroke-linecap="round"/>`).join('')}`;
      const xs = [52, 120, 188];
      const rot = [-4, 2, 5];
      const svg = `${floor(120, 124, 100)}${xs.map((x, i) => at(x, 62, k(`sh${i}`, sheet(i), 'ix-center'), rot[i] ?? 0)).join('')}
        ${at(86, 34, k('star', `<path d="M0 -11 L3.2 -3.4 L11 -3 L5 2.2 L7 10 L0 5.8 L-7 10 L-5 2.2 L-11 -3 L-3.2 -3.4 Z" fill="var(--g-accent)"/>`, 'ix-center'))}`;
      return {
        svg,
        duration: 1.8,
        tracks(root) {
          const sheets = xs.map((_, i) => arrive(root, `sh${i}`, { y: 90, r: [-14, 6, 16][i] ?? 0, o: 0 }, 0.04 + i * 0.1, 0.44 + i * 0.1, EASE.smooth));
          const h0 = new Track(q(root, 'h0'), 'h0', { sx: 0.1, o: 0 });
          h0.move(0.78, 1.08, { sx: 1, o: 1 }, EASE.smooth);
          const h1 = new Track(q(root, 'h1'), 'h1', { sx: 0.1, o: 0 });
          h1.move(0.92, 1.22, { sx: 1, o: 1 }, EASE.smooth);
          return [...sheets, h0, h1, sparkIn(root, 'star', 1.3)];
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------- dice

function diceScene(): Scene {
  const colors = ['var(--g-die)', 'var(--g-butter)', 'var(--g-sky)', 'var(--g-leaf-light)', 'var(--g-clay)'];
  const faces = [5, 3, 6, 2, 4];
  const dieSvg = (c: string, f: number) => die(f).replace('fill="var(--g-die)"', `fill="${c}"`);
  const restX = [24, 54, 84, 40, 70];
  const restY = [78, 80, 76, 104, 106];
  const dice = colors.map((c, i) => at(restX[i] ?? 0, restY[i] ?? 0, k(`dx${i}`, k(`dy${i}`, k(`ds${i}`, `<g transform="translate(-13 -13)">${dieSvg(c, faces[i] ?? 1)}</g>`, 'ix-center'))))).join('');
  const box = (x: number, y: number, c: string) => `<rect x="${x}" y="${y}" width="16" height="16" rx="3" fill="${c}" opacity=".35"/><rect x="${x}" y="${y}" width="16" height="16" rx="3" fill="none" stroke="${c}" stroke-width="1.4"/>`;
  const rows = ['var(--g-butter-dark)', 'var(--g-sky-dark)', 'var(--g-leaf)', 'var(--g-clay)'];
  const sheet = rows.map((c, r) => [0, 1, 2, 3].map((col) => box(132 + col * 22, 22 + r * 22, c)).join('')).join('');
  const crosses = [[0, 0], [1, 1], [2, 1]].map(([col, r], i) => at(140 + (col ?? 0) * 22, 30 + (r ?? 0) * 22, k(`x${i}`, `<path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke="var(--g-charcoal)" stroke-width="2.8" stroke-linecap="round"/>`, 'ix-center'))).join('');
  const svg = `${floor(120, 124, 104)}<rect x="124" y="14" width="102" height="100" rx="8" fill="var(--g-card)"/><rect x="124" y="14" width="102" height="100" rx="8" fill="none" stroke="var(--g-card-rim)"/>${sheet}${crosses}
    ${at(196, 84, k('arrow', `<path d="M-12 8 C-4 -8 6 -8 12 0" stroke="var(--g-accent)" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M8 -4 L13 1 L6 3" stroke="var(--g-accent)" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`, 'ix-center'))}
    ${dice}`;
  return {
    svg,
    duration: 1.9,
    tracks(root) {
      const out: Track[] = [];
      colors.forEach((_, i) => {
        const t0 = i * 0.06;
        const land = 0.5 + i * 0.06;
        const x = new Track(q(root, `dx${i}`), `dx${i}`, { x: 250 + i * 10 });
        x.move(t0, land + 0.16, { x: 0 }, 'cubic-bezier(.3,.7,.4,1)');
        const y = new Track(q(root, `dy${i}`), `dy${i}`, { y: -70 - i * 4 });
        y.path(t0, [[land - 0.14, { y: 0 }, EASE.down], [land - 0.04, { y: -7 }, EASE.up], [land + 0.06, { y: 0 }, EASE.down]]);
        const s = new Track(q(root, `ds${i}`), `ds${i}`, { r: 0 });
        s.move(t0, land + 0.16, { r: -360 - 90 * (i % 2) }, 'cubic-bezier(.3,.7,.4,1)');
        out.push(x, y, s);
      });
      [0, 1, 2].forEach((i) => {
        const t = 1.0 + i * 0.16;
        const tr = new Track(q(root, `x${i}`), `x${i}`, { s: 0.4, o: 0 });
        tr.path(t, [[t + 0.06, { s: 0.7, o: 1 }, EASE.linear], [t + 0.26, { s: 1 }, EASE.bouncy]]);
        out.push(tr);
      });
      out.push(arrive(root, 'arrow', { x: -10, o: 0 }, 1.5, 1.85, EASE.smooth));
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------------- coop

function stackScene(cards: ReadonlyArray<{ label: string; color: string; from: [number, number, number] }>, finale: 'burst' | 'star'): Scene {
  const pile: [number, number] = [120, 80];
  const face = (label: string, color: string) => `${cardRect(36, 50, 'var(--g-card)', 'var(--g-card-rim)', 5)}<text x="0" y="9" ${FONT} font-size="${label.length > 1 ? 18 : 24}" font-weight="800" fill="${color}" text-anchor="middle">${label}</text><circle cx="-11" cy="-17" r="3" fill="${color}"/>`;
  const placed = cards.map((c, i) => at(pile[0] + (i % 2 ? 2 : -2), pile[1] - i * 4, k(`k${i}`, face(c.label, c.color), 'ix-center'), i % 2 ? 4 : -4)).join('');
  const rays = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((a, i) => `<g transform="rotate(${a})"><path d="M0 -10 L0 -24" stroke="${['var(--g-rose-dark)', 'var(--g-butter-dark)', 'var(--g-sky-dark)', 'var(--g-leaf)'][i % 4]}" stroke-width="3.4" stroke-linecap="round"/><circle cx="0" cy="-29" r="2.4" fill="${['var(--g-butter-dark)', 'var(--g-rose)', 'var(--g-leaf-light)', 'var(--g-sky)'][i % 4]}"/></g>`)
    .join('');
  const top = finale === 'burst' ? at(120, 28, k('fin', rays, 'ix-center')) : at(170, 34, k('fin', spark(10), 'ix-center'));
  const svg = `${floor(120, 124, 70)}${placed}${top}`;
  const n = cards.length;
  return {
    svg,
    duration: Math.min(2, 0.3 + n * 0.22 + 0.6),
    tracks(root) {
      const out: Track[] = cards.map((c, i) => {
        const t0 = 0.06 + i * 0.22;
        const [fx, fy, fr] = c.from;
        const tr = new Track(q(root, `k${i}`), `k${i}`, { x: fx - pile[0], y: fy - pile[1] + i * 4, r: fr, sx: 1, sy: 1 });
        tr.path(t0, [[t0 + 0.34, { x: 0, y: 0, r: 0 }, 'cubic-bezier(.25,.8,.35,1)']]);
        squash(tr, t0 + 0.34, 0.05);
        return tr;
      });
      const ft = 0.1 + n * 0.22 + 0.12;
      const fin = new Track(q(root, 'fin'), 'fin', { s: 0.2, o: 0, r: finale === 'burst' ? -20 : -40 });
      fin.path(ft, [[ft + 0.08, { s: 0.5, o: 1, r: -10 }, EASE.linear], [ft + 0.42, { s: 1, o: 1, r: 0 }, EASE.bouncy]]);
      out.push(fin);
      return out;
    },
  };
}

function coopScene(look: Extract<Look, { archetype: 'coop' }>): Scene {
  switch (look.variant) {
    case 'hanabi':
      return stackScene(
        ['1', '2', '3', '4', '5'].map((label, i) => ({ label, color: 'var(--g-rose-dark)', from: ([[-34, 128, -30], [274, 128, 30], [-34, 56, -40], [274, 60, 36], [120, 190, 0]][i] ?? [120, 190, 0]) as [number, number, number] })),
        'burst',
      );
    case 'mind':
      return stackScene(
        [
          { label: '12', color: 'var(--g-sky-dark)', from: [-34, 112, -30] },
          { label: '37', color: 'var(--g-clay)', from: [274, 112, 30] },
          { label: '81', color: 'var(--g-leaf-dark)', from: [120, 196, 0] },
        ],
        'star',
      );
    case 'wires': {
      const wires = ['var(--g-sky-dark)', 'var(--g-rose-dark)', 'var(--g-butter-dark)'];
      const bomb = `<circle cx="0" cy="0" r="26" fill="var(--g-charcoal)"/><rect x="-14" y="-8" width="28" height="14" rx="3" fill="#1d1a17"/><text x="0" y="4" ${FONT} font-size="10" font-weight="800" fill="var(--g-rose)" text-anchor="middle">0:42</text>`;
      const svg = `${floor(120, 124, 104)}
        ${wires.map((c, i) => `<path d="M62 ${50 + i * 14} C100 ${44 + i * 14} 110 ${58 + i * 14} 132 ${50 + i * 14}" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/>`).join('')}
        ${wires.map((c, i) => (i === 0 ? '' : `<path d="M140 ${50 + i * 14} C160 ${44 + i * 14} 180 ${58 + i * 14} 212 ${50 + i * 14}" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/>`)).join('')}
        ${at(140, 50, k('cut', `<path d="M0 0 C20 -6 40 8 72 0" stroke="${wires[0]}" stroke-width="5" fill="none" stroke-linecap="round"/>`))}
        ${at(46, 64, bomb)}
        ${at(46, 30, `<circle r="6" fill="var(--g-rose-dark)"/>`)}${at(46, 30, k('ok', `<circle r="6" fill="var(--g-leaf)"/><circle r="2.4" fill="#fff" opacity=".7"/>`, 'ix-center'))}
        ${at(136, 30, k('snip', `<g transform="rotate(20)"><circle cx="-6" cy="-14" r="5" fill="none" stroke="var(--g-clay)" stroke-width="3"/><circle cx="6" cy="-14" r="5" fill="none" stroke="var(--g-clay)" stroke-width="3"/><path d="M-4 -10 L3 14 M4 -10 L-3 14" stroke="var(--g-steel-dark)" stroke-width="3" stroke-linecap="round"/></g>`, 'ix-center'))}
        ${[2, 4, 4, 7].map((n, i) => at(152 + i * 20, 104, k(`n${i}`, `<rect x="-8" y="-11" width="16" height="22" rx="3" fill="var(--g-cream)" stroke="var(--g-wood)" stroke-width="1.2"/><text x="0" y="5" ${FONT} font-size="12" font-weight="800" fill="var(--g-charcoal)" text-anchor="middle">${n}</text>`, 'ix-feet'))).join('')}`;
      return {
        svg,
        duration: 1.85,
        tracks(root) {
          const nums = [0, 1, 2, 3].map((i) => arrive(root, `n${i}`, { y: 28, o: 0 }, 0.04 + i * 0.08, 0.4 + i * 0.08, EASE.bouncy));
          // the two 4s answer each other
          for (const i of [1, 2]) nums[i]?.path(0.6, [[0.72, { y: -8 }, EASE.up], [0.9, { y: 0 }, EASE.down]]);
          const snip = arrive(root, 'snip', { x: 40, y: -20, r: 30, o: 0 }, 0.5, 0.9, EASE.smooth);
          snip.path(0.9, [[1.0, { s: 0.85 }, EASE.down], [1.12, { s: 1 }, EASE.up]]);
          const cut = new Track(q(root, 'cut'), 'cut', { x: 0, y: 0, r: 0 });
          cut.path(1.0, [[1.3, { x: 6, y: 10, r: 12 }, EASE.bouncy]]);
          const ok = new Track(q(root, 'ok'), 'ok', { s: 0.3, o: 0 });
          ok.path(1.3, [[1.36, { s: 0.6, o: 1 }, EASE.linear], [1.62, { s: 1 }, EASE.bouncy]]);
          return [...nums, snip, cut, ok];
        },
      };
    }
    case 'lock': {
      const symbol = (i: number) =>
        [
          `<circle r="5" fill="none" stroke="var(--g-charcoal)" stroke-width="2.4"/>`,
          `<path d="M0 -6 L6 5 H-6 Z" fill="none" stroke="var(--g-charcoal)" stroke-width="2.4" stroke-linejoin="round"/>`,
          `<path d="M-5 -5 H5 V5 H-5 Z" fill="none" stroke="var(--g-charcoal)" stroke-width="2.4"/>`,
        ][i] ?? '';
      const cardSvg = (i: number, c: string) => `${cardRect(34, 46, 'var(--g-card)', 'var(--g-card-rim)', 4)}<rect x="-13" y="-19" width="26" height="22" rx="3" fill="${c}" opacity=".5"/><g transform="translate(0 -8)">${symbol(i)}</g><path d="M-10 12 h20" stroke="var(--g-steel-dark)" stroke-width="2" stroke-linecap="round" opacity=".6"/>`;
      const windows = [0, 1, 2].map((i) => at(150 + i * 20, 82, `<rect x="-8" y="-9" width="16" height="18" rx="2" fill="var(--g-cream)"/>${k(`q${i}`, `<text x="0" y="5" ${FONT} font-size="13" font-weight="800" fill="var(--g-steel-dark)" text-anchor="middle">?</text>`)}${k(`d${i}`, symbol(i))}`)).join('');
      const svg = `${floor(124, 124, 104)}
        ${[0, 1, 2].map((i) => at(30 + i * 30, 72, k(`cd${i}`, cardSvg(i, ['var(--g-sky)', 'var(--g-butter-dark)', 'var(--g-rose)'][i] ?? 'var(--g-sky)'), 'ix-center'), -10 + i * 10)).join('')}
        ${at(170, 50, k('shackle', `<path d="M-18 14 V-4 A18 18 0 0 1 18 -4 V14" stroke="var(--g-steel-dark)" stroke-width="7" fill="none"/>`))}
        ${at(170, 82, `<rect x="-36" y="-22" width="72" height="44" rx="8" fill="var(--g-butter-dark)"/><rect x="-36" y="-22" width="72" height="8" rx="4" fill="#fff" opacity=".25"/>`)}
        ${windows}${at(214, 40, k('spark', spark(7), 'ix-center'))}`;
      return {
        svg,
        duration: 1.85,
        tracks(root) {
          const out: Track[] = [0, 1, 2].map((i) => arrive(root, `cd${i}`, { x: -40, y: 30, r: -30, o: 0 }, 0.04 + i * 0.12, 0.44 + i * 0.12, EASE.bouncy));
          [0, 1, 2].forEach((i) => {
            const t = 0.72 + i * 0.16;
            const qq = new Track(q(root, `q${i}`), `q${i}`, { y: 0, o: 1 });
            qq.move(t, t + 0.16, { y: -8, o: 0 }, EASE.smooth);
            const d = new Track(q(root, `d${i}`), `d${i}`, { y: 8, o: 0 });
            d.move(t + 0.04, t + 0.22, { y: 0, o: 1 }, EASE.smooth);
            out.push(qq, d);
          });
          const sh = new Track(q(root, 'shackle'), 'shackle', { y: 0 });
          sh.path(1.3, [[1.48, { y: -12 }, EASE.bouncy]]);
          out.push(sh, sparkIn(root, 'spark', 1.42));
          return out;
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------- luck

function luckScene(look: Extract<Look, { archetype: 'luck' }>): Scene {
  switch (look.variant) {
    case 'cauldron': {
      const chip = (c: string) => `<circle r="7" fill="${c}"/><circle r="4" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.4"/>`;
      const chips = ['var(--g-leaf)', 'var(--g-butter-dark)', 'var(--g-sky)', 'var(--g-rose)'];
      const spots: Array<[number, number]> = [[132, 66], [150, 70], [116, 72], [140, 76]];
      const svg = `${floor(140, 122, 96)}
        <path d="M18 92 C14 70 22 58 34 54 C30 48 36 42 44 46 C52 42 58 48 54 54 C66 58 72 72 66 92 Z" fill="var(--g-wood-light)"/><path d="M34 54 C40 52 48 52 54 54" stroke="var(--g-wood-dark)" stroke-width="2.4" fill="none"/>
        ${at(140, 70, k('liquid', `<ellipse cx="0" cy="0" rx="46" ry="8" fill="var(--g-leaf-light)"/>`))}
        ${chips.map((c, i) => at(spots[i]?.[0] ?? 140, spots[i]?.[1] ?? 70, k(`ch${i}`, chip(c), 'ix-center'))).join('')}
        <path d="M86 72 H194 C194 104 174 118 140 118 C106 118 86 104 86 72 Z" fill="var(--g-charcoal)"/><ellipse cx="140" cy="72" rx="54" ry="9" fill="none" stroke="var(--g-steel-dark)" stroke-width="5"/>
        <path d="M80 74 H92 M188 74 H200" stroke="var(--g-steel-dark)" stroke-width="5" stroke-linecap="round"/>
        ${at(140, 36, k('puff', `<circle cx="-12" cy="0" r="9" fill="var(--g-cream)" opacity=".9"/><circle cx="6" cy="-6" r="12" fill="var(--g-cream)" opacity=".9"/><circle cx="18" cy="4" r="7" fill="var(--g-cream)" opacity=".9"/>`, 'ix-center'))}`;
      return {
        svg,
        duration: 1.9,
        tracks(root) {
          const out: Track[] = chips.map((_, i) => {
            const [sx, sy] = spots[i] ?? [140, 70];
            const t0 = 0.05 + i * 0.22;
            const x = new Track(q(root, `ch${i}`), `ch${i}`, { x: 44 - sx, y: 50 - sy, o: 0, r: -90 });
            x.path(t0, [[t0 + 0.08, { x: 44 - sx + 10, y: 50 - sy - 12, o: 1, r: -60 }, EASE.linear], [t0 + 0.2, { x: (44 - sx) * 0.4, y: -46, r: -20 }, EASE.up], [t0 + 0.38, { x: 0, y: 0, r: 0 }, EASE.down]]);
            return x;
          });
          const liquid = new Track(q(root, 'liquid'), 'liquid', { y: 4 });
          liquid.path(0.44, [[0.6, { y: 2 }, EASE.smooth], [0.82, { y: 0 }, EASE.smooth], [1.04, { y: -2 }, EASE.smooth], [1.26, { y: -4 }, EASE.smooth]]);
          const puff = new Track(q(root, 'puff'), 'puff', { y: 20, s: 0.3, o: 0 });
          puff.path(1.3, [[1.38, { y: 14, s: 0.5, o: 1 }, EASE.linear], [1.8, { y: 0, s: 1, o: 1 }, EASE.bouncy]]);
          out.push(liquid, puff);
          return out;
        },
      };
    }
    case 'discs': {
      const back = `<ellipse cx="0" cy="0" rx="26" ry="9" fill="var(--g-charcoal)"/><ellipse cx="0" cy="-2" rx="26" ry="9" fill="var(--g-steel-dark)"/><ellipse cx="0" cy="-2" rx="18" ry="5.6" fill="none" stroke="var(--g-cream)" stroke-opacity=".35" stroke-width="1.4"/>`;
      const rose = `<ellipse cx="0" cy="0" rx="26" ry="9" fill="var(--g-charcoal)"/><ellipse cx="0" cy="-2" rx="26" ry="9" fill="var(--g-cream)"/><circle cx="0" cy="-3" r="4.2" fill="var(--g-rose-dark)"/><circle cx="-2" cy="-4" r="2.2" fill="var(--g-rose)"/><path d="M-9 -1 C-6 -6 -3 -3 -3 -3 M9 -1 C6 -6 3 -3 3 -3" stroke="var(--g-leaf)" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      const svg = `${floor(120, 116, 84)}<rect x="40" y="70" width="160" height="46" rx="10" fill="var(--g-wood-light)" opacity=".7"/>
        ${[0, 1].map((i) => at(120, 98 - i * 9, k(`dk${i}`, back, 'ix-center'))).join('')}
        ${at(120, 80, k('top', flipSvg('flip', back, rose), 'ix-center'))}
        ${at(190, 40, k('card', `${cardRect(30, 40, 'var(--g-card)', 'var(--g-card-rim)', 4)}<text x="0" y="7" ${FONT} font-size="20" font-weight="800" fill="var(--g-charcoal)" text-anchor="middle">3</text>`, 'ix-center'), 10)}
        ${at(154, 56, k('spark', spark(6), 'ix-center'))}`;
      return {
        svg,
        duration: 1.75,
        tracks(root) {
          const d0 = arrive(root, 'dk0', { x: -90, y: -20, o: 0 }, 0.04, 0.34, EASE.smooth);
          const d1 = arrive(root, 'dk1', { x: 90, y: -24, o: 0 }, 0.16, 0.46, EASE.smooth);
          const top = arrive(root, 'top', { x: -60, y: -50, o: 0 }, 0.28, 0.6, EASE.smooth);
          const card = arrive(root, 'card', { x: 40, r: 30, o: 0 }, 0.64, 0.98, EASE.bouncy);
          return [d0, d1, top, card, ...flip(root, 'flip', 1.04, 0.36), sparkIn(root, 'spark', 1.36)];
        },
      };
    }
    case 'trick': {
      const face = (c: string, mark: string) => `${cardRect(34, 48, 'var(--g-card)', 'var(--g-card-rim)', 4)}<rect x="-13" y="-19" width="26" height="38" rx="3" fill="${c}" opacity=".25"/>${mark}`;
      const num = (n: string, c: string) => `<text x="0" y="8" ${FONT} font-size="20" font-weight="800" fill="${c}" text-anchor="middle">${n}</text>`;
      const wizard = `${cardRect(34, 48, 'var(--g-sky-dark)', 'rgba(0,0,0,.15)', 4)}<path d="M0 -16 L10 10 H-10 Z" fill="var(--g-butter)"/><path d="M-12 10 H12" stroke="var(--g-butter)" stroke-width="3" stroke-linecap="round"/><circle cx="2" cy="-4" r="1.6" fill="var(--g-sky-dark)"/><text x="0" y="22" ${FONT} font-size="9" font-weight="800" fill="#fff" text-anchor="middle">Z</text>`;
      const spots: Array<[number, number, number, string]> = [
        [100, 66, -14, face('var(--g-rose-dark)', num('7', 'var(--g-rose-dark)'))],
        [126, 58, 8, face('var(--g-leaf)', num('11', 'var(--g-leaf-dark)'))],
        [146, 72, 18, face('var(--g-butter-dark)', num('3', 'var(--g-wood-dark)'))],
        [122, 76, -2, wizard],
      ];
      const from: Array<[number, number, number]> = [[-40, 70, -40], [120, -50, 0], [280, 70, 40], [120, 190, 0]];
      const svg = `${floor(122, 122, 90)}${spots.map(([x, y, rot, s], i) => at(x, y, k(`t${i}`, s, 'ix-center'), rot)).join('')}${at(152, 40, k('spark', spark(8), 'ix-center'))}`;
      return {
        svg,
        duration: 1.7,
        tracks(root) {
          const out: Track[] = spots.map(([x, y, rot], i) => {
            const [fx, fy, fr] = from[i] ?? [120, 160, 0];
            const t0 = 0.04 + i * 0.2;
            const a = (-rot * Math.PI) / 180;
            const dx = fx - x;
            const dy = fy - y;
            const tr = new Track(q(root, `t${i}`), `t${i}`, { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a), r: fr - rot, s: 1 });
            tr.move(t0, t0 + 0.36, { x: 0, y: 0, r: 0 }, 'cubic-bezier(.25,.8,.35,1)');
            return tr;
          });
          // the wizard wins the trick
          out[3]?.path(1.0, [[1.14, { s: 1.16, y: -8 }, EASE.up], [1.42, { s: 1.1, y: -6 }, EASE.bouncy]]);
          out.push(sparkIn(root, 'spark', 1.2));
          return out;
        },
      };
    }
    case 'duel': {
      const fighter = (c: string, glyph: string) => `${cardRect(44, 60, 'var(--g-card)', 'var(--g-card-rim)', 5)}<rect x="-17" y="-24" width="34" height="30" rx="3" fill="${c}"/>${glyph}<rect x="-14" y="12" width="12" height="12" rx="6" fill="var(--g-charcoal)"/><text x="-8" y="21.5" ${FONT} font-size="9" font-weight="800" fill="#fff" text-anchor="middle">5</text>`;
      const hero = `<circle cx="0" cy="-12" r="7" fill="var(--g-cream)"/><path d="M-9 4 C-9 -4 9 -4 9 4 Z" fill="var(--g-cream)"/>`;
      const robot = `<rect x="-7" y="-19" width="14" height="12" rx="3" fill="var(--g-steel)"/><circle cx="-3" cy="-13" r="1.6" fill="var(--g-charcoal)"/><circle cx="3" cy="-13" r="1.6" fill="var(--g-charcoal)"/><rect x="-9" y="-6" width="18" height="10" rx="2" fill="var(--g-steel)"/>`;
      const svg = `${floor(120, 122, 96)}
        ${at(94, 70, k('left', fighter('var(--g-clay)', hero), 'ix-feet'))}
        ${at(150, 72, k('right', fighter('var(--g-sky-dark)', robot), 'ix-feet'))}
        ${at(94, 18, k('cup', `<path d="M-10 -8 H10 V0 C10 7 5 10 0 10 C-5 10 -10 7 -10 0 Z" fill="var(--g-butter-dark)"/><path d="M-10 -5 C-17 -5 -16 4 -9 4 M10 -5 C17 -5 16 4 9 4" stroke="var(--g-butter-dark)" stroke-width="2.4" fill="none"/><rect x="-2" y="10" width="4" height="5" fill="var(--g-butter-dark)"/><rect x="-7" y="15" width="14" height="4" rx="1" fill="var(--g-wood)"/>`, 'ix-center'))}`;
      return {
        svg,
        duration: 1.8,
        tracks(root) {
          const left = new Track(q(root, 'left'), 'left', { x: -110, r: -20, y: 30 });
          left.path(0.04, [[0.44, { x: 0, r: 0, y: 0 }, 'cubic-bezier(.25,.8,.35,1)'], [0.56, { x: 10, r: 6 }, EASE.up], [0.8, { x: 0, r: 0 }, EASE.bouncy], [1.2, { y: -10 }, EASE.smooth]]);
          const right = new Track(q(root, 'right'), 'right', { x: 110, r: 20, y: 30, o: 1 });
          right.path(0.1, [[0.5, { x: 0, r: 0, y: 0 }, 'cubic-bezier(.25,.8,.35,1)'], [0.62, { x: -6, r: -4 }, EASE.up], [1.0, { x: 26, r: 34, y: 14 }, EASE.down], [1.2, { x: 24, r: 30, y: 12, o: 0.55 }, EASE.smooth]]);
          const cup = new Track(q(root, 'cup'), 'cup', { y: 26, s: 0.4, o: 0 });
          cup.path(1.2, [[1.28, { y: 20, s: 0.6, o: 1 }, EASE.linear], [1.66, { y: 0, s: 1 }, EASE.bouncy]]);
          return [left, right, cup];
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------- music

function musicScene(): Scene {
  const year = (y: string, c: string) => `${cardRect(40, 52, 'var(--g-card)', 'var(--g-card-rim)', 5)}<rect x="-16" y="-22" width="32" height="20" rx="3" fill="${c}" opacity=".3"/><text x="0" y="16" ${FONT} font-size="12" font-weight="800" fill="var(--g-charcoal)" text-anchor="middle">${y}</text><path d="M-4 -16 V-6 M-4 -16 L4 -18 V-8" stroke="${c}" stroke-width="2" fill="none"/><circle cx="-6" cy="-6" r="2.4" fill="${c}"/><circle cx="2" cy="-8" r="2.4" fill="${c}"/>`;
  const qr = `${cardRect(40, 52, 'var(--g-charcoal)', 'rgba(0,0,0,.3)', 5)}${[0, 1, 2, 3, 4]
    .flatMap((r) => [0, 1, 2, 3, 4].map((c) => ((r * 3 + c * 7) % 5 < 2 ? `<rect x="${-12 + c * 5}" y="${-14 + r * 5}" width="4" height="4" fill="#fff" opacity=".85"/>` : '')))
    .join('')}<text x="0" y="22" ${FONT} font-size="8" font-weight="800" fill="#fff" opacity=".7" text-anchor="middle">♪ ♪</text>`;
  const svg = `${floor(120, 124, 108)}<path d="M14 96 H226" stroke="var(--g-wood-light)" stroke-width="3" stroke-linecap="round"/>
    ${at(40, 68, k('y0', year('1985', 'var(--g-rose-dark)'), 'ix-center'))}${at(146, 68, k('y1', year('2003', 'var(--g-sky-dark)'), 'ix-center'))}${at(198, 68, k('y2', year('2019', 'var(--g-leaf)'), 'ix-center'))}
    ${at(92, 68, k('new', flipSvg('song', qr, year('1994', 'var(--g-butter-dark)')), 'ix-center'))}
    ${at(110, 26, k('note', `<path d="M0 -10 V6 M0 -10 L10 -12 V4" stroke="var(--g-accent)" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="-3" cy="6" r="3.6" fill="var(--g-accent)"/><circle cx="7" cy="4" r="3.6" fill="var(--g-accent)"/>`, 'ix-center'))}`;
  return {
    svg,
    duration: 1.95,
    tracks(root) {
      const y0 = new Track(q(root, 'y0'), 'y0', { x: 6 });
      y0.move(0.5, 0.8, { x: 0 }, EASE.smooth);
      const y1 = new Track(q(root, 'y1'), 'y1', { x: -28 });
      y1.move(0.5, 0.82, { x: 0 }, EASE.smooth);
      const y2 = new Track(q(root, 'y2'), 'y2', { x: -2 });
      y2.move(0.52, 0.82, { x: 0 }, EASE.smooth);
      const nw = new Track(q(root, 'new'), 'new', { x: 14, y: -124, r: -18, sx: 1, sy: 1 });
      nw.path(0.08, [[0.5, { x: 6, y: -34, r: -10 }, EASE.smooth], [0.86, { x: 0, y: 0, r: 0 }, EASE.down]]);
      squash(nw, 0.86, 0.06);
      const note = new Track(q(root, 'note'), 'note', { y: 22, o: 0, r: -16 });
      note.path(1.5, [[1.56, { y: 18, o: 1, r: -12 }, EASE.linear], [1.9, { y: 0, r: 0 }, EASE.smooth]]);
      return [y0, y1, y2, nw, ...flip(root, 'song', 1.12, 0.36), note];
    },
  };
}

// ---------------------------------------------------------------------------------------------- entry

export function sceneFor(look: Look): Scene {
  switch (look.archetype) {
    case 'tiles':
      return tilesScene(look);
    case 'route':
      return routeScene(look);
    case 'pattern':
      return patternScene(look);
    case 'words':
      return wordsScene(look);
    case 'dice':
      return diceScene();
    case 'coop':
      return coopScene(look);
    case 'luck':
      return luckScene(look);
    case 'music':
      return musicScene();
  }
}

/** The scene as an <svg> element string (class ix-play) for a container. */
export function sceneSvg(scene: Scene, label: string): string {
  return `<svg class="ix-play" viewBox="0 0 ${VIEW.w} ${VIEW.h}" role="img" aria-label="${label.replace(/"/g, '&quot;')}" focusable="false">${scene.svg}</svg>`;
}

/** The drawing / motion building blocks, shared with the scenes of the new games (newscenes.ts, 30.10, gallery-only). */
export { arrive, at, cardRect, flip, flipSvg, floor, FONT, hexPath, k, meeple, q, r1, spark, sparkIn, squash };
