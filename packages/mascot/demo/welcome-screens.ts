/**
 * New welcome screens (Felix 25.10, docs/design/2026-10-25-welcome-ideas.md) — a GALLERY-ONLY prototype.
 * Nothing here is used by the app: the screens live on the mascot gallery page (port 5180) until Felix
 * approves them; only then do they move into apps/web/src/features/onboarding.
 *
 *   ?screens=welcome            only these three phones   (&screen=1|2|3 — one phone, for screenshots)
 *   &reduced=1                  calm version (as under prefers-reduced-motion)
 *
 * 1 «Hallo» — tap Pompon: blush deepens, ears wiggle, happy eyes, 2–3 hearts float up (rate-limited).
 * 2 «Was wünschst du dir?» — Pompon holds a gift box; tap a wish bubble: it flies into the box on a spring,
 *   the lid bounces, Pompon hops, a small confetti burst. Calm: the bubble just gets a check, no flight.
 * 3 «Was feierst du als Nächstes?» — occasion cards; Pompon puts on the matching costume (party hat, Santa
 *   hat, flower, an envelope in his paws). The hats are the ones of the logo variants
 *   (apps/web/scripts/brand-variants.mjs), drawn in the same mascot units.
 *
 * Same Pompon as everywhere (the Bunny puppet, coat fawn, lop ears); the extra parts (box, costumes) are put
 * into his own SVG, so they move with his hops and breathing. Motion: the app's three springs as linear()
 * easings (tokens.css, design-system-motion.md), transform/opacity only, every animation finite, any new tap
 * interrupts nothing it should not. Vibration here is the gallery's own; in the app it goes through the
 * haptics wrapper.
 */
import { Bunny, type ReducedMotionMode } from '../src/index';

// ---- motion tokens (apps/web/src/styles/tokens.css) ------------------------------------------------------

const LINEAR_OK = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transition-timing-function', 'linear(0, 1)');
export const EASE = LINEAR_OK ? {
  snappy: 'linear(0, 0.036, 0.123, 0.234, 0.352, 0.468, 0.573, 0.665, 0.744, 0.808, 0.860, 0.901, 0.932, 0.956, 0.973, 0.985, 0.994, 0.999, 1.003, 1.004, 1.005, 1.005, 1.005, 1.005, 1)',
  smooth: 'linear(0, 0.023, 0.081, 0.159, 0.248, 0.340, 0.429, 0.514, 0.591, 0.660, 0.721, 0.773, 0.818, 0.856, 0.887, 0.913, 0.934, 0.950, 0.964, 0.974, 0.982, 0.988, 0.993, 0.996, 1)',
  bouncy: 'linear(0, 0.069, 0.237, 0.449, 0.662, 0.849, 0.994, 1.092, 1.146, 1.163, 1.153, 1.127, 1.092, 1.057, 1.026, 1.002, 0.986, 0.977, 0.973, 0.975, 0.979, 0.985, 0.990, 0.995, 1)',
} : { snappy: 'cubic-bezier(.25,.8,.3,1)', smooth: 'cubic-bezier(.2,.7,.3,1)', bouncy: 'cubic-bezier(.34,1.56,.64,1)' };
export const DUR = { snappy: 280, smooth: 350, bouncy: 480 };

// ---- pure keyframe builders (tested: transform/opacity only, finite) -------------------------------------

