/**
 * «Помпон в списке» (31.10, GALLERY-ONLY prototype) — a static mock of an OPENED wishlist, as the owner sees it
 * (apps/web: lists/OwnerListScreen.tsx → wishes/OwnerWishlist.tsx + WishGrid.tsx, wishes.css, selection/): the glass
 * top bar ("‹ Listen", ⋯), the list's icon tile + date chip, the title, its facts, "Deine Wünsche" with "+ Wunsch",
 * the STATIC secret line, the 2-column grid of square tiles (a product photo = a simple shape on the white plate, the
 * shop letter, the heart, title, price, the 44 px ⋯), "Erhalten (1)" and the tab bar. Owner data only: nothing here
 * knows or shows reservations.
 *
 * Tokens = the app's (styles/tokens.css, tiles.css; light + dark). The mock is plain DOM: the moments move its tiles
 * with the same Tracks as Pompon (one timeline per moment).
 */

export type Theme = 'light' | 'dark';
export type Place = 'a' | 'b' | 'empty';

export interface Wish {
  id: string;
  title: string;
  price: string;
  art: keyof typeof ART;
  shop?: string;
  /** no photo: the shop letter on its tint (tiles.css) */
  tint?: 1 | 2 | 3 | 4;
}

/** Simple product "photos" (viewBox 0 0 100 100): flat shapes, two or three colours, no detail. */
export const ART = {
  headphones: `<path d="M27 60V49a23 23 0 0 1 46 0v11" fill="none" stroke="#3B3F4A" stroke-width="6" stroke-linecap="round"/><rect x="18" y="52" width="17" height="27" rx="8" fill="#4A4F5C"/><rect x="65" y="52" width="17" height="27" rx="8" fill="#4A4F5C"/><rect x="22" y="57" width="6" height="17" rx="3" fill="#717888"/><rect x="72" y="57" width="6" height="17" rx="3" fill="#717888"/>`,
  book: `<rect x="31" y="19" width="40" height="62" rx="3" fill="#2F5DA8"/><rect x="31" y="19" width="7" height="62" rx="2" fill="#244A86"/><circle cx="56" cy="43" r="7.5" fill="#F5C443"/><rect x="44" y="63" width="22" height="3.4" rx="1.7" fill="#DCE6F5"/><rect x="47" y="69" width="16" height="3" rx="1.5" fill="#B9CBEA"/>`,
  sneaker: `<path d="M15 67c2-10 12-15 21-17l12-10c4-3 9-1 10 3l2 7c11 2 21 6 25 15v5H15z" fill="#E86A5A"/><rect x="13" y="69" width="74" height="9" rx="4.5" fill="#F4F1EC" stroke="#D8D1C6" stroke-width="1.2"/><path d="M40 53l6 5M45 48l6 5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
  plant: `<path d="M50 60C40 50 29 46 25 33c13 0 21 8 25 19z" fill="#3E8E5A"/><path d="M50 59c8-14 18-20 27-30 2 15-10 25-27 30z" fill="#4FA56A"/><path d="M50 58c-2-14 0-28 4-38 6 12 4 26-4 38z" fill="#357D4E"/><rect x="33" y="57" width="34" height="7" rx="2.5" fill="#B5643F"/><path d="M36 63h28l-4 19H40z" fill="#C9744E"/>`,
  mug: `<path d="M64 47h5a8.5 8.5 0 0 1 0 17h-5" fill="none" stroke="#86B3C6" stroke-width="5.5"/><rect x="29" y="35" width="36" height="43" rx="7" fill="#8FB8C9"/><path d="M29 47h36" stroke="#6E9AAE" stroke-width="3.2"/>`,
  game: `<rect x="21" y="29" width="58" height="46" rx="5" fill="#2E5E8E"/><rect x="21" y="29" width="58" height="46" rx="5" fill="none" stroke="#244C74" stroke-width="2"/><rect x="31" y="39" width="11" height="11" rx="2" fill="#F2C14E"/><rect x="45" y="39" width="11" height="11" rx="2" fill="#E46B5A"/><rect x="59" y="39" width="11" height="11" rx="2" fill="#6FC1D6"/><rect x="38" y="54" width="11" height="11" rx="2" fill="#F4F1EC"/><rect x="52" y="54" width="11" height="11" rx="2" fill="#F2C14E"/>`,
  camera: `<rect x="23" y="33" width="54" height="42" rx="9" fill="#F1EEE8" stroke="#CFC7BA" stroke-width="1.6"/><path d="M23 64h54" stroke="#E2574C" stroke-width="2.4"/><path d="M23 67.5h54" stroke="#F2B441" stroke-width="2.4"/><circle cx="50" cy="52" r="12" fill="#3A3D45"/><circle cx="50" cy="52" r="6" fill="#5D6676"/><rect x="29" y="38" width="10" height="6" rx="2" fill="#3A3D45"/>`,
  none: '',
} as const;

export const WISHES: readonly Wish[] = [
  { id: 'w1', title: 'Kopfhörer mit Noise Cancelling', price: '≈ 329 €', art: 'headphones', shop: 'S' },
  { id: 'w2', title: 'Der kleine Prinz, gebunden', price: '≈ 18 €', art: 'book', shop: 'T' },
  { id: 'w3', title: 'Laufschuhe, Größe 43', price: '≈ 120 €', art: 'sneaker', shop: 'Z' },
  { id: 'w4', title: 'Monstera im Topf', price: '≈ 35 €', art: 'plant', shop: 'P' },
  { id: 'w5', title: 'Keramiktasse, handgemacht', price: '≈ 24 €', art: 'mug', shop: 'E' },
  { id: 'w6', title: 'Brettspiel „Azul“', price: '≈ 39 €', art: 'none', shop: 'S', tint: 3 },
];
export const NEW_WISH: Wish = { id: 'w7', title: 'Sofortbildkamera', price: '≈ 99 €', art: 'camera', shop: 'O' };

export const PHONE_W = 390;
export const PHONE_H = 800;
/** the tab bar capsule (the app: bottom 16, left / right 12, 62 px) */
export const TAB = { top: PHONE_H - 16 - 62, h: 62 } as const;

export const MOCK_CSS = `
.lpp { --p-bg: #F2EBDD; --p-surface: #FFFDF8; --p-text: #2A231C; --p-text2: #62554A; --p-accent: #EE9443; --p-accent-text: #984A14;
  --p-fill: rgba(116,84,44,.07); --p-fill2: rgba(116,84,44,.11); --p-line: rgba(116,84,44,.15); --p-plate: #fff;
  --p-panel: rgba(255,253,248,.82); --p-edge: inset 0 0 0 1px rgba(255,255,255,.75); --p-shadow: 0 8px 22px -10px rgba(80,50,22,.22), 0 1px 2px rgba(80,50,22,.06);
  --p-tab: rgba(255,253,248,.86); --p-ok: #2D7146; --p-ok-bg: #E5F0E2; --p-tile1: #FCE5C9; --p-tile1-fg: #984A14; --p-tile3: #E3E6F1; --p-tile3-fg: #48557F;
  --mascot-shadow: rgba(70,40,15,.20); --mascot-outline: rgba(224,171,116,.5); --lp-dust: #E3CDB0;
  position: relative; width: ${PHONE_W}px; height: ${PHONE_H}px; border-radius: 46px; overflow: hidden; background: var(--p-bg); color: var(--p-text); flex: none;
  box-shadow: 0 0 0 9px #1D1D1F, 0 26px 60px rgba(40,25,10,.28); font: 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
  -webkit-tap-highlight-color: transparent; contain: layout paint; }
.lpp.dark { --p-bg: #17120F; --p-surface: #2A221D; --p-text: #F5EDE3; --p-text2: #C3B5A6; --p-accent-text: #F2A25A; --p-fill: rgba(255,230,205,.075); --p-fill2: rgba(255,230,205,.115);
  --p-line: rgba(255,230,205,.13); --p-plate: #2B231D; --p-panel: rgba(42,34,29,.86); --p-edge: inset 0 0 0 1px rgba(255,236,214,.08); --p-shadow: 0 8px 22px -10px rgba(0,0,0,.6);
  --p-tab: rgba(42,34,29,.9); --p-ok: #7ED39A; --p-ok-bg: #17311F; --p-tile1: #3A2A1C; --p-tile1-fg: #F3B676; --p-tile3: #23283A; --p-tile3-fg: #B9C3E6;
  --mascot-shadow: rgba(0,0,0,.42); --mascot-outline: rgba(255,214,170,.2); --lp-dust: #6B5A4A; }
.lpp-screen { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: none; }
.lpp-screen::-webkit-scrollbar { display: none; }
.lpp-content { position: relative; padding: 104px 16px 0; }
.lpp-tint { position: absolute; left: 0; right: 0; top: 0; height: 360px; pointer-events: none;
  background: radial-gradient(120% 70% at 30% 0%, rgba(243,182,118,.32), transparent 70%); }
.lpp.dark .lpp-tint { background: radial-gradient(120% 70% at 30% 0%, rgba(243,182,118,.12), transparent 70%); }
.lpp-top { position: absolute; left: 0; right: 0; top: 0; height: 96px; z-index: 10; pointer-events: none;
  background: linear-gradient(var(--p-bg) 40%, color-mix(in srgb, var(--p-bg) 0%, transparent)); }
.lpp-status { position: absolute; left: 30px; top: 16px; font: 600 15px/1 -apple-system, "Segoe UI", system-ui, sans-serif; }
.lpp-bar { position: absolute; left: 12px; right: 12px; top: 44px; height: 44px; display: flex; align-items: center; justify-content: space-between; pointer-events: auto; }
.lpp-pill { height: 44px; min-width: 44px; padding: 0 14px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--p-accent-text);
  background: var(--p-panel); box-shadow: var(--p-edge), var(--p-shadow); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); border: 0; font-size: 15px; }
