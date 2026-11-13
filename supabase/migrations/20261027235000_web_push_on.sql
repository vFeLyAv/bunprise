-- =============================================================================
-- Bunprise (Felix 27.10: «так все включаем»): switch Web Push ON in the database, after the 5th release is live —
-- the Worker secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_DISPATCH_SECRET are set and deployed
-- (GET https://bunprise.de/api/push/key answered 200 on 27.10, Worker ca24ec3c), the same PUSH_DISPATCH_SECRET is in
-- Supabase Vault ('push_dispatch_secret'), the app is built with VITE_PUSH = '1' and the published pilot-5 privacy
-- notice describes push (§3.18). Copied from supabase/emergency/web_push_on.sql. Forward only, NOT applied by agents:
-- Felix runs `npx supabase db push`.
-- Check: `select web_push from private.features` = true and
--        `select jobname, schedule from cron.job where jobname like 'bunprise_push%'` = bunprise_push_dispatch + bunprise_purge_push.
-- Red button: `select private.set_web_push(false);` in the SQL editor (or supabase/emergency/web_push_off.sql).
-- =============================================================================

select private.set_web_push(true);
