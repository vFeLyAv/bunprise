/**
 * «Pompons Sammlung» — the six outfits' DRAWINGS and how they are put on (27.10 gallery prototype, moved here 31.10;
 * docs/design/2026-10-27-pompons-sammlung.md). The rules (dates, B, unlocked) are ./rules.ts.
 *
 * Three are the wardrobe v2 drawings (./items.ts: scarf, party hat — reused as they are), the rest are the
 * Sammlung's own: the maple leaf (autumn, the «Листопад» leaf of ./leaves.ts), the two winter hats (./hats.ts, Felix's
 * picks 31.10: Nikolaus 2 «Набекрень», winter 3 «Мешковатая») and the spring daisy. Every outfit is an OPTIONAL layer
 * put on the puppet's shadow root from outside: a puppet nobody dresses looks and moves exactly as before.
 *
 * The drawings use the slot structure and CSS of the wardrobe (.wr > .wr-fall > .wr-head / .wr-wob), so they follow
 * the 3/4 turn, the hops and the breathing like the wardrobe items. Units: the puppet's own coordinates (x = 0 centre
 * line, y = 0 feet, head top y = -163; the lop ears start at x = ±24, y ≈ -160).
 */

import { followThrough, putOn, takeOff, WEAR, WEAR_CSS, wearVars, type WearTheme } from './items';
import { leafMarkup, MAPLE } from './leaves';
import { NEW_HATS, type HatId, type HatSpec, type NewHatVariant } from './hats';
import { isCostumeId, isOutfitId, type OutfitId, type WearId } from './rules';
import { costumeOn, undress } from './costume-rig';
import { dressCostume } from './costumes';

export {
  COSTUME_IDS,
  dayMonth,
  isCostumeId,
  isOutfitId,
  outfit,
  OUTFIT_IDS,
  OUTFITS,
  seasonOutfit,
  unlocked,
  wearNow,
  wornNow,
  type CostumeId,
  type DayMonth,
  type EarnMode,
  type Outfit,
  type OutfitId,
  type WearChoice,
  type WearId,
} from './rules';
export type { WearTheme } from './items';

// ---- the new drawings (leaf, daisy) ---------------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const f2 = (v: number) => String(Math.round(v * 100) / 100);
const W1 = (fb: string) => `var(--mascot-wear-1, ${fb})`;
const W2 = (fb: string) => `var(--mascot-wear-2, ${fb})`;
const shade = (fill: string, k = 78) => `color-mix(in srgb, ${fill} ${k}%, #3A1F0A)`;
const o = 'class="wr-o"';

function ellipse(cx: number, cy: number, rx: number, ry = rx): string {
  // two half-ellipses as cubic arcs (k = 0.5523), no SVG `A`
  const k = 0.5523;
  return `M${f2(cx - rx)} ${f2(cy)} C${f2(cx - rx)} ${f2(cy - ry * k)} ${f2(cx - rx * k)} ${f2(cy - ry)} ${f2(cx)} ${f2(cy - ry)}`
    + ` C${f2(cx + rx * k)} ${f2(cy - ry)} ${f2(cx + rx)} ${f2(cy - ry * k)} ${f2(cx + rx)} ${f2(cy)}`
    + ` C${f2(cx + rx)} ${f2(cy + ry * k)} ${f2(cx + rx * k)} ${f2(cy + ry)} ${f2(cx)} ${f2(cy + ry)}`
    + ` C${f2(cx - rx * k)} ${f2(cy + ry)} ${f2(cx - rx)} ${f2(cy + ry * k)} ${f2(cx - rx)} ${f2(cy)} Z`;
}

/** The maple leaf (the herbarium-traced Acer platanoides of «Листопад»): tucked into the fur at his left ear's root. */
export const LEAF_AT = { x: -33, y: -168, deg: -36, r: 31 } as const;

/** The daisy behind his right ear's root: eight petals round a golden heart, a little tilted. */
export const DAISY_AT = { x: 34, y: -166, r: 19 } as const;

function daisy(x: number, y: number, r: number): { petals: string; heart: string } {
  let petals = '';
  const n = 8;
  const pr = r * 0.32;
  const pl = r * 0.62;
  for (let i = 0; i < n; i++) {
    const a = ((-90 + 14 + (i * 360) / n) * Math.PI) / 180;
    const cx = x + Math.cos(a) * (r - pl);
    const cy = y + Math.sin(a) * (r - pl);
    // one petal: an ellipse along the ray, as a path (rotated points)
    const pts: string[] = [];
    const k = 0.5523;
    const ax = Math.cos(a);
    const ay = Math.sin(a);
    const P = (u: number, v: number) => `${f2(cx + u * ax - v * ay)} ${f2(cy + u * ay + v * ax)}`;
    pts.push(`M${P(-pl, 0)}`);
    pts.push(`C${P(-pl, pr * k)} ${P(-pl * k, pr)} ${P(0, pr)}`);
    pts.push(`C${P(pl * k, pr)} ${P(pl, pr * k)} ${P(pl, 0)}`);
    pts.push(`C${P(pl, -pr * k)} ${P(pl * k, -pr)} ${P(0, -pr)}`);
    pts.push(`C${P(-pl * k, -pr)} ${P(-pl, -pr * k)} ${P(-pl, 0)} Z`);
    petals += pts.join(' ') + ' ';
  }
  return { petals: petals.trim(), heart: ellipse(x, y, r * 0.34) };
}

