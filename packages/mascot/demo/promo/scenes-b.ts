/**
 * The promo film, scenes 3–6 (docs/design/2026-10-25-promo-video-plan.md §3; storyboard frames 3–6):
 * 3 wishes from a link (10 – 17 s), 4 invite (17 – 22.2 s), 5 the secret reservation (22.2 – 30.4 s),
 * 6 the finale (30.4 – 36.2 s). Only the main features (Felix 25.10: «только главные фишки»).
 */
import { GIFT_BEHIND, ICON_URL, STAR, icon2 } from '../promo-storyboard';
import { COSTUMES, GIFT_BOX, icon, ownPaws } from '../welcome-screens';
import type { Bunny } from '../../src/index';
import { EZ, Film, actor, blinks, caption, confetti, happy, hop, look, measure, tap, wink } from './film';

// ---- scene 3 · wishes from a link (10 – 17 s) ------------------------------------------------------------

const LINK = 'https://…/headphones';

function sceneWishes(film: Film): void {
  const t0 = 10.0;
  const exit = 16.6;
  caption(film, ['Paste a link.'], 'Picture and price fill in by themselves.', t0 + 0.05, exit);

  const phone = film.node(`<div class="ps-bar"></div><div class="ps-ph"><h4>Anna’s wishes</h4>
    <div class="ps-field pf-field">${icon2('link')}<span class="pf-ph">Paste a link</span><span class="pf-type">${[...LINK].map((c) => `<i>${c}</i>`).join('')}</span></div>
    <div class="pf-cardslot">
      <div class="ps-card ps-wish pf-skel"><div class="ps-art pf-skel-art"></div><b class="pf-skel-line"></b><span class="pf-skel-line short"></span><i class="pf-shine"></i></div>
      <div class="ps-card ps-wish pf-real"><div class="ps-art"><span class="pf-art">${icon('headphones')}</span></div><b class="pf-title">Wireless headphones</b><span class="pf-price">€ 79 · from the shop</span></div>
    </div>
    <div class="ps-card pf-mini"><i>${icon('book')}</i><b>Cookbook</b><span>€ 24</span></div>
    <div class="ps-card pf-mini"><i>${icon('plant')}</i><b>Monstera</b><span>€ 29</span></div></div>`,
  'left:126px;top:172px', 'ps-phone');
  const field = phone.querySelector('.pf-field') as HTMLElement;
  const fieldAt = measure(film, field);
  const real = phone.querySelector('.pf-real') as HTMLElement;
  const art = phone.querySelector('.pf-art') as HTMLElement;
  const artAt = measure(film, art);
  film.track(phone, { y: 540 }).move(t0 + 0.1, t0 + 0.75, { y: 0 }, EZ.smooth).move(exit + 0.05, exit + 0.45, { y: 560 }, EZ.in);

  // tap the field, the link types itself in
  const tapAt = t0 + 0.95;
  tap(film, fieldAt.x + 10, fieldAt.y, tapAt);
  film.track(phone.querySelector('.pf-ph') as HTMLElement, { o: 1 }).set(tapAt + 0.1, { o: 0 });
  const chars = [...phone.querySelectorAll<HTMLElement>('.pf-type i')];
  chars.forEach((c, i) => film.track(c, { o: 0 }).set(tapAt + 0.15 + i * 0.035, { o: 1 }));
  const typed = tapAt + 0.15 + chars.length * 0.035;

  // a shimmering placeholder, then the real card: picture, name, price, one after the other
  const skel = phone.querySelector('.pf-skel') as HTMLElement;
  film.track(skel, { o: 0, s: 0.96 }).move(typed + 0.05, typed + 0.3, { o: 1, s: 1 }, EZ.out).move(typed + 1.0, typed + 1.15, { o: 0 }, EZ.linear);
  film.track(phone.querySelector('.pf-shine') as HTMLElement, { x: -170 }).path(typed + 0.2, [[typed + 0.6, { x: 170 }, EZ.inOut], [typed + 0.61, { x: -170 }, EZ.linear], [typed + 1.0, { x: 170 }, EZ.inOut]]);
  const shown = typed + 1.0;
  film.track(real, { o: 0 }).move(shown, shown + 0.15, { o: 1 }, EZ.linear);
  film.track(art, { s: 0.4, o: 0 }).move(shown + 0.05, shown + 0.55, { s: 1, o: 1 }, EZ.bouncy);
  film.track(real.querySelector('.pf-title') as HTMLElement, { o: 0, y: 8 }).move(shown + 0.2, shown + 0.5, { o: 1, y: 0 }, EZ.out);
  film.track(real.querySelector('.pf-price') as HTMLElement, { o: 0, s: 0.6 }).move(shown + 0.38, shown + 0.8, { o: 1, s: 1 }, EZ.bouncy);
  confetti(film, artAt.x, artAt.y - 30, shown + 0.1, 8, 0.45);

  // Tapsi hops in from the left, sees the card; three wish stars fly into his cheeks
  const tapsi = actor(film, 'hamster', 86, 604, 190);
  tapsi.travel.set(0, { x: -230 });
  hop(tapsi, shown - 0.3, 115, 0, { h: 30, d: 0.4 });
  hop(tapsi, shown + 0.15, 115, 0, { h: 26, d: 0.38 });
  look(tapsi, shown + 0.6, 6, -3);
  const cheeks = [tapsi.at(-66, -86), tapsi.at(66, -86), tapsi.at(-66, -86)];
  const puff = [1.12, 1.24, 1.36];
  cheeks.forEach((cheek, i) => {
    const star = film.node(STAR, 'left:-13px;top:-13px;z-index:7', 'pf');
    const go = shown + 0.9 + i * 0.4;
    const land = go + 0.55;
    film.track(star, { o: 0, x: artAt.x, y: artAt.y, s: 0.5, r: 0 })
      .set(go, { o: 1 })
      .path(go, [[go + 0.25, { x: (artAt.x + cheek.x) / 2, y: Math.min(artAt.y, cheek.y) - 60, s: 1.2, r: 140 }, EZ.out], [land, { x: cheek.x, y: cheek.y, s: 0.4, r: 280 }, EZ.in]])
      .set(land + 0.01, { o: 0 });
    tapsi.cheeks.move(land, land + 0.4, { s: puff[i] ?? 1.3 }, EZ.bouncy);
    tapsi.squash.path(land, [[land + 0.06, { sx: 1.05, sy: 0.95 }, EZ.out], [land + 0.35, { sx: 1, sy: 1 }, EZ.bouncy]]);
  });
  const full = shown + 0.9 + 2 * 0.4 + 0.55;
  happy(tapsi, [[shown + 1.0, exit - 0.3]]);
  tapsi.face.move(full, full + 0.2, { x: 0, y: 0 }, EZ.inOut);
  // more wishes join the list
  phone.querySelectorAll<HTMLElement>('.pf-mini').forEach((row, i) => {
    film.track(row, { o: 0, y: 16 }).move(full + 0.2 + i * 0.22, full + 0.6 + i * 0.22, { o: 1, y: 0 }, EZ.bouncy);
  });
  blinks(tapsi, [shown + 0.45, exit - 0.15]);
  hop(tapsi, exit, -170, 0, { h: 30, d: 0.42 });
  // sound: the phone, the typed link (a tick per letter), the card pops in and its price dings, three gulps
  film.cue(t0 + 0.1, 'whoosh', { gain: 0.45, pitch: 0.9, seed: 9 });
  chars.forEach((_, i) => film.cue(tapAt + 0.15 + i * 0.035, 'type', { seed: i, gain: 0.8 }));
  film.cue(shown + 0.05, 'pop', { pitch: 1.2 });
  film.cue(shown + 0.38, 'chime', { pitch: 1.5, gain: 0.5, pan: 0.2 });
  cheeks.forEach((cheek, i) => {
    const go = shown + 0.9 + i * 0.4;
    film.cue(go, 'swish', { gain: 0.3, pan: 0.1 });
    film.cue(go + 0.55, 'gulp', { pitch: 1 + i * 0.15, pan: (cheek.x / 360 - 0.5) * 0.6 });
  });
  film.cue(full + 0.2, 'pop', { pitch: 1.1, gain: 0.5, pan: 0.3 });
  film.cue(full + 0.42, 'pop', { pitch: 1.25, gain: 0.5, pan: 0.3 });
  film.cue(exit + 0.05, 'whoosh', { gain: 0.45, pitch: 0.8, seed: 10 });
}

