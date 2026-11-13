/**
 * Gallery page «Комикс · Серия 1 · v2» (30.10, GALLERY-ONLY): the episode as ONE continuous vertical picture you
 * scroll through (strip.ts), phone width, scaled up as a whole on a wide screen. The roll down the slope follows the
 * scroll (rollProgress: the reader's eye line → the roll's time; transform / opacity only, one rAF per frame);
 * four small moments come alive once when they come into view; reduced motion: one still picture.
 *
 *   ?screens=story [&lang=ru] [&reduced=1] [&view=reader (inside a phone, like the app's full-screen sheet)]
 *   31.10: &ep=2 = episode 2 «Zweimal derselbe Schal» in the same manga style (manga2.ts);
 *   31.10: ?screens=story = v4, the black-and-white manga ribbon with one spot colour (manga.ts);
 *          &v=2 = the v2 strip (+ v3 frozen effects); &view=styles = the v3 style samples; &v=1 = the 7 panels of 26.10
 *   ?screens=story&v=1 — the 7 framed panels of 26.10, for comparison (gallery.ts)
 *   ?screens=story&view=styles [&lang=ru] — v3 (31.10): style samples A/B/C × 1/2/3 for Felix to pick (strip-styles.ts)
 *
 * Design note (Russian, for Felix): docs/design/2026-10-26-manga-episode-1.md, section «v2 (30.10)».
 */

// the v4 manga (episodes 1 + 2) and how a ribbon follows the scroll live in the package since 31.10
// (src/comic/: one source for the app's reader and this gallery)
import { MANGA_CSS, buildManga } from '../../src/comic/episode1';
import { buildManga2 } from '../../src/comic/episode2';
import { T2 } from '../../src/comic/texts';
import { driveStrip } from '../../src/comic/view';
import { WORLD_CSS } from './kit';
import { EPISODE_TITLE, type Lang } from './panels';
import { W, type Strip, buildStrip, rollProgress } from './strip';
import { LOC_STYLES, SH, STYLE_CSS, STYLE_NAMES, SW, type Sample, TEXT_STYLES, buildSample } from './strip-styles';

