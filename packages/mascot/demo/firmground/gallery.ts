/**
 * Gallery page «Твёрдая почва» (idea 1.9 of docs/ideas/2026-10-26-mascot-ideas.md, 26.10; Felix «нравится» →
 * in the app since 27.10). A phone-wide mock of the «Listen» tab (Paper tokens, the app's 2-column list grid) with
 * the REAL Lists buddy (Pompon, 96 px like in the app) built with `footing: true` (the moment is the buddy's own:
 * src/buddy/footing.ts + buddy.ts); firmground.ts adds only the gallery's tools (frozen frames, reproducible drops).
 *
 *   ?screens=firmground [&at=corner|left|right|brink|middle] [&t=0.4 (the phone frozen at that moment)]
 *                       [&reduced=1] [&size=96|128|160] [&auto=0 (no own life)] [&autoplay=0]
 *                       [&frames=13] [&zoom=2.5] [&guides=0]
 *
 * Design note (Russian, for Felix): docs/design/2026-10-26-firmground.md.
 */

import type { ReducedMotionMode } from '../../src/index';
import { ListsBuddy, type BuddyHaptic, type BuddyInfo } from '../../src/buddy/index';
import { geometry } from '../../src/buddy/rig';
import * as M from '../../src/buddy/footing';
import { FirmGround, type FirmEvent } from './firmground';

export type At = 'corner' | 'left' | 'right' | 'brink' | 'middle';

/** Floors of the mock used by the buttons: the second row of the grid (the first sits right under the switch). */
const FLOOR = { w: 'weihnachten', e: 'einfach-so' } as const;

/** Reproducible set-downs: which card, which end, how far round its corner the paw will touch (deg). */
export const PLACES: Record<At, { label: string; floor: keyof typeof FLOOR; side: -1 | 1; phi: number; hint: string }> = {
  corner: { label: 'На скругление угла', floor: 'w', side: 1, phi: 20, hint: 'лапка ложится на само скругление и поворачивается вместе с ним' },
  left: { label: 'У края слева', floor: 'w', side: -1, phi: 4, hint: 'лапка трогает верх карточки там, где начинается скругление' },
  right: { label: 'У края справа', floor: 'e', side: 1, phi: 8, hint: 'то же у правого края' },
  brink: { label: 'На самый край', floor: 'e', side: -1, phi: 0, hint: 'ближе движок не сажает: дальняя лапка висит над пустотой, он тянет её внутрь, к скруглению' },
  middle: { label: 'В середину', floor: 'e', side: 1, phi: 0, hint: 'контроль: в середине момента нет — обычная мягкая посадка' },
};

