// The release flag of Web Push (docs/spec/web-push-design.md §10). On in the demo (`VITE_DEMO=1`, no real pushes: the
// switches are simulated) and when `VITE_PUSH=1`; otherwise nothing of the feature renders and the app never calls its
// RPCs or /api/push/*. The flag hides the interface only — the database decides (private.features.web_push, switched by
// private.set_web_push; red button supabase/emergency/web_push_off.sql), and the Worker answers 501 without its secrets.

export function pushEnabled(env: { VITE_DEMO?: unknown; VITE_PUSH?: unknown } = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_PUSH === '1'
}
