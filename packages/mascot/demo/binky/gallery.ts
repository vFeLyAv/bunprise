/**
 * Gallery page «Бинки-кролик» (31.10, from Felix's three photos of one orange rabbit) — GALLERY-ONLY prototype on the
 * mascot gallery (5180). Nothing here reaches the app until Felix approves (his rule: new looks live in the gallery).
 *
 *   ?screens=binky                           everything: him live (tap = binky), the three ear variants, the binky
 *                                            frame by frame next to the photo, the poses (64 / 96 / 148, light + dark),
 *                                            the five themes, the family line-up (Pompon, Tapsi), names and role
 *     &ears=a|b|c                            ear variant for the rest of the page (default b)
 *     &coat=ginger|apricot                   his coat (default ginger, as in the photos)
 *     &eyes=photo|star                       eyes in the binky (default photo: open, ^ ^ after the landing)
 *     &theme=light|dark|navy|ocean|black     the page's own panel theme for the hero (default light)
 *     &reduced=1                             reduced motion: everything still, the binky is the mid-air still
 *     &view=compare|frames|ears|poses|themes|family   only that section (screenshots)
 *     &frames=10                             frames in the strip (default 10)
 *     &t=0.52                                &view=frame: one big frozen frame at t
 *
 * Every cell is the REAL puppet (Bunny / Hamster / the welcome stage's peek-once / our BinkyShow) reshaped by kit.ts.
 */

import { Bunny, Hamster, WelcomeStage } from '../../src/index';
import { BINKY_BEATS, BINKY_PEAK, BINKY_S, BinkyShow, binkyOnPuppet, type BinkyEyes, type BinkyFace } from './binky';
import { applyBinkyKit, BK_COAT_IDS, BK_COATS, EAR_VARIANTS, earTop, paintBinky, type BkCoat, type EarVariant } from './kit';

type Theme = 'light' | 'dark' | 'navy' | 'ocean' | 'black';
type PoseId = 'front' | 'left' | 'right' | 'sniff' | 'peek' | 'binky';

const THEMES: ReadonlyArray<[Theme, string]> = [['light', 'Светлая'], ['dark', 'Тёмная'], ['navy', 'Blau'], ['ocean', 'Ozean'], ['black', 'Schwarz']];
const POSES: ReadonlyArray<[PoseId, string]> = [['front', 'Сидит спереди'], ['left', '3/4 влево'], ['right', '3/4 вправо'], ['sniff', 'Нюхает'], ['peek', 'Из-за края'], ['binky', 'Бинки (в воздухе)']];
const SIZES = [148, 96, 64] as const;

/** The app's page colours and mascot tokens per theme (tokens.css, navy.css, ocean.css, black.css) — as on ?screens=costumes. */
const THEME_VARS: Record<Theme, Record<string, string>> = {
  light: { '--bk-bg': '#F2EBDD', '--bk-card': '#FFFDF8', '--bk-text': '#2A231C', '--bk-text2': '#62554A', '--bk-line': 'rgba(116,84,44,.15)', '--mascot-shadow': 'rgba(70,40,15,.20)', '--mascot-outline': 'rgba(224,171,116,.5)' },
  dark: { '--bk-bg': '#17120F', '--bk-card': '#2A221D', '--bk-text': '#F5EDE3', '--bk-text2': '#C3B5A6', '--bk-line': 'rgba(255,230,205,.13)', '--mascot-shadow': 'rgba(0,0,0,.42)', '--mascot-outline': 'rgba(255,214,170,.2)' },
  navy: { '--bk-bg': '#0F1526', '--bk-card': '#1D263B', '--bk-text': '#EEF2FA', '--bk-text2': '#AEB9CF', '--bk-line': 'rgba(200,220,255,.13)', '--mascot-shadow': 'rgba(0,0,0,.42)', '--mascot-outline': 'rgba(220,232,255,.18)' },
  ocean: { '--bk-bg': '#111418', '--bk-card': '#1C2026', '--bk-text': '#EDF1F6', '--bk-text2': '#AAB4C2', '--bk-line': 'rgba(210,225,245,.12)', '--mascot-shadow': 'rgba(0,0,0,.42)', '--mascot-outline': 'rgba(220,232,250,.18)' },
  black: { '--bk-bg': '#000000', '--bk-card': '#161618', '--bk-text': '#F2F2F4', '--bk-text2': '#B0B0B8', '--bk-line': 'rgba(255,255,255,.12)', '--mascot-shadow': 'rgba(0,0,0,.6)', '--mascot-outline': 'rgba(255,240,225,.2)' },
};

