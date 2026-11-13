/**
 * DEV ONLY — switch the visual direction live on the real screens (docs/design/directions.md).
 *
 * Since 2026-10-20 the decided look is the DEFAULT (src/styles/tokens.css: A's colours, B's shapes and
 * visible glass — ADR docs/decisions/2026-10-20-design-direction-glass.md); "основной" shows it as
 * production does. A / B / C are token overrides ON TOP of it on <html data-direction="paper|glass|pastel">
 * (src/dev/directions/*.css) — the comparison, and the shape a later theme ("Pastel") takes.
 * The choice lives in localStorage 'bunprise.devDirection' and is applied before the first render
 * (this module is evaluated while main.tsx awaits the dev frame).
 *
 * - Phone frame: the "Стиль" group in the toolbar (<DirectionToolbarGroup />).
 * - Without the frame (?frame=0, narrow window): Ctrl+Alt+D cycles, Ctrl+Alt+0…3 picks
 *   (physical keys, so the Russian layout works too); `?direction=paper|glass|pastel|current` sets it
 *   from the URL (handy on a phone; `current` = основной). A small pill bottom-left shows the choice; it
 *   renders only when a direction is active or was asked for, so e2e runs and other screenshots stay
 *   untouched.
 * - One preview that CSS from outside cannot do (docs/design/directions.md, "Блокеры"), only while a
 *   direction is active: 9 — <meta name="theme-color"> follows the direction's --theme-color (browser bar
 *   on a phone) and gets its original value back in "основной". (17 — the mascot's floor shadow and
 *   contour — is real since 2026-10-20: packages/mascot reads the two mascot tokens of tokens.css §6.)
 *
 * Never part of the production bundle: only src/dev/PhoneFrame.tsx imports this file.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { cn } from '../ui/cn';
import './direction-switcher.css';
import './directions/paper.css';
import './directions/glass.css';
import './directions/pastel.css';
import './directions/shims.css';

export const DIRECTIONS = [
  { id: 'paper', letter: 'A', label: 'Бумага', name: 'Warme Papeterie' },
  { id: 'glass', letter: 'B', label: 'Стекло', name: 'Glas & Tiefe' },
  { id: 'pastel', letter: 'C', label: 'Пастель', name: 'Pastell & Verspielt' },
] as const;

export type DirectionId = (typeof DIRECTIONS)[number]['id'];
/** 'current' = the default look (основной); the id stays 'current' so stored choices and links keep working. */
export type DirectionChoice = DirectionId | 'current';

export const DIRECTION_STORAGE_KEY = 'bunprise.devDirection';
const ORDER: readonly DirectionChoice[] = ['current', 'paper', 'glass', 'pastel'];
const CURRENT_LABEL = 'основной';

function isChoice(value: unknown): value is DirectionChoice {
  return typeof value === 'string' && (ORDER as readonly string[]).includes(value);
}

function readStored(): DirectionChoice {
  try {
    const value = localStorage.getItem(DIRECTION_STORAGE_KEY);
    return isChoice(value) ? value : 'current';
  } catch {
    return 'current';
  }
}

function writeStored(choice: DirectionChoice): void {
  try {
    if (choice === 'current') localStorage.removeItem(DIRECTION_STORAGE_KEY);
    else localStorage.setItem(DIRECTION_STORAGE_KEY, choice);
  } catch {
    /* private mode etc.: the choice still applies to this page */
  }
}

function applyToDocument(choice: DirectionChoice): void {
  const root = document.documentElement;
  if (choice === 'current') root.removeAttribute('data-direction');
  else root.setAttribute('data-direction', choice);
  syncThemeColor(choice);
}

// --- blocker 9 preview: the browser bar colour follows the direction ----------------------------------

let originalThemeColor: string | null = null;

function syncThemeColor(next: DirectionChoice): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  originalThemeColor ??= meta.content;
  const own = next === 'current' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim();
  meta.content = own || originalThemeColor;
}

/** `?direction=…` in the address bar wins over the stored choice (and is stored). */
function readUrl(): DirectionChoice | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('direction');
  return isChoice(value) ? value : null;
}

// --- a tiny store: the toolbar group and the frameless pill share it --------------------------------

