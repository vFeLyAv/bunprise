/**
 * Gallery page «Тапси хранит секреты» (26.10) on the mascot gallery (5180). 27.10: «Psst» and «Пылинка» are approved
 * and play in the app (their choreography lives in src/tapsi-moments.ts, this page uses it); «Сегодня» stays here. Three moments of the hamster, each in a mock of its real place at the
 * real size (the app's size m = 160 px):
 *   1 «Psst» — the end of the reservation moment (M17), «было / стало» side by side in the wish sheet;
 *   2 «Сегодня тот самый день» — over the occasion's card on its day;
 *   3 «Пылинка на линзе» — the empty «Freunde» card, on tap / Enter only.
 *
 *   ?screens=tapsi [&scene=psst|today|speck] [&t=1.2 (every stage frozen at 1.2 s)] [&reduced=1 (still poses)]
 *                  [&frames=1 (contact sheets open)] [&zoom=2 (contact-sheet cells at 2×)] [&coat=golden|cinnamon|…]
 *
 * Every stage is one timeline (stage.ts), so a frozen frame is the same every time. Design note (Russian, for
 * Felix): docs/design/2026-10-26-tapsi-moments.md.
 */

import type { HamsterCoat } from '../../src/index';
import { EZ, type Stage } from './stage';
import { SCENE_BOX, buildScene, type Built, type SceneId } from './scenes';

type TileId = 'psst' | 'today' | 'speck';

