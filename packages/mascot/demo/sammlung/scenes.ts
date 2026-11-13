/**
 * «Pompons Sammlung» — the scenes part (27.10, GALLERY-ONLY prototype, docs/design/2026-10-27-pompons-sammlung.md).
 * Every hidden / rare scene that plays in the app today (docs/handoffs/2026-10-27-approved-animations.md + the
 * approved «Погоня» and the three «Переел»), with a spoiler-free hint, where it is (shown only once found) and how to
 * show it again: each card replays the PACKAGE's own scene (TowerStage, HomeIconStage, ChaseStage, OverfedStage,
 * Hamster 'secret' / 'speck', the Lists buddy's footing) — nothing is redrawn here.
 *
 * A `Show` is mounted into a box of the scene's natural size (the size it has in the app); the gallery scales the box
 * with a CSS transform for the cards and the replay sheet. poster() = one still frame (the card picture), play() =
 * the scene once. Reduced motion = each scene's own calm version.
 */

import { ChaseStage, Hamster, OverfedStage } from '../../src/index';
import { HomeIconStage } from '../../src/homeicon';
import { TowerStage } from '../../src/tower';
import { HOST_H as TOWER_H } from '../../src/tower-plan';
import { ListsBuddy } from '../../src/buddy/index';
import { FirmGround } from '../firmground/firmground';
import { placeX } from '../firmground/gallery';

export type SceneId = 'tower' | 'speck' | 'psst' | 'footing' | 'homeicon' | 'chase' | 'overfed-a' | 'overfed-b' | 'overfed-c';

export interface Text {
  de: string;
  ru: string;
}

export interface SceneCard {
  id: SceneId;
  /** name, shown only once found (unfound cards say «???») */
  title: Text;
  /** the playful hint on the silhouette: never names the scene, the gesture, or what happens */
  hint: Text;
  /** where it plays — revealed only once found */
  where: Text;
  /** the scene can only be found on some devices (shown under the hint) */
  only?: Text;
  /** the natural box of the scene, px (as in the app) */
  box: { w: number; h: number };
  /** a card strip under the scene (its "edge"): top of the strip, px from the box's top */
  ledge?: number;
}

export const SCENES: readonly SceneCard[] = [
  {
    id: 'tower',
    title: { de: 'Die Bremer Hasen', ru: 'Бременская башня' },
    hint: { de: 'Manche kleinen Zeilen mögen es, wenn man sie öfter antippt.', ru: 'Некоторые маленькие строчки любят, когда их трогают много раз.' },
    where: { de: 'Profil · 5× auf die Versionszeile tippen', ru: 'Profil · 5 касаний по строке версии' },
    box: { w: 390, h: TOWER_H + 24 },
    ledge: TOWER_H - 16,
  },
  {
    id: 'speck',
    title: { de: 'Staub auf der Linse', ru: 'Пылинка на линзе' },
    hint: { de: 'Wer nach Freunden Ausschau hält, sieht manchmal nicht ganz klar.', ru: 'Кто высматривает друзей, иногда видит не совсем ясно.' },
    where: { de: 'Listen → Freunde, leere Karte: Tapsi antippen', ru: 'Listen → Freunde, пустая карточка: коснуться Тапси' },
    box: { w: 240, h: 190 },
    ledge: 170,
  },
  {
    id: 'psst',
    // the giver-only moment: the hint speaks of keeping a secret in general — it never says whose or which
    title: { de: 'Psst!', ru: 'Psst' },
    hint: { de: 'Tapsi kann ein Geheimnis für sich behalten. Hilf ihm einmal dabei.', ru: 'Тапси умеет хранить секреты. Помоги ему однажды.' },
    where: { de: 'Bei einem Wunsch von Freunden: «Ich schenke das»', ru: 'В желании друга: «Я дарю это»' },
    box: { w: 240, h: 190 },
    ledge: 170,
  },
  {
    id: 'footing',
    title: { de: 'Fester Boden', ru: 'Твёрдая почва' },
    hint: { de: 'Pompon steht gern sicher. Und ganz nah an einer Kante?', ru: 'Помпон любит стоять уверенно. А у самого края?' },
    where: { de: 'Listen: Pompon nahe an einer Kartenkante absetzen', ru: 'Listen: опустить Помпона у края карточки' },
    box: { w: 260, h: 176 },
  },
  {
    id: 'homeicon',
    title: { de: 'Hier wohne ich', ru: 'Здесь я буду жить' },
    hint: { de: 'Pompon sucht ein Zuhause – direkt auf deinem Bildschirm.', ru: 'Помпон ищет домик — прямо на твоём экране.' },
    where: { de: 'Einstieg · «Zum Home-Bildschirm» (iPhone, einmal)', ru: 'Онбординг · «Zum Home-Bildschirm» (iPhone, один раз)' },
    only: { de: 'nur auf dem iPhone', ru: 'только на iPhone' },
    box: { w: 390, h: 300 },
    ledge: 266,
  },
  {
    id: 'chase',
    title: { de: 'Die Selleriejagd', ru: 'Погоня за сельдереем' },
    hint: { de: 'Wenn etwas lange lädt: nicht wegschauen.', ru: 'Если что-то долго грузится — не отводи глаз.' },
    where: { de: 'Start und Wunsch-Link, wenn es dauert', ru: 'Start и ссылка желания, когда долго грузится' },
    box: { w: 390, h: 150 },
    ledge: 120,
  },
  {
    id: 'overfed-a',
    title: { de: 'Genug!', ru: 'Хватит!' },
    hint: { de: 'Schau dir alle Ideen bis zum Ende an. Hier gibt es zwei Enden.', ru: 'Досмотри все идеи до конца. У этой истории два конца.' },
    where: { de: 'Ideen · der Stapel ist durch (eines von zwei Enden)', ru: 'Ideen · колода закончилась (один из двух концов)' },
    box: { w: 358, h: 150 },
  },
  {
    id: 'overfed-b',
    title: { de: 'Der letzte Bissen', ru: 'Последний кусочек' },
    hint: { de: 'Wer alle Ideen gesehen hat, macht manchmal ein Nickerchen.', ru: 'Кто посмотрел все идеи, иногда задрёмывает.' },
    where: { de: 'Ideen · der Stapel ist durch (eines von zwei Enden)', ru: 'Ideen · колода закончилась (один из двух концов)' },
    box: { w: 358, h: 150 },
  },
  {
    id: 'overfed-c',
    title: { de: 'Hicks!', ru: 'Ик!' },
    hint: { de: 'Viele eigene Wünsche am Stück machen ganz schön satt.', ru: 'Много своих желаний подряд — это очень сытно.' },
    where: { de: 'Deine Liste · der 5. Wunsch hintereinander', ru: 'Твой список · 5-е желание подряд' },
    box: { w: 358, h: 150 },
  },
];

