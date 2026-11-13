/**
 * Gallery page for the Mitbringen moment (26.10, docs/ideas/2026-10-26-mascot-ideas.md §5 item 3) — a GALLERY-ONLY
 * prototype on the mascot gallery (5180); the app gets nothing until Felix approves it. Felix picked «Корзинка»
 * (26.10; «Салфетка» rejected, archived in E:\BALLR\_codex_handoffs\archive-20261026\mitbringen-napkin.ts). Two phones
 * side by side on the same 390 px mock of the occasion's "Mitbringen" section: the basket, and the last free item
 * (the same basket + one binky facing you, in place of the old `hop-across`):
 *
 *   ?screens=mitbringen                  both phones, played one after the other
 *     &move=basket|last                  only that phone
 *     &reduced=1                         "Weniger" / reduced motion
 *     &t=1.2                             every phone frozen at moment second 1.2 (0 = the server said yes; the tap is at −0.6)
 *     &theme=dark                        "Paper at night" (default light)
 *     &contact=1 [&frames=12]            contact sheet: frozen frames over the whole moment (deterministic seek)
 *     &coat=choc                         another coat (Pompon is fawn)
 *     &autoplay=0                        do not play on load
 *
 * Design note for Felix: docs/design/2026-10-26-mitbringen-moment.md.
 */

import { COATS, type BunnyCoat } from '../../src/index';
import { MOCK_CSS, PRE, type Theme, type Variant } from './mock';
import { MitbringenScene } from './scene';

const CSS = `${MOCK_CSS}
.mbx-page { margin: 0 auto 32px; }
.mbx-page h2 { margin: 6px 6px 4px; font-size: 24px; letter-spacing: -.02em; }
.mbx-page > p { margin: 0 6px 12px; max-width: 900px; color: var(--text-2, #6E6E73); font-size: 14px; line-height: 1.5; }
.mbx-controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 6px 18px; align-items: center; }
.mbx-controls select, .mbx-controls button, .mbx-col button { appearance: none; border: 0; border-radius: 999px; padding: 9px 14px; font: 600 14px/1 inherit;
  background: var(--tile, rgba(0,0,0,.06)); color: inherit; cursor: pointer; min-height: 40px; }
.mbx-controls button:active, .mbx-col button:active { transform: scale(.95); }
.mbx-controls a { font-size: 14px; color: inherit; }
.mbx-row3 { display: flex; flex-wrap: wrap; gap: 36px 34px; justify-content: center; align-items: flex-start; }
.mbx-col { width: 390px; display: flex; flex-direction: column; gap: 12px; }
.mbx-col h3 { margin: 0 4px; font-size: 18px; }
.mbx-col .tag { display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: rgba(240,160,75,.18); }
.mbx-col .play { display: flex; gap: 10px; align-items: center; margin-top: 10px; font-size: 13px; color: var(--text-2, #6E6E73); }
.mbx-col input[type=range] { flex: 1; accent-color: #F0A04B; }
.mbx-col > ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.5; color: var(--text-2, #6E6E73); }
.mbx-sheet { display: grid; gap: 14px 12px; grid-template-columns: repeat(auto-fill, 236px); justify-content: center; margin: 8px 0 34px; }
.mbx-cell { position: relative; width: 236px; height: 214px; overflow: hidden; border-radius: 14px; box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
.mbx-cell .mbx-phone { position: absolute; left: 0; top: 0; transform-origin: 0 0; box-shadow: none; border-radius: 0; }
.mbx-cell b { position: absolute; left: 6px; top: 6px; z-index: 2; padding: 2px 7px; border-radius: 999px; background: rgba(29,29,31,.72); color: #fff; font: 600 11px/1.4 system-ui, sans-serif; }
.mbx-sheet-title { margin: 20px 6px 6px; font-size: 17px; }
`;

