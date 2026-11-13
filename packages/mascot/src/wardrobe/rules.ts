/**
 * «Pompons Sammlung» — the wardrobe's RULES (no drawings, no DOM; docs/design/2026-10-27-pompons-sammlung.md §5).
 * Tiny on purpose: the app decides what Pompon wears from these alone and loads the drawings (./outfits.ts,
 * `@bunprise/mascot/wardrobe`) only when he really wears something. Subpath `@bunprise/mascot/wardrobe-rules`.
 *
 * Six outfits, at most one at a time, in the order of the year (the party hat last). Felix 28.10: variant B — in
 * «nach Jahreszeit» mode everyone wears the season's outfit; each found scene unlocks one more outfit (in this order)
 * to wear by hand on any day of the year. A counter, not a pairing: which outfit someone has never tells WHICH scene
 * they found (the reservation moment «Psst» is one of them). What he wears depends ONLY on the date, the person's own
 * choice and the number of finds — never on reservations, other people or their lists.
 */

/** A day of the year as [day, month]. */
export type DayMonth = readonly [number, number];

export type OutfitId = 'leaf' | 'scarf' | 'nikolaus' | 'winterhat' | 'daisy' | 'party';

/**
 * The costumes from Felix's photos he approved 31.10 (./costumes.ts, the laptop: ./laptop.ts composition A; spa came
 * 13th: «Спа отлично»). They are never worn by date: only when the person picks one. WHEN one is the person's is the
 * app's decision (its own milestones, apps/web features/sammlung/milestones.ts) — this list has no rule of its own.
 */
export type CostumeId =
  | 'sport' | 'groom' | 'pancake' | 'knight' | 'bandana' | 'lily' | 'samurai' | 'reading' | 'bunnyhood' | 'sunglasses' | 'shark' | 'laptop' | 'spa';
export const COSTUME_IDS: readonly CostumeId[] = ['sport', 'groom', 'pancake', 'knight', 'bandana', 'lily', 'samurai', 'reading', 'bunnyhood', 'sunglasses', 'shark', 'laptop', 'spa'];
export const isCostumeId = (v: unknown): v is CostumeId => typeof v === 'string' && (COSTUME_IDS as readonly string[]).includes(v);

/** Everything Pompon can wear: a seasonal outfit or a costume. */
export type WearId = OutfitId | CostumeId;

/** What the wardrobe does: dress by the date by itself, wear nothing, or one outfit / costume the person chose. */
export type WearChoice = 'auto' | 'none' | OutfitId | CostumeId;

export interface Outfit {
  id: OutfitId;
  /** German name (the gallery; the app's names come from its locales) */
  de: string;
  /** Russian name (for Felix, the gallery) */
  ru: string;
  /** when it comes by itself in «nach Jahreszeit» mode (empty = never by date: the birthday hat) */
  spans: readonly { from: DayMonth; to: DayMonth }[];
  /** the season as people read it */
  whenDe: string;
  whenRu: string;
  /** a new drawing of the Sammlung (true) or a wardrobe v2 item */
  fresh: boolean;
}

