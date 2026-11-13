/**
 * Promo video storyboard (Felix 25.10, docs/design/2026-10-25-promo-video-plan.md) — GALLERY-ONLY, still frames.
 * Nine key frames of the two clips: the main film «Pompon & Tapsi plan a party» (1–6) and «Add to Home Screen»
 * on iPhone (7–9). Each frame is the 1080 × 1920 video frame at one third (360 × 640). English captions
 * (Felix: "на англ, чтобы было для всех"); the install steps reuse the app's own words
 * (apps/web/src/locales/en/onboarding.json, homescreen_*). Nothing moves yet: motion comes in stage 2, scene by
 * scene, after Felix approves these frames. All people, names and products are made up.
 *
 *   ?screens=promo [&frame=1..9] [&safe=1]   &safe=1 shows the zones Reels/TikTok cover with their own buttons
 */
import { Bunny, Hamster, type BunnyPose, type EyeMode, type HamsterPose } from '../src/index';
import { COSTUMES, GIFT_BOX, el, icon, ownPaws } from './welcome-screens';

// ---- styles (scoped to .ps) -----------------------------------------------------------------------------

export const CSS_TEXT = `
/* the promo pages are always light, like the app's main palette (Felix 25.10), whatever the system theme */
:root { color-scheme: light; --bg: #F4F1EC; --card: rgba(255, 255, 255, .72); --text: #1D1D1F; --text-2: #6E6E73; --tile: rgba(0, 0, 0, .05);
  --pf-grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .42 0 0 0 0 .3 0 0 0 0 .18 0 0 0 .075 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23g)'/%3E%3C/svg%3E"); }
.ps { max-width: 1240px; margin: 28px auto 40px; padding: 0 12px; }
.ps > h2 { margin: 4px 6px; font-size: 24px; letter-spacing: -.02em; }
.ps > p { margin: 0 6px 12px; font-size: 14px; color: var(--text-2); max-width: 860px; }
.ps > h3 { margin: 28px 6px 12px; font-size: 18px; }
.ps-controls { margin: 6px 6px 16px; font-size: 13px; color: var(--text-2); display: flex; gap: 8px; align-items: center; }
.ps-row { display: flex; flex-wrap: wrap; gap: 26px 22px; justify-content: flex-start; align-items: flex-start; padding: 0 6px; }
.ps-col { width: 360px; display: flex; flex-direction: column; gap: 8px; }
.ps-col > b { font-size: 14px; }
.ps-col > small { font-size: 13px; line-height: 1.4; color: var(--text-2); }
.ps-col > small em { font-style: normal; color: #B65F1A; font-weight: 600; }
.ps-frame { position: relative; width: 360px; height: 640px; border-radius: 16px; overflow: hidden; flex: none; isolation: isolate;
  /* the film's light variant (promo/scenes.ts BACKDROP.light): near-white with light warm glows — the app's
     beige page looked "like a swamp" full-screen (Felix 25.10) */
  background-image: radial-gradient(78% 36% at -4% -2%, rgba(255,193,146,.34) 0%, transparent 72%),
    radial-gradient(70% 34% at 104% 30%, rgba(248,180,170,.24) 0%, transparent 72%), radial-gradient(84% 34% at 4% 98%, rgba(255,205,160,.26) 0%, transparent 72%),
    radial-gradient(72% 30% at 102% 80%, rgba(214,204,246,.24) 0%, transparent 72%), linear-gradient(180deg, #FFFFFF 0%, #FFFCF8 55%, #FFF7EF 100%);
  box-shadow: 0 18px 44px rgba(40, 25, 10, .18), inset 0 0 0 1px rgba(70,45,20,.06);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, system-ui, sans-serif; color: #2A231C; }
.ps-frame * { box-sizing: border-box; }
.ps-cap { position: absolute; left: 22px; right: 22px; top: 54px; z-index: 6; margin: 0; text-align: center; font-size: 27px; line-height: 1.13; font-weight: 780; letter-spacing: -.022em; text-wrap: balance; }
.ps-cap small { display: block; margin-top: 8px; font-size: 15px; line-height: 1.3; font-weight: 520; letter-spacing: 0; color: #62554A; }
.ps-safe { position: absolute; inset: 0; z-index: 9; pointer-events: none; display: none; }
.ps.safe .ps-safe { display: block; }
.ps-safe i { position: absolute; background: repeating-linear-gradient(45deg, rgba(220,60,60,.13) 0 6px, transparent 6px 12px); outline: 1px dashed rgba(200,50,50,.5); }
.ps-m { position: absolute; z-index: 4; }
.ps-fx { position: absolute; z-index: 5; pointer-events: none; }
/* a small phone of the app inside the frame */
.ps-phone { position: absolute; z-index: 2; width: 206px; height: 420px; border-radius: 30px; overflow: hidden; background: #FBF7F0;
  box-shadow: 0 0 0 6px #1D1D1F, 0 22px 44px rgba(40,25,10,.22); }
.ps-phone.small { width: 150px; height: 300px; border-radius: 24px; box-shadow: 0 0 0 5px #1D1D1F, 0 16px 34px rgba(40,25,10,.2); }
.ps-bar { height: 30px; }
.ps-ph { padding: 0 14px; }
.ps-ph h4 { margin: 2px 0 10px; font-size: 18px; line-height: 1.15; font-weight: 760; letter-spacing: -.015em; }
.ps-phone.small .ps-ph { padding: 0 10px; }
.ps-phone.small h4 { font-size: 14px; margin-bottom: 8px; }
.ps-card { border-radius: 16px; background: #fff; box-shadow: 0 4px 14px rgba(70,45,20,.08), inset 0 0 0 1px rgba(70,45,20,.05); }
.ps-wish { padding: 8px; }
.ps-art { display: grid; place-items: center; height: 92px; border-radius: 11px; background: linear-gradient(160deg, #FDE8D0, #F9D3C6); color: #C2661E; }
.ps-art svg { width: 46px; height: 46px; }
.ps-phone.small .ps-art { height: 70px; }
.ps-phone.small .ps-art svg { width: 36px; height: 36px; }
.ps-wish b { display: block; margin: 7px 2px 0; font-size: 13px; line-height: 1.2; }
.ps-wish span { display: block; margin: 2px 2px 0; font-size: 12px; color: #B65F1A; font-weight: 650; }
.ps-pill { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; padding: 6px 9px; border-radius: 999px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.ps-pill svg { width: 14px; height: 14px; }
.ps-pill.ok { background: #E3F4EA; color: #237A4B; }
.ps-pill.btn { background: #F0A04B; color: #2A1A0B; }
.ps-who { position: absolute; z-index: 3; font-size: 13px; font-weight: 700; color: #62554A; text-align: center; }
.ps-field { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; padding: 9px 10px; border-radius: 12px; background: #fff; box-shadow: inset 0 0 0 1.5px #F0A04B; font-size: 12px; color: #62554A; }
.ps-field svg { width: 15px; height: 15px; color: #C2661E; flex: none; }
.ps-cal { padding: 10px 10px 8px; }
.ps-cal b { display: block; margin: 0 2px 6px; font-size: 12.5px; }
.ps-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; font-size: 10px; text-align: center; color: #62554A; }
.ps-days i { font-style: normal; display: grid; place-items: center; height: 19px; border-radius: 7px; }
.ps-days i.hd { color: #A0948A; font-weight: 600; }
.ps-days i.on { background: #F0A04B; color: #2A1A0B; font-weight: 800; box-shadow: 0 0 0 3px rgba(240,160,75,.3); }
.ps-occ { display: flex; align-items: center; gap: 9px; margin-top: 10px; padding: 9px; }
.ps-occ i { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; background: #FDE8D0; color: #C2661E; flex: none; }
.ps-occ i svg { width: 20px; height: 20px; }
.ps-occ b { font-size: 12.5px; line-height: 1.2; } .ps-occ small { display: block; font-size: 11px; color: #85786A; font-weight: 500; }
.ps-avatar { position: absolute; z-index: 3; display: grid; place-items: center; width: 58px; height: 58px; border-radius: 50%; font-size: 22px; font-weight: 800; color: #fff; box-shadow: 0 0 0 4px #fff, 0 10px 22px rgba(70,45,20,.18); }
.ps-link { position: absolute; z-index: 3; left: 50%; transform: translateX(-50%); padding: 9px 14px; border-radius: 999px; background: rgba(255,255,255,.85); box-shadow: 0 6px 18px rgba(70,45,20,.12); font-size: 13px; font-weight: 650; color: #7A4A1C; white-space: nowrap; }
.ps-brand { position: absolute; z-index: 6; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.ps-brand img { width: 66px; height: 66px; border-radius: 16px; box-shadow: 0 10px 24px rgba(240,160,75,.35); }
.ps-brand b { font-size: 22px; letter-spacing: -.02em; } .ps-brand span { font-size: 13px; color: #62554A; } .ps-brand u { text-decoration: none; font-size: 15px; font-weight: 700; color: #9A4A12; }
/* the browser (drawn by us, no real UI copied) */
.ps-site { padding: 18px 14px 0; text-align: center; }
.ps-site b { display: block; font-size: 16px; line-height: 1.2; font-weight: 760; }
.ps-site .btns { margin-top: 112px; display: flex; flex-direction: column; gap: 7px; }
.ps-site .btns i { display: block; height: 26px; border-radius: 999px; background: #fff; box-shadow: inset 0 0 0 1px rgba(70,45,20,.15); }
.ps-site .btns i.main { background: #F0A04B; box-shadow: none; }
.ps-browser { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 8px 10px 16px; background: rgba(246,242,236,.94); box-shadow: 0 -1px 0 rgba(70,45,20,.1); }
.ps-url { flex: 1; padding: 7px 10px; border-radius: 12px; background: rgba(42,35,28,.07); font-size: 12px; font-weight: 600; text-align: center; }
.ps-share { position: relative; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: #2F6FE0; }
.ps-share svg { width: 21px; height: 21px; }
.ps-share.hot::after, .ps-row-hot::after { content: ''; position: absolute; inset: -5px; border-radius: 14px; box-shadow: 0 0 0 3px #F0A04B, 0 0 0 9px rgba(240,160,75,.28); }
.ps-sheet { position: absolute; left: 6px; right: 6px; bottom: 6px; z-index: 3; padding: 12px 8px 10px; border-radius: 22px; background: rgba(250,248,245,.97); box-shadow: 0 -10px 30px rgba(40,25,10,.18); }
.ps-sheet b.t { display: block; margin: 0 6px 9px; font-size: 12px; color: #85786A; font-weight: 600; }
.ps-sheet .r { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 10px 10px; border-radius: 12px; font-size: 12.5px; font-weight: 600; background: #fff; margin-top: 4px; }
.ps-sheet .r svg { width: 17px; height: 17px; color: #62554A; }
.ps-row-hot { position: relative; }
.ps-home { position: absolute; inset: 0; padding: 40px 14px 0; background: linear-gradient(170deg, #9FB6E8 0%, #C9B8E6 55%, #F2C9C0 100%); }
.ps-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 12px; }
.ps-app { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 9px; color: #fff; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.25); }
.ps-app i { display: block; width: 38px; height: 38px; border-radius: 10px; background: rgba(255,255,255,.55); }
.ps-app img { width: 38px; height: 38px; border-radius: 10px; box-shadow: 0 0 0 2.5px #fff, 0 6px 16px rgba(240,160,75,.6); }
.ps-star { width: 26px; height: 26px; color: #FFD166; filter: drop-shadow(0 2px 4px rgba(200,140,40,.35)); }
.ps-drop { width: 18px; height: 24px; }
`;

