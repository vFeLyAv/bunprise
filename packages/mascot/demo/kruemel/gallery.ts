/**
 * Gallery page «Krümel» v2 — Pompon's little brother, a baby lop rabbit (ideas doc 2026-10-26 §2.1 / top-5
 * item 5). GALLERY-ONLY prototype on the mascot gallery (5180); the app gets him only after Felix's OK (and
 * his name is Felix's). v1 is archived in _codex_handoffs/archive-20261026/kruemel-v1.
 *
 *   ?screens=kruemel [&coat=fawn|choc|himalayan|broken] [&theme=light|dark] [&reduced=1]
 *   &t=1.2        freeze the card peek AND both moments at 1.2 s (each clamped to its length; deterministic: seek)
 *   &frames=12    contact sheets (peek + moments), &contact=0 = none (not "sheet": main.ts reserves it)
 *
 * Sections: next to Pompon · his two moments («Плюх», «Апчхи») · on the "Erste Schritte" card at real app size,
 * light and dark, next to Pompon · coats · before / after ("Krümel ist gewachsen": lop ears, NO animated change).
 * Design note for Felix: docs/design/2026-10-26-kruemel.md.
 */

import { Bunny, COATS, WelcomeStage, welcomeSteps, type BunnyCoat, type ReducedMotionMode } from '../../src/index';
import type { Compiled, LoopTrack, Playhead, Track } from '../../src/timeline';
import { applyKit, type KitEars } from './kit';
import { KIT_MOMENTS, startMoment, type KitMoment } from './moments';

/** Krümel's size against Pompon's: a baby (airplane ears) and a few weeks older (lop ears). */
export const KIT_SCALE = { upright: 0.62, lop: 0.72 } as const;
/** On the "Erste Schritte" card (where Pompon is 96 px wide) he peeks this much smaller. */
export const KIT_PEEK_SCALE = 0.72;
/** His baby ears answer the stage's lop-ear physics with this much of its swing (shorter, stiffer). */
export const KIT_EAR_SWING = 0.7;
/** Pompon's size in the comparisons (the app's "xl"); Krümel is KIT_SCALE of it. */
const BASE = 320;
/** A still Krümel this big is as big as he peeks on the card (Pompon there ≈ 0.59 px per unit, × 0.72). */
const CARD_SIZE = 141;
/** Coats for him: Pompon's, without blue (Felix: no blue / violet coats). */
export const KIT_COATS: readonly BunnyCoat[] = ['fawn', 'choc', 'himalayan', 'broken'];
type Theme = 'light' | 'dark';