const CSS_TEXT = `
.tm { max-width: 980px; margin: 0 auto 32px; color: var(--text, #1D1D1F);
  --mascot-shadow: rgba(70,40,15,.20); --mascot-outline: rgba(224,171,116,.5); }
.tm h2 { margin: 6px 6px 4px; font-size: 24px; letter-spacing: -.01em; }
.tm > p { margin: 0 6px 14px; color: var(--text-2, #6E6E73); font-size: 14px; line-height: 1.5; max-width: 760px; }
.tm-tile { background: var(--card, rgba(255,255,255,.72)); border: 1px solid var(--card-border, rgba(255,255,255,.8)); border-radius: 30px;
  box-shadow: var(--shadow-card, 0 24px 60px rgba(70,45,20,.12)); padding: 18px 18px 16px; margin: 0 0 22px; }
.tm-tile h3 { margin: 2px 4px 4px; font-size: 20px; }
.tm-tile > p { margin: 0 4px 12px; font-size: 14px; line-height: 1.5; color: var(--text-2, #6E6E73); max-width: 760px; }
.tm-row { display: flex; flex-wrap: wrap; gap: 22px; justify-content: center; align-items: flex-start; }
.tm-row figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.tm-row figcaption { font: 600 13px/1.2 inherit; color: var(--text-2, #6E6E73); text-transform: uppercase; letter-spacing: .06em; }
.tm-bar { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; justify-content: center; margin: 14px 0 6px; font-size: 13px; color: var(--text-2, #6E6E73); }
.tm-bar button { appearance: none; border: 0; border-radius: 999px; padding: 9px 15px; font: 600 14px/1 inherit; cursor: pointer;
  background: rgba(0,0,0,.06); color: inherit; transition: transform .25s cubic-bezier(.34,1.56,.64,1); }
.tm-bar button.main { background: color-mix(in srgb, #F0A04B 24%, transparent); box-shadow: inset 0 0 0 1.5px #F0A04B; color: var(--text, #1D1D1F); }
.tm-bar button:active { transform: scale(.94); }
.tm-bar input[type=range] { width: 220px; accent-color: #F0A04B; }
.tm-bar output { min-width: 64px; font-variant-numeric: tabular-nums; color: var(--text, #1D1D1F); }
.tm-look { margin: 8px auto 4px; max-width: 760px; font-size: 13px; line-height: 1.5; color: var(--text-2, #6E6E73); padding-left: 20px; }
.tm-frames { margin: 10px 2px 0; }
.tm-frames summary { cursor: pointer; font: 600 14px/1.4 inherit; padding: 6px 4px; }
.tm-frames h4 { margin: 12px 4px 6px; font-size: 13px; font-weight: 600; color: var(--text-2, #6E6E73); }
.tm-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.tm-cell { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.tm-cell figcaption { font-size: 11px; color: var(--text-2, #6E6E73); font-variant-numeric: tabular-nums; }
.tm-crop { position: relative; overflow: hidden; border-radius: 12px; box-shadow: 0 0 0 1px rgba(60,40,20,.12); }
.tm-crop.sheet { background: #FFFDF8; }
.tm-crop.paper { background: #F2EBDD; }
.tm-crop.panel { background: #FBF6EE; }
.tm-crop + .tm-crop { margin-top: 4px; }
.tm-crop > .tm-box { position: absolute; }
.tm-tag { font-size: 10px; color: var(--text-2, #6E6E73); }

/* the app's surfaces (tokens.css "Paper", light) */
.tm-ui { font: 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; color: #2A231C; -webkit-font-smoothing: antialiased; }
.tm-box { position: relative; flex: none; }
.tm-sheet { position: relative; width: 362px; box-sizing: border-box; padding: 8px 14px 18px; border-radius: 34px; background: #FFFDF8;
  box-shadow: 0 18px 44px -18px rgba(70,45,20,.38), 0 2px 10px rgba(70,45,20,.06), inset 0 0 0 1px rgba(255,255,255,.9); }
.tm-grabber { display: block; width: 36px; height: 5px; border-radius: 3px; background: rgba(116,84,44,.17); margin: 0 auto 8px; }
.tm-sheet-head { display: flex; justify-content: space-between; align-items: center; min-height: 44px; padding: 0 6px; }
.tm-sheet-head b { font-size: 20px; letter-spacing: -.01em; }
.tm-sheet-head span { width: 30px; height: 30px; border-radius: 50%; background: rgba(116,84,44,.07); display: grid; place-items: center; color: #62554A; font-size: 17px; }
.tm-wish { display: flex; gap: 12px; align-items: center; padding: 6px 6px 0; }
.tm-wish i { width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg, #DCE7F5, #B9CBE6); flex: none; }
.tm-wish b { display: block; font-size: 17px; }
.tm-wish small { color: #62554A; font-size: 13px; }
.tm-actions { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 0 6px; }
.tm-actions .tm-box { margin-top: -118px; pointer-events: none; }
.tm-line { margin: 0; font-size: 17px; font-weight: 600; text-align: center; }
.tm-btn { display: grid; place-items: center; height: 50px; width: 100%; border-radius: 999px; background: rgba(116,84,44,.07); font-weight: 600; font-size: 16px; color: #2A231C; }
.tm-btn.primary { background: #EE9443; color: #2A1A0B; }
.tm-phone { position: relative; width: 390px; border-radius: 40px; overflow: hidden; background:
  radial-gradient(78% 36% at -4% -2%, rgba(255,193,146,.58), transparent 72%), radial-gradient(70% 34% at 104% 30%, rgba(248,180,170,.46), transparent 72%),
  linear-gradient(#F7F0E5, #F3EADC 55%, #F0E6D6); box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(60,40,20,.25); }
.tm-appbar { position: absolute; left: 0; right: 0; top: 0; height: 52px; display: flex; align-items: center; padding: 0 18px; font-weight: 600; color: #984A14; z-index: 1; }
.tm-card { box-sizing: border-box; padding: 16px 18px; border-radius: 26px; display: flex; flex-direction: column; gap: 4px;
  background: linear-gradient(100deg, rgba(248,180,170,.55), rgba(255,253,248,.92) 55%); box-shadow: 0 10px 24px -14px rgba(70,45,20,.3), 0 2px 8px rgba(70,45,20,.05), inset 0 0 0 1px rgba(255,255,255,.85); }
.tm-card b { font-size: 22px; letter-spacing: -.01em; }
.tm-today { color: #984A14; font-weight: 600; font-size: 14px; }
.tm-chips { display: flex; gap: 6px; margin-top: 6px; }
.tm-chips i { font-style: normal; font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 999px; background: rgba(116,84,44,.08); color: #62554A; }
.tm-below { padding: 4px 18px 26px; }
.tm-below h5 { margin: 0 0 10px; font-size: 17px; }
.tm-below i { display: block; height: 58px; border-radius: 18px; background: rgba(255,253,248,.7); margin-bottom: 10px; }
.tm-friends { padding: 64px 16px 22px; }
.tm-friends .tm-appbar { color: #2A231C; font-size: 17px; justify-content: center; }
.tm-panel { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 6px 16px 20px; border-radius: 28px; text-align: center;
  background: rgba(255,253,248,.78); box-shadow: 0 10px 24px -14px rgba(70,45,20,.3), inset 0 0 0 1px rgba(255,255,255,.85); }
.tm-panel h4 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: -.01em; text-wrap: balance; }
.tm-panel .tm-box { cursor: pointer; border-radius: 22px; outline-offset: 2px; }
.tm-panel .tm-box:focus-visible { outline: 3px solid #EE9443; }
.tm-panel small { color: #62554A; font-size: 13px; }
`;