// ---- small drawings -------------------------------------------------------------------------------------

const ICONS: Record<string, string> = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  share: '<path d="M12 3.5v11"/><path d="m8 7.5 4-4 4 4"/><path d="M8.5 10.5H7A1.5 1.5 0 0 0 5.5 12v7A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5"/>',
  addHome: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15.5V6.5A1.5 1.5 0 0 1 6.5 5H15"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.5L7 20Z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
};
export const icon2 = (name: string) => ICONS[name] ? `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>` : icon(name);
export const STAR = '<svg class="ps-star" viewBox="0 0 24 24"><path d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8Z" fill="currentColor"/></svg>';
export const DROP = '<svg class="ps-drop" viewBox="0 0 18 24"><path d="M9 1C6 7 2 11 2 15.5A7 7 0 0 0 16 15.5C16 11 12 7 9 1Z" fill="#BFE0FF" stroke="#7FB3EA" stroke-width="1.4"/><path d="M6 15.5a3 3 0 0 0 2.4 3" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>';
/** An opened gift with the same pair of headphones popping out (the hook: two identical gifts). */
const OPEN_GIFT = `<svg viewBox="-62 -132 124 136" width="150" height="165" aria-hidden="true">
  <g transform="translate(0 2)">${GIFT_BOX.replace('class="ws-lid"', 'class="ws-lid" transform="translate(30 -58) rotate(24 0 -47)"')}</g>
  <g transform="translate(-21 -94) scale(1.75)" fill="none" stroke="#5B4636" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13.5" width="4.5" height="7" rx="2" fill="#6C8CFF"/><rect x="16.5" y="13.5" width="4.5" height="7" rx="2" fill="#6C8CFF"/></g>
</svg>`;
/** A small occasion card the bunny carries in its mouth (mascot units: the mouth is at about y -74). */
export const MOUTH_CARD = `<g transform="translate(4 -78) rotate(-8)">
  <rect x="-34" y="0" width="68" height="44" rx="9" fill="#fff" stroke="rgba(70,45,20,.12)"/>
  <rect x="-27" y="9" width="18" height="18" rx="5" fill="#FDE8D0"/>
  <path d="M-25 23h14v-5a1.3 1.3 0 0 0-1.3-1.3h-11.4A1.3 1.3 0 0 0-25 18Z M-18 16.7v-3" fill="none" stroke="#C2661E" stroke-width="1.6" stroke-linecap="round"/>
  <rect x="-4" y="10" width="30" height="5" rx="2.5" fill="#2A231C" opacity=".75"/><rect x="-4" y="20" width="22" height="4" rx="2" fill="#B65F1A" opacity=".7"/>
  <rect x="-34" y="0" width="68" height="7" rx="3.5" fill="#F0A04B" opacity=".9"/></g>`;
