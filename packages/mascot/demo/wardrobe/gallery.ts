/**
 * Gallery page for the wardrobe v2 (26.10; Felix: «шарф нравится; мышь странная; ленточка не в тему; шапочка
 * ок, но не идеально — больше креатива и масштаба»). A GALLERY-ONLY prototype on the mascot gallery (5180); the
 * app gets it only after Felix's OK.
 *
 *   ?screens=wardrobe                         the year strip, the seven items with their moments (96 / 64 px), the
 *                                             big stage and the pose grid (96 px; every cell frozen)
 *     &item=<id>                              only this item (scarf, beanie, wreath, ring, witch, nikolaus, party)
 *     &theme=light|dark|navy                  only this theme in the grid (default: all three)
 *     &size=64|96|148                         the grid's size (default 96)
 *     &poses=all                              every pose in every theme (default: all 8 in the light theme, 4 key
 *                                             poses in the dark and Blau ones)
 *     &palette=1..3                           another colour set for the chosen item (WEAR_PALETTES)
 *     &reduced=1                              reduced motion: the item is already in place, no moment
 *     &grid=0                                 no grid
 *     &t=0.4                                  one frozen frame of the item's moment (deterministic; screenshots)
 *     &contact=1 [&frames=10] [&size=148]     contact sheet: every moment frame by frame, one row per item
 *       [&t0=0.2&t1=0.6]                      only this window of the moments
 *     (not "sheet" / "frame" / "static": main.ts reserves those for the welcome stage and the static poses)
 *
 * Every grid cell is the REAL puppet of that pose: the mascot (Bunny / Hamster), the welcome stage's peek, the
 * carry stage, the Lists buddy's held pose — and the item is put on from outside (items.ts putOn), exactly where
 * a later slot in the markup would be. Design note: docs/design/2026-10-26-wardrobe.md.
 */

import { Bunny, CarryStage, Hamster, WelcomeStage } from '../../src/index';
import { BuddyRig, geometry } from '../../src/buddy/rig';
import { childOf, dayOfYear, putOn, puppetRoots, WEAR, WEAR_IDS, WEAR_PALETTES, wearVars, wornOn, type WearId, type WearKind, type WearTheme } from './items';
import { EASE, MOMENTS, momentTotal, Update } from './update';

type PoseId = 'front' | 'left' | 'right' | 'jump' | 'sniff' | 'peek' | 'carry' | 'buddy';
type Puppet = Bunny | Hamster;

export const POSES: Readonly<Record<WearKind, readonly { id: PoseId; label: string }[]>> = {
  bunny: [
    { id: 'front', label: 'Спереди' },
    { id: 'left', label: '3/4 влево' },
    { id: 'right', label: '3/4 вправо' },
    { id: 'jump', label: 'Верх прыжка' },
    { id: 'sniff', label: 'Нюх (ухо −38°)' },
    { id: 'peek', label: 'Из-за края' },
    { id: 'carry', label: 'Перенос' },
    { id: 'buddy', label: 'Дружок в руке' },
  ],
  hamster: [
    { id: 'front', label: 'Спереди' },
    { id: 'left', label: '3/4 влево' },
    { id: 'right', label: '3/4 вправо' },
    { id: 'jump', label: 'Верх прыжка' },
    { id: 'sniff', label: 'Щёки 1,35' },
    { id: 'peek', label: 'Из-за края' },
    { id: 'carry', label: 'Бинокль (Freunde)' },
    { id: 'buddy', label: 'Дружок в руке' },
  ],
};
/** The poses of the compact panels (dark, Blau): the turn, the jump and the peek are where items go wrong. */
const KEY_POSES: readonly PoseId[] = ['front', 'right', 'jump', 'peek'];

export const THEMES: readonly { id: WearTheme; label: string }[] = [
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
  { id: 'navy', label: 'Blau' },
];
export const SIZES = [148, 96, 64] as const;

/** The app's page colours and mascot tokens per theme (tokens.css, navy.css). */
const THEME_VARS: Record<WearTheme, Record<string, string>> = {
  light: { '--wr-bg': '#F2EBDD', '--wr-card': '#FFFDF8', '--wr-text': '#2A231C', '--wr-text2': '#62554A', '--wr-line': 'rgba(116,84,44,.15)', '--mascot-shadow': 'rgba(70,40,15,.20)', '--mascot-outline': 'rgba(224,171,116,.5)' },
  dark: { '--wr-bg': '#17120F', '--wr-card': '#2A221D', '--wr-text': '#F5EDE3', '--wr-text2': '#C3B5A6', '--wr-line': 'rgba(255,230,205,.13)', '--mascot-shadow': 'rgba(0,0,0,.42)', '--mascot-outline': 'rgba(255,214,170,.2)' },
  navy: { '--wr-bg': '#0F1526', '--wr-card': '#1D263B', '--wr-text': '#EEF2FA', '--wr-text2': '#AEB9CF', '--wr-line': 'rgba(200,220,255,.13)', '--mascot-shadow': 'rgba(0,0,0,.42)', '--mascot-outline': 'rgba(220,232,255,.18)' },
};

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WHO: Record<WearKind, string> = { bunny: 'Помпон', hamster: 'Тапси' };
/** Short names for the year strip's short spans. */
const SHORT: Record<WearId, string> = { scarf: 'шарф', beanie: 'шапочка', wreath: 'венок', ring: 'круг', witch: 'ведьма', nikolaus: 'Николаус', party: 'колпак' };
/** Today in the gallery (the strip's marker): the real date. */
const TODAY: readonly [number, number] = [new Date().getDate(), new Date().getMonth() + 1];

