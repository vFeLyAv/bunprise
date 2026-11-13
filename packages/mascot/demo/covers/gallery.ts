/**
 * Gallery page «Обложки-заставки» (26.10) — a GALLERY-ONLY prototype on the mascot gallery (5180); nothing of it is in
 * the app until Felix's OK. Felix: an occasion without a photo gets one of OUR pictures when its title says what it
 * is; nothing fits → empty as before; or the host picks one of our pictures instead of a photo.
 *   1. every motif as a Start card (features/feed FeedCard: the cover across the top, dissolving into the card), light
 *      and dark, with its size;
 *   2. the occasion screen's hero (photo/HeroCover: full bleed, 1 : 1.08, fading under the day pill and the title);
 *   3. a playground: type a title (+ a date) → which motif and why (detect.ts, on the device only);
 *   4. the detection table (samples.ts — the same table the tests check), traps included;
 *   5. the picker in the form (form/PhotoField): automatic, nothing found, picked by hand, own photo, switched off;
 *   6. what already exists in the repo (the pictures Felix may have meant) next to the new ones.
 *
 *   ?screens=covers [&theme=light|dark] [&part=cards|hero|play|table|picker|before] [&title=…] [&date=YYYY-MM-DD]
 *
 * Design note for Felix (Russian): docs/design/2026-10-26-occasion-covers.md.
 */

import { addCss, applyPageTheme, el, markReady, PAPER_CSS, themeOf as pageThemeOf, type Theme } from '../parade/kit';
import { coverSvg } from './art';
import { explainTheme, type ThemeGuess } from './detect';
import { paletteCss } from './palette';
import { SAMPLE_TITLES } from './samples';
import { THEME_IDS, THEMES, type ThemeId } from './themes';

const PARTS = ['cards', 'hero', 'play', 'table', 'picker', 'before'] as const;
type Part = (typeof PARTS)[number];

/** The app's pictures Felix may have meant ("пару картинок уже готовы"): demo fixtures drawn from our own SVG. */
const BEFORE = [
  { url: new URL('../../../../apps/web/src/mocks/assets/demo-list-birthday.webp', import.meta.url).href, label: 'demo-list-birthday.webp — обложка демо-списка «Geburtstag» (960×540, 7 КБ)' },
  { url: new URL('../../../../apps/web/src/mocks/demo-cover.webp', import.meta.url).href, label: 'demo-cover.webp — фото демо-повода «Annas Einweihung» (1200×800, 45,6 КБ)' },
  { url: new URL('../../../../docs/brand/variants/bunprise-birthday.png', import.meta.url).href, label: 'docs/brand/variants — Помпон в колпаке (вариант иконки)' },
] as const;

const TILE_TONE: readonly (1 | 2 | 3 | 4)[] = [3, 1, 4, 2];

