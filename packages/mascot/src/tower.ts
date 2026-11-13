/**
 * «Парад» v2 — «Бременская башня» (ideas doc 2026-10-26 §1.6; approved by Felix 26.10: «выглядит теперь круто,
 * оставляем»; in the app since 27.10 — the Profil easter egg). Package entry `@bunprise/mascot/tower`: a screen
 * that does not play it never loads it. After 5 taps on the version line at the bottom of "Profil" the bunnies build
 * a tower on the top edge of the "Abmelden" card:
 *
 *   broken hops in from the left and turns to you; chocolate comes from the right and jumps onto its head, the
 *   himalayan from the left onto chocolate's — every landing squashes everybody below (the push travels down,
 *   eyes squeeze, ears flick). Pompon comes last, looks up at the tower (a sniff, a blink), crouches deep and leaps
 *   to the top; the tower sways. He turns to you, star eyes — and does a binky (the rabbit joy jump: a twist in the
 *   air, the hind feet kick). He lands a little off-centre; the tower starts to lean ("uh-oh": wide eyes), and they
 *   bail out top-down in alternating directions (Pompon right, himalayan left, chocolate right; broken drops back on
 *   both feet), land, and hop off. ≈ 5 s, nothing loops.
 *
 * The placement of every bunny comes from ONE rig (tower-plan.ts poseAt, sampled into keys), its limbs and face are
 * keys on the same timeline (tower-actor.ts). Only transform / opacity; seek(t) gives the same frame every time
 * (drive.ts Driver). The show pauses while its host is off screen or the tab is hidden and resumes there (drive.ts
 * Watch).
 *
 * Reduced motion ("Weniger"): as in v1 — four heads peek motionless over the same edge (paws on the edge, like the
 * app icon) for 2 s, fading in and out (opacity only; CSS, not a single animate() call).
 */

import { CssFade, Driver, freezeAt, LAYER_CSS, sampleTracks, Watch } from './drive';
import { TowerBunny, type Facing } from './tower-actor';
import { BEAT, bake, breakpoints, EDGE_INSET, FRIEND_SCALE, FRIENDS, HALF_WIDTH, HOST_H, paradeUnit, poseAt, towerPlan, type TowerPlan } from './tower-plan';
import type { Sampled, StyleOut } from './timeline';
import type { BunnyCoat } from './types';
import { cardOutline } from './welcome';
import { Peeker, placePeek, type StageGeo } from './welcome-actors';

export { EDGE_INSET as TOWER_EDGE_INSET, HOST_H as TOWER_HOST_H } from './tower-plan';
export type { TowerPlan } from './tower-plan';

/** Reduced motion: fade in, hold, fade out (s). */
export const RM = { fadeIn: 0.45, hold: 2, fadeOut: 0.45 } as const;

export interface TowerOptions {
  /** true = the calm alternative (four still heads, opacity only). The app maps its motion level to this. */
  reduced: boolean;
  /** px between the host's bottom and the card's top edge (the line they stand on). Default 16. */
  inset?: number;
  /** the card under the line, host px (reduced motion: the heads peek over it, the clip follows its corners) */
  card?: { left: number; width: number; radius: number };
  /** once, when the show is over (not after stop() / destroy()) */
  onEnd?: () => void;
}

/** @deprecated gallery name — use TowerOptions. */
export type ParadeOptions = TowerOptions;

const RM_TOTAL = RM.fadeIn + RM.hold + RM.fadeOut;
const pct = (s: number) => `${Math.round((s / RM_TOTAL) * 1000) / 10}%`;
/** The reduced-motion fade (opacity only, a CSS animation: no animate() call under reduced motion). */
const RM_CSS = `
.rm { position: absolute; top: 0; bottom: 0; opacity: 0; }
.rm.on { animation: pr-rm ${RM_TOTAL}s linear both; }
@keyframes pr-rm { 0% { opacity: 0; animation-timing-function: ease-out; } ${pct(RM.fadeIn)} { opacity: 1; } ${pct(RM.fadeIn + RM.hold)} { opacity: 1; animation-timing-function: ease-in; } 100% { opacity: 0; } }
`;

const side = (dir: 1 | -1): Facing => (dir === 1 ? 'r' : 'l');

