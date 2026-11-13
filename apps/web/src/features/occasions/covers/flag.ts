// The release flag of the cover motif CHOICE (docs/handoffs/2026-10-27-occasion-covers.md): on in the demo
// (`VITE_DEMO=1`) and when `VITE_COVERS=1`; otherwise the occasion form offers no motif and nothing sends
// `cover_theme` — a database without 20261027140000_occasion_cover_theme.sql would refuse the unknown column.
// Showing a STORED motif needs no flag: a server without the migration simply sends no `cover_theme`.
// Switch it on in scripts/release-web.ps1 only after Felix pushed the migration.

export function coversEnabled(env: { VITE_DEMO?: unknown; VITE_COVERS?: unknown } = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_COVERS === '1'
}
