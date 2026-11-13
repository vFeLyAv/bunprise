/**
 * Demo page: both mascots with every scene, coat chips, ears toggle and a size
 * slider. URL params:
 *   ?kind=bunny|hamster            show one mascot only
 *   &coat=choc &ears=up|lop        coat / ear style (ears: bunny only)
 *   &size=320                      stage width in px
 *   &scene=alert                   play that scene after mount
 *   &static=1                      render a FIXED pose for screenshots: idle loop off,
 *                                  reduced motion forced, `scene` (or `pose`) mapped to a static pose
 *   &pose=turn|alert|sleep|angry|wave|eat|drip   explicit static pose (static mode)
 *   &eyes=star|happy|sleep &puff=1.3            extra tweaks (static mode)
 *
 * Welcome stage (frame review, deterministic: every stage is frozen with seek(t)):
 *   ?sheet=welcome|peek-once|peek-bottom|peek-left|peek-right|run
 *        &frames=16 &cols=4      contact sheet: N stages, evenly spaced times 0 … duration
 *        &ledge=0                 no card at the bottom (default: a card; the paws rest on its top edge)
 *        &steps=<json>            your own WelcomeStep[] instead of a preset (tuning)
 *        &ratio=0.6               stage width / height (default: fill the cell)
 *        &bunnies=fawn,choc,…     coats ([0] = main bunny)
 *   ?frame=welcome&t=5.2 [&ledge=0] [&w=390&h=780]   one frozen phone-sized frame
 *
 * New welcome screens (25.10, gallery-only prototype, demo/welcome-screens.ts):
 *   ?screens=welcome [&screen=1|2|3] [&reduced=1]
 * Lists buddy (25.10, gallery-only prototype, demo/lists-buddy/):
 *   ?screens=buddy [&kind=bunny] [&reduced=1] [&size=128] [&seed=N] [&auto=0]
 * Promo video storyboard (25.10, still frames, demo/promo-storyboard.ts):
 *   ?screens=promo [&frame=1..9] [&safe=1]
 * Promo film, motion + sound, dark (25.10, demo/promo/): ?screens=film [&t=4.2] [&zoom=1] [&autoplay=0]
 * Launch screen (26.10, gallery-only prototype, demo/splash/): ?screens=splash [&ready=150|600|2000|never]
 *   [&theme=light|dark|navy|ocean|system] [&motion=full|reduce|off] [&tg=1] [&nosplash=1] [&storyboard=1] [&t=520]
 * Wardrobe v2 — a year of outfits, each with its own put-on moment (26.10, gallery-only prototype, demo/wardrobe/): ?screens=wardrobe [&item=scarf|beanie|wreath|ring|witch|nikolaus|party] [&theme=light|dark|navy] [&size=64|96|148] [&palette=N] [&reduced=1] [&grid=0] [&t=0.4] [&contact=1&frames=10]
 * Tapsi's moments (26.10, demo/tapsi/; «Psst» + «Пылинка» approved, in the app since 27.10: src/tapsi-moments.ts): ?screens=tapsi [&scene=psst|today|speck] [&t=1.2] [&reduced=1] [&frames=1] [&zoom=2]
 * «Листик / Снежинка» (26.10, gallery-only prototype, demo/seasons/): ?screens=seasons [&season=autumn|winter] [&end=duck|stay]
 *   [&theme=light|dark] [&reduced=1] [&t=2.4] [&frames=16 &t0= &t1=] [&contact=0] [&view=phone]
 * Krümel, Pompon's little brother (26.10, gallery-only prototype, demo/kruemel/): ?screens=kruemel [&coat=fawn|choc|himalayan|broken]
 *   [&reduced=1] [&t=1.2] [&frames=12]
 * Mitbringen moment «Корзинка», the last free item ends with a binky (26.10, gallery-only prototype, demo/mitbringen/; «Салфетка» dropped by Felix): ?screens=mitbringen [&move=basket|last] [&reduced=1] [&t=1.2] [&theme=dark] [&contact=1&frames=12]
 * «Парад», the Profil easter egg (26.10, demo/parade/; approved, in the app since 27.10: src/tower.ts): ?screens=parade [&reduced=1] [&theme=light|dark] [&t=2.4]
 *   [&frames=12] [&contact=0] [&view=phone] [&autoplay=0]
 * «Здесь я буду жить», onboarding "Zum Home-Bildschirm" (26.10, demo/homeicon/; approved, in the app since 27.10: src/homeicon.ts): ?screens=homeicon [&reduced=1]
 *   [&theme=light|dark] [&label=0] [&t=1.6] [&frames=12] [&contact=0] [&view=phone] [&autoplay=0]
 * «Твёрдая почва», Pompon checks the edge (26.10, demo/firmground/; approved, in the app since 27.10: src/buddy/footing.ts): ?screens=firmground [&at=corner|left|right|brink|middle] [&t=0.4] [&reduced=1] [&size=96|128|160] [&auto=0] [&autoplay=0] [&frames=13] [&zoom=2.5]
 * Comic episode 1 «Ein Wunsch rollt an» (gallery-only, demo/story/): v4 (31.10) b&w manga ribbon ?screens=story [&ep=2 episode 2] [&lang=ru] [&reduced=1] [&view=reader]; v2/v3 colour strip &v=2; v3 style samples &view=styles; v1 (26.10) seven panels ?screens=story&v=1 [&panel=1..7] [&view=reader] [&reduced=1] [&t=0.8] [&lang=ru]
 * «Ideen» → categories, the "Brettspiele" shelf + the die moment (26.10, gallery-only UI prototype, demo/ideas/): ?screens=ideas [&theme=light|dark] [&view=row|category|detail] [&reduced=1] [&t=0.6] [&players=two&price=low] [&tall=1]
 * Occasion covers «Обложки-заставки»: title → motif, 16 SVG pictures, the form picker (26.10, gallery-only, demo/covers/): ?screens=covers [&theme=dark] [&part=cards|hero|play|table|picker|before] [&title=…&date=…]
 * «Neue Spiele 30.10», the 17 new board-game animations (7 Kosmos + 10 iconic; gallery-only until Felix approves, demo/ideas/newgallery.ts): ?screens=newgames [&theme=light|dark|navy|ocean|black|all] [&view=grid|themes|frames] [&only=monopoly,jenga] [&reduced=1] [&gt=0.8] [&frames=6&anim=uno]
 * App icons «Значки приложения», all home-screen icon variants on mock home screens (27.10, demo/appicons/): ?screens=icons [&theme=dark] [&view=phones]
 * «Pompons Sammlung», the collection of found scenes + the wardrobe (27.10, gallery-only prototype, demo/sammlung/): ?screens=sammlung
 * Mascots sleep at night, a tap wakes them (31.10, gallery-only, demo/night/): ?screens=night [&time=23:30] [&theme=both|light|dark|navy|ocean|black|night|all] [&reduced=1] [&battery=1] [&drip=0] [&view=phones|strips] [&strip=fall|wake|morning|peek|loop] [&kind=bunny|hamster]
 * Costumes from Felix's photos + new bunnies + Pompon experiments (31.10, gallery-only, demo/costumes/): ?screens=costumes [&tab=costumes|bunnies|experiments] [&theme=light|dark|navy|ocean|black|all] [&size=64|96|148] [&view=sheet|motion|grid] [&only=…] [&reduced=1]
 *   [&found=tower,speck|all|none] [&earn=A|B] [&date=6.12] [&birthday=1] [&wear=auto|none|leaf|…] [&reduced=1] [&mascots=0] [&theme=dark] [&lang=ru] [&open=<scene>&t=1.2] [&view=phones]
 * DROPPED by Felix 31.10 («Не надо Флумми»; no start-page link, kept for the record): Flummi v2, the ginger binky bunny in a Duolingo-like flat style (31.10, gallery-only, demo/binky/v2/): ?screens=binky [&style=a|b|c] [&theme=…] [&reduced=1] [&view=hero|variants|views|idle|binky|motion|family|sizes|themes] [&view=frame&moment=binky|hop|laugh|curious|idle&t=0.64] [&frames=12]
 *   v1 (our Pompon puppet reshaped, rejected by Felix 31.10, demo/binky/): ?screens=binky&v=1 [&ears=a|b|c] [&coat=ginger|apricot] [&eyes=photo|star] [&theme=…] [&reduced=1] [&view=hero|ears|frames|poses|themes|family|names|frame&t=0.52] [&frames=10]
 * «Живые анимации», nine new idle moments of Pompon and Tapsi + the proposed mix (31.10, gallery-only, demo/alive/): ?screens=alive [&theme=both|light|dark] [&reduced=1] [&anim=flop,groom,…] [&t=1.2] [&frames=8] [&size=120] [&view=live|cards|frames|mix|frame] [&live=fast|app] [&seed=7] [&autoplay=0]
 * Pompon in an opened wishlist: stroke, boop, ear pull, shake, new wish, Erhalten, delete, selection, end, empty box (31.10, gallery-only, demo/listplay/): ?screens=listplay [&place=a|b|empty] [&play=stroke|boop|pull|dizzy|wish|received|delete|select|relax|move|end|bounce|pop [&t=1.2]] [&theme=dark] [&reduced=1] [&live=0] [&view=sheet&play=…&frames=8&zoom=2&crop=pompon]
 */

