/**
 * Gallery page «Flummi v2» (31.10) — GALLERY-ONLY. Felix rejected v1 («Флумми мне вообще не нравится») and allowed a
 * step away from our style: «Может, в стиле Дуолинго? Типа и проработано, но в то же время не прям реалистично.»
 *
 *   ?screens=binky                           v2 (this page); v1 stays at ?screens=binky&v=1
 *     &style=a|b|c                           A flat (no outline) · B thin outline in a darker shade · C bigger head
 *     &theme=light|dark|navy|ocean|black     the hero panel's theme
 *     &reduced=1                             reduced motion: everything still (each moment = its key pose)
 *     &view=hero|variants|views|idle|binky|motion|family|sizes|themes   only that section (screenshots)
 *     &view=frame&moment=binky|hop|laugh|curious|idle&t=0.64            one big frozen frame at t (seconds)
 *     &frames=12                             evenly spaced frames in the binky strip
 *
 * Every cell is a FlummiStage (demo/binky/v2/motion.ts) — Pompon and Tapsi next to him are the package puppets.
 */

import { Bunny, Hamster } from '../../../src/index';
import { THEME_VARS, THEMES } from '../../costumes/gallery';
import { STYLE_IDS, type StyleId, type ViewId } from './art';
import { BINKY_BEATS, DURATION, FlummiStage, KEY_POSE, MOMENT_IDS, NATIVE_VIEW, type MomentId } from './motion';

type Theme = 'light' | 'dark' | 'navy' | 'ocean' | 'black';

/** My recommendation (see docs/design/2026-10-31-flummi-v2.md). */
export const PICK: StyleId = 'a';

export const STYLE_LABELS: Readonly<Record<StyleId, { ru: string; what: string }>> = {
  a: { ru: 'A · плоский, без контура', what: 'Чистые плоские заливки, у каждого цвета 2–3 тона: основа, тень с чёткой границей, блик. Как Duolingo. Ни одной обводки.' },
  b: { ru: 'B · тонкий контур', what: 'То же, но каждая форма обведена тонкой линией своего же цвета, только темнее (не чёрной). Ближе к Помпону и Тапси.' },
  c: { ru: 'C · малыш', what: 'Как A, но пропорции другие: голова на 13 % больше, тело на 14 % меньше. Самый «детский», но меньше похож на «буханочку» с фото.' },
};

const VIEW_LABELS: Readonly<Record<ViewId, string>> = { front: 'спереди', q: '3/4', side: 'сбоку (профиль)' };
const MOMENT_LABELS: Readonly<Record<MomentId, string>> = { idle: 'покой', binky: 'бинки', hop: 'прыжки', laugh: 'смеётся', curious: 'любопытство' };

/** Key frames of the binky (s, label). */
export const BINKY_KEYS: ReadonlyArray<readonly [number, string]> = [
  [0, 'покой'],
  [BINKY_BEATS.crouch, 'присел'],
  [BINKY_BEATS.push, 'толчок'],
  [BINKY_BEATS.loaf, 'буханочка (как фото 1)'],
  [BINKY_BEATS.kick, 'поворот + пинок'],
  [BINKY_BEATS.land, 'приземлился'],
  [BINKY_BEATS.bounce, 'отскок, ^ ^'],
  [BINKY_BEATS.rest, 'покой'],
];
const HOP_KEYS: ReadonlyArray<readonly [number, string]> = [[0.08, 'присел'], [0.15, 'толчок'], [0.27, 'в воздухе'], [0.42, 'приземлился'], [0.6, 'поворот (спереди)'], [0.9, 'прыгает назад'], [2.75, 'конец = начало']];
const LAUGH_KEYS: ReadonlyArray<readonly [number, string]> = [[0, 'покой'], [0.12, 'замах'], [0.26, 'смех'], [0.5, 'хи-хи'], [1.3, 'успокоился'], [1.6, 'покой']];
const CURIOUS_KEYS: ReadonlyArray<readonly [number, string]> = [[0, 'покой'], [0.14, 'замах'], [0.36, 'наклон'], [0.9, 'ухо дёрнулось'], [1.62, 'назад'], [2.0, 'покой']];
const IDLE_KEYS: ReadonlyArray<readonly [number, string]> = [[0, 'сидит'], [0.6, 'нос шевелится'], [1.36, 'моргнул'], [2.58, 'ушко дёрнулось'], [3.5, 'взгляд в сторону'], [4.36, 'моргает дважды']];

