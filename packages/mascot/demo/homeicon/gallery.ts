/**
 * Gallery page «Здесь я буду жить» (ideas doc 2026-10-26 §1.5) on the mascot gallery (5180) — approved by Felix 27.10, in the app since then;
 * the gallery keeps it for checks. A phone shows the onboarding step "Zum Home-Bildschirm" (StepViews.tsx
 * HomeScreenStep, Paper tokens); above its card the app-icon frame slides up and Pompon becomes the icon (src/homeicon.ts — in the app since 27.10).
 *
 *   ?screens=homeicon [&reduced=1] [&theme=light|dark] [&label=0]
 *   &t=1.6         the phone frozen at 1.6 s (deterministic: seek)
 *   &frames=12     contact sheet frames, &contact=0 = none (not "sheet": main.ts reserves it)
 *   &view=phone    only the phone (screenshots) · &autoplay=0 = wait for ▶
 *
 * Design note for Felix: docs/design/2026-10-26-homeicon.md.
 */

import { addCss, applyPageTheme, el, markReady, PAPER_CSS, themeOf, type Theme } from '../parade/kit';
import { BEATS, CORNER, HomeIconStage, SHRINK } from '../../src/homeicon';

/** The real app icon (the master file the PWA icons are made from), for the side-by-side check. */
const ICON_URL = new URL('../../../../apps/web/public/icons/icon.svg', import.meta.url).href;

const CSS = `
.hi-page { max-width: 1180px; margin: 0 auto; padding: 8px 16px 48px; box-sizing: border-box; color: var(--text); }
.hi-page h2 { margin: 6px 0 4px; font-size: 24px; letter-spacing: -.02em; }
.hi-page h3.hi-title { margin: 30px 0 8px; font-size: 18px; }
.hi-lead { margin: 0 0 16px; color: var(--text-2); font-size: 14px; max-width: 780px; line-height: 1.45; }
.hi-main { display: flex; flex-wrap: wrap; gap: 32px; align-items: flex-start; }
.hi-controls { flex: 1 1 300px; max-width: 480px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
.hi-controls .row { justify-content: flex-start; margin: 0; }
.hi-controls h3 { margin: 6px 0 0; font-size: 15px; }
.hi-controls p, .hi-controls li { margin: 0; color: var(--text-2); line-height: 1.45; }
.hi-controls ol { margin: 0; padding-left: 20px; }
.hi-scrub { display: flex; align-items: center; gap: 10px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.hi-scrub input { flex: 1; accent-color: var(--accent-ui); }
.hi-sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(214px, 1fr)); gap: 10px; }
.hi-cell { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.hi-cell small, .hi-cmp small { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.hi-crop { position: relative; width: 214px; height: 140px; overflow: hidden; border-radius: 12px; box-shadow: 0 0 0 1px rgba(60,40,20,.14); }
.hi-zoom { position: absolute; left: 0; top: 0; transform-origin: 0 0; transform: translate(0, var(--crop-y)) scale(.55); }
.hi-zoom .bp-paper { border-radius: 0; box-shadow: none; }
.hi-cmps { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.hi-cmp { display: flex; flex-direction: column; gap: 6px; align-items: center; max-width: 200px; text-align: center; }
.hi-box { position: relative; width: 176px; height: 176px; }
.hi-box img { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: ${CORNER * 100}%; }
.hi-box .hi-diff { mix-blend-mode: difference; }
.hi-box.black { background: #000; border-radius: ${CORNER * 100}%; }

/* ---- the phone: the onboarding step "Zum Home-Bildschirm" (WelcomePage scene + card, StepViews HomeScreenStep) ---- */
.hi-phone { width: 390px; height: 844px; }
.hi-status { position: absolute; left: 0; right: 0; top: 0; height: 47px; display: flex; align-items: center; justify-content: space-between; padding: 0 30px; box-sizing: border-box; font-size: 15px; font-weight: 600; }
.hi-top { position: absolute; left: 0; right: 0; top: 47px; height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px 0 8px; box-sizing: border-box; }
.hi-top .hi-back { width: 44px; height: 44px; display: grid; place-items: center; font-size: 28px; color: var(--accent-text); }
.hi-dots { display: flex; gap: 6px; } .hi-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); opacity: .45; }
.hi-dots i.on { width: 20px; border-radius: 4px; background: var(--accent-text); opacity: 1; }
.hi-skip { font-size: 15px; color: var(--accent-text); padding: 0 6px; }
.hi-host { position: absolute; left: 0; width: 100%; top: 95px; z-index: 1; pointer-events: none; }
.hi-card { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; border-radius: 40px 40px 0 0; padding: 30px 20px 34px; box-sizing: border-box; display: flex; flex-direction: column; }
.hi-bubble { position: relative; margin: 0 auto; width: fit-content; max-width: 100%; border-radius: 20px; background: var(--surface); padding: 14px 22px; box-shadow: 0 1px 2px rgba(70,45,20,.07), 0 2px 8px rgba(70,45,20,.05); }
.hi-bubble h1 { margin: 0; text-align: center; font-size: 22px; line-height: 28px; font-weight: 700; letter-spacing: -.02em; text-wrap: balance; }
.hi-text { margin: 16px auto 0; max-width: 34ch; text-align: center; font-size: 17px; line-height: 22px; color: var(--text-2); }
.hi-steps { list-style: none; margin: 20px 0 0; padding: 0; border-radius: 24px; background: var(--surface); box-shadow: 0 1px 2px rgba(70,45,20,.07), 0 2px 8px rgba(70,45,20,.05); }
.hi-steps li { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 16px; box-sizing: border-box; font-size: 16px; line-height: 21px; position: relative; }
.hi-steps li + li::before { content: ''; position: absolute; left: 64px; right: 0; top: 0; height: 1px; background: var(--separator); }
.hi-steps i { width: 36px; height: 36px; border-radius: 10px; flex: none; display: grid; place-items: center; background: var(--accent-50); color: var(--accent-text); font-style: normal; font-size: 18px; font-weight: 600; }
.hi-note { margin: 12px 8px 16px; text-align: center; font-size: 13px; line-height: 18px; color: var(--text-2); }
.hi-btn { margin-top: auto; height: 52px; border: 0; border-radius: 999px; background: #EE9443; color: #2A1A0B; font: 600 17px/1 inherit; }
`;

