/**
 * Gallery page for the Lists buddy (Felix 25.10) — a GALLERY-ONLY prototype on the mascot gallery (5180).
 * A mock of the app's "Wunschlisten" screen (banner, avatar, stats row, segments, four wishlist cards) at
 * phone width, with the buddy living in it, plus switches and buttons to try every behaviour.
 *
 *   ?screens=buddy [&kind=bunny] [&reduced=1] [&size=128] [&seed=7] [&auto=0]
 *
 * Design note: docs/design/2026-10-25-lists-buddy.md.
 */

import type { ReducedMotionMode } from '../../src/index';
import { ListsBuddy, type BuddyHaptic, type BuddyInfo, type BuddyKind } from '../../src/buddy/index';

const CSS_TEXT = `
.lb { margin: 0 auto 28px; max-width: 980px; }
.lb h2 { margin: 6px 6px 4px; font-size: 22px; }
.lb > p { margin: 0 6px 12px; color: var(--text-2, #6E6E73); font-size: 14px; line-height: 1.45; }
.lb-controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 6px 14px; }
.lb-controls select, .lb-controls button { appearance: none; border: 0; border-radius: 999px; padding: 9px 14px; font: 600 14px/1 inherit;
  background: rgba(0,0,0,.06); color: inherit; cursor: pointer; }
.lb-controls select { padding-right: 28px; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 15px) 52%, calc(100% - 10px) 52%; background-size: 5px 5px; background-repeat: no-repeat; }
.lb-controls button:active { transform: scale(.95); }
.lb-row { display: flex; flex-wrap: wrap; gap: 22px; align-items: flex-start; justify-content: center; }
.lb-phone { position: relative; width: 390px; height: 780px; border-radius: 46px; overflow: hidden; background: #F2EBDD;
  box-shadow: 0 0 0 10px #1D1D1F, 0 30px 70px rgba(60,40,20,.28); flex: none; }
.lb-screen { position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none;
  background: radial-gradient(120% 60% at 0% 0%, #F9D9C3 0%, transparent 55%), radial-gradient(90% 50% at 100% 30%, #F4D6D6 0%, transparent 60%), #F2EBDD; }
.lb-screen::-webkit-scrollbar { display: none; }
.lb-content { position: relative; padding: 14px 16px 120px; color: #2A231C; font: 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; }
.lb-top { display: flex; align-items: center; justify-content: center; position: relative; height: 44px; font-weight: 700; font-size: 17px; }
.lb-top button { position: absolute; right: 0; top: 2px; border: 0; border-radius: 999px; padding: 9px 14px; background: #FFFDF8; font: 600 15px/1 inherit; box-shadow: 0 4px 14px rgba(80,50,20,.1); }
.lb-banner { height: 116px; margin-top: 8px; border-radius: 26px; background:
  radial-gradient(circle at 18% 30%, #F6A291 0 2px, transparent 3px), radial-gradient(circle at 62% 22%, #9FD3FF 0 2px, transparent 3px),
  radial-gradient(circle at 82% 64%, #FFD166 0 2px, transparent 3px), radial-gradient(circle at 38% 72%, #B9E3A5 0 2px, transparent 3px), #FFF9F2;
  background-size: 64px 48px; box-shadow: 0 6px 20px rgba(80,50,20,.08); }
.lb-profile { display: flex; align-items: flex-end; gap: 12px; margin: -46px 0 0 16px; }
.lb-avatar { width: 88px; height: 88px; border-radius: 50%; background: #F7E7B4; color: #7A5A15; display: grid; place-items: center;
  font-size: 36px; font-weight: 600; box-shadow: 0 0 0 5px #FFFDF8, 0 8px 22px rgba(80,50,20,.15); flex: none; }
.lb-profile b { font-size: 21px; margin-bottom: 26px; }
.lb-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 78px; }
.lb-stat { background: rgba(255,253,248,.82); border-radius: 22px; padding: 14px 16px; box-shadow: 0 6px 18px rgba(80,50,20,.07); }
.lb-stat strong { display: block; font-size: 28px; line-height: 1.1; }
.lb-stat span { font-size: 14px; color: #62554A; }
.lb-follow { display: flex; justify-content: space-between; align-items: center; margin: 14px 0 18px; font-size: 14px; color: #62554A; }
.lb-pill { border-radius: 999px; padding: 6px 12px; background: #FCE5C9; color: #783910; font-weight: 600; }
.lb-seg { display: grid; grid-template-columns: 1fr 1fr; background: rgba(0,0,0,.06); border-radius: 999px; padding: 4px; margin-bottom: 30px; }
.lb-seg span { text-align: center; padding: 10px; border-radius: 999px; font-weight: 600; color: #62554A; }
.lb-seg .on { background: #FFFDF8; color: #2A231C; box-shadow: 0 2px 8px rgba(80,50,20,.1); }
.lb-card { background: rgba(255,253,248,.9); border-radius: 24px; padding: 16px; margin-bottom: 34px; box-shadow: 0 8px 22px rgba(80,50,20,.08); }
.lb-card h3 { margin: 0 0 4px; font-size: 17px; }
.lb-card small { color: #62554A; font-size: 13px; }
.lb-thumbs { display: flex; gap: 8px; margin-top: 12px; }
.lb-thumbs i { width: 52px; height: 52px; border-radius: 14px; display: block; }
.lb-tabs { position: absolute; left: 12px; right: 12px; bottom: 14px; height: 64px; border-radius: 32px; background: rgba(255,253,248,.88);
  box-shadow: 0 10px 30px rgba(80,50,20,.16); display: flex; align-items: center; justify-content: space-around; font: 600 11px/1 -apple-system, "Segoe UI", system-ui, sans-serif; color: #62554A; z-index: 10; }
.lb-tabs .plus { width: 54px; height: 54px; border-radius: 50%; background: #F0A04B; color: #2A1A0B; display: grid; place-items: center; font-size: 30px; font-weight: 400; margin-top: -2px; }
.lb-tabs .on { color: #B65E1C; }
.lb-side { width: 300px; font-size: 13px; line-height: 1.5; color: var(--text-2, #6E6E73); }
.lb-side code { display: block; padding: 8px 10px; border-radius: 12px; background: rgba(0,0,0,.05); color: var(--text, #1D1D1F); font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; }
.lb-side ul { padding-left: 18px; margin: 8px 0; }
`;