const CSS = `
.cv-page { max-width: 1120px; margin: 0 auto 48px; padding: 8px 16px; box-sizing: border-box; color: var(--text); }
.cv-page h2 { margin: 6px 4px 4px; font-size: 26px; letter-spacing: -.02em; }
.cv-lead { margin: 0 4px 14px; color: var(--text-2); font-size: 14px; line-height: 1.5; max-width: 820px; }
.cv-nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 4px 18px; }
.cv-nav a { font-size: 13px; color: var(--text); text-decoration: none; padding: 7px 12px; border-radius: 999px; background: var(--tile); }
.cv-block { background: var(--card); border: 1px solid var(--card-border); border-radius: 30px; box-shadow: var(--shadow-card); padding: 18px 18px 22px; margin: 0 0 22px; }
.cv-block > h3 { margin: 2px 4px 4px; font-size: 20px; }
.cv-block > p { margin: 0 4px 14px; font-size: 14px; line-height: 1.5; color: var(--text-2); max-width: 820px; }
.cv-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
.cv-panel { border-radius: 26px; padding: 16px 14px 18px; box-shadow: none; }
.cv-panel > h4 { margin: 0 4px 12px; font-size: 14px; font-weight: 650; color: var(--text-2); }
.cv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; }
.cv-meta { margin: 6px 6px 0; font-size: 11.5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.cv-svg { display: block; width: 100%; height: 100%; }

/* ---- the Start card (features/feed/FeedCard + styles/feed.css .feed-cover) ---- */
.cv-card { display: flex; flex-direction: column; border-radius: 24px; padding: 16px; text-decoration: none; color: var(--text);
  background-color: var(--panel-bg); background-image: linear-gradient(100deg, var(--card-tint) 0%, rgba(255,255,255,0) 52%), var(--panel-sheen);
  box-shadow: var(--panel-edge), var(--panel-shadow); }
.cv-cover { display: block; margin: -16px -16px 8px; aspect-ratio: 16 / 7; border-radius: 24px 24px 0 0; overflow: hidden;
  -webkit-mask-image: linear-gradient(#000 64%, transparent); mask-image: linear-gradient(#000 64%, transparent); }
.cv-row { display: flex; gap: 16px; }
.cv-badge { position: relative; z-index: 1; margin-top: -40px; flex: none; width: 56px; height: 64px; border-radius: 12px; display: inline-flex; flex-direction: column;
  align-items: center; justify-content: center; background: var(--tile-bg); color: var(--tile-ink); font-variant-numeric: tabular-nums;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--hl) 55%, transparent), inset 0 1px 0 color-mix(in srgb, var(--hl) 90%, transparent), 0 6px 14px -8px rgba(80,50,22,.35); }
.cv-badge b { font-size: 11px; letter-spacing: .08em; line-height: 1; }
.cv-badge strong { font-size: 22px; line-height: 1; margin-top: 2px; font-weight: 800; letter-spacing: -.02em; }
.cv-badge i { font-style: normal; font-size: 11px; font-weight: 600; opacity: .8; margin-top: 4px; line-height: 1; }
.cv-badge.lg { width: 68px; height: 76px; margin-top: 0; border-radius: 24px; }
.cv-badge.lg strong { font-size: 28px; }
.cv-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.cv-when { font-size: 13px; line-height: 18px; color: var(--text-2); }
.cv-when b { color: var(--accent-text); font-weight: 600; }
.cv-text h3 { margin: 2px 0 0; font-size: 20px; line-height: 25px; font-weight: 700; letter-spacing: -.01em; }
.cv-line { margin-top: 4px; display: flex; align-items: center; gap: 6px; font-size: 15px; color: var(--text-2); }
.cv-line svg { flex: none; }
.cv-ava { width: 24px; height: 24px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 10px; font-weight: 700; font-style: normal;
  background: var(--tile-2); color: var(--tile-2-fg); }
.cv-tags { display: flex; gap: 6px; margin-top: 12px; }
.cv-tag { height: 24px; white-space: nowrap; display: inline-flex; align-items: center; padding: 0 10px; border-radius: 999px; font-size: 13px; font-weight: 600; background: var(--accent-50); color: var(--accent-text); }
.cv-tag.n { background: var(--fill); color: var(--text-2); }

/* ---- the occasion screen's hero (photo/photo.css .occ-cover, OccasionHero) ---- */
.cv-phones { display: flex; flex-wrap: wrap; gap: 28px; justify-content: center; align-items: flex-start; }
.cv-phone { width: 390px; height: 844px; }
.cv-phone-cap { margin: 10px 0 0; text-align: center; font-size: 12.5px; color: var(--text-2); max-width: 390px; }
.cv-hero-cover { position: relative; width: 100%; aspect-ratio: 1 / 1.08; max-height: 480px; overflow: hidden; margin-bottom: -88px;
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 140px), transparent 100%); mask-image: linear-gradient(to bottom, black calc(100% - 140px), transparent 100%); }
.cv-status { position: absolute; left: 0; right: 0; top: 0; height: 47px; z-index: 3; display: flex; align-items: center; justify-content: space-between; padding: 0 30px;
  box-sizing: border-box; font-size: 15px; font-weight: 600; color: var(--text); }
.cv-topbar { position: absolute; left: 12px; right: 12px; top: 51px; z-index: 3; display: flex; justify-content: space-between; }
.cv-glass { display: inline-flex; align-items: center; gap: 4px; height: 44px; padding: 0 16px 0 12px; border-radius: 999px; font-size: 16px; font-weight: 600; color: var(--text);
  background: var(--float-bg); box-shadow: var(--panel-edge), 0 8px 20px -10px rgba(60,40,20,.35); -webkit-backdrop-filter: blur(14px) saturate(1.6); backdrop-filter: blur(14px) saturate(1.6); }
.cv-glass.round { width: 44px; padding: 0; justify-content: center; }
.cv-hero-body { position: relative; z-index: 1; padding: 0 16px; display: flex; flex-direction: column; gap: 20px; }
.cv-hero-head { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.cv-pills { display: flex; gap: 8px; flex-wrap: wrap; }
.cv-pill { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--accent-text);
  background: color-mix(in srgb, var(--surface) 88%, transparent); box-shadow: var(--panel-edge), 0 4px 12px -8px rgba(60,40,20,.3); }
.cv-pill.motif { color: var(--text-2); }
.cv-hero-body h1 { margin: 0; font-size: 34px; line-height: 40px; letter-spacing: -.02em; font-weight: 800; }
.cv-hero-card { border-radius: 28px; padding: 20px; display: flex; flex-direction: column; gap: 18px;
  background-image: linear-gradient(100deg, var(--card-tint) 0%, rgba(255,255,255,0) 60%), var(--panel-sheen); }
.cv-hero-card .cv-row { align-items: center; }
.cv-hero-card p { margin: 0; }
.cv-date { font-size: 17px; font-weight: 600; }
.cv-time { font-size: 20px; font-weight: 700; margin-top: 2px; }
.cv-host { display: flex; align-items: center; gap: 12px; padding-top: 16px; border-top: 1px solid var(--separator); font-size: 15px; color: var(--text-2); }
.cv-host .cv-ava { width: 40px; height: 40px; font-size: 14px; }

/* ---- playground + table ---- */
.cv-play { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; }
.cv-play-in { flex: 1 1 320px; max-width: 460px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
.cv-play-in label { display: flex; flex-direction: column; gap: 6px; color: var(--text-2); font-size: 13px; }
.cv-play-in input { font: inherit; font-size: 17px; padding: 12px 14px; border-radius: 14px; border: 0; background: var(--tile); color: var(--text); outline-offset: 2px; }
.cv-play-in input[type=date] { font-size: 15px; max-width: 220px; }
.cv-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cv-chips button { appearance: none; border: 0; border-radius: 999px; padding: 6px 11px; font: 600 12.5px/1.2 inherit; cursor: pointer; background: var(--tile); color: var(--text); }
.cv-why { font-size: 14px; line-height: 1.5; padding: 12px 14px; border-radius: 16px; background: var(--tile); }
.cv-why b { font-size: 17px; }
.cv-why code { font-size: 12.5px; }
.cv-play-out { flex: 0 1 380px; min-width: 300px; }
.cv-empty-note { margin: 8px 6px 0; font-size: 12.5px; color: var(--text-3); }
.cv-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.cv-table th { text-align: left; font-size: 12px; color: var(--text-2); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--card-border); background: var(--card); }
.cv-table td { padding: 6px 8px; border-bottom: 1px solid color-mix(in srgb, var(--text) 8%, transparent); vertical-align: top; }
.cv-table td.ok { color: #2D7146; font-weight: 700; } .cv-table td.bad { color: #AE2A1C; font-weight: 700; }
:root[data-theme="dark"] .cv-table td.ok { color: #7ED39A; } :root[data-theme="dark"] .cv-table td.bad { color: #FF8F7E; }
.cv-table .trap { color: var(--text-2); font-size: 12.5px; }
.cv-table .none { color: var(--text-3); }
.cv-thumb { display: inline-block; width: 40px; height: 22px; border-radius: 5px; overflow: hidden; vertical-align: middle; margin-right: 6px; }
.cv-sum { margin: 0 4px 12px; font-size: 14px; font-weight: 600; }

/* ---- the picker in the form (form/PhotoField + photo-field.css) ---- */
.cv-forms { display: flex; flex-wrap: wrap; gap: 22px; justify-content: center; align-items: flex-start; }
.cv-form { width: 390px; border-radius: 34px; padding: 18px 16px 22px; box-sizing: border-box; box-shadow: 0 0 0 1px rgba(60,40,20,.08); }
.cv-form-state { margin: 0 2px 10px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--accent-text); }
.cv-form-kicker { margin: 0; font-size: 15px; color: var(--text-2); }
.cv-form-title { margin: 2px 0 16px; font-size: 30px; line-height: 36px; font-weight: 800; letter-spacing: -.02em; }
.cv-group { border-radius: 24px; overflow: hidden; }
.cv-frow { display: flex; align-items: center; gap: 12px; min-height: 54px; padding: 8px 14px 8px 13px; box-sizing: border-box; font-size: 17px; }
.cv-frow + .cv-frow { border-top: 1px solid var(--separator); }
.cv-frow .lbl { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.cv-frow .lbl b { font-weight: 600; color: var(--accent-text); }
.cv-frow .lbl span { font-size: 13px; color: var(--text-2); }
.cv-frow .lbl b.plain { color: var(--text); }
.cv-frow .chev { color: var(--text-3); font-size: 22px; }
.cv-ico { width: 30px; height: 30px; border-radius: 9px; flex: none; display: grid; place-items: center; color: #fff; }
.cv-ico.photo { background: linear-gradient(160deg, #A98BE0, #7E62C4); }
.cv-ico.motif { background: linear-gradient(160deg, #F6BE6E, #E58B3A); }
.cv-ghost { appearance: none; border: 0; background: var(--fill); color: var(--accent-text); border-radius: 999px; height: 36px; padding: 0 14px; font: 600 15px/1 inherit; }
.cv-frame { position: relative; width: min(calc(100% - 16px), 300px); margin: 8px auto 0; aspect-ratio: 1 / 1.08; border-radius: 16px; overflow: hidden; background: var(--fill-2); }
.cv-frame img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cv-frame-chip { position: absolute; left: 10px; top: 10px; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px 0 8px; border-radius: 999px;
  font-size: 13px; font-weight: 600; color: var(--text); background: var(--float-bg); box-shadow: var(--panel-edge); -webkit-backdrop-filter: blur(12px) saturate(1.6); backdrop-filter: blur(12px) saturate(1.6); }
.cv-frame-actions { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 8px; }
.cv-frame-actions span { display: inline-flex; align-items: center; height: 36px; padding: 0 14px; border-radius: 999px; font-size: 15px; font-weight: 600; color: var(--text);
  background: var(--float-bg); box-shadow: var(--panel-edge), 0 6px 16px -8px rgba(60,40,20,.35); -webkit-backdrop-filter: blur(12px) saturate(1.6); backdrop-filter: blur(12px) saturate(1.6); }
.cv-strip-h { display: flex; justify-content: space-between; align-items: baseline; padding: 12px 14px 0; font-size: 13px; color: var(--text-2); }
.cv-strip-h b { color: var(--text); font-size: 15px; font-weight: 600; }
.cv-strip { display: flex; gap: 10px; overflow-x: auto; padding: 10px 14px 14px; scroll-snap-type: x mandatory; scrollbar-width: none; }
.cv-strip::-webkit-scrollbar { display: none; }
.cv-opt { flex: none; width: 64px; display: flex; flex-direction: column; align-items: center; gap: 5px; scroll-snap-align: start; font-size: 11px; color: var(--text-2); text-align: center; line-height: 1.15; }
.cv-opt .sq { position: relative; width: 64px; height: 64px; border-radius: 16px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--separator); }
.cv-opt .sq.none { display: grid; place-items: center; background: transparent; box-shadow: inset 0 0 0 1.5px var(--fill-3); color: var(--text-3); }
.cv-opt[aria-checked="true"] { color: var(--text); font-weight: 600; }
.cv-opt[aria-checked="true"] .sq { box-shadow: 0 0 0 2.5px var(--surface), 0 0 0 4.5px var(--accent-text); }
.cv-opt .tick { position: absolute; right: 4px; top: 4px; width: 18px; height: 18px; border-radius: 50%; background: var(--accent-text); color: var(--surface); display: grid; place-items: center; }
.cv-hint { display: flex; gap: 6px; margin: 8px 6px 0; font-size: 13px; line-height: 18px; color: var(--text-2); }
.cv-before { display: flex; flex-wrap: wrap; gap: 16px; }
.cv-before figure { margin: 0; width: 300px; }
.cv-before img { width: 300px; height: 170px; object-fit: cover; border-radius: 16px; display: block; background: var(--tile); }
.cv-before figcaption { margin-top: 6px; font-size: 12.5px; color: var(--text-2); line-height: 1.4; }
.cv-before .cv-cover-only { width: 300px; height: 170px; border-radius: 16px; overflow: hidden; }
`;

