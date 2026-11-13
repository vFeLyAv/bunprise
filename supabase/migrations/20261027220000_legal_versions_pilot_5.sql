-- Bunprise pilot-5: new versions of the privacy notice and the terms for the 5th release
-- (docs/legal-drafts/pilot-5/README.md). The published texts are BUILT from the drafts for one feature set
-- (docs/legal-drafts/pilot-5/build.mjs --on …; default: map, friendcodes, calendarfeed, sharedwishes, backups — push off).
-- True for every feature set: the lazy reservation cleanup of 20261027200000_shared_wishes.sql (account deletion, blocks
-- and lost access end reservations through the every-minute job), "Zum Kalender hinzufügen" and the birthday
-- suggestion (20261027170000_calendar_feed.sql), the extended export (20261027210000_export_new_fields.sql), the code in
-- the link's "#" part, Ideas taste directions / topics, the app icon, the Ukrainian interface.
-- Push together with (after) those migrations. has_consents() becomes false for everyone until they accept again;
-- reading, export and deletion keep working. apps/web/src/lib/legal.ts (LEGAL_VERSIONS) must mirror these ids.
-- age_18plus stays unchanged. If the terms are NOT rebuilt (build.mjs --no-terms), delete the 'terms' row here.
insert into public.legal_versions (kind, version) values
  ('terms',          'terms-2026-10-pilot-5'),
  ('privacy_notice', 'privacy-2026-10-pilot-5')
on conflict (kind) do update set version = excluded.version, published_at = now();
