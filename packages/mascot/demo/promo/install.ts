/**
 * «Add to Home Screen» instructions (Felix 25.10: «сделай видео инструкцию»; storyboard frames 7–9 of
 * promo-storyboard.ts), one clip for iPhone (Safari) and one for Android (Chrome). Portrait 360 × 640, dark,
 * English captions. The browser, sheets, dialog and home screen are OUR OWN simplified drawings — no Apple or
 * Google logos, no copied system UI. iPhone captions are the app's own strings (apps/web/src/locales/en/
 * onboarding.json homescreen_*); Android has no strings in the app yet, its captions follow the same style.
 * ⚠️ Menu names change between OS versions: check them on a real phone before publishing.
 */
import { ICON_URL, icon2 } from '../promo-storyboard';
import { EZ, Film, actor, blinks, caption, confetti, happy, hop, look, measure, tap, type Actor } from './film';
import { backdrop } from './scenes';

export const INSTALL_IOS_LENGTH = 18;
export const INSTALL_ANDROID_LENGTH = 17.2;

const DOTS = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>';
const CHEVRONS = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

/** The phone (230 × 470) with its screen; returns the screen to put layers into. */
function phone(film: Film): { phone: HTMLElement; screen: HTMLElement } {
  const el = film.node('<div class="pfi-screen"></div>', 'left:65px;top:164px;width:230px;height:466px', 'pfi-phone');
  return { phone: el, screen: el.querySelector('.pfi-screen') as HTMLElement };
}

/** A layer of the screen (absolutely placed inside it). */
function layer(film: Film, screen: HTMLElement, cls: string, html: string): HTMLElement {
  return film.node(html, 'inset:0', `pfi-layer ${cls}`, screen);
}

/** The Bunprise start page, as the site looks in the browser (simplified). */
function site(film: Film, screen: HTMLElement, top: number): HTMLElement {
  return layer(film, screen, 'pfi-site', `<div style="padding-top:${top}px"><img src="${ICON_URL}" alt=""><b>Plans and wishes –<br>together with friends</b><p>One occasion, one wishlist, gifts reserved in secret.</p>
    <i class="pfi-btn"></i><i class="pfi-btn"></i><i class="pfi-btn main"></i></div>`);
}

/** The home screen: a grid of plain tiles, one empty place where the Bunprise icon appears. */
function home(film: Film, screen: HTMLElement): { el: HTMLElement; slot: HTMLElement } {
  const tiles = Array.from({ length: 20 }, (_, i) => i === 9
    ? '<div class="pfi-app pfi-slot"><img src="' + ICON_URL + '" alt=""><span>Bunprise</span></div>'
    : `<div class="pfi-app"><i style="background:${['#5B6CBF', '#C76B6B', '#4F9A7C', '#C9974A', '#7A68B8'][i % 5]}"></i><span>&nbsp;</span></div>`).join('');
  const el = layer(film, screen, 'pfi-home', `<div class="pfi-grid">${tiles}</div>`);
  return { el, slot: el.querySelector('.pfi-slot') as HTMLElement };
}

/** A ring that pulses out of an element twice (look here). */
function pulse(film: Film, at: { x: number; y: number; w: number; h: number }, t: number, radius = 14): void {
  for (const k of [0, 0.7]) {
    const ring = film.node('', `left:${at.x - at.w / 2 - 4}px;top:${at.y - at.h / 2 - 4}px;width:${at.w + 8}px;height:${at.h + 8}px;border-radius:${radius}px;box-shadow:0 0 0 3px #F0A04B;z-index:7`, 'pf');
    film.track(ring, { o: 0, s: 1 }).set(t + k, { o: 1 }).move(t + k, t + k + 0.65, { o: 0, s: 1.35 }, EZ.out);
  }
}

/** A highlight that stays around an element from t0 to t1. */
function outline(film: Film, at: { x: number; y: number; w: number; h: number }, t0: number, t1: number, radius = 12): void {
  const ring = film.node('', `left:${at.x - at.w / 2 - 4}px;top:${at.y - at.h / 2 - 4}px;width:${at.w + 8}px;height:${at.h + 8}px;border-radius:${radius}px;box-shadow:0 0 0 3px #F0A04B, 0 0 18px rgba(240,160,75,.45);z-index:7`, 'pf');
  film.track(ring, { o: 0, s: 1.08 }).move(t0, t0 + 0.3, { o: 1, s: 1 }, EZ.out).move(t1, t1 + 0.2, { o: 0 }, EZ.linear);
}

