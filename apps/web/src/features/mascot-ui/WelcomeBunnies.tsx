/**
 * The welcome stage (packages/mascot WelcomeStage, README "Приветственная сцена") as a React component:
 * bunnies climb out from behind the top edge of the CARD placed right under this host (and from the
 * side edges of the host), look around, and the main fawn bunny ends peeking up and waving, then breathes.
 *
 * Geometry (README "Край и карточка"): the host's own edges are the edges the bunnies hide behind. The
 * caller places the host so that its bottom edge lies `edgeInset` px BELOW the card's top edge (the
 * paws then rest on the card, the bodies hide behind it), as wide as the card, and above it in the
 * stacking order. `cardRef` → the card's top corner radius is read from its computed style (a theme may
 * change it), so a bunny near a corner hides behind the curve.
 *
 * Loading and motion rules:
 * - Lazy twice over: this component is a lazy chunk of its screens (React.lazy / dynamic import), and
 *   the package arrives with `import()` after the first paint. The empty host reserves the space.
 * - One animating mascot (stage.ts): the stage holds the stage while its choreography plays; when
 *   another mascot is mid-scene it starts at the calm end pose instead.
 * - `oncePerVisit` (a sessionStorage flag under the app prefix): the show plays once per visit; later
 *   visits in the same tab start at the calm end pose (the staying bunny breathes and blinks).
 * - Paused while the tab is hidden or the host is off-screen (the package's IdleScheduler).
 * - Reduced motion (OS or <html data-motion>): the package's static composition, faded in.
 * - Dev only: `?welcome=<seconds>|end` freezes the show at that moment (screenshots; seek()).
 * Decorative (aria-hidden): the text next to it carries the meaning.
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { BunnyCoat, CalmEyes, MomentClass, WelcomePreset, WelcomeStage } from '@bunprise/mascot';
import { ACTIVE_STORAGE_PREFIX } from '../../lib/app';
import { cn } from '../../ui/cn';
import { useMascotMotion } from './mascotMotion';
import { activeMascot, registerMascot, releaseStage, requestStage, unregisterMascot, type StageMember } from './stage';
import { momentBudget, observeMomentActivity } from './budget';

type MascotModule = typeof import('@bunprise/mascot');

let modulePromise: Promise<MascotModule> | null = null;

/** The package chunk (shared with the Mascot wrapper's import), with Pompon's look (./pompon.ts) set first. */
function loadModule(): Promise<MascotModule> {
  modulePromise ??= Promise.all([import('@bunprise/mascot'), import('./pompon')]).then(([mod]) => mod).catch((err: unknown) => {
    modulePromise = null;
    throw err;
  });
  return modulePromise;
}

/** Warm the package chunk (e.g. while the previous screen is still shown). */
export function preloadWelcome(): void {
  void loadModule().catch(() => undefined);
}

/** sessionStorage key of a once-per-visit show (app prefix: cleared with the session like every key). */
export function welcomeSeenKey(name: string): string {
  return `${ACTIVE_STORAGE_PREFIX}welcomeSeen.${name}`;
}

function wasSeen(name: string): boolean {
  try {
    return window.sessionStorage.getItem(welcomeSeenKey(name)) === '1';
  } catch {
    return false;
  }
}

function markSeen(name: string): void {
  try {
    window.sessionStorage.setItem(welcomeSeenKey(name), '1');
  } catch {
    /* storage blocked: the show simply plays again next time */
  }
}

/** Dev screenshots: `?welcome=4.3` or `?welcome=end` freezes the show (never part of a production build). */
function devSeek(): number | 'end' | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('welcome');
  if (raw === null) return null;
  if (raw === 'end') return 'end';
  const t = Number.parseFloat(raw);
  return Number.isFinite(t) && t >= 0 ? t : null;
}

/** Resolves after the next frame is on screen (the show never competes with the first paint). */
function afterPaint(cb: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const raf = requestAnimationFrame(() => {
    timer = setTimeout(cb, 0);
  });
  return () => {
    cancelAnimationFrame(raf);
    if (timer !== undefined) clearTimeout(timer);
  };
}

export interface WelcomeBunniesProps {
  /**
   * 'welcome' = the ≈ 8 s show (4 bunnies; with 2 coats: runner + main, ≈ 5.8 s), 'peek-once' = one bunny
   * peeks and stays; the short moments: 'hop-across', 'peek-side', 'pop-up', 'wave', 'lost', 'shrug', 'sleepy'
   * (packages/mascot README; the app's names for them: BunnyMoment.tsx).
   */
  choreography: WelcomePreset;
  momentClass?: MomentClass;
  still?: boolean;
  calmEyes?: CalmEyes;
  item?: 'calendar';
  /** Coats in order of appearance; [0] is the main bunny. Default: the package's four. */
  bunnies?: readonly BunnyCoat[];
  /** px between the host's bottom edge and the card's top edge (the paws rest on the card). Default 16. */
  edgeInset?: number;
  /** The card under the stage: its top-left corner radius becomes the clip curve. */
  cardRef?: RefObject<HTMLElement | null>;
  /** Plays once per visit under this name; later visits in the tab start at the calm end pose. */
  oncePerVisit?: string;
  /** Plays once per day under this name (this device); later the same day: the calm end pose. */
  oncePerDay?: string;
  /** Already seen (once per visit / day), or another mascot is mid-scene: 'end' = the calm end pose (default), 'none' = nothing. */
  whenSeen?: 'end' | 'none';
  /** Width of the main bunny is clamped to [minSize, maxSize] px. */
  minSize?: number;
  maxSize?: number;
  /** Once per show, when the choreography is over. */
  onEnd?: () => void;
  className?: string;
  style?: CSSProperties;
}

