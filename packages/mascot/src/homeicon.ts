/**
 * «Здесь я буду жить» (ideas doc 2026-10-26 §1.5) — the onboarding step "Zum Home-Bildschirm" (iOS Safari only,
 * once per device). Approved by Felix 27.10 («хорошо»), moved here from the gallery (demo/homeicon) as the package
 * entry `@bunprise/mascot/homeicon` — only the onboarding step loads it. A frame in the shape of the app icon (apps/web/public/icons/icon.svg: rounded
 * square, the orange gradient, the darker bar at the bottom) slides up from behind the card's top edge; Pompon climbs
 * onto the bar's top edge with the approved climb of the welcome stage (the exported Peeker itself: ear tips, the paws
 * come up and grip the edge, the wind-up, the pull) and settles into EXACTLY the icon's pose — eyes up and big, the
 * head a little lower, the paws where the icon has them — and freezes: he IS the icon now. Then the frame softly
 * scales down to a home-screen icon and its name fades in under it. ≈ 2.4 s, only transform / opacity, finite.
 * He never points at anything (iOS puts "Teilen" in different places).
 *
 * Reduced motion — and `still` (it already played on this device): the static icon composition (the end frame) fades
 * in — no animate() call. While it plays it pauses when the host is off screen or the tab is hidden (drive.ts Watch).
 *
 * Icon geometry (icon.svg, 1024 units): the bunny is 4.85 mascot units per icon unit, its centre line at 512, its
 * feet at 1131 (below the frame), the edge line at 840 (= 60 units above the feet), the paws at ±25 with their
 * centre 1.5 units above the edge, the face lifted 4 units, the eyes 1.34× with the highlights a little higher.
 */

import { ReducedMotion } from './core';
import { CssFade, Driver, freezeAt, LAYER_CSS, sampleTracks, Watch } from './drive';
import { Track, type Sampled, type StyleOut } from './timeline';
import type { ReducedMotionMode } from './types';
import { E, Peeker, placePeek, type PeekPlace, type StageGeo } from './welcome-actors';

/** icon.svg numbers (1024 units). */
export const ICON = {
  /** mascot units per icon unit (the bunny is drawn at scale 4.85) */
  scale: 4.85,
  /** the edge line (top of the bar), icon units from the top */
  edge: 840,
  /** the bunny's feet (its local origin), icon units from the top */
  feet: 1131,
  /** the icon's paws: centre x ±25, centre 1.5 units above the edge (y −61.5 with the edge at −60) */
  pawX: 25,
  pawLift: 1.5,
  /** face group translate(0 −4), eyes 8.3 × 9.9 instead of 6.2 × 7.4 */
  faceY: -4,
  eye: 8.3 / 6.2,
  /** highlights: the big one 4.82 above the eye centre (the puppet ×1.34 gives 3.62), the small one 3.42 below (4.02) */
  hiBig: -(4.82 - 2.7 * (8.3 / 6.2)) / (8.3 / 6.2),
  hiSmall: -(4.02 - 3.42) / (8.3 / 6.2),
} as const;

/** The welcome stage's peek line: the edge crosses the centre line DEPTH units above the feet (welcome-actors). */
const PEEK_DEPTH = 56;
/** The gripping paw's centre is this far above its origin (the bottom middle; welcome-actors gripPaw). */
const PAW_CENTRE = 10;

/** The beats (s). */
export const BEATS = {
  /** the frame starts to slide up from behind the card */
  rise: 0.04,
  riseDur: 0.5,
  /** Pompon's ear tips (the approved climb starts) */
  climb: 0.3,
  /** after the climb, s after `climb`: the blink that opens on the icon's look */
  settle: 1.25,
  settleDur: 0.3,
  /** the frame scales down */
  shrink: 2.0,
  shrinkDur: 0.4,
  /** its name fades in under it */
  label: 2.14,
  labelDur: 0.26,
} as const;

/** Reduced motion: the static composition fades in this long (s). */
export const RM_FADE = 0.45;

