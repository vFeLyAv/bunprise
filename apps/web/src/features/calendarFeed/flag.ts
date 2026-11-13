// The release flag of the Kalender-Abo (docs/handoffs/2026-10-27-calendar.md): on in the demo (`VITE_DEMO=1`, the
// address is simulated) and when `VITE_CALENDAR_FEED=1`; otherwise the Profil row is not shown and the app never calls
// the feed RPCs. The flag hides the interface only — the Worker answers 501 until CALENDAR_FEED = "on" (wrangler.jsonc),
// which goes on together with supabase/migrations/20261027170000_calendar_feed.sql and the pilot-5 privacy text.

export function calendarFeedEnabled(env: { VITE_DEMO?: unknown; VITE_CALENDAR_FEED?: unknown } = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_CALENDAR_FEED === '1'
}
