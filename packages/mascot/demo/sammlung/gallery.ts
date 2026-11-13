/**
 * Gallery page «Pompons Sammlung» (27.10, GALLERY-ONLY prototype; idea: docs/ideas/2026-10-27-pompons-sammlung.md,
 * design: docs/design/2026-10-27-pompons-sammlung.md). Nothing here is in the app.
 *
 * Two phones: the collection page that would sit in Profil (cards for every hidden scene: found = in colour, a tap
 * replays the package's own scene in a sheet; not found = a silhouette + a spoiler-free hint) and its wardrobe
 * (six outfits, earned by finds — option A or B — and «nach Jahreszeit» by the date). Under the phones: Pompon in
 * every outfit, front and 3/4.
 *
 *   ?screens=sammlung
 *     &found=tower,speck|all|none   which scenes count as found (default: four of nine)
 *     &earn=A|B                     how outfits are earned (default B, the recommendation)
 *     &date=6.12 [&birthday=1]      the date the season switch shows (default: today)
 *     &wear=auto|none|<outfit>      the wardrobe choice (default auto = «nach Jahreszeit»)
 *     &reduced=1 · &mascots=0       «Weniger» · «Kaninchen zeigen: aus»
 *     &theme=dark · &lang=ru        night colours · Russian phone texts (default German, the app's language)
 *     &open=<scene> [&t=1.2]        the replay sheet open on that scene (t = a frozen frame, for screenshots)
 *     &niko=1|2|3 · &winter=1|2|3   which hat the phones use (31.10: the NEW hats, demo/costumes/hats.ts; default = Felix's pick: niko 2, winter 3)
 *     &hats=old [&niko=a|b …]       the 28.10 hats instead (rejected by Felix 31.10; kept for comparison)
 *     &view=hats                    only the hat comparison (all variants: big, 3/4, tile size, the put-on frames)
 *     &view=phones                  only the two phones (screenshots) · &tall=1 = the phones unrolled (whole page)
 */

import { addCss, applyPageTheme, el, markReady, PAPER_CSS, themeOf, type Theme } from '../parade/kit';
import { Bunny } from '../../src/index';
import type { DayMonth } from '../wardrobe/items';
import { mountShow, scene, SCENE_IDS, SCENES, type SceneCard, type SceneId, type Show } from './scenes';
import { DEFAULT_HATS, DROP_MS, dress, dropIn, OLD_HATS, outfit, OUTFIT_IDS, OUTFITS, seasonOutfit, unlocked, wornNow, type EarnMode, type HatChoice, type OutfitId, type WearChoice } from './outfits';
import { HAT_VARIANTS, hatSpec, type HatId, type HatVariant } from './hats';
import { NEW_HAT_VARIANTS } from '../costumes/hats';

type Lang = 'de' | 'ru';
type Motion = 'full' | 'reduced' | 'off';

const T = {
  title: { de: 'Pompons Sammlung', ru: 'Коллекция Помпона' },
  back: { de: 'Profil', ru: 'Профиль' },
  scenes: { de: 'Szenen', ru: 'Сцены' },
  wardrobe: { de: 'Garderobe', ru: 'Гардероб' },
  count: { de: '{n} von {m} gefunden', ru: 'Найдено {n} из {m}' },
  tapHint: { de: 'Tippe auf eine Karte, um die Szene nochmal zu sehen.', ru: 'Коснись карточки, чтобы посмотреть сцену ещё раз.' },
  secret: { de: 'Noch geheim', ru: 'Пока секрет' },
  again: { de: 'Nochmal', ru: 'Ещё раз' },
  close: { de: 'Schließen', ru: 'Закрыть' },
  calm: { de: 'Weniger Bewegung: die ruhige Fassung', ru: '«Меньше движения»: спокойная версия' },
  device: { de: 'Nur auf diesem Gerät gespeichert. Niemand sonst sieht deine Sammlung.', ru: 'Хранится только на этом устройстве. Твою коллекцию не видит никто.' },
  season: { de: 'Nach Jahreszeit', ru: 'По сезону' },
  seasonSub: { de: 'Pompon zieht sich passend zum Datum um.', ru: 'Помпон сам одевается по дате.' },
  today: { de: 'Heute', ru: 'Сегодня' },
  nothing: { de: 'Nichts anziehen', ru: 'Без наряда' },
  wearsNothing: { de: 'ohne Outfit', ru: 'без наряда' },
  worn: { de: 'trägt er', ru: 'надето' },
  free: { de: 'gehört dir', ru: 'твой' },
  inSeason: { de: 'gerade Saison', ru: 'сейчас сезон' },
  more: { de: 'noch {k} {scenes}', ru: 'ещё {k} {scenes}' },
  earnA: { de: 'Jede gefundene Szene schenkt Pompon ein neues Outfit.', ru: 'Каждая найденная сцена дарит Помпону новый наряд.' },
  earnB: { de: 'Zur Saison trägt Pompon es von selbst. Jede gefundene Szene schenkt dir eins fürs ganze Jahr.', ru: 'В свой сезон Помпон носит наряд сам. Каждая найденная сцена дарит один наряд на весь год.' },
  locked: { de: 'Finde noch {k} {scenes}, dann gehört es dir.', ru: 'Найди ещё {k} {scenes} — и наряд твой.' },
  entry: { de: 'Pompons Sammlung', ru: 'Коллекция Помпона' },
} as const;

