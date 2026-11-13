/**
 * The costumes' dressing rig (31.10, Felix: «Всё, что мне уже понравилось и подтвердилось, можешь добавлять в
 * приложение»). Copied from the gallery prototype (demo/costumes/rig.ts — the gallery keeps its own copy for now; it is
 * being edited there for costumes that are not approved yet) with only what the approved costumes need.
 *
 * Like the wardrobe (./items.ts putOn), a costume is put on a puppet FROM OUTSIDE, into its own shadow root, after it
 * was built: a puppet nobody dresses is exactly as before (test/costumes-src.test.ts pins it).
 *
 * Units: the puppet's own coordinates (x = 0 centre line, y = 0 feet, head top y = -163).
 *
 * Slots — where a layer goes inside the puppet (`.hop > .body > .squash > .breathe`), so it rides every hop, squash and
 * breath of his and keeps the right depth:
 *
 *   behind      first in `.breathe`: behind the whole bunny (a cape, a sword on the back)
 *   front       in `.mover`, after his `.hop`: in front of him and NOT hopping with him (the laptop on the floor)
 *   body        after the belly, before the face: a garment over the body, under face, ears and paws (tank top, tuxedo)
 *   under-ears  before the lop ears — a band round the forehead the ears hang over
 *   face-under  first in `.face`: under the eyes, follows every glance and the 3/4 turn (the screen's light)
 *   face        last in `.face`: over the eyes, follows every glance and the turn (glasses, a blade of grass)
 *   over        before the front paws: over face and ears, under the paws (hats, hoods)
 *   paws        inside `.paws`, before the paws: held between them, lifted with them (dumbbell, book, sword)
 *
 * The 3/4 turn (`.turn-r` / `.turn-l`): a layer's drawing uses one of these classes for the part that must follow it —
 * the same numbers as BUNNY_CSS (the face moves 13 and narrows to .88, the paws 9):
 *   cs-head 11 + scaleX .9 about (0, -150) · cs-front 13 + scaleX .88 · cs-band 9 · cs-back -10.
 * Dangling parts (cape, plume, fins, bow tails, hood ears) use the wardrobe's `.wr-wob`: they swing once after HIS hop
 * (./items.ts followThrough) — nothing ever moves by itself. Reduced motion: everything still.
 */

import { echoMotion, type AnimTarget } from '../core';
import { bodyClip, childOf, followThrough } from './items';

export type Kind = 'bunny' | 'hamster';
export type Ears = 'lop' | 'upright';

export type SlotId = 'behind' | 'body' | 'under-ears' | 'face-under' | 'face' | 'over' | 'paws' | 'front';
export const SLOTS: readonly SlotId[] = ['behind', 'body', 'under-ears', 'face-under', 'face', 'over', 'paws', 'front'];

/** What a drawing may use of the puppet it is put on. */
export interface Ctx {
  kind: Kind;
  ears: Ears;
  /** url(#…-clip-body): the body silhouette of THIS puppet */
  clip: string;
  /** a prefix unique to this puppet, for ids a drawing defines itself */
  uid: string;
}

export interface Layer {
  slot: SlotId;
  draw: (c: Ctx) => string;
}

/** Parts of the puppet a look hides while worn: a hood over the ears, the laptop's twin paws over his own. */
export type HidePart = 'ears' | 'tail' | 'paws';

export interface Look {
  id: string;
  layers: readonly Layer[];
  hide?: readonly HidePart[];
  /** the puppet's 3/4 turn while worn (the laptop: he looks at its screen) */
  turn?: 'l' | 'r';
  /** resting eyes while worn (spa: closed, relaxed) — his own closed eyes; a scene's own eyes (stars, joy) still win */
  eyes?: 'sleep' | 'happy';
  /**
   * Puppet groups that get an ECHO while worn (core.ts echoMotion): [his group, the costume's group that makes every
   * move of it]. The laptop: his `.hop`, `.body` and `.paws` → the three groups round its twin paws.
   */
  echoes?: ReadonlyArray<readonly [string, string]>;
}

// ---- the CSS ---------------------------------------------------------------------------------------------------