const CSS_TEXT = `
.fg { margin: 0 auto 32px; max-width: 1000px; color: var(--text, #1D1D1F); }
.fg h2 { margin: 6px 6px 4px; font-size: 24px; letter-spacing: -.01em; }
.fg > p { margin: 0 6px 14px; color: var(--text-2, #6E6E73); font-size: 14px; line-height: 1.5; max-width: 780px; }
.fg-controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 6px 14px; align-items: center; }
.fg-controls select, .fg-controls button, .fg-bar button { appearance: none; border: 0; border-radius: 999px; padding: 9px 14px; font: 600 14px/1 inherit;
  background: rgba(0,0,0,.06); color: inherit; cursor: pointer; transition: transform .25s cubic-bezier(.34,1.56,.64,1); }
.fg-controls button.on { background: color-mix(in srgb, #F0A04B 24%, transparent); box-shadow: inset 0 0 0 1.5px #F0A04B; }
.fg-controls button:active, .fg-bar button:active { transform: scale(.94); }
.fg-controls .sep { width: 1px; height: 26px; background: rgba(0,0,0,.12); margin: 0 4px; }
.fg-row { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; justify-content: center; }
.fg-side { width: 330px; font-size: 13px; line-height: 1.5; color: var(--text-2, #6E6E73); }
.fg-side b { color: var(--text, #1D1D1F); }
.fg-side ul { padding-left: 18px; margin: 6px 0 12px; }
.fg-side code { display: block; padding: 8px 10px; border-radius: 12px; background: rgba(0,0,0,.05); color: var(--text, #1D1D1F);
  font: 12px/1.45 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; min-height: 3em; }
.fg-bar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: center; margin: 16px 0 6px; font-size: 13px; color: var(--text-2, #6E6E73); }
.fg-bar input[type=range] { width: 260px; accent-color: #F0A04B; }
.fg-bar output { min-width: 72px; font-variant-numeric: tabular-nums; color: var(--text, #1D1D1F); }
.fg-sheet h3 { margin: 22px 6px 4px; font-size: 18px; }
.fg-sheet > p { margin: 0 6px 10px; font-size: 13px; color: var(--text-2, #6E6E73); line-height: 1.5; }
.fg-grid { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.fg-cell { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.fg-cell figcaption { font-size: 11px; color: var(--text-2, #6E6E73); font-variant-numeric: tabular-nums; }
.fg-cell figcaption b { color: var(--text, #1D1D1F); font-weight: 600; }

/* the app's surfaces, light "Paper" (apps/web/src/styles/tokens.css, kit.css, tints.css) */
.fg-paper { --bg: #F2EBDD; --surface: #FFFDF8; --text: #2A231C; --text-2: #62554A; --accent-100: #FCE5C9; --accent-300: #F3B676;
  --accent-400: #EE9443; --accent-600: #984A14; --text-on-accent: #2A1A0B;
  --tint-1: rgba(255,170,104,.34); --tint-2: rgba(240,150,164,.3); --tint-3: rgba(146,166,230,.27); --tint-4: rgba(246,200,92,.36);
  --panel-bg: rgba(255,252,246,.62); --panel-sheen: linear-gradient(180deg, rgba(255,255,255,.5) 0%, transparent 42%);
  --panel-shadow: 0 1px 2px rgba(80,50,22,.05), 0 12px 30px -14px rgba(92,56,24,.26);
  --mascot-shadow: rgba(70,40,15,.20); --mascot-outline: rgba(224,171,116,.5);
  --page-backdrop: radial-gradient(78% 36% at -4% -2%, rgba(255,193,146,.58) 0%, transparent 72%), radial-gradient(70% 34% at 104% 30%, rgba(248,180,170,.46) 0%, transparent 72%),
    radial-gradient(84% 34% at 4% 98%, rgba(252,206,126,.5) 0%, transparent 72%), radial-gradient(72% 30% at 102% 80%, rgba(204,194,242,.42) 0%, transparent 72%),
    linear-gradient(180deg, #F7F0E5 0%, #F3EADC 55%, #F0E6D6 100%);
  color: var(--text); font: 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.fg-phone { position: relative; width: 390px; height: 780px; border-radius: 46px; overflow: hidden; background: var(--bg);
  box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(60,40,20,.28); flex: none; }
.fg-screen { position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; background: var(--page-backdrop); }
.fg-screen::-webkit-scrollbar { display: none; }
.fg-content { position: relative; padding: 14px 16px 120px; }
.fg-top { display: flex; align-items: center; justify-content: space-between; height: 52px; }
.fg-top b { font-size: 34px; font-weight: 800; letter-spacing: -.032em; }
.fg-top span { border-radius: 999px; padding: 10px 16px; background: var(--surface); font-weight: 600; font-size: 15px; box-shadow: var(--panel-shadow); }
.fg-profile { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.fg-avatar { width: 56px; height: 56px; border-radius: 50%; background: #F7E7B4; color: #7A5A15; display: grid; place-items: center; font-size: 24px; font-weight: 700;
  box-shadow: 0 0 0 4px var(--surface), 0 8px 22px rgba(80,50,20,.15); flex: none; }
.fg-profile b { display: block; font-size: 20px; letter-spacing: -.02em; }
.fg-profile small { color: var(--text-2); font-size: 13px; }
.fg-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 68px; }
.fg-stat { min-height: 76px; box-sizing: border-box; padding: 12px 16px; border-radius: 22px; background-color: var(--panel-bg); background-image: var(--panel-sheen);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.7), var(--panel-shadow); display: flex; flex-direction: column; justify-content: center; }
.fg-stat strong { font-size: 28px; line-height: 1.1; letter-spacing: -.02em; }
.fg-stat span { font-size: 13px; color: var(--text-2); }
.fg-seg { margin-top: 16px; padding: 6px 0 8px; }
.fg-seg div { display: grid; grid-template-columns: 1fr 1fr; background: rgba(116,84,44,.07); border-radius: 999px; padding: 4px; }
.fg-seg span { text-align: center; padding: 9px; border-radius: 999px; font-weight: 600; color: var(--text-2); }
.fg-seg .on { background: var(--surface); color: var(--text); box-shadow: 0 2px 8px rgba(80,50,20,.1); }
.fg-lists { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 16px 0 0; padding: 0; list-style: none; }
.fg-lists > li { display: flex; min-width: 0; }
.fg-card { --card-tint: var(--tint-1); width: 100%; min-height: 168px; box-sizing: border-box; padding: 12px; border-radius: 24px;
  background-color: var(--panel-bg); background-image: linear-gradient(162deg, var(--card-tint) 0%, rgba(255,255,255,0) 58%), var(--panel-sheen);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.7), var(--panel-shadow); display: flex; flex-direction: column; align-items: flex-start; }
.fg-card[data-tone='2'] { --card-tint: var(--tint-2); } .fg-card[data-tone='3'] { --card-tint: var(--tint-3); } .fg-card[data-tone='4'] { --card-tint: var(--tint-4); }
.fg-cover { width: 46px; height: 46px; border-radius: 14px; margin-bottom: 12px; background: var(--card-tint); box-shadow: inset 0 0 0 1px rgba(255,255,255,.6); }
.fg-card b { font-size: 17px; line-height: 22px; letter-spacing: -.01em; }
.fg-card small { margin-top: auto; color: var(--text-2); font-size: 13px; }
.fg-new { width: 100%; min-height: 168px; box-sizing: border-box; border-radius: 24px; border: 2px dashed color-mix(in oklab, var(--accent-400) 55%, transparent);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-weight: 700; font-size: 15px; }
.fg-new i { width: 46px; height: 46px; border-radius: 50%; background: var(--accent-300); color: var(--text-on-accent); display: grid; place-items: center; font: 400 28px/1 inherit; font-style: normal; }
.fg-tabs { position: absolute; left: 12px; right: 12px; bottom: 14px; height: 64px; border-radius: 32px; background: rgba(255,253,248,.88);
  box-shadow: 0 10px 30px rgba(80,50,20,.16); display: flex; align-items: center; justify-content: space-around; font-weight: 600; font-size: 11px; color: var(--text-2); z-index: 10; }
.fg-tabs .plus { width: 54px; height: 54px; border-radius: 50%; background: #F0A04B; color: #2A1A0B; display: grid; place-items: center; font-size: 30px; font-weight: 400; }
.fg-tabs .on { color: #B65E1C; }
.fg-finger { position: absolute; left: 0; top: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; pointer-events: none; z-index: 6;
  background: radial-gradient(circle, rgba(255,255,255,.55) 0 40%, rgba(255,255,255,0) 41%), rgba(90,60,30,.16); box-shadow: 0 0 0 1.5px rgba(90,60,30,.25);
  opacity: 0; transition: opacity .2s ease; }
.fg-finger.on { opacity: 1; }

/* contact sheet cells: a crop of one card end, everything drawn natively at zoom (puppet, card, radius) */
.fg-cell-stage { position: relative; overflow: hidden; border-radius: 14px; background: var(--page-backdrop); box-shadow: 0 0 0 1px rgba(60,40,20,.12); }
.fg-cell-card { position: absolute; background-color: var(--panel-bg); background-image: linear-gradient(162deg, var(--tint-3) 0%, rgba(255,255,255,0) 58%), var(--panel-sheen);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.7), var(--panel-shadow); }
.fg-guide { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed rgba(182,94,28,.55); z-index: 2; pointer-events: none; }
`;

