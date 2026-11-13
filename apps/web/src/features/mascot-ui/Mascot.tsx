/**
 * React wrapper around @bunprise/mascot (design-system-motion.md §4.3–4.8).
 *
 * - The package is imported lazily (`import()`), so it is not in the initial
 *   chunk. Until it arrives, a box of the final size is rendered (no layout
 *   shift); the puppet then fades in (--dur-s).
 * - Motion level (src/motion/level.ts via mascotMotion.ts): <html data-motion="full|reduce|off"> is mapped
 *   to the package's 'off' | 'force'; level 'off' or "Kaninchen zeigen" off (data-bunnies="off") = nothing
 *   is mounted (the empty box keeps the layout). Without the attribute the package follows the OS ('auto').
 * - One mascot animates at a time (stage.ts); the package pauses idle when
 *   the tab is hidden or the mascot is off-screen.
 * - A11y: without `label` the mascot is aria-hidden (the text next to it
 *   carries the meaning); `interactive` renders a focusable role="button".
 * - Size (blocker 5): a named size sets `data-mascot-size` + `--mascot-w`; the `.mascot-box` class
 *   (app.css) multiplies it by the token --mascot-scale-s|m|l (≤ --mascot-max, ≤ the container). The
 *   placeholder already has that final box; on mount the wrapper reads the laid-out width and hands it
 *   to the package (which then writes it inline).
 * - Imports kit pieces by file, never the ui barrel: this chunk loads on / and /i and must not pull
 *   the whole kit and motion with it (perf audit 2026-10-20 §6.6).
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react';
import type {
  Bunny,
  BunnyCoat,
  BunnyScene,
  CalmEyes,
  CreateMascotOptions,
  EarStyle,
  HamsterCoat,
  HamsterHolding,
  HamsterScene,
  MascotKind,
  MomentClass,
  MascotSceneEventDetail,
  ReducedMotionMode,
  Scene,
} from '@bunprise/mascot';
import { cn } from '../../ui/cn';
import { haptic } from '../../lib/haptics';
import '../../styles/mascot.css';
import { useMascotMotion } from './mascotMotion';
import { momentBudget, observeMomentActivity } from './budget';
import {
  registerMascot,
  releaseStage,
  requestStage,
  setMascotIdle,
  unregisterMascot,
  type AnyMascotInstance,
} from './stage';

type MascotModule = typeof import('@bunprise/mascot');

let modulePromise: Promise<MascotModule> | null = null;

/** Loads the mascot chunk once (shared by all instances) — with Pompon's look (./pompon.ts) set before any puppet. */
export function loadMascotModule(): Promise<MascotModule> {
  modulePromise ??= Promise.all([import('@bunprise/mascot'), import('./pompon')]).then(([mod]) => mod).catch((err: unknown) => {
    modulePromise = null;
    throw err;
  });
  return modulePromise;
}

/** Warm the chunk after the first screen (e.g. while the OTP code is typed). */
export function preloadMascot(): void {
  void loadMascotModule().catch(() => undefined);
}

/** Host widths in px (§4.6) before the --mascot-scale-* tokens. Height follows the viewBox (400×260 bunny, 400×250 hamster). */
export const MASCOT_SIZES = { s: 96, m: 160, l: 240, xl: 320 } as const;
export type MascotSizeName = keyof typeof MASCOT_SIZES;

/**
 * The host's laid-out width in CSS px (size × scale token, capped by CSS). getComputedStyle, not
 * getBoundingClientRect: the dev phone frame zooms the whole phone, the computed width is unzoomed.
 * Before layout (jsdom, a hidden parent) it falls back to the unscaled size.
 */
function laidOutWidth(host: HTMLElement, fallback: number): number {
  const width = parseFloat(getComputedStyle(host).width);
  return Number.isFinite(width) && width > 0 ? width : fallback;
}

export interface MascotHandle {
  /**
   * Plays a scene; resolves when it ends (immediately when skipped: busy, unknown scene, not mounted yet). `momentClass`
   * overrides the component's class for this one play (e.g. a 'response' to a tap on an illustration).
   */
  play: (scene: Scene, momentClass?: MomentClass) => Promise<void>;
  /** Same as a tap on the mascot (jump; 5 taps = angry). */
  tap: () => void;
  hop: () => Promise<void>;
  /** The underlying instance (null until the chunk mounted). */
  readonly instance: AnyMascotInstance | null;
}

