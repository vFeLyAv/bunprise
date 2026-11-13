import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SNIPPET from '../demo/splash/splash.html?raw';
import BOOT from '../demo/splash/boot.js?raw';
import {
  ENTRANCE_PREFIX,
  SPLASH_CAP_MS,
  SPLASH_FLOOR_MS,
  SPLASH_ID,
  SPLASH_OUT_CLASS,
  exitSplashWhenReady,
  longestMs,
  removeSplashNow,
  whenSettled,
  type SplashPhase,
} from '../demo/splash/controller';
import { phoneDocument, splashGallery, splitSnippet } from '../demo/splash/gallery';

// The launch screen (gallery prototype 26.10): the snippet that will be pasted into apps/web/index.html stays pure
// CSS, tiny and calm; the exit controller leaves only after the entrance AND the app (or the cap), once; boot.js pins
// the theme before the first paint.

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const [STYLE, MARKUP] = splitSnippet();
const CSS = STYLE.slice(STYLE.indexOf('<style>') + 7, STYLE.indexOf('</style>'));

async function gzipBytes(text: string): Promise<number> {
  const body = new Response(text).body;
  if (!body) throw new Error('no body');
  return (await new Response(body.pipeThrough(new CompressionStream('gzip'))).arrayBuffer()).byteLength;
}

/** Splits a CSS value list at its top-level commas (not inside calc(), linear(), cubic-bezier()). */
function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function keyframes(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g;
  for (const m of css.matchAll(re)) map.set(m[1] ?? '', m[2] ?? '');
  return map;
}

describe('launch screen snippet (splash.html)', () => {
  it('is one <style> plus one aria-hidden element: no script, no image, nothing from the network, nothing focusable', () => {
    const code = SNIPPET.replace(/<!--[\s\S]*?-->/g, '');
    expect(code.match(/<style>/g)).toHaveLength(1);
    expect(code).not.toMatch(/<script|<img|<link|@import|@font-face|:\/\/|\son\w+=/i);
    for (const url of SNIPPET.match(/url\([^)]*\)/g) ?? []) expect(url).toMatch(/^url\(#bps-/);
    document.body.innerHTML = MARKUP;
    const splash = document.getElementById(SPLASH_ID);
    expect(splash?.getAttribute('aria-hidden')).toBe('true');
    expect(splash?.querySelectorAll('a, button, input, select, textarea, [tabindex]')).toHaveLength(0);
    expect(document.body.children).toHaveLength(1);
  });

  it('stays within 4 KB gzip', async () => {
    expect(await gzipBytes(SNIPPET)).toBeLessThanOrEqual(4096);
  });

  it('animates and transitions only transform and opacity, and nothing loops', () => {
    const frames = keyframes(CSS);
    expect([...frames.keys()].sort()).toEqual(['bps-blink', 'bps-failsafe', 'bps-in-fade', 'bps-in-grow', 'bps-in-peek']);
    for (const [name, body] of frames) {
      const props = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      // the failsafe only flips visibility after 10 s when no script ever ran
      const allowed = name === 'bps-failsafe' ? ['visibility'] : ['transform', 'opacity'];
      expect(props.every((p) => allowed.includes(p ?? '')), `${name}: ${props.join(', ')}`).toBe(true);
    }
    for (const m of CSS.matchAll(/transition:([^;}]+)/g)) {
      for (const item of topLevel(m[1] ?? '')) expect(['opacity', 'transform']).toContain(item.split(/\s+/)[0]);
    }
    expect(CSS).not.toMatch(/infinite|animation-iteration-count/);
  });

  it('names the entrance bps-in-* (the controller waits for those), not the blink or the failsafe', () => {
    const used = [...CSS.matchAll(/animation:([^;}]+)/g)].flatMap((m) => topLevel(m[1] ?? '').map((item) => item.split(/\s+/)[0]));
    expect(used.sort()).toEqual(['bps-blink', 'bps-failsafe', 'bps-in-fade', 'bps-in-grow', 'bps-in-peek']);
    expect(used.filter((n) => n?.startsWith(ENTRANCE_PREFIX))).toHaveLength(3);
  });

  it('has the colours of every theme and of the system dark scheme, and calmer rules for reduced motion', () => {
    expect(CSS).toContain('@media (prefers-color-scheme:dark){:root:not([data-theme=light]) #bp-splash{');
    for (const [theme, page] of [['dark', '#18130F'], ['navy', '#0F1527'], ['ocean', '#111418'], ['black', '#000']] as const) {
      expect(CSS).toMatch(new RegExp(`:root\\[data-theme=${theme}\\] #bp-splash\\{[^}]*--m:${page}`));
    }
    expect(CSS).toContain('@media (prefers-reduced-motion:reduce){:root:not([data-motion=full]) #bp-splash{--k:0}}');
    expect(CSS).toContain(':root[data-motion=reduce] #bp-splash{--k:0}');
    expect(CSS).toContain(':root[data-motion=off] #bp-splash{--k:0;--f:0}');
  });
});

