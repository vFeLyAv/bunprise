/**
 * Gallery page for the launch screen (Felix 26.10) — a GALLERY-ONLY prototype on the mascot gallery (5180); the app
 * gets it only after his OK. A phone plays a cold start of the app: the splash (splash.html, verbatim) over a mock of
 * the first screen (the "Bald" feed, two cover photos that arrive late, like the real covers), and the exit controller
 * (controller.ts, verbatim) decides when it leaves. The phone is an iframe, so every replay is a fresh document: the
 * CSS animations start with its first paint and performance.now() counts from its start, like a real launch.
 *
 *   ?screens=splash [&ready=150|600|2000|never] [&theme=light|dark|navy|ocean|black|system] [&motion=full|reduce|off]
 *                   [&reduced=1 (= motion=reduce)] [&tg=1 (Telegram's own loader first)] [&nosplash=1 (today)]
 *   &storyboard=1   contact sheet: frozen frames over the whole start (deterministic: every animation is paused and
 *                   seeked through the Web Animations API — a review tool only, the splash itself never needs it;
 *                   not "sheet", which main.ts reserves for the welcome stage)
 *   &t=520          one frozen phone at 520 ms (screenshots)
 *
 * Design note: docs/design/2026-10-26-splash.md.
 */

import SNIPPET from './splash.html?raw';
import {
  ENTRANCE_PREFIX,
  SPLASH_CAP_MS,
  SPLASH_FLOOR_MS,
  SPLASH_ID,
  SPLASH_OUT_CLASS,
  exitSplashWhenReady,
  longestMs,
  type SplashPhase,
} from './controller';

type ReadyKey = '150' | '600' | '2000' | 'never';
type ThemeKey = 'light' | 'dark' | 'navy' | 'ocean' | 'black' | 'system';
type MotionKey = 'full' | 'reduce' | 'off';

interface Scenario {
  label: string;
  /** the mock app's first screen appears (in the app: the JS bundle ran, React rendered) */
  render: number;
  /** the cover photos arrive (their bytes, then decode) */
  photo: number;
}

const SCENARIOS: Record<ReadyKey, Scenario> = {
  '150': { label: '150 мс', render: 90, photo: 150 },
  '600': { label: '600 мс', render: 300, photo: 600 },
  '2000': { label: '2000 мс', render: 700, photo: 2000 },
  never: { label: 'никогда (лимит 2,5 с)', render: 900, photo: 4200 },
};
const THEMES: [ThemeKey, string][] = [['light', 'Светлая'], ['dark', 'Тёмная'], ['navy', 'Blau'], ['ocean', 'Ozean'], ['black', 'Schwarz'], ['system', 'Как в системе']];
const MOTIONS: [MotionKey, string][] = [['full', 'Полное'], ['reduce', 'Меньше движения'], ['off', 'Aus (без анимаций)']];
/** Telegram hides its own loading placeholder at ready() or at the page's load event — roughly when the app bundle has
 *  run, a moment before the first screen renders; the simulation lifts it then, but not before 250 ms */
const telegramLift = (s: Scenario): number => Math.max(250, s.render - 30);

// ---- the mock app inside the phone (German, like the app; colours from tokens.css / navy.css / ocean.css) ----------