/** A gift hidden behind Tapsi's back: only its right side shows. */
export const GIFT_BEHIND = `<g transform="translate(74 -46) rotate(14)">${GIFT_BOX}</g>`;
/** Worried brows (up towards the middle) for the hook; the pout mouth is the puppet's own. */
export const WORRIED = '<g fill="none" stroke="var(--mascot-eye)" stroke-width="2.4" stroke-linecap="round"><path d="M-42 -105 L-27 -111"/><path d="M27 -111 L42 -105"/></g>';

// ---- helpers --------------------------------------------------------------------------------------------

interface Frame { root: HTMLElement; mascots: { destroy(): void }[] }

function frame(caption: string, sub?: string, capStyle = ''): Frame {
  const root = el('div', 'ps-frame');
  root.innerHTML = `<p class="ps-cap" style="${capStyle}">${caption}${sub ? `<small>${sub}</small>` : ''}</p>
    <div class="ps-safe" aria-hidden="true"><i style="left:0;right:0;bottom:0;height:20%"></i><i style="right:0;top:42%;bottom:20%;width:15%"></i><i style="left:0;right:0;top:0;height:6%"></i></div>`;
  return { root, mascots: [] };
}

function add(f: Frame, html: string, style: string, cls = 'ps-fx'): HTMLElement {
  const node = el('div', cls, html);
  node.style.cssText = style;
  f.root.append(node);
  return node;
}