const CSS = `
.kr-page { max-width: 1100px; margin: 0 auto; padding: 8px 16px 48px; box-sizing: border-box; color: var(--text); }
.kr-page h2 { margin: 6px 0 4px; font-size: 24px; letter-spacing: -.02em; }
.kr-page h3 { margin: 26px 0 6px; font-size: 18px; }
.kr-lead, .kr-note { margin: 0 0 12px; color: var(--text-2); font-size: 14px; line-height: 1.45; max-width: 780px; }
.kr-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 10px 0 4px; }
.kr-controls .row { margin: 0; justify-content: flex-start; }
.kr-paper { --mascot-shadow: rgba(70,40,15,.20); --mascot-outline: rgba(224,171,116,.5); --kr-ink: #2A231C; --kr-ink-2: #62554A;
  background: radial-gradient(70% 60% at 0% 0%, rgba(255,193,146,.45), transparent 70%), radial-gradient(60% 60% at 100% 30%, rgba(248,180,170,.35), transparent 70%), linear-gradient(#F7F0E5, #F0E6D6);
  border-radius: 28px; padding: 18px 20px; color: var(--kr-ink); box-shadow: inset 0 0 0 1px rgba(255,255,255,.7), 0 12px 30px -16px rgba(92,56,24,.3); }
.kr-paper.dark { --mascot-shadow: rgba(0,0,0,.42); --mascot-outline: rgba(255,214,170,.2); --kr-ink: #F5EDE3; --kr-ink-2: #C3B5A6;
  background: radial-gradient(70% 60% at 0% 0%, rgba(255,150,84,.13), transparent 70%), radial-gradient(60% 60% at 100% 30%, rgba(232,118,124,.10), transparent 70%), linear-gradient(#1C1612, #15100D);
  box-shadow: inset 0 0 0 1px rgba(255,236,214,.075), 0 12px 30px -16px rgba(0,0,0,.6); }
.kr-row { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: center; gap: 28px; }
.kr-fig { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 13px; color: var(--kr-ink-2); text-align: center; }
.kr-fig b { color: var(--kr-ink); font-size: 14px; }
.kr-floor { border-bottom: 2px solid rgba(116,84,44,.18); line-height: 0; }
.dark .kr-floor { border-bottom-color: rgba(255,230,205,.13); }
.kr-arrow { align-self: center; font-size: 13px; color: var(--kr-ink-2); text-align: center; max-width: 140px; }
.kr-moments { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 16px; }
.kr-moment { display: flex; flex-direction: column; gap: 10px; }
.kr-moment .kr-row { gap: 18px; min-height: 230px; }
.kr-moment p { margin: 0; font-size: 13px; line-height: 1.4; color: var(--kr-ink-2); }
.kr-moment p b { color: var(--kr-ink); }
.kr-cards { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.kr-cardbox { width: 358px; display: flex; flex-direction: column; gap: 8px; }
.kr-cardbox > small { font-size: 13px; color: var(--text-2); }
.kr-screen { position: relative; padding: 96px 0 0; }
.kr-fs { position: relative; z-index: 2; border-radius: 28px; padding: 16px; color: #2A231C;
  background-color: rgba(255,252,246,.62); background-image: linear-gradient(180deg, rgba(255,255,255,.5) 0%, transparent 42%);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.62), inset 0 1px 0 rgba(255,255,255,.95), 0 1px 2px rgba(80,50,22,.05), 0 12px 30px -14px rgba(92,56,24,.26); }
.dark .kr-fs { color: #F5EDE3; background-color: rgba(46,37,31,.72); background-image: linear-gradient(180deg, rgba(255,236,214,.05) 0%, transparent 42%);
  box-shadow: inset 0 0 0 1px rgba(255,236,214,.075), inset 0 1px 0 rgba(255,236,214,.11), 0 1px 2px rgba(0,0,0,.3), 0 12px 30px -14px rgba(0,0,0,.55); }
.kr-fs header { display: flex; align-items: center; justify-content: space-between; }
.kr-fs header b { font-size: 22px; line-height: 28px; font-weight: 700; }
.kr-fs header i { width: 44px; height: 44px; display: grid; place-items: center; font-style: normal; color: var(--kr-ink-2); font-size: 20px; }
.kr-fs p { margin: 0; min-height: 44px; display: flex; align-items: center; padding: 0 8px; font-size: 17px; color: #783910; }
.dark .kr-fs p { color: #F2A25A; }
.kr-host { position: absolute; top: 8px; right: 48px; width: 112px; height: 104px; min-height: 0; z-index: 3; pointer-events: none; }
.kr-sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.kr-sheet.peek { grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); }
.kr-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.kr-cell small { font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.kr-cell .kr-paper { padding: 8px 6px 4px; border-radius: 14px; width: 100%; box-sizing: border-box; display: flex; justify-content: center; }
.kr-crop { position: relative; width: 232px; height: 168px; overflow: hidden; border-radius: 12px; box-shadow: 0 0 0 1px rgba(60,40,20,.14); }
.kr-zoom { position: absolute; left: 0; top: 0; width: 358px; transform: translate(-392px, -60px) scale(2); transform-origin: 0 0; }
.kr-scrub { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--kr-ink-2, var(--text-2)); font-variant-numeric: tabular-nums; }
.kr-scrub input { flex: 1; accent-color: var(--accent-ui); }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function markReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset.ready = '1')));
}

/** A still puppet (no idle loop, no CSS motion): Pompon, or Krümel with his ears. */
export function stillBunny(parent: HTMLElement, opts: { size: number; coat: BunnyCoat; kit: KitEars | null }): Bunny {
  const box = el('div', 'kr-floor');
  parent.append(box);
  const b = new Bunny(box, { size: opts.size, coat: opts.coat, ears: 'lop', idle: false, reducedMotion: 'force', interactive: false });
  b.pose('idle');
  const svg = b.root.querySelector('svg');
  if (opts.kit && svg) applyKit(svg, opts.kit);
  return b;
}

type StageInternals = { built: { actors: Array<{ tracks: Track[]; loops: LoopTrack[] }>; playhead: Playhead } | null };

/**
 * The approved `peek-once` with Krümel in it: the actor puppet gets his look; his baby ears answer the
 * stage's own ear physics (the lop-ear tracks, mirrored and a little stiffer), on the same timeline — so
 * seek(t) stays exact.
 */
export function kitStage(host: HTMLElement, opts: { coat: BunnyCoat; ears: KitEars; scale: number; reducedMotion: ReducedMotionMode }): WelcomeStage {
  const steps = welcomeSteps('peek-once').map((s) => ({ ...s, scale: opts.scale }));
  const stage = new WelcomeStage(host, { bunnies: [opts.coat], choreography: steps, edgeInset: { bottom: 16 }, minSize: 96, maxSize: 125, calmEyes: 'happy', reducedMotion: opts.reducedMotion });
  kitInto(stage, opts.ears);
  // the stage rebuilds itself for a new host size (new actor, new timeline): Krümel goes back in. This observer
  // is created after the stage's own one, so it runs after the rebuild; it ends with the stage.
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => (stage.isDestroyed ? ro.disconnect() : kitInto(stage, opts.ears)));
    ro.observe(host);
  }
  return stage;
}

/** The stage build each stage got Krümel in (kitInto is a no-op for a build that already has him). */
const kitted = new WeakMap<WelcomeStage, unknown>();

/** Puts Krümel's look into a stage's (only) actor; with baby ears they get the stage's ear motion. */
export function kitInto(stage: WelcomeStage, ears: KitEars): void {
  const built = (stage as unknown as StageInternals).built;
  if (!built || kitted.get(stage) === built) return;
  const svg = stage.root.querySelector('.actor')?.shadowRoot?.querySelector('svg');
  if (!svg) return;
  kitted.set(stage, built);
  applyKit(svg, ears);
  // the static composition (reduced motion) has no motion to answer: the ears just rest
  if (ears !== 'upright' || stage.reducedMotion) return;
  const actor = built.actors[0];
  if (!actor) return;
  // they join the stage's timeline where it is, running when it runs
  const ms = stage.time * 1000;
  const run = stage.playing && !stage.suspended;
  const target: Record<string, Element | null> = {
    'p0.earL': svg.querySelector('.up .ear-l'),
    'p0.earR': svg.querySelector('.up .ear-r'),
    'p0.earTwitch': svg.querySelector('.up .ear-r'),
  };
  const turn = (tr: unknown) => (typeof tr === 'string' ? tr.replace(/rotate\((-?[\d.]+)deg\)/, (_, d: string) => `rotate(${Math.round(-Number(d) * KIT_EAR_SWING * 1000) / 1000}deg)`) : tr);
  for (const src of [...actor.tracks, ...actor.loops]) {
    const target1 = target[src.name];
    if (!target1) continue;
    for (const c of src.compile()) {
      // `base` = the start pose the playhead writes back when it re-makes a settled animation (seek back)
      const base = c.base ? { ...c.base, ...(c.base.transform ? { transform: String(turn(c.base.transform)) } : {}) } : null;
      const mirrored: Compiled = { ...c, el: target1, name: `kit.${src.name}`, frames: c.frames.map((k) => ({ ...k, transform: turn(k.transform) as string })), base };
      if (base?.transform) (target1 as SVGElement).style.transform = base.transform;
      built.playhead.addAt(mirrored, 'kit', ms, run);
    }
  }
}

/** A still Krümel that can play / freeze one of his moments. */
class MomentPuppet {
  private anims: Animation[] = [];
  private readonly svg: SVGSVGElement | null;
  private readonly moment: KitMoment;
  constructor(parent: HTMLElement, size: number, coat: BunnyCoat, moment: KitMoment) {
    this.svg = stillBunny(parent, { size, coat, kit: 'upright' }).root.querySelector('svg');
    this.moment = moment;
  }
  private run(at: number | null): void {
    for (const a of this.anims.splice(0)) a.cancel();
    if (this.svg) this.anims = startMoment(this.svg, this.moment, at);
  }
  play(): void {
    this.run(null);
  }
  seek(t: number): void {
    this.run(t);
  }
  get time(): number {
    const t = this.anims[0]?.currentTime;
    return typeof t === 'number' ? t / 1000 : 0;
  }
  get playing(): boolean {
    return this.anims[0]?.playState === 'running';
  }
}

export function kruemelGallery(app: HTMLElement, q: URLSearchParams): void {
  if (!document.getElementById('kr-css')) {
    const style = el('style');
    style.id = 'kr-css';
    style.textContent = CSS;
    document.head.append(style);
  }
  const asked = q.get('coat') as BunnyCoat | null;
  let coat: BunnyCoat = asked && KIT_COATS.includes(asked) ? asked : 'fawn';
  let reduced = q.get('reduced') === '1';
  let theme: Theme = q.get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  const frozen = q.has('t') ? Number(q.get('t')) || 0 : null;
  const destroyers: Array<{ destroy(): void }> = [];

  const page = el('section', 'kr-page');
  app.append(page);
  page.append(
    el('h2', undefined, 'Krümel (по-русски Крошка) — младший брат Помпона · v2'),
    el('p', 'kr-lead', 'Только галерея. Вислоухий крольчонок в «самолётной» фазе: у малышей вислоухих кроликов уши сначала стоят, потом несколько недель торчат в стороны, и только потом повисают — поэтому одно ушко у него ещё стоит, а второе уже в сторону и кончик свисает. Один мягкий силуэт (большая круглая голова, маленькое тельце-груша), пушок на лбу и щеках, большие глаза, крошечные нос и рот пониже, большие задние лапки. Имя: Krümel («крошка»; в Германии так ласково зовут малышей) — другие варианты в docs/design/2026-10-26-kruemel.md.'),
  );
  const controls = el('div', 'kr-controls');
  page.append(controls);
  const body = el('div');
  page.append(body);

  const coatRow = el('div', 'row');
  const coatChips: HTMLButtonElement[] = [];
  for (const id of KIT_COATS) {
    const c = COATS.bunny.find((x) => x.id === id);
    if (!c) continue;
    const chip = el('button', 'btn chip');
    chip.type = 'button';
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', String(id === coat));
    const sw = el('i');
    sw.style.background = `linear-gradient(135deg, ${c.colors[0]} 45%, ${c.colors[3]} 46%)`;
    chip.append(sw, c.name);
    chip.addEventListener('click', () => {
      coat = id;
      coatChips.forEach((x) => x.setAttribute('aria-checked', String(x === chip)));
      render(null);
    });
    coatChips.push(chip);
    coatRow.append(chip);
  }
  const themeBtn = el('button', 'btn small');
  themeBtn.type = 'button';
  const showTheme = () => (themeBtn.textContent = theme === 'dark' ? 'Тема: тёмная' : 'Тема: светлая');
  showTheme();
  themeBtn.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    showTheme();
    render(null);
  });
  const motion = el('button', 'btn small', 'Меньше движения');
  motion.type = 'button';
  motion.classList.toggle('on', reduced);
  motion.addEventListener('click', () => {
    reduced = !reduced;
    motion.classList.toggle('on', reduced);
    render(null);
  });
  const replay = el('button', 'btn small', '▶ Всё сначала');
  replay.type = 'button';
  controls.append(coatRow, themeBtn, motion, replay);

  const paper = (shot?: string) => {
    const p = el('div', `kr-paper${theme === 'dark' ? ' dark' : ''}`);
    if (shot) p.dataset['shot'] = shot;
    return p;
  };

  function render(at: number | null): void {
    for (const d of destroyers.splice(0)) d.destroy();
    body.textContent = '';
    const frames = Math.max(0, Math.min(30, Math.round(Number(q.get('frames') ?? 10))));
    const sheets = !reduced && frames > 0 && q.get('contact') !== '0';

    // 1 — next to Pompon, real scale (Pompon at the app's "xl" size, 320: big enough to judge the details)
    body.append(el('h3', undefined, 'Рядом с Помпоном — в одном масштабе'));
    const p1 = paper('compare');
    const r1 = el('div', 'kr-row');
    p1.append(r1);
    const f1 = el('div', 'kr-fig');
    destroyers.push(stillBunny(f1, { size: BASE, coat: 'fawn', kit: null }));
    f1.append(el('b', undefined, 'Помпон'), el('span', undefined, 'размер «xl», 320 — крупно, чтобы видеть детали'));
    const f2 = el('div', 'kr-fig');
    destroyers.push(stillBunny(f2, { size: Math.round(BASE * KIT_SCALE.upright), coat, kit: 'upright' }));
    f2.append(el('b', undefined, 'Крошка'), el('span', undefined, `× ${KIT_SCALE.upright}`));
    r1.append(f1, f2);
    body.append(p1, el('p', 'kr-note', 'Та же семья: тот же окрас, тот же контур, такие же щёчки-румянец. Но другой возраст: голова больше тельца, глаза крупнее и ниже, нос и рот совсем маленькие, уши ещё «детские».'));

    // 2 — his moments
    body.append(el('h3', undefined, 'Его моменты (по ≤ 2 с, только галерея)'));
    if (reduced) body.append(el('p', 'kr-note', 'Меньше движения: моменты не играют — он просто сидит (как в приложении под «Weniger»).'));
    const grid = el('div', 'kr-moments');
    body.append(grid);
    for (const m of ['plop', 'sneeze'] as const) {
      const info = KIT_MOMENTS[m];
      const tile = paper(`moment-${m}`);
      tile.classList.add('kr-moment');
      const row = el('div', 'kr-row');
      const big = el('div', 'kr-fig');
      const small = el('div', 'kr-fig');
      row.append(big, small);
      const pBig = new MomentPuppet(big, 250, coat, m);
      const pSmall = new MomentPuppet(small, CARD_SIZE, coat, m);
      small.append(el('span', undefined, 'размер как на карточке'));
      tile.append(el('p', undefined, `<b>«${info.title}»</b> · ${info.duration.toFixed(1)} с — ${info.note}`), row);
      grid.append(tile);
      if (reduced) continue;
      const scrub = el('div', 'kr-scrub');
      const btn = el('button', 'btn small', '▶');
      btn.type = 'button';
      const range = el('input');
      range.type = 'range';
      range.min = '0';
      range.step = '0.01';
      range.max = String(info.duration);
      const out = el('span', undefined, '0.00 s');
      scrub.append(btn, 'Кадр', range, out);
      tile.append(scrub);
      const show = () => {
        out.textContent = `${pBig.time.toFixed(2)} / ${info.duration.toFixed(2)} s`;
        range.value = String(pBig.time);
      };
      const tick = () => {
        show();
        if (pBig.playing) requestAnimationFrame(tick);
      };
      const play = () => {
        pBig.play();
        pSmall.play();
        requestAnimationFrame(tick);
      };
      btn.addEventListener('click', play);
      range.addEventListener('input', () => {
        pBig.seek(Number(range.value));
        pSmall.seek(Number(range.value));
        show();
      });
      if (at !== null) {
        pBig.seek(at);
        pSmall.seek(at);
        show();
      } else play();
    }
    if (sheets) {
      for (const m of ['plop', 'sneeze'] as const) {
        const d = KIT_MOMENTS[m].duration;
        body.append(el('h3', undefined, `Контактный лист «${KIT_MOMENTS[m].title}» · ${frames} кадров · 0–${d.toFixed(2)} s`));
        const sheet = el('div', 'kr-sheet');
        sheet.dataset['shot'] = `sheet-${m}`;
        body.append(sheet);
        for (let i = 0; i < frames; i++) {
          const t = frames === 1 ? 0 : (d * i) / (frames - 1);
          const cell = el('div', 'kr-cell');
          const box = paper();
          cell.append(box, el('small', undefined, `t = ${t.toFixed(2)} s`));
          sheet.append(cell);
          new MomentPuppet(box, 150, coat, m).seek(t);
        }
      }
    }

    // 3 — the "Erste Schritte" card at real app size, light and dark: Pompon today (end pose) and Krümel peeking
    body.append(el('h3', undefined, 'На карточке «Erste Schritte» — настоящий размер, светлая и тёмная тема'));
    body.append(el('p', 'kr-note', reduced
      ? 'Меньше движения: статичная поза (как иллюстрация). В приложении под «Weniger» на этой карточке никто не выглядывает — Крошки тоже не будет.'
      : 'Слева — как сейчас (Помпон, последний кадр одобренного peek-once), справа — Крошка: тот же подъём лапками, оглядывается и остаётся. Его ушки отвечают на рывки той же «физикой ушей», что и висячие, только чуть жёстче.'));
    const mode: ReducedMotionMode = reduced ? 'force' : 'off';
    const peeks: WelcomeStage[] = [];
    for (const th of ['light', 'dark'] as const) {
      const cards = el('div', 'kr-cards');
      cards.dataset['shot'] = `card-${th}`;
      body.append(cards);
      const pomBox = firstStepsCard(cards, `Сейчас: Помпон · ${th === 'dark' ? 'тёмная' : 'светлая'}`, th);
      const pom = new WelcomeStage(pomBox.host, { bunnies: ['fawn'], choreography: 'peek-once', edgeInset: { bottom: 16 }, minSize: 96, maxSize: 125, calmEyes: 'happy', reducedMotion: mode });
      destroyers.push(pom);
      if (reduced) pom.play();
      else pom.seek(pom.duration);
      const kitBox = firstStepsCard(cards, `Крошка · ${th === 'dark' ? 'тёмная' : 'светлая'}`, th);
      const peek = kitStage(kitBox.host, { coat, ears: 'upright', scale: KIT_PEEK_SCALE, reducedMotion: mode });
      destroyers.push(peek);
      peeks.push(peek);
      if (reduced) peek.play();
      else if (at !== null) peek.seek(Math.min(at, peek.duration));
      else peek.play();
    }
    const first = peeks[0];
    if (first) (window as unknown as { kruemel: WelcomeStage }).kruemel = first;
    if (first && !reduced) {
      const scrub = el('div', 'kr-scrub');
      scrub.style.maxWidth = '358px';
      const range = el('input');
      range.type = 'range';
      range.min = '0';
      range.step = '0.01';
      range.max = String(first.duration);
      const out = el('span', undefined, '0.00 s');
      scrub.append('Кадр (Крошка)', range, out);
      body.append(scrub);
      const show = () => {
        out.textContent = `${first.time.toFixed(2)} / ${first.duration.toFixed(2)} s`;
        range.value = String(Math.min(first.time, first.duration));
      };
      const tick = () => {
        show();
        if (first.playing && first.time < first.duration) requestAnimationFrame(tick);
      };
      range.addEventListener('input', () => {
        for (const p of peeks) p.seek(Number(range.value));
        show();
      });
      if (at !== null) show();
      else requestAnimationFrame(tick);
    }

    // contact sheet of Krümel's peek (2× crops, frozen with seek)
    if (sheets && first) {
      const d = first.duration;
      body.append(el('h3', undefined, `Контактный лист выглядывания · ${frames} кадров · 0–${d.toFixed(2)} s · увеличение 2×`));
      const sheet = el('div', 'kr-sheet peek');
      sheet.dataset['shot'] = 'sheet-peek';
      body.append(sheet);
      for (let i = 0; i < frames; i++) {
        const t = frames === 1 ? 0 : (d * i) / (frames - 1);
        const cell = el('div', 'kr-cell');
        const crop = el('div', 'kr-crop');
        const zoom = el('div', 'kr-zoom');
        crop.append(zoom);
        cell.append(crop, el('small', undefined, `t = ${t.toFixed(2)} s`));
        sheet.append(cell);
        const { host } = firstStepsCard(zoom, null, theme);
        const s = kitStage(host, { coat, ears: 'upright', scale: KIT_PEEK_SCALE, reducedMotion: 'off' });
        s.seek(t);
        destroyers.push(s);
      }
    }

    // 4 — coats
    body.append(el('h3', undefined, 'Окрасы (без голубого)'));
    const p3 = paper('coats');
    const r3 = el('div', 'kr-row');
    p3.append(r3);
    for (const id of KIT_COATS) {
      const f = el('div', 'kr-fig');
      destroyers.push(stillBunny(f, { size: 180, coat: id, kit: 'upright' }));
      f.append(el('span', undefined, COATS.bunny.find((c) => c.id === id)?.name ?? id));
      r3.append(f);
    }
    body.append(p3);

    // 5 — before / after, no animated change
    body.append(el('h3', undefined, 'До и после — без анимации ушей'));
    const p2 = paper('grown');
    const r2 = el('div', 'kr-row');
    p2.append(r2);
    const b1 = el('div', 'kr-fig');
    destroyers.push(stillBunny(b1, { size: Math.round(BASE * KIT_SCALE.upright), coat, kit: 'upright' }));
    b1.append(el('b', undefined, 'До'), el('span', undefined, 'малыш: ушки стоят и торчат в стороны'));
    const arrow = el('div', 'kr-arrow', 'через несколько недель —<br>в следующий визит, а не на глазах');
    const b2 = el('div', 'kr-fig');
    destroyers.push(stillBunny(b2, { size: Math.round(BASE * KIT_SCALE.lop), coat, kit: 'lop' }));
    b2.append(el('b', undefined, 'После'), el('span', undefined, '„Krümel ist gewachsen“ — висячие ушки, как у брата'));
    r2.append(b1, arrow, b2);
    body.append(p2);
    markReady();
  }

  replay.addEventListener('click', () => render(null));
  render(frozen);
  window.addEventListener('pagehide', () => destroyers.forEach((d) => d.destroy()), { once: true });
}

/** The app's "Erste Schritte" card (FirstSteps.tsx): 96 px free above it, the peek host -88 px / right 48 px. */
function firstStepsCard(parent: HTMLElement, label: string | null, theme: Theme): { box: HTMLElement; host: HTMLDivElement } {
  const box = el('div', 'kr-cardbox');
  if (label) box.append(el('small', undefined, label));
  const screen = el('div', `kr-screen kr-paper${theme === 'dark' ? ' dark' : ''}`);
  screen.style.padding = '96px 0 0';
  screen.style.borderRadius = '0';
  screen.style.boxShadow = 'none';
  const card = el('section', 'kr-fs', '<header><b>Erste Schritte</b><i>✕</i></header><p>Eigenen Anlass anlegen</p><p>Ersten Wunsch notieren</p><p>Deinen Folgen-Link teilen</p>');
  const host = el('div', 'kr-host');
  screen.append(card, host);
  box.append(screen);
  parent.append(box);
  return { box, host };
}
