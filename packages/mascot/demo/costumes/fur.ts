/**
 * New bunnies and experiments on Pompon himself (31.10, Felix: «можешь даже поэкспериментировать именно с кроликом,
 * может добавить волос или каких-то деталей … Надо сохранить милость») — GALLERY-ONLY prototype.
 *
 * All of them are the SAME puppet (bunnyMarkup): other coat colours (custom properties on the host), the package's
 * upright ears, Krümel's round baby body for the dwarf (demo/kruemel/kit.ts applyKit), and fur drawn into the rig's
 * slots (rig.ts) — a mane under the face, eye rings under the eyes, tufts inside the ears and cheeks. Nothing in
 * packages/mascot/src changes; Pompon in the app stays exactly as he is.
 */

import { applyKit } from '../kruemel/kit';
import { CHEEK_PTS, cheekFluff } from '../../src/fur';
import type { WearerId } from './costumes';
import { ell, f, flipX, line, mirror, outside, smooth, type CoatColors, type Layer, type Look, type Model, type Pt } from './rig';

const LN = 'class="cs-ln"';
const p = (d: string, fill: string, extra = '') => `<path d="${d}" fill="${fill}"${extra ? ` ${extra}` : ''}/>`;
const ln = (d: string) => `<path ${LN} d="${d}"/>`;
const g = (cls: string, inner: string) => `<g class="${cls}">${inner}</g>`;

/** A scalloped ring (a mane): outer edge with `n` soft bumps, an inner hole; outer and inner as separate paths. */
export function maneRing(cx: number, cy: number, o: { rx: number; ry: number }, i: { rx: number; ry: number }, n: number, amp: number, crest = 0): { outer: string; inner: string; outerPts: Pt[] } {
  const outerPts: Pt[] = [];
  for (let k = 0; k < n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    // bumps every other point; the crest grows the bumps on top (a lionhead's "wool cap")
    const top = Math.max(0, -Math.sin(a)) ** 3;
    const r = k % 2 === 0 ? 1 + (amp + crest * top) / o.rx : 1 - amp * 0.35 / o.rx;
    outerPts.push([cx + o.rx * r * Math.cos(a), cy + o.ry * r * Math.sin(a)]);
  }
  const innerPts: Pt[] = [];
  for (let k = 0; k < n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = k % 2 === 0 ? 1 - 2.4 / i.rx : 1 + 1.2 / i.rx;
    innerPts.push([cx + i.rx * r * Math.cos(a), cy + i.ry * r * Math.sin(a)]);
  }
  return { outer: smooth(outerPts), inner: smooth(innerPts), outerPts };
}

// ---- the models: who wears costumes ----------------------------------------------------------------------------

const LEO_COAT: CoatColors = ['#F8CC98', '#EAA86A', '#FFF3E3', '#E39A5B', '#C97C3E', '#F4CFA4', '#F2A894'];
const HOTOT_COAT: CoatColors = ['#FFFFFF', '#F1ECE6', '#FFFFFF', '#F5EFE9', '#E1D6CB', '#FFFFFF', '#F6C1C1'];
const AGOUTI_COAT: CoatColors = ['#CDB9A2', '#AF9880', '#F7F1E8', '#9C8571', '#7B6655', '#DCCBB7', '#E9B4A8'];

/**
 * Leo the lionhead: a soft wool mane round his face and a crest between the ears — in his OWN coat (the same
 * gradient as his head, so it reads as a big fluffy head, not as a collar); its contour only where the wool sticks out
 * (rig.outside), a few lighter strands for texture. It does not shift in the 3/4 turn: his face turns inside it.
 */
