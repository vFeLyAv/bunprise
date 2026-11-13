/**
 * Hamster — the bunny's friend. Faithful port of hamster-v2.html:
 * same shapes (folded ear, cheek pouches), same CSS states, same scenes.
 */

import { EASINGS, SPRING } from './core';
import { MascotBase, type MascotSpec } from './mascot';
import { BODY, cookieMarkup, star } from './shapes';
import type { Coat, HamsterCoat, HamsterHolding, HamsterOptions, HamsterPose, HamsterScene } from './types';

export const HAMSTER_SCENES: readonly HamsterScene[] = ['greet', 'eat', 'walk', 'jump', 'sleep', 'angry', 'secret', 'speck', 'idle'];

/** Coats of real hamsters; colours copied from the prototype. */
export const HAMSTER_COATS: readonly Coat<HamsterCoat>[] = [
  { id: 'golden', name: 'Золотистый', pattern: 'cap', colors: ['#FFF9F0', '#F6E3C9', '#FFFFFF', '#F8C68A', '#E9AC6C', '#F8C68A', '#F4A487'] },
  { id: 'cinnamon', name: 'Корица', pattern: 'cap', colors: ['#FFF8F1', '#F3DDC9', '#FFFFFF', '#DE9F78', '#C9845D', '#E6AC86', '#EFA08F'] },
  { id: 'sable', name: 'Соболь', pattern: 'cap', colors: ['#FFF6EC', '#EED8C3', '#FFFFFF', '#8E6450', '#75503F', '#D7AA8C', '#E8A08E'] },
  { id: 'dwarf', name: 'Джунгарик', pattern: 'stripe', colors: ['#F6F4F3', '#DCD8D7', '#FFFFFF', '#CFC7C8', '#B6ADAE', '#F2D1CD', '#F1B2B4'] },
  { id: 'robo', name: 'Робо', pattern: 'brows', colors: ['#FAEDD9', '#EACDA5', '#FFFDF8', '#E9C493', '#D8AE7A', '#F6E0C6', '#F2B19B'] },
  { id: 'spot', name: 'Пятнышко', pattern: 'patch', colors: ['#FFFFFF', '#F1EDEA', '#FFFFFF', '#F2B47C', '#DF9D63', '#F7D8BD', '#F4A487'] },
];

const eyeN = (x: number, y: number) =>
  `<g class="eye"><ellipse cx="${x}" cy="${y}" rx="5.8" ry="7.2" fill="var(--mascot-eye)"/><circle cx="${x + 2.1}" cy="${y - 2.6}" r="1.75" fill="#fff"/></g>`;
const eyeS = (x: number, y: number) =>
  `<ellipse cx="${x}" cy="${y}" rx="6.4" ry="7.8" fill="var(--mascot-eye)"/><path d="${star(x + 1.8, y - 2.2, 3.6, 1.15, 4)}" fill="#fff"/><circle cx="${x - 2.6}" cy="${y + 2.9}" r=".95" fill="#fff" opacity=".85"/>`;

/**
 * The binoculars he can hold up (HamsterHolding 'binoculars'; hidden unless `.hold-binoculars`). Drawn in the
 * puppet's own units in front of his face (barrels centred on his eyes at ±32 / -96), with his OWN front paws
 * on them: the same paw ellipse, colour (--mascot-paw) and toe lines as his resting paws, which are hidden
 * while he holds something — so there are always exactly two paws, and they hold the binoculars. A glint
 * (a light band, clipped to the two lenses) crosses them now and then. A speck of dust on the right lens (hidden;
 * drawn above the paws, so a paw pushes it ahead of itself) shows only in the scene 'speck' (tapsi-moments.ts).
 */
function binocularsMarkup(id: (name: string) => string): string {
  const gBarrel = `url(#${id('g-barrel')})`;
  const gLens = `url(#${id('g-lens')})`;
  const clipLens = `url(#${id('clip-lens')})`;
  const toes = 'stroke="rgba(150,90,40,.35)" stroke-width="1.1" stroke-linecap="round"';
  return `
      <g class="bino">
        <rect x="-15" y="-108" width="30" height="12" rx="6" fill="#4C3B31"/>
        <rect x="-4.5" y="-114.5" width="9" height="9" rx="2.6" fill="#65503F"/>
        <path d="M-2 -113.4 v6.4 M0 -113.4 v6.4 M2 -113.4 v6.4" stroke="#3E3029" stroke-width=".8" stroke-linecap="round"/>
        <circle cx="-31" cy="-97" r="20" fill="${gBarrel}"/>
        <circle cx="31" cy="-97" r="20" fill="${gBarrel}"/>
        <circle cx="-31" cy="-97" r="15.4" fill="#3A2D26"/>
        <circle cx="31" cy="-97" r="15.4" fill="#3A2D26"/>
        <circle cx="-31" cy="-97" r="13" fill="${gLens}"/>
        <circle cx="31" cy="-97" r="13" fill="${gLens}"/>
        <g clip-path="${clipLens}"><path class="bino-glint" d="M-58 -118 L-50 -118 L-62 -76 L-70 -76 Z" fill="#FFFFFF" opacity=".7"/></g>
        <ellipse cx="-35.6" cy="-102.4" rx="4.2" ry="2.5" transform="rotate(-38 -35.6 -102.4)" fill="#FFFFFF" opacity=".85"/>
        <ellipse cx="26.4" cy="-102.4" rx="4.2" ry="2.5" transform="rotate(-38 26.4 -102.4)" fill="#FFFFFF" opacity=".85"/>
        <circle cx="-25.5" cy="-91.5" r="1.4" fill="#FFFFFF" opacity=".5"/>
        <circle cx="36.5" cy="-91.5" r="1.4" fill="#FFFFFF" opacity=".5"/>
        <g class="bino-paw"><ellipse cx="-46" cy="-84" rx="10" ry="12" transform="rotate(-32 -46 -84)" fill="var(--mascot-paw)"/><path d="M-41.6 -91.6 l3.1 .9 M-39.7 -88.4 l3.1 .9" ${toes}/></g>
        <g class="bino-paw"><ellipse cx="46" cy="-84" rx="10" ry="12" transform="rotate(32 46 -84)" fill="var(--mascot-paw)"/><path d="M41.6 -91.6 l-3.1 .9 M39.7 -88.4 l-3.1 .9" ${toes}/></g>
        <g class="bino-speck"><circle cx="26" cy="-95" r="2.9" fill="#6B5648"/><circle cx="28.8" cy="-96.9" r="1.6" fill="#6B5648"/><circle cx="24.2" cy="-92.8" r="1.1" fill="#6B5648" opacity=".8"/></g>
      </g>`;
}