// ---- scene 4 · invite friends (17 – 22.2 s) --------------------------------------------------------------

const PLANE = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M3 11.5 21 4l-5 16-4.5-6.5Z" fill="#fff" stroke="#B65F1A" stroke-width="1.6" stroke-linejoin="round"/><path d="M11.5 13.5 21 4" stroke="#B65F1A" stroke-width="1.4"/></svg>';
const CHECK_BADGE = `<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#2E9D62;color:#fff;box-shadow:0 0 0 3px var(--pf-ring, #fff)">${icon('check').replace('stroke-width="1.8"', 'stroke-width="3"').replace('<svg ', '<svg width="13" height="13" ')}</span>`;

function sceneInvite(film: Film): void {
  const t0 = 17.0;
  const exit = 21.75;
  caption(film, ['Invite your friends', 'with one link.'], null, t0 + 0.05, exit);

  const pompon = actor(film, 'bunny', 180, 552, 272);
  const env = pompon.wear(COSTUMES.invite.paws ?? '', 'paws');
  ownPaws(pompon.puppet as Bunny, false);
  pompon.travel.set(0, { y: 340 }).move(t0 + 0.15, t0 + 0.6, { y: 0 }, EZ.out).move(exit + 0.05, exit + 0.45, { y: 360 }, EZ.in);
  pompon.squash.path(t0 + 0.55, [[t0 + 0.62, { sx: 1.1, sy: 0.9 }, EZ.out], [t0 + 0.95, { sx: 1, sy: 1 }, EZ.bouncy]]);
  const envAt = pompon.at(0, -46);
  // the envelope wiggles open, the link pops out of it
  const envTrack = film.track(env, { r: 0, y: 0 });
  envTrack.path(t0 + 0.9, [[t0 + 1.0, { r: -6 }, EZ.out], [t0 + 1.1, { r: 6 }, EZ.inOut], [t0 + 1.2, { r: -4 }, EZ.inOut], [t0 + 1.35, { r: 0 }, EZ.bouncy]]);
  const pill = film.node('<span class="pf-pill">bunprise.de/i/…</span>', `left:${envAt.x}px;top:${envAt.y}px;z-index:6`, 'pf');
  const pillTop = envAt.y - 92;
  film.track(pill, { o: 0, y: 0, s: 0.4 })
    .set(t0 + 1.3, { o: 1 })
    .move(t0 + 1.3, t0 + 1.8, { y: pillTop - envAt.y, s: 1 }, EZ.bouncy)
    .move(t0 + 2.55, t0 + 2.75, { s: 0.8, o: 0 }, EZ.in);
  happy(pompon, [[t0 + 1.35, t0 + 2.0]]);

  // three friends appear, a paper plane flies to each, they join (a check)
  const friends = [['B', '#6C8CFF', 72, 268], ['M', '#FF7A9A', 180, 232], ['L', '#3FB78A', 288, 268]] as const;
  friends.forEach(([letter, color, x, y], i) => {
    const av = film.node(letter, `left:${x - 29}px;top:${y - 29}px;background:${color}`, 'ps-avatar');
    const appear = t0 + 1.6 + i * 0.15;
    film.track(av, { o: 0, s: 0.3 }).move(appear, appear + 0.5, { o: 1, s: 1 }, EZ.bouncy)
      .path(t0 + 2.75 + 0.55 + i * 0.14, [[t0 + 2.75 + 0.65 + i * 0.14, { s: 1.16 }, EZ.out], [t0 + 2.75 + 1.05 + i * 0.14, { s: 1 }, EZ.bouncy]])
      .move(exit + i * 0.04, exit + 0.3 + i * 0.04, { o: 0, y: -30, s: 0.8 }, EZ.in);
    const plane = film.node(PLANE, 'left:-17px;top:-17px;z-index:6', 'pf');
    const go = t0 + 2.75 + i * 0.14;
    const land = go + 0.55;
    const sx = envAt.x;
    const sy = pillTop;
    film.track(plane, { o: 0, x: sx, y: sy, r: 0, s: 0.6 })
      .set(go, { o: 1 })
      .path(go, [[go + 0.3, { x: (sx + x) / 2 + (x - sx) * 0.15, y: Math.min(sy, y) - 40 + i * 6, r: (x - sx) * 0.12 - 20, s: 1 }, EZ.out], [land, { x, y: y + 6, r: (x - sx) * 0.2, s: 0.5 }, EZ.in]])
      .set(land + 0.01, { o: 0 });
    const badge = film.node(CHECK_BADGE, `left:${x + 12}px;top:${y - 34}px;z-index:7`, 'pf');
    film.track(badge, { o: 0, s: 0.3 }).move(land + 0.05, land + 0.5, { o: 1, s: 1 }, EZ.bouncy).move(exit + i * 0.04, exit + 0.3 + i * 0.04, { o: 0, y: -30 }, EZ.in);
  });
  const allIn = t0 + 2.75 + 2 * 0.14 + 0.6;
  happy(pompon, [[allIn, exit - 0.1]]);
  hop(pompon, allIn + 0.1, 0, 0, { h: 30, d: 0.4, tilt: 0 });
  blinks(pompon, [t0 + 1.0, exit - 0.05]);
  // sound: Pompon rises and lands, the envelope rustles, the link pops out, the friends pop in,
  // a whoosh per paper plane and a ding per friend who joins (rising: C – E – G)
  film.cue(t0 + 0.15, 'whoosh', { gain: 0.4, pitch: 0.8, seed: 11 });
  film.cue(t0 + 0.6, 'thump', { gain: 0.5 });
  film.cue(t0 + 0.9, 'swish', { gain: 0.3 });
  film.cue(t0 + 1.3, 'pop', { pitch: 1.25 });
  friends.forEach(([, , x], i) => {
    const pan = (x / 360 - 0.5) * 0.9;
    film.cue(t0 + 1.6 + i * 0.15, 'pop', { pitch: 0.9 + i * 0.1, gain: 0.5, pan });
    film.cue(t0 + 2.75 + i * 0.14, 'whoosh', { gain: 0.3, pitch: 1.3, pan, seed: 12 + i });
    film.cue(t0 + 2.75 + i * 0.14 + 0.6, 'chime', { pitch: [1, 1.26, 1.5][i] ?? 1, gain: 0.55, pan });
  });
  film.cue(exit, 'whoosh', { gain: 0.45, pitch: 0.8, seed: 15 });
}