// (31.10: kept exactly as Felix reviewed him — a ginger dwarf is being built as a new character elsewhere, demo/binky*;
// Leo's rework and the ear tufts wait until that is settled)
const LEO_MANE = maneRing(0, -104, { rx: 82, ry: 66 }, { rx: 56, ry: 46 }, 17, 3.6, 7);
function strands(cx: number, cy: number, r0: { rx: number; ry: number }, r1: { rx: number; ry: number }, n: number, from: number, to: number): string {
  let d = '';
  for (let k = 0; k < n; k++) {
    const a = ((from + ((to - from) * (k + 0.5)) / n) * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x0 = cx + r0.rx * c;
    const y0 = cy + r0.ry * s;
    const x1 = cx + r1.rx * c;
    const y1 = cy + r1.ry * s;
    d += `M${f(x0)} ${f(y0)} Q${f((x0 + x1) / 2 + 3 * s)} ${f((y0 + y1) / 2 - 3 * c)} ${f(x1)} ${f(y1)} `;
  }
  return d.trim();
}
const leoFur: Look = {
  id: 'leo-mane',
  layers: [{
    slot: 'fur',
    draw: (c) => p(LEO_MANE.outer, c.gBody) + outside(c, ln(LEO_MANE.outer))
      + p(strands(0, -104, { rx: 66, ry: 54 }, { rx: 80, ry: 64 }, 18, 160, 380), 'none', 'stroke="#FFF3E3" stroke-width="2.6" stroke-linecap="round" stroke-opacity=".75"')
      + p(strands(0, -104, { rx: 62, ry: 50 }, { rx: 74, ry: 60 }, 14, 170, 370), 'none', 'stroke="#D98E50" stroke-width="2" stroke-linecap="round" stroke-opacity=".3"'),
  }],
};

/** Knopf: Krümel's round baby body, two short upright ears close together, a Hotot's dark eye bands. */
const KNOPF_EAR = ell(-15, -150, 9.2, 19.5, -13);
const KNOPF_EAR_IN = ell(-15, -148.5, 4.6, 13.5, -13);
function knopfShape(root: ShadowRoot): void {
  const svg = root.querySelector('svg');
  if (!svg) return;
  applyKit(svg, 'upright');
  if (svg.dataset['knopf']) return;
  svg.dataset['knopf'] = '1';
  const l = svg.querySelector('.up .ear-l');
  const r = svg.querySelector('.up .ear-r');
  if (l) l.innerHTML = p(KNOPF_EAR, 'var(--mascot-accent)') + p(KNOPF_EAR_IN, 'var(--mascot-ear-in)');
  if (r) r.innerHTML = p(flipX(KNOPF_EAR), 'var(--mascot-accent)') + p(flipX(KNOPF_EAR_IN), 'var(--mascot-ear-in)');
  const style = document.createElement('style');
  style.dataset['knopf'] = '';
  style.textContent = '.kit .up .ear-l { transform-box: view-box; transform-origin: -12px -133px; } .kit .up .ear-r { transform-box: view-box; transform-origin: 12px -133px; }';
  root.append(style);
}
const knopfFur: Look = {
  id: 'knopf-hotot',
  // thin dark rings with a little gap round each eye (a Hotot's "eyeliner"); a full dark band merged with the eye
  layers: [{ slot: 'face-under', draw: () => p(`${ell(-25, -84, 11.6, 13)} ${ell(25, -84, 11.6, 13)}`, 'none', 'stroke="#5A4842" stroke-width="2.6"') }],
};

/** Hasel the agouti: wild colour, light eye rings, darker ear rims and tips, a little ticking on the head. */
const UP_EAR_L = ell(-21, -180, 11.5, 26, -12);
function agouti(): Look {
  const tick = (x: number, y: number, a: number) => `M${f(x)} ${f(y)} q${f(3 * Math.cos(a))} ${f(3 * Math.sin(a) - 2)} ${f(6 * Math.cos(a))} ${f(6 * Math.sin(a))}`;
  const ticks = [[-30, -150, 0.3], [-12, -156, 0.1], [8, -155, -0.1], [26, -150, -0.3], [-44, -136, 0.6], [44, -136, -0.6], [-20, -142, 0.2], [18, -142, -0.2], [-56, -118, 1], [56, -118, -1]]
    .map(([x, y, a]) => tick(x as number, y as number, a as number)).join(' ');
  const ear = (side: 'l' | 'r') => (c: { uid: string }) => {
    const d = side === 'l' ? UP_EAR_L : flipX(UP_EAR_L);
    const id = `${c.uid}-ag-${side}`;
    return `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${p(ell(side === 'l' ? -26 : 26, -205, 13, 9, side === 'l' ? -12 : 12), '#6E5A4B', 'opacity=".55"')}</g>`
      + p(d, 'none', 'stroke="#7B6655" stroke-width="2.6" stroke-opacity=".45"');
  };
  return {
    id: 'hasel-agouti',
    layers: [
      { slot: 'fur', draw: (c) => `<g clip-path="${c.clip}">${p(ticks, 'none', 'stroke="#7B6655" stroke-width="2.6" stroke-linecap="round" stroke-opacity=".28"')}</g>` },
      { slot: 'face-under', draw: () => p(ell(-29, -93, 10.6, 12), '#F7F1E8', 'opacity=".85"') + p(ell(29, -93, 10.6, 12), '#F7F1E8', 'opacity=".85"') },
      { slot: 'ear-l', draw: ear('l') },
      { slot: 'ear-r', draw: ear('r') },
    ],
  };
}

/**
 * Mila's blossom — the same drawing as the comic's (demo/story/strip-art.ts `blossom`, copied, not imported: that folder
 * is being reworked by another helper), centred on (x, y) in puppet units; it goes INSIDE her left lop ear, so it swings
 * with it.
 */
const r1 = (v: number) => String(Math.round(v * 10) / 10);
export function milaBlossom(x = -34, y = -152, r = 10.5): string {
  const petals = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(a) * r * 0.62;
    const py = y + Math.sin(a) * r * 0.62;
    return `<ellipse cx="${r1(px)}" cy="${r1(py)}" rx="${r1(r * 0.5)}" ry="${r1(r * 0.42)}" transform="rotate(${r1((a * 180) / Math.PI + 90)} ${r1(px)} ${r1(py)})" fill="#FF8FA3" stroke="#D9667E" stroke-width="1"/>`;
  }).join('');
  return `<g class="blossom">${petals}<circle cx="${x}" cy="${y}" r="${r1(r * 0.32)}" fill="#FFD46B" stroke="#E3A340" stroke-width=".8"/>`
    + `<path d="M${r1(x + r * 0.6)} ${r1(y + r * 0.7)} q${r1(r * 0.9)} ${r1(r * 0.3)} ${r1(r * 1.2)} ${r1(r * 1.1)}" fill="none" stroke="#6CB84C" stroke-width="2" stroke-linecap="round"/>`
    + `<ellipse cx="${r1(x + r * 1.45)}" cy="${r1(y + r * 1.25)}" rx="${r1(r * 0.42)}" ry="${r1(r * 0.22)}" transform="rotate(35 ${r1(x + r * 1.45)} ${r1(y + r * 1.25)})" fill="#7AC458"/></g>`;
}
const milaFur: Look = { id: 'mila-blossom', hide: ['muzzle'], layers: [{ slot: 'ear-l', draw: () => milaBlossom() }] };