const CARDS = [
  { id: 'geburtstag', title: 'Geburtstag 2026', meta: '5 Wünsche', tone: 1 },
  { id: FLOOR.w, title: 'Weihnachten', meta: '8 Wünsche', tone: 3 },
  { id: FLOOR.e, title: 'Einfach so', meta: '3 Wünsche', tone: 2 },
  { id: 'buecher', title: 'Bücher', meta: '4 Wünsche', tone: 4 },
  { id: 'reise', title: 'Reise', meta: '2 Wünsche', tone: 1 },
];

/** Next frame (layout is there); jsdom without rAF: a short timeout. */
function onFrame(cb: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => cb());
  else setTimeout(cb, 16);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function phoneMarkup(): string {
  const cards = CARDS.map((c, i) => `<li data-buddy-floor="${c.id}" data-buddy-card="${i}"><article class="fg-card" data-tone="${c.tone}">
      <span class="fg-cover"></span><b>${c.title}</b><small>${c.meta}</small></article></li>`).join('');
  return `<div class="fg-screen"><div class="fg-content">
      <div class="fg-top"><b>Listen</b><span>Teilen</span></div>
      <div class="fg-profile"><div class="fg-avatar" data-buddy-avatar>K</div><div><b>Felix</b><small>3 Follower · Du folgst 3</small></div></div>
      <div class="fg-stats" data-buddy-floor="stats"><div class="fg-stat"><strong>20</strong><span>Wünsche</span></div><div class="fg-stat"><strong>4</strong><span>Mit dir geteilt</span></div></div>
      <div class="fg-seg" data-buddy-ceiling><div><span class="on">Meine</span><span>Freunde</span></div></div>
      <ul class="fg-lists"><li data-buddy-floor="new"><div class="fg-new"><i>+</i>Neue Liste</div></li>${cards}</ul>
      <i class="fg-finger"></i>
    </div></div>
    <nav class="fg-tabs"><span>Start</span><span class="on">Listen</span><span class="plus">+</span><span>Ideen</span><span>Profil</span></nav>`;
}