function hamsterMarkup(id: (name: string) => string): string {
  const gBody = `url(#${id('g-body')})`;
  const gBelly = `url(#${id('g-belly')})`;
  const gFold = `url(#${id('g-fold')})`;
  const gEarShadow = `url(#${id('g-earshadow')})`;
  const clipBody = `url(#${id('clip-body')})`;
  const HAMSTER = `
  <ellipse class="shadow" cx="0" cy="1" rx="70" ry="7" fill="rgba(70,40,15,.12)"/>
  <g class="hop">
    <g class="tfoot tfoot-l"><g class="foot foot-l"><ellipse cx="-39" cy="-3" rx="14.5" ry="5.8" fill="var(--mascot-paw)"/></g></g>
    <g class="tfoot tfoot-r"><g class="foot foot-r"><ellipse cx="39" cy="-3" rx="14.5" ry="5.8" fill="var(--mascot-paw)"/></g></g>
    <g class="body"><g class="wiggle"><g class="breathe">
      <g class="tail tail-l"><ellipse cx="-73" cy="-18" rx="6.5" ry="5" fill="var(--mascot-accent)"/></g>
      <g class="tail tail-r"><ellipse cx="73" cy="-18" rx="6.5" ry="5" fill="var(--mascot-accent)"/></g>
      <g class="te te-l"><g class="ear-l">
        <ellipse cx="-44" cy="-150" rx="16" ry="18.5" transform="rotate(-12 -44 -150)" fill="var(--mascot-accent)"/>
        <ellipse cx="-44.5" cy="-149" rx="8.5" ry="10.5" transform="rotate(-12 -44.5 -149)" fill="var(--mascot-ear-in)"/>
      </g></g>
      <g class="te te-r"><g class="ear-r"><g class="ear-tip">
        <ellipse cx="55" cy="-142.6" rx="16.5" ry="10.4" transform="rotate(34 55 -142.6)" fill="${gFold}"/>
      </g></g></g>
      <path d="${BODY}" fill="${gBody}"/>
      <g clip-path="${clipBody}">
        <g class="cap"><path d="M9 -175 L9 -158 C2 -148 -24 -122 -66 -112 L-92 -112 L-92 -175 Z" fill="var(--mascot-accent)"/><path d="M17 -175 L17 -158 C24 -146 44 -118 70 -106 L92 -106 L92 -175 Z" fill="var(--mascot-accent)"/></g>
        <path class="stripe" d="M-5 -170 L5 -170 L2.2 -127 Q0 -122.5 -2.2 -127 Z" fill="var(--mascot-stripe)"/>
        <ellipse class="ear-shadow" cx="51" cy="-143" rx="12" ry="6" transform="rotate(34 51 -143)" fill="${gEarShadow}"/>
        <g class="patch"><g class="tpatch"><path d="M17 -111 C27 -118 45 -114 48 -101 C51 -88 42 -79 31 -80 C19 -81 13 -92 14 -100 C14.5 -105 15 -108 17 -111 Z" fill="var(--mascot-accent)"/></g><ellipse cx="-50" cy="-30" rx="10" ry="8" fill="var(--mascot-accent)" opacity=".9"/></g>
      </g>
      <g class="tc tc-l"><g class="cheek cheek-l"><g class="cheek-j"><ellipse cx="-66" cy="-86" rx="15" ry="25" fill="${gBody}"/></g></g></g>
      <g class="tc tc-r"><g class="cheek cheek-r"><g class="cheek-j"><ellipse cx="66" cy="-86" rx="15" ry="25" fill="${gBody}"/></g></g></g>
      <ellipse cx="0" cy="-46" rx="56" ry="50" fill="${gBelly}"/>
      <g class="tf">
        <ellipse cx="-47" cy="-81" rx="9" ry="5.5" fill="var(--mascot-blush)" opacity=".3"/>
        <ellipse cx="47" cy="-81" rx="9" ry="5.5" fill="var(--mascot-blush)" opacity=".3"/>
        <g class="brows"><ellipse cx="-31" cy="-110" rx="6.6" ry="3.6" transform="rotate(-12 -31 -110)" fill="#FFFFFF"/><ellipse cx="31" cy="-110" rx="6.6" ry="3.6" transform="rotate(12 31 -110)" fill="#FFFFFF"/></g>
        <g class="face">
          <g class="eyes">${eyeN(-32, -96)}${eyeN(32, -96)}</g>
          <g class="eyes-star">${eyeS(-32, -96)}${eyeS(32, -96)}</g>
          <g class="eyes-happy" fill="none" stroke="var(--mascot-eye)" stroke-width="2.8" stroke-linecap="round"><path d="M-38.5 -94 Q-32 -102 -25.5 -94"/><path d="M25.5 -94 Q32 -102 38.5 -94"/></g>
          <g class="eyes-sleep" fill="none" stroke="var(--mascot-eye)" stroke-width="2.6" stroke-linecap="round"><path d="M-38 -96 Q-32 -90.5 -26 -96"/><path d="M26 -96 Q32 -90.5 38 -96"/></g>
          <g class="angry-brows" fill="none" stroke="var(--mascot-eye)" stroke-width="2.6" stroke-linecap="round"><path d="M-41 -110 L-25 -104.5"/><path d="M25 -104.5 L41 -110"/></g>
          <path d="M-4 -91.5 Q0 -93.2 4 -91.5 Q3 -88.4 0 -87.4 Q-3 -88.4 -4 -91.5 Z" fill="var(--mascot-nose)"/>
          <path class="mouth" d="M0 -87.4 Q0 -84 -3.8 -83.6 M0 -87.4 Q0 -84 3.8 -83.6" fill="none" stroke="var(--mascot-mouth)" stroke-width="1.5" stroke-linecap="round"/>
          <path class="pout" d="M-4.2 -83.2 Q0 -86.6 4.2 -83.2" fill="none" stroke="var(--mascot-mouth)" stroke-width="1.6" stroke-linecap="round"/>
          <ellipse class="mouth-open" cx="0" cy="-83.4" rx="2.8" ry="2.4" fill="#8C4A47"/>
          <g class="snot"><path d="M1.6 -88.2 C1.7 -85.6 4.4 -83.6 4.4 -80.6 C4.4 -78.5 3.2 -77.3 2.3 -77.3 C1.2 -77.3 .3 -78.7 .5 -80.5 C.7 -83 1.3 -85.8 1.6 -88.2 Z" fill="rgba(185,220,255,.75)" stroke="rgba(120,170,230,.55)" stroke-width=".6"/><path d="M1.7 -84.4 Q2.7 -82.8 2.6 -80.8" fill="none" stroke="#fff" stroke-width=".8" stroke-linecap="round" opacity=".9"/></g>
        </g>
      </g>${binocularsMarkup(id)}
      <g class="tp"><g class="paws">
        ${cookieMarkup()}
        <g class="paw paw-l"><ellipse cx="-16" cy="-46" rx="10" ry="12" transform="rotate(-28 -16 -46)" fill="var(--mascot-paw)"/><path d="M-14.2 -39.6 l1.7 2.1 M-11.6 -40.9 l1.7 2.1" stroke="rgba(150,90,40,.35)" stroke-width="1.1" stroke-linecap="round"/></g>
        <g class="paw paw-r"><ellipse cx="16" cy="-46" rx="10" ry="12" transform="rotate(28 16 -46)" fill="var(--mascot-paw)"/><path d="M14.2 -39.6 l-1.7 2.1 M11.6 -40.9 l-1.7 2.1" stroke="rgba(150,90,40,.35)" stroke-width="1.1" stroke-linecap="round"/></g>
      </g></g>
      <g class="anger"><path d="M-52 -139 Q-52 -134 -57 -134 M-48 -139 Q-48 -134 -43 -134 M-52 -125 Q-52 -130 -57 -130 M-48 -125 Q-48 -130 -43 -130" fill="none" stroke="#E8505B" stroke-width="2.4" stroke-linecap="round"/></g>
    </g></g></g>
  </g>`;

  return `
    <defs>
      <linearGradient id="${id('g-body')}" gradientUnits="userSpaceOnUse" x1="0" y1="-165" x2="0" y2="0">
        <stop offset="0" style="stop-color: var(--mascot-base-top)"/><stop offset="1" style="stop-color: var(--mascot-base-bottom)"/>
      </linearGradient>
      <radialGradient id="${id('g-belly')}" gradientUnits="userSpaceOnUse" cx="0" cy="-44" r="56">
        <stop offset="0" style="stop-color: var(--mascot-belly); stop-opacity: .75"/><stop offset=".55" style="stop-color: var(--mascot-belly); stop-opacity: .4"/><stop offset="1" style="stop-color: var(--mascot-belly); stop-opacity: 0"/>
      </radialGradient>
      <radialGradient id="${id('g-bubble')}" cx=".35" cy=".32" r=".75">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity=".9"/><stop offset=".6" stop-color="#D3E8FF" stop-opacity=".6"/><stop offset="1" stop-color="#B4D4F7" stop-opacity=".5"/>
      </radialGradient>
      <clipPath id="${id('clip-body')}"><path d="${BODY}"/></clipPath>
      <linearGradient id="${id('g-fold')}" gradientUnits="userSpaceOnUse" x1="44" y1="-152" x2="70" y2="-132">
        <stop offset="0" style="stop-color: var(--mascot-accent)"/><stop offset="1" style="stop-color: var(--mascot-accent-dark)"/>
      </linearGradient>
      <radialGradient id="${id('g-earshadow')}">
        <stop offset="0" stop-color="#8C5020" stop-opacity=".2"/><stop offset="1" stop-color="#8C5020" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="${id('g-barrel')}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#806656"/><stop offset="1" stop-color="#55433A"/>
      </linearGradient>
      <radialGradient id="${id('g-lens')}" cx=".38" cy=".32" r=".78">
        <stop offset="0" stop-color="#EEF4FB"/><stop offset=".55" stop-color="#A9BEDA"/><stop offset="1" stop-color="#7489AA"/>
      </radialGradient>
      <clipPath id="${id('clip-lens')}"><circle cx="-31" cy="-97" r="13"/><circle cx="31" cy="-97" r="13"/></clipPath>
    </defs>
    <g class="hm pat-cap" transform="translate(200 236) scale(1.25)">
      <g class="mover">${HAMSTER}<g class="fx"></g></g>
    </g>`;
}