/** Feet of the puppet at (x, y) of the frame; `size` = stage width. viewBox: bunny 400×260 (feet y 246),
 *  hamster 400×250 (feet y 238). */
function bunny(f: Frame, x: number, feetY: number, size: number, opts: { pose?: BunnyPose; eyes?: EyeMode; puff?: number; flip?: boolean; extra?: string; extraWhere?: 'front' | 'back' | 'paws' } = {}): Bunny {
  const host = add(f, '', `left:${x - size / 2}px;top:${feetY - (246 / 400) * size}px;width:${size}px;${opts.flip ? 'transform:scaleX(-1)' : ''}`, 'ps-m');
  const b = new Bunny(host, { coat: 'fawn', ears: 'lop', size, idle: false, reducedMotion: 'force', interactive: false });
  if (opts.pose) b.pose(opts.pose);
  if (opts.eyes) b.setEyes(opts.eyes);
  if (opts.puff) b.setPuff(opts.puff);
  if (opts.extra) wear(b.root, opts.extra, opts.extraWhere ?? 'front');
  if (opts.extraWhere === 'paws') ownPaws(b, false);
  f.mascots.push(b);
  return b;
}

function hamster(f: Frame, x: number, feetY: number, size: number, opts: { pose?: HamsterPose; eyes?: EyeMode; puff?: number; flip?: boolean; extra?: string; extraWhere?: 'front' | 'back' } = {}): Hamster {
  const host = add(f, '', `left:${x - size / 2}px;top:${feetY - (238 / 400) * size}px;width:${size}px;${opts.flip ? 'transform:scaleX(-1)' : ''}`, 'ps-m');
  const h = new Hamster(host, { coat: 'golden', size, idle: false, reducedMotion: 'force', interactive: false });
  if (opts.pose) h.pose(opts.pose);
  if (opts.eyes) h.setEyes(opts.eyes);
  if (opts.puff) h.setPuff(opts.puff);
  if (opts.extra) wear(h.root, opts.extra, opts.extraWhere ?? 'front');
  f.mascots.push(h);
  return h;
}