/** Tile, tint and float tokens of the app on the paper mocks (styles/tiles.css, tints.css, kit.css), light + night. */
const APP_TOKENS = `
.bp-paper { --tile-1: #FCE5C9; --tile-1-fg: #984A14; --tile-2: #F8E0D8; --tile-2-fg: #8C4757; --tile-3: #E3E6F1; --tile-3-fg: #48557F; --tile-4: #F7EDC9; --tile-4-fg: #76580F;
  --tint-1: rgba(255,170,104,.34); --tint-2: rgba(240,150,164,.3); --tint-3: rgba(146,166,230,.27); --tint-4: rgba(246,200,92,.36);
  --hl: #fff; --fill-2: rgba(116,84,44,.11); --fill-3: rgba(116,84,44,.17); }
.bp-paper.dark { --tile-1: #3A2A1C; --tile-1-fg: #F3B676; --tile-2: #3A2424; --tile-2-fg: #F0B3BE; --tile-3: #23283A; --tile-3-fg: #B9C3E6; --tile-4: #353016; --tile-4-fg: #E9D38D;
  --tint-1: rgba(255,150,84,.17); --tint-2: rgba(236,124,142,.14); --tint-3: rgba(130,150,226,.14); --tint-4: rgba(236,186,80,.14);
  --hl: rgba(255,236,214,.16); --fill-2: rgba(255,230,205,.115); --fill-3: rgba(255,230,205,.17); }
.cv-badge[data-tile="1"], .cv-card[data-tile="1"] { --tile-bg: var(--tile-1); --tile-ink: var(--tile-1-fg); --card-tint: var(--tint-1); }
.cv-badge[data-tile="2"], .cv-card[data-tile="2"] { --tile-bg: var(--tile-2); --tile-ink: var(--tile-2-fg); --card-tint: var(--tint-2); }
.cv-badge[data-tile="3"], .cv-card[data-tile="3"] { --tile-bg: var(--tile-3); --tile-ink: var(--tile-3-fg); --card-tint: var(--tint-3); }
.cv-badge[data-tile="4"], .cv-card[data-tile="4"] { --tile-bg: var(--tile-4); --tile-ink: var(--tile-4-fg); --card-tint: var(--tint-4); }
`;

