-- =============================================================================
-- Bunprise — EMERGENCY TEMPLATE ("red button", follows-design §9, review #10, A14). NOT a migration.
--
-- What it does: closes EVERY follower path in the database within minutes, without rolling code back —
--   * followers no longer read lists "Meine Follower" (REST policies and every RPC go through
--     private.can_read_wishlist / private.can_read_wish, which check private.follower_lists_on()) and cannot reserve
--     on them (reserve_wish checks the reader rule under the pair lock);
--   * since 20261027200000 (shared wishes, lazy liveness) the reservations are NOT touched here: a reservation that
--     was held only through a follower list is dead from the next read on (no answer shows or counts it; the giver
--     sees "Nicht mehr verfügbar") and the cleanup job (private.reservations_cleanup_run, every minute) ends it.
--     A wish that is ALSO in one of the owner's occasions stays reserved for a giver who reads it there.
-- Owners notice nothing (their branches do not change). Occasion lists, follows, requests and links stay as they are.
--
-- Why it lives OUTSIDE supabase/migrations/: there it would be applied by the next `supabase db push` by itself.
-- How to use it (only with Felix's OK, like every change of the hosted database):
--   1. copy this file to supabase/migrations/<YYYYMMDDHHMMSS>_follower_lists_off.sql (a timestamp later than every
--      existing migration);
--   2. `npx supabase db push` — it runs as ONE transaction, like every migration file (with psql: `psql -1 -f …`);
--      LOCK TABLE only works inside a transaction;
--   3. check: `select follower_lists from private.features` = false; a few minutes later
--      `select private.shared_wishes_health()` -> dead_active = 0 (the cleanup ended the dead rows).
-- Switching back on later (again as a new migration, after the leak is fixed):
--      update private.features set follower_lists = true;
--   Reservations the cleanup already ended never come back; ones it had not reached yet are live again (Q22 note in
--   docs/spec/shared-wishes-design.md).
--
-- Order matters:
--   1. LOCK TABLE profiles IN EXCLUSIVE MODE waits for every profile-pair writer — every running reservation holds
--      its pair of profile rows until it commits — and keeps new ones out until this transaction commits; those then
--      see the switch off and answer not_allowed.
--   2. LOCK TABLE follows IN EXCLUSIVE MODE: no follow changes meanwhile (kept from the pre-20261027200000 order).
--   3. the switch.
-- Tested as a step of the random walk (packages/db-tests/test/lists/random-walk.test.ts, F19) and on its own
-- (packages/db-tests/test/lists/kill-switch.test.ts), which run exactly this file.
-- =============================================================================

-- One statement (a DO block): `supabase db push` runs a file's statements one by one outside a transaction, and a
-- top-level LOCK TABLE then fails with 25P01 (27.10, the first push of shared_wishes_on). Inside the block the locks
-- hold until the switch is written and committed.
do $$
begin
  lock table public.profiles in exclusive mode;
  lock table public.follows in exclusive mode;
  
  update private.features set follower_lists = false;
end $$;
