/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /** '1' shows the Google sign-in button (provider configured in Supabase) */
  readonly VITE_GOOGLE_ENABLED?: string
  /** '1' enables the configured Apple OAuth provider */
  readonly VITE_APPLE_ENABLED?: string
  readonly VITE_APP_URL?: string
  /** '1' in `npm run dev:demo` (.env.demo): MSW mocks replace Supabase */
  readonly VITE_DEMO?: string
  /** '1' shows the in-app invitations "Freunde einladen" (features/invitations/flag.ts; with the pilot-4 texts only) */
  readonly VITE_INVITES?: string
  /** '1' offers the cover motif choice in the occasion form (features/occasions/covers/flag.ts; after 20261027140000 is pushed) */
  readonly VITE_COVERS?: string
  /** '1' shows Web Push (Profil › Benachrichtigungen, the hint under an invitation; features/push/flag.ts) — only after
   *  Felix set the Worker + Vault secrets, pushed 20261027150000 and switched it on with the pilot-5 texts */
  readonly VITE_PUSH?: string
  /** "1" = the Kalender-Abo row in Profil (features/calendarFeed/flag.ts) */
  readonly VITE_CALENDAR_FEED?: string
  /** '1' shows "Bei neuen Einladungen eine E-Mail schicken" in Profil › Privatsphäre (features/inviteEmail/flag.ts) — only after
   *  20261028000000_invite_email.sql is pushed, BREVO_API_KEY is set and the database switch is on with a privacy text
   *  built WITH inviteemail (pilot-6 went out without it, 31.10 — the next version, pilot-7) */
  readonly VITE_INVITE_EMAIL?: string
  /** '1' shows "Mein Code" (QR) and "Code eingeben" in "Freunde hinzufügen" (features/people/codeFlag.ts) — only after
   *  20261027160000_friend_codes.sql is pushed */
  readonly VITE_FRIEND_CODES?: string
  /** '1' shares a wish between lists ("Aus meinen Listen holen" adds instead of moving; lib/api/wishPlaces.ts) — only
   *  after 20261027200000_shared_wishes.sql is pushed; the database switch decides the rest (fallback: moving) */
  readonly VITE_SHARED_WISHES?: string
  /** '1' shows "Anzahl" (quantity 1..10) in the wish form and sheet (lib/api/wishExtras.ts) — only after
   *  20261030120000_wish_quantity_together.sql is pushed AND its database switch is on (20261031130000_wish_extras_on.sql,
   *  6th release with the pilot-6 privacy text) */
  readonly VITE_WISH_QUANTITY?: string
  /** '1' shows "Passt zusammen" (linked wishes, "Beides reservieren"; lib/api/wishExtras.ts) — same condition */
  readonly VITE_WISH_TOGETHER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** injected by vite.config.ts `define` from package.json */
declare const __APP_VERSION__: string