const PAGE_CSS = `
.app.fl-page { max-width: none; padding: 20px 16px 48px; }
.fl-page h1 { margin: 4px 6px; }
.fl-page .sub { max-width: 1000px; }
.fl-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 6px; font-size: 13px; color: var(--text-2); }
.fl-bar b { font-weight: 600; margin-right: 4px; min-width: 70px; }
.fl-bar a { border-radius: 999px; padding: 6px 11px; font: 600 13px/1 inherit; font-family: inherit; background: var(--tile); color: var(--text); text-decoration: none; }
.fl-bar a[aria-current="true"] { background: color-mix(in srgb, var(--accent-ui) 22%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent-ui); }
.fl-panel { background: var(--cs-bg); color: var(--cs-text); border-radius: 26px; padding: 14px 14px 18px; margin: 0 0 16px; overflow-x: auto; box-shadow: 0 0 0 1px var(--cs-line); }
.fl-panel h2 { margin: 2px 6px 6px; font-size: 19px; }
.fl-panel h3 { margin: 10px 6px 4px; font-size: 15px; }
.fl-panel p, .fl-note { font-size: 13px; color: var(--cs-text2); margin: 4px 6px 10px; max-width: 1000px; line-height: 1.45; }
.fl-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.fl-strip { display: flex; gap: 6px; align-items: flex-end; flex-wrap: nowrap; }
.fl-fig { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.fl-fig figcaption { font-size: 12px; color: var(--cs-text2); text-align: center; line-height: 1.3; max-width: 230px; font-variant-numeric: tabular-nums; }
.fl-fig figcaption b { display: block; color: var(--cs-text); font-size: 13px; }
.fl-cell { position: relative; flex: none; overflow: hidden; border-radius: 12px; background: var(--cs-card); box-shadow: inset 0 0 0 1px var(--cs-line); }
.fl-cell > .fl-host { position: absolute; }
.fl-cell small { position: absolute; left: 6px; top: 4px; font-size: 10.5px; color: var(--cs-text2); line-height: 1.2; }
.fl-grid { display: grid; gap: 6px 10px; align-items: end; }
.fl-grid .fl-h { font-size: 11px; font-weight: 600; color: var(--cs-text2); text-align: center; padding: 8px 0 2px; }
.fl-grid .fl-rl { font-size: 11px; color: var(--cs-text2); text-align: right; padding-right: 4px; align-self: center; line-height: 1.3; }
.fl-grid .fl-rl b { display: block; color: var(--cs-text); font-size: 12.5px; }
.fl-vars { display: grid; grid-template-columns: repeat(3, minmax(330px, 1fr)); gap: 12px; }
.fl-var { border-radius: 20px; padding: 10px; box-shadow: 0 0 0 1px var(--cs-line); background: var(--cs-card); }
.fl-var.pick { box-shadow: 0 0 0 2px var(--accent-ui); }
.fl-var h3 { margin: 2px 4px 4px; font-size: 16px; }
.fl-var h3 a { color: inherit; }
.fl-var p { margin: 2px 4px 8px; font-size: 12.5px; }
.fl-live { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-end; }
.fl-btns { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; max-width: 300px; }
.fl-btn { appearance: none; border: 0; border-radius: 999px; padding: 9px 14px; font: 700 13.5px/1 inherit; font-family: inherit; min-height: 40px; cursor: pointer;
  background: color-mix(in srgb, var(--accent-ui) 22%, transparent); color: var(--cs-text); box-shadow: inset 0 0 0 1.5px var(--accent-ui); }
.fl-btn.alt { background: transparent; box-shadow: inset 0 0 0 1.5px var(--cs-line); }
.fl-btn[aria-pressed="true"] { background: color-mix(in srgb, var(--accent-ui) 40%, transparent); }
.fl-btn[disabled] { opacity: .55; cursor: default; }
.fl-compare { display: flex; gap: 14px; align-items: stretch; flex-wrap: wrap; }
.fl-photo { width: 300px; min-height: 240px; border-radius: 14px; overflow: hidden; background: var(--cs-card); box-shadow: inset 0 0 0 1px var(--cs-line);
  display: grid; place-items: center; text-align: center; font-size: 12px; color: var(--cs-text2); position: relative; }
.fl-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fl-photo img[hidden], .fl-photo label[hidden] { display: none; }
.fl-photo label { cursor: pointer; padding: 14px; line-height: 1.45; }
.fl-photo input { display: none; }
.fl-page ul { margin: 4px 0 6px; padding-left: 22px; font-size: 13px; line-height: 1.5; }
`;

