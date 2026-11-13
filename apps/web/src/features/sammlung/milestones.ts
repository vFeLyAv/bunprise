import type { CostumeId } from '@bunprise/mascot/wardrobe-rules'
import type { SceneId } from './scenes'

// The costumes of «Pompons Sammlung» (31.10; Felix: «Всё, что мне уже понравилось и подтвердилось, можешь добавлять в
// приложение»; the brief: «награды за события (новый костюм), без лутбоксов»). Each of the thirteen approved costumes (spa came last) is
// the reward for ONE of the person's own milestones in the app — clear, no chance, no streaks, no «you missed a day».
// The order below is the order of the Garderobe (roughly the order people meet these things). Felix can change any
// line here: the milestone ↔ costume pairs, the order (docs/handoffs/2026-10-31-costumes-in-app.md).
//
// SECRECY (CLAUDE.md, the product promise): a milestone is only ever the person's OWN action on their OWN things, after
// the server said yes — never a reservation, never something other people did, never other people's lists. The
// recorder takes nothing but a fixed id (./note.ts noteMilestone, ./store.ts); «Psst» — the one find that means «I
// reserved a gift» — never counts for a costume (sixFinds below). Nothing leaves the device (./store.ts).

export interface Milestone {
  /** a fixed name, stored on this device (./store.ts `got`) */
  id: MilestoneId
  /** the costume it gives */
  costume: CostumeId
  /** recorded where it happens (./note.ts noteMilestone) or worked out from the record (derived) */
  derived?: true
}

export const MILESTONE_IDS = [
  'wish', 'list', 'occasion', 'invite', 'friends', 'firststeps', 'photo', 'banner', 'comic', 'calendar', 'received', 'wishphoto', 'scenes',
] as const
export type MilestoneId = (typeof MILESTONE_IDS)[number]
/** The milestones a place in the app records (the others are worked out from the record). */
export type NotedMilestone = Exclude<MilestoneId, 'firststeps' | 'scenes'>

export const isMilestoneId = (v: unknown): v is MilestoneId => typeof v === 'string' && (MILESTONE_IDS as readonly string[]).includes(v)
export const isNotedMilestone = (v: unknown): v is NotedMilestone => isMilestoneId(v) && v !== 'firststeps' && v !== 'scenes'

/**
 *  1 wish       a wish of yours is saved                              → the laptop (he types, Enter, a heart: «sent»)
 *  2 list       a list of yours is created                            → glasses + book (a list is a little book)
 *  3 occasion   an occasion of yours is in the calendar               → the tuxedo (dressed up for the day)
 *  4 invite     you made the invite link for your occasion            → the pancake (guests are coming: pancakes!)
 *  5 friends    you made your friend link or friend code              → the hoodie with bunny ears (a bunch of bunnies)
 *  6 firststeps 1 + 3 + 5: the three «Erste Schritte» of Start          → sport (warm-up done)
 *  7 photo      you uploaded a profile photo                          → sunglasses (photo shoot)
 *  8 banner     you chose a banner for your lists page                → the lily hat (you decorated)
 *  9 comic      you read an episode of «Pompon & Tapsi» to its end    → the samurai (a manga)
 * 10 calendar   you subscribed Bunprise in your own calendar          → the shark hood (it dives into your calendar)
 * 11 received   you marked one of your wishes «Erhalten»              → the bandana with a bow (a gift bow)
 * 12 wishphoto  you gave one of your wishes a photo                    → spa (a well-groomed wish: «Pflege», Wellness)
 * 13 scenes     six hidden scenes found («Psst» does not count)       → the knight (the collection's hero)
 */
export const MILESTONES: readonly Milestone[] = [
  { id: 'wish', costume: 'laptop' },
  { id: 'list', costume: 'reading' },
  { id: 'occasion', costume: 'groom' },
  { id: 'invite', costume: 'pancake' },
  { id: 'friends', costume: 'bunnyhood' },
  { id: 'firststeps', costume: 'sport', derived: true },
  { id: 'photo', costume: 'sunglasses' },
  { id: 'banner', costume: 'lily' },
  { id: 'comic', costume: 'samurai' },
  { id: 'calendar', costume: 'shark' },
  { id: 'received', costume: 'bandana' },
  { id: 'wishphoto', costume: 'spa' },
  { id: 'scenes', costume: 'knight', derived: true },
]

export const milestoneOf = (costume: CostumeId): Milestone | undefined => MILESTONES.find((m) => m.costume === costume)

/** Finds that count for the knight: six — never «Psst» (it would say «this person reserved a gift»). */
export const SCENES_FOR_KNIGHT = 6
export function knightFinds(found: readonly SceneId[]): number {
  return found.filter((id) => id !== 'psst').length
}

/**
 * The milestones this person has, in the Garderobe's order: the recorded ones (`got`) and the two worked out from the
 * record — firststeps (wish + occasion + friends) and scenes (six finds without «Psst»). Depends on NOTHING else.
 */
export function earnedMilestones(found: readonly SceneId[], got: readonly MilestoneId[]): MilestoneId[] {
  const has = new Set<MilestoneId>(got.filter(isNotedMilestone))
  if (has.has('wish') && has.has('occasion') && has.has('friends')) has.add('firststeps')
  if (knightFinds(found) >= SCENES_FOR_KNIGHT) has.add('scenes')
  return MILESTONES.filter((m) => has.has(m.id)).map((m) => m.id)
}

/** The costumes that are the person's (in the Garderobe's order). */
export function earnedCostumes(found: readonly SceneId[], got: readonly MilestoneId[]): CostumeId[] {
  const earned = earnedMilestones(found, got)
  return MILESTONES.filter((m) => earned.includes(m.id)).map((m) => m.costume)
}