const STEP = `<div class="hi-status"><span>9:41</span><span>●●● ▮</span></div>
<div class="hi-top"><span class="hi-back">‹</span><span class="hi-dots"><i></i><i></i><i></i><i class="on"></i></span><span class="hi-skip">Überspringen</span></div>
<div class="hi-card bp-panel" data-card>
  <div class="hi-bubble"><h1>Zum Home‑Bildschirm hinzufügen</h1></div>
  <p class="hi-text">Dann ist Bunprise immer griffbereit – wie eine richtige App.</p>
  <ol class="hi-steps">
    <li><i>⇧</i><span>Tipp auf „Teilen“ – in der Leiste oder im Menü „…“</span></li>
    <li><i>＋</i><span>Wähle „Zum Home‑Bildschirm“</span></li>
    <li><i>✓</i><span>Tipp oben rechts auf „Hinzufügen“</span></li>
  </ol>
  <p class="hi-note">Wenn du Bunprise zum ersten Mal vom Home‑Bildschirm öffnest, meldest du dich noch einmal an.</p>
  <button class="hi-btn" type="button" tabindex="-1">Fertig</button>
</div>`;

const HOST_TOP = 95;

export interface StepPhone {
  phone: HTMLDivElement;
  host: HTMLDivElement;
}

/** The onboarding step; the stage host spans from under the top bar down to the card's top edge (the icon hides behind it). */
export function stepPhone(parent: HTMLElement, theme: Theme): StepPhone {
  const phone = el('div', `hi-phone bp-paper${theme === 'dark' ? ' dark' : ''}`, STEP);
  const host = el('div', 'hi-host');
  phone.append(host);
  parent.append(phone);
  const card = phone.querySelector<HTMLElement>('[data-card]');
  // jsdom has no layout: the measured card top of the 390 × 844 phone
  const cardTop = card && card.offsetHeight > 0 ? card.offsetTop : 354;
  host.style.height = `${cardTop - HOST_TOP}px`;
  return { phone, host };
}