// ---- helpers ------------------------------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function setVars(node: HTMLElement, vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
}
function markReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset['ready'] = '1')));
}
const sec = (t: number): string => `${t.toFixed(2).replace('.', ',')} с`;

interface Opts {
  style: StyleId;
  reduced: boolean;
}

/** A cell for a stage of width `size` standing on its floor; `air` = room above for the binky. */
function cell(parent: HTMLElement, size: number, air = false, label?: string): { cell: HTMLElement; host: HTMLElement } {
  const c = el('div', 'fl-cell');
  c.style.width = `${size}px`;
  c.style.height = `${Math.round(size * (air ? 0.92 : 0.76))}px`;
  parent.append(c);
  const host = el('div', 'fl-host');
  host.style.left = '0px';
  host.style.bottom = `${Math.round(size * 0.035)}px`;
  c.append(host);
  if (label) c.append(el('small', undefined, label));
  return { cell: c, host };
}

/** A still Flummi: `view` at rest, or the key pose of `moment`. */
function still(host: HTMLElement, size: number, o: Opts, view: ViewId, moment?: MomentId): FlummiStage {
  const views: readonly ViewId[] = moment === 'hop' ? ['front', 'q', 'side'] : [view];
  const st = new FlummiStage(host, { size, style: o.style, views, view, reduced: true });
  if (moment) st.pose(moment);
  return st;
}

/** One frame of a moment at `t` (the real timeline, seeked; reduced: the same frame written as a still). */
function frame(host: HTMLElement, size: number, o: Opts, m: MomentId, t: number): FlummiStage {
  const view = NATIVE_VIEW[m];
  const views: readonly ViewId[] = m === 'hop' ? ['front', 'q', 'side'] : [view];
  const st = new FlummiStage(host, { size, style: o.style, views, view, reduced: o.reduced });
  st.seek(m, t);
  return st;
}

function bar(parent: HTMLElement, q: URLSearchParams, label: string, key: string, values: ReadonlyArray<readonly [string, string]>, cur: string): void {
  const b = el('div', 'fl-bar');
  b.append(el('b', undefined, label));
  for (const [v, text] of values) {
    const a = el('a', undefined, text);
    const next = new URLSearchParams(q);
    next.set(key, v);
    a.href = `?${next.toString()}`;
    a.setAttribute('aria-current', String(v === cur));
    b.append(a);
  }
  parent.append(b);
}

function panel(parent: HTMLElement, theme: Theme, title: string, note?: string): HTMLElement {
  const p = el('section', 'fl-panel');
  setVars(p, THEME_VARS[theme]);
  p.dataset['theme'] = theme;
  p.append(el('h2', undefined, title));
  if (note) p.append(el('p', undefined, note));
  parent.append(p);
  return p;
}

function button(text: string, disabled: boolean, onClick: () => void, cls = 'fl-btn'): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

/** A strip of frozen frames of `m`. */
function strip(parent: HTMLElement, o: Opts, m: MomentId, keys: ReadonlyArray<readonly [number, string]>, size: number, air: boolean): void {
  const row = el('div', 'fl-strip');
  row.dataset['strip'] = m;
  parent.append(row);
  for (const [t, label] of keys) {
    const fig = el('figure', 'fl-fig');
    const { cell: c, host } = cell(fig, size, air);
    c.dataset['t'] = String(t);
    row.append(fig);
    frame(host, size, o, m, t);
    const cap = el('figcaption');
    if (label) cap.append(el('b', undefined, label));
    cap.append(document.createTextNode(`t = ${sec(t)}`));
    fig.append(cap);
  }
}