const CSS = `
.sm-page { max-width: 1240px; margin: 0 auto; padding: 8px 16px 56px; box-sizing: border-box; color: var(--text); }
.sm-page h2 { margin: 6px 0 4px; font-size: 26px; letter-spacing: -.02em; }
.sm-page h3 { margin: 26px 0 6px; font-size: 19px; }
.sm-lead { margin: 0 0 14px; color: var(--text-2); font-size: 14px; max-width: 860px; line-height: 1.5; }
.sm-controls { display: grid; gap: 8px; margin: 0 0 18px; font-size: 13px; color: var(--text-2); }
.sm-controls .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-start; margin: 0; }
.sm-controls .row > b { min-width: 150px; color: var(--text); font-weight: 600; }
.sm-chip { appearance: none; border: 0; border-radius: 999px; padding: 7px 12px; font: 600 13px/1 inherit; background: var(--tile); color: var(--text); cursor: pointer;
  transition: transform .25s cubic-bezier(.34,1.56,.64,1); min-height: 32px; }
.sm-chip:active { transform: scale(.94); }
.sm-chip[aria-pressed="true"] { background: color-mix(in srgb, #F0A04B 24%, transparent); box-shadow: inset 0 0 0 1.5px #F0A04B; }
.sm-phones { display: flex; flex-wrap: wrap; gap: 36px; justify-content: center; align-items: flex-start; }
.sm-col { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.sm-col > small { font-size: 12px; color: var(--text-2); }

/* ---- the phone ---- */
.sm-phone { width: 390px; height: 844px; box-sizing: border-box; display: flex; flex-direction: column; }
.sm-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 28px; scrollbar-width: none; }
.sm-scroll::-webkit-scrollbar { display: none; }
.sm-phone.tall { height: auto; min-height: 844px; }
.sm-phone.tall .sm-scroll { overflow: visible; }
.sm-status { height: 47px; display: flex; align-items: center; justify-content: space-between; padding: 0 30px; font-size: 15px; font-weight: 600; }
.sm-nav { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; height: 44px; padding: 0 12px; }
.sm-nav span:first-child { color: var(--accent-text); font-size: 17px; }
.sm-nav b { font-size: 17px; }
.sm-seg { margin: 6px 16px 14px; display: grid; grid-template-columns: 1fr 1fr; padding: 3px; border-radius: 12px; background: var(--fill); }
.sm-seg button { appearance: none; border: 0; background: transparent; border-radius: 9px; min-height: 36px; font: 600 14px/1 inherit; color: var(--text-2); cursor: pointer; }
.sm-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: 0 1px 3px rgba(60,35,10,.12); }
.sm-sum { margin: 0 16px 4px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.sm-sum b { font-size: 22px; letter-spacing: -.01em; }
.sm-dots { display: flex; gap: 4px; }
.sm-dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--separator); }
.sm-dots i.on { background: #EE9443; }
.sm-tip { margin: 0 16px 12px; font-size: 13px; color: var(--text-2); }
.sm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 0 16px; }
.sm-card { display: flex; flex-direction: column; justify-content: flex-start; position: relative; appearance: none; border: 0; padding: 0; text-align: left; font: inherit; color: inherit; border-radius: 20px; overflow: hidden;
  cursor: pointer; min-height: 44px; transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.sm-card:active { transform: scale(.97); }
.sm-card:focus-visible { outline: 3px solid #EE9443; outline-offset: 2px; }
.sm-card.locked { cursor: default; }
.sm-card.locked:active { transform: none; }
.sm-thumb { flex: none; position: relative; height: 108px; overflow: hidden; background: var(--accent-50); }
.sm-card.locked .sm-thumb { background: var(--fill); }
.sm-thumb .sm-layer { position: absolute; inset: 0; }
.sm-nat { position: absolute; left: 50%; bottom: 0; transform-origin: 50% 100%; pointer-events: none; }
.sm-layer.sil .sm-nat { filter: brightness(0); opacity: .12; }
.bp-paper.dark .sm-layer.sil .sm-nat { filter: brightness(0) invert(1); opacity: .13; }
.sm-q { position: absolute; right: 10px; top: 8px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 14px; font-weight: 700;
  color: var(--text-3); background: var(--surface); box-shadow: 0 1px 2px rgba(60,35,10,.1); }
.sm-text { padding: 9px 12px 12px; display: grid; gap: 3px; }
.sm-text b { font-size: 15px; line-height: 1.2; }
.sm-text span { font-size: 12px; line-height: 1.35; color: var(--text-2); }
.sm-text em { font-style: normal; font-size: 11px; color: var(--text-3); }
.sm-foot { margin: 16px 20px 0; font-size: 12px; color: var(--text-3); text-align: center; line-height: 1.4; }
.sm-scene-host { position: absolute; }
.sm-ledge { position: absolute; left: 16px; right: 16px; height: 60px; border-radius: 22px; background-color: var(--panel-bg); background-image: var(--panel-sheen);
  box-shadow: var(--panel-edge), var(--panel-shadow); }
.sm-buddy-card { position: absolute; background-color: var(--panel-bg); background-image: var(--panel-sheen); box-shadow: var(--panel-edge), var(--panel-shadow); }

/* ---- the replay sheet ---- */
.sm-scrim { position: absolute; inset: 0; background: rgba(30,18,8,.28); opacity: 0; pointer-events: none; transition: opacity .3s ease; z-index: 8; }
.sm-sheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 9; border-radius: 28px 28px 0 0; padding: 8px 16px 30px; background: color-mix(in srgb, var(--surface) 95%, transparent);
  -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); box-shadow: 0 -12px 34px rgba(60,35,10,.16);
  transform: translateY(105%); transition: transform .45s cubic-bezier(.32,.9,.3,1); }
.sm-phone.sheet-open .sm-scrim { opacity: 1; pointer-events: auto; }
.sm-phone.sheet-open .sm-sheet { transform: translateY(0); }
.sm-grab { width: 38px; height: 5px; border-radius: 3px; background: var(--separator); margin: 0 auto 10px; }
.sm-sheet h4 { margin: 0 4px 2px; font-size: 19px; }
.sm-sheet p { margin: 0 4px 10px; font-size: 13px; color: var(--text-2); }
.sm-stage { position: relative; height: 230px; overflow: hidden; border-radius: 20px; background: var(--accent-50); }
.sm-btns { display: flex; gap: 10px; margin-top: 12px; }
.sm-btns button { flex: 1; appearance: none; border: 0; min-height: 48px; border-radius: 999px; font: 600 16px/1 inherit; cursor: pointer; background: var(--fill); color: var(--text); }
.sm-btns button.primary { background: #EE9443; color: #2A1A0B; }

/* ---- the wardrobe ---- */
.sm-dressing { margin: 0 16px; height: 250px; position: relative; border-radius: 24px; overflow: hidden; background: var(--accent-50); }
.sm-dressing .sm-floor { position: absolute; left: 22px; right: 22px; bottom: 0; height: 30px; border-radius: 22px 22px 0 0; background-color: var(--panel-bg);
  background-image: var(--panel-sheen); box-shadow: var(--panel-edge), var(--panel-shadow); }
.sm-dressing .sm-pompon { position: absolute; left: 50%; bottom: 22px; width: 260px; margin-left: -130px; }
.sm-dressing .sm-cap { position: absolute; left: 14px; top: 12px; font-size: 13px; color: var(--text-2); }
.sm-dressing .sm-cap b { color: var(--text); }
.sm-row { margin: 14px 16px 0; padding: 12px 14px; border-radius: 18px; display: flex; align-items: center; gap: 12px; }
.sm-row div { flex: 1; display: grid; gap: 2px; }
.sm-row b { font-size: 16px; font-weight: 600; }
.sm-row span { font-size: 12px; color: var(--text-2); }
.sm-switch { appearance: none; border: 0; width: 51px; height: 31px; border-radius: 999px; background: var(--separator); position: relative; cursor: pointer; flex: none; padding: 0; }
.sm-switch::after { content: ''; position: absolute; left: 2px; top: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.2);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.sm-switch[aria-checked="true"] { background: #34C759; }
.sm-switch[aria-checked="true"]::after { transform: translateX(20px); }
.sm-outfits { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 14px 16px 0; }
.sm-tile { align-content: start; appearance: none; border: 0; padding: 0 0 8px; border-radius: 18px; overflow: hidden; font: inherit; color: inherit; cursor: pointer; text-align: center;
  display: grid; gap: 2px; transition: transform .3s cubic-bezier(.34,1.56,.64,1); min-height: 44px; }
.sm-tile:active { transform: scale(.96); }
.sm-tile:focus-visible { outline: 3px solid #EE9443; outline-offset: 2px; }
.sm-tile .sm-mini { height: 118px; position: relative; overflow: hidden; background: var(--accent-50); }
.sm-tile.locked .sm-mini { background: var(--fill); }
.sm-tile.locked .sm-mini > div { filter: brightness(0); opacity: .12; }
.bp-paper.dark .sm-tile.locked .sm-mini > div { filter: brightness(0) invert(1); opacity: .13; }
.sm-tile .sm-mini > div { position: absolute; left: 50%; bottom: 0; width: 156px; margin-left: -78px; }
.sm-tile b { font-size: 13px; padding: 4px 6px 0; }
.sm-tile span { font-size: 11px; color: var(--text-2); padding: 0 4px; }
.sm-tile.on { box-shadow: inset 0 0 0 2px #EE9443, var(--panel-shadow); }
.sm-note { margin: 12px 18px 0; font-size: 12px; line-height: 1.4; color: var(--text-2); min-height: 34px; }
.sm-none { margin: 12px 16px 0; }

/* ---- the hat comparison (28.10) ---- */
.sm-hats { display: grid; gap: 14px; margin: 0 0 26px; }
.sm-hat { border-radius: 28px; padding: 14px 16px 16px; box-shadow: none !important; }
.sm-hat-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 0 4px 8px; font-size: 15px; }
.sm-hat-title span { color: var(--text-2); font-size: 13px; }
.sm-hat-title .sm-chip { margin-left: auto; }
.sm-hat-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
.sm-hat-big { position: relative; width: 280px; height: 250px; overflow: hidden; border-radius: 22px; background: var(--accent-50); }
.sm-hat-big > div { position: absolute; left: 50%; bottom: 4px; width: 260px; margin-left: -130px; }
.sm-hat-turn { position: relative; width: 200px; height: 190px; overflow: hidden; border-radius: 22px; background: var(--accent-50); }
.sm-hat-turn > div { position: absolute; left: 50%; bottom: 4px; width: 190px; margin-left: -95px; }
.sm-hat-row .sm-tile { width: 112px; cursor: default; }
.sm-hat-frames { display: flex; gap: 8px; }
.sm-hat-frames figure { margin: 0; display: grid; gap: 2px; justify-items: center; }
.sm-hat-frames figure > div { position: relative; width: 96px; height: 120px; overflow: hidden; border-radius: 14px; background: var(--accent-50); }
.sm-hat-frames figure > div > div { position: absolute; left: 50%; bottom: 2px; width: 150px; margin-left: -75px; }
.sm-hat-frames figcaption { font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; }

/* ---- outfits strip ---- */
.sm-strip { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); gap: 12px; padding: 16px; border-radius: 28px; overflow-x: auto; }
.sm-strip figure { margin: 0; display: grid; gap: 4px; justify-items: center; }
.sm-strip figure > div { position: relative; width: 150px; height: 168px; overflow: hidden; }
.sm-strip figure > div > div { position: absolute; left: 50%; bottom: 4px; width: 190px; margin-left: -95px; }
.sm-strip figcaption { font-size: 12px; color: var(--text-2); text-align: center; line-height: 1.35; }
.sm-strip figcaption b { color: var(--text); }
.sm-entry { width: 358px; border-radius: 18px; padding: 0; overflow: hidden; }
.sm-entry li { list-style: none; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 0 16px; font-size: 17px; }
.sm-entry li i { width: 30px; height: 30px; border-radius: 9px; background: #EE9443; flex: none; }
.sm-entry li span { flex: 1; }
.sm-entry li em { font-style: normal; color: var(--text-3); font-size: 15px; }
.sm-entry-wrap { padding: 18px 16px; border-radius: 30px; }
.sm-off { margin: 30px 24px; font-size: 14px; color: var(--text-2); line-height: 1.5; text-align: center; }
`;