let choice: DirectionChoice = 'current';
let pillRequested = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDirection(): DirectionChoice {
  return choice;
}

export function setDirection(next: DirectionChoice): void {
  choice = next;
  writeStored(next);
  applyToDocument(next);
  emit();
}

function cycleDirection(): void {
  const i = ORDER.indexOf(choice);
  setDirection(ORDER[(i + 1) % ORDER.length] ?? 'current');
}

// Apply before the first render: no flash of the old look on reload.
if (typeof document !== 'undefined') {
  const fromUrl = readUrl();
  choice = fromUrl ?? readStored();
  if (fromUrl) {
    writeStored(fromUrl);
    pillRequested = true;
  }
  applyToDocument(choice);
}

export function useDirection(): DirectionChoice {
  return useSyncExternalStore(subscribe, getDirection, () => 'current' as const);
}

function usePillRequested(): boolean {
  return useSyncExternalStore(subscribe, () => pillRequested, () => false);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Ctrl+Alt+D cycles основной → A → B → C; Ctrl+Alt+0…3 picks one. `event.code` = physical key, so it
 * works with any keyboard layout. Ignored while typing in a field. Mount once (PhoneFrame does).
 */
export function useDirectionHotkeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || isTyping(event.target)) return;
      const digit = /^Digit([0-3])$/.exec(event.code)?.[1];
      if (event.code !== 'KeyD' && digit === undefined) return;
      event.preventDefault();
      if (digit === undefined) cycleDirection();
      else setDirection(ORDER[Number(digit)] ?? 'current');
      pillRequested = true;
      emit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Phone-frame toolbar: «Стиль [основной] [A Бумага] [B Стекло] [C Пастель]». */
export function DirectionToolbarGroup() {
  const active = useDirection();
  return (
    <span className="pf-dir" role="group" aria-labelledby="pf-dir-label">
      <span id="pf-dir-label" className="pf-dir-label">
        Стиль
      </span>
      <span className="pf-group">
        <button
          type="button"
          className={cn('pf-btn', active === 'current' && 'is-active')}
          aria-pressed={active === 'current'}
          title="основной вид: цвета A + формы и стекло B, как в production (Ctrl+Alt+0)"
          onClick={() => setDirection('current')}
        >
          {CURRENT_LABEL}
        </button>
        {DIRECTIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={cn('pf-btn', active === d.id && 'is-active')}
            aria-pressed={active === d.id}
            title={`${d.letter} · ${d.name} — поверх основного (Ctrl+Alt+${ORDER.indexOf(d.id)})`}
            onClick={() => setDirection(d.id)}
          >
            {d.letter} {d.label}
          </button>
        ))}
      </span>
    </span>
  );
}

/**
 * Without the frame: a small pill bottom-left. Collapsed it is one 32 px button with the active letter
 * (it stays clear of the bars, the FAB and the footer links); tap expands it. Rendered only when a
 * direction is active or the hotkey / `?direction=` asked for it.
 */
export function DirectionPill() {
  const active = useDirection();
  const requested = usePillRequested();
  const [open, setOpen] = useState(false);
  if (active === 'current' && !requested) return null;
  const letter = DIRECTIONS.find((d) => d.id === active)?.letter ?? '·';
  return (
    <div className="pf-dir-pill" role="toolbar" aria-label="Стиль (dev)">
      {open ? (
        <>
          <button
            type="button"
            className={cn('pf-dir-btn', active === 'current' && 'is-active')}
            aria-pressed={active === 'current'}
            title={CURRENT_LABEL}
            onClick={() => setDirection('current')}
          >
            0
          </button>
          {DIRECTIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={cn('pf-dir-btn', active === d.id && 'is-active')}
              aria-pressed={active === d.id}
              title={d.name}
              onClick={() => setDirection(d.id)}
            >
              {d.letter}
            </button>
          ))}
          <button type="button" className="pf-dir-btn" aria-label="Свернуть" title="Свернуть" onClick={() => setOpen(false)}>
            ×
          </button>
        </>
      ) : (
        <button type="button" className="pf-dir-btn is-active" aria-label={`Стиль: ${letter}`} title="Стиль (Ctrl+Alt+D)" onClick={() => setOpen(true)}>
          {letter}
        </button>
      )}
    </div>
  );
}