/** A cell that plays `m` (once on load, again on its button). */
function liveMoment(parent: HTMLElement, o: Opts, m: MomentId, size: number, air: boolean): void {
  const fig = el('figure', 'fl-fig');
  const { cell: c, host } = cell(fig, size, air, 'играет');
  c.dataset['show'] = m;
  parent.append(fig);
  const view = NATIVE_VIEW[m];
  const st = new FlummiStage(host, { size, style: o.style, views: m === 'hop' ? ['front', 'q', 'side'] : [view], view, reduced: o.reduced });
  if (o.reduced) st.pose(m);
  let busy = false;
  const go = () => {
    if (busy || o.reduced) return;
    busy = true;
    void st.play(m).then(() => (busy = false));
  };
  fig.append(button(o.reduced ? 'Меньше движения: стоит' : `▶ ${MOMENT_LABELS[m]} ещё раз`, o.reduced, go));
  go();
}

// ---- sections -----------------------------------------------------------------------------------------------------

/** Him live (idle; tap = binky; buttons for every moment and view) next to Pompon and Tapsi at the same scale. */
function hero(parent: HTMLElement, theme: Theme, o: Opts): void {
  const p = panel(parent, theme, 'Флумми v2 — живой', 'Сидит, дышит, моргает, шевелит носом, дёргает ушком. Нажми на него — бинки. Кнопки: вид (спереди / 3/4 / сбоку) и движения. Справа — Помпон и Тапси в том же масштабе.');
  const row = el('div', 'fl-live');
  p.append(row);
  const size = 300;
  const fig = el('figure', 'fl-fig');
  const { cell: c, host } = cell(fig, size, true);
  c.style.cursor = 'pointer';
  c.dataset['live'] = '1';
  row.append(fig);
  const st = new FlummiStage(host, { size, style: o.style, view: 'q', reduced: o.reduced });
  st.startIdle();
  const cap = el('figcaption');
  cap.append(el('b', undefined, `Flummi · Флумми · ${STYLE_LABELS[o.style].ru}`));
  fig.append(cap);
  const btns = el('div', 'fl-btns');
  fig.append(btns);
  const viewBtns: HTMLButtonElement[] = [];
  for (const v of ['front', 'q', 'side'] as const) {
    const b = button(VIEW_LABELS[v], false, () => {
      if (st.busy) return;
      st.stopIdle();
      st.setView(v);
      for (const x of viewBtns) x.setAttribute('aria-pressed', String(x === b));
      st.startIdle();
    }, 'fl-btn alt');
    b.setAttribute('aria-pressed', String(v === 'q'));
    viewBtns.push(b);
    btns.append(b);
  }
  const play = (m: MomentId) => {
    if (st.busy) return;
    void st.play(m);
  };
  for (const m of ['binky', 'hop', 'laugh', 'curious'] as const) btns.append(button(o.reduced ? `${MOMENT_LABELS[m]} (стоп-кадр)` : `▶ ${MOMENT_LABELS[m]}`, false, () => play(m)));
  c.addEventListener('click', () => play('binky'));
  const fam = (label: string, sub: string, mk: (h: HTMLElement) => void) => {
    const f = el('figure', 'fl-fig');
    const { host: h } = cell(f, 220, false);
    mk(h);
    const cp = el('figcaption');
    cp.append(el('b', undefined, label), document.createTextNode(sub));
    f.append(cp);
    row.append(f);
  };
  fam('Pompon · Помпон', 'главный, наш стиль', (h) => void new Bunny(h, { size: 220, idle: !o.reduced, interactive: false, reducedMotion: o.reduced ? 'force' : 'auto' }));
  fam('Tapsi · Тапси', 'хомяк, наш стиль', (h) => void new Hamster(h, { size: 220, idle: !o.reduced, interactive: false, reducedMotion: o.reduced ? 'force' : 'auto' }));
  fam('Флумми v2', 'тот же масштаб', (h) => {
    const s2 = new FlummiStage(h, { size: 220, style: o.style, views: ['front'], view: 'front', reduced: o.reduced });
    s2.startIdle();
  });
}