/** A wish bubble's flight from its place to the box opening: a little lift, an arc, shrinking into the box. */
export function flightKeyframes(dx: number, dy: number): Keyframe[] {
  const lift = Math.min(-40, dy * 0.35 - 30);
  return [
    { transform: 'translate(0px, 0px) scale(1)', opacity: 1, offset: 0, easing: 'ease-out' },
    { transform: 'translate(0px, -6px) scale(1.08)', opacity: 1, offset: 0.12, easing: 'ease-in-out' },
    { transform: `translate(${(dx * 0.55).toFixed(1)}px, ${(dy * 0.4 + lift).toFixed(1)}px) scale(0.85)`, opacity: 1, offset: 0.55, easing: 'ease-in' },
    { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.22)`, opacity: 0, offset: 1 },
  ];
}

/** One confetti piece: thrown up and out, falls back with "gravity", spins and fades. Deterministic per seed. */
export function confettiKeyframes(seed: number): Keyframe[] {
  const rnd = (n: number) => { const x = Math.sin(seed * 9301 + n * 49297) * 233280; return x - Math.floor(x); };
  const angle = (-90 + (rnd(1) - 0.5) * 120) * (Math.PI / 180);
  const speed = 70 + rnd(2) * 60;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const spin = (rnd(3) - 0.5) * 540;
  const at = (t: number) => `translate(${(vx * t).toFixed(1)}px, ${(vy * t + 120 * t * t).toFixed(1)}px) rotate(${(spin * t).toFixed(0)}deg)`;
  return [
    { transform: 'translate(0px, 0px) rotate(0deg) scale(0.6)', opacity: 1, offset: 0 },
    { transform: `${at(0.35)} scale(1)`, opacity: 1, offset: 0.35 },
    { transform: `${at(0.7)} scale(1)`, opacity: 0.9, offset: 0.7 },
    { transform: `${at(1)} scale(0.9)`, opacity: 0, offset: 1 },
  ];
}

/** A heart floating up from the head: drifts sideways, grows a little, fades. */
export function heartKeyframes(index: number): Keyframe[] {
  const drift = [-26, 8, 30][index % 3] ?? 0;
  return [
    { transform: 'translate(0px, 0px) scale(0.4)', opacity: 0, offset: 0 },
    { transform: `translate(${(drift * 0.3).toFixed(0)}px, -18px) scale(1)`, opacity: 1, offset: 0.25 },
    { transform: `translate(${drift}px, -70px) scale(1.1)`, opacity: 0, offset: 1 },
  ];
}

// ---- drawings (mascot units: head top y = -163, centre x = 0; same as icon.svg / brand-variants.mjs) -----

export const GIFT_BOX = `<g class="ws-gift">
  <ellipse cx="0" cy="-1" rx="36" ry="4.5" fill="rgba(70,40,15,.12)"/>
  <rect x="-31" y="-44" width="62" height="43" rx="6" fill="#F28C7A"/>
  <rect x="-31" y="-44" width="62" height="9" rx="5" fill="#000" opacity=".06"/>
  <rect x="-6" y="-44" width="12" height="43" fill="#FFE08A"/>
  <g class="ws-lid">
    <rect x="-35" y="-54" width="70" height="13" rx="5" fill="#F6A291"/>
    <rect x="-6.5" y="-54" width="13" height="13" fill="#FFE08A"/>
    <path d="M0 -54 C-6 -66 -20 -66 -17 -58.5 C-15 -54 -6 -54 0 -54 Z M0 -54 C6 -66 20 -66 17 -58.5 C15 -54 6 -54 0 -54 Z" fill="#FFD166"/>
    <circle cx="0" cy="-55" r="3.6" fill="#F7C04A"/>
  </g>
</g>`;

/** Paws on the box (the puppet's own paws sit at the belly; these hold the box's upper corners). */
const BOX_PAWS = `<g class="ws-paws" fill="var(--mascot-paw)">
  <ellipse cx="-29" cy="-34" rx="8.5" ry="10"/><ellipse cx="29" cy="-34" rx="8.5" ry="10"/>
  <path d="M-32 -29 l1 2.4 M-27.5 -28 l.6 2.6 M32 -29 l-1 2.4 M27.5 -28 l-.6 2.6" stroke="rgba(150,90,40,.3)" stroke-width="1.1" stroke-linecap="round"/>
</g>`;

type Costume = 'birthday' | 'christmas' | 'justbecause' | 'invite';

export const COSTUMES: Record<Costume, { front: string; paws?: string }> = {
  // party hat (brand-variants.mjs), a touch smaller: the puppet's head is narrower at the top than the icon's
  birthday: { front: `<g transform="rotate(10 0 -160)">
    <path d="M-27 -162 L0 -236 L27 -162 Z" fill="#6C8CFF"/>
    <path d="M-20.4 -180 L-15.9 -192.4 L18.6 -180.9 L22.5 -170.5 Z M-11.2 -205 L-7.5 -215.2 L9.7 -207.9 L13.4 -197.7 Z" fill="#FFF9F1"/>
    <circle cx="0" cy="-238" r="9" fill="#FF7A9A"/>
    <ellipse cx="0" cy="-162" rx="28" ry="5" fill="#4E6AD6"/></g>` },
  // Santa hat (brand-variants.mjs)
  christmas: { front: `<g transform="rotate(-6 0 -160)">
    <path d="M-40 -166 C-34 -200 -6 -226 30 -222 C52 -220 62 -204 66 -186 C56 -196 44 -202 32 -200 C26 -186 30 -176 40 -166 Z" fill="#D64545"/>
    <path d="M-40 -166 C-34 -200 -6 -226 30 -222 C10 -214 -10 -196 -14 -166 Z" fill="#FFFFFF" opacity=".08"/>
    <rect x="-50" y="-174" width="100" height="18" rx="9" fill="#FFF9F1"/>
    <rect x="-50" y="-174" width="100" height="6" rx="3" fill="#FFFFFF"/>
    <circle cx="66" cy="-184" r="11" fill="#FFF9F1"/></g>` },
  // "einfach so": a small flower behind the left ear
  justbecause: { front: `<g transform="translate(-40 -150) rotate(-15)">
    ${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-10" rx="7" ry="10" fill="#FFB3C7" transform="rotate(${a})"/>`).join('')}
    <circle r="6.5" fill="#FFD166"/><circle r="2.4" cx="-1.6" cy="-1.6" fill="#fff" opacity=".6"/></g>` },
  // an invitation: an envelope held in both paws
  invite: { front: '', paws: `<g class="ws-envelope">
    <rect x="-30" y="-66" width="60" height="40" rx="5" fill="#FFF9F1" stroke="#E4CDB0" stroke-width="1.5"/>
    <path d="M-29 -64 L0 -44 L29 -64" fill="none" stroke="#E4CDB0" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="0" cy="-44" r="5.5" fill="#F28C7A"/>
    <path d="M-2.2 -45 a1.6 1.6 0 0 1 2.2 -1 a1.6 1.6 0 0 1 2.2 1 q0 1.6 -2.2 3 q-2.2 -1.4 -2.2 -3 Z" fill="#fff"/>
  </g>${BOX_PAWS.replace('ws-paws', 'ws-paws ws-env-paws')}` },
};

// ---- icons (24×24, stroke) ------------------------------------------------------------------------------

const ICON: Record<string, string> = {
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5A1.5 1.5 0 0 1 4 17.5Z M20 5.5C20 4.7 19.3 4 18.5 4H13v15h5.5a1.5 1.5 0 0 0 1.5-1.5Z"/>',
  headphones: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13.5" width="4.5" height="7" rx="2"/><rect x="16.5" y="13.5" width="4.5" height="7" rx="2"/>',
  ticket: '<path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4Z"/><path d="M14 6.5v11" stroke-dasharray="1.6 2"/>',
  plant: '<path d="M12 20v-7"/><path d="M12 13c0-4 2.5-6.5 7-6.5 0 4.5-2.5 6.5-7 6.5Z"/><path d="M12 15c0-3-2-5-6-5 0 3.5 2 5 6 5Z"/><path d="M7.5 20h9"/>',
  surprise: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M3 7.5h18V10H3Z"/><path d="M12 7.5V20"/><path d="M12 7.5C10.5 4 7 4 7.5 6.2 7.8 7.5 12 7.5 12 7.5Zm0 0c1.5-3.5 5-3.5 4.5-1.3-.3 1.3-4.5 1.3-4.5 1.3Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5 10 17 19 7.5"/>',
  cake: '<path d="M4 20h16v-7.5A1.5 1.5 0 0 0 18.5 11h-13A1.5 1.5 0 0 0 4 12.5Z"/><path d="M4 15.5c2.7 1.6 5.3 1.6 8 0 2.7 1.6 5.3 1.6 8 0"/><path d="M12 11V8"/><path d="M12 4.5c-1 1-1 2 0 2.5 1-.5 1-1.5 0-2.5Z"/>',
  tree: '<path d="M12 3 6 11h3l-4 6h14l-4-6h3Z"/><path d="M12 17v3.5"/>',
  heart: '<path d="M12 19.5C6.5 15.5 4 12.4 4 9.3 4 7 5.8 5.2 8.1 5.2c1.6 0 3 .9 3.9 2.2.9-1.3 2.3-2.2 3.9-2.2C18.2 5.2 20 7 20 9.3c0 3.1-2.5 6.2-8 10.2Z"/>',
  envelope: '<rect x="3.5" y="6" width="17" height="12.5" rx="2"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>',
};
export const icon = (name: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name] ?? ''}</svg>`;

// ---- styles (scoped to .ws) -----------------------------------------------------------------------------

const CSS_TEXT = `
.ws { max-width: 1180px; margin: 28px auto 8px; padding: 0 12px; }
.ws > h2 { margin: 4px 6px; font-size: 24px; letter-spacing: -.02em; }
.ws > p { margin: 0 6px 12px; font-size: 14px; color: var(--text-2); }
.ws-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 6px 6px 16px; font-size: 13px; color: var(--text-2); }
.ws-controls select, .ws-controls button { font: inherit; border-radius: 999px; border: 0; padding: 8px 14px; min-height: 40px; background: var(--tile); color: var(--text); cursor: pointer; }
.ws-row { display: flex; flex-wrap: wrap; gap: 28px; justify-content: center; align-items: flex-start; }
.ws-col { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.ws-col > small { font-size: 13px; color: var(--text-2); max-width: 340px; text-align: center; }
.ws-phone { position: relative; width: 360px; height: 740px; border-radius: 42px; overflow: hidden; flex: none;
  background: radial-gradient(120% 60% at 0% 0%, #F9D9C2 0%, transparent 55%), radial-gradient(90% 50% at 100% 30%, #F6D3CF 0%, transparent 60%),
    radial-gradient(90% 50% at 90% 100%, #E7DDF0 0%, transparent 60%), #F4EDE2;
  box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(40, 25, 10, .25);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, system-ui, sans-serif; color: #2A231C; -webkit-tap-highlight-color: transparent; }
.ws-top { position: absolute; left: 0; right: 0; top: 16px; display: flex; justify-content: flex-end; align-items: center; padding: 0 14px; z-index: 5; }
.ws-dots { position: absolute; left: 50%; transform: translateX(-50%); display: flex; gap: 7px; }
.ws-dots i { width: 7px; height: 7px; border-radius: 50%; background: rgba(42,35,28,.18); }
.ws-dots i.on { background: #B65F1A; }
.ws-skip { border: 0; border-radius: 999px; padding: 10px 16px; font-family: inherit; font-weight: 600; font-size: 15px; line-height: 1; color: #9A4A12; background: rgba(255,255,255,.75); box-shadow: 0 4px 14px rgba(70,45,20,.1); }
.ws-card { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; border-radius: 34px 34px 0 0; padding: 26px 20px 24px;
  display: flex; flex-direction: column; background: rgba(255,253,248,.88); box-shadow: 0 -12px 40px rgba(70,45,20,.08); box-sizing: border-box; }
.ws-bunny { position: absolute; z-index: 3; cursor: pointer; touch-action: manipulation; outline: none; border-radius: 40px; }
.ws-bunny:focus-visible { box-shadow: 0 0 0 3px rgba(240,160,75,.7); }
.ws-fx { position: absolute; inset: 0; z-index: 6; pointer-events: none; overflow: hidden; }
.ws-fx > * { position: absolute; will-change: transform, opacity; }
.ws-bubble { align-self: center; margin-top: 4px; padding: 14px 22px; border-radius: 22px; background: #fff; box-shadow: 0 8px 24px rgba(70,45,20,.1); font-weight: 700; font-size: 19px; }
.ws-slogan { margin: 30px 0 0; text-align: center; font-size: 30px; line-height: 1.18; font-weight: 750; letter-spacing: -.02em; }
.ws-slogan span { display: block; }
.ws-pet-hint { margin: 18px auto 0; font-size: 14px; color: #85786A; opacity: 0; transition: opacity .6s; }
.ws-pet-hint.on { opacity: 1; }
.ws-cta { margin-top: auto; border: 0; border-radius: 999px; min-height: 54px; font-family: inherit; font-weight: 650; font-size: 17px; line-height: 1; color: #2A1A0B; background: #F0A04B; cursor: pointer; }
.ws-cta:active { transform: scale(.97); }
.ws-cta.quiet { background: rgba(42,35,28,.07); color: #62554A; }
.ws-h { margin: 6px 0 0; text-align: center; font-size: 25px; font-weight: 750; letter-spacing: -.02em; }
.ws-sub { margin: 6px 0 0; text-align: center; font-size: 16px; color: #62554A; }
.ws-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin: 22px 0 0; }
.ws-chip { display: inline-flex; align-items: center; gap: 8px; min-height: 46px; padding: 0 16px 0 12px; border: 0; border-radius: 999px; cursor: pointer;
  font-family: inherit; font-weight: 600; font-size: 15px; line-height: 1; color: #2A231C; background: #fff; box-shadow: 0 4px 14px rgba(70,45,20,.09), inset 0 0 0 1px rgba(70,45,20,.06); }
.ws-chip svg { width: 22px; height: 22px; color: #C2661E; flex: none; }
.ws-chip.done { background: #FFF1DF; box-shadow: inset 0 0 0 1.5px #F0A04B; color: #7A4A1C; cursor: default; }
.ws-chip.done svg { color: #2E8B57; }
.ws-chip.flying { visibility: hidden; }
.ws-own { display: none; margin: 14px 0 0; gap: 8px; }
.ws-own.on { display: flex; }
.ws-own input { flex: 1; min-width: 0; min-height: 46px; border-radius: 14px; border: 1px solid #D9CBB8; padding: 0 14px; font-family: inherit; font-size: 16px; background: #fff; }
.ws-own button { min-height: 46px; border: 0; border-radius: 14px; padding: 0 14px; font-family: inherit; font-weight: 650; font-size: 15px; background: #F0A04B; color: #2A1A0B; }
.ws-count { margin: 16px 0 0; min-height: 20px; text-align: center; font-size: 14px; color: #62554A; }
.ws-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0 0; }
.ws-occ { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-height: 104px; padding: 14px; border: 0; border-radius: 22px; cursor: pointer; text-align: left;
  font-family: inherit; font-weight: 650; font-size: 16px; line-height: 1.2; color: #2A231C; background: #fff; box-shadow: 0 6px 18px rgba(70,45,20,.08), inset 0 0 0 1px rgba(70,45,20,.05);
  transition: box-shadow .25s, background-color .25s; }
.ws-occ i { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 14px; background: #FDE8D0; color: #C2661E; }
.ws-occ i svg { width: 24px; height: 24px; }
.ws-occ.on { background: #FFF6EA; box-shadow: inset 0 0 0 2px #F0A04B, 0 8px 22px rgba(240,160,75,.25); }
`;

// ---- one phone -----------------------------------------------------------------------------------------

interface Phone { root: HTMLElement; card: HTMLElement; fx: HTMLElement; bunny: Bunny; bunnyHost: HTMLElement; destroy(): void }

const BUNNY_SIZE = 290;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function makePhone(step: number, reducedMotion: ReducedMotionMode, cardTop = 300): Phone {
  const root = el('div', 'ws-phone');
  const top = el('div', 'ws-top', `<div class="ws-dots">${[1, 2, 3].map((n) => `<i class="${n === step ? 'on' : ''}"></i>`).join('')}</div><button class="ws-skip" type="button">Überspringen</button>`);
  const card = el('div', 'ws-card');
  const bunnyHost = el('div', 'ws-bunny');
  // the puppet's feet (viewBox 400×260, feet at y 246) stand on the card's top edge, a hair into it
  bunnyHost.style.cssText = `left:${(360 - BUNNY_SIZE) / 2}px;top:${cardTop - (246 / 400) * BUNNY_SIZE + 8}px;width:${BUNNY_SIZE}px`;
  card.style.top = `${cardTop}px`;
  const fx = el('div', 'ws-fx');
  root.append(top, card, bunnyHost, fx);
  const bunny = new Bunny(bunnyHost, { coat: 'fawn', ears: 'lop', size: BUNNY_SIZE, idle: true, reducedMotion, interactive: false });
  return { root, card, fx, bunny, bunnyHost, destroy: () => bunny.destroy() };
}

/** Where an element's centre is, in the phone's own coordinates. */
function centreIn(phone: HTMLElement, target: Element): { x: number; y: number } {
  const p = phone.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  return { x: r.left + r.width / 2 - p.left, y: r.top + r.height / 2 - p.top };
}

/** Puts extra markup into the puppet's breathing group: `before` the paws (box, envelope) or in front of all. */
export function dress(bunny: Bunny, markup: string, where: 'beforePaws' | 'front'): SVGGElement | null {
  const breathe = bunny.root.querySelector('.breathe');
  if (!breathe) return null;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'ws-extra');
  g.innerHTML = markup;
  if (where === 'beforePaws') breathe.insertBefore(g, breathe.querySelector('.tp'));
  else breathe.append(g);
  return g;
}

/** The puppet's own paws (`.tp`, at the belly) hide while extra paws hold something (box, envelope):
 *  otherwise the bunny has four paws (Felix 25.10). */
export function ownPaws(bunny: Bunny, shown: boolean): void {
  const paws = bunny.root.querySelector<SVGGElement>('.tp');
  if (paws) paws.style.visibility = shown ? '' : 'hidden';
}

/** Runs `done` once the animation finished or was cancelled (`finished` rejects on cancel). */
function settle(anim: Animation, done: () => void): void {
  anim.finished.then(done, done);
}

/** Keeps the running animations of one phone, so destroy() can cancel them. */
function tracker(): { live: Set<Animation>; track: (a: Animation) => Animation } {
  const live = new Set<Animation>();
  return { live, track: (a) => { live.add(a); settle(a, () => live.delete(a)); return a; } };
}

function vibrate(ms: number): void {
  // gallery only — in the app this is the one haptics wrapper (lib/haptics.ts)
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

function confettiBurst(fx: HTMLElement, at: { x: number; y: number }, calm: boolean, seed: number): Animation[] {
  if (calm) return [];
  const colors = ['#6C8CFF', '#FF7A9A', '#FFD166', '#7FD1AE', '#F0A04B'];
  const out: Animation[] = [];
  for (let i = 0; i < 14; i++) {
    const piece = el('i');
    const round = i % 3 === 0;
    piece.style.cssText = `left:${at.x - 4}px;top:${at.y - 3}px;width:${round ? 7 : 9}px;height:${round ? 7 : 5}px;border-radius:${round ? '50%' : '2px'};background:${colors[i % colors.length]}`;
    fx.append(piece);
    const anim = piece.animate(confettiKeyframes(seed * 31 + i), { duration: 900 + (i % 4) * 60, easing: 'linear', fill: 'forwards' });
    settle(anim, () => piece.remove());
    out.push(anim);
  }
  return out;
}

// ---- screen 1: hello + pet Pompon ----------------------------------------------------------------------

function screenHello(reducedMotion: ReducedMotionMode): Phone {
  const phone = makePhone(1, reducedMotion);
  const calm = reducedMotion === 'force';
  phone.card.innerHTML = `<div class="ws-bubble">Hallo Felix! Ich bin Pompon.</div>
    <p class="ws-slogan"><span>Träumen.</span><span>Wünschen.</span><span>Freude schenken.</span></p>
    <p class="ws-pet-hint">psst … streichel mich mal</p>
    <button class="ws-cta" type="button">Weiter</button>`;
  const hint = phone.card.querySelector('.ws-pet-hint');
  const hintTimer = setTimeout(() => hint?.classList.add('on'), 3500);
  phone.bunnyHost.tabIndex = 0;
  phone.bunnyHost.setAttribute('role', 'button');
  phone.bunnyHost.setAttribute('aria-label', 'Pompon streicheln');
  const timers: ReturnType<typeof setTimeout>[] = [];
  let lastPet = 0;
  let hearts = 0;
  const pet = () => {
    const now = performance.now();
    if (now - lastPet < 650) return; // rate limit: one reaction at a time, never stacked
    lastPet = now;
    hint?.classList.remove('on');
    vibrate(8);
    const b = phone.bunny;
    b.setEyes('happy');
    b.setPuff(1.12);
    timers.push(setTimeout(() => { b.setEyes('normal'); b.setPuff(1); }, 1100));
    // blush deepens and fades back (opacity only)
    for (const blush of b.root.querySelectorAll('.tf > ellipse')) {
      blush.animate([{ opacity: 0.3 }, { opacity: 0.85, offset: 0.3 }, { opacity: 0.85, offset: 0.7 }, { opacity: 0.3 }], { duration: 1300, easing: 'ease-in-out' });
    }
    if (!calm) {
      // ears wiggle around their own pivots (bouncy settle)
      const wiggle = (deg: number): Keyframe[] => [{ transform: 'rotate(0deg)' }, { transform: `rotate(${deg}deg)`, offset: 0.25 }, { transform: `rotate(${-deg * 0.6}deg)`, offset: 0.55 }, { transform: `rotate(${deg * 0.25}deg)`, offset: 0.8 }, { transform: 'rotate(0deg)' }];
      b.root.querySelector('.lop .ear-l')?.animate(wiggle(9), { duration: 700, easing: 'ease-in-out' });
      b.root.querySelector('.lop .ear-r')?.animate(wiggle(-9), { duration: 700, easing: 'ease-in-out', delay: 60 });
    }
    // hearts: at most three alive; calm = one heart fading in place
    const head = b.root.querySelector('.tf') ?? b.root.querySelector('svg');
    if (!head) return;
    const at = centreIn(phone.root, head);
    const count = calm ? 1 : 3;
    for (let i = 0; i < count && hearts < 3; i++) {
      hearts++;
      const heart = el('div', undefined, `<svg viewBox="0 0 24 22" width="${18 + (i % 2) * 6}" height="${16 + (i % 2) * 6}"><path d="M12 21C5 15 1 11 1 6.5 1 3.4 3.4 1 6.5 1c2.1 0 4.1 1.2 5.5 3 1.4-1.8 3.4-3 5.5-3C20.6 1 23 3.4 23 6.5 23 11 19 15 12 21Z" fill="${i === 1 ? '#FF7A9A' : '#FF9EB0'}"/></svg>`);
      heart.style.left = `${at.x - 10 + (i - 1) * 18}px`;
      heart.style.top = `${at.y - 70}px`;
      phone.fx.append(heart);
      const frames: Keyframe[] = calm ? [{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }] : heartKeyframes(i);
      const anim = heart.animate(frames, { duration: calm ? 1200 : 1300 + i * 120, delay: calm ? 0 : i * 110, easing: EASE.smooth, fill: 'backwards' });
      settle(anim, () => { heart.remove(); hearts--; });
    }
  };
  phone.bunnyHost.addEventListener('click', pet);
  phone.bunnyHost.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pet(); } });
  return { ...phone, destroy: () => { clearTimeout(hintTimer); timers.forEach(clearTimeout); phone.destroy(); } };
}

