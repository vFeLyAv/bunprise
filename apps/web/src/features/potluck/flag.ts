// The release flag of the bring-along list "Mitbringen" (docs/design/2026-10-25-bring-list.md, decision 4: only
// together with the pilot-3 legal texts). On in the demo (`VITE_DEMO=1`) and when `VITE_POTLUCK=1`; otherwise the
// occasion form offers no choice, nothing sends `sections` and the occasion page shows the wish list as before.
// scripts/release-web.ps1 pins it to '0'. The flag hides the interface only — the database decides access.

export function potluckEnabled(env: { VITE_DEMO?: unknown; VITE_POTLUCK?: unknown } = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_POTLUCK === '1'
}
