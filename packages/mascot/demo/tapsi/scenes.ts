/**
 * Tapsi's moments (26.10, gallery): the three scenes, each on one timeline. 27.10: «Psst» and «Пылинка» are approved —
 * their choreography is the package's (src/tapsi-moments.ts, the app plays it); «Сегодня» ('today') is gallery-only.
 *
 *   'before' — today's reservation moment M17 (apps/web GuestWishlist HamsterCheer + src/hamster.ts jump → eat),
 *              keyframe for keyframe, so it can be frozen at any frame next to the new ending
 *   'psst'   — the same moment with the new ending «Psst»: after chewing both paws cover his mouth, ^ ^, a head
 *              tilt and a small nod ("Ich sag nix"); the star eyes of the end are gone
 *   'today'  — «Сегодня тот самый день»: on the occasion's day his full cheeks quietly empty, the hidden star
 *              floats up with one glint and melts above the card
 *   'speck'  — «Пылинка на линзе»: binoculars down, one paw brushes a speck off a lens, binoculars up (on tap)
 *
 * Times are seconds. Only transform and opacity; the app's springs (EZ.smooth / bouncy) for new motion, the
 * puppet's own curves where the approved scene is replayed. Under reduced motion a scene is a still pose (no
 * animate() at all).
 */

import type { HamsterCoat } from '../../src/index';
import { star } from '../../src/shapes';
import { splitEase } from '../../src/timeline';
import { EZ, PSST, RESERVE, TapsiParts, authorPsstEnding, authorReserveStart, authorSpeck } from '../../src/tapsi-moments';
import { Stage, mountTapsi, type Rig } from './stage';

export type SceneId = 'before' | 'psst' | 'today' | 'speck';

export interface Built {
  id: SceneId;
  stage: Stage;
  rig: Rig;
  /** when the puppet is free again (s); the cheeks may still settle after it (stage.end) */
  duration: number;
  /** named moments of the scene (s), for the gallery's readout and the tests */
  marks: Record<string, number>;
  reduced: boolean;
  destroy(): void;
}

export interface SceneOptions {
  reduced?: boolean;
  coat?: HamsterCoat;
  /** extra tracks on the same timeline (the gallery's mock UI: the sheet's line and button rise in) */
  decorate?: (stage: Stage) => void;
}

/** The box each scene is built in (px), and the part a contact-sheet cell shows. */
export const SCENE_BOX: Record<SceneId, { w: number; h: number; crop: { x: number; y: number; w: number; h: number } }> = {
  before: { w: 334, h: 230, crop: { x: 72, y: 20, w: 190, h: 210 } },
  psst: { w: 334, h: 230, crop: { x: 72, y: 20, w: 190, h: 210 } },
  today: { w: 390, h: 300, crop: { x: 226, y: 40, w: 140, h: 140 } },
  speck: { w: 342, h: 120, crop: { x: 86, y: 0, w: 170, h: 120 } },
};

/** The hamster's size in each place (the app's named sizes: m = 160). */
const SIZE = 160;

// ---- the puppet's parts, one track each ------------------------------------------------------------------

/**
 * The package's parts registry (src/tapsi-moments.ts — the approved «Psst» and «Пылинка» are authored there and
 * play in the app since 27.10) on the gallery's own frozen rig, plus the gallery's wrappers (the sheet's bounce-in).
 */
class Parts extends TapsiParts {
  constructor(
    stage: Stage,
    readonly rig: Rig,
  ) {
    super({
      query: (sel) => rig.parts(sel),
      track: (els, base, name) => stage.track(els, base, name),
      add: (markup, parent) => {
        const g = rig.add(markup, parent);
        return g.firstElementChild ?? g;
      },
    });
  }

  get box() { return this.get('box', this.rig.box, { o: 1 }); }
  get pop() { return this.get('pop', this.rig.pop, { y: 0, s: 1 }); }
  get lift() { return this.get('lift', this.rig.lift, { x: 0, y: 0 }); }
}

// ---- 1 · the reservation moment (M17), today's ending or «Psst» ---------------------------------------------

export { PSST, RESERVE };