const DARK_VARS = '--bg:#17120F;--t:#1C1612;--m:#18130F;--b:#15100D;--g1:rgba(255,150,84,.13);--g2:rgba(232,118,124,.1);--g3:rgba(236,172,82,.1);--g4:rgba(150,132,226,.09);--text:#F5EDE3;--text2:#C3B5A6;--card:rgba(52,42,35,.72);--rim:rgba(255,236,214,.08);--cover:#553A22;--fill:rgba(255,230,205,.09);--accent:#EE9443;--tab:rgba(42,34,29,.86);--shadow:0 10px 24px -14px rgba(0,0,0,.6)';
const MOCK_CSS = `
:root{color-scheme:light dark}:root[data-theme=light]{color-scheme:only light}:root[data-theme=dark],:root[data-theme=navy],:root[data-theme=ocean],:root[data-theme=black]{color-scheme:dark}
:root{--bg:#F2EBDD;--t:#F7F0E5;--m:#F3EADC;--b:#F0E6D6;--g1:rgba(255,193,146,.58);--g2:rgba(248,180,170,.46);--g3:rgba(252,206,126,.5);--g4:rgba(204,194,242,.42);
  --text:#2A231C;--text2:#62554A;--card:rgba(255,253,248,.78);--rim:rgba(255,255,255,.85);--cover:#F8D0A2;--fill:rgba(116,84,44,.08);--accent:#EE9443;
  --tab:rgba(255,253,248,.86);--shadow:0 10px 24px -14px rgba(70,45,20,.3),0 2px 8px rgba(70,45,20,.05)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK_VARS}}}
:root[data-theme=dark]{${DARK_VARS}}
:root[data-theme=navy]{--bg:#0F1526;--t:#131A2D;--m:#0F1527;--b:#0D1322;--g1:rgba(96,140,255,.14);--g2:rgba(150,120,255,.1);--g3:rgba(70,170,230,.09);--g4:rgba(255,150,84,.07);
  --text:#EEF2FA;--text2:#AEB9CF;--card:rgba(30,40,64,.7);--rim:rgba(214,228,255,.07);--cover:#1F2840;--fill:rgba(200,220,255,.08);--tab:rgba(22,30,50,.86);--shadow:0 10px 24px -14px rgba(0,0,0,.6)}
:root[data-theme=ocean]{--bg:#111418;--t:#15191F;--m:#111418;--b:#0F1215;--g1:rgba(80,160,255,.12);--g2:rgba(90,200,250,.08);--g3:rgba(120,140,255,.08);--g4:rgba(80,160,255,.05);
  --text:#EDF1F6;--text2:#AAB4C2;--card:rgba(36,41,49,.7);--rim:rgba(220,232,250,.07);--cover:#232831;--fill:rgba(205,220,240,.08);--accent:#4FA8FF;--tab:rgba(28,32,38,.86);--shadow:0 10px 24px -14px rgba(0,0,0,.6)}
:root[data-theme=black]{--bg:#000;--t:#000;--m:#000;--b:#000;--g1:transparent;--g2:transparent;--g3:transparent;--g4:transparent;
  --text:#F2F2F4;--text2:#B0B0B8;--card:#161618;--rim:rgba(255,255,255,.07);--cover:#1F1F22;--fill:rgba(255,255,255,.07);--accent:#DE8C4A;--tab:#111113;--shadow:0 0 #0000}
html{background:var(--bg)}
body{margin:0;min-height:100vh;overflow:hidden;color:var(--text);font:15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;z-index:-1;background:radial-gradient(78% 36% at -4% -2%,var(--g1),transparent 72%),radial-gradient(70% 34% at 104% 30%,var(--g2),transparent 72%),radial-gradient(84% 34% at 4% 98%,var(--g3),transparent 72%),radial-gradient(72% 30% at 102% 80%,var(--g4),transparent 72%),linear-gradient(var(--t),var(--m) 55%,var(--b))}
.m-app{padding:54px 16px 0}
.m-top{display:flex;align-items:center;justify-content:space-between;height:40px}
.m-brand{display:flex;align-items:center;gap:8px;font-weight:700;font-size:16px}
.m-brand i{width:22px;height:22px;border-radius:6px;background:linear-gradient(#F6C07E,#F0A04B)}
.m-icons{display:flex;gap:10px}.m-icons i{width:36px;height:36px;border-radius:50%;background:var(--card);box-shadow:var(--shadow),inset 0 0 0 1px var(--rim)}
.m-head{display:flex;align-items:center;justify-content:space-between;margin:12px 0 16px}
.m-head h1{margin:0;font-size:34px;font-weight:800;letter-spacing:-.032em}
.m-seg{display:flex;background:var(--fill);border-radius:999px;padding:3px;font-size:13px;font-weight:600}
.m-seg span{padding:6px 12px;border-radius:999px;color:var(--text2)}.m-seg .on{background:var(--card);color:var(--text);box-shadow:var(--shadow)}
.m-card{background:var(--card);border-radius:24px;box-shadow:var(--shadow),inset 0 0 0 1px var(--rim);overflow:hidden;margin-bottom:14px}
.feed-cover{position:relative;overflow:hidden;display:block;height:170px;background:var(--cover)}
.feed-cover::before{content:"";position:absolute;inset:0;background:radial-gradient(90% 70% at 22% 18%,rgba(255,255,255,.4),transparent 62%)}
.feed-cover[data-state=loading]::before{animation:m-pulse 1.2s ease-in-out infinite}
:root[data-motion=reduce] .feed-cover::before,:root[data-motion=off] .feed-cover::before{animation:none}
@media (prefers-reduced-motion:reduce){:root:not([data-motion=full]) .feed-cover::before{animation:none}}
@keyframes m-pulse{50%{opacity:.4}}
.feed-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .32s cubic-bezier(.2,.7,.3,1)}
.feed-cover-img[data-loaded]{opacity:1}
:root[data-motion=off] .feed-cover-img{transition:none}
.m-body{padding:12px 16px 16px}.m-body h2{margin:0 0 2px;font-size:19px;letter-spacing:-.01em}.m-body p{margin:0;color:var(--text2);font-size:14px}
.m-chips{display:flex;gap:6px;margin-top:10px}.m-chips span{font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px;background:var(--fill);color:var(--text2)}
.m-tabs{position:fixed;left:12px;right:12px;bottom:14px;height:62px;border-radius:31px;background:var(--tab);box-shadow:var(--shadow),inset 0 0 0 1px var(--rim);
  display:flex;align-items:center;justify-content:space-around;font-size:11px;font-weight:600;color:var(--text2)}
.m-tabs .on{color:var(--accent)}.m-tabs .plus{width:50px;height:50px;border-radius:50%;background:var(--accent);color:#1D140C;display:grid;place-items:center;font-size:28px;font-weight:400}
`;

