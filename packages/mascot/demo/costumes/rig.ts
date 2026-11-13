/**
 * Costumes from Felix's photos (31.10) — GALLERY-ONLY prototype. The dressing rig.
 *
 * Like the wardrobe (demo/wardrobe/items.ts putOn), everything is put on a puppet FROM OUTSIDE, into its own shadow
 * root, after it was built: packages/mascot/src is not touched, so the app's Pompon / Tapsi and every scene stay
 * exactly as they are (test/costumes.test.ts pins the default markup). A puppet nobody dresses never sees any of it.
 *
 * Units: the puppet's own coordinates (x = 0 centre line, y = 0 feet, head top y = -163, both mascots).
 *
 * Slots — where a layer goes inside the puppet (`.hop > .body > .squash > .breathe`), so it rides every hop, squash
 * and breath of his and keeps the right depth:
 *
 *   behind      first in `.breathe`: behind the whole bunny (a cape, a veil, a sword on the back, the cup's far rim)
 *   front       in `.mover`, after his `.hop`: in front of him and NOT hopping with him (a big laptop he peeks over)
 *   fur         right after the body silhouette: under cheeks, belly and face (a lionhead's mane)
 *   body        after the belly, before the face: a garment over the body, under face, ears and paws (tank top, tuxedo)
 *   under-ears  bunny: before the lop ears — a band round the forehead the ears hang over (hamster: = over)
 *   face-under  first in `.face`: under the eyes, follows every glance and the 3/4 turn (eye rings)
 *   face        last in `.face`: over the eyes, follows every glance and the turn (glasses, cucumber slices)
 *   over        before the front paws: over face and ears, under the paws (hats, hoods, the cup in front of him)
 *   paws        inside `.paws`, before the paws: held between them, lifted with them (dumbbell, bouquet, strawberry)
 *   ear-l/-r    inside the visible ear: swings with it (fluffy ear tips, an agouti's ear rims)
 *   cheek-l/-r  inside the cheek: puffs and chews with it (cheek fluff)
 *
 * The 3/4 turn (the puppet's .turn-r / .turn-l on `.hm`): a layer's drawing uses one of these classes for the part
 * that must follow it — the same numbers as BUNNY_CSS (the face moves 13 and narrows to .88, the paws 9, the ears 8–16):
 *   cs-head   11 + scaleX .9 about (0, -150)    hats, between the ears' and the face's shift
 *   cs-front  13 + scaleX .88 about x = 0       on the face / neck (a bow tie)
 *   cs-band   9                                  garments clipped to the body, hoods (their outline must not shrink)
 *   cs-back   -10                                behind him (a cape shows on the back side)
 * Layers in `face`, `face-under`, `paws`, the ears and the cheeks need none: their parent already turns.
 * Things that stand on the floor beside him (the strawberry tree) carry `cs-floor`: the carried bunny of the carry
 * stage (its svg has the class `carry`) leaves them out — they would fly along with him.
 * Dangling parts (veil, cape, plume, fins, bow tails) use the wardrobe's `.wr-wob` (data-wob = amplitude): they swing
 * once after HIS hop (followThrough) and lean a little in the turn — nothing ever moves by itself.
 *
 * Rules (ideas doc §3.1, §3.4): flat colours, the silhouette's own contour (--mascot-outline) on outer shapes,
 * transform / opacity only, reduced motion = everything still.
 */

import { BUNNY_COATS } from '../../src/bunny';
import { HAMSTER_COATS } from '../../src/hamster';
import { bodyClip, childOf, followThrough, puppetRoots } from '../wardrobe/items';

export type Kind = 'bunny' | 'hamster';
export type { Pt } from '../../src/geometry';
export type Ears = 'lop' | 'upright';

export type SlotId = 'behind' | 'fur' | 'body' | 'under-ears' | 'face-under' | 'face' | 'over' | 'paws' | 'ear-l' | 'ear-r' | 'cheek-l' | 'cheek-r' | 'front';
export const SLOTS: readonly SlotId[] = ['behind', 'fur', 'body', 'under-ears', 'face-under', 'face', 'over', 'paws', 'ear-l', 'ear-r', 'cheek-l', 'cheek-r', 'front'];

