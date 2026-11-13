/**
 * «Живые анимации» (Felix 31.10: «…ну и новых живых анимаций») — GALLERY-ONLY prototype on the mascot gallery (5180).
 * Nothing of it is in the app (apps/web) or in the package (src/) until Felix approves it.
 *
 *   ?screens=alive [&theme=both|light|dark] [&reduced=1] [&anim=flop,groom,…] [&t=1.2] [&frames=8] [&size=120]
 *                  [&view=cards|live|frames|mix|frame] [&live=fast|app] [&seed=7] [&autoplay=0]
 *
 *   live    the three places of the app (Start card corner 96 px, an empty state 148 px, Tapsi on the Lists tile 96 px)
 *           playing the moments at random by the proposed mix (mix.ts), one at a time — fast (×12) or in app time
 *   cards   every moment at 148 and 96 px on a card edge, light and dark: ▶, tap a mascot, a scrub slider (&t= freezes
 *           all of them at that second)
 *   frames  frame strips (&frames=N evenly over each moment; the same keys as the animation, frozen, no animate())
 *   mix     the proposed mix as a table
 *   frame   one big frozen frame: &view=frame&anim=flop&t=1.2&size=400
 *
 * Design note: docs/design/2026-10-31-alive.md.
 */

import { freezeAt } from '../../src/drive';
import { setBunnyFur } from '../../src/fur';
import { AliveActor } from './actor';
import { FAST, LiveDirector, MIX, RULES } from './mix';
import { authorMove, MARK_RU, MOVE_IDS, MOVES, type MoveId, type MoveInfo } from './moves';
import { GEO, mountAlive, NEUTRAL, type AliveKind, type PartName, type Pose } from './rig';

type Theme = 'light' | 'dark';
const THEMES: ReadonlyArray<[Theme, string]> = [['light', 'Светлая'], ['dark', 'Тёмная']];

/** The app's page colours and mascot tokens (tokens.css; as on ?screens=binky / costumes). */
const THEME_VARS: Record<Theme, Record<string, string>> = {
  light: {
    '--al-bg': '#F2EBDD', '--al-card': '#FFFDF8', '--al-text': '#2A231C', '--al-text2': '#62554A', '--al-line': 'rgba(116,84,44,.15)',
    '--al-shadow': '0 6px 18px rgba(80,50,20,.09)', '--al-accent': '#EE9443',
    '--mascot-shadow': 'rgba(70,40,15,.20)', '--mascot-outline': 'rgba(224,171,116,.5)', '--alive-dust': 'rgba(196,160,118,.75)',
  },
  dark: {
    '--al-bg': '#17120F', '--al-card': '#2A221D', '--al-text': '#F5EDE3', '--al-text2': '#C3B5A6', '--al-line': 'rgba(255,230,205,.13)',
    '--al-shadow': '0 6px 18px rgba(0,0,0,.35)', '--al-accent': '#EE9443',
    '--mascot-shadow': 'rgba(0,0,0,.42)', '--mascot-outline': 'rgba(255,214,170,.2)', '--alive-dust': 'rgba(226,200,168,.55)',
  },
};

