import { useEffect, useRef, type RefObject } from 'react';
import type { Bunny } from '@bunprise/mascot';
import type { BuddyAlive, BuddyHaptic, ListsBuddy as Buddy, ReducedMotionMode } from '@bunprise/mascot/buddy';
import { onAccountEnded } from '../../lib/accountBoundary';
import { haptic } from '../../lib/haptics';
// only modules this route's chunk already uses (the ui barrel, layers): importing e.g. mascot-ui/mascotMotion here
// changed how rolldown splits the shared chunks and grew the first screen /soon by 0.5 KB gz
import { getMotionAttr, useBunniesShown, useLayerRoot, useMotionAttr } from '../../ui';
import { useSheetOpen } from '../../ui/layers';
import { ownWishAddCount } from '../wishes/wishAdded';
// the gallery switch only (a tiny module with no imports of its own): «Твёрдая почва» plays unless it is sent back to
// the mascot gallery (mascot-ui/inGallery.ts)
import { playsInApp } from '../mascot-ui/inGallery';
// «Ночью маскоты спят» (31.10): is it night for him? (./nightLatch.ts loads the answer; the night itself is the lazy
// ./buddyNight.ts)
import { useNightLatch, type NightLatch } from './nightLatch';
import type { BuddyNight } from './buddyNight';

// Pompon lives on the "Listen" tab (Felix 25.10: first «оставляем хомяка и маленький размер», then the bunny after
// all — «это главная вкладка, а у нас приложение больше по зайцам»; small size kept): the buddy of
// @bunprise/mascot/buddy walks on the top edges of the stats row and the list cards ([data-buddy-floor]),
// admires the avatar ([data-buddy-avatar]), inspects cards, naps; long-press / drag picks him up, a throw
// tumbles him. This is a lazy chunk of the Lists route, and the package entry is imported only after the
// screen painted — nothing of him is in the first screens. He replaces the static header hamster (25.10); the
// hamster's cheek rule (fuller with more wishes) went with it — a new own wish still gets a happy hop.
//   settings: "Kaninchen zeigen" off or Animationen "Aus" → nothing is loaded (like every mascot);
//             "Weniger" (and low battery, which lowers the level) → calm: no roaming, no flight, set down gently;
//   «Твёрдая почва» (Felix 26.10 «нравится», 27.10 in the app; package option `footing`): set down softly near a
//   card's rounded end, he touches the card with one paw, shifts his weight and steps inward (1.2 s, at most every 20 s);
//   pauses while a sheet is open; hidden while another mascot of the tab (Tapsi with binoculars, Pompon of
//   the empty card) is on screen; the tab hidden / him off screen → the package stops his life by itself.
//   «Ночью маскоты спят» (Felix 31.10 «спящие норм, оставляем»; playsInApp('night'), switch «Nachts schlafen»):
//   23:00 – 07:00 he sleeps instead of roaming — ./buddyNight.ts swaps the buddy for the sleeper and back.

/** Wait this long after mount before loading him: the tab paints first (budget, CLS: he is an overlay). */
const AFTER_PAINT_MS = 350;

// a confirmed own wish addition gets one happy hop, at most every 10 s, never on a mere revisit (tab memory)
let lastSeenCreate = 0;
let lastCelebrateAt = -Infinity;
onAccountEnded(() => { lastSeenCreate = 0; lastCelebrateAt = -Infinity; });

type BuddyModule = typeof import('@bunprise/mascot/buddy');
let modulePromise: Promise<BuddyModule> | null = null;
function loadBuddy(): Promise<BuddyModule> {
  // with Pompon's look (mascot-ui/pompon.ts: the fluffy cheeks) set before he is built
  modulePromise ??= Promise.all([import('@bunprise/mascot/buddy'), import('../mascot-ui/pompon')]).then(([mod]) => mod).catch((err: unknown) => {
    modulePromise = null;
    throw err;
  });
  return modulePromise;
}

/** The ground: above the tab bar (and the home indicator). */
function groundInset(): number {
  const cs = getComputedStyle(document.documentElement);
  return (parseFloat(cs.getPropertyValue('--tabbar-h')) || 56) + (parseFloat(cs.getPropertyValue('--sa-bottom')) || 0) + 8;
}