export interface ModelInfo extends Model {
  id: WearerId;
  /** names (DE, RU), breed and a one-line role — for the new bunnies */
  de: string;
  ru: string;
  breed?: string;
  role?: string;
  photos?: readonly number[];
  /** shown smaller in the family line-up (a dwarf) */
  scale?: number;
}

export const MODELS: Readonly<Record<WearerId, ModelInfo>> = {
  pompon: { id: 'pompon', kind: 'bunny', coat: 'fawn', ears: 'lop', de: 'Pompon', ru: 'Помпон' },
  tapsi: { id: 'tapsi', kind: 'hamster', coat: 'golden', de: 'Tapsi', ru: 'Тапси' },
  // Mila as in the comic (30.10, Felix: «ушки выглядят на нём не очень» about her upright ears): the approved LOP-eared
  // puppet, coat 'broken', a pink blossom on her left ear, the coat's two muzzle spots off
  mila: { id: 'mila', kind: 'bunny', coat: 'broken', ears: 'lop', fur: milaFur, de: 'Mila', ru: 'Мила' },
  leo: {
    id: 'leo', kind: 'bunny', coat: 'fawn', ears: 'upright', paint: LEO_COAT, fur: leoFur, de: 'Leo', ru: 'Лёва',
    breed: 'львиноголовый (Löwenkopf)', photos: [7, 11],
    role: 'Праздничный: встречает на страницах вечеринок и больших дней рождения — грива как праздничный воротник; в костюме самурая — «защитник желаний».',
  },
  knopf: {
    id: 'knopf', kind: 'bunny', coat: 'fawn', ears: 'upright', paint: HOTOT_COAT, shape: knopfShape, fur: knopfFur, de: 'Knopf', ru: 'Пуговка',
    breed: 'карликовый хотот (Zwerg-Hotot): белый, тёмные «очки» вокруг глаз', photos: [2, 13], scale: 0.92,
    role: 'Самый маленький: появляется в крошечных подтверждениях («Gespeichert», «Kopiert») — выглянул на секунду и спрятался.',
  },
  hasel: {
    id: 'hasel', kind: 'bunny', coat: 'fawn', ears: 'upright', paint: AGOUTI_COAT, fur: agouti(), de: 'Hasel', ru: 'Орешек',
    breed: 'серый агути (Wildfarbe)', photos: [3, 12],
    role: 'Искатель: живёт в «Ideen» — нюхает и приносит идеи подарков (там, где сейчас Помпон с колодой).',
  },
};

/** 31.10, Felix: «Новые кролики не очень. Лёва ещё более-менее» — only Leo stays on the page; Knopf and Hasel are archived
 * (code kept, shown with &archived=1). */
export const NEW_BUNNIES: readonly WearerId[] = ['leo'];
export const ARCHIVED_BUNNIES: readonly WearerId[] = ['knopf', 'hasel'];