// ---------- CSS (states and keyframes exactly as in the prototype) ----------
const HAMSTER_CSS = `
:host { --mascot-stripe: #8B8487; }

/* hamster: pivots */
.hop, .body, .breathe { transform-box: fill-box; transform-origin: 50% 100%; }
.foot, .cookie, .shadow, .paws { transform-box: fill-box; transform-origin: center; }
.paw { transform-box: fill-box; transform-origin: 50% 100%; }
.ear-l { transform-box: fill-box; transform-origin: 50% 95%; transition: transform .35s cubic-bezier(.34, 1.56, .64, 1); }
.ear-r { transform-box: fill-box; transform-origin: 25% 95%; transition: transform .35s cubic-bezier(.34, 1.56, .64, 1); }
.ear-tip { transform-box: fill-box; transform-origin: 23% 37%; transition: transform .12s ease-out; }
.cheek { transform-box: fill-box; transform: scale(var(--puff, 1)); transition: transform .7s cubic-bezier(.34, 1.56, .64, 1); }
.cheek-l { transform-origin: 100% 50%; }
.cheek-r { transform-origin: 0% 50%; }
.cheek-j { transform-box: fill-box; transform-origin: center; }
.face { transition: transform .45s cubic-bezier(.25, .8, .3, 1); }
.eye { transform-box: fill-box; transform-origin: center; transition: transform .1s ease; }
.cookie { opacity: 0; }

/* resting */
.breathe { animation: breathe 3.6s ease-in-out infinite; }
@keyframes breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(.994, 1.018); } }
.blink .eye { transform: scaleY(.12); }
.startle .eye { transform: scale(1.25); }
.look-l .face { transform: translateX(-2.4px); }
.look-r .face { transform: translateX(2.4px); }
.look-up .face { transform: translateY(-2.5px); }
.twitch .ear-l { transform: rotate(-14deg); }
.flick .ear-tip { transform: rotate(-12deg); }
.perk .ear-tip { transform: rotate(-8deg); }

/* quarter turn (same hamster): face, cheeks, ears and paws shift towards the step */
.tf, .tp, .te, .tc, .tfoot, .cap, .stripe, .tpatch { transform-box: fill-box; transition: transform .28s cubic-bezier(.3, .7, .3, 1); }
.tf, .tpatch, .tfoot { transform-origin: center; }
.te { transform-origin: 50% 100%; }
.tc-l { transform-origin: 100% 50%; }
.tc-r { transform-origin: 0% 50%; }
.turn-r { --dir: 1; }
.turn-l { --dir: -1; }
.turn-r .tf, .turn-r .tpatch { transform: translateX(13px) scaleX(.88); }
.turn-l .tf, .turn-l .tpatch { transform: translateX(-13px) scaleX(.88); }
.turn-r .cap, .turn-r .stripe { transform: translateX(9px); }
.turn-l .cap, .turn-l .stripe { transform: translateX(-9px); }
.turn-r .tp { transform: translateX(9px); }
.turn-l .tp { transform: translateX(-9px); }
.ear-shadow { transform-box: fill-box; transform-origin: center; transition: transform .28s cubic-bezier(.3, .7, .3, 1); }
.turn-r .ear-shadow { transform: translateX(7px); }
.turn-l .ear-shadow { transform: translateX(-15px) scale(.86); }
.turn-r .te-l { transform: translateX(15px) scale(.86); }
.turn-r .te-r { transform: translateX(7px); }
.turn-l .te-l { transform: translateX(-7px); }
.turn-l .te-r { transform: translateX(-15px) scale(.86); }
.turn-r .tc-l, .turn-l .tc-r { transform: scale(.55); }
.turn-r .tc-r, .turn-l .tc-l { transform: scale(1.04); }
.turn-r .tfoot-l { transform: translateX(12px) scale(.9); }
.turn-r .tfoot-r { transform: translateX(5px); }
.turn-l .tfoot-r { transform: translateX(-12px) scale(.9); }
.turn-l .tfoot-l { transform: translateX(-5px); }

/* walking with little hops */
.walking .hop { animation: hopstep .5s ease-in-out infinite; }
@keyframes hopstep {
  0%, 50%, 100% { transform: translateY(0) rotate(0); }
  25% { transform: translateY(-6px) rotate(calc(var(--dir, 1) * 1.5deg)); }
  75% { transform: translateY(-6px) rotate(calc(var(--dir, 1) * -1.5deg)); }
}
.walking .foot-l { animation: step-a .5s ease-in-out infinite; }
.walking .foot-r { animation: step-b .5s ease-in-out infinite; }
@keyframes step-a { 0%, 50%, 100% { transform: none; } 25% { transform: translate(calc(var(--dir, 1) * 4px), -7px) rotate(calc(var(--dir, 1) * -10deg)); } }
@keyframes step-b { 0%, 50%, 100% { transform: none; } 75% { transform: translate(calc(var(--dir, 1) * 4px), -7px) rotate(calc(var(--dir, 1) * -10deg)); } }
.walking .paws { animation: swing .5s ease-in-out infinite; }
@keyframes swing { 25% { transform: translateY(-1.5px) rotate(4deg); } 75% { transform: translateY(-1.5px) rotate(-4deg); } }
.walking .ear-l, .walking .ear-r { animation: earbob .5s ease-in-out infinite; }
@keyframes earbob { 25% { transform: rotate(-6deg); } 75% { transform: rotate(4deg); } }
.wiggle { transform-box: fill-box; transform-origin: 50% 0%; }
.walking .wiggle { animation: wiggle .25s ease-in-out infinite alternate; }
@keyframes wiggle { from { transform: skewX(-1.5deg); } to { transform: skewX(1.5deg); } }
.tail { opacity: 0; transform-box: fill-box; transition: opacity .15s; }
.tail-l { transform-origin: 100% 50%; }
.tail-r { transform-origin: 0% 50%; }
.turn-r .tail-l, .turn-l .tail-r { opacity: 1; animation: wag .16s ease-in-out infinite alternate; }
@keyframes wag { from { transform: rotate(-28deg); } to { transform: rotate(28deg); } }

/* eyes and mouth */
.eyes-star, .eyes-happy, .eyes-sleep { opacity: 0; }
.m-star .eyes, .m-happy .eyes, .m-sleep .eyes { opacity: 0; }
.m-star .eyes-star, .m-happy .eyes-happy, .m-sleep .eyes-sleep { opacity: 1; }
.mouth-open { opacity: 0; transform-box: fill-box; transform-origin: 50% 20%; transition: transform .25s ease, opacity .1s; }
.m-open .mouth-open, .m-yawn .mouth-open { opacity: 1; }
.m-open .mouth, .m-yawn .mouth { opacity: 0; }
.m-yawn .mouth-open { transform: scale(2.1, 2.7); }

/* eating */
.chewing .cheek-j { animation: chew .17s ease-in-out infinite alternate; }
@keyframes chew { to { transform: scale(1.07, .95); } }

/* anger: brows, pout, anime vein mark */
.angry-brows, .pout, .anger { opacity: 0; }
.m-angry .angry-brows, .m-angry .pout, .m-angry .anger { opacity: 1; }
.m-angry .mouth, .m-angry .mouth-open { opacity: 0; }
.m-angry .eye { transform: scaleY(.82); }
.anger { transform-box: fill-box; transform-origin: center; }
.m-angry .anger { animation: throb .35s ease-in-out infinite alternate; }
@keyframes throb { from { transform: scale(.9); } to { transform: scale(1.15); } }

/* sleep */
.sleeping .breathe { animation: breathe-deep 3.4s ease-in-out infinite; }
@keyframes breathe-deep { 0%, 100% { transform: scale(1.03, .955); } 50% { transform: scale(1.045, .985); } }
.sleeping .ear-l { transform: rotate(-16deg); }
.sleeping .ear-r { transform: rotate(14deg); }
/* the snot drip stretches with each breath; now and then he sniffs it back in */
.snot { opacity: 0; transform-box: fill-box; transform-origin: 50% 0%; }
.sleeping .snot { opacity: 1; animation: drip 3.4s ease-in-out infinite; }
@keyframes drip { 0%, 100% { transform: scaleY(.35); } 50% { transform: scaleY(1.15); } }
.sniff .snot { animation: sniff .45s ease-in forwards; }
@keyframes sniff { to { transform: scaleY(.08); } }

/* coats: which markings are visible */
.cap, .stripe, .brows, .patch { display: none; }
.pat-cap .cap, .pat-stripe .stripe, .pat-brows .brows, .pat-patch .patch { display: inline; }

/* holding binoculars (HamsterHolding): his own two paws hold them up, the resting ones are hidden.
   One 16 s loop shared by every part (same duration, same start: they stay in step; the idle pause and
   the offscreen pause freeze them all at once): look straight → turn left (head, binoculars, a small lean)
   → scan → sweep right, a glint crosses the lenses → back to the middle → lower the binoculars, blink
   twice → raise them again with a soft spring overshoot. Transform only; .rm = the still pose. */
.bino { display: none; transform-box: fill-box; transform-origin: 50% 45%; }
.hold-binoculars .bino { display: inline; }
.hold-binoculars .paw-l, .hold-binoculars .paw-r { display: none; }
.hold-binoculars .bino { animation: bino-look 16s cubic-bezier(.45, 0, .2, 1) infinite; }
.hold-binoculars .tf { animation: bino-face 16s cubic-bezier(.45, 0, .2, 1) infinite; }
.hold-binoculars .te { animation: bino-ears 16s cubic-bezier(.45, 0, .2, 1) infinite; }
.hold-binoculars .wiggle { transform-origin: 50% 100%; animation: bino-lean 16s cubic-bezier(.45, 0, .2, 1) infinite; }
.hold-binoculars .eye { animation: bino-blink 16s ease-in-out infinite; }
.hold-binoculars .bino-glint { animation: bino-glint 16s cubic-bezier(.4, 0, .3, 1) infinite; }
@keyframes bino-look {
  0%, 7% { transform: translate(0px, 0px) rotate(0deg) scale(1, 1); }
  17% { transform: translate(-9px, 1px) rotate(-4deg) scale(.95, 1); }
  25% { transform: translate(-10px, .5px) rotate(-5deg) scale(.95, 1); }
  33% { transform: translate(-9px, 1px) rotate(-4deg) scale(.95, 1); }
  46% { transform: translate(9px, 1px) rotate(4deg) scale(.95, 1); }
  54% { transform: translate(10px, .5px) rotate(5deg) scale(.95, 1); }
  61% { transform: translate(9px, 1px) rotate(4deg) scale(.95, 1); }
  70%, 73% { transform: translate(0px, 0px) rotate(0deg) scale(1, 1); }
  77.5% { transform: translate(0px, 36px) rotate(0deg) scale(.97, .97); }
  85% { transform: translate(0px, 36px) rotate(0deg) scale(.97, .97); animation-timing-function: cubic-bezier(.34, 1.56, .64, 1); }
  90%, 100% { transform: translate(0px, 0px) rotate(0deg) scale(1, 1); }
}
@keyframes bino-face {
  0%, 7%, 70%, 100% { transform: translateX(0px); }
  17%, 33% { transform: translateX(-6px); }
  46%, 61% { transform: translateX(6px); }
}
@keyframes bino-ears {
  0%, 7%, 70%, 100% { transform: translateX(0px); }
  17%, 33% { transform: translateX(-3px); }
  46%, 61% { transform: translateX(3px); }
}
@keyframes bino-lean {
  0%, 7%, 70%, 100% { transform: rotate(0deg); }
  17%, 33% { transform: rotate(-2deg); }
  46%, 61% { transform: rotate(2deg); }
}
@keyframes bino-blink {
  0%, 79%, 80.4%, 82%, 83.4%, 100% { transform: scaleY(1); }
  79.6%, 82.6% { transform: scaleY(.1); }
}
@keyframes bino-glint {
  0%, 48% { transform: translateX(0px); }
  52.5%, 100% { transform: translateX(132px); }
}

/* driven (27.10, tapsi-moments.ts): a timeline scene moves these parts itself — the puppet's own loops and
   transitions step aside while it runs (the class is on .hm only during the scene) */
.hm.driven .breathe, .hm.driven .cheek-j, .hm.driven .bino, .hm.driven .tf, .hm.driven .te, .hm.driven .wiggle, .hm.driven .eye, .hm.driven .bino-glint { animation: none; }
.hm.driven .cheek, .hm.driven .ear-l, .hm.driven .ear-r, .hm.driven .ear-tip, .hm.driven .face, .hm.driven .eye, .hm.driven .tf, .hm.driven .tp, .hm.driven .te, .hm.driven .tc, .hm.driven .mouth-open, .hm.driven .tail { transition: none; }
.hm.driven .wiggle { transform-origin: 50% 100%; }
.bino-paw, .bino-speck { transform-box: fill-box; transform-origin: 50% 50%; }
.bino-speck { opacity: 0; }

/* reduced motion (.rm is toggled on the svg by ReducedMotion) */
.rm .breathe, .rm .sleeping .breathe, .rm .walking .hop, .rm .walking .foot-l, .rm .walking .foot-r, .rm .walking .paws, .rm .walking .ear-l, .rm .walking .ear-r,
.rm .chewing .cheek-j, .rm .sleeping .snot, .rm .walking .wiggle, .rm .turn-r .tail-l, .rm .turn-l .tail-r, .rm .m-angry .anger,
.rm .hold-binoculars .bino, .rm .hold-binoculars .tf, .rm .hold-binoculars .te, .rm .hold-binoculars .wiggle, .rm .hold-binoculars .eye, .rm .hold-binoculars .bino-glint { animation: none; }
.rm .cheek, .rm .ear-l, .rm .ear-r, .rm .ear-tip, .rm .face, .rm .tf, .rm .tp, .rm .te, .rm .tc, .rm .tfoot, .rm .cap, .rm .stripe, .rm .tpatch { transition: none; }
/* Weniger with the binoculars (Felix 26.10, «Пылинка»): they rest lowered, his calm ^ ^ eyes show; a tap moves nothing */
.rm .hold-binoculars .bino { transform: translate(0px, 36px) scale(.97); }
`;

