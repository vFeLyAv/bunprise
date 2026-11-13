import { useCallback, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, useDragControls, useMotionValue, useTransform, type HTMLMotionProps } from 'motion/react';
import * as m from 'motion/react-m';
import { cn } from './cn';
// the floating glass (.glass-bar / .glass-sheet / .glass-float / .glass-toast) ships with the kit, not globally
import '../styles/glass.css';
import { haptic } from './haptics';
import { IconButton } from './IconButton';
import { IconX } from './icons';
import { registerOpenSheet, useLayerRoot } from './layers';
import { registerSheetLayer } from './sheetLayer';
import { fade, useReducedMotionPref, useSpring } from './motion';

type DragEndHandler = NonNullable<HTMLMotionProps<'div'>['onDragEnd']>;
type DragInfo = Parameters<DragEndHandler>[1];

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Release (§2.4, wave 1 "follows the finger"): where the sheet WOULD land — the offset plus 200 ms of the
 * release velocity — past 35 % of its height, or a flick faster than 500 px/s, closes it (the exit spring
 * starts with the finger's velocity); anything else springs back (smooth spring). Up past the detent it
 * rubber-bands (15 % of the finger's travel).
 */
const CLOSE_OFFSET_RATIO = 0.35;
const CLOSE_VELOCITY = 500;
const PROJECT_S = 0.2;
/** A pull on the content (scrolled to its top) becomes a sheet drag after this many px downward. */
const PULL_SLOP_PX = 6;

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Accessible name of the dialog when it has no visible `title` (e.g. the wish sheet: its name sits under the photo). */
  label?: string;
  /** Accessible name of the "×" button (from i18n). */
  closeLabel: string;
  /** Pinned under the content, above the safe area (the CTA). */
  footer?: ReactNode;
  /** 'content' (default; max 90 dvh) or 'full'. */
  detent?: 'content' | 'full';
  /** Element to focus on open; default: first focusable, else the panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

/** Off-screen start/end of the slide: a little more than its height, so neither the floating inset nor
 *  the shadow peeks out at the bottom before it opens or after it closed. */
const HIDDEN_Y = '115%';

/** The vertical offset of a running transform (matrix f), 0 without one. */
function currentOffsetY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  const m = /matrix(?:3d)?\(([^)]+)\)/.exec(t);
  if (!m?.[1]) return 0;
  const v = m[1].split(',').map(Number);
  const ty = v.length === 16 ? v[13] : v[5];
  return Number.isFinite(ty) ? (ty as number) : 0;
}

/**
 * Content-height sheets glide to a new height (the reservation moment adds the hamster, a state change
 * swaps the actions): the panel is anchored at the bottom, so a taller panel would push its top edge up
 * at once. A ResizeObserver (it runs after layout, before paint) offsets the panel by the difference and
 * the smooth spring (--ease-smooth / --dur-smooth, a CSS linear() curve) takes it back — transform only,
 * a Web Animation on the panel, no motion engine and no scrim change. A finger on the handle cancels it.
 * Not while the sheet slides in or out, not while it is dragged, not under reduced motion (0 ms tokens).
 */
function useGlideToNewHeight(panelRef: RefObject<HTMLDivElement | null>, active: boolean, isMoving: () => boolean) {
  const glide = useRef<Animation | null>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel || typeof ResizeObserver !== 'function' || typeof panel.animate !== 'function') return;
    let last = panel.offsetHeight;
    const ro = new ResizeObserver(() => {
      const h = panel.offsetHeight;
      const delta = h - last;
      last = h;
      if (Math.abs(delta) < 2 || isMoving()) return;
      const cs = getComputedStyle(panel);
      const duration = parseFloat(cs.getPropertyValue('--dur-smooth')) || 0;
      if (duration <= 0) return;
      const from = currentOffsetY(panel) + delta;
      glide.current?.cancel();
      glide.current = panel.animate([{ transform: `translateY(${from}px)` }, { transform: 'translateY(0px)' }], {
        duration,
        // fallback = the smooth spring's cubic-bezier (tokens.css, browsers without linear())
        easing: cs.getPropertyValue('--ease-smooth').trim() || 'cubic-bezier(.2,.7,.3,1)',
      });
    });
    ro.observe(panel);
    return () => {
      ro.disconnect();
      glide.current?.cancel();
      glide.current = null;
    };
  }, [panelRef, active, isMoving]);
  /** A finger on the handle: the glide (≤ 350 ms, right after a content change) ends at once. */
  return useCallback(() => {
    glide.current?.finish();
    glide.current = null;
  }, []);
}

