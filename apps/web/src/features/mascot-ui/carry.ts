/**
 * The bunny WORKS (Felix's K10): playCarry() — after a create action the bunny picks the new thing up,
 * hops along a curved path to where it belongs and puts it down there with a little bounce, waves and hops
 * away (packages/mascot CarryStage).
 *
 *   const carry = useCarry()                       // in a component (uses the overlay layer of the screen)
 *   await carry({ from: buttonRect, to: dayCell, item: 'card', tint: 'var(--tint-2)' })
 *   // → resolves when the item LIES on the target: reveal the real card / row now
 *
 *   playCarry({ from, to, item: 'gift' })          // the same without a hook (layer = document.body)
 *
 * - `from`: a DOMRect (or any {left, top, width, height}) in viewport px — e.g. the "+" button or the sheet
 *   that just closed; `to`: the target Element (its rect is read now) or a rect.
 * - item 'card' (a mini occasion card, `tint` = its colour — use the occasion's tint) | 'gift' (a wish).
 * - Motion level (<html data-motion / data-bunnies>, src/motion/level.ts): 'full' → the whole show
 *   (≈ 2.4 s to the landing, ≈ 4.2 s in all); 'reduced' or "Kaninchen zeigen" off → no bunny, the item simply
 *   glides from `from` to `to` (≈ 0.5 s); 'off' → nothing at all, resolves at once.
 * - One mascot at a time (stage.ts): when another one is mid-scene, the item glides instead.
 * - Never blocks input: the layer is pointer-events: none; ANY tap (pointerdown anywhere) skips to the end
 *   (the item lands at once, the bunny is gone). A hidden page skips too. A missing target resolves at once.
 * - Lazy: the package loads on the first call (the mascot chunk); nothing of it is in a route's first chunk.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { CarryAway, CarryBox, CarryItem } from '@bunprise/mascot';
import { useLayerRoot } from '../../ui/layers';
import { getBunniesShown, getMotionAttr } from '../../ui/motionMode';
import { feedback } from '../../lib/haptics';
import { loadMascotModule } from './Mascot';
import { registerMascot, releaseStage, requestStage, unregisterMascot, type StageMember } from './stage';

export interface CarryRequest {
  /** Where it starts, viewport px (a DOMRect). */
  from: DOMRect | CarryBox;
  /** Where it lands: the element (read now) or a rect in viewport px. */
  to: Element | DOMRect | CarryBox;
  item?: CarryItem;
  away?: CarryAway;
  signal?: AbortSignal;
  /** A caller that already confirms its action may opt out. Letters and decorative jumps never add feedback. */
  feedback?: boolean;
  /** CSS colour of the card / gift (e.g. 'var(--tint-3)' — resolved against the page). */
  tint?: string;
  /** Called when the whole show is over (bunny gone). */
  onDone?: () => void;
  /**
   * The show passes BEHIND this element (the create menu's panel): the stage plays over the screen as usual
   * but is cut out where the element is (its rounded box, read now) — a decorative jump never covers its
   * content (Felix 22.10), yet stays visible everywhere else: the bunny pops out of the "+" over the tab bar
   * and vanishes behind the panel.
   */
  hideBehind?: Element | null;
}

function boxOf(target: Element | DOMRect | CarryBox): CarryBox | null {
  if (typeof Element !== 'undefined' && target instanceof Element) {
    if (!target.isConnected) return null;
    const r = target.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }
  const b = target as CarryBox;
  return Number.isFinite(b.left) && Number.isFinite(b.top) ? { left: b.left, top: b.top, width: b.width, height: b.height } : null;
}

/** A CSS colour expression (a var()) as the computed colour, for the SVG fill inside the stage. */
function resolveColour(layer: HTMLElement, colour: string | undefined): string | undefined {
  if (!colour || !colour.includes('var(')) return colour;
  const probe = document.createElement('span');
  probe.style.color = colour;
  layer.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value || undefined;
}

/** Viewport px → the layer's own px (the dev phone frame zooms its screen). */
function toLayer(box: CarryBox, layer: HTMLElement): CarryBox {
  if (layer === document.body) return box;
  const r = layer.getBoundingClientRect();
  const scale = layer.offsetWidth > 0 ? r.width / layer.offsetWidth : 1;
  return { left: (box.left - r.left) / scale, top: (box.top - r.top) / scale, width: box.width / scale, height: box.height / scale };
}

/** clip-path that hides the stage where `element` is (its border box with its corner radius), in layer px. */
function cutOut(element: Element, layer: HTMLElement): string | null {
  const box = boxOf(element);
  if (!box) return null;
  const b = toLayer(box, layer);
  const scale = box.width > 0 ? b.width / box.width : 1;
  const r = Math.min((Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0) * scale, b.width / 2, b.height / 2);
  const n = (v: number) => String(Math.round(v * 100) / 100);
  const [x0, y0, x1, y1] = [b.left, b.top, b.left + b.width, b.top + b.height];
  const hole = `M${n(x0 + r)} ${n(y0)}H${n(x1 - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(y0 + r)}V${n(y1 - r)}A${n(r)} ${n(r)} 0 0 1 ${n(x1 - r)} ${n(y1)}H${n(x0 + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x0)} ${n(y1 - r)}V${n(y0 + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x0 + r)} ${n(y0)}Z`;
  return `path(evenodd, 'M-10000 -10000H10000V10000H-10000Z${hole}')`;
}

