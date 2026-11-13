-- =============================================================================
-- Bunprise — RELEASE TEMPLATE: switch "Anzahl" (quantity) and "Passt zusammen" (linked wishes) ON in the database.
-- NOT a migration (in migrations/ the next `supabase db push` would apply it).
--
-- 20261030120000_wish_quantity_together.sql creates both features with private.features.wish_quantity = false and
-- wish_together = false: a quantity other than 1 is refused, set_wish_links / reserve_together answer not_allowed and
-- the screens carry no `together`.
--
-- How (only with Felix's OK, together with the release that has VITE_WISH_QUANTITY = '1' / VITE_WISH_TOGETHER = '1'
-- and the pilot-6 privacy text that mentions the quantity and the links — docs/handoffs/2026-10-30-quantity-together.md):
--   1. copy this file to supabase/migrations/<YYYYMMDDHHMMSS>_wish_extras_on.sql (later than every migration);
--   2. `npx supabase db push`;
--   3. check: `select wish_quantity, wish_together from private.features` = (true, true).
-- Off again: supabase/emergency/wish_extras_off.sql (both) or wish_together_off.sql (only the links).
-- =============================================================================

update private.features set wish_quantity = true, wish_together = true;