const TITLES: Record<TileId, string> = {
  psst: '1 · «Psst» — Тапси запечатывает секрет',
  today: '2 · «Сегодня тот самый день» — Тапси отпускает звезду',
  speck: '3 · «Пылинка на линзе» — Тапси протирает бинокль',
};

const INTROS: Record<TileId, string> = {
  psst: 'Конец уже одобренной сцены брони (M17): Тапси съел звезду-желание. Было: звёзды в глазах, лапки вниз. Стало: после последнего жевка он прикрывает рот обеими лапками, глаза — довольные дуги ^ ^, голова чуть набок, маленький кивок, румянец чуть ярче — «Ich sag nix». Шторка желания у дарителя, после ответа сервера, рядом со строкой «Versteckt!».',
  today: 'В день праздника на странице повода (только у того, кто сам что-то забронировал): Тапси выглядывает из-за карточки с полными щеками — там с самой брони спрятана звезда. Он выпрыгивает пружинкой, смотрит на «Heute», радуется — два прыжка с хлопком лапок, — набирает воздуха (щёки ещё больше), «пфф!» — звезда вылетает с оборотом, его чуть отбрасывает, он провожает её взглядом, она мерцает и тает над карточкой.',
  speck: 'Пустая вкладка «Freunde»: Тапси с биноклем. Только по касанию (или Enter): опускает бинокль, моргает, одной лапкой дважды смахивает пылинку с линзы, по чистым линзам пробегает блик, глаза ^ ^ — и бинокль снова вверх с мягкой пружинкой. Лапок всё время две: одна держит бинокль, другая смахивает.',
};

const LOOK: Record<TileId, string[]> = {
  psst: [
    'лапки у рта читаются как «я молчу», а не «ой, испугался» (глаза закрыты дугами, голова набок, щёки полные);',
    'почти не длиннее: было 5,14 с, стало 5,65 с (+0,51 с) — звёзды в глазах в конце убраны;',
    'кадры 3,9–5,7 с в раскадровке: лапки идут к рту плавно, ничего не прыгает.',
  ],
  today: [
    'у каждого движения есть причина и отдача (Кирилл 26.10: «вылетает почти как в PowerPoint») — вдох перед «пфф!», отдача после;',
    'хлопки — лапки встречаются на верху каждого прыжка; звезда сначала вбок мимо щеки, потом вверх, быстро и с замедлением;',
    'искорка ровно одна; звезда тает (прозрачность и чуть больше размер), не «лопается»;',
    'низ Тапси спрятан за карточкой — как у кроликов, выглядывающих из-за края.',
  ],
  speck: [
    'всегда ровно две лапки (обычные лапки на животе спрятаны, пока он держит бинокль);',
    'пылинку видно в реальном размере (тёмная точка на правой линзе), она улетает с первым движением;',
    'играет только по касанию / Enter — это ответ, а не украшение. Нажми на Тапси.',
  ],
};

/** The frame a tile shows before anything is played: the new pose, the star in the air, the rest pose. */
const PREVIEW: Record<TileId, number> = { psst: 4.6, today: 2.1, speck: 0 };

