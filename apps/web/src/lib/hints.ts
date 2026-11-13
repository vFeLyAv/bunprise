import { onAccountEnded } from './accountBoundary';
import type { FeedOccasion, FeedScreen, Me } from './api/types';
import type { ListsOverview } from './api/lists.types';
import { ACTIVE_STORAGE_PREFIX } from './app';

/** Fixed coachmark names only: no account, person, wish or occasion IDs in storage. 'story-1': the comic card on Start
 * (features/comic, closed with × or opened — episode 1; a later episode gets its own fixed name). */
export type HintId = 'first-steps' | 'first-occasion' | 'reserve-hint' | 'story-1';
const key = `${ACTIVE_STORAGE_PREFIX}hintsSeen`;
const known = new Set<HintId>(['first-steps', 'first-occasion', 'reserve-hint', 'story-1']);
function read(): HintId[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is HintId => typeof id === 'string' && known.has(id as HintId)) : [];
  } catch { return []; }
}
export function hasSeenHint(id: HintId): boolean { return read().includes(id); }
export function markHintSeen(id: HintId): void {
  try { localStorage.setItem(key, JSON.stringify([...new Set([...read(), id])])); }
  catch { /* The optional hint may appear again when storage is unavailable. */ }
}

// Which optional hints were shown in this page session, and which are on screen right now — memory only, never stored
// (a reload, sign-out or account change starts fresh). The list above remembers only what was CLOSED; this is the other
// half of the rule "at most one optional hint per session" (docs/design/2026-10-26-manga-episode-1.md, decided with
// Codex 26.10): the comic card on Start (features/comic) shows only when no other hint was shown in this session —
// «Erste Schritte», the reservation hint, the first-occasion line and the birthday suggestion all come first — and it
// steps aside when one of them comes onto the screen after it.
const shownThisSession = new Set<string>();
const onScreen = new Map<string, number>();
const hintListeners = new Set<() => void>();
const emitHints = (): void => { for (const listener of hintListeners) listener(); };
/** A hint is on screen (call it from an effect); returns its "gone again" (the effect's cleanup). */
export function showHint(id: string): () => void {
  shownThisSession.add(id);
  onScreen.set(id, (onScreen.get(id) ?? 0) + 1);
  emitHints();
  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    const left = (onScreen.get(id) ?? 1) - 1;
    if (left > 0) onScreen.set(id, left);
    else onScreen.delete(id);
    emitHints();
  };
}
/** Was any hint other than `id` shown in this session? */
export function otherHintShown(id: string): boolean { return [...shownThisSession].some((other) => other !== id); }
/** Is a hint other than `id` on screen right now? */
export function otherHintOnScreen(id: string): boolean { return [...onScreen.keys()].some((other) => other !== id); }
export function subscribeHints(listener: () => void): () => void {
  hintListeners.add(listener);
  return () => { hintListeners.delete(listener); };
}
/** The account ended in this tab (lib/accountBoundary.ts); also tests. */
export function resetHintSession(): void { shownThisSession.clear(); onScreen.clear(); emitHints(); }
onAccountEnded(resetHintSession);

// When «Erste Schritte» shows on Start (features/feed/FirstSteps.tsx) — pure, so the comic card (features/comic: never
// together with it) and the month view ask the very same question. Moved here from FirstSteps on 31.10, unchanged.
/** «Erste Schritte» stays for this long after onboarding. */
export const FIRST_STEPS_DAYS = 14;
export interface FirstStepsInput {
  userId: string;
  me: Me | undefined;
  lists: ListsOverview | undefined;
  data: FeedScreen;
  /** when the screen opened (ms) */
  now: number;
  /** "×" was pressed on this device ('first-steps' above) */
  dismissed: boolean;
  /** the lists feature is on (features/lists/flag.ts) */
  listsOn: boolean;
}
export interface FirstStepsState {
  visible: boolean;
  /** my own occasions (host) */
  mine: FeedOccasion[];
  needsOccasion: boolean;
  needsWish: boolean;
  needsLink: boolean;
}
export function firstSteps({ userId, me, lists, data, now, dismissed, listsOn }: FirstStepsInput): FirstStepsState {
  const age = now - Date.parse(me?.profile.onboarding_done_at ?? '');
  const mine = [...data.upcoming, ...data.past].filter((occasion) => occasion.role === 'host');
  const ownLists = lists?.me.id === userId ? lists : undefined;
  const needsOccasion = mine.length === 0;
  const needsWish = !mine.some((occasion) => occasion.wish_count > 0) && !(ownLists?.stats.my_wishes);
  const needsLink = listsOn && !(ownLists?.me.live_links);
  const visible = !dismissed && me?.profile.id === userId && age >= 0 && age < FIRST_STEPS_DAYS * 86400000
    && (needsOccasion || (needsWish && (listsOn || mine.length > 0)) || needsLink);
  return { visible, mine, needsOccasion, needsWish, needsLink };
}