const PAGE_CSS = `
.app.wr-page { max-width: none; padding: 20px 16px 48px; }
.wr-page h1 { margin: 4px 6px; }
.wr-page .sub { max-width: 940px; }
.wr-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 6px; font-size: 13px; color: var(--text-2); }
.wr-bar b { font-weight: 600; margin-right: 4px; min-width: 64px; }
.wr-bar a, .wr-bar button { appearance: none; border: 0; border-radius: 999px; padding: 6px 11px; font: 600 13px/1 inherit; font-family: inherit;
  background: var(--tile); color: var(--text); text-decoration: none; cursor: pointer; }
.wr-bar a[aria-current="true"], .wr-bar button[aria-pressed="true"] { background: color-mix(in srgb, var(--accent-ui) 22%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent-ui); }
.wr-h2 { margin: 18px 6px 8px; font-size: 19px; }
.wr-year { background: var(--wr-bg); color: var(--wr-text); border-radius: 22px; padding: 12px 14px 14px; margin: 10px 0 8px; max-width: 1100px;
  box-shadow: 0 0 0 1px var(--wr-line); }
.wr-yrow { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 8px; }
.wr-yrow + .wr-yrow { margin-top: 6px; }
.wr-yrow.hamster { margin-bottom: 14px; }
.wr-yrow.bunny { margin-top: 16px; }
.wr-ylab { font-size: 12px; font-weight: 700; text-align: right; color: var(--wr-text); }
.wr-ylab small { display: block; font-weight: 400; color: var(--wr-text2); }
.wr-months { position: relative; display: grid; grid-template-columns: repeat(12, 1fr); font-size: 11px; color: var(--wr-text2); }
.wr-months span { padding: 0 0 3px 3px; border-left: 1px solid var(--wr-line); }
.wr-track { position: relative; height: 30px; border-radius: 9px; background: repeating-linear-gradient(90deg, transparent 0, transparent calc(100% / 12 - 1px), var(--wr-line) calc(100% / 12 - 1px), var(--wr-line) calc(100% / 12)); }
.wr-span { position: absolute; top: 3px; height: 24px; border-radius: 8px; border: 0; padding: 0 6px; cursor: pointer; font: 700 12px/24px inherit; font-family: inherit;
  color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
.wr-span.narrow { overflow: visible; }
.wr-span.narrow { padding: 0; }
.wr-span.narrow > em { position: absolute; left: 50%; top: -15px; transform: translateX(-50%); font-style: normal; font-size: 11px; line-height: 1; color: var(--wr-text); text-shadow: none; }
.wr-span em { font-style: normal; }
.wr-today { position: absolute; top: -4px; bottom: -4px; width: 2px; border-radius: 1px; background: var(--wr-text); opacity: .55; pointer-events: none; }
.wr-today::after { content: attr(data-label); position: absolute; bottom: -15px; left: 4px; font-size: 10px; white-space: nowrap; }
.wr-occ { font-size: 12px; color: var(--wr-text2); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wr-occ button { border: 0; border-radius: 8px; padding: 4px 9px; font: 700 12px/1.4 inherit; font-family: inherit; color: #fff; cursor: pointer; }
.wr-rules { font-size: 12px; color: var(--wr-text2); margin: 8px 0 0 82px; line-height: 1.45; }
.wr-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 12px; max-width: 1240px; margin: 8px 0 6px; }
.wr-card2 { background: var(--wr-bg); color: var(--wr-text); border-radius: 20px; padding: 10px 12px 12px; box-shadow: 0 0 0 1px var(--wr-line); display: flex; flex-direction: column; gap: 6px; }
.wr-card2 h3 { margin: 0; font-size: 15px; }
.wr-card2 h3 small { font-weight: 400; color: var(--wr-text2); font-size: 12px; }
.wr-card2 .when { font-size: 12px; color: var(--wr-text2); }
.wr-pair { display: flex; align-items: flex-end; gap: 6px; }
.wr-box { position: relative; flex: none; overflow: hidden; border-radius: 12px; background: var(--wr-card); box-shadow: inset 0 0 0 1px var(--wr-line); }
.wr-box > .wr-host { position: absolute; }
.wr-card2 .moment { font-size: 12px; line-height: 1.4; }
.wr-card2 .moment b { font-size: 13px; }
.wr-card2 button { align-self: flex-start; appearance: none; border: 0; border-radius: 999px; padding: 7px 12px; font: 700 13px/1 inherit; font-family: inherit;
  background: color-mix(in srgb, var(--accent-ui) 22%, transparent); color: var(--wr-text); box-shadow: inset 0 0 0 1.5px var(--accent-ui); cursor: pointer; }
.wr-stage { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; margin: 10px 0 22px; }
.wr-stage-box { position: relative; width: 300px; height: 330px; border-radius: 28px; background: var(--wr-bg); flex: none; overflow: hidden;
  box-shadow: 0 0 0 1px var(--wr-line); }
.wr-stage-box > .wr-host { position: absolute; left: 30px; bottom: 26px; }
.wr-stage-ctl { flex: 1 1 360px; display: flex; flex-direction: column; gap: 8px; }
.wr-stage-ctl .wr-bar { margin: 0; }
.wr-steps { margin: 2px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--text-2); line-height: 1.5; max-width: 620px; }
.wr-big { font-size: 16px !important; padding: 12px 20px !important; }
.wr-scrub { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.wr-scrub input { flex: 1; max-width: 360px; accent-color: var(--accent-ui); }
.wr-panel { background: var(--wr-bg); color: var(--wr-text); border-radius: 26px; padding: 14px 14px 18px; margin: 0 0 18px; overflow-x: auto;
  box-shadow: 0 0 0 1px var(--wr-line); }
.wr-panel h2 { margin: 2px 6px 10px; font-size: 18px; }
.wr-grid { display: grid; gap: 6px 10px; align-items: end; }
.wr-grid .wr-h { font-size: 11px; font-weight: 600; color: var(--wr-text2); text-align: center; padding: 10px 0 2px; }
.wr-grid .wr-rl { font-size: 11px; color: var(--wr-text2); text-align: right; padding-right: 4px; align-self: center; line-height: 1.3; }
.wr-grid .wr-rl b { display: block; color: var(--wr-text); font-size: 12px; }
.wr-cell { position: relative; justify-self: center; overflow: hidden; border-radius: 10px; box-shadow: 0 0 0 1px var(--wr-line); }
.wr-cell > .wr-host, .wr-clip > .wr-host { position: absolute; }
.wr-card { position: absolute; left: 0; right: 0; bottom: 0; background: var(--wr-card); border-radius: 10px 10px 0 0; box-shadow: 0 -1px 0 var(--wr-line); }
.wr-clip { position: absolute; left: 0; right: 0; top: 0; overflow: hidden; }
.wr-sheet { display: grid; gap: 8px; }
.wr-sheet small { display: block; text-align: center; font-size: 11px; color: var(--wr-text2); font-variant-numeric: tabular-nums; margin-top: 3px; }
.wr-note { font-size: 12px; color: var(--text-2); margin: 6px; max-width: 940px; }
`;

