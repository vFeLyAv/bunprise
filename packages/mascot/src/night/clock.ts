/**
 * «Ночью маскоты спят» (Felix 31.10: «прикольно, но чтобы можно было будить»; approved for the app 31.10: «спящие
 * норм, оставляем») — the time rules, as pure functions. Package entry `@bunprise/mascot/night-clock`: a tiny file
 * without any puppet, so an app screen can ask "is it night?" without loading the night moments
 * (tests: test/night.test.ts). Moved here from the gallery prototype (demo/night/clock.ts re-exports it).
 *
 *   - night = 23:00 – 07:00 local time of the device (fixed hours: predictable; the dark theme is NOT a signal —
 *     many people use it all day);
 *   - a tap wakes the mascot; he then stays awake AWAKE_MS (10 min) after the LAST touch, then dozes off again;
 *   - the person scrolls / types elsewhere → at most one sleepy peek every PEEK_GAP_MS (he never steals attention).
 */

/** Minutes after midnight: [from, to). `from > to` wraps over midnight; `from === to` = never night. */
export interface NightWindow {
  from: number;
  to: number;
}

export const NIGHT: NightWindow = { from: 23 * 60, to: 7 * 60 };
/** He stays awake this long after the last touch, then dozes off again (Felix: 10 min). */
export const AWAKE_MS = 10 * 60_000;
/** At most one sleepy peek (the person scrolls elsewhere) in this time. */
export const PEEK_GAP_MS = 20_000;

const DAY = 24 * 60;

/** Minutes after local midnight (0 … 1439.99). */
export function minuteOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60_000;
}

function wrap(min: number): number {
  return ((min % DAY) + DAY) % DAY;
}

/** Is `min` (minutes after midnight) inside the night window? 23:00 is night, 07:00 is already day. */
export function isNight(min: number, w: NightWindow = NIGHT): boolean {
  const m = wrap(min);
  if (w.from === w.to) return false;
  return w.from < w.to ? m >= w.from && m < w.to : m >= w.from || m < w.to;
}

/** Minutes until the night state changes next (> 0). Never: Infinity. */
export function minutesToChange(min: number, w: NightWindow = NIGHT): number {
  if (w.from === w.to) return Infinity;
  const m = wrap(min);
  const target = isNight(m, w) ? w.to : w.from;
  const d = wrap(target - m);
  return d === 0 ? DAY : d;
}

/** What the mascot should be doing now. */
export interface SleepRule {
  /** the clock (ms since epoch; the gallery runs a simulated one) */
  now: number;
  /** Settings switch «Nachts schlafen» (default on) */
  enabled: boolean;
  /** woken by a tap: awake until this moment (ms) */
  awakeUntil: number;
  window?: NightWindow;
}

export function wantsSleep(r: SleepRule): boolean {
  return r.enabled && isNight(minuteOfDay(r.now), r.window) && r.now >= r.awakeUntil;
}

/** "23:00" for minutes after midnight (wraps; seconds are dropped). */
export function fmtTime(min: number): string {
  const m = Math.floor(wrap(min));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "23:00" / "7:05" → minutes after midnight; anything else → null. */
export function parseTime(s: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s?.trim() ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

/** The epoch ms of `min` (minutes after midnight) on the day of `base` — for a simulated clock (gallery, dev override). */
export function atMinute(base: number, min: number): number {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + wrap(min) * 60_000;
}