/** The three style variants side by side: front / 3/4 / side at 148, then 64, then dark. */
function variantsSection(parent: HTMLElement, theme: Theme, o: Opts, q: URLSearchParams): void {
  const p = panel(parent, theme, 'Три варианта стиля — выбери A, B или C', 'Нажми на название — вся страница покажет этот вариант. Сверху вниз: 148 px (спереди, 3/4, сбоку), 64 px, тёмная тема, в прыжке.');
  const grid = el('div', 'fl-vars');
  p.append(grid);
  for (const s of STYLE_IDS) {
    const box = el('div', `fl-var${s === PICK ? ' pick' : ''}`);
    box.dataset['style'] = s;
    const h = el('h3');
    const a = el('a', undefined, STYLE_LABELS[s].ru + (s === PICK ? ' ⭐ мой выбор' : ''));
    const next = new URLSearchParams(q);
    next.set('style', s);
    next.delete('view');
    a.href = `?${next.toString()}`;
    h.append(a);
    box.append(h, el('p', undefined, STYLE_LABELS[s].what));
    const so: Opts = { ...o, style: s };
    const row = el('div', 'fl-row');
    box.append(row);
    for (const v of ['front', 'q', 'side'] as const) {
      const { host } = cell(row, 104, false);
      still(host, 104, so, v);
    }
    const small = el('div', 'fl-row');
    small.style.marginTop = '6px';
    box.append(small);
    for (const v of ['front', 'q', 'side'] as const) {
      const { host } = cell(small, 64, false);
      still(host, 64, so, v);
    }
    const dark = el('div', 'fl-row');
    setVars(dark, THEME_VARS.dark);
    dark.style.cssText += ';background:var(--cs-bg);border-radius:14px;padding:6px;margin-top:8px';
    box.append(dark);
    still(cell(dark, 96, false).host, 96, so, 'front');
    still(cell(dark, 96, false).host, 96, so, 'q');
    still(cell(dark, 96, true).host, 96, so, 'side', 'binky');
    grid.append(box);
  }
}

/** The three views big. */
function viewsSection(parent: HTMLElement, theme: Theme, o: Opts): void {
  const p = panel(parent, theme, 'Три вида: спереди, 3/4, сбоку', 'Это новый рисунок (не кукла Помпона), поэтому теперь есть и профиль — как на фото 1. Плоские формы: у каждого цвета основа, тень с чёткой границей и блик; пушок — геометрические пучки на щеках, груди и хвостике.');
  const row = el('div', 'fl-row');
  p.append(row);
  for (const v of ['front', 'q', 'side'] as const) {
    const fig = el('figure', 'fl-fig');
    const { host } = cell(fig, 300, false);
    still(host, 300, o, v);
    fig.append(el('figcaption', undefined, VIEW_LABELS[v]));
    row.append(fig);
  }
}

/** Idle life: three live views + key frames. */
function idleSection(parent: HTMLElement, theme: Theme, o: Opts): void {
  const p = panel(parent, theme, 'Жизнь в покое', `Цикл ${sec(DURATION.idle)} (один конечный отрезок, потом заново): дышит, моргает (раз и дважды), трижды шевелит носом, дёргает одним ушком и потом другим, косится вперёд. Пауза, когда вкладка скрыта или он не на экране.`);
  const row = el('div', 'fl-row');
  p.append(row);
  for (const v of ['front', 'q', 'side'] as const) {
    const fig = el('figure', 'fl-fig');
    const { host } = cell(fig, 220, false, 'живой');
    const st = new FlummiStage(host, { size: 220, style: o.style, views: [v], view: v, reduced: o.reduced });
    st.startIdle();
    fig.append(el('figcaption', undefined, VIEW_LABELS[v]));
    row.append(fig);
  }
  p.append(el('div', 'fl-note', 'Кадры (3/4):'));
  const row2 = el('div', 'fl-strip');
  p.append(row2);
  for (const [t, label] of IDLE_KEYS) {
    const fig = el('figure', 'fl-fig');
    const { host } = cell(fig, 140, false);
    const st = new FlummiStage(host, { size: 140, style: o.style, views: ['q'], view: 'q', reduced: o.reduced });
    st.seek('idle', t);
    const cap = el('figcaption');
    cap.append(el('b', undefined, label), document.createTextNode(`t = ${sec(t)}`));
    fig.append(cap);
    row2.append(fig);
  }
}