export const EAR_LABELS: Readonly<Record<EarVariant, { ru: string; what: string }>> = {
  a: { ru: 'A · крошечные кругляшки', what: 'Почти круглые «пуговки», ≈ 17 единиц над головой — самые маленькие. Риск: издалека он может читаться как хомяк.' },
  b: { ru: 'B · мягкие овалы', what: 'Чуть длиннее (≈ 30 единиц, треть головы — как на фото 1), круглые кончики, стоят рядом. Мой выбор: сразу видно кролика, но уши всё ещё крошечные.' },
  c: { ru: 'C · загнутый кончик', what: 'Как B, но кончик правого уха мягко свисает набок (видна его спинка, без розового). Асимметрия «живая» и узнаётся даже в 64 px.' },
};

/** Name proposals (DE · RU) and the role idea. */
export const NAMES: ReadonlyArray<{ de: string; ru: string; why: string; pick?: boolean }> = [
  { de: 'Flummi', ru: 'Флумми', why: 'по-немецки Flummi — мячик-попрыгунчик: это его бинки. Звучит одинаково на обоих языках, как Pompon и Tapsi.', pick: true },
  { de: 'Muffin', ru: 'Маффин', why: 'круглый рыжий «кекс»-буханочка; тоже одинаково на обоих языках.' },
  { de: 'Brötchen', ru: 'Булочка', why: 'кроличья «буханочка» (bunny loaf) — как он сидит и как летит; по-русски очень ласково.' },
];
export const ROLE = 'Радость за всех: делает один бинки, когда что-то большое сбылось у всей компании — все подарки к празднику разобраны, общий сбор закрыт, у друга сегодня день рождения.';

/** What the photos gave him (RU). */
const FROM_PHOTOS: readonly string[] = [
  'тело — компактная «буханочка»: ниже и шире Помпона, без шеи, одна мягкая линия силуэта (фото 1);',
  'крошечные стоячие ушки рядом друг с другом, мягкие и круглые, с белым пушком внутри (фото 1, 3);',
  'большие тёмные глаза (наш стиль: два блика), пухлая белая мордочка, пушистые щёчки (фото 3);',
  'тёплый рыжий мех, светлый низ и белый пушистый хвостик — виден в повороте 3/4 и в прыжке (фото 2);',
  'главное — бинки: в воздухе он «буханочка», лапки поджаты, тело и голова слегка закручены в разные стороны, тень на полу сжимается и бледнеет (фото 1–3).',
];