/** The home-screen size against the onboarding size of the frame. */
export const SHRINK = 0.6;
/** iOS icon corner (the superellipse approximated by a circle radius): 22.37 % of the side. */
export const CORNER = 0.2237;

export interface HomeIconOptions {
  /** 'force' = the static composition, 'off' = always the show, 'auto' (default) = the OS setting */
  reducedMotion?: ReducedMotionMode;
  /** shorthand for reducedMotion: 'force' (true) / 'off' (false) — the gallery and the tests */
  reduced?: boolean;
  /** start at the end composition, still (it already played on this device): faded in like reduced motion */
  still?: boolean;
  /** the frame's side, px (default: 45 % of the host width, 150–200) */
  size?: number;
  /** the frame's resting bottom, px above the host's bottom (the card's top edge) */
  lift?: number;
  /** the app's name under the shrunk icon (null = none) */
  label?: string | null;
  onEnd?: () => void;
}

const CSS = `
.tile { position: absolute; left: 0; top: 0; border-radius: ${CORNER * 100}%; overflow: hidden; background: linear-gradient(180deg, #F6C07E 0%, #F0A04B 100%);
  box-shadow: 0 14px 30px -14px rgba(120,60,10,.55), 0 2px 6px rgba(120,60,10,.12); --mascot-outline: none; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; background: #E5923D; }
.label { position: absolute; left: 0; width: 100%; text-align: center; font: 600 13px/16px -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif; color: var(--text, #2A231C); opacity: 0; }
.rm { opacity: 0; }
.rm.on { animation: hi-rm ${RM_FADE}s ease-out both; }
@keyframes hi-rm { from { opacity: 0; } to { opacity: 1; } }
`;

/** For a frame of side S (px): px per bunny unit (the icon's scale) and the bar's height. */
export function iconGeometry(S: number): { u: number; bar: number } {
  return { u: (ICON.scale * S) / 1024, bar: ((1024 - ICON.edge) / 1024) * S };
}

/** Units between the edge and the feet in the icon (60); the peek leaves 56 (the head sinks the rest). */
export const ICON_DEPTH = (ICON.feet - ICON.edge) / ICON.scale;

/** The step's icon scene: the frame rises, Pompon climbs in and becomes the icon, the frame shrinks (≈ 2.4 s). */
export class HomeIconStage {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  /** reduced motion: the static composition, faded in */
  readonly reduced: boolean;
  /** no show at all: the static composition (reduced motion, or `still`) */
  readonly isStatic: boolean;
  /** Resolves when the show is over (its natural end, or the fade-in of the static composition), stop() or destroy(). */
  readonly done: Promise<void>;
  readonly duration: number;
  readonly size: number;
  /** the frame's resting place in the host (px; its scale origin is its centre) */
  readonly rest: { x: number; y: number };
  readonly tracks: Sampled[] = [];
  readonly place: PeekPlace;
  private readonly driver: Driver | null = null;
  private readonly peeker: Peeker;
  private readonly fade: CssFade | null = null;
  private readonly onEnd: (() => void) | undefined;
  private readonly watch: Watch;
  private resolveDone!: () => void;
  private ended = false;
  private destroyed = false;