/** An element is pressed (a short squeeze that springs back). */
function press(film: Film, el: HTMLElement, t: number): void {
  film.track(el, { s: 1 }).path(t, [[t + 0.08, { s: 0.94 }, EZ.out], [t + 0.4, { s: 1 }, EZ.bouncy]]);
}

/** Pompon, the guide: hops in from the left at the bottom, waves hello. */
function guide(film: Film): Actor {
  const p = actor(film, 'bunny', 60, 632, 150, 9);
  p.travel.set(0, { x: -170 });
  hop(p, 0.9, 85, 0, { h: 30, d: 0.4 });
  hop(p, 1.35, 85, 0, { h: 24, d: 0.38 });
  p.pawR.move(1.9, 2.15, { x: 22, y: -26, r: -40 }, EZ.out)
    .path(2.15, [[2.32, { r: -18 }, EZ.inOut], [2.5, { r: -42 }, EZ.inOut], [2.68, { r: -18 }, EZ.inOut]])
    .move(2.75, 2.95, { x: 0, y: 0, r: 0 }, EZ.inOut);
  happy(p, [[1.85, 2.8]]);
  return p;
}

/** Pompon points up-right with his paw from t0 to t1 (towards what is to be tapped). */
function point(p: Actor, t0: number, t1: number): void {
  p.pawR.move(t0, t0 + 0.25, { x: 20, y: -34, r: -58 }, EZ.out)
    .path(t0 + 0.25, [[t0 + 0.55, { y: -38 }, EZ.inOut], [t0 + 0.85, { y: -34 }, EZ.inOut]])
    .move(t1, t1 + 0.25, { x: 0, y: 0, r: 0 }, EZ.inOut);
  look(p, t0, 4, -3, t1);
}

/** The end: the icon pops onto the home screen, a little Pompon hops in and sits on it, everyone is happy. */
function finale(film: Film, homeLayer: HTMLElement, slot: HTMLElement, guideActor: Actor, t: number, length: number): void {
  const slotImg = slot.querySelector('img') as HTMLElement;
  const iconAt = measure(film, slotImg);
  film.track(homeLayer, { o: 0, s: 1.06 }).move(t, t + 0.45, { o: 1, s: 1 }, EZ.smooth);
  film.track(slot, { o: 0, s: 0.2 }).move(t + 0.45, t + 0.95, { o: 1, s: 1 }, EZ.bouncy);
  film.cue(t, 'whoosh', { gain: 0.4, pitch: 0.9, seed: 21 });
  film.cue(t + 0.5, 'pop', { pitch: 1.1 });
  film.cue(t + 0.62, 'chime', { pitch: 1.25 });
  confetti(film, iconAt.x, iconAt.y - 10, t + 0.6, 12, 0.55);
  // the guide leaves (he is too big to sit on an icon); a little Pompon hops in from the right and sits on it
  hop(guideActor, t - 0.2, -160, 0, { h: 28, d: 0.42 });
  const small = actor(film, 'bunny', iconAt.x, iconAt.y - iconAt.h / 2 + 5, 74, 9, 2.6);
  small.travel.set(0, { x: 170, o: 0 }).set(t + 0.9, { o: 1 });
  hop(small, t + 0.95, -85, 0, { h: 26, d: 0.36 });
  hop(small, t + 1.35, -85, 0, { h: 40, d: 0.42 });
  happy(small, [[t + 1.9, t + 3.2]]);
  hop(small, t + 2.6, 0, 0, { h: 18, d: 0.32, tilt: 0 });
  blinks(small, [t + 3.8, length - 0.9]);
  for (const [ear, dir] of [[small.earL, 1], [small.earR, -1]] as const) {
    ear.path(t + 3.3, [[t + 3.45, { r: dir * -12 }, EZ.out], [t + 3.65, { r: dir * 8 }, EZ.inOut], [t + 4.0, { r: 0 }, EZ.bouncy]]);
  }
  film.cue(t + 2.6, 'success', { gain: 0.7 });
}

// ---- iPhone (Safari) -------------------------------------------------------------------------------------