// small UI glyphs (the app's line icons: 24 grid, round strokes, currentColor)
const ICON = {
  pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/></svg>',
  cal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/></svg>',
  photo: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 15.5l-4.5-4.5-8.5 8"/></svg>',
  spark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" opacity=".8"/></svg>',
  sparkSm: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/></svg>',
  none: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M6.5 17.5l11-11"/></svg>',
  tick: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>',
};

function esc(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/** A Start card (FeedCard) with the motif as its cover; `tile` = the occasion's own colour (tileTone of its id). */
export function feedCard(title: string, theme: ThemeId | null, tile: 1 | 2 | 3 | 4, opts: { host?: string; place?: string; when?: [string, string]; day?: [string, string, string] } = {}): HTMLElement {
  const [rel, abs] = opts.when ?? ['In 5 Tagen', 'Sa., 31. Okt.'];
  const [mon, day, wd] = opts.day ?? ['OKT', '31', 'Sa'];
  const card = el('a', 'cv-card', `${theme ? `<span class="cv-cover">${coverSvg(theme)}</span>` : ''}
<span class="cv-row"><span class="cv-badge" data-tile="${tile}"${theme ? '' : ' style="margin-top:0"'}><b>${mon}</b><strong>${day}</strong><i>${wd}</i></span>
<span class="cv-text"><span class="cv-when"><b>${esc(rel)}</b> · ${esc(abs)}</span><h3>${esc(title)}</h3>
${opts.place ? `<span class="cv-line">${ICON.pin}<span>${esc(opts.place)}</span></span>` : ''}
${opts.host ? `<span class="cv-line"><i class="cv-ava">${esc(opts.host.slice(0, 2).toUpperCase())}</i><span>${esc(opts.host)} lädt ein</span></span>` : '<span class="cv-tags"><span class="cv-tag">Gastgeber</span><span class="cv-tag n">3 Gäste</span></span>'}
</span></span>`);
  card.dataset.tile = String(tile);
  if (theme) card.dataset.cover = theme;
  return card;
}

/** The occasion screen (S7) with the motif as the hero cover. */
function heroPhone(theme: ThemeId, title: string, dark: boolean, tile: 1 | 2 | 3 | 4, hostView: boolean): HTMLElement {
  const phone = el('div', `cv-phone bp-paper${dark ? ' dark' : ''}`);
  phone.innerHTML = `<div class="cv-status"><span>9:41</span><span>●●● ▮</span></div>
<div class="cv-topbar"><span class="cv-glass">‹ Zurück</span><span class="cv-glass round">•••</span></div>
<div class="cv-hero-cover">${coverSvg(theme)}</div>
<div class="cv-hero-body">
  <div class="cv-hero-head"><div class="cv-pills"><span class="cv-pill">${ICON.cal} In 5 Tagen</span>${hostView ? `<span class="cv-pill motif">${ICON.sparkSm} Motiv · ändern</span>` : ''}</div><h1>${esc(title)}</h1></div>
  <div class="cv-hero-card bp-panel cv-card-tint" data-tile="${tile}">
    <div class="cv-row"><span class="cv-badge lg" data-tile="${tile}"><b>OKT</b><strong>31</strong><i>Sa</i></span>
      <div><p class="cv-date">Samstag, 31. Oktober</p><p class="cv-time">19:00</p></div></div>
    <div class="cv-line">${ICON.pin}<span>Bei Mila zu Hause</span></div>
    <div class="cv-host"><i class="cv-ava">${hostView ? 'DU' : 'MI'}</i><span>${hostView ? 'Du lädst ein' : 'Mila lädt ein'}</span></div>
  </div>
</div>`;
  const card = phone.querySelector<HTMLElement>('.cv-hero-card');
  if (card) card.style.setProperty('--card-tint', `var(--tint-${tile})`);
  return phone;
}

type FormState = 'auto' | 'nothing' | 'nothing-open' | 'manual' | 'photo' | 'off';

const FORM_STATES: readonly { state: FormState; label: string; title: string; motif: ThemeId | null }[] = [
  { state: 'auto', label: '1 · Автоматически: название подошло', title: 'Annas 30. Geburtstag', motif: 'birthday' },
  { state: 'nothing', label: '2 · Ничего не подошло — как сейчас', title: 'Treffen mit Jo', motif: null },
  { state: 'nothing-open', label: '3 · «Motiv wählen» открыт', title: 'Treffen mit Jo', motif: null },
  { state: 'manual', label: '4 · Выбрано вручную', title: 'Freitag bei mir', motif: 'gamenight' },
  { state: 'photo', label: '5 · Своё фото — всегда важнее', title: 'Annas 30. Geburtstag', motif: 'birthday' },
  { state: 'off', label: '6 · «Kein Motiv»: автоматику выключили', title: 'Annas 30. Geburtstag', motif: null },
];

function strip(selected: ThemeId | null, first: ThemeId | null): string {
  // the motif the title suggests comes first (after "Kein Motiv"), the rest in the picker order
  const order = first ? [first, ...THEME_IDS.filter((t) => t !== first)] : [...THEME_IDS];
  const none = `<span class="cv-opt" role="radio" aria-checked="${selected === null}"><span class="sq none">${ICON.none}${selected === null ? `<span class="tick">${ICON.tick}</span>` : ''}</span>Kein Motiv</span>`;
  const opts = order
    .map(
      (t) =>
        `<span class="cv-opt" role="radio" aria-checked="${t === selected}"><span class="sq">${coverSvg(t, 'thumb')}${t === selected ? `<span class="tick">${ICON.tick}</span>` : ''}</span>${esc(THEMES[t].name.de)}</span>`,
    )
    .join('');
  return `<div class="cv-strip-h"><b>Motiv</b><span>${first ? 'passend zuerst' : 'statt Foto'}</span></div><div class="cv-strip" role="radiogroup" aria-label="Motiv">${none}${opts}</div>`;
}

function formMock(state: FormState, title: string, motif: ThemeId | null, dark: boolean, label: string): HTMLElement {
  const auto = explainTheme(title).theme;
  let group = '';
  const photoRow = '<div class="cv-frow"><span class="cv-ico photo">' + ICON.photo + '</span><span class="lbl"><b>Foto hinzufügen</b></span><span class="chev">›</span></div>';
  if (state === 'auto' || state === 'manual') {
    const t = motif ?? 'birthday';
    group = `<div class="cv-frame">${coverSvg(t)}<span class="cv-frame-chip">${ICON.sparkSm} ${state === 'auto' ? 'Automatisch' : 'Motiv'}</span>
<span class="cv-frame-actions"><span>Eigenes Foto</span><span>Entfernen</span></span></div>
<div class="cv-frow"><span class="cv-ico motif">${ICON.spark}</span><span class="lbl"><b class="plain">Motiv: ${esc(THEMES[t].name.de)}</b><span>${state === 'auto' ? 'Passt zum Titel – du kannst es ändern.' : 'Von dir gewählt.'}</span></span></div>
${strip(t, auto)}`;
  } else if (state === 'nothing') {
    group = `${photoRow}<div class="cv-frow"><span class="cv-ico motif">${ICON.spark}</span><span class="lbl"><b>Motiv wählen</b><span>Ein Bild von uns statt Foto</span></span><span class="chev">›</span></div>`;
  } else if (state === 'nothing-open') {
    group = `${photoRow}${strip(null, null)}`;
  } else if (state === 'photo') {
    group = `<div class="cv-frame"><img alt="" src="${BEFORE[1].url}"><span class="cv-frame-actions"><span>Ersetzen</span><span>Entfernen</span></span></div>
<div class="cv-frow"><span class="cv-ico photo">${ICON.photo}</span><span class="lbl"><b class="plain">Titelfoto</b><span>Dein Foto hat Vorrang vor jedem Motiv.</span></span></div>`;
  } else {
    group = `<div class="cv-frow"><span class="cv-ico motif">${ICON.spark}</span><span class="lbl"><b class="plain">Kein Titelbild</b><span>Das automatische Motiv ist aus.</span></span><button class="cv-ghost" type="button" tabindex="-1">Rückgängig</button></div>
${photoRow}${strip(null, auto)}`;
  }
  const form = el('div', `cv-form bp-paper${dark ? ' dark' : ''}`);
  form.dataset.state = state;
  form.innerHTML = `<p class="cv-form-state">${esc(label)}</p><p class="cv-form-kicker">Neuer Anlass</p><p class="cv-form-title">${esc(title)}</p>
<div class="cv-group bp-panel" role="group" aria-label="Titelbild">${group}</div>
<p class="cv-hint">${ICON.info}<span>${state === 'photo' ? 'Nur Fotos, die du teilen darfst. Sind Menschen darauf, frag sie vorher.' : 'Motive sind Bilder von Bunprise – ohne Upload, ohne fremde Fotos.'}</span></p>`;
  return form;
}

function whyText(g: ThemeGuess): string {
  if (g.via === 'blocked') return `Пусто: слово «${esc(g.matched ?? '')}» — грустный или медицинский повод (<code>${esc(g.pattern ?? '')}</code>), праздничная картинка тут не нужна.`;
  if (g.via === 'none' || !g.theme) return 'Пусто: ни одно слово не подошло — обложки нет, как раньше. Хозяин может выбрать мотив сам.';
  const name = THEMES[g.theme].name.ru;
  if (g.via === 'date') return `<b>${esc(name)}</b> — по дате <code>${esc(g.pattern ?? '')}</code>: название общее («${esc(g.matched ?? '')}»), а день праздничный.`;
  if (g.via === 'weak') return `<b>${esc(name)}</b> — слабое слово «${esc(g.matched ?? '')}» (<code>${esc(g.pattern ?? '')}</code>): только если ничего другого не нашлось.`;
  const typo = g.pattern?.startsWith('~') && g.matched && !g.matched.includes(g.pattern.slice(1)) ? ' (с опечаткой)' : '';
  return `<b>${esc(name)}</b> — слово «${esc(g.matched ?? '')}»${typo}, правило <code>${esc(g.pattern ?? '')}</code>.`;
}

async function gzipSize(text: string): Promise<number | null> {
  if (typeof CompressionStream !== 'function' || typeof Blob === 'undefined' || typeof Response === 'undefined') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return (await new Response(stream).arrayBuffer()).byteLength;
  } catch {
    return null;
  }
}