describe('exit controller', () => {
  let start = 0;
  const now = (): number => Date.now() - start;
  /** a document of its own per run: the controller acts once per document */
  const freshDoc = (): Document => {
    const d = document.implementation.createHTMLDocument('splash');
    d.body.innerHTML = `${MARKUP}<div id="root"></div>`;
    return d;
  };
  let doc: Document;

  beforeEach(() => {
    vi.useFakeTimers();
    start = Date.now();
    doc = freshDoc();
  });

  /** A fake CSS animation of the entrance that finishes after `ms`. */
  function entranceFinishingAt(el: HTMLElement, ms: number): void {
    const finished = new Promise<void>((resolve) => setTimeout(resolve, ms));
    el.getAnimations = () => [{ animationName: `${ENTRANCE_PREFIX}-peek`, finished } as unknown as Animation];
  }

  const resolvedAt = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('leaves only after both the entrance and the app, then once, and is removed after its transition', async () => {
    const el = doc.getElementById(SPLASH_ID) as HTMLElement;
    el.style.transitionDuration = '0.32s';
    el.style.transitionDelay = '0.04s';
    entranceFinishingAt(el, 560);
    const phases: SplashPhase[] = [];
    const done = exitSplashWhenReady({ doc, painted: resolvedAt(100), settled: () => resolvedAt(50), now, onPhase: (p) => phases.push(p) });
    await vi.advanceTimersByTimeAsync(400);
    expect(phases).toEqual(['ready']);
    expect(el.classList.contains(SPLASH_OUT_CLASS)).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(phases).toEqual(['ready', 'entered', 'exit']);
    expect(el.classList.contains(SPLASH_OUT_CLASS)).toBe(true);
    // another call does not start anything new
    expect(exitSplashWhenReady({ doc, painted: Promise.resolve(), now })).toBe(done);
    el.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'transform' }));
    expect(el.isConnected).toBe(true);
    el.dispatchEvent(Object.assign(new Event('transitionend'), { propertyName: 'opacity' }));
    await done;
    expect(el.isConnected).toBe(false);
    expect(phases).toEqual(['ready', 'entered', 'exit', 'removed']);
  });

  it(`never shows before ${SPLASH_FLOOR_MS} ms, even when the entrance and the app are instant`, async () => {
    const el = doc.getElementById(SPLASH_ID) as HTMLElement;
    const done = exitSplashWhenReady({ doc, painted: Promise.resolve(), settled: () => Promise.resolve(), now });
    await vi.advanceTimersByTimeAsync(SPLASH_FLOOR_MS - 10);
    expect(el.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    await done;
    expect(el.isConnected).toBe(false);
  });

  it(`stops waiting for photos at the cap (${SPLASH_CAP_MS} ms), but always waits for the painted screen`, async () => {
    const el = doc.getElementById(SPLASH_ID) as HTMLElement;
    const never = (): Promise<void> => new Promise(() => undefined);
    void exitSplashWhenReady({ doc, painted: resolvedAt(300), settled: never, now });
    await vi.advanceTimersByTimeAsync(SPLASH_CAP_MS - 10);
    expect(el.classList.contains(SPLASH_OUT_CLASS)).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(el.isConnected).toBe(false); // no transition in jsdom's computed style: removed at once
    // a screen painted only after the cap: the splash leaves right after it, never over an empty page
    const lateDoc = freshDoc();
    const late = lateDoc.getElementById(SPLASH_ID) as HTMLElement;
    const at = now();
    void exitSplashWhenReady({ doc: lateDoc, painted: resolvedAt(500), settled: never, now });
    await vi.advanceTimersByTimeAsync(490);
    expect(late.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(late.isConnected).toBe(false);
    expect(now() - at).toBeLessThan(520);
  });

  it('removes a splash whose transitionend never comes after the longest transition', async () => {
    const el = doc.getElementById(SPLASH_ID) as HTMLElement;
    el.style.transitionDuration = '0.32s';
    const done = exitSplashWhenReady({ doc, painted: Promise.resolve(), settled: () => Promise.resolve(), now });
    await vi.advanceTimersByTimeAsync(SPLASH_FLOOR_MS + 10);
    expect(el.classList.contains(SPLASH_OUT_CLASS)).toBe(true);
    expect(el.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(320 + 150);
    await done;
    expect(el.isConnected).toBe(false);
  });

  it('drops a splash at once on a bfcache restore, and does nothing without one', async () => {
    const el = doc.getElementById(SPLASH_ID) as HTMLElement;
    void exitSplashWhenReady({ doc, painted: new Promise(() => undefined), now });
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(el.isConnected).toBe(false);
    await expect(exitSplashWhenReady({ doc: document.implementation.createHTMLDocument(), painted: Promise.resolve() })).resolves.toBeUndefined();
    document.body.innerHTML = MARKUP;
    removeSplashNow();
    expect(document.getElementById(SPLASH_ID)).toBeNull();
  });

  it('reads the longest time of a computed list', () => {
    expect(longestMs('0.32s, 0.22s')).toBe(320);
    expect(longestMs('40ms')).toBe(40);
    expect(longestMs('0s')).toBe(0);
    expect(longestMs('')).toBe(0);
  });
});

describe('whenSettled (the first screen has nothing loading in view)', () => {
  const box = (e: Element, top: number): void => {
    e.getBoundingClientRect = () => ({ top, left: 0, width: 300, height: 100, bottom: top + 100, right: 300, x: 0, y: top, toJSON: () => '' }) as DOMRect;
  };

  it('waits for skeletons and incomplete images in the viewport, ignores those below the fold, and can be stopped', async () => {
    document.body.innerHTML = '<div class="skeleton" id="s"></div><div aria-busy="true" id="below"></div><img id="i" alt="">';
    const skeleton = document.getElementById('s') as HTMLElement;
    const img = document.getElementById('i') as HTMLImageElement;
    box(skeleton, 10);
    box(document.getElementById('below') as HTMLElement, window.innerHeight + 50);
    box(img, 120);
    let complete = false;
    Object.defineProperty(img, 'complete', { get: () => complete });
    let settled = false;
    void whenSettled(document).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 60));
    expect(settled).toBe(false);
    skeleton.remove();
    await new Promise((r) => setTimeout(r, 60));
    expect(settled).toBe(false);
    complete = true;
    await new Promise((r) => setTimeout(r, 60));
    expect(settled).toBe(true);

    document.body.innerHTML = '<div class="skeleton" id="s2"></div>';
    box(document.getElementById('s2') as HTMLElement, 0);
    const stop = new AbortController();
    let stopped = false;
    void whenSettled(document, stop.signal).then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 40));
    expect(stopped).toBe(false);
    stop.abort();
    await new Promise((r) => setTimeout(r, 40));
    expect(stopped).toBe(true);
  });
});