const MOCK_APP = `<div class="m-app">
  <div class="m-top"><span class="m-brand"><i></i>Bunprise</span><span class="m-icons"><i></i><i></i></span></div>
  <div class="m-head"><h1>Bald</h1><span class="m-seg"><span class="on">Liste</span><span>Monat</span></span></div>
  <article class="m-card"><span class="feed-cover" data-state="loading"></span><div class="m-body"><h2>Lenas Geburtstag</h2><p>Samstag, 1. November · in 6 Tagen</p><div class="m-chips"><span>3 Wünsche</span><span>Du kommst</span></div></div></article>
  <article class="m-card"><span class="feed-cover" data-state="loading"></span><div class="m-body"><h2>Spieleabend bei Tim</h2><p>Freitag, 7. November · 19:00</p></div></article>
</div>
<nav class="m-tabs"><span class="on">Bald</span><span>Listen</span><span class="plus">+</span><span>Ideen</span><span>Profil</span></nav>`;

// two drawn "photos" (no network): a birthday cake, a games evening
const PHOTO_CAKE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 170" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="a" cx="30%" cy="22%" r="95%"><stop offset="0" stop-color="#FFE6C8"/><stop offset=".55" stop-color="#F0A27C"/><stop offset="1" stop-color="#A9524A"/></radialGradient><linearGradient id="t" x2="0" y2="1"><stop offset="0" stop-color="#8A5536"/><stop offset="1" stop-color="#55301E"/></linearGradient><linearGradient id="c" x2="0" y2="1"><stop offset="0" stop-color="#FFF6EF"/><stop offset="1" stop-color="#EFCDBE"/></linearGradient></defs><rect width="390" height="170" fill="url(#a)"/><g fill="#FFF6E0"><circle cx="40" cy="30" r="15" opacity=".3"/><circle cx="330" cy="38" r="22" opacity=".22"/><circle cx="290" cy="20" r="8" opacity=".4"/><circle cx="92" cy="62" r="6" opacity=".45"/><circle cx="362" cy="92" r="11" opacity=".28"/><circle cx="18" cy="98" r="9" opacity=".22"/></g><circle cx="195" cy="52" r="46" fill="#FFE7A8" opacity=".28"/><rect y="128" width="390" height="42" fill="url(#t)"/><ellipse cx="195" cy="132" rx="94" ry="12" fill="#F7EFE8"/><rect x="128" y="82" width="134" height="50" rx="10" fill="url(#c)"/><path d="M128 84h134v6q-8 16-16 0q-8 12-16 0q-8 18-16 0q-8 10-16 0q-8 16-16 0q-8 12-16 0q-8 18-16 0q-8 10-16 0q-3 10-6 2z" fill="#F59BB0"/><ellipse cx="195" cy="84" rx="67" ry="9" fill="#F7AFC0"/><rect x="128" y="113" width="134" height="6" fill="#F6C4D0"/><g fill="#7FB7E8"><rect x="168" y="58" width="5" height="24" rx="2"/><rect x="193" y="54" width="5" height="28" rx="2"/><rect x="218" y="58" width="5" height="24" rx="2"/></g><g fill="#FFD36B"><ellipse cx="170.5" cy="52" rx="3.5" ry="6"/><ellipse cx="195.5" cy="48" rx="3.5" ry="6"/><ellipse cx="220.5" cy="52" rx="3.5" ry="6"/></g></svg>`;
const PHOTO_GAMES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 390 170" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="a" cx="72%" cy="18%" r="100%"><stop offset="0" stop-color="#A6DCCB"/><stop offset=".6" stop-color="#3F8A84"/><stop offset="1" stop-color="#1E4A50"/></radialGradient></defs><rect width="390" height="170" fill="url(#a)"/><g transform="rotate(-6 195 130)"><rect x="80" y="70" width="240" height="130" rx="10" fill="#F4E3C3"/><g fill="#E8574A"><rect x="100" y="86" width="26" height="26" rx="4"/><rect x="190" y="118" width="26" height="26" rx="4"/></g><g fill="#5AA9E6"><rect x="134" y="86" width="26" height="26" rx="4"/><rect x="258" y="86" width="26" height="26" rx="4"/></g><g fill="#F2C14E"><rect x="168" y="86" width="26" height="26" rx="4"/><rect x="224" y="118" width="26" height="26" rx="4"/></g></g><g transform="rotate(14 302 58)"><rect x="282" y="38" width="40" height="40" rx="9" fill="#FFFDF8"/><g fill="#2A231C"><circle cx="292" cy="48" r="3.5"/><circle cx="302" cy="58" r="3.5"/><circle cx="312" cy="68" r="3.5"/></g></g><g transform="rotate(-16 62 70)"><rect x="40" y="38" width="44" height="62" rx="6" fill="#FFFDF8"/><rect x="45" y="43" width="34" height="52" rx="4" fill="#E8574A"/></g></svg>`;
const PHOTOS = [PHOTO_CAKE, PHOTO_GAMES].map((s) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`);

/** The snippet's <style> (with its comment) goes into <head>, the rest is the body markup. */
export function splitSnippet(snippet: string = SNIPPET): [string, string] {
  const cut = snippet.indexOf('</style>') + '</style>'.length;
  return [snippet.slice(0, cut), snippet.slice(cut)];
}

export interface PhoneOptions {
  theme: ThemeKey;
  motion: MotionKey;
  splash: boolean;
}

/** The phone's document: what index.html would be with the splash pasted in (+ the mock app's own styles). */
export function phoneDocument(o: PhoneOptions): string {
  const [style, markup] = splitSnippet();
  // the attributes boot.js / main.tsx would set; "full" is pinned so the gallery moves even under a system reduce
  const attrs = `${o.theme === 'system' ? '' : ` data-theme="${o.theme}"`} data-motion="${o.motion}"`;
  // color-scheme as in index.html + tokens.css: without it a browser's "darken every site" repainted the phone (26.10)
  return `<!doctype html><html lang="de"${attrs}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">`
    + `<style>${MOCK_CSS}</style>${o.splash ? style : ''}</head><body>${o.splash ? markup : ''}<div id="root"></div></body></html>`;
}

