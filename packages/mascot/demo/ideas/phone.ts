/**
 * The phone mocks of the "Ideen → Kategorien" prototype (26.10, GALLERY-ONLY), 390 px like an iPhone, Paper light and
 * "Paper at night" (tokens copied from apps/web/src/styles/tokens.css, tiles.css and features/gifts/gifts.css — the
 * gallery cannot import the app's CSS):
 *   1. the "Ideen" tab scrolled below the deck: the new row of category tiles («Stöbern nach Thema»);
 *   2. the "Brettspiele" screen: header scene (the die moment, motion.ts), three filter pills, a 2-column grid;
 *   3. one game opened: the sheet with its facts, shops and «Zur Wunschliste hinzufügen».
 * German strings as the app would show them; glass only on bars and the sheet (never under the lists).
 */

import { categoryArt, CATEGORY_TONE, headerScene, motifArt } from './art';
import { CATEGORIES, DRAFT_COUNT, DRAFT_PRICE_SPAN, CATALOG_GAMES, FILTER_LABELS, offerLabel, priceLabel, span, type Filters, type GameCard } from './games';

export type Theme = 'light' | 'dark';

const LIGHT_EXTRA = `--fill-2: rgba(116,84,44,.11); --surface-2: #FAF5EC; --thumb: #FFFDF8; --accent-100: #FCE5C9; --accent-200: #F8D0A2;
  --tile-1: #FCE5C9; --tile-1-fg: #984A14; --tile-2: #F8E0D8; --tile-2-fg: #8C4757; --tile-3: #E3E6F1; --tile-3-fg: #48557F; --tile-4: #F7EDC9; --tile-4-fg: #76580F;
  --ok-text: #2D7146; --ok-bg: #E5F0E2; --scrim: rgba(42,35,28,.18); --sheet-bg: #FFFDF8;
  --card-shadow: 0 1px 2px rgba(80,50,22,.06), 0 6px 18px -10px rgba(92,56,24,.28);
  --photo-plate: #fff; --photo-rim: transparent; --credit-bg: rgb(255 255 255 / .82); --credit-ink: #5f554b;
  --g-shadow: rgb(42 35 28 / .13); --g-shadow-strong: rgb(42 35 28 / .2); --g-card: #FFFDF8; --g-card-rim: rgba(116,84,44,.16); --g-die: #FFFDF8; --g-die-rim: rgba(116,84,44,.24);`;
const DARK_EXTRA = `--fill-2: rgba(255,230,205,.115); --surface-2: #332A23; --thumb: #4B3E34; --accent-100: #3D2A1A; --accent-200: #553A22;
  --tile-1: #3A2A1C; --tile-1-fg: #F3B676; --tile-2: #3A2424; --tile-2-fg: #F0B3BE; --tile-3: #23283A; --tile-3-fg: #B9C3E6; --tile-4: #353016; --tile-4-fg: #E9D38D;
  --ok-text: #7ED39A; --ok-bg: #17311F; --scrim: rgba(6,4,2,.5); --sheet-bg: #2A221D;
  --card-shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 18px -10px rgba(0,0,0,.6);
  --photo-plate: #2B231D; --photo-rim: rgba(255,236,214,.08); --credit-bg: rgb(23 18 15 / .88); --credit-ink: #C3B5A6;
  --g-shadow: rgb(0 0 0 / .32); --g-shadow-strong: rgb(0 0 0 / .42); --g-card: #EADFCF; --g-card-rim: rgba(0,0,0,.18); --g-die: #EFE5D8; --g-die-rim: rgba(0,0,0,.2);`;
