-- =============================================================================
-- Bunprise — RELEASE TEMPLATE: switch "one wish in several lists" ON in the database (design Q17: only after the app
-- that shows shared wishes is released). NOT a migration (in migrations/ the next `supabase db push` would apply it).
--
-- 20261027200000_shared_wishes.sql creates the feature with private.features.shared_wishes = false: add_wishes_to_list
-- answers not_allowed and the app keeps MOVING wishes ("Aus meinen Listen holen") exactly as before. Everything else
-- of that migration (lazy liveness, the cleanup job, the read rule of wishes) is active from the push on.
--
-- How (only with Felix's OK, together with the release that has VITE_SHARED_WISHES = '1' and the pilot-5 privacy
-- text that describes several lists per wish — docs/legal-drafts/pilot-5-notes.md):
--   1. copy this file to supabase/migrations/<YYYYMMDDHHMMSS>_shared_wishes_on.sql (later than every migration);
--   2. `npx supabase db push`;
--   3. check: `select shared_wishes, shared_wishes_visible from private.features` = (true, true).
-- Off again: supabase/emergency/shared_wishes_off.sql (no NEW extra places; existing ones stay).
-- =============================================================================

-- One statement (a DO block): `supabase db push` runs a file's statements one by one outside a transaction, and a
-- top-level LOCK TABLE then fails with 25P01 (27.10, the first push of shared_wishes_on). Inside the block the locks
-- hold until the switch is written and committed.
do $$
begin
  lock table public.profiles in exclusive mode;
  update private.features set shared_wishes = true;
end $$;