.lpp-pill.round { padding: 0; justify-content: center; color: var(--p-text); font-size: 20px; letter-spacing: 1px; }
.lpp-head { position: relative; display: flex; flex-direction: column; gap: 8px; }
.lpp-row { position: relative; display: flex; align-items: center; gap: 12px; height: 56px; }
.lpp-tile { width: 56px; height: 56px; border-radius: 16px; background: var(--p-tile1); color: var(--p-tile1-fg); display: grid; place-items: center; flex: none; }
.lpp-chip { height: 30px; padding: 0 12px; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; background: var(--p-fill2); color: var(--p-text); }
.lpp-chip.accent { background: color-mix(in srgb, var(--p-accent) 18%, transparent); color: var(--p-accent-text); }
.lpp-head h1 { margin: 4px 0 0; font-size: 34px; line-height: 1.1; letter-spacing: -.02em; font-weight: 800; }
.lpp-facts { display: flex; gap: 8px; flex-wrap: wrap; }
.lpp-sec { margin-top: 24px; display: flex; flex-direction: column; gap: 4px; }
.lpp-sec-row { display: flex; min-height: 44px; align-items: center; justify-content: space-between; gap: 12px; }
.lpp-sec-row h2 { margin: 0; font-size: 22px; line-height: 1.2; font-weight: 700; letter-spacing: -.01em; }
.lpp-add { height: 44px; padding: 0 16px; border: 0; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px; font: 600 15px/1 inherit;
  background: color-mix(in srgb, var(--p-accent) 16%, var(--p-surface)); color: var(--p-accent-text); box-shadow: var(--p-edge); cursor: pointer; }
