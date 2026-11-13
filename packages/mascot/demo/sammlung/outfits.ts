/**
 * «Pompons Sammlung» — the wardrobe part for the gallery. 31.10: the outfits, their rules and drawings moved to the
 * package (src/wardrobe/outfits.ts + rules.ts — the app wears them now); this file keeps the gallery's own extra: a
 * choice between ALL hat variants, including the 28.10 ones Felix rejected (&hats=old, ./hats.ts).
 *
 * 28.10: Felix — the Nikolaus hat and the winter hat "look not good": both redrawn in hats.ts, two variants each.
 * 31.10: rejected again; the new ones are '1' | '2' | '3' (src/wardrobe/hats.ts). Felix picked 31.10: Nikolaus 2
 * «Набекрень», winter 3 «Мешковатая» (= the package's DEFAULT_HATS).
 */

import {
  DEFAULT_HATS as PACKAGE_HATS,
  dress as dressWith,
  outfitVars as outfitVarsWith,
  type HatPick,
  type OutfitId,
  type WearTheme,
} from '../../src/wardrobe/outfits';
import { hatSpec, type HatId, type HatVariant } from './hats';

export {
  DAISY_AT,
  DROP_FRAMES,
  DROP_MS,
  dropIn,
  LEAF_AT,
  outfit,
  OUTFIT_IDS,
  OUTFITS,
  reused,
  seasonOutfit,
  unlocked,
  wornNow,
  type EarnMode,
  type Outfit,
  type OutfitId,
  type WearChoice,
} from '../../src/wardrobe/outfits';

/** Which variant of each hat. */
export type HatChoice = Record<HatId, HatVariant>;
export const DEFAULT_HATS: HatChoice = { ...PACKAGE_HATS };
/** The 28.10 hats (rejected), for &hats=old. */
export const OLD_HATS: HatChoice = { nikolaus: 'a', winterhat: 'a' };

const pick = (hats: HatChoice): HatPick => (id) => hatSpec(id, hats[id]);

/** --mascot-wear-1 / -2 for an outfit in a theme (the host sets them; they pass the shadow boundary). */
export function outfitVars(id: OutfitId, theme: WearTheme, hats: HatChoice = DEFAULT_HATS): Record<string, string> {
  return outfitVarsWith(id, theme, pick(hats));
}

/**
 * Dresses the puppet whose shadow root is `root` (null = takes everything off). Returns the outfit's group (its
 * first child `.wr-fall` is what the put-on drop moves), or null. `host` gets the outfit's colour tokens.
 */
export function dress(root: ShadowRoot, host: HTMLElement, id: OutfitId | null, theme: WearTheme = 'light', hats: HatChoice = DEFAULT_HATS): SVGGElement | null {
  return dressWith(root, host, id, theme, pick(hats));
}
