/**
 * @bunprise/mascot/listplay — «Помпон в открытом списке» (Felix 31.10: «надо добавить ещё анимаций разных, также
 * каких-то взаимодействий с кроликом в листах»; gallery `?screens=listplay`, approved for the app 31.10: «Мне все
 * анимации нравятся»). A separate entry, lazy like the Tower and the night: a screen without a list Pompon (or without
 * any Pompon: the ear pull and the shake are for every Pompon) never loads it.
 *
 *   const rig = mountPompon(layer, { still })            // his own puppet (the list header) …
 *   const dress = dressPompon(puppet)                     // … or the rig's parts on a Pompon the host already shows
 *   const shot = authorBoop({ rig, seat, ghost: false, haptic }, {})
 *   const player = new Player(rig.box, shot.tracks, shot.duration, shot.marks, onEnd); player.play()
 *
 * Every moment is one finite timeline (seek(t) = the same frame), transform / opacity only. Design:
 * docs/design/2026-10-31-list-play.md; the app's rules: apps/web features/wishes/listPompon.ts.
 */

export { BOX_H, dressPompon, EAR_PIVOT, EAR_TIP, earTipAt, FEET, feetAt, feetIn, HIT, mountPompon, NEUTRAL, SIZE, turnPose, UNIT, unitOf, type Dress, type PartName, type PomponParts, type Pose, type Rig } from './rig';
export { Player, type Mark } from './player';
export {
  authorBoop, authorBounce, authorBulk, authorDelete, authorDizzy, authorEnd, authorGrab, authorMove, authorPeek, authorPop, authorPull,
  authorReceived, authorRelax, authorRelease, authorSelect, authorStroke, authorWish, bodyRect, Builder, DIZZY_S, earFollow, END_TEXT, EZ, LID_CRACK,
  NERVOUS, outward, poseAt, STROKE_HOLD, TRIP_HOP_S, TRIP_HOPS, TRIP_REACH, union,
  type Ctx, type EndBubble, type GiftBox, type Haptic, type ListHook, type Moment, type ReceivedTarget, type Rect, type Shot, type Side, type Vec, type WishTarget,
} from './moves';
export { GIFT_BOX, mountGiftBox, type MountedGiftBox } from './box';
export { createShakeDetector, motionOf, SHAKE, type MotionSample, type ShakeDetector, type ShakeRule } from './shake';
// pauses a moment while its host is off screen or the tab is hidden (the same observer every mascot uses)
export { Watch } from '../drive';