const PAGE_CSS = `
.app.bk-page { max-width: none; padding: 20px 16px 48px; }
.bk-page h1 { margin: 4px 6px; }
.bk-page .sub { max-width: 980px; }
.bk-bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 8px 6px; font-size: 13px; color: var(--text-2); }
.bk-bar b { font-weight: 600; margin-right: 4px; min-width: 64px; }
.bk-bar a { border-radius: 999px; padding: 6px 11px; font: 600 13px/1 inherit; font-family: inherit; background: var(--tile); color: var(--text); text-decoration: none; }
.bk-bar a[aria-current="true"] { background: color-mix(in srgb, var(--accent-ui) 22%, transparent); box-shadow: inset 0 0 0 1.5px var(--accent-ui); }
.bk-panel { background: var(--bk-bg); color: var(--bk-text); border-radius: 26px; padding: 14px 14px 18px; margin: 0 0 16px; overflow-x: auto; box-shadow: 0 0 0 1px var(--bk-line); }
.bk-panel h2 { margin: 2px 6px 6px; font-size: 19px; }
.bk-panel p, .bk-note { font-size: 13px; color: var(--bk-text2); margin: 4px 6px 10px; max-width: 980px; line-height: 1.45; }
.bk-row { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
.bk-fig { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.bk-fig figcaption { font-size: 12px; color: var(--bk-text2); text-align: center; line-height: 1.3; max-width: 220px; }
.bk-fig figcaption b { display: block; color: var(--bk-text); font-size: 13px; }
.bk-cell { position: relative; flex: none; overflow: hidden; border-radius: 12px; background: var(--bk-card); box-shadow: inset 0 0 0 1px var(--bk-line); }
.bk-cell > .bk-host { position: absolute; }
.bk-cell small { position: absolute; left: 6px; top: 4px; font-size: 10.5px; color: var(--bk-text2); line-height: 1.2; }
.bk-ledge { position: absolute; left: 0; right: 0; bottom: 0; background: var(--bk-bg); border-radius: 10px 10px 0 0; box-shadow: 0 -1px 0 var(--bk-line); }
.bk-grid { display: grid; gap: 6px 10px; align-items: end; }
.bk-grid .bk-h { font-size: 11px; font-weight: 600; color: var(--bk-text2); text-align: center; padding: 8px 0 2px; }
.bk-grid .bk-rl { font-size: 11px; color: var(--bk-text2); text-align: right; padding-right: 4px; align-self: center; line-height: 1.3; }
.bk-grid .bk-rl b { display: block; color: var(--bk-text); font-size: 12.5px; }
.bk-ears { display: grid; grid-template-columns: repeat(3, minmax(260px, 1fr)); gap: 12px; }
.bk-ear { border-radius: 20px; padding: 10px; box-shadow: 0 0 0 1px var(--bk-line); background: var(--bk-card); }
.bk-ear h3 { margin: 2px 4px 4px; font-size: 16px; }
.bk-ear.pick { box-shadow: 0 0 0 2px var(--accent-ui); }
.bk-ear p { margin: 2px 4px 8px; font-size: 12.5px; }
.bk-live { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-end; }
.bk-btn { appearance: none; border: 0; border-radius: 999px; padding: 9px 15px; font: 700 14px/1 inherit; font-family: inherit; min-height: 40px; cursor: pointer;
  background: color-mix(in srgb, var(--accent-ui) 22%, transparent); color: var(--bk-text); box-shadow: inset 0 0 0 1.5px var(--accent-ui); }
.bk-btn[disabled] { opacity: .55; cursor: default; }
.bk-strip { display: flex; gap: 6px; align-items: flex-end; flex-wrap: nowrap; }
.bk-strip .bk-fig figcaption { font-variant-numeric: tabular-nums; }
.bk-compare { display: flex; gap: 14px; align-items: stretch; flex-wrap: wrap; }
.bk-photo { width: 340px; min-height: 280px; border-radius: 14px; overflow: hidden; background: var(--bk-card); box-shadow: inset 0 0 0 1px var(--bk-line);
  display: grid; place-items: center; text-align: center; font-size: 12px; color: var(--bk-text2); padding: 0; position: relative; }
.bk-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bk-photo img[hidden], .bk-photo label[hidden] { display: none; }
.bk-photo label { cursor: pointer; padding: 14px; line-height: 1.45; }
.bk-photo input { display: none; }
.bk-names { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; margin: 6px 0; }
.bk-names div { border-radius: 16px; padding: 10px 12px; box-shadow: 0 0 0 1px var(--bk-line); background: var(--bk-card); font-size: 12.5px; line-height: 1.45; }
.bk-names div.pick { box-shadow: 0 0 0 2px var(--accent-ui); }
.bk-names b { font-size: 17px; display: block; }
.bk-page ul { margin: 4px 0 6px; padding-left: 22px; font-size: 13px; line-height: 1.5; }
`;

// ---- helpers ----------------------------------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function setVars(node: HTMLElement, vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) node.style.setProperty(k, v);
}
function markReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset['ready'] = '1')));
}

interface Opts {
  ears: EarVariant;
  coat: BkCoat;
  eyes: BinkyEyes;
  face: BinkyFace;
  reduced: boolean;
}

/** A cell for a puppet of stage width `size`: room above for the binky (50 units up) and the ears. */
function cellBox(size: number, air = false): { w: number; h: number; floor: number } {
  return { w: size, h: Math.round(size * (air ? 0.98 : 0.8)), floor: Math.round(size * 0.04) };
}

function cell(parent: HTMLElement, size: number, air = false, label?: string): { cell: HTMLElement; host: HTMLElement } {
  const box = cellBox(size, air);
  const c = el('div', 'bk-cell');
  c.style.width = `${box.w}px`;
  c.style.height = `${box.h}px`;
  parent.append(c);
  const host = el('div', 'bk-host');
  host.style.left = '0px';
  host.style.bottom = `${box.floor}px`;
  c.append(host);
  if (label) c.append(el('small', undefined, label));
  return { cell: c, host };
}

/** The real Bunny puppet, reshaped into him. Still (reduced 'force') unless `live`. */
export function binkyBunny(host: HTMLElement, size: number, o: Pick<Opts, 'ears' | 'coat'>, live = false): Bunny {
  const p = new Bunny(host, { size, idle: live, interactive: false, reducedMotion: live ? 'auto' : 'force' });
  const svg = p.root.querySelector('svg');
  paintBinky(host, o.coat, svg?.querySelector('.hm'));
  if (svg) applyBinkyKit(svg, o.ears);
  return p;
}