/**
 * A finger that pulls DOWN on the sheet's content while the content is scrolled to its top drags the sheet
 * (iOS sheets): after PULL_SLOP_PX the pointer is handed to the drag (`start`), and the browser's own scroll
 * of that touch is cancelled (a non-passive touchmove), so the content does not overscroll under the finger.
 * Upward pulls and pulls on scrolled content stay scrolling. Touch and pen only (a mouse scrolls with the wheel).
 */
function usePullToDismiss(contentRef: RefObject<HTMLDivElement | null>, enabled: boolean, start: (event: PointerEvent) => void) {
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  useEffect(() => {
    const el = contentRef.current;
    if (!enabled || !el) return;
    let origin: { id: number; x: number; y: number } | null = null;
    let pulling = false;
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      origin = el.scrollTop <= 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
      pulling = false;
    };
    const move = (e: PointerEvent) => {
      if (!origin || pulling || e.pointerId !== origin.id) return;
      const dy = e.clientY - origin.y;
      const dx = e.clientX - origin.x;
      if (dy < -PULL_SLOP_PX || Math.abs(dx) > Math.abs(dy) + PULL_SLOP_PX) {
        origin = null; // a scroll up or a sideways move: not ours
        return;
      }
      if (dy > PULL_SLOP_PX && el.scrollTop <= 0) {
        pulling = true;
        startRef.current(e);
      }
    };
    const end = () => {
      origin = null;
      pulling = false;
    };
    const touchMove = (e: TouchEvent) => {
      if (pulling && e.cancelable) e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('touchmove', touchMove, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('touchmove', touchMove);
    };
  }, [contentRef, enabled]);
}

/**
 * Bottom sheet (§3): glass panel (.glass-sheet: blur, saturation, specular top edge) with handle, spring
 * open (smooth), drag the handle/header to dismiss, scrim (--scrim), Esc, focus trap, inert +
 * scroll-locked background, safe-area padding.
 * Phone width: the 'content' detent FLOATS --sheet-inset off the sides and the bottom with --r-sheet on
 * every corner (iOS 26 partial sheet; the home-indicator padding shrinks by the inset); the 'full' detent
 * stays edge to edge (blocker 19). When its layer is ≥ 768 px wide it becomes a centred 480 px modal
 * (a container query on the layer, not a media query: inside the 390 px dev phone frame on a wide
 * desktop window it must stay a bottom sheet).
 * Under reduced motion it fades instead of sliding (§2.8).
 *
 * Needs `domMax` features in <LazyMotion> for the drag gesture; with
 * `domAnimation` only, the sheet still opens/closes via buttons, scrim and Esc.
 */
