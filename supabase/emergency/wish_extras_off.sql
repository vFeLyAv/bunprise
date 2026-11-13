-- =============================================================================
-- Bunprise — EMERGENCY TEMPLATE: switch "Anzahl" and "Passt zusammen" OFF. NOT a migration.
--
-- Effect from the commit on: a NEW quantity other than 1 is refused (stored quantities stay and are still shown);
-- set_wish_links and reserve_together answer not_allowed, the screens carry `together: null` (the stored links stay,
-- switching on again shows them). Reservations are not touched — each wish stays reservable alone.
--
-- How (only with Felix's OK): run it in the Supabase SQL editor, or copy it to
-- supabase/migrations/<YYYYMMDDHHMMSS>_wish_extras_off.sql and `npx supabase db push`.
-- Check: `select wish_quantity, wish_together from private.features` = (false, false).
-- =============================================================================

update private.features set wish_quantity = false, wish_together = false;