const kb = (n: number) => `${(n / 1024).toFixed(1).replace('.', ',')} КБ`;

export function coversGallery(app: HTMLElement, q: URLSearchParams): void {
  addCss('bp-paper-css', PAPER_CSS);
  addCss('cv-css', CSS + APP_TOKENS + paletteCss('.bp-paper, .cv-scope', '.bp-paper.dark, .cv-scope.dark'));
  const theme: Theme = pageThemeOf(q);
  applyPageTheme(theme);
  const dark = theme === 'dark';
  const only = (PARTS as readonly string[]).includes(q.get('part') ?? '') ? (q.get('part') as Part) : null;
  const show = (p: Part) => only === null || only === p;

  const page = el('section', 'cv-page');
  app.append(page);
  page.append(
    el('h2', undefined, 'Обложки-заставки для поводов'),
    el('p', 'cv-lead', 'Только галерея. Повод без фото получает НАШУ картинку, если название говорит, что это (день рождения, вечер игр, зал …). Не подошло — пусто, как раньше. Или хозяин сам выбирает картинку вместо фото. Распознавание — маленькая функция прямо в телефоне: название никуда не уходит. 16 мотивов, нарисованы кодом (SVG) в цветах «Paper», в пяти — маленький гость: Помпон или Тапси.'),
  );
  const nav = el('nav', 'cv-nav');
  const labels: Record<Part, string> = { cards: '1 · Карточки', hero: '2 · Экран повода', play: '3 · Попробовать', table: '4 · Таблица', picker: '5 · Выбор в форме', before: '6 · Что уже было' };
  for (const p of PARTS) {
    const link = el('a', undefined, labels[p]);
    link.setAttribute('href', `#cv-${p}`);
    nav.append(link);
  }
  const themeLink = el('a', undefined, dark ? 'Тема: тёмная → светлая' : 'Тема: светлая → тёмная');
  const nextQ = new URLSearchParams(q);
  nextQ.set('theme', dark ? 'light' : 'dark');
  themeLink.setAttribute('href', `?${nextQ.toString()}`);
  nav.append(themeLink);
  page.append(nav);

  // 1 · every motif as a Start card, light + dark
  if (show('cards')) {
    const block = el('div', 'cv-block');
    block.id = 'cv-cards';
    block.append(
      el('h3', undefined, '1 · Все 16 мотивов на карточке «Start»'),
      el('p', undefined, 'Как фото сейчас: картинка по верху карточки от края до края и растворяется в ней, листок календаря стоит на её нижнем краю. Название карточки — пример; мотив выбран функцией по этому названию. Под каждой — размер картинки (SVG, сжато gzip).'),
    );
    const two = el('div', 'cv-two');
    const sizes: { id: ThemeId; out: HTMLElement[] }[] = THEME_IDS.map((id) => ({ id, out: [] }));
    for (const isDark of [false, true]) {
      const panel = el('div', `cv-panel bp-paper${isDark ? ' dark' : ''}`);
      panel.append(el('h4', undefined, isDark ? 'Тёмная тема (и «Blau», «Ozean»)' : 'Светлая тема'));
      const grid = el('div', 'cv-grid');
      THEME_IDS.forEach((id, i) => {
        const meta = THEMES[id];
        const wrap = el('div');
        const detected = explainTheme(meta.sample).theme;
        wrap.append(feedCard(meta.sample, detected, TILE_TONE[i % 4] ?? 1, { host: i % 3 === 0 ? undefined : ['Mila', 'Jonas', 'Lisa', 'Tom'][i % 4], place: i % 2 ? 'Bei Mila zu Hause' : undefined }));
        const m = el('p', 'cv-meta', `${meta.name.ru} · ${id}${meta.guest ? ` · гость: ${meta.guest === 'pompon' ? 'Помпон' : 'Тапси'}` : ''}`);
        sizes[i]?.out.push(m);
        wrap.append(m);
        grid.append(wrap);
      });
      panel.append(grid);
      two.append(panel);
    }
    block.append(two);
    page.append(block);
    void (async () => {
      let total = 0;
      for (const s of sizes) {
        const svg = coverSvg(s.id);
        const gz = await gzipSize(svg);
        total += gz ?? 0;
        for (const out of s.out) out.textContent += ` · ${kb(svg.length)}${gz ? `, ${kb(gz)} gzip` : ''}`;
      }
      if (total) block.querySelector('p')?.append(` Все 16 вместе: ${kb(total)} gzip.`);
    })();
  }

  // 2 · the occasion screen's hero
  if (show('hero')) {
    const block = el('div', 'cv-block');
    block.id = 'cv-hero';
    block.append(
      el('h3', undefined, '2 · Экран повода: обложка сверху'),
      el('p', undefined, 'Та же картинка, другой кадр (1 : 1,08, как у фото): видна середина, края уходят. Низ растворяется под пилюлей дня и заголовком — поэтому всё важное в картинке стоит выше «стола». Справа — вид хозяина: маленькая пилюля «Motiv · ändern» ведёт в форму (гости её не видят).'),
    );
    const row = el('div', 'cv-phones');
    const heroes: [ThemeId, string, boolean, boolean][] = [
      ['birthday', 'Annas 30. Geburtstag', dark, false],
      ['gamenight', 'Spieleabend bei Mila', !dark, false],
      ['sport', 'Training mit Tom', dark, true],
    ];
    heroes.forEach(([id, title, d, host], i) => {
      const cell = el('div');
      cell.append(heroPhone(id, title, d, TILE_TONE[i] ?? 1, host), el('p', 'cv-phone-cap', `${THEMES[id].name.ru} · ${d ? 'тёмная' : 'светлая'}${host ? ' · вид хозяина' : ' · вид гостя'}`));
      row.append(cell);
    });
    block.append(row);
    page.append(block);
  }

  // 3 · playground
  if (show('play')) {
    const block = el('div', 'cv-block');
    block.id = 'cv-play';
    block.append(el('h3', undefined, '3 · Попробовать: название → мотив'), el('p', undefined, 'Пиши как в форме. Дата нужна только для общих названий («Party», «Familientreffen»): 24–26.12 → Рождество, 31.12/1.1 → Новый год, 31.10 → Хэллоуин, Пасха (воскресенье и понедельник).'));
    const wrap = el('div', 'cv-play');
    const inputs = el('div', 'cv-play-in');
    const titleLabel = el('label', undefined, 'Название повода');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 80;
    input.value = q.get('title') ?? 'Spieleabend bei Mila';
    input.setAttribute('autocomplete', 'off');
    titleLabel.append(input);
    const dateLabel = el('label', undefined, 'Дата (необязательно)');
    const date = el('input');
    date.type = 'date';
    date.value = q.get('date') ?? '';
    dateLabel.append(date);
    const chips = el('div', 'cv-chips');
    for (const t of ['Geburstag Oma', 'Brettspiele & Pizza', 'Зал', 'Grillen', 'Trauerfeier für Opa', 'Skiurlaub in Österreich', 'Weinnacht', 'Familientreffen', 'ДР Маши', 'Halloween-Kinoabend']) {
      const b = el('button', undefined, t);
      b.type = 'button';
      b.addEventListener('click', () => {
        input.value = t;
        if (t === 'Familientreffen' && !date.value) date.value = '2026-12-24';
        update();
      });
      chips.append(b);
    }
    const why = el('div', 'cv-why');
    inputs.append(titleLabel, dateLabel, chips, why);
    const out = el('div', `cv-play-out cv-panel bp-paper${dark ? ' dark' : ''}`);
    wrap.append(inputs, out);
    block.append(wrap);
    page.append(block);
    const update = () => {
      const g = explainTheme(input.value, date.value ? { date: date.value } : {});
      why.innerHTML = whyText(g);
      out.replaceChildren(feedCard(input.value.trim() || 'Ohne Titel', g.theme, 1, { host: 'Mila', place: 'Bei Mila zu Hause' }));
      if (!g.theme) out.append(el('p', 'cv-empty-note', 'Без мотива карточка такая же, как сейчас.'));
    };
    input.addEventListener('input', update);
    date.addEventListener('input', update);
    update();
  }

  // 4 · the detection table
  if (show('table')) {
    const block = el('div', 'cv-block');
    block.id = 'cv-table';
    const rows = SAMPLE_TITLES.map((s) => ({ s, g: explainTheme(s.title, s.date ? { date: s.date } : {}) }));
    const ok = rows.filter((r) => r.g.theme === r.s.expect).length;
    block.append(
      el('h3', undefined, `4 · Таблица: ${rows.length} названий`),
      el('p', undefined, 'Та же таблица проверяется тестом (test/covers.test.ts). «Ловушка» — название, на котором небрежный список слов ошибся бы. Точность важнее охвата: лучше пусто, чем неправильная картинка.'),
      el('p', 'cv-sum', `Совпало ${ok} из ${rows.length}${ok === rows.length ? ' ✓' : ' — есть расхождения!'}`),
    );
    const table = el('table', 'cv-table');
    table.innerHTML = `<thead><tr><th>Название</th><th>Дата</th><th>Ожидается</th><th>Распознано</th><th></th><th>Почему / ловушка</th></tr></thead>`;
    const body = el('tbody');
    for (const { s, g } of rows) {
      const tr = el('tr');
      const good = g.theme === s.expect;
      const thumb = g.theme ? `<span class="cv-thumb cv-scope${dark ? ' dark' : ''}">${coverSvg(g.theme, 'thumb')}</span>` : '';
      tr.innerHTML = `<td>${esc(s.title)}</td><td>${s.date ?? ''}</td><td class="${s.expect ? '' : 'none'}">${s.expect ? esc(THEMES[s.expect].name.ru) : '— пусто'}</td>
<td class="${g.theme ? '' : 'none'}">${thumb}${g.theme ? esc(THEMES[g.theme].name.ru) : '— пусто'}</td><td class="${good ? 'ok' : 'bad'}">${good ? '✓' : '✗'}</td>
<td class="trap">${s.trap ? `⚠ ${esc(s.trap)} · ` : ''}${g.pattern ? `<code>${esc(g.pattern)}</code>` : g.via === 'none' ? 'ни одно слово не подошло' : ''}</td>`;
      body.append(tr);
    }
    table.append(body);
    block.append(table);
    page.append(block);
  }

  // 5 · the picker in the form
  if (show('picker')) {
    const block = el('div', 'cv-block');
    block.id = 'cv-picker';
    block.append(
      el('h3', undefined, '5 · Выбор в форме повода (PhotoField)'),
      el('p', undefined, 'Группа «Titelbild»: фото как сейчас + полоска мотивов. Подошло название — мотив уже стоит с пометкой «Automatisch», его видно сразу, до сохранения (хозяин видит ровно то, что увидят гости). Неверная догадка — один тап: другой мотив или «Kein Motiv». Своё фото всегда важнее мотива.'),
    );
    const row = el('div', 'cv-forms');
    for (const f of FORM_STATES) row.append(formMock(f.state, f.title, f.motif, dark, f.label));
    block.append(row);
    page.append(block);
  }

  // 6 · what already exists
  if (show('before')) {
    const block = el('div', 'cv-block');
    block.id = 'cv-before';
    block.append(
      el('h3', undefined, '6 · Какие картинки уже были (что ты, скорее всего, видел)'),
      el('p', undefined, 'Готовых обложек-«заставок» в приложении нет. Похоже, ты видел эти: (1) обложку демо-списка «Geburtstag» — торт со свечами и шариками; (2) фото демо-повода «Annas Einweihung»; (3) Помпона в колпаке из вариантов иконки; ещё (4) картинку «Brettspiel» в каталоге «Ideen» (features/gifts/art, BoardgameArt) и значки списков cake / game. Всё это нарисовано нами (без чужих лицензий), но webp — растровые: тёмную тему не умеют, каждая 7–46 КБ. Новые — последние две: тот же дух, но SVG, 1–3 КБ (gzip) и сами перекрашиваются в тёмной теме.'),
    );
    const row = el('div', 'cv-before');
    for (const b of BEFORE) {
      const fig = el('figure');
      fig.innerHTML = `<img alt="" src="${b.url}" loading="lazy"><figcaption>${esc(b.label)}</figcaption>`;
      row.append(fig);
    }
    for (const id of ['birthday', 'gamenight'] as const) {
      const fig = el('figure');
      fig.innerHTML = `<div class="cv-cover-only cv-scope${dark ? ' dark' : ''}">${coverSvg(id)}</div><figcaption>Новое: ${esc(THEMES[id].name.ru)} (SVG, этот прототип)</figcaption>`;
      row.append(fig);
    }
    block.append(row);
    page.append(block);
  }

  markReady();
}
