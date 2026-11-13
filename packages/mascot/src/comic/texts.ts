/**
 * Every text of the comic «Pompon & Tapsi» — episode 1 «Ein Wunsch rollt an» and episode 2 «Zweimal derselbe Schal» —
 * in the app's four languages (German first, as in the app; Russian for Felix since 26.10; English and Ukrainian
 * added 31.10 for the app's reader). Real text: the reader shows it as text (translatable, readable by screen
 * readers), drawn like a comic; sound effects are drawn into the art (decorative). Every line ≤ 70 characters
 * (tests). Names: Pompon / Tapsi / Mila / Momo — Помпон / Тапси / Мила / Момо (RU), Помпон / Тапсі / Міла / Момо (UK),
 * as the app's locales spell them. All names, dates and wishes are invented.
 *
 * `kind` says what a text is, in Russian for Felix: плашка (narration box) / реплика / звук / шёпот …
 */

export type ComicLang = 'de' | 'en' | 'ru' | 'uk';
export const COMIC_LANGS: readonly ComicLang[] = ['de', 'en', 'ru', 'uk'];

export interface ComicText {
  kind: string;
  de: string;
  en: string;
  ru: string;
  uk: string;
}

/** A text in one language. */
export function say(t: Readonly<Record<ComicLang, string>>, lang: ComicLang): string {
  return t[lang];
}

// ---- episode 1 «Ein Wunsch rollt an» ---------------------------------------------------------------------------

/** The story beats (the same since v1, 26.10). */
export const T = {
  p1: { kind: 'плашка', de: 'Pompon weiß, wann. Aber was schenkt er Mila?', en: 'Pompon knows when. But what will he give Mila?', ru: 'Помпон знает, когда. Но что подарить Миле?', uk: 'Помпон знає, коли. Але що подарувати Мілі?' },
  p2: { kind: 'плашка', de: 'Tapsi hütet die Wünsche. Milas: eine Gießkanne.', en: 'Tapsi keeps the wishes. Mila’s: a watering can.', ru: 'Тапси хранит желания. У Милы — лейка.', uk: 'Тапсі береже бажання. У Міли — лійка.' },
  p3: { kind: 'звук', de: 'Hicks!', en: 'Hic!', ru: 'Ик!', uk: 'Гик!' },
  p5: { kind: 'реплика Помпона', de: 'Die Gießkanne schenke ich Mila!', en: 'I’ll give Mila the watering can!', ru: 'Лейку Миле подарю я!', uk: 'Лійку Мілі подарую я!' },
  p6box: { kind: 'плашка', de: 'Wer was schenkt, bleibt für Mila geheim.', en: 'Who gives what stays a secret from Mila.', ru: 'Кто что дарит — для Милы секрет.', uk: 'Хто що дарує — для Міли таємниця.' },
  p6mila: { kind: 'реплика Милы (издалека)', de: 'Hallo, ihr zwei!', en: 'Hi, you two!', ru: 'Привет, вы двое!', uk: 'Привіт, ви двоє!' },
  p6psst: { kind: 'шёпот Тапси', de: 'Psst!', en: 'Shh!', ru: 'Тсс!', uk: 'Тсс!' },
  p7ask: { kind: 'реплика Помпона', de: 'Kommst du mit?', en: 'Want to come along?', ru: 'Пойдёшь со мной?', uk: 'Підеш зі мною?' },
  p7box: { kind: 'плашка', de: 'Pompon weiß, wann. Tapsi weiß, was.', en: 'Pompon knows when. Tapsi knows what.', ru: 'Помпон знает, когда. Тапси знает, что.', uk: 'Помпон знає, коли. Тапсі знає, що.' },
} satisfies Record<string, ComicText>;

export const EPISODE_TITLE: Record<ComicLang, string> & { end: Record<ComicLang, string> } = {
  de: 'Ein Wunsch rollt an',
  en: 'A Wish Rolls In',
  ru: 'Желание прикатилось',
  uk: 'Бажання прикотилося',
  end: {
    de: 'So haben sich Pompon und Tapsi kennengelernt.',
    en: 'That’s how Pompon and Tapsi met.',
    ru: 'Вот так Помпон и Тапси познакомились.',
    uk: 'Ось так Помпон і Тапсі познайомилися.',
  },
};

/** The title line and the end mark (since v2, 30.10). */
export const STRIP_TEXT = {
  folge: { kind: 'заголовок', de: 'Folge 1 · Ein Wunsch rollt an', en: 'Episode 1 · A Wish Rolls In', ru: 'Серия 1 · Желание прикатилось', uk: 'Серія 1 · Бажання прикотилося' },
  end: { kind: 'конец', de: 'Ende von Folge 1', en: 'End of episode 1', ru: 'Конец серии 1', uk: 'Кінець серії 1' },
} satisfies Record<string, ComicText>;