/** The welcome stage's peek-once (the empty screens), frozen at its end; the peeking actor is reshaped into him. */
function peekCell(parent: HTMLElement, size: number, o: Opts): HTMLElement {
  const box = cellBox(size);
  const c = el('div', 'bk-cell');
  c.style.width = `${box.w}px`;
  c.style.height = `${box.h}px`;
  parent.append(c);
  const ledge = el('div', 'bk-ledge');
  const ledgeH = Math.round(size * 0.2);
  ledge.style.height = `${ledgeH}px`;
  const inset = Math.round(size * 0.08);
  const stageHost = el('div');
  const bottom = box.h - ledgeH + inset;
  const hostH = Math.max(140, bottom);
  stageHost.style.cssText = `position:absolute;left:0;top:${bottom - hostH}px;width:${box.w}px;height:${hostH}px`;
  c.append(ledge, stageHost);
  const unit = size * 0.486;
  const stage = new WelcomeStage(stageHost, { bunnies: ['fawn'], choreography: 'peek-once', reducedMotion: 'off', minSize: unit, maxSize: unit, edgeInset: { bottom: inset }, edgeRadius: { bottom: 10 } });
  stage.seek(stage.duration);
  const dress = () => {
    const sr = stageHost.shadowRoot;
    if (!sr) return;
    // every element the stage painted with a coat (actor hosts, the gripping paws) gets his colours
    for (const n of Array.from(sr.querySelectorAll<HTMLElement>('[style*="--mascot-paw"]'))) paintBinky(n, o.coat);
    for (const n of Array.from(sr.querySelectorAll<HTMLElement>('*'))) {
      const svg = n.shadowRoot?.querySelector('svg');
      if (svg?.querySelector('.breathe')) {
        paintBinky(n, o.coat, svg.querySelector('.hm'));
        applyBinkyKit(svg, o.ears);
      }
    }
  };
  dress();
  requestAnimationFrame(() => requestAnimationFrame(dress));
  return c;
}

/** One frozen pose cell. */
function poseCell(parent: HTMLElement, pose: PoseId, size: number, o: Opts): HTMLElement {
  if (pose === 'peek') return peekCell(parent, size, o);
  const { cell: c, host } = cell(parent, size, pose === 'binky');
  c.dataset['pose'] = pose;
  if (pose === 'binky') {
    new BinkyShow(host, { size, ears: o.ears, coat: o.coat, reduced: true, eyes: o.eyes, face: o.face });
    return c;
  }
  const p = binkyBunny(host, size, o);
  const hm = p.root.querySelector('.hm');
  if (pose === 'left' || pose === 'right') hm?.classList.add(pose === 'left' ? 'turn-l' : 'turn-r');
  if (pose === 'sniff') {
    // the approved 'alert' at its sniffing moment: one ear up, eyes wider, nose up, the body stretched up a little,
    // the little sniff marks of Bunny.sniffPuffs() by his nose (static here)
    p.pose('alert');
    hm?.classList.remove('look-far-r');
    hm?.classList.add('look-up');
    const body = p.root.querySelector<SVGGElement>('.body');
    if (body) body.style.transform = 'translateY(-3px) scale(.98,1.04)';
    p.root.querySelector('.fx')?.insertAdjacentHTML('beforeend', '<path d="M12 -82 q3.6 -2 6.4 0 M13 -76 q3.8 -1.4 7 .6" fill="none" stroke="var(--mascot-accent-dark)" stroke-width="2" stroke-linecap="round" opacity=".85"/>');
  }
  return c;
}

/** Links of one query parameter (current one marked). */
function bar(parent: HTMLElement, q: URLSearchParams, label: string, key: string, values: ReadonlyArray<readonly [string, string]>, cur: string): void {
  const b = el('div', 'bk-bar');
  b.append(el('b', undefined, label));
  for (const [v, text] of values) {
    const a = el('a', undefined, text);
    const next = new URLSearchParams(q);
    next.set(key, v);
    a.href = `?${next.toString()}`;
    a.setAttribute('aria-current', String(v === cur));
    b.append(a);
  }
  parent.append(b);
}

function panel(parent: HTMLElement, theme: Theme, title: string, note?: string): HTMLElement {
  const p = el('section', 'bk-panel');
  setVars(p, THEME_VARS[theme]);
  p.dataset['theme'] = theme;
  p.append(el('h2', undefined, title));
  if (note) p.append(el('p', undefined, note));
  parent.append(p);
  return p;
}

// ---- sections ---------------------------------------------------------------------------------------------------

