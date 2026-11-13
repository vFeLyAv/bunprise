import { Track } from './timeline';

/** A small corner-only cutout. The target layout and existing mask styles remain untouched. */
export function biteMark(parent: HTMLElement, x: number, y: number, background = 'var(--page-bg, #FFF9F0)') {
  const mark = document.createElement('div');
  mark.dataset['biteMark'] = '';
  mark.style.cssText = `position:absolute;left:${x - 13}px;top:${y - 13}px;width:26px;height:26px;border-radius:50%;pointer-events:none;background:${background};transform-origin:70% 70%;opacity:0`;
  parent.append(mark);
  const track = new Track(mark, 'bite.mark', { o: 0, s: 0.2 });
  track.path(1.05, [[1.13, { o: 1, s: 1 }, 'ease-out'], [2.1, { o: 1, s: 1 }], [2.34, { s: 0.92 }, 'ease-in'], [2.65, { o: 0, s: 0.05 }, 'ease-in-out']]);
  return { element: mark, track };
}