const COATS: readonly HamsterCoat[] = ['golden', 'cinnamon', 'sable', 'dwarf', 'robo', 'spot'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmt = (t: number): string => `${t.toFixed(2).replace('.', ',')} с`;

/** A box of the scene's size (the scene builds itself inside). */
function sceneBox(id: SceneId): HTMLDivElement {
  const box = el('div', `tm-box tm-${id}`);
  box.style.width = `${SCENE_BOX[id].w}px`;
  box.style.height = `${SCENE_BOX[id].h}px`;
  return box;
}

/** The wish sheet's own beats on the same timeline: the line at 0.14 s, the way back at 0.26 s (GuestWishlist). */
function sheetBeats(line: HTMLElement, button: HTMLElement): (stage: Stage) => void {
  return (stage) => {
    for (const [node, at] of [[line, 0.14], [button, 0.26]] as const) {
      stage.track(node, { o: 0, y: 8 }, 'ui.rise').set(0.001, { o: 0, y: 8 }).move(at, at + 0.35, { y: 0, o: 1 }, EZ.smooth);
    }
  };
}

interface Player {
  stages: Built[];
  duration: number;
}

export function tapsiGallery(app: HTMLElement, q: URLSearchParams): void {
  const style = el('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);
  const reduced = q.get('reduced') === '1';
  const only = q.get('scene') as TileId | null;
  const frozen = q.has('t') ? Number(q.get('t')) : null;
  const zoom = Math.min(3, Math.max(1, Number(q.get('zoom') ?? 1) || 1));
  const coatQ = q.get('coat') as HamsterCoat | null;
  const coat = coatQ && COATS.includes(coatQ) ? coatQ : undefined;
  const built: Built[] = [];
  const opts = { reduced, ...(coat ? { coat } : {}) };
  // the page's life: leaving it tears everything down (also a contact sheet that is still being built); a page kept in
  // the back/forward cache stays as it is and comes back the same
  const life = new AbortController();
  const onHide = (e: Event): void => {
    if ((e as PageTransitionEvent).persisted) return;
    window.removeEventListener('pagehide', onHide);
    life.abort();
  };
  window.addEventListener('pagehide', onHide);

  const section = el('section', 'tm');
  section.innerHTML = `<h2>Тапси хранит секреты (26.10) — прототип</h2>
    <p>«Psst» и «Пылинка» одобрены и с 27.10 играют в приложении (тот же код из пакета); «Сегодня» — пока только здесь. Тапси — хранитель тайн: три его момента, каждый в макете своего
    места и в настоящем размере (как в приложении, 160 px). ▶ — проиграть; ползунок — любой кадр; «Раскадровка» — все кадры
    сразу. ${reduced ? '<b>Сейчас: «Weniger» (меньше движения) — неподвижные позы.</b>' : '<a href="?screens=tapsi&reduced=1">Как это выглядит при «Weniger»</a>.'}</p>`;
  app.append(section);

  const tiles: TileId[] = only && only in TITLES ? [only] : ['psst', 'today', 'speck'];
  for (const id of tiles) {
    const tile = el('article', 'tm-tile');
    tile.dataset['scene'] = id;
    tile.append(el('h3', undefined, TITLES[id]), el('p', undefined, INTROS[id]));
    const row = el('div', 'tm-row');
    tile.append(row);
    const player: Player = { stages: [], duration: 0 };
    if (id === 'psst') {
      for (const [variant, label] of [['before', 'было'], ['psst', 'стало']] as const) {
        const fig = el('figure');
        const sheet = el('div', 'tm-sheet tm-ui');
        sheet.innerHTML = '<i class="tm-grabber"></i><div class="tm-sheet-head"><b>Kabellose Kopfhörer</b><span>×</span></div><div class="tm-wish"><i></i><div><b>79,00 €</b><small>bei klangwerk.de</small></div></div>';
        const actions = el('div', 'tm-actions');
        const box = sceneBox(variant);
        const line = el('p', 'tm-line', 'Versteckt! Lena erfährt nichts.');
        const button = el('span', 'tm-btn', 'Reservierung aufheben');
        actions.append(box, line, button);
        sheet.append(actions);
        fig.append(el('figcaption', undefined, label), sheet);
        row.append(fig);
        const b = buildScene(variant, box, { ...opts, decorate: reduced ? undefined : sheetBeats(line, button) });
        built.push(b);
        player.stages.push(b);
      }
    } else if (id === 'today') {
      const phone = el('div', 'tm-phone tm-ui');
      phone.append(el('div', 'tm-appbar', '‹ Bald'));
      const box = sceneBox('today');
      const below = el('div', 'tm-below');
      below.innerHTML = '<h5>Lenas Wünsche</h5><i></i><i></i>';
      phone.append(box, below);
      row.append(phone);
      const b = buildScene('today', box, opts);
      built.push(b);
      player.stages.push(b);
    } else {
      const phone = el('div', 'tm-phone tm-friends tm-ui');
      phone.append(el('div', 'tm-appbar', 'Freunde'));
      const panel = el('div', 'tm-panel');
      const box = sceneBox('speck');
      box.tabIndex = 0;
      box.setAttribute('role', 'button');
      box.setAttribute('aria-label', 'Тапси: протереть бинокль');
      panel.append(box, el('h4', undefined, 'Folge Freunden, dann siehst du hier ihre Wünsche'), Object.assign(el('span', 'tm-btn primary'), { textContent: 'Deinen Link teilen' }));
      phone.append(panel);
      row.append(phone);
      const b = buildScene('speck', box, opts);
      built.push(b);
      player.stages.push(b);
      // on tap / Enter / Space only (one scene at a time: a tap while he is busy is ignored, like the puppet)
      const tapPlay = (): void => {
        if (!reduced && !b.stage.playing) void playAll([b]);
      };
      box.addEventListener('click', tapPlay);
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          tapPlay();
        }
      });
    }
    player.duration = Math.max(...player.stages.map((s) => s.duration));

    // controls: play, scrub, readout
    const bar = el('div', 'tm-bar');
    const out = el('output');
    const range = el('input');
    range.type = 'range';
    range.min = '0';
    range.step = '0.01';
    const stageEnd = Math.max(...player.stages.map((s) => (s.reduced ? 0 : s.stage.end)));
    range.max = String(Math.max(player.duration, Math.min(stageEnd, player.duration + 2.6)).toFixed(2));
    range.value = '0';
    const show = (t: number): void => {
      out.textContent = fmt(t);
      range.value = String(t);
    };
    let raf = 0;
    let runs = 0;
    const playAll = async (list: Built[]): Promise<void> => {
      cancelAnimationFrame(raf);
      // a newer run owns the readout: an older run that ends late must not stop its ticking
      const run = ++runs;
      for (const s of player.stages) s.stage.seek(0);
      const tick = (): void => {
        const first = list[0];
        if (first) show(first.stage.time);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      await Promise.all(list.map((s) => s.stage.play(0)));
      if (run === runs) cancelAnimationFrame(raf);
    };
    if (reduced) {
      bar.append(el('span', undefined, '«Weniger»: неподвижная поза, ни одной анимации.'));
    } else {
      const button = (label: string, list: Built[], main = false): void => {
        const btn = el('button', main ? 'main' : undefined, label);
        btn.type = 'button';
        btn.addEventListener('click', () => void playAll(list));
        bar.append(btn);
      };
      if (id === 'psst') {
        const [before, after] = player.stages;
        button('▶ Оба', player.stages, true);
        if (before) button('▶ Было', [before]);
        if (after) button('▶ Стало', [after]);
      } else {
        button(id === 'speck' ? '▶ Как касание' : '▶ Играть', player.stages, true);
      }
      range.addEventListener('input', () => {
        cancelAnimationFrame(raf);
        const t = Number(range.value);
        for (const s of player.stages) s.stage.seek(t);
        out.textContent = fmt(t);
      });
      const len = id === 'psst'
        ? `было ${fmt(player.stages[0]?.duration ?? 0)} · стало ${fmt(player.stages[1]?.duration ?? 0)}`
        : `длина ${fmt(player.duration)}`;
      bar.append(range, out, el('span', undefined, len));
      show(0);
    }
    tile.append(bar);
    const ul = el('ul', 'tm-look');
    for (const li of LOOK[id]) ul.append(el('li', undefined, li));
    tile.append(ul);
    if (!reduced) tile.append(framesBlock(id, opts, zoom, q.get('frames') === '1', life.signal));
    section.append(tile);

    // the tile opens on a telling frame (or on `&t=`); ▶ always plays from 0
    const first = frozen !== null && Number.isFinite(frozen) ? frozen : PREVIEW[id];
    if (!reduced) {
      for (const s of player.stages) s.stage.seek(first);
      show(first);
    }
  }

  life.signal.addEventListener('abort', () => {
    built.forEach((b) => b.destroy());
    built.length = 0;
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (q.get('frames') !== '1' || reduced) document.documentElement.dataset['ready'] = '1';
  }));
}

