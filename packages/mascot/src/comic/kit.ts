/**
 * The comic's panel kit «Pompon & Tapsi» (since 31.10 part of the package: the app's reader and the gallery
 * demo/story/ both build on it; docs/design/2026-10-26-manga-episode-1.md, 2026-10-31-manga-episode-2.md).
 *
 * One panel = one fixed world of w × h CSS px (scaled as a whole by the page) with backgrounds, props, text and
 * the app's own puppets (Bunny / Hamster, unchanged). Every pose is a Track of the mascot timeline (../timeline.ts)
 * — the same approach as the promo film, and the puppets stay in reduced motion: they never move on their own, the
 * panel moves them.
 *
 * A panel is shown in one of two ways:
 *   still(t)  — every track's value at t written inline (no animation at all): the contact sheet, "Weniger";
 *   build()   — the tracks compiled into Web Animations on ONE Playhead: seek(t) gives the same frame every time,
 *               play() runs the panel's "comes alive" moment once (transform / opacity only, finite, no loops).
 */

import { Bunny } from '../bunny';
import { Hamster } from '../hamster';
import { Playhead, Track, type ChannelInput, type StyleOut } from '../timeline';
import type { BunnyCoat, EyeMode, HamsterCoat } from '../types';

/** The panel world (CSS px). 4 : 5 — one panel per phone screen with room for its caption. */
export const PW = 360;
export const PH = 450;

const LINEAR_OK = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transition-timing-function', 'linear(0, 1)');

/** The app's springs (apps/web/src/styles/tokens.css --ease-*) plus plain curves for arcs and falls. */
export const EZ = {
  smooth: LINEAR_OK ? 'linear(0, 0.023, 0.081, 0.159, 0.248, 0.340, 0.429, 0.514, 0.591, 0.660, 0.721, 0.773, 0.818, 0.856, 0.887, 0.913, 0.934, 0.950, 0.964, 0.974, 0.982, 0.988, 0.993, 0.996, 1)' : 'cubic-bezier(.2,.7,.3,1)',
  bouncy: LINEAR_OK ? 'linear(0, 0.069, 0.237, 0.449, 0.662, 0.849, 0.994, 1.092, 1.146, 1.163, 1.153, 1.127, 1.092, 1.057, 1.026, 1.002, 0.986, 0.977, 0.973, 0.975, 0.979, 0.985, 0.990, 0.995, 1)' : 'cubic-bezier(.34,1.56,.64,1)',
  out: 'cubic-bezier(.2,.7,.3,1)',
  in: 'cubic-bezier(.5,0,.8,.5)',
  inOut: 'cubic-bezier(.45,0,.2,1)',
  linear: 'linear',
} as const;

/** Where the feet sit in each puppet's viewBox and its scale (src/bunny.ts / src/hamster.ts markup). */
const RIG = {
  bunny: { scale: 1.2, feetY: 246, viewH: 260 },
  hamster: { scale: 1.25, feetY: 236, viewH: 250 },
} as const;

/**
 * Injected into each puppet's shadow root: the panel drives it, so its own CSS transitions and loops step aside
 * (a still is then exact at once, and nothing ticks). Web Animations of the panel are not CSS animations: they run.
 */
const DRIVEN_CSS = `
*, *::before, *::after { transition: none !important; animation: none !important; }
.cheek-j { transform-box: fill-box; transform-origin: 50% 50%; }
`;

export type Kind = 'bunny' | 'hamster';

/** Density of the ink version's screen-tone (ears, patches, cap). */
export type InkTone = 'light' | 'mid' | 'dark' | 'hatch';

let inkSeq = 0;

/**
 * The ink version of a puppet (v4, 31.10, Felix: black & white manga, our characters): the SAME puppet and markup,
 * restyled from inside its own shadow root — white body, a clean ink contour around the whole silhouette (an SVG
 * dilate filter, so the cheeks get their line too), ears / patches / cap as dot screen-tone, black eyes, nose and
 * mouth, hatching for the blush. Only greys: the one spot colour of the comic is never on a puppet.
 */
