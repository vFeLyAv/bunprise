/**
 * Gallery page «Комикс · Серия 1» (26.10) — a GALLERY-ONLY storyboard on the mascot gallery (5180); nothing of it is
 * in the app until Felix's OK. Episode 1 of the Pompon & Tapsi comic, drawn with the app's own puppets:
 *   - the contact sheet: every panel as a still image, with its German text, the Russian translation and a note;
 *   - a phone-sized reader: one panel per screen, vertical scroll with snap, a quiet counter, «Schließen»;
 *   - ONE panel that comes alive (EPISODE[i].alive): once, when the reader stops on it; ▶ and a slider on its card.
 *
 *   ?screens=story [&panel=1..7 (one panel large)] [&view=reader (only the phone)] [&reduced=1 (stills only)]
 *                  [&t=0.8 (the living panel frozen at 0.8 s)] [&lang=ru (texts in the panels in Russian)]
 *
 * Design note (Russian, for Felix): docs/design/2026-10-26-manga-episode-1.md. Plot: panels.ts.
 *
 * 30.10: this is v1, now at ?screens=story&v=1 (for comparison); ?screens=story without v = v2, the one continuous
 * strip (strip-gallery.ts, Felix 30.10: «слитная картинка, которая листается»).
 */

import { PH, PW, Panel, WORLD_CSS } from './kit';
import { EPISODE, EPISODE_TITLE, type Lang, type PanelDef } from './panels';
import { stripGallery } from './strip-gallery';

