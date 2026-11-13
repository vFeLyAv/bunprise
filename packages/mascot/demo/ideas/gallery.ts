/**
 * Gallery page "Ideen → Kategorien" (26.10, Felix: «во вкладку идеи именно как категории, типа Настольные игры …») —
 * a GALLERY-ONLY UI prototype on the mascot gallery (5180); the app gets nothing until Felix approves it.
 * Design note for Felix: docs/design/2026-10-26-ideas-categories.md; the games: docs/research/2026-10-26-board-games.md.
 *
 *   ?screens=ideas                 the screens, light and dark side by side, then all 24 game animations
 *     &theme=light|dark            only that theme
 *     &view=row|category|detail|anims|frames    only that part (for screenshots)
 *     &reduced=1                   reduced motion: no animation, the end pose at once; the carousel switches instantly
 *     &t=0.9                       the category screens frozen at 0.9 s of the die moment (deterministic: seek)
 *     &gt=0.8                      the opened game's animation frozen at 0.8 s
 *     &autoplay=0                  play nothing on load
 *     &players=two|four|party &time=short|mid|long &price=low|mid|high    start with a filter
 *     &game=<draft id>             the game opened in the detail screen (one of the ten cards)
 *     &slide=2                     the detail carousel on its photo
 *     &frames=10                   contact sheets: the die moment and the games in &anim (0 = none)
 *     &anim=hig-carcassonne,…      the games of the contact sheets (draft ids without "cat:")
 *     &tall=1                      the category screen without its own scrolling (the whole grid, for review)
 */

import { addCss, applyPageTheme, Driver, el, freezeAt, markReady, PAPER_CSS } from '../parade/kit';
import { ANIMS_CSS, animsGrid, contactSheet, mountScene, type Mounted } from './anims';
import { headerScene } from './art';
import { FILTER_STEPS, fits, GAMES, NO_FILTER, type Filters, type GameCard } from './games';
import { BEATS, openTracks } from './motion';
import { categoryPhone, ideasPhone, PHONE_CSS, type CategoryPhone, type Theme } from './phone';
import { PLAYS } from './plays';
import { ARCHETYPES } from './scenes';
import { gameSheetPhone, SHEET_CSS } from './sheet';

const PAGE_CSS = `
.ix-page { max-width: 1280px; margin: 0 auto; padding: 8px 16px 56px; box-sizing: border-box; color: var(--text); }
.ix-page > h2 { margin: 6px 0 4px; font-size: 24px; letter-spacing: -.02em; }
.ix-lead { margin: 0 0 8px; color: var(--text-2); font-size: 14px; max-width: 860px; line-height: 1.5; }
.ix-sec { margin-top: 30px; }
.ix-sec > h3 { margin: 0 0 4px; font-size: 19px; }
.ix-sec > p { margin: 0 0 14px; color: var(--text-2); font-size: 14px; max-width: 860px; line-height: 1.5; }
.ix-phones { display: flex; flex-wrap: wrap; gap: 40px 44px; align-items: flex-start; padding: 10px 10px 0; }
.ix-cap { margin: 14px 4px 0; font-size: 13px; color: var(--text-2); text-align: center; }
.ix-ctl { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 16px; }
.ix-scrub { display: inline-flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.ix-scrub input { width: 220px; accent-color: var(--accent-ui); }
.ix-sheetgrid { display: grid; grid-template-columns: repeat(auto-fill, 236px); gap: 12px; }
.ix-cell { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.ix-cell .bp-paper { width: 236px; border-radius: 16px; box-shadow: 0 0 0 1px rgba(60,40,20,.14); }
.ix-cell .ix-hero { border-radius: 0; box-shadow: none; }
.ix-cell small { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.ix-only .ix-phones { padding: 14px; gap: 40px; }
.ix-arch { margin: 0 0 14px; padding-left: 18px; font-size: 14px; line-height: 1.55; color: var(--text-2); max-width: 980px; }
.ix-arch b { color: var(--text); }
`;

const DEFAULT_GAME = 'cat:schmidt-quacksalber';
const DEFAULT_SHEETS = ['hig-carcassonne', 'dow-zug-um-zug', 'cge-codenames', 'cocktail-hanabi'];
const VIEWS = ['row', 'category', 'detail', 'anims', 'frames'] as const;
type View = (typeof VIEWS)[number];

function filtersFrom(q: URLSearchParams): Filters {
  const pick = <K extends keyof Filters>(key: K): Filters[K] => {
    const v = q.get(key);
    return (FILTER_STEPS[key] as readonly string[]).includes(v ?? '') ? (v as Filters[K]) : NO_FILTER[key];
  };
  return { players: pick('players'), time: pick('time'), price: pick('price') };
}