/** What a drawing may use of the puppet it is put on. */
export interface Ctx {
  kind: Kind;
  ears: Ears;
  /** url(#…-clip-body): the body silhouette of THIS puppet */
  clip: string;
  /** url(#…-g-body): the coat's top → bottom gradient (fur drawn in the coat's own colours) */
  gBody: string;
  /** url(#…-g-ear): the ear gradient (bunny); the accent for the hamster */
  gEar: string;
  /** a prefix unique to this puppet, for ids a drawing defines itself */
  uid: string;
  /** the body silhouette's path (Knopf's is Krümel's round one) */
  bodyD: string;
}

let maskSeq = 0;
/**
 * Draws `inner` only OUTSIDE the body silhouette (a static mask: white everywhere, the body black). For fur outlines:
 * the contour of a mane / ruff shows where the fluff sticks out, never as a line across his face or belly.
 */
export function outside(c: Ctx, inner: string): string {
  const id = `${c.uid}-out${++maskSeq}`;
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-300" y="-400" width="600" height="520"><rect x="-300" y="-400" width="600" height="520" fill="#fff"/><path d="${c.bodyD}" fill="#000"/></mask><g mask="url(#${id})">${inner}</g>`;
}

export interface Layer {
  slot: SlotId;
  draw: (c: Ctx) => string;
}

/** Parts of the puppet a look hides while worn: a hood over the ears, a cup over the feet. */
export type HidePart = 'ears' | 'feet' | 'tail' | 'muzzle' | 'paws';

export interface Look {
  id: string;
  layers: readonly Layer[];
  hide?: readonly HidePart[];
  /** resting eyes while worn (the puppet's own closed «happy» arcs) */
  eyes?: 'happy' | 'sleep';
  /**
   * 31.10 (round 2): only this region of HIS body silhouette stays visible while worn (a path in puppet units). The
   * noodle cup: nothing of him below its front lip, so his sides never stick out of the cup — the clip sits on his own
   * body path, so it rides every hop, squash, binky twist and breath with him. Taken off again on undress.
   */
  bodyClip?: string;
}

// ---- small geometry helpers (absolute M / L / C / Q / Z only: every number pair is a point) ----------------------
// 31.10: moved to the package (src/geometry.ts — the app's fluffy cheeks and Sammlung hats are drawn with them)

export { at, ell, f, flipX, line, mirror, poly, rrect, shift, smooth } from '../../src/geometry';

// ---- the CSS ---------------------------------------------------------------------------------------------------

export const COSTUME_CSS = `
.cs { pointer-events: none; }
.cs-o, .cs .wr-o { stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke;
  paint-order: stroke fill; stroke-linejoin: round; }
.cs-ln { fill: none; stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke;
  stroke-linecap: round; stroke-linejoin: round; }
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
.carry .cs-floor { display: none; }
`;

/** CSS that hides parts of the puppet while a look is worn (scoped: one puppet per shadow root). */
export function hideCss(parts: readonly HidePart[]): string {
  const rules: string[] = [];
  if (parts.includes('ears')) rules.push('.hm .lop, .hm .up, .hm .tall { display: none !important; }');
  if (parts.includes('feet')) rules.push('.hm .tfoot { visibility: hidden; }');
  if (parts.includes('tail')) rules.push('.hm .tail { visibility: hidden; }');
  // the broken coat's two small spots by the nose (Mila in the comic: at small sizes they read as an open mouth)
  if (parts.includes('muzzle')) rules.push('.hm .tpatch ellipse { opacity: 0; }');
  // the front paws (the noodle cup draws them on its rim instead); props held in the paws slot stay
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
  const gb = root.querySelector('linearGradient[id$="g-body"]');
  const ge = root.querySelector('linearGradient[id$="g-ear"]');
  const ears: Ears = kind === 'hamster' || hm.classList.contains('ears-up') ? 'upright' : 'lop';
  const host = root.host as HTMLElement;
  if (!host.dataset['csUid']) host.dataset['csUid'] = `cs${++uidSeq}`;
  return {
    kind,
    ears,
    clip,
    gBody: gb ? `url(#${gb.id})` : 'var(--mascot-base-top)',
    gEar: ge ? `url(#${ge.id})` : 'var(--mascot-accent)',
    uid: host.dataset['csUid'] ?? 'cs',
    bodyD: root.querySelector('clipPath[id$="clip-body"] path')?.getAttribute('d') ?? '',
  };
}