import {
  Bunny,
  COATS,
  Hamster,
  SCENES,
  WELCOME_DEFAULT_BUNNIES,
  WELCOME_PRESETS,
  WelcomeStage,
  type AnyMascot,
  type BunnyCoat,
  type BunnyPose,
  type BunnyScene,
  type EyeMode,
  type HamsterPose,
  type HamsterScene,
  type MascotKind,
  type MascotSceneEventDetail,
  type ReducedMotionMode,
  type WelcomePreset,
  type WelcomeStep,
} from '../src/index';
import { newIdeasGallery } from './new-ideas';
import { welcomeScreensGallery } from './welcome-screens';
import { listsBuddyGallery } from './lists-buddy/gallery';
import { promoStoryboardGallery } from './promo-storyboard';
import { promoFilmGallery } from './promo/player';
import { splashGallery } from './splash/gallery';
import { wardrobeGallery } from './wardrobe/gallery';
import { tapsiGallery } from './tapsi/gallery';
import { seasonsGallery } from './seasons/gallery';
import { kruemelGallery } from './kruemel/gallery';
import { mitbringenGallery } from './mitbringen/gallery';
import { paradeGallery } from './parade/gallery';
import { homeIconGallery } from './homeicon/gallery';
import { firmGroundGallery } from './firmground/gallery';
import { storyGallery } from './story/gallery';
import { ideasGallery } from './ideas/gallery';
import { coversGallery } from './covers/gallery';
import { appIconsGallery } from './appicons/gallery';
import { sammlungGallery } from './sammlung/gallery';
import { newGamesGallery } from './ideas/newgallery';
import { costumesGallery } from './costumes/gallery';
import { nightGallery } from './night/gallery';
import { binkyGallery } from './binky/gallery';
import { flummiV2Gallery } from './binky/v2/gallery';
import { aliveGallery } from './alive/gallery';
import { listPlayGallery } from './listplay/gallery';

