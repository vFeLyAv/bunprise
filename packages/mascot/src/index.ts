/**
 * @bunprise/mascot — the Bunprise mascots (bunny + hamster) as reusable,
 * framework-agnostic TypeScript. Importing this module also registers the
 * <bunprise-mascot> custom element (when running in a browser).
 *
 * The welcome stage (WelcomeStage, <bunprise-welcome>) and the carry (CarryStage) are side-effect free:
 * a bundle that does not use it does not contain it. Call
 * defineWelcomeElement() once to register <bunprise-welcome>.
 */

import { Bunny, BUNNY_COATS, BUNNY_SCENES } from './bunny';
import { Hamster, HAMSTER_COATS, HAMSTER_SCENES } from './hamster';
import { defineMascotElement } from './element';
import type { CreateMascotOptions } from './types';

export { Bunny, BUNNY_COATS, BUNNY_SCENES } from './bunny';
export { Hamster, HAMSTER_COATS, HAMSTER_SCENES } from './hamster';
export { MascotBase, COAT_VARS } from './mascot';
export { SPRING, EASINGS, anim, ReducedMotion, IdleScheduler, SceneQueue } from './core';
export { BunpriseMascotElement, defineMascotElement, MASCOT_TAG, type AnyMascot } from './element';
export { WelcomeStage, welcomeSteps, stageUnit, WELCOME_PRESETS, WELCOME_DEFAULT_BUNNIES, MAX_ACTORS } from './welcome';
export { BunpriseWelcomeElement, defineWelcomeElement, WELCOME_TAG } from './welcome-element';
export { CarryStage } from './carry';
export { ChaseStage, type ChaseOptions } from './chase';
export { NibbleStage, type NibbleOptions } from './nibble';
export { OverfedStage, type OverfedOptions } from './overfed';
export { HamsterEdgeStage, type HamsterEdgeOptions } from './hamster-edge';
export { gallop } from './gallop';
export { setBunnyFur, furOf, type FurId } from './fur';
export type * from './types';

/** Scene names per mascot (in the order the demo shows them). */
export const SCENES = {
  bunny: BUNNY_SCENES,
  hamster: HAMSTER_SCENES,
} as const;

/** Coats per mascot (id, Russian name, pattern, the seven colours). */
export const COATS = {
  bunny: BUNNY_COATS,
  hamster: HAMSTER_COATS,
} as const;

/** Builds a mascot of the given kind inside `host` (a div/span/custom element — it gets a Shadow DOM). */
export function createMascot(host: HTMLElement, options: CreateMascotOptions): Bunny | Hamster {
  return options.kind === 'hamster' ? new Hamster(host, options) : new Bunny(host, options);
}

defineMascotElement();