export function buildInstallIos(film: Film): void {
  const L = INSTALL_IOS_LENGTH;
  backdrop(film, L);
  const { phone: ph, screen } = phone(film);
  site(film, screen, 54);
  const bar = layer(film, screen, 'pfi-iosbar', `<div class="pfi-bottom"><span class="pfi-muted">${CHEVRONS}</span><span class="pfi-url">bunprise.de</span><span class="pfi-share">${icon2('share')}</span></div>`);
  const share = bar.querySelector('.pfi-share') as HTMLElement;
  const dim = layer(film, screen, 'pfi-dim', '');
  const sheet = layer(film, screen, 'pfi-sheet-wrap', `<div class="pfi-sheet"><div class="pfi-sheet-head"><img src="${ICON_URL}" alt=""><b>Bunprise<small>bunprise.de</small></b></div>
    <div class="pfi-row"><span>Copy</span>${icon2('copy')}</div><div class="pfi-row"><span>Add Bookmark</span>${icon2('bookmark')}</div>
    <div class="pfi-row pfi-add"><span>Add to Home Screen</span>${icon2('addHome')}</div><div class="pfi-row"><span>Find on Page</span>${icon2('search')}</div></div>`);
  const addRow = sheet.querySelector('.pfi-add') as HTMLElement;
  const confirm = layer(film, screen, 'pfi-confirm', `<div class="pfi-top"><span class="pfi-link">Cancel</span><b>Add to Home Screen</b><span class="pfi-link pfi-strong">Add</span></div>
    <div class="pfi-card"><img src="${ICON_URL}" alt=""><div><b>Bunprise</b><small>bunprise.de</small></div></div>`);
  const addBtn = confirm.querySelector('.pfi-strong') as HTMLElement;
  const { el: homeLayer, slot } = home(film, screen);
  const shareAt = measure(film, share);
  const rowAt = measure(film, addRow);
  const addAt = measure(film, addBtn);

  // 0 · hello: the phone slides up with the site, Pompon hops in and waves
  caption(film, ['Add to Home Screen'], 'Then Bunprise is always at hand –\njust like a real app.', 0.05, 2.9);
  film.track(ph, { y: 520 }).move(0.15, 0.8, { y: 0 }, EZ.smooth);
  film.cue(0.15, 'whoosh', { gain: 0.45, pitch: 0.9, seed: 11 });
  const p = guide(film);

  // 1 · "Tap Share": the button pulses, Pompon points, a tap, the share sheet slides up
  caption(film, ['Tap “Share”'], 'in the toolbar or in the “…” menu', 3.1, 6.2);
  point(p, 3.4, 5.4);
  pulse(film, shareAt, 3.7, 10);
  const tapShare = 5.0;
  tap(film, shareAt.x, shareAt.y, tapShare);
  press(film, share, tapShare);
  film.track(dim, { o: 0 }).move(tapShare + 0.2, tapShare + 0.5, { o: 1 }, EZ.out).move(8.6, 8.8, { o: 0 }, EZ.linear);
  film.track(sheet, { y: 320 }).move(tapShare + 0.2, tapShare + 0.75, { y: 0 }, EZ.smooth).move(8.6, 8.9, { y: 340 }, EZ.in);
  film.cue(tapShare + 0.2, 'whoosh', { gain: 0.4, pitch: 1.1, seed: 12 });

  // 2 · "Choose Add to Home Screen": the row lights up, a tap; the confirm page slides in
  caption(film, ['Choose', '“Add to Home Screen”'], null, 6.4, 9.4);
  point(p, 6.6, 8.6);
  outline(film, rowAt, 7.1, 8.5, 12);
  film.cue(7.1, 'bling', { gain: 0.5 });
  const tapRow = 8.2;
  tap(film, rowAt.x, rowAt.y, tapRow);
  press(film, addRow, tapRow);
  film.track(confirm, { x: 240 }).move(8.6, 9.1, { x: 0 }, EZ.smooth).move(11.6, 11.9, { o: 0 }, EZ.linear);
  film.cue(8.6, 'swish', { gain: 0.5 });

  // 3 · "Tap Add in the top right corner": a tap, and the phone goes to the home screen
  caption(film, ['Tap “Add”'], 'in the top right corner', 9.6, 13.4);
  point(p, 9.8, 11.2);
  outline(film, addAt, 10.3, 11.4, 10);
  const tapAdd = 11.15;
  tap(film, addAt.x, addAt.y, tapAdd);
  press(film, addBtn, tapAdd);
  finale(film, homeLayer, slot, p, 11.6, L);

  // 4 · done
  caption(film, ['Done!'], 'Bunprise is on your Home Screen,\njust like an app.', 13.6, 99, { size: 34 });
  blinks(p, [4.2, 7.6]);
  film.duration = L;
}

// ---- Android (Chrome) ------------------------------------------------------------------------------------