export interface ListsBuddyProps {
  /** The content box he lives in (position: relative). */
  stage: RefObject<HTMLElement | null>;
  /** My own wishes (a new one gets a happy hop). */
  count: number;
  /** Another mascot of the tab is on screen: he steps aside. */
  hidden: boolean;
}

export default function ListsBuddy({ stage, count, hidden }: ListsBuddyProps) {
  const level = useMotionAttr();
  const shown = useBunniesShown();
  // the app's level → the package (as mascot-ui/mascotMotion.ts maps it for every mascot)
  const reducedMotion: ReducedMotionMode = level === 'full' ? 'off' : level === 'auto' ? 'auto' : 'force';
  const sheetOpen = useSheetOpen();
  const root = useLayerRoot();
  const buddy = useRef<Buddy | null>(null);
  const latch: NightLatch = useNightLatch();
  const latest = useRef({ reducedMotion, count, hidden, sheetOpen, latch });
  // the newest settings for the late build and celebrate() (this effect runs before the ones below)
  useEffect(() => { latest.current = { reducedMotion, count, hidden, sheetOpen, latch }; });
  // the night (./buddyNight.ts) once it runs; decide: day buddy or night, once painted and known (set by the mount effect)
  const night = useRef<BuddyNight | null>(null);
  const decide = useRef<(() => void) | null>(null);

  function celebrate(): void {
    const b = buddy.current;
    const added = ownWishAddCount();
    if (!b || added <= lastSeenCreate || latest.current.count === 0) return;
    lastSeenCreate = added;
    if (getMotionAttr() !== 'full' || latest.current.hidden || Date.now() - lastCelebrateAt < 10000) return;
    lastCelebrateAt = Date.now();
    b.trigger('wish');
  }

  // mount once per stage: load the package after the first paint, then build him (at night: the sleeper instead)
  useEffect(() => {
    if (!shown) return;
    let alive = true;
    let painted = false;
    let decided = false;
    let nightLoading = false;
    let stopWear: (() => void) | null = null;
    let detachPlay: (() => void) | null = null;
    // «Живые анимации» (31.10): his living moments, once mascot-ui/alive.ts arrived
    let aliveLife: { alive: BuddyAlive; destroy(): void } | null = null;
    const scroller = root && root !== document.body ? root : window;
    const dropBuddy = () => {
      stopWear?.();
      stopWear = null;
      detachPlay?.();
      detachPlay = null;
      aliveLife?.destroy();
      aliveLife = null;
      buddy.current?.destroy();
      buddy.current = null;
    };
    const buildBuddy = (start?: { floor: string; x: number }): Promise<Buddy | null> => loadBuddy().then((mod) => {
      const host = stage.current;
      if (!alive || !host) return null;
      const now = latest.current;
      const b = mod.createBuddy({
        stage: host,
        scroller,
        kind: 'bunny',
        width: 96,
        reducedMotion: now.reducedMotion,
        groundInset: groundInset(),
        // at night only the tap answers with a vibration (nothing else vibrates at night)
        haptics: (kind: BuddyHaptic) => { if (kind === 'tap' || !night.current?.night) haptic(kind); },
        footing: playsInApp('footing'),
        // «Fester Boden» really played (or its calm version): a find of «Pompons Sammlung» (sammlung/note.ts)
        onFooting: (e) => { if (e.kind === 'play' || e.kind === 'reduced') void import('../sammlung/note').then((m) => m.noteFind('footing'), () => undefined); },
        // he woke up from his night's sleep: he goes on from exactly that spot
        ...(start ? { start } : {}),
        // «Живые анимации»: a due moment (mascot-ui/alive.ts: its mix and the app's rules) is his next deed
        alive: { due: () => aliveLife?.alive.due() ?? false, play: (puppet, ctx) => aliveLife?.alive.play(puppet, ctx) ?? null },
      });
      buddy.current = b;
      b.setHidden(now.hidden);
      b.setPaused(now.hidden || now.sheetOpen);
      celebrate();
      // he wears today's outfit of the Sammlung (sammlung/wear.ts, its own lazy chunk)
      import('../sammlung/wear').then((m) => {
        if (!alive || buddy.current !== b) return;
        stopWear = m.wearToday(() => {
          const el = host.querySelector<HTMLElement>('.bd-host');
          return el?.shadowRoot ? { root: el.shadowRoot, host: el } : null;
        });
      }, () => undefined);
      // the ear pull and the shake, as on every Pompon (31.10, mascot-ui/pomponPlay.ts — its own lazy chunk): he lends
      // his puppet only while he stands; a press elsewhere on him stays his own (tap, pick up, throw)
      import('../mascot-ui/pomponPlay').then((p) => {
        const box = host.querySelector<HTMLElement>('.bd-host');
        const hit = host.querySelector<HTMLElement>('.bd-hit');
        if (!alive || buddy.current !== b || !box || !hit) return;
        detachPlay = p.attachPompon({
          box: () => box,
          target: hit,
          borrow: () => {
            const loan = b.lend();
            return loan ? { puppet: loan.puppet as Bunny, giveBack: loan.giveBack } : null;
          },
          still: () => b.reduced,
        });
      }, () => undefined);
      // «Живые анимации» (31.10, mascot-ui/alive.ts — its own lazy chunk): groom, periscope, stretch, loaf, sneeze, dig as
      // his deeds; nothing while hidden, a sheet is open or under still poses (and never asleep: then he is the sleeper)
      import('../mascot-ui/alive').then((a) => {
        const box = host.querySelector<HTMLElement>('.bd-host');
        if (!alive || buddy.current !== b || !box) return;
        aliveLife = a.buddyAlive({
          kind: 'bunny',
          seen: box,
          touch: host.querySelector<HTMLElement>('.bd-hit'),
          quiet: () => b.reduced || latest.current.hidden || latest.current.sheetOpen,
        });
      }, () => undefined);
      return b;
    });
    // the night's rules take over (opened at night, or the night began while the tab is open)
    const runNight = () => {
      if (night.current || nightLoading) return;
      nightLoading = true;
      // (the buddy module too: he wakes up into it without a gap)
      void loadBuddy().catch(() => undefined);
      void import('./buddyNight').then((n) => {
        const host = stage.current;
        if (!alive || !host) return;
        night.current = n.createBuddyNight({
          stage: host,
          scroller,
          buddy: () => buddy.current,
          buildBuddy,
          dropBuddy,
          settings: () => ({ reducedMotion: latest.current.reducedMotion, hidden: latest.current.hidden, sheetOpen: latest.current.sheetOpen }),
        });
      }).catch(() => {
        nightLoading = false;
        if (alive && !buddy.current) void buildBuddy().catch(() => undefined);
      });
    };
    // after the first paint, once it is known whether it is night (./nightLatch.ts: a moment after mount)
    decide.current = () => {
      const now = latest.current.latch;
      if (!painted || now === null) return;
      if (!decided) {
        decided = true;
        if (!now) {
          void buildBuddy().catch(() => { /* offline chunk: no buddy, the tab works as before */ });
          return;
        }
      }
      if (now) runNight();
    };
    const timer = setTimeout(() => {
      painted = true;
      decide.current?.();
    }, AFTER_PAINT_MS);
    return () => {
      alive = false;
      decide.current = null;
      clearTimeout(timer);
      night.current?.destroy();
      night.current = null;
      dropBuddy();
    };
    // the settings below are applied to the living buddy without rebuilding him
  }, [shown, stage, root]);

  useEffect(() => { decide.current?.(); }, [latch]);
  useEffect(() => {
    buddy.current?.setReducedMotion(reducedMotion);
    night.current?.sync();
  }, [reducedMotion]);
  useEffect(() => {
    buddy.current?.setHidden(hidden);
    buddy.current?.setPaused(hidden || sheetOpen);
    night.current?.sync();
  }, [hidden, sheetOpen]);
  useEffect(() => { celebrate(); }, [count]);

  return null;
}