/** Extra markup in the puppet's breathing group: in front of everything, behind the body, or before its paws. */
function wear(root: ParentNode, markup: string, where: 'front' | 'back' | 'paws'): void {
  const breathe = root.querySelector('.breathe');
  if (!breathe) return;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.innerHTML = markup;
  if (where === 'back') breathe.prepend(g);
  else if (where === 'paws') breathe.insertBefore(g, breathe.querySelector('.tp'));
  else breathe.append(g);
}

export const ICON_URL = new URL('../../../docs/brand/bunprise-icon.svg', import.meta.url).href;

function wishCard(small = false): string {
  return `<div class="ps-card ps-wish"><div class="ps-art">${icon('headphones')}</div><b>Wireless headphones</b><span>€ 79${small ? '' : ' · from the shop'}</span></div>`;
}

// ---- the nine frames ------------------------------------------------------------------------------------

function f1Hook(): Frame {
  const f = frame('The same gift.<br>Twice?', 'Anna’s birthday, last year …');
  add(f, OPEN_GIFT, 'left:14px;top:226px');
  add(f, OPEN_GIFT, 'left:196px;top:226px');
  add(f, '<span style="font-size:30px;font-weight:800;color:#B65F1A">=</span>', 'left:170px;top:322px');
  const tapsi = hamster(f, 180, 580, 200, { eyes: 'normal', extra: WORRIED });
  tapsi.root.querySelector<SVGElement>('.pout')?.style.setProperty('opacity', '1');
  tapsi.root.querySelector<SVGElement>('.mouth')?.style.setProperty('opacity', '0');
  add(f, DROP, 'left:238px;top:452px');
  return f;
}

