/**
 * The "stage": only one mascot animates at a time (design-system-motion.md §4.7).
 *
 * Module-level registry of mounted mascots. `requestStage(id)` hands the stage
 * to one mascot and stops the idle loop of the others; `releaseStage(id)`
 * gives idle back to those that want it. A play() request while another
 * mascot is busy is skipped — scenes are never queued.
 *
 * A member is anything that animates: a bunny or hamster puppet, or the welcome stage
 * (features/mascot-ui/WelcomeBunnies.tsx — it counts as the active mascot while its choreography
 * plays, and is "busy" exactly then).
 *
 * Pausing when hidden / offscreen is done by the package itself
 * (packages/mascot src/core.ts IdleScheduler.observe), not here.
 */
import type { Bunny, Hamster, MomentClass } from '@bunprise/mascot';

export type AnyMascotInstance = Bunny | Hamster;

/** What the stage needs from a member (Bunny and Hamster have it; the welcome stage adapts to it). */
export interface StageMember {
  /** mid-scene / mid-choreography: nobody else may start now */
  readonly busy: boolean;
  readonly isDestroyed: boolean;
  readonly suspended?: boolean;
  stopIdle(): void;
  startIdle(): void;
  /** Immediately freeze or hide a lower-priority moment. */
  interrupt?(): void | Promise<void>;
}

interface Entry {
  instance: StageMember;
  /** Whether this mascot wants its idle loop when it is not on stage. */
  idle: boolean;
}

const entries = new Map<symbol, Entry>();
let active: symbol | null = null;
let activeClass: MomentClass = 'decoration';
const PRIORITY: Record<MomentClass, number> = { decoration: 0, illustration: 1, response: 2, work: 3 };

function resumeOneIdle(): void {
  let chosen = false;
  for (const e of entries.values()) {
    if (e.instance.isDestroyed) continue;
    if (active === null && e.idle && !chosen) { chosen = true; e.instance.startIdle(); }
    else e.instance.stopIdle();
  }
}

export function registerMascot(id: symbol, instance: StageMember, idle: boolean): void {
  entries.set(id, { instance, idle });
  if (active !== null && active !== id) instance.stopIdle();
  else if (active === null) resumeOneIdle();
}

export function unregisterMascot(id: symbol): void {
  entries.delete(id);
  if (active === id) releaseStage(id);
}

export function setMascotIdle(id: symbol, idle: boolean): void {
  const e = entries.get(id);
  if (e) e.idle = idle;
  if (active === null) resumeOneIdle();
  else if (active !== id) e?.instance.stopIdle();
}

/** True when `id` may animate now. False = another mascot is mid-scene; skip. */
export function requestStage(id: symbol, momentClass: MomentClass = 'response'): boolean {
  if (active !== null && active !== id) {
    const current = entries.get(active);
    if (current && !current.instance.isDestroyed && current.instance.busy) {
      if ((!current.instance.suspended && PRIORITY[momentClass] <= PRIORITY[activeClass]) || !current.instance.interrupt) return false;
      // Set ownership before interruption: an old onEnd callback cannot release the new owner's stage.
      active = id;
      void current.instance.interrupt();
    }
  }
  active = id;
  activeClass = momentClass;
  for (const [key, e] of entries) {
    if (key !== id && !e.instance.isDestroyed) e.instance.stopIdle();
  }
  return true;
}

export function releaseStage(id: symbol): void {
  if (active !== id) return;
  // A repeated tap/play can be skipped by the puppet's scene queue and resolve
  // immediately. Only the completion of its actual running scene frees the stage.
  const instance = entries.get(id)?.instance;
  if (instance && !instance.isDestroyed && instance.busy) return;
  active = null;
  resumeOneIdle();
}

/** Which mascot holds the stage (tests / dev overlays). */
export function activeMascot(): symbol | null {
  return active;
}

/** Tests only. */
export function resetStage(): void {
  entries.clear();
  active = null;
}