/** Where a slot's container goes: parent + the node it is inserted before (null = append). */
function anchor(root: ShadowRoot, slot: SlotId, c: Ctx): { parent: Element; before: Node | null } | null {
  const breathe = root.querySelector('.breathe');
  if (!breathe) return null;
  const face = root.querySelector('.tf .face');
  const ear = (side: 'l' | 'r') => root.querySelector(c.kind === 'hamster' ? `.ear-${side}` : `${c.ears === 'upright' ? '.up' : '.lop'} .ear-${side}`);
  switch (slot) {
    case 'front': {
      const mover = root.querySelector('.mover');
      return mover ? { parent: mover, before: childOf(mover, 'fx') } : null;
    }
    case 'behind':
      return { parent: breathe, before: breathe.firstChild };
    case 'fur': {
      const body = Array.from(breathe.children).find((e) => e.tagName.toLowerCase() === 'path');
      return { parent: breathe, before: body?.nextSibling ?? null };
    }
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
    case 'ear-l':
    case 'ear-r': {
      const e = ear(slot === 'ear-l' ? 'l' : 'r');
      return e ? { parent: e, before: null } : null;
    }
    case 'cheek-l':
    case 'cheek-r': {
      const j = root.querySelector(`.${slot} .cheek-j`);
      return j ? { parent: j, before: null } : null;
    }
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Takes off every costume layer (and the hiding rules) of this puppet: the markup is exactly as before. */
export function undress(root: ShadowRoot): void {
  for (const g of Array.from(root.querySelectorAll('.cs'))) g.remove();
  for (const s of Array.from(root.querySelectorAll('style[data-costume], style[data-costume-hide]'))) s.remove();
  for (const b of Array.from(root.querySelectorAll('[data-cs-clip]'))) {
    b.removeAttribute('clip-path');
    b.removeAttribute('data-cs-clip');
  }
  const hm = root.querySelector('.hm');
  const eyes = hm?.getAttribute('data-cs-eyes');
  if (hm && eyes) {
    hm.classList.remove(`m-${eyes}`);
    hm.removeAttribute('data-cs-eyes');
  }
}

/**
 * Puts these looks on the puppet in `root` (after taking off what it wore): one container per used slot, the
 * looks' layers in order inside it. Returns the containers (empty when this is not a puppet).
 */
export function dress(root: ShadowRoot, looks: ReadonlyArray<Look | null | undefined>): SVGGElement[] {
  undress(root);
  const c = ctxOf(root);
  const list = looks.filter((l): l is Look => !!l);
  if (!c || !list.length) return [];
  const style = document.createElement('style');
  style.dataset['costume'] = '';
  style.textContent = COSTUME_CSS;
  root.append(style);
  const hide = [...new Set(list.flatMap((l) => l.hide ?? []))];
  if (hide.length) {
    const h = document.createElement('style');
    h.dataset['costumeHide'] = hide.join(' ');
    h.textContent = hideCss(hide);
    root.append(h);
  }
  const boxes = new Map<SlotId, SVGGElement>();
  for (const look of list) {
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
  }
  // a look's resting eyes (the headphones: dreamy ^ ^) — the puppet's own eye classes; his scenes may change them
  const eyes = list.find((l) => l.eyes)?.eyes;
  const hm = root.querySelector('.hm');
  if (eyes && hm && !hm.classList.contains('m-star')) {
    hm.classList.remove('m-happy', 'm-sleep');
    hm.classList.add(`m-${eyes}`);
    hm.setAttribute('data-cs-eyes', eyes);
  }
  // a look that keeps only part of HIS body visible (the noodle cup): a clip on his own body path; the clipPath lives
  // in the look's first container, so undress takes it off with the layers
  const keep = list.find((l) => l.bodyClip)?.bodyClip;
  const body = root.querySelector('.breathe > path');
  const holder = boxes.values().next().value;
  if (keep && body && holder) {
    const id = `${c.uid}-keep`;
    const cp = document.createElementNS(SVG_NS, 'clipPath');
    cp.setAttribute('id', id);
    const kp = document.createElementNS(SVG_NS, 'path');
    kp.setAttribute('d', keep);
    cp.append(kp);
    holder.prepend(cp);
    body.setAttribute('clip-path', `url(#${id})`);
    body.setAttribute('data-cs-clip', '');
  }
  followThrough(root);
  return [...boxes.values()];
}

// ---- who wears it -------------------------------------------------------------------------------------------

/** The seven coat colours in COAT_VARS order: base top, base bottom, belly, accent, accent dark, paw, inner ear. */
export type CoatColors = readonly [string, string, string, string, string, string, string];
const COAT_VARS = ['--mascot-base-top', '--mascot-base-bottom', '--mascot-belly', '--mascot-accent', '--mascot-accent-dark', '--mascot-paw', '--mascot-ear-in'] as const;

/** A puppet that wears costumes: Pompon, Tapsi, Mila, or one of the new bunnies (same puppet, other coat / fur). */
export interface Model {
  id: string;
  kind: Kind;
  /** the package coat the puppet is built with (its pattern: none / points / broken) */
  coat: string;
  ears?: Ears;
  /** own colours over the coat (the new bunnies) */
  paint?: CoatColors;
  /** extra custom properties on the host (e.g. a darker eye) */
  vars?: Readonly<Record<string, string>>;
  /** a static reshape of the puppet's own shapes (Knopf: Krümel's round baby body) — run once per puppet */
  shape?: (root: ShadowRoot) => void;
  /** the bunny's own fur details (mane, eye rings), worn under any costume */
  fur?: Look;
}

const PATTERNS: Record<Kind, readonly string[]> = { bunny: ['pat-points', 'pat-broken'], hamster: ['pat-cap', 'pat-stripe', 'pat-brows', 'pat-patch'] };

/**
 * Sets a model's colours on a puppet host (also a stage actor's host, which was built with another coat): the
 * package coat (colours + its pattern class, e.g. Mila's broken patches), then the model's own paint over it.
 */
export function paint(host: HTMLElement, m: Model, hm?: Element | null): void {
  const coat = (m.kind === 'bunny' ? BUNNY_COATS : HAMSTER_COATS).find((c) => c.id === m.coat) as { colors: readonly string[]; pattern: string } | undefined;
  const colors = m.paint ?? coat?.colors;
  colors?.forEach((v, i) => host.style.setProperty(COAT_VARS[i] as string, v));
  if (hm && coat) {
    hm.classList.remove(...PATTERNS[m.kind]);
    if (coat.pattern !== 'none') hm.classList.add(`pat-${coat.pattern}`);
  }
  for (const [k, v] of Object.entries(m.vars ?? {})) host.style.setProperty(k, v);
}

/** Everything a model is, on the puppet in `root`: colours, ears, shape, its fur — and then the look. */
export function outfit(root: ShadowRoot, m: Model, look?: Look | null, extra: ReadonlyArray<Look | null> = []): SVGGElement[] {
  const hm = root.querySelector('.hm');
  if (!hm) return [];
  paint(root.host as HTMLElement, m, hm);
  if (m.kind === 'bunny' && m.ears) {
    hm.classList.toggle('ears-up', m.ears === 'upright');
    hm.classList.toggle('ears-lop', m.ears !== 'upright');
  }
  m.shape?.(root);
  return dress(root, [m.fur, ...extra, look]);
}

/** Dresses every puppet under `node` (a mascot host, or a stage whose actors have their own roots); again after layout. */
export function outfitAll(node: Element, m: Model, look?: Look | null, extra: ReadonlyArray<Look | null> = []): void {
  const go = () => {
    for (const root of puppetRoots(node)) outfit(root, m, look, extra);
  };
  go();
  requestAnimationFrame(() => requestAnimationFrame(go));
}