// ---- experiments on Pompon -------------------------------------------------------------------------------------

/** The forelock: three soft wisps on the top of his head, between the ear roots. */
const TUFT = 'M-13 -150 C-14 -158 -12.5 -166 -9 -171 C-7.4 -166.6 -5.6 -164 -3.4 -162.6 C-3.6 -169.6 -1.2 -175 2.4 -178 C3 -172 4.8 -167.6 7.2 -165.6 C8.2 -168.4 9.6 -170.4 11.6 -170.8 C12.6 -164 13.4 -157 13 -150 Z';
const TUFT_LN = 'M-12.4 -162 C-12 -165.6 -10.8 -168.6 -9 -171 C-7.4 -166.6 -5.6 -164 -3.4 -162.6 C-3.6 -169.6 -1.2 -175 2.4 -178 C3 -172 4.8 -167.6 7.2 -165.6 C8.2 -168.4 9.6 -170.4 11.6 -170.8 C12.2 -167.6 12.6 -164.6 12.8 -162';
/** The single curl (an "ahoge"): one strand from the crown curling over. */
const CURL = 'M-3.4 -158 C-6.6 -170 -3 -183 8 -186.4 C15.4 -188.6 19.6 -181.6 15.6 -176.6 C14.4 -180.6 10.4 -182 6.6 -179.6 C1.6 -176.4 0.6 -168 3.4 -158 Z';
const CURL_LN = 'M-4.6 -163.4 C-5.4 -173 -1.2 -183.4 8 -186.4 C15.4 -188.6 19.6 -181.6 15.6 -176.6 C14.4 -180.6 10.4 -182 6.6 -179.6 C2.6 -177 1.2 -170.6 2.2 -163.4';

// Cheek fluff (right cheek; the left one mirrored): soft tufts along the outer lower edge, inside the cheek group.
// 31.10, Felix's pick for Pompon → moved to the package (src/fur.ts: CHEEK_PTS / CHEEK_LN / cheekFluff); the app opts
// in with setBunnyFur({ fawn: ['cheeks'] }). The gallery draws the very same paths through its rig.

/** The chest fluff: a soft scalloped bib of lighter fur on the chest, below the chin (the paws lie on it). */
const BIB: readonly Pt[] = [[-24, -66], [-12, -69.4], [0, -70.4], [12, -69.4], [24, -66], [28, -58.6], [21, -55.4], [17, -47.6], [10.6, -52.4], [4.4, -45], [-1.4, -51.6], [-7.6, -45.4], [-12, -52.6], [-18.6, -48.4], [-22, -56], [-28.6, -59]];

/** Fluffy ear tips (left lop ear; the right one mirrored): wisps hanging from the ear's lower end (-66, -83). */
const TIP_PTS: readonly Pt[] = ([[-12, -8], [-14.4, 0.4], [-9.4, -0.6], [-9.4, 8.4], [-4.2, 1.6], [-0.6, 10.6], [2.4, 1.6], [7.4, 6.6], [8.6, -2.4], [12, -8], [0, -6]] as const).map(([x, y]): Pt => [x - 66, y - 83]);
const TIP_LN: readonly Pt[] = TIP_PTS.slice(0, 10);

/** The lite mane: a soft fluffy edge round his face and chin, in his own coat (only its edge shows). */
// low and wide: the fluff shows on the jowls below his lop ears (on the head sides the ears would hide it)
const RUFF = maneRing(0, -97, { rx: 87, ry: 58 }, { rx: 60, ry: 46 }, 17, 4.2, 0);

export type ExperimentId = 'tuft' | 'cheeks' | 'ruff' | 'chest' | 'eartips' | 'curl' | 'tuft-chest' | 'cheeks-tips';

export interface Experiment {
  id: ExperimentId;
  ru: string;
  de: string;
  /** RU: what it changes */
  what: string;
  layers: readonly Layer[];
}