/** The sound effects drawn into the art (v4). */
export const SFX = {
  roll: { kind: 'звук (катится)', de: 'KULLER KULLER', en: 'TUMBLE TUMBLE', ru: 'КУВЫРК-КУВЫРК', uk: 'КУВИРК-КУВИРК' },
  land: { kind: 'звук (бух)', de: 'PLUMPS!', en: 'THUMP!', ru: 'БУХ!', uk: 'БУХ!' },
  eat: { kind: 'звук (ням)', de: 'MAMPF!', en: 'NOM!', ru: 'НЯМ!', uk: 'НЯМ!' },
} satisfies Record<string, ComicText>;

/** Two narration boxes that make the middle clearer (v4.1, 31.10). */
export const ROLLING: ComicText = { kind: 'плашка (склон)', de: 'Mit Milas Wunsch im Arm kullert Tapsi den Hügel hinunter …', en: 'Hugging Mila’s wish, Tapsi tumbles down the hill …', ru: 'С желанием Милы в лапах Тапси катится с холма…', uk: 'З бажанням Міли в лапках Тапсі котиться з пагорба…' };
export const IDEA: ComicText = { kind: 'плашка (идея)', de: 'Milas Wunsch + Milas Fest = Pompons Idee!', en: 'Mila’s wish + Mila’s party = Pompon’s idea!', ru: 'Желание Милы + праздник Милы = идея Помпона!', uk: 'Бажання Міли + свято Міли = ідея Помпона!' };

/** One sentence per story beat for screen readers (the picture itself is decoration), beats 1 … 7. */
export const ALT1: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, Record<ComicLang, string>>> = {
  1: {
    de: 'Pompons Bau mit einer Tür für jeden Tag; Tür 14 leuchtet. Pompon hält Milas Einladung, daneben eine leere Geschenkbox.',
    en: 'Pompon’s burrow with a door for every day; door 14 glows. Pompon holds Mila’s invitation, an empty gift box beside him.',
    ru: 'Нора Помпона с дверцей на каждый день; дверца 14 светится. Помпон держит приглашение Милы, рядом пустая коробка.',
    uk: 'Нора Помпона з дверцятами на кожен день; дверцята 14 світяться. Помпон тримає запрошення Міли, поруч порожня коробка.',
  },
  2: {
    de: 'Auf dem Hügel reicht Mila Tapsi einen leuchtenden Stern mit einer Gießkanne darin.',
    en: 'On the hill, Mila hands Tapsi a glowing star with a watering can inside.',
    ru: 'На холме Мила протягивает Тапси светящуюся звёздочку с лейкой внутри.',
    uk: 'На пагорбі Міла простягає Тапсі сяйливу зірочку з лійкою всередині.',
  },
  3: {
    de: 'Tapsi hat Schluckauf und kugelt mit dem Stern im Arm den Hügel hinunter, hinter ihm eine Glitzerspur.',
    en: 'Tapsi gets the hiccups and tumbles down the hill hugging the star, a trail of glitter behind him.',
    ru: 'Тапси икает и катится с холма со звездой в лапках, за ним — дорожка искорок.',
    uk: 'Тапсі гикає й котиться з пагорба із зіркою в лапках, за ним — доріжка іскорок.',
  },
  4: {
    de: 'Tapsi landet benommen im Moos neben Pompon; die Einladung liegt zwischen ihnen. Beide neigen sich zueinander.',
    en: 'Tapsi lands, dizzy, in the moss next to Pompon; the invitation lies between them. Both lean towards each other.',
    ru: 'Тапси, ошалевший, приземляется в мох рядом с Помпоном; между ними лежит приглашение. Оба наклоняются друг к другу.',
    uk: 'Тапсі, приголомшений, падає в мох поруч із Помпоном; між ними лежить запрошення. Обоє нахиляються одне до одного.',
  },
  5: {
    de: 'Großaufnahme: Milas Stern lehnt an ihrer Einladung, Pompons Nase ist direkt daran.',
    en: 'Close-up: Mila’s star leans against her invitation, Pompon’s nose right next to it.',
    ru: 'Крупный план: звезда Милы прислонилась к её приглашению, нос Помпона прямо у звезды.',
    uk: 'Великий план: зірка Міли притулилася до її запрошення, ніс Помпона просто біля зірки.',
  },
  6: {
    de: 'Der Stern leuchtet jetzt in Tapsis Backe. Mila winkt vom Hügel, Tapsi hält sich beide Pfoten vor den Mund.',
    en: 'The star now glows in Tapsi’s cheek. Mila waves from the hill, Tapsi holds both paws over his mouth.',
    ru: 'Звезда теперь светится у Тапси за щекой. Мила машет с холма, Тапси закрывает рот обеими лапками.',
    uk: 'Зірка тепер світиться в Тапсі за щокою. Міла махає з пагорба, Тапсі затуляє рот обома лапками.',
  },
  7: {
    de: 'An Tür 14 schiebt Pompon die Einladung mit dem „+1“ zu Tapsi. Beide lächeln, die Backe leuchtet noch.',
    en: 'At door 14, Pompon pushes the invitation with the “+1” over to Tapsi. Both smile, the cheek still glows.',
    ru: 'У дверцы 14 Помпон подталкивает приглашение с «+1» к Тапси. Оба улыбаются, щека ещё светится.',
    uk: 'Біля дверцят 14 Помпон підсуває запрошення з «+1» до Тапсі. Обоє усміхаються, щока ще світиться.',
  },
};

