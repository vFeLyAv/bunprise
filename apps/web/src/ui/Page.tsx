import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { useLayerRoot } from './layers';

interface PageScroll {
  /** The page scrolled ≥ 32 px: the large title went under the bar (TopBar fades its small title in). */
  scrolled: boolean;
  /** Any content is under the bar (scrollTop > 0): the bar's glass material fades in (scroll edge). */
  underBar: boolean;
}

const PageScrollContext = createContext<PageScroll>({ scrolled: false, underBar: false });

/** True once the large title scrolled under the top bar (TopBar fades its title in). */
export function usePageScrolled(): boolean {
  return useContext(PageScrollContext).scrolled;
}

/** True as soon as content scrolls under the top bar (scrollTop > 0): TopBar shows its material. */
export function usePageUnderBar(): boolean {
  return useContext(PageScrollContext).underBar;
}

export interface PageProps {
  /** Usually `<TopBar … />` (fixed; the page pads itself below it). */
  topBar?: ReactNode;
  /** Extra space at the bottom for a fixed CTA / FAB, in px. */
  bottomSpace?: number;
  /** No bottom padding: the last element (a docked card) touches the legal footer (scene screens). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Screen layout: 16 px gutter, safe areas, column centred at --page-w (480 px),
 * padding under the fixed top bar and above the home indicator.
 */
export function Page({ topBar, bottomSpace = 0, flush = false, className, children }: PageProps) {
  const [scrolled, setScrolled] = useState(false);
  const [underBar, setUnderBar] = useState(false);
  const titleSentinel = useRef<HTMLDivElement>(null);
  const edgeSentinel = useRef<HTMLDivElement>(null);
  const root = useLayerRoot();

  // IntersectionObserver sentinels instead of a scroll listener (§3 TopBar): both sit where the content
  // starts, right under the bar. The 1 px edge sentinel leaves the visible area at the first scrolled
  // pixel (scroll edge), the 32 px title sentinel once the large title is under the bar.
  useEffect(() => {
    const title = titleSentinel.current;
    const edge = edgeSentinel.current;
    if (!title || !edge || typeof IntersectionObserver !== 'function') return;
    const cs = getComputedStyle(title);
    const bar = parseFloat(cs.getPropertyValue('--topbar-h')) || 52;
    const sa = parseFloat(cs.getPropertyValue('--sa-top')) || 0;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target === title) setScrolled(!entry.isIntersecting);
          else if (entry.target === edge) setUnderBar(!entry.isIntersecting);
        }
      },
      {
        root: root && root !== document.body ? root : null,
        // only the vertical position counts: a page that slides sideways (the swipe between the tabs moves it a
        // whole width) keeps its bar as it is
        rootMargin: `-${Math.round(bar + sa)}px 200% 0px 200%`,
      },
    );
    io.observe(title);
    io.observe(edge);
    return () => io.disconnect();
  }, [root]);

  const scroll = useMemo<PageScroll>(() => ({ scrolled, underBar }), [scrolled, underBar]);

  return (
    <PageScrollContext.Provider value={scroll}>
      {topBar}
      <main
        className={cn(
          'relative mx-auto w-full max-w-(--page-w) flex-auto px-safe',
          // with a bar: room for the fixed bar + notch; without: still clear the notch / status bar
          topBar ? 'pt-[calc(var(--topbar-h)+var(--sa-top))]' : 'pt-[calc(var(--sa-top)+var(--sp-4))]',
          className,
        )}
        style={{ paddingBottom: flush ? 0 : `calc(var(--sa-bottom) + var(--sp-6) + ${bottomSpace}px)` }}
      >
        <div
          ref={titleSentinel}
          aria-hidden="true"
          data-sentinel="title"
          className="pointer-events-none absolute left-0 top-[calc(var(--topbar-h)+var(--sa-top))] h-8 w-px"
        />
        <div
          ref={edgeSentinel}
          aria-hidden="true"
          data-sentinel="edge"
          className="pointer-events-none absolute left-0 top-[calc(var(--topbar-h)+var(--sa-top))] h-px w-px"
        />
        {children}
      </main>
    </PageScrollContext.Provider>
  );
}

/**
 * Large title in the content (--fs-display); the TopBar shows the small one after it scrolls away.
 * Default spacing: 8 px above, 32 px below. A `mb-*` class in `className` replaces the bottom margin
 * (cn() only joins classes, so two margin utilities would let the CSS order decide).
 */
export function LargeTitle({ className, children }: { className?: string; children: ReactNode }) {
  const ownMargin = /(^|\s)mb-/.test(className ?? '');
  return <h1 className={cn('mt-2 t-display text-text', !ownMargin && 'mb-8', className)}>{children}</h1>;
}