export function Sheet({ open, onClose, title, label, closeLabel, footer, detent = 'content', initialFocusRef, className, children }: SheetProps) {
  const root = useLayerRoot();
  const titleId = useId();
  const reduced = useReducedMotionPref();
  const smooth = useSpring('smooth');
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const y = useMotionValue<number | string>(0);
  const dragControls = useDragControls();
  const dragging = useRef(false);
  /** past the close threshold during the current drag (one haptic tick per crossing) */
  const armed = useRef(false);
  // the panel is "moving" while it slides in/out or follows a finger (at rest y is 0 — after the slide-in
  // motion may keep it as "0%")
  const isMoving = useCallback(() => dragging.current || y.isAnimating() || parseFloat(String(y.get())) !== 0, [y]);
  const stopGlide = useGlideToNewHeight(panelRef, open && !reduced && detent !== 'full', isMoving);
  usePullToDismiss(contentRef, open && !reduced, (event) => {
    stopGlide();
    dragControls.start(event);
  });

  // Scrim follows the finger: opacity = 1 − offset / height, no animation (§2.4).
  const scrimOpacity = useTransform(y, (v) => {
    const h = panelRef.current?.offsetHeight ?? 1;
    return typeof v === 'number' && v > 0 ? Math.max(0, 1 - v / h) : 1;
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus management, keyboard, inert background and scroll lock while open.
  useEffect(() => {
    if (!open || !root) return;
    const container = containerRef.current;
    const panel = panelRef.current;
    // The layer root is the portal container's parent (document.body or the dev phone screen).
    const layer = container?.parentElement;
    if (!container || !layer) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseSheet = registerOpenSheet();

    const focusInitial = () => {
      const target = initialFocusRef?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      target?.focus({ preventScroll: true });
    };
    const raf = requestAnimationFrame(focusInitial);

    const releaseLayer = registerSheetLayer(container, layer);

    const onKeyDown = (e: KeyboardEvent) => {
      // A nested control (e.g. the calendar) gets Escape first. A covered sheet never handles the
      // keyboard: otherwise every document listener closes its sheet for a single key press.
      if (e.defaultPrevented || container.hasAttribute('inert')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const list = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      releaseSheet();
      document.removeEventListener('keydown', onKeyDown);
      releaseLayer();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open, root, initialFocusRef]);

  if (!root) return null;

  /** Would this release close the sheet? (the offset plus 200 ms of the velocity, or a fast flick down) */
  const closes = (info: DragInfo) => {
    const h = panelRef.current?.offsetHeight ?? 0;
    return info.offset.y + Math.max(0, info.velocity.y) * PROJECT_S > h * CLOSE_OFFSET_RATIO || info.velocity.y > CLOSE_VELOCITY;
  };
  const onDrag = (_event: unknown, info: DragInfo) => {
    // the finger crossed the point where letting go closes the sheet (or came back): one light tick
    const h = panelRef.current?.offsetHeight ?? 0;
    const past = info.offset.y > h * CLOSE_OFFSET_RATIO;
    if (past !== armed.current) {
      armed.current = past;
      haptic('select');
    }
  };
  const onDragEnd = (_event: unknown, info: DragInfo) => {
    dragging.current = false;
    armed.current = false;
    if (closes(info)) onCloseRef.current();
  };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div ref={containerRef} className="@container fixed inset-0 z-(--z-backdrop)">
          <div className="absolute inset-0 @3xl:grid @3xl:place-items-center">
            <m.div
              aria-hidden="true"
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.45, 0, 0.2, 1] }}
              onClick={() => onCloseRef.current()}
            >
              <m.div className="absolute inset-0 bg-scrim" style={{ opacity: scrimOpacity }} />
            </m.div>
            <m.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-label={title ? undefined : label}
              tabIndex={-1}
              data-detent={detent}
              className={cn(
                'glass-sheet absolute flex max-h-[90dvh] flex-col outline-none',
                detent === 'full'
                  ? 'inset-x-0 bottom-0 h-[90dvh] rounded-t-sheet pb-[calc(var(--sp-5)+var(--sa-bottom))]'
                  : 'inset-x-(--sheet-inset) bottom-(--sheet-inset) rounded-sheet pb-[calc(var(--sp-5)_+_max(0px,_var(--sa-bottom)_-_var(--sheet-inset)))]',
                '@3xl:static @3xl:w-[480px] @3xl:max-h-[85dvh] @3xl:rounded-xl @3xl:pb-5',
                className,
              )}
              style={{ y }}
              initial={reduced ? { opacity: 0 } : { y: HIDDEN_Y }}
              animate={reduced ? { opacity: 1 } : { y: 0 }}
              exit={reduced ? { opacity: 0, transition: fade } : { y: HIDDEN_Y }}
              transition={reduced ? fade : smooth}
              drag={reduced ? false : 'y'}
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.15, bottom: 1 }}
              dragMomentum={false}
              dragTransition={{ bounceStiffness: 250, bounceDamping: 28 }}
              onDragStart={() => {
                dragging.current = true;
                armed.current = false;
              }}
              onDrag={onDrag}
              onDragEnd={onDragEnd}
            >
              <div
                className="touch-none select-none px-5 pt-2"
                onPointerDown={(e) => {
                  // the finger wins: a height glide in progress ends, the drag takes over
                  stopGlide();
                  if (!reduced) dragControls.start(e);
                }}
              >
                <div aria-hidden="true" className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-fill-3" />
                <div className="flex min-h-11 items-center justify-between gap-2">
                  {title ? (
                    <h2 id={titleId} className="min-w-0 flex-1 line-clamp-2 t-title-3 text-text hyphens-auto [overflow-wrap:anywhere]">
                      {title}
                    </h2>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <IconButton label={closeLabel} variant="plain" className="-mr-2" onClick={() => onCloseRef.current()}>
                    <IconX />
                  </IconButton>
                </div>
              </div>
              {/* pulled down while scrolled to its top, the content drags the sheet (usePullToDismiss) */}
              <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 [touch-action:pan-y]">
                {children}
              </div>
              {footer ? <div className="px-5 pt-3">{footer}</div> : null}
            </m.div>
          </div>
        </div>
      ) : null}
    </AnimatePresence>,
    root,
  );
}