const q = new URLSearchParams(location.search);
const app = document.getElementById('app');
if (!app) throw new Error('no #app');
const page = !q.has('frame') && !q.has('sheet') && !q.has('static');
if (page && !q.has('screens')) queueMicrotask(() => newIdeasGallery(app));
// the new welcome screens (25.10, gallery-only prototype): on top of the page; ?screens=welcome = only them
if (page && (!q.has('screens') || q.get('screens') === 'welcome')) queueMicrotask(() => welcomeScreensGallery(app, q));
// the Lists buddy (25.10, gallery-only prototype): on top of the page; ?screens=buddy = only him
if (page && (!q.has('screens') || q.get('screens') === 'buddy')) queueMicrotask(() => listsBuddyGallery(app, q));
// the promo video storyboard (25.10): only on its own page, ?screens=promo
if (page && q.get('screens') === 'promo') queueMicrotask(() => promoStoryboardGallery(app, q));
if (page && q.get('screens') === 'film') queueMicrotask(() => promoFilmGallery(app, q));
// the launch screen (26.10, gallery-only prototype): only on its own page, ?screens=splash
if (page && q.get('screens') === 'splash') queueMicrotask(() => splashGallery(app, q));
if (page && q.get('screens') === 'mitbringen') queueMicrotask(() => mitbringenGallery(app, q));
if (page && q.get('screens') === 'wardrobe') queueMicrotask(() => wardrobeGallery(app, q));
if (page && q.get('screens') === 'tapsi') queueMicrotask(() => tapsiGallery(app, q));
// «Листик / Снежинка» and Krümel (26.10, gallery-only prototypes): each only on its own page
if (page && q.get('screens') === 'seasons') queueMicrotask(() => seasonsGallery(app, q));
if (page && q.get('screens') === 'kruemel') queueMicrotask(() => kruemelGallery(app, q));
// «Парад» (26.10, gallery-only prototype): only on its own page
if (page && q.get('screens') === 'parade') queueMicrotask(() => paradeGallery(app, q));
// «Здесь я буду жить», onboarding "Zum Home-Bildschirm" (26.10, gallery-only prototype): only on its own page
if (page && q.get('screens') === 'homeicon') queueMicrotask(() => homeIconGallery(app, q));
if (page && q.get('screens') === 'firmground') queueMicrotask(() => firmGroundGallery(app, q));
if (page && q.get('screens') === 'story') queueMicrotask(() => storyGallery(app, q));
if (page && q.get('screens') === 'ideas') queueMicrotask(() => ideasGallery(app, q));
if (page && q.get('screens') === 'covers') queueMicrotask(() => coversGallery(app, q));
// the home-screen icons of Einstellungen → App-Symbol (27.10; the app's own files) on mock home screens: ?screens=icons
if (page && q.get('screens') === 'icons') queueMicrotask(() => appIconsGallery(app, q));
// «Pompons Sammlung» (27.10, gallery-only prototype): the found scenes + the wardrobe, only on its own page
if (page && q.get('screens') === 'sammlung') queueMicrotask(() => sammlungGallery(app, q));
// «Neue Spiele 30.10» (gallery-only until Felix approves): the 17 new game animations, only on their own page
if (page && q.get('screens') === 'newgames') queueMicrotask(() => newGamesGallery(app, q));
// costumes from Felix's photos, new bunnies, Pompon experiments (31.10, gallery-only until Felix approves): ?screens=costumes
if (page && q.get('screens') === 'costumes') queueMicrotask(() => costumesGallery(app, q));
// mascots sleep at night, a tap wakes them (31.10, gallery-only until Felix approves): ?screens=night
if (page && q.get('screens') === 'night') queueMicrotask(() => nightGallery(app, q));
// the binky bunny from Felix's three photos of an orange rabbit (31.10, gallery-only until Felix approves): ?screens=binky
// = Flummi v2 (Duolingo-like flat style); the rejected v1 stays at ?screens=binky&v=1
if (page && q.get('screens') === 'binky') queueMicrotask(() => (q.get('v') === '1' ? binkyGallery(app, q) : flummiV2Gallery(app, q)));
// «Живые анимации» — new idle moments of Pompon and Tapsi (31.10, gallery-only until Felix approves): ?screens=alive
if (page && q.get('screens') === 'alive') queueMicrotask(() => aliveGallery(app, q));
// Pompon in an opened wishlist (31.10, gallery-only until Felix approves): ?screens=listplay
if (page && q.get('screens') === 'listplay') queueMicrotask(() => listPlayGallery(app, q));
// the index: a link to it on top (the other ?screens= pages are reached by their URL)
if (page && !q.has('screens')) queueMicrotask(() => {
  const a = document.createElement('a');
  a.href = '?screens=sammlung';
  a.textContent = 'Новое (27.10): Pompons Sammlung — найденные сцены и гардероб →';
  a.style.cssText = 'display:block;max-width:1000px;margin:16px auto 0;padding:12px 16px;border-radius:16px;background:rgba(240,160,75,.16);color:inherit;font-weight:600;text-decoration:none';
  app.prepend(a);
  const games = document.createElement('a');
  games.href = '?screens=newgames';
  games.textContent = 'Новое (30.10): Neue Spiele — 17 анимаций игр (Kosmos + Монополия, УНО, Дженга …) →';
  games.style.cssText = a.style.cssText;
  app.prepend(games);
  const costumes = document.createElement('a');
  costumes.href = '?screens=costumes';
  costumes.textContent = 'Новое (31.10): Костюмы по твоим фото, новые кролики и эксперименты с Помпоном →';
  costumes.style.cssText = a.style.cssText;
  app.prepend(costumes);
  const night = document.createElement('a');
  night.href = '?screens=night';
  night.textContent = 'Новое (31.10): Ночью маскоты спят — коснись, чтобы разбудить →';
  night.style.cssText = a.style.cssText;
  app.prepend(night);
  const alive = document.createElement('a');
  alive.href = '?screens=alive';
  alive.textContent = 'Новое (31.10): Живые анимации — флоп, умывашки, перископ, потягушки, буханочка, чих, копает; Тапси умывается и столбик →';
  alive.style.cssText = a.style.cssText;
  app.prepend(alive);
  const listplay = document.createElement('a');
  listplay.href = '?screens=listplay';
  listplay.textContent = 'Новое (31.10): Помпон в открытом списке — погладить, нос, ушко, встряхнуть, новое желание, Erhalten, удалить, выбор, конец списка →';
  listplay.style.cssText = a.style.cssText;
  app.prepend(listplay);
});