/** Him live: sits, breathes, blinks; tap or the button = the binky. Next to him: Pompon and Tapsi at the same scale. */
function hero(parent: HTMLElement, theme: Theme, o: Opts): void {
  const p = panel(parent, theme, 'Он сам — нажми, и он сделает бинки', `Живой: сидит, дышит, моргает. Касание или кнопка — бинки (${BINKY_S.toFixed(1).replace('.', ',')} с, один раз). Рядом Помпон и Тапси в том же масштабе.`);
  const row = el('div', 'bk-live');
  p.append(row);
  const size = 260;
  const fig = el('figure', 'bk-fig');
  const { cell: c, host } = cell(fig, size, true);
  c.style.cursor = 'pointer';
  c.dataset['live'] = '1';
  row.append(fig);
  const bunny = binkyBunny(host, size, o, !o.reduced);
  const svg = bunny.root.querySelector('svg');
  // the 3/4 binky starts from his 3/4 pose (the approved turn class): that is the rest pose its tracks start from
  if (o.face !== 'front') svg?.querySelector('.hm')?.classList.add(o.face === 'l' ? 'turn-l' : 'turn-r');
  let running: Promise<void> | null = null;
  const go = () => {
    if (running || !svg) return;
    const r = binkyOnPuppet(svg, { reduced: o.reduced || bunny.reducedMotion, eyes: o.eyes, face: o.face });
    running = r.done.then(() => {
      running = null;
    });
  };
  c.addEventListener('click', go);
  const btn = el('button', 'bk-btn', o.reduced ? 'Меньше движения: бинки не играет' : '▶ Бинки');
  btn.type = 'button';
  btn.disabled = o.reduced;
  btn.addEventListener('click', go);
  const cap = el('figcaption');
  cap.append(el('b', undefined, `${NAMES[0]?.de ?? ''} · ${NAMES[0]?.ru ?? ''} (рабочее имя)`), document.createTextNode(`уши ${o.ears.toUpperCase()} · ${BK_COATS[o.coat].ru}`));
  fig.append(cap, btn);
  // the family at the same scale
  const fam = (label: string, sub: string, mk: (h: HTMLElement) => void) => {
    const f = el('figure', 'bk-fig');
    const { host: h } = cell(f, 200, false);
    mk(h);
    const cp = el('figcaption');
    cp.append(el('b', undefined, label), document.createTextNode(sub));
    f.append(cp);
    row.append(f);
  };
  fam('Pompon · Помпон', 'главный, вислоухий', (h) => void new Bunny(h, { size: 200, idle: !o.reduced, interactive: false, reducedMotion: o.reduced ? 'force' : 'auto' }));
  fam('Tapsi · Тапси', 'хомяк, друг', (h) => void new Hamster(h, { size: 200, idle: !o.reduced, interactive: false, reducedMotion: o.reduced ? 'force' : 'auto' }));
  fam(`${NAMES[0]?.de ?? ''} · ${NAMES[0]?.ru ?? ''}`, 'новый, тот же масштаб', (h) => void binkyBunny(h, 200, o, !o.reduced));
}

/** The three ear variants side by side: 148 / 96 / 64, light and dark, and in the air. */
function earsSection(parent: HTMLElement, theme: Theme, o: Opts, q: URLSearchParams): void {
  const p = panel(parent, theme, 'Уши — выбери: A, B или C', 'Мила со стоячими длинными ушами тебе не понравилась (30.10), поэтому здесь уши очень короткие, круглые, пушистые внутри и стоят рядом. Нажми на вариант — вся страница покажет его. Сверху вниз: 148 / 96 / 64 px, тёмная тема, в воздухе.');
  const grid = el('div', 'bk-ears');
  p.append(grid);
  for (const v of EAR_VARIANTS) {
    const box = el('div', `bk-ear${v === 'b' ? ' pick' : ''}`);
    box.dataset['ears'] = v;
    const h = el('h3');
    const a = el('a', undefined, EAR_LABELS[v].ru + (v === 'b' ? ' ⭐' : ''));
    const next = new URLSearchParams(q);
    next.set('ears', v);
    a.href = `?${next.toString()}`;
    a.style.color = 'inherit';
    h.append(a);
    box.append(h, el('p', undefined, `${EAR_LABELS[v].what} Верх ушей: y = ${earTop(v).toFixed(0)}.`));
    const vo: Opts = { ...o, ears: v };
    const row = el('div', 'bk-row');
    box.append(row);
    for (const s of SIZES) poseCell(row, 'front', s, vo);
    const dark = el('div', 'bk-row');
    setVars(dark, THEME_VARS.dark);
    dark.style.cssText += ';background:var(--bk-bg);border-radius:14px;padding:6px;margin-top:8px';
    box.append(dark);
    poseCell(dark, 'front', 96, vo);
    poseCell(dark, 'right', 96, vo);
    poseCell(dark, 'binky', 96, vo);
    grid.append(box);
  }
}