/** The gift palette (gifts.css --gift-*): the same in both themes, like in the app. */
const PALETTE = `--g-charcoal: oklch(0.36 0.02 60); --g-cream: oklch(0.965 0.02 85); --g-wood: oklch(0.63 0.085 60); --g-wood-dark: oklch(0.5 0.075 52);
  --g-wood-light: oklch(0.8 0.07 72); --g-leaf: oklch(0.63 0.11 150); --g-leaf-dark: oklch(0.5 0.1 152); --g-leaf-light: oklch(0.77 0.1 142);
  --g-clay: oklch(0.69 0.11 45); --g-clay-dark: oklch(0.58 0.12 40); --g-sky: oklch(0.76 0.065 245); --g-sky-dark: oklch(0.56 0.075 258);
  --g-sky-light: oklch(0.9 0.03 240); --g-rose: oklch(0.77 0.085 15); --g-rose-dark: oklch(0.6 0.12 15); --g-butter: oklch(0.9 0.1 92);
  --g-butter-dark: oklch(0.79 0.13 82); --g-steel: oklch(0.84 0.008 80); --g-steel-dark: oklch(0.65 0.012 80); --g-accent: #DC7B2C;`;

export const PHONE_CSS = `
.ix-phone, .ix-tok { ${PALETTE} ${LIGHT_EXTRA} }
.ix-phone.dark, .ix-tok.dark { ${DARK_EXTRA} }
.ix-phone { width: 390px; height: 844px; font-size: 15px; line-height: 1.3; }
.ix-phone.tall { height: auto; min-height: 844px; }
.ix-phone svg { display: block; }
.ix-scroll { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; padding: 102px 16px 120px; box-sizing: border-box; }
.ix-phone.tall .ix-scroll { position: relative; overflow: visible; }
.ix-scroll::-webkit-scrollbar { display: none; }
.ix-status { position: absolute; z-index: 5; left: 0; right: 0; top: 0; height: 47px; display: flex; align-items: center; justify-content: space-between; padding: 0 30px; box-sizing: border-box; font-size: 15px; font-weight: 600; }
.ix-bar { position: absolute; z-index: 4; left: 0; right: 0; top: 0; height: 98px; box-sizing: border-box; padding: 47px 12px 0; display: flex; align-items: center; justify-content: space-between;
  background: var(--float-bg); -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5); box-shadow: inset 0 -1px 0 var(--separator); }
.ix-bar b { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); font-size: 17px; font-weight: 600; white-space: nowrap; }
.ix-pill { height: 44px; display: inline-flex; align-items: center; gap: 2px; padding: 0 16px 0 10px; border-radius: 999px; font-size: 17px; font-weight: 600; color: var(--accent-text); }
.ix-pill i { font-style: normal; font-size: 26px; line-height: 1; margin-top: -3px; }
.ix-tabs { position: absolute; z-index: 4; left: 16px; right: 16px; bottom: 26px; height: 62px; border-radius: 999px; display: grid; grid-template-columns: repeat(4, 1fr); align-items: center;
  background: var(--float-bg); -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5); box-shadow: inset 0 0 0 1px var(--separator), 0 8px 24px -10px rgba(60,35,15,.35); }
.ix-tabs span { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; font-weight: 600; color: var(--text-2); }
.ix-tabs span svg { width: 24px; height: 24px; }
.ix-tabs span.on { color: var(--accent-text); }
.ix-h2 { margin: 0; font-size: 22px; line-height: 28px; font-weight: 700; letter-spacing: -.02em; }
.ix-sub { margin: 2px 0 0; font-size: 13px; line-height: 18px; color: var(--text-2); }

/* --- 1. the Ideen tab below the deck --- */
.ix-deck { border-radius: 28px; background: var(--surface); box-shadow: var(--card-shadow); overflow: hidden; }
.ix-deck-pic { height: 92px; background: var(--tile-3); display: grid; place-items: end center; overflow: hidden; }
.ix-deck-pic svg { width: 220px; margin-bottom: -18px; }
.ix-deck-body { padding: 12px 16px 14px; }
.ix-deck-body h3 { margin: 0; font-size: 20px; line-height: 25px; font-weight: 600; }
.ix-deck-body p { margin: 2px 0 0; font-size: 15px; color: var(--text-2); }
.ix-deck-body p b { color: var(--accent-text); font-weight: 600; }
.ix-deck-acts { display: flex; gap: 8px; margin-top: 10px; }
.ix-deck-acts span { flex: 1; height: 44px; border-radius: 999px; display: grid; place-items: center; font-size: 15px; font-weight: 600; background: var(--fill); }
.ix-deck-acts span.acc { background: #EE9443; color: #2A1A0B; }
.ix-verdict { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: start; gap: 4px; margin: 14px 0 0; padding: 0 4px; }
.ix-verdict .undo { width: 36px; height: 36px; margin-top: 8px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); color: var(--text-2); font-size: 17px; }
.ix-verdict .pair { display: grid; grid-template-columns: 1fr 1fr; justify-items: center; gap: 8px; }
.ix-verdict .act { display: flex; flex-direction: column; align-items: center; gap: 5px; }
.ix-verdict .act i { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 24px; background: var(--surface); color: var(--text-2); box-shadow: var(--card-shadow); }
.ix-verdict .act.like i { background: #EE9443; color: #2A1A0B; }
.ix-verdict .act small { font-size: 12px; font-weight: 600; color: var(--text-2); white-space: nowrap; }
.ix-verdict .pos { padding-top: 17px; font-size: 12px; font-weight: 600; color: var(--text-2); white-space: nowrap; text-align: right; }
.ix-browse { margin: 28px -16px 0; }
.ix-browse-head { display: flex; align-items: flex-end; justify-content: space-between; padding: 0 16px; }
.ix-browse-head a { font-size: 15px; font-weight: 600; color: var(--accent-text); text-decoration: none; padding: 10px 0 2px 10px; }
.ix-row { display: flex; gap: 10px; overflow-x: auto; scrollbar-width: none; padding: 12px 16px 6px; scroll-snap-type: x mandatory; scroll-padding: 0 16px; }
.ix-row::-webkit-scrollbar { display: none; }
.ix-tile { position: relative; flex: none; width: 118px; scroll-snap-align: start; border: 0; padding: 0; text-align: left; background: none; color: inherit; font: inherit; cursor: pointer; }
.ix-tile .art { height: 92px; border-radius: 22px; display: grid; place-items: center; background: var(--tile-bg); overflow: hidden; box-shadow: inset 0 0 0 1px rgba(255,255,255,.04); }
.ix-tile .art svg { width: 108px; height: 81px; }
.ix-tile b { display: block; margin: 7px 4px 0; font-size: 15px; line-height: 19px; font-weight: 600; }
.ix-tile small { display: block; margin: 1px 4px 0; font-size: 13px; color: var(--text-2); }
.ix-tile .new { position: absolute; left: 8px; top: 8px; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; background: var(--surface); color: var(--accent-text); box-shadow: 0 1px 3px rgba(60,35,15,.16); }
.ix-tile:active .art { transform: scale(.96); transition: transform .28s cubic-bezier(.25,.8,.3,1); }
.ix-why { margin-top: 22px; border-radius: 28px; padding: 16px; }
.ix-why h3 { margin: 0; font-size: 17px; font-weight: 600; }
.ix-why p { margin: 4px 0 10px; font-size: 13px; color: var(--text-2); }

/* --- 2. the Brettspiele screen --- */
.ix-hero { position: relative; border-radius: 28px; overflow: hidden; background: linear-gradient(165deg, var(--tile-4) 0%, var(--tile-1) 100%); box-shadow: var(--card-shadow); }
.ix-hero .ix-scene { width: 100%; height: auto; margin-top: 6px; }
.ix-hero-text { padding: 2px 18px 16px; }
.ix-hero h1 { margin: 0; font-size: 28px; line-height: 34px; font-weight: 700; letter-spacing: -.02em; }
.ix-hero p { margin: 2px 0 0; font-size: 15px; line-height: 20px; color: var(--text-2); }
.ix-hero .meta { margin-top: 6px; font-size: 13px; color: var(--text-2); }
.ix-hero .meta b { color: var(--tile-4-fg); font-weight: 600; }
.ix-center { transform-box: fill-box; transform-origin: center; }
.ix-feet { transform-box: fill-box; transform-origin: 50% 100%; }
.ix-filters { display: flex; gap: 8px; margin: 16px -16px 0; padding: 0 16px; overflow-x: auto; scrollbar-width: none; }
.ix-filters::-webkit-scrollbar { display: none; }
.ix-filter { flex: none; height: 44px; padding: 0 14px 0 12px; border: 0; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px; font: 600 15px/1 inherit; cursor: pointer;
  background: var(--fill-2); color: var(--text); transition: background-color .28s, color .28s; }
.ix-filter svg { width: 18px; height: 18px; flex: none; }
.ix-filter .chev { font-size: 12px; opacity: .6; margin-left: 2px; }
.ix-filter[aria-pressed="true"] { background: var(--accent-100); color: var(--accent-text); }
.ix-filter:active { transform: scale(.96); }
.ix-count { margin: 12px 4px 0; font-size: 13px; color: var(--text-2); }
.ix-grid { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px 10px; }
.ix-grid > li[hidden] { display: none; }
.ix-card { position: relative; height: 100%; display: flex; flex-direction: column; border-radius: 22px; background: var(--surface); box-shadow: var(--card-shadow); overflow: hidden; cursor: pointer; }
.ix-card .art { position: relative; height: 112px; display: grid; place-items: center; background: var(--tile-bg); }
.ix-card .art svg { width: 150px; height: 103px; }
.ix-award { position: absolute; left: 8px; top: 8px; max-width: calc(100% - 16px); box-sizing: border-box; padding: 3px 8px 3px 6px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; line-height: 14px; font-weight: 700; background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(60,35,15,.16); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ix-award i { font-style: normal; color: #C9302C; }
.ix-card .body { flex: 1; display: flex; flex-direction: column; padding: 10px 12px 10px; }
.ix-card h3 { margin: 0; font-size: 15px; line-height: 19px; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 38px; }
.ix-facts { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 13px; line-height: 18px; color: var(--text-2); white-space: nowrap; }
.ix-facts span { display: inline-flex; align-items: center; gap: 3px; }
.ix-facts svg { width: 14px; height: 14px; }
.ix-buy { display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding-top: 6px; }
.ix-buy b { font-size: 15px; font-weight: 600; color: var(--accent-text); font-variant-numeric: tabular-nums; }
.ix-add { position: relative; width: 36px; height: 36px; margin: -4px -4px -4px 0; border: 0; border-radius: 999px; display: grid; place-items: center; cursor: pointer;
  background: var(--accent-100); color: var(--accent-text); font: 600 22px/1 inherit; transition: background-color .28s; }
.ix-add::after { content: ""; position: absolute; inset: -4px; }
.ix-add[aria-pressed="true"] { background: var(--ok-bg); color: var(--ok-text); }
.ix-add:active { transform: scale(.9); }
.ix-foot { margin: 18px 4px 0; font-size: 12px; line-height: 17px; color: var(--text-2); text-align: center; }

/* --- 3. one game opened --- */
.ix-scrim { position: absolute; inset: 0; z-index: 6; background: var(--scrim); }
.ix-sheet { position: absolute; z-index: 7; left: 8px; right: 8px; bottom: 8px; max-height: calc(100% - 132px); border-radius: 40px; padding: 8px 18px 18px; box-sizing: border-box; display: flex; flex-direction: column;
  background: var(--sheet-bg); -webkit-backdrop-filter: blur(24px) saturate(1.5); backdrop-filter: blur(24px) saturate(1.5); box-shadow: inset 0 0 0 1px var(--separator), 0 -10px 40px -12px rgba(40,25,10,.35); }
.ix-grab { width: 36px; height: 5px; border-radius: 3px; background: var(--fill-2); margin: 0 auto 10px; }
.ix-sheet .art { height: 150px; border-radius: 24px; display: grid; place-items: center; background: var(--tile-bg); }
.ix-sheet .art svg { width: 200px; height: 137px; }
.ix-sheet h2 { margin: 14px 2px 0; font-size: 22px; line-height: 27px; font-weight: 700; letter-spacing: -.01em; }
.ix-sheet .by { margin: 2px 2px 0; font-size: 13px; color: var(--text-2); }
.ix-sheet .by b { color: var(--text); font-weight: 600; }
.ix-sheet .blurb { margin: 10px 2px 0; font-size: 15px; line-height: 21px; }
.ix-factrow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
.ix-factrow span { border-radius: 16px; background: var(--fill); padding: 8px 10px; display: flex; flex-direction: column; gap: 1px; font-size: 12px; color: var(--text-2); }
.ix-factrow span b { font-size: 16px; color: var(--text); font-weight: 600; }
.ix-offers { list-style: none; margin: 12px 0 0; padding: 0; border-radius: 18px; background: var(--fill); }
.ix-offers li { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 0 14px; font-size: 15px; }
.ix-offers li + li { box-shadow: inset 0 1px 0 var(--separator); }
.ix-offers li span { flex: 1; font-weight: 600; }
.ix-offers li em { font-style: normal; color: var(--text-2); font-variant-numeric: tabular-nums; }
.ix-offers li i { font-style: normal; color: var(--accent-text); font-weight: 600; }
.ix-asof { margin: 6px 4px 0; font-size: 12px; color: var(--text-2); }
.ix-cta { margin-top: 16px; flex: none; height: 52px; border: 0; border-radius: 999px; display: flex; align-items: center; justify-content: center; gap: 6px; background: #EE9443; color: #2A1A0B; font: 600 17px/1 inherit; }
`;