// ---- scene 5 · reserve in secret (22.2 – 30.4 s) ---------------------------------------------------------

function smallWish(): string {
  return `<div class="ps-card ps-wish"><div class="ps-art">${icon('headphones')}</div><b>Wireless headphones</b><span>€ 79</span></div>`;
}

function sceneSecret(film: Film): void {
  const t0 = 22.2;
  const exit = 29.9;
  caption(film, ['Reserve in secret.'], 'Anna sees nothing.', t0 + 0.05, exit);

  const ben = film.node(`<div class="ps-bar"></div><div class="ps-ph"><h4>Anna’s wishes</h4>${smallWish()}
    <div class="pf-btnslot"><span class="ps-pill btn pf-get">I’ll get this</span><span class="ps-pill ok pf-got">${icon('check')}Reserved by you</span></div></div>`, 'left:22px;top:190px', 'ps-phone small');
  const anna = film.node(`<div class="ps-bar"></div><div class="ps-ph"><h4>My wishes</h4>${smallWish()}</div>`, 'left:188px;top:190px', 'ps-phone small');
  const benLabel = film.node('Ben sees', 'left:22px;top:160px;width:150px', 'ps-who');
  const annaLabel = film.node('Anna sees', 'left:188px;top:160px;width:150px', 'ps-who');
  film.track(ben, { x: -220 }).move(t0 + 0.15, t0 + 0.8, { x: 0 }, EZ.smooth).move(exit, exit + 0.4, { x: -240 }, EZ.in);
  film.track(anna, { x: 220 }).move(t0 + 0.25, t0 + 0.9, { x: 0 }, EZ.smooth).move(exit + 0.05, exit + 0.45, { x: 240 }, EZ.in);
  film.track(benLabel, { o: 0, y: 6 }).move(t0 + 0.8, t0 + 1.1, { o: 1, y: 0 }, EZ.out).move(exit, exit + 0.2, { o: 0 }, EZ.linear);
  film.track(annaLabel, { o: 0, y: 6 }).move(t0 + 0.9, t0 + 1.2, { o: 1, y: 0 }, EZ.out).move(exit, exit + 0.2, { o: 0 }, EZ.linear);

  // Ben taps "I'll get this": the button turns into "Reserved by you"
  const get = ben.querySelector('.pf-get') as HTMLElement;
  const got = ben.querySelector('.pf-got') as HTMLElement;
  const getAt = measure(film, get);
  const tapAt = t0 + 1.55;
  tap(film, getAt.x, getAt.y, tapAt);
  film.track(get, { o: 1, s: 1 }).path(tapAt, [[tapAt + 0.08, { s: 0.92 }, EZ.out], [tapAt + 0.25, { s: 1, o: 0 }, EZ.out]]);
  film.track(got, { o: 0, s: 0.6 }).move(tapAt + 0.2, tapAt + 0.65, { o: 1, s: 1 }, EZ.bouncy);
  confetti(film, getAt.x, getAt.y, tapAt + 0.25, 10, 0.5);

  // Tapsi takes the gift and hides it behind his back, winks, "shh"
  const tapsi = actor(film, 'hamster', 180, 610, 176);
  tapsi.travel.set(0, { y: 300 }).move(tapAt + 0.6, tapAt + 1.05, { y: 0 }, EZ.out).move(exit + 0.05, exit + 0.45, { y: 320 }, EZ.in);
  tapsi.squash.path(tapAt + 1.0, [[tapAt + 1.07, { sx: 1.1, sy: 0.9 }, EZ.out], [tapAt + 1.4, { sx: 1, sy: 1 }, EZ.bouncy]]);
  look(tapsi, tapAt + 1.15, -6, -2);
  const k = 1.25 * (176 / 400);
  const giftEl = film.node(`<svg viewBox="-36 -58 72 60" width="${72 * k}" height="${60 * k}" aria-hidden="true">${GIFT_BOX.replace('class="ws-gift"', '')}</svg>`, `left:${-36 * k}px;top:${-30 * k}px;z-index:6`, 'pf');
  const side = tapsi.at(74, -46 - 22);
  const fly = tapAt + 1.25;
  film.track(giftEl, { o: 0, x: getAt.x, y: getAt.y, s: 0.5, r: 0 })
    .set(fly, { o: 1 })
    .path(fly, [[fly + 0.3, { x: (getAt.x + side.x) / 2, y: getAt.y - 30, s: 1.05, r: 20 }, EZ.out], [fly + 0.65, { x: side.x - 24, y: side.y, s: 1, r: 8 }, EZ.in]])
    // out to his side (clear of his body), then it goes behind him and slides in
    .move(fly + 1.0, fly + 1.25, { x: side.x + 14, y: side.y, s: 0.95, r: 14 }, EZ.inOut)
    .set(fly + 1.26, { o: 0 });
  const behind = tapsi.wear(GIFT_BEHIND, 'back');
  film.track(behind, { o: 0, x: 26 }).set(fly + 1.25, { o: 1 }).move(fly + 1.26, fly + 1.6, { x: 0 }, EZ.smooth);
  happy(tapsi, [[fly + 0.7, fly + 1.1]]);
  tapsi.face.move(fly + 1.3, fly + 1.5, { x: 0, y: 0 }, EZ.inOut);
  const winkAt = fly + 1.7;
  wink(film, tapsi, winkAt, winkAt + 1.1);
  tapsi.pawR.move(winkAt - 0.1, winkAt + 0.15, { x: -13, y: -34, r: -24 }, EZ.out).move(winkAt + 1.2, winkAt + 1.45, { x: 0, y: 0, r: 0 }, EZ.inOut);
  tapsi.lift.path(winkAt, [[winkAt + 0.2, { r: -5 }, EZ.out], [winkAt + 1.0, { r: -5 }, EZ.linear], [winkAt + 1.3, { r: 0 }, EZ.bouncy]]);
  // giggles: the cheeks bounce
  tapsi.cheeks.path(winkAt + 1.5, [[winkAt + 1.62, { s: 1.08 }, EZ.out], [winkAt + 1.74, { s: 1 }, EZ.in], [winkAt + 1.86, { s: 1.08 }, EZ.out], [winkAt + 2.1, { s: 1 }, EZ.bouncy]]);
  happy(tapsi, [[winkAt + 1.5, winkAt + 2.3]]);
  blinks(tapsi, [winkAt + 2.6]);

  // Anna's list: unchanged — a calm ring around her card says "look, nothing here"
  const annaCard = anna.querySelector('.ps-wish') as HTMLElement;
  const cardAt = measure(film, annaCard);
  const ring = film.node('', `left:${cardAt.x - cardAt.w / 2 - 5}px;top:${cardAt.y - cardAt.h / 2 - 5}px;width:${cardAt.w + 10}px;height:${cardAt.h + 10}px;border-radius:20px;box-shadow:0 0 0 2.5px rgba(240,160,75,.85), 0 0 22px rgba(240,160,75,.35);z-index:3`, 'pf');
  const look2 = winkAt + 0.9;
  film.track(ring, { o: 0, s: 1.06 }).move(look2, look2 + 0.4, { o: 1, s: 1 }, EZ.out).path(look2 + 0.4, [[look2 + 0.9, { s: 1.03 }, EZ.inOut], [look2 + 1.4, { s: 1 }, EZ.inOut]]).move(exit - 0.4, exit, { o: 0 }, EZ.linear);
  // sound: the phones slide in, "Reserved by you", Tapsi pops up, the gift flies and goes behind his back,
  // the wink, a calm ding on Anna's unchanged card, two giggles, everything leaves
  film.cue(t0 + 0.15, 'whoosh', { gain: 0.45, pitch: 0.9, seed: 16 });
  film.cue(tapAt + 0.2, 'success', { pan: -0.3 });
  film.cue(tapAt + 0.6, 'whoosh', { gain: 0.3, pitch: 0.8, seed: 17 });
  film.cue(tapAt + 1.05, 'thump', { gain: 0.4, pitch: 1.25 });
  film.cue(fly, 'whoosh', { gain: 0.3, pitch: 1.3, seed: 18 });
  film.cue(fly + 1.25, 'swish', { gain: 0.45, pan: 0.2 });
  film.cue(winkAt, 'bling', {});
  film.cue(look2, 'chime', { pitch: 0.75, gain: 0.35, pan: 0.4 });
  film.cue(winkAt + 1.62, 'pop', { pitch: 1.6, gain: 0.22 });
  film.cue(winkAt + 1.86, 'pop', { pitch: 1.75, gain: 0.22 });
  film.cue(exit, 'whoosh', { gain: 0.45, pitch: 0.8, seed: 19 });
}

