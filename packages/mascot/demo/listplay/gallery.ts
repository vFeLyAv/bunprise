/**
 * «Помпон в открытом списке» (Felix 31.10: «надо добавить ещё анимаций разных, также каких-то взаимодействий с
 * кроликом в листах») — the prototype on the mascot gallery (5180). Approved 31.10 («Мне все анимации нравятся») and in
 * the app since: Pompon's rig, player and moments live in src/listplay/ (@bunprise/mascot/listplay); this page keeps
 * its phone mock (the list's own tiles in the same timelines). Design note: docs/design/2026-10-31-list-play.md; the
 * app: docs/handoffs/2026-10-31-list-play-in-app.md.
 *
 *   ?screens=listplay                       three phones: A (in the header), B (corner above the tab bar), the empty list
 *     &place=a|b|empty                      one phone only
 *     &play=stroke|boop|pull|dizzy|wish|received|delete|select|relax|move|end|bounce|pop   play it on load …
 *     &t=1.2                                … or freeze it at that second (the same frame every time)
 *     &theme=dark  &reduced=1  &live=0      paper at night · «Weniger Bewegung» · the mock ignores gestures
 *   ?screens=listplay&view=sheet&play=wish [&place=a|b] [&frames=8] [&zoom=2]   key frames of one moment, side by side
 */

import { setBunnyFur } from '../../src/fur';
import { createShakeDetector } from '../../src/listplay/shake';
import { MOCK_CSS, rectIn, type Place, type Theme } from './mock';
import { FEET } from './rig';
import { Arbiter, ListPlay, PLAYABLE, type Playable } from './stage';

const CSS = `${MOCK_CSS}
.app.lpg-page { max-width: none; padding: 20px 16px 48px; }
.lpg { max-width: 1480px; margin: 0 auto; }
.lpg h2 { margin: 6px 6px 4px; font-size: 26px; letter-spacing: -.02em; }
.lpg h3 { margin: 28px 6px 10px; font-size: 18px; }
.lpg > p, .lpg .note { margin: 0 6px 12px; max-width: 1000px; color: var(--text-2); font-size: 14px; line-height: 1.5; }
.lpg-bar { position: sticky; top: 0; z-index: 30; display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; padding: 10px 12px; margin: 6px 0 18px;
  border-radius: 20px; background: var(--card); border: 1px solid var(--card-border); box-shadow: var(--shadow-card); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
  font-size: 13px; color: var(--text-2); }
.lpg-bar button, .lpg-bar select, .lpg-moves button { appearance: none; border: 0; border-radius: 999px; padding: 9px 13px; min-height: 38px; font: 600 13px/1 inherit; background: var(--tile); color: var(--text); cursor: pointer; }
.lpg-bar button.on { box-shadow: inset 0 0 0 1.5px var(--accent-ui); background: color-mix(in srgb, var(--accent-ui) 18%, transparent); }
.lpg-bar button:active, .lpg-moves button:active { transform: scale(.95); }
.lpg-bar label { display: inline-flex; align-items: center; gap: 6px; }
.lpg-bar input[type=range] { width: 220px; accent-color: var(--accent-ui); }
.lpg-bar .time { min-width: 92px; font-variant-numeric: tabular-nums; color: var(--text); }
.lpg-phones { display: flex; flex-wrap: wrap; gap: 30px 34px; align-items: flex-start; justify-content: center; }
.lpg-cell { display: flex; flex-direction: column; gap: 12px; width: 390px; }
.lpg-cap { font-size: 13px; line-height: 1.45; color: var(--text-2); padding: 0 6px; min-height: 76px; }
.lpg-cap b { color: var(--text); font-size: 15px; }
.lpg-cap .rec { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; background: rgba(240,160,75,.2); color: var(--text); font-weight: 700; font-size: 12px; }
.lpg-moves { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px 14px; margin: 0 0 8px; }
.lpg-move { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 18px; background: var(--card); border: 1px solid var(--card-border); }
.lpg-move button { flex: none; min-width: 44px; }
.lpg-move div { font-size: 13px; line-height: 1.45; color: var(--text-2); }
.lpg-move b { color: var(--text); }
.lpg-move a { color: inherit; font-size: 12px; }
.lpg-log { margin: 8px 6px; padding: 10px 14px; border-radius: 16px; background: var(--tile); font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--text-2); min-height: 60px; max-width: 1000px; }
.lpg-rules { margin: 0 6px; max-width: 1000px; font-size: 14px; line-height: 1.55; }
.lpg-rules li { margin: 3px 0; }
/* key frames */
.lps-grid { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.lps-cell { display: flex; flex-direction: column; gap: 6px; }
.lps-win { position: relative; overflow: hidden; border-radius: 18px; box-shadow: 0 0 0 1px rgba(60,40,20,.14); background: #000; }
.lps-phone { position: absolute; left: 0; top: 0; }
.lps-phone .lpp { box-shadow: none; border-radius: 0; }
.lps-cell small { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; padding-left: 4px; }
.lps-cell small b { color: var(--text); }
`;