const LABELS: Record<MascotKind, Record<string, string>> = {
  bunny: { greet: 'Привет', eat: 'Ест', walk: 'Скачет', jump: 'Бинки', alert: 'Нюхает', sleep: 'Спит', angry: 'Злится', surprise: 'Уши торчком', idle: 'Покой' },
  hamster: { greet: 'Привет', eat: 'Ест', walk: 'Идёт', jump: 'Прыжок', sleep: 'Спит', angry: 'Злится', secret: 'Бронь: Psst', speck: 'Пылинка (бинокль)', idle: 'Покой' },
};
const TITLES: Record<MascotKind, string> = { bunny: 'Кролик', hamster: 'Хомяк' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function num(v: string | null): number | undefined {
  const n = Number(v);
  return v !== null && Number.isFinite(n) && n > 0 ? n : undefined;
}

function kindOf(v: string | null): MascotKind | null {
  return v === 'bunny' || v === 'hamster' ? v : null;
}

/** Scene name -> static pose, so ?static=1&scene=alert works like the prototypes' ?pose=. */
function sceneToPose(scene: string | null): string {
  switch (scene) {
    case 'alert':
    case 'sleep':
    case 'angry':
    case 'eat':
    case 'turn':
    case 'drip':
    case 'wave':
      return scene;
    case 'greet':
      return 'wave';
    case 'walk':
      return 'turn';
    default:
      return 'idle';
  }
}

function build(kind: MascotKind, host: HTMLElement, opts: { size?: number; idle: boolean; reducedMotion: ReducedMotionMode; interactive: boolean }): AnyMascot {
  const coat = q.get('coat') ?? undefined;
  if (kind === 'hamster') return new Hamster(host, { ...opts, ...(coat ? { coat: coat as Hamster['coat'] } : {}) });
  return new Bunny(host, { ...opts, ears: q.get('ears') === 'up' || q.get('ears') === 'upright' ? 'upright' : 'lop', ...(coat ? { coat: coat as Bunny['coat'] } : {}) });
}

// ---------- static mode (screenshots) ----------
function renderStatic(): void {
  if (!app) return;
  app.className = 'app static';
  const kind = kindOf(q.get('kind')) ?? 'bunny';
  const stage = el('div');
  app.append(stage);
  // 420 px = the prototypes' stage width (480 card - paddings), so screenshots line up 1:1
  const m = build(kind, stage, { size: num(q.get('size')) ?? 420, idle: false, reducedMotion: 'force', interactive: false });
  const pose = q.get('pose') ?? sceneToPose(q.get('scene'));
  if (m instanceof Bunny) m.pose(pose as BunnyPose);
  else m.pose(pose as HamsterPose);
  const eyes = q.get('eyes');
  if (eyes) m.setEyes(eyes as EyeMode);
  const puff = num(q.get('puff'));
  if (puff) m.setPuff(puff);
  (window as unknown as { mascot: AnyMascot }).mascot = m;
  document.documentElement.dataset.ready = '1';
}

// ---------- interactive demo ----------
function renderDemo(): void {
  if (!app) return;
  app.append(el('h1', undefined, 'Bunprise · маскоты'), el('p', 'sub', 'Кролик (главный) и хомяк (друг) · порт прототипов в @bunprise/mascot'));

  const only = kindOf(q.get('kind'));
  const kinds: MascotKind[] = only ? [only] : ['bunny', 'hamster'];
  const mascots: AnyMascot[] = [];
  const size = num(q.get('size')) ?? 320;

  const toolbar = el('div', 'toolbar');
  const sizeLabel = el('label');
  const sizeOut = el('span', undefined, `${size}px`);
  const slider = el('input');
  slider.type = 'range';
  slider.min = '120';
  slider.max = '480';
  slider.step = '10';
  slider.value = String(size);
  slider.addEventListener('input', () => {
    sizeOut.textContent = `${slider.value}px`;
    mascots.forEach((m) => m.setSize(Number(slider.value)));
  });
  sizeLabel.append('Размер', slider, sizeOut);

  const rmLabel = el('label');
  const rmSelect = el('select');
  for (const [v, t] of [['auto', 'как в системе'], ['force', 'меньше движения'], ['off', 'всегда анимировать']] as const) {
    const o = el('option', undefined, t);
    o.value = v;
    rmSelect.append(o);
  }
  rmSelect.addEventListener('change', () => mascots.forEach((m) => m.setReducedMotion(rmSelect.value as ReducedMotionMode)));
  rmLabel.append('Движение', rmSelect);

  const themeBtn = el('button', 'btn small', 'Тема');
  themeBtn.type = 'button';
  themeBtn.addEventListener('click', () => {
    const html = document.documentElement;
    html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
  });
  toolbar.append(sizeLabel, rmLabel, themeBtn);
  app.append(toolbar);

  const grid = el('div', 'grid');
  app.append(grid);

  for (const kind of kinds) {
    const card = el('section', 'card');
    card.append(el('h2', undefined, TITLES[kind]));
    const wrap = el('div', 'stage-wrap');
    const stage = el('div');
    stage.setAttribute('aria-label', kind === 'bunny' ? 'Кролик: нажми, чтобы он подпрыгнул' : 'Хомяк: нажми, чтобы он подпрыгнул');
    wrap.append(stage);
    card.append(wrap);

    const m = build(kind, stage, { size, idle: true, reducedMotion: 'auto', interactive: true });
    mascots.push(m);

    // scene buttons; highlighted while the scene runs (mascot-scene-* events bubble from the host)
    const scenes = el('div', 'row');
    const buttons = new Map<string, HTMLButtonElement>();
    for (const s of SCENES[kind]) {
      const b = el('button', 'btn', LABELS[kind][s] ?? s);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (m instanceof Bunny) void m.play(s as BunnyScene);
        else void m.play(s as HamsterScene);
      });
      buttons.set(s, b);
      scenes.append(b);
    }
    stage.addEventListener('mascot-scene-start', (e) => {
      const { scene } = (e as CustomEvent<MascotSceneEventDetail>).detail;
      buttons.forEach((b, s) => b.classList.toggle('on', s === scene));
    });
    stage.addEventListener('mascot-scene-end', () => buttons.forEach((b) => b.classList.remove('on')));
    card.append(scenes);

    // coat chips
    const coats = el('div', 'row');
    coats.setAttribute('role', 'radiogroup');
    coats.setAttribute('aria-label', 'Окрас');
    const chips: HTMLButtonElement[] = [];
    for (const c of COATS[kind]) {
      const chip = el('button', 'btn chip');
      chip.type = 'button';
      chip.setAttribute('role', 'radio');
      chip.dataset.id = c.id;
      chip.setAttribute('aria-checked', String(c.id === m.coat));
      const swatch = el('i');
      swatch.style.background = `linear-gradient(135deg, ${c.colors[0]} 45%, ${c.colors[3]} 46%)`;
      chip.append(swatch, c.name);
      chip.addEventListener('click', () => {
        if (m instanceof Bunny) m.setCoat(c.id as Bunny['coat']);
        else m.setCoat(c.id as Hamster['coat']);
        chips.forEach((x) => x.setAttribute('aria-checked', String(x.dataset.id === m.coat)));
        void m.hop();
      });
      chips.push(chip);
      coats.append(chip);
    }
    card.append(coats);

    // ears + eyes
    const extras = el('div', 'row');
    if (m instanceof Bunny) {
      const earsBtn = el('button', 'btn small', '');
      earsBtn.type = 'button';
      const label = () => (earsBtn.textContent = m.ears === 'upright' ? 'Уши: стоячие' : 'Уши: висячие');
      label();
      earsBtn.addEventListener('click', () => {
        m.setEars(m.ears === 'upright' ? 'lop' : 'upright');
        label();
        void m.hop();
      });
      extras.append(earsBtn);
    }
    const eyesSel = el('select');
    for (const v of ['normal', 'star', 'happy', 'sleep'] as const) {
      const o = el('option', undefined, `Глаза: ${v}`);
      o.value = v;
      eyesSel.append(o);
    }
    eyesSel.addEventListener('change', () => m.setEyes(eyesSel.value as EyeMode));
    extras.append(eyesSel);
    const idleBtn = el('button', 'btn small on', 'Idle-цикл');
    idleBtn.type = 'button';
    idleBtn.addEventListener('click', () => {
      if (m.idleRunning) m.stopIdle();
      else m.startIdle();
      idleBtn.classList.toggle('on', m.idleRunning);
    });
    extras.append(idleBtn);
    card.append(extras);
    card.append(el('p', 'hint', kind === 'bunny' ? 'Нажми на кролика · 5 раз подряд — затопает и разозлится' : 'Нажми на хомяка · 5 раз подряд — разозлится'));
    grid.append(card);

    const scene = q.get('scene');
    if (scene && (SCENES[kind] as readonly string[]).includes(scene)) {
      if (m instanceof Bunny) void m.play(scene as BunnyScene);
      else void m.play(scene as HamsterScene);
    }
  }

  if (!only) renderWelcome(grid, rmSelect);

  const note = el('p', 'note');
  note.innerHTML =
    'Для скриншотов: <code>?kind=bunny&amp;scene=alert&amp;coat=choc&amp;ears=up&amp;static=1</code> · приветствие: <code>?sheet=welcome&amp;frames=16&amp;cols=4</code>, <code>?frame=welcome&amp;t=6.5</code>';
  app.append(note);
  (window as unknown as { mascots: AnyMascot[] }).mascots = mascots;
}