// ---- the hats -------------------------------------------------------------------------------------------------------

/** Felix's picks (31.10): Nikolaus 2 «Набекрень», winter 3 «Мешковатая». */
export const DEFAULT_HATS: Readonly<Record<HatId, NewHatVariant>> = { nikolaus: '2', winterhat: '3' };

/** Which drawing a hat outfit uses (the gallery passes its own pick, e.g. the rejected 28.10 hats for comparison). */
export type HatPick = (id: HatId) => HatSpec;
export const defaultHat: HatPick = (id) => NEW_HATS[id][DEFAULT_HATS[id]];

const NEW_COLORS: Record<'leaf' | 'daisy', Record<WearTheme, readonly [string, string]>> = {
  // the leaf keeps its own autumn palette (leaves.ts PALETTES.amber); the tokens are unused
  leaf: { light: ['#EF8E34', '#D9532A'], dark: ['#EF8E34', '#D9532A'], navy: ['#EF8E34', '#D9532A'] },
  // white-pink petals (pink is what makes them read on the cream fur), a golden heart
  daisy: { light: ['#FBE3EA', '#F2B530'], dark: ['#FBE3EA', '#F5C04A'], navy: ['#FBE3EA', '#F5C04A'] },
};

let seq = 0;

function freshMarkup(id: 'leaf' | 'daisy'): { land: { x: number; y: number }; inner: string } {
  if (id === 'leaf') {
    const k = LEAF_AT.r / MAPLE.radius;
    return {
      land: { x: LEAF_AT.x, y: LEAF_AT.y },
      inner: `<g class="wr-head"><g transform="translate(${LEAF_AT.x} ${LEAF_AT.y}) rotate(${LEAF_AT.deg}) scale(${f2(k)})">${leafMarkup('maple', 'amber', `sm-leaf-${++seq}`)}</g></g>`,
    };
  }
  const d = daisy(DAISY_AT.x, DAISY_AT.y, DAISY_AT.r);
  return {
    land: { x: DAISY_AT.x, y: DAISY_AT.y },
    inner: `<g class="wr-head"><g transform="rotate(-12 ${DAISY_AT.x} ${DAISY_AT.y})">
      <path ${o} d="${d.petals}" fill="${W1('#FBE3EA')}"/>
      <path ${o} d="${d.heart}" fill="${W2('#F2B530')}"/>
      <path d="${ellipse(DAISY_AT.x + 1.2, DAISY_AT.y + 1.4, DAISY_AT.r * 0.2)}" fill="${shade(W2('#F2B530'), 82)}" opacity=".45"/>
    </g></g>`,
  };
}

/** --mascot-wear-1 / -2 for an outfit in a theme (the host sets them; they pass the shadow boundary). */
export function outfitVars(id: OutfitId, theme: WearTheme, hat: HatPick = defaultHat): Record<string, string> {
  if (id === 'nikolaus' || id === 'winterhat') {
    const [a, b] = hat(id).colors[theme];
    return { '--mascot-wear-1': a, '--mascot-wear-2': b };
  }
  if (id === 'leaf' || id === 'daisy') {
    const [a, b] = NEW_COLORS[id][theme];
    return { '--mascot-wear-1': a, '--mascot-wear-2': b };
  }
  return wearVars(id, theme);
}

/** What this puppet wears now (null = nothing): read from its shadow root. */
export function wearing(root: ShadowRoot): WearId | null {
  const outfit = root.querySelector('.wr[data-wear]')?.getAttribute('data-wear');
  if (isOutfitId(outfit)) return outfit;
  const costume = costumeOn(root);
  return isCostumeId(costume) ? costume : null;
}

/**
 * Dresses the puppet whose shadow root is `root` (null = takes everything off): one seasonal outfit or one costume,
 * never both. Returns the outfit's group (its first child `.wr-fall` is what the put-on drop moves) — for a costume its
 * first container (dropIn knows it) — or null. `host` gets an outfit's colour tokens (the costumes have their own).
 */