// ---- helpers ------------------------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setVars(node: HTMLElement, vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
}

function hmOf(p: Puppet): SVGGElement | null {
  return p.root.querySelector<SVGGElement>('.hm');
}

/** Puppet aspect (height / width of the host). */
const ASPECT: Record<WearKind, number> = { bunny: 260 / 400, hamster: 250 / 400 };
/** Puppet units above his feet a moment needs: the tallest hat (≈ 250) plus its drop (≈ 110). */
const HEADROOM = 370;
/** px per puppet unit at a host width */
const unitPx = (kind: WearKind, size: number) => ((kind === 'bunny' ? 1.2 : 1.25) * size) / 400;

function makePuppet(kind: WearKind, host: HTMLElement, size: number, reduced: 'force' | 'off', idle = false): Puppet {
  const base = { size, idle, interactive: false, reducedMotion: reduced } as const;
  return kind === 'bunny' ? new Bunny(host, { ...base, coat: 'fawn', ears: 'lop' }) : new Hamster(host, { ...base, coat: 'golden' });
}

/** Freezes every animation of a puppet (its own scene, its CSS breathing) at `ms` / at 0. */
function freezeAt(p: Puppet, pick: (a: Animation) => number): void {
  const svg = p.root.querySelector('svg');
  for (const a of svg?.getAnimations?.({ subtree: true }) ?? []) {
    a.pause();
    a.currentTime = pick(a);
  }
}

/** Puts the item on every puppet under `node` (now, and once more after layout: a stage may rebuild on its first resize). */
function dressAll(node: Element, id: WearId): void {
  const go = () => {
    for (const root of puppetRoots(node)) putOn(root, id);
  };
  go();
  requestAnimationFrame(() => requestAnimationFrame(go));
}

const fmt = (s: number) => s.toFixed(2).replace('.', ',');

// ---- one frozen cell per pose ---------------------------------------------------------------------------------

/** Cell box: the puppet sits at the bottom with headroom for the jump and the tall hats. */
function cellBox(size: number): { w: number; h: number; floor: number } {
  return { w: size, h: Math.round(size * 1.12), floor: Math.round(size * 0.05) };
}

/** One frozen cell; pass `parent` so the cell is in the document before its puppet is built (see themePanel). */
export function buildCell(kind: WearKind, id: WearId, pose: PoseId, size: number, parent?: HTMLElement): HTMLElement {
  const box = cellBox(size);
  const cell = el('div', 'wr-cell');
  cell.style.width = `${box.w}px`;
  cell.style.height = `${box.h}px`;
  cell.dataset['pose'] = pose;
  parent?.append(cell);
  const host = el('div', 'wr-host');
  host.style.left = '0px';
  host.style.bottom = `${box.floor}px`;

  const simple = (setup: (p: Puppet) => void, reduced: 'force' | 'off' = 'force'): HTMLElement => {
    cell.append(host);
    const p = makePuppet(kind, host, size, reduced);
    setup(p);
    const worn = putOn(p.root, id);
    if (worn) worn.dataset['cell'] = pose;
    return cell;
  };

  switch (pose) {
    case 'front':
      return simple(() => undefined);
    case 'left':
    case 'right':
      return simple((p) => hmOf(p)?.classList.add(pose === 'left' ? 'turn-l' : 'turn-r'));
    case 'jump':
      // the approved jump (bunny: binky, 40 units, 0.96 s; hamster: 36, 0.9 s), frozen at its top
      return simple((p) => {
        const d = kind === 'bunny' ? 960 : 900;
        p.setEyes('star');
        const jump = (p as unknown as { jumpMotion(h: number, ms: number, binky?: boolean): Promise<void> }).jumpMotion(kind === 'bunny' ? 40 : 36, d, kind === 'bunny');
        jump.catch(() => undefined);
        // (Chromium lists an element's animations only while it is in the document: build the cell attached)
        freezeAt(p, (a) => (Number(a.effect?.getTiming().duration) === d ? d * 0.5 : 0));
      }, 'off');
    case 'sniff':
      return simple((p) => {
        if (p instanceof Bunny) p.pose('alert');
        else {
          p.setPuff(1.35);
          p.setEyes('happy');
        }
      });
    case 'peek':
      return kind === 'bunny' ? bunnyPeek(cell, id, size) : hamsterPeek(cell, host, id, size);
    case 'carry':
      if (kind === 'hamster') return simple((p) => (p as Hamster).setHolding('binoculars'));
      return carryCell(cell, id, size);
    case 'buddy':
      return buddyCell(cell, host, kind, id, size);
  }
}

/** The welcome stage's peek-once (the empty screens), frozen at its end: the real peeking actor wears the item. */
function bunnyPeek(cell: HTMLElement, id: WearId, size: number): HTMLElement {
  const box = cellBox(size);
  const card = el('div', 'wr-card');
  const cardH = Math.round(size * 0.2);
  card.style.height = `${cardH}px`;
  const inset = Math.round(size * 0.08);
  const stageHost = el('div', 'wr-stagehost');
  // the stage is at least 120 px tall (its own :host min-height): anchor its bottom (the card's top + inset), the
  // part above the cell is empty and clipped by the cell
  const bottom = box.h - cardH + inset;
  const hostH = Math.max(140, bottom);
  stageHost.style.cssText = `position:absolute;left:0;top:${bottom - hostH}px;width:${box.w}px;height:${hostH}px`;
  cell.append(card, stageHost);
  queueMicrotask(() => {
    const unit = size * 0.486; // stageUnit = size / 162 ⇔ the mascot's 1.2 × width / 400
    const stage = new WelcomeStage(stageHost, { bunnies: ['fawn'], choreography: 'peek-once', reducedMotion: 'off', minSize: unit, maxSize: unit, edgeInset: { bottom: inset }, edgeRadius: { bottom: 10 } });
    stage.seek(stage.duration);
    dressAll(stageHost, id);
  });
  return cell;
}