function renderMock(doc: Document): void {
  const root = doc.getElementById('root');
  if (root && !root.firstChild) root.innerHTML = MOCK_APP;
}

/** The covers get their photos: an <img> each, shown once decoded (like the app's FeedCoverImage). */
function loadPhotos(doc: Document): Promise<void> {
  const covers = Array.from(doc.querySelectorAll<HTMLElement>('.feed-cover[data-state="loading"]'));
  return Promise.all(covers.map((cover, i) => new Promise<void>((resolve) => {
    const img = doc.createElement('img');
    img.className = 'feed-cover-img';
    img.alt = '';
    cover.append(img);
    void doc.defaultView?.getComputedStyle(img).opacity; // its "before" style exists, so the fade-in transitions
    const done = (): void => {
      img.setAttribute('data-loaded', '');
      cover.dataset.state = 'ready';
      resolve();
    };
    img.onload = done;
    img.onerror = done;
    img.src = PHOTOS[i % PHOTOS.length] ?? '';
  }))).then(() => undefined);
}

// ---- deterministic frames (contact sheet / one frame) ----------------------------------------------------------

interface Plan { entranceEnd: number; exitAt: number; exitMs: number }

function isEntrance(a: Animation): boolean {
  const name = (a as Partial<CSSAnimation>).animationName;
  return typeof name === 'string' && name.startsWith(ENTRANCE_PREFIX);
}