// ---------- welcome stage ----------

const PRESET_LABELS: Record<WelcomePreset, string> = {
  welcome: 'Приветствие (вся сцена)',
  'peek-once': 'Выглянул и остался (пустые экраны)',
  'peek-bottom': 'Выглядывает снизу',
  'peek-left': 'Выглядывает слева',
  'peek-right': 'Выглядывает справа',
  run: 'Пробегает',
  'hop-across': 'Перепрыгивает без остановки (лента)',
  'peek-side': 'Выглядывает сбоку и прячется (настройки)',
  'pop-up': 'Выскакивает и прячется (повод)',
  wave: 'Выглядывает и машет (профиль готов)',
  lost: 'Потерялся: оглядывается (404)',
  shrug: 'Пожимает плечами (ошибка)',
  sleepy: 'Засыпает на краю (юр. тексты)',
  // MX-core (wave 3): Felix's new ideas
  'corner-left': 'Из-за угла слева (новое)',
  'corner-right': 'Из-за угла справа (новое)',
  meet: 'Двое из-за косяков (новое)',
  'ears-only': 'Только уши (новое)',
  lift: 'Лифт: сидит на краю (новое)',
  surprise: 'Уши торчком: удивился (новое)',
  'peek-sniff': 'Нюхает вниз (Ideen, новое)',
  // 22.10: the app's "+" menu (a floating sheet: no side door frame)
  'climb-left': 'Вылезает у левого конца края (меню «+»)',
  'climb-right': 'Вылезает у правого конца края (меню «+»)',
};