/** Tapsi peeking in over a card edge (the HamsterEdgeStage composition: feet behind the edge, cheeks a bit full). */
function hamsterPeek(cell: HTMLElement, host: HTMLElement, id: WearId, size: number): HTMLElement {
  const box = cellBox(size);
  const cardH = Math.round(size * 0.2);
  const card = el('div', 'wr-card');
  card.style.height = `${cardH}px`;
  const clip = el('div', 'wr-clip');
  clip.style.height = `${box.h - cardH}px`;
  // feet 22 % of his height below the edge, like HamsterEdgeStage (112 of 144 px shown)
  const tall = size * ASPECT.hamster;
  host.style.bottom = '';
  host.style.top = `${Math.round(box.h - cardH - tall * 0.78)}px`;
  clip.append(host);
  cell.append(clip, card);
  const p = makePuppet('hamster', host, size, 'force');
  p.setPuff(1.22);
  p.setEyes('happy');
  putOn(p.root, id);
  return cell;
}

/** The carry stage (CarryStage, the bunny takes a new card to its place), frozen mid-hop on the way. */
function carryCell(cell: HTMLElement, id: WearId, size: number): HTMLElement {
  const box = cellBox(size);
  const stageHost = el('div', 'wr-stagehost');
  stageHost.style.cssText = `position:absolute;left:0;top:0;width:${box.w}px;height:${box.h}px`;
  cell.append(stageHost);
  queueMicrotask(() => {
    const tall = size * 0.51; // the mascot's height in px at this width (170 units × 1.2 × width / 400)
    // a straight way just under the cell (feet: from.centre + 0.25 tall → to.top + 4); the carry bends it upward
    // in the middle, so mid-way the bunny hops across the middle of the cell
    const line = box.h + tall * 0.08;
    const bw = tall * 0.4;
    const bh = tall * 0.3;
    const carry = new CarryStage(stageHost, {
      from: { left: -box.w * 0.3 - bw / 2, top: line - tall * 0.25 - bh / 2, width: bw, height: bh },
      to: { left: box.w * 1.3 - bw / 2, top: line - 4, width: bw, height: bh },
      item: 'card',
      tint: '#F7B27A',
      coat: 'fawn',
      size: tall,
      reducedMotion: 'off',
    });
    carry.seek(carryT);
    dressAll(stageHost, id);
  });
  return cell;
}
/** The carry frame shown: mid-air on the way (tuned in the gallery; &carryT= overrides it). */
export const CARRY_T = 1.1;
let carryT: number = CARRY_T;

/** The Lists buddy held up by the scruff (his real rig: feet and paws hang, ears flop, worried brows), tilted in the swing. */
function buddyCell(cell: HTMLElement, host: HTMLElement, kind: WearKind, id: WearId, size: number): HTMLElement {
  const box = cellBox(size);
  const geo = geometry(kind, size);
  host.style.bottom = '';
  // the finger holds the scruff a little below the cell's top (lower with a hat: it stands above the scruff)
  host.style.left = `${Math.round(box.w / 2 - geo.scruff.x)}px`;
  host.style.top = `${Math.round(size * (WEAR[id].slot === 'head' ? 0.42 : 0.24) - geo.scruff.y)}px`;
  host.style.transformOrigin = `${geo.scruff.x}px ${geo.scruff.y}px`;
  host.style.transform = 'rotate(9deg)';
  cell.append(host);
  const p = makePuppet(kind, host, size, 'force');
  const rig = new BuddyRig(p, kind);
  rig.set('bd-held', true);
  rig.worry(true);
  rig.set('m-open', true);
  rig.swing(10, 7);
  if (kind === 'hamster') p.setPuff(1.15);
  putOn(p.root, id);
  return cell;
}

// ---- the grid -----------------------------------------------------------------------------------------------

/** One theme's panel. It is attached to `parent` BEFORE its cells are built: some cells freeze their puppet's
 *  own animations, and Chromium lists the animations of an element only while it is in the document. */
function themePanel(parent: HTMLElement, theme: WearTheme, items: readonly WearId[], size: number, poses: readonly PoseId[] | null, palette: number): HTMLElement {
  const panel = el('section', 'wr-panel');
  setVars(panel, THEME_VARS[theme]);
  panel.dataset['theme'] = theme;
  panel.append(el('h2', undefined, `Тема: ${THEMES.find((t) => t.id === theme)?.label ?? theme} · ${size} px${poses ? ' · ключевые позы' : ''}`));
  parent.append(panel);
  for (const kind of ['bunny', 'hamster'] as const) {
    const mine = items.filter((id) => WEAR[id].kind === kind);
    if (!mine.length) continue;
    const list = POSES[kind].filter((p) => !poses || poses.includes(p.id));
    const grid = el('div', 'wr-grid');
    panel.append(grid);
    grid.style.gridTemplateColumns = `110px repeat(${list.length}, ${size}px)`;
    grid.append(el('div'));
    for (const p of list) grid.append(el('div', 'wr-h', p.label));
    for (const id of mine) {
      const label = el('div', 'wr-rl');
      label.append(el('b', undefined, WHO[kind]), document.createTextNode(WEAR[id].label));
      grid.append(label);
      for (const p of list) {
        const cell = buildCell(kind, id, p.id, size, grid);
        setVars(cell, wearVars(id, theme, palette));
      }
    }
  }
  return panel;
}

// ---- the year strip -----------------------------------------------------------------------------------------