/** The end line of an episode («So haben sich … kennengelernt.») as a text. */
const END1: ComicText = { kind: 'конец', ...EPISODE_TITLE.end };

/** Every text of episode 1 (v4 manga), in reading order (tests: ≤ 70 characters, every language). */
export const MANGA_TEXTS: readonly ComicText[] = [
  STRIP_TEXT.folge, T.p1, T.p2, T.p3, ROLLING, SFX.roll, SFX.land, IDEA, T.p5, SFX.eat, T.p6box, T.p6mila, T.p6psst, T.p7ask, T.p7box,
  END1, STRIP_TEXT.end,
];

// ---- episode 2 «Zweimal derselbe Schal» ------------------------------------------------------------------------

export const T2 = {
  folge: { kind: 'заголовок', de: 'Folge 2 · Zweimal derselbe Schal', en: 'Episode 2 · The Same Scarf Twice', ru: 'Серия 2 · Дважды один и тот же шарф', uk: 'Серія 2 · Двічі той самий шарф' },
  e1: { kind: 'плашка', de: 'Momo hat Geburtstag. Pompon weiß es natürlich.', en: 'It’s Momo’s birthday. Pompon knows, of course.', ru: 'У Момо день рождения. Помпон, конечно, знает.', uk: 'У Момо день народження. Помпон, звісно, знає.' },
  e3: { kind: 'Помпон и Мила (хором)', de: 'Für dich, Momo!', en: 'For you, Momo!', ru: 'Это тебе, Момо!', uk: 'Це тобі, Момо!' },
  e5: { kind: 'Тапси', de: 'Oh nein.', en: 'Oh no.', ru: 'Ой-ой.', uk: 'Ой-ой.' },
  e6: { kind: 'Тапси', de: 'Ich hab eine Idee!', en: 'I have an idea!', ru: 'У меня идея!', uk: 'У мене ідея!' },
  e7: { kind: 'плашка', de: 'Ein Jahr später …', en: 'A year later …', ru: 'Через год…', uk: 'Через рік…' },
  e8: { kind: 'плашка', de: 'Momo gibt Tapsi seine Wünsche.', en: 'Momo gives Tapsi his wishes.', ru: 'Момо отдаёт Тапси свои желания.', uk: 'Момо віддає Тапсі свої бажання.' },
  e9: { kind: 'плашка', de: 'Sicher. Und für alle Freunde.', en: 'Kept safe. And there for all his friends.', ru: 'Надёжно. И для всех друзей.', uk: 'Надійно. І для всіх друзів.' },
  e10: { kind: 'Помпон', de: 'Das Buch, bitte!', en: 'The book, please!', ru: 'Мне книгу!', uk: 'Мені книжку!' },
  e11: { kind: 'Мила', de: 'Schon vergeben? Dann die Pflanze!', en: 'Already taken? Then the plant!', ru: 'Уже занято? Тогда цветок!', uk: 'Уже зайнято? Тоді квітку!' },
  e12a: { kind: 'плашка', de: 'So sehen es die Freunde.', en: 'What the friends see.', ru: 'Так видят друзья.', uk: 'Так бачать друзі.' },
  e12b: { kind: 'плашка', de: 'So sieht es Momo.', en: 'What Momo sees.', ru: 'Так видит Момо.', uk: 'Так бачить Момо.' },
  e13: { kind: 'Момо', de: 'Genau, was ich mir gewünscht habe!', en: 'Just what I wished for!', ru: 'Именно то, что я хотел!', uk: 'Саме те, що я хотів!' },
  e14: { kind: 'шёпот Тапси', de: 'Psst. Tapsi verrät nichts.', en: 'Shh. Tapsi won’t tell.', ru: 'Тсс. Тапси ничего не выдаст.', uk: 'Тсс. Тапсі нічого не видасть.' },
  tag: { kind: 'плашка (конец)', de: 'Wer was schenkt, bleibt geheim. Und nie doppelt.', en: 'Who gives what stays secret. And never twice.', ru: 'Кто что дарит — секрет. И никогда дважды.', uk: 'Хто що дарує — таємниця. І ніколи двічі.' },
  end: { kind: 'конец', de: 'Ende von Folge 2', en: 'End of episode 2', ru: 'Конец серии 2', uk: 'Кінець серії 2' },
} satisfies Record<string, ComicText>;