/** Plays the carry in `layer` (default document.body). Resolves when the item has landed. */
export function playCarry(request: CarryRequest, layer: HTMLElement | null = typeof document === 'undefined' ? null : document.body): Promise<void> {
  const level = getMotionAttr();
  const to = boxOf(request.to);
  const from = boxOf(request.from);
  if (!layer || !to || !from || level === 'off' || request.signal?.aborted) {
    request.onDone?.();
    return Promise.resolve();
  }
  const id = Symbol('carry');
  const glide = level === 'reduced' || !getBunniesShown();
  return loadMascotModule().then(
    (mod) =>
      new Promise<void>((resolveLanded) => {
        if (request.signal?.aborted || (request.to instanceof Element && !request.to.isConnected)) { resolveLanded(); request.onDone?.(); return; }
        const host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.dataset['carry'] = request.item ?? 'card';
        host.style.cssText = 'position:fixed;inset:0;z-index:var(--z-overlay);pointer-events:none';
        const hole = request.hideBehind ? cutOut(request.hideBehind, layer) : null;
        if (hole) host.style.clipPath = hole;
        layer.append(host);
        let stage: InstanceType<typeof mod.CarryStage> | null = null;
        const member: StageMember = {
          get busy() {
            return stage?.busy ?? false;
          },
          get isDestroyed() {
            return stage?.isDestroyed ?? true;
          },
          stopIdle: () => undefined,
          startIdle: () => undefined,
          interrupt: () => stage?.destroy(),
        };
        registerMascot(id, member, false);
        // one mascot at a time: when another is mid-scene, only the item glides
        const reduced = glide || !requestStage(id, 'work');
        const tint = resolveColour(layer, request.tint);
        stage = new mod.CarryStage(host, {
          from: toLayer(from, layer),
          to: toLayer(to, layer),
          item: request.item ?? 'card',
          ...(request.away ? { away: request.away } : {}),
          ...(tint ? { tint } : {}),
          reducedMotion: reduced ? 'force' : 'off',
        });
        const created = stage;
        const abort = () => { created.destroy(); host.remove(); };
        request.signal?.addEventListener('abort', abort, { once: true });
        const observer = new MutationObserver(() => {
          if (request.to instanceof Element && !request.to.isConnected) abort();
        });
        observer.observe(layer, { childList: true, subtree: true });
        const motionObserver = new MutationObserver(() => {
          if (getMotionAttr() !== 'full' || !getBunniesShown()) abort();
        });
        motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion', 'data-bunnies'] });
        window.addEventListener('popstate', abort);
        const skip = () => created.skip();
        const onVisibility = () => {
          if (document.hidden) skip();
        };
        window.addEventListener('pointerdown', skip, { capture: true, passive: true });
        document.addEventListener('visibilitychange', onVisibility);
        void created.landed.then(() => {
          if (!created.isDestroyed && !request.signal?.aborted && request.feedback !== false && (request.item === undefined || request.item === 'card' || request.item === 'gift')) feedback('success');
          resolveLanded();
        });
        void created.done.then(() => {
          observer.disconnect();
          motionObserver.disconnect();
          request.signal?.removeEventListener('abort', abort);
          window.removeEventListener('popstate', abort);
          window.removeEventListener('pointerdown', skip, { capture: true });
          document.removeEventListener('visibilitychange', onVisibility);
          releaseStage(id);
          unregisterMascot(id);
          created.destroy();
          host.remove();
          request.onDone?.();
        });
        created.play();
      }),
    () => {
      // the chunk failed to load: the item simply appears
      request.onDone?.();
    },
  );
}

/** playCarry bound to the screen's overlay layer (document.body, or the dev phone frame's screen). */
export function useCarry(): (request: CarryRequest) => Promise<void> {
  const layer = useLayerRoot();
  const router = useRouter({ warn: false });
  const pending = useRef(new Set<AbortController>());
  useEffect(() => () => {
    for (const controller of pending.current) controller.abort();
    pending.current.clear();
  }, []);
  useEffect(() => router?.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
    if (fromLocation?.pathname === toLocation.pathname) return;
    for (const controller of pending.current) controller.abort();
    pending.current.clear();
  }), [router]);
  return useCallback((request: CarryRequest) => {
    const controller = new AbortController();
    pending.current.add(controller);
    return playCarry({ ...request, signal: request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal,
      onDone: () => { pending.current.delete(controller); request.onDone?.(); } }, layer);
  }, [layer]);
}