export function homeIconGallery(app: HTMLElement, q: URLSearchParams): void {
  addCss('bp-paper-css', PAPER_CSS);
  addCss('hi-css', CSS);
  let theme: Theme = themeOf(q);
  let reduced = q.get('reduced') === '1';
  let label = q.get('label') !== '0';
  const frozen = q.has('t') ? Number(q.get('t')) || 0 : null;
  const phoneOnly = q.get('view') === 'phone';
  applyPageTheme(theme);
  const stages: HomeIconStage[] = [];

  const page = el('section', 'hi-page');
  app.append(page);
  if (!phoneOnly) {
    page.append(
      el('h2', undefined, '«Здесь я буду жить» — Помпон становится иконкой'),
      el('p', 'hi-lead', 'Одобрено 27.10, уже в приложении. Шаг онбординга «Zum Home-Bildschirm» (только iOS Safari, один раз на устройстве). Из-за края карточки снизу выезжает рамка в форме иконки приложения; Помпон забирается на её оранжевую планку — тем же одобренным подъёмом лапками — и замирает точно в позе иконки: он и есть иконка. Потом рамка мягко уменьшается до размера иконки на экране «Домой». ≈ 2,4 с, только transform / opacity, без петель. Лапкой ни на что не показывает.'),
    );
  }
  const main = el('div', 'hi-main');
  page.append(main);
  const phoneBox = el('div');
  main.append(phoneBox);
  const controls = el('div', 'hi-controls');
  if (!phoneOnly) main.append(controls);

  const transport = el('div', 'row');
  const playBtn = el('button', 'btn', '▶ Ещё раз');
  const motionBtn = el('button', 'btn small', 'Меньше движения');
  const themeBtn = el('button', 'btn small', '');
  const labelBtn = el('button', 'btn small', 'Подпись «Bunprise»');
  for (const b of [playBtn, motionBtn, themeBtn, labelBtn]) b.type = 'button';
  transport.append(playBtn, motionBtn, themeBtn, labelBtn);
  const scrub = el('label', 'hi-scrub');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.step = '0.01';
  const out = el('span', undefined, '0.00 s');
  scrub.append('Кадр', range, out);
  const info = el('div');
  controls.append(transport, scrub, info);

  let stage: HomeIconStage | null = null;
  const show = () => {
    if (!stage) return;
    out.textContent = `${stage.time.toFixed(2)} / ${stage.duration.toFixed(2)} s`;
    range.value = String(Math.min(stage.time, stage.duration));
  };
  const tick = () => {
    show();
    if (stage?.playing) requestAnimationFrame(tick);
  };
  const play = () => {
    if (!stage) return;
    stage.stop();
    stage.play();
    requestAnimationFrame(tick);
  };

  function syncButtons(): void {
    motionBtn.classList.toggle('on', reduced);
    labelBtn.classList.toggle('on', label);
    themeBtn.textContent = theme === 'dark' ? 'Тема: тёмная' : 'Тема: светлая';
  }

  function build(at: number | null, autoplay: boolean): void {
    for (const s of stages.splice(0)) s.destroy();
    phoneBox.textContent = '';
    page.querySelectorAll('.hi-extra').forEach((n) => n.remove());
    const ph = stepPhone(phoneBox, theme);
    stage = new HomeIconStage(ph.host, { reduced, label: label ? 'Bunprise' : null, onEnd: show });
    stages.push(stage);
    (window as unknown as { homeicon: HomeIconStage }).homeicon = stage;
    range.max = String(stage.duration);
    const c = BEATS.climb;
    info.innerHTML = reduced
      ? '<h3>Меньше движения</h3><p>Сразу неподвижная композиция «как иконка» (конечный кадр: рамка уже маленькая, Помпон в позе иконки), плавно проявляется за 0,45 с. Ни одного вызова animate().</p>'
      : `<h3>Что смотреть (секунды)</h3><ol>
  <li>${BEATS.rise.toFixed(2)}–${(BEATS.rise + BEATS.riseDur).toFixed(2)} — рамка-иконка выезжает из-за края карточки (мягко, без отскока).</li>
  <li>${c.toFixed(2)} — кончики ушей над оранжевой планкой; ${(c + 0.28).toFixed(2)} / ${(c + 0.36).toFixed(2)} — лапки дугой из-за планки, шлёп; ${(c + 0.66).toFixed(2)}–${(c + 1.0).toFixed(2)} — подтягивается (одобренный подъём приветствия).</li>
  <li>${(c + BEATS.settle).toFixed(2)} — моргает и открывает глаза уже «как на иконке»: большие, смотрят вверх; голова оседает на 4 единицы, лапки встают точно на места иконки. ${(c + BEATS.settle + 0.06 + BEATS.settleDur).toFixed(2)} — замер: теперь это иконка.</li>
  <li>${BEATS.shrink.toFixed(2)}–${(BEATS.shrink + BEATS.shrinkDur).toFixed(2)} — рамка мягко уменьшается (×${SHRINK}) до иконки на экране «Домой»${label ? `; ${BEATS.label.toFixed(2)} — проявляется подпись «Bunprise»` : ''}. ${stage.duration.toFixed(2)} — конец.</li>
</ol><p>Ниже — проверка, что последний кадр совпадает с настоящей иконкой.</p>`;
    if (at !== null) {
      stage.seek(at);
      show();
    } else if (autoplay) play();
    else show();
    if (!phoneOnly) {
      renderCompare();
      renderSheet(ph);
    }
  }

  /** The end pose (just before it shrinks) next to the real icon.svg, and both blended by difference (black = the same). */
  function renderCompare(): void {
    const wrap = el('div', 'hi-extra');
    wrap.append(el('h3', 'hi-title', 'Проверка: Помпон в рамке = настоящая иконка?'));
    const row = el('div', 'hi-cmps');
    wrap.append(row);
    page.append(wrap);
    const S = 176;
    const at = BEATS.shrink - 0.01;
    const frozenTile = (box: HTMLElement) => {
      const host = el('div');
      host.style.cssText = `position:absolute;inset:0;width:${S}px;height:${S}px`;
      box.append(host);
      const s = new HomeIconStage(host, { reduced: false, size: S, lift: 0, label: null });
      s.seek(at);
      stages.push(s);
    };
    const a = el('div', 'hi-cmp');
    const boxA = el('div', 'hi-box');
    a.append(boxA, el('small', undefined, `Сцена, кадр t = ${at.toFixed(2)} с (перед уменьшением)`));
    const b = el('div', 'hi-cmp');
    const boxB = el('div', 'hi-box', `<img alt="" src="${ICON_URL}">`);
    b.append(boxB, el('small', undefined, 'Настоящая иконка apps/web/public/icons/icon.svg'));
    const c = el('div', 'hi-cmp');
    const boxC = el('div', 'hi-box black');
    c.append(boxC, el('small', undefined, 'Наложение «разница»: чёрное = совпадает пиксель в пиксель, светлое = отличие'));
    row.append(a, b, c);
    // in the document first: the stage measures its host
    frozenTile(boxA);
    frozenTile(boxC);
    const diff = el('img', 'hi-diff');
    diff.alt = '';
    diff.src = ICON_URL;
    boxC.append(diff);
  }

  function renderSheet(ph: { host: HTMLElement }): void {
    const frames = Math.max(0, Math.min(30, Math.round(Number(q.get('frames') ?? 12))));
    if (frames === 0 || q.get('contact') === '0' || !stage) return;
    const d = stage.duration;
    const wrap = el('div', 'hi-extra');
    wrap.append(el('h3', 'hi-title', `Контактный лист · ${frames} кадров · 0–${d.toFixed(2)} s${reduced ? ' · меньше движения' : ''}`));
    const grid = el('div', 'hi-sheet');
    wrap.append(grid);
    page.append(wrap);
    const hostTop = ph.host.offsetTop || HOST_TOP;
    for (let i = 0; i < frames; i++) {
      const t = frames === 1 ? 0 : (d * i) / (frames - 1);
      const cell = el('div', 'hi-cell');
      const crop = el('div', 'hi-crop');
      const zoom = el('div', 'hi-zoom');
      zoom.style.setProperty('--crop-y', `${-(hostTop * 0.55) + 4}px`);
      crop.append(zoom);
      cell.append(crop, el('small', undefined, `t = ${t.toFixed(2)} s`));
      grid.append(cell);
      const p = stepPhone(zoom, theme);
      const s = new HomeIconStage(p.host, { reduced, label: label ? 'Bunprise' : null });
      s.seek(t);
      stages.push(s);
    }
  }

  playBtn.addEventListener('click', play);
  motionBtn.addEventListener('click', () => {
    reduced = !reduced;
    syncButtons();
    build(null, true);
  });
  labelBtn.addEventListener('click', () => {
    label = !label;
    syncButtons();
    build(null, true);
  });
  themeBtn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    applyPageTheme(theme);
    syncButtons();
    build(stage && !stage.playing ? stage.time : null, false);
  });
  range.addEventListener('input', () => {
    stage?.seek(Number(range.value));
    show();
  });
  syncButtons();
  build(frozen, q.get('autoplay') !== '0');
  markReady();
  window.addEventListener('pagehide', () => stages.forEach((s) => s.destroy()), { once: true });
}