export interface MascotProps {
  kind: MascotKind;
  /** Coat id; default fawn / golden. */
  coat?: BunnyCoat | HamsterCoat;
  /** Bunny only. */
  ears?: EarStyle;
  /** Hamster only: what he holds up in his front paws ('binoculars': the empty "Freunde" card). Its loop runs with `idle`. */
  holding?: HamsterHolding;
  /** Named size or width in px. Default 'm' (160). */
  size?: number | MascotSizeName;
  /** Plays when set / changed (after mount). */
  scene?: Scene;
  /** Idle loop (blink, glance, ear twitch). Default true. */
  idle?: boolean;
  momentClass?: MomentClass;
  calmEyes?: CalmEyes;
  puff?: number;
  /** Tap = jump. Renders a focusable button; give it a `label`. */
  interactive?: boolean;
  /**
   * With `interactive`: a tap / Enter / Space plays this scene (as a 'response') instead of the jump — only then, never
   * by itself (27.10: Tapsi's «Пылинка» 'speck' on the empty "Freunde" card). Under reduced motion the package keeps
   * its still answer (for 'speck': nothing moves).
   */
  tapScene?: Scene;
  onSceneEnd?: (scene: Scene) => void;
  onReady?: () => void;
  /**
   * Pompon (the fawn bunny) wears today's outfit of «Pompons Sammlung» (features/sammlung/wear.ts: the season, or what
   * the person chose in the Garderobe). Default true; false where he wears something of his own (the onboarding).
   */
  wear?: boolean;
  /**
   * Pompon in a place that lets no touch through (pointer-events: none, the new-wish peek): two small ear targets next to
   * him, so his ear can still be pulled (31.10, ./pomponPlay.ts). Default: his whole box is the target.
   */
  earTargets?: boolean;
  /** Accessible name (from i18n). Without it: aria-hidden. */
  label?: string;
  className?: string;
  ref?: Ref<MascotHandle>;
}

function isBunny(mod: MascotModule, inst: AnyMascotInstance): inst is Bunny {
  return inst instanceof mod.Bunny;
}

function hasCoat(mod: MascotModule, kind: MascotKind, coat: string): boolean {
  const list: ReadonlyArray<{ id: string }> = mod.COATS[kind];
  return list.some((c) => c.id === coat);
}

function restorePuff(instance: AnyMascotInstance, puff: number | undefined): void {
  // Scene cancellation resets the package pose. An explicit app value (the
  // header's own-wish count) remains authoritative after that scene settles.
  if (puff !== undefined && !instance.busy && !instance.isDestroyed) instance.setPuff(Math.max(1, Math.min(1.35, puff)));
}

function buildOptions(
  mod: MascotModule,
  kind: MascotKind,
  base: { size: number; idle: boolean; interactive: boolean; reducedMotion: ReducedMotionMode; calmEyes: CalmEyes; haptics: typeof haptic },
  coat: string | undefined,
  ears: EarStyle | undefined,
  holding: HamsterHolding | undefined,
): CreateMascotOptions {
  if (kind === 'hamster') {
    const c = coat && hasCoat(mod, 'hamster', coat) ? (coat as HamsterCoat) : undefined;
    const opts: CreateMascotOptions = { kind, ...base, holding: holding ?? null };
    if (c) opts.coat = c;
    return opts;
  }
  const c = coat && hasCoat(mod, 'bunny', coat) ? (coat as BunnyCoat) : undefined;
  const opts: CreateMascotOptions = { kind: 'bunny', ...base };
  if (c) opts.coat = c;
  if (ears) opts.ears = ears;
  return opts;
}