const ICON = {
  people: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5" r="2.6" fill="currentColor"/><path d="M1.2 13.4c.4-2.6 2.3-4.2 4.8-4.2s4.4 1.6 4.8 4.2z" fill="currentColor"/><circle cx="11.6" cy="5.6" r="2.1" fill="currentColor" opacity=".6"/><path d="M11 9.4c2 .1 3.5 1.5 3.8 4h-3c-.1-1.6-.4-2.9-.8-4z" fill="currentColor" opacity=".6"/></svg>',
  clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  euro: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.6 4.2A4.6 4.6 0 0 0 4.4 8a4.6 4.6 0 0 0 7.2 3.8M2.6 6.8h6.2M2.6 9.2h6.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  start: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 10h16M9 3v4M15 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  lists: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  ideas: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="9" width="16" height="11" rx="2.5" fill="currentColor" opacity=".25"/><rect x="3" y="7" width="18" height="4" rx="2" fill="currentColor"/><path d="M12 7v13" stroke="currentColor" stroke-width="2"/><path d="M12 7c-1.5-3.4-5.4-3.8-5.4-1.6C6.6 7 10 7 12 7zm0 0c1.5-3.4 5.4-3.8 5.4-1.6C17.4 7 14 7 12 7z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const STATUS = '<div class="ix-status"><span>9:41</span><span>●●● ▮</span></div>';
const TABS = `<nav class="ix-tabs" aria-hidden="true"><span>${ICON.start}Start</span><span>${ICON.lists}Listen</span><span class="on">${ICON.ideas}Ideen</span><span>${ICON.profile}Profil</span></nav>`;

function phone(theme: Theme, extra = ''): HTMLDivElement {
  const ph = document.createElement('div');
  ph.className = `ix-phone bp-paper${theme === 'dark' ? ' dark' : ''}${extra ? ` ${extra}` : ''}`;
  ph.dataset['theme'] = theme;
  return ph;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 1. "Ideen", scrolled below the deck: the deck's last card + verdict buttons, the category row, "Warum diese Ideen?". */
export function ideasPhone(theme: Theme, onOpen?: (id: string) => void): HTMLDivElement {
  const ph = phone(theme);
  const tiles = CATEGORIES.map(
    (c) => `<button type="button" class="ix-tile" data-cat="${c.id}" style="--tile-bg: var(--tile-${CATEGORY_TONE[c.id]})" aria-label="${esc(`${c.label}, ${c.count} ${c.unit}`)}">
      <span class="art">${categoryArt(c.id)}</span>${c.isNew ? '<span class="new">Neu</span>' : ''}<b>${esc(c.label)}</b><small>${c.count} ${c.unit}</small></button>`,
  ).join('');
  ph.innerHTML = `${STATUS}
  <div class="ix-bar"><span></span><b>Ideen</b><span></span></div>
  <div class="ix-scroll">
    <div class="ix-deck" aria-hidden="true">
      <div class="ix-deck-pic">${motifArt('themind')}</div>
      <div class="ix-deck-body"><h3>Kartenspiel „Die Crew – Jagd um die Welt“</h3><p><b>ca. 15 €</b> · passt zu Spiele, Reisen</p>
        <div class="ix-deck-acts"><span>Mehr wie das</span><span class="acc">＋ Auf meine Liste</span></div></div>
    </div>
    <div class="ix-verdict" aria-hidden="true"><span class="undo">↶</span><span class="pair"><span class="act"><i>✕</i><small>Nicht für mich</small></span><span class="act like"><i>♥</i><small>Gefällt mir</small></span></span><span class="pos">3 von 8</span></div>
    <section class="ix-browse" aria-label="Stöbern nach Thema">
      <div class="ix-browse-head"><div><h2 class="ix-h2">Stöbern nach Thema</h2><p class="ix-sub">Von uns ausgesucht – echte Shops, keine Werbung.</p></div><a href="#" tabindex="-1">Alle</a></div>
      <div class="ix-row">${tiles}</div>
    </section>
    <div class="ix-why bp-panel" aria-hidden="true"><h3>Warum diese Ideen?</h3><p>Weil du dir das wünschst: Spiele, Kaffee &amp; Tee</p></div>
  </div>
  ${TABS}`;
  if (onOpen) {
    ph.querySelectorAll<HTMLElement>('.ix-tile').forEach((tile) => {
      tile.addEventListener('click', () => onOpen(tile.dataset['cat'] ?? ''));
    });
  }
  return ph;
}

function gameCard(g: GameCard): string {
  // a winner shows its prize; a nominee only "Nominiert 2018" (the full words are in the sheet)
  const nominee = g.award?.startsWith('Nominiert') ?? false;
  const label = nominee ? `Nominiert ${/d{4}/.exec(g.award ?? '')?.[0] ?? ''}` : (g.award ?? '');
  const award = g.award ? `<span class="ix-award" title="${esc(g.award)}"><i>${nominee ? '☆' : '★'}</i>${esc(label)}</span>` : '';
  return `<li data-game="${g.id}"><div data-k="card" class="ix-card" style="--tile-bg: var(--tile-${g.tone})">
    <div class="art">${motifArt(g.motif)}${award}</div>
    <div class="body"><h3>${esc(g.name)}</h3>
      <div class="ix-facts"><span>${ICON.people}${span(g.players)}</span><span>${ICON.clock}${span(g.minutes)} Min</span><span>ab ${g.age}</span></div>
      <div class="ix-buy"><b>${priceLabel(g.price)}</b><button type="button" class="ix-add" aria-pressed="false" aria-label="${esc(`${g.name}: auf meine Liste`)}">＋</button></div>
    </div></div></li>`;
}

export interface CategoryPhone {
  phone: HTMLDivElement;
  /** the screen the tracks of motion.ts look into */
  screen: HTMLElement;
  setFilters(f: Filters): void;
}

/**
 * 2. The "Brettspiele" screen. `onFilter(key)` = a pill was tapped (the gallery cycles that filter on every phone);
 * `onCard(game)` = a card was tapped (the gallery opens it in the detail phone).
 */
export function categoryPhone(theme: Theme, games: readonly GameCard[], fits: (g: GameCard, f: Filters) => boolean, hooks: { onFilter?: (key: keyof Filters) => void; onCard?: (g: GameCard) => void } = {}, tall = false): CategoryPhone {
  const ph = phone(theme, tall ? 'tall' : '');
  const pill = (key: keyof Filters, icon: string) =>
    `<button type="button" class="ix-filter" data-filter="${key}" aria-pressed="false">${icon}<span>${FILTER_LABELS[key].all}</span><span class="chev">▾</span></button>`;
  ph.innerHTML = `${STATUS}
  <div class="ix-bar"><span class="ix-pill"><i>‹</i>Ideen</span><span></span></div>
  <div class="ix-scroll">
    <header class="ix-hero">${headerScene()}
      <div class="ix-hero-text"><h1>Brettspiele</h1><p>Kultklassiker und kleine Entdeckungen – von uns ausgesucht.</p>
        <div class="meta"><b>${DRAFT_COUNT + CATALOG_GAMES} Spiele</b> · ${priceLabel(DRAFT_PRICE_SPAN).replace('ca. ', '')} · Stand 26.10.2026</div></div>
    </header>
    <div class="ix-filters" role="group" aria-label="Filter">${pill('players', ICON.people)}${pill('time', ICON.clock)}${pill('price', ICON.euro)}</div>
    <p class="ix-count" aria-live="polite"></p>
    <ul class="ix-grid">${games.map(gameCard).join('')}</ul>
    <p class="ix-foot">Preise ungefähr, Stand 26.10.2026. Keine Partnerlinks – wir verdienen nichts daran.</p>
  </div>
  ${TABS}`;
  const screen = ph;
  const count = ph.querySelector<HTMLElement>('.ix-count');
  const items = [...ph.querySelectorAll<HTMLLIElement>('.ix-grid > li')];

  function setFilters(f: Filters): void {
    let shown = 0;
    for (const li of items) {
      const g = games.find((x) => x.id === li.dataset['game']);
      const ok = g ? fits(g, f) : false;
      li.hidden = !ok;
      if (ok) shown += 1;
    }
    for (const key of ['players', 'time', 'price'] as const) {
      const b = ph.querySelector<HTMLElement>(`[data-filter="${key}"]`);
      if (!b) continue;
      const on = f[key] !== 'all';
      b.setAttribute('aria-pressed', String(on));
      const label = b.querySelector('span');
      if (label) label.textContent = (FILTER_LABELS[key] as Record<string, string>)[f[key]] ?? '';
    }
    if (count) count.textContent = shown === games.length ? `${games.length} von ${DRAFT_COUNT + CATALOG_GAMES} Spielen im Prototyp` : `${shown} von ${games.length} passen`;
  }

  ph.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => hooks.onFilter?.(b.dataset['filter'] as keyof Filters));
  });
  ph.querySelectorAll<HTMLButtonElement>('.ix-add').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      b.textContent = on ? '✓' : '＋';
    });
  });
  ph.querySelectorAll<HTMLElement>('[data-game]').forEach((li) => {
    li.addEventListener('click', () => {
      const g = games.find((x) => x.id === li.dataset['game']);
      if (g) hooks.onCard?.(g);
    });
  });
  return { phone: ph, screen, setFilters };
}

