-- =============================================================================
-- Bunprise — EMERGENCY TEMPLATE: switch only "Passt zusammen" (linked wishes) OFF; the quantity stays. NOT a migration.
--
-- Effect from the commit on: set_wish_links and reserve_together answer not_allowed, the screens carry
-- `together: null`. The stored links stay; every wish stays reservable alone. Reservations are not touched.
--
-- How (only with Felix's OK): run it in the Supabase SQL editor, or copy it to
-- supabase/migrations/<YYYYMMDDHHMMSS>_wish_together_off.sql and `npx supabase db push`.
-- Check: `select wish_together from private.features` = false.
-- =============================================================================

update private.features set wish_together = false;