/** Key moments of the binky shown next to the photo (s): crouch, push-off, the loaf at the top, the twist, the landing. */
export const KEY_FRAMES: ReadonlyArray<readonly [number, string]> = [[BINKY_BEATS.crouch, 'присел'], [0.32, 'толчок'], [BINKY_PEAK, 'верх: буханочка'], [0.66, 'поворот'], [BINKY_BEATS.land + 0.03, 'приземлился']];

/** The photo slot: the reference picture is NOT stored in the repo — pick it from D:\Bunnys - Bunprise (stays in the browser), or the screenshot script puts it in. */
function photoSlot(parent: HTMLElement): void {
  const photo = el('div', 'bk-photo');
  photo.dataset['ref'] = '1';
  const img = el('img');
  img.alt = '';
  img.hidden = true;
  const lab = el('label');
  lab.append(document.createTextNode('Фото для сравнения: нажми и выбери снимок из «D:\\Bunnys - Bunprise» (остаётся только в браузере, никуда не загружается).'));
  const input = el('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    img.src = URL.createObjectURL(file);
    img.hidden = false;
    lab.hidden = true;
  });
  lab.append(input);
  photo.append(img, lab);
  parent.append(photo);
}

function strip(parent: HTMLElement, o: Opts, face: BinkyFace, times: ReadonlyArray<readonly [number, string]>, size: number): void {
  const row = el('div', 'bk-strip');
  row.dataset['face'] = face;
  parent.append(row);
  for (const [t, label] of times) {
    const fig = el('figure', 'bk-fig');
    const { cell: c, host } = cell(fig, size, true);
    c.dataset['t'] = String(t);
    row.append(fig);
    new BinkyShow(host, { size, ears: o.ears, coat: o.coat, eyes: o.eyes, face, reduced: false }).seek(t);
    const cap = el('figcaption');
    cap.append(el('b', undefined, label), document.createTextNode(`t = ${t.toFixed(2)} с`));
    fig.append(cap);
  }
}

/** The binky frame by frame (frozen, deterministic) next to a reference photo. */
function framesSection(parent: HTMLElement, theme: Theme, o: Opts, frames: number, size = 148): void {
  const p = panel(parent, theme, `Бинки по кадрам — ${BINKY_S.toFixed(1).replace('.', ',')} с, один раз`, `Присел (0–${BINKY_BEATS.crouch.toFixed(2)}) → оттолкнулся (${BINKY_BEATS.leave.toFixed(2)}) → в воздухе «буханочка»: задние лапы и передние лапки поджаты, тело чуть шире и ниже, поворот (нос вверх на взлёте и вниз перед посадкой, голова дёргается в сторону и обратно), тень сжимается почти вдвое и бледнеет (верх ${BINKY_PEAK.toFixed(2)}) → приземлился (${BINKY_BEATS.land.toFixed(2)}), один маленький отскок, ушки качнулись → покой. Только transform/opacity. «Меньше движения»: только неподвижная поза в воздухе.`);
  const cmp = el('div', 'bk-compare');
  cmp.dataset['compare'] = '1';
  p.append(cmp);
  photoSlot(cmp);
  const keys = el('div');
  keys.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  cmp.append(keys);
  keys.append(el('div', 'bk-note', '3/4, как на фото 3 (по умолчанию):'));
  strip(keys, o, o.face === 'front' ? 'r' : o.face, KEY_FRAMES, size);
  keys.append(el('div', 'bk-note', 'то же спереди:'));
  strip(keys, o, 'front', KEY_FRAMES, size);

  // every frame of the chosen one, evenly spaced
  p.append(el('div', 'bk-note', `Все кадры (${o.face === 'front' ? 'спереди' : '3/4'}), равномерно:`));
  const n = Math.max(2, Math.min(16, frames));
  const all = Array.from({ length: n }, (_, i): readonly [number, string] => {
    const t = Math.round((((BINKY_S - 0.1) * i) / (n - 1)) * 100) / 100;
    return [t, ''];
  });
  strip(p, o, o.face, all, 112);
  // the same at phone size
  p.append(el('div', 'bk-note', '64 px (размер телефона):'));
  const small = el('div', 'bk-strip');
  p.append(small);
  for (const t of [0, BINKY_BEATS.crouch, 0.36, BINKY_PEAK, 0.67, BINKY_BEATS.land, BINKY_BEATS.bounce, 1.4]) {
    const { host } = cell(small, 64, true, t.toFixed(2));
    new BinkyShow(host, { size: 64, ears: o.ears, coat: o.coat, eyes: o.eyes, face: o.face }).seek(t);
  }
  // a big one that plays
  const live = el('div', 'bk-row');
  live.style.marginTop = '12px';
  p.append(live);
  const { cell: lc, host: lh } = cell(live, 220, true, 'играет целиком');
  lc.dataset['show'] = '1';
  const show = new BinkyShow(lh, { size: 220, ears: o.ears, coat: o.coat, eyes: o.eyes, face: o.face, reduced: o.reduced });
  const btn = el('button', 'bk-btn', o.reduced ? 'Меньше движения: поза в воздухе, стоит' : '▶ Ещё раз');
  btn.type = 'button';
  btn.disabled = o.reduced;
  let busy = false;
  btn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    void show.play().then(() => (busy = false));
  });
  live.append(btn);
}

