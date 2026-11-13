/**
 * Tapsi's moments (26.10, gallery) — the timeline stage and the puppet rig of the gallery page.
 *
 * Every moving part is ONE Track of the mascot timeline (src/timeline.ts): keys at absolute seconds, compiled into
 * Web Animations that one Playhead moves together. seek(t) therefore gives the same frame every time (the contact
 * sheets and `&t=` rely on it); play() runs them on the document timeline. Only transform and opacity move.
 *
 * The puppet is the app's own Hamster (src/hamster.ts) with idle, scenes and timers off, held in its 'driven' mode
 * (since 27.10 in the package: its CSS loops — breathing, the binocular look-around, chewing — and its CSS
 * transitions step aside, so they do not fight the tracks).
 */

import { Hamster, type HamsterCoat, type HamsterHolding } from '../../src/index';
import { Playhead, Track, type ChannelInput } from '../../src/timeline';

/** The app's springs and the puppet's curves (moved into the package with the approved scenes, 27.10). */
export { EZ } from '../../src/tapsi-moments';

/** One timeline: tracks → Web Animations, frozen or running together. */
export class Stage {
  private readonly list: Track[] = [];
  private readonly playhead = new Playhead();
  private clock: Animation | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private built = false;
  private finish: (() => void) | null = null;
  /** seconds; set by the scene (the moment the puppet is free again) */
  duration = 0;

  get tracks(): readonly Track[] {
    return this.list;
  }

  track(el: Element | readonly Element[], base: ChannelInput, name: string): Track {
    const t = new Track(el, name, base);
    this.list.push(t);
    return t;
  }

  /** The last key of any track (s): what still moves after `duration` (the cheeks settling, a fade). */
  get end(): number {
    return this.list.reduce((m, t) => Math.max(m, Number.isFinite(t.end) ? t.end : 0), 0);
  }

  /** Writes every track's start value inline, compiles the animations (paused at 0). */
  build(): void {
    if (this.built) return;
    this.built = true;
    for (const tr of this.list) {
      const base = tr.baseStyle();
      for (const el of tr.els) inline(el, base);
      for (const c of tr.compile()) this.playhead.add(c, tr.name);
    }
    const anchor = this.list[0]?.els[0] as (Element & { animate?: Element['animate'] }) | undefined;
    if (anchor && typeof anchor.animate === 'function') {
      // an empty clock: the gallery reads the time from it while playing (it moves nothing)
      this.clock = this.playhead.adopt(anchor.animate([], { duration: Math.max(1, this.end * 1000), fill: 'forwards' }), this.end * 1000);
    }
    this.seek(0);
  }

  /** Reduced motion: no animation at all — every track's value at `t` is written inline (a still pose). */
  still(t: number): void {
    for (const tr of this.list) {
      const st = tr.styleAt(t);
      for (const el of tr.els) inline(el, st);
    }
  }

  seek(seconds: number): void {
    this.stopTimer();
    this.playhead.seek(Math.max(0, seconds) * 1000);
  }

  /** Runs from `from` (s) to the last key; resolves at the end (or when interrupted by seek / play / destroy). */
  play(from = 0): Promise<void> {
    this.stopTimer();
    if (!this.built) this.build();
    this.playhead.playFrom(Math.max(0, from) * 1000);
    return new Promise<void>((resolve) => {
      this.finish = resolve;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.finish = null;
        resolve();
      }, Math.max(0, this.end - from) * 1000 + 40);
    });
  }

  /** The playhead's time in seconds. */
  get time(): number {
    const t = this.clock?.currentTime;
    return typeof t === 'number' ? t / 1000 : 0;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  destroy(): void {
    this.stopTimer();
    this.playhead.cancel();
    this.clock = null;
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const f = this.finish;
    this.finish = null;
    f?.();
  }
}

function inline(el: Element, st: { transform?: string; opacity?: string } | null): void {
  if (!st) return;
  const s = (el as HTMLElement | SVGElement).style;
  if (st.transform !== undefined) s.transform = st.transform;
  if (st.opacity !== undefined) s.opacity = st.opacity;
}