.lpp-add:active, .lpp-big:active { transform: scale(.96); }
.lpp-hint { margin: 0 0 12px; font-size: 13px; line-height: 18px; color: var(--p-text2); }
.lpp-grid { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
.lpc { position: relative; display: flex; min-width: 0; }
.lpc-card { position: relative; display: flex; flex-direction: column; width: 100%; border-radius: 22px; background: var(--p-panel); box-shadow: var(--p-edge), var(--p-shadow); }
.lpc-open { display: flex; flex-direction: column; width: 100%; padding: 6px 6px 0; border: 0; background: none; color: inherit; text-align: left; font: inherit; border-radius: inherit; cursor: pointer; }
.lpc-media { position: relative; display: block; width: 100%; aspect-ratio: 1 / 1; border-radius: 16px; overflow: hidden; background: var(--p-plate);
  box-shadow: inset 0 0 0 .5px rgba(80,50,22,.1); }
.lpc-media svg { position: absolute; inset: 9%; width: 82%; height: 82%; }
.lpc-media.tint3 { background: var(--p-tile3); color: var(--p-tile3-fg); display: grid; place-items: center; }
.lpc-letter { font-size: 44px; font-weight: 800; letter-spacing: -.02em; }
.lpc-shop { position: absolute; left: 8px; bottom: 8px; width: 22px; height: 22px; border-radius: 7px; background: var(--p-tile1); color: var(--p-tile1-fg); display: grid; place-items: center;
  font-size: 12px; font-weight: 800; box-shadow: 0 0 0 2px #fff, 0 2px 6px -2px rgba(80,50,22,.35); }
.lpc-heart { position: absolute; right: 8px; bottom: 8px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
  background: color-mix(in oklab, var(--p-surface) 84%, transparent); box-shadow: 0 2px 8px -4px rgba(80,50,22,.35); }
.lpc-text { display: flex; flex-direction: column; gap: 4px; padding: 8px 6px 10px; min-width: 0; }
.lpc-title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; font-size: 15px; line-height: 20px; font-weight: 600; min-height: 40px; }
.lpc-price { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--p-text2); }
.lpc-more { position: absolute; top: 4px; right: 4px; z-index: 2; width: 44px; height: 44px; border: 0; background: none; border-radius: 50%; display: grid; place-items: center; color: var(--p-text); cursor: pointer; padding: 0; }
.lpc-more::before { content: ""; position: absolute; inset: 7px; border-radius: 50%; background: color-mix(in oklab, var(--p-surface) 84%, transparent);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.6), 0 2px 8px -4px rgba(80,50,22,.35); }
.lpc-more i { position: relative; font-style: normal; font-size: 16px; letter-spacing: 1px; line-height: 1; transform: translateY(-3px); }
.lpc-badge { position: absolute; left: 14px; top: 14px; z-index: 1; height: 24px; padding: 0 8px 0 6px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 700; color: var(--p-ok); background: var(--p-ok-bg); box-shadow: 0 1px 4px -2px rgba(80,50,22,.3); opacity: 0; pointer-events: none; }
.lpc-seal { position: absolute; z-index: 1; width: 46px; height: 46px; margin: -23px 0 0 -23px; opacity: 0; pointer-events: none; }
.lpc-ring { position: absolute; inset: 0; z-index: 1; border-radius: inherit; pointer-events: none; box-shadow: inset 0 0 0 2.5px var(--p-accent); opacity: 0; transition: opacity .15s; }
.lpc-sel { position: absolute; left: 14px; top: 14px; z-index: 1; width: 26px; height: 26px; border-radius: 50%; display: none; place-items: center;
  background: color-mix(in oklab, var(--p-surface) 70%, transparent); box-shadow: inset 0 0 0 2px #fff, 0 1px 5px -2px rgba(80,50,22,.45); color: #fff; font-size: 14px; font-weight: 800; }
.lpp[data-selecting] .lpc-sel { display: grid; }
.lpc[data-on] .lpc-sel { background: var(--p-accent); }
.lpc[data-on] .lpc-ring { opacity: 1; }
.lpp[data-selecting] .lpc-more { visibility: hidden; }
/* selection mode: the app's own wobble (selection/selectTile.css: the rotate property, out of step) */
@keyframes lpc-jiggle { 0% { rotate: -0.9deg; } 50% { rotate: 0.9deg; } 100% { rotate: -0.9deg; } }
.lpp[data-selecting="jiggle"] .lpc > .lpc-card { animation: lpc-jiggle .32s ease-in-out infinite; }
.lpp[data-selecting="jiggle"] .lpc:nth-child(2n) > .lpc-card { animation-duration: .36s; animation-delay: -.11s; }
.lpp[data-selecting="jiggle"] .lpc:nth-child(3n) > .lpc-card { animation-delay: -.21s; }
.lpp[data-frozen] .lpc > .lpc-card { animation-play-state: paused !important; }
.lpp[data-selecting="calm"] .lpc-ring { opacity: .45; }
.lpp-received { margin-top: 16px; width: 100%; min-height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 16px; border: 0; border-radius: 18px;
  background: var(--p-fill); color: var(--p-text); font: 600 17px/1.2 inherit; }
.lpp-received .ck { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--p-ok-bg); color: var(--p-ok); font-size: 14px; flex: none; }
.lpp-received .lbl { flex: 1; text-align: left; }
.lpp-received .cnt { position: relative; min-width: 26px; height: 26px; border-radius: 999px; background: var(--p-surface); font-size: 13px; font-weight: 700; color: var(--p-text2); display: inline-grid; place-items: center; }
.lpp-received .cnt b { grid-area: 1 / 1; font-weight: 700; }
.lpp-end { position: relative; height: 128px; }
.lpp-end .floor { position: absolute; left: 50%; bottom: 40px; width: 120px; margin-left: -60px; height: 2px; border-radius: 2px; background: var(--p-line); opacity: .7; }
.lpp-spacer { height: 96px; }
.lpp-tabs { position: absolute; left: 12px; right: 12px; top: ${TAB.top}px; height: ${TAB.h}px; z-index: 10; border-radius: 31px; display: flex; align-items: center; justify-content: space-around;
  background: var(--p-tab); box-shadow: inset 0 0 0 1px rgba(255,255,255,.5), 0 10px 30px rgba(0,0,0,.16); -webkit-backdrop-filter: blur(20px) saturate(1.3); backdrop-filter: blur(20px) saturate(1.3);
  font: 600 11px/1 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--p-text2); }