/** Every text of episode 2 in reading order (tests). */
export const MANGA2_TEXTS: readonly ComicText[] = [
  T2.folge, T2.e1, T2.e3, T2.e5, T2.e6, T2.e7, T2.e8, T2.e9, T2.e10, SFX.eat, T2.e11, T2.e12a, T2.e12b, T2.e13, T2.e14, T2.tag, T2.end,
];

/** One sentence per beat of episode 2 for screen readers. */
export const ALT2: Readonly<Record<string, Record<ComicLang, string>>> = {
  e1: { de: 'Pompons Bau: Tür 21 leuchtet, Momo hat Geburtstag.', en: 'Pompon’s burrow: door 21 glows, it’s Momo’s birthday.', ru: 'Нора Помпона: светится дверца 21 — у Момо день рождения.', uk: 'Нора Помпона: світяться дверцята 21 — у Момо день народження.' },
  e2: { de: 'Pompon und Mila tragen jeder genau das gleiche Paket.', en: 'Pompon and Mila each carry exactly the same parcel.', ru: 'Помпон и Мила несут одинаковые коробки.', uk: 'Помпон і Міла несуть однакові коробки.' },
  e3: { de: 'Beide schenken Momo denselben gestreiften Schal.', en: 'Both give Momo the same striped scarf.', ru: 'Оба дарят Момо одинаковый полосатый шарф.', uk: 'Обоє дарують Момо однаковий смугастий шарф.' },
  e4: { de: 'Peinliche Stille: drei erstarrte Gesichter.', en: 'An awkward silence: three frozen faces.', ru: 'Неловкая пауза: три застывших лица.', uk: 'Незручна пауза: три завмерлі мордочки.' },
  e5: { de: 'Tapsi hält sich die Augen zu, dann hat er eine Idee.', en: 'Tapsi covers his eyes with his paws, then he has an idea.', ru: 'Тапси закрывает глаза лапками, потом ему приходит идея.', uk: 'Тапсі затуляє очі лапками, а потім у нього з’являється ідея.' },
  e8: { de: 'Ein Jahr später gibt Momo Tapsi seine drei Wunschsterne.', en: 'A year later, Momo gives Tapsi his three wish stars.', ru: 'Через год Момо отдаёт Тапси три звезды-желания.', uk: 'Через рік Момо віддає Тапсі три зірки-бажання.' },
  e10: { de: 'Pompon wählt das Buch, Tapsi versteckt den Stern in der Backe.', en: 'Pompon picks the book, Tapsi hides the star in his cheek.', ru: 'Помпон выбирает книгу, Тапси прячет звезду в щёку.', uk: 'Помпон вибирає книжку, Тапсі ховає зірку за щоку.' },
  e11: { de: 'Mila sieht: das Buch ist vergeben, und nimmt die Pflanze.', en: 'Mila sees the book is taken and picks the plant.', ru: 'Мила видит: книга занята — и берёт цветок.', uk: 'Міла бачить: книжку вже зайнято — і бере квітку.' },
  e12: { de: 'Die Freunde sehen, was vergeben ist; Momos Liste sieht aus wie immer.', en: 'The friends see what is taken; Momo’s list looks the same as always.', ru: 'Друзья видят, что занято; у Момо список как всегда.', uk: 'Друзі бачать, що зайнято; у Момо список як завжди.' },
  e13: { de: 'Zwei verschiedene Geschenke, Momo springt vor Freude.', en: 'Two different gifts, Momo jumps for joy.', ru: 'Два разных подарка, Момо прыгает от радости.', uk: 'Два різні подарунки, Момо стрибає від радості.' },
  e14: { de: 'Tapsi flüstert «Psst», noch ein Stern blitzt aus seiner Backe.', en: 'Tapsi whispers “Shh”, another star peeks out of his cheek.', ru: 'Тапси шепчет «тсс», из щеки выглядывает ещё одна звёздочка.', uk: 'Тапсі шепоче «тсс», зі щоки визирає ще одна зірочка.' },
};

/** The episodes of the comic: their title line, short title and end mark. */
export const EPISODES = {
  1: { folge: STRIP_TEXT.folge, title: EPISODE_TITLE, end: STRIP_TEXT.end },
  2: { folge: T2.folge, end: T2.end },
} as const;
export type EpisodeNumber = keyof typeof EPISODES;