// ---- scene 6 · the finale (30.4 – 36.2 s) ------------------------------------------------------------------

function sceneFinale(film: Film): void {
  const t0 = 30.4;
  caption(film, ['Dream big!'], null, t0 + 0.1, 999, { size: 42, top: 70 });
  confetti(film, 96, 330, t0 + 0.15, 18, 1.2);
  confetti(film, 264, 330, t0 + 0.3, 18, 1.2);

  const pompon = actor(film, 'bunny', 116, 404, 236);
  pompon.wear(COSTUMES.birthday.front);
  pompon.travel.set(0, { x: -260 });
  hop(pompon, t0 + 0.25, 130, 0, { h: 40, d: 0.42 });
  hop(pompon, t0 + 0.72, 130, 0, { h: 34, d: 0.42 });
  const tapsi = actor(film, 'hamster', 256, 398, 176);
  tapsi.travel.set(0, { x: 240 });
  hop(tapsi, t0 + 0.4, -120, 0, { h: 34, d: 0.4 });
  hop(tapsi, t0 + 0.85, -120, 0, { h: 30, d: 0.4 });
  // both jump for joy, twice
  hop(pompon, t0 + 1.45, 0, 0, { h: 46, d: 0.46, tilt: 0 });
  hop(tapsi, t0 + 1.6, 0, 0, { h: 40, d: 0.44, tilt: 0 });
  hop(pompon, t0 + 2.1, 0, 0, { h: 34, d: 0.42, tilt: 0 });
  hop(tapsi, t0 + 2.25, 0, 0, { h: 30, d: 0.4, tilt: 0 });
  happy(pompon, [[t0 + 1.2, t0 + 3.4]]);
  happy(tapsi, [[t0 + 1.3, t0 + 3.5]]);
  confetti(film, 180, 250, t0 + 2.6, 14, 0.9);
  // Tapsi waves, Pompon wiggles his ears
  tapsi.pawR.move(t0 + 3.0, t0 + 3.25, { x: 30, y: -26, r: -24 }, EZ.out)
    .path(t0 + 3.25, [[t0 + 3.45, { r: -6 }, EZ.inOut], [t0 + 3.65, { r: -26 }, EZ.inOut], [t0 + 3.85, { r: -6 }, EZ.inOut], [t0 + 4.05, { r: -24 }, EZ.inOut]])
    .move(t0 + 4.4, t0 + 4.7, { x: 0, y: 0, r: 0 }, EZ.inOut);
  for (const [ear, dir] of [[pompon.earL, 1], [pompon.earR, -1]] as const) {
    ear.path(t0 + 3.2, [[t0 + 3.35, { r: dir * -12 }, EZ.out], [t0 + 3.55, { r: dir * 8 }, EZ.inOut], [t0 + 3.75, { r: dir * -6 }, EZ.inOut], [t0 + 4.1, { r: 0 }, EZ.bouncy]]);
  }
  blinks(pompon, [t0 + 4.3, t0 + 5.3]);
  blinks(tapsi, [t0 + 4.6]);
  look(pompon, t0 + 3.6, 2, 3);
  look(tapsi, t0 + 3.7, -2, 3);

  // the brand rises
  const brand = film.node(`<img class="pf-icon" src="${ICON_URL}" alt=""><b>Bunprise</b><span>Plans and wishes – together with friends</span><u>bunprise.de</u>`, 'left:0;right:0;top:428px', 'ps-brand');
  film.track(brand, { o: 0, y: 40 }).move(t0 + 1.9, t0 + 2.45, { o: 1, y: 0 }, EZ.smooth);
  film.track(brand.querySelector('.pf-icon') as HTMLElement, { s: 0.5, r: -10 }).move(t0 + 2.0, t0 + 2.6, { s: 1, r: 0 }, EZ.bouncy);
  // sound: the fanfare with the title, the brand rings in as a chord (C – E – G)
  film.cue(t0 + 0.1, 'fanfare', {});
  [1, 1.26, 1.5].forEach((pitch, i) => film.cue(t0 + 2.0 + i * 0.03, 'chime', { pitch, gain: 0.4 }));
}

export function buildFilmB(film: Film): void {
  sceneWishes(film);
  sceneInvite(film);
  sceneSecret(film);
  sceneFinale(film);
}
