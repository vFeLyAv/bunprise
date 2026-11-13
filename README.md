# Bunprise 🐰

Eine Web-App, in der Pläne und Wünsche zusammen leben: **gemeinsamer Kalender mit Freunden**, **Wunschlisten** zu jedem Anlass und **geheime Geschenk-Reservierung** – wer sich etwas wünscht, sieht nicht, wer was reserviert hat, die Freunde schon. Mit zwei Maskottchen: einem Hasen und einem Hamster.

Gebaut habe ich sie mit KI-Werkzeugen (Claude Code, Codex): Ich habe die Funktionen geplant, Entscheidungen getroffen, jeden Bildschirm getestet und Feedback in Runden umgesetzt.

**Stand:** Pilot. Alle Bildschirme laufen im **Demo-Modus** (ohne Server, mit erfundenen Freunden Anna, Ben und Clara).

## Funktionen
- Anmeldung per Code aus der E-Mail, Onboarding mit dem Hasen
- Anlässe („Mein Geburtstag 12.12.“) mit Datum, Ort, Mini-Karte und „Wer kommt?“
- Wunschlisten: Wünsche mit Preis, Link und Foto; geheime Reservierung
- Einladung per Link, Kalender (auch „Zu Google Kalender hinzufügen“)
- Deutsch, Englisch, Russisch, Ukrainisch; helles, dunkles und sehr dunkles Design
- Installierbar als App (PWA)

## Technik
- **Frontend:** React, TypeScript, Vite, TanStack Router + Query, Tailwind CSS, vite-plugin-pwa
- **Backend:** Supabase (PostgreSQL mit Row Level Security), Cloudflare Worker
- **Tests:** Vitest, Playwright; Gleichzeitigkeits-Tests auf echtem PostgreSQL (PGlite)
- **Demo-Modus:** Mock Service Worker (MSW) ersetzt den Server im Browser
- Maskottchen als eigenes Paket (`packages/mascot`)

## Ordner
| Ordner | Inhalt |
|---|---|
| `apps/web/` | die App |
| `packages/mascot/` | Hase und Hamster (Animationen, Kostüme) |
| `packages/db-tests/` | Datenbank-Tests |
| `supabase/` | Datenbank-Schema und Migrationen |
| `workers/edge/` | Cloudflare Worker |

## Demo lokal starten
Node 24:
```bash
npm install
npm run dev:demo     # http://localhost:5173
```

Hinweis: Kommentare im Code verweisen teils auf interne Notizen (`docs/…`), die nicht in diesem Repository liegen.

---

*English: Bunprise is a shared calendar + wish lists + secret gift reservations app (React, TypeScript, Supabase, Cloudflare). Pilot stage; run `npm run dev:demo` for a demo without a server.*