const CSS_TEXT = `
${WORLD_CSS}
.app.sp2-app { max-width: none; padding: 0 0 40px; }
${MANGA_CSS}
.sp2-frame.m4f { background: #FFFFFF; box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
.sp2-foot.m4f { background: #FFFFFF; }
.sp2-foot.m4f .soft { background: rgba(0,0,0,.06); color: #141414; }
.sp2-foot a.main { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; min-width: 220px; border-radius: 999px; font: 650 16px/1 inherit; text-decoration: none; background: #EE9443; color: #2A1A0B; }
.sp2-eps { display: inline-flex; gap: 4px; margin: 0 0 10px; padding: 3px; border-radius: 999px; background: rgba(0,0,0,.06); font-size: 13.5px; }
.sp2-eps a, .sp2-eps b { padding: 6px 12px; border-radius: 999px; color: inherit; text-decoration: none; min-height: 20px; }
.sp2-eps b { background: #FFFFFF; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.sp2-phone.m4f, .sp2-phone.m4f .sp2-scroll { background: #FFFFFF; color: #141414; }
.sp2-phone.m4f .sp2-top { background: linear-gradient(rgba(255,255,255,.95) 70%, rgba(255,255,255,0)); }
.sp2-phone.m4f .sp2-top small { color: #555555; }
.sp2-phone.m4f .sp2-close { background: rgba(0,0,0,.07); color: #141414; }
.sp2-phone.m4f .sp2-bar { background: rgba(0,0,0,.1); }
.sp2-phone.m4f .sp2-bar i { background: #F39A3D; }
${STYLE_CSS}
.app.sp3-app { max-width: none; padding: 0 0 40px; }
.sp3-head { max-width: 1240px; margin: 0 auto; padding: 18px 16px 8px; box-sizing: border-box; color: var(--text, #1D1D1F); }
.sp3-head h2 { margin: 0 0 6px; font-size: 22px; letter-spacing: -.015em; }
.sp3-head p, .sp3-head li { font-size: 13.5px; line-height: 1.5; color: var(--text-2, #6E6E73); }
.sp3-head p { margin: 0 0 8px; max-width: 900px; }
.sp3-head ul { margin: 0 0 10px; padding-left: 18px; }
.sp3-grid { display: grid; grid-template-columns: repeat(auto-fill, ${SW}px); justify-content: center; gap: 26px 24px; padding: 6px 0 0; }
.sp3-card { margin: 0; display: flex; flex-direction: column; gap: 8px; }
.sp3-card figcaption { font-size: 13px; line-height: 1.35; color: var(--text-2, #6E6E73); padding: 0 6px; }
.sp3-card figcaption b { display: inline-block; min-width: 30px; padding: 2px 8px; margin-right: 6px; border-radius: 999px; font-size: 14px; color: var(--text, #1D1D1F);
  background: color-mix(in srgb, #F0A04B 24%, transparent); box-shadow: inset 0 0 0 1.5px #F0A04B; text-align: center; }
.sp3-frame { position: relative; width: ${SW}px; height: ${SH}px; overflow: hidden; border-radius: 18px; background: #150F0C; box-shadow: 0 16px 40px -18px rgba(30,18,8,.55); }
@media (max-width: 420px) { .sp3-grid { grid-template-columns: 100%; } .sp3-frame { width: 100%; border-radius: 0; } }
.sp2-head { max-width: 560px; margin: 0 auto; padding: 18px 16px 14px; box-sizing: border-box; color: var(--text, #1D1D1F); }
.sp2-head h2 { margin: 0 0 6px; font-size: 22px; letter-spacing: -.015em; }
.sp2-head p { margin: 0 0 10px; font-size: 13.5px; line-height: 1.5; color: var(--text-2, #6E6E73); }
.sp2-links { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; }
.sp2-links a { color: #B65F1A; }
.sp2-col { width: 100%; max-width: 560px; margin: 0 auto; }
.sp2-frame { position: relative; overflow: hidden; background: #150F0C; }
.sp2-frame > .sp-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.sp2-world .sp2-title { position: absolute; z-index: 9; color: #FFE9C2; }
.sp2-world .sp2-title b { display: block; font-size: 33px; line-height: 1.05; font-weight: 900; font-style: italic; letter-spacing: -.01em;
  color: #FFC46B; -webkit-text-stroke: 6px #2A231C; paint-order: stroke fill; }
.sp2-world .sp2-title span { display: block; margin-top: 7px; font-size: 14.5px; font-weight: 650; color: #F1E2CC; letter-spacing: .01em; }
.sp2-world .sp2-end { position: absolute; z-index: 9; color: #F1E2CC; }
.sp2-world .sp2-end p { margin: 0 auto 6px; max-width: 300px; font-size: 15px; line-height: 1.3; font-weight: 600; }
.sp2-world .sp2-end b { font-size: 12.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #C3B5A6; }
.sp2-foot { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 18px 16px 30px; background: #150F0C; }
.sp2-foot button { appearance: none; border: 0; min-height: 48px; min-width: 220px; border-radius: 999px; font: 650 16px/1 inherit; cursor: pointer; }
.sp2-foot .main { background: #EE9443; color: #2A1A0B; }
.sp2-foot .main[disabled] { opacity: .55; cursor: default; }
.sp2-foot .soft { background: rgba(245,237,227,.1); color: #F5EDE3; }
.sp2-foot button:focus-visible, .sp2-close:focus-visible { outline: 3px solid #FFC46B; outline-offset: 2px; }

/* the phone: the app's full-screen sheet (the strip at 1 : 1) */
.app.sp2-only { max-width: none; display: flex; justify-content: center; padding: 30px 16px; }
.sp2-phone { position: relative; width: 390px; height: 780px; flex: none; border-radius: 44px; overflow: hidden; background: #150F0C; color: #F5EDE3;
  box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(40,25,10,.3); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif; }
.sp2-scroll { position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.sp2-scroll::-webkit-scrollbar { display: none; }
.sp2-scroll .sp2-col { max-width: none; padding-top: 0; }
.sp2-top { position: absolute; left: 0; right: 0; top: 0; z-index: 3; height: 84px; padding: 38px 12px 0 20px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between;
  background: linear-gradient(rgba(21,15,12,.92) 70%, rgba(21,15,12,0)); }

.sp2-top b { font-size: 15px; font-weight: 650; }
.sp2-top small { display: block; font-size: 12px; color: #C3B5A6; font-weight: 500; margin-top: 2px; }
.sp2-close { appearance: none; border: 0; width: 44px; height: 44px; border-radius: 50%; background: rgba(245,237,227,.12); color: #F5EDE3; font-size: 20px; cursor: pointer; }
.sp2-bar { position: absolute; left: 20px; right: 20px; top: 88px; height: 2px; border-radius: 2px; background: rgba(245,237,227,.12); z-index: 3; overflow: hidden; }
.sp2-bar i { display: block; height: 100%; background: #FFC46B; transform-origin: 0 50%; transform: scaleX(0); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The strip in a column: a frame of the scaled size with the world inside. */
interface Shown {
  strip: Strip;
  col: HTMLDivElement;
  frame: HTMLDivElement;
  k: number;
  fit(width: number): void;
}

function showStrip(lang: Lang, motion: boolean, version: 2 | 4 = 4, ep: 1 | 2 = 1): Shown {
  const col = el('div', 'sp2-col');
  const frame = el('div', `sp2-frame${version === 4 ? ' m4f' : ''}`);
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', ep === 2 ? `Pompon & Tapsi · ${T2.folge[lang]}` : `Pompon & Tapsi · Folge 1 · ${EPISODE_TITLE[lang]}`);
  const world = el('div');
  frame.append(world);
  col.append(frame);
  const strip = version === 4 ? (ep === 2 ? buildManga2 : buildManga)(world, lang, motion) : buildStrip(world, lang, motion);
  const shown: Shown = {
    strip,
    col,
    frame,
    k: 1,
    fit(width: number) {
      const k = Math.max(0.6, width / W);
      shown.k = k;
      frame.style.width = `${(W * k).toFixed(2)}px`;
      frame.style.height = `${(strip.world.h * k).toFixed(2)}px`;
      world.style.transform = `scale(${k.toFixed(4)})`;
    },
  };
  shown.fit(W);
  return shown;
}

/**
 * Drives the strip from a scroller: the roll follows the reader's eye line (one seek per animation frame, only
 * when it changed); a moment plays once when its part of the strip is in the middle of the view, or jumps to its
 * end when the reader is already past it.
 */
function drive(shown: Shown, scroller: Window | HTMLElement, signal: AbortSignal, onFrame?: (share: number) => void): void {
  // the package's driver (src/comic/view.ts), the same one the app's reader uses; the v2 strip rolls by rollProgress
  driveStrip(shown.strip, {
    frame: shown.frame,
    scale: () => shown.k,
    scroller,
    signal,
    rollAt: shown.strip.rollAt ?? rollProgress,
    ...(onFrame ? { onFrame: ({ share }: { share: number }) => onFrame(share) } : {}),
  });
}

export function stripGallery(app: HTMLElement, q: URLSearchParams): void {
  const style = el('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);
  const reduced = q.get('reduced') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lang: Lang = q.get('lang') === 'ru' ? 'ru' : 'de';
  /** 4 = the manga (default since 31.10), 2 = the continuous strip of 30.10 (+ the v3 effects) */
  const version: 2 | 4 = q.get('v') === '2' ? 2 : 4;
  const vq = version === 2 ? '&v=2' : '';
  /** the episode (manga only): 1 by default, &ep=2 the second one */
  const ep: 1 | 2 = version === 4 && q.get('ep') === '2' ? 2 : 1;
  const keep = `${lang === 'ru' ? '&lang=ru' : ''}${reduced ? '&reduced=1' : ''}${q.get('view') === 'reader' ? '&view=reader' : ''}`;
  /** «Серия 1 · Серия 2»: a small switch on top (manga only) */
  const epSwitch = (): HTMLElement => {
    const nav = el('nav', 'sp2-eps');
    nav.setAttribute('aria-label', lang === 'ru' ? 'Серии' : 'Folgen');
    for (const n of [1, 2] as const) {
      const label = lang === 'ru' ? `Серия ${n}` : `Folge ${n}`;
      if (n === ep) nav.append(el('b', undefined, label));
      else {
        const a = el('a', undefined, label);
        a.href = `?screens=story${n === 2 ? '&ep=2' : ''}${keep}`;
        nav.append(a);
      }
    }
    return nav;
  };
  const life = new AbortController();
  const shownAll: Shown[] = [];
  const onHide = (e: Event): void => {
    if ((e as PageTransitionEvent).persisted) return;
    window.removeEventListener('pagehide', onHide);
    life.abort();
  };
  window.addEventListener('pagehide', onHide);
  life.signal.addEventListener('abort', () => {
    shownAll.forEach((s) => s.strip.destroy());
    shownAll.length = 0;
  });

  const foot = (scrollTop: () => void): HTMLDivElement => {
    const f = el('div', `sp2-foot${version === 4 ? ' m4f' : ''}`);
    let next: HTMLElement;
    if (version === 4 && ep === 1) {
      // the end of episode 1 leads on to episode 2
      const a = el('a', 'main', lang === 'ru' ? 'Дальше: серия 2 →' : 'Weiter: Folge 2 →');
      a.href = `?screens=story&ep=2${keep}`;
      next = a;
    } else {
      const b = el('button', 'main', lang === 'ru' ? 'Следующая серия — скоро' : 'Nächste Folge – bald');
      b.type = 'button';
      b.disabled = true;
      next = b;
    }
    const again = el('button', 'soft', lang === 'ru' ? 'Сначала' : 'Von vorn');
    again.type = 'button';
    again.addEventListener('click', scrollTop);
    f.append(next, again);
    return f;
  };

  // ---- v3: the style samples (A/B/C × 1/2/3), still pictures for Felix to pick from ---------------------------------
  if (q.get('view') === 'styles') {
    app.classList.add('sp3-app');
    const samples: Sample[] = [];
    life.signal.addEventListener('abort', () => samples.forEach((x) => x.destroy()));
    const head = el('section', 'sp3-head');
    head.innerHTML = `<h2>Комикс · стили на выбор (v3)</h2>
      <p>Один и тот же кусок истории (нора Помпона → холм, где Мила отдаёт звезду Тапси) в трёх стилях мест и трёх стилях текста.
      Куклы везде одни и те же. Выбери одну букву и одну цифру (например «B2») — потом перерисую всю картинку в этом стиле.
      Реплика Милы «${lang === 'ru' ? 'Береги его, Тапси!' : 'Pass gut auf ihn auf, Tapsi!'}» — только для пробы (предложение: так передача ещё понятнее).</p>`;
    const ul = el('ul');
    for (const k of [...LOC_STYLES, ...TEXT_STYLES.map((n) => `${n}` as const)]) ul.append(el('li', undefined, STYLE_NAMES[k]));
    const links = el('div', 'sp2-links');
    const a1 = el('a', undefined, lang === 'ru' ? 'Тексты по-немецки' : 'Тексты по-русски');
    a1.href = `?screens=story&view=styles${lang === 'ru' ? '' : '&lang=ru'}`;
    const a2 = el('a', undefined, 'Назад к комиксу (v4, манга)');
    a2.href = `?screens=story${lang === 'ru' ? '&lang=ru' : ''}`;
    links.append(a1, a2);
    head.append(ul, links);
    const grid = el('div', 'sp3-grid');
    for (const loc of LOC_STYLES) {
      for (const text of TEXT_STYLES) {
        const card = el('figure', 'sp3-card');
        card.dataset['style'] = `${loc}${text}`;
        const cap = el('figcaption');
        cap.append(el('b', undefined, `${loc}${text}`), `${STYLE_NAMES[loc].split(':')[0]} + ${STYLE_NAMES[`${text}`].split(':')[0]}`);
        const frame = el('div', 'sp3-frame');
        frame.setAttribute('role', 'img');
        frame.setAttribute('aria-label', `Stilprobe ${loc}${text}`);
        const world = el('div');
        frame.append(world);
        samples.push(buildSample(world, loc, text, lang));
        card.append(cap, frame);
        grid.append(card);
      }
    }
    app.append(head, grid);
    ready();
    return;
  }

  // ---- inside a phone (the app's full-screen sheet) -----------------------------------------------------------------
  if (q.get('view') === 'reader') {
    app.classList.add('sp2-only');
    const phone = el('div', `sp2-phone${version === 4 ? ' m4f' : ''}`);
    const scroll = el('div', 'sp2-scroll');
    const shown = showStrip(lang, !reduced, version, ep);
    shownAll.push(shown);
    scroll.append(shown.col, foot(() => scroll.scrollTo({ top: 0 })));
    const top = el('div', 'sp2-top');
    const title = el('div');
    title.append(el('b', undefined, 'Pompon & Tapsi'), el('small', undefined, ep === 2 ? T2.folge[lang] : `Folge 1 · ${EPISODE_TITLE[lang]}`));
    const close = el('button', 'sp2-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', lang === 'ru' ? 'Закрыть' : 'Schließen');
    top.append(title, close);
    const bar = el('div', 'sp2-bar');
    const fill = el('i');
    bar.append(fill);
    phone.append(scroll, top, bar);
    app.append(phone);
    drive(shown, scroll, life.signal, (share) => { fill.style.transform = `scaleX(${share.toFixed(4)})`; });
    ready();
    return;
  }

  // ---- the page: notes for Felix, then the strip -------------------------------------------------------------------
  app.classList.add('sp2-app');
  const head = el('section', 'sp2-head');
  head.innerHTML = version === 4 && ep === 2
    ? `<h2>Комикс · Серия 2 «Zweimal derselbe Schal»</h2>
    <p>Откуда взялась тайная бронь: Помпон и Мила дарят Момо одинаковый шарф — а через год Тапси прячет выбранные желания в щёки,
    и у Момо список выглядит как всегда. Тот же стиль манги, один цвет — только звёзды и дверца 21.
    ${reduced ? '<b>Сейчас «Weniger»: всё неподвижно, история читается целиком.</b>' : ''} Только в галерее.</p>`
    : version === 4
    ? `<h2>Комикс · Серия 1 — v4: манга</h2>
    <p>Чёрно-белая манга (тушь и точечный растр) с одним цветом — оранжевым — только на звезде-желании, дверце 14 и «+1» с сердечком.
    Кадры разной формы на одной ленте сверху вниз; каждый кадр один раз «оживает», когда появляется; в высоком косом кадре Тапси катится <b>вместе с прокруткой</b>.
    ${reduced ? '<b>Сейчас «Weniger»: всё неподвижно, история читается целиком.</b>' : ''} Только в галерее.</p>`
    : `<h2>Комикс · Серия 1 — v2: одна длинная картинка (+ эффекты v3)</h2>
    <p>Листай вниз: сцены перетекают друг в друга без рамок. На склоне Тапси катится <b>вместе с прокруткой</b> (крутишь назад — катится назад).
    Мила — наша одобренная кукла с висячими ушками (белая с рыжими пятнами, цветочек на ушке).
    ${reduced ? '<b>Сейчас «Weniger»: всё неподвижно, история читается целиком.</b>' : ''} Только в галерее.</p>`;
  const links = el('div', 'sp2-links');
  const link = (href: string, text: string): void => {
    const a = el('a', undefined, text);
    a.href = href;
    links.append(a);
  };
  const eq = ep === 2 ? '&ep=2' : '';
  const base = `?screens=story${vq}${eq}${lang === 'ru' ? '&lang=ru' : ''}`;
  link(`?screens=story${vq}${eq}&lang=${lang === 'ru' ? 'de' : 'ru'}${reduced ? '&reduced=1' : ''}`, lang === 'ru' ? 'Тексты по-немецки' : 'Тексты по-русски');
  link(`${base}${reduced ? '' : '&reduced=1'}`, reduced ? 'С движением' : '«Weniger» (без движения)');
  link(`${base}&view=reader${reduced ? '&reduced=1' : ''}`, 'В телефоне (шторка)');
  link(`?screens=story&v=1${lang === 'ru' ? '&lang=ru' : ''}`, 'v1 (7 кадров) для сравнения');
  link(version === 4 ? `?screens=story&v=2${lang === 'ru' ? '&lang=ru' : ''}` : `?screens=story${lang === 'ru' ? '&lang=ru' : ''}`, version === 4 ? 'v2/v3: длинная цветная картинка' : 'v4: манга (новое)');
  link(`?screens=story&view=styles${lang === 'ru' ? '&lang=ru' : ''}`, 'Стили A/B/C × 1/2/3 (v3)');
  if (version === 4) head.prepend(epSwitch());
  head.append(links);
  const shown = showStrip(lang, !reduced, version, ep);
  shownAll.push(shown);
  const fitPage = (): void => shown.fit(Math.min(560, app.clientWidth || window.innerWidth || W));
  app.append(head, shown.col);
  shown.col.append(foot(() => shown.frame.scrollIntoView({ block: 'start' })));
  fitPage();
  window.addEventListener('resize', fitPage, { signal: life.signal });
  drive(shown, window, life.signal);
  ready();

  function ready(): void {
    requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset['ready'] = '1'; }));
  }
}