export function Mascot({
  kind,
  coat,
  ears,
  holding,
  size = 'm',
  scene,
  idle = true,
  momentClass = 'response',
  calmEyes = 'happy',
  puff,
  interactive = false,
  tapScene,
  onSceneEnd,
  onReady,
  wear = true,
  earTargets = false,
  label,
  className,
  ref,
}: MascotProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<AnyMascotInstance | null>(null);
  const modRef = useRef<MascotModule | null>(null);
  const [id] = useState(() => Symbol('mascot'));
  const [ready, setReady] = useState(false);
  // the motion level: 'reduced' = static pose; 'off' or "Kaninchen zeigen" off = no mascot (mascotMotion.ts)
  const { reducedMotion, shown } = useMascotMotion();
  const onSceneEndRef = useRef(onSceneEnd);
  const onReadyRef = useRef(onReady);
  const puffRef = useRef(puff);
  const tapSceneRef = useRef(tapScene);

  const px = typeof size === 'number' ? size : MASCOT_SIZES[size];
  const sizeName = typeof size === 'number' ? undefined : size;
  useEffect(observeMomentActivity, []);

  useEffect(() => {
    onSceneEndRef.current = onSceneEnd;
    onReadyRef.current = onReady;
    puffRef.current = puff;
    tapSceneRef.current = tapScene;
  });

  // Latest props for the (async) mount below; later changes go through the setters further down.
  const initial = useRef({ coat, ears, holding, px, idle, interactive, reducedMotion, calmEyes, earTargets });
  useEffect(() => {
    initial.current = { coat, ears, holding, px, idle, interactive, reducedMotion, calmEyes, earTargets };
  });

  // Mount once per kind — and only while mascots may appear (the empty box keeps the layout otherwise).
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !shown) return;
    let cancelled = false;
    let detachPlay: (() => void) | null = null;
    loadMascotModule()
      .then((mod) => {
        if (cancelled || !hostRef.current) return;
        const o = initial.current;
        modRef.current = mod;
        const inst = mod.createMascot(
          host,
          buildOptions(
            mod,
            kind,
            { size: laidOutWidth(host, o.px), idle: o.idle, interactive: false, reducedMotion: o.reducedMotion, calmEyes: o.calmEyes, haptics: haptic },
            o.coat,
            o.ears,
            o.holding,
          ),
        );
        instRef.current = inst;
        registerMascot(id, inst, o.idle);
        setReady(true);
        // Pompon (every fawn bunny: the new-wish peek, the invite, …): the ear pull and the shake, as everywhere
        // (31.10, ./pomponPlay.ts — its own lazy chunk; a press elsewhere on him stays this place's own)
        if (isBunny(mod, inst) && (o.coat ?? 'fawn') === 'fawn') {
          import('./pomponPlay').then((p) => {
            if (cancelled || inst.isDestroyed) return;
            detachPlay = p.attachPompon({ box: () => host, target: host, borrow: () => (inst.busy || inst.isDestroyed ? null : { puppet: inst }), still: () => inst.reducedMotion, earTargets: o.earTargets });
          }, () => undefined);
        }
      })
      .catch(() => {
        /* The mascot is decorative: keep the empty placeholder. */
      });
    return () => {
      cancelled = true;
      detachPlay?.();
      unregisterMascot(id);
      instRef.current?.destroy();
      instRef.current = null;
      modRef.current = null;
      setReady(false);
    };
  }, [kind, id, shown]);

  useEffect(() => {
    const inst = instRef.current;
    const mod = modRef.current;
    if (!ready || !inst || !mod || !coat) return;
    if (isBunny(mod, inst)) {
      if (hasCoat(mod, 'bunny', coat)) inst.setCoat(coat as BunnyCoat);
    } else if (hasCoat(mod, 'hamster', coat)) {
      inst.setCoat(coat as HamsterCoat);
    }
  }, [coat, ready]);

  useEffect(() => {
    const inst = instRef.current;
    const mod = modRef.current;
    if (!ready || !inst || !mod || !ears) return;
    if (isBunny(mod, inst)) inst.setEars(ears);
  }, [ears, ready]);

  useEffect(() => {
    const inst = instRef.current;
    const mod = modRef.current;
    if (!ready || !inst || !mod || isBunny(mod, inst)) return;
    inst.setHolding(holding ?? null);
  }, [holding, ready]);

  // A new size: drop the package's inline width so the CSS box (size × scale token) applies again,
  // read it, and hand it back to the package.
  useEffect(() => {
    const host = hostRef.current;
    const inst = instRef.current;
    if (!ready || !host || !inst) return;
    host.style.removeProperty('width');
    inst.setSize(laidOutWidth(host, px));
  }, [px, ready]);

  useEffect(() => {
    const inst = instRef.current;
    if (!ready || !inst) return;
    setMascotIdle(id, idle);
  }, [idle, ready, id]);

  useEffect(() => {
    if (ready) instRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion, ready]);

  // Pompon wears today's outfit (features/sammlung/wear.ts — a lazy chunk; the drawings load only when he wears one)
  const dressable = kind === 'bunny' && (coat ?? 'fawn') === 'fawn' && wear;
  useEffect(() => {
    const inst = instRef.current;
    if (!ready || !inst || !dressable) return;
    let alive = true;
    let stop: (() => void) | null = null;
    import('../sammlung/wear').then((m) => {
      if (alive) stop = m.wearToday(() => (inst.isDestroyed ? null : { root: inst.root, host: inst.host }));
    }, () => undefined);
    return () => {
      alive = false;
      stop?.();
    };
  }, [ready, dressable]);

  useEffect(() => {
    if (ready) instRef.current?.setPuff(Math.max(1, Math.min(1.35, puff ?? 1)));
  }, [puff, ready]);
  useEffect(() => { if (ready) instRef.current?.setCalmEyes(calmEyes); }, [calmEyes, ready]);

  // Scene end → callback (the package dispatches a bubbling CustomEvent on the host).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<MascotSceneEventDetail>).detail;
      onSceneEndRef.current?.(detail.scene);
    };
    host.addEventListener('mascot-scene-end', handler);
    return () => host.removeEventListener('mascot-scene-end', handler);
  }, []);

  const play = useCallback(
    async (s: Scene, as?: MomentClass): Promise<void> => {
      const inst = instRef.current;
      const mod = modRef.current;
      if (!inst || !mod) return;
      const allowed: ReadonlyArray<string> = mod.SCENES[kind];
      if (!allowed.includes(s)) return;
      const role = as ?? momentClass;
      const animated = reducedMotion !== 'force' && s !== 'idle';
      if (animated && !momentBudget.claim(role)) {
        if (s === 'sleep') inst.pose('sleep');
        return;
      }
      if (!requestStage(id, role)) return;
      // it really plays now: a collection scene becomes a find of «Pompons Sammlung» (features/sammlung/note.ts)
      if (kind === 'hamster') void import('../sammlung/note').then((m) => m.noteMascotScene(kind, s), () => undefined);
      try {
        if (isBunny(mod, inst)) await inst.play(s as BunnyScene);
        else await inst.play(s as HamsterScene);
      } finally {
        restorePuff(inst, puffRef.current);
        if (animated) momentBudget.end();
        releaseStage(id);
      }
    },
    [kind, id, momentClass, reducedMotion],
  );

  const tap = useCallback(() => {
    const inst = instRef.current;
    if (inst && tapSceneRef.current) {
      void play(tapSceneRef.current, 'response');
      return;
    }
    if (!inst || !momentBudget.claim('response') || !requestStage(id, 'response')) return;
    void inst.tap().finally(() => { restorePuff(inst, puffRef.current); momentBudget.end(); releaseStage(id); });
  }, [id, play]);
  const hop = useCallback(async () => {
    const inst = instRef.current;
    if (!inst || !momentBudget.claim('response') || !requestStage(id, 'response')) return;
    try { await inst.hop(); } finally { restorePuff(inst, puffRef.current); momentBudget.end(); releaseStage(id); }
  }, [id]);

  useEffect(() => {
    if (ready && scene) void play(scene);
  }, [scene, ready, play]);

  useImperativeHandle(
    ref,
    () => ({
      play,
      tap,
      hop,
      get instance() {
        return instRef.current;
      },
    }),
    [play, tap, hop],
  );
  useEffect(() => { if (ready) onReadyRef.current?.(); }, [ready]);

  const style = { '--mascot-w': `${px}px`, aspectRatio: kind === 'hamster' ? '400 / 250' : '400 / 260' } as CSSProperties;
  const classes = cn(
    'mascot-box block overflow-visible transition-opacity duration-(--dur-s) ease-(--ease-out)',
    ready ? 'opacity-100' : 'opacity-0',
    interactive && 'cursor-pointer rounded-lg',
    className,
  );

  if (interactive) {
    return (
      <div
        ref={hostRef}
        role="button"
        tabIndex={0}
        aria-label={label}
        className={classes}
        style={style}
        data-mascot={kind}
        data-mascot-size={sizeName}
        onClick={tap}
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            tap();
          }
        }}
      />
    );
  }
  return (
    <div
      ref={hostRef}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={classes}
      style={style}
      data-mascot={kind}
      data-mascot-size={sizeName}
    />
  );
}

/** `const bunny = useMascot(); <Mascot kind="bunny" ref={bunny.ref} />; bunny.play('greet')`. */
export function useMascot(): { ref: RefObject<MascotHandle | null>; play: (scene: Scene) => Promise<void>; tap: () => void } {
  const ref = useRef<MascotHandle | null>(null);
  const play = useCallback((scene: Scene) => ref.current?.play(scene) ?? Promise.resolve(), []);
  const tap = useCallback(() => ref.current?.tap(), []);
  return { ref, play, tap };
}
