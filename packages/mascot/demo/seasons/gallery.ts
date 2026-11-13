/**
 * Gallery page «Листопад / Снегопад» (seasons v2; ideas doc 2026-10-26 §1.4) — GALLERY-ONLY prototype on the
 * mascot gallery (5180); the app gets it only after Felix's OK. A phone shows the Start screen ("Bald" feed, Paper
 * tokens from apps/web/src/styles/tokens.css); Pompon peeks over the first card's top edge while leaves / snow come
 * down from the top of the screen (scene.ts, props drawn in props.ts).
 *
 *   ?screens=seasons [&season=autumn|winter] [&end=duck|stay] [&theme=light|dark] [&reduced=1]
 *   &t=2.4           the phone frozen at 2.4 s (deterministic: seek)
 *   &frames=16       contact sheet frames (1:1 crops around Pompon), &t0= &t1= the time range, &contact=0 = none (not "sheet": main.ts reserves it)
 *   &view=phone      only the phone (screenshots)
 *
 * Design note for Felix: docs/design/2026-10-26-seasons.md.
 */

import { SeasonScene, type Season, type SeasonEnd } from './scene';

const CSS = `
.sz-page { max-width: 1180px; margin: 0 auto; padding: 8px 16px 48px; box-sizing: border-box; color: var(--text); }
.sz-page h2 { margin: 6px 0 4px; font-size: 24px; letter-spacing: -.02em; }
.sz-lead { margin: 0 0 16px; color: var(--text-2); font-size: 14px; max-width: 760px; line-height: 1.45; }
.sz-main { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; }
.sz-controls { flex: 1 1 300px; max-width: 470px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
.sz-controls .row { justify-content: flex-start; margin: 0; }
.sz-controls h3 { margin: 6px 0 0; font-size: 15px; }
.sz-controls p { margin: 0; color: var(--text-2); line-height: 1.45; }
.sz-scrub { display: flex; align-items: center; gap: 10px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.sz-scrub input { flex: 1; accent-color: var(--accent-ui); }
.sz-sheet-title { margin: 30px 0 8px; font-size: 18px; }
.sz-sheet { display: grid; gap: 10px; }
.sz-cell { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.sz-cell small { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.sz-crop { position: relative; overflow: hidden; border-radius: 12px; box-shadow: 0 0 0 1px rgba(60,40,20,.14); }

/* ---- the phone: the app's Start screen (tokens.css "Paper"; night = "Paper at night") ---- */
.sz-phone { --bg: #F2EBDD; --text: #2A231C; --text-2: #62554A; --accent-text: #984A14;
  --g1: rgba(255,193,146,.58); --g2: rgba(248,180,170,.46); --g3: rgba(252,206,126,.5); --g4: rgba(204,194,242,.42);
  --top: #F7F0E5; --mid: #F3EADC; --bottom: #F0E6D6; --fill: rgba(116,84,44,.07); --thumb: #FFFDF8;
  --panel-bg: rgba(255,252,246,.62); --panel-sheen: linear-gradient(180deg, rgba(255,255,255,.5) 0%, transparent 42%);
  --panel-edge: inset 0 0 0 1px rgba(255,255,255,.62), inset 0 1px 0 rgba(255,255,255,.95);
  --panel-shadow: 0 1px 2px rgba(80,50,22,.05), 0 12px 30px -14px rgba(92,56,24,.26);
  --tint: #FCE5C9; --tint-ink: #984A14; --tab: rgba(255,253,248,.86);
  --mascot-shadow: rgba(70,40,15,.20); --mascot-outline: rgba(224,171,116,.5);
  position: relative; width: 390px; height: 720px; flex: none; border-radius: 44px; overflow: hidden; color: var(--text);
  background: radial-gradient(78% 36% at -4% -2%, var(--g1) 0%, transparent 72%), radial-gradient(70% 34% at 104% 30%, var(--g2) 0%, transparent 72%),
    radial-gradient(84% 34% at 4% 98%, var(--g3) 0%, transparent 72%), radial-gradient(72% 30% at 102% 80%, var(--g4) 0%, transparent 72%),
    linear-gradient(180deg, var(--top) 0%, var(--mid) 55%, var(--bottom) 100%);
  box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(40,25,10,.25);
  font: 17px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.sz-phone.dark { --bg: #17120F; --text: #F5EDE3; --text-2: #C3B5A6; --accent-text: #F2A25A;
  --g1: rgba(255,150,84,.13); --g2: rgba(232,118,124,.10); --g3: rgba(236,172,82,.10); --g4: rgba(150,132,226,.09);
  --top: #1C1612; --mid: #18130F; --bottom: #15100D; --fill: rgba(255,230,205,.075); --thumb: #4B3E34;
  --panel-bg: rgba(46,37,31,.72); --panel-sheen: linear-gradient(180deg, rgba(255,236,214,.05) 0%, transparent 42%);
  --panel-edge: inset 0 0 0 1px rgba(255,236,214,.075), inset 0 1px 0 rgba(255,236,214,.11);
  --panel-shadow: 0 1px 2px rgba(0,0,0,.3), 0 12px 30px -14px rgba(0,0,0,.55);
  --tint: #3D2A1A; --tint-ink: #FFC58A; --tab: rgba(42,34,29,.86);
  --mascot-shadow: rgba(0,0,0,.42); --mascot-outline: rgba(255,214,170,.2); box-shadow: 0 0 0 10px #2C2C2E, 0 30px 70px rgba(0,0,0,.6); }
.sz-app { position: absolute; inset: 0; padding: 54px 16px 0; }
.sz-top { display: flex; align-items: center; justify-content: space-between; height: 40px; }
.sz-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; }
.sz-brand i { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(#F6C07E, #F0A04B); }
.sz-icons { display: flex; gap: 10px; }
.sz-icons i { width: 36px; height: 36px; border-radius: 50%; background: var(--panel-bg); box-shadow: var(--panel-edge), var(--panel-shadow); }
/* as FeedPage: pt-4, the title row min-h 52 px + mb-7, the section heading + mb-3 */
.sz-head { display: flex; align-items: center; justify-content: space-between; min-height: 52px; margin: 16px 0 28px; }
.sz-head b { font-size: 34px; font-weight: 800; letter-spacing: -.032em; line-height: 41px; }
.sz-seg { display: flex; width: 200px; box-sizing: border-box; background: var(--fill); border-radius: 999px; padding: 3px; font-size: 13px; font-weight: 600; }
.sz-seg span { flex: 1; text-align: center; padding: 7px 12px; border-radius: 999px; color: var(--text-2); }
.sz-seg .on { background: var(--thumb); color: var(--text); box-shadow: 0 1px 3px rgba(70,45,20,.12); }
.sz-h2 { margin: 0 0 12px; font-size: 22px; line-height: 28px; font-weight: 700; letter-spacing: -.01em; }
.sz-card { position: relative; z-index: 1; display: flex; gap: 16px; padding: 16px; margin-bottom: 12px; border-radius: 24px;
  background-color: var(--panel-bg); background-image: var(--panel-sheen); box-shadow: var(--panel-edge), var(--panel-shadow); }
.sz-badge { flex: none; width: 54px; height: 60px; border-radius: 14px; background: var(--tint); color: var(--tint-ink);
  display: flex; flex-direction: column; align-items: center; justify-content: center; font-weight: 700; line-height: 1; }
.sz-badge small { font-size: 11px; letter-spacing: .06em; } .sz-badge span { font-size: 22px; margin-top: 3px; }
.sz-card p { margin: 0; font-size: 13px; line-height: 18px; color: var(--text-2); } .sz-card p b { color: var(--accent-text); font-weight: 600; }
.sz-card h4 { margin: 2px 0 0; font-size: 20px; line-height: 25px; font-weight: 700; }
.sz-tags { display: flex; gap: 6px; margin-top: 10px; } .sz-tags span { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--fill); color: var(--text-2); }
.sz-tabs { position: absolute; left: 12px; right: 12px; bottom: 14px; height: 62px; border-radius: 31px; background: var(--tab);
  box-shadow: var(--panel-edge), var(--panel-shadow); display: flex; align-items: center; justify-content: space-around; font-size: 11px; font-weight: 600; color: var(--text-2); }
.sz-tabs .on { color: #DC7B2C; } .sz-tabs .plus { width: 50px; height: 50px; border-radius: 50%; background: #EE9443; color: #1D140C; display: grid; place-items: center; font-size: 28px; font-weight: 400; }
.sz-host { position: absolute; top: 0; z-index: 5; pointer-events: none; }
.sz-caption { position: absolute; left: 16px; right: 16px; top: 8px; z-index: 6; font-size: 12px; color: var(--text-2); text-align: center; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

const FEED = `<div class="sz-app">
  <div class="sz-top"><span class="sz-brand"><i></i>Bunprise</span><span class="sz-icons"><i></i><i></i></span></div>
  <div class="sz-head"><b>Bald</b><span class="sz-seg"><span class="on">Liste</span><span>Monat</span></span></div>
  <div class="sz-h2">Diese Woche</div>
  <article class="sz-card" data-first><span class="sz-badge"><small>NOV</small><span>1</span></span><span><p><b>in 6 Tagen</b> · Sa., 1. Nov.</p><h4>Lenas Geburtstag</h4><span class="sz-tags"><span>3 Wünsche</span><span>Du kommst</span></span></span></article>
  <article class="sz-card"><span class="sz-badge"><small>NOV</small><span>7</span></span><span><p><b>in 12 Tagen</b> · Fr., 7. Nov. · 19:00</p><h4>Spieleabend bei Tim</h4><span class="sz-tags"><span>Mitbringen</span></span></span></article>