/** In the order of the year, the occasion hat last (the order finds unlock them in). Dates: Felix 28.10 (§0). */
export const OUTFITS: readonly Outfit[] = [
  { id: 'leaf', de: 'Ahornblatt', ru: 'Кленовый листик', spans: [{ from: [22, 9], to: [31, 10] }], whenDe: '22.9. – 31.10.', whenRu: '22.09 – 31.10', fresh: true },
  { id: 'scarf', de: 'Schal', ru: 'Шарф', spans: [{ from: [1, 11], to: [5, 12] }], whenDe: '1.11. – 5.12.', whenRu: '01.11 – 05.12', fresh: false },
  { id: 'nikolaus', de: 'Nikolausmütze', ru: 'Шапка Николауса', spans: [{ from: [6, 12], to: [26, 12] }], whenDe: '6.12. – 26.12.', whenRu: '06.12 – 26.12', fresh: true },
  { id: 'winterhat', de: 'Wintermütze', ru: 'Зимняя шапка', spans: [{ from: [27, 12], to: [31, 12] }, { from: [1, 1], to: [28, 2] }], whenDe: '27.12. – 28.2.', whenRu: '27.12 – 28.02', fresh: true },
  { id: 'daisy', de: 'Gänseblümchen', ru: 'Маргаритка', spans: [{ from: [1, 3], to: [31, 5] }], whenDe: '1.3. – 31.5.', whenRu: '01.03 – 31.05', fresh: true },
  { id: 'party', de: 'Partyhut', ru: 'Праздничный колпак', spans: [], whenDe: 'an Geburtstagen', whenRu: 'в дни рождения', fresh: false },
];

export const OUTFIT_IDS: readonly OutfitId[] = OUTFITS.map((o) => o.id);
export const outfit = (id: OutfitId): Outfit => OUTFITS.find((o) => o.id === id) as Outfit;
export const isOutfitId = (v: unknown): v is OutfitId => typeof v === 'string' && (OUTFIT_IDS as readonly string[]).includes(v);

const BEFORE = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const doy = ([d, m]: DayMonth): number => (BEFORE[m - 1] ?? 0) + d;

/**
 * «Nach Jahreszeit»: what Pompon wears on this date (the device's clock, nothing else). A birthday occasion wins over
 * the date (the party hat, only on that occasion's page); summer (1.6 – 21.9) has nothing — an outfit is a treat,
 * not a uniform. 29.2 counts as 28.2 + 1 = 1.3 (spring: the daisy).
 */
export function seasonOutfit(date: DayMonth, birthday = false): OutfitId | null {
  if (birthday) return 'party';
  const day = doy(date);
  for (const o of OUTFITS) if (o.spans.some((s) => day >= doy(s.from) && day <= doy(s.to))) return o.id;
  return null;
}

/**
 * How an outfit is earned (the gallery shows both; Felix chose B 28.10):
 * A — «Находка = обновка»: the n-th found scene unlocks the n-th outfit; seasonal ones are worn by date only once unlocked.
 * B — «Сезон дарит, находки — навсегда»: the season's outfit for everyone; each find unlocks one outfit for the whole year.
 */
export type EarnMode = 'A' | 'B';

/** Outfits the person may CHOOSE by hand (both options: the first `found` of the year order). */
export function unlocked(foundCount: number): OutfitId[] {
  return OUTFIT_IDS.slice(0, Math.max(0, Math.min(OUTFIT_IDS.length, Math.floor(foundCount))));
}

/** What Pompon wears now, for a choice, a date, the earn option and the number of found scenes. */
export function wornNow(choice: WearChoice, date: DayMonth, mode: EarnMode, foundCount: number, birthday = false): OutfitId | null {
  if (choice === 'none' || isCostumeId(choice)) return null;
  const open = unlocked(foundCount);
  if (choice !== 'auto') return open.includes(choice) ? choice : null;
  const s = seasonOutfit(date, birthday);
  if (!s) return null;
  return mode === 'B' || open.includes(s) ? s : null;
}

/**
 * The same with the costumes (variant B): a chosen costume once it is the person's (`costumes`: the app says which),
 * otherwise exactly wornNow(). A costume that is not theirs (a broken record) = nothing, like a locked outfit.
 */
export function wearNow(choice: WearChoice, date: DayMonth, foundCount: number, costumes: readonly CostumeId[], birthday = false): WearId | null {
  if (isCostumeId(choice)) return costumes.includes(choice) ? choice : null;
  return wornNow(choice, date, 'B', foundCount, birthday);
}

/** [day, month] of a Date in the device's own time zone. */
export function dayMonth(d: Date): DayMonth {
  return [d.getDate(), d.getMonth() + 1];
}