export const SCENE_IDS: readonly SceneId[] = SCENES.map((s) => s.id);
export const scene = (id: SceneId): SceneCard => SCENES.find((s) => s.id === id) as SceneCard;

/** Words a hint or a title must never contain (the reservation is the product's secret; tests check this). */
export const NEVER_SAY: readonly RegExp[] = [/reserv/i, /брон/i, /verschenkt|vergeben/i, /jemand.*(dir|deine)/i, /кто-то.*(тво|тебе)/i];

/** One mounted scene. */
export interface Show {
  readonly duration: number;
  poster(): void;
  play(): void;
  /** one frozen frame of the scene at t seconds (screenshots, the sheet's &t=) */
  seek(t: number): void;
  /** resolves when a play() is over (natural end) */
  readonly done: Promise<void>;
  destroy(): void;
}

const raf = (cb: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => cb()) : setTimeout(cb, 16));

/** The still frame of each scene on its card (seconds; chosen so the scene reads at a glance). */
export const POSTER_T: Record<SceneId, number> = { tower: 2.75, speck: 0, psst: 0, footing: 0.42, homeicon: 0, chase: 1.5, 'overfed-a': 1.9, 'overfed-b': 3.2, 'overfed-c': 1.1 };

function ledgeEl(card: SceneCard): HTMLElement | null {
  if (card.ledge === undefined) return null;
  const l = document.createElement('div');
  l.className = 'sm-ledge';
  l.style.top = `${card.ledge}px`;
  return l;
}

/** Pauses every animation under `node` (shadow roots included) at `t` s; false = none there yet. */
export function freezeUnder(node: Element, t: number): boolean {
  let any = false;
  const visit = (root: Element | ShadowRoot) => {
    const els = root instanceof ShadowRoot ? Array.from(root.querySelectorAll('*')) : [root, ...Array.from(root.querySelectorAll('*'))];
    for (const e of els) {
      for (const a of e.getAnimations?.() ?? []) {
        any = true;
        a.pause();
        a.currentTime = t * 1000;
      }
      if (e.shadowRoot) visit(e.shadowRoot);
    }
  };
  visit(node);
  return any;
}