const CSS_TEXT = `
.sp-page { max-width: 1000px; margin: 0 auto 40px; color: var(--text, #1D1D1F); }
.sp-page h2 { margin: 6px 6px 4px; font-size: 26px; letter-spacing: -.015em; }
.sp-page > p, .sp-intro { margin: 0 6px 12px; color: var(--text-2, #6E6E73); font-size: 14px; line-height: 1.5; max-width: 780px; }
.sp-links { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0 6px 18px; font-size: 13px; }
.sp-links a { color: #B65F1A; }
.sp-block { background: var(--card, rgba(255,255,255,.72)); border: 1px solid var(--card-border, rgba(255,255,255,.8)); border-radius: 30px;
  box-shadow: var(--shadow-card, 0 24px 60px rgba(70,45,20,.12)); padding: 18px 18px 20px; margin: 0 0 22px; }
.sp-block h3 { margin: 2px 4px 4px; font-size: 20px; }
.sp-block > p { margin: 0 4px 14px; font-size: 14px; line-height: 1.5; color: var(--text-2, #6E6E73); max-width: 780px; }
.sp-sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 18px 16px; }
.sp-card { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.sp-card .sp-frame { align-self: center; }
.sp-num { display: flex; align-items: center; gap: 8px; font: 700 13px/1.2 inherit; letter-spacing: .04em; color: var(--text-2, #6E6E73); text-transform: uppercase; }
.sp-num .sp-badge { text-transform: none; letter-spacing: 0; font-weight: 650; font-size: 12px; padding: 3px 8px; border-radius: 999px;
  background: color-mix(in srgb, #F0A04B 22%, transparent); color: var(--text, #1D1D1F); box-shadow: inset 0 0 0 1px #F0A04B; }
.sp-texts { margin: 0; font-size: 13px; line-height: 1.45; }
.sp-texts dt { font-weight: 650; color: var(--text, #1D1D1F); }
.sp-texts dd { margin: 0 0 4px; color: var(--text-2, #6E6E73); }
.sp-texts .de { font-weight: 600; color: var(--text, #1D1D1F); }
.sp-note { margin: 0; font-size: 12.5px; line-height: 1.45; color: var(--text-2, #6E6E73); }
.sp-bar { display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; font-size: 13px; color: var(--text-2, #6E6E73); }
.sp-bar button { appearance: none; border: 0; border-radius: 999px; padding: 9px 15px; font: 600 14px/1 inherit; cursor: pointer;
  background: color-mix(in srgb, #F0A04B 24%, transparent); box-shadow: inset 0 0 0 1.5px #F0A04B; color: var(--text, #1D1D1F); }
.sp-bar input[type=range] { flex: 1 1 140px; accent-color: #F0A04B; }
.sp-bar output { min-width: 54px; font-variant-numeric: tabular-nums; color: var(--text, #1D1D1F); }
.sp-one { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; justify-content: center; }
.sp-one .sp-side { flex: 1 1 260px; max-width: 360px; display: flex; flex-direction: column; gap: 12px; }

/* a panel: the world scaled as a whole (kit.ts PW × PH) */
.sp-frame { position: relative; flex: none; overflow: hidden; border-radius: 10px; background: #17110E;
  box-shadow: 0 0 0 3px #F6EEDF, 0 0 0 4px rgba(42,35,28,.5), 0 14px 30px -12px rgba(30,18,8,.45); }
.sp-frame > .sp-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }

${WORLD_CSS}

/* the phone reader */
.sp-phone { position: relative; width: 390px; height: 780px; flex: none; border-radius: 44px; overflow: hidden; background: #120D0B; color: #F5EDE3;
  box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(40,25,10,.3); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif; }
.sp-reader-top { position: absolute; left: 0; right: 0; top: 0; z-index: 3; height: 92px; padding: 44px 14px 0 20px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between;
  background: linear-gradient(#120D0B 62%, rgba(18,13,11,0)); }
.sp-reader-top b { font-size: 15px; font-weight: 650; }
.sp-reader-top small { display: block; font-size: 12px; color: #C3B5A6; font-weight: 500; margin-top: 2px; }
.sp-reader-top .sp-right { display: flex; align-items: center; gap: 6px; }
.sp-count { font-size: 13px; color: #C3B5A6; font-variant-numeric: tabular-nums; min-width: 38px; text-align: right; }
.sp-close { appearance: none; border: 0; width: 44px; height: 44px; border-radius: 50%; background: rgba(245,237,227,.1); color: #F5EDE3; font-size: 20px; cursor: pointer; }
.sp-scroll { position: absolute; inset: 0; overflow-y: auto; scroll-snap-type: y mandatory; overscroll-behavior: contain; scrollbar-width: none; }
.sp-scroll::-webkit-scrollbar { display: none; }
.sp-page-p { height: 780px; box-sizing: border-box; padding: 92px 16px 28px; scroll-snap-align: start; scroll-snap-stop: always; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
.sp-page-p .sp-frame { box-shadow: 0 0 0 2px rgba(246,238,223,.85); }
.sp-hint { font-size: 12px; color: #918377; }
.sp-end { justify-content: center; text-align: center; gap: 12px; }
.sp-end h4 { margin: 0; font-size: 24px; letter-spacing: -.01em; }
.sp-end p { margin: 0; color: #C3B5A6; font-size: 15px; max-width: 28ch; }
.sp-end .sp-btn { appearance: none; border: 0; min-height: 50px; min-width: 220px; border-radius: 999px; font: 650 16px/1 inherit; cursor: pointer; }
.sp-end .sp-btn.main { background: #EE9443; color: #2A1A0B; }
.sp-end .sp-btn.soft { background: rgba(245,237,227,.1); color: #F5EDE3; }
.sp-end .sp-btn[disabled] { opacity: .55; cursor: default; }
.sp-reader-wrap { display: flex; flex-wrap: wrap; gap: 26px; align-items: flex-start; justify-content: center; }
.sp-reader-wrap ul { flex: 1 1 260px; max-width: 420px; margin: 0; padding-left: 18px; font-size: 13.5px; line-height: 1.55; color: var(--text-2, #6E6E73); }
.app.sp-only { max-width: none; display: flex; justify-content: center; padding: 30px 16px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmt = (t: number): string => `${t.toFixed(2).replace('.', ',')} с`;

interface Shown {
  def: PanelDef;
  panel: Panel;
}

/** One panel at `width` px: a frame of that size with the world scaled inside. */
function framePanel(def: PanelDef, width: number, lang: Lang): { frame: HTMLDivElement; panel: Panel } {
  const k = width / PW;
  const frame = el('div', 'sp-frame');
  frame.style.width = `${Math.round(width)}px`;
  frame.style.height = `${Math.round(PH * k)}px`;
  const world = el('div');
  frame.append(world);
  const panel = new Panel(world);
  world.style.transform = `scale(${k})`;
  frame.setAttribute('role', 'img');
  frame.setAttribute('aria-label', def.alt[lang]);
  def.build(panel, lang);
  return { frame, panel };
}

/** The texts of a panel for the contact sheet: German (as in the app) + Russian for Felix. */
function texts(def: PanelDef): HTMLDListElement {
  const dl = el('dl', 'sp-texts');
  if (!def.texts.length) {
    dl.append(el('dt', undefined, 'без слов'));
    return dl;
  }
  for (const t of def.texts) {
    const dd = el('dd');
    dd.append(el('span', 'de', t.de), ` — ${t.ru}`);
    dl.append(el('dt', undefined, t.kind), dd);
  }
  return dl;
}

/** ?screens=story: v2 (the continuous strip) by default, v1 (seven panels) with &v=1. */
export function storyGallery(app: HTMLElement, q: URLSearchParams): void {
  if (q.get('v') === '1') panelsGallery(app, q);
  else stripGallery(app, q);
}

function panelsGallery(app: HTMLElement, q: URLSearchParams): void {
  const style = el('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);
  const reduced = q.get('reduced') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lang: Lang = q.get('lang') === 'ru' ? 'ru' : 'de';
  const frozenQ = q.has('t') ? Number(q.get('t')) : null;
  const frozen = frozenQ !== null && Number.isFinite(frozenQ) ? Math.max(0, frozenQ) : null;
  const one = Number(q.get('panel'));
  const view = q.get('view');
  const shown: Shown[] = [];
  const life = new AbortController();
  const onHide = (e: Event): void => {
    if ((e as PageTransitionEvent).persisted) return;
    window.removeEventListener('pagehide', onHide);
    life.abort();
  };
  window.addEventListener('pagehide', onHide);
  life.signal.addEventListener('abort', () => {
    shown.forEach((s) => s.panel.destroy());
    shown.length = 0;
  });

  /**
   * A still panel is its still. The living panel: on the contact sheet its finished end pose (or `&t=`), in the
   * reader its first frame until it comes alive; under «Weniger» always the still end pose, without any animation.
   */
  const show = (def: PanelDef, width: number, from: 'start' | 'end' = 'end'): { frame: HTMLDivElement; panel: Panel } => {
    const made = framePanel(def, width, lang);
    shown.push({ def, panel: made.panel });
    if (def.alive && !reduced) made.panel.seek(frozen ?? (from === 'start' ? 0 : made.panel.end));
    else made.panel.still();
    return made;
  };

  const controls = (panel: Panel): HTMLDivElement => {
    const bar = el('div', 'sp-bar');
    if (reduced) {
      bar.append(el('span', undefined, '«Weniger»: неподвижный кадр (конечная поза), без анимации.'));
      return bar;
    }
    const btn = el('button', undefined, '▶ Оживить');
    btn.type = 'button';
    const range = el('input');
    range.type = 'range';
    range.min = '0';
    range.step = '0.01';
    range.max = panel.end.toFixed(2);
    const out = el('output');
    const showT = (t: number): void => {
      range.value = String(t);
      out.textContent = fmt(t);
    };
    // the frame the panel shows now (`&t=` or its end pose)
    showT(frozen ?? panel.end);
    let raf = 0;
    btn.addEventListener('click', () => {
      cancelAnimationFrame(raf);
      const tick = (): void => {
        showT(panel.time);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      void panel.play(0).then(() => {
        cancelAnimationFrame(raf);
        showT(panel.end);
      });
    });
    range.addEventListener('input', () => {
      cancelAnimationFrame(raf);
      const t = Number(range.value);
      panel.seek(t);
      out.textContent = fmt(t);
    });
    bar.append(btn, range, out);
    return bar;
  };

  // ---- one panel large -----------------------------------------------------------------------------------------
  const single = EPISODE.find((d) => d.n === one);
  if (single) {
    app.classList.add('sp-only');
    const wrap = el('div', 'sp-one');
    const width = Math.min(720, Math.max(320, Math.floor(((window.innerHeight || 1000) - 60) * (PW / PH))));
    const { frame, panel } = show(single, width);
    const side = el('div', 'sp-side');
    side.append(el('div', 'sp-num', `Кадр ${single.n} из ${EPISODE.length} · ${single.title}`), texts(single), el('p', 'sp-note', single.note));
    if (single.alive) side.append(controls(panel));
    wrap.append(frame, side);
    app.append(wrap);
    ready();
    return;
  }

  // ---- the reader only -------------------------------------------------------------------------------------------
  if (view === 'reader') {
    app.classList.add('sp-only');
    app.append(reader());
    ready();
    return;
  }

  // ---- the whole page --------------------------------------------------------------------------------------------
  const page = el('section', 'sp-page');
  page.innerHTML = `<h2>Комикс «Pompon &amp; Tapsi» · Серия 1 «${EPISODE_TITLE.de}» — раскадровка v1 (26.10)</h2>
    <p class="sp-intro">Только в галерее: в приложение попадёт после твоего «ок». Нарисовано нашими же куклами (те же Помпон и Тапси, что в приложении).
    ${EPISODE.length} кадров, каждый — законченная картинка. Один кадр (отмечен «оживает») показывает, как кадр «оживает» один раз на 1–2 с.
    Тексты в кадрах — настоящий текст (немецкий, как в приложении); ниже каждого кадра — русский перевод.
    ${reduced ? '<b>Сейчас «Weniger»: только неподвижные кадры.</b>' : ''}</p>`;
  const links = el('div', 'sp-links');
  const link = (href: string, text: string): void => {
    const a = el('a', undefined, text);
    a.href = href;
    links.append(a);
  };
  link('?screens=story', 'v2: одна длинная картинка (новое)');
  link('?screens=story&v=1&view=reader', 'Только телефон-читалка');
  EPISODE.forEach((d) => link(`?screens=story&v=1&panel=${d.n}`, `Кадр ${d.n} крупно`));
  link(`?screens=story&v=1${reduced ? '' : '&reduced=1'}`, reduced ? 'С движением' : '«Weniger» (без движения)');
  link(`?screens=story&v=1&lang=${lang === 'ru' ? 'de' : 'ru'}`, lang === 'ru' ? 'Тексты в кадрах: по-немецки' : 'Тексты в кадрах: по-русски');
  page.append(links);

  const sheetBlock = el('div', 'sp-block');
  sheetBlock.append(el('h3', undefined, 'Все кадры (контактный лист)'),
    el('p', undefined, 'Читается сверху вниз, слева направо. Под кадром: что там написано (немецкий → русский) и что видно.'));
  const sheet = el('div', 'sp-sheet');
  sheetBlock.append(sheet);
  for (const def of EPISODE) {
    const card = el('figure', 'sp-card');
    card.dataset['panel'] = String(def.n);
    const num = el('div', 'sp-num', `${def.n} · ${def.title}`);
    if (def.alive) num.append(el('span', 'sp-badge', 'оживает'));
    const { frame, panel } = show(def, 300);
    card.append(num, frame, texts(def), el('p', 'sp-note', def.note));
    if (def.alive) card.append(controls(panel));
    sheet.append(card);
  }
  page.append(sheetBlock);

  const readerBlock = el('div', 'sp-block');
  readerBlock.append(el('h3', undefined, 'Как это читается на телефоне'),
    el('p', undefined, 'Полноэкранная шторка: один кадр на экран, листаешь вверх (с «защёлкой»). Попробуй прокрутить колёсиком или пальцем.'));
  const rw = el('div', 'sp-reader-wrap');
  const ul = el('ul');
  for (const li of [
    'Один кадр на экран, листание с «защёлкой»; во время прокрутки ничего не двигается.',
    `Кадр ${EPISODE.find((d) => d.alive)?.n ?? '—'} «оживает» один раз, когда ты на нём остановился, и потом стоит. При «Weniger» — сразу конечная поза.`,
    'Скромный счётчик «3 / 7», видимая кнопка «Schließen», без автоперелистывания, без лайков и «стриков».',
    'В конце — «Nächste Folge» (пока «bald») и «Schließen». Приложение помнит последний кадр («Weiterlesen»).',
  ]) ul.append(el('li', undefined, li));
  rw.append(reader(), ul);
  readerBlock.append(rw);
  page.append(readerBlock);
  app.append(page);
  ready();

  // ---- the phone reader ------------------------------------------------------------------------------------------
  function reader(): HTMLDivElement {
    const phone = el('div', 'sp-phone');
    const top = el('div', 'sp-reader-top');
    const title = el('div');
    title.append(el('b', undefined, 'Pompon & Tapsi'), el('small', undefined, `Folge 1 · ${EPISODE_TITLE[lang]}`));
    const right = el('div', 'sp-right');
    const count = el('span', 'sp-count', `1 / ${EPISODE.length}`);
    const close = el('button', 'sp-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', lang === 'ru' ? 'Закрыть' : 'Schließen');
    right.append(count, close);
    top.append(title, right);
    const scroll = el('div', 'sp-scroll');
    const pages: HTMLElement[] = [];
    let living: { page: HTMLElement; panel: Panel; done: boolean } | null = null;
    for (const def of EPISODE) {
      const p = el('section', 'sp-page-p');
      // the living panel waits on its first frame (a finished picture too) until the reader stops on it
      const { frame, panel } = show(def, 358, 'start');
      p.append(frame);
      if (def.n === 1) p.append(el('span', 'sp-hint', lang === 'ru' ? 'Листай вверх ↑' : 'Nach oben wischen ↑'));
      scroll.append(p);
      pages.push(p);
      if (def.alive && !reduced) living = { page: p, panel, done: frozen !== null };
    }
    const end = el('section', 'sp-page-p sp-end');
    const next = el('button', 'sp-btn main', lang === 'ru' ? 'Следующая серия — скоро' : 'Nächste Folge – bald');
    next.type = 'button';
    next.disabled = true;
    const again = el('button', 'sp-btn soft', lang === 'ru' ? 'Сначала' : 'Von vorn');
    again.type = 'button';
    again.addEventListener('click', () => scroll.scrollTo({ top: 0 }));
    end.append(el('h4', undefined, lang === 'ru' ? 'Конец серии 1' : 'Ende von Folge 1'), el('p', undefined, EPISODE_TITLE.end[lang]), next, again);
    scroll.append(end);
    pages.push(end);
    phone.append(scroll, top);

    // the counter and the one living panel: only once the scroll has come to rest on a page (never while scrolling)
    let settle: ReturnType<typeof setTimeout> | null = null;
    const onRest = (): void => {
      const i = Math.round(scroll.scrollTop / Math.max(1, scroll.clientHeight));
      count.textContent = `${Math.min(i + 1, EPISODE.length)} / ${EPISODE.length}`;
      if (living && !living.done && pages[i] === living.page) {
        living.done = true;
        void living.panel.play(0);
      }
    };
    scroll.addEventListener('scroll', () => {
      if (settle !== null) clearTimeout(settle);
      settle = setTimeout(onRest, 140);
    }, { passive: true, signal: life.signal });
    life.signal.addEventListener('abort', () => { if (settle !== null) clearTimeout(settle); });
    return phone;
  }

  function ready(): void {
    requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset['ready'] = '1'; }));
  }
}