/** One line per moment for Felix (Russian; the mock's own texts are German like the app). */
const MOMENTS: Readonly<Record<Playable, [string, string]>> = {
  stroke: ['Погладить', 'потри по нему пальцем или мышкой (можно просто водить курсором): прижимается к руке, глаза ^ ^, румянец, тихое «мурр» — стук зубками, штрихи у щеки, 1–2 сердечка; руку убрал — довольный вздох'],
  boop: ['Тык в нос', 'коснись его: нос сплющился и быстро шевелится, ушки вверх, круглые глаза — и хихикает. 5 касаний за 2,5 с — сердится (одобренная сцена с 💢)'],
  pull: ['Потянуть за ушко', 'зажми кончик уха и тяни: ушко поворачивается и чуть вытягивается целиком (мягкий предел, форма не меняется), лицо «ай» > <; отпустил — пружинит назад, хихикает, встряхивается. Слишком сильно — само выскользнет'],
  dizzy: ['Встряхнуть телефон', 'голова кругом: глаза-спиральки, звёздочки вокруг головы, мягко покачивается — потом встряхивается и стоит ровно (на телефоне — датчик движения, не чаще раза в 10 с)'],
  wish: ['Новое желание', '«+ Wunsch»: новая карточка падает в сетку, он прыгает к ней, двумя лапками прихлопывает её «на место», гордый подскок, обратно'],
  received: ['Erhalten', 'прыгает на карточку, ставит лапкой печать ✓, мини-бинки, обратно; карточка уходит в «Erhalten (2)»'],
  delete: ['Удалить', 'карточка сжимается и исчезает, он машет «пока», остальные закрывают дырку, он отряхивает лапки'],
  select: ['Режим выбора', 'долгое нажатие на карточку: карточки дрожат — он вздрагивает, держится за ушки, немного дрожит вместе с ними и так и сидит'],
  relax: ['Fertig', 'выход из выбора: отпускает ушки, облегчённо выдыхает'],
  move: ['Verschieben', 'выбранные карточки улетают к краю, он скачет за ними, смотрит вслед (ушко вверх), машет и возвращается'],
  end: ['Конец списка', 'долистал до конца — он сидит под последним рядом: смотрит вверх, на тебя, машет: «Das war’s!»'],
  bounce: ['Пружинка', 'в самом конце тянешь ещё (колесо мыши / палец): крошечный подскок'],
  peek: ['Пустой список: в коробке', 'он сидит в закрытой подарочной коробке; иногда (и если коснуться коробки) крышка приоткрывается — в щёлке глаза и кончики ушей, смотрит туда-сюда, моргает, прячется, крышка падает обратно'],
  pop: ['Пустой список: «+»', 'коробка пару раз качнётся изнутри, толчок — он головой выбивает крышку (она отлетает с поворотом и ложится рядом на пол) и выпрыгивает, приземляется рядом; звёздочки в глазах — один раз']
};