const HAMSTER_SPEC: MascotSpec<HamsterCoat> = {
  kind: 'hamster',
  viewBox: '0 0 400 250',
  css: HAMSTER_CSS,
  markup: hamsterMarkup,
  coats: HAMSTER_COATS,
  patternClasses: ['pat-cap', 'pat-stripe', 'pat-brows', 'pat-patch'],
  zOrigin: { x: 40, y: -150 },
  crumbY: -80,
};

export class Hamster extends MascotBase<HamsterScene, HamsterCoat, HamsterPose> {
  private readonly earL: SVGGElement;
  private readonly earR: SVGGElement;
  private readonly tip: SVGGElement;
  private held: HamsterHolding | null = null;

  constructor(host: HTMLElement, options: HamsterOptions = {}) {
    super(host, options, HAMSTER_SPEC);
    this.earL = this.$('.ear-l');
    this.earR = this.$('.ear-r');
    this.tip = this.$('.ear-tip');
    this.setHolding(options.holding ?? null);
    this.finishSetup(options);
  }

  /** What he holds up in his front paws (null: nothing, the paws rest on his belly). */
  get holding(): HamsterHolding | null {
    return this.held;
  }

  /**
   * Holds something up ('binoculars') or puts it away (null) — at once, no animation. A lasting state like
   * the coat: scenes, pose() and interrupt() keep it. Its loop runs with the idle loop (paused with it,
   * offscreen and in a hidden tab); under reduced motion it is a still pose.
   */
  setHolding(holding: HamsterHolding | null): void {
    if (holding === this.held) return;
    if (this.held) this.hm.classList.remove(`hold-${this.held}`);
    this.held = holding;
    if (holding) this.hm.classList.add(`hold-${holding}`);
  }

