/**
 * Gallery page «Парад» v2 — «Бременская башня» (ideas doc 2026-10-26 §1.6) on the mascot gallery (5180). Approved by
 * Felix 26.10; since 27.10 the scene lives in the package (src/tower.ts, entry @bunprise/mascot/tower) and plays in
 * the app. A phone shows the bottom of the "Profil" tab (Paper tokens from apps/web/src/styles/tokens.css); 5 taps on
 * the version line start the show (the ▶ button too).
 *
 *   ?screens=parade [&reduced=1] [&theme=light|dark]
 *   &t=2.4         the phone frozen at 2.4 s (deterministic: seek)
 *   &w=320         a narrow phone (default 390 px)
 *   &frames=12     contact sheet frames (crops of the bottom band), &contact=0 = none (not "sheet": main.ts reserves it)
 *   &view=phone    only the phone (screenshots) · &autoplay=0 = wait for the taps
 *
 * Design note for Felix: docs/design/2026-10-26-parade.md (v1 archived in _codex_handoffs/archive-20261026/parade-v1).
 */

import { addCss, applyPageTheme, el, markReady, PAPER_CSS, themeOf, type Theme } from './kit';
import { BEAT, EDGE_INSET, HOST_H, minGap, onStage } from '../../src/tower-plan';
import { ParadeStage, RM } from '../../src/tower';

const CSS = `
.pr-page { max-width: 1180px; margin: 0 auto; padding: 8px 16px 48px; box-sizing: border-box; color: var(--text); }
.pr-page h2 { margin: 6px 0 4px; font-size: 24px; letter-spacing: -.02em; }
.pr-lead { margin: 0 0 16px; color: var(--text-2); font-size: 14px; max-width: 780px; line-height: 1.45; }
.pr-main { display: flex; flex-wrap: wrap; gap: 32px; align-items: flex-start; }
.pr-controls { flex: 1 1 300px; max-width: 480px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
.pr-controls .row { justify-content: flex-start; margin: 0; }
.pr-controls h3 { margin: 6px 0 0; font-size: 15px; }
.pr-controls p, .pr-controls li { margin: 0; color: var(--text-2); line-height: 1.45; }
.pr-controls ol { margin: 0; padding-left: 20px; }
.pr-scrub { display: flex; align-items: center; gap: 10px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.pr-scrub input { flex: 1; accent-color: var(--accent-ui); }
.pr-taps { font-variant-numeric: tabular-nums; }
.pr-sheet-title { margin: 30px 0 8px; font-size: 18px; }
.pr-sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(214px, 1fr)); gap: 10px; }
.pr-cell { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.pr-cell small { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.pr-crop { position: relative; width: 214px; height: 236px; overflow: hidden; border-radius: 12px; box-shadow: 0 0 0 1px rgba(60,40,20,.14); }
.pr-zoom { position: absolute; left: 0; top: 0; transform-origin: 0 0; transform: translate(-0px, var(--crop-y)) scale(.55); }
.pr-zoom .bp-paper { border-radius: 0; box-shadow: none; }

/* ---- the phone: the bottom of the Profil tab (AccountPages.tsx SettingsPage, settings.css, nav.css) ---- */
.pr-phone { width: 390px; height: 660px; }
.pr-status { position: absolute; left: 0; right: 0; top: 0; height: 47px; display: flex; align-items: center; justify-content: space-between; padding: 0 30px; box-sizing: border-box; font-size: 15px; font-weight: 600; z-index: 4; }
.pr-bar { position: absolute; left: 0; right: 0; top: 0; height: 99px; z-index: 3; background: var(--float-bg); -webkit-backdrop-filter: blur(20px) saturate(1.6); backdrop-filter: blur(20px) saturate(1.6);
  box-shadow: 0 1px 0 var(--separator); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 15px; box-sizing: border-box; font-size: 17px; font-weight: 600; }
.pr-scroll { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 16px 98px; display: flex; flex-direction: column; gap: 28px; }
.pr-group { display: flex; flex-direction: column; gap: 8px; }
.pr-cap { margin: 0; padding: 0 16px; font-size: 13px; line-height: 18px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--text-2); }
.pr-list { margin: 0; padding: 0; list-style: none; border-radius: 22px; }
.pr-list li { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 16px; font-size: 17px; position: relative; }
.pr-list li + li::before { content: ''; position: absolute; left: 58px; right: 0; top: 0; height: 1px; background: var(--separator); }
.pr-list li i { width: 30px; height: 30px; border-radius: 9px; flex: none; background-image: linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,0) 60%); }
.pr-list li span { flex: 1; }
.pr-list li b { font-weight: 400; color: var(--text-3); font-size: 20px; }
.pr-end { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.pr-logout { width: 100%; min-height: 52px; border-radius: 22px; display: flex; align-items: center; justify-content: center; font-weight: 600; color: var(--danger-text); }
.pr-version { margin: 0; text-align: center; font-size: 12px; line-height: 16px; color: var(--text-3); text-wrap: balance; cursor: pointer; padding: 6px 8px; border-radius: 8px;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; transition: background-color .1s; }
.pr-version:active { background-color: var(--fill); }
.pr-version:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
.pr-tabs { position: absolute; left: 16px; right: 16px; bottom: 22px; height: 64px; display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); column-gap: 10px; align-items: center; z-index: 3; }
.pr-cap2 { height: 64px; width: 138px; border-radius: 999px; display: flex; align-items: center; justify-content: space-around; padding: 0 5px; box-sizing: border-box;
  background: var(--float-bg); -webkit-backdrop-filter: blur(16px) saturate(1.6); backdrop-filter: blur(16px) saturate(1.6); box-shadow: var(--panel-edge), var(--panel-shadow);
  font-size: 10px; font-weight: 600; color: var(--text-2); }
.pr-cap2:first-child { justify-self: end; } .pr-cap2:last-child { justify-self: start; }
.pr-cap2 span { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 62px; }
.pr-cap2 span i { width: 22px; height: 22px; border-radius: 7px; background: currentColor; opacity: .55; }
.pr-cap2 .on { color: #DC7B2C; } .pr-cap2 .on i { border-radius: 50%; opacity: 1; background: linear-gradient(#F6C07E, #F0A04B); }
.pr-plus { width: 54px; height: 54px; border-radius: 50%; background: #EE9443; color: #2A1A0B; display: grid; place-items: center; font-size: 30px; font-weight: 300; box-shadow: 0 6px 16px rgba(160,80,20,.3); }
.pr-narrow .pr-cap2 { width: 116px; } .pr-narrow .pr-cap2 span { width: 52px; }
.pr-host { position: absolute; left: 0; width: 100%; z-index: 2; pointer-events: none; }
`;

