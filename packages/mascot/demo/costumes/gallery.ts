/**
 * Gallery page «Костюмы по фото · новые кролики · эксперименты с Помпоном» (31.10) — GALLERY-ONLY prototype on the
 * mascot gallery (5180). Nothing here reaches the app until Felix approves (his rule: new looks live in the gallery).
 *
 *   ?screens=costumes                       tab «Kostüme» (default): cards (148 / 96 / 64 px + a motion button) and the
 *                                           pose grid (front, 3/4 left / right, top of the hop, sniff, peek, carry)
 *     &tab=costumes|bunnies|experiments|hats   the tabs (Kostüme · Neue Hasen · Pompon-Experimente · Mützen (neu))
 *     &theme=light|dark|navy|ocean|black|all   the grid's theme (default light; all = five panels, key poses in the dark ones)
 *     &size=64|96|148                       the grid's size (default 96)
 *     &only=sport,lily                      only these items (costume / bunny / experiment ids of the tab)
 *     &reduced=1                            reduced motion: everything still, the motion buttons do nothing
 *     &view=grid                            only the pose grid (screenshots)
 *     &view=sheet                           contact sheet: every item of the tab, big, in light + dark (screenshots)
 *     &view=motion [&frames=8]              the binky (the approved jump, 0.96 s) frame by frame with the item on —
 *                                           proves it stays put; every frame frozen (deterministic)
 *
 * Every grid cell is the REAL puppet in that pose: the mascot (Bunny / Hamster), the welcome stage's peek-once, the
 * carry stage — dressed from outside by rig.ts (packages/mascot/src untouched).
 */

import { Bunny, CarryStage, Hamster, WelcomeStage } from '../../src/index';
import { ARCHIVED_COSTUMES, COSTUMES, COSTUME_IDS, lookOf, PHOTOS, type CostumeId, type WearerId } from './costumes';
import { ARCHIVED_BUNNIES, EXPERIMENTS, EXPERIMENT_IDS, experimentLook, MODELS, NEW_BUNNIES, type ExperimentId, type ModelInfo } from './fur';
import { outfitAll, type Kind, type Look } from './rig';
// the laptop (31.10 v3, laptop.ts): rig's outfit + its twin-paw wiring; its own page (&view=laptop) and compositions
import { laptopCardButton, laptopView, outfit, setLaptopVariant } from './laptop';
import { NEW_HAT_VARIANTS, NEW_HATS, RECOMMENDED } from './hats';
import { strawberrySection, strawberrySheet } from './strawberry';
import type { HatId, NewHatVariant } from '../sammlung/hats';

type Tab = 'costumes' | 'bunnies' | 'experiments' | 'hats';
type Theme = 'light' | 'dark' | 'navy' | 'ocean' | 'black';
type PoseId = 'front' | 'left' | 'right' | 'jump' | 'sniff' | 'peek' | 'carry';
type Puppet = Bunny | Hamster;

export const THEMES: ReadonlyArray<[Theme, string]> = [['light', 'Светлая'], ['dark', 'Тёмная'], ['navy', 'Blau'], ['ocean', 'Ozean'], ['black', 'Schwarz']];
export const POSES: ReadonlyArray<[PoseId, string]> = [['front', 'Спереди'], ['left', '3/4 влево'], ['right', '3/4 вправо'], ['jump', 'Верх прыжка'], ['sniff', 'Нюх (ухо −38°)'], ['peek', 'Из-за края'], ['carry', 'Перенос']];
const KEY_POSES: readonly PoseId[] = ['front', 'right', 'jump'];

/** The app's page colours and mascot tokens per theme (tokens.css, navy.css, ocean.css, black.css). */
export const THEME_VARS: Record<Theme, Record<string, string>> = {
  light: { '--cs-bg': '#F2EBDD', '--cs-card': '#FFFDF8', '--cs-text': '#2A231C', '--cs-text2': '#62554A', '--cs-line': 'rgba(116,84,44,.15)', '--mascot-shadow': 'rgba(70,40,15,.20)', '--mascot-outline': 'rgba(224,171,116,.5)' },
  dark: { '--cs-bg': '#17120F', '--cs-card': '#2A221D', '--cs-text': '#F5EDE3', '--cs-text2': '#C3B5A6', '--cs-line': 'rgba(255,230,205,.13)', '--mascot-shadow': 'rgba(0,0,0,.42)', '--mascot-outline': 'rgba(255,214,170,.2)' },
  navy: { '--cs-bg': '#0F1526', '--cs-card': '#1D263B', '--cs-text': '#EEF2FA', '--cs-text2': '#AEB9CF', '--cs-line': 'rgba(200,220,255,.13)', '--mascot-shadow': 'rgba(0,0,0,.42)', '--mascot-outline': 'rgba(220,232,255,.18)' },
  ocean: { '--cs-bg': '#111418', '--cs-card': '#1C2026', '--cs-text': '#EDF1F6', '--cs-text2': '#AAB4C2', '--cs-line': 'rgba(210,225,245,.12)', '--mascot-shadow': 'rgba(0,0,0,.42)', '--mascot-outline': 'rgba(220,232,250,.18)' },
  black: { '--cs-bg': '#000000', '--cs-card': '#161618', '--cs-text': '#F2F2F4', '--cs-text2': '#B0B0B8', '--cs-line': 'rgba(255,255,255,.12)', '--mascot-shadow': 'rgba(0,0,0,.6)', '--mascot-outline': 'rgba(255,240,225,.2)' },
};

