/**
 * The promo film in the gallery: the stage, play / pause, a scrubber, speed, scene jumps and sound.
 *
 *   ?screens=film [&clip=main|…] [&t=4.2] [&zoom=1|1.25|1.5] [&autoplay=0] [&render=1]
 *   &clip picks a clip of clips.ts (size, builder, scene jumps); &render=1 = square corners, no shadow (the renderer).
 *   &t=… opens paused at that time (screenshots); window.promoFilm = { seek(t), duration, cues(), soundtrack({ music?, sfx? }) }
 *   for the renderer. The film is dark only (Felix 25.10). Sound: sound.ts, in step with the playhead.
 */
import { CSS_TEXT } from '../promo-storyboard';
import { el } from '../welcome-screens';
import { clipById, CLIPS } from './clips';
import { Film } from './film';
import { FilmSound, renderSoundtrack, wavBase64, type MixParts } from './sound';

const FILM_CSS = `
.pfp { max-width: 980px; margin: 24px auto 40px; padding: 0 12px; }
.pfp > h2 { margin: 4px 6px; font-size: 24px; letter-spacing: -.02em; }
.pfp > p { margin: 0 6px 14px; font-size: 14px; color: var(--text-2); max-width: 760px; }
.pfp-main { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; padding: 0 6px; }
.pfp-zoom { flex: none; transform-origin: 0 0; }
.pfp-side { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
.pfp-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pfp button, .pfp select { font: inherit; border-radius: 999px; border: 0; padding: 8px 14px; min-height: 40px; background: var(--tile); color: var(--text); cursor: pointer; }
.pfp button.main { background: #F0A04B; color: #2A1A0B; font-weight: 700; min-width: 110px; }
.pfp input[type=range] { width: 100%; }
.pfp-time { font-variant-numeric: tabular-nums; color: var(--text-2); }
.pfp-scenes small { color: var(--text-2); }
.pf-stage { position: relative; }
.pf-cap { position: absolute; margin: 0; font-size: 27px; line-height: 1.13; font-weight: 780; letter-spacing: -.022em; color: #2A231C; }
.pf-cap small { display: block; margin-top: 8px; font-size: 15px; line-height: 1.3; font-weight: 520; letter-spacing: 0; color: #62554A; }
.pf-word { display: inline-block; }
.pf-slot { position: relative; height: 54px; margin-top: 10px; }
.pf-slot .ps-occ { position: absolute; left: 0; right: 0; top: 0; margin: 0; }
.pf-field { position: relative; }
.pf-ph { color: #A0948A; }
.pf-type { position: absolute; left: 31px; right: 8px; top: 50%; transform: translateY(-50%); white-space: nowrap; overflow: hidden; color: #2A231C; }
.pf-type i { font-style: normal; }
.pf-cardslot { position: relative; height: 150px; }
.pf-cardslot > .ps-card { position: absolute; left: 0; right: 0; top: 0; overflow: hidden; }
.pf-skel-art { background: #EFE7DA; }
.pf-skel-line { display: block; height: 10px; width: 72%; margin: 10px 2px 0; border-radius: 5px; background: #EFE7DA; }
.pf-skel-line.short { width: 38%; }
.pf-shine { position: absolute; top: 0; bottom: 0; left: 50%; width: 90px; margin-left: -45px; background: linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent); }
.pf-art { display: grid; place-items: center; }
.pf-mini { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 7px 9px; font-size: 12px; }
.pf-mini i { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: #FDE8D0; color: #C2661E; flex: none; }
.pf-mini i svg { width: 16px; height: 16px; }
.pf-mini b { flex: 1; } .pf-mini span { color: #B65F1A; font-weight: 700; }
.pf-pill { display: block; transform: translate(-50%, -50%); white-space: nowrap; padding: 9px 14px; border-radius: 999px; background: #fff; box-shadow: 0 8px 20px rgba(70,45,20,.16); font-size: 13.5px; font-weight: 700; color: #7A4A1C; }
.pf-btnslot { position: relative; height: 30px; margin-top: 8px; }
.pf-btnslot .ps-pill { position: absolute; left: 0; top: 0; margin: 0; }
.pf-accent { color: #B65F1A; }
.pf-hp { color: #5B4636; }
.pf-stage[data-theme="dark"] .pf-hp { color: #EAD7C3; }
.pfp button[aria-pressed="true"] { background: #2A231C; color: #fff; }
/* light (default): the mascots' shadow and rim as in the app's day theme (tokens.css) */
.pf-stage { --mascot-shadow: rgba(70,40,15,.20); --mascot-outline: rgba(224,171,116,.5); --pf-ring: #fff; }
/* dark: the app's night theme (tokens.css light-dark() night values) on the film's own elements */
.pf-stage[data-theme="dark"] { --pf-text: #F5EDE3; --pf-text-2: #C3B5A6; --pf-surface: #2A221D; --pf-surface-2: #332A23; --pf-screen: #1E1814; --pf-ring: #2A221D;
  --mascot-shadow: rgba(0,0,0,.42); --mascot-outline: rgba(255,214,170,.2); color: var(--pf-text); box-shadow: 0 18px 44px rgba(0,0,0,.35); }
.pf-stage[data-theme="dark"] .pf-cap, .pf-stage[data-theme="dark"] .ps-ph h4, .pf-stage[data-theme="dark"] .ps-wish b, .pf-stage[data-theme="dark"] .ps-occ b,
.pf-stage[data-theme="dark"] .ps-cal b, .pf-stage[data-theme="dark"] .pf-mini b, .pf-stage[data-theme="dark"] .pf-type, .pf-stage[data-theme="dark"] .ps-brand b { color: var(--pf-text); }
.pf-stage[data-theme="dark"] .pf-cap small, .pf-stage[data-theme="dark"] .ps-days, .pf-stage[data-theme="dark"] .ps-who, .pf-stage[data-theme="dark"] .ps-occ small,
.pf-stage[data-theme="dark"] .ps-brand span { color: var(--pf-text-2); }
.pf-stage[data-theme="dark"] .ps-days i.hd, .pf-stage[data-theme="dark"] .pf-ph { color: #918377; }
.pf-stage[data-theme="dark"] .ps-phone { background: var(--pf-screen); box-shadow: 0 0 0 6px #0A0807, 0 0 0 7px rgba(255,236,214,.16), 0 22px 44px rgba(0,0,0,.45); }
.pf-stage[data-theme="dark"] .ps-phone.small { box-shadow: 0 0 0 5px #0A0807, 0 0 0 6px rgba(255,236,214,.16), 0 16px 34px rgba(0,0,0,.45); }
.pf-stage[data-theme="dark"] .ps-card { background: var(--pf-surface); box-shadow: 0 4px 14px rgba(0,0,0,.3), inset 0 0 0 1px rgba(255,230,205,.07); }
.pf-stage[data-theme="dark"] .ps-art { background: linear-gradient(160deg, #4A3526, #3D2A1A); color: #F2A25A; }
.pf-stage[data-theme="dark"] .ps-wish span, .pf-stage[data-theme="dark"] .pf-mini span, .pf-stage[data-theme="dark"] .ps-brand u, .pf-stage[data-theme="dark"] .pf-accent { color: #F2A25A; }
.pf-stage[data-theme="dark"] .ps-field { background: var(--pf-surface-2); color: var(--pf-text-2); }
.pf-stage[data-theme="dark"] .ps-occ i, .pf-stage[data-theme="dark"] .pf-mini i { background: #3D2A1A; color: #F2A25A; }
.pf-stage[data-theme="dark"] .pf-skel-art, .pf-stage[data-theme="dark"] .pf-skel-line { background: #3A3029; }
.pf-stage[data-theme="dark"] .pf-shine { background: linear-gradient(90deg, transparent, rgba(255,236,214,.12), transparent); }
.pf-stage[data-theme="dark"] .ps-pill.ok { background: rgba(46,157,98,.2); color: #7FD1AE; }
.pf-stage[data-theme="dark"] .pf-pill { background: var(--pf-surface-2); color: #F2A25A; box-shadow: 0 8px 20px rgba(0,0,0,.4); }
.pf-stage[data-theme="dark"] .ps-avatar { box-shadow: 0 0 0 4px var(--pf-ring), 0 10px 22px rgba(0,0,0,.35); }
/* the install clips (install.ts): our own simplified phone, browser, sheet, dialog and home screen — night colours */
.pfi-phone { border-radius: 32px; background: #0A0807; box-shadow: 0 0 0 1px rgba(255,236,214,.16), 0 22px 44px rgba(0,0,0,.45); z-index: 2; }
.pfi-screen { position: absolute; inset: 6px; border-radius: 26px; overflow: hidden; background: #1E1814; font-size: 12px; color: #F5EDE3; }
.pfi-site > div { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 0 18px; text-align: center; }
.pfi-site img { width: 52px; height: 52px; border-radius: 13px; box-shadow: 0 8px 18px rgba(240,160,75,.3); }
.pfi-site b { margin-top: 6px; font-size: 15px; line-height: 1.2; font-weight: 760; }
.pfi-site p { margin: 0; font-size: 11px; line-height: 1.35; color: #C3B5A6; }
.pfi-btn { display: block; align-self: stretch; height: 30px; margin-top: 4px; border-radius: 999px; background: rgba(255,230,205,.08); box-shadow: inset 0 0 0 1px rgba(255,230,205,.12); }
.pfi-btn:first-of-type { margin-top: 40px; }
.pfi-btn.main { background: #F0A04B; box-shadow: none; }
.pfi-bottom { position: absolute; left: 0; right: 0; bottom: 0; height: 60px; padding: 8px 10px 18px; display: flex; align-items: center; gap: 8px; background: rgba(40,32,27,.97); box-shadow: 0 -1px 0 rgba(255,230,205,.08); }
.pfi-topbar { position: absolute; left: 0; right: 0; top: 0; height: 62px; padding: 26px 6px 6px 10px; display: flex; align-items: center; gap: 4px; background: rgba(40,32,27,.97); box-shadow: 0 1px 0 rgba(255,230,205,.08); }
.pfi-url { flex: 1; padding: 7px 10px; border-radius: 12px; background: rgba(255,230,205,.09); text-align: center; font-size: 12px; font-weight: 600; }
.pfi-muted { display: grid; place-items: center; color: #7D6F64; }
.pfi-share { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; color: #6FA8FF; }
.pfi-share svg { width: 20px; height: 20px; }
.pfi-dots { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: #F5EDE3; }
.pfi-dim { background: rgba(0,0,0,.5); }
.pfi-sheet { position: absolute; left: 6px; right: 6px; bottom: 6px; padding: 12px 8px 10px; border-radius: 22px; background: #2E2620; box-shadow: 0 -10px 30px rgba(0,0,0,.45); }
.pfi-sheet-head { display: flex; align-items: center; gap: 9px; margin: 0 6px 10px; }
.pfi-sheet-head img { width: 34px; height: 34px; border-radius: 9px; }
.pfi-sheet-head b, .pfi-card b { font-size: 12.5px; }
.pfi-sheet-head small, .pfi-card small { display: block; font-size: 10.5px; font-weight: 500; color: #A89A8D; }
.pfi-row { position: relative; display: flex; align-items: center; justify-content: space-between; margin-top: 5px; padding: 10px 12px; border-radius: 12px; background: #3A3029; font-size: 12.5px; font-weight: 600; }
.pfi-row svg { width: 17px; height: 17px; color: #C3B5A6; }
.pfi-confirm { background: #1E1814; }
.pfi-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 34px 7px 12px; font-size: 11px; white-space: nowrap; }
.pfi-top b { font-size: 11px; }
.pfi-link { padding: 6px 3px; color: #F2A25A; }
.pfi-strong { font-weight: 800; }
.pfi-card { display: flex; align-items: center; gap: 10px; margin: 8px 12px; padding: 10px; border-radius: 14px; background: #2A221D; }
.pfi-card img { width: 46px; height: 46px; border-radius: 12px; }
.pfi-home { padding: 44px 14px 0; background: linear-gradient(170deg, #2E2440 0%, #3A2733 55%, #4A2E26 100%); }
.pfi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 10px; }
.pfi-app { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 8.5px; font-weight: 600; color: #F5EDE3; }
.pfi-app i { display: block; width: 40px; height: 40px; border-radius: 11px; opacity: .55; }
.pfi-app img { width: 40px; height: 40px; border-radius: 11px; box-shadow: 0 0 0 2px rgba(255,236,214,.55), 0 6px 16px rgba(240,160,75,.5); }
.pfi-menu { position: absolute; top: 30px; right: 6px; width: 162px; padding: 6px 0; border-radius: 12px; background: #2E2620; box-shadow: 0 12px 30px rgba(0,0,0,.5); transform-origin: 100% 0; }
.pfi-mrow { position: relative; padding: 9px 14px; font-size: 12px; font-weight: 600; }
.pfi-dialog { position: absolute; left: 14px; right: 14px; top: 150px; padding: 16px 12px 10px; border-radius: 20px; background: #2E2620; box-shadow: 0 18px 40px rgba(0,0,0,.55); }
.pfi-dialog > b { display: block; margin: 0 4px 6px; font-size: 14px; }
.pfi-dialog .pfi-card { margin: 6px 0; }
.pfi-actions { display: flex; justify-content: flex-end; gap: 16px; padding: 8px 6px 2px; font-size: 12px; }
/* the 16:9 banners (banners.ts) */
.pfb-brand { display: flex; align-items: center; gap: 18px; }
.pfb-brand img { width: 84px; height: 84px; border-radius: 20px; box-shadow: 0 10px 26px rgba(240,160,75,.35); flex: none; }
.pfb-brand b { display: block; font-size: 44px; line-height: 1; font-weight: 800; letter-spacing: -.03em; color: #F5EDE3; }
.pfb-brand span { display: block; margin-top: 8px; font-size: 17px; line-height: 1.25; color: #C3B5A6; }
.pfb-brand u, .pfb-text u, .pfb-title u { text-decoration: none; font-weight: 700; color: #F2A25A; }
.pfb-brand u { display: block; margin-top: 10px; font-size: 16px; }
.pfb-text { display: flex; flex-direction: column; justify-content: center; }
.pfb-text b { font-size: 40px; line-height: 1.05; font-weight: 800; letter-spacing: -.03em; color: #F5EDE3; }
.pfb-text span { margin-top: 12px; font-size: 18px; color: #C3B5A6; }
.pfb-text u { margin-top: 12px; font-size: 16px; }
.pfb-pill { margin-top: 10px; padding: 7px 11px; font-size: 12px; }
.pfb-title { text-align: center; }
.pfb-title b { display: block; font-size: 48px; line-height: 1; font-weight: 800; letter-spacing: -.03em; color: #F5EDE3; }
.pfb-title span { display: block; margin-top: 10px; font-size: 15px; color: #C3B5A6; }
`;