function yearStrip(parent: HTMLElement, items: readonly WearId[], pick: (id: WearId) => void): void {
  const box = el('section', 'wr-year');
  setVars(box, THEME_VARS.light);
  parent.append(box);
  const head = el('div', 'wr-yrow');
  const months = el('div', 'wr-months');
  for (const m of MONTHS) months.append(el('span', undefined, m));
  head.append(el('div'), months);
  box.append(head);
  const today = dayOfYear(TODAY);
  for (const kind of ['bunny', 'hamster'] as const) {
    const row = el('div', `wr-yrow ${kind}`);
    const lab = el('div', 'wr-ylab', WHO[kind]);
    lab.append(el('small', undefined, kind === 'bunny' ? 'кролик' : 'хомяк'));
    const track = el('div', 'wr-track');
    row.append(lab, track);
    box.append(row);
    for (const id of items) {
      const spec = WEAR[id];
      if (spec.kind !== kind) continue;
      for (const s of spec.spans) {
        const from = dayOfYear(s.from);
        const to = dayOfYear(s.to);
        const b = el('button', 'wr-span');
        b.type = 'button';
        b.style.left = `${((from - 1) / 365) * 100}%`;
        b.style.width = `${((to - from + 1) / 365) * 100}%`;
        b.style.background = spec.colors.light[0];
        b.title = `${spec.label} (${spec.de}) · ${spec.season} · момент «${MOMENTS[id].title}», ${fmt(MOMENTS[id].total)} с`;
        const days = to - from + 1;
        // long spans: the full name inside; short ones: the short name; a week: the short name above the bar;
        // a few days (the scarf's last days of December): the colour only, the name is in the tooltip
        if (days < 15) b.classList.add('narrow');
        if (days >= 7) b.append(el('em', undefined, days >= 60 ? spec.label : SHORT[id]));
        b.addEventListener('click', () => pick(id));
        track.append(b);
      }
    }
    const mark = el('i', 'wr-today');
    mark.style.left = `${((today - 0.5) / 365) * 100}%`;
    if (kind === 'hamster') mark.dataset['label'] = `сегодня ${TODAY[0]}.${String(TODAY[1]).padStart(2, '0')}`;
    track.append(mark);
  }
  const occ = el('div', 'wr-yrow');
  const occLab = el('div', 'wr-ylab', 'По поводу');
  occLab.append(el('small', undefined, 'в любой день'));
  const chips = el('div', 'wr-occ');
  for (const id of items) {
    const spec = WEAR[id];
    if (!spec.occasion) continue;
    const b = el('button', undefined, `${WHO[spec.kind]}: ${spec.label}`);
    b.type = 'button';
    b.style.background = spec.colors.light[0];
    b.addEventListener('click', () => pick(id));
    chips.append(b, document.createTextNode(` — ${spec.occasion}; важнее даты (в день рождения в декабре — колпак, не шапка)`));
  }
  occ.append(occLab, chips);
  box.append(occ);
  const now = wornOn('bunny', TODAY);
  const nowH = wornOn('hamster', TODAY);
  box.append(el('p', 'wr-rules', `Одна вещь за раз. Сегодня (${TODAY[0]}.${String(TODAY[1]).padStart(2, '0')}): Помпон — ${now ? WEAR[now].label.toLowerCase() : 'без наряда'}, Тапси — ${nowH ? WEAR[nowH].label.toLowerCase() : 'без наряда'}. Наряд дня (ведьма, Николаус) важнее сезона (шарф). Пустые месяцы — это нормально: наряд — праздник, а не форма. Нажми на полоску — вещь появится на сцене ниже и покажет свой момент.`));
}

// ---- the seven items with their moments, at phone size ------------------------------------------------------------

interface CardPuppet {
  id: WearId;
  puppet: Puppet;
  worn: SVGGElement | null;
}

function itemCards(parent: HTMLElement, items: readonly WearId[], reduced: boolean): { playAll: () => Promise<void> } {
  const grid = el('div', 'wr-cards');
  parent.append(grid);
  const live: CardPuppet[] = [];
  let running: Update | null = null;
  let op = 0;

  const play = async (c: CardPuppet): Promise<void> => {
    running?.cancel();
    const mine = ++op;
    if (!c.worn) return;
    c.worn = putOn(c.puppet.root, c.id);
    if (!c.worn) return;
    const u = new Update(c.puppet.root, c.id, c.worn, reduced);
    running = u;
    await u.play();
    if (mine === op) running = null;
  };

  for (const id of items) {
    const spec = WEAR[id];
    const m = MOMENTS[id];
    const card = el('article', 'wr-card2');
    setVars(card, THEME_VARS.light);
    setVars(card, wearVars(id, 'light'));
    const h = el('h3', undefined, `${WHO[spec.kind]}: ${spec.label} `);
    h.append(el('small', undefined, spec.de));
    card.append(h, el('div', 'when', spec.occasion ? `по поводу: ${spec.occasion}` : spec.season));
    const pair = el('div', 'wr-pair');
    card.append(pair);
    grid.append(card);
    let big: CardPuppet | null = null;
    for (const size of [96, 64]) {
      // room above him for the falling item and the tallest hat
      const head = Math.round(unitPx(spec.kind, size) * HEADROOM) + 6;
      const boxEl = el('div', 'wr-box');
      boxEl.style.width = `${size + 24}px`;
      boxEl.style.height = `${Math.max(Math.round(size * ASPECT[spec.kind]) + 10, head)}px`;
      const host = el('div', 'wr-host');
      host.style.left = '12px';
      host.style.bottom = '5px';
      boxEl.append(host);
      pair.append(boxEl);
      const p = makePuppet(spec.kind, host, size, reduced ? 'force' : 'off');
      freezeAt(p, () => 0);
      const worn = putOn(p.root, id);
      if (size === 96) big = { id, puppet: p, worn };
    }
    const moment = el('div', 'moment');
    moment.append(el('b', undefined, `«${m.title}» · ${fmt(m.total)} с`), document.createTextNode(` — ${m.steps.map((s) => s.replace(/^[\d,–\s·]+/, '')).slice(0, 3).join(' → ')}`));
    card.append(moment);
    const b = el('button', undefined, reduced ? 'Меньше движения: вещь просто на месте' : '▶ момент');
    b.type = 'button';
    card.append(b);
    if (big) {
      const c = big;
      live.push(c);
      b.addEventListener('click', () => void play(c));
    }
  }

  const playAll = async () => {
    for (const c of live) {
      const mine = op + 1;
      await play(c);
      if (op !== mine) return;
      await new Promise((r) => setTimeout(r, 260));
      if (op !== mine) return;
    }
  };
  return { playAll };
}