/** The photo slot: the reference picture is NOT stored in the repo — pick it from D:\Bunnys - Bunprise (stays in the browser). */
function photoSlot(parent: HTMLElement): void {
  const photo = el('div', 'fl-photo');
  photo.dataset['ref'] = '1';
  const img = el('img');
  img.alt = '';
  img.hidden = true;
  const lab = el('label');
  lab.append(document.createTextNode('Фото для сравнения: нажми и выбери снимок из «D:\\Bunnys - Bunprise» (остаётся только в браузере, никуда не загружается).'));
  const input = el('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    img.src = URL.createObjectURL(file);
    img.hidden = false;
    lab.hidden = true;
  });
  lab.append(input);
  photo.append(img, lab);
  parent.append(photo);
}

function binkySection(parent: HTMLElement, theme: Theme, o: Opts, frames: number): void {
  const p = panel(parent, theme, `Бинки сбоку — ${sec(DURATION.binky)}, один раз`, 'Присел (замах) → толчок, тело вытягивается → в воздухе «буханочка»: лапы поджаты, как на фото 1 → поворот: зад подлетает вверх, голова дёргается назад, задние лапы бьют назад (видны розовые подушечки) → падает, приземляется со сплющиванием → один маленький отскок, глаза ^ ^ → покой. Только transform и opacity, одна временная шкала. «Меньше движения»: только стоп-кадр «буханочка в воздухе».');
  const cmp = el('div', 'fl-compare');
  cmp.dataset['compare'] = '1';
  p.append(cmp);
  photoSlot(cmp);
  const big = el('div', 'fl-row');
  cmp.append(big);
  for (const t of [BINKY_BEATS.loaf, BINKY_BEATS.kick]) {
    const fig = el('figure', 'fl-fig');
    const { host } = cell(fig, 280, true);
    frame(host, 280, o, 'binky', t);
    fig.append(el('figcaption', undefined, `t = ${sec(t)} — ${t === BINKY_BEATS.loaf ? 'буханочка' : 'поворот + пинок'}`));
    big.append(fig);
  }
  p.append(el('h3', undefined, 'Ключевые кадры'));
  strip(p, o, 'binky', BINKY_KEYS, 148, true);
  const n = Math.max(2, Math.min(20, frames));
  const even = Array.from({ length: n }, (_, i): readonly [number, string] => [Math.round(((DURATION.binky * i) / (n - 1)) * 100) / 100, '']);
  p.append(el('h3', undefined, `Все кадры подряд (${n}, равномерно)`));
  strip(p, o, 'binky', even, 96, true);
  p.append(el('h3', undefined, '64 px (размер телефона)'));
  strip(p, o, 'binky', BINKY_KEYS.map(([t]) => [t, ''] as const), 64, true);
  p.append(el('h3', undefined, 'Целиком'));
  const live = el('div', 'fl-row');
  p.append(live);
  liveMoment(live, o, 'binky', 300, true);
  p.append(el('p', undefined, 'Один кадр крупно: добавь к адресу &view=frame&moment=binky&t=0.64 (любое t от 0 до 1,6).'));
}

function motionSection(parent: HTMLElement, theme: Theme, o: Opts): void {
  const p = panel(parent, theme, 'Ещё движения: прыжки и две эмоции', 'Мультяшный тайминг: замах → действие (сплющился / вытянулся) → один перелёт → успокоился. Без желе и раскачивания.');
  const block = (m: MomentId, title: string, note: string, keys: ReadonlyArray<readonly [number, string]>) => {
    p.append(el('h3', undefined, `${title} · ${sec(DURATION[m])}`));
    p.append(el('p', undefined, note));
    const row = el('div', 'fl-row');
    row.style.flexWrap = 'nowrap';
    p.append(row);
    liveMoment(row, o, m, 220, m === 'hop');
    strip(row, o, m, keys, 128, m === 'hop');
  };
  block('hop', 'Прыжки (сбоку)', 'Два прыжка вправо, быстрый разворот (на один миг виден спереди, моргает), два прыжка влево, разворот, прыжок на место. Конец = начало.', HOP_KEYS);
  block('laugh', 'Смеётся (спереди)', 'Замах вниз, подскок: глаза ^ ^, рот открыт (зубки и язычок), лапки к груди, румянец ярче, три маленьких «хи-хи»-подскока, ушки один раз качнулись наружу, успокоился.', LAUGH_KEYS);
  block('curious', 'Любопытство (3/4)', 'Маленький замах в другую сторону, наклон головы с одним перелётом, одно ушко поднялось (и потом дёрнулось), зрачки шире, одна бровь вверх, ротик «о», нос нюхает, моргнул, вернулся.', CURIOUS_KEYS);
}

