-- =============================================================================
-- Bunprise pilot — 4/5: current versions of the legal texts (pilot-decisions §1)
-- A new text version = a new migration with a new row → has_consents() becomes false for everyone
-- until they accept again (reading still works, creating/reserving does not).
-- apps/web/src/lib/legal.ts (LEGAL_VERSIONS) must mirror these ids.
-- =============================================================================
insert into public.legal_versions (kind, version) values
  ('terms',      'terms-2026-10-pilot-1'),
  ('privacy',    'privacy-2026-10-pilot-1'),
  ('age_18plus', 'age-18plus-2026-10-pilot-1')
on conflict (kind) do update set version = excluded.version, published_at = now();
