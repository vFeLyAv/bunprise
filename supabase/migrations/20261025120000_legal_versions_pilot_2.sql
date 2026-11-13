-- Bunprise pilot-2: new versions of the privacy notice and the terms (docs/legal-drafts/pilot-2/README.md).
-- has_consents() becomes false for everyone until they accept again; reading, export and deletion keep working.
-- apps/web/src/lib/legal.ts (LEGAL_VERSIONS) must mirror these ids. age_18plus stays unchanged.
insert into public.legal_versions (kind, version) values
  ('terms',          'terms-2026-10-pilot-2'),
  ('privacy_notice', 'privacy-2026-10-pilot-2')
on conflict (kind) do update set version = excluded.version, published_at = now();
