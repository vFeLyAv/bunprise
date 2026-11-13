import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { cn } from './cn';
// the floating glass (.glass-bar / .glass-sheet / .glass-float / .glass-toast) ships with the kit, not globally
import '../styles/glass.css';
import { IconCheck } from './icons';
import { useLayerRoot, useSheetOpen } from './layers';
import { fade, useReducedMotionPref, useSpring } from './motion';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: ReactNode;
  kind?: ToastKind;
  /** One action, e.g. "Undo". */
  action?: ToastAction;
  /** Auto-dismiss in ms; default 4000, 8000 with an action. Paused while focused or pressed. */
  duration?: number;
  /** Stable id: showing again replaces instead of stacking. */
  id?: string;
}

/** What the viewport renders (also the adapter target for src/lib/toast.ts, see ToastHost.tsx). */
export interface ToastViewItem {
  id: string;
  message: ReactNode;
  kind: ToastKind;
  action?: ToastAction;
  duration: number;
}

export interface ToastApi {
  show: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  info: (message: ReactNode, options?: Omit<ToastOptions, 'message' | 'kind'>) => string;
  success: (message: ReactNode, options?: Omit<ToastOptions, 'message' | 'kind'>) => string;
  error: (message: ReactNode, options?: Omit<ToastOptions, 'message' | 'kind'>) => string;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  /** How many are visible at once; the rest wait in a queue. Spec: 1. */
  maxVisible?: number;
  children: ReactNode;
}

/**
 * Context-based variant: `const toast = useToast(); toast.success(t('…'))`.
 * The app shell may instead keep its store (src/lib/toast.ts) and render <ToastHost /> (ToastHost.tsx).
 */
export function ToastProvider({ maxVisible = 1, children }: ToastProviderProps) {
  const [items, setItems] = useState<ToastViewItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setItems((q) => q.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((o: ToastOptions) => {
    counter.current += 1;
    const id = o.id ?? `toast-${counter.current}`;
    const item: ToastViewItem = {
      id,
      message: o.message,
      kind: o.kind ?? 'info',
      action: o.action,
      duration: o.duration ?? (o.action ? 8000 : 4000),
    };
    setItems((q) => [...q.filter((t) => t.id !== id), item]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      info: (message, options) => show({ ...options, message, kind: 'info' }),
      success: (message, options) => show({ ...options, message, kind: 'success' }),
      error: (message, options) => show({ ...options, message, kind: 'error' }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport items={items.slice(0, maxVisible)} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast() needs a <ToastProvider> above it');
  return api;
}

export interface ToastViewportProps {
  /** The visible toasts (first = oldest). */
  items: ReadonlyArray<ToastViewItem>;
  onDismiss: (id: string) => void;
}

/**
 * Fixed stack above the home indicator; portals into the layer root. While a sheet is open the
 * stack moves under the status bar instead (a visible toast glides there), so it never covers the
 * sheet's buttons.
 */
export function ToastViewport({ items, onDismiss }: ToastViewportProps) {
  const root = useLayerRoot();
  const top = useSheetOpen();
  if (!root) return null;
  return createPortal(
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-(--z-toast) flex flex-col items-center gap-2 px-4',
        top ? 'top-[calc(var(--sa-top)+var(--sp-2))]' : 'bottom-[max(calc(var(--sa-bottom)+var(--sp-4)),var(--toast-tabbar-clearance,0px))]',
      )}
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={onDismiss} fromTop={top} />
        ))}
      </AnimatePresence>
    </div>,
    root,
  );
}

/**
 * Toast capsule of smoky ink glass (.glass-toast, --r-toast; --text-inverse text), bouncy in from below
 * (from above while a sheet is open), fade out (§3 Toast).
 */
function ToastCard({ item, onDismiss, fromTop }: { item: ToastViewItem; onDismiss: (id: string) => void; fromTop: boolean }) {
  const reduced = useReducedMotionPref();
  const bouncy = useSpring('bouncy');
  const smooth = useSpring('smooth');
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const paused = focused || pressed;
  const dismissRef = useRef(onDismiss);
  const action = item.action;

  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => dismissRef.current(item.id), item.duration);
    return () => clearTimeout(t);
  }, [paused, item.id, item.duration]);

  // "Pressed" ends wherever the pointer is released (it may slide off the toast). We listen on the window
  // instead of capturing the pointer: a capture retargets pointerup to the card, so the browser then fires
  // the click on the card and a mouse click never reached the action button ("Rückgängig" did nothing).
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseRef.current?.(), []);
  const press = () => {
    releaseRef.current?.();
    const release = () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      if (releaseRef.current === release) releaseRef.current = null;
      setPressed(false);
    };
    releaseRef.current = release;
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    setPressed(true);
  };

  return (
    <m.div
      role={item.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'glass-toast pointer-events-auto flex w-full max-w-[calc(var(--page-max)-2rem)] items-center gap-3 rounded-toast px-4 py-3 text-text-inverse t-subhead',
      )}
      layout={reduced ? false : 'position'}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: fromTop ? -24 : 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: fade }}
      transition={reduced ? fade : { ...bouncy, layout: smooth }}
      onPointerDown={press}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {item.kind === 'success' ? <IconCheck size={20} className="shrink-0 text-(--toast-accent)" /> : null}
      <div className="min-w-0 flex-1">{item.message}</div>
      {action ? (
        <button
          type="button"
          className="hit-expand shrink-0 rounded-button px-2 py-1 t-subhead font-semibold text-(--toast-accent) tr-colors active:opacity-70"
          onClick={() => {
            action.onClick();
            dismissRef.current(item.id);
          }}
        >
          {action.label}
        </button>
      ) : null}
    </m.div>
  );
}