/** Where to set him down for a placement on floor `id` (stage px), null if that floor is not there. */
export function placeX(fg: FirmGround, id: string, at: At, side: -1 | 1 = PLACES[at].side): number | null {
  const f = fg.floor(id);
  const shape = f && fg.shape(f);
  if (!f || !shape) return null;
  if (at === 'middle') return (f.x0 + f.x1) / 2;
  if (at === 'brink') {
    // the engine's own landing margin (buddy.ts land(): margin() * 0.6 = radius * 0.54) — he never lands closer
    const r = geometry('bunny', fg.width).radius * 0.54;
    return side < 0 ? f.x0 + r : f.x1 - r;
  }
  return M.feetForTouch(shape, side, (PLACES[at].phi * Math.PI) / 180, fg.width);
}

/** The gallery's own vibration (in the app it goes through the haptics wrapper). */
function vibrate(kind: BuddyHaptic): void {
  const pattern = kind === 'warning' ? [12, 40, 18] : kind === 'select' ? 6 : 10;
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

function eventText(e: FirmEvent): string {
  const where = e.side === -1 ? 'у левого края' : e.side === 1 ? 'у правого края' : '';
  switch (e.kind) {
    case 'play': return `момент: ${where} «${e.floor}», шаг внутрь ${e.step?.toFixed(1)} px`;
    case 'done': return `готово: стоит на твёрдом, ${where}`;
    case 'reduced': return `«Weniger»: сразу на безопасное место (${e.step?.toFixed(1)} px внутрь), глаза ^ ^`;
    case 'middle': return 'середина карточки — момента нет, обычная мягкая посадка';
    case 'pause': return `пауза 20 с: ещё ${e.wait} с — обычная мягкая посадка`;
    case 'stopped': return 'прервали (схватили / прокрутка) — без рывка';
  }
}

/** Contact sheet: `n` frozen frames of 0 … 1.2 s, each a native-zoom crop of the card's end. Returns a cleanup. */
function buildSheet(host: HTMLElement, at: At, size: number, zoom: number, n: number, reduced: boolean, guides: boolean): () => void {
  host.replaceChildren();
  if (at === 'middle') {
    host.append(el('p', undefined, 'В середине карточки момента нет — смотреть нечего (это и проверяем).'));
    return () => undefined;
  }
  const side = PLACES[at].side;
  const Z = zoom;
  const W = 104;
  const H = 76;
  const FY = 60;
  const R = 24;
  const grid = el('div', 'fg-grid fg-paper');
  const cells: { stage: HTMLElement; t: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? (i * M.DURATION) / (n - 1) : 0;
    const fig = el('figure', 'fg-cell');
    const stage = el('div', 'fg-cell-stage');
    Object.assign(stage.style, { width: `${W * Z}px`, height: `${H * Z}px` });
    const card = el('div', 'fg-cell-card');
    card.dataset.buddyFloor = 'c';
    card.dataset.buddyCard = '0';
    const cardW = 300;
    Object.assign(card.style, { left: `${(side < 0 ? 18 : W - 18 - cardW) * Z}px`, top: `${FY * Z}px`, width: `${cardW * Z}px`, height: `${60 * Z}px`, borderRadius: `${R * Z}px` });
    stage.append(card);
    if (guides) {
      const line = el('i', 'fg-guide');
      line.style.top = `${FY * Z}px`;
      stage.append(line);
    }
    const cap = el('figcaption');
    cap.innerHTML = `<b>${t.toFixed(2)} с</b>`;
    fig.append(stage, cap);
    grid.append(fig);
    cells.push({ stage, t });
  }
  host.append(grid);
  const live: { b: ListsBuddy; fg: FirmGround }[] = [];
  onFrame(() => {
    for (const c of cells) {
      const b = new ListsBuddy({ stage: c.stage, scroller: null, kind: 'bunny', width: size * Z, reducedMotion: reduced ? 'force' : 'off', autonomous: false, groundInset: 0, footing: true });
      const fg = new FirmGround(b);
      const x = placeX(fg, 'c', at, side);
      if (x !== null) fg.freeze('c', x, c.t);
      live.push({ b, fg });
    }
    host.dataset.ready = '1';
  });
  return () => live.forEach(({ b, fg }) => { fg.detach(); b.destroy(); });
}

export function firmGroundGallery(app: HTMLElement, q: URLSearchParams): void {
  app.replaceChildren();
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);

  const atQ = q.get('at') as At | null;
  let at: At = atQ && atQ in PLACES ? atQ : 'corner';
  const tQ = q.get('t');
  const frozenT = tQ !== null && Number.isFinite(Number(tQ)) ? Math.max(0, Number(tQ)) : null;
  const zoom = Number(q.get('zoom')) > 0 ? Number(q.get('zoom')) : 2.5;
  const nFrames = Math.max(2, Math.min(25, Number(q.get('frames')) || 13));
  const guides = q.get('guides') !== '0';

  const section = el('section', 'fg');
  section.innerHTML = `<h2>«Твёрдая почва» — Помпон проверяет край (1.9) · прототип</h2>
    <p>Одобрено (27.10 — в приложении). Настоящий дружок со «Списков» (тот же движок, 96 px как в приложении). Если его <b>мягко опустить</b> у
    скруглённого края карточки, он трогает поверхность одной лапкой, переносит вес от края и делает один маленький шаг внутрь —
    1,2 с, не чаще раза в 20 с. Опусти его кнопками ниже (точно в одно и то же место) или сам мышкой.</p>`;
  const controls = el('div', 'fg-controls');
  const placeButtons = (Object.keys(PLACES) as At[]).map((key) => {
    const b = el('button', undefined, PLACES[key].label);
    b.type = 'button';
    b.dataset.at = key;
    b.title = PLACES[key].hint;
    controls.append(b);
    return b;
  });
  const replay = el('button', undefined, 'Повторить');
  replay.type = 'button';
  const sep = el('span', 'sep');
  const motionSel = el('select');
  motionSel.setAttribute('aria-label', 'Движение');
  motionSel.add(new Option('Полное движение', 'off'));
  motionSel.add(new Option('Weniger (уменьшенное)', 'force'));
  motionSel.value = q.get('reduced') === '1' ? 'force' : 'off';
  const sizeSel = el('select');
  sizeSel.setAttribute('aria-label', 'Размер');
  sizeSel.add(new Option('96 px — как в приложении', '96'));
  sizeSel.add(new Option('128 px', '128'));
  sizeSel.add(new Option('160 px', '160'));
  sizeSel.value = ['128', '160'].includes(q.get('size') ?? '') ? (q.get('size') as string) : '96';
  controls.append(replay, sep, motionSel, sizeSel);

  const row = el('div', 'fg-row');
  const phone = el('div', 'fg-phone fg-paper');
  const side = el('div', 'fg-side');
  side.innerHTML = `<b>На что смотреть</b><ul>
      <li><b>касание</b>: лапка у края встаёт ровно на верх карточки — без щели и не «тонет»; на скруглении она поворачивается по нему;</li>
      <li><b>вес</b>: тело отклоняется от края, лапки стоят на месте;</li>
      <li><b>шаг</b>: сначала лапка у края, потом тело, потом вторая лапка — ничего не скользит;</li>
      <li><b>в середине</b> карточки момента нет; <b>мышкой</b> — не чаще раза в 20 с (кнопки — без паузы);</li>
      <li><b>Weniger</b>: сразу на безопасном месте, глаза ^ ^.</li></ul>
    <b>Сейчас</b><code class="fg-debug">—</code>
    <p style="margin:10px 0 0">Ползунок ниже останавливает кадр момента; полоса кадров — тот же момент крупно (${zoom}×), с пунктиром по верхней линии карточки.</p>`;
  row.append(phone, side);

  const bar = el('div', 'fg-bar');
  bar.innerHTML = '<span>Кадр момента</span>';
  const scrub = el('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(M.DURATION);
  scrub.step = '0.02';
  scrub.value = String(Math.min(M.DURATION, frozenT ?? 0.38));
  scrub.setAttribute('aria-label', 'Время внутри момента');
  const out = el('output');
  const live = el('button', undefined, '▶ Живьём');
  live.type = 'button';
  bar.append(scrub, out, live);

  const sheet = el('section', 'fg-sheet');
  const sheetTitle = el('h3');
  const sheetNote = el('p', undefined, 'Каждый кадр — настоящий дружок, остановленный в момент t (не скриншот). Пунктир — верхняя линия карточки: за краем она уходит вниз по скруглению.');
  const sheetHost = el('div');
  sheet.append(sheetTitle, sheetNote, sheetHost);

  section.append(controls, row, bar, sheet);
  app.append(section);
  const debug = side.querySelector<HTMLElement>('.fg-debug');

  let buddy: ListsBuddy | null = null;
  let fg: FirmGround | null = null;
  let lastEvent = '—';
  let state = '';
  let sheetCleanup: () => void = () => undefined;
  const paint = () => { if (debug) debug.textContent = `${state}\n${lastEvent}`; };
  const reduced = () => motionSel.value === 'force';
  const size = () => Number(sizeSel.value);
  const mark = () => placeButtons.forEach((b) => b.classList.toggle('on', b.dataset.at === at));

  const rebuildSheet = () => {
    sheetCleanup();
    sheetTitle.textContent = `Полоса кадров: «${PLACES[at].label}» — 0 … ${M.DURATION} с`;
    sheetCleanup = buildSheet(sheetHost, at, size(), zoom, nFrames, reduced(), guides);
  };

  const finger = (p: { x: number; y: number } | null) => {
    const f = phone.querySelector<HTMLElement>('.fg-finger');
    if (!f) return;
    if (p) f.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    f.classList.toggle('on', p !== null);
  };

  const showT = (t: number) => { out.value = `t = ${t.toFixed(2)} с`; };

  const freezeAt = (t: number) => {
    if (!fg) return;
    const id = FLOOR[PLACES[at].floor];
    const x = placeX(fg, id, at);
    if (x === null) return;
    const screen = phone.querySelector<HTMLElement>('.fg-screen');
    const f = fg.floor(id);
    if (screen && f) screen.scrollTop = Math.max(0, f.y - 420);
    fg.freeze(id, x, t);
    showT(t);
  };

  const drop = async (where: At) => {
    if (!fg) return;
    at = where;
    mark();
    rebuildSheet();
    const id = FLOOR[PLACES[at].floor];
    const screen = phone.querySelector<HTMLElement>('.fg-screen');
    const f = fg.floor(id);
    if (screen && f && screen.scrollTop > f.y - 300) screen.scrollTop = Math.max(0, f.y - 420);
    const x = placeX(fg, id, at);
    if (x === null) return;
    await fg.dropAt(id, x, { force: true, onFinger: finger });
  };

  const build = () => {
    fg?.detach();
    buddy?.destroy();
    phone.innerHTML = phoneMarkup();
    const content = phone.querySelector<HTMLElement>('.fg-content');
    const screen = phone.querySelector<HTMLElement>('.fg-screen');
    if (!content || !screen) return;
    buddy = new ListsBuddy({
      stage: content,
      scroller: screen,
      kind: 'bunny',
      width: size(),
      reducedMotion: motionSel.value as ReducedMotionMode,
      seed: Number(q.get('seed') ?? '') || undefined,
      autonomous: q.get('auto') !== '0' && frozenT === null,
      groundInset: 96,
      haptics: vibrate,
      onState: (s: BuddyInfo) => { state = `${s.action} · ${s.mode} · ${s.floor}`; paint(); },
      footing: true,
      onFooting: (e: FirmEvent) => { lastEvent = eventText(e); paint(); },
    });
    fg = new FirmGround(buddy);
    const w = window as unknown as { firmGround: FirmGround; listsBuddy: ListsBuddy };
    w.firmGround = fg;
    w.listsBuddy = buddy;
  };

  const start = () => {
    build();
    mark();
    rebuildSheet();
    if (frozenT !== null) {
      onFrame(() => { freezeAt(frozenT); phone.dataset.ready = '1'; });
    } else {
      showT(Number(scrub.value));
      phone.dataset.ready = '1';
      if (q.get('autoplay') !== '0') setTimeout(() => void drop(at), 900);
    }
  };

  for (const b of placeButtons) b.addEventListener('click', () => void drop(b.dataset.at as At));
  replay.addEventListener('click', () => void drop(at));
  live.addEventListener('click', () => void drop(at));
  scrub.addEventListener('input', () => freezeAt(Number(scrub.value)));
  sizeSel.addEventListener('change', () => { build(); rebuildSheet(); });
  motionSel.addEventListener('change', () => { buddy?.setReducedMotion(motionSel.value as ReducedMotionMode); rebuildSheet(); });
  // wait one frame so the phone has its layout (the floors are measured from it)
  onFrame(start);
  window.addEventListener('pagehide', () => { sheetCleanup(); fg?.detach(); buddy?.destroy(); }, { once: true });
}
