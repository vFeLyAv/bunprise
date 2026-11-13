/**
 * @bunprise/mascot/buddy — the Lists buddy (Felix 25.10): Tapsi the hamster lives on a screen by himself —
 * walks on the top edges of marked elements, inspects cards, admires the avatar, naps — and can be picked up
 * (long-press on touch, drag with a mouse), dangled and thrown. A separate entry so bundles that never show
 * him (every screen but "Listen") do not contain him.
 *
 *   const buddy = createBuddy({ stage, scroller: window, haptics, reducedMotion: 'auto' })
 *   buddy.setPaused(true)   // a sheet is open
 *   buddy.setHidden(true)   // another Tapsi is on screen
 *   buddy.trigger('wish')   // a wish was added: happy hop
 *   buddy.destroy()
 *
 * The stage (position: relative) marks its floors with [data-buddy-floor="<id>"] (the stats row "stats",
 * cards add data-buddy-card="<index>") and the avatar with [data-buddy-avatar]. README: "Дружок на «Списках»".
 */

import { ListsBuddy, type BuddyOptions } from './buddy';

export { ListsBuddy, type BuddyAlive, type BuddyHaptic, type BuddyInfo, type BuddyOptions, type FootingEvent } from './buddy';
export { COOLDOWN_MS as FOOTING_COOLDOWN_MS, DURATION as FOOTING_DURATION, FLINCH as FOOTING_FLINCH, LEAN as FOOTING_LEAN, REACH_U as FOOTING_REACH_U, TOUCH_LIFT_U as FOOTING_TOUCH_LIFT_U } from './footing';
export type { ActionKind, BuddyKind } from './brain';
export type { ReducedMotionMode } from '../types';

/** Builds the buddy in `options.stage`; returns the controller (destroy() removes everything it added). */
export function createBuddy(options: BuddyOptions): ListsBuddy {
  return new ListsBuddy(options);
}
