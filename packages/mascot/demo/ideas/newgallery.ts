/**
 * Gallery page «Neue Spiele 30.10» — the 17 new game animations (newscenes.ts / newgames.ts), GALLERY-ONLY until
 * Felix approves them (http://localhost:5180/?screens=newgames). Every game: its name (RU + DE), its key, its group,
 * the end pose (= the game's picture) in light and dark; tap = it plays once (≤ 2 s). Below: the end poses in all five
 * themes of the app (Hell, Dunkel, Blau, Ozean, Schwarz) and frozen frames of a few scenes.
 *
 *   ?screens=newgames
 *     &theme=light|dark|navy|ocean|black|all   the themes of the cards (default: light + dark)
 *     &view=grid|themes|frames                 only that part (for screenshots)
 *     &only=sky-team,monopoly,…                only these games (key or the part after "cat:" / "new:")
 *     &reduced=1                               reduced motion: the end pose, no animation at all
 *     &gt=0.8                                  every card frozen at 0.8 s (deterministic: seek)
 *     &frames=6 &anim=monopoly,jenga           frozen frames of these games (0 = none)
 */

import type { Track } from '../../src/timeline';
import { addCss, applyPageTheme, Driver, el, freezeAt, markReady, PAPER_CSS } from '../parade/kit';
import { ANIMS_CSS } from './anims';
import { NEW_ARCHETYPES, NEW_GAMES, NEW_TONE, type NewGame } from './newgames';
import { newSceneFor } from './newscenes';
import { PHONE_CSS } from './phone';
import { ARCHETYPES, sceneSvg, type Archetype } from './scenes';

export type NgTheme = 'light' | 'dark' | 'navy' | 'ocean' | 'black';
export const NG_THEMES: ReadonlyArray<[NgTheme, string]> = [['light', 'Светлая'], ['dark', 'Тёмная'], ['navy', 'Blau'], ['ocean', 'Ozean'], ['black', 'Schwarz']];

/** The surface around a stage per theme (tokens.css / navy.css / ocean.css / black.css: --surface); the tiles are the dark ones in every dark theme, like in the app. */
const NG_CSS = `
.ng-page { max-width: 1320px; margin: 0 auto; padding: 8px 16px 56px; box-sizing: border-box; color: var(--text); }
.ng-page > h2 { margin: 6px 0 4px; font-size: 24px; letter-spacing: -.02em; }
.ng-lead { margin: 0 0 10px; color: var(--text-2); font-size: 14px; max-width: 900px; line-height: 1.5; }
.ng-sec { margin-top: 26px; }
.ng-sec > h3 { margin: 0 0 4px; font-size: 19px; }
.ng-sec > p { margin: 0 0 12px; color: var(--text-2); font-size: 14px; max-width: 900px; line-height: 1.5; }
.ng-ctl { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0 6px; font-size: 13px; }
.ng-ctl a { color: inherit; padding: 6px 10px; border-radius: 999px; background: rgba(240,160,75,.14); text-decoration: none; }
.ng-ctl a.on { background: #EE9443; color: #fff; }
.ng-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr)); gap: 14px; }
.ng-card { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 22px; background: var(--surface, #FFFDF8); box-shadow: 0 1px 2px rgba(80,50,22,.06), 0 6px 18px -10px rgba(92,56,24,.28); }
.ng-card b { font-size: 16px; line-height: 20px; }
.ng-card .de { font-size: 13px; color: var(--text-2); }
.ng-card code { font-size: 11.5px; padding: 1px 6px; border-radius: 6px; background: rgba(116,84,44,.09); }
.ng-card .grp { font-size: 12px; color: var(--text-2); }
.ng-card .line { margin: 2px 0 0; font-size: 13px; line-height: 18px; }
.ng-card .prov { font-size: 11px; font-weight: 700; color: #984A14; background: #FCE5C9; border-radius: 6px; padding: 1px 6px; margin-left: 6px; }
.ng-stages { display: grid; grid-template-columns: repeat(var(--n, 2), 1fr); gap: 8px; }
.ng-frame { border: 0; margin: 0; padding: 6px; border-radius: 18px; background: var(--ng-surface); cursor: pointer; display: flex; flex-direction: column; gap: 4px; font: inherit; }
.ng-frame:focus-visible { outline: 3px solid #EE9443; outline-offset: 2px; }
.ng-frame small { font-size: 11px; color: var(--ng-ink); text-align: left; padding-left: 4px; }
.ng-frame.light { --ng-surface: #F2EBDD; --ng-ink: #62554A; }
.ng-frame.dark { --ng-surface: #17120F; --ng-ink: #C3B5A6; }
.ng-frame.navy { --ng-surface: #0F1526; --ng-ink: #AEB9CF; }
.ng-frame.ocean { --ng-surface: #111418; --ng-ink: #AAB4C2; }
.ng-frame.black { --ng-surface: #000; --ng-ink: #B0B0B8; }
.ng-themes { display: grid; grid-template-columns: 170px repeat(5, minmax(0, 1fr)); gap: 6px 8px; align-items: center; }
.ng-themes > span { font-size: 13px; line-height: 16px; }
.ng-themes > i { font-style: normal; font-size: 12px; color: var(--text-2); }
.ng-themes .ng-frame { cursor: default; padding: 4px; border-radius: 12px; }
.ng-themes .ix-stage { border-radius: 9px; }
.ng-frames { display: grid; grid-template-columns: repeat(auto-fill, 180px); gap: 8px; margin-bottom: 14px; }
.ng-frames figure { margin: 0; display: flex; flex-direction: column; gap: 3px; align-items: center; }
.ng-frames figcaption { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.ng-frames .ng-frame { width: 180px; box-sizing: border-box; cursor: default; }
`;

