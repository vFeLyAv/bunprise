// The release flag of the lists tab and of lists without an occasion (follows-design §00 p. 9): on in the demo
// (`VITE_DEMO=1`) and when `VITE_LISTS=1`; otherwise /lists shows a calm "Bald verfügbar" with the bunny and
// asks the server nothing. The flag hides the interface only — it is no access switch (the database's "red
// button" is, §3.4/§9). The `.env*` files are not touched by agents: the name belongs into `.env.example`.

export function listsEnabled(env: { VITE_DEMO?: unknown; VITE_LISTS?: unknown } = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_LISTS === '1'
}
