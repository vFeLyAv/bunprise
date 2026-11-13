-- =============================================================================
-- Bunprise — switch the in-app invitations ("Freunde einladen") ON in the database, with the 4th release.
-- Felix 26.10: «так включи приглашения и исправь Datenschutz и AGB». Built from the release template
-- supabase/emergency/occasion_invitations_on.sql.
--
-- 20261027120000_occasion_invitations.sql ships the feature switched OFF (private.features.occasion_invitations
-- defaults to false). This migration is the one explicit step that turns it on — together with
--   * the pilot-4 legal texts with the invitation paragraphs (privacy notice AND terms,
--     20261026200000_legal_versions_pilot_4.sql: everybody accepts them once before using the app again), and
--   * the client flag VITE_INVITES = '1' (scripts/release-web.ps1).
-- Pushed by Felix with `npx supabase db push` (agents never apply migrations to the hosted project).
-- Check afterwards: `select occasion_invitations from private.features` = true, and the daily pg_cron job
-- bunprise_purge_invitations (Integrations → Cron).
-- Off again (emergency): supabase/emergency/occasion_invitations_off.sql as a NEW migration with a later timestamp.
-- =============================================================================

update private.features set occasion_invitations = true;
