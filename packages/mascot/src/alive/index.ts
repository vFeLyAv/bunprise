/**
 * @bunprise/mascot/alive — «Живые анимации» (Felix 31.10: «…ну и новых живых анимаций»; gallery `?screens=alive`,
 * approved for the app after rounds 2–3: «Всё остальное хорошо»; the flop and the slump are dropped). A separate entry,
 * lazy like the Tower and the night: a screen without a resting mascot never loads it.
 *
 *   const rig = dressAlive(puppet)                 // the parts on a puppet the host already shows (or mountAlive)
 *   const run = playAlive(rig, authorAlive('groom', rig), { idle: false })
 *   await run.done                                  // or run.stop() — at once back to the rest pose
 *   const mix = new AliveMix({ kind: 'bunny', now: clock.now() })   // when, and which one
 *
 * Every moment is one finite timeline (seek(t) = the same frame), transform / opacity only, from and back to the
 * puppet's rest pose. Design: docs/design/2026-10-31-alive.md; the app's rules: apps/web features/mascot-ui/alive.ts.
 */

export {
  BODY_ORIGIN, DUST_N, DUST_NAMES, dressAlive, GEO, mountAlive, NEUTRAL, PUFF_DIRS, PUFF_N, PUFF_NAMES, ROLL_ORIGIN,
  type AliveKind, type AliveRig, type DustName, type Extra, type Geo, type LyingDrawing, type PartName, type Pose, type PuffName, type RigOptions,
} from './rig';
export {
  ALIVE_IDS, ALIVE_MOVES, aliveInfo, authorAlive, blink, Builder, DIG_S, earTip, EYES, EZ, GROOM_S, HWASH_S, lick, LOAF_S, MARK_RU,
  pawAt, PERISCOPE_S, POST_S, SNEEZE_S, STRETCH_S, toHappy, toOpen, wiggleNose, yawn,
  type AliveId, type AliveInfo, type Key, type Shot,
} from './moves';
export { ALIVE_MIX, ALIVE_RULES, AliveMix, alivePool, aliveRng, pickAlive, type AliveMixOptions, type AliveMixRow, type AlivePickContext, type AliveRules, type AliveTier } from './mix';
export { playAlive, SeenClock, type AliveRun, type PlayOptions } from './play';
import type { AliveId } from './moves';

/**
 * The moments that keep his paws and his turn as they are — the only ones while Pompon wears a costume of
 * «Pompons Sammlung» (a held book / dumbbell / sword stays in the paws' slot, the laptop hides his paws and turns him).
 */
export const ALIVE_PAWS_FREE: readonly AliveId[] = ['sneeze'];

/** Pompon wears a costume now (src/wardrobe costume-rig: its <style data-costume>; seasonal outfits do not count). */
export function wearsCostume(root: ShadowRoot): boolean {
  return root.querySelector('style[data-costume]') !== null;
}