export function promoFilmGallery(app: HTMLElement, query: URLSearchParams): void {
  app.replaceChildren();
  const style = document.createElement('style');
  style.textContent = CSS_TEXT + FILM_CSS;
  document.head.append(style);
  const clip = clipById(query.get('clip'));
  const W = clip.w;
  const H = clip.h;
  const section = el('section', 'pfp');
  section.innerHTML = `<h2>Ролик: ${clip.title}</h2>
    <p>${clip.note} Тёмный вариант (решение Кирилла 25.10). Всё движение и звук — одна шкала времени: ползунок ставит любой кадр, при записи видео будет то же самое. Раскадровка: <a href="?screens=promo">?screens=promo</a>.</p>
    <div class="pfp-row" style="margin:0 6px 14px">${CLIPS.map((c) => c.id === clip.id ? `<b>${c.title}</b>` : `<a href="?screens=film&clip=${c.id}">${c.title}</a>`).join(' · ')}</div>`;
  const main = el('div', 'pfp-main');
  const zoomBox = el('div', 'pfp-zoom');
  const stage = el('div', 'ps-frame pf-stage');
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  // the film is dark only (Felix 25.10: «оставляем только тёмную тему»)
  stage.dataset['theme'] = 'dark';
  if (query.get('render') === '1') { stage.style.borderRadius = '0'; stage.style.boxShadow = 'none'; }
  zoomBox.append(stage);
  const side = el('div', 'pfp-side');
  side.innerHTML = `<div class="pfp-row"><button class="main" type="button" data-act="play">▶ Пуск</button><button type="button" data-act="restart">⟲ Сначала</button>
      <select aria-label="Скорость"><option value="1">1×</option><option value="0.5">0,5×</option><option value="0.25">0,25×</option></select>
      <select aria-label="Размер" data-act="zoom"><option value="1">100 %</option><option value="1.25">125 %</option><option value="1.5">150 %</option></select></div>
    <div class="pfp-row"><button type="button" data-act="sound" aria-pressed="true">🔊 Звук</button><button type="button" data-act="music" aria-pressed="true">🎵 Музыка</button>
      <label class="pfp-time">Громкость <input type="range" min="0" max="1" step="0.05" value="0.8" data-act="volume" aria-label="Громкость" style="width:120px;vertical-align:middle"></label></div>
    <input type="range" min="0" step="0.01" aria-label="Время" data-act="time">
    <div class="pfp-time"></div>
    <div class="pfp-row pfp-scenes">${clip.scenes.map((s) => `<button type="button" data-at="${s.at}">${s.label}</button>`).join('')}</div>
    <small>Пробел — пуск/пауза, ← → — на 1/30 секунды. Звук играет только на 1× (на 0,5× и 0,25× — тишина); браузер включает его только после нажатия ▶ или 🔊.</small>`;
  main.append(zoomBox, side);
  section.append(main);
  app.append(section);

  const film = new Film(stage);
  clip.build(film);
  film.build();
  const sound = new FilmSound(film.cues, film.duration);
  // banners are silent loops (GIF / MP4 for Telegram): no music, and the preview plays them round and round
  const loop = clip.kind === 'gif';
  if (loop) sound.music = false;

  const play = side.querySelector<HTMLButtonElement>('[data-act="play"]');
  const scrub = side.querySelector<HTMLInputElement>('[data-act="time"]');
  const time = side.querySelector<HTMLElement>('div.pfp-time');
  const speed = side.querySelector<HTMLSelectElement>('select[aria-label="Скорость"]');
  const zoom = side.querySelector<HTMLSelectElement>('[data-act="zoom"]');
  const soundBtn = side.querySelector<HTMLButtonElement>('[data-act="sound"]');
  const musicBtn = side.querySelector<HTMLButtonElement>('[data-act="music"]');
  const volume = side.querySelector<HTMLInputElement>('[data-act="volume"]');
  if (!play || !scrub || !time || !speed || !zoom || !soundBtn || !musicBtn || !volume) return;
  scrub.max = String(film.duration);

  let t = Number(query.get('t') ?? '0') || 0;
  let running = false;
  let last = 0;
  let soundOn = true;
  const show = () => {
    film.seek(t);
    scrub.value = String(t);
    time.textContent = `${t.toFixed(2)} с / ${film.duration.toFixed(1)} с`;
  };
  /** Sound follows the playhead: (re)started from t while playing at 1×, silent otherwise. Call from a click. */
  const resync = () => {
    if (running && soundOn && Number(speed.value) === 1) void sound.start(() => t);
    else sound.stop();
  };
  const setZoom = (z: number) => {
    zoomBox.style.transform = `scale(${z})`;
    zoomBox.style.width = `${W * z}px`;
    zoomBox.style.height = `${H * z}px`;
  };
  const frame = (now: number) => {
    if (!running) return;
    const dt = (now - last) / 1000;
    last = now;
    // while sound plays, the picture follows the audio clock (no drift between the two)
    const heard = sound.time();
    t = heard ?? t + dt * Number(speed.value);
    if (t >= film.duration && loop) t %= film.duration;
    else if (t >= film.duration) { t = film.duration; running = false; play.textContent = '▶ Пуск'; sound.stop(); }
    show();
    if (running) requestAnimationFrame(frame);
  };
  const toggle = (withSound = true) => {
    running = !running;
    play.textContent = running ? '❚❚ Пауза' : '▶ Пуск';
    if (running) {
      if (t >= film.duration - 0.01) t = 0;
      last = performance.now();
      requestAnimationFrame(frame);
    }
    if (withSound) resync();
    else sound.stop();
  };
  const jump = (to: number) => { t = Math.max(0, Math.min(film.duration, to)); show(); resync(); };
  play.addEventListener('click', () => toggle());
  side.querySelector('[data-act="restart"]')?.addEventListener('click', () => { if (!running) toggle(false); jump(0); });
  scrub.addEventListener('input', () => { t = Number(scrub.value); show(); sound.stop(); });
  scrub.addEventListener('change', () => resync());
  zoom.addEventListener('change', () => setZoom(Number(zoom.value)));
  speed.addEventListener('change', () => resync());
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.textContent = soundOn ? '🔊 Звук' : '🔇 Без звука';
    resync();
  });
  // the quiet music bed on/off (Felix 25.10: compare with and without; the effects stay)
  musicBtn.addEventListener('click', () => {
    sound.music = !sound.music;
    musicBtn.setAttribute('aria-pressed', String(sound.music));
    musicBtn.textContent = sound.music ? '🎵 Музыка' : '🎵 Без музыки';
    resync();
  });
  volume.addEventListener('input', () => { sound.volume = Number(volume.value); });
  side.querySelectorAll<HTMLButtonElement>('[data-at]').forEach((b) => b.addEventListener('click', () => jump(Number(b.dataset['at']))));
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.key !== ' ') return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') jump(t + 1 / 30);
    else if (e.key === 'ArrowLeft') jump(t - 1 / 30);
  });
  const z = Number(query.get('zoom') ?? (window.innerWidth > 1100 && H > W ? '1.25' : '1'));
  zoom.value = String(z);
  setZoom(z);
  show();
  (window as unknown as { promoFilm: PromoFilmHook }).promoFilm = {
    seek: (s: number) => { t = s; show(); },
    duration: film.duration,
    cues: () => film.cues.map((c) => ({ t: c.t, name: c.name })),
    soundtrack: async (parts: MixParts = {}) => wavBase64(await renderSoundtrack(film.cues, film.duration, parts)),
  };
  // autoplay on open is silent (browsers allow sound only after a click): ▶ or 🔊 brings the sound in
  if (query.get('autoplay') !== '0' && !query.has('t')) toggle(false);
  window.addEventListener('pagehide', () => { sound.close(); film.destroy(); }, { once: true });
}

/** What the renderer and screenshot scripts use (window.promoFilm). */
interface PromoFilmHook {
  seek(t: number): void;
  duration: number;
  cues(): { t: number; name: string }[];
  /** the soundtrack (music bed and/or every cue: { music: false } leaves the music out), 48 kHz stereo 16-bit WAV, base64 */
  soundtrack(parts?: MixParts): Promise<string>;
}