/** When the controller would start the exit in this scenario (entrance end, floor, ready or cap). */
function planOf(doc: Document, s: Scenario): Plan {
  const splash = doc.getElementById(SPLASH_ID);
  if (!splash) return { entranceEnd: 0, exitAt: Number.POSITIVE_INFINITY, exitMs: 0 };
  const ends = splash.getAnimations({ subtree: true }).filter(isEntrance).map((a) => Number(a.effect?.getComputedTiming().endTime ?? 0));
  const entranceEnd = Math.max(0, ...ends);
  const style = doc.defaultView?.getComputedStyle(splash);
  const exitMs = style ? longestMs(style.transitionDuration) + longestMs(style.transitionDelay) : 0;
  const readyAt = s.photo <= SPLASH_CAP_MS ? s.photo : Math.max(s.render, SPLASH_CAP_MS);
  return { entranceEnd, exitAt: Math.max(entranceEnd, SPLASH_FLOOR_MS, readyAt), exitMs };
}

/** Puts a loaded phone document into its state at `t` ms after its first paint and freezes it there. */
async function freezeAt(doc: Document, t: number, s: Scenario): Promise<Plan> {
  if (t >= s.render) renderMock(doc);
  if (t >= s.photo) await loadPhotos(doc);
  const plan = planOf(doc, s);
  const root = doc.getElementById('root');
  const splash = doc.getElementById(SPLASH_ID);
  const seek = (a: Animation, ms: number): void => {
    a.pause();
    a.currentTime = Math.max(0, ms);
  };
  for (const a of doc.getAnimations()) {
    const target = (a.effect as KeyframeEffect | null)?.target ?? null;
    if ('transitionProperty' in a) seek(a, t - s.photo); // the covers' photo fade-in
    else if (target && root?.contains(target)) seek(a, t - s.render); // the covers' pulse
    else seek(a, t); // the splash: its animations started with the document
  }
  if (splash && t >= plan.exitAt) {
    if (t >= plan.exitAt + plan.exitMs) splash.remove();
    else {
      splash.classList.add(SPLASH_OUT_CLASS);
      for (const a of doc.getAnimations()) {
        const target = (a.effect as KeyframeEffect | null)?.target ?? null;
        if ('transitionProperty' in a && target && splash.contains(target)) seek(a, t - plan.exitAt);
      }
    }
  }
  return plan;
}

/** Loads `html` into the iframe; resolves with its document (not the initial about:blank, whose load may come late). */
function loadFrame(iframe: HTMLIFrameElement, html: string): Promise<Document> {
  return new Promise((resolve) => {
    const onLoad = (): void => {
      const doc = iframe.contentDocument;
      if (!doc?.getElementById('root')) return;
      iframe.removeEventListener('load', onLoad);
      resolve(doc);
    };
    iframe.addEventListener('load', onLoad);
    iframe.srcdoc = html;
  });
}

// ---- the page ------------------------------------------------------------------------------------------------