const CARDS = [
  { title: 'Geburtstag 2026', meta: '5 Wünsche · Meine Follower', thumbs: ['#F6C07E', '#9FD3FF', '#F6A291'] },
  { title: 'Weihnachten', meta: '8 Wünsche · Nur ich', thumbs: ['#D64545', '#B9E3A5', '#FFE08A', '#C9B8F2'] },
  { title: 'Einfach so', meta: '3 Wünsche · Meine Follower', thumbs: ['#FFB3C7', '#A9D8FF'] },
  { title: 'Bücher', meta: '4 Wünsche · Nur ich', thumbs: ['#E9C493', '#8E6450', '#F2D1CD'] },
];

const BUTTONS: { label: string; act: Parameters<ListsBuddy['trigger']>[0] }[] = [
  { label: 'Погулять', act: 'wander' },
  { label: 'Осмотреть список', act: 'inspect' },
  { label: 'Любоваться аватаркой', act: 'admire' },
  { label: 'Набить щёки', act: 'stuff' },
  { label: 'Почесаться', act: 'scratch' },
  { label: 'Оглядеться', act: 'lookAround' },
  { label: 'Вздремнуть', act: 'nap' },
  { label: 'Новое желание', act: 'wish' },
  { label: 'Помахать', act: 'wave' },
  { label: 'Бросить!', act: 'throw' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function phoneMarkup(): string {
  const cards = CARDS.map((c, i) => `<article class="lb-card" data-buddy-floor="card-${i}" data-buddy-card="${i}"><h3>${c.title}</h3><small>${c.meta}</small>
    <div class="lb-thumbs">${c.thumbs.map((t) => `<i style="background:${t}"></i>`).join('')}</div></article>`).join('');
  return `<div class="lb-screen"><div class="lb-content">
      <div class="lb-top">Wunschlisten<button type="button">Teilen</button></div>
      <div class="lb-banner"></div>
      <div class="lb-profile"><div class="lb-avatar" data-buddy-avatar>K</div><b>Felix</b></div>
      <div class="lb-stats" data-buddy-floor="stats"><div class="lb-stat"><strong>20</strong><span>Wünsche</span></div><div class="lb-stat"><strong>4</strong><span>Mit dir geteilt</span></div></div>
      <div class="lb-follow"><span>3 Follower · Du folgst 3 ›</span><span class="lb-pill">2 Anfragen</span></div>
      <div class="lb-seg"><span class="on">Meine</span><span>Freunde</span></div>
      ${cards}
    </div></div>
    <nav class="lb-tabs"><span>Start</span><span class="on">Listen</span><span class="plus">+</span><span>Ideen</span><span>Profil</span></nav>`;
}

/** The gallery's own vibration (in the app it goes through the haptics wrapper). */
function vibrate(kind: BuddyHaptic): void {
  const pattern = kind === 'warning' ? [12, 40, 18] : kind === 'select' ? 6 : 10;
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

export function listsBuddyGallery(app: HTMLElement, query: URLSearchParams): void {
  const only = query.get('screens') === 'buddy';
  if (only) app.replaceChildren();
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);

  const section = el('section', 'lb');
  section.innerHTML = `<h2>Дружок на вкладке «Списки» (25.10) — прототип</h2>
    <p>Только в галерее: в приложение не попадает, пока Кирилл не одобрит. Хомяк Тапси (или кролик Помпон) живёт сам: гуляет по краю
    карточек, смотрит на аватарку, проверяет списки, набивает щёки, засыпает. <b>Схвати его</b> мышкой (на телефоне — долгое нажатие),
    покачай и <b>брось</b>.</p>`;
  const controls = el('div', 'lb-controls');
  const kindSel = el('select');
  kindSel.setAttribute('aria-label', 'Персонаж');
  kindSel.add(new Option('Хомяк Тапси', 'hamster'));
  kindSel.add(new Option('Кролик Помпон', 'bunny'));
  kindSel.value = query.get('kind') === 'bunny' ? 'bunny' : 'hamster';
  const motionSel = el('select');
  motionSel.setAttribute('aria-label', 'Движение');
  motionSel.add(new Option('Полное движение', 'off'));
  motionSel.add(new Option('Уменьшенное движение', 'force'));
  motionSel.value = query.get('reduced') === '1' ? 'force' : 'off';
  const sizeSel = el('select');
  sizeSel.setAttribute('aria-label', 'Размер');
  sizeSel.add(new Option('Размер как сейчас (96)', '96'));
  sizeSel.add(new Option('Крупнее (128)', '128'));
  sizeSel.value = query.get('size') === '128' ? '128' : '96';
  controls.append(kindSel, motionSel, sizeSel);
  const buttons = BUTTONS.map((b) => {
    const btn = el('button', undefined, b.label);
    btn.type = 'button';
    btn.dataset.act = b.act;
    controls.append(btn);
    return btn;
  });
  const reset = el('button', undefined, 'Сначала');
  reset.type = 'button';
  controls.append(reset);

  const row = el('div', 'lb-row');
  const phone = el('div', 'lb-phone');
  const side = el('div', 'lb-side');
  side.innerHTML = `<b>Что он умеет</b><ul>
    <li>сам: гуляет, перепрыгивает с карточки на карточку, нюхает, чешется, сидит, оглядывается;</li>
    <li>подходит к списку и заглядывает в него: «о да, отличная идея!»;</li>
    <li>смотрит на аватарку: глаза-сердечки, звёздочки, румянец;</li>
    <li>хомяк набивает подарок за щёки; без касаний ~45 с — засыпает;</li>
    <li>глаза следят за курсором рядом; тап — хихикает, двойной тап — машет;</li>
    <li>прокрутка рывком — «держится»; схватить — висит и болтает лапками;</li>
    <li>бросить — кувырок, катится, встаёт с головокружением, злится, фыркает, отряхивается; часто бросать — обижается и сидит спиной.</li></ul>
    <b>Сейчас</b><code class="lb-debug">—</code>`;
  row.append(phone, side);
  section.append(controls, row);
  if (only) app.append(section); else app.prepend(section);
  const debug = side.querySelector<HTMLElement>('.lb-debug');

  let buddy: ListsBuddy | null = null;
  const build = () => {
    buddy?.destroy();
    phone.innerHTML = phoneMarkup();
    const content = phone.querySelector<HTMLElement>('.lb-content');
    const screen = phone.querySelector<HTMLElement>('.lb-screen');
    if (!content || !screen) return;
    const kind = kindSel.value as BuddyKind;
    buttons.forEach((b) => { b.hidden = b.dataset.act === 'stuff' && kind !== 'hamster'; });
    buddy = new ListsBuddy({
      stage: content,
      scroller: screen,
      kind,
      width: Number(sizeSel.value),
      reducedMotion: motionSel.value as ReducedMotionMode,
      seed: Number(query.get('seed') ?? '') || undefined,
      autonomous: query.get('auto') !== '0',
      groundInset: 96,
      haptics: vibrate,
      onState: (s: BuddyInfo) => { if (debug) debug.textContent = `${s.action} · ${s.mode} · ${s.floor} · обида ${s.grumpy}`; },
    });
    (window as unknown as { listsBuddy: ListsBuddy }).listsBuddy = buddy;
  };
  for (const b of buttons) b.addEventListener('click', () => buddy?.trigger(b.dataset.act as Parameters<ListsBuddy['trigger']>[0]));
  for (const s of [kindSel, sizeSel]) s.addEventListener('change', build);
  motionSel.addEventListener('change', () => buddy?.setReducedMotion(motionSel.value as ReducedMotionMode));
  reset.addEventListener('click', build);
  // wait one frame so the phone has its layout (the floors are measured from it)
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(build);
  else setTimeout(build, 16);
  window.addEventListener('pagehide', () => buddy?.destroy(), { once: true });
}