.lpp.dark .lpp-tabs { box-shadow: inset 0 0 0 1px rgba(255,236,214,.08), 0 10px 30px rgba(0,0,0,.4); }
.lpp-tabs span { display: grid; justify-items: center; gap: 4px; min-width: 44px; }
.lpp-tabs span i { width: 22px; height: 22px; border-radius: 7px; background: currentColor; opacity: .32; display: block; }
.lpp-tabs .on { color: var(--p-accent-text); }
.lpp-tabs .on i { opacity: .85; }
.lpp-tabs .plus { width: 52px; height: 52px; border-radius: 50%; background: var(--p-accent); color: #2A1A0B; display: grid; place-items: center; font-size: 30px; font-weight: 400; }
.lpp-over { position: absolute; inset: 0; z-index: 6; pointer-events: none; overflow: hidden; }
.lpp-content .lp-actor { z-index: 4; }
/* selection bars (selection/selectionChrome.css: a glass capsule at the bottom, over the tab bar) */
.lpp-selbar { position: absolute; left: 16px; right: 16px; top: ${TAB.top - 1}px; height: 64px; z-index: 12; border-radius: 999px; display: none; align-items: stretch; justify-content: space-around; padding: 4px;
  background: var(--p-tab); box-shadow: inset 0 0 0 1px rgba(255,255,255,.5), 0 10px 30px rgba(0,0,0,.18); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); }