function f2Occasion(): Frame {
  const f = frame('Plan the occasion<br>in seconds.');
  add(f, `<div class="ps-bar"></div><div class="ps-ph"><h4>March</h4>
    <div class="ps-card ps-cal"><b>2027</b><div class="ps-days">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<i class="hd">${d}</i>`).join('')}
      ${Array.from({ length: 31 }, (_, i) => `<i class="${i + 1 === 14 ? 'on' : ''}">${i + 1}</i>`).join('')}</div></div>
    <div class="ps-card ps-occ" style="opacity:.35"><i>${icon('plus')}</i><b>New occasion</b></div></div>`, 'left:34px;top:170px', 'ps-phone');
  bunny(f, 262, 586, 210, { eyes: 'happy', extra: MOUTH_CARD });
  return f;
}

function f3Wishes(): Frame {
  const f = frame('Paste a link.', 'Picture and price fill in by themselves.');
  add(f, `<div class="ps-bar"></div><div class="ps-ph"><h4>Anna’s wishes</h4>
    <div class="ps-field">${icon2('link')}<span>https://…/headphones</span></div>${wishCard()}</div>`, 'left:122px;top:160px', 'ps-phone');
  hamster(f, 96, 590, 200, { eyes: 'happy', puff: 1.35 });
  add(f, STAR, 'left:150px;top:350px;transform:rotate(-12deg)');
  add(f, STAR, 'left:118px;top:394px;transform:scale(.8) rotate(10deg)');
  add(f, STAR, 'left:96px;top:432px;transform:scale(.65)');
  return f;
}

function f4Invite(): Frame {
  const f = frame('Invite your friends<br>with one link.');
  const friends = [['B', '#6C8CFF', 46, 214], ['M', '#FF7A9A', 151, 186], ['L', '#7FD1AE', 256, 214]] as const;
  for (const [letter, color, x, y] of friends) add(f, letter, `left:${x}px;top:${y}px;background:${color}`, 'ps-avatar');
  add(f, '<svg width="360" height="140" viewBox="0 0 360 140" aria-hidden="true"><path d="M180 132 C150 96 100 82 76 64 M180 132 C180 100 180 90 180 62 M180 132 C210 96 260 82 284 64" fill="none" stroke="#C9A27E" stroke-width="2.2" stroke-dasharray="3 7" stroke-linecap="round"/></svg>', 'left:0;top:248px');
  bunny(f, 180, 560, 236, { eyes: 'happy', extra: COSTUMES.invite.paws ?? '', extraWhere: 'paws' });
  add(f, 'bunprise.de/i/…', 'top:574px', 'ps-link');
  return f;
}

function f5Secret(): Frame {
  const f = frame('Reserve in secret.', 'Anna sees nothing.');
  add(f, 'Ben sees', 'left:22px;top:150px;width:150px', 'ps-who');
  add(f, 'Anna sees', 'left:188px;top:150px;width:150px', 'ps-who');
  add(f, `<div class="ps-bar"></div><div class="ps-ph"><h4>Anna’s wishes</h4>${wishCard(true)}<div class="ps-pill ok">${icon('check')}Reserved by you</div></div>`, 'left:22px;top:176px', 'ps-phone small');
  add(f, `<div class="ps-bar"></div><div class="ps-ph"><h4>My wishes</h4>${wishCard(true)}</div>`, 'left:188px;top:176px', 'ps-phone small');
  hamster(f, 180, 600, 176, { eyes: 'happy', extra: GIFT_BEHIND, extraWhere: 'back' });
  return f;
}

