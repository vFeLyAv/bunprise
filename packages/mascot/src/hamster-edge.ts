import { Hamster } from './hamster';
import { MoveStage, type MoveOptions, type MoveShow } from './props';
import { Track } from './timeline';
import type { HamsterCoat } from './types';

export interface HamsterEdgeOptions extends MoveOptions { coat?: HamsterCoat; edge?: 'bottom' | 'left' | 'right'; cheeks?: number; stay?: boolean; illustration?: boolean }
/** Tapsi peeks in with full cheek pouches, using the same approved hamster puppet. */
export class HamsterEdgeStage extends MoveStage {
  private hamster: Hamster | null = null;
  constructor(host: HTMLElement, private readonly options: HamsterEdgeOptions = {}) {
    super(host, options, ':host{display:block;position:relative;overflow:hidden;pointer-events:none;min-height:120px}');
    this.setup();
  }
  protected author(reduced: boolean): MoveShow {
    if (reduced && !this.options.illustration) return { tracks: [], duration: 0, empty: true };
    const w = this.host.clientWidth || 390, h = this.host.clientHeight || 180;
    const actor = document.createElement('div');
    actor.style.cssText = 'position:absolute;width:230px;height:144px';
    this.stage.append(actor);
    this.hamster = new Hamster(actor, { size: 230, idle: false, interactive: false, reducedMotion: 'force', calmEyes: 'happy', ...(this.options.coat ? { coat: this.options.coat } : {}) });
    this.hamster.setPuff(Math.min(1.4, Math.max(1, this.options.cheeks ?? 1.22)));
    const edge = this.options.edge ?? 'bottom';
    const end = { x: edge === 'left' ? -70 : edge === 'right' ? w - 160 : (w - 230) / 2, y: h - 112 };
    const start = { x: edge === 'left' ? -240 : edge === 'right' ? w + 10 : end.x, y: edge === 'bottom' ? h + 10 : end.y };
    const travel = new Track(actor, 'hamster.travel', { ...start });
    travel.path(0, [[0.7, { ...end }, 'cubic-bezier(.25,.9,.35,1)'], [1.2, { ...end }]]);
    if (!this.options.stay) travel.path(1.8, [[2.15, { ...start }, 'ease-in']]);
    if (reduced) return { tracks: [travel], duration: 0.45, staticAt: 1.2, isStatic: true };
    const eyes = this.hamster.root.querySelector('.eyes')!, happy = this.hamster.root.querySelector('.eyes-happy')!;
    const glance = new Track(eyes, 'hamster.eyes', { o: 1 });
    glance.path(0.7, [[0.95, { sx: 1.06, sy: 1.06 }], [1.25, { o: 0 }]]);
    const smile = new Track(happy, 'hamster.happy', { o: 0 });
    smile.set(1.25, { o: 1 });
    const cheek = this.hamster.root.querySelector('.cheek-j');
    const puff = cheek ? new Track(cheek, 'hamster.cheeks') : null;
    puff?.path(0.9, [[1.15, { sx: 1.08, sy: 1.02 }], [1.4, { sx: 1, sy: 1 }]]);
    return { tracks: [travel, glance, smile, ...(puff ? [puff] : [])], duration: this.options.stay ? 1.5 : 2.25 };
  }
  protected override cleanup(): void { this.hamster?.destroy(); this.hamster = null; }
}