interface Mounted {
  play(): void;
  destroy(): void;
}

function groupLabel(g: NewGame): string {
  const a = g.archetype in NEW_ARCHETYPES ? NEW_ARCHETYPES[g.archetype as keyof typeof NEW_ARCHETYPES] : ARCHETYPES[g.archetype as Archetype];
  const isNew = g.archetype in NEW_ARCHETYPES;
  return `${a.ru} · ${a.de}${isNew ? ' (новая группа)' : ''} — вариант «${g.variant}»`;
}

/** A stage of one game in one theme (the token classes + the archetype's tile tint). */
function stageIn(theme: NgTheme, game: NewGame, tag: 'button' | 'div' = 'div'): { frame: HTMLElement; stage: HTMLElement } {
  const frame = el(tag, `ng-frame ix-tok ${theme}${theme === 'light' ? '' : ' dark'}`);
  const stage = el('div', 'ix-stage');
  stage.style.setProperty('--tile-bg', `var(--tile-${NEW_TONE[game.archetype]})`);
  frame.append(stage);
  return { frame, stage };
}

function mount(stage: HTMLElement, game: NewGame, opts: { reduced: boolean; at: number | null }): Mounted {
  const scene = newSceneFor(game.variant);
  stage.innerHTML = sceneSvg(scene, game.de);
  const tracks: Track[] = scene.tracks(stage);
  let driver: Driver | null = null;
  const ensure = () => (driver ??= new Driver(stage, tracks, scene.duration));
  if (opts.reduced || opts.at === null) freezeAt(tracks, scene.duration);
  else ensure().seek(opts.at);
  return {
    play() {
      if (opts.reduced) return;
      const d = ensure();
      d.stop();
      d.play();
    },
    destroy() {
      driver?.destroy();
    },
  };
}

/** "cat:kosmos-sky-team" is asked for as itself, "kosmos-sky-team" or "sky-team"; "cat:hasbro-monopoly" as "monopoly". */
const matches = (g: NewGame, v: string) => g.key === v || g.key.endsWith(`:${v}`) || g.key.endsWith(`-${v}`);

