/**
 * «Ночью маскоты спят» (Felix 31.10: «прикольно, но чтобы можно было будить») — the gallery page (5180). Approved
 * 31.10 («спящие норм, оставляем») and in the app since: the code lives in src/night/ (@bunprise/mascot/night), the
 * files next to this one re-export it.
 *
 *   ?screens=night [&time=23:30] [&theme=both|light|dark|navy|ocean|black|night|all] [&reduced=1] [&battery=1]
 *                  [&drip=0] [&awake=10] [&speed=0|1|60] [&off=1]
 *                  [&view=phones|strips] [&place=start|lists|friends|plus]
 *                  [&strip=fall|wake|morning|peek|loop] [&kind=bunny|hamster] [&frames=10] [&size=120]
 *
 * Phones = mock-ups of the real places (Start: the first card's corner; Listen: Pompon the buddy on the stats row;
 * Listen → Freunde: Tapsi with binoculars; the "+" menu: Pompon peeking over the sheet — at night the approved
 * `sleepy` preset of src/welcome.ts, unchanged). A simulated clock with a slider (22:30 → 07:30) drives them.
 * Strips = frozen frames of every moment (Track.styleAt, the same keys as the animations) for screenshots.
 * Design note: docs/design/2026-10-31-mascots-night.md.
 */

import { WelcomeStage } from '../../src/index';
import { freezeAt } from '../../src/drive';
import { atMinute, fmtTime, isNight, minuteOfDay, parseTime } from './clock';
import { NightMascot, type NightState } from './controller';
import { asleepPose, authorFall, authorPeek, authorWake, BREATH_S, restPose, sleepLoops, Z_S, type Shot } from './moves';
import { mountNightPuppet, NEUTRAL, type NightKind, type NightRig, type Pose } from './rig';

type Theme = 'light' | 'dark' | 'navy' | 'ocean' | 'black';
const THEMES: ReadonlyArray<[Theme, string]> = [['light', 'Светлая'], ['dark', 'Тёмная'], ['navy', 'Blau'], ['ocean', 'Ozean'], ['black', 'Schwarz']];
type Place = 'start' | 'lists' | 'friends' | 'plus';
const PLACES: ReadonlyArray<[Place, string]> = [
  ['start', 'Start — угол первой карточки'],
  ['lists', 'Listen — Помпон-дружок на плашке'],
  ['friends', 'Listen → Freunde — Тапси с биноклем'],
  ['plus', 'Меню «+» — Помпон выглядывает'],
];

