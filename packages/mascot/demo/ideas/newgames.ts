/**
 * The 17 new game animations (30.10, GALLERY-ONLY until Felix approves them): the 7 Kosmos games that are in the
 * catalogue without an animation (workers/edge/src/giftIdeas/catalog.de.json ids — test/ideas-new-games.test.ts reads
 * that file and checks the ids) and 10 iconic games Felix asked for («монополию, уно и другие культовые»). 8 of them
 * were added to the catalogue on 30.10 (docs/handoffs/2026-10-30-iconic-games.md) and use its ids; Jenga and Scrabble
 * are not in the catalogue (the publishers give no player maximum / no playing time): PROVISIONAL keys "new:<slug>",
 * their scenes stay in the gallery only.
 *
 * Each one is a scene of newscenes.ts. The group is what you DO in the game (scenes.ts has the eight old ones; three
 * are new here). The names are only for the gallery (Felix reads Russian, the app would show the German one).
 */

import type { Archetype } from './scenes';
import type { NewVariant } from './newscenes';

export type NewArchetype = Archetype | 'board' | 'stack' | 'shed';

export const NEW_ARCHETYPES: Record<Exclude<NewArchetype, Archetype>, { de: string; ru: string }> = {
  board: { de: 'Brett-Klassiker', ru: 'Классика на поле (фишка ходит)' },
  stack: { de: 'Stapeln & Geschick', ru: 'Башня / ловкость' },
  shed: { de: 'Ablegen', ru: 'Сбросить карты / фишки' },
};

export interface NewGame {
  /** catalogue id (the 7) or a provisional key "new:<slug>" (the 10) */
  key: string;
  de: string;
  ru: string;
  archetype: NewArchetype;
  variant: NewVariant;
  /** one line for Felix (Russian): what the scene shows */
  line: string;
  inCatalog: boolean;
}