const CSS_TEXT = `
.app.al-page { max-width: none; padding: 20px 16px 48px; }
.al-page h1 { margin: 4px 6px; }
.al-page > p, .al-note { max-width: 1000px; margin: 4px 6px 12px; font-size: 14px; line-height: 1.5; color: var(--text-2); }
.al-page h2 { margin: 26px 6px 8px; font-size: 21px; }
.al-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 6px; font-size: 13px; color: var(--text-2); }
.al-bar b { font-weight: 600; min-width: 70px; }
.al-bar a, .al-bar button { border: 0; border-radius: 999px; padding: 6px 11px; font: 600 13px/1 inherit; font-family: inherit; background: var(--tile); color: var(--text); text-decoration: none; cursor: pointer; }
.al-bar a[aria-current="true"] { background: color-mix(in srgb, var(--accent-ui) 22%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent-ui); }
.al-panel { background: var(--al-bg); color: var(--al-text); border-radius: 22px; padding: 10px 12px 12px; box-shadow: 0 0 0 1px var(--al-line); }
.al-panel > h4 { margin: 0 2px 8px; font-size: 13px; color: var(--al-text2); font-weight: 600; }
.al-cell { position: relative; flex: none; overflow: visible; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.al-cell .al-edge { position: absolute; left: 6px; right: 6px; bottom: 0; border-radius: 16px 16px 0 0; background: var(--al-card); box-shadow: var(--al-shadow); }
.al-cell small { position: absolute; left: 4px; top: 2px; font-size: 11px; color: var(--al-text2); font-variant-numeric: tabular-nums; }
.al-cell em { position: absolute; right: 4px; top: 2px; font-size: 10.5px; font-style: normal; color: var(--al-text2); }
.al-cell .al-actor { z-index: 1; }
.al-row { display: flex; gap: 6px; align-items: flex-end; flex-wrap: wrap; }
.al-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 640px), 1fr)); gap: 16px; align-items: start; }
.al-move { background: var(--card); border: 1px solid var(--card-border); border-radius: 26px; padding: 12px 14px 14px; box-shadow: var(--shadow-card); }
.al-move header { display: flex; align-items: center; gap: 10px; }
.al-move h3 { margin: 0; font-size: 19px; flex: 1; }
.al-move h3 small { font-size: 13px; color: var(--text-2); font-weight: 500; }
.al-move .al-line { margin: 4px 2px 10px; font-size: 13.5px; line-height: 1.45; color: var(--text-2); }
.al-play { appearance: none; border: 0; border-radius: 999px; min-width: 44px; height: 44px; padding: 0 16px; font: 700 15px/1 inherit; font-family: inherit; cursor: pointer;
  background: color-mix(in srgb, var(--accent-ui) 26%, transparent); color: var(--text); }
.al-play:disabled { opacity: .45; cursor: default; }
.al-stages { display: flex; gap: 10px; flex-wrap: wrap; }
.al-scrub { display: flex; align-items: center; gap: 10px; margin: 10px 2px 0; font-size: 12.5px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.al-scrub input { flex: 1; accent-color: var(--accent-ui); }
/* live places */
.al-lives { display: flex; gap: 14px; flex-wrap: wrap; }
.al-live { display: flex; flex-direction: column; gap: 8px; }
.al-live-row { display: flex; gap: 12px; flex-wrap: wrap; }
.al-status { font-size: 13px; color: var(--al-text); min-height: 20px; }
.al-status i { font-style: normal; color: var(--al-text2); }
.al-scene { position: relative; width: 300px; flex: none; border-radius: 18px; background: var(--al-bg); box-shadow: inset 0 0 0 1px var(--al-line); overflow: hidden; }
.al-scene > b { position: absolute; left: 12px; top: 9px; font-size: 12px; color: var(--al-text2); font-weight: 600; }
.al-mcard { position: absolute; left: 14px; right: 14px; border-radius: 20px; background: var(--al-card); box-shadow: var(--al-shadow); overflow: hidden; }
.al-mcard .cover { height: 52px; background: radial-gradient(circle at 22% 30%, #FFD9A8 0 14px, transparent 15px), linear-gradient(135deg, #F6B474, #E77F55); }
[data-theme="dark"] .al-mcard .cover { filter: brightness(.82) saturate(.9); }
.al-mcard .txt { padding: 9px 12px 10px; font-size: 13px; line-height: 1.35; }
.al-mcard .txt span { display: block; color: var(--al-text2); font-size: 12px; }
.al-mcard.empty { text-align: center; padding: 18px 16px 16px; }
.al-mcard.empty b { display: block; font-size: 16px; margin: 4px 0 10px; }
.al-mcard.empty i { display: block; height: 38px; line-height: 38px; border-radius: 999px; background: var(--al-accent); color: #2A1A0B; font-style: normal; font-weight: 600; font-size: 14px; }
.al-tiles { position: absolute; left: 14px; right: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.al-tile { height: 66px; border-radius: 18px; background: var(--al-card); box-shadow: var(--al-shadow); padding: 10px 13px; box-sizing: border-box; }
.al-tile strong { display: block; font-size: 22px; line-height: 1.1; }
.al-tile span { font-size: 12px; color: var(--al-text2); }
.al-bar button.on { background: color-mix(in srgb, var(--accent-ui) 22%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent-ui); }
/* strips */
.al-strip { margin: 6px 0 16px; }
.al-strip > b { display: block; margin: 0 4px 6px; font-size: 14px; color: var(--al-text); }
.al-strip .al-row { gap: 4px; }
.al-strip .al-cell { cursor: default; border-radius: 12px; background: var(--al-bg); box-shadow: inset 0 0 0 1px var(--al-line); overflow: hidden; }
/* the mix table */
.al-mix { font-size: 13.5px; line-height: 1.45; max-width: 1100px; margin: 0 6px; }
.al-mix table { border-collapse: collapse; margin: 6px 0 12px; width: 100%; }
.al-mix td, .al-mix th { padding: 6px 9px; border-bottom: 1px solid var(--tile); text-align: left; vertical-align: top; }
.al-mix th { font-size: 12.5px; color: var(--text-2); font-weight: 600; }
.al-mix .w { font-variant-numeric: tabular-nums; white-space: nowrap; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function setVars(e: HTMLElement, vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) e.style.setProperty(k, v);
}

const sec = (s: number) => `${s.toFixed(2).replace(/0$/, '').replace('.', ',')} с`;
const who = (k: AliveKind) => (k === 'bunny' ? 'Помпон' : 'Тапси');

interface CellOpts {
  kind: AliveKind;
  size: number;
  reduced: boolean;
  idle: boolean;
  /** extra room around him (flop, stretch reach, periscope rise) */
  roomTop?: number;
  width?: number;
}

/** A cell = a bit of page with a card edge at the bottom; the mascot sits on the card's top edge. */
function cell(parent: HTMLElement, o: CellOpts): { cell: HTMLElement; actor: AliveActor } {
  const g = GEO[o.kind];
  const k = o.size / 400;
  const feet = g.feetY * k;
  const top = Math.round(o.roomTop ?? o.size * 0.3);
  const w = Math.round(o.width ?? o.size * 1.32);
  const edge = Math.round(o.size * 0.16);
  const c = el('div', 'al-cell');
  c.style.width = `${w}px`;
  c.style.height = `${Math.round(top + feet + edge)}px`;
  const e = el('div', 'al-edge');
  e.style.height = `${edge + 1}px`;
  c.append(e);
  parent.append(c);
  const actor = new AliveActor(c, { kind: o.kind, size: o.size, idle: o.idle, reduced: o.reduced });
  actor.rig.box.style.left = `${Math.round((w - o.size) / 2)}px`;
  actor.rig.box.style.top = `${top}px`;
  return { cell: c, actor };
}

function bar(parent: HTMLElement, q: URLSearchParams, label: string, key: string, opts: ReadonlyArray<readonly [string | null, string]>): void {
  const b = el('div', 'al-bar');
  b.append(el('b', undefined, label));
  const cur = q.get(key);
  for (const [v, text] of opts) {
    const u = new URL(location.href);
    if (v === null) u.searchParams.delete(key);
    else u.searchParams.set(key, v);
    u.searchParams.delete('t');
    const a = el('a', undefined, text);
    a.href = u.search;
    if (cur === v) a.setAttribute('aria-current', 'true');
    b.append(a);
  }
  parent.append(b);
}

// ------------------------------------------------------------------------------------------------ live

interface Live {
  setFast(fast: boolean): void;
  destroy(): void;
}

function livePanel(parent: HTMLElement, theme: Theme, o: { reduced: boolean; fast: boolean; seed: number; autoplay: boolean }): Live | null {
  const panel = el('div', 'al-panel al-live');
  setVars(panel, THEME_VARS[theme]);
  panel.dataset.theme = theme;
  panel.append(el('h4', undefined, `${THEMES.find(([t]) => t === theme)?.[1]} тема`));
  const status = el('div', 'al-status');
  panel.append(status);
  const row = el('div', 'al-live-row');
  panel.append(row);
  parent.append(panel);

  // Start: Pompon on the right corner of the first card (96 px)
  const start = el('div', 'al-scene');
  start.style.height = '196px';
  start.innerHTML = `<b>Start · угол карточки · 96 px</b><div class="al-mcard" style="top:86px"><div class="cover"></div><div class="txt">Spieleabend bei Lena<span>Sa., 1. Nov · 19:30 · 4 kommen</span></div></div>`;
  row.append(start);
  // an empty state: Pompon bigger, above the title (148 px)
  const empty = el('div', 'al-scene');
  empty.style.height = '262px';
  empty.innerHTML = `<b>Пустой экран · 148 px</b><div class="al-mcard empty" style="top:142px"><b>Noch keine Wünsche</b><i>Wunsch hinzufügen</i></div>`;
  row.append(empty);
  // Lists: Tapsi on the right stats tile (96 px)
  const lists = el('div', 'al-scene');
  lists.style.height = '196px';
  lists.innerHTML = `<b>Listen · Тапси на плашке · 96 px</b><div class="al-tiles" style="top:104px"><div class="al-tile"><strong>20</strong><span>Wünsche</span></div><div class="al-tile"><strong>4</strong><span>Mit dir geteilt</span></div></div>`;
  row.append(lists);

  const put = (scene: HTMLElement, kind: AliveKind, size: number, left: number, edgeTop: number): AliveActor => {
    const a = new AliveActor(scene, { kind, size, idle: true, reduced: o.reduced });
    a.rig.box.style.left = `${left}px`;
    a.rig.box.style.top = `${Math.round(edgeTop - a.rig.feet + 1)}px`;
    return a;
  };
  const pompon96 = put(start, 'bunny', 96, 300 - 14 - 96 - 6, 86);
  const pompon148 = put(empty, 'bunny', 148, (300 - 148) / 2, 142);
  const tapsi96 = put(lists, 'hamster', 96, 14 + (272 - 12) / 2 + 12 + ((272 - 12) / 2 - 96) / 2, 104);
  const actors = [pompon96, pompon148, tapsi96];

  if (o.reduced) {
    status.innerHTML = '<b>«Weniger» (reduced motion):</b> <i>ничего не играет — как в приложении (idle выключен), спокойная поза ^ ^</i>';
    return { setFast: () => undefined, destroy: () => actors.forEach((a) => a.destroy()) };
  }
  const log: string[] = [];
  const say = (text: string) => {
    log.unshift(text);
    log.length = Math.min(log.length, 4);
    status.innerHTML = `<b>сейчас:</b> ${log[0] ?? ''}${log.length > 1 ? ` <i>· до этого: ${log.slice(1).join(' · ')}</i>` : ''}`;
  };
  const director = new LiveDirector(panel, [
    { actor: pompon96, label: 'Start (96)' },
    { actor: pompon148, label: 'пустой экран (148)' },
    { actor: tapsi96, label: 'Listen, Тапси (96)' },
  ], { fast: o.fast, seed: o.seed, onPick: say });
  if (o.autoplay) {
    director.start();
    status.innerHTML = `<i>первое оживление через ${o.fast ? (RULES.firstAfterS / FAST).toFixed(1).replace('.', ',') : RULES.firstAfterS} с…</i>`;
  } else status.innerHTML = '<i>живой режим выключен (&autoplay=0)</i>';
  return {
    setFast: (f) => director.setFast(f),
    destroy: () => {
      director.destroy();
      actors.forEach((a) => a.destroy());
    },
  };
}

// ------------------------------------------------------------------------------------------------ cards

function roomFor(id: MoveId, size: number): { roomTop: number; width: number } {
  // periscope / post rise; the flop and the stretch reach sideways
  // (the flop and the stretch stay inside his own box: the same width for all)
  const top = id === 'periscope' || id === 'post' ? size * 0.36 : size * 0.26;
  return { roomTop: Math.round(top), width: Math.round(size * 1.28) };
}

function moveCard(parent: HTMLElement, m: MoveInfo, themes: readonly Theme[], o: { reduced: boolean; at: number | null }): void {
  const card = el('article', 'al-move');
  card.dataset.move = m.id;
  const head = el('header');
  const h = el('h3', undefined, m.ru);
  h.append(el('small', undefined, ` · ${m.de} · ${sec(m.duration)} · ${who(m.kind)}`));
  const play = el('button', 'al-play', '▶');
  play.type = 'button';
  play.setAttribute('aria-label', `${m.ru} abspielen`);
  head.append(h, play);
  card.append(head, el('p', 'al-line', m.line));
  const stages = el('div', 'al-stages');
  card.append(stages);
  const actors: AliveActor[] = [];
  for (const theme of themes) {
    const panel = el('div', 'al-panel');
    setVars(panel, THEME_VARS[theme]);
    panel.dataset.theme = theme;
    panel.append(el('h4', undefined, `${THEMES.find(([t]) => t === theme)?.[1]} · 148 / 96 px`));
    const row = el('div', 'al-row');
    panel.append(row);
    stages.append(panel);
    for (const size of [148, 96]) {
      const { cell: c, actor } = cell(row, { kind: m.kind, size, reduced: o.reduced, idle: true, ...roomFor(m.id, size) });
      c.append(el('small', undefined, `${size} px`));
      c.addEventListener('click', () => void actor.play(m.id));
      actors.push(actor);
    }
  }
  const scrub = el('label', 'al-scrub');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.max = String(m.duration);
  range.step = '0.01';
  range.value = String(o.at ?? 0);
  range.setAttribute('aria-label', `${m.ru}: кадр`);
  const out = el('span', undefined, o.at === null ? 'кадр: —' : `кадр: ${sec(Math.min(o.at, m.duration))}`);
  scrub.append('кадр', range, out);
  card.append(scrub);
  parent.append(card);

  if (o.reduced) {
    play.disabled = true;
    play.title = '«Weniger»: в приложении idle выключен — ничего не играет';
    range.disabled = true;
    out.textContent = '«Weniger»: спокойная поза, ничего не играет';
    return;
  }
  play.addEventListener('click', () => {
    out.textContent = 'кадр: —';
    actors.forEach((a) => void a.play(m.id));
  });
  range.addEventListener('input', () => {
    const t = Number(range.value);
    out.textContent = `кадр: ${sec(t)}`;
    actors.forEach((a) => a.freeze(m.id, t));
  });
  if (o.at !== null) {
    const at = o.at;
    actors.forEach((a) => a.freeze(m.id, at));
  }
}

// ------------------------------------------------------------------------------------------------ frames

/** One frozen frame (a static puppet: no idle, no animate(); the moment's tracks at t written inline). */
function frame(parent: HTMLElement, m: MoveInfo, t: number, size: number, label = true): void {
  const { roomTop, width } = roomFor(m.id, size);
  const g = GEO[m.kind];
  const k = size / 400;
  const edge = Math.round(size * 0.12);
  const c = el('div', 'al-cell');
  c.style.width = `${width}px`;
  c.style.height = `${Math.round(roomTop + g.feetY * k + edge)}px`;
  const e = el('div', 'al-edge');
  e.style.height = `${edge + 1}px`;
  c.append(e);
  parent.append(c);
  const rig = mountAlive(c, { kind: m.kind, size, idle: false });
  rig.box.style.left = `${Math.round((width - size) / 2)}px`;
  rig.box.style.top = `${roomTop}px`;
  const shot = authorMove(m.id, rig);
  rig.takeOver();
  rig.setExtras(shot.extras ?? []);
  const rest: Pose = {};
  for (const n of Object.keys(NEUTRAL) as PartName[]) if (rig.has(n)) rest[n] = NEUTRAL[n];
  rig.apply(rest);
  freezeAt(shot.tracks, t);
  if (!label) return;
  c.append(el('small', undefined, sec(t)));
  const mark = Object.entries(shot.marks).filter(([, at]) => at <= t + 1e-6).sort((a, b) => b[1] - a[1])[0];
  if (mark) c.append(el('em', undefined, MARK_RU[mark[0]] ?? mark[0]));
}

function strips(parent: HTMLElement, moves: readonly MoveInfo[], themes: readonly Theme[], frames: number, size: number): void {
  for (const theme of themes) {
    const panel = el('div', 'al-panel');
    setVars(panel, THEME_VARS[theme]);
    panel.dataset.theme = theme;
    panel.style.marginBottom = '12px';
    panel.append(el('h4', undefined, `${THEMES.find(([t]) => t === theme)?.[1]} · ${size} px · ${frames} кадров на анимацию`));
    parent.append(panel);
    for (const m of moves) {
      const s = el('div', 'al-strip');
      s.dataset.move = m.id;
      s.append(el('b', undefined, `${m.ru} · ${sec(m.duration)}`));
      const row = el('div', 'al-row');
      s.append(row);
      panel.append(s);
      for (let i = 0; i < frames; i++) frame(row, m, (m.duration * i) / Math.max(1, frames - 1), size);
    }
  }
}

// ------------------------------------------------------------------------------------------------ mix

function mixSection(parent: HTMLElement): void {
  const box = el('div', 'al-mix');
  const total = (k: AliveKind) => MIX.filter((m) => MOVES.find((x) => x.id === m.id)?.kind === k).reduce((s, m) => s + m.weight, 0);
  const row = (id: MoveId) => {
    const m = MIX.find((x) => x.id === id);
    const info = MOVES.find((x) => x.id === id);
    if (!m || !info) return '';
    const share = Math.round((m.weight / total(info.kind)) * 100);
    const tier = m.tier === 'common' ? 'обычное' : m.tier === 'calm' ? 'спокойное' : 'особое';
    return `<tr><td><b>${info.ru}</b></td><td class="w">${String(m.weight).replace('.', ',')} (≈ ${share} %)</td><td>${tier}</td><td>${m.when}</td><td>${m.at96}</td><td>${m.at148}</td></tr>`;
  };
  box.innerHTML = `
    <table>
      <tr><th>Анимация</th><th>Вес (доля)</th><th>Тип</th><th>Когда</th><th>96 px на краю карточки</th><th>148 px, картинка побольше</th></tr>
      <tr><td colspan="6"><b>Помпон</b></td></tr>
      ${['groom', 'sneeze', 'dig', 'periscope', 'loaf', 'stretch'].map((id) => row(id as MoveId)).join('')}
      <tr><td colspan="6"><b>Тапси</b> (дружок на «Списках»; с биноклем в «Freunde» — нет: лапки заняты)</td></tr>
      ${['hwash', 'post'].map((id) => row(id as MoveId)).join('')}
    </table>
    <p><b>Правила (предложение):</b> обычная жизнь куклы остаётся как есть (моргает, косится, качает ушком, шевелит носом; кролик сам
    нюхает раз в 16–26 с). Сверху — <b>одна</b> живая анимация за раз: первая через ${RULES.firstAfterS} с после открытия экрана, дальше каждые
    ${RULES.gapS[0]}–${RULES.gapS[1]} с (≤ 2 в минуту — внутри бюджета украшений «3 в минуту»), одна и та же два раза подряд — никогда.
    Спокойные (буханочка, потягушки) — только после ${RULES.calmAfterS} с без касаний. Флоп и сполз — в архиве (&amp;archive=1), не в миксе.
    Пока человек печатает или листает — ничего; вне экрана или в скрытой вкладке — пауза; «Weniger» — ни одной.
    На экране двигается только один маскот (арбитр stage.ts).</p>`;
  parent.append(box);
}

// ------------------------------------------------------------------------------------------------ the page

export function aliveGallery(app: HTMLElement, q: URLSearchParams): void {
  // Pompon's own look in the app (apps/web/src/features/mascot-ui/pompon.ts): the fluffy cheeks
  setBunnyFur({ fawn: ['cheeks'] });
  app.replaceChildren();
  app.classList.add('al-page');
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);

  const reduced = q.get('reduced') === '1';
  const askedTheme = q.get('theme');
  const themes: Theme[] = askedTheme === 'light' || askedTheme === 'dark' ? [askedTheme] : ['light', 'dark'];
  if (themes.length === 1 && themes[0] === 'dark') document.documentElement.dataset.theme = 'dark';
  const tParam = q.get('t');
  const at = tParam !== null && Number.isFinite(Number(tParam)) ? Math.max(0, Number(tParam)) : null;
  const frames = Math.max(2, Math.min(16, Number(q.get('frames')) || 8));
  const size = Math.max(64, Math.min(480, Number(q.get('size')) || 120));
  const onlyIds = (q.get('anim') ?? '').split(',').filter((x): x is MoveId => (MOVE_IDS as readonly string[]).includes(x));
  // the dropped flop and slump (31.10) only with &archive=1
  const shown = q.get('archive') === '1' ? MOVES : MOVES.filter((m) => !m.archived);
  const moves = onlyIds.length ? shown.filter((m) => onlyIds.includes(m.id)) : shown;
  const view = q.get('view');
  const show = (v: string) => !view || view === v;
  const fast = q.get('live') !== 'app';
  const seed = Number(q.get('seed')) || 7;
  const autoplay = q.get('autoplay') !== '0' && at === null;

  if (view === 'frame') {
    const m = moves[0] ?? MOVES[0];
    if (m) {
      const t = Math.min(at ?? 0, m.duration);
      for (const theme of themes) {
        const panel = el('div', 'al-panel');
        setVars(panel, THEME_VARS[theme]);
        panel.dataset.theme = theme;
        panel.style.display = 'inline-block';
        panel.style.margin = '0 10px 10px 0';
        panel.append(el('h4', undefined, `${m.ru} · t = ${sec(t)} · ${q.get('size') ?? 400} px`));
        app.append(panel);
        frame(panel, m, t, Math.max(64, Math.min(640, Number(q.get('size')) || 400)));
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset.ready = '1')));
    return;
  }

  app.append(el('h1', undefined, 'Живые анимации — прототип (31.10)'));
  const intro = el('p');
  intro.innerHTML = `<b>Только в галерее</b> — в приложении и в пакете ничего не меняется, пока ты не одобришь. Маленькие дела, которые Помпон и
    Тапси делают сами, без касания. Помпон: ${shown.filter((m) => m.kind === 'bunny').map((m) => m.ru).join(', ')}; Тапси:
    ${MOVES.filter((m) => m.kind === 'hamster').map((m) => m.ru.replace('Тапси ', '')).join(', ')}. Это <b>те же куклы</b>, что в приложении
    (у Помпона пушистые щёчки), только transform / opacity, каждая анимация — одна конечная временная шкала (кадр по времени всегда один и
    тот же). Сверху — «живой режим», как это смешивалось бы в приложении; ниже — каждая анимация отдельно (▶ или касание маскота), кадры и
    предложение микса.`;
  app.append(intro);
  bar(app, q, 'Тема', 'theme', [[null, 'Светлая + тёмная'], ['light', 'Светлая'], ['dark', 'Тёмная']]);
  bar(app, q, 'Движение', 'reduced', [[null, 'Полное'], ['1', 'Меньше (reduced)']]);
  bar(app, q, 'Раздел', 'view', [[null, 'Всё'], ['live', 'Живой режим'], ['cards', 'Анимации'], ['frames', 'Кадры'], ['mix', 'Микс']]);

  const lives: Live[] = [];
  if (show('live')) {
    app.append(el('h2', undefined, 'Живой режим — как в приложении'));
    const note = el('p', 'al-note');
    note.innerHTML = `Три места приложения. По одной анимации за раз, по весам микса (ниже), с паузой между ними. <b>Быстро</b> — время ×${FAST}
      (пауза 2,5–5 с вместо 30–60 с), <b>как в приложении</b> — настоящие паузы. Между анимациями куклы живут своей обычной жизнью (моргают,
      качают ушком; Помпон сам иногда нюхает).`;
    app.append(note);
    const speed = el('div', 'al-bar al-speed');
    const bFast = el('button', fast ? 'on' : '', `Быстро (×${FAST})`);
    const bApp = el('button', fast ? '' : 'on', 'Как в приложении (30–60 с)');
    for (const [b, f] of [[bFast, true], [bApp, false]] as const) {
      b.type = 'button';
      b.addEventListener('click', () => {
        bFast.classList.toggle('on', f);
        bApp.classList.toggle('on', !f);
        lives.forEach((l) => l.setFast(f));
      });
    }
    speed.append(bFast, bApp);
    app.append(speed);
    const wrap = el('div', 'al-lives');
    app.append(wrap);
    themes.forEach((theme, i) => {
      const l = livePanel(wrap, theme, { reduced, fast, seed: seed + i * 101, autoplay });
      if (l) lives.push(l);
    });
  }

  if (show('cards')) {
    app.append(el('h2', undefined, 'Каждая анимация — 148 и 96 px, светлая и тёмная'));
    const note = el('p', 'al-note');
    note.innerHTML = reduced
      ? '«Меньше движения»: ни одна анимация не играет (в приложении idle тогда выключен) — спокойная поза ^ ^.'
      : `▶ — сыграть во всех четырёх; касание маскота — только в нём; ползунок — любой кадр (то же даёт <code>&t=1.2</code> для всех сразу).
        Маскот сидит на верхнем крае карточки — как в приложении.`;
    app.append(note);
    const all = el('div', 'al-bar');
    if (!reduced) {
      const b = el('button', undefined, '▶ все сразу');
      b.type = 'button';
      b.addEventListener('click', () => document.querySelectorAll<HTMLButtonElement>('.al-move .al-play').forEach((x) => x.click()));
      all.append(b);
      app.append(all);
    }
    const grid = el('div', 'al-grid');
    app.append(grid);
    for (const m of moves) moveCard(grid, m, themes, { reduced, at });
  }

  if (show('frames')) {
    app.append(el('h2', undefined, 'Кадры'));
    app.append(el('p', 'al-note', `Каждая анимация — ${frames} кадров через равные промежутки (те же ключи, что у анимации, заморожены; число кадров: &frames=N, размер: &size=N).`));
    strips(app, moves, themes, frames, size);
  }

  if (show('mix')) {
    app.append(el('h2', undefined, 'Как смешать в приложении (предложение)'));
    mixSection(app);
  }

  (window as unknown as { alive: { lives: Live[] } }).alive = { lives };
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset.ready = '1')));
}