function presetOf(v: string | null): WelcomePreset {
  return (WELCOME_PRESETS as readonly string[]).includes(v ?? '') ? (v as WelcomePreset) : 'welcome';
}

/** &steps=<json>: your own WelcomeStep[] (tuning / review). */
function stepsOf(v: string | null): WelcomeStep[] | null {
  if (!v) return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as WelcomeStep[]) : null;
  } catch {
    return null;
  }
}

function bunniesOf(v: string | null): BunnyCoat[] {
  const ids = COATS.bunny.map((c) => c.id as string);
  const list = (v ?? '').split(',').filter((s) => ids.includes(s)) as BunnyCoat[];
  return list.length ? list : [...WELCOME_DEFAULT_BUNNIES];
}

interface Phone {
  phone: HTMLDivElement;
  host: HTMLDivElement;
  /** sizes the bottom card + the stage above it; returns the edge inset and the card's corner radius (px) for the stage */
  layout: () => { inset: number; radius: number };
}

/** Start-screen mock: title, the stage, a bottom card whose top edge the bunnies hide behind. */
function phoneMock(parent: HTMLElement, opts: { title: boolean; ledge: boolean; cls?: string }): Phone {
  const phone = el('div', `phone${opts.cls ? ` ${opts.cls}` : ''}${opts.ledge ? '' : ' flat'}`);
  if (opts.title) {
    const title = el('div', 'phone-title');
    title.append(el('b', undefined, 'Bunprise'), el('span', undefined, 'Pläne und Wünsche an einem Ort'));
    phone.append(title);
  }
  const host = el('div', 'phone-stage');
  const sheet = el('div', 'phone-sheet');
  sheet.append(el('i'), el('i'));
  phone.append(host, sheet);
  parent.append(phone);
  const layout = () => {
    const H = phone.clientHeight || 720;
    const card = opts.ledge ? Math.round(H * 0.3) : 0;
    const inset = opts.ledge ? Math.max(6, Math.round(H * 0.022)) : 0;
    sheet.style.height = `${card}px`;
    host.style.bottom = `${card - inset}px`;
    // the card's rounded top corners: the bunnies hide behind the curve (edgeRadius)
    const radius = opts.ledge ? Number.parseFloat(getComputedStyle(sheet).borderTopLeftRadius) || 0 : 0;
    return { inset, radius };
  };
  return { phone, host, layout };
}