  protected registerIdleLoops(): void {
    // while he holds the binoculars their loop does the blinking and the glances (his eyes are behind them)
    this.addIdleLoop(() => {
      if (this.held) return;
      this.pulse('blink', 140);
      if (Math.random() < 0.25) this.timeout(() => this.pulse('blink', 130), 300);
    }, 2400, 3200);
    this.addIdleLoop(() => {
      if (!this.held) this.pulse(Math.random() < 0.5 ? 'look-l' : 'look-r', 1200);
    }, 5000, 4000);
    this.addIdleLoop(() => this.pulse('twitch', 320), 5200, 5200);
    this.addIdleLoop(() => this.flick(), 3600, 4200);
  }

  protected runScene(scene: HamsterScene): Promise<void> {
    switch (scene) {
      case 'greet':
        return this.greet();
      case 'eat':
        return this.eat();
      case 'walk':
        return this.walk();
      case 'jump':
        return this.jump();
      case 'angry':
        return this.angry();
      case 'secret':
        return this.secret();
      case 'speck':
        return this.speck();
      default:
        return Promise.resolve();
    }
  }

  protected jumpBodyFrames(): Keyframe[] {
    return [
      { transform: 'scale(1,1)', offset: 0 },
      { transform: 'scale(1.08,.88)', offset: 0.18 },
      { transform: 'scale(.95,1.07)', offset: 0.3 },
      { transform: 'scale(1,1)', offset: 0.52 },
      { transform: 'scale(.97,1.04)', offset: 0.72 },
      { transform: 'scale(1.07,.9)', offset: 0.84 },
      { transform: 'scale(.98,1.02)', offset: 0.93 },
      { transform: 'scale(1,1)', offset: 1 },
    ];
  }