describe('boot.js (theme and motion before the first paint)', () => {
  const run = (): void => {
    // the planned classic script, run as-is
    new Function(BOOT)();
  };
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, '', '/');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-motion');
  });
  const attr = (name: string): string | null => document.documentElement.getAttribute(name);

  it('pins the chosen theme, else Telegram\'s scheme, else nothing', () => {
    localStorage.setItem('bunprise.theme', 'navy');
    sessionStorage.setItem('bunprise.tgScheme', 'light');
    run();
    expect(attr('data-theme')).toBe('navy');
    localStorage.setItem('bunprise.theme', 'black');
    run();
    expect(attr('data-theme')).toBe('black');
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    run();
    expect(attr('data-theme')).toBe('light');
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('bunprise.theme', 'pink');
    run();
    expect(attr('data-theme')).toBeNull();
  });

  it('reads Telegram\'s first-launch colours from the fragment (dark and light), without touching it', () => {
    const hash = (bg: string) => `#tgWebAppData=x&tgWebAppPlatform=ios&tgWebAppThemeParams=${encodeURIComponent(`{"bg_color":"${bg}","text_color":"#000000"}`)}`;
    history.replaceState(null, '', `/${hash('#18222d')}`);
    run();
    expect(attr('data-theme')).toBe('dark');
    expect(location.hash).toContain('tgWebAppThemeParams');
    history.replaceState(null, '', `/${hash('#ffffff')}`);
    run();
    expect(attr('data-theme')).toBe('light');
  });

  it('pins the device\'s calmer motion levels (the system\'s is CSS) and survives blocked storage', () => {
    localStorage.setItem('bunprise.reduceMotion', JSON.stringify({ level: 'reduced', bunnies: true, batterySaver: true }));
    run();
    expect(attr('data-motion')).toBe('reduce');
    localStorage.setItem('bunprise.reduceMotion', JSON.stringify({ level: 'off' }));
    run();
    expect(attr('data-motion')).toBe('off');
    document.documentElement.removeAttribute('data-motion');
    localStorage.setItem('bunprise.reduceMotion', JSON.stringify({ level: 'full' }));
    run();
    expect(attr('data-motion')).toBeNull();
    localStorage.setItem('bunprise.reduceMotion', 'reduce');
    run();
    expect(attr('data-motion')).toBe('reduce');
    document.documentElement.removeAttribute('data-motion');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(run).not.toThrow();
    expect(attr('data-motion')).toBeNull();
  });
});

describe('splash gallery (gallery only)', () => {
  it('puts the snippet verbatim into the phone document, with the theme and motion of the switches', () => {
    const html = phoneDocument({ theme: 'navy', motion: 'reduce', splash: true });
    expect(html).toContain('data-theme="navy" data-motion="reduce"');
    expect(html).toContain(STYLE);
    expect(html).toContain(MARKUP);
    const plain = phoneDocument({ theme: 'system', motion: 'full', splash: false });
    expect(plain.startsWith('<!doctype html><html lang="de" data-motion="full">')).toBe(true);
    expect(plain).not.toContain(SPLASH_ID);
  });

  it('builds the phone and the switches', () => {
    const app = document.createElement('main');
    document.body.append(app);
    splashGallery(app, new URLSearchParams('screens=splash&ready=600&theme=dark'));
    expect(app.querySelector('.sp-phone iframe')).not.toBeNull();
    const pressed = [...app.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent);
    expect(pressed).toEqual(['600 мс', 'Тёмная', 'Полное']);
  });
});
