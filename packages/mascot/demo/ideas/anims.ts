/**
 * The game animations on the gallery page (26.10, GALLERY-ONLY): mounting one scene (scenes.ts) into a box, the review
 * grid of all 24 games (end pose; tap = play once) with their archetype, photo and "So wird gespielt", and contact
 * sheets of frozen frames (Track.styleAt — exactly what seek(t) shows, no animation at all).
 */

import type { Track } from '../../src/timeline';
import { Driver, el, freezeAt } from '../parade/kit';
import { PLAYS, PHOTOS, photoUrl } from './plays';
import { ARCHETYPES, sceneFor, sceneSvg, type Scene } from './scenes';
import type { Theme } from './phone';

export const ANIMS_CSS = `
.ix-board.bp-paper { box-shadow: none; border-radius: 26px; padding: 16px; margin-top: 4px; }
.ix-anims { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 14px; }
.ix-anim { position: relative; display: flex; flex-direction: column; gap: 6px; border: 0; padding: 10px 10px 12px; text-align: left; font: inherit; color: var(--text);
  border-radius: 22px; background: var(--surface); box-shadow: var(--card-shadow); cursor: pointer; }
.ix-anim:focus-visible { outline: 3px solid #EE9443; outline-offset: 2px; }
.ix-stage { position: relative; border-radius: 16px; background: var(--tile-bg, var(--tile-1)); overflow: hidden; aspect-ratio: 240 / 132; }
.ix-stage .ix-play { display: block; width: 100%; height: 100%; }
.ix-anim b { font-size: 15px; line-height: 19px; }
.ix-anim .arch { font-size: 12px; color: var(--text-2); }
.ix-anim .howto { margin: 2px 0 0; font-size: 13px; line-height: 18px; color: var(--text); }
.ix-anim .nophoto { font-size: 12px; color: var(--text-2); }
.ix-anim img { position: absolute; right: 18px; top: 18px; width: 46px; height: 46px; object-fit: contain; border-radius: 10px; background: var(--photo-plate); box-shadow: 0 1px 3px rgba(0,0,0,.18); padding: 3px; box-sizing: border-box; }
.ix-frames { display: grid; grid-template-columns: repeat(auto-fill, 196px); gap: 10px; margin-bottom: 18px; }
.ix-frames figure { margin: 0; display: flex; flex-direction: column; gap: 3px; align-items: center; }
.ix-frames figcaption { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.ix-frames .ix-stage { width: 196px; }
.ix-frames-title { margin: 6px 0 8px; font-size: 15px; }
`;

/** Tile tone per archetype (tiles.css --tile-1…4). */
export const ARCH_TONE: Record<string, 1 | 2 | 3 | 4> = { tiles: 1, route: 3, pattern: 4, words: 2, dice: 4, coop: 3, luck: 1, music: 2 };

export interface Mounted {
  readonly scene: Scene;
  readonly tracks: readonly Track[];
  readonly duration: number;
  /** play once from the start (no-op in reduced motion: the end pose stays) */
  play(): void;
  seek(t: number): void;
  readonly time: number;
  readonly playing: boolean;
  destroy(): void;
}

/**
 * Puts the scene of `id` into `host` (an element inside the token classes). Reduced motion: the end pose, no animate()
 * at all. `at` = frozen at that second; else the end pose until play() (the Driver — Web Animations — is made only then).
 */
export function mountScene(host: HTMLElement, id: string, opts: { reduced: boolean; at?: number | null; onEnd?: () => void }): Mounted {
  const play0 = PLAYS[id];
  if (!play0) throw new Error(`no play for ${id}`);
  const scene = sceneFor(play0.look);
  host.innerHTML = sceneSvg(scene, play0.name);
  const tracks = scene.tracks(host);
  let driver: Driver | null = null;
  const ensure = (): Driver => {
    driver ??= new Driver(host, tracks, scene.duration, opts.onEnd);
    return driver;
  };
  if (opts.reduced) freezeAt(tracks, scene.duration);
  else if (opts.at !== null && opts.at !== undefined) ensure().seek(opts.at);
  else freezeAt(tracks, scene.duration);
  return {
    scene,
    tracks,
    duration: scene.duration,
    play() {
      if (opts.reduced) return;
      const d = ensure();
      d.stop();
      d.play();
    },
    seek(t: number) {
      if (opts.reduced) return;
      ensure().seek(t);
    },
    get time() {
      return driver ? driver.time : scene.duration;
    },
    get playing() {
      return driver?.playing ?? false;
    },
    destroy() {
      driver?.destroy();
    },
  };
}

/** All 24 games: the end pose of each animation; tap a tile = it plays once. */
export function animsGrid(theme: Theme, reduced: boolean, ids: readonly string[]): { node: HTMLElement; mounted: Mounted[] } {
  const board = el('div', `ix-board bp-paper ix-tok${theme === 'dark' ? ' dark' : ''}`);
  const grid = el('div', 'ix-anims');
  board.append(grid);
  const mounted: Mounted[] = [];
  for (const id of ids) {
    const play = PLAYS[id];
    if (!play) continue;
    const tile = el('button', 'ix-anim');
    tile.type = 'button';
    tile.dataset['play'] = id;
    const stage = el('div', 'ix-stage');
    stage.style.setProperty('--tile-bg', `var(--tile-${ARCH_TONE[play.look.archetype] ?? 1})`);
    tile.append(stage);
    const arch = ARCHETYPES[play.look.archetype];
    tile.append(el('b', undefined, play.name), el('span', 'arch', `${arch.ru} · ${arch.de}`));
    const src = photoUrl(id);
    if (src) {
      const img = el('img');
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.src = src;
      img.title = `Bild: ${PHOTOS[id]?.shop ?? ''}`;
      img.addEventListener('error', () => img.remove());
      tile.append(img);
    } else tile.append(el('span', 'nophoto', 'без фото (страница магазина не открылась)'));
    if (play.howTo) tile.append(el('p', 'howto', `<b>So wird gespielt.</b> ${escapeHtml(play.howTo)}`));
    grid.append(tile);
    const m = mountScene(stage, id, { reduced });
    mounted.push(m);
    tile.addEventListener('click', () => m.play());
  }
  return { node: board, mounted };
}

/** Frozen frames of one game's animation, 0 … its duration. */
export function contactSheet(theme: Theme, id: string, frames: number): HTMLElement {
  const wrap = el('div');
  const play = PLAYS[id];
  if (!play) return wrap;
  const scene = sceneFor(play.look);
  wrap.append(el('h4', 'ix-frames-title', `${play.name} · ${ARCHETYPES[play.look.archetype].ru} · ${frames} кадров · 0–${scene.duration.toFixed(2)} s · ${theme === 'dark' ? 'тёмная' : 'светлая'}`));
  const board = el('div', `ix-board bp-paper ix-tok${theme === 'dark' ? ' dark' : ''}`);
  const grid = el('div', 'ix-frames');
  board.append(grid);
  wrap.append(board);
  for (let i = 0; i < frames; i++) {
    const t = frames === 1 ? scene.duration : (scene.duration * i) / (frames - 1);
    const fig = el('figure');
    const stage = el('div', 'ix-stage');
    stage.style.setProperty('--tile-bg', `var(--tile-${ARCH_TONE[play.look.archetype] ?? 1})`);
    stage.innerHTML = sceneSvg(scene, play.name);
    fig.append(stage, el('figcaption', undefined, `t = ${t.toFixed(2)} s`));
    grid.append(fig);
    freezeAt(scene.tracks(stage), t);
  }
  return wrap;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