const CSS_TEXT = `
.sp { margin: 0 auto 28px; max-width: 1060px; }
.sp h2 { margin: 6px 6px 4px; font-size: 22px; }
.sp > p { margin: 0 6px 12px; color: var(--text-2, #6E6E73); font-size: 14px; line-height: 1.45; max-width: 820px; }
.sp-controls { display: flex; flex-direction: column; gap: 8px; margin: 0 6px 16px; }
.sp-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--text-2, #6E6E73); }
.sp-group > span { min-width: 168px; }
.sp-group button { appearance: none; border: 0; border-radius: 999px; padding: 8px 13px; font: 600 13px/1 inherit; font-family: inherit;
  background: var(--tile, rgba(0,0,0,.06)); color: var(--text, #1D1D1F); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.sp-group button:active { transform: scale(.95); }
.sp-group button[aria-pressed="true"] { background: color-mix(in srgb, var(--accent-ui, #F0A04B) 22%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent-ui, #F0A04B); }
.sp-row { display: flex; flex-wrap: wrap; gap: 26px; align-items: flex-start; justify-content: center; }
.sp-phone { position: relative; width: 390px; height: 780px; border-radius: 46px; overflow: hidden; background: #000; flex: none;
  box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(60,40,20,.28); }
.sp-phone iframe, .sp-mini iframe { position: absolute; left: 0; top: 0; width: 390px; height: 780px; border: 0; display: block; }
.sp-tg { position: absolute; inset: 0; z-index: 2; display: grid; place-content: center; justify-items: center; gap: 14px; background: #F4F4F5; color: #8A8A8E; font: 13px/1.3 system-ui, sans-serif; }
.sp-tg.dark { background: #1E2227; color: #7D8590; }
.sp-tg i { width: 28px; height: 28px; border-radius: 50%; border: 3px solid currentColor; border-right-color: transparent; animation: sp-spin .9s linear infinite; }
@keyframes sp-spin { to { transform: rotate(1turn); } }
.sp-side { width: 330px; font-size: 13px; line-height: 1.5; color: var(--text-2, #6E6E73); }
.sp-side b { color: var(--text, #1D1D1F); }
.sp-log { list-style: none; padding: 0; margin: 6px 0 14px; font-variant-numeric: tabular-nums; }
.sp-log li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--tile, rgba(0,0,0,.06)); }
.sp-log li span:last-child { color: var(--text, #1D1D1F); font-weight: 600; }
.sp-side ul { padding-left: 18px; margin: 6px 0 12px; }
.sp-side code { font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; color: var(--text, #1D1D1F); }
.sp-sheet { display: grid; grid-template-columns: repeat(auto-fill, 172px); gap: 16px 12px; justify-content: center; margin-top: 26px; }
.sp-sheet.wait { visibility: hidden; }
.sp-cell { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.sp-mini { position: relative; width: 164px; height: 328px; border-radius: 22px; overflow: hidden; flex: none; box-shadow: 0 0 0 4px #1D1D1F; }
.sp-mini iframe { transform: scale(.42052); transform-origin: 0 0; }
.sp-cell small { font-size: 12px; color: var(--text-2, #6E6E73); font-variant-numeric: tabular-nums; text-align: center; line-height: 1.3; }
.sp-frame { display: flex; justify-content: center; padding: 16px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const PHASE_LABELS: Record<SplashPhase, string> = {
  entered: 'Вход заставки закончился',
  ready: 'Приложение готово (экран + фото)',
  exit: 'Выход начался',
  removed: 'Заставка убрана из DOM',
};

async function gzipSize(text: string): Promise<number | null> {
  if (typeof CompressionStream !== 'function' || typeof Blob === 'undefined' || typeof Response === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return (await new Response(stream).arrayBuffer()).byteLength;
  } catch {
    return null;
  }
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;
}

export function splashGallery(app: HTMLElement, query: URLSearchParams): void {
  app.replaceChildren();
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);

  interface State { ready: ReadyKey; theme: ThemeKey; motion: MotionKey; tg: boolean; nosplash: boolean }
  const state: State = {
    ready: pick<ReadyKey>(query.get('ready'), ['150', '600', '2000', 'never'], '150'),
    theme: pick<ThemeKey>(query.get('theme'), ['light', 'dark', 'navy', 'ocean', 'black', 'system'], 'light'),
    motion: query.get('reduced') === '1' ? 'reduce' : pick<MotionKey>(query.get('motion'), ['full', 'reduce', 'off'], 'full'),
    tg: query.get('tg') === '1',
    nosplash: query.get('nosplash') === '1',
  };
  const frameAt = query.has('t') ? Number(query.get('t')) : null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const clearTimers = (): void => { timers.splice(0).forEach((id) => clearTimeout(id)); };
  window.addEventListener('pagehide', clearTimers, { once: true });

  // ?t=…: one frozen phone, nothing else (screenshots)
  if (frameAt !== null && Number.isFinite(frameAt)) {
    const wrap = el('div', 'sp-frame');
    const phone = el('div', 'sp-phone');
    const iframe = el('iframe');
    iframe.title = 'Bunprise: кадр запуска';
    phone.append(iframe);
    wrap.append(phone);
    app.append(wrap);
    void loadFrame(iframe, phoneDocument({ theme: state.theme, motion: state.motion, splash: !state.nosplash }))
      .then((doc) => freezeAt(doc, frameAt, SCENARIOS[state.ready]))
      .then(() => requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; })));
    return;
  }

  const section = el('section', 'sp');
  section.innerHTML = `<h2>Заставка при запуске (26.10) — прототип</h2>
    <p>Только в галерее: в приложение попадёт после одобрения Кирилла. Это холодный старт: сразу фон темы, через 60 мс — значок
    приложения, Помпон выглядывает из-за края и (если ждать дольше) моргает. Как только приложение готово — экран нарисован
    и фото на нём декодированы, — Помпон ныряет обратно, и заставка растворяется. Не раньше, чем закончится вход (≈ 0,56 с),
    и не позже 2,5 с, даже если фото ещё грузятся.</p>`;
  const controls = el('div', 'sp-controls');
  const row = el('div', 'sp-row');
  const phone = el('div', 'sp-phone');
  const side = el('div', 'sp-side');
  row.append(phone, side);
  const sheet = el('div', 'sp-sheet');
  section.append(controls, row, sheet);
  app.append(section);

  const groups: { key: keyof State; buttons: HTMLButtonElement[] }[] = [];
  const syncButtons = (): void => {
    for (const g of groups) for (const b of g.buttons) b.setAttribute('aria-pressed', String(String(state[g.key]) === b.dataset.value));
  };
  const group = <K extends 'ready' | 'theme' | 'motion'>(label: string, key: K, options: [string, string][]): void => {
    const box = el('div', 'sp-group');
    box.append(el('span', undefined, label));
    const buttons = options.map(([value, text]) => {
      const b = el('button', undefined, text);
      b.type = 'button';
      b.dataset.value = value;
      b.addEventListener('click', () => {
        (state as unknown as Record<K, string>)[key] = value;
        syncButtons();
        play();
      });
      box.append(b);
      return b;
    });
    groups.push({ key, buttons });
    controls.append(box);
  };
  group('Приложение готово через:', 'ready', (Object.keys(SCENARIOS) as ReadyKey[]).map((k) => [k, SCENARIOS[k].label]));
  group('Тема:', 'theme', THEMES);
  group('Движение:', 'motion', MOTIONS);
  const extra = el('div', 'sp-group');
  extra.append(el('span', undefined, 'Сравнить:'));
  const toggle = (key: 'tg' | 'nosplash', text: string): HTMLButtonElement => {
    const b = el('button', undefined, text);
    b.type = 'button';
    b.dataset.value = 'true';
    b.addEventListener('click', () => { state[key] = !state[key]; syncButtons(); play(); });
    groups.push({ key, buttons: [b] });
    extra.append(b);
    return b;
  };
  toggle('tg', 'Сначала загрузчик Telegram');
  toggle('nosplash', 'Без заставки (как сейчас)');
  const again = el('button', undefined, '▶ Ещё раз');
  again.type = 'button';
  again.addEventListener('click', () => play());
  const sheetBtn = el('button', undefined, 'Раскадровка');
  sheetBtn.type = 'button';
  sheetBtn.addEventListener('click', () => void renderSheet());
  extra.append(again, sheetBtn);
  controls.append(extra);
  syncButtons();

  side.innerHTML = `<b>Хронометраж этого запуска</b> <small>(мс от старта страницы)</small><ul class="sp-log"></ul>
    <b>Что проверить</b><ul>
      <li>фон сразу нужной темы, без вспышки;</li>
      <li>значок спокойно проявляется, Помпон выглядывает, ничего не дёргается;</li>
      <li>фото на карточках уже на месте, когда заставка уходит (150 / 600 / 2000);</li>
      <li>«никогда»: в 2,5 с заставка всё равно уходит, фото придут позже;</li>
      <li>«Меньше движения»: только проявление и растворение.</li></ul>
    <b>Файлы</b><ul>
      <li><code>packages/mascot/demo/splash/splash.html</code> — ровно то, что вставится в <code>index.html</code> (<span class="sp-size">…</span>);</li>
      <li><code>controller.ts</code> — когда уходить (план для <code>main.tsx</code>);</li>
      <li><code>boot.js</code> — тема до первого кадра (план).</li></ul>`;
  const log = side.querySelector<HTMLUListElement>('.sp-log');
  const sizeOut = side.querySelector<HTMLElement>('.sp-size');
  void gzipSize(SNIPPET).then((n) => {
    if (sizeOut) sizeOut.textContent = n ? `${(n / 1024).toFixed(1).replace('.', ',')} КБ gzip` : `${SNIPPET.length} байт без сжатия`;
  });
  const logLine = (label: string, ms: number | string): void => {
    if (!log) return;
    const li = el('li');
    li.append(el('span', undefined, label), el('span', undefined, typeof ms === 'number' ? `${Math.round(ms)} мс` : ms));
    log.append(li);
  };

  const syncUrl = (): void => {
    const p = new URLSearchParams({ screens: 'splash', ready: state.ready, theme: state.theme, motion: state.motion });
    if (state.tg) p.set('tg', '1');
    if (state.nosplash) p.set('nosplash', '1');
    try { history.replaceState(history.state, '', `?${p.toString()}`); } catch { /* sandboxed */ }
  };

  let runs = 0;
  function play(): void {
    clearTimers();
    syncUrl();
    // a discarded run's controller may still settle: only the current run writes the readout
    const run = ++runs;
    const line = (label: string, ms: number): void => { if (run === runs) logLine(label, ms); };
    phone.replaceChildren();
    if (log) log.replaceChildren();
    const s = SCENARIOS[state.ready];
    const iframe = el('iframe');
    iframe.title = 'Bunprise: холодный старт (симуляция)';
    phone.append(iframe);
    let cover: HTMLElement | null = null;
    if (state.tg) {
      cover = el('div', `sp-tg${state.theme === 'light' ? '' : ' dark'}`);
      cover.append(el('i'), el('span', undefined, 'Telegram открывает мини-приложение…'));
      phone.append(cover);
    }
    void loadFrame(iframe, phoneDocument({ theme: state.theme, motion: state.motion, splash: !state.nosplash })).then((doc) => {
      const view = doc.defaultView;
      if (!view || !iframe.isConnected) return;
      const at = (ms: number, fn: () => void): void => { timers.push(setTimeout(fn, Math.max(0, ms - view.performance.now()))); };
      at(s.render, () => renderMock(doc));
      at(s.photo, () => void loadPhotos(doc));
      if (cover) at(telegramLift(s), () => cover?.remove());
      if (cover) line('Telegram убрал свой загрузчик', telegramLift(s));
      line('Экран приложения нарисован', s.render);
      line('Фото пришли', s.photo);
      const painted = new Promise<void>((resolve) => at(s.render, () => view.requestAnimationFrame(() => setTimeout(resolve, 0))));
      if (state.nosplash) return;
      void exitSplashWhenReady({ doc, painted, onPhase: (p, ms) => line(PHASE_LABELS[p], ms) });
    });
  }

  async function renderSheet(): Promise<void> {
    sheet.replaceChildren();
    sheet.classList.add('wait');
    const s = SCENARIOS[state.ready];
    const opts = { theme: state.theme, motion: state.motion, splash: !state.nosplash };
    // a probe document tells when the exit starts in this scenario
    const probeBox = el('div', 'sp-mini');
    const probe = el('iframe');
    probeBox.append(probe);
    sheet.append(probeBox);
    const plan = planOf(await loadFrame(probe, phoneDocument(opts)), s);
    probeBox.remove();
    const exitAt = Number.isFinite(plan.exitAt) ? plan.exitAt : s.photo + 400;
    const times = [0, 50, 100, 160, 220, 300, 380, 460, 560].filter((t) => t < exitAt);
    if (exitAt > 1150) times.push(1000); // the blink, while the app keeps us waiting
    for (let d = 0; d <= Math.max(360, plan.exitMs); d += 60) times.push(Math.round(exitAt + d));
    const what = (t: number): string => {
      if (t < exitAt) return t === 0 ? 'первый кадр' : t < plan.entranceEnd ? 'вход' : 'ждёт приложение';
      return t >= exitAt + plan.exitMs ? 'убрана' : 'выход';
    };
    await Promise.all(times.map(async (t) => {
      const cell = el('div', 'sp-cell');
      const mini = el('div', 'sp-mini');
      const iframe = el('iframe');
      iframe.title = `кадр ${t} мс`;
      mini.append(iframe);
      cell.append(mini, el('small', undefined, `${t} мс · ${what(t)}`));
      sheet.append(cell);
      await freezeAt(await loadFrame(iframe, phoneDocument(opts)), t, s);
    }));
    sheet.classList.remove('wait');
    document.documentElement.dataset.ready = '1';
  }

  window.addEventListener('pagehide', () => phone.replaceChildren(), { once: true });
  play();
  if (query.get('storyboard') === '1') void renderSheet();
}
