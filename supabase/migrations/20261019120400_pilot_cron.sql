-- =============================================================================
-- Bunprise pilot — 5/5: conditional pg_cron job (pilot-decisions §1, G-18)
-- signInWithOtp creates an auth.users row for ANY address typed in. Addresses whose owner never
-- finished signing in are deleted after 24 h (promised in the Datenschutzerklärung, DSE 3.1).
-- Runs only where pg_cron is available (hosted Supabase). On PGlite / local Postgres without
-- pg_cron this migration does nothing except print a notice.
-- Other retention rules (reservations / reports 90 days) are NOT cron: they happen when the
-- occasion or the account is deleted.
-- =============================================================================
do $cron$
declare
  v_job_name text := 'bunprise_purge_unconfirmed_users';
  v_command  text := $job$delete from auth.users where last_sign_in_at is null and created_at < now() - interval '24 hours'$job$;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here - skipping the 24h cleanup job (expected on PGlite / local)';
    return;
  end if;

  -- Supabase installs pg_cron with its objects in schema `cron` (docs: create extension pg_cron with schema pg_catalog)
  execute 'create extension if not exists pg_cron with schema pg_catalog';

  if not exists (select 1 from pg_namespace where nspname = 'cron') then
    raise notice 'pg_cron extension present but schema cron missing - skipping';
    return;
  end if;

  -- re-runnable: replace an existing job with the same name
  execute format('select cron.unschedule(j.jobid) from cron.job j where j.jobname = %L', v_job_name);
  execute format('select cron.schedule(%L, %L, %L)', v_job_name, '17 3 * * *', v_command);   -- daily 03:17 UTC
end
$cron$;
