-- =============================================================================
-- Bunprise — EMERGENCY TEMPLATE "keine neuen Orte" (design §7): stop adding wishes to more lists. NOT a migration.
--
-- What it does: add_wishes_to_list answers not_allowed from the commit on (the app falls back to moving). Existing
-- extra places, the wishes and every reservation stay exactly as they are; guests keep seeing the shared wishes.
-- For a LEAK of what guests see, use shared_wishes_hide.sql instead.
--
-- How (only with Felix's OK):
--   1. copy to supabase/migrations/<YYYYMMDDHHMMSS>_shared_wishes_off.sql (later than every migration);
--   2. `npx supabase db push` (one transaction; LOCK TABLE needs it);
--   3. check: `select shared_wishes from private.features` = false.
-- Order: LOCK TABLE profiles first — every add_wishes_to_list holds the owner's profile row and reads the switch
-- under it, so no add slips past the switch.
-- =============================================================================

-- One statement (a DO block): `supabase db push` runs a file's statements one by one outside a transaction, and a
-- top-level LOCK TABLE then fails with 25P01 (27.10, the first push of shared_wishes_on). Inside the block the locks
-- hold until the switch is written and committed.
do $$
begin
  lock table public.profiles in exclusive mode;
  update private.features set shared_wishes = false;
end $$;