/** Authors one bunny's limbs and face along the plan (events sorted by time: every track gets its keys in order). */
function choreograph(p: TowerPlan, k: number, a: TowerBunny): void {
  const m = p.members[k];
  if (!m) return;
  const ev: Array<[number, () => void]> = [];
  const at = (t: number, fn: () => void) => ev.push([t, fn]);
  const enterEnd = (m.enter[m.enter.length - 1]?.t ?? 0) + (m.enter[m.enter.length - 1]?.d ?? 0);
  for (const h of m.enter) at(h.t, () => a.hop(h, m.inDir));
  at(enterEnd, () => a.settle(enterEnd));

  if (k === 0) {
    // the bottom one: turns to you and watches chocolate come
    at(enterEnd + 0.04, () => a.turn(enterEnd + 0.04, 'front'));
    const c = p.members[1]?.jump;
    if (c) {
      at(c.crouch - 0.1, () => a.look(c.crouch - 0.1, c.crouch + 0.02, 2.4, -1));
      at(c.up + 0.06, () => a.look(c.up + 0.06, c.up + 0.2, 0.6, -3.5));
      at(c.land + 0.12, () => a.look(c.land + 0.12, c.land + 0.3, 0, 0));
    }
  } else if (m.jump) {
    const j = m.jump;
    // waits beside the tower and looks up at the crown it is going to land on
    at(enterEnd + 0.02, () => a.look(enterEnd + 0.02, enterEnd + 0.18, m.inDir * 1.5, -3));
    if (k === 3) {
      // Pompon: the hesitation — looks all the way up, leans back, sniffs; the himalayan landing makes him blink
      at(BEAT.look, () => {
        a.look(BEAT.look, BEAT.look + 0.16, m.inDir * 2, -5);
        a.lean(BEAT.look, BEAT.look + 0.24, -m.inDir * 8);
      });
      at(BEAT.look + 0.2, () => a.sniff(BEAT.look + 0.2));
      const h = p.members[2]?.jump;
      if (h) at(h.land + 0.03, () => a.blink(h.land + 0.03));
      // upright again for the crouch (the wind-up brings the ears forward)
      at(j.crouch, () => a.lean(j.crouch, j.up, 0, 'ease-in-out', false));
    }
    at(j.crouch, () => a.windUp(j.crouch, j.up));
    at(j.up, () => {
      a.shadow(j.up, false);
      a.air(j.up, j.land, m.inDir);
    });
    at(j.land, () => a.look(j.land, j.land + 0.16, 0, 0));
    at(j.land + 0.06, () => a.turn(j.land + 0.06, 'front'));
  }

  // being landed on: the push reaches it a little later the lower it is
  for (let up = k + 1; up < p.members.length; up++) {
    const uj = p.members[up]?.jump;
    if (!uj) continue;
    const t = uj.land + 0.035 * (up - k);
    at(t, () => a.jolt(t, up === 3 ? 1.15 : 0.8));
  }

  if (k === 3) {
    // on top: turns to you, a blink on the turn that opens as stars
    at(BEAT.front, () => a.turn(BEAT.front, 'front'));
    at(BEAT.front + 0.1, () => a.stars(BEAT.front + 0.1));
    const b = p.binky;
    at(b.crouch, () => a.windUp(b.crouch, b.up));
    at(b.up, () => a.binky(b.up, b.land));
    at(BEAT.uhOh, () => {
      a.unstar(BEAT.uhOh);
      a.mouth(BEAT.uhOh + 0.06, 'o');
    });
  } else {
    // everybody looks up at Pompon on top; the binky landing shakes them (ears only)
    at(BEAT.front + 0.16, () => a.look(BEAT.front + 0.16, BEAT.front + 0.32, 0, -3.5));
    const tb = p.binky.land + 0.035 * (3 - k);
    at(tb, () => {
      const { L, R } = a.ears();
      L.move(Math.max(tb, L.end), Math.max(tb + 0.07, L.end + 0.03), { r: 5 }, 'ease-out');
      R.move(Math.max(tb, R.end), Math.max(tb + 0.07, R.end + 0.03), { r: -5 }, 'ease-out');
      L.move(Math.max(tb + 0.07, L.end), Math.max(tb + 0.3, L.end + 0.03), { r: 0 }, 'ease-in-out');
      R.move(Math.max(tb + 0.07, R.end), Math.max(tb + 0.3, R.end + 0.03), { r: 0 }, 'ease-in-out');
    });
    // uh-oh: the tower leans — wide eyes, a glance to the side it leans to
    at(BEAT.uhOh + 0.03 * k, () => {
      a.widen(BEAT.uhOh + 0.03 * k);
      a.look(BEAT.uhOh + 0.03 * k, BEAT.uhOh + 0.12 + 0.03 * k, 3, -2);
    });
  }

  // bail out, land, hop off
  if (k === 0) {
    at(m.ground, () => {
      a.slap(m.ground, 0.7);
      a.look(m.ground, m.ground + 0.14, 0, 0);
    });
    at(m.ground + 0.04, () => a.blink(m.ground + 0.04));
    at(m.ground + 0.08, () => a.turn(m.ground + 0.08, side(m.outDir)));
  } else if (m.fall) {
    const f = m.fall;
    at(f.t0 - 0.09, () => a.windUp(f.t0 - 0.09, f.t0));
    at(f.t0 - 0.07, () => {
      a.turn(f.t0 - 0.07, side(m.outDir));
      a.look(f.t0 - 0.07, f.t0 + 0.1, 0, 0);
    });
    at(f.t0, () => a.air(f.t0, f.t1, m.outDir));
    at(f.t1, () => a.shadow(f.t1, true));
    if (k === 3) at(f.t1, () => a.mouth(f.t1, 'rest'));
  }
  at(m.ground + 0.1, () => a.widen(m.ground + 0.1, 1));
  for (const h of m.exit) at(h.t, () => a.hop(h, m.outDir));

  ev.sort((x, y) => x[0] - y[0]);
  for (const [, fn] of ev) fn();
}