.lpp[data-selecting] .lpp-selbar { display: flex; }
.lpp-selbar button { flex: 1; min-width: 44px; min-height: 44px; border: 0; background: none; border-radius: 999px; color: var(--p-accent-text); font: 600 12px/1.2 inherit; cursor: pointer; display: grid; place-items: center; gap: 2px; }
.lpp-selbar button b { font-size: 18px; line-height: 1; }
.lpp-selbar button.danger { color: #C2410C; }
.lpp-seltop { position: absolute; left: 12px; right: 12px; top: 44px; height: 44px; z-index: 12; display: none; align-items: center; justify-content: space-between; }
.lpp[data-selecting] .lpp-seltop { display: flex; }
.lpp[data-selecting] .lpp-bar { visibility: hidden; }
/* the action capsule replaces the tab bar meanwhile (no tab icons showing through its glass) */
.lpp-tabs { transition: opacity .2s; }
.lpp[data-selecting] .lpp-tabs { opacity: 0; pointer-events: none; }
.lpp-seltop b { font-size: 15px; }
/* the ⋯ sheet and the toast */
.lpp-dim { position: absolute; inset: 0; z-index: 14; background: rgba(10,8,6,.32); opacity: 0; pointer-events: none; transition: opacity .2s; }
.lpp-sheet { position: absolute; left: 10px; right: 10px; bottom: 12px; z-index: 15; border-radius: 28px; padding: 16px 12px 12px; background: var(--p-surface); box-shadow: 0 -6px 30px rgba(0,0,0,.18);
  transform: translateY(110%); transition: transform .32s cubic-bezier(.2,.8,.2,1); }
.lpp[data-sheet] .lpp-dim { opacity: 1; pointer-events: auto; }
.lpp[data-sheet] .lpp-sheet { transform: none; }
.lpp-sheet h5 { margin: 0 6px 10px; font-size: 17px; }
.lpp-sheet button { display: flex; width: 100%; min-height: 52px; align-items: center; padding: 0 14px; margin-bottom: 8px; border: 0; border-radius: 16px; background: var(--p-fill); color: var(--p-text); font: 600 16px/1 inherit; cursor: pointer; }
.lpp-sheet button.danger { color: #C2410C; }
.lpp-sheet button.quiet { background: none; justify-content: center; color: var(--p-text2); margin: 0; }
.lpp-toast { position: absolute; left: 50%; top: ${TAB.top - 58}px; z-index: 13; transform: translate(-50%, 8px); opacity: 0; padding: 11px 16px; border-radius: 999px; white-space: nowrap;
  background: var(--p-panel); box-shadow: var(--p-edge), 0 8px 24px rgba(0,0,0,.16); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); font-size: 14px; font-weight: 600;
  transition: opacity .2s, transform .25s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
.lpp-toast.on { opacity: 1; transform: translate(-50%, 0); }
/* the speech bubble ("Das war’s!") and the ghost finger of the played moments */
.lpp-bubble { position: absolute; left: 0; top: 0; z-index: 5; padding: 7px 12px; border-radius: 16px; white-space: nowrap; pointer-events: none; opacity: 0; transform-origin: 0 100%;
  background: var(--p-panel); box-shadow: var(--p-edge), 0 6px 18px -6px rgba(0,0,0,.25); font-size: 14px; font-weight: 700; }
.lpp-finger { position: absolute; left: 0; top: 0; z-index: 7; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; pointer-events: none; opacity: 0;
  background: radial-gradient(circle, rgba(255,255,255,.78) 0 34%, rgba(255,255,255,.32) 58%, rgba(255,255,255,0) 72%); box-shadow: 0 0 0 1.2px rgba(80,50,22,.22); }
/* the empty list (OwnerWishlist EmptyState): Pompon lies in an open gift box */
.lpp-empty { position: relative; margin-top: 8px; padding: 0 18px 20px; border-radius: 26px; background: var(--p-panel); box-shadow: var(--p-edge), var(--p-shadow); text-align: center; }
.lpp-empty .seat { position: relative; height: 150px; }
.lpp-empty h3 { margin: 0 0 6px; font-size: 20px; }
.lpp-empty p { margin: 0 0 16px; color: var(--p-text2); font-size: 14px; line-height: 1.4; }
.lpp-big { width: 100%; height: 50px; border: 0; border-radius: 999px; background: var(--p-accent); color: #2A1A0B; font: 700 16px/1 inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.lpp-boxlayer { position: absolute; left: 0; top: 0; width: 180px; height: 110px; pointer-events: none; }
.lpp.dark .lpp-boxlayer svg { filter: brightness(.84) saturate(.92); }
.lpp-boxlayer svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
`;

const ICON_GIFT = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>';
const HEART = '<svg width="14" height="13" viewBox="0 0 24 22"><path d="M12 21C5 15 1 11 1 6.5 1 3.4 3.4 1 6.5 1c2.1 0 4.1 1.2 5.5 3 1.4-1.8 3.4-3 5.5-3C20.6 1 23 3.4 23 6.5 23 11 19 15 12 21Z" fill="#EE9443"/></svg>';
/** the paw stamp's mark: a green ✓ in a round, slightly uneven ink ring */
export const SEAL_SVG = '<svg viewBox="-23 -23 46 46" width="46" height="46" aria-hidden="true"><circle r="19" fill="rgba(59,152,94,.12)" stroke="#3B985E" stroke-width="2.6" stroke-dasharray="20 2.4 9 1.8"/><path d="M-9 0.5l6 6 12-13" fill="none" stroke="#3B985E" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function cardMarkup(w: Wish): string {
  const media = w.art === 'none'
    ? `<span class="lpc-media tint${w.tint ?? 3}"><span class="lpc-letter">${w.shop ?? '·'}</span><span class="lpc-heart">${HEART}</span></span>`
    : `<span class="lpc-media"><svg viewBox="0 0 100 100" aria-hidden="true">${ART[w.art]}</svg>${w.shop ? `<span class="lpc-shop">${w.shop}</span>` : ''}<span class="lpc-heart">${HEART}</span></span>`;
  return `<div class="lpc-card"><span class="lpc-ring"></span><button type="button" class="lpc-open">${media}<span class="lpc-text"><span class="lpc-title">${w.title}</span><span class="lpc-price">${w.price}</span></span></button>
    <button type="button" class="lpc-more" aria-label="Mehr zu „${w.title}“" aria-haspopup="dialog"><i>•••</i></button>
    <span class="lpc-badge">✓ Erhalten</span><span class="lpc-seal">${SEAL_SVG}</span><span class="lpc-sel" aria-hidden="true">✓</span></div>`;
}

export function cardEl(w: Wish): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'lpc';
  li.dataset.id = w.id;
  li.innerHTML = cardMarkup(w);
  return li;
}

/** What the moments and the live mode need from one phone. */
export interface PhoneRefs {
  readonly place: Place;
  readonly phone: HTMLElement;
  readonly screen: HTMLElement;
  readonly content: HTMLElement;
  /** where Pompon's box lives: the content (scrolls with the list) or, B, the fixed overlay */
  readonly layer: HTMLElement;
  readonly grid: HTMLElement | null;
  readonly seatRow: HTMLElement | null;
  readonly addBtn: HTMLElement | null;
  readonly endSpot: HTMLElement | null;
  readonly received: HTMLElement | null;
  readonly countOld: HTMLElement | null;
  readonly countNew: HTMLElement | null;
  readonly emptySeat: HTMLElement | null;
  readonly bigAdd: HTMLElement | null;
  readonly bubble: HTMLElement;
  readonly finger: HTMLElement;
  readonly toast: HTMLElement;
  readonly sheet: HTMLElement;
  cards(): HTMLElement[];
  card(id: string): HTMLElement | null;
}

const TABS = '<nav class="lpp-tabs" aria-label="Tabs"><span><i></i>Start</span><span class="on"><i></i>Listen</span><span class="plus" aria-hidden="true">+</span><span><i></i>Ideen</span><span><i></i>Profil</span></nav>';

export function buildPhone(parent: HTMLElement, o: { place: Place; theme: Theme; wishes?: readonly Wish[] }): PhoneRefs {
  const phone = document.createElement('div');
  phone.className = `lpp${o.theme === 'dark' ? ' dark' : ''}`;
  phone.dataset.place = o.place;
  const empty = o.place === 'empty';
  const wishes = o.wishes ?? WISHES;
  const head = `<div class="lpp-head"><div class="lpp-row" data-seat-row><span class="lpp-tile">${ICON_GIFT}</span><span class="lpp-chip accent">in 23 Tagen</span></div>
      <h1>Geburtstag 2026</h1><div class="lpp-facts"><span class="lpp-chip">${empty ? 'Noch leer' : `${wishes.length + 1} Wünsche`}</span><span class="lpp-chip">Meine Follower</span></div></div>`;
  const section = empty
    ? `<section class="lpp-sec"><div class="lpp-sec-row"><h2>Deine Wünsche</h2></div>
        <div class="lpp-empty"><div class="seat" data-empty-seat></div><h3>Noch keine Wünsche</h3><p>Füg deinen ersten Wunsch hinzu – dann wissen deine Follower, was dich freut</p>
        <button type="button" class="lpp-big" data-big-add><span style="font-size:22px;line-height:1">+</span> Wunsch hinzufügen</button></div></section>
        <div class="lpp-spacer" style="height:240px"></div>`
    : `<section class="lpp-sec"><div class="lpp-sec-row"><h2>Deine Wünsche</h2><button type="button" class="lpp-add" data-add aria-label="Wunsch hinzufügen"><span style="font-size:20px;line-height:1">+</span> Wunsch</button></div>
        <p class="lpp-hint">Deine Follower sehen die Liste und sprechen sich heimlich ab. Du siehst davon nichts – so soll es sein.</p>
        <ul class="lpp-grid"></ul>
        <button type="button" class="lpp-received" aria-label="Erhalten, 1 Wunsch"><span class="ck">✓</span><span class="lbl">Erhalten</span><span class="cnt" aria-hidden="true"><b data-count-old>1</b><b data-count-new style="opacity:0">2</b></span><span aria-hidden="true" style="color:var(--p-text2)">›</span></button>
        <div class="lpp-end" data-end></div></section>
        <div class="lpp-spacer"></div>`;
  phone.innerHTML = `<div class="lpp-screen"><div class="lpp-content"><div class="lpp-tint"></div>${head}${section}</div></div>
    <div class="lpp-over"></div>
    <header class="lpp-top"><span class="lpp-status">9:41</span><div class="lpp-bar"><span class="lpp-pill">‹ Listen</span><button type="button" class="lpp-pill round" aria-label="Liste: mehr">•••</button></div></header>
    <div class="lpp-seltop"><span class="lpp-pill" data-sel-all>Alle</span><b data-sel-count>1 ausgewählt</b><span class="lpp-pill" data-sel-done>Fertig</span></div>
    ${TABS}
    <div class="lpp-selbar" role="toolbar" aria-label="Aktionen für die ausgewählten Wünsche"><button type="button" data-sel-move><b>⇢</b>Verschieben</button><button type="button" data-sel-received><b>✓</b>Erhalten</button><button type="button" class="danger" data-sel-delete><b>🗑</b>Löschen</button></div>
    <div class="lpp-toast" role="status"></div>
    <div class="lpp-dim"></div>
    <div class="lpp-sheet" role="dialog" aria-modal="true"><h5></h5><button type="button" data-act="received">Als erhalten markieren</button><button type="button" data-act="select">Mehrere auswählen</button><button type="button" class="danger" data-act="delete">Löschen</button><button type="button" class="quiet" data-act="cancel">Abbrechen</button></div>`;
  parent.append(phone);
  const $ = <T extends HTMLElement>(sel: string): T | null => phone.querySelector<T>(sel);
  const screen = $('.lpp-screen');
  const content = $('.lpp-content');
  const over = $('.lpp-over');
  if (!screen || !content || !over) throw new Error('[listplay] phone markup');
  const grid = $('.lpp-grid');
  if (grid) for (const w of wishes) grid.append(cardEl(w));
  const bubble = document.createElement('div');
  bubble.className = 'lpp-bubble';
  bubble.setAttribute('aria-hidden', 'true');
  const finger = document.createElement('div');
  finger.className = 'lpp-finger';
  finger.setAttribute('aria-hidden', 'true');
  const layer = o.place === 'b' ? over : content;
  layer.append(bubble, finger);
  const refs: PhoneRefs = {
    place: o.place,
    phone,
    screen,
    content,
    layer,
    grid,
    seatRow: $('[data-seat-row]'),
    addBtn: $('[data-add]'),
    endSpot: $('[data-end]'),
    received: $('.lpp-received'),
    countOld: $('[data-count-old]'),
    countNew: $('[data-count-new]'),
    emptySeat: $('[data-empty-seat]'),
    bigAdd: $('[data-big-add]'),
    bubble,
    finger,
    toast: $('.lpp-toast') ?? bubble,
    sheet: $('.lpp-sheet') ?? bubble,
    cards: () => (grid ? [...grid.querySelectorAll<HTMLElement>(':scope > .lpc')] : []),
    card: (id) => grid?.querySelector<HTMLElement>(`:scope > .lpc[data-id="${id}"]`) ?? null,
  };
  return refs;
}

/** `el`'s box in px of `layer` (its padding box: what an absolutely positioned child of `layer` sees). */
export function rectIn(el: Element, layer: HTMLElement): { x: number; y: number; w: number; h: number } {
  const a = el.getBoundingClientRect();
  const b = layer.getBoundingClientRect();
  return { x: a.left - b.left - layer.clientLeft, y: a.top - b.top - layer.clientTop, w: a.width, h: a.height };
}

/** Shows the toast for a moment (the app's toasts; plain CSS transition). */
export function toast(refs: PhoneRefs, text: string, ms = 1800): void {
  const t = refs.toast;
  t.textContent = text;
  t.classList.add('on');
  const prev = Number(t.dataset.timer ?? 0);
  if (prev) clearTimeout(prev);
  t.dataset.timer = String(window.setTimeout(() => t.classList.remove('on'), ms));
}