function authorReserve(p: Parts, ending: 'stars' | 'psst'): { duration: number; marks: Record<string, number> } {
  // the sheet's bounce-in (GuestWishlist HamsterCheer: scale 0.6 → 1, y 16 → 0 on the bouncy spring, opacity fade)
  p.get('box', p.rig.box, { o: 0 }).move(0, 0.16, { o: 1 }, EZ.out);
  p.get('pop', p.rig.pop, { y: 16, s: 0.6 }).move(0, 0.48, { y: 0, s: 1 }, EZ.bouncy);
  // jump → eat (the package's choreography, the same keys the app plays)
  authorReserveStart(p, ending === 'psst');
  const ce = RESERVE.swallowed;
  let free: number;
  let marks: Record<string, number> = { ...RESERVE };
  if (ending === 'stars') {
    // the old ending: star eyes, the ear tip flicks, paws back down, 0.9 s, normal eyes
    p.eyes(ce, 'star');
    p.flick(ce);
    p.paws.move(ce, ce + 0.32, { y: 0 }, EZ.spring);
    free = ce + 0.32 + 0.9;
    p.eyes(free, 'round');
  } else {
    const end = authorPsstEnding(p);
    free = end.free;
    marks = end.marks;
  }
  // 1.8 s after the scene the cheeks go back (hamster.ts: timeout → setPuff(1), the same 0.7 s spring)
  p.puff.move(free + 1.8, free + 2.5, { s: 1 }, EZ.spring);
  marks['free'] = free;
  return { duration: free, marks };
}

// ---- 2 · «Сегодня тот самый день» ---------------------------------------------------------------------------

const STAR_PX = 22;

/** The wish star (the same star he ate: src/shapes.ts cookieMarkup), drawn at its full size, centred on 0 0. */
function starMarkup(): string {
  const r = STAR_PX / 2;
  const k = r / 11;
  return `<svg viewBox="-${r + 3} -${r + 3} ${2 * r + 6} ${2 * r + 6}" width="${2 * r + 6}" height="${2 * r + 6}" aria-hidden="true" style="display:block;overflow:visible">
    <path d="${star(0, 0, r, 5.6 * k)}" fill="#F6C25B" stroke="#E3A340" stroke-width="${(1.6 * k).toFixed(2)}" stroke-linejoin="round"/>
    <circle cx="${(-2.5 * k).toFixed(2)}" cy="${(-2 * k).toFixed(2)}" r="${(1.2 * k).toFixed(2)}" fill="#FFF3D6"/>
    <circle cx="${(2.8 * k).toFixed(2)}" cy="${(1.5 * k).toFixed(2)}" r="${(1.1 * k).toFixed(2)}" fill="#FFF3D6"/>
  </svg>`;
}

/** The one glint: a small four-point sparkle, centred on 0 0. */
function glintMarkup(): string {
  return `<svg viewBox="-8 -8 16 16" width="16" height="16" aria-hidden="true" style="display:block;overflow:visible">
    <path d="${star(0, 0, 6.5, 1.5, 4)}" fill="#FFFFFF" stroke="#F3B676" stroke-width=".7" stroke-linejoin="round"/></svg>`;
}

function overlay(root: HTMLElement, html: string, size: number, z: number): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = `position:absolute;left:${-size / 2}px;top:${-size / 2}px;width:${size}px;height:${size}px;z-index:${z};pointer-events:none`;
  el.innerHTML = html;
  root.append(el);
  return el;
}

/** Where Tapsi stands in the 'today' box (feet hidden behind the card, whose top edge is at CARD_TOP). */
export const TODAY = { left: 214, cardTop: 176 } as const;