const tr = (t: { de: string; ru: string }, lang: Lang, vars: Record<string, string | number> = {}) =>
  Object.entries(vars).reduce<string>((s, [k, v]) => s.replace(`{${k}}`, String(v)), t[lang]);

/** «Szene / Szenen», «сцена / сцены / сцен» */
function scenesWord(k: number, lang: Lang): string {
  if (lang === 'de') return k === 1 ? 'Szene' : 'Szenen';
  const d = k % 10;
  const h = k % 100;
  return d === 1 && h !== 11 ? 'сцена' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'сцены' : 'сцен';
}

function parseDate(v: string | null): DayMonth {
  const m = v?.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (m) return [Number(m[1]), Number(m[2])];
  const now = new Date();
  return [now.getDate(), now.getMonth() + 1];
}

function parseFound(v: string | null): Set<SceneId> {
  if (v === 'all') return new Set(SCENE_IDS);
  if (v === 'none') return new Set();
  if (v) return new Set(v.split(',').filter((s): s is SceneId => (SCENE_IDS as readonly string[]).includes(s)));
  return new Set<SceneId>(['tower', 'speck', 'footing', 'overfed-b']);
}

const DATES: readonly { label: string; d: DayMonth; birthday?: boolean }[] = [
  { label: '15.10 · осень', d: [15, 10] },
  { label: '15.11 · поздняя осень', d: [15, 11] },
  { label: '6.12 · Николаус', d: [6, 12] },
  { label: '15.01 · зима', d: [15, 1] },
  { label: '15.04 · весна', d: [15, 4] },
  { label: '15.07 · лето', d: [15, 7] },
  { label: 'день рождения', d: [15, 7], birthday: true },
];

