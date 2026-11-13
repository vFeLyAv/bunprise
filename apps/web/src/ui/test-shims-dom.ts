/**
 * jsdom shims for component tests: matchMedia (never reduced) and a no-op
 * IntersectionObserver. No Web Animations API here on purpose — motion then
 * falls back to its JS driver so enter/exit animations really complete in
 * tests. (The mascot tests add a WAAPI fake in features/mascot-ui/test-shims.ts.)
 * Each shim checks first, so a global setup file may install the same ones.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (typeof globalThis.IntersectionObserver !== 'function') {
  class NoopIntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver = NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