function familySection(parent: HTMLElement, themes: readonly Theme[], o: Opts): void {
  for (const theme of themes) {
    const p = panel(parent, theme, `Рядом с нашими, один масштаб · ${THEMES.find((t) => t[0] === theme)?.[1] ?? theme}`, 'Слева направо: Помпон, Тапси, Флумми v2 спереди, 3/4, сбоку. Он другой: плоские тона вместо мягких градиентов, глаза с белками, зубки. Подходит ли он к ним — решать тебе.');
    for (const size of [148, 96] as const) {
      const row = el('div', 'fl-row');
      row.style.marginBottom = '8px';
      p.append(row);
      const fig = (label: string, mk: (h: HTMLElement) => void) => {
        const f = el('figure', 'fl-fig');
        const { host } = cell(f, size, false);
        mk(host);
        if (size === 148) f.append(el('figcaption', undefined, label));
        row.append(f);
      };
      fig('Помпон', (h) => void new Bunny(h, { size, idle: false, interactive: false, reducedMotion: 'force' }));
      fig('Тапси', (h) => void new Hamster(h, { size, idle: false, interactive: false, reducedMotion: 'force' }));
      fig('Флумми спереди', (h) => void still(h, size, o, 'front'));
      fig('Флумми 3/4', (h) => void still(h, size, o, 'q'));
      fig('Флумми сбоку', (h) => void still(h, size, o, 'side'));
    }
  }
}

const GRID_POSES: ReadonlyArray<readonly [string, string, ViewId, MomentId | null, number?]> = [
  ['front', 'спереди', 'front', null],
  ['q', '3/4', 'q', null],
  ['side', 'сбоку', 'side', null],
  ['binky-loaf', 'бинки: буханочка', 'side', 'binky', BINKY_BEATS.loaf],
  ['binky-kick', 'бинки: пинок', 'side', 'binky', BINKY_BEATS.kick],
  ['laugh', 'смеётся', 'front', 'laugh'],
  ['curious', 'любопытство', 'q', 'curious'],
];

function poseCell(parent: HTMLElement, size: number, o: Opts, pose: (typeof GRID_POSES)[number]): void {
  const [id, , view, moment, t] = pose;
  const air = moment === 'binky';
  const { cell: c, host } = cell(parent, size, air);
  c.dataset['pose'] = id;
  if (!moment) still(host, size, o, view);
  else {
    const st = new FlummiStage(host, { size, style: o.style, views: [view], view, reduced: true });
    st.seek(moment, t ?? KEY_POSE[moment]);
  }
}

function sizesSection(parent: HTMLElement, themes: readonly Theme[], o: Opts): void {
  for (const theme of themes) {
    const p = panel(parent, theme, `Размеры 148 / 96 / 64 px · ${THEMES.find((t) => t[0] === theme)?.[1] ?? theme}`);
    for (const size of [148, 96, 64] as const) {
      const grid = el('div', 'fl-grid');
      grid.style.gridTemplateColumns = `70px repeat(${GRID_POSES.length}, ${size}px)`;
      p.append(grid);
      grid.append(el('div'));
      for (const [, label] of GRID_POSES) grid.append(el('div', 'fl-h', size === 148 ? label : ''));
      grid.append(el('div', 'fl-rl', `${size} px`));
      for (const pose of GRID_POSES) poseCell(grid, size, o, pose);
    }
  }
}