/** The pose grid: rows = sizes, columns = poses; light and dark. */
function posesSection(parent: HTMLElement, themes: readonly Theme[], o: Opts): void {
  for (const theme of themes) {
    const p = panel(parent, theme, `Позы · ${THEMES.find((t) => t[0] === theme)?.[1]} тема · 148 / 96 / 64 px`);
    for (const size of SIZES) {
      const grid = el('div', 'bk-grid');
      grid.style.gridTemplateColumns = `70px repeat(${POSES.length}, ${size}px)`;
      p.append(grid);
      grid.append(el('div', 'bk-rl', `${size} px`));
      for (const [, label] of POSES) grid.append(el('div', 'bk-h', size === 148 ? label : ''));
      grid.append(el('div'));
      for (const [pose] of POSES) poseCell(grid, pose, size, o);
    }
  }
}

/** Five themes × key poses at 96 px. */
function themesSection(parent: HTMLElement, o: Opts): void {
  const p = panel(parent, 'light', 'Все пять тем (96 px): Светлая, Тёмная, Blau, Ozean, Schwarz');
  const poses: PoseId[] = ['front', 'right', 'peek', 'binky'];
  const grid = el('div', 'bk-grid');
  grid.style.gridTemplateColumns = `90px repeat(${poses.length}, 96px)`;
  grid.style.gap = '0';
  p.append(grid);
  grid.append(el('div'));
  for (const id of poses) grid.append(el('div', 'bk-h', POSES.find((x) => x[0] === id)?.[1] ?? id));
  for (const [theme, label] of THEMES) {
    const lab = el('div', 'bk-rl');
    lab.append(el('b', undefined, label));
    grid.append(lab);
    for (const id of poses) {
      const wrapCell = el('div');
      setVars(wrapCell, THEME_VARS[theme]);
      wrapCell.style.cssText += `;background:var(--bk-bg);padding:5px;height:${cellBox(96, true).h}px;display:flex;align-items:flex-end`;
      grid.append(wrapCell);
      poseCell(wrapCell, id, 96, o);
    }
  }
}

/** The family at the same scale (148 and 96), his two coats. */
function familySection(parent: HTMLElement, themes: readonly Theme[], o: Opts): void {
  for (const theme of themes) {
    const p = panel(parent, theme, `Одна семья, один масштаб · ${THEMES.find((t) => t[0] === theme)?.[1]} тема`, 'Та же кукла, тот же контур, глаза, румянец и толщина линий. Слева направо: Помпон, Тапси, он (рыжий), он (абрикосовый — светлее, только для сравнения).');
    for (const size of [148, 96] as const) {
      const row = el('div', 'bk-row');
      row.style.marginBottom = '8px';
      p.append(row);
      const fig = (label: string, mk: (h: HTMLElement) => void, turn?: 'r') => {
        const f = el('figure', 'bk-fig');
        const { host } = cell(f, size);
        mk(host);
        if (turn) host.shadowRoot?.querySelector('.hm')?.classList.add('turn-r');
        if (size === 148) f.append(el('figcaption', undefined, label));
        row.append(f);
      };
      fig('Помпон', (h) => void new Bunny(h, { size, idle: false, interactive: false, reducedMotion: 'force' }));
      fig('Тапси', (h) => void new Hamster(h, { size, idle: false, interactive: false, reducedMotion: 'force' }));
      for (const coat of BK_COAT_IDS) fig(BK_COATS[coat].ru, (h) => void binkyBunny(h, size, { ...o, coat }));
      fig('Помпон 3/4', (h) => void new Bunny(h, { size, idle: false, interactive: false, reducedMotion: 'force' }), 'r');
      fig('он 3/4', (h) => void binkyBunny(h, size, o), 'r');
    }
  }
}