const PLACES: ReadonlyArray<[Place, string, string]> = [
  ['a', 'A · в шапке, рядом со значком списка', 'Сидит справа в ряду значка и даты: открыл список — он тут. Ни на тексте, ни на кнопках (⋯ — выше, «+ Wunsch» — ниже). Уезжает вверх вместе с шапкой; в конце списка ты находишь его внизу.'],
  ['b', 'B · в углу над вкладками', 'Всегда внизу справа. Чтобы не закрывать карточки, он прячется за панель вкладок, пока под ним что-то есть, и выходит, где свободно (здесь список уже долистан до конца). Прокрути вверх — увидишь.'],
  ['empty', 'Пустой список', 'Вместо спящего хомяка — Помпон в закрытой подарочной коробке: иногда приоткрывает крышку и выглядывает (коснись коробки). Большой «+» — выбивает крышку и выпрыгивает.'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const ready = () => requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset.ready = '1')));

function isPlayable(v: string | null): v is Playable {
  return (PLAYABLE as readonly string[]).includes(v ?? '');
}

/** Small moments read better bigger in the key frames. */
const SMALL: ReadonlySet<Playable> = new Set(['stroke', 'boop', 'pull', 'dizzy', 'bounce', 'end', 'select', 'relax', 'peek', 'pop']);
/** The moments of the empty list play on its own phone. */
const onEmpty = (m: Playable) => m === 'pop' || m === 'peek';

export function listPlayGallery(app: HTMLElement, q: URLSearchParams): void {
  // Pompon's fluffy cheeks, exactly as the app switches them on (apps/web/src/features/mascot-ui/pompon.ts) — only on this page
  setBunnyFur({ fawn: ['cheeks'] });
  app.className = 'app lpg-page';
  const style = el('style');
  style.textContent = CSS;
  document.head.append(style);
  const theme: Theme = q.get('theme') === 'dark' ? 'dark' : 'light';
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  if (q.get('view') === 'sheet') sheet(app, q, theme);
  else page(app, q, theme);
}

// ------------------------------------------------------------------------------------------------ the page

