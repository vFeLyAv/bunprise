/**
 * New hats (31.10) — drawn here in the gallery, moved to the package the same day (src/wardrobe/hats.ts): the app's
 * Sammlung wears Felix's picks (Nikolaus 2 «Набекрень», winter 3 «Мешковатая»). The gallery keeps importing them from
 * here; the costumes page puts them on through rig.ts (slot `over` or `under-ears`, turning like the head: cs-head).
 */

import type { HatId, NewHatVariant } from '../../src/wardrobe/hats';

export { NEW_HAT_VARIANTS, NEW_HATS } from '../../src/wardrobe/hats';

/** My pick for Felix (31.10, before he chose: he took Nikolaus 2 and winter 3 — src/wardrobe/outfits.ts DEFAULT_HATS). */
export const RECOMMENDED: Record<HatId, NewHatVariant> = { nikolaus: '2', winterhat: '2' };