function authorToday(stage: Stage, p: Parts, root: HTMLElement, reduced: boolean): { duration: number; marks: Record<string, number> } {
  const rig = p.rig;
  const starEl = overlay(root, starMarkup(), STAR_PX + 6, 4);
  const glintEl = overlay(starEl, glintMarkup(), 16, 1);
  glintEl.style.left = `${STAR_PX / 2 + 3 - 8 + 7}px`;
  glintEl.style.top = `${STAR_PX / 2 + 3 - 8 - 7}px`;
  const box = { x: TODAY.left, y: TODAY.cardTop - rig.at(0, -30).y };
  const mouth = rig.at(0, -84);
  const from = { x: box.x + mouth.x, y: box.y + mouth.y + 2 };
  const starT = stage.track(starEl, { x: from.x, y: from.y, r: 0, s: 0.3, o: 0 }, 'tapsi.star');
  const glintT = stage.track(glintEl, { r: 0, s: 0, o: 0 }, 'tapsi.glint');

  if (reduced) {
    // the still: ^ ^ eyes, cheeks empty, the star beside him (no motion at all)
    p.eyes(0.001, 'happy');
    const beside = rig.at(100, -158);
    starT.set(0.001, { x: box.x + beside.x, y: box.y + beside.y, s: 0.85, r: 12, o: 1 });
    return { duration: 0, marks: {} };
  }

  // Felix 26.10: the first version "just floats out, like PowerPoint" — now every beat has a cause and a recoil:
  // he springs up, sees "Heute", is glad (two hops, two claps), takes a breath (the cheeks swell), "pff!" — the
  // star shoots out spinning and the puff throws him back, he follows it with his eyes, it twinkles and melts.

  // 1 · he springs up from behind the card (cheeks still full: the star is in there since the reservation); the
  // bouncy spring overshoots, so he peeks a little higher and settles; the ears trail and flop on the stop
  const H = rig.at(0, -30).y - rig.at(0, -182).y;
  p.get('puff', '.cheek', { s: 1.35 });
  const lift = p.get('lift', rig.lift, { x: 0, y: H });
  lift.move(0.05, 0.46, { y: 0 }, EZ.bouncy);
  p.body.path(0.05, [[0.2, { sx: 0.95, sy: 1.07 }, EZ.out], [0.4, { sx: 1.06, sy: 0.94 }, EZ.inOut], [0.62, { sx: 1, sy: 1 }, EZ.bouncy]]);
  p.earL.path(0.05, [[0.22, { r: 14 }, EZ.out], [0.44, { r: -6 }, EZ.inOut], [0.7, { r: 0 }, EZ.bouncy]]);
  p.earR.path(0.05, [[0.22, { r: -13 }, EZ.out], [0.44, { r: 6 }, EZ.inOut], [0.7, { r: 0 }, EZ.bouncy]]);
  p.flick(0.4);

  // 2 · a look down at the card ("Heute"), a blink, ^ ^ — and he is glad: two little hops, a clap on each
  p.face.move(0.48, 0.6, { y: 3 }, EZ.smooth).move(0.68, 0.8, { y: 0 }, EZ.smooth);
  p.blink(0.6);
  p.eyes(0.66, 'happy');
  const hops = [0.8, 1.0] as const;
  lift.path(hops[0], hops.flatMap((t) => [[t + 0.09, { y: -7 }, EZ.out], [t + 0.19, { y: 0 }, EZ.in]] as const));
  p.body.path(hops[0], hops.flatMap((t) => [[t + 0.09, { sx: 0.97, sy: 1.04 }, EZ.out], [t + 0.2, { sx: 1.05, sy: 0.95 }, EZ.in]] as const));
  p.earL.path(hops[0], hops.flatMap((t) => [[t + 0.09, { r: -6 }, EZ.out], [t + 0.2, { r: 7 }, EZ.in]] as const));
  p.earR.path(hops[0], hops.flatMap((t) => [[t + 0.09, { r: 6 }, EZ.out], [t + 0.2, { r: -7 }, EZ.in]] as const));
  p.paws.move(0.76, 0.86, { y: -8 }, EZ.out);
  // the paws meet in front of him at the top of each hop (the left one turns in with +r, the right one with −r)
  p.pawL.path(0.76, hops.flatMap((t) => [[t + 0.09, { x: 5, y: -2, r: 24 }, EZ.out], [t + 0.18, { x: 0, y: 0, r: 4 }, EZ.out]] as const));
  p.pawR.path(0.76, hops.flatMap((t) => [[t + 0.09, { x: -5, y: -2, r: -24 }, EZ.out], [t + 0.18, { x: 0, y: 0, r: -4 }, EZ.out]] as const));

  // 3 · a breath in: the cheeks swell even more, he stretches up, the ears go back, the paws come down — a short hold
  const inhale = 1.22;
  const out = 1.5;
  p.puff.move(inhale, out - 0.06, { s: 1.5 }, EZ.out);
  p.body.move(inhale, out - 0.06, { sx: 0.98, sy: 1.045 }, EZ.out);
  p.earL.move(inhale, out - 0.06, { r: 9 }, EZ.out);
  p.earR.move(inhale, out - 0.06, { r: -9 }, EZ.out);
  p.face.move(inhale, out - 0.06, { y: -1.5 }, EZ.out);
  p.paws.move(inhale, inhale + 0.14, { y: 0 }, EZ.smooth);
  p.pawL.move(inhale, inhale + 0.14, { x: 0, y: 0, r: 0 }, EZ.smooth);
  p.pawR.move(inhale, inhale + 0.14, { x: 0, y: 0, r: 0 }, EZ.smooth);

  // 4 · "pff!": the mouth pops open, the cheeks empty with a jelly wobble, the puff throws him back and down a
  // little, the ears flap forward and spring back
  p.open.set(out - 0.02, { s: 0.9 });
  p.mouthOpen(out, true, 0.04);
  p.mouthOpen(out + 0.2, false, 0.08);
  p.puff.path(out, [[out + 0.1, { s: 0.94 }, EZ.out], [out + 0.25, { s: 1.04 }, EZ.inOut], [out + 0.42, { s: 1 }, EZ.inOut]]);
  p.body.path(out, [[out + 0.08, { sx: 1.07, sy: 0.92 }, EZ.out], [out + 0.28, { sx: 0.98, sy: 1.02 }, EZ.inOut], [out + 0.45, { sx: 1, sy: 1 }, EZ.inOut]]);
  lift.path(out, [[out + 0.08, { y: 3 }, EZ.out], [out + 0.32, { y: 0 }, EZ.bouncy]]);
  p.earL.path(out, [[out + 0.1, { r: -12 }, EZ.out], [out + 0.42, { r: 0 }, EZ.bouncy]]);
  p.earR.path(out, [[out + 0.1, { r: 12 }, EZ.out], [out + 0.42, { r: 0 }, EZ.bouncy]]);

  // 5 · the star shoots out of his mouth: sideways past the cheek first (never a sticker on his forehead), then up
  // — fast at the start, slowing at the top (ONE easing over the bend, splitEase), growing, one whole turn. It hangs
  // there with a small bob, twinkles once (the one glint), then melts (opacity + a little bigger, never a pop).
  starT.set(out + 0.01, { o: 1 });
  const side = { x: from.x + 36, y: from.y - 10 };
  const top = { x: from.x + 40, y: from.y - 92 };
  const leg1 = Math.hypot(side.x - from.x, side.y - from.y);
  const leg2 = Math.hypot(top.x - side.x, top.y - side.y);
  const flight = { t0: out + 0.01, t1: out + 0.5 };
  const [k, e1, e2] = splitEase('cubic-bezier(.12,.8,.3,1)', leg1 / (leg1 + leg2));
  const bend = flight.t0 + k * (flight.t1 - flight.t0);
  const twinkle = flight.t1 + 0.22;
  const melted = twinkle + 0.5;
  starT.path(flight.t0, [
    [bend, { x: side.x, y: side.y, s: 0.75, r: 150 }, e1],
    [flight.t1, { x: top.x, y: top.y, s: 1.08, r: 340 }, e2],
    [flight.t1 + 0.16, { x: top.x - 1, y: top.y + 4, s: 1, r: 360 }, EZ.inOut],
    [twinkle, { x: top.x, y: top.y, s: 1.16, r: 360 }, EZ.out],
    [twinkle + 0.12, { x: top.x, y: top.y - 2, s: 1.04, r: 362 }, EZ.inOut],
    [melted, { x: top.x + 2, y: top.y - 16, s: 1.28, r: 372, o: 0 }, EZ.out],
  ]);
  glintT.set(twinkle - 0.02, { o: 1 }).path(twinkle - 0.02, [[twinkle + 0.14, { s: 1.2, r: 25 }, EZ.out], [twinkle + 0.38, { s: 0, r: 60, o: 1 }, EZ.in]]);

  // 6 · he follows it: the face turns up towards it, the head tilts after it, the paws rise a little ("fly!")
  const look = out + 0.16;
  p.face.move(look, look + 0.3, { x: 2, y: -3 }, EZ.smooth);
  p.tf.move(look + 0.06, look + 0.36, { r: 6 }, EZ.smooth);
  p.te.move(look + 0.06, look + 0.36, { r: 4 }, EZ.smooth);
  p.paws.move(look + 0.1, look + 0.34, { y: -8 }, EZ.out);

  // 7 · it is gone: a content nod, everything back home on a spring, the eyes open
  const done = melted - 0.12;
  p.nod.path(done, [[done + 0.12, { sx: 1.015, sy: 0.97 }, EZ.out], [done + 0.3, { sx: 1, sy: 1 }, EZ.inOut]]);
  p.face.move(done, done + 0.26, { x: 0, y: 0 }, EZ.smooth);
  p.tf.move(done, done + 0.26, { r: 0 }, EZ.smooth);
  p.te.move(done, done + 0.26, { r: 0 }, EZ.smooth);
  p.paws.move(done, done + 0.3, { y: 0 }, EZ.bouncy);
  const open = done + 0.16;
  p.balls.set(open - 0.02, { sy: 0.25 });
  p.eyes(open, 'round');
  p.balls.move(open, open + 0.12, { sy: 1 }, EZ.out);
  const duration = Math.round((done + 0.3) * 100) / 100;
  return { duration, marks: { risen: 0.46, glad: hops[0], inhale, out, glint: twinkle, melted } };
}