export function newGamesGallery(app: HTMLElement, q: URLSearchParams): void {
  addCss('bp-paper-css', PAPER_CSS);
  addCss('ix-phone-css', PHONE_CSS);
  addCss('ix-anims-css', ANIMS_CSS);
  addCss('ng-css', NG_CSS);
  const askedTheme = q.get('theme');
  const themes: NgTheme[] =
    askedTheme === 'all' ? NG_THEMES.map(([t]) => t) : NG_THEMES.some(([t]) => t === askedTheme) ? [askedTheme as NgTheme] : ['light', 'dark'];
  applyPageTheme(themes.length === 1 && themes[0] !== 'light' ? 'dark' : 'light');
  const reduced = q.get('reduced') === '1';
  const gtRaw = q.get('gt');
  const frozenAt = gtRaw !== null && Number.isFinite(Number(gtRaw)) ? Number(gtRaw) : null;
  const view = q.get('view');
  const shows = (part: 'grid' | 'themes' | 'frames') => !view || view === part;
  const onlyList = (q.get('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const games = onlyList.length ? NEW_GAMES.filter((g) => onlyList.some((v) => matches(g, v))) : NEW_GAMES;

  const page = el('section', 'ng-page');
  app.append(page);
  const mounted: Mounted[] = [];

  if (!view) {
    const base = `?screens=newgames${reduced ? '&reduced=1' : ''}`;
    const ctl = el('div', 'ng-ctl');
    const playAll = el('button', 'btn small', '▶ Проиграть все');
    playAll.type = 'button';
    playAll.addEventListener('click', () => {
      for (const m of mounted) m.play();
    });
    ctl.append(playAll);
    const links: Array<[string, string, boolean]> = [
      ['Светлая + тёмная', base, !askedTheme],
      ...NG_THEMES.map(([t, label]): [string, string, boolean] => [label, `${base}&theme=${t}`, askedTheme === t]),
      ['Все 5 тем', `${base}&theme=all`, askedTheme === 'all'],
      [reduced ? 'Движение: обычное' : 'Меньше движения', reduced ? '?screens=newgames' : '?screens=newgames&reduced=1', false],
    ];
    for (const [label, href, on] of links) {
      const a = el('a', on ? 'on' : undefined, label);
      a.href = href;
      ctl.append(a);
    }
    page.append(
      el('h2', undefined, '«Neue Spiele 30.10» — 17 новых анимаций игр'),
      el('p', 'ng-lead', 'Кирилл одобрил 30.10 (после «Монополию сделай в виде законченного круга»): сцены перенесены в приложение (apps/web/src/features/gifts/plays/newscenes.ts — копия этого файла; меняем сначала здесь). Каждая анимация ≤ 2 с, играет один раз (только transform / opacity), её последний кадр — это «картинка» игры (её же видно при «Меньше движения»). Наши плоские рисунки в палитре подарков: они напоминают игру, но не копируют коробку, логотип или фирменные надписи. <b>Нажми на картинку — проиграется.</b> 15 игр есть в каталоге (ключ = id каталога) и уже в приложении; Jenga и Scrabble в каталог не попали (у издателей нет числа игроков / времени) — их сцены пока только здесь, с временным ключом <code>new:…</code>.'),
      ctl,
    );
  }

  // ---------------------------------------------------------------------------------------- 1. the cards
  if (shows('grid')) {
    const groups: Array<[string, string, readonly NewGame[]]> = [
      ['1 · Kosmos (7) — в каталоге и в приложении', 'Ключ — id из каталога (workers/edge/src/giftIdeas/catalog.de.json).', games.filter((g) => g.key.startsWith('cat:kosmos-'))],
      ['2 · Культовые игры (10) — 8 в каталоге и в приложении, Jenga и Scrabble только здесь', 'Без логотипов и фирменной графики — только узнаваемые формы и цвета. Монополия — замкнутое кольцо полей (по просьбе Кирилла 30.10), «Не сердись» — крест с четырьмя домиками.', games.filter((g) => !g.key.startsWith('cat:kosmos-'))],
    ];
    for (const [title, sub, list] of groups) {
      if (!list.length) continue;
      const sec = el('div', 'ng-sec');
      if (!view) sec.append(el('h3', undefined, title), el('p', undefined, sub));
      const grid = el('div', 'ng-grid');
      sec.append(grid);
      for (const game of list) {
        const card = el('article', 'ng-card');
        card.dataset['game'] = game.key;
        const head = el('div');
        head.append(el('b', undefined, game.ru));
        if (!game.inCatalog) head.append(el('span', 'prov', 'только галерея'));
        card.append(head, el('span', 'de', `${game.de} · <code>${game.key}</code>`), el('span', 'grp', groupLabel(game)));
        const stages = el('div', 'ng-stages');
        stages.style.setProperty('--n', String(Math.min(themes.length, 3)));
        const own: Mounted[] = [];
        for (const theme of themes) {
          const { frame, stage } = stageIn(theme, game, 'button');
          (frame as HTMLButtonElement).type = 'button';
          frame.setAttribute('aria-label', `${game.de} abspielen (${theme})`);
          frame.append(el('small', undefined, NG_THEMES.find(([t]) => t === theme)?.[1] ?? theme));
          stages.append(frame);
          const m = mount(stage, game, { reduced, at: frozenAt });
          own.push(m);
          mounted.push(m);
          // tap = this game plays once in every theme shown (side by side)
          frame.addEventListener('click', () => {
            for (const x of own) x.play();
          });
        }
        card.append(stages, el('p', 'line', game.line));
        grid.append(card);
      }
      page.append(sec);
    }
  }

  // ---------------------------------------------------------------------------------------- 2. every theme, end pose
  if (shows('themes')) {
    const sec = el('div', 'ng-sec');
    if (!view) sec.append(el('h3', undefined, '3 · «Картинка» (конечная поза) во всех пяти темах'), el('p', undefined, 'Светлая, тёмная, Blau, Ozean, Schwarz — фон плитки как в приложении (в тёмных темах — тёмные плитки), рисунок — палитра подарков.'));
    const table = el('div', 'ng-themes');
    table.append(el('i', undefined, ''), ...NG_THEMES.map(([, label]) => el('i', undefined, label)));
    for (const game of games) {
      table.append(el('span', undefined, `${game.ru}<br><small style="color:var(--text-2)">${game.de}</small>`));
      for (const [theme] of NG_THEMES) {
        const { frame, stage } = stageIn(theme, game);
        table.append(frame);
        mount(stage, game, { reduced: true, at: null });
      }
    }
    sec.append(table);
    page.append(sec);
  }

  // ---------------------------------------------------------------------------------------- 3. frozen frames
  const frames = Math.max(0, Math.min(16, Math.round(Number(q.get('frames') ?? 6))));
  if (shows('frames') && frames > 0) {
    const sec = el('div', 'ng-sec');
    const asked = (q.get('anim') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const list = asked.length ? NEW_GAMES.filter((g) => asked.some((v) => matches(g, v))) : NEW_GAMES.filter((g) => ['sky-team', 'monopoly', 'mensch-aergere-dich-nicht', 'jenga'].some((v) => matches(g, v)));
    if (!view) sec.append(el('h3', undefined, `4 · Кадры: ${frames} шт. на игру`), el('p', undefined, 'Замороженные кадры (ровно то, что показывает seek(t) — без анимации). Другие игры: &anim=uno,cluedo&frames=8.'));
    const theme = themes[0] ?? 'light';
    for (const game of list) {
      const scene = newSceneFor(game.variant);
      sec.append(el('h4', 'ix-frames-title', `${game.ru} · ${game.de} · 0–${scene.duration.toFixed(2)} s`));
      const grid = el('div', 'ng-frames');
      for (let i = 0; i < frames; i++) {
        const t = frames === 1 ? scene.duration : (scene.duration * i) / (frames - 1);
        const fig = el('figure');
        const { frame, stage } = stageIn(theme, game);
        stage.innerHTML = sceneSvg(scene, game.de);
        freezeAt(scene.tracks(stage), t);
        fig.append(frame, el('figcaption', undefined, `t = ${t.toFixed(2)} s`));
        grid.append(fig);
      }
      sec.append(grid);
    }
    page.append(sec);
  }

  markReady();
  window.addEventListener(
    'pagehide',
    () => {
      for (const m of mounted) m.destroy();
    },
    { once: true },
  );
}
