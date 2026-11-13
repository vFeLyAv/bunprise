-- Bunprise pilot-6: a new version of the privacy notice for the 6th release (docs/legal-drafts/pilot-6/README.md).
-- The published text is BUILT from the drafts for one feature set (docs/legal-drafts/pilot-6/build.mjs --on …; this
-- release: map, push, friendcodes, backups, calendarfeed, sharedwishes — inviteemail OFF, Felix 31.10: no Brevo key yet).
-- True for every feature set: "Anzahl" (wishes.quantity) and "Passt zusammen" (private.wish_links, "Beides
-- reservieren") of 20261030120000_wish_quantity_together.sql, switched on by the NEXT migration
-- (20261031130000_wish_extras_on.sql); "Zum Kalender hinzufügen" only through Google Kalender (no .ics file any more),
-- the colour scheme "Schwarz", the friend code created when "Mein Code & Link" opens.
-- Push together with (after) 20261030120000. has_consents() becomes false for everyone until they accept again;
-- reading, export and deletion keep working. apps/web/src/lib/legal.ts (LEGAL_VERSIONS) must mirror this id.
-- The terms stay terms-2026-10-pilot-5 and age_18plus stays unchanged: only the 'privacy_notice' row changes.
insert into public.legal_versions (kind, version) values
  ('privacy_notice', 'privacy-2026-10-pilot-6')
on conflict (kind) do update set version = excluded.version, published_at = now();