const num = (v: string | null): number | null => (v !== null && Number.isFinite(Number(v)) ? Number(v) : null);
const fullId = (id: string | null): string => (id ? (id.startsWith('cat:') ? id : `cat:${id}`) : '');

export function ideasGallery(app: HTMLElement, q: URLSearchParams): void {
  addCss('bp-paper-css', PAPER_CSS);
  addCss('ix-phone-css', PHONE_CSS);
  addCss('ix-anims-css', ANIMS_CSS);
  addCss('ix-sheet-css', SHEET_CSS);
  addCss('ix-page-css', PAGE_CSS);
  const asked = q.get('theme');
  const themes: Theme[] = asked === 'dark' ? ['dark'] : asked === 'light' ? ['light'] : ['light', 'dark'];
  applyPageTheme(themes.length === 1 && themes[0] === 'dark' ? 'dark' : 'light');
  let reduced = q.get('reduced') === '1';
  const frozen = num(q.get('t'));
  const gameAt = num(q.get('gt'));
  const autoplay = q.get('autoplay') !== '0';
  const view = q.get('view');
  const only: View | null = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : null;
  const shows = (part: View) => !only || only === part;
  const tall = q.get('tall') === '1';
  let filters = filtersFrom(q);
  let game: GameCard | undefined = GAMES.find((g) => g.id === fullId(q.get('game'))) ?? GAMES.find((g) => g.id === DEFAULT_GAME) ?? GAMES[0];
  const startSlide = q.get('slide') === '2' ? 1 : 0;

  const page = el('section', `ix-page${only ? ' ix-only' : ''}`);
  app.append(page);
  if (!only) {
    page.append(
      el('h2', undefined, '«Ideen» → категории: «Brettspiele»'),
      el('p', 'ix-lead', 'Только галерея (в приложение — после твоего «ок»). Во вкладке «Ideen» под колодой появляется ряд тем «Stöbern nach Thema» — у каждой свой рисунок. Тап по теме открывает её экран: шапка с рисунком (при открытии вкатывается кубик), три фильтра — игроки, время, цена — и сетка карточек. Тап по карточке — лист игры: сверху короткая анимация самой игры, свайп влево — настоящее фото коробки, ниже факты, «So wird gespielt», магазины и «Zur Wunschliste hinzufügen». Без партнёрских ссылок. Игры и цены — из черновика каталога (docs/research/2026-10-26-board-games…); 10 из них на экране темы, все 24 анимации — внизу.'),
    );
  }

  // ---------------------------------------------------------------------------------------- 1. the category row
  const secRow = el('div', 'ix-sec');
  const rowPhones = el('div', 'ix-phones');
  if (!only) {
    secRow.append(
      el('h3', undefined, '1 · Вкладка «Ideen»: ряд тем под колодой'),
      el('p', undefined, 'Колода остаётся главной и первой (первый экран не меняется). Ниже — горизонтальный ряд плиток, его видно, когда долистал до кнопок колоды. Плитки листаются вбок; тап — открывает тему (здесь — прокручивает к экрану «Brettspiele» и проигрывает момент).'),
    );
  }
  secRow.append(rowPhones);
  if (shows('row')) page.append(secRow);

  // ---------------------------------------------------------------------------------------- 2. the category screen
  const secCat = el('div', 'ix-sec');
  const ctl = el('div', 'ix-ctl');
  const playBtn = el('button', 'btn small', '▶ Ещё раз');
  const motionBtn = el('button', 'btn small', 'Меньше движения');
  const resetBtn = el('button', 'btn small', 'Сбросить фильтры');
  for (const b of [playBtn, motionBtn, resetBtn]) b.type = 'button';
  const scrub = el('label', 'ix-scrub');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.max = String(BEATS.end);
  range.step = '0.01';
  range.setAttribute('aria-label', 'Кадр');
  const out = el('span', undefined, '');
  scrub.append('Кадр', range, out);
  ctl.append(playBtn, motionBtn, resetBtn, scrub);
  const catPhones = el('div', 'ix-phones');
  if (!only) {
    secCat.append(
      el('h3', undefined, '2 · Экран темы «Brettspiele»'),
      el('p', undefined, `Момент при открытии (≈ ${BEATS.end.toFixed(1)} с, только transform / opacity, без петель): кубик вкатывается справа, трижды отскакивает (каждый раз другая грань) и ложится шестёркой; фишки на поле разом подпрыгивают, мелькает искорка; карточки поднимаются на место одна за другой. «Меньше движения» — сразу конечная поза, без анимации. Фильтры — нажимай пилюли (в прототипе каждое нажатие — следующий вариант; в приложении откроется маленький лист с вариантами). «＋» — на мою Wunschliste; тап по карточке открывает её внизу (экран 3).`),
      ctl,
    );
  }
  secCat.append(catPhones);
  if (shows('category')) page.append(secCat);

  // ---------------------------------------------------------------------------------------- 3. one game opened
  const secDetail = el('div', 'ix-sec');
  const detailCtl = el('div', 'ix-ctl');
  const replayBtn = el('button', 'btn small', '▶ Анимация игры ещё раз');
  const photoBtn = el('button', 'btn small', 'Фото ⇄ анимация');
  for (const b of [replayBtn, photoBtn]) b.type = 'button';
  detailCtl.append(replayBtn, photoBtn);
  const detailPhones = el('div', 'ix-phones');
  if (!only) {
    secDetail.append(
      el('h3', undefined, '3 · Игра открыта: анимация игры, фото, «So wird gespielt»'),
      el('p', undefined, 'Сверху маленькая карусель: слайд 1 — наша анимация самой игры (≤ 2 с, один раз при открытии), свайп влево (или стрелка, точки, ←/→) — слайд 2, настоящее фото коробки на белой «тарелке» с подписью «Bild: <Shop>», как у каталога. Нет хорошего фото — нет второго слайда и точек. Ниже — факты, наш текст, «So wird gespielt» (как играть, своими словами по официальным правилам), магазины и «Zur Wunschliste hinzufügen».'),
      detailCtl,
    );
  }
  secDetail.append(detailPhones);
  if (shows('detail')) page.append(secDetail);

  // ---------------------------------------------------------------------------------------- 4. all game animations
  const secAnims = el('div', 'ix-sec');
  if (!only) {
    const counts = new Map<string, string[]>();
    for (const [, p] of Object.entries(PLAYS)) counts.set(p.look.archetype, [...(counts.get(p.look.archetype) ?? []), p.name]);
    const list = el('ul', 'ix-arch');
    for (const [arch, names] of counts) {
      const a = ARCHETYPES[arch as keyof typeof ARCHETYPES];
      list.append(el('li', undefined, `<b>${a.ru}</b> (${a.de}): ${names.join(', ')}`));
    }
    secAnims.append(
      el('h3', undefined, '4 · Анимации всех 24 игр — 8 типов'),
      el('p', undefined, 'Чтобы хватило на любую игру, игры сгруппированы по тому, что в них делаешь; у каждого типа одна анимация, а у игры — свои цвета и детали. Здесь — конечные позы; нажми на плитку — проиграется (≤ 2 с, только transform / opacity). Маленькое фото в углу — что лежит на втором слайде. Под каждой — «So wird gespielt».'),
      list,
    );
  }
  if (shows('anims')) page.append(secAnims);

  // ---------------------------------------------------------------------------------------- 5. contact sheets
  const secSheet = el('div', 'ix-sec');
  const frames = Math.max(0, Math.min(24, Math.round(Number(q.get('frames') ?? 10))));
  if ((!only && frames > 0) || only === 'frames') page.append(secSheet);

  // ---------------------------------------------------------------------------------------- behaviour
  let cats: CategoryPhone[] = [];
  let drivers: Driver[] = [];
  let scenes: Mounted[] = [];
  let sheets: Array<ReturnType<typeof gameSheetPhone>> = [];
  let grid: Mounted[] = [];

  const show = () => {
    const d = drivers[0];
    const t = d ? d.time : reduced ? BEATS.end : 0;
    out.textContent = reduced ? 'меньше движения: конечная поза' : `${t.toFixed(2)} / ${BEATS.end.toFixed(2)} s`;
    range.value = String(t);
    range.disabled = reduced;
  };
  const tick = () => {
    show();
    if (drivers.some((d) => d.playing)) requestAnimationFrame(tick);
  };
  const play = () => {
    if (reduced) return;
    for (const d of drivers) {
      d.stop();
      d.play();
    }
    requestAnimationFrame(tick);
  };

  function setFilters(next: Filters): void {
    filters = next;
    for (const c of cats) c.setFilters(filters);
  }

  function cycle(key: keyof Filters): void {
    const steps = FILTER_STEPS[key] as readonly string[];
    const at = steps.indexOf(filters[key]);
    setFilters({ ...filters, [key]: steps[(at + 1) % steps.length] } as Filters);
  }

  /** The game sheet in every theme; its animation plays once (one after the other: one moment at a time). */
  function buildDetail(playNow: boolean, slide = 0): void {
    for (const s of scenes) s.destroy();
    scenes = [];
    sheets = [];
    detailPhones.textContent = '';
    if (!game) return;
    for (const theme of themes) {
      const behind = cats.find((c) => c.phone.dataset['theme'] === theme)?.phone ?? null;
      const box = el('div');
      const sheet = gameSheetPhone(theme, game, behind, { reduced, slide });
      box.append(sheet.phone);
      if (!only) box.append(el('p', 'ix-cap', theme === 'dark' ? 'Тёмная тема' : 'Светлая тема'));
      detailPhones.append(box);
      sheets.push(sheet);
      scenes.push(mountScene(sheet.stage, game.id, { reduced, at: gameAt }));
    }
    if (playNow && gameAt === null && !reduced) for (const s of scenes) s.play();
  }

  function buildCategory(at: number | null, autoplayNow: boolean): void {
    for (const d of drivers) d.destroy();
    drivers = [];
    cats = [];
    catPhones.textContent = '';
    for (const theme of themes) {
      const c = categoryPhone(theme, GAMES, fits, {
        onFilter: cycle,
        onCard: (g) => {
          game = g;
          buildDetail(true);
          if (!only) secDetail.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
        },
      }, tall);
      const box = el('div');
      box.append(c.phone);
      if (!only) box.append(el('p', 'ix-cap', theme === 'dark' ? 'Тёмная тема' : 'Светлая тема'));
      catPhones.append(box);
      cats.push(c);
      const tracks = openTracks(c.screen);
      if (reduced) freezeAt(tracks, BEATS.end);
      else drivers.push(new Driver(c.phone, tracks, BEATS.end, show));
    }
    setFilters(filters);
    if (reduced) show();
    else if (at !== null) {
      for (const d of drivers) d.seek(at);
      show();
    } else if (autoplayNow) play();
    else show();
  }

  function buildRow(): void {
    rowPhones.textContent = '';
    for (const theme of themes) {
      const box = el('div');
      box.append(
        ideasPhone(theme, (id) => {
          if (id !== 'brettspiele') return;
          if (!only) secCat.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
          play();
        }),
      );
      if (!only) box.append(el('p', 'ix-cap', theme === 'dark' ? 'Тёмная тема' : 'Светлая тема'));
      rowPhones.append(box);
    }
  }

  function buildAnims(): void {
    for (const m of grid) m.destroy();
    secAnims.querySelector('.ix-board')?.remove();
    const g = animsGrid(themes[0] ?? 'light', reduced, Object.keys(PLAYS));
    grid = g.mounted;
    secAnims.append(g.node);
  }

  /** Frozen frames (Track.styleAt, the same values seek() shows — no animation at all). */
  function buildSheets(): void {
    secSheet.textContent = '';
    if (frames === 0) return;
    if (only !== 'frames') {
      secSheet.append(el('h3', undefined, `5 · Кадры: момент «Кубик» · ${frames} шт. · 0–${BEATS.end.toFixed(2)} s`));
      const cells = el('div', 'ix-sheetgrid');
      secSheet.append(cells);
      for (let i = 0; i < frames; i++) {
        const t = frames === 1 ? BEATS.end : (BEATS.end * i) / (frames - 1);
        const cell = el('div', 'ix-cell');
        const tok = el('div', `bp-paper ix-tok${themes[0] === 'dark' ? ' dark' : ''}`);
        tok.append(el('div', 'ix-hero', headerScene()));
        cell.append(tok, el('small', undefined, `t = ${t.toFixed(2)} s`));
        cells.append(cell);
        freezeAt(openTracks(tok), t);
      }
    }
    const asked = (q.get('anim') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const ids = (asked.length ? asked : DEFAULT_SHEETS).map(fullId).filter((id) => PLAYS[id]);
    for (const id of ids) for (const theme of themes) secSheet.append(contactSheet(theme, id, frames));
  }

  playBtn.addEventListener('click', play);
  replayBtn.addEventListener('click', () => {
    for (const s of sheets) s.go(0);
    for (const s of scenes) s.play();
  });
  photoBtn.addEventListener('click', () => {
    for (const s of sheets) s.go(s.slide === 0 ? 1 : 0);
  });
  motionBtn.addEventListener('click', () => {
    reduced = !reduced;
    motionBtn.classList.toggle('on', reduced);
    buildCategory(null, true);
    buildDetail(true);
    if (shows('anims')) buildAnims();
  });
  resetBtn.addEventListener('click', () => setFilters(NO_FILTER));
  range.addEventListener('input', () => {
    for (const d of drivers) d.seek(Number(range.value));
    show();
  });

  motionBtn.classList.toggle('on', reduced);
  if (shows('row')) buildRow();
  buildCategory(frozen, autoplay && shows('category'));
  if (shows('detail')) buildDetail(autoplay && !shows('category'), startSlide);
  if (shows('anims')) buildAnims();
  if ((!only && frames > 0) || only === 'frames') buildSheets();
  markReady();
  window.addEventListener(
    'pagehide',
    () => {
      for (const d of drivers) d.destroy();
      for (const s of [...scenes, ...grid]) s.destroy();
    },
    { once: true },
  );
}