export function dress(root: ShadowRoot, host: HTMLElement, id: WearId | null, theme: WearTheme = 'light', hat: HatPick = defaultHat): SVGGElement | null {
  takeOff(root);
  undress(root);
  for (const v of ['--mascot-wear-1', '--mascot-wear-2']) host.style.removeProperty(v);
  if (!id) return null;
  if (isCostumeId(id)) return dressCostume(root, id)[0] ?? null;
  for (const [k, v] of Object.entries(outfitVars(id, theme, hat))) host.style.setProperty(k, v);
  if (id === 'scarf' || id === 'party') return putOn(root, id);
  const breathe = root.querySelector('.breathe');
  if (!breathe) return null;
  if (!root.querySelector('style[data-wardrobe]')) {
    const style = document.createElement('style');
    style.dataset['wardrobe'] = '';
    style.textContent = WEAR_CSS;
    root.append(style);
  }
  const spec = id === 'nikolaus' || id === 'winterhat' ? hat(id) : null;
  const m = spec ? { land: spec.land, inner: `<g class="wr-head">${spec.markup()}</g>` } : freshMarkup(id as 'leaf' | 'daisy');
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'wr wr-slot-head');
  g.setAttribute('data-wear', id);
  if (spec) g.setAttribute('data-variant', spec.variant);
  g.innerHTML = `<g class="wr-fall" style="transform-origin: ${m.land.x}px ${m.land.y}px">${m.inner}</g>`;
  const child = (cls: string) => Array.from(breathe.children).find((c) => c.classList.contains(cls)) ?? null;
  // over the ears (before the paws) or behind them (before the lop ears: the ear roots overlap the brim)
  breathe.insertBefore(g, spec?.layer === 'under' ? child('lop') : child('tp'));
  // ear flaps (the rejected 28.10 winter hat «A») live ON the ears (inside .ear-l / .ear-r), so they swing with them;
  // their shape stays inside each ear's own box, so the ear's pivot (transform-box: fill-box) does not move
  if (spec?.flap) {
    for (const [cls, side] of [['ear-l', -1], ['ear-r', 1]] as const) {
      const ear = root.querySelector(`.lop .${cls}`);
      if (!ear) continue;
      const fl = document.createElementNS(SVG_NS, 'g');
      fl.setAttribute('class', 'wr wr-flap');
      fl.innerHTML = spec.flap(side);
      ear.append(fl);
    }
  }
  followThrough(root);
  return g;
}

/** The wardrobe v2 spec of a reused outfit (null for the new ones) — the gallery shows where it comes from. */
export const reused = (id: OutfitId) => (id === 'scarf' || id === 'party' ? WEAR[id] : null);

/** The put-on drop (ms) and its keyframes: falls 30 units, lands with a soft squash, one small rebound, rest. */
export const DROP_MS = 560;
export const DROP_FRAMES: Keyframe[] = [
  { transform: 'translate(0px, -30px) scale(1, 1)', offset: 0, easing: 'cubic-bezier(.5, 0, .9, .6)' },
  { transform: 'translate(0px, 0px) scale(1.06, .9)', offset: 0.42, easing: 'cubic-bezier(.2, .8, .4, 1)' },
  { transform: 'translate(0px, -5px) scale(.98, 1.03)', offset: 0.68, easing: 'cubic-bezier(.5, 0, .6, 1)' },
  { transform: 'translate(0px, 0px) scale(1.015, .985)', offset: 0.86, easing: 'ease-out' },
  { transform: 'translate(0px, 0px) scale(1, 1)', offset: 1 },
];

/**
 * «Обновка» light: the outfit drops in from 30 units above and fades in, lands with a gentle squash-and-rebound
 * (a soft bounce), then Pompon does his one approved hop. Transform / opacity only, 560 ms + the hop; ear flaps
 * fade in with it. Reduced motion = nothing moves (the outfit is simply there). Returns the drop's animation.
 */
export function dropIn(worn: SVGGElement | null, reduced: boolean): Animation | null {
  if (worn?.classList.contains('cs')) return costumeIn(worn, reduced);
  const fall = worn?.firstElementChild;
  if (!worn || !fall || reduced || typeof (fall as Element).animate !== 'function') return null;
  const fade: Keyframe[] = [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 1 }];
  worn.animate(fade, { duration: DROP_MS, easing: 'linear' });
  const root = worn.getRootNode();
  if (root instanceof ShadowRoot) for (const fl of Array.from(root.querySelectorAll('.wr-flap'))) fl.animate(fade, { duration: DROP_MS, easing: 'linear' });
  return (fall as Element).animate(DROP_FRAMES, { duration: DROP_MS });
}

/** A costume's put-on: every piece fades in and settles from 18 units above with one soft rebound (translate only). */
export const COSTUME_IN_FRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translate(0px, -18px)', offset: 0, easing: 'cubic-bezier(.5, 0, .9, .6)' },
  { opacity: 1, transform: 'translate(0px, 0px)', offset: 0.45, easing: 'cubic-bezier(.2, .8, .4, 1)' },
  { opacity: 1, transform: 'translate(0px, -3px)', offset: 0.7, easing: 'cubic-bezier(.5, 0, .6, 1)' },
  { opacity: 1, transform: 'translate(0px, 0px)', offset: 1 },
];

/**
 * «Обновка» for a costume (dropIn does it for a costume's container): all its pieces of this puppet land together, in
 * DROP_MS; transform / opacity only. Reduced motion = nothing moves (the costume is simply there).
 */
function costumeIn(box: SVGGElement, reduced: boolean): Animation | null {
  const root = box.getRootNode();
  if (reduced || !(root instanceof ShadowRoot) || typeof box.animate !== 'function') return null;
  let first: Animation | null = null;
  for (const b of Array.from(root.querySelectorAll('.cs'))) {
    const a = b.animate(COSTUME_IN_FRAMES, { duration: DROP_MS });
    first ??= a;
  }
  return first;
}