  protected jumpEars(o: KeyframeAnimationOptions): void {
    this.earL.animate([{ transform: 'none' }, { transform: 'rotate(6deg)', offset: 0.3 }, { transform: 'rotate(-8deg)', offset: 0.55 }, { transform: 'rotate(12deg)', offset: 0.86 }, { transform: 'none' }], o);
    this.earR.animate([{ transform: 'none' }, { transform: 'rotate(-6deg)', offset: 0.3 }, { transform: 'rotate(8deg)', offset: 0.55 }, { transform: 'rotate(-10deg)', offset: 0.86 }, { transform: 'none' }], o);
    this.tip.animate([{ transform: 'none' }, { transform: 'rotate(-12deg)', offset: 0.3 }, { transform: 'rotate(7deg)', offset: 0.56 }, { transform: 'rotate(-14deg)', offset: 0.86 }, { transform: 'none' }], o);
  }

  /** Double flick of the folded ear tip. */
  private flick(): void {
    this.pulse('flick', 120);
    this.timeout(() => this.pulse('flick', 110), 230);
  }

  // ---------- jump: squash -> stretch -> tucked feet -> slap ----------
  private async jump(): Promise<void> {
    this.setEyes('star');
    await this.jumpMotion();
    await this.wait(250);
    this.setEyes('normal');
  }