const PROFIL = `<div class="pr-status"><span>9:41</span><span>●●● ▮</span></div>
<div class="pr-bar">Profil</div>
<div class="pr-scroll">
  <section class="pr-group"><h3 class="pr-cap">Rechtliches</h3><ul class="pr-list bp-panel">
    <li><i style="background-color:#7D6E62"></i><span>Impressum</span><b>›</b></li>
    <li><i style="background-color:#8F7FD3"></i><span>Datenschutz</span><b>›</b></li>
    <li><i style="background-color:#5B9BD5"></i><span>Nutzungsbedingungen</span><b>›</b></li></ul></section>
  <section class="pr-group"><h3 class="pr-cap">Hilfe</h3><ul class="pr-list bp-panel">
    <li><i style="background-color:#E2A42E"></i><span>Problem melden</span><b>›</b></li></ul></section>
  <div class="pr-end">
    <div class="pr-logout bp-panel" data-edge>Abmelden</div>
    <p class="pr-version" role="button" tabindex="0" data-version>Private Testversion · nur für Erwachsene (18+) · Version 0.9.0</p>
  </div>
</div>
<nav class="pr-tabs" aria-hidden="true">
  <div class="pr-cap2"><span><i></i>Start</span><span><i></i>Listen</span></div>
  <div class="pr-plus">+</div>
  <div class="pr-cap2"><span><i></i>Ideen</span><span class="on"><i></i>Profil</span></div>
</nav>`;

export interface ProfilPhone {
  phone: HTMLDivElement;
  host: HTMLDivElement;
  version: HTMLElement;
  /** the card's left / width / radius in host px (reduced motion: the heads peek over it) */
  card: { left: number; width: number; radius: number };
}

/** Layout offset of `node` inside `root` (offsetTop chain: transforms of ancestors do not change it). */
function offsetIn(node: HTMLElement, root: HTMLElement): { top: number; left: number } {
  let top = 0;
  let left = 0;
  let n: HTMLElement | null = node;
  while (n && n !== root) {
    top += n.offsetTop;
    left += n.offsetLeft;
    n = n.offsetParent as HTMLElement | null;
  }
  return { top, left };
}