function page(app: HTMLElement, q: URLSearchParams, theme0: Theme): void {
  const section = el('section', 'lpg');
  app.append(section);
  section.append(el('h2', undefined, 'Помпон в открытом списке — 31.10 (только галерея)'));
  const intro = el('p');
  intro.innerHTML = 'Все идеи на одном макете открытого вишлиста (как в приложении: шапка, сетка карточек, «+ Wunsch», вкладки). <b>Живой режим</b> — трогай Помпона и список по-настоящему. <b>▶</b> играет момент (серый кружок показывает палец), ползунок и <code>&amp;t=</code> — замороженный кадр. Помпон — 96 px, как в приложении, с пушистыми щёчками.';
  section.append(intro);

  const st = {
    theme: theme0,
    still: q.get('reduced') === '1',
    live: q.get('live') !== '0',
    target: (q.get('place') === 'b' ? 'b' : 'a') as Place,
  };
  const only = q.get('place') as Place | null;
  const arbiter = new Arbiter();
  let stages: ListPlay[] = [];
  const logLines: string[] = [];
  const logBox = el('div', 'lpg-log');
  const log = (t: string) => {
    logLines.unshift(`${new Date().toLocaleTimeString('de-DE')}  ${t}`);
    logLines.length = Math.min(logLines.length, 12);
    logBox.textContent = logLines.join('\n');
    logBox.style.whiteSpace = 'pre';
  };

  // ---- the bar
  const bar = el('div', 'lpg-bar');
  const btn = (text: string, fn: () => void, on?: boolean) => {
    const b = el('button', on ? 'on' : undefined, text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };
  const themeBtn = btn(st.theme === 'dark' ? 'Тема: тёмная' : 'Тема: светлая', () => {
    st.theme = st.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = st.theme;
    themeBtn.textContent = st.theme === 'dark' ? 'Тема: тёмная' : 'Тема: светлая';
    build();
  });
  const stillBtn = btn('Weniger Bewegung', () => {
    st.still = !st.still;
    stillBtn.classList.toggle('on', st.still);
    for (const s of stages) s.setStill(st.still);
  }, st.still);
  const liveBtn = btn('Живой режим', () => {
    st.live = !st.live;
    liveBtn.classList.toggle('on', st.live);
    for (const s of stages) s.setLive(st.live);
  }, st.live);
  const shakeBtn = btn('Schütteln', () => shakeNow(true));
  const resetBtn = btn('Сбросить', () => build());
  const targetSel = el('select');
  for (const [v, t] of [['a', 'кнопки ▶ → телефон A'], ['b', 'кнопки ▶ → телефон B']] as const) {
    const o = el('option', undefined, t);
    o.value = v;
    o.selected = v === st.target;
    targetSel.append(o);
  }
  targetSel.addEventListener('change', () => (st.target = targetSel.value as Place));
  bar.append(themeBtn, stillBtn, liveBtn, shakeBtn, resetBtn, targetSel);

  // iOS: motion events need the person's OK, asked from a tap
  type Perm = { requestPermission?: () => Promise<'granted' | 'denied'> };
  const DM = (typeof DeviceMotionEvent === 'function' ? DeviceMotionEvent : undefined) as unknown as Perm | undefined;
  if (DM && typeof DM.requestPermission === 'function') {
    const allow = btn('Bewegung erlauben', () => {
      void DM.requestPermission?.().then((r) => {
        log(`devicemotion: ${r}`);
        if (r === 'granted') {
          listenMotion();
          allow.remove();
        }
      }).catch(() => log('devicemotion: abgelehnt'));
    });
    bar.append(allow);
  } else if (navigator.maxTouchPoints > 0) listenMotion(); // a phone or tablet (desktop browsers only warn about the sensor)

  // the scrubber: freeze one moment on one phone
  const scrubSel = el('select');
  for (const m of PLAYABLE) {
    const o = el('option', undefined, `кадр: ${MOMENTS[m][0]}`);
    o.value = m;
    scrubSel.append(o);
  }
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.step = '0.01';
  range.value = '0';
  const time = el('span', 'time', '—');
  const scrubLabel = el('label');
  scrubLabel.append(scrubSel, range, time);
  bar.append(scrubLabel);
  section.append(bar);

  const phones = el('div', 'lpg-phones');
  section.append(phones);

  section.append(el('h3', undefined, 'Взаимодействия (▶ играет на выбранном телефоне; «кадры» — ключевые кадры рядом)'));
  const moves = el('div', 'lpg-moves');
  for (const m of PLAYABLE) {
    const row = el('div', 'lpg-move');
    const play = btn('▶', () => {
      const s = onEmpty(m) ? stages.find((x) => x.place === 'empty') : stages.find((x) => x.place === st.target) ?? stages[0];
      s?.playButton(m);
    });
    play.setAttribute('aria-label', `${MOMENTS[m][0]} abspielen`);
    const text = el('div');
    const sheetPlace = onEmpty(m) ? 'empty' : 'a';
    text.innerHTML = `<b>${MOMENTS[m][0]}</b> — ${MOMENTS[m][1]} · <a href="?screens=listplay&view=sheet&play=${m}&place=${sheetPlace}${st.theme === 'dark' ? '&theme=dark' : ''}">кадры</a>`;
    row.append(play, text);
    moves.append(row);
  }
  section.append(moves);
  section.append(el('h3', undefined, 'Что происходит (вибрация — только запись: в приложении её делает обёртка lib/haptics)'));
  section.append(logBox);
  const rules = el('div', 'lpg-rules');
  rules.innerHTML = `<h3>Правила, которые соблюдены</h3><ul>
    <li><b>Тайна брони.</b> В своём списке ничего не зависит от брони: Помпон реагирует только на твои собственные действия (добавил, получил, удалил, выбрал, долистал, потрогал). Текст под заголовком всегда один и тот же.</li>
    <li><b>Не закрывает</b> текст и кнопки: в покое A сидит на пустом месте шапки, B прячется, пока под ним карточки. Ловит палец только его тело (52 × 58 px), а не вся коробка. Во время момента он стоит только на <i>той</i> карточке, с которой что-то делает.</li>
    <li><b>Один маскот за раз:</b> пока играет один телефон, Помпоны на других замирают и ничего не играют.</li>
    <li><b>Пауза</b>, если вкладка скрыта или телефон вне экрана; потом — с того же кадра. Всё конечное, только transform / opacity, каждый момент — одна шкала (seek).</li>
    <li><b>Weniger Bewegung:</b> Помпон не двигается вообще (спокойные глаза ^ ^); список меняется, но только плавным появлением / исчезновением.</li>
    <li><b>Ушко и встряхивание</b> — для любого места в приложении, не только для списков (здесь просто показаны на макете).</li></ul>`;
  section.append(rules);

  // ---- phones
  function build(): void {
    for (const s of stages) s.destroy();
    stages = [];
    phones.textContent = '';
    for (const [place, title, note] of PLACES) {
      if (only && only !== place) continue;
      const cell = el('div', 'lpg-cell');
      const cap = el('div', 'lpg-cap');
      cap.innerHTML = `<b>${title}</b>${place === 'a' ? '<span class="rec">рекомендую</span>' : ''}<br>${note}`;
      cell.append(cap);
      phones.append(cell);
      stages.push(new ListPlay(cell, { place, theme: st.theme, still: st.still, live: st.live, arbiter, log }));
    }
    (window as unknown as { listplay: unknown }).listplay = { stages, arbiter };
  }
  build();

  // ---- the scrubber
  let scrubStage: ListPlay | null = null;
  const scrub = () => {
    const m = scrubSel.value as Playable;
    if (!scrubStage) {
      const place: Place = onEmpty(m) ? 'empty' : st.target;
      const old = stages.find((s) => s.place === place);
      const cell = old?.refs.phone.parentElement;
      if (!old || !cell) return;
      old.destroy();
      scrubStage = new ListPlay(cell, { place, theme: st.theme, still: false, live: false, arbiter, log });
      stages = stages.map((s) => (s === old ? (scrubStage as ListPlay) : s));
      (window as unknown as { listplay: unknown }).listplay = { stages, arbiter };
    }
    const shot = scrubStage.freeze(m, Number(range.value));
    if (shot) {
      range.max = String(shot.duration);
      time.textContent = `${Number(range.value).toFixed(2)} / ${shot.duration.toFixed(2)} с`;
    }
  };
  range.addEventListener('input', scrub);
  scrubSel.addEventListener('change', () => {
    range.value = '0';
    scrubStage = null;
    build();
    scrub();
  });

  // ---- the shake (devicemotion: a deliberate shake — three hard peaks within 0.7 s; at most every 10 s). The rule is
  // the package's (src/listplay/shake.ts): the app feeds the same detector.
  function shakeNow(simulated: boolean): void {
    const s = stages.find((x) => x.place === st.target) ?? stages[0];
    log(simulated ? '· Schütteln (кнопка)' : '· телефон встряхнули');
    s?.shake(simulated);
  }
  function listenMotion(): void {
    const detector = createShakeDetector();
    window.addEventListener('devicemotion', (e) => {
      if (detector.feed(e, performance.now())) shakeNow(false);
    });
  }

  // ---- URL: &play= (on load) / &t= (frozen)
  const play = q.get('play');
  if (isPlayable(play)) {
    const tq = q.get('t');
    if (tq !== null) {
      scrubSel.value = play;
      range.value = tq;
      scrub();
    } else {
      window.setTimeout(() => {
        const s = onEmpty(play) ? stages.find((x) => x.place === 'empty') : stages.find((x) => x.place === st.target) ?? stages[0];
        s?.playButton(play);
      }, 600);
    }
  }
  ready();
}

// ------------------------------------------------------------------------------------------------ key frames

function sheet(app: HTMLElement, q: URLSearchParams, theme: Theme): void {
  const name = q.get('play');
  const m: Playable = isPlayable(name) ? name : 'stroke';
  const place: Place = onEmpty(m) ? 'empty' : q.get('place') === 'b' ? 'b' : 'a';
  const still = q.get('reduced') === '1';
  const section = el('section', 'lpg');
  app.append(section);
  section.append(el('h2', undefined, `${MOMENTS[m][0]} — ключевые кадры (${place.toUpperCase()}${theme === 'dark' ? ', тёмная' : ''})`));
  section.append(el('p', undefined, MOMENTS[m][1]));
  const grid = el('div', 'lps-grid');
  section.append(grid);
  const arbiter = new Arbiter();
  const nop = () => undefined;

  // the beats of the moment (from a first, throw-away build)
  const probeCell = el('div', 'lps-cell');
  grid.append(probeCell);
  const probe = new ListPlay(probeCell, { place, theme, still, live: false, arbiter, log: nop });
  const first = probe.freeze(m, 0);
  const duration = first?.duration ?? 1;
  const n = Number(q.get('frames'));
  let times: Array<[number, string]>;
  if (Number.isFinite(n) && n > 1) times = Array.from({ length: n }, (_, i) => [(duration * i) / (n - 1), ''] as [number, string]);
  else {
    const beats = Object.entries(first?.beats ?? {}).map(([k, v]): [number, string] => [v, k]).sort((a, b) => a[0] - b[0]);
    const all: Array<[number, string]> = [[0, 'start'], ...beats];
    times = all.filter((x, i) => i === 0 || x[0] - (all[i - 1]?.[0] ?? -1) > 0.04).slice(0, 9);
  }
  probe.destroy();
  probeCell.remove();

  const zoom = Number(q.get('zoom')) || (SMALL.has(m) || q.get('crop') === 'pompon' ? 2.4 : 1);
  for (const [t, label] of times) {
    const cell = el('div', 'lps-cell');
    // holder > window > phone, built BEFORE the phone: moving a scrolled phone in the DOM resets its scroll position
    const holder = el('div');
    holder.style.cssText = 'position:relative;flex:none;width:390px;height:800px;';
    const win = el('div', 'lps-win');
    win.style.cssText = 'position:absolute;left:0;top:0;width:390px;height:800px;transform-origin:0 0;';
    const inner = el('div', 'lps-phone');
    win.append(inner);
    holder.append(win);
    cell.append(holder);
    grid.append(cell);
    const s = new ListPlay(inner, { place, theme, still, live: false, arbiter, log: nop });
    const shot = s.freeze(m, t);
    // the window: around where it happens (the focus is in px of his layer)
    let f = { ...(shot?.focus ?? { x: 0, y: 0, w: 390, h: 800 }) };
    const scroll = place === 'b' ? 0 : s.refs.screen.scrollTop;
    if (q.get('crop') === 'pompon') {
      // &crop=pompon: a close-up around wherever Pompon stands at this second (his box, as animated now)
      const br = rectIn(s.rig.box, s.refs.layer);
      f = { x: br.x + FEET.x - 60, y: br.y + FEET.y - 80, w: 120, h: 86 };
    }
    const small = SMALL.has(m) || q.get('crop') === 'pompon';
    const pad = small ? 22 : 40;
    const h = Math.round(Math.min(800, Math.max(small ? 136 : 260, f.h + pad * 2 + (small ? 24 : 30))));
    const top = Math.round(Math.max(0, Math.min(800 - h, f.y - scroll - pad - (small ? 24 : 30))));
    const w = Math.round(Math.min(390, Math.max(small ? 170 : 390, f.w + pad * 2 + 40)));
    const left = Math.round(Math.max(0, Math.min(390 - w, f.x + f.w / 2 - w / 2)));
    win.style.width = `${w}px`;
    win.style.height = `${h}px`;
    inner.style.left = `${-left}px`;
    inner.style.top = `${-top}px`;
    // bigger with a transform (CSS zoom moved the phone's scroll position in Firefox)
    holder.style.width = `${w * zoom}px`;
    holder.style.height = `${h * zoom}px`;
    if (zoom !== 1) win.style.transform = `scale(${zoom})`;
    const caption = el('small');
    caption.innerHTML = `<b>t = ${t.toFixed(2)} с</b>${label ? ` · ${label}` : ''}`;
    cell.append(caption);
  }
  ready();
}