function renderWelcome(grid: HTMLElement, rmSelect: HTMLSelectElement): void {
  const card = el('section', 'card welcome-card');
  card.append(el('h2', undefined, 'Приветствие'));
  const wrap = el('div', 'welcome-wrap');
  card.append(wrap);
  grid.append(card);

  let preset = presetOf(q.get('welcome'));
  let coats: BunnyCoat[] = bunniesOf(q.get('bunnies'));
  let loop = false;
  let ledge = q.get('ledge') !== '0';
  let stage: WelcomeStage | null = null;
  let phone: Phone | null = null;
  const stageBox = el('div', 'phone-box');
  wrap.append(stageBox);

  const controls = el('div', 'welcome-controls');
  wrap.append(controls);
  const transport = el('div', 'row');
  const playBtn = el('button', 'btn', '▶ Играть');
  const pauseBtn = el('button', 'btn', '❚❚ Пауза');
  const stopBtn = el('button', 'btn', '■ Стоп');
  for (const b of [playBtn, pauseBtn, stopBtn]) b.type = 'button';
  transport.append(playBtn, pauseBtn, stopBtn);

  const choreo = el('label');
  const choreoSel = el('select');
  for (const p of WELCOME_PRESETS) {
    const o = el('option', undefined, PRESET_LABELS[p]);
    o.value = p;
    o.selected = p === preset;
    choreoSel.append(o);
  }
  choreo.append('Хореография', choreoSel);

  const chips = el('div', 'row');
  chips.setAttribute('aria-label', 'Кролики (первый — главный)');
  const chipEls: HTMLButtonElement[] = [];
  const syncChips = () => chipEls.forEach((c) => c.setAttribute('aria-checked', String(coats.includes(c.dataset.id as BunnyCoat))));
  for (const c of COATS.bunny) {
    const chip = el('button', 'btn chip');
    chip.type = 'button';
    chip.setAttribute('role', 'checkbox');
    chip.dataset.id = c.id;
    const swatch = el('i');
    swatch.style.background = `linear-gradient(135deg, ${c.colors[0]} 45%, ${c.colors[3]} 46%)`;
    chip.append(swatch, c.name);
    chip.addEventListener('click', () => {
      const id = c.id as BunnyCoat;
      if (coats.includes(id)) {
        if (coats.length > 1) coats = coats.filter((x) => x !== id);
      } else coats = [...coats, id].slice(0, 4);
      syncChips();
      rebuild(true);
    });
    chipEls.push(chip);
    chips.append(chip);
  }
  syncChips();

  const toggles = el('div', 'row');
  const loopBtn = el('button', 'btn small', 'Повтор');
  const ledgeBtn = el('button', 'btn small', 'Карточка снизу');
  for (const b of [loopBtn, ledgeBtn]) b.type = 'button';
  loopBtn.addEventListener('click', () => {
    loop = !loop;
    loopBtn.classList.toggle('on', loop);
    rebuild(true);
  });
  ledgeBtn.classList.toggle('on', ledge);
  ledgeBtn.addEventListener('click', () => {
    ledge = !ledge;
    ledgeBtn.classList.toggle('on', ledge);
    rebuild(true);
  });
  toggles.append(loopBtn, ledgeBtn);

  const scrub = el('div', 'scrub');
  const range = el('input');
  range.type = 'range';
  range.min = '0';
  range.step = '0.01';
  const timeOut = el('span', undefined, '0.00 s');
  scrub.append('Кадр', range, timeOut);

  const hint = el('p', 'hint');
  hint.style.textAlign = 'left';
  hint.textContent =
    'Окрасы по порядку появления: 1-й — главный (в конце машет лапкой), 2-й — снизу слева, 3-й — из-за правого края, 4-й — перебегает. Ползунок замораживает кадр (seek).';
  controls.append(transport, choreo, chips, toggles, scrub, hint);

  const showTime = () => {
    if (!stage) return;
    const t = stage.time;
    timeOut.textContent = `${t.toFixed(2)} s / ${stage.duration.toFixed(2)} s`;
    range.value = String(Math.min(t, stage.duration));
  };
  const tick = () => {
    showTime();
    if (stage?.playing) requestAnimationFrame(tick);
  };

  function rebuild(autoplay: boolean): void {
    stage?.destroy();
    stageBox.textContent = '';
    phone = phoneMock(stageBox, { title: true, ledge });
    const { inset, radius } = phone.layout();
    stage = new WelcomeStage(phone.host, {
      bunnies: coats,
      choreography: preset,
      loop,
      edgeInset: { bottom: inset },
      edgeRadius: { bottom: radius },
      reducedMotion: rmSelect.value as ReducedMotionMode,
      onEnd: () => showTime(),
    });
    range.max = String(stage.duration);
    (window as unknown as { welcome: WelcomeStage }).welcome = stage;
    if (autoplay) {
      stage.play();
      requestAnimationFrame(tick);
    } else showTime();
  }

  playBtn.addEventListener('click', () => {
    stage?.play();
    requestAnimationFrame(tick);
  });
  pauseBtn.addEventListener('click', () => {
    stage?.pause();
    showTime();
  });
  stopBtn.addEventListener('click', () => {
    stage?.stop();
    showTime();
  });
  choreoSel.addEventListener('change', () => {
    preset = presetOf(choreoSel.value);
    rebuild(true);
  });
  range.addEventListener('input', () => {
    stage?.seek(Number(range.value));
    showTime();
  });
  rmSelect.addEventListener('change', () => stage?.setReducedMotion(rmSelect.value as ReducedMotionMode));
  rebuild(q.get('autoplay') !== '0');
}

/** Waits two frames (layout + paint) and marks the page ready for screenshots. */
function markReady(): void {
  requestAnimationFrame(() => requestAnimationFrame(() => (document.documentElement.dataset.ready = '1')));
}