// ---- the puppet ---------------------------------------------------------------------------------------------

/** viewBox 400 × 250; the puppet group sits at translate(200 236) scale(1.25) (src/hamster.ts). */
const VIEW_H = 250;
const FEET_Y = 236;
const PUPPET_SCALE = 1.25;

export interface Rig {
  puppet: Hamster;
  /** the positioned box (left/top in the parent, width = size) */
  box: HTMLElement;
  /** the app's bounce-in wrapper (GuestWishlist's m.div: scale about its centre) */
  pop: HTMLElement;
  /** rise / duck / travel (px) */
  lift: HTMLElement;
  size: number;
  /** px per puppet unit */
  unit: number;
  /** px from the box top to the feet line */
  feet: number;
  part<T extends Element = SVGGElement>(selector: string): T;
  parts(selector: string): Element[];
  /** box-local px of a point in puppet units (0, 0 = between the feet) */
  at(ux: number, uy: number): { x: number; y: number };
  /** an extra drawing inside the puppet, in puppet units; `before` = selector of the sibling it goes before */
  add(markup: string, parent: string, before?: string): SVGGElement;
  destroy(): void;
}

export interface RigOptions {
  size: number;
  left: number;
  top: number;
  coat?: HamsterCoat;
  holding?: HamsterHolding;
  z?: number;
}

export function mountTapsi(parent: HTMLElement, o: RigOptions): Rig {
  const k = o.size / 400;
  const box = document.createElement('div');
  box.className = 'tm-actor';
  box.style.cssText = `position:absolute;left:${o.left}px;top:${o.top}px;width:${o.size}px;height:${VIEW_H * k}px;z-index:${o.z ?? 2}`;
  const pop = document.createElement('div');
  pop.style.cssText = 'position:absolute;inset:0;transform-origin:50% 50%';
  const lift = document.createElement('div');
  lift.style.cssText = `position:absolute;inset:0;transform-origin:50% ${FEET_Y * k}px`;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0';
  lift.append(host);
  pop.append(lift);
  box.append(pop);
  parent.append(box);
  const puppet = new Hamster(host, {
    size: o.size,
    idle: false,
    interactive: false,
    reducedMotion: 'off',
    ...(o.coat ? { coat: o.coat } : {}),
    ...(o.holding ? { holding: o.holding } : {}),
  });
  // the puppet's own 'driven' mode (hamster.ts, 27.10): its CSS loops and transitions step aside for the timeline
  puppet.root.querySelector('.hm')?.classList.add('driven');
  // The stage owns the clock: the puppet's own offscreen / hidden-tab pausing would pause only ITS animations (not the
  // wrappers', not the star's) and later resume a frame the gallery froze. Its idle is off anyway, so its scheduler
  // has nothing else to do here. (The later src "driven mode" would skip it.)
  (puppet as unknown as { idle: { destroy(): void } }).idle.destroy();
  const part = <T extends Element = SVGGElement>(sel: string): T => {
    const el = puppet.root.querySelector<T & Element>(sel);
    if (!el) throw new Error(`[tapsi] missing part ${sel}`);
    return el;
  };
  const unit = k * PUPPET_SCALE;
  return {
    puppet,
    box,
    pop,
    lift,
    size: o.size,
    unit,
    feet: FEET_Y * k,
    part,
    parts: (sel) => [...puppet.root.querySelectorAll(sel)],
    at: (ux, uy) => ({ x: 200 * k + unit * ux, y: FEET_Y * k + unit * uy }),
    add: (markup, parentSel, before) => {
      const p = part(parentSel);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = markup;
      const ref = before ? p.querySelector(`:scope > ${before}`) : null;
      if (ref) p.insertBefore(g, ref);
      else p.append(g);
      return g;
    },
    destroy: () => {
      puppet.destroy();
      box.remove();
    },
  };
}
