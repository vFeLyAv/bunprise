/**
 * One game opened (26.10, GALLERY-ONLY): the sheet "Wo erhältlich" of the deck with the game's facts — and on top a
 * small carousel (Felix: «заходишь, проигрывается анимация и ты можешь листнуть влево и там будет еще фотка настоящей
 * игры»): slide 1 = our animation of the game (scenes.ts, plays once when the sheet opens), slide 2 = the real photo of
 * the game on a white plate with "Bild: <Shop>" (like GiftPicture in the app). Swipe, the arrow buttons, the dots or
 * ←/→ switch; reduced motion switches instantly. A game without a usable photo (or a photo that fails to load) keeps
 * only the animation: no second slide, no dots, no arrows. Below the facts: "So wird gespielt" (≤ 300 characters),
 * then the shops and «Zur Wunschliste hinzufügen».
 */

import { ARCH_TONE } from './anims';
import { offerLabel, span, type GameCard } from './games';
import type { Theme } from './phone';
import { PHOTOS, PLAYS, photoUrl } from './plays';

export const SHEET_CSS = `
.ix-sheet2 { position: absolute; z-index: 7; left: 8px; right: 8px; bottom: 8px; top: 56px; border-radius: 40px; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
  background: var(--sheet-bg); box-shadow: inset 0 0 0 1px var(--separator), 0 -10px 40px -12px rgba(40,25,10,.35); }
.ix-sheet2 .ix-grab { flex: none; margin: 8px auto 8px; }
.ix-sheet2 .body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; padding: 0 16px 14px; }
.ix-sheet2 .body::-webkit-scrollbar { display: none; }
.ix-sheet2 .foot { flex: none; padding: 10px 16px 16px; box-shadow: 0 -1px 0 var(--separator); }
.ix-sheet2 .foot .ix-cta { margin-top: 0; width: 100%; }
.ix-sheet2 h2 { margin: 10px 2px 0; font-size: 22px; line-height: 27px; font-weight: 700; letter-spacing: -.01em; }
.ix-sheet2 .by { margin: 2px 2px 0; font-size: 13px; color: var(--text-2); }
.ix-sheet2 .by b { color: var(--text); font-weight: 600; }
.ix-sheet2 .blurb { margin: 10px 2px 0; font-size: 15px; line-height: 21px; }
.ix-car { position: relative; height: 172px; border-radius: 24px; overflow: hidden; touch-action: pan-y; outline: none; user-select: none; -webkit-user-select: none; }
.ix-car:focus-visible { box-shadow: 0 0 0 3px #EE9443; }
.ix-car-track { display: flex; height: 100%; transition: transform .35s cubic-bezier(.2,.7,.3,1); }
.ix-car.reduced .ix-car-track, .ix-car.dragging .ix-car-track { transition: none; }
.ix-car-slide { position: relative; flex: 0 0 100%; height: 100%; }
.ix-car-slide.anim { background: var(--tile-bg); }
.ix-car-slide.anim .ix-play { display: block; width: 100%; height: 100%; }
.ix-car-slide.photo { background: var(--photo-plate); box-shadow: inset 0 0 0 1px var(--separator); }
.ix-car-slide.photo img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 6%; box-sizing: border-box; pointer-events: none; }
.ix-credit { position: absolute; top: 10px; right: 12px; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 8px; border-radius: 999px;
  background: var(--credit-bg); color: var(--credit-ink); font-size: 11px; line-height: 1.4; }
.ix-car-btn { position: absolute; top: 50%; z-index: 2; width: 44px; height: 44px; margin-top: -22px; border: 0; border-radius: 50%; display: grid; place-items: center; padding: 0; cursor: pointer;
  background: var(--float-bg); color: var(--text); font: 600 24px/1 system-ui, sans-serif; box-shadow: inset 0 0 0 1px var(--separator), 0 2px 8px rgba(40,25,10,.2); transition: opacity .2s; }
.ix-car-btn.prev { left: 8px; } .ix-car-btn.next { right: 8px; }
.ix-car-btn[aria-hidden="true"] { opacity: 0; pointer-events: none; }
.ix-car-btn:focus-visible { outline: 3px solid #EE9443; outline-offset: 2px; }
.ix-dots { display: flex; justify-content: center; margin: -4px 0 -10px; }
.ix-dots button { width: 30px; height: 36px; border: 0; padding: 0; background: none; display: grid; place-items: center; cursor: pointer; }
.ix-dots button i { width: 7px; height: 7px; border-radius: 4px; background: var(--text-3); opacity: .45; transition: transform .28s cubic-bezier(.25,.8,.3,1), opacity .28s; }
.ix-dots button[aria-selected="true"] i { opacity: 1; background: var(--accent-text); transform: scaleX(2.2); }
.ix-car.reduced ~ .ix-dots button i { transition: none; }
.ix-howto { margin-top: 12px; padding: 10px 12px 11px; border-radius: 18px; background: var(--accent-50); }
.ix-howto h3 { margin: 0 0 3px; font-size: 13px; line-height: 18px; font-weight: 700; color: var(--accent-text); }
.ix-howto p { margin: 0; font-size: 15px; line-height: 21px; }
`;

