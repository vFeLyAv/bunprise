/**
 * 16:9 banners (Felix 25.10: «варианты в GIF в формате 16:9, чтобы можно было как баннер куда-то вставить,
 * например в TG-бота позже»). Stage 640 × 360 (the Telegram bot description picture size), dark, silent,
 * SEAMLESS loops of BANNER_LENGTH s: every track starts and ends at rest, every repeating part (breathing)
 * divides the length, so the last frame flows into the first. Text stays on screen the whole time (a banner is
 * read at a glance); only the mascots, sparkles and confetti move. No drifting backdrop and no grain: a GIF
 * stores what changes between frames, a still background keeps it small.
 */
import { GIFT_BEHIND, ICON_URL } from '../promo-storyboard';
import { COSTUMES, icon } from '../welcome-screens';
import { EZ, Film, actor, blinks, confetti, happy, hop, wink } from './film';

export const BANNER_W = 640;
export const BANNER_H = 360;
/** 2 breaths of 2.6 s: the loop length every banner uses */
export const BANNER_LENGTH = 5.2;
const BREATH = BANNER_LENGTH / 2;

function still(film: Film): void {
  film.root.style.backgroundImage = [
    'radial-gradient(60% 70% at 0% 0%, rgba(255,150,84,.22) 0%, transparent 72%)',
    'radial-gradient(55% 70% at 100% 20%, rgba(232,118,124,.16) 0%, transparent 72%)',
    'radial-gradient(60% 70% at 85% 100%, rgba(150,132,226,.16) 0%, transparent 72%)',
    'linear-gradient(180deg, #211914 0%, #1A1410 60%, #15100D 100%)',
  ].join(',');
}

/** A soft star that twinkles once (scale and opacity, back to nothing by the end). */
function twinkle(film: Film, x: number, y: number, t: number, size = 16): void {
  const s = film.node(`<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 1.5l2.2 7.3 7.3 2.2-7.3 2.2L12 20.5l-2.2-7.3L2.5 11l7.3-2.2Z" fill="#FFD166"/></svg>`, `left:${x - size / 2}px;top:${y - size / 2}px;z-index:7`, 'pf');
  film.track(s, { o: 0, s: 0.2, r: 0 }).path(t, [[t + 0.3, { o: 1, s: 1, r: 45 }, EZ.out], [t + 0.8, { o: 0, s: 0.4, r: 90 }, EZ.in]]);
}

// ---- 1 · brand: Pompon and Tapsi next to the name ---------------------------------------------------------

export function buildBannerBrand(film: Film): void {
  still(film);
  film.node(`<img src="${ICON_URL}" alt=""><div><b>Bunprise</b><span>Plans and wishes –<br>together with friends</span><u>bunprise.de</u></div>`,
    'left:40px;top:0;bottom:0;width:330px', 'pfb-brand');
  const pompon = actor(film, 'bunny', 440, 324, 260, 4, BREATH);
  const tapsi = actor(film, 'hamster', 578, 320, 170, 5, BREATH);
  hop(pompon, 0.5, 0, 0, { h: 26, d: 0.4, tilt: 0 });
  hop(tapsi, 0.9, 0, 0, { h: 22, d: 0.36, tilt: 0 });
  happy(pompon, [[0.55, 1.6]]);
  happy(tapsi, [[0.95, 1.8]]);
  blinks(pompon, [2.4, 4.4]);
  blinks(tapsi, [3.1]);
  tapsi.pawR.move(2.2, 2.45, { x: 30, y: -26, r: -24 }, EZ.out)
    .path(2.45, [[2.65, { r: -6 }, EZ.inOut], [2.85, { r: -26 }, EZ.inOut], [3.05, { r: -6 }, EZ.inOut]])
    .move(3.2, 3.5, { x: 0, y: 0, r: 0 }, EZ.inOut);
  for (const [ear, dir] of [[pompon.earL, 1], [pompon.earR, -1]] as const) {
    ear.path(3.4, [[3.55, { r: dir * -12 }, EZ.out], [3.75, { r: dir * 8 }, EZ.inOut], [4.1, { r: 0 }, EZ.bouncy]]);
  }
  twinkle(film, 368, 92, 1.3, 18);
  twinkle(film, 610, 120, 2.9, 14);
  twinkle(film, 330, 250, 4.0, 12);
  film.duration = BANNER_LENGTH;
}

