-- =============================================================================
-- Bunprise (Felix's decision 31.10: both on in this release): switch "Anzahl" (quantity) and
-- "Passt zusammen" (linked wishes, "Beides reservieren") ON in the database, together with the 6th release (app built
-- with VITE_WISH_QUANTITY = '1' and VITE_WISH_TOGETHER = '1', scripts/release-web.ps1) and the pilot-6 privacy text
-- that describes both (20261031120000_legal_versions_pilot_6.sql, the migration right before this one).
-- Copied from supabase/emergency/wish_extras_on.sql. Forward only, NOT applied by agents: Felix runs
-- `npx supabase db push`.
-- Check: `select wish_quantity, wish_together from private.features` = (true, true).
-- Off again: supabase/emergency/wish_extras_off.sql (both) or wish_together_off.sql (only the links) as a new
-- migration or in the SQL editor — stored quantities and links stay, every wish stays reservable alone.
-- =============================================================================

update private.features set wish_quantity = true, wish_together = true;