export interface GameSheet {
  phone: HTMLDivElement;
  /** the animation slide: mountScene() puts the scene in here */
  stage: HTMLElement;
  /** the shown slide (0 = animation, 1 = photo) */
  readonly slide: number;
  readonly slides: number;
  go(index: number): void;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function gameSheetPhone(theme: Theme, game: GameCard, behind: HTMLElement | null, opts: { reduced: boolean; slide?: number }): GameSheet {
  const ph = document.createElement('div');
  ph.className = `ix-phone bp-paper${theme === 'dark' ? ' dark' : ''}`;
  ph.dataset['theme'] = theme;
  if (behind) {
    const back = behind.cloneNode(true) as HTMLElement;
    back.querySelectorAll('[data-k]').forEach((n) => ((n as HTMLElement).style.cssText = ''));
    back.querySelectorAll('.ix-status, .ix-bar, .ix-tabs').forEach((n) => n.remove());
    const scroll = back.querySelector('.ix-scroll');
    if (scroll) ph.append(scroll);
  }
  const play = PLAYS[game.id];
  const tone = play ? (ARCH_TONE[play.look.archetype] ?? game.tone) : game.tone;
  const src = photoUrl(game.id);
  const shop = PHOTOS[game.id]?.shop ?? '';
  const offers = game.offers.map((o) => `<li><span>${esc(o.shop)}</span><em>~ ${offerLabel(o.cents)}</em><i>›</i></li>`).join('');
  ph.insertAdjacentHTML(
    'beforeend',
    `<div class="ix-status"><span>9:41</span><span>●●● ▮</span></div><div class="ix-scrim"></div>
  <section class="ix-sheet2" role="dialog" aria-label="${esc(game.name)}">
    <div class="ix-grab"></div>
    <div class="body">
      <div class="ix-car${opts.reduced ? ' reduced' : ''}" tabindex="0" role="group" aria-roledescription="Karussell" aria-label="Bilder zu ${esc(game.name)}">
        <div class="ix-car-track">
          <div class="ix-car-slide anim" style="--tile-bg: var(--tile-${tone})" role="group" aria-roledescription="Bild" aria-label="So sieht das Spiel aus (Zeichnung)"></div>
          ${src ? `<div class="ix-car-slide photo" role="group" aria-roledescription="Bild" aria-label="Foto: ${esc(game.name)}"><img alt="" decoding="async" referrerpolicy="no-referrer" draggable="false" src="${esc(src)}"><span class="ix-credit">Bild: ${esc(shop)}</span></div>` : ''}
        </div>
        ${src ? '<button type="button" class="ix-car-btn prev" aria-label="Vorheriges Bild">‹</button><button type="button" class="ix-car-btn next" aria-label="Nächstes Bild: Foto">›</button>' : ''}
      </div>
      ${src ? '<div class="ix-dots" role="tablist" aria-label="Bild wählen"><button type="button" role="tab" aria-label="Zeichnung"><i></i></button><button type="button" role="tab" aria-label="Foto"><i></i></button></div>' : ''}
      <h2>${esc(game.name)}</h2>
      <p class="by">${esc(game.kind)} · <b>${esc(game.publisher)}</b>${game.award ? ` · ${esc(game.award)}` : ''}</p>
      <div class="ix-factrow"><span>Spieler<b>${span(game.players)}</b></span><span>Dauer<b>${span(game.minutes)} Min</b></span><span>Alter<b>ab ${game.age}</b></span></div>
      <p class="blurb">${esc(game.blurb)}</p>
      ${play?.howTo ? `<section class="ix-howto" aria-label="So wird gespielt"><h3>So wird gespielt</h3><p>${esc(play.howTo)}</p></section>` : ''}
      <ul class="ix-offers">${offers}</ul>
      <p class="ix-asof">Ungefähre Preise, Stand 26.10.2026.</p>
    </div>
    <div class="foot"><button type="button" class="ix-cta" tabindex="-1">＋ Zur Wunschliste hinzufügen</button></div>
  </section>`,
  );

  const car = ph.querySelector<HTMLElement>('.ix-car');
  const track = ph.querySelector<HTMLElement>('.ix-car-track');
  const stage = ph.querySelector<HTMLElement>('.ix-car-slide.anim');
  if (!car || !track || !stage) throw new Error('game sheet: markup');
  let slides = src ? 2 : 1;
  let slide = 0;

  const render = () => {
    track.style.transform = `translateX(${-slide * 100}%)`;
    ph.querySelectorAll<HTMLElement>('.ix-car-slide').forEach((s, i) => s.setAttribute('aria-hidden', String(i !== slide)));
    ph.querySelectorAll<HTMLElement>('.ix-dots [role="tab"]').forEach((d, i) => {
      d.setAttribute('aria-selected', String(i === slide));
      d.tabIndex = i === slide ? 0 : -1;
    });
    ph.querySelector('.ix-car-btn.prev')?.setAttribute('aria-hidden', String(slide === 0));
    ph.querySelector('.ix-car-btn.next')?.setAttribute('aria-hidden', String(slide >= slides - 1));
  };
  const go = (index: number) => {
    slide = Math.max(0, Math.min(slides - 1, index));
    render();
  };

  // a photo that does not load (another checkout without the git-ignored photos): only the animation stays
  ph.querySelector<HTMLImageElement>('.ix-car-slide.photo img')?.addEventListener('error', () => {
    ph.querySelector('.ix-car-slide.photo')?.remove();
    ph.querySelectorAll('.ix-car-btn, .ix-dots').forEach((n) => n.remove());
    slides = 1;
    go(0);
  });

  ph.querySelector('.ix-car-btn.prev')?.addEventListener('click', () => go(slide - 1));
  ph.querySelector('.ix-car-btn.next')?.addEventListener('click', () => go(slide + 1));
  ph.querySelectorAll<HTMLElement>('.ix-dots [role="tab"]').forEach((d, i) => d.addEventListener('click', () => go(i)));
  car.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(slide + 1);
    else if (e.key === 'ArrowLeft') go(slide - 1);
    else return;
    e.preventDefault();
  });

  // swipe: the track follows the finger 1:1, a release past 40 px (or a quick flick) switches
  let down: { x: number; t: number; id: number } | null = null;
  car.addEventListener('pointerdown', (e) => {
    if (slides < 2 || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    down = { x: e.clientX, t: e.timeStamp, id: e.pointerId };
    car.setPointerCapture?.(e.pointerId);
    car.classList.add('dragging');
  });
  car.addEventListener('pointermove', (e) => {
    if (!down || e.pointerId !== down.id) return;
    let dx = e.clientX - down.x;
    if ((slide === 0 && dx > 0) || (slide === slides - 1 && dx < 0)) dx *= 0.3;
    track.style.transform = `translateX(calc(${-slide * 100}% + ${dx}px))`;
  });
  const release = (e: PointerEvent) => {
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x;
    const fast = Math.abs(dx) / Math.max(1, e.timeStamp - down.t) > 0.5;
    down = null;
    car.classList.remove('dragging');
    if (dx < -40 || (fast && dx < -10)) go(slide + 1);
    else if (dx > 40 || (fast && dx > 10)) go(slide - 1);
    else go(slide);
  };
  car.addEventListener('pointerup', release);
  car.addEventListener('pointercancel', release);

  go(opts.slide ?? 0);
  return {
    phone: ph,
    stage,
    get slide() {
      return slide;
    },
    get slides() {
      return slides;
    },
    go,
  };
}
