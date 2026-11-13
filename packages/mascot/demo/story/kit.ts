/**
 * The comic's panel kit (26.10, GALLERY-ONLY prototype, docs/design/2026-10-26-manga-episode-1.md).
 *
 * Since 31.10 the kit itself (Panel, Actor, EZ, the ink puppets) lives in the package — src/comic/kit.ts, one source
 * for the app's reader and this gallery — and is re-exported here unchanged. Only WORLD_CSS stays here: it styles the
 * text of the v1 panels and the v2 / v3 strip (the v4 manga brings its own CSS, src/comic/episode1.ts MANGA_CSS).
 */

export { Actor, EZ, PH, PW, Panel } from '../../src/comic/kit';
export type { ActorOptions, InkTone, Kind } from '../../src/comic/kit';

/** Text in a panel / the strip: real text (translatable, readable by screen readers), drawn like a comic. */
export const WORLD_CSS = `
.sp-world { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Roboto, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.sp-world .sp-box { position: absolute; z-index: 9; max-width: 230px; padding: 7px 11px 8px; background: #FFF6E6; color: #2A231C; border-radius: 4px;
  box-shadow: 0 0 0 2px #2A231C, 3px 4px 0 rgba(0,0,0,.35); font-size: 15.5px; line-height: 1.22; font-weight: 680; letter-spacing: -.005em; text-wrap: balance; }
.sp-world .sp-bubble { position: absolute; z-index: 9; max-width: 190px; padding: 8px 13px 9px; background: #FFFFFF; color: #2A231C; border-radius: 20px;
  box-shadow: 0 0 0 2px #2A231C; font-size: 15.5px; line-height: 1.2; font-weight: 650; text-align: center; text-wrap: balance; }
.sp-world .sp-bubble::after { content: ''; position: absolute; width: 14px; height: 14px; background: #FFFFFF; box-shadow: 2px 2px 0 0 #2A231C;
  left: var(--tail-x, 30%); bottom: -7px; transform: rotate(var(--tail-r, 45deg)); }
.sp-world .sp-bubble.up::after { bottom: auto; top: -7px; box-shadow: -2px -2px 0 0 #2A231C; }
.sp-world .sp-bubble.whisper { border-radius: 20px; box-shadow: 0 0 0 2px #2A231C; outline: 2px dashed rgba(42,35,28,.0); background: #FFFFFF; font-style: italic; font-weight: 600; }
.sp-world .sp-sfx { position: absolute; z-index: 9; font-size: 34px; line-height: 1; font-weight: 900; font-style: italic; letter-spacing: .01em; color: #FFC46B;
  -webkit-text-stroke: 5px #2A231C; paint-order: stroke fill; transform: rotate(var(--r, -8deg)); white-space: nowrap; }
`;