function f6Finale(): Frame {
  const f = frame('Dream big!', undefined, 'top:70px;font-size:40px');
  bunny(f, 118, 380, 200, { eyes: 'happy', extra: COSTUMES.birthday.front });
  hamster(f, 252, 368, 150, { eyes: 'happy', pose: 'wave' });
  const colors = ['#6C8CFF', '#FF7A9A', '#FFD166', '#7FD1AE', '#F0A04B'];
  for (let i = 0; i < 16; i++) {
    const x = 30 + ((i * 97) % 300);
    const y = 140 + ((i * 53) % 110);
    add(f, '', `left:${x}px;top:${y}px;width:${i % 3 ? 9 : 7}px;height:${i % 3 ? 5 : 7}px;border-radius:${i % 3 ? '2px' : '50%'};background:${colors[i % 5]};transform:rotate(${i * 37}deg)`);
  }
  add(f, `<img src="${ICON_URL}" alt=""><b>Bunprise</b><span>Plans and wishes – together with friends</span><u>bunprise.de</u>`, 'top:404px', 'ps-brand');
  return f;
}

function iphone(f: Frame, inner: string): void {
  add(f, `<div class="ps-bar"></div>${inner}`, 'left:77px;top:176px', 'ps-phone');
}

const SITE = `<div class="ps-site"><b>Plans and wishes – together with friends</b><div class="btns"><i></i><i></i><i class="main"></i></div></div>`;

function f7Share(): Frame {
  const f = frame('On iPhone: tap “Share”', 'in the toolbar or in the “…” menu');
  iphone(f, `${SITE}<div class="ps-browser"><div class="ps-url">bunprise.de</div><div class="ps-share hot">${icon2('share')}</div></div>`);
  bunny(f, 52, 632, 140, { pose: 'wave', eyes: 'happy' });
  return f;
}

function f8Add(): Frame {
  const f = frame('Choose<br>“Add to Home Screen”');
  iphone(f, `${SITE}<div class="ps-sheet"><b class="t">bunprise.de</b>
    <div class="r"><span>Copy</span>${icon2('copy')}</div>
    <div class="r"><span>Add Bookmark</span>${icon2('bookmark')}</div>
    <div class="r ps-row-hot"><span>Add to Home Screen</span>${icon2('addHome')}</div>
    <div class="r"><span>Find on Page</span>${icon2('search')}</div></div>`);
  bunny(f, 52, 632, 140, { pose: 'wave', eyes: 'happy' });
  return f;
}

function f9Done(): Frame {
  const f = frame('Tap “Add” – done!', 'Bunprise is on your Home Screen, just like an app.');
  const tiles = Array.from({ length: 16 }, (_, i) => i === 9
    ? `<div class="ps-app"><img src="${ICON_URL}" alt=""><span>Bunprise</span></div>`
    : `<div class="ps-app"><i></i><span>&nbsp;</span></div>`).join('');
  iphone(f, `<div class="ps-home"><div class="ps-grid">${tiles}</div></div>`);
  // Pompon sits on the new icon (tile 10 = row 3, column 2)
  bunny(f, 77 + 14 + 18 + 50 + 4, 176 + 40 + 2 * 66 + 15, 74, { eyes: 'happy' });
  return f;
}