function namesSection(parent: HTMLElement, theme: Theme): void {
  const p = panel(parent, theme, 'Имя и роль');
  const grid = el('div', 'bk-names');
  p.append(grid);
  for (const n of NAMES) {
    const d = el('div', n.pick ? 'pick' : undefined);
    d.append(el('b', undefined, `${n.de} · ${n.ru}${n.pick ? ' ⭐' : ''}`), document.createTextNode(n.why));
    grid.append(d);
  }
  p.append(el('p', undefined, `Роль (идея): ${ROLE}`));
  p.append(el('p', undefined, 'Что взято с фото:'));
  const ul = el('ul');
  for (const s of FROM_PHOTOS) ul.append(el('li', undefined, s));
  p.append(ul);
}

/** One big frozen frame (screenshots): &view=frame&t=0.52 */
function frameView(parent: HTMLElement, theme: Theme, o: Opts, t: number): void {
  const p = panel(parent, theme, `Кадр t = ${t.toFixed(2)} с`);
  const { host } = cell(p, 400, true);
  new BinkyShow(host, { size: 400, ears: o.ears, coat: o.coat, eyes: o.eyes, face: o.face }).seek(t);
}

// ---- the page ---------------------------------------------------------------------------------------------------

export function binkyGallery(app: HTMLElement, q: URLSearchParams): void {
  const style = el('style');
  style.textContent = PAGE_CSS;
  document.head.append(style);
  app.className = 'app bk-page';
  app.replaceChildren();
  const pick = <T extends string>(v: string | null, all: readonly T[], d: T): T => (all as readonly string[]).includes(v ?? '') ? (v as T) : d;
  const o: Opts = {
    ears: pick(q.get('ears'), EAR_VARIANTS, 'b'),
    coat: pick(q.get('coat'), BK_COAT_IDS, 'ginger'),
    eyes: pick(q.get('eyes'), ['photo', 'star'] as const, 'photo'),
    face: pick(q.get('face'), ['r', 'front', 'l'] as const, 'r'),
    reduced: q.get('reduced') === '1',
  };
  const theme = pick(q.get('theme'), THEMES.map((t) => t[0]), 'light');
  const view = q.get('view');
  const frames = Number(q.get('frames') ?? '10') || 10;

  app.append(el('h1', undefined, 'Бинки-кролик · новый персонаж по твоим фото'));
  app.append(el('p', 'sub', 'Только галерея (31.10). Тот же «кукольный» кролик, что и Помпон (те же слои, глаза, румянец, контур), но с телом-«буханочкой», крошечными ушками и рыжим мехом — и его коронный бинки. В приложении ничего не меняется.'));
  bar(app, q, 'Уши', 'ears', EAR_VARIANTS.map((v) => [v, EAR_LABELS[v].ru] as const), o.ears);
  bar(app, q, 'Окрас', 'coat', BK_COAT_IDS.map((c) => [c, BK_COATS[c].ru] as const), o.coat);
  bar(app, q, 'Глаза в прыжке', 'eyes', [['photo', 'как на фото (открытые, ^ ^ после)'], ['star', 'звёздочки (как бинки Помпона)']], o.eyes);
  bar(app, q, 'Бинки', 'face', [['r', '3/4, как фото 3'], ['front', 'спереди']], o.face);
  bar(app, q, 'Тема', 'theme', THEMES, theme);
  bar(app, q, 'Движение', 'reduced', [['0', 'обычное'], ['1', 'меньше движения']], o.reduced ? '1' : '0');

  const show = (name: string) => !view || view === name;
  if (view === 'frame') frameView(app, theme, o, Number(q.get('t') ?? BINKY_PEAK) || 0);
  if (show('hero')) hero(app, theme, o);
  if (show('ears')) earsSection(app, theme, o, q);
  if (show('frames') || view === 'compare') framesSection(app, theme, o, frames);
  if (show('poses')) posesSection(app, ['light', 'dark'], o);
  if (show('themes')) themesSection(app, o);
  if (show('family')) familySection(app, ['light', 'dark'], o);
  if (show('names')) namesSection(app, theme);
  markReady();
}
