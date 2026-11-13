-- =============================================================================
-- Bunprise — RELEASE TEMPLATE: switch Web Push ON in the database (docs/spec/web-push-design.md §10).
-- NOT a migration (in migrations/ it would be applied by the next `supabase db push` by itself).
--
-- 20261027150000_web_push.sql creates push SWITCHED OFF (private.features.web_push = false): no device can subscribe,
-- no outbox row is written, nothing is sent, the dispatch job does not exist.
-- Use it ONLY with Felix's OK, after ALL of these (docs/handoffs/2026-10-27-web-push.md):
--   * the Worker secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_DISPATCH_SECRET are set and deployed
--     (GET https://bunprise.de/api/push/key answers 200);
--   * the same PUSH_DISPATCH_SECRET is in Supabase Vault under the name 'push_dispatch_secret';
--   * the published privacy notice describes push (pilot-5; pilot-4 §3.16 says "keine Push-Benachrichtigung").
-- Steps:
--   1. copy this file to supabase/migrations/<YYYYMMDDHHMMSS>_web_push_on.sql (a timestamp later than every migration);
--   2. `npx supabase db push`;
--   3. check: `select web_push from private.features` = true and
--      `select jobname, schedule from cron.job where jobname = 'bunprise_push_dispatch'` = one row ('20 seconds');
--   4. build the app with VITE_PUSH = '1'.
-- =============================================================================

select private.set_web_push(true);