  // ---------- greet: paw waves at the cheek, body leans ----------
  private async greet(): Promise<void> {
    this.setEyes('star');
    this.mouthOpen(true);
    this.hm.classList.add('perk');
    const d = 2100;
    void this.anim(this.body, [{ transform: 'none' }, { transform: 'rotate(-4deg)', offset: 0.18 }, { transform: 'rotate(-4deg)', offset: 0.8 }, { transform: 'none' }], { duration: d, easing: 'ease-in-out' });
    await this.anim(
      this.pawR,
      [
        { transform: 'none' },
        { transform: 'translate(44px,-30px) rotate(-22deg)', offset: 0.16 },
        { transform: 'translate(44px,-30px) rotate(16deg)', offset: 0.3 },
        { transform: 'translate(44px,-30px) rotate(-22deg)', offset: 0.44 },
        { transform: 'translate(44px,-30px) rotate(16deg)', offset: 0.58 },
        { transform: 'translate(44px,-30px) rotate(-22deg)', offset: 0.72 },
        { transform: 'none', offset: 1 },
      ],
      { duration: d, easing: 'ease-in-out' },
    );
    this.mouthOpen(false);
    this.hm.classList.remove('perk');
    await this.jumpMotion(12, 620);
    this.setEyes('normal');
  }

  // ---------- eat: lifts the cookie to the mouth and nibbles with the whole body ----------
  private async eat(): Promise<void> {
    this.cookie.style.opacity = '1';
    this.hm.classList.add('look-up');
    await this.anim(this.cookie, [{ transform: 'translateY(-210px) rotate(-60deg)' }, { transform: 'none' }], { duration: 700, easing: SPRING });
    this.hm.classList.remove('look-up');
    this.setEyes('star');
    void this.anim(this.body, [{ transform: 'none' }, { transform: 'scale(1.05,.95)' }, { transform: 'none' }], { duration: 280 });
    await this.wait(260);
    await this.anim(this.paws, [{ transform: 'none' }, { transform: 'translateY(-30px)' }], { duration: 280, easing: EASINGS.lift });
    this.setEyes('happy');
    this.hm.classList.add('chewing');
    for (let i = 0; i < 9; i++) {
      this.mouthOpen(i % 2 === 0);
      if (i % 2 === 1) {
        this.crumb();
        this.crumb();
        this.cookie.style.transform = `scale(${(1 - (i + 1) * 0.09).toFixed(2)}) rotate(${i * 6}deg)`;
      }
      await this.anim(this.body, [{ transform: 'none' }, { transform: 'translateY(1.6px) rotate(1.5deg) scale(1.012,.985)' }, { transform: 'none' }], { duration: 170, easing: 'ease-in-out' });
    }
    this.mouthOpen(false);
    this.hm.classList.remove('chewing');
    this.cookie.style.opacity = '0';
    this.cookie.style.transform = '';
    this.setPuff(1.35);
    this.setEyes('star');
    this.flick();
    await this.anim(this.paws, [{ transform: 'translateY(-30px)' }, { transform: 'none' }], { duration: 320, easing: SPRING });
    await this.wait(900);
    this.setEyes('normal');
    this.timeout(() => this.setPuff(1), 1800);
  }

  // ---------- walk: quarter turn, hop, and skip along ----------
  private async walk(): Promise<void> {
    const dist = 70;
    const dur = 1700;
    this.hm.classList.add('turn-r');
    await this.jumpMotion(12, 520);
    this.hm.classList.add('walking');
    await this.anim(this.mover, [{ transform: 'translateX(0px)' }, { transform: `translateX(${dist}px)` }], { duration: dur, easing: 'linear' });
    this.hm.classList.remove('walking');
    await this.wait(140);
    this.hm.classList.replace('turn-r', 'turn-l');
    await this.jumpMotion(10, 480);
    this.hm.classList.add('walking');
    await this.anim(this.mover, [{ transform: `translateX(${dist}px)` }, { transform: 'translateX(0px)' }], { duration: dur, easing: 'linear' });
    this.hm.classList.remove('walking', 'turn-l');
    await this.jumpMotion(10, 480);
    this.setEyes('star');
    this.flick();
    await this.wait(600);
    this.setEyes('normal');
  }