const tuftL: Layer = { slot: 'fur', draw: (c) => g('cs-head', p(TUFT, c.gBody) + ln(TUFT_LN) + p('M-3 -160 C-3 -166 -1 -171 1.4 -174 M5 -160 C5 -164 6 -166.4 7.4 -167.6', 'none', 'stroke="var(--mascot-accent)" stroke-width="1.8" stroke-opacity=".45" stroke-linecap="round"')) };
const curlL: Layer = { slot: 'fur', draw: (c) => g('cs-head', p(CURL, c.gBody) + ln(CURL_LN)) };
const cheekR: Layer = { slot: 'cheek-r', draw: (c) => p(cheekFluff('r').fill, c.gBody) + ln(cheekFluff('r').edge) };
const cheekL: Layer = { slot: 'cheek-l', draw: (c) => p(cheekFluff('l').fill, c.gBody) + ln(cheekFluff('l').edge) };
const chestL: Layer = {
  slot: 'body',
  draw: () => g('cs-band', p(smooth(BIB), 'var(--mascot-belly)', 'opacity=".72"') + p('M-14 -63 Q-12 -58 -13.4 -53 M-2 -65 Q0 -59 -1.4 -53.6 M10 -64 Q12 -59 10.6 -54', 'none', 'stroke="var(--mascot-accent)" stroke-width="1.8" stroke-opacity=".3" stroke-linecap="round"')
    + p(line(BIB.slice(4, 16)), 'none', 'stroke="var(--mascot-accent-dark)" stroke-width="1.5" stroke-opacity=".22" stroke-linecap="round"')),
};
const tipL: Layer = { slot: 'ear-l', draw: (c) => p(smooth(TIP_PTS), c.gEar) + ln(line(TIP_LN)) };
const tipR: Layer = { slot: 'ear-r', draw: (c) => p(smooth(mirror(TIP_PTS)), c.gEar) + ln(line(mirror(TIP_LN))) };
const ruffL: Layer = { slot: 'fur', draw: (c) => p(RUFF.outer, c.gBody) + outside(c, ln(RUFF.outer)) };

export const EXPERIMENTS: Readonly<Record<ExperimentId, Experiment>> = {
  tuft: { id: 'tuft', ru: 'Чёлочка', de: 'Schopf', what: '⚠ Близко к хохолку, который ты отверг 19.10 — не рекомендую. Три мягкие прядки на макушке между ушами — силуэт чуть выше, «только что проснулся».', layers: [tuftL] },
  cheeks: { id: 'cheeks', ru: 'Пушистые щёчки ⭐ выбор Кирилла', de: 'Flauschbäckchen', what: '31.10 ты выбрал этот вариант (один, без кисточек). По нижнему краю щёчек — пушистые кисточки. Они внутри щёчек: надуваются и жуют вместе с ними.', layers: [cheekL, cheekR] },
  ruff: { id: 'ruff', ru: 'Гривка (лёгкая)', de: 'Mini-Mähne', what: 'Пушистый край вокруг мордочки и под подбородком, в цвет шёрстки — «львиноголовый чуть-чуть».', layers: [ruffL] },
  chest: { id: 'chest', ru: 'Пушок на груди', de: 'Brustflausch', what: 'Светлое жабо из пуха под ротиком, лапки лежат поверх.', layers: [chestL] },
  eartips: { id: 'eartips', ru: 'Кисточки на ушах', de: 'Ohrpinsel', what: 'Пушистые кончики висячих ушей — качаются вместе с ушами. 31.10: ты сказал «можно кому-то другому дать» — пока ни за кем не закреплены (вариант на будущее, для нового персонажа).', layers: [tipL, tipR] },
  curl: { id: 'curl', ru: 'Завиток', de: 'Locke', what: '⚠ Близко к хохолку, который ты отверг 19.10 — не рекомендую. Один завиток на макушке («ахоге» из аниме).', layers: [curlL] },
  'tuft-chest': { id: 'tuft-chest', ru: 'Чёлочка + пушок', de: 'Schopf + Brustflausch', what: '⚠ Близко к хохолку, который ты отверг 19.10 — не рекомендую. Сочетание 1: прядки на макушке и жабо на груди.', layers: [tuftL, chestL] },
  'cheeks-tips': { id: 'cheeks-tips', ru: 'Щёчки + кисточки', de: 'Bäckchen + Ohrpinsel', what: 'Сочетание 2: пушистые щёчки и кончики ушей — «плюшевый» Помпон.', layers: [cheekL, cheekR, tipL, tipR] },
};

/** Felix's pick (31.10) first: the cheek fluff ALONE; the rest for comparison. */
export const EXPERIMENT_IDS: readonly ExperimentId[] = ['cheeks', 'eartips', 'ruff', 'chest', 'tuft', 'curl', 'tuft-chest', 'cheeks-tips'];
export const FELIX_PICK: ExperimentId = 'cheeks';

export function experimentLook(id: ExperimentId): Look {
  return { id: `exp-${id}`, layers: EXPERIMENTS[id].layers };
}

/** for tests: the outline points of the fur shapes (bounds checks) */
export const FUR_GEOMETRY = { TUFT, CURL, CHEEK_PTS, BIB, TIP_PTS, RUFF, LEO_MANE, KNOPF_EAR } as const;
