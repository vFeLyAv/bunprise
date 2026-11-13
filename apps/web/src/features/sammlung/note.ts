import { noteMilestoneOf, noteScene } from './store'
import type { NotedMilestone } from './milestones'
import type { SceneId } from './scenes'

// The ONE way a hidden scene becomes a find of «Pompons Sammlung» (design §4): the few components that start a
// collection scene load this module at the moment it really starts — Mascot.tsx (Tapsi's «Psst» and «Staub auf der
// Linse»), MoveMoment.tsx (the chase, the three «Переел»), TowerMoment.tsx, HomeIconScene.tsx, ListsBuddy.tsx
// («Fester Boden») — always with a dynamic import(): the mascot chunks and the first screens' preload lists stay as
// they were (/soon budget). The record itself: store.ts noteScene.
// Not counted: a scene that did not play (Kaninchen off, motion off, one mascot at a time said no, the server said no:
// those places never start it). Counted: the calm «Weniger» version (it was seen). Replays inside the collection use
// the package directly and never come here.

export function noteFind(id: SceneId): void {
  noteScene(id)
}

/** A puppet scene just started (Mascot.tsx play()): Tapsi's two collection scenes. */
export function noteMascotScene(kind: 'bunny' | 'hamster', scene: string): void {
  if (kind !== 'hamster') return
  if (scene === 'secret') noteScene('psst')
  else if (scene === 'speck') noteScene('speck')
}

/** A move stage just started (MoveMoment.tsx): the chase and «Переел» A / B / C. */
export function noteMoveScene(kind: string, variant: string): void {
  if (kind === 'chase') noteScene('chase')
  else if (kind === 'overfed' && (variant === 'a' || variant === 'b' || variant === 'c')) noteScene(`overfed-${variant}`)
}

/**
 * And the ONE way a costume milestone is recorded (./milestones.ts, 31.10): the person's own action on their own thing,
 * called right after the server said yes — always with a dynamic import() from the place it happens, like the finds.
 * Takes only the milestone's fixed name. Never called from anything about reservations or other people's lists
 * (sammlung.test.ts lists every caller).
 */
export function noteMilestone(id: NotedMilestone): void {
  noteMilestoneOf(id)
}