const VARIANTS: Variant[] = ['basket', 'last'];
const TITLES: Record<Variant, string> = {
  basket: '«Корзинка»',
  last: 'Последний свободный пункт',
};
const TAGS: Record<Variant, string> = { basket: '≈ 2,6 с, выбрана', last: '≈ 2,9 с, новое' };
const NOTES: Record<Variant, string[]> = {
  basket: [
    'Тап «Ich bring’s mit» → кнопка крутится → сервер «да» (момент 0).',
    'Помпон выпрыгивает из-за правого края экрана на высоте строки «Kuchen», 2 прыжка, ставит корзинку в конец строки «Du bringst» — она тает в подсветке, появляется «, Kuchen».',
    'Глаза ^ ^, разворот на месте (одобренный поворот 3/4) и 2 прыжка обратно за край.',
  ],
  last: [
    'Ты взял последний свободный пункт («4 von 4 verteilt»): Помпон приносит корзинку так же и ставит её в строку «Du bringst».',
    'Сначала твой пункт: пока он поворачивается к тебе, корзинка тает в строке и появляется «, Kuchen».',
    'Потом радость: один бинки — прыжок вверх с поворотом в воздухе, уши взлетают, глаза ^ ^; под карточкой появляется «Alles ist verteilt. Danke!». Поворот 3/4 и 2 прыжка обратно за край.',
  ],
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const fmt = (t: number) => `${t >= 0 ? ' ' : '−'}${Math.abs(t).toFixed(2)} с`;

export function mitbringenGallery(app: HTMLElement, query: URLSearchParams): void {
  app.replaceChildren();
  app.style.maxWidth = '1320px';
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const asked = query.get('move');
  const shown = VARIANTS.filter((v) => !asked || asked === v);
  const variants = shown.length ? shown : VARIANTS;
  let theme: Theme = query.get('theme') === 'dark' ? 'dark' : 'light';
  let reduced = query.get('reduced') === '1';
  const coatAsked = query.get('coat');
  let coat: BunnyCoat = COATS.bunny.some((c) => c.id === coatAsked) ? (coatAsked as BunnyCoat) : 'fawn';
  const tParam = query.get('t');
  const frozen = tParam !== null && Number.isFinite(Number(tParam)) ? Number(tParam) : null;
  const contact = query.get('contact') === '1';
  const frames = Math.max(4, Math.min(24, Number(query.get('frames')) || 12));
  document.documentElement.dataset['theme'] = theme;

  const page = el('section', 'mbx-page');
  page.innerHTML = `<h2>«Mitbringen»: момент Помпона — «Корзинка» и последний пункт</h2>
    <p>Только в галерее (в приложение не попадает без твоего «ок»). Макет раздела «Mitbringen» на экране повода шириной телефона
    (390 px), цвета приложения. Оба телефона отвечают на <b>твоё</b> «Ich bring’s mit» после ответа сервера. Слева — «Корзинка»
    (ты её выбрал). Справа — <b>новое</b>: если это был последний свободный пункт, Помпон приносит корзинку так же и радуется
    одним бинки (вместо пробежки через заголовок). Время под телефоном считается от ответа сервера (тап — за 0,6 с до него).</p>`;
  const controls = el('div', 'mbx-controls');
  const themeSel = el('select');
  themeSel.setAttribute('aria-label', 'Тема');
  themeSel.add(new Option('Светлая тема', 'light'));
  themeSel.add(new Option('Тёмная тема', 'dark'));
  themeSel.value = theme;
  const motionSel = el('select');
  motionSel.setAttribute('aria-label', 'Движение');
  motionSel.add(new Option('Полное движение', 'full'));
  motionSel.add(new Option('Меньше движения (Weniger)', 'reduced'));
  motionSel.value = reduced ? 'reduced' : 'full';
  const coatSel = el('select');
  coatSel.setAttribute('aria-label', 'Окрас');
  for (const c of COATS.bunny) coatSel.add(new Option(`Окрас: ${c.name}`, c.id));
  coatSel.value = coat;
  const playAll = el('button', '', '▶ Показать по очереди');
  const sheetLink = el('a');
  const params = new URLSearchParams(query);
  params.set('contact', contact ? '0' : '1');
  sheetLink.href = `?${params.toString()}`;
  sheetLink.textContent = contact ? 'Скрыть контактный лист' : 'Контактный лист кадров';
  controls.append(themeSel, motionSel, coatSel, playAll, sheetLink);
  page.append(controls);

  const row = el('div', 'mbx-row3');
  page.append(row);
  const sheetBox = el('div');
  page.append(sheetBox);
  app.append(page);

  interface Col {
    variant: Variant;
    holder: HTMLElement;
    scene: MitbringenScene | null;
    range: HTMLInputElement;
    label: HTMLElement;
  }
  const cols: Col[] = [];
  let queue = 0;

  const build = (c: Col): MitbringenScene => {
    c.scene?.destroy();
    const scene = new MitbringenScene(c.holder, { variant: c.variant, theme, reduced, coat });
    c.scene = scene;
    c.range.min = String(-PRE);
    c.range.max = String(scene.duration);
    c.range.step = '0.01';
    c.range.value = String(-PRE);
    c.label.textContent = `${fmt(-PRE)} / ${scene.duration.toFixed(2)} с`;
    return scene;
  };

  for (const variant of variants) {
    const col = el('div', 'mbx-col');
    col.dataset['variant'] = variant;
    col.append(el('h3', '', `${TITLES[variant]}<span class="tag">${TAGS[variant]}</span>`));
    const holder = el('div');
    col.append(holder);
    const play = el('div', 'play');
    const again = el('button', '', '▶ Ещё раз');
    const range = el('input');
    range.type = 'range';
    range.setAttribute('aria-label', 'Кадр');
    const label = el('span', '', '');
    play.append(again, range, label);
    col.append(play);
    col.append(el('ul', '', NOTES[variant].map((n) => `<li>${n}</li>`).join('')));
    row.append(col);
    const c: Col = { variant, holder, scene: null, range, label };
    cols.push(c);
    again.onclick = () => {
      queue += 1;
      const s = build(c);
      void s.play();
    };
    range.oninput = () => {
      const t = Number(range.value);
      c.scene?.seek(t);
      label.textContent = `${fmt(t)} / ${(c.scene?.duration ?? 0).toFixed(2)} с`;
    };
  }

  const rebuildAll = () => cols.forEach(build);
  /** One mascot animates at a time: the phones play one after the other. */
  const playInOrder = async () => {
    const mine = ++queue;
    for (const c of cols) {
      if (mine !== queue) return;
      const s = build(c);
      await s.play();
      if (mine !== queue) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  themeSel.onchange = () => {
    theme = themeSel.value === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset['theme'] = theme;
    for (const ph of document.querySelectorAll<HTMLElement>('.mbx-phone')) ph.dataset['theme'] = theme;
  };
  motionSel.onchange = () => {
    reduced = motionSel.value === 'reduced';
    queue += 1;
    rebuildAll();
  };
  coatSel.onchange = () => {
    coat = coatSel.value as BunnyCoat;
    queue += 1;
    rebuildAll();
  };
  playAll.onclick = () => void playInOrder();

  rebuildAll();
  if (frozen !== null) {
    for (const c of cols) {
      c.scene?.seek(frozen);
      c.range.value = String(frozen);
      c.label.textContent = `${fmt(frozen)} / ${(c.scene?.duration ?? 0).toFixed(2)} с`;
    }
  } else if (query.get('autoplay') !== '0' && !contact) void playInOrder();

  if (contact) {
    const zoom = Math.max(0.3, Math.min(2, Number(query.get('zoom')) || 0.6));
    const t0 = query.has('t0') ? Number(query.get('t0')) : null;
    const t1 = query.has('t1') ? Number(query.get('t1')) : null;
    renderSheet(sheetBox, variants, { theme, reduced, coat, frames, zoom, t0, t1 });
  }

  const w = window as unknown as { mitbringen?: { scenes: () => (MitbringenScene | null)[]; ready: boolean } };
  w.mitbringen = { scenes: () => cols.map((c) => c.scene), ready: false };
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (w.mitbringen) w.mitbringen.ready = true;
    document.body.dataset['ready'] = '1';
  }));
  window.addEventListener('pagehide', () => cols.forEach((c) => c.scene?.destroy()), { once: true });
}