export const COSTUME_CSS = `
.cs { pointer-events: none; }
.cs-o, .cs .wr-o { stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke;
  paint-order: stroke fill; stroke-linejoin: round; }
.cs-head, .cs-front, .cs-band, .cs-back, .cs .wr-wob { transform-box: view-box; }
.cs-head, .cs-front, .cs-band, .cs-back { transition: transform .28s cubic-bezier(.3, .7, .3, 1); }
.cs-head { transform-origin: 0px -150px; }
.cs-front { transform-origin: 0px 0px; }
.turn-r .cs-head { transform: translateX(11px) scaleX(.9); }
.turn-l .cs-head { transform: translateX(-11px) scaleX(.9); }
.turn-r .cs-front { transform: translateX(13px) scaleX(.88); }
.turn-l .cs-front { transform: translateX(-13px) scaleX(.88); }
.turn-r .cs-band { transform: translateX(9px); }
.turn-l .cs-band { transform: translateX(-9px); }
.turn-r .cs-back { transform: translateX(-10px); }
.turn-l .cs-back { transform: translateX(10px); }
.cs .wr-wob { --wr-lean: 0deg; transform: rotate(var(--wr-lean)); transition: transform .6s cubic-bezier(.34, 1.56, .64, 1); }
.turn-r .cs .wr-wob { --wr-lean: -6deg; }
.turn-l .cs .wr-wob { --wr-lean: 6deg; }
.rm .cs-head, .rm .cs-front, .rm .cs-band, .rm .cs-back, .rm .cs .wr-wob { transition: none; }
`;

/**
 * A look's resting eyes as CSS (scoped to this puppet, gone with the look): his own closed «sleep» / «happy» eyes show
 * while his eyes are otherwise open. Not a class on `.hm` (the gallery's way): the puppet repaints those classes after
 * every scene and would take them off. Whatever eyes a scene shows (stars, joy, a buddy's heart) win over these.
 */
export function eyesCss(mode: 'sleep' | 'happy'): string {
  const open = '.hm:not(.m-star):not(.m-happy):not(.m-sleep):not(.bd-m-heart):not(.bd-m-dizzy)';
  return `${open} .eyes { opacity: 0; }\n${open} .eyes-${mode} { opacity: 1; }`;
}

/** CSS that hides parts of the puppet while a look is worn (scoped: one puppet per shadow root). */
export function hideCss(parts: readonly HidePart[]): string {
  const rules: string[] = [];
  if (parts.includes('ears')) rules.push('.hm .lop, .hm .up, .hm .tall { display: none !important; }');
  if (parts.includes('tail')) rules.push('.hm .tail { visibility: hidden; }');
  // the front paws (the laptop draws them on its keys instead); props held in the paws slot stay
  if (parts.includes('paws')) rules.push('.hm .paw { visibility: hidden; }');
  return rules.join('\n');
}

// ---- dressing ------------------------------------------------------------------------------------------------

let uidSeq = 0;

/** The context of the puppet in this shadow root (null: not a puppet). */
export function ctxOf(root: ShadowRoot): Ctx | null {
  const clip = bodyClip(root);
  const hm = root.querySelector('.hm');
  if (!clip || !hm) return null;
  const kind: Kind = root.querySelector('.cap') ? 'hamster' : 'bunny';
  const ears: Ears = kind === 'hamster' || hm.classList.contains('ears-up') ? 'upright' : 'lop';
  const host = root.host as HTMLElement;
  if (!host.dataset['csUid']) host.dataset['csUid'] = `cs${++uidSeq}`;
  return { kind, ears, clip, uid: host.dataset['csUid'] ?? 'cs' };
}

