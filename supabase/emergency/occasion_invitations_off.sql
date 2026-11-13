-- =============================================================================
-- Bunprise — EMERGENCY TEMPLATE ("red button" for in-app invitations, docs/spec/in-app-invites-design.md §8 item 6).
-- NOT a migration (it would be applied by the next `supabase db push` by itself if it lived in migrations/).
--
-- What it does, in ONE transaction:
--   * private.features.occasion_invitations = false: nobody gets candidates, nobody can send, withdraw or answer,
--     every inbox is empty, the dot on Start goes away (every RPC of 20261027120000 checks private.invitations_on());
--   * every pending invitation becomes 'void' — switching the button on again later resurrects nothing.
-- Order matters: the switch first. Every send holds the switch's row FOR SHARE, so this UPDATE waits for the sends that
-- are running and the void below then catches what they inserted; a send that starts later sees the switch off.
-- Memberships that were created by accepted invitations stay (they are ordinary memberships). Links (/i) are not
-- touched. The VITE_INVITES flag only hides the interface; this closes the paths in the database.
--
-- How to use it (only with Felix's OK, like every change of the hosted database):
--   1. copy this file to supabase/migrations/<YYYYMMDDHHMMSS>_occasion_invitations_off.sql (a timestamp later than
--      every existing migration);
--   2. `npx supabase db push`;
--   3. check: `select occasion_invitations from private.features` = false and
--      `select count(*) from public.occasion_invitations where outcome = 'pending'` = 0.
-- Switching back on (again as a new migration, after the problem is fixed):
--      update private.features set occasion_invitations = true;
-- =============================================================================

update private.features set occasion_invitations = false;

update public.occasion_invitations set outcome = 'void', decided_at = now() where outcome = 'pending';