const FRAMES: readonly { title: string; note: string; make: () => Frame }[] = [
  { title: '1 · Крючок · 0–3 с', note: 'Две одинаковые коробки открываются одновременно: в обеих те же наушники. Тапси смотрит то на одну, то на другую, капелька пота. <em>Новое движение:</em> закрыть глаза лапками.', make: f1Hook },
  { title: '2 · Событие · 3–10 с', note: 'В календаре загорается 14-е, появляется карточка «Anna’s birthday». Помпон хватает её зубами и прыжками относит на этот день (готовая сцена «carry»).', make: f2Occasion },
  { title: '3 · Желания · 10–17 с', note: 'Ссылка вставляется в поле, карточка сама собирается: картинка, название, цена. Звёздочки-желания летят Тапси за щёки, щёки раздуваются (готовые щёки).', make: f3Wishes },
  { title: '4 · Приглашение · 17–22 с', note: 'Помпон держит конверт; ссылка-пилюля отрывается и улетает по пунктиру к трём друзьям, их кружки по очереди подпрыгивают.', make: f4Invite },
  { title: '5 · Тайная бронь · 22–31 с', note: 'Слева Бен нажимает «I’ll get this» → «Reserved by you». Справа у Анны то же желание без изменений. Тапси прячет подарок за спину. <em>Новое:</em> подмигнуть.', make: f5Secret },
  { title: '6 · Финал · 31–36 с', note: 'Конфетти, Помпон в колпаке и Тапси машут, оба подпрыгивают. Снизу выезжают иконка, имя, строка и адрес. Можно добавить тизер манги: «How did Tapsi find us? Soon.»', make: f6Finale },
  { title: '7 · Установка 1 · iPhone', note: 'Наш собственный упрощённый браузер (не копия Safari). Кнопка «Поделиться» пульсирует кольцом, Помпон показывает на неё лапкой. Слова — из шага «Add to Home Screen» в приложении.', make: f7Share },
  { title: '8 · Установка 2', note: 'Снизу выезжает лист; строка «Add to Home Screen» подсвечивается и нажимается. Перед рендером проверить названия на настоящем iPhone.', make: f8Add },
  { title: '9 · Установка 3', note: 'Главный экран: иконка Bunprise «вырастает» на своём месте, Помпон запрыгивает на неё и садится. <em>Новое:</em> прыжок на иконку. Потом — тот же клип для Android (меню ⋮ → «Install app»).', make: f9Done },
];

export function promoStoryboardGallery(app: HTMLElement, query: URLSearchParams): void {
  const single = Number(query.get('frame')) || 0;
  app.replaceChildren();
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);
  const section = el('section', 'ps');
  if (query.get('safe') === '1') section.classList.add('safe');
  section.innerHTML = `<h2>Ролик: раскадровка (25.10)</h2>
    <p>Ключевые кадры двух роликов, неподвижно. Кадр = видео 1080 × 1920, показан в масштабе 1 : 3. Подписи — английские. Под каждым кадром: что в нём будет двигаться. Только в галерее; движение — следующим шагом, после одобрения. План: docs/design/2026-10-25-promo-video-plan.md</p>`;
  const controls = el('label', 'ps-controls', '<input type="checkbox"> показать зоны, которые закрывают кнопки Reels / TikTok');
  const safe = controls.querySelector('input');
  if (safe) {
    safe.checked = section.classList.contains('safe');
    safe.addEventListener('change', () => section.classList.toggle('safe', safe.checked));
  }
  section.append(controls);
  const groups = [{ title: 'Основной ролик «Pompon & Tapsi plan a party» (~36 с)', from: 0, to: 6 }, { title: 'Клип «Add to Home Screen» (iPhone, ~18 с)', from: 6, to: 9 }];
  const all: Frame[] = [];
  for (const group of groups) {
    const items = FRAMES.slice(group.from, group.to).filter((_, i) => !single || single === group.from + i + 1);
    if (!items.length) continue;
    section.append(el('h3', undefined, group.title));
    const row = el('div', 'ps-row');
    for (const item of items) {
      const col = el('div', 'ps-col');
      const made = item.make();
      all.push(made);
      col.append(el('b', undefined, item.title), made.root, el('small', undefined, item.note));
      row.append(col);
    }
    section.append(row);
  }
  app.append(section);
  window.addEventListener('pagehide', () => all.forEach((f) => f.mascots.forEach((m) => m.destroy())), { once: true });
}