export const NEW_GAMES: readonly NewGame[] = [
  // ---------------------------------------------------------------- in the catalogue (Kosmos), no animation until now
  { key: 'cat:kosmos-sky-team', de: 'Sky Team', ru: 'Скай Тим («Небесная команда»)', archetype: 'coop', variant: 'cockpit', inCatalog: true,
    line: 'Два пилота кладут кубики (синий и оранжевый) в кабину, авиагоризонт выравнивается, самолёт садится на полосу.' },
  { key: 'cat:kosmos-die-crew', de: 'Die Crew – Jagd um die Welt', ru: 'Экипаж: Вокруг света', archetype: 'coop', variant: 'crew', inCatalog: true,
    line: 'Взятка вместе: четыре карты, козырь-вертолёт забирает её, задание (зелёная 7) отмечено галочкой, фишка экипажа шагает к самолёту.' },
  { key: 'cat:kosmos-flip-7', de: 'Flip 7 – Voll Fies', ru: 'Флип 7: Очень подло', archetype: 'luck', variant: 'flip', inCatalog: true,
    line: '«Ещё одну!»: карты слетают с колоды и переворачиваются — семь разных чисел, ряд подпрыгивает, «+15».' },
  { key: 'cat:kosmos-catan-big-box', de: 'CATAN – Big Box', ru: 'Колонизаторы (CATAN), большая коробка', archetype: 'dice', variant: 'catan', inCatalog: true,
    line: 'Шестиугольники с жетонами чисел; кубики 2 + 4 = 6 — поле «6» мигает, выдаёт карту зерна, ставится домик и дорога.' },
  { key: 'cat:kosmos-cities', de: 'Cities', ru: 'Города (Cities)', archetype: 'tiles', variant: 'district', inCatalog: true,
    line: 'Фигурка встаёт в ряд, из ряда прилетает плитка и закрывает квартал 3 × 3, на участке вырастает дом из трёх этажей.' },
  { key: 'cat:kosmos-wildwuchs', de: 'Wildwuchs', ru: 'Дикие заросли (Wildwuchs)', archetype: 'pattern', variant: 'garden', inCatalog: true,
    line: 'Семечко падает в грядку и прорастает, цветы одного цвета подрастают, пчела прилетает — и растёт ещё один (комбо).' },
  { key: 'cat:kosmos-happy-holiday', de: 'Happy Holiday', ru: 'Счастливого отпуска (Happy Holiday)', archetype: 'pattern', variant: 'planner', inCatalog: true,
    line: 'Плитка города ложится в план отпуска рядом с тем же городом, два чемодана прыгают на полку, за дни подряд — звёзды.' },
  // ---------------------------------------------------------------- iconic games (8 in the catalogue since 30.10; Jenga, Scrabble: provisional keys)
  { key: 'cat:hasbro-monopoly', de: 'Monopoly', ru: 'Монополия', archetype: 'board', variant: 'street', inCatalog: true,
    line: 'Кубики 1 + 2, фишка прыгает на три поля, всплывает карточка улицы, на улицу ставится зелёный домик.' },
  { key: 'cat:mattel-uno', de: 'UNO', ru: 'УНО', archetype: 'shed', variant: 'colors', inCatalog: true,
    line: 'На красную 7 веером ложатся красная 2, синяя 2, синяя 5; в руке осталась одна карта (смена цвета) — она качается, пузырь «1!».' },
  { key: 'cat:schmidt-mensch-aergere-dich-nicht', de: 'Mensch ärgere Dich nicht', ru: 'Не сердись, дружище (Лудо)', archetype: 'board', variant: 'ludo', inCatalog: true,
    line: 'Выпало 4: красная фишка проходит четыре поля и сбивает жёлтую — та кувырком летит обратно в домик.' },
  { key: 'cat:mattel-scrabble', de: 'Scrabble', ru: 'Скрабл (Эрудит)', archetype: 'words', variant: 'letters', inCatalog: true,
    line: 'Три фишки-буквы с подставки ложатся на поле и пересекают слово HAUS — получается BAUM, «+8».' },
  { key: 'cat:hasbro-cluedo', de: 'Cluedo', ru: 'Клуэдо', archetype: 'board', variant: 'detective', inCatalog: true,
    line: 'Из секретного конверта три карты: кто, чем, где — переворачиваются, сверху ложится лупа.' },
  { key: 'cat:schmidt-kniffel', de: 'Kniffel', ru: 'Книффель (покер на кубиках)', archetype: 'dice', variant: 'yahtzee', inCatalog: true,
    line: 'Пять кубиков из стаканчика — пять шестёрок, кубики подпрыгивают, в листке очков появляется «50».' },
  { key: 'cat:hasbro-jenga', de: 'Jenga', ru: 'Дженга', archetype: 'stack', variant: 'tower', inCatalog: true,
    line: 'Брусок выезжает из середины башни, башня качается — и стоит; брусок ложится наверх.' },
  { key: 'cat:jumbo-rummikub', de: 'Rummikub', ru: 'Руммикуб', archetype: 'shed', variant: 'rummy', inCatalog: true,
    line: 'С подставки на стол: синяя 6 продолжает ряд 3-4-5, три девятки разных цветов складываются в группу.' },
  { key: 'cat:zygomatic-dobble', de: 'Dobble', ru: 'Доббль', archetype: 'words', variant: 'spot', inCatalog: true,
    line: 'Две круглые карты въезжают с двух сторон; одна картинка (звезда) есть на обеих — она вспыхивает, пунктир их соединяет.' },
  { key: 'cat:piatnik-activity', de: 'Activity Original', ru: 'Активити', archetype: 'words', variant: 'activity', inCatalog: true,
    line: 'Песочные часы переворачиваются, карта открывается — выбор падает на «рисовать», на блокноте появляется домик, фишка команды шагает.' },
];

/** Tile tone per group (tiles.css --tile-1…4), the old ones as in anims.ts. */
export const NEW_TONE: Record<NewArchetype, 1 | 2 | 3 | 4> = { tiles: 1, route: 3, pattern: 4, words: 2, dice: 4, coop: 3, luck: 1, music: 2, board: 3, stack: 1, shed: 2 };