/** localStorage key of a once-per-day moment (app prefix: cleared on sign-out like every account key). */
export function momentDayKey(name: string): string {
  return `${ACTIVE_STORAGE_PREFIX}moment.${name}`;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seenToday(name: string): boolean {
  try {
    return window.localStorage.getItem(momentDayKey(name)) === today();
  } catch {
    return false;
  }
}

function markSeenToday(name: string): void {
  try {
    window.localStorage.setItem(momentDayKey(name), today());
  } catch {
    /* storage blocked: the moment simply plays again next time */
  }
}

export default function WelcomeBunnies({
  choreography,
  momentClass = 'illustration',
  calmEyes = 'happy',
  item,
  bunnies,
  edgeInset = 16,
  still = false,
  cardRef,
  oncePerVisit,
  oncePerDay,
  whenSeen = 'end',
  minSize,
  maxSize,
  onEnd,
  className,
  style,
}: WelcomeBunniesProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<WelcomeStage | null>(null);
  const [ready, setReady] = useState(false);
  // the motion level: 'reduced' = the package's static composition; 'off' / "Kaninchen zeigen" off = none
  const { reducedMotion, shown } = useMascotMotion();
  const reducedRef = useRef(reducedMotion);
  useEffect(() => { reducedRef.current = reducedMotion; });
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });
  // the first values win (a new show is a new component: key it)
  const initial = useRef({ choreography, bunnies, edgeInset, cardRef, oncePerVisit, oncePerDay, whenSeen, minSize, maxSize, reducedMotion, momentClass, calmEyes, item, still });

  useEffect(observeMomentActivity, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !shown) return;
    const id = Symbol('welcome');
    let stage: WelcomeStage | null = null;
    let claimed = false;
    let cancelled = false;
    const o = initial.current;
    const seen = (o.oncePerVisit !== undefined && wasSeen(o.oncePerVisit)) || (o.oncePerDay !== undefined && seenToday(o.oncePerDay));
    // a moment that has no calm end pose (it leaves the stage): nothing to show once it was seen
    if (seen && o.whenSeen === 'none' && devSeek() === null) return;

    const cancelPaint = afterPaint(() => {
      loadModule()
        .then((mod) => {
          if (cancelled || !hostRef.current) return;
          const card = o.cardRef?.current;
          const radius = card ? Number.parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0 : 0;
          const created = new mod.WelcomeStage(host, {
            ...(o.bunnies ? { bunnies: o.bunnies } : {}),
            choreography: o.choreography,
            calmEyes: o.calmEyes,
            ...(o.item ? { item: o.item } : {}),
            reducedMotion: reducedRef.current,
            edgeInset: { bottom: o.edgeInset },
            edgeRadius: { bottom: radius },
            ...(o.minSize !== undefined ? { minSize: o.minSize } : {}),
            ...(o.maxSize !== undefined ? { maxSize: o.maxSize } : {}),
            onEnd: () => {
              claimed = false;
              momentBudget.end();
              releaseStage(id);
              onEndRef.current?.();
            },
          });
          stage = created;
          stageRef.current = created;
          const followStage = () => {
            if (!created.ended) return;
            const owner = activeMascot();
            if (owner !== null && owner !== id) created.pause();
            else created.resumeCalm();
          };
          const member: StageMember = {
            get busy() {
              // playWhenIdle schedules the show: the reservation must already
              // count as busy before requestIdleCallback actually begins it.
              return claimed && !created.ended;
            },
            get isDestroyed() {
              return created.isDestroyed;
            },
            get suspended() { return created.suspended; },
            // The calm end pose breathes and blinks — but not while ANOTHER mascot holds the stage (one mascot
            // animates at a time): it pauses then and breathes on once the stage is free (resumeCalm; play() would
            // restart the show). Until 23.10 it paused on every stage release — its own at the end of the show too —
            // and froze for good (Felix: "кролик застыл" on the legal pages).
            stopIdle: followStage,
            startIdle: followStage,
            interrupt: () => { claimed = false; created.seek(created.duration + 1); },
          };
          registerMascot(id, member, false);

          const seek = devSeek();
          if (seek !== null) created.seek(seek === 'end' ? created.duration + 1 : seek);
          else if (seen || o.still || !momentBudget.claim(o.momentClass) || !requestStage(id, o.momentClass)) {
            if (o.whenSeen === 'none') {
              created.destroy();
              stageRef.current = null;
              return;
            }
            created.seek(created.duration + 1);
          } else {
            claimed = true;
            if (o.oncePerVisit) markSeen(o.oncePerVisit);
            if (o.oncePerDay) markSeenToday(o.oncePerDay);
            created.playWhenIdle();
          }
          setReady(true);
        })
        .catch(() => {
          /* decorative: the empty host stays */
        });
    });

    return () => {
      cancelled = true;
      cancelPaint();
      unregisterMascot(id);
      stage?.destroy();
      stageRef.current = null;
      setReady(false);
    };
  }, [shown]);

  useEffect(() => {
    stageRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      data-welcome={choreography}
      className={cn('transition-opacity duration-(--dur-s) ease-(--ease-out)', ready ? 'opacity-100' : 'opacity-0', className)}
      style={style}
    />
  );
}