/** Mounts scene `id` into `box` (already in the document, sized card.box). */
export function mountShow(id: SceneId, box: HTMLElement, reduced: boolean): Show {
  const card = scene(id);
  box.replaceChildren();
  const ledge = ledgeEl(card);
  if (ledge) box.append(ledge);
  const host = document.createElement('div');
  host.className = 'sm-scene-host';
  box.append(host);
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  if (id === 'tower') {
    Object.assign(host.style, { left: '0', top: '0', width: `${card.box.w}px`, height: `${TOWER_H}px` });
    let stage: TowerStage | null = null;
    const make = () => {
      stage?.destroy();
      stage = new TowerStage(host, { reduced, card: { left: 16, width: card.box.w - 32, radius: 22 }, onEnd: resolveDone });
      return stage;
    };
    const s = make();
    return {
      duration: s.duration,
      done,
      poster: () => make().seek(reduced ? 1 : POSTER_T.tower),
      play: () => make().play(),
      seek: (t) => make().seek(t),
      destroy: () => stage?.destroy(),
    };
  }

  if (id === 'homeicon') {
    Object.assign(host.style, { left: '0', top: '0', width: `${card.box.w}px`, height: `${card.box.h}px` });
    let stage: HomeIconStage | null = null;
    const make = (still: boolean) => {
      stage?.destroy();
      stage = new HomeIconStage(host, { reduced, still, label: 'Bunprise', onEnd: resolveDone });
      return stage;
    };
    const s = make(true);
    return {
      duration: s.duration,
      done,
      poster: () => { const st = make(false); st.seek(st.duration); },
      play: () => make(false).play(),
      seek: (t) => make(false).seek(t),
      destroy: () => stage?.destroy(),
    };
  }

  if (id === 'chase' || id.startsWith('overfed-')) {
    const h = id === 'chase' ? 120 : card.box.h;
    Object.assign(host.style, { left: '0', top: '0', width: `${card.box.w}px`, height: `${h}px` });
    let stage: ChaseStage | OverfedStage | null = null;
    const make = () => {
      stage?.destroy();
      host.replaceChildren();
      const rm = reduced ? 'force' : 'off';
      stage = id === 'chase'
        ? new ChaseStage(host, { reducedMotion: rm, coat: 'fawn' })
        : new OverfedStage(host, { reducedMotion: rm, coat: 'fawn', illustration: true, variant: id.slice(8) as 'a' | 'b' | 'c' });
      void stage.done.then(resolveDone);
      return stage;
    };
    const s = make();
    return {
      duration: s.duration,
      done,
      poster: () => { const st = make(); st.seek(reduced ? st.duration : POSTER_T[id]); },
      play: () => make().play(),
      seek: (t) => make().seek(t),
      destroy: () => stage?.destroy(),
    };
  }

  if (id === 'speck' || id === 'psst') {
    Object.assign(host.style, { left: `${(card.box.w - 150) / 2}px`, top: `${(card.ledge ?? 170) - 94}px`, width: '150px' });
    let m: Hamster | null = null;
    const make = (idle: boolean) => {
      m?.destroy();
      host.replaceChildren();
      m = new Hamster(host, { size: 150, idle, interactive: false, reducedMotion: reduced ? 'force' : 'off', coat: 'golden', ...(id === 'speck' ? { holding: 'binoculars' as const } : {}) });
      return m;
    };
    make(false);
    return {
      duration: id === 'psst' ? 2.6 : 1.6,
      done,
      poster: () => { const h2 = make(false); if (id === 'psst') h2.pose('psst'); },
      play: () => { const h2 = make(false); void h2.play(id === 'psst' ? 'secret' : 'speck').then(resolveDone); },
      seek: (t) => {
        const h2 = make(false);
        void h2.play(id === 'psst' ? 'secret' : 'speck');
        // the scene module loads lazily: freeze its animations once they exist
        const until = performance.now() + 1500;
        const tick = () => { if (!freezeUnder(host, t) && performance.now() < until) raf(tick); };
        raf(tick);
      },
      destroy: () => m?.destroy(),
    };
  }

  // footing: the REAL Lists buddy (`footing: true`) on a card's rounded end; the replay sets him down there. He measures
  // his floors on screen, so his box is never CSS-scaled: it has the size it is shown at (96 px buddy, 64 px in a card).
  const W = box.clientWidth || card.box.w;
  const H = box.clientHeight || card.box.h;
  const small = H < 150;
  Object.assign(host.style, { left: '0', top: '0', width: `${W}px`, height: `${H}px` });
  const cardEl = document.createElement('div');
  cardEl.className = 'sm-buddy-card';
  cardEl.dataset['buddyFloor'] = 'c';
  cardEl.dataset['buddyCard'] = '0';
  Object.assign(cardEl.style, { left: '-60px', top: `${H - (small ? 30 : 56)}px`, width: `${W - (small ? 0 : 20)}px`, height: '80px', borderRadius: `${small ? 18 : 24}px` });
  host.append(cardEl);
  let buddy: ListsBuddy | null = null;
  let fg: FirmGround | null = null;
  const make = () => {
    fg?.detach();
    buddy?.destroy();
    buddy = new ListsBuddy({ stage: host, scroller: null, kind: 'bunny', width: small ? 64 : 96, reducedMotion: reduced ? 'force' : 'off', autonomous: false, groundInset: 0, footing: true, onFooting: (e) => { if (e.kind === 'done' || e.kind === 'reduced') resolveDone(); } });
    fg = new FirmGround(buddy);
    return fg;
  };
  return {
    duration: 1.2,
    done,
    poster: () => {
      const f = make();
      raf(() => { const x = placeX(f, 'c', 'corner', 1); if (x !== null) f.freeze('c', x, reduced ? 0 : POSTER_T.footing); });
    },
    play: () => {
      const f = make();
      raf(() => { const x = placeX(f, 'c', 'corner', 1); if (x !== null) void f.dropAt('c', x); });
    },
    seek: (t) => {
      const f = make();
      raf(() => { const x = placeX(f, 'c', 'corner', 1); if (x !== null) f.freeze('c', x, t); });
    },
    destroy: () => { fg?.detach(); buddy?.destroy(); },
  };
}