// ---- screen 2: the wish box ----------------------------------------------------------------------------

const WISHES: readonly { id: string; label: string; icon: string }[] = [
  { id: 'books', label: 'Bücher', icon: 'book' },
  { id: 'headphones', label: 'Kopfhörer', icon: 'headphones' },
  { id: 'experience', label: 'Ein Erlebnis', icon: 'ticket' },
  { id: 'plant', label: 'Pflanze', icon: 'plant' },
  { id: 'surprise', label: 'Überraschung', icon: 'surprise' },
];

function screenWishBox(reducedMotion: ReducedMotionMode): Phone {
  const phone = makePhone(2, reducedMotion, 280);
  const calm = reducedMotion === 'force';
  dress(phone.bunny, GIFT_BOX + BOX_PAWS, 'beforePaws');
  ownPaws(phone.bunny, false);
  const lid = phone.bunny.root.querySelector<SVGGElement>('.ws-lid');
  phone.card.innerHTML = `<h3 class="ws-h">Was wünschst du dir?</h3><p class="ws-sub">Träum ruhig groß!</p>
    <div class="ws-chips">${WISHES.map((w) => `<button class="ws-chip" type="button" data-wish="${w.id}">${icon(w.icon)}<span>${w.label}</span></button>`).join('')}
      <button class="ws-chip" type="button" data-own="1">${icon('plus')}<span>Eigener Wunsch …</span></button></div>
    <form class="ws-own"><input type="text" maxlength="60" placeholder="z. B. Ein Tag am Meer" aria-label="Eigener Wunsch"><button type="submit">Rein damit</button></form>
    <p class="ws-count" aria-live="polite"></p>
    <button class="ws-cta quiet" type="button">Später</button>`;
  const count = phone.card.querySelector<HTMLElement>('.ws-count');
  const cta = phone.card.querySelector<HTMLButtonElement>('.ws-cta');
  const own = phone.card.querySelector<HTMLFormElement>('.ws-own');
  const ownInput = own?.querySelector('input');
  let wishes = 0;
  let burstSeed = 1;
  let bursts = 0;
  const { live, track } = tracker();

  const landed = () => {
    wishes++;
    if (count) count.textContent = wishes === 1 ? 'Dein erster Wunsch ist in der Box!' : `Schon ${wishes} Wünsche in der Box`;
    if (cta) { cta.textContent = 'Weiter'; cta.classList.remove('quiet'); }
    vibrate(10);
    const b = phone.bunny;
    b.setEyes('happy');
    setTimeout(() => b.setEyes('normal'), 900);
    if (calm || !lid) return;
    // the lid pops up and settles on the bouncy spring (restarts if another wish lands meanwhile)
    lid.getAnimations().forEach((a) => a.cancel());
    track(lid.animate([
      { transform: 'translateY(0px) rotate(0deg)' },
      { transform: 'translateY(-16px) rotate(-7deg)', offset: 0.3 },
      { transform: 'translateY(0px) rotate(0deg)' },
    ], { duration: 560, easing: EASE.bouncy }));
    void b.hop();
    if (bursts < 2) {
      bursts++;
      const at = centreIn(phone.root, lid);
      const pieces = confettiBurst(phone.fx, { x: at.x, y: at.y - 6 }, calm, burstSeed++);
      pieces.forEach(track);
      void Promise.allSettled(pieces.map((p) => p.finished)).then(() => { bursts--; });
    }
  };

  const throwIntoBox = (from: HTMLElement, label: string, iconName: string) => {
    if (calm || !lid) { landed(); return; }
    const start = centreIn(phone.root, from);
    const end = centreIn(phone.root, lid);
    const ghost = el('div', 'ws-chip', `${icon(iconName)}<span>${label}</span>`);
    ghost.style.cssText = 'position:absolute;margin:0;transform-origin:center';
    phone.fx.append(ghost);
    const w = ghost.offsetWidth;
    const h = ghost.offsetHeight;
    ghost.style.left = `${start.x - w / 2}px`;
    ghost.style.top = `${start.y - h / 2}px`;
    const flight = track(ghost.animate(flightKeyframes(end.x - start.x, end.y - start.y - 6), { duration: 720, fill: 'forwards' }));
    flight.finished.then(() => { ghost.remove(); landed(); }, () => ghost.remove());
  };

  phone.card.querySelector('.ws-chips')?.addEventListener('click', (event) => {
    const chip = (event.target as Element).closest<HTMLButtonElement>('.ws-chip');
    if (!chip || chip.classList.contains('done')) return;
    if (chip.dataset['own']) { own?.classList.add('on'); ownInput?.focus(); return; }
    const wish = WISHES.find((w) => w.id === chip.dataset['wish']);
    if (!wish) return;
    chip.classList.add('done');
    chip.disabled = true;
    const svg = chip.querySelector('svg');
    if (svg) svg.outerHTML = icon('check');
    if (!calm) {
      // the chip "lets go" of a copy that flies; the chip itself stays as a checked, quieter pill
      track(chip.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: DUR.bouncy, easing: EASE.bouncy }));
    } else {
      track(chip.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' }));
    }
    throwIntoBox(chip, wish.label, wish.icon);
  });
  own?.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = ownInput?.value.trim() ?? '';
    if (!text || !ownInput) return;
    ownInput.value = '';
    throwIntoBox(ownInput, text, 'heart');
  });
  return { ...phone, destroy: () => { live.forEach((a) => a.cancel()); phone.destroy(); } };
}