// ---- the stage: one live puppet, the moments, live poses ----------------------------------------------------

interface StageState {
  id: WearId;
  theme: WearTheme;
  palette: number;
  reduced: boolean;
}

function stageSection(parent: HTMLElement, first: StageState): { show: (id: WearId) => void } {
  const wrap = el('section', 'wr-stage');
  const box = el('div', 'wr-stage-box');
  const ctl = el('div', 'wr-stage-ctl');
  wrap.append(box, ctl);
  parent.append(wrap);

  const state: StageState = { ...first };
  let puppet: Puppet | null = null;
  let worn: SVGGElement | null = null;
  let update: Update | null = null;
  /** Each moment run, slider grab and rebuild is a new operation: older async continuations see it and stop. */
  let op = 0;
  /** The worn item lifting off (gallery replays); a run started meanwhile waits for it too. */
  let exiting: Promise<void> = Promise.resolve();
  /** The slider froze the moment at a frame (a scene button hands the puppet back first). */
  let scrubbed = false;
  const SIZE = 240;

  const itemBar = el('div', 'wr-bar');
  const palBar = el('div', 'wr-bar');
  const themeBar = el('div', 'wr-bar');
  const poseBar = el('div', 'wr-bar');
  const goBar = el('div', 'wr-bar');
  const steps = el('ol', 'wr-steps');
  const scrub = el('label', 'wr-scrub');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.step = '0.01';
  range.value = '0';
  const tLabel = el('span', undefined, 't = —');
  scrub.append(el('span', undefined, 'Кадр момента'), range, tLabel);
  ctl.append(itemBar, palBar, themeBar, poseBar, goBar, steps, scrub);

  const button = (bar: HTMLElement, text: string, on: () => void, pressed?: boolean): HTMLButtonElement => {
    const b = el('button', undefined, text);
    b.type = 'button';
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', on);
    bar.append(b);
    return b;
  };

  const rebuild = () => {
    op++;
    scrubbed = false;
    update?.cancel();
    update = null;
    puppet?.destroy();
    box.replaceChildren();
    setVars(box, THEME_VARS[state.theme]);
    setVars(box, wearVars(state.id, state.theme, state.palette));
    const host = el('div', 'wr-host');
    box.append(host);
    const kind = WEAR[state.id].kind;
    puppet = makePuppet(kind, host, SIZE, state.reduced ? 'force' : 'off', !state.reduced);
    worn = putOn(puppet.root, state.id);
    range.max = String(momentTotal(state.id));
    range.value = '0';
    tLabel.textContent = 't = —';
    renderBars();
  };

  const renderBars = () => {
    itemBar.replaceChildren(el('b', undefined, 'Вещь'));
    for (const id of WEAR_IDS) button(itemBar, `${WHO[WEAR[id].kind]}: ${WEAR[id].label}`, () => { state.id = id; state.palette = 0; rebuild(); }, id === state.id);
    palBar.replaceChildren(el('b', undefined, 'Цвета'));
    WEAR_PALETTES[state.id].forEach((pal, i) => {
      const b = button(palBar, pal.name, () => { state.palette = i; rebuild(); }, i === state.palette);
      b.prepend(swatch(pal.c[0]), swatch(pal.c[1]));
    });
    themeBar.replaceChildren(el('b', undefined, 'Тема'));
    for (const t of THEMES) button(themeBar, t.label, () => { state.theme = t.id; rebuild(); }, t.id === state.theme);
    button(themeBar, state.reduced ? 'Меньше движения: вкл' : 'Меньше движения: выкл', () => { state.reduced = !state.reduced; rebuild(); }, state.reduced);
    poseBar.replaceChildren(el('b', undefined, 'Поза'));
    const kind = WEAR[state.id].kind;
    const hm = () => (puppet ? hmOf(puppet) : null);
    // one thing at a time: no scene while the moment runs (they would animate the same parts)
    const scene = (name: 'jump' | 'greet' | 'eat' | 'walk' | 'alert') => {
      if (!puppet) return;
      if (update && scrubbed) {
        // a frame frozen by the slider: hand the puppet back (its resting state = the moment's end), then play
        op++;
        scrubbed = false;
        update.cancel();
        update = null;
        range.value = '0';
        tLabel.textContent = 't = —';
        if (!state.reduced) puppet.startIdle();
      }
      if (update) return;
      if (puppet instanceof Bunny) void puppet.play(name);
      else if (name !== 'alert') void puppet.play(name);
    };
    button(poseBar, 'Спереди', () => hm()?.classList.remove('turn-l', 'turn-r'));
    button(poseBar, '3/4 влево', () => { hm()?.classList.remove('turn-r'); hm()?.classList.add('turn-l'); });
    button(poseBar, '3/4 вправо', () => { hm()?.classList.remove('turn-l'); hm()?.classList.add('turn-r'); });
    button(poseBar, 'Прыжок', () => scene('jump'));
    button(poseBar, 'Привет', () => scene('greet'));
    button(poseBar, 'Ест', () => scene('eat'));
    button(poseBar, 'Скачет', () => scene('walk'));
    if (kind === 'bunny') button(poseBar, 'Нюх', () => scene('alert'));
    else button(poseBar, 'Бинокль', () => { const h = puppet as Hamster | null; h?.setHolding(h.holding ? null : 'binoculars'); });
    goBar.replaceChildren();
    const m = MOMENTS[state.id];
    const go = button(goBar, `▶ «${m.title}»`, () => void runUpdate());
    go.classList.add('wr-big');
    goBar.append(el('span', undefined, state.reduced ? 'вещь сразу на месте (меньше движения)' : `${fmt(m.total)} с · один раз, когда вещь появляется впервые в сезоне (или в день повода)`));
    steps.replaceChildren(...m.steps.map((s) => el('li', undefined, s)));
  };

  const fresh = (): Update | null => {
    if (!puppet || !worn) return null;
    update?.cancel();
    const id = state.id;
    // the moment starts from the resting puppet: put the item on again (a clean group), then build the timeline
    worn = putOn(puppet.root, id);
    if (!worn) return null;
    update = new Update(puppet.root, id, worn, state.reduced);
    return update;
  };

  const runUpdate = async () => {
    if (!puppet || puppet.busy) return;
    const mine = ++op;
    const p = puppet;
    p.stopIdle();
    scrubbed = false;
    // gallery only (in the app the item is new): the one he wears lifts off and fades while the new one falls —
    // the costume change Felix approved on the welcome screens (snappy 280 ms), so nothing vanishes at once
    const old = !state.reduced && update === null ? worn : null;
    const fall = old ? childOf(old, 'wr-fall') : null;
    if (old && fall && typeof fall.animate === 'function') {
      old.setAttribute('class', 'wr-old');
      const off = fall.animate([{ transform: 'translateY(0px) scale(1)', opacity: 1 }, { transform: 'translateY(-26px) scale(.9)', opacity: 0 }], { duration: 280, easing: EASE.snappy, fill: 'forwards' });
      exiting = off.finished.then(() => old.remove(), () => old.remove());
    }
    // the new one waits (invisible, frame 0) until the old one is gone — also when clicked again meanwhile
    const u = fresh();
    if (!u) return;
    await exiting;
    if (mine !== op || update !== u) return;
    await u.play();
    // a newer run, a slider grab or a rebuild took over: this continuation does nothing
    if (mine !== op || puppet !== p) return;
    update = null;
    if (!state.reduced) p.startIdle();
  };

  range.addEventListener('input', () => {
    const t = Number(range.value);
    // not while one of his own scenes runs (it would keep animating the same parts)
    if (!puppet || puppet.busy) {
      range.value = '0';
      tLabel.textContent = 't = — (дождись конца сцены)';
      return;
    }
    op++; // the slider takes control: a pending play() never overwrites this frame
    scrubbed = true;
    puppet.stopIdle();
    const u = update && update.animations.length ? update : fresh();
    u?.seek(t);
    tLabel.textContent = `t = ${t.toFixed(2)} s`;
  });

  rebuild();
  return {
    show: (id: WearId) => {
      state.id = id;
      state.palette = 0;
      rebuild();
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      void runUpdate();
    },
  };
}

