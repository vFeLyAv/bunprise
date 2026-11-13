// The release flag of the short friend codes — the tabs "QR-Code" and "Eingeben" of "Freunde hinzufügen", the row
// the QR-first "Mein Code & Link" in Profil (else "Mein Folgen-Link") and "Code eingeben" in the empty "Freunde" (docs/spec/add-friends-design.md §2): on in
// the demo (`VITE_DEMO=1`) and when `VITE_FRIEND_CODES=1` — set it only once 20261027160000_friend_codes.sql is in the
// database (before that the RPCs do not exist). The link tab and the fixed links work without it. It hides the
// interface only. The `.env*` files are not touched by agents: the name belongs into `.env.example` (Felix / main
// session).

export function friendCodesEnabled(env: { VITE_DEMO?: unknown; VITE_FRIEND_CODES?: unknown } = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_FRIEND_CODES === '1'
}
