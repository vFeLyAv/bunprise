/**
 * @bunprise/mascot/wardrobe — «Pompons Sammlung»: the six outfits Pompon can wear (31.10, Felix's decisions 28.10 /
 * 31.10, docs/design/2026-10-27-pompons-sammlung.md) and the twelve costumes from Felix's photos (31.10, approved:
 * docs/design/2026-10-31-costumes-bunnies.md, the laptop composition A). Opt-in and a separate entry: a bundle that
 * never dresses him does not contain the drawings, and a puppet nobody dresses is exactly as before.
 *
 *   const worn = wearNow(choice, dayMonth(new Date()), foundCount, costumesOfThePerson)   // also @bunprise/mascot/wardrobe-rules
 *   dress(mascot.root, mascot.host, worn, 'light')                       // on (null = off); theme: light | dark | navy
 *   dropIn(group, reduced)                                               // the put-on moment (nothing under reduced motion)
 *   new LaptopTyping(mascot.root, mascot.host, reduced, onEnd).play()    // the laptop's typing (one timeline, finite)
 *
 * Every puppet built from the package markup can wear them (the mascot, a stage actor, the Lists buddy):
 * `puppetRoots(node)` finds their shadow roots under a host.
 */

export {
  COSTUME_IDS,
  COSTUME_IN_FRAMES,
  dayMonth,
  DEFAULT_HATS,
  defaultHat,
  dress,
  DROP_FRAMES,
  DROP_MS,
  dropIn,
  isCostumeId,
  isOutfitId,
  outfit,
  OUTFIT_IDS,
  OUTFITS,
  outfitVars,
  seasonOutfit,
  unlocked,
  wearing,
  wearNow,
  wornNow,
  type CostumeId,
  type DayMonth,
  type EarnMode,
  type HatPick,
  type Outfit,
  type OutfitId,
  type WearChoice,
  type WearId,
  type WearTheme,
} from './outfits';
export { puppetRoots } from './items';
export { COSTUMES, costumeLook, type Costume } from './costumes';
export { LaptopTyping, STILL_T, TYPE_S } from './laptop';
export type { HatId, HatSpec, NewHatVariant } from './hats';