/** The bottom of the Profil tab; the stage host spans the phone's width and ends EDGE_INSET px below the card's top edge. */
export function profilPhone(parent: HTMLElement, theme: Theme, width = 390): ProfilPhone {
  const phone = el('div', `pr-phone bp-paper${theme === 'dark' ? ' dark' : ''}${width < 360 ? ' pr-narrow' : ''}`, PROFIL);
  phone.style.width = `${width}px`;
  const host = el('div', 'pr-host');
  phone.append(host);
  parent.append(phone);
  const edge = phone.querySelector<HTMLElement>('[data-edge]');
  const version = phone.querySelector<HTMLElement>('[data-version]');
  if (!edge || !version) throw new Error('[parade] mock failed');
  // jsdom has no layout: the measured layout of the 390 × 660 phone
  const at = edge.offsetHeight > 0 ? offsetIn(edge, phone) : { top: 478, left: 16 };
  const cardW = edge.offsetWidth || width - 32;
  host.style.top = `${at.top + EDGE_INSET - HOST_H}px`;
  host.style.height = `${HOST_H}px`;
  return { phone, host, version, card: { left: at.left, width: cardW, radius: 22 } };
}

export function paradeGallery(app: HTMLElement, q: URLSearchParams): void {
  addCss('bp-paper-css', PAPER_CSS);
  addCss('pr-css', CSS);
  let theme: Theme = themeOf(q);
  let reduced = q.get('reduced') === '1';
  const frozen = q.has('t') ? Number(q.get('t')) || 0 : null;
  const phoneOnly = q.get('view') === 'phone';
  const width = Math.max(300, Math.min(440, Math.round(Number(q.get('w') ?? 390)) || 390));
  applyPageTheme(theme);
  const stages: ParadeStage[] = [];

  const page = el('section', 'pr-page');
  app.append(page);
  if (!phoneOnly) {
    page.append(
      el('h2', undefined, '«Парад» v2 — «Бременская башня», пасхалка в профиле'),
      el(
        'p',
        'pr-lead',
        'Только галерея. Пять касаний подряд по строке версии внизу «Profil» — и на краю карточки «Abmelden» кролики строят башню: броукен внизу, шоколадный прыгает ему на голову, гималайский — на шоколадного; каждое приземление приплющивает всех снизу. Последним Помпон: смотрит вверх, прыгает на самый верх, поворачивается к тебе — глаза-звёзды — и делает бинки. Башня кренится, и все врассыпную. ≈ 5 с, только transform / opacity, без петель.',
      ),
    );
  }
  const main = el('div', 'pr-main');
  page.append(main);
  const phoneBox = el('div');
  main.append(phoneBox);
  const controls = el('div', 'pr-controls');
  if (!phoneOnly) main.append(controls);

  const transport = el('div', 'row');
  const playBtn = el('button', 'btn', '▶ Парад');
  const motionBtn = el('button', 'btn small', 'Меньше движения');
  const themeBtn = el('button', 'btn small', '');
  for (const b of [playBtn, motionBtn, themeBtn]) b.type = 'button';
  transport.append(playBtn, motionBtn, themeBtn);
  const scrub = el('label', 'pr-scrub');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.step = '0.01';
  const out = el('span', undefined, '0.00 s');
  scrub.append('Кадр', range, out);
  const taps = el('p', 'pr-taps');
  const info = el('div');
  controls.append(transport, scrub, taps, info);

  let stage: ParadeStage | null = null;
  let phone: ReturnType<typeof profilPhone> | null = null;
  let tapTimes: number[] = [];

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
    themeBtn.textContent = theme === 'dark' ? 'Тема: тёмная' : 'Тема: светлая';
  }

  function build(at: number | null, autoplay: boolean): void {
    for (const s of stages.splice(0)) s.destroy();
    phoneBox.textContent = '';
    phone = profilPhone(phoneBox, theme, width);
    stage = new ParadeStage(phone.host, { reduced, card: phone.card, onEnd: show });
    stages.push(stage);
    (window as unknown as { parade: ParadeStage }).parade = stage;
    range.max = String(stage.duration);
    tapTimes = [];
    taps.textContent = 'Касания по строке версии: 0 / 5 (в приложении — без подсказки, это секрет)';
    // the easter egg: 5 taps within 2.5 s (like the bunny's own 5-tap rule); keyboard: Enter / Space
    const onTap = () => {
      const now = performance.now();
      tapTimes = [...tapTimes.filter((x) => now - x < 2500), now];
      taps.textContent = `Касания по строке версии: ${Math.min(5, tapTimes.length)} / 5 (в приложении — без подсказки, это секрет)`;
      if (tapTimes.length >= 5) {
        tapTimes = [];
        play();
      }
    };
    phone.version.addEventListener('click', onTap);
    phone.version.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onTap();
      }
    });
    renderInfo();
    if (at !== null) {
      stage.seek(at);
      show();
    } else if (autoplay) play();
    else show();
    renderSheet();
  }

  function renderInfo(): void {
    if (!stage) return;
    const p = stage.plan;
    const [, c, h, pp] = p.members;
    const f = (t: number | undefined) => (t ?? 0).toFixed(2);
    const peak = Math.max(...Array.from({ length: Math.ceil(p.duration * 100) }, (_, i) => onStage(p, i / 100)));
    const gap = minGap(p);
    info.innerHTML = reduced
      ? `<h3>Меньше движения</h3><p>Как в v1: четыре головы неподвижно выглядывают над краем карточки (поза иконки: лапки на краю), ${String(RM.fadeIn).replace('.', ',')} с проявляются, ${RM.hold} с стоят, ${String(RM.fadeOut).replace('.', ',')} с тают. Ни одного вызова animate(), только CSS-прозрачность.</p>`
      : `<h3>Что смотреть (секунды)</h3><ol>
  <li>${f(BEAT.in[0])} — броукен запрыгивает слева, встаёт у середины и поворачивается к тебе.</li>
  <li>${f(c?.jump?.up)}–${f(c?.jump?.land)} — шоколадный (справа) прыгает ему на голову: оба приплющиваются, у нижнего зажмуриваются глаза, ушки вздрагивают.</li>
  <li>${f(h?.jump?.up)}–${f(h?.jump?.land)} — гималайский (слева) прыгает на шоколадного: толчок проходит вниз по башне.</li>
  <li>${f(BEAT.look)} — Помпон стоит справа и смотрит на башню снизу вверх (откинулся, нюхает, моргает).</li>
  <li>${f(pp?.jump?.up)}–${f(pp?.jump?.land)} — большой прыжок на самый верх; башню качает.</li>
  <li>${f(BEAT.front)} — поворачивается к тебе, глаза-звёзды; ${f(p.binky.up)}–${f(p.binky.land)} — бинки (прыжок радости с поворотом в воздухе).</li>
  <li>${f(BEAT.uhOh)} — приземлился чуть сбоку, башня кренится: «ой» — глаза круглые.</li>
  <li>${f(BEAT.sep[3])} — все врассыпную сверху вниз: Помпон вправо, гималайский влево, шоколадный вправо; броукен опускается на обе лапы и убегает влево. ${p.duration.toFixed(2)} — конец, ничего не крутится.</li>
</ol>
<p>Пик: ${peak} кролика на экране сразу. На краю никто ни через кого не проходит: ближе всего силуэты ${gap.gap.toFixed(0)} px (t = ${gap.at.toFixed(2)} с).</p>`;
  }

  function renderSheet(): void {
    const old = page.querySelector('.pr-sheet-wrap');
    old?.remove();
    const frames = Math.max(0, Math.min(30, Math.round(Number(q.get('frames') ?? 12))));
    if (phoneOnly || frames === 0 || q.get('contact') === '0' || !stage) return;
    const d = stage.duration;
    const wrap = el('div', 'pr-sheet-wrap');
    wrap.append(el('h3', 'pr-sheet-title', `Контактный лист · ${frames} кадров · 0–${d.toFixed(2)} s${reduced ? ' · меньше движения' : ''}`));
    const grid = el('div', 'pr-sheet');
    wrap.append(grid);
    page.append(wrap);
    const cropY = -(phone ? Number.parseFloat(phone.host.style.top) * 0.55 - 10 : 50);
    for (let i = 0; i < frames; i++) {
      const t = frames === 1 ? 0 : (d * i) / (frames - 1);
      const cell = el('div', 'pr-cell');
      const crop = el('div', 'pr-crop');
      crop.style.width = `${Math.round(width * 0.55)}px`;
      const zoom = el('div', 'pr-zoom');
      zoom.style.setProperty('--crop-y', `${cropY}px`);
      crop.append(zoom);
      cell.append(crop, el('small', undefined, `t = ${t.toFixed(2)} s`));
      grid.append(cell);
      const ph = profilPhone(zoom, theme, width);
      const s = new ParadeStage(ph.host, { reduced, card: ph.card });
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