  // ---------- angry: "don't touch me!" (5 taps in a row) ----------
  private async angry(): Promise<void> {
    this.setEyes('normal');
    this.hm.classList.add('m-angry');
    this.setPuff(1.25);
    await this.anim(this.body, [{ transform: 'none' }, { transform: 'scale(1.06,.92)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
    void this.anim(this.body, [{ transform: 'none' }, { transform: 'rotate(3deg)', offset: 0.15 }, { transform: 'rotate(3deg)', offset: 0.85 }, { transform: 'none' }], { duration: 1500, easing: 'ease-in-out' });
    await this.anim(
      this.pawR,
      [
        { transform: 'none' },
        { transform: 'translate(10px,-28px) scale(1.25)', offset: 0.15 },
        { transform: 'translate(14px,-28px) scale(1.25) rotate(14deg)', offset: 0.3 },
        { transform: 'translate(6px,-28px) scale(1.25) rotate(-14deg)', offset: 0.45 },
        { transform: 'translate(14px,-28px) scale(1.25) rotate(14deg)', offset: 0.6 },
        { transform: 'translate(6px,-28px) scale(1.25) rotate(-14deg)', offset: 0.75 },
        { transform: 'none', offset: 1 },
      ],
      { duration: 1500, easing: 'ease-in-out' },
    );
    this.hm.classList.remove('m-angry');
    this.setEyes('happy');
    await this.anim(this.body, [{ transform: 'none' }, { transform: 'scale(1.03,.97)', offset: 0.5 }, { transform: 'none' }], { duration: 700, easing: 'ease-in-out' });
    this.setPuff(1);
    this.setEyes('normal');
  }

  // ---------- secret: the reservation moment with the «Psst» ending (27.10, tapsi-moments.ts) ----------
  /**
   * Jump → the wish star drops into his paws → nine bites → both paws over his mouth, ^ ^, a head tilt and a nod
   * ("Ich sag nix") → paws down, eyes open (≈ 5.65 s); 1.8 s later the cheeks go back, as after eat. The choreography
   * is one timeline in its own lazily loaded module. Reduced motion: the still pose (pose('psst')), it stays.
   * Without the module (an offline chunk) the old jump + eat play instead.
   */
  private async secret(): Promise<void> {
    if (this.isReduced) {
      this.pose('psst');
      return;
    }
    const m = await this.after(import('./tapsi-moments').catch(() => null));
    if (!m) {
      await this.jump();
      await this.eat();
      return;
    }
    // the CSS value under the scene's own cheek track: the same 1.35 when the scene lets go (no transition)
    this.setPuff(m.FULL_CHEEKS);
    await this.drive((svg) => m.startScene(svg, 'secret'));
    this.setEyes('normal');
    this.timeout(() => this.setPuff(1), 1800);
  }

  // ---------- speck: «Пылинка на линзе» — only with the binoculars (27.10, tapsi-moments.ts) ----------
  /**
   * The binoculars come down, one paw brushes a speck off the right lens, the glint crosses, binoculars up (1.6 s),
   * starting from wherever the look-around loop was (it glides back to the middle). Reduced motion or nothing in
   * his paws: nothing moves (the reduced pose already shows the binoculars lowered, ^ ^).
   */
  private async speck(): Promise<void> {
    if (this.isReduced || this.held !== 'binoculars') return;
    const m = await this.after(import('./tapsi-moments').catch(() => null));
    if (!m) return;
    const from = m.readLoopPose((sel) => this.$$(sel));
    await this.drive((svg) => m.startScene(svg, 'speck', from));
  }

  /** Also undoes the «Psst» still (its left paw, head tilt and blush are not among the base parts). */
  protected override resetPose(): void {
    super.resetPose();
    for (const el of [this.$('.paw-l'), this.$('.tf'), ...this.$$('.te')]) el.style.transform = '';
    for (const b of this.$$('.tf > ellipse').slice(0, 2)) b.style.opacity = '';
  }

  // ---------- static poses (prototype ?pose= params) ----------
  pose(name: HamsterPose): void {
    this.resetPose();
    const snot = this.$('.snot');
    snot.style.animation = '';
    snot.style.transform = '';
    switch (name) {
      case 'wave':
        this.pawR.style.transform = 'translate(44px,-30px) rotate(-22deg)';
        this.body.style.transform = 'rotate(-4deg)';
        this.hm.classList.add('perk');
        this.mouthOpen(true);
        break;
      case 'sleep':
        this.hm.classList.add('sleeping');
        this.setEyes('sleep');
        break;
      case 'eat':
        this.cookie.style.opacity = '1';
        this.paws.style.transform = 'translateY(-30px)';
        this.setEyes('happy');
        this.mouthOpen(true);
        break;
      case 'angry':
        this.hm.classList.add('m-angry');
        this.setPuff(1.25);
        this.pawR.style.transform = 'translate(10px,-28px) scale(1.25)';
        break;
      case 'turn':
        this.hm.classList.add('turn-r');
        break;
      case 'psst':
        // the «Psst» still (tapsi-moments.ts PSST): paws over his mouth, ^ ^, the head tilted, full cheeks, warm blush
        this.setPuff(1.35);
        this.setEyes('happy');
        this.paws.style.transform = 'translateY(-30px)';
        this.$('.paw-l').style.transform = 'translate(5px,0px) rotate(20deg)';
        this.pawR.style.transform = 'translate(-5px,0px) rotate(-36deg)';
        this.$('.tf').style.transform = 'rotate(-8deg)';
        for (const te of this.$$('.te')) te.style.transform = 'rotate(-5deg)';
        this.body.style.transform = 'rotate(-2deg)';
        for (const b of this.$$('.tf > ellipse').slice(0, 2)) b.style.opacity = '0.62';
        break;
      case 'drip':
        this.hm.classList.add('sleeping');
        this.setEyes('sleep');
        snot.style.animation = 'none';
        snot.style.transform = 'scaleY(1.1)';
        break;
      default:
        break;
    }
  }
}