/** Contact sheet: N frames per variant, each its own phone frozen with seek(t), cropped to the section. */
function renderSheet(
  box: HTMLElement,
  variants: Variant[],
  o: { theme: Theme; reduced: boolean; coat: BunnyCoat; frames: number; zoom: number; t0: number | null; t1: number | null },
): void {
  // a cell shows 390 × 350 phone px (the section from its title to the third row), scaled by `zoom`; the last item's
  // cell is taller: it reaches "Alles ist verteilt. Danke!" under the card
  const cw = Math.round(390 * o.zoom);
  for (const variant of variants) {
    const ch = Math.round((variant === 'last' ? 500 : 350) * o.zoom);
    box.append(el('h3', 'mbx-sheet-title', `${TITLES[variant]} — кадры${o.reduced ? ' (меньше движения)' : ''}`));
    const grid = el('div', 'mbx-sheet');
    grid.style.gridTemplateColumns = `repeat(auto-fill, ${cw}px)`;
    box.append(grid);
    const cell = () => {
      const c = el('div', 'mbx-cell');
      c.style.width = `${cw}px`;
      c.style.height = `${ch}px`;
      grid.append(c);
      return c;
    };
    // the first frame is the spinner (before the answer) unless a range is asked for; the last one the calm end
    const probeCell = cell();
    const first = new MitbringenScene(probeCell, { variant, theme: o.theme, reduced: o.reduced, coat: o.coat });
    const dur = first.duration;
    const ranged = o.t0 !== null || o.t1 !== null;
    const a = o.t0 ?? 0;
    const b = o.t1 ?? dur;
    const times = Array.from({ length: o.frames }, (_, i) =>
      ranged ? a + ((b - a) * i) / (o.frames - 1) : i === 0 ? -0.3 : (dur * (i - 1)) / (o.frames - 2));
    times.forEach((t, i) => {
      const c = i === 0 ? probeCell : cell();
      const scene = i === 0 ? first : new MitbringenScene(c, { variant, theme: o.theme, reduced: o.reduced, coat: o.coat });
      scene.seek(t);
      // measured before scaling (transforms do not change layout); crop to the section
      const top = Math.max(0, scene.geo.card.top - 172);
      scene.refs.phone.style.transform = `scale(${o.zoom}) translateY(${-top}px)`;
      c.append(el('b', '', `t = ${t.toFixed(2)} с`));
    });
  }
}