export function buildInstallAndroid(film: Film): void {
  const L = INSTALL_ANDROID_LENGTH;
  backdrop(film, L);
  const { phone: ph, screen } = phone(film);
  const top = layer(film, screen, 'pfi-chromebar', `<div class="pfi-topbar"><span class="pfi-url">bunprise.de</span><span class="pfi-dots">${DOTS}</span></div>`);
  site(film, screen, 70);
  const dots = top.querySelector('.pfi-dots') as HTMLElement;
  const dim = layer(film, screen, 'pfi-dim', '');
  const menu = layer(film, screen, 'pfi-menu-wrap', `<div class="pfi-menu"><div class="pfi-mrow">New tab</div><div class="pfi-mrow">History</div><div class="pfi-mrow">Bookmarks</div>
    <div class="pfi-mrow pfi-add">Add to Home screen</div><div class="pfi-mrow">Settings</div></div>`);
  const menuBox = menu.querySelector('.pfi-menu') as HTMLElement;
  const addRow = menu.querySelector('.pfi-add') as HTMLElement;
  const dialog = layer(film, screen, 'pfi-dialog-wrap', `<div class="pfi-dialog"><b>Install app</b><div class="pfi-card"><img src="${ICON_URL}" alt=""><div><b>Bunprise</b><small>bunprise.de</small></div></div>
    <div class="pfi-actions"><span class="pfi-link">Cancel</span><span class="pfi-link pfi-strong">Install</span></div></div>`);
  const dialogBox = dialog.querySelector('.pfi-dialog') as HTMLElement;
  const installBtn = dialog.querySelector('.pfi-strong') as HTMLElement;
  const { el: homeLayer, slot } = home(film, screen);
  const dotsAt = measure(film, dots);
  const rowAt = measure(film, addRow);
  const installAt = measure(film, installBtn);

  caption(film, ['Add to Home Screen'], 'Then Bunprise is always at hand –\njust like a real app.', 0.05, 2.9);
  film.track(ph, { y: 520 }).move(0.15, 0.8, { y: 0 }, EZ.smooth);
  film.cue(0.15, 'whoosh', { gain: 0.45, pitch: 0.9, seed: 11 });
  const p = guide(film);

  // 1 · the menu ⋮ at the top right
  caption(film, ['Tap the menu ⋮'], 'top right, next to the address', 3.1, 6.0);
  point(p, 3.4, 5.3);
  pulse(film, dotsAt, 3.7, 10);
  const tapDots = 4.9;
  tap(film, dotsAt.x, dotsAt.y, tapDots);
  press(film, dots, tapDots);
  film.track(dim, { o: 0 }).move(tapDots + 0.15, tapDots + 0.4, { o: 1 }, EZ.out).move(7.95, 8.15, { o: 0.6 }, EZ.linear).move(10.95, 11.15, { o: 0 }, EZ.linear);
  film.track(menuBox, { o: 0, s: 0.6 }).move(tapDots + 0.15, tapDots + 0.55, { o: 1, s: 1 }, EZ.smooth).move(7.95, 8.15, { o: 0, s: 0.96 }, EZ.in);
  film.cue(tapDots + 0.15, 'pop', { pitch: 1.3, gain: 0.6 });

  // 2 · "Add to Home screen" (or "Install app")
  caption(film, ['Choose', '“Add to Home screen”'], 'or “Install app”', 6.2, 9.1);
  point(p, 6.4, 8.3);
  outline(film, rowAt, 6.9, 8.0, 10);
  film.cue(6.9, 'bling', { gain: 0.5 });
  const tapRow = 7.75;
  tap(film, rowAt.x, rowAt.y, tapRow);
  press(film, addRow, tapRow);
  film.track(dialogBox, { o: 0, s: 0.85 }).move(8.2, 8.6, { o: 1, s: 1 }, EZ.bouncy).move(10.95, 11.15, { o: 0, s: 0.96 }, EZ.in);
  film.cue(8.2, 'pop', { pitch: 1 });

  // 3 · "Install"
  caption(film, ['Tap “Install”'], null, 9.3, 12.9);
  point(p, 9.5, 10.9);
  outline(film, installAt, 9.9, 10.95, 10);
  const tapInstall = 10.7;
  tap(film, installAt.x, installAt.y, tapInstall);
  press(film, installBtn, tapInstall);
  finale(film, homeLayer, slot, p, 11.1, L);

  caption(film, ['Done!'], 'Bunprise is on your Home screen,\njust like an app.', 13.1, 99, { size: 34 });
  blinks(p, [4.2, 7.3]);
  film.duration = L;
}
