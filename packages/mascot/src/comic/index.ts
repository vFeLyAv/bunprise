/**
 * @bunprise/mascot/comic — the comic «Pompon & Tapsi» (episode 1 «Ein Wunsch rollt an», episode 2 «Zweimal derselbe
 * Schal»; v4 manga style, approved by Felix 31.10): black-and-white ink ribbons with one spot colour, drawn with the
 * app's own puppets, texts in DE / EN / RU / UK. Opt-in and side-effect free: nothing here runs on import, and a
 * bundle that does not import this subpath does not contain it (the app loads it lazily, in its own chunk).
 *
 *   const view = new ComicView(host, { episode: 1, lang: 'de', motion: true });
 *   view.fit(host.clientWidth);
 *   view.drive(scroller, ({ share, panel, end }) => …);
 *   view.destroy();
 *
 * Design notes (Russian, for Felix): docs/design/2026-10-26-manga-episode-1.md, 2026-10-31-manga-episode-2.md.
 */

export { ComicView, COMIC_CSS, COMIC_WIDTH, driveStrip } from './view';
export type { ComicFrameInfo, ComicPanelBox, ComicViewOptions, DriveOptions } from './view';
export { COMIC_LANGS, EPISODES, EPISODE_TITLE, MANGA2_TEXTS, MANGA_TEXTS } from './texts';
export type { ComicLang, ComicText, EpisodeNumber } from './texts';
export { Beat } from './beat';
export type { Strip } from './beat';