</div>
<nav class="sz-tabs"><span class="on">Bald</span><span>Listen</span><span class="plus">+</span><span>Ideen</span><span>Profil</span></nav>`;

export interface Phone {
  phone: HTMLDivElement;
  host: HTMLDivElement;
}

/** The Start screen; the stage host spans from the screen top to 16 px below the first card's top edge. */
export function startPhone(parent: HTMLElement, dark: boolean): Phone {
  const phone = el('div', `sz-phone${dark ? ' dark' : ''}`, FEED);
  const host = el('div', 'sz-host');
  phone.append(host);
  parent.append(phone);
  const card = phone.querySelector<HTMLElement>('[data-first]');
  const pr = phone.getBoundingClientRect();
  const cr = card?.getBoundingClientRect();
  // jsdom has no layout: the measured layout of a 390 px phone
  const top = cr && cr.height > 0 ? cr.top - pr.top : 230;
  const left = cr && cr.width > 0 ? cr.left - pr.left : 16;
  const width = cr && cr.width > 0 ? cr.width : 358;
  host.style.left = `${left}px`;
  host.style.width = `${width}px`;
  host.style.height = `${Math.round(top) + 16}px`;
  return { phone, host };
}

function choice<T extends string>(label: string, options: ReadonlyArray<readonly [T, string]>, value: T, onPick: (v: T) => void): HTMLElement {
  const box = el('div');
  box.append(el('h3', undefined, label));
  const row = el('div', 'row');
  const buttons: HTMLButtonElement[] = [];
  for (const [v, text] of options) {
    const b = el('button', 'btn small', text);
    b.type = 'button';
    b.classList.toggle('on', v === value);
    b.addEventListener('click', () => {
      buttons.forEach((x) => x.classList.toggle('on', x === b));
      onPick(v);
    });
    buttons.push(b);
    row.append(b);
  }
  box.append(row);
  return box;
}

function markReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset.ready = '1')));
}

export function seasonsGallery(app: HTMLElement, q: URLSearchParams): void {
  if (!document.getElementById('sz-css')) {
    const style = el('style');
    style.id = 'sz-css';
    style.textContent = CSS;
    document.head.append(style);
  }
  let season: Season = q.get('season') === 'winter' ? 'winter' : 'autumn';
  let end: SeasonEnd = q.get('end') === 'stay' ? 'stay' : 'duck';
  let reduced = q.get('reduced') === '1';
  let dark = q.get('theme') === 'dark';
  const frozen = q.has('t') ? Number(q.get('t')) || 0 : null;
  const onlyPhone = q.get('view') === 'phone';

  const page = el('section', 'sz-page');
  app.append(page);
  if (!onlyPhone) {
    page.append(el('h2', undefined, 'Листопад и Снегопад — сезон без костюма (v2)'));
    page.append(el('p', 'sz-lead', 'Только галерея. Start, первая карточка ленты: Помпон выглядывает из-за её края (одобренный подъём лапками). Осенью падает несколько листьев (остролистный клён и дуб, близкие и далёкие), один ложится ему на лоб. Зимой идёт лёгкий снег, одна снежинка садится на нос — он косится на неё и чихает. Заменяет утренний «hop-across» раз в день. При «меньше движения» не играет ничего — это украшение.'));
  }
  const main = el('div', 'sz-main');
  page.append(main);
  const phoneBox = el('div');
  main.append(phoneBox);
  const scenes: SeasonScene[] = [];
  let scene: SeasonScene | null = null;

  const controls = el('div', 'sz-controls');
  const scrub = el('div', 'sz-scrub');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.step = '0.01';
  const timeOut = el('span', undefined, '0.00 s');
  scrub.append('Кадр', range, timeOut);
  const replay = el('button', 'btn', '▶ Показать снова');
  replay.type = 'button';
  const note = el('p');

  const showTime = () => {
    if (!scene) return;
    const t = scene.time;
    timeOut.textContent = `${t.toFixed(2)} / ${scene.duration.toFixed(2)} s`;
    range.value = String(Math.min(t, scene.duration));
  };
  const tick = () => {
    showTime();
    if (scene?.playing) requestAnimationFrame(tick);
  };

  const build = (at: number | null) => {
    if (scene) {
      scene.destroy();
      scenes.splice(scenes.indexOf(scene), 1);
    }
    phoneBox.textContent = '';
    const { phone, host } = startPhone(phoneBox, dark);
    scene = new SeasonScene(host, { season, end, reducedMotion: reduced ? 'force' : 'off' });
    scenes.push(scene);
    if (scene.off) {
      phone.append(el('div', 'sz-caption', 'Меньше движения: ничего не играет (это украшение)'));
      note.textContent = 'Меньше движения: Помпона и листьев / снега нет — как у всех украшений в приложении.';
    } else {
      note.textContent = season === 'autumn'
        ? 'Осень: далёкие листья (дуб, жёлтый и оранжевый клён) медленно летят за Помпоном и уходят за карточку, каждый раз переворачивается. Ближний кленовый лист падает маятником и поворачивается, как тонкая пластинка: виден в ракурсе, один раз показывает светлую изнанку. Ложится на лоб; Помпон дважды моргает, наклоняется на 5°, лист соскальзывает по уху и щеке за край карточки. Помпон смотрит на тебя и прячется.'
        : 'Зима: лёгкий снегопад (далёкие мягкие точки, маленькие звёздочки, одна близкая). Большая мягкая снежинка садится на нос; Помпон косится на неё (глаза к носу), нос шевелится, «а… а…» (жмурится, ротик открыт) — «апчхи!»: кивок, глаза закрыты, три облачка, снежинку сдувает вверх, и она тает в воздухе. Смотрит на тебя и прячется.';
    }
    range.max = String(scene.duration);
    (window as unknown as { seasons: SeasonScene }).seasons = scene;
    if (at !== null) {
      scene.seek(at);
      showTime();
    } else {
      scene.play();
      requestAnimationFrame(tick);
    }
  };

  replay.addEventListener('click', () => build(null));
  range.addEventListener('input', () => {
    scene?.seek(Number(range.value));
    showTime();
  });
  controls.append(
    choice<Season>('Сезон', [['autumn', 'Осень — листопад'], ['winter', 'Зима — снегопад']], season, (v) => { season = v; build(null); }),
    choice<SeasonEnd>('В конце', [['duck', 'прячется (Start)'], ['stay', 'остаётся']], end, (v) => { end = v; build(null); }),
    choice<'full' | 'reduce'>('Движение', [['full', 'полное'], ['reduce', 'меньше движения']], reduced ? 'reduce' : 'full', (v) => { reduced = v === 'reduce'; build(null); }),
    choice<'light' | 'dark'>('Тема', [['light', 'светлая'], ['dark', 'тёмная']], dark ? 'dark' : 'light', (v) => { dark = v === 'dark'; build(null); }),
  );
  const row = el('div', 'row');
  row.append(replay);
  controls.append(row, scrub, note);
  if (!onlyPhone) main.append(controls);
  build(frozen);

  // contact sheet: frozen 1:1 crops of the whole scene (screen top to below the card edge) — nothing may ever be
  // cut by anything but the card edge
  const frames = Math.max(0, Math.min(40, Math.round(Number(q.get('frames') ?? 16))));
  if (!onlyPhone && q.get('contact') !== '0' && frames > 0 && !reduced) {
    const probe = scene as SeasonScene | null;
    const duration = probe?.duration ?? 4;
    const t0 = Math.max(0, Number(q.get('t0') ?? 0) || 0);
    const t1 = Math.max(t0, Number(q.get('t1') ?? duration) || duration);
    page.append(el('h3', 'sz-sheet-title', `Контактный лист · ${frames} кадров · ${t0.toFixed(2)}–${t1.toFixed(2)} s · 1:1`));
    const grid = el('div', 'sz-sheet');
    const cropW = 390;
    const cropH = 272;
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${cropW}px, 1fr))`;
    page.append(grid);
    for (let i = 0; i < frames; i++) {
      const t = frames === 1 ? t0 : t0 + ((t1 - t0) * i) / (frames - 1);
      const cell = el('div', 'sz-cell');
      const crop = el('div', 'sz-crop');
      crop.style.width = `${cropW}px`;
      crop.style.height = `${cropH}px`;
      cell.append(crop, el('small', undefined, `t = ${t.toFixed(2)} s`));
      grid.append(cell);
      const inner = el('div');
      inner.style.cssText = 'position: absolute; left: 0; top: 0';
      crop.append(inner);
      const { phone, host } = startPhone(inner, dark);
      phone.style.borderRadius = '0';
      phone.style.boxShadow = 'none';
      const s = new SeasonScene(host, { season, end, reducedMotion: 'off' });
      s.seek(t);
      scenes.push(s);
    }
  }
  window.addEventListener('pagehide', () => scenes.forEach((s) => s.destroy()), { once: true });
  markReady();
}