function swatch(color: string): HTMLElement {
  const i = el('i');
  i.style.cssText = `display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:4px;vertical-align:-1px;background:${color};box-shadow:0 0 0 1px rgba(0,0,0,.15)`;
  return i;
}

// ---- frozen frames: &t= and the contact sheet --------------------------------------------------------------

/** One puppet wearing `id`, its moment frozen at t (deterministic). */
export function updateFrame(parent: HTMLElement, id: WearId, t: number, size: number, theme: WearTheme, palette: number, reduced: boolean): Update | null {
  const kind = WEAR[id].kind;
  const cell = el('div', 'wr-cell');
  // room above him for the falling item and the tallest hat
  const h = Math.round(Math.max(size * ASPECT[kind], unitPx(kind, size) * HEADROOM) + size * 0.05);
  cell.style.width = `${size}px`;
  cell.style.height = `${h}px`;
  cell.style.background = 'var(--wr-bg)';
  setVars(cell, THEME_VARS[theme]);
  setVars(cell, wearVars(id, theme, palette));
  const host = el('div', 'wr-host');
  host.style.left = '0px';
  host.style.bottom = `${Math.round(size * 0.05)}px`;
  cell.append(host);
  parent.append(cell);
  const p = makePuppet(kind, host, size, reduced ? 'force' : 'off');
  // its CSS breathing (infinite) frozen at rest too, or a frame would depend on when it is taken (Codex 26.10);
  // the cell is already in the document (Chromium lists only attached elements' animations)
  freezeAt(p, () => 0);
  const worn = putOn(p.root, id);
  if (!worn) return null;
  const u = new Update(p.root, id, worn, reduced);
  u.seek(t);
  return u;
}

function contactSheet(app: HTMLElement, q: URLSearchParams, items: readonly WearId[], theme: WearTheme, palette: number, reduced: boolean): void {
  const frames = Math.max(2, Math.min(24, Math.round(Number(q.get('frames') ?? 10)) || 10));
  const size = Number(q.get('size')) || 148;
  const panel = el('section', 'wr-panel');
  setVars(panel, THEME_VARS[theme]);
  panel.append(el('h2', undefined, `Моменты по кадрам · ${frames} кадров на вещь · ${size} px${reduced ? ' · меньше движения' : ''}`));
  app.append(panel);
  for (const id of items) {
    const total = momentTotal(id);
    // &t0= &t1= : only this window of the moment (a close look at the contact)
    const t0 = Math.max(0, Math.min(total, Number(q.get('t0') ?? 0) || 0));
    const t1 = Math.max(t0, Math.min(total, Number(q.get('t1') ?? total) || total));
    panel.append(el('h2', undefined, `${WHO[WEAR[id].kind]}: ${WEAR[id].label} — «${MOMENTS[id].title}» (${fmt(total)} с)`));
    const sheet = el('div', 'wr-sheet');
    sheet.style.gridTemplateColumns = `repeat(${frames}, ${size}px)`;
    sheet.dataset['item'] = id;
    panel.append(sheet);
    for (let i = 0; i < frames; i++) {
      const t = t0 + ((t1 - t0) * i) / (frames - 1);
      const box = el('div');
      sheet.append(box);
      updateFrame(box, id, t, size, theme, palette, reduced);
      box.append(el('small', undefined, `t = ${t.toFixed(2)} s`));
    }
  }
}

