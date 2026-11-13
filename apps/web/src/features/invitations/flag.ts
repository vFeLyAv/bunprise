// The release flag of the in-app invitations "Freunde einladen" (docs/spec/in-app-invites-design.md, decision Р12:
// only together with legal texts that describe them — pilot-4, Felix 26.10). On in the demo (`VITE_DEMO=1`) and when
// `VITE_INVITES=1`; otherwise nothing of the feature renders and the app never calls its RPCs (a database without
// 20261027120000 stays fine). scripts/release-web.ps1 sets it to '1' since the 4th release. The flag hides the
// interface only — the database decides access (20261027130000 switches it on), and its
// own red button is private.features.occasion_invitations (supabase/emergency/occasion_invitations_off.sql).

export function invitesEnabled(env: { VITE_DEMO?: unknown; VITE_INVITES?: unknown } = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_INVITES === '1'
}