/**
 * The tower show in `host` (a positioned box, ≈ 390 px high, the full screen width; its bottom edge `inset` px below
 * the card's top edge; pointer-events none). Built frozen at 0: play() starts it, seek(t) freezes any frame.
 */
export class TowerStage {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly reduced: boolean;
  readonly plan: TowerPlan;
  readonly duration: number;
  /** every authored track (motion), for sample() and the tests */
  readonly tracks: Sampled[] = [];
  /** Resolves when the show is over (its natural end, stop() or destroy()). */
  readonly done: Promise<void>;
  private readonly stageEl: HTMLDivElement;
  private readonly driver: Driver | null = null;
  private readonly fade: CssFade | null = null;
  private readonly watch: Watch;
  private readonly actors: TowerBunny[] = [];
  private readonly peekers: Peeker[] = [];
  private readonly onEnd: (() => void) | undefined;
  private resolveDone!: () => void;
  private destroyed = false;
  private running = false;

  constructor(host: HTMLElement, options: TowerOptions) {
    this.host = host;
    this.reduced = options.reduced;
    this.onEnd = options.onEnd;
    this.done = new Promise((r) => {
      this.resolveDone = r;
    });
    const inset = options.inset ?? EDGE_INSET;
    const W = host.clientWidth || 390;
    const H = host.clientHeight || HOST_H;
    this.plan = towerPlan(W, H, inset);
    this.root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${LAYER_CSS}${RM_CSS}</style><div class="stage" aria-hidden="true"></div>`;
    const stage = this.root.querySelector<HTMLDivElement>('.stage');
    if (!stage) throw new Error('[tower] stage failed to mount');
    this.stageEl = stage;
    const ended = () => this.ended();

    if (this.reduced) {
      const card = options.card ?? { left: 16, width: W - 32, radius: 22 };
      this.fade = new CssFade(this.buildStill(card, H, W, inset), 'on', RM_TOTAL, ended);
      this.duration = RM_TOTAL;
    } else {
      const layer = document.createElement('div');
      layer.className = 'layer tower';
      stage.append(layer);
      this.duration = this.plan.duration;
      const corners = breakpoints(this.plan);
      // bottom to top: an upper bunny is drawn over the one it stands on (its feet on the crown)
      this.plan.members.forEach((m, k) => {
        const a = new TowerBunny(`t${k}`, m.coat, m.u, layer, side(m.inDir), poseAt(this.plan, k, 0));
        a.place(bake((t) => poseAt(this.plan, k, t), 0, this.duration, 1 / 60, corners));
        choreograph(this.plan, k, a);
        this.actors.push(a);
        this.tracks.push(...a.tracks);
      });
      this.driver = new Driver(stage, this.tracks, this.duration, ended);
    }
    this.watch = new Watch(host, (this.driver ?? this.fade) as Driver | CssFade);
  }

  /** The four still heads over the card (reduced motion; v1, unchanged). */
  private buildStill(card: { left: number; width: number; radius: number }, H: number, W: number, inset: number): HTMLDivElement {
    const rm = document.createElement('div');
    rm.className = 'rm';
    rm.style.left = `${card.left}px`;
    rm.style.width = `${card.width}px`;
    this.stageEl.append(rm);
    const geo: StageGeo = { W: card.width, H, u0: paradeUnit(W), inset: { bottom: inset, top: 0, left: 0, right: 0 }, radius: { bottom: card.radius } };
    const clip = document.createElement('div');
    clip.className = 'clip';
    clip.style.inset = '0';
    clip.style.setProperty('clip-path', `path('${cardOutline(geo, 0, 0, Math.min(card.radius, card.width / 2))}')`);
    const paws = document.createElement('div');
    paws.className = 'layer paws';
    rm.append(clip, paws);
    // left to right: Pompon, then the friends from the top of the tower to its bottom; evenly spaced over the card
    const cast: Array<{ coat: BunnyCoat; u: number }> = [
      { coat: 'fawn', u: geo.u0 * 0.9 },
      ...[...FRIENDS].reverse().map((coat) => ({ coat, u: geo.u0 * FRIEND_SCALE * 0.92 })),
    ];
    const widths = cast.map((c) => 2 * HALF_WIDTH * c.u);
    const gap = (card.width - widths.reduce((s, w) => s + w, 0)) / (cast.length + 1);
    let x = gap;
    cast.forEach((c, i) => {
      const w = widths[i] ?? 0;
      const pos = (x + w / 2) / card.width;
      x += w + gap;
      const place = placePeek({ edge: 'bottom', pos, tilt: 0, floor: false, reveal: 0, turn: false }, c.u, geo);
      const peeker = new Peeker(`p${i}`, c.coat, c.u, clip, { x: 0, y: 0 }, paws, place);
      peeker.peek({ at: 0, place, hold: 0, look: [], sniff: false, greet: false, stay: true, seated: true, lookFrom: 0.35 });
      freezeAt([...peeker.tracks, ...peeker.loops], 2);
      this.peekers.push(peeker);
    });
    return rm;
  }

  get time(): number {
    return this.driver?.time ?? this.fade?.time ?? 0;
  }

  /** Running (also while parked off screen: it resumes when it can be seen). */
  get playing(): boolean {
    return this.running && !this.destroyed;
  }

  /** Mid-show: the app's one-mascot-at-a-time arbiter asks this. */
  get busy(): boolean {
    return this.playing;
  }

  /** Parked: off screen or in a hidden tab, it waits at its exact frame. */
  get suspended(): boolean {
    return this.watch.suspended;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  get animations(): readonly Animation[] {
    return this.driver?.animations ?? [];
  }

  /** How many bunnies the stage built (4; 4 still heads under reduced motion). */
  get actorCount(): number {
    return this.reduced ? this.peekers.length : this.actors.length;
  }

  /** Plays from the current frame (from the start when idle or over); waits while it cannot be seen. */
  play(): void {
    if (this.destroyed || this.running) return;
    this.running = true;
    this.watch.start();
  }

  /** Freezes the current frame. */
  pause(): void {
    if (this.destroyed) return;
    this.running = false;
    this.watch.stop();
    this.driver?.pause();
    this.fade?.pause();
  }

  /** Freezes the exact frame at `seconds` (reduced motion: the fade at that moment). */
  seek(seconds: number): void {
    if (this.destroyed) return;
    this.running = false;
    this.watch.stop();
    const t = Math.max(0, Math.min(this.duration, Number.isFinite(seconds) ? seconds : 0));
    this.driver?.seek(t);
    this.fade?.seek(t);
  }

  /** Back to before the start (nothing shown); `done` resolves. */
  stop(): void {
    if (this.destroyed) return;
    this.running = false;
    this.watch.stop();
    this.driver?.stop();
    this.fade?.stop();
    this.resolveDone();
  }

  /** Styles of every animated part at `seconds` (from the same keys as the animations). */
  sample(seconds: number): Record<string, StyleOut> {
    return sampleTracks(this.tracks, seconds);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.running = false;
    this.watch.destroy();
    this.driver?.destroy();
    this.fade?.stop();
    for (const a of this.actors) a.remove();
    for (const p of this.peekers) p.remove();
    this.root.innerHTML = '';
    this.resolveDone();
  }

  private ended(): void {
    if (this.destroyed) return;
    this.running = false;
    this.watch.stop();
    this.onEnd?.();
    this.resolveDone();
  }
}

/** The gallery's name (demo/parade, test/parade.test.ts). */
export { TowerStage as ParadeStage };