// ---- screen 3: occasions with costumes -----------------------------------------------------------------

const OCCASIONS: readonly { id: Costume; label: string; icon: string }[] = [
  { id: 'birthday', label: 'Geburtstag', icon: 'cake' },
  { id: 'christmas', label: 'Weihnachten', icon: 'tree' },
  { id: 'justbecause', label: 'Einfach so', icon: 'heart' },
  { id: 'invite', label: 'Ich habe eine Einladung', icon: 'envelope' },
];

function screenOccasions(reducedMotion: ReducedMotionMode): Phone {
  const phone = makePhone(3, reducedMotion, 262);
  const calm = reducedMotion === 'force';
  phone.card.innerHTML = `<h3 class="ws-h">Was feierst du als Nächstes?</h3><p class="ws-sub">Pompon zieht sich schon mal um.</p>
    <div class="ws-cards">${OCCASIONS.map((o) => `<button class="ws-occ" type="button" aria-pressed="false" data-occ="${o.id}"><i>${icon(o.icon)}</i>${o.label}</button>`).join('')}</div>
    <button class="ws-cta" type="button" disabled style="opacity:.45">Los geht's!</button>`;
  const cta = phone.card.querySelector<HTMLButtonElement>('.ws-cta');
  let worn: SVGGElement | null = null;
  let current: Costume | null = null;
  const { live, track } = tracker();

  const wear = (costume: Costume) => {
    if (costume === current) return;
    current = costume;
    // the old costume pops off (snappy), the new one drops on (bouncy)
    const old = worn;
    const spec = COSTUMES[costume];
    // holding the envelope: its own paws replace the puppet's at once; back to a hat: the puppet's paws
    // return when the envelope (with its paws) has left, so there are never four paws
    if (spec.paws) ownPaws(phone.bunny, false);
    if (old) {
      if (calm) { old.remove(); if (!spec.paws) ownPaws(phone.bunny, true); }
      else {
        const off = track(old.animate([{ transform: 'translateY(0px)', opacity: 1 }, { transform: 'translateY(-26px) scale(.9)', opacity: 0 }], { duration: DUR.snappy, easing: EASE.snappy, fill: 'forwards' }));
        settle(off, () => { old.remove(); if (!spec.paws && current === costume) ownPaws(phone.bunny, true); });
      }
    }
    const group = spec.paws ? dress(phone.bunny, spec.paws, 'beforePaws') : dress(phone.bunny, spec.front, 'front');
    worn = group;
    if (group) {
      group.style.transformBox = 'fill-box';
      group.style.transformOrigin = '50% 100%';
      track(group.animate(calm
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ transform: 'translateY(-46px) scale(.9)', opacity: 0 }, { transform: 'translateY(-46px) scale(.9)', opacity: 1, offset: 0.15 }, { transform: 'translateY(0px) scale(1)', opacity: 1 }],
      { duration: calm ? 250 : 620, easing: calm ? 'ease-out' : EASE.bouncy }));
    }
    phone.bunny.setEyes('happy');
    setTimeout(() => phone.bunny.setEyes('normal'), 800);
    if (!calm) setTimeout(() => { void phone.bunny.hop(); }, 280);
    vibrate(8);
    if (cta) { cta.disabled = false; cta.style.opacity = '1'; }
  };

  phone.card.querySelector('.ws-cards')?.addEventListener('click', (event) => {
    const card = (event.target as Element).closest<HTMLButtonElement>('.ws-occ');
    if (!card) return;
    phone.card.querySelectorAll('.ws-occ').forEach((c) => { c.classList.toggle('on', c === card); c.setAttribute('aria-pressed', String(c === card)); });
    if (!calm) track(card.animate([{ transform: 'scale(1)' }, { transform: 'scale(.96)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: DUR.bouncy, easing: EASE.bouncy }));
    wear(card.dataset['occ'] as Costume);
  });
  cta?.addEventListener('click', () => {
    // the end of the onboarding: a happy hop and confetti from Pompon's head
    vibrate(14);
    void phone.bunny.hop();
    const head = phone.bunny.root.querySelector('.tf');
    // from above the head, so the confetti never covers his face
    if (head) { const at = centreIn(phone.root, head); confettiBurst(phone.fx, { x: at.x, y: at.y - 58 }, calm, 7).forEach(track); }
  });
  return { ...phone, destroy: () => { live.forEach((a) => a.cancel()); phone.destroy(); } };
}

// ---- the gallery section -------------------------------------------------------------------------------

const SCREENS = [
  { title: '1 · Hallo — погладь Помпона', note: 'Тапни по кролику: румянец, уши, сердечки. Не чаще раза в 0,65 с. Подсказка «psst …» появляется через 3,5 с.', make: screenHello },
  { title: '2 · Коробка желаний', note: 'Тапни по пузырькам: каждый летит в коробку, крышка подпрыгивает, Помпон радуется. «Eigener Wunsch …» — свой текст.', make: screenWishBox },
  { title: '3 · Повод и наряд', note: 'Выбери карточку — Помпон переодевается. «Los geht\'s!» — финальный прыжок и конфетти.', make: screenOccasions },
] as const;

export function welcomeScreensGallery(app: HTMLElement, query: URLSearchParams): void {
  const only = query.get('screens') === 'welcome';
  const single = Number(query.get('screen')) || 0;
  if (only) app.replaceChildren();
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);
  const section = el('section', 'ws');
  section.innerHTML = `<h2>Новое приветствие (25.10) — прототип</h2><p>Только в галерее, в приложение не попадает, пока Кирилл не одобрит. Тексты — немецкие, как в приложении.</p>`;
  const controls = el('div', 'ws-controls');
  const motion = el('select');
  motion.setAttribute('aria-label', 'Движение');
  motion.add(new Option('Полное движение', 'off'));
  motion.add(new Option('Уменьшенное движение', 'force'));
  motion.value = query.get('reduced') === '1' ? 'force' : 'off';
  const reset = el('button', undefined, 'Сначала');
  reset.type = 'button';
  controls.append(motion, reset);
  const row = el('div', 'ws-row');
  section.append(controls, row);
  if (only) app.append(section); else app.prepend(section);

  let phones: Phone[] = [];
  const build = () => {
    phones.forEach((p) => p.destroy());
    row.replaceChildren();
    phones = SCREENS.filter((_, i) => !single || single === i + 1).map((screen) => {
      const col = el('div', 'ws-col');
      const phone = screen.make(motion.value as ReducedMotionMode);
      col.append(el('b', undefined, screen.title), phone.root, el('small', undefined, screen.note));
      row.append(col);
      return phone;
    });
    (window as unknown as { welcomeScreens: Phone[] }).welcomeScreens = phones;
  };
  motion.addEventListener('change', build);
  reset.addEventListener('click', build);
  build();
  window.addEventListener('pagehide', () => phones.forEach((p) => p.destroy()), { once: true });
}