// ---- 3 · «Пылинка на линзе» (the package's choreography; the speck is part of the binoculars drawing) ----------

function authorSpeckScene(p: Parts, reduced: boolean): { duration: number; marks: Record<string, number> } {
  if (reduced) {
    // the still: binoculars down, ^ ^ (in the app: the puppet's reduced pose with calm eyes)
    p.bino.set(0.001, { y: 36, sx: 0.97, sy: 0.97 });
    p.eyes(0.001, 'happy');
    return { duration: 0, marks: {} };
  }
  return authorSpeck(p);
}

// ---- build ---------------------------------------------------------------------------------------------------

/**
 * Builds scene `id` in `root` (a positioned box of SCENE_BOX[id] size; 'today' brings its own card). Not running:
 * frozen at 0 (or, reduced, the still pose — no animations at all). The caller seeks / plays the stage.
 */
export function buildScene(id: SceneId, root: HTMLElement, o: SceneOptions = {}): Built {
  const reduced = o.reduced ?? false;
  const stage = new Stage();
  const coat = o.coat ? { coat: o.coat } : {};
  const b = SCENE_BOX[id];
  let rig: Rig;
  let res: { duration: number; marks: Record<string, number> };
  if (id === 'today') {
    const card = document.createElement('div');
    card.className = 'tm-card';
    card.innerHTML = '<b>Lenas Geburtstag</b><span class="tm-today">Heute · Samstag, 1. November</span><span class="tm-chips"><i>3 Wünsche</i><i>Du kommst</i></span>';
    card.style.cssText = `position:absolute;left:16px;right:16px;top:${TODAY.cardTop}px;z-index:3`;
    root.append(card);
    // the card's top edge is the floor line: what is below it is not drawn at all (a clip, not occlusion — the
    // app's cards are see-through glass), like the bunnies that peek over a card (src/props.ts edge clip)
    const clip = document.createElement('div');
    clip.className = 'tm-edge';
    clip.style.cssText = `position:absolute;left:0;right:0;top:0;height:${TODAY.cardTop}px;overflow:hidden;z-index:2;pointer-events:none`;
    root.append(clip);
    rig = mountTapsi(clip, { size: SIZE, left: TODAY.left, top: 0, z: 2, ...coat });
    rig.box.style.top = `${TODAY.cardTop - rig.at(0, -30).y}px`;
  } else if (id === 'speck') {
    rig = mountTapsi(root, { size: SIZE, left: (b.w - SIZE) / 2, top: 14, holding: 'binoculars', ...coat });
  } else {
    rig = mountTapsi(root, { size: SIZE, left: (b.w - SIZE) / 2, top: b.h - 100, ...coat });
  }
  const p = new Parts(stage, rig);
  if (id === 'before' || id === 'psst') {
    if (reduced) {
      // the still of the reservation moment: today's (cheeks full + ^ ^, I-02) or «Psst» (+ paws at his mouth, a tilt)
      p.puff.set(0.001, { s: 1.35 });
      p.eyes(0.001, 'happy');
      if (id === 'psst') {
        p.paws.set(0.001, PSST.paws);
        p.pawL.set(0.001, PSST.pawL);
        p.pawR.set(0.001, PSST.pawR);
        p.tf.set(0.001, PSST.tf);
        p.te.set(0.001, PSST.te);
        p.body.set(0.001, PSST.body);
        p.blush.set(0.001, PSST.blush);
      }
      res = { duration: 0, marks: {} };
    } else {
      res = authorReserve(p, id === 'before' ? 'stars' : 'psst');
    }
  } else if (id === 'today') {
    res = authorToday(stage, p, root, reduced);
  } else {
    res = authorSpeckScene(p, reduced);
  }
  if (!reduced) p.breatheUntil(res.duration);
  o.decorate?.(stage);
  stage.duration = res.duration;
  if (reduced) stage.still(1);
  else stage.build();
  return {
    id,
    stage,
    rig,
    duration: res.duration,
    marks: res.marks,
    reduced,
    destroy: () => {
      stage.destroy();
      rig.destroy();
      root.replaceChildren();
    },
  };
}
