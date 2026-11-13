/**
 * «Парад» v2 — «Бременская башня», the Profil easter egg (approved by Felix 26.10, docs/design/2026-10-26-parade.md):
 * the bunnies build a tower on the top edge of the "Abmelden" card, Pompon does a binky on top, the tower tips and
 * they all bail out (≈ 5 s). Mounted by AccountPages after 5 quick taps on the version line (account/paradeTaps.ts);
 * load it with React.lazy — the scene itself (@bunprise/mascot/tower) is one more lazy chunk, fetched only now.
 *
 * Rules (all built in): `playsInApp('tower')` (inGallery.ts); "Kaninchen zeigen" off or Animationen "Aus" → nothing;
 * "Weniger" → four still heads over the card fade in and out (opacity only); one mascot at a time (stage.ts: a user
 * response); paused while off screen or the tab is hidden (the package); never blocks input (pointer-events: none),
 * decorative (aria-hidden). `onEnd` once — when it is over, could not start, or is not allowed at all.
 *
 * Geometry: the wrapper the caller gives (position: relative) starts at the card's top edge; the host spans the page
 * width (the card plus the gutters) and ends 16 px below that edge, 390 px tall (the tower fits above the card).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { useMascotMotion } from './mascotMotion';
import { momentBudget, observeMomentActivity } from './budget';
import { registerMascot, releaseStage, requestStage, unregisterMascot } from './stage';
import { playsInApp } from './inGallery';

type TowerModule = typeof import('@bunprise/mascot/tower');
let towerModule: Promise<TowerModule> | null = null;

/** Loads the tower scene once (its own chunk), with Pompon's look (./pompon.ts) set first. */
export function loadTower(): Promise<TowerModule> {
  towerModule ??= Promise.all([import('@bunprise/mascot/tower'), import('./pompon')]).then(([mod]) => mod).catch((err: unknown) => {
    towerModule = null;
    throw err;
  });
  return towerModule;
}

/** Host height and how far it reaches below the card's top edge (px; the package's TOWER_HOST_H / TOWER_EDGE_INSET). */
export const TOWER_HOST_PX = 390;
export const TOWER_INSET_PX = 16;
/** The card's top corner radius (settings: rounded-[22px]). */
const CARD_RADIUS = 22;

export interface TowerMomentProps {
  /** The "Abmelden" card: its width and left edge place the still heads under reduced motion. */
  cardRef: RefObject<HTMLElement | null>;
  onEnd: () => void;
}

function systemReduced(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function TowerMoment({ cardRef, onEnd }: TowerMomentProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { shown, reducedMotion } = useMascotMotion();
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });
  useEffect(observeMomentActivity, []);
  const allowed = shown && playsInApp('tower');
  // read once when the show starts (a level change mid-show: "off" ends it through `allowed`)
  const motion = useRef(reducedMotion);

  useEffect(() => {
    const host = hostRef.current;
    if (!allowed || !host) {
      onEndRef.current();
      return;
    }
    const reduced = motion.current === 'force' || (motion.current === 'auto' && systemReduced());
    const id = Symbol('tower');
    let cancelled = false;
    let over = false;
    let stage: InstanceType<TowerModule['TowerStage']> | null = null;
    const end = () => {
      if (over) return;
      over = true;
      momentBudget.end();
      releaseStage(id);
      unregisterMascot(id);
      if (!cancelled) onEndRef.current();
    };
    void loadTower()
      .then((mod) => {
        if (cancelled) return;
        const card = cardRef.current;
        const width = card?.offsetWidth || Math.max(0, host.clientWidth - 2 * TOWER_INSET_PX);
        const left = card ? card.offsetLeft - host.offsetLeft : TOWER_INSET_PX;
        const created = new mod.TowerStage(host, { reduced, inset: TOWER_INSET_PX, card: { left, width, radius: CARD_RADIUS } });
        stage = created;
        registerMascot(
          id,
          {
            get busy() { return created.busy; },
            get isDestroyed() { return created.isDestroyed; },
            get suspended() { return created.suspended; },
            stopIdle: () => undefined,
            startIdle: () => undefined,
            interrupt: () => created.stop(),
          },
          false,
        );
        // an answer to the person's own taps; when a more important moment holds the stage, nothing happens
        if (!momentBudget.claim('response') || !requestStage(id, 'response')) {
          end();
          return;
        }
        void created.done.then(end);
        created.play();
        // it plays (also the calm heads of «Weniger»): a find of «Pompons Sammlung»
        void import('../sammlung/note').then((m) => m.noteFind('tower'), () => undefined);
      })
      .catch(() => end());
    return () => {
      cancelled = true;
      if (!over) {
        over = true;
        releaseStage(id);
        unregisterMascot(id);
      }
      stage?.destroy();
    };
  }, [allowed, cardRef]);

  if (!allowed) return null;
  return (
    <div
      ref={hostRef}
      data-tower=""
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 'calc(-1 * var(--gutter, 16px))',
        right: 'calc(-1 * var(--gutter, 16px))',
        top: TOWER_INSET_PX - TOWER_HOST_PX,
        height: TOWER_HOST_PX,
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
}
