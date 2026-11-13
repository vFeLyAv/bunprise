/**
 * <BunnyMoment kind="…" /> — the bunnies live across the app (wave 1, Felix's K8): one small, stable API
 * for every mascot moment that is not a scene of the standalone <Mascot> (those stay in Mascot.tsx).
 *
 *   kind          what happens                                                     where (wave 1)
 *   'welcome'     the ≈ 8 s show of four bunnies, the main one waves and stays     start screen
 *   'hello'       the short two-bunny show (a friend hops across, Pompon waves)    onboarding
 *   'peek'        climbs over the card's top edge, looks around and stays         empty states, invite landing
 *   'pop-up'      pops up from behind the card, looks at you, ducks back           occasion page (hero card)
 *   'wave'        peeks up and waves, stays                                        profile saved, onboarding done
 *   'hop-across'  a friend hops across behind the card, without a stop             feed (first open of the day)
 *   'peek-side'   peeks from behind the right edge, looks in, ducks                settings
 *   'lost'        looks left and right, puzzled, sniffs, stays                     404
 *   'shrug'       shrugs with its paws ("no idea"), stays                          error screens
 *   'sleepy'      yawns and nods off on the edge, stays (a floating "z")           legal pages
 *
 * Geometry: this component renders the stage host; the CALLER places it (className / style) so that its
 * bottom edge lies `edgeInset` px below the top edge of the card in `cardRef` (the paws then rest on the
 * card, the body hides behind it) and above the card in the stacking order — or, for 'hop-across', BEHIND
 * the card (lower z-index), so the card covers the lower half of the hopping bunny.
 * Rules (all built in): lazy (the stage code is its own chunk, the package arrives after the first paint);
 * one animating mascot at a time (stage.ts: when another is busy it starts at its calm end pose, or shows
 * nothing for 'hop-across'); paused while the tab is hidden or the host is off-screen; the motion level
 * (src/motion/level.ts): 'reduced' ("Weniger") → overlays that only decorate a card ('peek', 'pop-up',
 * 'wave', 'hop-across', 'peek-side') are not shown at all — a bunny frozen over a card "keeps staring at
 * you" (Felix, 20.10) — while the screen's own illustration ('welcome', 'hello', 'lost', 'shrug', 'sleepy',
 * or any kind with calm="still", e.g. an empty state) shows its static pose; 'off' or "Kaninchen zeigen"
 * off → nothing;
 * never blocks input (pointer-events: none); decorative (aria-hidden).
 * `once`: 'always' (every mount), 'visit' (once per tab visit), 'day' (once per day on this device) — when
 * already played, the calm end pose (or nothing for 'hop-across'). Storage keys: docs/storage-registry.md.
 */
import { Suspense, lazy, useId, useMemo, type CSSProperties, type RefObject } from 'react';
import type { BunnyCoat, MomentClass, WelcomePreset } from '@bunprise/mascot';
import { useBunniesShown, useMotionAttr } from '../../ui/motionMode';
import { pickMoment, type DirectorPick, type MomentFamily } from './director';

const WelcomeBunnies = lazy(() => import('./WelcomeBunnies'));
const MoveMoment = lazy(() => import('./MoveMoment'));

export type BunnyMomentKind = 'welcome' | 'hello' | 'peek' | 'pop-up' | 'wave' | 'hop-across' | 'peek-side' | 'lost' | 'shrug' | 'sleepy';

export interface BunnyMomentProps {
  kind: BunnyMomentKind;
  pick?: DirectorPick;
  /** Vary an existing host without adding another mascot or an eager route import. */
  family?: MomentFamily;
  momentClass?: MomentClass;
  /** Start at the calm end pose without playing (e.g. the second auth step). */
  still?: boolean;
  /** The card whose top edge the bunny holds on to: its top corner radius becomes the clip curve. */
  cardRef?: RefObject<HTMLElement | null>;
  /** px between the host's bottom edge and the card's top edge. Default 16 (0 for 'hop-across'). */
  edgeInset?: number;
  /** When to play the moment. Default: 'visit' for 'welcome' / 'hello', 'day' for 'hop-across', else 'always'. */
  once?: 'always' | 'visit' | 'day';
  /** Name of the once-memory (default: the kind), e.g. 'feed' or `occasion-${id}`. */
  onceKey?: string;
  /** Width of the main bunny is clamped to [minSize, maxSize] px. */
  minSize?: number;
  maxSize?: number;
  /** Once per show, when the moment is over. */
  onEnd?: () => void;
  /**
   * When it cannot play now (already seen under `once`, or another mascot holds the stage): 'end' = its calm
   * end pose, 'none' = nothing (a moment must never just appear at its end, e.g. the "+" menu). Default 'end'
   * ('none' for 'hop-across').
   */
  whenSeen?: 'end' | 'none';
  /** Under the motion level 'reduced': 'still' = the static pose, 'hide' = nothing. Default: 'still' for
   *  the screen illustrations ('welcome', 'hello', 'lost', 'shrug', 'sleepy'), 'hide' for card overlays. */
  calm?: 'still' | 'hide';
  className?: string;
  style?: CSSProperties;
}

