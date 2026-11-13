-- =============================================================================
-- Bunprise — EMERGENCY TEMPLATE "Zusatzorte verstecken" (design §7; only for a visibility LEAK). NOT a migration.
--
-- What it does: from the next read on, guests and followers see every wish ONLY in its home list (the extra places
-- are not "effective"). The owner still sees her shared wishes, muted, with "Vorübergehend ausgeblendet" (paused).
-- No data changes. A reservation that was held only through an extra place is dead from the next read on (the giver
-- sees "Nicht mehr verfügbar"); the cleanup job ends it within minutes. If the places are shown again BEFORE the
-- cleanup reached that row, it is live again; once ended it never comes back (design Q22, corrected by Codex v1.4 #7).
--
-- How (only with Felix's OK):
--   1. copy to supabase/migrations/<YYYYMMDDHHMMSS>_shared_wishes_hide.sql (later than every migration);
--   2. `npx supabase db push` (one transaction);
--   3. check: `select shared_wishes_visible from private.features` = false.
-- Show again (after the fix): a new migration with
--   lock table public.profiles in exclusive mode; update private.features set shared_wishes_visible = true;
-- Order: LOCK TABLE profiles first — every reservation holds its pair of profile rows until it commits, so no
-- reservation through an extra place commits after the switch.
-- =============================================================================

-- One statement (a DO block): `supabase db push` runs a file's statements one by one outside a transaction, and a
-- top-level LOCK TABLE then fails with 25P01 (27.10, the first push of shared_wishes_on). Inside the block the locks
-- hold until the switch is written and committed.
do $$
begin
  lock table public.profiles in exclusive mode;
  update private.features set shared_wishes_visible = false;
end $$;