// ---- contact sheets ------------------------------------------------------------------------------------------

interface Strip {
  title: string;
  times: number[];
  /** which builds stand in one cell (top to bottom) */
  variants: SceneId[];
  /** the part of the scene box a cell shows (default SCENE_BOX[…].crop) */
  crop?: { x: number; y: number; w: number; h: number };
}

function range(t0: number, t1: number, step: number): number[] {
  const out: number[] = [];
  for (let t = t0; t <= t1 + 1e-6; t += step) out.push(Math.round(t * 100) / 100);
  return out;
}

const STRIPS: Record<TileId, Strip[]> = {
  psst: [
    { title: 'Новый конец: 3,8–5,8 с, шаг 0,1 с — в каждой ячейке сверху «было», снизу «стало»', times: range(3.8, 5.8, 0.1), variants: ['before', 'psst'], crop: { x: 82, y: 122, w: 170, h: 108 } },
    { title: '«Стало» целиком: 0–6 с, шаг 0,3 с (начало то же, что сейчас: впрыгивает, прыжок, звезда, 9 жевков)', times: range(0, 6, 0.3), variants: ['psst'] },
  ],
  today: [{ title: 'Весь момент: 0–3,0 с, шаг 0,1 с', times: range(0, 3.0, 0.1), variants: ['today'] }],
  speck: [{ title: 'Весь момент: 0–1,6 с, шаг 0,08 с', times: range(0, 1.6, 0.08), variants: ['speck'] }],
};