/** A thumbnail box: the scene's natural box, scaled to fit (bottom-centred) — the CSS scale never touches the scene's own motion. */
function fitScale(card: SceneCard, w: number, h: number): number {
  const zoom: Partial<Record<SceneId, number>> = { tower: 1.08, homeicon: 1.25, chase: 1.1, speck: 1.05, psst: 1.05 };
  return Math.min(w / card.box.w, h / card.box.h) * (zoom[card.id] ?? 1);
}

function natBox(card: SceneCard, scale: number, fit: { w: number; h: number }): HTMLElement {
  const nat = el('div', 'sm-nat');
  // the Lists buddy measures his floors on screen: never scale him — his box IS the thumbnail / the stage (1:1)
  const w = card.id === 'footing' ? fit.w : card.box.w;
  const h = card.id === 'footing' ? fit.h : card.box.h;
  nat.style.width = `${w}px`;
  nat.style.height = `${h}px`;
  nat.style.marginLeft = `${-w / 2}px`;
  if (card.id !== 'footing') nat.style.transform = `scale(${scale})`;
  return nat;
}

export function sammlungGallery(app: HTMLElement, q: URLSearchParams): void {
  addCss('bp-paper-css', PAPER_CSS);
  addCss('sm-css', CSS);
  app.replaceChildren();
  app.style.maxWidth = 'none';

  let theme: Theme = themeOf(q);
  let lang: Lang = q.get('lang') === 'ru' ? 'ru' : 'de';
  let motion: Motion = q.get('mascots') === '0' ? 'off' : q.get('reduced') === '1' ? 'reduced' : 'full';
  const found = parseFound(q.get('found'));
  let earn: EarnMode = q.get('earn') === 'A' ? 'A' : 'B';
  let date: DayMonth = parseDate(q.get('date'));
  let birthday = q.get('birthday') === '1';
  const wearQ = q.get('wear');
  let choice: WearChoice = wearQ === 'none' || (OUTFIT_IDS as readonly string[]).includes(wearQ ?? '') ? (wearQ as WearChoice) : 'auto';
  const phonesOnly = q.get('view') === 'phones';
  const hatsOnly = q.get('view') === 'hats';
  // 31.10: the new hats by default; &hats=old = the rejected 28.10 ones (for comparison)
  const oldHats = q.get('hats') === 'old';
  const variants: readonly HatVariant[] = oldHats ? HAT_VARIANTS : NEW_HAT_VARIANTS;
  const base = oldHats ? OLD_HATS : DEFAULT_HATS;
  const variantOf = (v: string | null, dflt: HatVariant): HatVariant => ((variants as readonly string[]).includes(v ?? '') ? (v as HatVariant) : dflt);
  const hats: HatChoice = { nikolaus: variantOf(q.get('niko'), base.nikolaus), winterhat: variantOf(q.get('winter'), base.winterhat) };
  applyPageTheme(theme);

  const page = el('div', 'sm-page');
  app.append(page);
  if (!phonesOnly && !hatsOnly) {
    page.append(
      el('h2', undefined, 'Pompons Sammlung — найденные сцены и гардероб'),
      el('p', 'sm-lead', `Прототип только для галереи (в приложении ничего нет). Слева — страница коллекции в Profil: карточка каждой
        скрытой сцены. Найденная — цветная, касание показывает сцену ещё раз (настоящая сцена из пакета). Не найденная — силуэт и
        подсказка без спойлера. Справа — гардероб: шесть нарядов Помпона, «по сезону автоматически» и как наряды «достаются»
        (вариант A или B). Ниже — Помпон в каждом наряде. Всё хранится только на устройстве. Документ:
        <code>docs/design/2026-10-27-pompons-sammlung.md</code>.`),
    );
  }

  // ---------- controls (gallery only, Russian) ----------
  const controls = el('div', 'sm-controls');
  if (!phonesOnly && !hatsOnly) page.append(controls);
  // the redrawn hats (28.10): both variants side by side, above the phones
  const hatBox = el('div', 'sm-hats');
  if (!phonesOnly) page.append(hatBox);
  const chip = (label: string, pressed: boolean, onClick: () => void): HTMLButtonElement => {
    const b = el('button', 'sm-chip', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  };
  const row = (label: string, ...items: HTMLElement[]) => {
    const r = el('div', 'row');
    r.append(el('b', undefined, label), ...items);
    return r;
  };

  const phones = el('div', 'sm-phones');
  if (!hatsOnly) page.append(phones);
  const colA = el('div', 'sm-col');
  const colB = el('div', 'sm-col');
  phones.append(colA, colB);

  let sheetShow: Show | null = null;
  let preview: Bunny | null = null;
  const reduced = () => motion !== 'full';
  const wearTheme = () => (theme === 'dark' ? 'dark' : 'light') as 'light' | 'dark';

  // ---------- phone 1: the collection ----------
  // a real phone height (the page scrolls inside, the sheet sits at its bottom); &tall=1 = the whole page unrolled
  const tall = q.get('tall') === '1' ? ' tall' : '';
  const phone1 = el('div', `sm-phone bp-paper${tall}`);
  const phone2 = el('div', `sm-phone bp-paper${tall}`);
  colA.append(phone1, el('small', undefined, 'Коллекция: Profil → «Pompons Sammlung» → «Szenen»'));
  colB.append(phone2, el('small', undefined, 'Та же страница → «Garderobe»'));

  const head = (ph: HTMLElement, tab: 'scenes' | 'wardrobe'): HTMLElement => {
    ph.innerHTML = `<div class="sm-status"><span>9:41</span><span>●●● ▮</span></div>
      <div class="sm-nav"><span>‹ ${tr(T.back, lang)}</span><b>${tr(T.title, lang)}</b><span></span></div>`;
    const seg = el('div', 'sm-seg');
    for (const [id, t] of [['scenes', T.scenes], ['wardrobe', T.wardrobe]] as const) {
      const b = el('button', undefined, tr(t, lang));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(id === tab));
      seg.append(b);
    }
    const scroll = el('div', 'sm-scroll');
    scroll.append(seg);
    ph.append(scroll);
    return scroll;
  };

  const thumbs: Show[] = [];
  const closeSheet = () => {
    sheetShow?.destroy();
    sheetShow = null;
    phone1.classList.remove('sheet-open');
    if (preview && !reduced()) preview.startIdle();
  };

  const openSheet = (id: SceneId, frozen: number | null = null) => {
    const card = scene(id);
    const sheet = phone1.querySelector<HTMLElement>('.sm-sheet');
    if (!sheet) return;
    sheetShow?.destroy();
    preview?.stopIdle(); // one mascot at a time
    sheet.replaceChildren();
    sheet.append(el('div', 'sm-grab'), el('h4', undefined, card.title[lang]), el('p', undefined, reduced() ? `${card.where[lang]} · ${tr(T.calm, lang)}` : card.where[lang]));
    const stage = el('div', 'sm-stage');
    sheet.append(stage);
    const scale = Math.min(358 / card.box.w, 230 / card.box.h);
    const nat = natBox(card, scale, { w: 358, h: 230 });
    stage.append(nat);
    const btns = el('div', 'sm-btns');
    const again = el('button', 'primary', tr(T.again, lang));
    const close = el('button', undefined, tr(T.close, lang));
    again.type = close.type = 'button';
    btns.append(close, again);
    sheet.append(btns);
    phone1.classList.add('sheet-open');
    const show = mountShow(id, nat, reduced());
    sheetShow = show;
    if (frozen !== null) requestAnimationFrame(() => show.seek(frozen)); // a frozen frame for screenshots
    else setTimeout(() => show.play(), 380); // after the sheet has come up
    again.addEventListener('click', () => show.play());
    close.addEventListener('click', closeSheet);
  };

  const renderScenes = () => {
    for (const s of thumbs.splice(0)) s.destroy();
    const s1 = head(phone1, 'scenes');
    if (motion === 'off') {
      s1.append(el('p', 'sm-off', lang === 'de'
        ? '«Kaninchen zeigen» ist aus: In Profil gibt es dann keine Sammlung. Deine Funde bleiben auf dem Gerät und sind wieder da, sobald die Kaninchen zurück sind.'
        : '«Kaninchen zeigen» выключено: тогда коллекции в Profil нет. Находки остаются на устройстве и вернутся вместе с кроликами.'));
      return;
    }
    const sum = el('div', 'sm-sum');
    const dots = el('div', 'sm-dots');
    for (const id of SCENE_IDS) dots.append(el('i', found.has(id) ? 'on' : undefined));
    sum.append(el('b', undefined, tr(T.count, lang, { n: found.size, m: SCENE_IDS.length })), dots);
    s1.append(sum, el('p', 'sm-tip', tr(T.tapHint, lang)));
    const grid = el('div', 'sm-grid');
    s1.append(grid);
    for (const card of SCENES) grid.append(sceneCard(card));
    s1.append(el('p', 'sm-foot', tr(T.device, lang)));
    phone1.append(el('div', 'sm-scrim'), el('div', 'sm-sheet'));
    phone1.querySelector('.sm-scrim')?.addEventListener('click', closeSheet);
    // posters once the cards have their layout
    requestAnimationFrame(() => {
      for (const b of Array.from(grid.querySelectorAll<HTMLElement>('[data-scene]'))) {
        const id = b.dataset['scene'] as SceneId;
        const nat = b.querySelector<HTMLElement>('.sm-nat');
        if (!nat) continue;
        const s = mountShow(id, nat, reduced());
        s.poster();
        thumbs.push(s);
      }
    });
  };

  const sceneCard = (card: SceneCard): HTMLElement => {
    const isFound = found.has(card.id);
    const b = el('button', `sm-card bp-panel${isFound ? '' : ' locked'}`);
    b.type = 'button';
    b.dataset['card'] = card.id;
    const thumb = el('div', 'sm-thumb');
    const layer = el('div', `sm-layer${isFound ? '' : ' sil'}`);
    layer.dataset['scene'] = card.id;
    layer.append(natBox(card, fitScale(card, 173, 108), { w: 173, h: 108 }));
    thumb.append(layer);
    if (!isFound) thumb.append(el('span', 'sm-q', '?'));
    const text = el('div', 'sm-text');
    if (isFound) text.append(el('b', undefined, card.title[lang]), el('span', undefined, card.where[lang]));
    else {
      text.append(el('b', undefined, tr(T.secret, lang)), el('span', undefined, card.hint[lang]));
      if (card.only) text.append(el('em', undefined, card.only[lang]));
    }
    b.append(thumb, text);
    b.setAttribute('aria-label', isFound ? `${card.title[lang]} — ${tr(T.again, lang)}` : `${tr(T.secret, lang)}: ${card.hint[lang]}`);
    if (isFound) b.addEventListener('click', () => openSheet(card.id));
    else b.setAttribute('aria-disabled', 'true');
    return b;
  };

  // ---------- phone 2: the wardrobe ----------
  const tiles = new Map<OutfitId, Bunny>();
  const renderWardrobe = (animate = false) => {
    preview?.destroy();
    preview = null;
    for (const m of tiles.values()) m.destroy();
    tiles.clear();
    const s2 = head(phone2, 'wardrobe');
    if (motion === 'off') {
      s2.append(el('p', 'sm-off', lang === 'de' ? 'Ohne Kaninchen gibt es auch keine Garderobe.' : 'Без кроликов нет и гардероба.'));
      return;
    }
    const n = found.size;
    const worn = wornNow(choice, date, earn, n, birthday);
    const dressing = el('div', 'sm-dressing');
    const cap = el('div', 'sm-cap');
    cap.innerHTML = `${tr(T.today, lang)} ${date[0]}.${date[1]}.${birthday ? (lang === 'de' ? ' · Geburtstag' : ' · день рождения') : ''}: <b>${worn ? (lang === 'de' ? outfit(worn).de : outfit(worn).ru) : tr(T.wearsNothing, lang)}</b>`;
    const pHost = el('div', 'sm-pompon');
    dressing.append(cap, el('div', 'sm-floor'), pHost);
    s2.append(dressing);

    const rowEl = el('div', 'sm-row bp-panel');
    const txt = el('div');
    txt.append(el('b', undefined, tr(T.season, lang)), el('span', undefined, tr(T.seasonSub, lang)));
    const sw = el('button', 'sm-switch');
    sw.type = 'button';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(choice === 'auto'));
    sw.setAttribute('aria-label', tr(T.season, lang));
    sw.addEventListener('click', () => { choice = choice === 'auto' ? 'none' : 'auto'; renderWardrobe(true); syncControls(); });
    rowEl.append(txt, sw);
    s2.append(rowEl);

    const grid = el('div', 'sm-outfits');
    const open = unlocked(n);
    const inSeason = seasonOutfit(date, birthday);
    for (const o of OUTFITS) {
      const isOpen = open.includes(o.id);
      // option B: the season's outfit is worn (and shown in colour) even before it is unlocked
      const t = el('button', `sm-tile bp-panel${isOpen || worn === o.id ? '' : ' locked'}${worn === o.id ? ' on' : ''}`);
      t.type = 'button';
      const mini = el('div', 'sm-mini');
      const mh = el('div');
      mini.append(mh);
      const need = OUTFIT_IDS.indexOf(o.id) + 1 - n;
      const state = worn === o.id ? (isOpen ? tr(T.worn, lang) : `${tr(T.worn, lang)} · ${tr(T.inSeason, lang)}`) : isOpen ? tr(T.free, lang) : earn === 'B' && inSeason === o.id ? tr(T.inSeason, lang) : tr(T.more, lang, { k: need, scenes: scenesWord(need, lang) });
      t.append(mini, el('b', undefined, lang === 'de' ? o.de : o.ru), el('span', undefined, `${lang === 'de' ? o.whenDe : o.whenRu} · ${state}`));
      t.setAttribute('aria-pressed', String(worn === o.id));
      t.addEventListener('click', () => {
        if (!isOpen) {
          const note = phone2.querySelector('.sm-note');
          if (note) note.textContent = tr(T.locked, lang, { k: need, scenes: scenesWord(need, lang) });
          return;
        }
        choice = o.id;
        renderWardrobe(true);
        syncControls();
      });
      grid.append(t);
      const m = new Bunny(mh, { size: 156, idle: false, interactive: false, reducedMotion: 'force', coat: 'fawn', ears: 'lop' });
      dress(m.root, mh, o.id, wearTheme(), hats);
      tiles.set(o.id, m);
    }
    s2.append(grid);
    s2.append(el('p', 'sm-note', tr(earn === 'A' ? T.earnA : T.earnB, lang)));
    const none = chip(tr(T.nothing, lang), choice === 'none', () => { choice = 'none'; renderWardrobe(true); syncControls(); });
    none.classList.add('sm-none');
    s2.append(none, el('p', 'sm-foot', tr(T.device, lang)));

    // the preview Pompon: alive (idle) unless reduced; dressed; a fresh choice drops in + one hop
    preview = new Bunny(pHost, { size: 260, idle: !reduced() && !sheetShow, interactive: false, reducedMotion: reduced() ? 'force' : 'off', coat: 'fawn', ears: 'lop' });
    const g = dress(preview.root, pHost, worn, wearTheme(), hats);
    if (animate && g && !reduced() && !sheetShow) {
      const p = preview;
      requestAnimationFrame(() => {
        const a = dropIn(g, false);
        void a?.finished.then(() => p.hop()).catch(() => undefined);
      });
    }
  };

  // ---------- controls ----------
  const syncControls = () => {
    controls.replaceChildren();
    const sceneChips = SCENES.map((s) => chip(s.title.ru, found.has(s.id), () => {
      if (found.has(s.id)) found.delete(s.id); else found.add(s.id);
      renderAll(s.id);
    }));
    controls.append(
      row('Найдено (нажми = найти / забыть):', ...sceneChips,
        chip('все', found.size === SCENE_IDS.length, () => { SCENE_IDS.forEach((id) => found.add(id)); renderAll(); }),
        chip('ничего', found.size === 0, () => { found.clear(); renderAll(); })),
      row('Наряды достаются:',
        chip('A — каждая находка = наряд', earn === 'A', () => { earn = 'A'; renderAll(); }),
        chip('B — сезон дарит, находки навсегда (совет)', earn === 'B', () => { earn = 'B'; renderAll(); })),
      row('Дата (сезон):', ...DATES.map((d) => chip(d.label, !!d.birthday === birthday && d.d[0] === date[0] && d.d[1] === date[1], () => { date = d.d; birthday = !!d.birthday; renderWardrobe(true); syncControls(); }))),
      row('Гардероб:', chip('по сезону', choice === 'auto', () => { choice = 'auto'; renderWardrobe(true); syncControls(); }),
        chip('без наряда', choice === 'none', () => { choice = 'none'; renderWardrobe(true); syncControls(); })),
      row('Движение:',
        chip('полное', motion === 'full', () => { motion = 'full'; renderAll(); }),
        chip('«Weniger»', motion === 'reduced', () => { motion = 'reduced'; renderAll(); }),
        chip('«Kaninchen zeigen: aus»', motion === 'off', () => { motion = 'off'; renderAll(); })),
      row(oldHats ? 'Шапки (старые, 28.10):' : 'Шапки (новые, 31.10):',
        ...variants.map((v) => chip(`Николаус ${v.toUpperCase()} «${hatSpec('nikolaus', v).ru}»`, hats.nikolaus === v, () => { hats.nikolaus = v; renderAll(); })),
        ...variants.map((v) => chip(`Зимняя ${v.toUpperCase()} «${hatSpec('winterhat', v).ru}»`, hats.winterhat === v, () => { hats.winterhat = v; renderAll(); }))),
      row('Тема и язык:',
        chip('светлая', theme === 'light', () => { theme = 'light'; renderAll(); }),
        chip('тёмная', theme === 'dark', () => { theme = 'dark'; renderAll(); }),
        chip('Deutsch', lang === 'de', () => { lang = 'de'; renderAll(); }),
        chip('Русский', lang === 'ru', () => { lang = 'ru'; renderAll(); })),
    );
  };

  // ---------- under the phones: the entry row + Pompon in every outfit ----------
  const extras = el('div');
  if (!phonesOnly && !hatsOnly) page.append(extras);

  // ---------- the hat comparison (28.10) ----------
  const hatBunnies: Bunny[] = [];
  const renderHats = () => {
    for (const b of hatBunnies.splice(0)) b.destroy();
    hatBox.replaceChildren();
    hatBox.append(
      el('h3', undefined, oldHats
        ? 'Старые шапки (28.10, ты их отклонил 31.10) — только для сравнения'
        : 'Шапки заново (31.10): по три варианта — выбери один для Николауса и один для зимы'),
      el('p', 'sm-lead', oldHats
        ? 'Так было: «A» сидели низко, как шлем, «B» — маленькие напёрстки сверху. Новые: без &hats=old.'
        : `Слева направо: большая витрина, поворот 3/4, размер плитки, и как шапка надевается — падает, мягко «пружинит» и
        потом Помпон подпрыгивает. Все сидят НА макушке, край идёт по круглой голове и чуть шире неё, лоб открыт; «1» — между
        ушками (уши лежат поверх края), «2» и «3» — на корнях ушей (уши свисают из-под края). Старые для сравнения: &hats=old.`),
    );
    const make = (box: HTMLElement, size: number, id: HatId, v: HatVariant, turn = false): Bunny => {
      const m = new Bunny(box, { size, idle: false, interactive: false, reducedMotion: 'force', coat: 'fawn', ears: 'lop' });
      if (turn) m.root.querySelector('.hm')?.classList.add('turn-r');
      dress(m.root, box, id, wearTheme(), { ...hats, [id]: v });
      hatBunnies.push(m);
      return m;
    };
    for (const id of ['nikolaus', 'winterhat'] as const) {
      for (const v of variants) {
        const spec = hatSpec(id, v);
        const card = el('div', `sm-hat bp-paper${theme === 'dark' ? ' dark' : ''}`);
        card.dataset['hat'] = `${id}-${v}`;
        const title = el('div', 'sm-hat-title', `<b>${id === 'nikolaus' ? 'Николаус' : 'Зимняя шапка'} ${v.toUpperCase()} — «${spec.ru}»</b> <span>${spec.de} · ${spec.layer === 'over' ? 'на голове, поверх корней ушей' : (oldHats ? 'между ушами, за ними' : 'между ушками: уши лежат поверх края')}</span>`);
        const row = el('div', 'sm-hat-row');
        const big = el('div', 'sm-hat-big');
        const bigHost = el('div');
        big.append(bigHost);
        const turn = el('div', 'sm-hat-turn');
        const turnHost = el('div');
        turn.append(turnHost);
        const tile = el('div', 'sm-tile bp-panel');
        const mini = el('div', 'sm-mini');
        const miniHost = el('div');
        mini.append(miniHost);
        tile.append(mini, el('b', undefined, id === 'nikolaus' ? 'Nikolausmütze' : 'Wintermütze'), el('span', undefined, 'плитка'));
        const frames = el('div', 'sm-hat-frames');
        row.append(big, turn, tile, frames);
        const play = el('button', 'sm-chip', '▶ надеть');
        (play as HTMLButtonElement).type = 'button';
        title.append(play);
        card.append(title, row);
        hatBox.append(card);
        const m = make(bigHost, 260, id, v);
        make(turnHost, 190, id, v, true);
        make(miniHost, 156, id, v);
        // the put-on, frozen: falling, the squash on landing, the rebound, at rest
        for (const t of [0.1, 0.24, 0.32, 0.4, 0.56]) {
          const f = el('figure');
          const fb = el('div');
          const fh = el('div');
          fb.append(fh);
          f.append(fb, el('figcaption', undefined, `${t.toFixed(2)} с`));
          frames.append(f);
          const fm = make(fh, 150, id, v);
          const worn = fm.root.querySelector<SVGGElement>('.wr-slot-head');
          dropIn(worn, false);
          // freeze exactly this puppet's put-on animations (the hat group, its drop, the ear flaps) at t
          const anims = [worn, ...Array.from(fm.root.querySelectorAll('.wr-flap'))].flatMap((e) => (e ? e.getAnimations({ subtree: true }) : []));
          for (const a of anims) { a.pause(); a.currentTime = Math.min(t, DROP_MS / 1000 - 0.001) * 1000; }
        }
        play.addEventListener('click', () => {
          if (motion !== 'full') return;
          const worn = dress(m.root, bigHost, id, wearTheme(), { ...hats, [id]: v });
          const a = dropIn(worn, false);
          void a?.finished.then(() => m.hop()).catch(() => undefined);
        });
      }
    }
  };
  const stripBunnies: Bunny[] = [];
  const renderExtras = () => {
    for (const b of stripBunnies.splice(0)) b.destroy();
    extras.replaceChildren();
    extras.append(el('h3', undefined, 'Вход: новая строка в Profil (над «Rechtliches»)'));
    const wrap = el('div', `sm-entry-wrap bp-paper${theme === 'dark' ? ' dark' : ''}`);
    wrap.style.boxShadow = 'none';
    wrap.style.width = 'fit-content';
    wrap.innerHTML = `<ul class="sm-entry bp-panel"><li><i></i><span>${tr(T.entry, lang)}</span><em>${found.size}/${SCENE_IDS.length} ›</em></li></ul>`;
    extras.append(wrap);
    extras.append(el('h3', undefined, 'Помпон в каждом наряде (спереди и в повороте 3/4) — новые: листик, обе шапки (выбранные варианты), маргаритка'));
    const strip = el('div', `sm-strip bp-paper${theme === 'dark' ? ' dark' : ''}`);
    strip.style.boxShadow = 'none';
    extras.append(strip);
    for (const turn of [false, true]) {
      for (const o of OUTFITS) {
        const fig = el('figure');
        const box = el('div');
        const h = el('div');
        box.append(h);
        fig.append(box, el('figcaption', undefined, `<b>${o.ru}</b>${turn ? ' · 3/4' : `<br>${o.de} · ${o.whenRu}${o.fresh ? ' · новый' : ''}`}`));
        strip.append(fig);
        const m = new Bunny(h, { size: 190, idle: false, interactive: false, reducedMotion: 'force', coat: 'fawn', ears: 'lop' });
        if (turn) m.root.querySelector('.hm')?.classList.add('turn-r');
        dress(m.root, h, o.id, wearTheme(), hats);
        stripBunnies.push(m);
      }
    }
  };

  const renderAll = (revealed?: SceneId) => {
    closeSheet();
    applyPageTheme(theme);
    phone1.classList.toggle('dark', theme === 'dark');
    phone2.classList.toggle('dark', theme === 'dark');
    renderScenes();
    renderWardrobe();
    if (!phonesOnly && !hatsOnly) { syncControls(); renderExtras(); }
    if (!phonesOnly) renderHats();
    // a freshly found card «opens»: its colour fades in over the silhouette (opacity + a soft scale; none under «Weniger»)
    if (revealed && found.has(revealed) && motion === 'full') {
      const c = phone1.querySelector<HTMLElement>(`[data-card="${revealed}"] .sm-layer`);
      c?.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 520, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    }
  };

  renderAll();
  const open = q.get('open');
  if (open && (SCENE_IDS as readonly string[]).includes(open) && motion !== 'off') {
    setTimeout(() => openSheet(open as SceneId, q.has('t') ? Number(q.get('t')) || 0 : null), 60);
  }
  setTimeout(markReady, 400);
  (window as unknown as { sammlung: unknown }).sammlung = { openSheet, closeSheet, found };
}
