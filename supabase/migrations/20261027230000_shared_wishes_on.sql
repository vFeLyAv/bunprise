-- =============================================================================
-- Bunprise (Felix 27.10: «так все включаем»): switch "one wish in several lists" ON in the database, together with
-- the 5th release (app built with VITE_SHARED_WISHES = '1', scripts/release-web.ps1) and the pilot-5 privacy text that
-- describes several lists per wish (20261027220000_legal_versions_pilot_5.sql). Copied from
-- supabase/emergency/shared_wishes_on.sql. Forward only, NOT applied by agents: Felix runs `npx supabase db push`.
-- Check: `select shared_wishes, shared_wishes_visible from private.features` = (true, true).
-- Off again: supabase/emergency/shared_wishes_off.sql (no NEW extra places; existing ones stay) as a new migration.
-- =============================================================================

-- One statement (a DO block): `supabase db push` runs a file's statements one by one outside a transaction, and a
-- top-level LOCK TABLE then fails with 25P01 (27.10, the first push of shared_wishes_on). Inside the block the locks
-- hold until the switch is written and committed.
do $$
begin
  lock table public.profiles in exclusive mode;
  update private.features set shared_wishes = true;
end $$;