function renderSheet(): void {
  if (!app) return;
  app.className = 'app sheet';
  const name = presetOf(q.get('sheet'));
  const frames = Math.max(1, Math.min(48, Math.round(num(q.get('frames')) ?? 16)));
  const cols = Math.max(1, Math.min(frames, Math.round(num(q.get('cols')) ?? 4)));
  const rows = Math.ceil(frames / cols);
  const ledge = q.get('ledge') !== '0';
  const ratio = num(q.get('ratio'));
  const bunnies = bunniesOf(q.get('bunnies'));
  const custom = stepsOf(q.get('steps'));

  const head = el('div', 'sheet-head');
  const title = el('b', undefined, custom ? `custom · ${q.get('label') ?? 'steps'}` : `${name} · ${PRESET_LABELS[name]}`);
  const meta = el('span');
  head.append(title, meta);
  const grid = el('div', 'sheet-grid');
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  app.append(head, grid);

  const gap = 12;
  const labelH = 20;
  const cellW = (window.innerWidth - 36 - (cols - 1) * gap) / cols;
  const cellH = (window.innerHeight - 28 - 30 - (rows - 1) * gap) / rows - labelH;
  let w = cellW;
  let h = cellH;
  if (ratio) {
    w = Math.min(cellW, cellH * ratio);
    h = w / ratio;
  }
  // &crop=x,y,w,h (+ &sw=&sh= stage size): every cell shows that window of a full-size stage, 1:1
  const crop = (q.get('crop') ?? '').split(',').map(Number);
  const zoomed = crop.length === 4 && crop.every((v) => Number.isFinite(v));
  const sw = num(q.get('sw')) ?? 390;
  const sh = num(q.get('sh')) ?? 780;

  const stages: WelcomeStage[] = [];
  let duration = 0;
  let t0 = 0;
  let t1 = 0;
  for (let i = 0; i < frames; i++) {
    const cell = el('div', 'cell');
    grid.append(cell);
    const box = el('div');
    cell.append(box);
    let target: HTMLElement = box;
    if (zoomed) {
      const [cx = 0, cy = 0, cw = 100, ch = 100] = crop;
      box.style.cssText = `width:${cw}px;height:${ch}px;overflow:hidden;position:relative;border-radius:10px;box-shadow:0 0 0 1px rgba(60,40,20,.12)`;
      const inner = el('div');
      inner.style.cssText = `position:absolute;left:${-cx}px;top:${-cy}px;width:${sw}px;height:${sh}px`;
      box.append(inner);
      target = inner;
    } else {
      box.style.width = `${Math.floor(w)}px`;
      box.style.height = `${Math.floor(h)}px`;
    }
    const phone = phoneMock(target, { title: false, ledge });
    if (zoomed) {
      phone.phone.style.cssText = 'width:100%;height:100%;aspect-ratio:auto;border-radius:0;box-shadow:none';
    }
    const { inset, radius } = phone.layout();
    const s = new WelcomeStage(phone.host, {
      bunnies,
      choreography: custom ?? name,
      edgeInset: { bottom: inset },
      edgeRadius: { bottom: radius },
      reducedMotion: 'off',
      loop: q.get('loop') === '1',
    });
    if (i === 0) {
      duration = s.duration;
      t0 = Math.max(0, Number(q.get('t0') ?? 0) || 0);
      t1 = Math.max(t0, Number(q.get('t1') ?? duration) || duration);
    }
    const t = frames === 1 ? t0 : t0 + ((t1 - t0) * i) / (frames - 1);
    s.seek(t);
    stages.push(s);
    cell.append(el('small', undefined, `t = ${t.toFixed(2)} s`));
  }
  meta.textContent = `${frames} кадров · ${t0.toFixed(2)}–${t1.toFixed(2)} s (всего ${duration.toFixed(2)} s) · ${bunnies.join(', ')}${ledge ? ' · карточка снизу' : ''}`;
  (window as unknown as { stages: WelcomeStage[] }).stages = stages;
  markReady();
}

function renderFrame(): void {
  if (!app) return;
  app.className = 'app frame';
  const name = presetOf(q.get('frame'));
  const ledge = q.get('ledge') !== '0';
  const w = num(q.get('w')) ?? 390;
  const h = num(q.get('h')) ?? 780;
  const box = el('div');
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  // phone size exactly: the label next to it must not squeeze it (that resized the stage after seek)
  box.style.flex = 'none';
  app.append(box);
  const phone = phoneMock(box, { title: true, ledge });
  phone.phone.style.width = '100%';
  phone.phone.style.height = '100%';
  phone.phone.style.aspectRatio = 'auto';
  const { inset, radius } = phone.layout();
  const s = new WelcomeStage(phone.host, {
    bunnies: bunniesOf(q.get('bunnies')),
    choreography: stepsOf(q.get('steps')) ?? name,
    edgeInset: { bottom: inset },
    edgeRadius: { bottom: radius },
    reducedMotion: q.get('rm') === '1' ? 'force' : 'off',
  });
  const t = Number(q.get('t') ?? '0');
  if (q.get('rm') === '1') s.play();
  else s.seek(Number.isFinite(t) ? t : 0);
  app.append(el('div', 'frame-label', `${name} · t = ${(Number.isFinite(t) ? t : 0).toFixed(2)} s / ${s.duration.toFixed(2)} s`));
  (window as unknown as { welcome: WelcomeStage }).welcome = s;
  markReady();
}

if (q.get('static') === '1') renderStatic();
else if (q.get('screens')) { /* welcome-screens.ts renders the page */ }
else if (q.get('sheet')) renderSheet();
else if (q.get('frame')) renderFrame();
else renderDemo();