  constructor(host: HTMLElement, options: HomeIconOptions = {}) {
    this.host = host;
    const mode: ReducedMotionMode = options.reduced === undefined ? (options.reducedMotion ?? 'auto') : options.reduced ? 'force' : 'off';
    const rm = new ReducedMotion(mode);
    this.reduced = rm.matches;
    rm.destroy();
    this.isStatic = this.reduced || Boolean(options.still);
    this.onEnd = options.onEnd;
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    const W = host.clientWidth || 390;
    const H = host.clientHeight || 300;
    const lift = options.lift ?? 34;
    // never taller than the room above the card (8 px free at the top)
    const S = Math.round(options.size ?? Math.max(96, Math.min(200, W * 0.45, H - lift - 8)));
    this.size = S;
    this.rest = { x: Math.round((W - S) / 2), y: Math.round(H - lift - S) };
    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${LAYER_CSS}${CSS}</style><div class="stage" aria-hidden="true"></div>`;
    const stage = this.root.querySelector<HTMLDivElement>('.stage');
    if (!stage) throw new Error('[homeicon] stage failed to mount');

    // frame (placed + scaled) > tile (the icon: gradient, rounded, clips) > clip (the bunny behind the bar) + bar + paws
    const frame = document.createElement('div');
    frame.className = 'frame';
    frame.style.width = `${S}px`;
    frame.style.height = `${S}px`;
    frame.style.transformOrigin = '50% 50%';
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.width = `${S}px`;
    tile.style.height = `${S}px`;
    const { u, bar } = iconGeometry(S);
    const clip = document.createElement('div');
    clip.className = 'clip';
    clip.style.inset = `0 0 ${bar}px 0`;
    const barEl = document.createElement('div');
    barEl.className = 'bar';
    barEl.style.height = `${bar}px`;
    const paws = document.createElement('div');
    paws.className = 'layer paws';
    tile.append(clip, barEl, paws);
    frame.append(tile);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = options.label === undefined ? 'Bunprise' : (options.label ?? '');
    stage.append(frame, label);
    // the label sits under the SHRUNK icon (the frame scales about its centre)
    label.style.top = `${this.rest.y + S / 2 + (S * SHRINK) / 2 + 7}px`;
    label.style.display = options.label === null ? 'none' : '';

    const geo: StageGeo = { W: S, H: S, u0: u, inset: { bottom: bar, top: 0, left: 0, right: 0 } };
    this.place = placePeek({ edge: 'bottom', pos: 0.5, tilt: 0, floor: false, reveal: 0, turn: false }, u, geo);
    this.peeker = new Peeker('p0', 'fawn', u, clip, { x: 0, y: 0 }, paws, this.place);
    const t0 = BEATS.climb;
    const settled = this.peeker.peek({ at: t0, place: this.place, hold: 0, look: [], sniff: false, greet: false, stay: true, lookFrom: BEATS.settle });
    this.tracks.push(...this.peeker.tracks, ...this.peeker.loops);
    this.iconPose(settled, u, clip);

    // the frame: slides up from behind the card (the host's bottom = the card's top edge), later shrinks
    const hidden = H - this.rest.y + 6;
    const ft = new Track(frame, 'icon.frame', { x: this.rest.x, y: this.rest.y + hidden, s: 1 });
    ft.move(BEATS.rise, BEATS.rise + BEATS.riseDur, { y: this.rest.y }, E.out);
    ft.move(BEATS.shrink, BEATS.shrink + BEATS.shrinkDur, { s: SHRINK }, E.out);
    const lt = new Track(label, 'icon.label', { o: 0 });
    lt.move(BEATS.label, BEATS.label + BEATS.labelDur, { o: options.label === null ? 0 : 1 }, 'ease-out');
    this.tracks.push(ft, lt);
    const motion = Math.round((BEATS.label + BEATS.labelDur + 0.02) * 1000) / 1000;

    if (this.isStatic) {
      // the static icon composition: the end frame, faded in by CSS (no animate() call); its "duration" is the fade
      freezeAt(this.tracks, motion);
      stage.classList.add('rm');
      this.duration = RM_FADE;
      this.fade = new CssFade(stage, 'on', RM_FADE, () => this.finish());
    } else {
      this.duration = motion;
      this.driver = new Driver(stage, this.tracks, this.duration, () => this.finish());
    }
    this.watch = new Watch(host, (this.driver ?? this.fade) as Driver | CssFade);
  }

  /** Mid-show (the app's one-mascot-at-a-time arbiter asks this). */
  get busy(): boolean {
    return !this.destroyed && !this.ended && this.playing;
  }

  /** Playing, but waiting while the host is off screen or the tab is hidden. */
  get suspended(): boolean {
    return this.watch.suspended;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** The show reached its end (or was stopped). */
  get hasEnded(): boolean {
    return this.ended;
  }

  private finish(): void {
    if (this.ended || this.destroyed) return;
    this.ended = true;
    this.watch.stop();
    this.onEnd?.();
    this.resolveDone();
  }

  /**
   * After the climb (t = when it is settled): a blink that opens on the icon's look — the face lifted 4 units, the
   * eyes 1.34× (each about its own centre, the highlights a little higher, as drawn in icon.svg) — while the head
   * sinks the last 4 units into the icon's place (the icon's edge is 60 units above the feet, the peek's 56) and the
   * paws shift the 1 unit to the icon's spots. Then nothing moves.
   */
  private iconPose(t: number, u: number, clip: HTMLElement): void {
    const named = (n: string) => this.peeker.tracks.find((x) => x.name === `p0.${n}`) as Track | undefined;
    const svg = clip.querySelector('.actor')?.shadowRoot?.querySelector('svg');
    if (!svg) return;
    const ts = t + 0.06;
    const dur = BEATS.settleDur;
    // the head: 4 units lower (the lift is in px, straight out through the edge: + = into it)
    named('lift')?.move(ts, ts + dur, { x: 0, y: (ICON_DEPTH - PEEK_DEPTH) * u }, E.inOut);
    // the face, with its blush: lifted 4 units (icon.svg <g transform="translate(0 -4)">)
    const tf = svg.querySelector('.tf');
    if (tf) this.tracks.push(new Track(tf, 'icon.tf', { y: 0 }).move(ts, ts + dur * 0.8, { y: ICON.faceY }, E.face));
    // each eye about its own centre (scaling the .eyes group would move them apart), as the blink opens
    svg.querySelectorAll('.eyes .eye').forEach((eye, i) => {
      this.tracks.push(new Track(eye, `icon.eye${i}`, { s: 1 }).move(ts + 0.04, ts + dur * 0.8, { s: ICON.eye }, E.out));
      const [big, small] = eye.querySelectorAll('circle');
      if (big) this.tracks.push(new Track(big, `icon.hi${i}`, { y: 0 }).move(ts + 0.04, ts + dur * 0.8, { y: ICON.hiBig }, E.out));
      if (small) this.tracks.push(new Track(small, `icon.lo${i}`, { y: 0 }).move(ts + 0.04, ts + dur * 0.8, { y: ICON.hiSmall }, E.out));
    });
    // the paws to the icon's spots: centre x ±25, 1.5 units above the edge (bunny space: the edge at −PEEK_DEPTH)
    const pawY = -PEEK_DEPTH - ICON.pawLift + PAW_CENTRE;
    for (const [side, x] of [['L', -ICON.pawX], ['R', ICON.pawX]] as const) {
      const T = named(`paw${side}`);
      T?.move(Math.max(ts, T.end), ts + dur * 0.7, { x, y: pawY, r: 0, sx: 1, sy: 1 }, E.inOut);
    }
  }

  get time(): number {
    return this.driver?.time ?? this.fade?.time ?? 0;
  }

  get playing(): boolean {
    return (this.driver?.playing ?? this.fade?.playing ?? false) || this.watch.suspended;
  }

  get animations(): readonly Animation[] {
    return this.driver?.animations ?? [];
  }

  /** Plays from the start (or from where pause() / seek() left it); waits while the host cannot be seen. */
  play(): void {
    if (this.destroyed) return;
    this.ended = false;
    this.watch.start();
  }

  /** Freezes the current frame. */
  pause(): void {
    this.watch.stop();
    this.driver?.pause();
    this.fade?.pause();
  }

  /** Freezes the exact frame at `seconds` (deterministic: every animation gets the same currentTime). */
  seek(seconds: number): void {
    if (this.destroyed) return;
    this.watch.stop();
    this.driver?.seek(seconds);
    this.fade?.seek(seconds);
  }

  /** Back to before the start; `done` resolves (a stopped show is over). */
  stop(): void {
    this.watch.stop();
    this.driver?.stop();
    this.fade?.stop();
    if (!this.destroyed) this.resolveDone();
  }

  /** Styles of every animated part at `seconds`. */
  sample(seconds: number): Record<string, StyleOut> {
    return sampleTracks(this.tracks, seconds);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.watch.destroy();
    this.driver?.destroy();
    this.fade?.stop();
    this.peeker.remove();
    this.root.innerHTML = '';
    this.resolveDone();
  }
}