// ---- the page -----------------------------------------------------------------------------------------------

function pick<T extends string>(v: string | null, all: readonly T[]): T[] {
  return v && (all as readonly string[]).includes(v) ? [v as T] : [...all];
}

function linkBar(label: string, entries: readonly [string, string][], key: string, q: URLSearchParams): HTMLElement {
  const bar = el('div', 'wr-bar');
  bar.append(el('b', undefined, label));
  const current = q.get(key) ?? '';
  for (const [value, text] of entries) {
    const next = new URLSearchParams(q);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'item') next.delete('palette');
    const a = el('a', undefined, text);
    a.href = `?${next.toString()}`;
    a.setAttribute('aria-current', String(current === value));
    bar.append(a);
  }
  return bar;
}

function markReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset['ready'] = '1')));
}

export function wardrobeGallery(app: HTMLElement, q: URLSearchParams): void {
  if (!document.getElementById('wr-page-css')) {
    const style = el('style');
    style.id = 'wr-page-css';
    style.textContent = PAGE_CSS;
    document.head.append(style);
  }
  app.className = 'app wr-page';
  const items = pick<WearId>(q.get('item'), WEAR_IDS);
  const themes = pick<WearTheme>(q.get('theme'), THEMES.map((t) => t.id));
  const sizeQ = Number(q.get('size'));
  const size = (SIZES as readonly number[]).includes(sizeQ) ? sizeQ : 96;
  const palette = Math.max(0, Math.min(3, Math.round(Number(q.get('palette') ?? 0)) || 0));
  const reduced = q.get('reduced') === '1';
  const allPoses = q.get('poses') === 'all';
  if (q.get('carryT')) carryT = Number(q.get('carryT')) || CARRY_T;
  const theme0 = themes[0] ?? 'light';
  const item0 = items[0] ?? 'scarf';

  // one frozen frame (screenshots)
  const tq = q.get('t');
  if (tq !== null && Number.isFinite(Number(tq))) {
    document.body.style.background = THEME_VARS[theme0]['--wr-bg'] ?? '';
    const frameSize = Number(q.get('size')) || 300;
    updateFrame(app, item0, Number(tq), frameSize, theme0, palette, reduced);
    app.append(el('p', 'wr-note', `${WEAR[item0].label} · «${MOMENTS[item0].title}» t = ${Number(tq).toFixed(2)} s из ${momentTotal(item0).toFixed(2)} s${reduced ? ' · меньше движения' : ''}`));
    markReady();
    return;
  }

  app.append(el('h1', undefined, 'Гардероб v2 · год нарядов'));
  app.append(el('p', 'sub', 'Прототип только для галереи (26.10). Ты сказал: «шарф нравится; летучая мышь странная и непонятная; ленточка со звёздочкой неплохо, но не в тему; шапочка Тапси ок, но не идеально — больше креатива и масштаба». Поэтому: шарф остался, мышь и ленточка ушли в архив, теперь 7 вещей на весь год (Германия) — у Помпона и у Тапси, и у КАЖДОЙ вещи свой короткий момент с характером (до 1,6 с) вместо одного общего падения.'));
  const nav = new URLSearchParams(q);
  app.append(linkBar('Вещь', [['', 'Все'], ...WEAR_IDS.map((id): [string, string] => [id, WEAR[id].label])], 'item', nav));
  app.append(linkBar('Тема', [['', 'Все'], ...THEMES.map((t): [string, string] => [t.id, t.label])], 'theme', nav));
  app.append(linkBar('Размер', [['', '96 px'], ['148', '148 px'], ['64', '64 px']], 'size', nav));
  app.append(linkBar('Режим', [['', 'Страница'], ['1', 'Моменты по кадрам']], 'contact', nav));
  app.append(linkBar('Движение', [['', 'Полное'], ['1', 'Меньше движения']], 'reduced', nav));

  if (q.get('contact') === '1') {
    contactSheet(app, q, items, theme0, palette, reduced);
    markReady();
    return;
  }

  app.append(el('h2', 'wr-h2', 'Год нарядов'));
  let stage: { show: (id: WearId) => void } | null = null;
  yearStrip(app, items, (id) => stage?.show(id));

  app.append(el('h2', 'wr-h2', `${items.length === 1 ? 'Вещь' : `${items.length} вещей`} и их моменты — на размере телефона (96 px и 64 px)`));
  const all = el('div', 'wr-bar');
  app.append(all);
  const cards = itemCards(app, items, reduced);
  const allBtn = el('button', undefined, reduced ? 'Меньше движения: моментов нет' : '▶ все моменты по очереди');
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => void cards.playAll());
  all.append(allBtn, el('span', undefined, 'один маскот двигается за раз; моменты детерминированы — кадры по ссылке «Моменты по кадрам»'));

  app.append(el('h2', 'wr-h2', 'Сцена (крупно): вещь едет вместе с ним во всех движениях'));
  stage = stageSection(app, { id: item0, theme: theme0, palette, reduced });
  if (q.get('grid') === '0') {
    markReady();
    return;
  }
  app.append(el('h2', 'wr-h2', 'Позы'));
  app.append(el('p', 'wr-note', 'Все клетки неподвижны (один маскот двигается за раз). «Перенос» — настоящая сцена CarryStage, «Из-за края» у Помпона — настоящий peek-once приветствия, «Дружок в руке» — поза дружка из «Listen», когда его держат за шкирку. Светлая тема — все 8 поз, тёмная и Blau — 4 ключевые (все: &poses=all).'));
  // build the panels one after another, so the page answers while the puppets mount
  const queue = themes.slice();
  const next = () => {
    const theme = queue.shift();
    if (!theme) {
      markReady();
      return;
    }
    themePanel(app, theme, items, size, allPoses || theme === 'light' ? null : KEY_POSES, palette);
    setTimeout(next, 0);
  };
  next();
}
