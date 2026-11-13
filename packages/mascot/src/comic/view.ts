/**
 * The comic in a page: one episode's ribbon in a scaled frame, driven by a scroller (framework-agnostic; the app's
 * reader apps/web/src/features/comic/ and the gallery demo/story/ use it).
 *
 *   - the roll down the slope (episode 1) IS the scroll: the reader's eye line → the roll's time, one seek per
 *     animation frame and only when it changed — the same scroll offset always gives the same frame;
 *   - every panel comes alive ONCE when it is in the middle of the view (or jumps to its end when the reader is
 *     already past it): transform / opacity only, ≤ 2 s, finite;
 *   - reduced motion (`motion: false`): one still picture, not a single Web Animation;
 *   - the page goes hidden: a running moment freezes where it is and runs on when the page is visible again.
 */

import type { Beat, Strip } from './beat';
import { MANGA_CSS, MW, PANELS, buildManga } from './episode1';
import { PANELS2, buildManga2 } from './episode2';
import { EPISODES, type ComicLang, type EpisodeNumber } from './texts';
import { readLineY } from './util';

/** The ribbon's own width (CSS px at scale 1): a phone. */
export const COMIC_WIDTH = MW;

/** Everything the ribbon needs (scoped to its own class names: .cm-frame, .sp-world, .m4). */
export const COMIC_CSS = `
.cm-frame { position: relative; overflow: hidden; background: #FFFFFF; color: #141414; }
.cm-frame > .sp-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.sp-world { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
${MANGA_CSS}`;

/** What the scroller reports on every frame. */
export interface ComicFrameInfo {
  /** how far the ribbon is scrolled through (0 … 1) */
  share: number;
  /** the panel at the reading line (index into `panels`) */
  panel: number;
  /** the end of the episode is on screen */
  end: boolean;
}

export interface DriveOptions {
  /** the frame the world is scaled into (its top = the world's top) */
  frame: HTMLElement;
  /** the frame's current scale (world px → CSS px) */
  scale: () => number;
  scroller: Window | HTMLElement;
  /** aborting it stops everything (listeners, the pending frame) */
  signal: AbortSignal;
  /** reading line (world y) → the roll's time; default the strip's own `rollAt` (none: the roll waits at 0) */
  rollAt?: (readY: number) => number;
  onFrame?: (view: { share: number; top: number; bottom: number; readY: number }) => void;
}

/**
 * Drives a built strip from a scroller (the gallery pages and ComicView): the roll follows the reader's eye line,
 * a moment plays once when its part of the strip is in the middle of the view, or jumps to its end when the reader
 * is already past it. While the document is hidden, a running moment is paused.
 */
export function driveStrip(strip: Strip, o: DriveOptions): void {
  const { frame, scroller, signal } = o;
  const rollAt = o.rollAt ?? strip.rollAt;
  let raf = 0;
  let last = -1;
  const update = (): void => {
    raf = 0;
    const view = scroller === window || !(scroller instanceof HTMLElement) ? { top: 0, h: window.innerHeight } : { top: scroller.getBoundingClientRect().top, h: scroller.clientHeight };
    const rect = frame.getBoundingClientRect();
    const stripTop = rect.top - view.top;
    const k = o.scale() || 1;
    const readY = readLineY(stripTop, view.h, k);
    if (strip.roll && rollAt) {
      const p = rollAt(readY);
      if (Math.abs(p - last) > 1e-4) {
        last = p;
        strip.roll.seek(p);
      }
    }
    const top = -stripTop / k;
    const bottom = top + view.h / k;
    if (!hidden()) for (const m of strip.moments) moment(m, top, bottom);
    o.onFrame?.({ share: Math.min(1, Math.max(0, -stripTop / Math.max(1, rect.height - view.h))), top, bottom, readY });
  };
  const moment = (m: Beat, top: number, bottom: number): void => {
    if (m.played) return;
    const { y0, y1 } = m.region;
    const band0 = top + (bottom - top) * 0.15;
    const band1 = top + (bottom - top) * 0.85;
    if (y1 < top) {
      m.played = true;
      m.seek(m.end);
    } else if (y0 < band1 && y1 > band0 && (Math.min(y1, band1) - Math.max(y0, band0)) > Math.min(160, (y1 - y0) * 0.4)) {
      void m.play();
    }
  };
  const ask = (): void => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  const visibility = (): void => {
    for (const m of strip.moments) {
      if (hidden()) m.pause();
      else m.resume();
    }
    if (!hidden()) ask();
  };
  scroller.addEventListener('scroll', ask, { passive: true, signal });
  window.addEventListener('resize', ask, { signal });
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility, { signal });
  signal.addEventListener('abort', () => cancelAnimationFrame(raf));
  update();
}

function hidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export interface ComicViewOptions {
  episode: EpisodeNumber;
  lang: ComicLang;
  /** false = reduced motion: one still picture, nothing animates */
  motion: boolean;
  /** the frame's accessible name (default «Pompon & Tapsi · <episode title line>») */
  label?: string;
}

/** A panel of the ribbon in reading order (world y). */
export interface ComicPanelBox {
  id: string;
  y0: number;
  y1: number;
}

/** One episode built into `host`: <style> + the frame (role group, labelled) with the world inside. */
export class ComicView {
  readonly episode: EpisodeNumber;
  readonly frame: HTMLDivElement;
  readonly strip: Strip;
  /** the ribbon's panels in reading order (world y) */
  readonly panels: readonly ComicPanelBox[];
  private k = 1;
  private readonly world: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private life: AbortController | null = null;

  constructor(host: HTMLElement, o: ComicViewOptions) {
    this.episode = o.episode;
    this.style = document.createElement('style');
    this.style.textContent = COMIC_CSS;
    this.frame = document.createElement('div');
    this.frame.className = 'cm-frame';
    this.frame.setAttribute('role', 'group');
    this.frame.setAttribute('aria-label', o.label ?? `Pompon & Tapsi · ${EPISODES[o.episode].folge[o.lang]}`);
    this.frame.lang = o.lang;
    this.world = document.createElement('div');
    this.frame.append(this.world);
    host.append(this.style, this.frame);
    this.strip = (o.episode === 2 ? buildManga2 : buildManga)(this.world, o.lang, o.motion);
    this.panels = (o.episode === 2 ? PANELS2 : PANELS)
      .filter((p) => p.pts.length > 0)
      .map((p) => ({ id: p.id, y0: Math.min(...p.pts.map(([, y]) => y)), y1: Math.max(...p.pts.map(([, y]) => y)) }));
    this.fit(COMIC_WIDTH);
  }

  /** World px → CSS px. */
  get scale(): number {
    return this.k;
  }

  /** The world's height (world px). */
  get height(): number {
    return this.strip.world.h;
  }

  /** Scales the ribbon to `width` CSS px (never below 0.6). */
  fit(width: number): void {
    const k = Math.max(0.6, width / COMIC_WIDTH);
    this.k = k;
    this.frame.style.width = `${(COMIC_WIDTH * k).toFixed(2)}px`;
    this.frame.style.height = `${(this.strip.world.h * k).toFixed(2)}px`;
    this.world.style.transform = `scale(${k.toFixed(4)})`;
  }

  /** The panel at world y `readY` (index into `panels`; the first one above the ribbon's start). */
  panelAt(readY: number): number {
    let at = 0;
    this.panels.forEach((p, i) => {
      if (p.y0 <= readY) at = i;
    });
    return at;
  }

  /** CSS px from the frame's top to panel `index`'s top (a little above it, so its caption shows too). */
  panelTop(index: number): number {
    const p = this.panels[Math.max(0, Math.min(this.panels.length - 1, index))];
    return p ? Math.max(0, (p.y0 - 12) * this.k) : 0;
  }

  /** Drives the ribbon from `scroller` until `stop()` / destroy(); `onFrame` gets the reading position. */
  drive(scroller: Window | HTMLElement, onFrame?: (info: ComicFrameInfo) => void): void {
    this.life?.abort();
    const life = new AbortController();
    this.life = life;
    const h = this.height;
    driveStrip(this.strip, {
      frame: this.frame,
      scale: () => this.k,
      scroller,
      signal: life.signal,
      onFrame: onFrame ? ({ share, bottom, readY }) => onFrame({ share, panel: this.panelAt(readY), end: bottom >= h - 40 }) : undefined,
    });
  }

  /** Stops following the scroller (the ribbon keeps its frame). */
  stop(): void {
    this.life?.abort();
    this.life = null;
  }

  destroy(): void {
    this.stop();
    this.strip.destroy();
    this.style.remove();
    this.frame.remove();
  }
}
