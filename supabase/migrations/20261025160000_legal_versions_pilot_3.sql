-- Bunprise pilot-3: new versions of the privacy notice and the terms (docs/legal-drafts/pilot-3/README.md):
-- the bring-along list "Mitbringen" (20261025150000_potluck.sql), the own photo for a wish, the product photos
-- of the Ideas catalogue and the colour scheme on the device. Push together with 20261025150000_potluck.sql.
-- has_consents() becomes false for everyone until they accept again; reading, export and deletion keep working.
-- apps/web/src/lib/legal.ts (LEGAL_VERSIONS) must mirror these ids. age_18plus stays unchanged.
insert into public.legal_versions (kind, version) values
  ('terms',          'terms-2026-10-pilot-3'),
  ('privacy_notice', 'privacy-2026-10-pilot-3')
on conflict (kind) do update set version = excluded.version, published_at = now();