const STILL_WHEN_CALM: ReadonlySet<BunnyMomentKind> = new Set(['welcome', 'hello', 'lost', 'shrug', 'sleepy']);

const PRESET: Record<BunnyMomentKind, WelcomePreset> = {
  welcome: 'welcome',
  hello: 'welcome',
  peek: 'peek-once',
  'pop-up': 'pop-up',
  wave: 'wave',
  'hop-across': 'hop-across',
  'peek-side': 'peek-side',
  lost: 'lost',
  shrug: 'shrug',
  sleepy: 'sleepy',
};

/** Who plays it: Pompon (fawn) for most, his friends for the quick visits. */
const CAST: Partial<Record<BunnyMomentKind, readonly BunnyCoat[]>> = {
  hello: ['fawn', 'choc'],
  'hop-across': ['broken'],
  'peek-side': ['choc'],
  sleepy: ['himalayan'],
};

const DEFAULT_ONCE: Partial<Record<BunnyMomentKind, 'visit' | 'day'>> = {
  welcome: 'visit',
  hello: 'visit',
  'hop-across': 'day',
};

export function BunnyMoment({ kind, pick: explicitPick, family, momentClass, still, cardRef, edgeInset, once, onceKey, minSize, maxSize, onEnd, whenSeen, calm, className, style }: BunnyMomentProps) {
  const level = useMotionAttr();
  const shown = useBunniesShown();
  const opening = useId();
  const placement = calm === 'still' ? 'illustration' : family === 'screen-host:start' ? 'card-top' : family === 'screen-host:profile' ? 'compact-edge' : undefined;
  const pick = useMemo(() => explicitPick ?? (family && shown ? pickMoment(family, { motion: level === 'auto' ? 'full' : level, requestKey: opening, ...(placement ? { placement } : {}) }) : null), [explicitPick, family, shown, level, opening, placement]);
  if (!shown) return null;
  if (level === 'reduced' && (calm ?? (STILL_WHEN_CALM.has(kind) ? 'still' : 'hide')) === 'hide') return null;
  const policy = once ?? DEFAULT_ONCE[kind] ?? 'always';
  const name = onceKey ?? kind;
  const cast = pick ? [pick.coat, pick.coat === 'choc' ? 'fawn' : 'choc'] as const : CAST[kind];
  if (pick?.special === 'hamster' || pick?.special === 'chase') return (
    <Suspense fallback={null}><MoveMoment kind={pick.special === 'hamster' ? 'hamster' : 'chase'} momentClass={momentClass ?? 'decoration'} edge={pick.edge === 'top' ? 'bottom' : pick.edge} coat={pick.coat} className={className} style={style} {...(onEnd ? { onEnd } : {})} /></Suspense>
  );
  return (
    <Suspense fallback={null}>
      <WelcomeBunnies
        choreography={pick?.preset ?? PRESET[kind]}
        {...(still ? { still: true } : {})}
        momentClass={momentClass ?? (STILL_WHEN_CALM.has(kind) || calm === 'still' ? 'illustration' : 'decoration')}
        calmEyes={kind === 'sleepy' ? 'sleep' : 'happy'}
        {...(pick?.special === 'calendar' ? { item: 'calendar' } : {})}
        {...(cast ? { bunnies: cast } : {})}
        edgeInset={edgeInset ?? (kind === 'hop-across' ? 0 : 16)}
        {...(cardRef ? { cardRef } : {})}
        {...(policy === 'visit' ? { oncePerVisit: name } : {})}
        {...(policy === 'day' ? { oncePerDay: name } : {})}
        whenSeen={whenSeen ?? (kind === 'hop-across' ? 'none' : 'end')}
        {...(minSize !== undefined ? { minSize } : {})}
        {...(maxSize !== undefined ? { maxSize } : {})}
        {...(onEnd ? { onEnd } : {})}
        className={className}
        style={style}
      />
    </Suspense>
  );
}