const PAGE_CSS = `
.app.cs-page { max-width: none; padding: 20px 16px 48px; }
.cs-page h1 { margin: 4px 6px; }
.cs-page .sub { max-width: 980px; }
.cs-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 6px; font-size: 13px; color: var(--text-2); }
.cs-bar b { font-weight: 600; margin-right: 4px; min-width: 64px; }
.cs-bar a, .cs-bar button { appearance: none; border: 0; border-radius: 999px; padding: 6px 11px; font: 600 13px/1 inherit; font-family: inherit;
  background: var(--tile); color: var(--text); text-decoration: none; cursor: pointer; }
.cs-bar a[aria-current="true"] { background: color-mix(in srgb, var(--accent-ui) 22%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent-ui); }
.cs-tabs a { font-size: 15px; padding: 9px 16px; }
.cs-h2 { margin: 18px 6px 8px; font-size: 19px; }
.cs-note { font-size: 12.5px; color: var(--text-2); margin: 6px; max-width: 980px; line-height: 1.45; }
.cs-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; max-width: 1400px; margin: 8px 0 6px; }
.cs-card { background: var(--cs-bg); color: var(--cs-text); border-radius: 20px; padding: 10px 12px 12px; box-shadow: 0 0 0 1px var(--cs-line); display: flex; flex-direction: column; gap: 6px; }
.cs-card h3 { margin: 0; font-size: 17px; }
.cs-card h3 small { font-weight: 400; color: var(--cs-text2); font-size: 12.5px; }
.cs-card .ph { font-size: 12px; color: var(--cs-text2); }
.cs-card .what { font-size: 12.5px; line-height: 1.4; }
.cs-row { display: flex; align-items: flex-end; gap: 6px; flex-wrap: wrap; }
.cs-box { position: relative; flex: none; overflow: hidden; border-radius: 12px; background: var(--cs-card); box-shadow: inset 0 0 0 1px var(--cs-line); }
.cs-box > .cs-host, .cs-cell > .cs-host, .cs-clip > .cs-host { position: absolute; }
.cs-box small { position: absolute; left: 6px; top: 4px; font-size: 10.5px; color: var(--cs-text2); line-height: 1.2; }
.cs-card button { align-self: flex-start; appearance: none; border: 0; border-radius: 999px; padding: 8px 13px; font: 700 13px/1 inherit; font-family: inherit;
  background: color-mix(in srgb, var(--accent-ui) 22%, transparent); color: var(--cs-text); box-shadow: inset 0 0 0 1.5px var(--accent-ui); cursor: pointer; min-height: 36px; }
.cs-card button[disabled] { opacity: .55; cursor: default; }
.cs-panel { background: var(--cs-bg); color: var(--cs-text); border-radius: 26px; padding: 14px 14px 18px; margin: 0 0 18px; overflow-x: auto; box-shadow: 0 0 0 1px var(--cs-line); }
.cs-panel h2 { margin: 2px 6px 10px; font-size: 18px; }
.cs-grid { display: grid; gap: 6px 10px; align-items: end; }
.cs-grid .cs-h { font-size: 11px; font-weight: 600; color: var(--cs-text2); text-align: center; padding: 10px 0 2px; }
.cs-grid .cs-rl { font-size: 11px; color: var(--cs-text2); text-align: right; padding-right: 4px; align-self: center; line-height: 1.3; }
.cs-grid .cs-rl b { display: block; color: var(--cs-text); font-size: 12.5px; }
.cs-cell { position: relative; justify-self: center; overflow: hidden; border-radius: 10px; background: var(--cs-card); box-shadow: 0 0 0 1px var(--cs-line); }
.cs-cell.na { display: grid; place-items: center; font-size: 11px; color: var(--cs-text2); text-align: center; padding: 6px; box-sizing: border-box; }
.cs-ledge { position: absolute; left: 0; right: 0; bottom: 0; background: var(--cs-bg); border-radius: 10px 10px 0 0; box-shadow: 0 -1px 0 var(--cs-line); }
.cs-clip { position: absolute; left: 0; right: 0; top: 0; overflow: hidden; }
.cs-sheet { display: grid; gap: 8px 10px; }
.cs-sheet figure { margin: 0; text-align: center; }
.cs-sheet figcaption { font-size: 12px; color: var(--cs-text2); margin-top: 3px; line-height: 1.3; }
.cs-sheet figcaption b { color: var(--cs-text); display: block; font-size: 13px; }
.cs-family { display: flex; align-items: flex-start; gap: 4px; flex-wrap: wrap; padding: 10px 6px 0; }
.cs-family figure { margin: 0; text-align: center; }
.cs-family figcaption { font-size: 12px; color: var(--cs-text2); margin-top: 4px; line-height: 1.3; max-width: 190px; }
.cs-family figcaption b { display: block; color: var(--cs-text); font-size: 14px; }
.cs-roles { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin: 10px 0; max-width: 1200px; }
.cs-roles div { background: var(--cs-bg); color: var(--cs-text); border-radius: 16px; padding: 10px 12px; box-shadow: 0 0 0 1px var(--cs-line); font-size: 12.5px; line-height: 1.45; }
.cs-roles b { font-size: 15px; }
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

/** Puppet aspect (height / width of the host). */
const ASPECT: Record<Kind, number> = { bunny: 260 / 400, hamster: 250 / 400 };

function makePuppet(m: ModelInfo, host: HTMLElement, size: number, reduced: 'force' | 'off'): Puppet {
  const base = { size, idle: false, interactive: false, reducedMotion: reduced } as const;
  return m.kind === 'bunny'
    ? new Bunny(host, { ...base, coat: m.coat as 'fawn', ears: m.ears ?? 'lop' })
    : new Hamster(host, { ...base, coat: m.coat as 'golden' });
}

/** Freezes every animation of a puppet: the ones of this run at `ms`, his CSS loops (breathing) at 0. */
function freeze(p: Puppet, ms: number): void {
  const svg = p.root.querySelector('svg');
  for (const a of svg?.getAnimations?.({ subtree: true }) ?? []) {
    a.pause();
    const loops = a.effect?.getTiming().iterations === Infinity;
    a.currentTime = loops ? 0 : ms;
  }
}

/** The approved binky (bunny: 40 units, 0.96 s; hamster: 36, 0.9 s) — the scene the motion buttons play. */
const JUMP: Record<Kind, { h: number; d: number }> = { bunny: { h: 40, d: 960 }, hamster: { h: 36, d: 900 } };
function startJump(p: Puppet, kind: Kind): void {
  p.setEyes('star');
  const j = JUMP[kind];
  (p as unknown as { jumpMotion(h: number, ms: number, binky?: boolean): Promise<void> }).jumpMotion(j.h, j.d, kind === 'bunny').catch(() => undefined);
}

function markReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset['ready'] = '1')));
}

// ---- what a row is: one model + one look ---------------------------------------------------------------------

interface Item {
  key: string;
  ru: string;
  de: string;
  sub: string;
  what: string;
  model: ModelInfo;
  look: Look | null;
  /** a second figure in the card (the wedding pair, Tapsi's version) */
  also?: ReadonlyArray<{ model: ModelInfo; look: Look | null; label: string; turn?: 'l' | 'r' }>;
  turn?: 'l' | 'r';
}

function costumeItems(only: readonly string[] | null, archived = false): Item[] {
  // 31.10 (2nd review): the headphones are archived — shown only with &archived=1
  return COSTUME_IDS.filter((id) => (!only || only.includes(id)) && (archived || !ARCHIVED_COSTUMES.includes(id))).map((id) => {
    const c = COSTUMES[id];
    const main = MODELS[c.who[0] as WearerId];
    const also: Array<{ model: ModelInfo; look: Look | null; label: string; turn?: 'l' | 'r' }> = c.who.slice(1).map((w) => ({ model: MODELS[w], look: lookOf(c, MODELS[w].kind), label: MODELS[w].ru }));
    if (id === 'groom') also.unshift({ model: MODELS.mila, look: lookOf(COSTUMES.bride, 'bunny'), label: 'с Милой', turn: 'l' });
    if (id === 'bride') also.unshift({ model: MODELS.pompon, look: lookOf(COSTUMES.groom, 'bunny'), label: 'с Помпоном', turn: 'r' });
    return {
      key: id,
      ru: c.ru,
      de: c.de,
      sub: `фото ${c.photos.join(' + ')} · ${c.photos.map((n) => PHOTOS.find((x) => x.n === n)?.what ?? '').join('; ')}`,
      what: c.note,
      model: main,
      look: lookOf(c, main.kind),
      also,
      turn: id === 'groom' ? 'r' : id === 'bride' ? 'l' : c.turn,
    };
  });
}

function bunnyItems(only: readonly string[] | null, archived = false): Item[] {
  return [...NEW_BUNNIES, ...(archived ? ARCHIVED_BUNNIES : [])].filter((id) => !only || only.includes(id)).map((id) => {
    const m = MODELS[id];
    const dress: Partial<Record<WearerId, CostumeId>> = { leo: 'samurai', knopf: 'reading', hasel: 'strawberry' };
    const cid = dress[id];
    return {
      key: id,
      ru: m.ru,
      de: m.de,
      sub: `${m.breed ?? ''} · по фото ${(m.photos ?? []).join(', ')}`,
      what: m.role ?? '',
      model: m,
      look: null,
      also: [{ model: MODELS.pompon, look: null, label: 'рядом Помпон' }, ...(cid ? [{ model: m, look: lookOf(COSTUMES[cid], 'bunny'), label: `в костюме: ${COSTUMES[cid].ru.toLowerCase()}` }] : [])],
    };
  });
}

function experimentItems(only: readonly string[] | null): Item[] {
  const today: Item = { key: 'today', ru: 'Помпон сегодня', de: 'Pompon heute', sub: 'как в приложении сейчас — для сравнения', what: 'Без изменений.', model: MODELS.pompon, look: null };
  return [today, ...EXPERIMENT_IDS.filter((id) => !only || only.includes(id)).map((id): Item => {
    const e = EXPERIMENTS[id as ExperimentId];
    return { key: id, ru: e.ru, de: e.de, sub: 'эксперимент — в приложении ничего не меняется', what: e.what, model: MODELS.pompon, look: experimentLook(id as ExperimentId), also: [{ model: MODELS.pompon, look: null, label: 'сегодня' }] };
  })];
}

// ---- one frozen cell per pose -----------------------------------------------------------------------------------

function cellBox(size: number): { w: number; h: number; floor: number } {
  return { w: size, h: Math.round(size * 1.12), floor: Math.round(size * 0.05) };
}

/** One frozen cell (attached to `parent` before its puppet is built: animations are listed only for attached elements). */
export function poseCell(parent: HTMLElement, item: Item, pose: PoseId, size: number): HTMLElement {
  const box = cellBox(size);
  const cell = el('div', 'cs-cell');
  cell.style.width = `${box.w}px`;
  cell.style.height = `${box.h}px`;
  cell.dataset['pose'] = pose;
  cell.dataset['item'] = item.key;
  parent.append(cell);
  const host = el('div', 'cs-host');
  host.style.left = '0px';
  host.style.bottom = `${box.floor}px`;
  const m = item.model;

  const simple = (setup: (p: Puppet) => void, reduced: 'force' | 'off' = 'force'): HTMLElement => {
    cell.append(host);
    const p = makePuppet(m, host, size, reduced);
    outfit(p.root, m, item.look);
    setup(p);
    return cell;
  };
  const hm = (p: Puppet) => p.root.querySelector('.hm');

  switch (pose) {
    case 'front':
      return simple(() => undefined);
    case 'left':
    case 'right':
      return simple((p) => hm(p)?.classList.add(pose === 'left' ? 'turn-l' : 'turn-r'));
    case 'jump':
      return simple((p) => {
        startJump(p, m.kind);
        freeze(p, JUMP[m.kind].d * 0.5);
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
      return m.kind === 'bunny' ? bunnyPeek(cell, item, size) : hamsterPeek(cell, host, item, size);
    case 'carry':
      if (m.kind === 'hamster') {
        cell.classList.add('na');
        cell.textContent = 'у Тапси нет переноса';
        return cell;
      }
      return carryCell(cell, item, size);
  }
}

/** The welcome stage's peek-once (the empty screens), frozen at its end: the real peeking actor wears the look. */
function bunnyPeek(cell: HTMLElement, item: Item, size: number): HTMLElement {
  const box = cellBox(size);
  const ledge = el('div', 'cs-ledge');
  const ledgeH = Math.round(size * 0.2);
  ledge.style.height = `${ledgeH}px`;
  const inset = Math.round(size * 0.08);
  const stageHost = el('div');
  const bottom = box.h - ledgeH + inset;
  const hostH = Math.max(140, bottom);
  stageHost.style.cssText = `position:absolute;left:0;top:${bottom - hostH}px;width:${box.w}px;height:${hostH}px`;
  cell.append(ledge, stageHost);
  const unit = size * 0.486;
  const stage = new WelcomeStage(stageHost, { bunnies: ['fawn'], choreography: 'peek-once', reducedMotion: 'off', minSize: unit, maxSize: unit, edgeInset: { bottom: inset }, edgeRadius: { bottom: 10 } });
  stage.seek(stage.duration);
  outfitAll(stageHost, item.model, item.look);
  return cell;
}

/** Tapsi peeking in over a card edge (the HamsterEdgeStage composition: feet behind the edge). */
function hamsterPeek(cell: HTMLElement, host: HTMLElement, item: Item, size: number): HTMLElement {
  const box = cellBox(size);
  const ledgeH = Math.round(size * 0.2);
  const ledge = el('div', 'cs-ledge');
  ledge.style.height = `${ledgeH}px`;
  const clip = el('div', 'cs-clip');
  clip.style.height = `${box.h - ledgeH}px`;
  const tall = size * ASPECT.hamster;
  host.style.bottom = '';
  host.style.top = `${Math.round(box.h - ledgeH - tall * 0.78)}px`;
  clip.append(host);
  cell.append(clip, ledge);
  const p = makePuppet(item.model, host, size, 'force');
  outfit(p.root, item.model, item.look);
  p.setPuff(1.22);
  p.setEyes('happy');
  return cell;
}

/** The carry stage (the bunny takes a new card to its place), frozen mid-hop on the way. */
function carryCell(cell: HTMLElement, item: Item, size: number): HTMLElement {
  const box = cellBox(size);
  const stageHost = el('div');
  stageHost.style.cssText = `position:absolute;left:0;top:0;width:${box.w}px;height:${box.h}px`;
  cell.append(stageHost);
  const tall = size * 0.51;
  const line = box.h + tall * 0.08;
  const bw = tall * 0.4;
  const bh = tall * 0.3;
  const carry = new CarryStage(stageHost, {
    from: { left: -box.w * 0.3 - bw / 2, top: line - tall * 0.25 - bh / 2, width: bw, height: bh },
    to: { left: box.w * 1.3 - bw / 2, top: line - 4, width: bw, height: bh },
    item: 'card', tint: '#F7B27A', coat: 'fawn', size: tall, reducedMotion: 'off',
  });
  carry.seek(1.1);
  outfitAll(stageHost, item.model, item.look);
  return cell;
}

// ---- cards: big / phone sizes + the motion button -------------------------------------------------------------------

interface Live {
  puppet: Puppet;
  kind: Kind;
}
/** One mascot moves at a time on this page. */
let playing: Live | null = null;

function figure(parent: HTMLElement, m: ModelInfo, look: Look | null, size: number, reduced: boolean, label?: string, turn?: 'l' | 'r', scale = 1): Puppet {
  const s = Math.round(size * scale);
  const h = Math.round(size * 0.98);
  const boxEl = el('div', 'cs-box');
  boxEl.style.width = `${s + 16}px`;
  boxEl.style.height = `${h}px`;
  const host = el('div', 'cs-host');
  host.style.left = '8px';
  host.style.bottom = `${Math.round(size * 0.04)}px`;
  boxEl.append(host);
  if (label) boxEl.append(el('small', undefined, label));
  parent.append(boxEl);
  const p = makePuppet(m, host, s, reduced ? 'force' : 'off');
  outfit(p.root, m, look);
  if (turn) p.root.querySelector('.hm')?.classList.add(turn === 'l' ? 'turn-l' : 'turn-r');
  freeze(p, 0);
  return p;
}

function cards(parent: HTMLElement, items: readonly Item[], theme: Theme, reduced: boolean): void {
  const grid = el('div', 'cs-cards');
  parent.append(grid);
  for (const it of items) {
    const card = el('article', 'cs-card');
    card.dataset['item'] = it.key;
    setVars(card, THEME_VARS[theme]);
    const h = el('h3', undefined, `${it.ru} `);
    h.append(el('small', undefined, it.de));
    card.append(h, el('div', 'ph', it.sub));
    const row = el('div', 'cs-row');
    card.append(row);
    grid.append(card);
    const big = figure(row, it.model, it.look, 148, reduced, undefined, it.turn);
    for (const a of it.also ?? []) figure(row, a.model, a.look, 148, reduced, a.label, a.turn, a.model.scale ?? 1);
    figure(row, it.model, it.look, 96, reduced, '96 px', it.turn);
    figure(row, it.model, it.look, 64, reduced, '64', it.turn);
    card.append(el('div', 'what', it.what));
    const b = el('button', undefined, reduced ? 'Меньше движения: стоит на месте' : '▶ надеть и прыгнуть (бинки, 0,96 с)');
    b.type = 'button';
    if (reduced) b.disabled = true;
    b.addEventListener('click', () => {
      if (playing?.puppet.busy || big.busy) return;
      playing = { puppet: big, kind: it.model.kind };
      for (const a of big.root.querySelector('svg')?.getAnimations?.({ subtree: true }) ?? []) if (a.playState === 'paused') a.play();
      void big.play('jump').then(() => {
        if (playing?.puppet === big) playing = null;
      });
    });
    card.append(b);
  }
}

// ---- the pose grid ---------------------------------------------------------------------------------------------

function gridPanel(parent: HTMLElement, items: readonly Item[], theme: Theme, size: number, poses: readonly PoseId[]): void {
  const panel = el('section', 'cs-panel');
  setVars(panel, THEME_VARS[theme]);
  panel.dataset['theme'] = theme;
  panel.append(el('h2', undefined, `Тема: ${THEMES.find((t) => t[0] === theme)?.[1] ?? theme} · ${size} px`));
  parent.append(panel);
  const list = POSES.filter(([id]) => poses.includes(id));
  const grid = el('div', 'cs-grid');
  grid.style.gridTemplateColumns = `118px repeat(${list.length}, ${size}px)`;
  panel.append(grid);
  grid.append(el('div'));
  for (const [, label] of list) grid.append(el('div', 'cs-h', label));
  for (const it of items) {
    const lab = el('div', 'cs-rl');
    lab.append(el('b', undefined, it.ru), document.createTextNode(`${it.model.ru} · ${it.de}`));
    grid.append(lab);
    for (const [pose] of list) poseCell(grid, it, pose, size);
  }
}

// ---- contact sheets: everything big, and the binky frame by frame -------------------------------------------------

function sheet(parent: HTMLElement, items: readonly Item[], themes: readonly Theme[], size: number): void {
  for (const theme of themes) {
    const panel = el('section', 'cs-panel');
    setVars(panel, THEME_VARS[theme]);
    panel.dataset['theme'] = theme;
    panel.append(el('h2', undefined, `${THEMES.find((t) => t[0] === theme)?.[1]} тема · ${size} px · спереди и 3/4`));
    parent.append(panel);
    const grid = el('div', 'cs-sheet');
    grid.style.gridTemplateColumns = `repeat(auto-fill, ${size * 2 + 14}px)`;
    panel.append(grid);
    for (const it of items) {
      const fig = el('figure');
      fig.dataset['item'] = it.key;
      grid.append(fig);
      const row = el('div', 'cs-row');
      row.style.justifyContent = 'center';
      fig.append(row);
      poseCell(row, it, 'front', size);
      poseCell(row, it, it.turn === 'l' ? 'left' : 'right', size);
      const cap = el('figcaption');
      cap.append(el('b', undefined, it.ru), document.createTextNode(`${it.de} · ${it.model.ru}`));
      fig.append(cap);
    }
  }
}

export const MOTION_FRAMES = [0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84, 0.96, 1.2];

function motionSheet(parent: HTMLElement, items: readonly Item[], theme: Theme, size: number, frames: number): void {
  const panel = el('section', 'cs-panel');
  setVars(panel, THEME_VARS[theme]);
  panel.append(el('h2', undefined, `В движении: одобренный прыжок-бинки (0,96 с), кадры заморожены · ${size} px — вещь едет вместе с ним`));
  parent.append(panel);
  const ts = MOTION_FRAMES.slice(0, Math.max(2, Math.min(MOTION_FRAMES.length, frames)));
  const grid = el('div', 'cs-grid');
  grid.style.gridTemplateColumns = `118px repeat(${ts.length}, ${size}px)`;
  panel.append(grid);
  grid.append(el('div'));
  for (const t of ts) grid.append(el('div', 'cs-h', `t = ${t.toFixed(2)} с`));
  for (const it of items) {
    const lab = el('div', 'cs-rl');
    lab.append(el('b', undefined, it.ru), document.createTextNode(it.model.ru));
    grid.append(lab);
    for (const t of ts) {
      const box = cellBox(size);
      const cell = el('div', 'cs-cell');
      cell.style.width = `${box.w}px`;
      cell.style.height = `${box.h}px`;
      cell.dataset['t'] = String(t);
      grid.append(cell);
      const host = el('div', 'cs-host');
      host.style.left = '0px';
      host.style.bottom = `${box.floor}px`;
      cell.append(host);
      const p = makePuppet(it.model, host, size, 'off');
      outfit(p.root, it.model, it.look);
      startJump(p, it.model.kind);
      freeze(p, t * 1000);
    }
  }
}

// ---- the new bunnies: the family line-up -----------------------------------------------------------------------------

function family(parent: HTMLElement, theme: Theme, reduced: boolean, archived = false): void {
  const panel = el('section', 'cs-panel');
  setVars(panel, THEME_VARS[theme]);
  panel.append(el('h2', undefined, 'Одна семья: та же кукла, другие окрасы, уши и шёрстка (в реальном масштабе друг к другу)'));
  parent.append(panel);
  const row = el('div', 'cs-family');
  panel.append(row);
  for (const id of ['pompon', 'leo', 'mila', ...(archived ? ARCHIVED_BUNNIES : [])] as const) {
    const m = MODELS[id];
    const fig = el('figure');
    row.append(fig);
    const r = el('div', 'cs-row');
    fig.append(r);
    figure(r, m, null, 150, reduced, undefined, undefined, m.scale ?? 1);
    const cap = el('figcaption');
    cap.append(el('b', undefined, `${m.de} · ${m.ru}`), document.createTextNode(m.breed ?? (id === 'pompon' ? 'главный, вислоухий кремовый' : 'из комикса: броукен, висячие ушки, цветочек на ушке')));
    fig.append(cap);
  }
  const roles = el('div', 'cs-roles');
  parent.append(roles);
  for (const id of [...NEW_BUNNIES, ...(archived ? ARCHIVED_BUNNIES : [])]) {
    const m = MODELS[id];
    const d = el('div');
    setVars(d, THEME_VARS[theme]);
    d.append(el('b', undefined, `${m.de} · ${m.ru}`), el('br'), document.createTextNode(`${m.breed ?? ''}. ${m.role ?? ''}`));
    roles.append(d);
  }
}

// ---- the page --------------------------------------------------------------------------------------------------

function linkBar(label: string, entries: ReadonlyArray<readonly [string, string]>, key: string, q: URLSearchParams, cls = ''): HTMLElement {
  const bar = el('div', `cs-bar ${cls}`.trim());
  bar.append(el('b', undefined, label));
  const current = q.get(key) ?? '';
  for (const [value, text] of entries) {
    const next = new URLSearchParams(q);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'tab') next.delete('only');
    const a = el('a', undefined, text);
    a.href = `?${next.toString()}`;
    a.setAttribute('aria-current', String(current === value));
    bar.append(a);
  }
  return bar;
}

const TAB_TITLES: Record<Tab, string> = { costumes: 'Kostüme · Костюмы', bunnies: 'Neue Hasen · Новые кролики', experiments: 'Pompon-Experimente · Эксперименты', hats: 'Mützen (neu) · Шапки' };

/** The new Nikolaus and winter hats (hats.ts) as looks on the rig: the same drawing the Sammlung phones use. */
export function hatLook(id: HatId, v: NewHatVariant): Look {
  const spec = NEW_HATS[id][v];
  return { id: `hat-${id}-${v}`, layers: [{ slot: spec.layer === 'under' ? 'under-ears' : 'over', draw: () => `<g class="cs-head">${spec.markup()}</g>` }] };
}

function hatItems(only: readonly string[] | null): Item[] {
  return (['nikolaus', 'winterhat'] as const).flatMap((id) => NEW_HAT_VARIANTS.map((v): Item => {
    const spec = NEW_HATS[id][v];
    const look = hatLook(id, v);
    const pick = RECOMMENDED[id] === v ? ' ⭐ мой выбор' : '';
    return {
      key: `${id}-${v}`,
      ru: `${id === 'nikolaus' ? 'Николаус' : 'Зимняя'} ${v} «${spec.ru}»${pick}`,
      de: `${id === 'nikolaus' ? 'Nikolausmütze' : 'Wintermütze'} · ${spec.de}`,
      sub: `${spec.layer === 'under' ? 'между ушками — уши лежат поверх края' : 'на корнях ушей — уши свисают из-под края'} · в «Pompons Sammlung»: ${id === 'nikolaus' ? '06.12 – 26.12' : '27.12 – 28.02'}`,
      what: spec.note,
      model: MODELS.pompon,
      look,
      also: [{ model: MODELS.pompon, look, label: '3/4', turn: 'r' }],
    };
  })).filter((it) => !only || only.includes(it.key));
}

export function costumesGallery(app: HTMLElement, q: URLSearchParams): void {
  if (!document.getElementById('cs-page-css')) {
    const style = el('style');
    style.id = 'cs-page-css';
    style.textContent = PAGE_CSS;
    document.head.append(style);
  }
  app.className = 'app cs-page';
  const tabQ = q.get('tab');
  const tab: Tab = tabQ === 'bunnies' || tabQ === 'experiments' || tabQ === 'hats' ? tabQ : 'costumes';
  const themeQ = q.get('theme');
  const themes: Theme[] = themeQ === 'all' ? THEMES.map((t) => t[0]) : THEMES.some((t) => t[0] === themeQ) ? [themeQ as Theme] : ['light'];
  const sizeQ = Number(q.get('size'));
  const size = [64, 96, 148].includes(sizeQ) ? sizeQ : 96;
  const reduced = q.get('reduced') === '1';
  // 31.10: Knopf and Hasel are archived (Felix: «Новые кролики не очень»), shown only with &archived=1
  const archived = q.get('archived') === '1';
  const only = q.get('only')?.split(',').filter(Boolean) ?? null;
  const view = q.get('view') ?? 'page';
  setLaptopVariant(q.get('laptop'));
  const items = tab === 'costumes' ? costumeItems(only, archived) : tab === 'bunnies' ? bunnyItems(only, archived) : tab === 'hats' ? hatItems(only) : experimentItems(only);
  const theme0 = themes[0] ?? 'light';
  document.body.style.background = '';
  if (view === 'laptop') return laptopView(app, q, THEME_VARS);
  // 31.10 (2nd review): the strawberry scene alone — &view=scene (stage + key frames), &t=2.6 (that frame, frozen)
  if (view === 'scene') {
    const t = q.get('t');
    strawberrySection(app, { vars: THEME_VARS[theme0], reduced, t: t === null ? null : Number(t), size: Number(q.get('stage')) || 300 });
    if (t === null) strawberrySheet(app, { vars: THEME_VARS[theme0], size: Number(q.get('size')) || 148, reduced });
    markReady();
    return;
  }

  if (view === 'grid' || view === 'sheet' || view === 'motion') {
    if (view === 'grid') for (const t of themes) gridPanel(app, items, t, size, POSES.map((x) => x[0]));
    if (view === 'sheet') sheet(app, items, themeQ ? themes : ['light', 'dark'], Number(q.get('size')) || 148);
    if (view === 'motion') motionSheet(app, items, theme0, Number(q.get('size')) || 120, Number(q.get('frames')) || MOTION_FRAMES.length);
    markReady();
    return;
  }

  app.append(el('h1', undefined, 'Костюмы по фото · новые кролики · эксперименты с Помпоном'));
  app.append(el('p', 'sub', 'Прототип только для галереи (31.10). Ты дал 18 фото (папка «Bunnys - Bunprise»): «сделай по этим идеям новые костюмы, новых кроликов … надо сохранить милость». Всё нарисовано заново в стиле нашей куклы и надето на настоящего Помпона / Тапси снаружи — в приложении ничего не изменилось. Кнопка «▶» в каждой карточке надевает вещь и делает одобренный прыжок-бинки: видно, что вещь едет вместе с ним.'));
  app.append(linkBar('Вкладка', (Object.keys(TAB_TITLES) as Tab[]).map((t): [string, string] => [t === 'costumes' ? '' : t, TAB_TITLES[t]]), 'tab', q, 'cs-tabs'));
  app.append(linkBar('Тема сетки', [['', 'Светлая'], ...THEMES.slice(1).map(([id, l]): [string, string] => [id, l]), ['all', 'Все пять']], 'theme', q));
  app.append(linkBar('Размер сетки', [['', '96 px'], ['148', '148 px'], ['64', '64 px']], 'size', q));
  app.append(linkBar('Движение', [['', 'Полное'], ['1', 'Меньше движения']], 'reduced', q));
  app.append(linkBar('Вид', [['', 'Страница'], ['sheet', 'Все крупно (светлая + тёмная)'], ['motion', 'Бинки по кадрам'], ['grid', 'Только позы']], 'view', q));
  if (tab === 'costumes') app.append(linkBar('Архив', [['', 'без наушников'], ['1', 'показать и наушники (убраны 31.10)']], 'archived', q));

  if (tab === 'bunnies') {
    app.append(el('h2', 'cs-h2', 'Новые кролики'));
    app.append(linkBar('Архив', [['', 'только Лёва'], ['1', 'показать и отложенных (Пуговка, Орешек)']], 'archived', q));
    family(app, theme0, reduced, archived);
  }
  if (tab === 'experiments') {
    app.append(el('p', 'cs-note', 'Цель — «ещё милее и живее, но не суетливее». Каждая деталь отдельно, рядом — Помпон сегодня; внизу два сочетания. Всё это шёрстка той же куклы (тот же цвет, тот же контур), а не наряд: детали едут с головой, щёчками и ушами.'));
  }
  if (tab === 'hats') {
    const note = el('p', 'cs-note', 'Ты отклонил все четыре шапки из «Pompons Sammlung» (28.10): «кривые и странно выглядят на кролике». Новые сидят НА макушке, край идёт по круглой голове и чуть шире неё, лоб открыт, висячие уши свисают из-под края (2 и 3) или лежат поверх него (1 «между ушками»); у каждой один наклон; качается только кончик / помпон — один раз после прыжка. Те же рисунки уже стоят в телефонах коллекции. ');
    const a = el('a', undefined, 'Старые шапки для сравнения →');
    a.href = '?screens=sammlung&view=hats&hats=old';
    const b = el('a', undefined, ' · новые в «Pompons Sammlung» →');
    b.href = '?screens=sammlung&view=hats';
    note.append(a, b);
    app.append(note);
  }
  app.append(el('h2', 'cs-h2', tab === 'costumes' ? `${items.length} костюмов — крупно и в размере телефона` : tab === 'bunnies' ? 'Каждый крупно, рядом Помпон и один костюм' : tab === 'hats' ? 'Шапка Николауса и зимняя шапка — по три варианта (спереди и 3/4)' : 'Каждый вариант рядом с сегодняшним Помпоном'));
  cards(app, items, theme0, reduced);
  laptopCardButton(app, reduced);
  // 31.10 (2nd review): the strawberry scene (one seekable timeline) under the cards
  if (tab === 'costumes' && items.some((it) => it.key === 'strawberry')) strawberrySection(app, { vars: THEME_VARS[theme0], reduced, t: q.get('t') === null ? null : Number(q.get('t')) });

  app.append(el('h2', 'cs-h2', 'Позы (все клетки неподвижны: один маскот двигается за раз)'));
  app.append(el('p', 'cs-note', '«Из-за края» — настоящий peek-once приветствия, «Перенос» — настоящая сцена CarryStage, «Верх прыжка» — одобренный бинки на середине. В тёмных темах (если выбрать «Все пять») — ключевые позы: спереди, 3/4, прыжок.'));
  const queue = themes.slice();
  const next = () => {
    const t = queue.shift();
    if (!t) {
      markReady();
      return;
    }
    gridPanel(app, items, t, size, themes.length > 1 && t !== 'light' ? KEY_POSES : POSES.map((x) => x[0]));
    setTimeout(next, 0);
  };
  next();
}
