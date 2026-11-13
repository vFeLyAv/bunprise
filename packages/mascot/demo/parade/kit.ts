/**
 * Shared bits of the two gallery prototypes «Парад» (demo/parade) and «Здесь я буду жить» (demo/homeicon):
 * DOM helpers and the Paper tokens of a phone mock (light + dark, copied from apps/web/src/styles/tokens.css and
 * kit.css — the gallery must not import the app). The actor-layer CSS and `Driver` / `CssFade` (one Playhead over
 * authored tracks; the reduced-motion CSS fade) live in the package since 27.10 (src/drive.ts) and are re-exported.
 */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Waits two frames (layout + paint) and marks the page ready for screenshots. */
export function markReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset.ready = '1')));
}

export function addCss(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const style = el('style');
  style.id = id;
  style.textContent = css;
  document.head.append(style);
}

/** ?theme=dark|light; the gallery page's own colours follow (index.html :root[data-theme]). */
export type Theme = 'light' | 'dark';
export function themeOf(q: URLSearchParams): Theme {
  return q.get('theme') === 'dark' ? 'dark' : 'light';
}
export function applyPageTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * The Paper tokens on a phone mock (`.bp-paper`, night: `.bp-paper.dark`). Values from tokens.css (light-dark
 * pairs) and kit.css (frosted panel); the mascot contour / floor shadow are the app's (tokens §6).
 */
export const PAPER_CSS = `
.bp-paper { --bg: #F2EBDD; --text: #2A231C; --text-2: #62554A; --text-3: #85786A; --accent-text: #984A14; --danger-text: #AE2A1C;
  --g1: rgba(255,193,146,.58); --g2: rgba(248,180,170,.46); --g3: rgba(252,206,126,.5); --g4: rgba(204,194,242,.42);
  --top: #F7F0E5; --mid: #F3EADC; --bottom: #F0E6D6; --fill: rgba(116,84,44,.07); --separator: rgba(116,84,44,.15); --surface: #FFFDF8;
  --panel-bg: rgba(255,252,246,.62); --panel-sheen: linear-gradient(180deg, rgba(255,255,255,.5) 0%, transparent 42%);
  --panel-edge: inset 0 0 0 1px rgba(255,255,255,.62), inset 0 1px 0 rgba(255,255,255,.95);
  --panel-shadow: 0 1px 2px rgba(80,50,22,.05), 0 12px 30px -14px rgba(92,56,24,.26);
  --float-bg: rgba(255,253,248,.72); --accent-50: #FEF4E7;
  --mascot-shadow: rgba(70,40,15,.20); --mascot-outline: rgba(224,171,116,.5);
  position: relative; flex: none; overflow: hidden; border-radius: 44px; color: var(--text);
  background: radial-gradient(78% 36% at -4% -2%, var(--g1) 0%, transparent 72%), radial-gradient(70% 34% at 104% 30%, var(--g2) 0%, transparent 72%),
    radial-gradient(84% 34% at 4% 98%, var(--g3) 0%, transparent 72%), radial-gradient(72% 30% at 102% 80%, var(--g4) 0%, transparent 72%),
    linear-gradient(180deg, var(--top) 0%, var(--mid) 55%, var(--bottom) 100%);
  box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(40,25,10,.25);
  font: 17px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.bp-paper.dark { --bg: #17120F; --text: #F5EDE3; --text-2: #C3B5A6; --text-3: #918377; --accent-text: #F2A25A; --danger-text: #FF8F7E;
  --g1: rgba(255,150,84,.13); --g2: rgba(232,118,124,.10); --g3: rgba(236,172,82,.10); --g4: rgba(150,132,226,.09);
  --top: #1C1612; --mid: #18130F; --bottom: #15100D; --fill: rgba(255,230,205,.075); --separator: rgba(255,230,205,.13); --surface: #2A221D;
  --panel-bg: rgba(46,37,31,.72); --panel-sheen: linear-gradient(180deg, rgba(255,236,214,.05) 0%, transparent 42%);
  --panel-edge: inset 0 0 0 1px rgba(255,236,214,.075), inset 0 1px 0 rgba(255,236,214,.11);
  --panel-shadow: 0 1px 2px rgba(0,0,0,.3), 0 12px 30px -14px rgba(0,0,0,.55);
  --float-bg: rgba(42,34,29,.74); --accent-50: #2B1F16;
  --mascot-shadow: rgba(0,0,0,.42); --mascot-outline: rgba(255,214,170,.2); box-shadow: 0 0 0 10px #2C2C2E, 0 30px 70px rgba(0,0,0,.6); }
.bp-panel { background-color: var(--panel-bg); background-image: var(--panel-sheen); box-shadow: var(--panel-edge), var(--panel-shadow); }
`;

// The timeline plumbing moved into the package (src/drive.ts, 27.10.2026: the tower and the home icon are in the app
// now); the gallery pages keep importing it from here.
export { applyStyle, CssFade, Driver, freezeAt, LAYER_CSS } from '../../src/drive';
