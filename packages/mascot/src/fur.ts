/**
 * Fur details of a bunny's OWN coat (not clothes) — opt-in, per coat. 31.10, Felix (gallery «Эксперименты с
 * Помпоном», docs/design/2026-10-31-costumes-bunnies.md §0/§5): «наверное, только с щёчками лучше» — Pompon gets the
 * fluffy cheeks («Flauschbäckchen»), alone, without ear tufts.
 *
 *   setBunnyFur({ fawn: ['cheeks'] })   // the app, once, before it builds a puppet: every fawn bunny = Pompon
 *
 * Nobody calls it → nothing changes: every puppet and scene builds byte for byte as before (test/fur.test.ts pins the
 * default markup). With it, the fur is added to every bunny puppet of that coat wherever it is built — the mascot
 * itself (MascotBase.setCoat) and every stage actor (welcome-actors.ts applyCoat: welcome / "+" menu peeks, the
 * carry, the chase, the tower, the home-screen icon, «Переел») — and taken off again when the coat changes.
 *
 * The cheek fluff: soft tufts along the lower outer edge of each cheek, INSIDE the cheek group (`.cheek-j`), so they
 * puff and chew with it; filled with this puppet's own coat gradient, their outer edge in the silhouette's contour
 * (--mascot-outline, none by default). The same geometry the gallery draws (demo/costumes/fur.ts imports it).
 */

import { line, mirror, smooth, type Pt } from './geometry';
import type { BunnyCoat } from './types';

export type FurId = 'cheeks';

/** Cheek fluff, right cheek (the left one is mirrored): key points of the tufts' shape, puppet units. */
export const CHEEK_PTS: readonly Pt[] = [[60, -92], [73, -95], [77.5, -88], [84.5, -83], [78.6, -78], [83.6, -71], [76.6, -69.4], [78.4, -61.6], [70, -64], [63, -62], [57, -74]];
/** The part of its outline that is outer edge (the contour line). */
export const CHEEK_LN: readonly Pt[] = [[77, -90], [84.5, -83], [78.6, -78], [83.6, -71], [76.6, -69.4], [78.4, -61.6], [70.6, -63.6]];

const paths: Partial<Record<'l' | 'r', { fill: string; edge: string }>> = {};

/** The two paths of one cheek's fluff: `fill` (the tufts, in the coat) and `edge` (their outer contour, open). */
export function cheekFluff(side: 'l' | 'r'): { fill: string; edge: string } {
  return (paths[side] ??= side === 'r'
    ? { fill: smooth(CHEEK_PTS), edge: line(CHEEK_LN) }
    : { fill: smooth(mirror(CHEEK_PTS)), edge: line(mirror(CHEEK_LN)) });
}

/** The contour of fur, inline (a puppet's root may have no stylesheet for it: actors share one sheet). */
const EDGE_STYLE = 'fill: none; stroke: var(--mascot-outline, none); stroke-width: var(--mascot-outline-width, 1.5px); vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round';

let byCoat: ReadonlyMap<string, readonly FurId[]> = new Map();

/**
 * Which coats wear which fur. Replaces the previous setting; `{}` = none (the default). Applies to puppets built
 * (or re-coated) from now on — call it before the first puppet.
 */
export function setBunnyFur(fur: Readonly<Partial<Record<BunnyCoat, readonly FurId[]>>>): void {
  byCoat = new Map(Object.entries(fur).filter((e): e is [string, readonly FurId[]] => Array.isArray(e[1]) && e[1].length > 0));
}

/** The fur a coat wears now (empty = none). */
export function furOf(coat: string): readonly FurId[] {
  return byCoat.get(coat) ?? [];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Puts on / takes off the fur of `coat` on the bunny puppet under `hm` (its `.hm` group). Without a setting this only
 * looks once for fur to take off — the markup stays exactly as built.
 */
export function applyFur(hm: Element, coat: string): void {
  const cheeks = furOf(coat).includes('cheeks');
  const worn = hm.querySelectorAll('.fur-cheeks');
  if (cheeks === worn.length > 0) return;
  if (!cheeks) {
    for (const g of Array.from(worn)) g.remove();
    return;
  }
  for (const side of ['l', 'r'] as const) {
    const j = hm.querySelector(`.cheek-${side} .cheek-j`);
    // the cheek's own fill IS this puppet's coat gradient, url(#<instance>-g-body)
    const fill = j?.querySelector('ellipse')?.getAttribute('fill');
    if (!j || !fill) continue;
    const d = cheekFluff(side);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'fur-cheeks');
    g.setAttribute('pointer-events', 'none');
    g.innerHTML = `<path d="${d.fill}" fill="${fill}"/><path d="${d.edge}" style="${EDGE_STYLE}"/>`;
    j.append(g);
  }
}