/** 3. One game opened: the category screen dimmed behind, the sheet with facts, shops and the wishlist button. */
export function detailPhone(theme: Theme, game: GameCard, behind: HTMLElement | null): HTMLDivElement {
  const ph = phone(theme);
  if (behind) {
    const back = behind.cloneNode(true) as HTMLElement;
    back.querySelectorAll('[data-k]').forEach((n) => ((n as HTMLElement).style.cssText = ''));
    back.querySelectorAll('.ix-status, .ix-bar, .ix-tabs').forEach((n) => n.remove());
    const scroll = back.querySelector('.ix-scroll');
    if (scroll) ph.append(scroll);
  }
  const offers = game.offers.map((o) => `<li><span>${esc(o.shop)}</span><em>~ ${offerLabel(o.cents)}</em><i>›</i></li>`).join('');
  const sheet = document.createElement('div');
  sheet.innerHTML = `<div class="ix-scrim"></div>
  <section class="ix-sheet" role="dialog" aria-label="${esc(game.name)}">
    <div class="ix-grab"></div>
    <div class="art" style="--tile-bg: var(--tile-${game.tone})">${motifArt(game.motif)}</div>
    <h2>${esc(game.name)}</h2>
    <p class="by">${esc(game.kind)} · <b>${esc(game.publisher)}</b>${game.award ? ` · ${esc(game.award)}` : ''}</p>
    <div class="ix-factrow"><span>Spieler<b>${span(game.players)}</b></span><span>Dauer<b>${span(game.minutes)} Min</b></span><span>Alter<b>ab ${game.age}</b></span></div>
    <p class="blurb">${esc(game.blurb)}</p>
    <ul class="ix-offers">${offers}</ul>
    <p class="ix-asof">Ungefähre Preise, Stand 26.10.2026.</p>
    <button type="button" class="ix-cta" tabindex="-1">＋ Zur Wunschliste hinzufügen</button>
  </section>`;
  ph.insertAdjacentHTML('afterbegin', STATUS);
  ph.append(...sheet.childNodes);
  return ph;
}