const CROP_BG: Record<SceneId, string> = { before: 'sheet', psst: 'sheet', today: 'paper', speck: 'panel' };

function framesBlock(id: TileId, opts: { reduced: boolean; coat?: HamsterCoat }, zoom: number, open: boolean, life: AbortSignal): HTMLDetailsElement {
  const details = el('details', 'tm-frames');
  details.append(el('summary', undefined, 'Раскадровка — все кадры (каждый кадр заморожен, одинаковый при каждом открытии)'));
  const holder = el('div');
  details.append(holder);
  const link = el('a', undefined, zoom === 1 ? 'крупнее (×2)' : 'в настоящем размере (×1)');
  link.href = `?screens=tapsi&scene=${id}&frames=1${zoom === 1 ? '&zoom=2' : ''}`;
  holder.append(el('span', 'tm-tag', zoom === 1 ? 'Ячейки — в настоящем размере, как на телефоне. ' : 'Ячейки увеличены в 2 раза. '), link);
  let made = false;
  const cells: Built[] = [];
  const make = async (): Promise<void> => {
    if (made || life.aborted) return;
    made = true;
    for (const strip of STRIPS[id]) {
      holder.append(el('h4', undefined, strip.title));
      const grid = el('div', 'tm-grid');
      holder.append(grid);
      for (let i = 0; i < strip.times.length; i++) {
        const t = strip.times[i] ?? 0;
        const fig = el('figure', 'tm-cell');
        for (const v of strip.variants) {
          const crop = strip.crop ?? SCENE_BOX[v].crop;
          const c = el('div', `tm-crop ${CROP_BG[v]} tm-ui`);
          c.style.width = `${crop.w}px`;
          c.style.height = `${crop.h}px`;
          if (zoom !== 1) c.style.setProperty('zoom', String(zoom));
          const box = sceneBox(v);
          box.style.left = `${-crop.x}px`;
          box.style.top = `${-crop.y}px`;
          c.append(box);
          fig.append(c);
          const b = buildScene(v, box, opts);
          b.stage.seek(t);
          cells.push(b);
        }
        fig.append(el('figcaption', undefined, fmt(t)));
        grid.append(fig);
        // a few cells per frame keep the page responsive while the sheet builds
        if (i % 6 === 5) await new Promise<void>((r) => requestAnimationFrame(() => r()));
        if (life.aborted) return;
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset['ready'] = '1'; }));
  };
  details.addEventListener('toggle', () => { if (details.open) void make(); });
  life.addEventListener('abort', () => cells.forEach((c) => c.destroy()));
  if (open) {
    details.open = true;
    void make();
  }
  return details;
}
