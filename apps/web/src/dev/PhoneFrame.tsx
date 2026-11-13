/**
 * DEV ONLY — an iPhone-like frame around the app so Felix can watch it on a
 * desktop browser while agents work.
 *
 * - Active when the window is ≥ 700 px wide and the URL has no `?frame=0`.
 * - Inner viewport 390×844 (or 430×932), 48 px corner radius, dark bezel,
 *   dynamic island, status bar with the current time, home indicator.
 * - The app scrolls inside the frame; `position: fixed` bars stay inside it
 *   (contain: paint) and overlays portal into the screen (LayerRootProvider).
 * - Simulated safe areas: --sa-top / --sa-bottom (and --sat / --sab) on the screen.
 * - Toolbar: 390 / 430, "без рамки", DE / EN (localStorage 'bunprise.lang' + reload),
 *   "Стиль" основной / A / B / C (the decided default look and the three directions on top of it,
 *   DirectionSwitcher.tsx; without the frame: Ctrl+Alt+D or `?direction=` and a small pill bottom-left).
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '../ui/cn';
import { LayerRootProvider } from '../ui/layers';
import { DirectionPill, DirectionToolbarGroup, useDirectionHotkeys } from './DirectionSwitcher';
import { DEMO_MODE } from '../lib/app';
import './phone-frame.css';

const MIN_WINDOW_WIDTH = 700;
const BEZEL = 12;
const SIZES = {
  '390': { w: 390, h: 844 },
  '430': { w: 430, h: 932 },
} as const;
type SizeKey = keyof typeof SIZES;
const SIZE_STORAGE_KEY = 'bunprise.devframe.size';
const LANG_STORAGE_KEY = 'bunprise.lang';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}

function subscribeEnabled(onChange: () => void): () => void {
  const mql = window.matchMedia(`(min-width: ${MIN_WINDOW_WIDTH}px)`);
  mql.addEventListener('change', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    mql.removeEventListener('change', onChange);
    window.removeEventListener('popstate', onChange);
  };
}

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('frame') === '0') return false;
  return window.innerWidth >= MIN_WINDOW_WIDTH;
}

/** Wraps the app in the phone frame on wide screens; renders it as-is otherwise. */
export function PhoneFrame({ children }: { children: ReactNode }) {
  const enabled = useSyncExternalStore(subscribeEnabled, isEnabled, () => false);
  useDirectionHotkeys();
  if (!enabled) {
    return (
      <>
        {children}
        <DirectionPill />
      </>
    );
  }
  return <Frame>{children}</Frame>;
}

function useClock(lang: string): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

/** Shrinks the phone when the window is too short for it (zoom keeps fixed/backdrop behaviour intact). */
function useFit(width: number, height: number): number {
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const update = () => {
      const availW = window.innerWidth - 32;
      const availH = window.innerHeight - 70;
      setZoom(Math.min(1, availW / width, availH / height));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [width, height]);
  return zoom;
}

function noFrameHref(): string {
  const params = new URLSearchParams(window.location.search);
  params.set('frame', '0');
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

function currentLang(): string {
  const stored = readStorage(LANG_STORAGE_KEY);
  if (stored) return stored.slice(0, 2);
  const docLang = typeof document !== 'undefined' ? document.documentElement.lang : '';
  return (docLang || 'de').slice(0, 2);
}

function Frame({ children }: { children: ReactNode }) {
  const [sizeKey, setSizeKey] = useState<SizeKey>(() => (readStorage(SIZE_STORAGE_KEY) === '430' ? '430' : '390'));
  const [screen, setScreen] = useState<HTMLElement | null>(null);
  const lang = currentLang();
  const time = useClock(lang);
  const { w, h } = SIZES[sizeKey];
  const zoom = useFit(w + 2 * BEZEL, h + 2 * BEZEL);

  // Marks the framed view (<html data-dev-frame>): the page backdrop then shows on the simulated screen
  // (.pf-screen, phone-frame.css) — the production layer (body::before, app.css) sits behind the stage.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-dev-frame', '');
    return () => root.removeAttribute('data-dev-frame');
  }, []);

  const chooseSize = (key: SizeKey) => {
    writeStorage(SIZE_STORAGE_KEY, key);
    setSizeKey(key);
  };
  const chooseLang = (next: 'de' | 'en' | 'ru' | 'uk') => {
    if (next === lang) return;
    writeStorage(LANG_STORAGE_KEY, next);
    window.location.reload();
  };

  return (
    <div className="pf-stage">
      <div className="pf-toolbar" role="toolbar" aria-label="Dev frame">
        <span className="pf-brand">Bunprise · dev</span>
        {['localhost', '127.0.0.1'].includes(window.location.hostname) ? <span className="pf-group">
          <a className={cn('pf-btn pf-link', !DEMO_MODE && 'is-active')} href="http://localhost:5174">Приложение · Google</a>
          <a className={cn('pf-btn pf-link', DEMO_MODE && 'is-active')} href="http://localhost:5173">Демо</a>
        </span> : null}
        <span className="pf-group">
          {(Object.keys(SIZES) as SizeKey[]).map((key) => (
            <button key={key} type="button" className={cn('pf-btn', key === sizeKey && 'is-active')} onClick={() => chooseSize(key)}>
              {key}
            </button>
          ))}
        </span>
        <a className="pf-btn pf-link" href={noFrameHref()}>
          без рамки
        </a>
        <span className="pf-group">
          <button type="button" className={cn('pf-btn', lang === 'de' && 'is-active')} onClick={() => chooseLang('de')}>
            DE
          </button>
          <button type="button" className={cn('pf-btn', lang === 'en' && 'is-active')} onClick={() => chooseLang('en')}>
            EN
          </button>
          <button type="button" className={cn('pf-btn', lang === 'ru' && 'is-active')} onClick={() => chooseLang('ru')}>
            RU
          </button>
          <button type="button" className={cn('pf-btn', lang === 'uk' && 'is-active')} onClick={() => chooseLang('uk')}>
            UK
          </button>
        </span>
        <DirectionToolbarGroup />
      </div>

      <div className="pf-phone" style={{ width: w + 2 * BEZEL, height: h + 2 * BEZEL, zoom }}>
        <div className="pf-screen" style={{ width: w, height: h }}>
          <div className="pf-app" ref={setScreen}>
            {screen ? <LayerRootProvider value={screen}>{children}</LayerRootProvider> : null}
          </div>
          <div className="pf-status" aria-hidden="true">
            <span>{time}</span>
            <span className="pf-icons">
              <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden="true">
                <rect x="0" y="8" width="3" height="4" rx="1" />
                <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
                <rect x="10" y="3" width="3" height="9" rx="1" />
                <rect x="15" y="0" width="3" height="12" rx="1" />
              </svg>
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M1 4.2a10 10 0 0 1 14 0M3.6 6.9a6.3 6.3 0 0 1 8.8 0M6.2 9.5a2.6 2.6 0 0 1 3.6 0" />
              </svg>
              <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true">
                <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" strokeOpacity="0.4" />
                <rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor" />
                <path d="M25 4.5v4a2 2 0 0 0 0-4z" fill="currentColor" fillOpacity="0.4" />
              </svg>
            </span>
          </div>
          <div className="pf-island" aria-hidden="true" />
          <div className="pf-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
