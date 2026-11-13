import { MoveStage, boxIn, mountProp, type Box, type MoveOptions, type MoveShow } from './props';
import { Track } from './timeline';
import { movingBunny } from './move-actor';
import { biteMark } from './bite';
import type { BunnyCoat } from './types';

export interface NibbleOptions extends MoveOptions { target: Element | Box; coat?: BunnyCoat; background?: string; corner?: 'left' | 'right' }
/** A card corner is nibbled, three crumbs fall, and the corner heals. No target mutations. */
export class NibbleStage extends MoveStage {
  constructor(host: HTMLElement, private readonly options: NibbleOptions) {
    super(host, options, ':host{display:block;position:relative;overflow:hidden;pointer-events:none}');
    this.setup();
  }
  protected author(reduced: boolean): MoveShow {
    if (reduced) return { tracks: [], duration: 0, empty: true };
    const target = boxIn(this.host, this.options.target);
    const left = this.options.corner === 'left';
    const x = left ? target.left : target.left + target.width;
    const y = target.top;
    const dir = left ? 1 : -1;
    const bunny = movingBunny(this.stage, this.options.coat ?? 'fawn', 112, dir);
    const clip = document.createElement('div');
    clip.style.cssText = `position:absolute;inset:0;overflow:hidden;clip-path:inset(0 0 ${Math.max(0, (this.host.clientHeight || 180) - y)}px)`;
    this.stage.append(clip);
    clip.append(bunny.puppet.frame);
    bunny.travel.set(0, { ...bunny.feet(x + dir * 22, y + 130), o: 1 });
    bunny.travel.path(0, [[0.7, { ...bunny.feet(x + dir * 22, y + 44) }, 'ease-out'], [1, { ...bunny.feet(x + dir * 12, y + 42) }], [1.12, { ...bunny.feet(x + dir * 4, y + 50) }, 'ease-in'], [1.35, { ...bunny.feet(x + dir * 20, y + 40) }, 'ease-out'], [2.25, { ...bunny.feet(x + dir * 20, y + 40) }], [2.65, { ...bunny.feet(x + dir * 20, y + 140) }, 'ease-in']]);
    bunny.part('eyes', '.eyes').set(1.12, { o: 0 });
    bunny.part('happy', '.eyes-happy', { o: 0 }).set(1.12, { o: 1 });
    const cheek = bunny.part('cheek', '.cheek-j');
    for (let i = 0; i < 5; i++) cheek.path(1.2 + i * 0.17, [[1.28 + i * 0.17, { sx: 1.14, sy: 0.97 }], [1.37 + i * 0.17, { sx: 1.04, sy: 1 }]]);
    const bite = biteMark(this.stage, x, y, this.options.background);
    const crumbs = Array.from({ length: 3 }, (_, i) => {
      const prop = mountProp(this.stage, 'crumb', 5 + i);
      const tr = new Track(prop.frame, `crumb.${i}`, { x: x - 4, y: y - 3, o: 0 });
      tr.set(1.1 + i * 0.04, { o: 1 });
      tr.path(1.1 + i * 0.04, [[1.35, { x: x + (i - 1) * 14, y: y - 6, r: i * 60 }, 'ease-out'], [1.7, { y: y + 38 + i * 8, r: 110 + i * 60 }, 'ease-in'], [1.95, { y: y + 32 + i * 8 }, 'ease-out'], [2.1, { y: y + 40 + i * 8, o: 0 }, 'ease-in']]);
      return tr;
    });
    return { tracks: [...bunny.tracks(), bite.track, ...crumbs], duration: 2.8 };
  }
}
