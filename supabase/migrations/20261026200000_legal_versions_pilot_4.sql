-- Bunprise pilot-4: new versions of the privacy notice and the terms (docs/legal-drafts/pilot-4/README.md):
-- the in-app invitations "Freunde einladen" (20261027120000_occasion_invitations.sql, switched on by
-- 20261027130000_occasion_invitations_on.sql — Felix 26.10: «так включи приглашения и исправь Datenschutz и AGB»),
-- corrections of pilot-3 against the code, the 30-day deletion of unfinished accounts (20261026190000_small_fixes.sql)
-- and the optional end time of an occasion (20261026180000_occasion_end_time.sql). Push together with those four.
-- has_consents() becomes false for everyone until they accept again; reading, export and deletion keep working.
-- apps/web/src/lib/legal.ts (LEGAL_VERSIONS) must mirror these ids. age_18plus stays unchanged.
insert into public.legal_versions (kind, version) values
  ('terms',          'terms-2026-10-pilot-4'),
  ('privacy_notice', 'privacy-2026-10-pilot-4')
on conflict (kind) do update set version = excluded.version, published_at = now();