const CSS_TEXT = `
.nt { max-width: 1480px; margin: 0 auto 40px; }
.nt h2 { margin: 6px 6px 4px; font-size: 24px; letter-spacing: -.01em; }
.nt h3 { margin: 26px 6px 8px; font-size: 18px; }
.nt > p, .nt .nt-note { margin: 0 6px 12px; color: var(--text-2); font-size: 14px; line-height: 1.5; max-width: 980px; }
.nt-bar { position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; padding: 10px 12px; margin: 0 0 14px;
  border-radius: 20px; background: var(--card); border: 1px solid var(--card-border); box-shadow: var(--shadow-card);
  -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); font-size: 13px; color: var(--text-2); }
.nt-clock { display: flex; align-items: baseline; gap: 8px; min-width: 150px; }
.nt-clock b { font-size: 30px; font-variant-numeric: tabular-nums; color: var(--text); letter-spacing: -.02em; }
.nt-clock i { font-style: normal; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: var(--tile); color: var(--text); }
.nt-clock i.night { background: #27304A; color: #E9EEFA; }
.nt-bar input[type="range"] { width: 260px; accent-color: var(--accent-ui); }
.nt-bar label { display: inline-flex; align-items: center; gap: 6px; }
.nt-bar select, .nt-bar button { appearance: none; border: 0; border-radius: 999px; padding: 8px 12px; font: 600 13px/1 inherit; background: var(--tile); color: var(--text); cursor: pointer; }
.nt-bar button.on { box-shadow: inset 0 0 0 1.5px var(--accent-ui); background: color-mix(in srgb, var(--accent-ui) 18%, transparent); }
.nt-bar button:active { transform: scale(.95); }
.nt-row { display: flex; flex-wrap: wrap; gap: 26px 22px; align-items: flex-start; margin: 4px 0 26px; }
.nt-row > h4 { flex: 1 0 100%; margin: 0 6px -8px; font-size: 15px; color: var(--text-2); font-weight: 600; }
.nt-cell { display: flex; flex-direction: column; gap: 10px; width: 330px; }
.nt-cap { font-size: 13px; line-height: 1.4; color: var(--text-2); min-height: 38px; padding: 0 6px; }
.nt-cap b { color: var(--text); }
.nt-cap .st { display: inline-block; margin-left: 4px; padding: 1px 8px; border-radius: 999px; background: var(--tile); color: var(--text); font-weight: 600; }

/* ---- the phone (tokens of the app: tokens.css / navy.css / ocean.css / black.css) ---- */
.ntp { --p-bg: #F2EBDD; --p-surface: #FFFDF8; --p-text: #2A231C; --p-text2: #62554A; --p-accent: #EE9443; --p-accent-text: #984A14;
  --p-line: rgba(80,50,20,.08); --p-tab: rgba(255,253,248,.88); --p-shadow: 0 8px 22px rgba(80,50,20,.08);
  --mascot-shadow: rgba(70,40,15,.20); --mascot-outline: rgba(224,171,116,.5); --buddy-z: #C9845D;
  position: relative; width: 330px; height: 680px; border-radius: 44px; overflow: hidden; background: var(--p-bg); color: var(--p-text);
  box-shadow: 0 0 0 9px #1D1D1F, 0 26px 60px rgba(40,25,10,.28); flex: none;
  font: 15px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif; }
.ntp.dark { --p-bg: #17120F; --p-surface: #2A221D; --p-text: #F5EDE3; --p-text2: #C3B5A6; --p-accent-text: #F2A25A; --p-line: rgba(255,255,255,.07);
  --p-tab: rgba(42,34,29,.9); --p-shadow: 0 8px 22px rgba(0,0,0,.35); --mascot-shadow: rgba(0,0,0,.42); --mascot-outline: rgba(255,214,170,.2); --buddy-z: #D9A27A; }
.ntp.navy { --p-bg: #0F1526; --p-surface: #1D263B; --p-text: #EEF2FA; --p-text2: #AEB9CF; --p-tab: rgba(29,38,59,.92); --mascot-outline: rgba(220,232,255,.18); }
.ntp.ocean { --p-bg: #111418; --p-surface: #1C2026; --p-text: #EDF1F6; --p-text2: #AAB4C2; --p-accent-text: #6CB6FF; --p-tab: rgba(28,32,38,.92); --mascot-outline: rgba(220,232,250,.18); }
.ntp.black { --p-bg: #000; --p-surface: #161618; --p-text: #F2F2F4; --p-text2: #B0B0B8; --p-accent-text: #E59D60; --p-tab: rgba(22,22,24,.94); --mascot-outline: rgba(255,240,225,.2); }
.ntp-screen { position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.ntp-screen::-webkit-scrollbar { display: none; }
.ntp-content { position: relative; padding: 50px 16px 130px; min-height: 900px; }
.ntp-title { font-size: 30px; font-weight: 700; letter-spacing: -.02em; margin: 6px 2px 2px; }
.ntp-sub { color: var(--p-text2); font-size: 14px; margin: 0 2px 18px; }
.ntp-label { font-size: 13px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--p-text2); margin: 0 4px 10px; }
.ntp-card { position: relative; background: var(--p-surface); border-radius: 22px; box-shadow: var(--p-shadow); margin-bottom: 16px; overflow: hidden; }
.ntp-card .cover { height: 112px; background: radial-gradient(circle at 22% 30%, #FFD9A8 0 18px, transparent 19px), linear-gradient(135deg, #F6B474, #E77F55); }
.ntp.dark .ntp-card .cover, .ntp.navy .ntp-card .cover, .ntp.ocean .ntp-card .cover, .ntp.black .ntp-card .cover { filter: brightness(.82) saturate(.9); }
.ntp-card .body { padding: 12px 14px 14px; }
.ntp-card h5 { margin: 0 0 3px; font-size: 17px; }
.ntp-card small { color: var(--p-text2); font-size: 13px; }
.ntp-card .who { display: flex; gap: 4px; margin-top: 10px; }
.ntp-card .who i { width: 26px; height: 26px; border-radius: 50%; display: block; box-shadow: 0 0 0 2px var(--p-surface); }
.ntp-card.c2 .cover { background: radial-gradient(circle at 70% 40%, #CFE6FF 0 16px, transparent 17px), linear-gradient(135deg, #9CC8F2, #7E9BE0); }
.ntp-tabs { position: absolute; left: 12px; right: 12px; bottom: 16px; height: 62px; border-radius: 31px; background: var(--p-tab); box-shadow: 0 10px 30px rgba(0,0,0,.18);
  display: flex; align-items: center; justify-content: space-around; font: 600 11px/1 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--p-text2); z-index: 10; }
.ntp-tabs .plus { width: 52px; height: 52px; border-radius: 50%; background: var(--p-accent); color: #2A1A0B; display: grid; place-items: center; font-size: 30px; font-weight: 400; }
.ntp-tabs .on { color: var(--p-accent-text); }
.ntp-head { display: flex; align-items: center; gap: 12px; margin: 4px 2px 18px; }
.ntp-avatar { width: 60px; height: 60px; border-radius: 50%; background: #F7E7B4; color: #7A5A15; display: grid; place-items: center; font-size: 26px; font-weight: 600; flex: none; }
.ntp-head b { font-size: 21px; }
.ntp-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 70px; }
.ntp-stat { position: relative; background: var(--p-surface); border-radius: 20px; padding: 13px 15px; box-shadow: var(--p-shadow); }
.ntp-stat strong { display: block; font-size: 26px; line-height: 1.1; }
.ntp-stat span { font-size: 13px; color: var(--p-text2); }
.ntp-seg { display: grid; grid-template-columns: 1fr 1fr; background: var(--p-line); border-radius: 999px; padding: 4px; margin: 18px 0 22px; }
.ntp-seg span { text-align: center; padding: 9px; border-radius: 999px; font-weight: 600; color: var(--p-text2); font-size: 14px; }
.ntp-seg .on { background: var(--p-surface); color: var(--p-text); box-shadow: 0 2px 8px rgba(0,0,0,.1); }
.ntp-list { background: var(--p-surface); border-radius: 22px; padding: 15px; margin-bottom: 14px; box-shadow: var(--p-shadow); }
.ntp-list h5 { margin: 0 0 3px; font-size: 16px; }
.ntp-list small { color: var(--p-text2); font-size: 13px; }
.ntp-list .thumbs { display: flex; gap: 7px; margin-top: 10px; }
.ntp-list .thumbs i { width: 46px; height: 46px; border-radius: 12px; display: block; }
.ntp-empty { position: relative; background: var(--p-surface); border-radius: 26px; padding: 0 18px 20px; box-shadow: var(--p-shadow); text-align: center; }
.ntp-empty .seat { position: relative; height: 112px; margin: 0 auto 4px; }
.ntp-empty h5 { margin: 0 0 14px; font-size: 19px; line-height: 1.25; }
.ntp-btn { display: block; text-align: center; height: 46px; line-height: 46px; border-radius: 999px; font-weight: 600; margin-top: 10px; background: var(--p-accent); color: #2A1A0B; }
.ntp-btn.sec { background: var(--p-line); color: var(--p-text); }
.ntp-dim { position: absolute; inset: 0; background: rgba(10,8,6,.38); z-index: 11; }
.ntp-sheet { position: absolute; left: 10px; right: 10px; bottom: 12px; z-index: 12; border-radius: 28px; padding: 18px 16px 16px; background: var(--p-surface);
  box-shadow: 0 -6px 30px rgba(0,0,0,.18); }
.ntp-sheet h5 { margin: 0 0 12px; font-size: 19px; }
.ntp-opt { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 18px; background: var(--p-line); margin-bottom: 10px; font-weight: 600; }
.ntp-opt i { width: 40px; height: 40px; border-radius: 12px; display: block; background: linear-gradient(135deg, #F6B474, #E77F55); flex: none; }
.ntp-opt.c2 i { background: linear-gradient(135deg, #9CC8F2, #7E9BE0); }
.ntp-peek { position: absolute; left: 10px; right: 10px; z-index: 13; pointer-events: none; }
.ntp .nt-actor { cursor: pointer; z-index: 5; -webkit-tap-highlight-color: transparent; }

/* ---- strips ---- */
.nt-strip { display: grid; gap: 8px; margin: 6px 0 18px; }
.nt-strip-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-end; padding-bottom: 4px; }
.nt-strip-row > b { flex: 1 0 100%; font-size: 13px; color: var(--text); margin: 6px 0 0; }
.nt-frame { position: relative; flex: none; border-radius: 14px; background: var(--strip-bg, #FFFDF8); box-shadow: 0 0 0 1px rgba(60,40,20,.1); overflow: hidden; }
.nt-frame small { position: absolute; left: 6px; top: 4px; font-size: 11px; color: var(--strip-ink, #62554A); font-variant-numeric: tabular-nums; }
.nt-frame em { position: absolute; right: 6px; top: 4px; font-size: 10px; font-style: normal; color: var(--strip-ink, #62554A); }
.nt-frame .floor { position: absolute; left: 0; right: 0; height: 2px; background: rgba(120,90,60,.18); }
.nt-strips.dark { --strip-bg: #2A221D; --strip-ink: #C3B5A6; --mascot-shadow: rgba(0,0,0,.42); --mascot-outline: rgba(255,214,170,.2); --buddy-z: #D9A27A; }
.nt-rules { font-size: 14px; line-height: 1.55; max-width: 980px; margin: 0 6px; }
.nt-rules code { font-size: 12.5px; }
.nt-rules table { border-collapse: collapse; margin: 6px 0 12px; }
.nt-rules td, .nt-rules th { padding: 6px 10px; border-bottom: 1px solid var(--tile); text-align: left; vertical-align: top; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

const STATE_RU: Record<NightState, string> = { awake: 'не спит', falling: 'засыпает…', asleep: 'спит', peek: 'приоткрыл глаз', waking: 'просыпается…' };

/** The simulated clock: a time of day that runs at `speed` (0 = stopped, 1 = real time, 60 = a minute a second). */
class SimClock {
  ms: number;
  speed: number;
  private last = performance.now();
  constructor(min: number, speed: number) {
    this.ms = atMinute(Date.now(), min);
    this.speed = speed;
  }
  tick(): void {
    const now = performance.now();
    this.ms += (now - this.last) * this.speed;
    this.last = now;
  }
  set(min: number): void {
    this.ms = atMinute(this.ms, min);
    this.last = performance.now();
  }
  get minute(): number {
    return minuteOfDay(this.ms);
  }
}

interface Settings {
  still: boolean;
  reduced: boolean;
  battery: boolean;
  drip: boolean;
  awakeMin: number;
  enabled: boolean;
}

interface Live {
  update(): void;
  setStill(still: boolean): void;
  setEnabled(on: boolean): void;
  nudge(): void;
  destroy(): void;
}

// ------------------------------------------------------------------------------------------------ the phones

function tabs(on: 'start' | 'lists'): string {
  return `<nav class="ntp-tabs"><span class="${on === 'start' ? 'on' : ''}">Start</span><span class="${on === 'lists' ? 'on' : ''}">Listen</span><span class="plus">+</span><span>Ideen</span><span>Profil</span></nav>`;
}

const AVATARS = ['#F6C07E', '#9FD3FF', '#F6A291', '#B9E3A5'];
const startMarkup = () => `<div class="ntp-screen"><div class="ntp-content">
    <div class="ntp-title">Start</div><div class="ntp-sub">Fr., 31. Oktober</div>
    <div class="ntp-label">Bald</div>
    <article class="ntp-card c1" data-nt-seat><div class="cover"></div><div class="body"><h5>Spieleabend bei Lena</h5><small>Sa., 1. Nov · 19:30 · 4 kommen</small>
      <div class="who">${AVATARS.map((c) => `<i style="background:${c}"></i>`).join('')}</div></div></article>
    <article class="ntp-card c2"><div class="cover"></div><div class="body"><h5>Geburtstag von Max</h5><small>Do., 6. Nov · ganztägig</small></div></article>
    <article class="ntp-card"><div class="body"><h5>Kino</h5><small>Sa., 8. Nov · 20:15</small></div></article>
  </div></div>${tabs('start')}`;
const listsMarkup = (seg: 'mine' | 'friends') => `<div class="ntp-screen"><div class="ntp-content">
    <div class="ntp-head"><div class="ntp-avatar">K</div><b>Felix</b></div>
    ${seg === 'mine' ? `<div class="ntp-stats"><div class="ntp-stat"><strong>20</strong><span>Wünsche</span></div><div class="ntp-stat" data-nt-seat><strong>4</strong><span>Mit dir geteilt</span></div></div>` : ''}
    <div class="ntp-seg"><span class="${seg === 'mine' ? 'on' : ''}">Meine</span><span class="${seg === 'friends' ? 'on' : ''}">Freunde</span></div>
    ${seg === 'mine'
      ? `<div class="ntp-list"><h5>Geburtstag 2026</h5><small>5 Wünsche · Meine Follower</small><div class="thumbs"><i style="background:#F6C07E"></i><i style="background:#9FD3FF"></i><i style="background:#F6A291"></i></div></div>
         <div class="ntp-list"><h5>Weihnachten</h5><small>8 Wünsche · Nur ich</small><div class="thumbs"><i style="background:#D64545"></i><i style="background:#B9E3A5"></i><i style="background:#FFE08A"></i></div></div>
         <div class="ntp-list"><h5>Bücher</h5><small>4 Wünsche · Nur ich</small><div class="thumbs"><i style="background:#E9C493"></i><i style="background:#8E6450"></i></div></div>`
      : `<section class="ntp-empty"><div class="seat" data-nt-seat></div><h5>Folge Freunden, dann siehst du hier ihre Wünsche</h5>
           <span class="ntp-btn">Deinen Link teilen</span><span class="ntp-btn sec">Code eingeben</span></section>`}
  </div></div>${tabs('lists')}`;
const plusMarkup = () => `<div class="ntp-screen" style="overflow:hidden"><div class="ntp-content">
    <div class="ntp-title">Start</div><div class="ntp-sub">Fr., 31. Oktober</div><div class="ntp-label">Bald</div>
    <article class="ntp-card c1"><div class="cover"></div><div class="body"><h5>Spieleabend bei Lena</h5><small>Sa., 1. Nov · 19:30</small></div></article>
  </div></div>${tabs('start')}<div class="ntp-dim"></div>
  <div class="ntp-sheet"><h5>Neu</h5><div class="ntp-opt"><i></i>Anlass planen</div><div class="ntp-opt c2"><i></i>Wunsch hinzufügen</div><span class="ntp-btn">Weiter</span></div>`;

/** A phone with one sleeping mascot (Start / Listen / Freunde). */
function mascotPhone(cell: HTMLElement, place: Exclude<Place, 'plus'>, theme: Theme, clock: SimClock, s: Settings, lag: number, onState: (t: string) => void): Live {
  const phone = el('div', `ntp ${theme === 'light' ? '' : `dark ${theme}`}`);
  phone.innerHTML = place === 'start' ? startMarkup() : listsMarkup(place === 'lists' ? 'mine' : 'friends');
  cell.prepend(phone);
  const content = phone.querySelector<HTMLElement>('.ntp-content');
  const seat = phone.querySelector<HTMLElement>('[data-nt-seat]');
  const screen = phone.querySelector<HTMLElement>('.ntp-screen');
  if (!content || !seat || !screen) throw new Error('[night] phone markup');
  const kind: NightKind = place === 'friends' ? 'hamster' : 'bunny';
  const size = place === 'friends' ? 160 : 96;
  const m = new NightMascot(content, {
    kind,
    size,
    binoculars: place === 'friends',
    coat: kind === 'bunny' ? 'fawn' : 'golden',
    now: () => clock.ms - lag,
    still: s.still,
    drip: s.drip,
    enabled: s.enabled,
    awakeMs: s.awakeMin * 60_000,
    onChange: (st, me) => onState(stateText(st, me, clock)),
  });
  // feet on the top edge of the seat: Start = the first card near its right corner, Listen = the right stats tile,
  // Freunde = centred at the top of the empty card (like FriendsEmpty: Tapsi stands above the title)
  const place1 = () => {
    const box = m.rig.box;
    const cr = content.getBoundingClientRect();
    const r = seat.getBoundingClientRect();
    const left = place === 'friends' ? r.left - cr.left + (r.width - size) / 2 : r.right - cr.left - size - (place === 'start' ? 6 : -6);
    const top = place === 'friends' ? r.bottom - cr.top - m.rig.feet - 2 : r.top - cr.top - m.rig.feet + 2;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  };
  place1();
  m.rig.box.setAttribute('role', 'button');
  m.rig.box.setAttribute('aria-label', kind === 'bunny' ? 'Pompon wecken' : 'Tapsi wecken');
  // the person scrolls the screen elsewhere: a sleepy peek, never more
  screen.addEventListener('scroll', () => m.nudge(), { passive: true });
  onState(stateText(m.state, m, clock));
  return {
    update: () => m.update(),
    setStill: (v) => m.setStill(v),
    setEnabled: (v) => m.setEnabled(v),
    nudge: () => {
      screen.scrollTo({ top: 60, behavior: 'smooth' });
      setTimeout(() => screen.scrollTo({ top: 0, behavior: 'smooth' }), 700);
    },
    destroy: () => m.destroy(),
  };
}

function stateText(st: NightState, m: NightMascot, clock: SimClock): string {
  if (st === 'awake' && m.awakeUntil > clock.ms && isNight(clock.minute)) return `не спит до ${fmtTime(minuteOfDay(m.awakeUntil))}, потом снова уснёт`;
  if (st === 'awake') return isNight(clock.minute) ? 'не спит' : 'день: как сейчас в приложении';
  return `${STATE_RU[st]}${st === 'asleep' ? (m.still ? ' (неподвижно)' : ' · коснись — проснётся') : ''}`;
}

/** The "+" menu: Pompon peeks over the sheet — at night the approved `sleepy` preset (src/welcome.ts, unchanged). */
function plusPhone(cell: HTMLElement, theme: Theme, clock: SimClock, s: Settings, onState: (t: string) => void): Live & { reopen(): void } {
  const phone = el('div', `ntp ${theme === 'light' ? '' : `dark ${theme}`}`);
  phone.innerHTML = plusMarkup();
  cell.prepend(phone);
  const sheet = phone.querySelector<HTMLElement>('.ntp-sheet');
  if (!sheet) throw new Error('[night] plus markup');
  const host = el('div', 'ntp-peek');
  phone.append(host);
  let stage: WelcomeStage | null = null;
  let night: boolean | null = null;
  const open = () => {
    stage?.destroy();
    night = s.enabled && isNight(clock.minute);
    const sheetTop = phone.clientHeight - 12 - sheet.offsetHeight;
    host.style.top = `${sheetTop - 124}px`;
    host.style.height = '140px';
    stage = new WelcomeStage(host, {
      bunnies: ['fawn'],
      choreography: night ? 'sleepy' : 'peek-once',
      edgeInset: { bottom: 16 },
      edgeRadius: { bottom: 28 },
      minSize: 96,
      maxSize: 104,
      reducedMotion: s.still ? 'force' : 'off',
      calmEyes: night ? 'sleep' : 'happy',
    });
    stage.play();
    onState(night ? 'ночью: `sleepy` — выглянул, зевнул, задремал на краю (одобренный пресет, как на юр. страницах)' : 'день: `peek` — как сейчас в приложении');
  };
  open();
  return {
    update: () => {
      if ((s.enabled && isNight(clock.minute)) !== night) open();
    },
    setStill: () => open(),
    setEnabled: () => open(),
    nudge: () => undefined,
    reopen: open,
    destroy: () => stage?.destroy(),
  };
}

// ------------------------------------------------------------------------------------------------ the strips

function frameRig(parent: HTMLElement, kind: NightKind, size: number): NightRig {
  const k = size / 400;
  const geoH = kind === 'bunny' ? 260 : 250;
  const frame = el('div', 'nt-frame');
  frame.style.width = `${size + 16}px`;
  frame.style.height = `${Math.round(geoH * k) + 30}px`;
  parent.append(frame);
  const rig = mountNightPuppet(frame, { kind, size, binoculars: kind === 'hamster', coat: kind === 'bunny' ? 'fawn' : 'golden', idle: false });
  rig.box.style.left = '8px';
  rig.box.style.top = '22px';
  const floor = el('i', 'floor');
  floor.style.top = `${22 + rig.feet}px`;
  frame.prepend(floor);
  rig.takeOver();
  return rig;
}

/** Awake, as he usually looks when night starts: Tapsi with the binoculars up at his eyes (his look-around loop). */
function awakeFrom(rig: NightRig): Pose {
  return rig.binoculars ? { ...restPose(rig), bino: { ...NEUTRAL.bino }, glint: { x: 0 } } : restPose(rig);
}

const MARK_RU: Record<string, string> = { yawn: 'зевок', nod: 'клюёт носом', settle: 'уснул', startle: 'ой!', rub: 'трёт глаза', look: 'бинокль', stretch: 'потянулся', wave: 'машет', open: 'открыл глаза', peek: 'глазок' };

function stripRow(parent: HTMLElement, label: string, kind: NightKind, size: number, frames: number, which: 'fall' | 'wake' | 'morning' | 'peek' | 'loop', drip: boolean, at: number | null = null): void {
  const row = el('div', 'nt-strip-row');
  row.append(el('b', undefined, label));
  parent.append(row);
  const author = (rig: NightRig): Shot => {
    if (which === 'fall') return authorFall(rig, awakeFrom(rig), drip);
    if (which === 'peek') return authorPeek(rig, asleepPose(rig, drip));
    return authorWake(rig, asleepPose(rig, drip), which === 'wake' ? 'tap' : 'morning');
  };
  for (let i = 0; i < frames; i++) {
    const rig = frameRig(row, kind, size);
    const frame = rig.box.parentElement as HTMLElement;
    if (which === 'loop') {
      const t = at ?? (Z_S * i) / Math.max(1, frames - 1);
      rig.apply(asleepPose(rig, drip));
      freezeAt(sleepLoops(rig, drip), t);
      frame.append(el('small', undefined, `${t.toFixed(1)} s`));
      continue;
    }
    const shot = author(rig);
    const t = at ?? (shot.duration * i) / Math.max(1, frames - 1);
    // the pose the moment starts from (parts it never moves keep it), then every track's value at t
    rig.apply(which === 'fall' ? awakeFrom(rig) : asleepPose(rig, drip));
    freezeAt(shot.tracks, t);
    frame.append(el('small', undefined, `${t.toFixed(2)} s`));
    const mark = Object.entries(shot.marks).filter(([, at]) => at <= t + 1e-6).sort((a, b) => b[1] - a[1])[0];
    if (mark) frame.append(el('em', undefined, MARK_RU[mark[0]] ?? mark[0]));
  }
}

function strips(parent: HTMLElement, q: URLSearchParams, s: Settings): void {
  const box = el('div', `nt-strips${q.get('theme') === 'dark' ? ' dark' : ''}`);
  parent.append(box);
  const size = Math.max(64, Math.min(480, Number(q.get('size')) || 120));
  const at = q.get('t') !== null && Number.isFinite(Number(q.get('t'))) ? Number(q.get('t')) : null;
  const frames = at !== null ? 1 : Math.max(2, Math.min(16, Number(q.get('frames')) || 10));
  const only = q.get('strip');
  const kinds: NightKind[] = q.get('kind') === 'hamster' ? ['hamster'] : q.get('kind') === 'bunny' ? ['bunny'] : ['bunny', 'hamster'];
  const rows: ReadonlyArray<['fall' | 'wake' | 'morning' | 'peek' | 'loop', string, number]> = [
    ['fall', 'Засыпает (1,95 с)', frames],
    ['loop', `Спит: петля (дыхание ${BREATH_S} с, «z» раз в ${Z_S} с)`, Math.min(frames, 7)],
    ['peek', 'Скролл рядом: глазок (0,85 с)', Math.min(frames, 7)],
    ['wake', 'Касание: просыпается (2,0 с)', frames],
    ['morning', 'Утро 07:00: сам просыпается (2,0 с)', frames],
  ];
  for (const kind of kinds) {
    const g = el('div', 'nt-strip');
    g.append(el('h4', undefined, kind === 'bunny' ? 'Помпон (кролик)' : 'Тапси с биноклем'));
    box.append(g);
    for (const [which, label, n] of rows) if (!only || only === which) stripRow(g, label, kind, size, at !== null ? 1 : n, which, s.drip, at);
  }
}

// ------------------------------------------------------------------------------------------------ the page

export function nightGallery(app: HTMLElement, q: URLSearchParams): void {
  app.replaceChildren();
  // four phones side by side (the gallery page is 1000 px wide by default)
  app.style.maxWidth = 'none';
  const style = document.createElement('style');
  style.textContent = CSS_TEXT;
  document.head.append(style);
  const view = q.get('view');
  const reduced = q.get('reduced') === '1';
  const battery = q.get('battery') === '1';
  const s: Settings = {
    reduced,
    battery,
    still: reduced || battery,
    drip: q.get('drip') !== '0',
    awakeMin: Math.max(1, Number(q.get('awake')) || 10),
    enabled: q.get('off') !== '1',
  };
  const askedTheme = q.get('theme') ?? 'both';
  const themes: Theme[] =
    askedTheme === 'all' ? THEMES.map(([t]) => t)
      : askedTheme === 'night' ? ['dark', 'navy', 'ocean', 'black']
        : THEMES.some(([t]) => t === askedTheme) ? [askedTheme as Theme]
          : ['light', 'dark'];
  if (themes.length === 1 && themes[0] !== 'light') document.documentElement.dataset.theme = 'dark';

  const section = el('section', 'nt');
  app.append(section);
  if (view !== 'strips') {
    section.insertAdjacentHTML('beforeend', `<h2>Ночью маскоты спят — прототип (31.10)</h2>
      <p><b>Одобрено 31.10 и уже в приложении</b> (Start, Listen, Freunde, «+»; переключатель «Nachts schlafen»). С 23:00 до 07:00 Помпон и Тапси спят там, где
      живут: зевают, клюют носом и засыпают (≤ 2 с), потом только медленно дышат, и изредка всплывает «z». <b>Коснись спящего</b> —
      он вздрогнет, потрёт глаза, потянется и помашет (2 с), потом 10 минут не спит и снова засыпает. Если листаешь экран рядом —
      он лишь приоткроет один глаз и спит дальше. «Меньше движения» или экономия батареи — неподвижная спящая поза.</p>`);
  }

  const startMin = parseTime(q.get('time')) ?? 23 * 60 + 30;
  const clock = new SimClock(startMin, Math.max(0, Number(q.get('speed') ?? 1) || 0));
  const lives: Live[] = [];
  const plusLives: Array<Live & { reopen(): void }> = [];

  // ---- the bar
  let readout: HTMLElement | null = null;
  let badge: HTMLElement | null = null;
  let range: HTMLInputElement | null = null;
  const toRange = (min: number) => (((min - (22 * 60 + 30)) % 1440) + 1440) % 1440;
  if (view !== 'strips') {
    const bar = el('div', 'nt-bar');
    section.append(bar);
    const clk = el('div', 'nt-clock');
    readout = el('b');
    badge = el('i');
    clk.append(readout, badge);
    range = el('input');
    range.type = 'range';
    range.min = '0';
    range.max = '540';
    range.step = '1';
    range.setAttribute('aria-label', 'Время');
    const jump = (label: string, min: number, speed: number) => {
      const b = el('button', undefined, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        clock.set(min);
        clock.speed = speed;
        syncSpeed();
        tick();
      });
      return b;
    };
    const speedBtns: Array<[HTMLButtonElement, number]> = [];
    const speedBtn = (label: string, v: number) => {
      const b = el('button', undefined, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        clock.speed = v;
        syncSpeed();
      });
      speedBtns.push([b, v]);
      return b;
    };
    const syncSpeed = () => speedBtns.forEach(([b, v]) => b.classList.toggle('on', clock.speed === v));
    range.addEventListener('input', () => {
      clock.set(22 * 60 + 30 + Number(range?.value ?? 0));
      tick();
    });
    const themeSel = el('select');
    themeSel.setAttribute('aria-label', 'Тема');
    for (const [v, label] of [['both', 'Светлая + Тёмная'], ...THEMES, ['night', 'Все ночные темы'], ['all', 'Все 5 тем']] as const) themeSel.add(new Option(label, v));
    themeSel.value = askedTheme;
    themeSel.addEventListener('change', () => go({ theme: themeSel.value }));
    const motionSel = el('select');
    motionSel.setAttribute('aria-label', 'Движение');
    motionSel.add(new Option('Движение: полное', '0'));
    motionSel.add(new Option('Движение: меньше (reduced)', '1'));
    motionSel.value = reduced ? '1' : '0';
    motionSel.addEventListener('change', () => {
      s.reduced = motionSel.value === '1';
      applyStill();
    });
    const bat = el('label');
    const batBox = el('input');
    batBox.type = 'checkbox';
    batBox.checked = battery;
    batBox.addEventListener('change', () => {
      s.battery = batBox.checked;
      applyStill();
    });
    bat.append(batBox, 'Экономия батареи (≤ 20 %)');
    const drip = el('label');
    const dripBox = el('input');
    dripBox.type = 'checkbox';
    dripBox.checked = s.drip;
    dripBox.addEventListener('change', () => go({ drip: dripBox.checked ? null : '0' }));
    drip.append(dripBox, 'Сопля стекает');
    const sw = el('label');
    const swBox = el('input');
    swBox.type = 'checkbox';
    swBox.checked = s.enabled;
    swBox.addEventListener('change', () => {
      s.enabled = swBox.checked;
      lives.forEach((l) => l.setEnabled(s.enabled));
      plusLives.forEach((l) => l.setEnabled(s.enabled));
    });
    sw.append(swBox, '«Nachts schlafen»');
    const awakeSel = el('select');
    awakeSel.setAttribute('aria-label', 'Не спит после касания');
    for (const v of [1, 2, 5, 10, 20]) awakeSel.add(new Option(`после касания не спит ${v} мин`, String(v)));
    awakeSel.value = String(s.awakeMin);
    awakeSel.addEventListener('change', () => go({ awake: awakeSel.value }));
    const scroll = el('button', undefined, 'Листать рядом');
    scroll.type = 'button';
    scroll.addEventListener('click', () => lives.forEach((l) => l.nudge()));
    const reopen = el('button', undefined, 'Открыть «+» снова');
    reopen.type = 'button';
    reopen.addEventListener('click', () => plusLives.forEach((l) => l.reopen()));
    bar.append(
      clk, range, jump('22:59 → 23:00', 22 * 60 + 59 + 56 / 60, 1), jump('06:59 → 07:00', 6 * 60 + 59 + 56 / 60, 1), jump('23:30', 23 * 60 + 30, 1),
      speedBtn('⏸', 0), speedBtn('×1', 1), speedBtn('×60', 60),
      themeSel, motionSel, bat, drip, sw, awakeSel, scroll, reopen,
    );
    syncSpeed();
  }

  const applyStill = () => {
    s.still = s.reduced || s.battery;
    lives.forEach((l) => l.setStill(s.still));
    plusLives.forEach((l) => l.setStill(s.still));
  };
  const go = (patch: Record<string, string | null>) => {
    const u = new URL(location.href);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) u.searchParams.delete(k);
      else u.searchParams.set(k, v);
    }
    u.searchParams.set('time', fmtTime(clock.minute));
    location.href = u.toString();
  };

  // ---- the phones
  if (view !== 'strips') {
    const onlyPlace = q.get('place');
    for (const theme of themes) {
      const row = el('div', 'nt-row');
      row.append(el('h4', undefined, THEMES.find(([t]) => t === theme)?.[1] ?? theme));
      section.append(row);
      let lag = 0;
      for (const [place, title] of PLACES) {
        if (onlyPlace && onlyPlace !== place) continue;
        const cell = el('div', 'nt-cell');
        const cap = el('div', 'nt-cap');
        const head = el('b', undefined, title);
        const st = el('span', 'st');
        cap.append(head, el('br'), st);
        cell.append(cap);
        row.append(cell);
        const say = (t: string) => (st.textContent = t);
        if (place === 'plus') plusLives.push(plusPhone(cell, theme, clock, s, say));
        else lives.push(mascotPhone(cell, place, theme, clock, s, lag, say));
        // one after another on the screen row: the night does not start in every phone at the same millisecond
        lag += 700;
      }
    }
  }

  // ---- the strips
  if (view !== 'phones') {
    if (view !== 'strips') section.append(el('h3', undefined, 'Кадры (замороженные, те же ключи, что и анимация)'));
    strips(section, q, s);
  }

  if (view !== 'strips' && view !== 'phones') {
    const rules = el('div', 'nt-rules');
    rules.innerHTML = `<h3>Предложение: правила и переключатель</h3>
      <table>
        <tr><th>Когда спят</th><td>23:00 – 07:00 по часам телефона (не по тёмной теме: ею многие пользуются весь день)</td></tr>
        <tr><th>Открыл приложение ночью</th><td>маскот уже спит (без анимации засыпания — он уснул раньше)</td></tr>
        <tr><th>Часы дошли до 23:00, маскот на экране</th><td>засыпает (1,95 с), дальше — только дыхание и «z»</td></tr>
        <tr><th>Касание</th><td>просыпается (2,0 с, можно коснуться и во время засыпания — проснётся с того кадра); второе касание во время пробуждения ничего не ломает (игнорируется)</td></tr>
        <tr><th>После касания</th><td>не спит 10 минут после последнего касания, потом снова засыпает</td></tr>
        <tr><th>Листаешь рядом</th><td>только приоткрывает глаз (не чаще раза в 20 с), спит дальше</td></tr>
        <tr><th>07:00</th><td>если на экране — сам просыпается (без «ой!»), иначе просто уже бодрый</td></tr>
        <tr><th>Меньше движения / батарея</th><td>неподвижная спящая поза с неподвижной «z»; касание будит сразу, без анимации</td></tr>
        <tr><th>Где</th><td>Start (угол первой карточки), Listen (Помпон-дружок не гуляет, спит на плашке), Freunde (Тапси, бинокль на животике), «+» (одобренный <code>sleepy</code>)</td></tr>
      </table>
      <p><b>Переключатель</b> (Einstellungen → Bewegung, под «Kaninchen zeigen», по умолчанию включён) — теперь есть в приложении:<br>
      DE: <b>Nachts schlafen</b> — «Von 23 bis 7 Uhr schlafen {{bunny}} und {{hamster}}. Antippen weckt sie.»<br>
      RU: <b>Ночью спят</b> — «С 23:00 до 7:00 {{bunny}} и {{hamster}} спят. Коснись — проснутся.»</p>`;
    section.append(rules);
  }

  // ---- the clock
  const tick = () => {
    clock.tick();
    if (readout) readout.textContent = fmtTime(clock.minute);
    if (badge) {
      const n = isNight(clock.minute);
      badge.textContent = n ? 'ночь' : 'день';
      badge.className = n ? 'night' : '';
    }
    if (range && document.activeElement !== range) range.value = String(Math.min(540, toRange(clock.minute)));
    lives.forEach((l) => l.update());
    plusLives.forEach((l) => l.update());
  };
  tick();
  if (view !== 'strips') setInterval(tick, 100);
  (window as unknown as { night: { clock: SimClock; lives: Live[] } }).night = { clock, lives };
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset.ready = '1')));
}