function inkify(root: ShadowRoot, tone: InkTone): void {
  const n = ++inkSeq;
  // the coat's own colours on the host become greys too (the ink style below overrides them anyway)
  const host = root.host as HTMLElement;
  for (const [v, c] of [['--mascot-base-top', '#FFFFFF'], ['--mascot-base-bottom', '#F4F4F4'], ['--mascot-belly', '#FFFFFF'], ['--mascot-paw', '#FFFFFF'], ['--mascot-accent', '#9A9A9A'], ['--mascot-accent-dark', '#7A7A7A'], ['--mascot-ear-in', '#FFFFFF']] as const) host.style.setProperty(v, c);
  const r = tone === 'light' ? 0.85 : tone === 'mid' ? 1.15 : 1.5;
  // 'hatch' (ep 2, Momo): cross-hatching instead of dots, so a third bunny reads apart from Pompon and Mila
  const toneT = tone === 'hatch'
    ? `<pattern id="ink-t${n}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><rect width="4" height="4" fill="#FFFFFF"/><path d="M0 0 V4 M0 0 H4" stroke="#1A1A1A" stroke-width=".8"/></pattern>`
    : `<pattern id="ink-t${n}" width="4.2" height="4.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4.2" height="4.2" fill="#FFFFFF"/><circle cx="2.1" cy="2.1" r="${r}" fill="#1A1A1A"/></pattern>`;
  root.querySelector('svg defs')?.insertAdjacentHTML('beforeend', `
    ${toneT}
    <pattern id="ink-d${n}" width="4.2" height="4.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4.2" height="4.2" fill="#FFFFFF"/><circle cx="2.1" cy="2.1" r="1.75" fill="#1A1A1A"/></pattern>
    <pattern id="ink-h${n}" width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(-32)"><rect width="3.4" height="3.4" fill="#FFFFFF" fill-opacity="0"/><path d="M0 0 V3.4" stroke="#1A1A1A" stroke-width=".85"/></pattern>
    <filter id="ink-e${n}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
      <feMorphology in="SourceAlpha" operator="dilate" radius="1.9" result="d"/><feFlood flood-color="#141414"/><feComposite in2="d" operator="in" result="e"/>
      <feMerge><feMergeNode in="e"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
  const line = 'stroke: #141414 !important; stroke-width: 1.5px !important; vector-effect: non-scaling-stroke; paint-order: stroke fill;';
  const style = document.createElement('style');
  style.textContent = `
:host { --mascot-base-top: #FFFFFF !important; --mascot-base-bottom: #F4F4F4 !important; --mascot-belly: #FFFFFF !important; --mascot-paw: #FFFFFF !important;
  --mascot-eye: #141414 !important; --mascot-nose: #2E2E2E !important; --mascot-mouth: #141414 !important; --mascot-shadow: rgba(0,0,0,.13); --mascot-outline: none; }
.hop { filter: url(#ink-e${n}); }
.breathe > path, .cheek-j > ellipse { fill: #FFFFFF !important; }
.foot ellipse, .paw > ellipse, .tail > :first-child { fill: #FFFFFF !important; ${line} }
.paw > path { stroke: #141414 !important; opacity: .75; }
.lop .ear-l > path:first-child, .lop .ear-r > path:first-child, .te .ear-l > ellipse:first-child, .ear-tip ellipse { fill: url(#ink-t${n}) !important; ${line} }
.lop .ear-l > path:last-child, .lop .ear-r > path:last-child, .te .ear-l > ellipse:last-child { fill: #FFFFFF !important; opacity: .9 !important; }
.cap path, .tpatch path, .patch ellipse, .broken ellipse, .broken path, .tail-l ellipse, .tail-r ellipse { fill: url(#ink-t${n}) !important; }
.stripe, .points ellipse { fill: url(#ink-d${n}) !important; }
.ear-shadow { display: none; }
.tf > ellipse { fill: url(#ink-h${n}) !important; opacity: .9 !important; }
.mouth-open { fill: #141414 !important; }
.shadow { fill: rgba(0,0,0,.13) !important; }
`;
  root.append(style);
}

export interface ActorOptions {
  /** feet centre on the panel (px) */
  x: number;
  feetY: number;
  /** puppet width (px) */
  size: number;
  z?: number;
  coat?: BunnyCoat | HamsterCoat;
  /** bunny only (default lop: Pompon) */
  ears?: 'lop' | 'upright';
  eyes?: EyeMode;
  /** cheek fullness (1 = normal) */
  puff?: number;
  /** a three-quarter turn of the head and body (the puppets' own turn-l / turn-r classes) */
  turn?: 'l' | 'r';
  /** mirror the whole puppet (looking the other way) */
  flip?: boolean;
  label?: string;
  /** v4: the black-and-white ink version (screen-tone density of ears / patches) */
  ink?: InkTone;
}

/** One puppet on a panel: wrappers for placement / hop / spin / squash, part tracks on demand. */
export class Actor {
  readonly kind: Kind;
  readonly puppet: Bunny | Hamster;
  readonly size: number;
  /** px per puppet unit */
  readonly unit: number;
  readonly box: HTMLElement;
  /** placement and fade (px): the whole puppet */
  readonly travel: Track;
  /** lift (y) and tilt (r) about the feet */
  readonly lift: Track;
  /** rotation about the body's centre (a roll) */
  readonly spin: Track;
  /** squash and stretch about the feet */
  readonly squash: Track;
  readonly home: { x: number; y: number };
  private readonly panel: Panel;
  private readonly parts = new Map<string, Track>();
  private readonly feetPx: number;

  constructor(panel: Panel, kind: Kind, o: ActorOptions, parent: HTMLElement) {
    this.panel = panel;
    this.kind = kind;
    this.size = o.size;
    const rig = RIG[kind];
    const k = o.size / 400;
    this.unit = k * rig.scale;
    this.feetPx = rig.feetY * k;
    this.home = { x: o.x, y: o.feetY };
    const name = o.label ?? kind;
    this.box = panel.node('', `left:${o.x - o.size / 2}px;top:${o.feetY - this.feetPx}px;width:${o.size}px;height:${rig.viewH * k}px;z-index:${o.z ?? 4}`, 'sp-actor', parent);
    const lift = panel.node('', `inset:0;transform-origin:50% ${this.feetPx}px`, 'sp', this.box);
    // the body's centre: about 90 puppet units above the feet (both puppets)
    const spin = panel.node('', `inset:0;transform-origin:50% ${this.feetPx - 90 * this.unit}px`, 'sp', lift);
    const sq = panel.node('', `inset:0;transform-origin:50% ${this.feetPx}px`, 'sp', spin);
    const host = panel.node('', `inset:0${o.flip ? ';transform:scaleX(-1)' : ''}`, 'sp', sq);
    const common = { size: o.size, idle: false, interactive: false, reducedMotion: 'force' as const };
    this.puppet = kind === 'bunny'
      ? new Bunny(host, { ...common, coat: (o.coat as BunnyCoat | undefined) ?? 'fawn', ears: o.ears ?? 'lop' })
      : new Hamster(host, { ...common, coat: (o.coat as HamsterCoat | undefined) ?? 'golden' });
    const style = document.createElement('style');
    style.textContent = DRIVEN_CSS;
    this.puppet.root.append(style);
    if (o.ink) inkify(this.puppet.root, o.ink);
    // The panel owns the clock: the puppet's own offscreen pausing would pause only ITS animations and later resume a
    // frame the page froze (the same reason as demo/tapsi/stage.ts). Its idle is off, so nothing else is lost.
    (this.puppet as unknown as { idle?: { destroy(): void } }).idle?.destroy();
    panel.own(this.puppet);
    if (o.eyes && o.eyes !== 'normal') this.puppet.setEyes(o.eyes);
    if (o.puff !== undefined) this.puppet.setPuff(o.puff);
    if (o.turn) this.hm().classList.add(o.turn === 'l' ? 'turn-l' : 'turn-r');
    this.travel = panel.track(this.box, { x: 0, y: 0, o: 1 }, `${name}.travel`);
    this.lift = panel.track(lift, { y: 0, r: 0 }, `${name}.lift`);
    this.spin = panel.track(spin, { r: 0 }, `${name}.spin`);
    this.squash = panel.track(sq, { sx: 1, sy: 1 }, `${name}.squash`);
  }

  /** The puppet's root group (the pose classes live on it). */
  hm(): SVGGElement {
    return this.el<SVGGElement>('.hm');
  }

  el<T extends Element = SVGGElement>(selector: string): T {
    const found = this.puppet.root.querySelector<T & Element>(selector);
    if (!found) throw new Error(`[story] missing part ${selector}`);
    return found;
  }

  /**
   * A track on the puppet's own part(s), made on first use (a part nobody poses keeps its CSS, e.g. a turn).
   * `all` = every match (both eyes, both cheeks).
   */
  part(selector: string, base: ChannelInput = {}, all = false): Track {
    const hit = this.parts.get(selector);
    if (hit) return hit;
    const els = all ? [...this.puppet.root.querySelectorAll(selector)] : [this.el(selector)];
    const t = this.panel.track(els, base, `${this.kind}${selector}`);
    this.parts.set(selector, t);
    return t;
  }

  /** Panel px of a point in puppet units (0, 0 = between the feet), for the puppet at its home spot. */
  at(ux: number, uy: number): { x: number; y: number } {
    return { x: this.home.x + this.unit * ux, y: this.home.y + this.unit * uy };
  }

  /** An extra drawing inside the puppet, in puppet units (moves and breathes with it). */
  wear(markup: string, where: 'front' | 'back' | 'paws' = 'front'): SVGGElement {
    const breathe = this.el('.breathe');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = markup;
    if (where === 'back') breathe.prepend(g);
    else if (where === 'paws') breathe.insertBefore(g, breathe.querySelector('.tp'));
    else breathe.append(g);
    return g;
  }

  /** An extra drawing inside one of the puppet's own parts (it follows that part: an ear, a cheek). */
  wearOn(selector: string, markup: string): SVGGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.innerHTML = markup;
    this.el(selector).append(g);
    return g;
  }

  /**
   * Both paws over the mouth, head a little to one side: the app's approved «Psst» (demo/tapsi/scenes.ts PSST, the
   * end pose of the reservation moment M17), in puppet units.
   */
  psst(): void {
    this.part('.paws', { y: this.kind === 'hamster' ? -30 : -24 });
    this.part('.paw-l', { x: 5, y: 0, r: 20 });
    this.part('.paw-r', { x: -5, y: 0, r: -36 });
    this.part('.tf', { r: -8 });
    this.part('.te', { r: -5 }, true);
  }
}

export class Panel {
  /** the w × h world (a v1 panel: PW × PH; the v2 strip: one tall world) */
  readonly root: HTMLElement;
  readonly w: number;
  readonly h: number;
  /**
   * The timeline new tracks belong to (v2 strip: 'roll', a moment's name, '' = still). A panel of v1 never sets
   * it: all its tracks are one timeline.
   */
  scope = '';
  /** Where new nodes, layers, props and actors go (v4: inside a clipped manga panel); default the world itself. */
  parent: HTMLElement;
  private readonly list: Track[] = [];
  private readonly scopeOf = new Map<Track, string>();
  private readonly owned: { destroy(): void }[] = [];
  private playhead: Playhead | null = null;
  private clock: Animation | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finish: (() => void) | null = null;
  /** seconds of the panel's "comes alive" moment (0 = a still panel) */
  duration = 0;

  constructor(root: HTMLElement, size: { w: number; h: number; clip?: boolean } = { w: PW, h: PH }) {
    this.root = root;
    this.w = size.w;
    this.h = size.h;
    this.parent = root;
    root.classList.add('sp-world');
    root.style.cssText = `position:relative;width:${size.w}px;height:${size.h}px;overflow:${size.clip === false ? 'visible' : 'hidden'}`;
  }

  get tracks(): readonly Track[] {
    return this.list;
  }

  /** The tracks made while `scope` was `name`. */
  tracksIn(name: string): Track[] {
    return this.list.filter((t) => this.scopeOf.get(t) === name);
  }

  get live(): boolean {
    return this.playhead !== null;
  }

  track(el: Element | readonly Element[], base: ChannelInput, name: string): Track {
    const t = new Track(el, name, base);
    this.list.push(t);
    this.scopeOf.set(t, this.scope);
    return t;
  }

  /** An absolutely placed element (left / top / size in panel px through `style`). */
  node(html: string, style: string, cls = 'sp', parent: HTMLElement = this.parent): HTMLElement {
    const el = document.createElement('div');
    el.className = cls;
    if (html) el.innerHTML = html;
    el.style.cssText = `position:absolute;${style}`;
    parent.append(el);
    return el;
  }

  /** A full-panel SVG layer in panel px (viewBox 0 0 w h). */
  layer(markup: string, z = 1, cls = 'sp'): HTMLElement {
    const { w, h } = this;
    return this.node(`<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" style="display:block;overflow:visible">${markup}</svg>`, `left:0;top:0;width:${w}px;height:${h}px;z-index:${z};pointer-events:none`, cls);
  }

  /** An SVG layer over a band of the world only (y0 … y1, full width), drawn in world px (viewBox offset). */
  band(markup: string, y0: number, y1: number, z = 1, cls = 'sp'): HTMLElement {
    const { w } = this;
    const h = y1 - y0;
    return this.node(`<svg viewBox="0 ${y0} ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" style="display:block;overflow:visible">${markup}</svg>`, `left:0;top:${y0}px;width:${w}px;height:${h}px;z-index:${z};pointer-events:none`, cls);
  }

  /** A small SVG centred on (x, y): `view` = its viewBox, w × h px. */
  prop(markup: string, view: string, x: number, y: number, w: number, h: number, z = 3): HTMLElement {
    return this.node(`<svg viewBox="${view}" width="${w}" height="${h}" aria-hidden="true" style="display:block;overflow:visible">${markup}</svg>`, `left:${x - w / 2}px;top:${y - h / 2}px;width:${w}px;height:${h}px;z-index:${z};pointer-events:none`);
  }

  actor(kind: Kind, o: ActorOptions): Actor {
    return new Actor(this, kind, o, this.parent);
  }

  own(thing: { destroy(): void }): void {
    this.owned.push(thing);
  }

  /** The last key of any track (s). */
  get end(): number {
    return this.list.reduce((m, t) => Math.max(m, Number.isFinite(t.end) ? t.end : 0), 0);
  }

  /** A still: every track's value at `t` written inline, no animation (default: the end pose). */
  still(t = this.duration): void {
    for (const tr of this.list) inline(tr.els, tr.styleAt(t));
  }

  /** Compiles every track into Web Animations, paused at 0 (a panel that comes alive). */
  build(): void {
    if (this.playhead) return;
    const ph = new Playhead();
    this.playhead = ph;
    for (const tr of this.list) {
      inline(tr.els, tr.baseStyle());
      for (const c of tr.compile()) ph.add(c, tr.name);
    }
    const anchor = this.root as HTMLElement & { animate?: Element['animate'] };
    if (typeof anchor.animate === 'function') {
      // an empty clock: the page reads the time from it while playing (it moves nothing)
      this.clock = ph.adopt(anchor.animate([], { duration: Math.max(1, this.end * 1000), fill: 'forwards' }), this.end * 1000);
    }
    this.seek(0);
  }

  seek(seconds: number): void {
    this.stopTimer();
    if (!this.playhead) this.build();
    this.playhead?.seek(Math.max(0, seconds) * 1000);
  }

  /** Runs once from `from` (s) to the last key; resolves at the end (or when interrupted). */
  play(from = 0): Promise<void> {
    this.stopTimer();
    if (!this.playhead) this.build();
    this.playhead?.playFrom(Math.max(0, from) * 1000);
    return new Promise<void>((resolve) => {
      this.finish = resolve;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.finish = null;
        resolve();
      }, Math.max(0, this.end - from) * 1000 + 40);
    });
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** The playhead's time in seconds (0 for a still). */
  get time(): number {
    const t = this.clock?.currentTime;
    return typeof t === 'number' ? t / 1000 : 0;
  }

  /** Every Web Animation of the panel (tests). */
  get animations(): Animation[] {
    return this.playhead?.animations ?? [];
  }

  destroy(): void {
    this.stopTimer();
    this.playhead?.cancel();
    this.playhead = null;
    this.clock = null;
    this.owned.forEach((o) => o.destroy());
    this.owned.length = 0;
    this.root.replaceChildren();
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const f = this.finish;
    this.finish = null;
    f?.();
  }
}

function inline(els: readonly Element[], st: StyleOut | null): void {
  if (!st) return;
  for (const el of els) {
    const s = (el as HTMLElement | SVGElement).style;
    if (st.transform !== undefined) s.transform = st.transform;
    if (st.opacity !== undefined) s.opacity = st.opacity;
  }
}