/** Where a slot's container goes: parent + the node it is inserted before (null = append). */
function anchor(root: ShadowRoot, slot: SlotId, c: Ctx): { parent: Element; before: Node | null } | null {
  const breathe = root.querySelector('.breathe');
  if (!breathe) return null;
  const face = root.querySelector('.tf .face');
  switch (slot) {
    case 'front': {
      const mover = root.querySelector('.mover');
      return mover ? { parent: mover, before: childOf(mover, 'fx') } : null;
    }
    case 'behind':
      return { parent: breathe, before: breathe.firstChild };
    case 'body':
      return { parent: breathe, before: childOf(breathe, 'tf') };
    case 'under-ears':
      return c.kind === 'bunny' ? { parent: breathe, before: childOf(breathe, 'lop') } : { parent: breathe, before: childOf(breathe, 'tp') };
    case 'face-under':
      return face ? { parent: face, before: face.firstChild } : null;
    case 'face':
      return face ? { parent: face, before: null } : null;
    case 'over':
      return { parent: breathe, before: childOf(breathe, 'tp') };
    case 'paws': {
      const paws = root.querySelector('.tp .paws');
      return paws ? { parent: paws, before: childOf(paws, 'paw-l') } : null;
    }
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The groups of this puppet that have an echo now (taken back on undress). */
const echoed = new WeakMap<ShadowRoot, Element[]>();

/** Takes off every costume layer (and the hiding rules, the turn, the echoes) of this puppet: the markup is exactly as before. */
export function undress(root: ShadowRoot): void {
  for (const g of Array.from(root.querySelectorAll('.cs'))) g.remove();
  for (const s of Array.from(root.querySelectorAll('style[data-costume], style[data-costume-hide]'))) s.remove();
  const svg = root.querySelector('svg');
  const turn = svg?.getAttribute('data-cs-turn');
  if (svg && turn) {
    svg.classList.remove(`turn-${turn}`);
    svg.removeAttribute('data-cs-turn');
  }
  for (const el of echoed.get(root) ?? []) echoMotion(el, null);
  echoed.delete(root);
}

/** The costume this puppet wears now (its look id), or null. */
export function costumeOn(root: ShadowRoot): string | null {
  return root.querySelector('style[data-costume]')?.getAttribute('data-costume') || null;
}

/**
 * Puts this look on the puppet in `root` (after taking off what it wore): one container per used slot, the look's
 * layers in order inside it. Returns the containers (empty when this is not a puppet).
 */
export function dressLook(root: ShadowRoot, look: Look): SVGGElement[] {
  undress(root);
  const c = ctxOf(root);
  if (!c) return [];
  const style = document.createElement('style');
  style.dataset['costume'] = look.id;
  style.textContent = COSTUME_CSS;
  root.append(style);
  if (look.hide?.length || look.eyes) {
    const h = document.createElement('style');
    h.dataset['costumeHide'] = [...(look.hide ?? []), ...(look.eyes ? [`eyes-${look.eyes}`] : [])].join(' ');
    h.textContent = [hideCss(look.hide ?? []), look.eyes ? eyesCss(look.eyes) : ''].filter(Boolean).join('\n');
    root.append(h);
  }
  const boxes = new Map<SlotId, SVGGElement>();
  for (const layer of look.layers) {
    let box = boxes.get(layer.slot);
    if (!box) {
      const a = anchor(root, layer.slot, c);
      if (!a) continue;
      box = document.createElementNS(SVG_NS, 'g') as SVGGElement;
      box.setAttribute('class', `cs cs-slot-${layer.slot}`);
      a.parent.insertBefore(box, a.before);
      boxes.set(layer.slot, box);
    }
    const g = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    g.setAttribute('data-look', look.id);
    g.innerHTML = layer.draw(c);
    box.append(g);
  }
  // the turn goes on the svg, not on `.hm`: the puppet's own scenes and poses clear `.hm`'s classes, never the svg's
  // (a scene's own turn on `.hm` still wins while it lasts: BUNNY_CSS lists .turn-l after .turn-r)
  const svg = root.querySelector('svg');
  if (look.turn && svg && !svg.classList.contains(`turn-${look.turn}`)) {
    svg.classList.add(`turn-${look.turn}`);
    svg.setAttribute('data-cs-turn', look.turn);
  }
  const wired: Element[] = [];
  for (const [src, dst] of look.echoes ?? []) {
    const el = root.querySelector(src);
    if (!el) continue;
    echoMotion(el, () => root.querySelector<SVGGElement>(dst) as AnimTarget | null);
    wired.push(el);
  }
  if (wired.length) echoed.set(root, wired);
  followThrough(root);
  return [...boxes.values()];
}