function themesSection(parent: HTMLElement, o: Opts): void {
  const p = panel(parent, 'light', 'Все пять тем (96 px): Светлая, Тёмная, Blau, Ozean, Schwarz');
  const poses = GRID_POSES.filter((x) => ['front', 'q', 'side', 'binky-loaf', 'laugh'].includes(x[0]));
  const grid = el('div', 'fl-grid');
  grid.style.gridTemplateColumns = `90px repeat(${poses.length}, 106px)`;
  grid.style.gap = '0';
  p.append(grid);
  grid.append(el('div'));
  for (const [, label] of poses) grid.append(el('div', 'fl-h', label));
  for (const [theme, label] of THEMES) {
    const lab = el('div', 'fl-rl');
    lab.append(el('b', undefined, label));
    grid.append(lab);
    for (const pose of poses) {
      const wrapCell = el('div');
      setVars(wrapCell, THEME_VARS[theme]);
      wrapCell.style.cssText += `;background:var(--cs-bg);padding:5px;height:${Math.round(96 * 0.92)}px;display:flex;align-items:flex-end`;
      grid.append(wrapCell);
      poseCell(wrapCell, 96, o, pose);
    }
  }
}

function frameView(parent: HTMLElement, theme: Theme, o: Opts, m: MomentId, t: number): void {
  const p = panel(parent, theme, `${MOMENT_LABELS[m]} · кадр t = ${sec(t)}`);
  const { host } = cell(p, 440, m === 'binky' || m === 'hop');
  frame(host, 440, o, m, t);
}

// ---- the page -----------------------------------------------------------------------------------------------------

export function flummiV2Gallery(app: HTMLElement, q: URLSearchParams): void {
  const style = el('style');
  style.textContent = PAGE_CSS;
  document.head.append(style);
  app.className = 'app fl-page';
  app.replaceChildren();
  const pick = <T extends string>(v: string | null, list: readonly T[], d: T): T => ((list as readonly string[]).includes(v ?? '') ? (v as T) : d);
  const o: Opts = { style: pick(q.get('style'), STYLE_IDS, PICK), reduced: q.get('reduced') === '1' };
  const theme = pick(q.get('theme'), THEMES.map((t) => t[0]), 'light');
  const view = q.get('view');
  const frames = Number(q.get('frames') ?? '12') || 12;

  app.append(el('h1', undefined, 'Флумми v2 · новый стиль «как Duolingo»'));
  const sub = el('p', 'sub', 'Только галерея (31.10). Новый рисунок, а не перекроенный Помпон: плоские заливки без чёрных контуров, у каждого цвета 2–3 тона, большая голова, компактное тело-«буханочка», большие глаза с веками и бровками, зубки, пушок из простых геометрических пучков. Рыжий, белая мордочка, живот и хвостик, короткие круглые ушки — как на твоих фото. В приложении ничего не меняется. ');
  const v1 = el('a', undefined, 'Старый Флумми (v1) →');
  const v1q = new URLSearchParams(q);
  v1q.set('v', '1');
  v1q.delete('view');
  v1.href = `?${v1q.toString()}`;
  sub.append(v1);
  app.append(sub);
  bar(app, q, 'Вариант', 'style', STYLE_IDS.map((s) => [s, STYLE_LABELS[s].ru + (s === PICK ? ' ⭐' : '')] as const), o.style);
  bar(app, q, 'Тема', 'theme', THEMES, theme);
  bar(app, q, 'Движение', 'reduced', [['0', 'обычное'], ['1', 'меньше движения']], o.reduced ? '1' : '0');

  const show = (name: string) => !view || view === name;
  if (view === 'frame') {
    const m = pick(q.get('moment'), MOMENT_IDS, 'binky');
    frameView(app, theme, o, m, Number(q.get('t') ?? KEY_POSE[m]) || 0);
  }
  if (show('hero')) hero(app, theme, o);
  if (show('variants')) variantsSection(app, theme, o, q);
  if (show('views')) viewsSection(app, theme, o);
  if (show('idle')) idleSection(app, theme, o);
  if (show('binky')) binkySection(app, theme, o, frames);
  if (show('motion')) motionSection(app, theme, o);
  if (show('family')) familySection(app, ['light', 'dark'], o);
  if (show('sizes')) sizesSection(app, ['light', 'dark'], o);
  if (show('themes')) themesSection(app, o);
  markReady();
}