// ---- 2 · the secret: a reserved wish, Tapsi hides the gift and winks ---------------------------------------

export function buildBannerSecret(film: Film): void {
  still(film);
  film.node('<b>Reserve gifts<br>in secret.</b><span>No more double gifts.</span><u>bunprise.de</u>', 'left:40px;top:0;bottom:0;width:300px', 'pfb-text');
  const card = film.node(`<div class="ps-card ps-wish"><div class="ps-art">${icon('headphones')}</div><b>Wireless headphones</b><span>€ 79</span></div>
    <div class="ps-pill ok pfb-pill">${icon('check')}Reserved</div>`, 'left:338px;top:46px;width:172px', 'pfb-card');
  const pill = card.querySelector('.pfb-pill') as HTMLElement;
  const tapsi = actor(film, 'hamster', 548, 330, 170, 5, BREATH);
  tapsi.wear(GIFT_BEHIND, 'back');
  // the "Reserved" pill gives a little bounce, Tapsi winks with a "shh", giggles, blinks — all back at rest
  film.track(pill, { s: 1 }).path(0.6, [[0.75, { s: 1.12 }, EZ.out], [1.15, { s: 1 }, EZ.bouncy]]);
  twinkle(film, 498, 214, 0.65, 16);
  wink(film, tapsi, 1.3, 2.5);
  tapsi.pawR.move(1.2, 1.45, { x: -13, y: -34, r: -24 }, EZ.out).move(2.6, 2.9, { x: 0, y: 0, r: 0 }, EZ.inOut);
  tapsi.lift.path(1.3, [[1.5, { r: -5 }, EZ.out], [2.4, { r: -5 }, EZ.linear], [2.75, { r: 0 }, EZ.bouncy]]);
  tapsi.cheeks.path(3.1, [[3.22, { s: 1.08 }, EZ.out], [3.34, { s: 1 }, EZ.in], [3.46, { s: 1.08 }, EZ.out], [3.75, { s: 1 }, EZ.bouncy]]);
  happy(tapsi, [[3.05, 3.9]]);
  blinks(tapsi, [4.5]);
  twinkle(film, 600, 150, 3.4, 13);
  film.duration = BANNER_LENGTH;
}

// ---- 3 · Dream big!: a little party --------------------------------------------------------------------

export function buildBannerDream(film: Film): void {
  still(film);
  film.node('<b>Dream big!</b><span>Plans and wishes – together with friends · <u>bunprise.de</u></span>', 'left:0;right:0;top:26px', 'pfb-title');
  const pompon = actor(film, 'bunny', 232, 334, 262, 4, BREATH);
  pompon.wear(COSTUMES.birthday.front);
  const tapsi = actor(film, 'hamster', 424, 330, 190, 5, BREATH);
  hop(pompon, 0.3, 0, 0, { h: 40, d: 0.44, tilt: 0 });
  hop(tapsi, 0.6, 0, 0, { h: 34, d: 0.4, tilt: 0 });
  hop(pompon, 2.9, 0, 0, { h: 34, d: 0.42, tilt: 0 });
  hop(tapsi, 3.2, 0, 0, { h: 30, d: 0.38, tilt: 0 });
  happy(pompon, [[0.3, 1.5], [2.9, 4.1]]);
  happy(tapsi, [[0.6, 1.7], [3.2, 4.3]]);
  confetti(film, 160, 210, 0.45, 16, 1);
  confetti(film, 500, 200, 0.75, 16, 1);
  confetti(film, 330, 150, 3.05, 14, 0.9);
  blinks(pompon, [2.2, 4.7]);
  blinks(tapsi, [2.5]);
  film.duration = BANNER_LENGTH;
}
