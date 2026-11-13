import { Suspense, lazy, useEffect, useRef, useState, type RefObject } from 'react';
import type { NightMascot } from '@bunprise/mascot/night';
import { ACTIVE_STORAGE_PREFIX } from '../../lib/app';
import { useBunniesShown, useMotionAttr } from '../../ui/motionMode';
import { BunnyMoment } from './BunnyMoment';
import MoveMoment from './MoveMoment';
import { playsInApp } from './inGallery';

// «Ночью маскоты спят» (approved 31.10, playsInApp('night')): 23:00 – 07:00 Pompon sleeps on the right corner of the
// first card (96 px) — instead of the day's friend hop and the rare surprise. Opened at night = already asleep; the
// night began while Start was open = he comes (fades in), yawns and falls asleep. A tap wakes him (10 min awake, then
// he dozes off again); at 07:00 he wakes up by himself and stays until Start is left. «Weniger» / battery saver: the
// still sleeping pose (closed eyes: he does not "stare at you"). Rules: ./nightMount.ts. ./night.ts is loaded with
// import(), never statically (its chunk would join the preload list of the first screen /soon — see there).
const NightSleeper = lazy(() => import('./NightSleeper'));
/** px between his box and the card's right edge; his feet stand this far down into the card's top edge */
export const NIGHT_CORNER = { inset: 6, sink: 2, size: 96 } as const;

/** The host: a 0 px line along the first card's top edge (inline: a new utility class would grow the shell's CSS) */
const NIGHT_HOST = { top: 0, height: 0 } as const;

export function placeOnCorner(m: NightMascot, host: HTMLElement): void {
  m.rig.box.style.left = `${Math.round(host.clientWidth - m.rig.size - NIGHT_CORNER.inset)}px`;
  m.rig.box.style.top = `${Math.round(NIGHT_CORNER.sink - m.rig.feet)}px`;
}

export const START_SURPRISE_KEY = `${ACTIVE_STORAGE_PREFIX}moment.start-surprise`;
const attempts = new Set<string>();
export function startSurpriseDay(now = new Date()): string { return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`; }
// The rare surprise alternates by day between the scenes the app may play (inGallery.ts: a scene still in the
// gallery is left out — 24.10 the nibble; none left = no surprise, the usual friend hop).
export function startSurpriseKind(now = new Date()): 'nibble' | 'chase' | null {
  const pool = (['chase', 'nibble'] as const).filter((kind) => playsInApp(kind));
  return pool[Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000) % Math.max(pool.length, 1)] ?? null;
}
function eligible(day: string): boolean {
  if (attempts.has(day)) return false;
  try { return localStorage.getItem(START_SURPRISE_KEY) !== day; } catch { return true; }
}

/** Lazy Start decoration; replaces the friend hop, never accompanies it. No feed data enters. */
export default function StartSurprise({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const shown = useBunniesShown();
  const level = useMotionAttr();
  const [day] = useState(startSurpriseDay);
  const [kind] = useState(startSurpriseKind);
  const [rare] = useState(() => kind !== null && eligible(day));
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  // at night he sleeps here: once he is here he stays until Start is left (07:00: he wakes up in front of you).
  // null = not known yet (./night.ts is on its way: the day's moments wait in their own lazy chunks anyway), false =
  // day; live = the night began while Start was open
  const [night, setNight] = useState<{ live: boolean } | false | null>(null);
  useEffect(() => {
    let alive = true;
    let off: (() => void) | undefined;
    let first = true;
    import('./night').then((n) => {
      if (!alive) return;
      off = n.watchSleeps((sleeps) => {
        const live = !first;
        first = false;
        setNight((cur) => cur || (sleeps ? { live } : false));
      });
    }, () => { if (alive) setNight((cur) => cur ?? false); });
    return () => { alive = false; off?.(); };
  }, []);
  useEffect(() => {
    if (night || !rare || !shown || level !== 'full') return;
    attempts.clear(); attempts.add(day);
    // A busy first four seconds means skip this visit; decorations never queue behind input.
    let active = false;
    const activity = () => { active = true; };
    for (const name of ['input', 'keydown', 'scroll', 'touchmove', 'pointerdown']) document.addEventListener(name, activity, true);
    const timer = setTimeout(() => { if (!active && !document.hidden && targetRef.current?.isConnected) setReady(true); }, 4000);
    return () => {
      clearTimeout(timer);
      for (const name of ['input', 'keydown', 'scroll', 'touchmove', 'pointerdown']) document.removeEventListener(name, activity, true);
    };
  }, [day, level, rare, shown, targetRef, night]);
  if (night && shown) return <Suspense fallback={null}><NightSleeper kind="bunny" coat="fawn" size={NIGHT_CORNER.size} live={night.live} delay={700} place={placeOnCorner} className="pointer-events-none absolute inset-x-0 z-2" style={NIGHT_HOST} /></Suspense>;
  if (!shown || level !== 'full') return null;
  if (!rare) return <BunnyMoment kind="hop-across" family="screen-host:start" onceKey="feed" cardRef={targetRef} edgeInset={16} minSize={104} maxSize={120} className="pointer-events-none absolute inset-x-0 z-2" style={{ top: -116, height: 132 }} />;
  if (!ready || kind === null) return null;
  return <MoveMoment kind={kind} targetRef={targetRef} momentClass="decoration" className="pointer-events-none absolute inset-x-0 z-2" style={{ top: -120, height: kind === 'chase' ? 120 : 220 }} onStart={() => {
    if (started.current) return;
    started.current = true;
    try { localStorage.setItem(START_SURPRISE_KEY, day); } catch { /* memory cap remains */ }
  }} />;
}
