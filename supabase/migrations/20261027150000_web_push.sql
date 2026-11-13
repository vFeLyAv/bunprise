-- =============================================================================
-- Bunprise: WEB PUSH — the first notification type "Anna lädt dich ein" (docs/spec/web-push-design.md v1.1).
-- Forward only. NOT applied to the hosted project by agents: Felix runs `npx supabase db push`.
--
-- CREATED SWITCHED OFF: private.features.web_push defaults to FALSE. While it is off no device can subscribe, no
-- outbox row is written and nothing is sent. It is switched on ONLY together with the privacy text that describes
-- push (pilot-5; the pilot-4 text §3.16 says "keine Push-Benachrichtigung") by a release migration with exactly
--     select private.set_web_push(true);
-- (template supabase/emergency/web_push_on.sql; red button: supabase/emergency/web_push_off.sql). It also needs the
-- secret in Supabase Vault ("push_dispatch_secret") and the Worker secrets (docs/handoffs/2026-10-27-web-push.md).
--
-- How a push travels (design §4.2):
--   send_occasion_invites  --trigger-->  private.push_outbox (one row for EVERY new invitation row, delivered or
--                                        silently suppressed: the sender's transaction does the same work whatever
--                                        the outcome — no timing oracle, design §4.1 E / §6 item 6)
--   pg_cron every 20 s     -->  private.push_dispatch(): answers of earlier batches (gone / retry), then up to 200
--                               outbox rows -> private.invitation_visible + preference + live auth session per
--                               device -> messages -> batches of <= 10 -> pg_net POST to the Worker /api/push/send,
--                               HMAC-SHA256 signed with the Vault secret (the secret never leaves the database)
--   the Worker                  verifies, encrypts (RFC 8291), signs VAPID, posts to the push service, answers
--                               { gone: [subscription ids], retry: [subscription ids] }
-- Secrecy of reservations (design §6): nothing here reads or writes wishes, wishlists or reservations (meta-test);
-- a message is built from the invitation, the inviter's display name, the occasion title, the preference and the
-- device rows only; dispatch runs in its own transaction on a fixed cadence and takes no lock a reservation holds.
-- Codex design review (27.10, design §14): subscriptions are bound to the auth session; an endpoint never moves to
-- another account; consent version + time are kept per device; transient failures are retried (≤ 2 more times).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Switch and configuration
-- -----------------------------------------------------------------------------
alter table private.features add column web_push boolean not null default false;
comment on column private.features.web_push is
  'Web Push. false (the default: shipped off) = no subscription, no outbox row, nothing sent. Change it ONLY through private.set_web_push(boolean), which also (un)schedules the dispatch job.';

create table private.push_config (
  singleton    boolean primary key default true check (singleton),
  -- the Worker endpoint that receives the signed batches (not a secret)
  dispatch_url text not null default 'https://bunprise.de/api/push/send' check (dispatch_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?/')
);
insert into private.push_config default values;
alter table private.push_config enable row level security;  alter table private.push_config force row level security;
revoke all on private.push_config from public, anon, authenticated;
comment on table private.push_config is 'Web Push: where private.push_dispatch() sends its batches. The HMAC secret is in Supabase Vault ("push_dispatch_secret"), never here.';

-- -----------------------------------------------------------------------------
-- 2. Helpers that tables and RPCs need (definer-only)
-- -----------------------------------------------------------------------------
create or replace function private.web_push_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.web_push from private.features f), false);
$$;

-- A push service of a browser maker, https on the default port, no user info (design §7 P2) — and ONE spelling per
-- subscription (Codex code review #1: "/x/../fcm/send/T" or "%41" would reach the same subscription under another
-- text, i.e. another row and another account): no dot segments, no fragment, no backslash; percent escapes only in the
-- query of Microsoft's WNS, only the three a base64 token needs, upper case (the app upper-cases them). The Worker
-- checks the same rules again and sends only to the exact text it validated (workers/edge/src/push/endpoint.ts).
create or replace function private.push_endpoint_ok(p_endpoint text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(length(p_endpoint) <= 1024
     and p_endpoint !~ '/\.{1,2}(/|\?|$)'
     and (p_endpoint ~ ('^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com)'
                        || '/[A-Za-z0-9._~:=/-]+$')
       or p_endpoint ~ ('^https://[a-z0-9-]+\.notify\.windows\.com/[A-Za-z0-9._~/-]*'
                        || '\?([A-Za-z0-9._~=&-]|%2B|%2F|%3D)+$')), false);
$$;

-- the auth session of the caller (GoTrue puts session_id into every access token)
create or replace function private.current_session_id()
returns uuid language plpgsql stable set search_path = '' as $$
declare v text := auth.jwt() ->> 'session_id';
begin
  if v is null or v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return v::uuid;
end $$;

-- a device gets pushes only while the session that registered it lives: sign-out (here or "everywhere"), a revoked
-- or timed-out session and account deletion end it at once (design §7 P8)
create or replace function private.push_session_alive(p_session uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.sessions s
                  where s.id = p_session and s.user_id = p_profile and (s.not_after is null or s.not_after > now()));
$$;

-- HMAC-SHA256 (RFC 2104) on the built-in sha256(): no pgcrypto (its schema differs between Supabase and the tests)
create or replace function private.push_hmac(p_key text, p_message text)
returns text language plpgsql immutable strict set search_path = '' as $$
declare
  k    bytea := convert_to(p_key, 'UTF8');
  ipad bytea;
  opad bytea;
begin
  if length(k) > 64 then k := sha256(k); end if;
  k := k || decode(repeat('00', 64 - length(k)), 'hex');
  ipad := k;
  opad := k;
  for n in 0..63 loop
    ipad := set_byte(ipad, n, get_byte(k, n) # 54);   -- 0x36
    opad := set_byte(opad, n, get_byte(k, n) # 92);   -- 0x5c
  end loop;
  return encode(sha256(opad || sha256(ipad || convert_to(p_message, 'UTF8'))), 'hex');
end $$;

-- the shared secret from Supabase Vault; null where there is none (or no Vault)
create or replace function private.push_secret()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select s.decrypted_secret into v from vault.decrypted_secrets s where s.name = 'push_dispatch_secret' limit 1;
  return v;
exception when undefined_table or invalid_schema_name or insufficient_privilege then
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Tables — RPC only: RLS enabled and forced, NOT ONE privilege and NOT ONE policy (like the invitation tables)
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  session_id   uuid not null,                         -- the auth session that registered this device (no FK into auth)
  endpoint     text not null unique check (private.push_endpoint_ok(endpoint)),
  p256dh       text not null check (p256dh ~ '^B[A-Za-z0-9_-]{86}$'),   -- 65-byte P-256 point (0x04 …), base64url
  auth         text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),      -- 16-byte auth secret, base64url
  lang         text not null check (lang in ('de', 'en', 'ru', 'uk')),
  -- consent evidence (Codex design review #7): which explanation the person agreed to on this device, and when
  consent      text not null check (consent ~ '^push-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  consented_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id);
comment on table public.push_subscriptions is
  'Web Push devices (one row per browser subscription). RPC-only. Never linked to wishes, wishlists or reservations. Deleted on switch-off by the person, account deletion, a dead session (daily purge; dispatch skips it at once), 404/410 from the push service, or as the 11th device.';

create table public.push_preferences (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  invitations boolean not null default true,
  updated_at  timestamptz not null default now()
);
comment on table public.push_preferences is 'Web Push: which kinds a person wants (a missing row = the defaults). RPC-only.';

create table private.push_outbox (
  id              bigint generated always as identity primary key,
  kind            text not null check (kind in ('invitation')),
  ref_id          uuid not null,                       -- occasion_invitations.id (no FK: dispatch re-checks everything)
  subscription_id uuid references public.push_subscriptions(id) on delete cascade,   -- a retry: this device only
  attempt         smallint not null default 0 check (attempt between 0 and 2),
  not_before      timestamptz not null default now(),
  created_at      timestamptz not null default now()   -- of the FIRST attempt; older than 1 hour = dropped
);
create index push_outbox_due_idx on private.push_outbox (not_before, id);
comment on table private.push_outbox is
  'Web Push work queue: ids only (no names, no text). A row for EVERY new invitation, delivered or not (no timing oracle). Taken by push_dispatch within ~20 s; dropped after 1 hour.';

create table private.push_requests (
  request_id bigint primary key,                       -- pg_net request id
  sent_at    timestamptz not null default now(),
  items      jsonb not null                            -- [{s: subscription, k: kind, r: ref, a: attempt, c: first created_at}]
);
comment on table private.push_requests is 'Web Push batches in flight: read back by push_collect (gone / retry), at most ~1 hour.';

revoke all on public.push_subscriptions, public.push_preferences from public, anon, authenticated;
revoke all on private.push_outbox, private.push_requests from public, anon, authenticated;
alter table public.push_subscriptions  enable row level security;  alter table public.push_subscriptions  force row level security;
alter table public.push_preferences    enable row level security;  alter table public.push_preferences    force row level security;
alter table private.push_outbox        enable row level security;  alter table private.push_outbox        force row level security;
alter table private.push_requests      enable row level security;  alter table private.push_requests      force row level security;

create or replace function private.push_wants(p_profile uuid, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_kind
           when 'invitation' then coalesce((select p.invitations from public.push_preferences p where p.profile_id = p_profile), true)
           else false end;
$$;

-- -----------------------------------------------------------------------------
-- 4. The outbox trigger: one row per new invitation row — delivered or silently suppressed alike
-- -----------------------------------------------------------------------------
create or replace function private.push_enqueue()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if private.web_push_on() then
    insert into private.push_outbox (kind, ref_id) values ('invitation', new.id);
  end if;
  return null;
end $$;
create trigger occasion_invitations_push after insert on public.occasion_invitations
  for each row execute function private.push_enqueue();

-- -----------------------------------------------------------------------------
-- 5. RPCs (authenticated)
-- -----------------------------------------------------------------------------

-- push_subscribe(endpoint, p256dh, auth, lang, consent): this device, for the caller and their current session.
-- An endpoint that belongs to ANOTHER account is never taken over (Codex design review #2): push_endpoint_taken —
-- the app then drops the browser subscription and subscribes afresh (a new endpoint). The same account again (a new
-- session, new language, renewed consent) updates the row. At most 10 devices per person (the oldest goes).
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_lang text, p_consent text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := private.require_user();
  v_session uuid := private.current_session_id();
begin
  if not private.web_push_on() then raise exception using message = 'not_found'; end if;
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if v_session is null or not private.push_session_alive(v_session, v_uid) then
    raise exception using message = 'not_authenticated';
  end if;
  if not private.push_endpoint_ok(p_endpoint)
     or coalesce(p_p256dh !~ '^B[A-Za-z0-9_-]{86}$', true)
     or coalesce(p_auth !~ '^[A-Za-z0-9_-]{22}$', true)
     or coalesce(p_lang not in ('de', 'en', 'ru', 'uk'), true)
     or coalesce(p_consent !~ '^push-[0-9]{4}-[0-9]{2}-[0-9]{2}$', true) then
    raise exception using message = 'validation';
  end if;
  -- one registration of this person at a time: the 10-device limit below holds under parallel calls too (Codex code
  -- review #5). A push-only advisory key, never a profile row lock (profile rows take part in other lock orders).
  perform pg_advisory_xact_lock(hashtextextended('push-device:' || v_uid::text, 0));
  insert into public.push_subscriptions as s (profile_id, session_id, endpoint, p256dh, auth, lang, consent)
  values (v_uid, v_session, p_endpoint, p_p256dh, p_auth, p_lang, p_consent)
  on conflict (endpoint) do update
     set session_id = excluded.session_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang,
         consent = excluded.consent, consented_at = now()
   where s.profile_id = v_uid;
  if not found then raise exception using message = 'push_endpoint_taken'; end if;
  delete from public.push_subscriptions s
   where s.profile_id = v_uid
     and s.id not in (select x.id from public.push_subscriptions x where x.profile_id = v_uid
                       order by x.consented_at desc, x.id desc limit 10);
  return jsonb_build_object('ok', true, 'invitations', private.push_wants(v_uid, 'invitation'));
end $$;

-- push_unsubscribe(endpoint): my row for this device goes (works while the switch is off too). Always { ok: true }.
create or replace function public.push_unsubscribe(p_endpoint text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.profile_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- get_push_settings(endpoint | null): is push available, is THIS device registered for me and my current session
-- (else the app offers to switch it on / re-registers it), my preference.
create or replace function public.get_push_settings(p_endpoint text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'available', private.web_push_on(),
    'device', p_endpoint is not null and exists (
      select 1 from public.push_subscriptions s
       where s.endpoint = p_endpoint and s.profile_id = v_uid and s.session_id = private.current_session_id()),
    'invitations', private.push_wants(v_uid, 'invitation'));
end $$;

-- set_push_settings(invitations): narrowing or widening my own preference; works while the switch is off too.
create or replace function public.set_push_settings(p_invitations boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_invitations is null then raise exception using message = 'validation'; end if;
  insert into public.push_preferences as p (profile_id, invitations) values (v_uid, p_invitations)
  on conflict (profile_id) do update set invitations = excluded.invitations, updated_at = now();
  return jsonb_build_object('ok', true, 'invitations', p_invitations);
end $$;

-- export_my_push(): Art. 15/20 — my preference and my devices (address at the push service, language, consent and
-- its time). The device keys are left out: technical, they live in the browser anyway.
create or replace function public.export_my_push()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'preferences', jsonb_build_object('invitations', private.push_wants(v_uid, 'invitation')),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'lang', s.lang, 'consent', s.consent,
                                          'consented_at', s.consented_at, 'created_at', s.created_at)
                       order by s.created_at, s.id)
        from public.push_subscriptions s where s.profile_id = v_uid), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
-- 6. Dispatch (pg_cron, every 20 s while switched on) — definer-only, never callable through the API
-- -----------------------------------------------------------------------------

-- the Worker's answers to earlier batches: delete the devices it called gone (subscription ids), queue the MESSAGES it
-- asks to retry (their 1-based position n in the batch: a device with two invitations in one batch gets only the failed
-- one again — Codex code review #4) and every message of a batch without a usable answer after 10 minutes, for at most
-- two more attempts, 30 s / 2 min later
create or replace function private.push_collect()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  r       record;
  v_body  jsonb;
  v_gone  jsonb;
  v_retry jsonb;
  v_n     integer := 0;
begin
  for r in
    select q.request_id, q.items, resp.status_code, (resp.id is not null) as answered, resp.content
      from private.push_requests q
      left join net._http_response resp on resp.id = q.request_id
     where resp.id is not null or q.sent_at < now() - interval '10 minutes'
     order by q.request_id
     for update of q skip locked
  loop
    v_gone := '[]'::jsonb;
    v_retry := null;                                    -- null = no usable answer: every item may be retried
    if r.answered and r.status_code = 200 then
      begin
        v_body := r.content::jsonb;
        v_gone := case when jsonb_typeof(v_body -> 'gone') = 'array' then v_body -> 'gone' else '[]'::jsonb end;
        v_retry := case when jsonb_typeof(v_body -> 'retry') = 'array' then v_body -> 'retry' else '[]'::jsonb end;
      exception when data_exception then
        v_retry := '[]'::jsonb;                         -- an unreadable "200": nothing is retried blindly
      end;
    end if;
    begin
      delete from public.push_subscriptions s
       where s.id in (select x::uuid from jsonb_array_elements_text(v_gone) x
                       where x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
      v_n := v_n + 1;
      insert into private.push_outbox (kind, ref_id, subscription_id, attempt, not_before, created_at)
      select it ->> 'k', (it ->> 'r')::uuid, s.id, (it ->> 'a')::smallint + 1,
             now() + make_interval(secs => 30 * power(4, (it ->> 'a')::int)), (it ->> 'c')::timestamptz
        from jsonb_array_elements(r.items) with ordinality t(it, k)
        join public.push_subscriptions s on s.id = (it ->> 's')::uuid
       where (it ->> 'a')::int < 2
         and (it ->> 'c')::timestamptz > now() - interval '1 hour'
         and (v_retry is null or v_retry @> to_jsonb(t.k));
    exception when foreign_key_violation or data_exception then
      null;                                             -- a device went meanwhile / a broken item: no retry
    end;
    delete from private.push_requests q where q.request_id = r.request_id;
  end loop;
  return v_n;
exception when undefined_table or invalid_schema_name then
  return 0;                                             -- no pg_net here
end $$;

create or replace function private.push_dispatch()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_secret  text;
  v_url     text;
  v_rows    jsonb;
  v_total   integer;
  v_chunk   jsonb;
  v_ts      text;
  v_payload text;
  v_req     bigint;
  v_at      integer := 0;
begin
  perform private.push_collect();
  if not private.web_push_on() then
    delete from private.push_outbox;                    -- switched off: nothing waits for later
    return 0;
  end if;
  v_secret := private.push_secret();
  select c.dispatch_url into v_url from private.push_config c;
  if v_secret is null or length(v_secret) < 32 or v_url is null then
    delete from private.push_outbox o where o.created_at < now() - interval '1 hour';
    return 0;
  end if;

  with picked as (
    delete from private.push_outbox o
     where o.id in (select x.id from private.push_outbox x where x.not_before <= now()
                     order by x.id limit 200 for update skip locked)
    returning o.id, o.kind, o.ref_id, o.subscription_id, o.attempt, o.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('m', m.msg, 'i', m.item) order by m.oid, m.sid), '[]'::jsonb) into v_rows
    from (select p.id as oid, s.id as sid,
                 jsonb_build_object(
                   'id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'lang', s.lang,
                   -- the push service keeps it while the phone is offline: at most 12 hours, never past the invitation
                   -- (no minimum either — Codex code review #8)
                   'ttl', greatest(0, least(43200, floor(extract(epoch from (i.expires_at - now())))::int)),
                   'kind', 'invitation', 'inviter', coalesce(inv.display_name, ''), 'title', o.title) as msg,
                 jsonb_build_object('s', s.id, 'k', p.kind, 'r', p.ref_id, 'a', p.attempt, 'c', p.created_at) as item
            from picked p
            join public.occasion_invitations i on i.id = p.ref_id
            join public.occasions o on o.id = i.occasion_id
            join public.profiles inv on inv.id = i.inviter_id
            join public.push_subscriptions s on s.profile_id = i.invitee_id
                                            and (p.subscription_id is null or s.id = p.subscription_id)
           where p.kind = 'invitation'
             and p.created_at > now() - interval '1 hour'
             and private.invitation_visible(i.id)
             and private.push_wants(i.invitee_id, 'invitation')
             and private.push_session_alive(s.session_id, s.profile_id)) m;

  v_total := jsonb_array_length(v_rows);
  while v_at < v_total loop
    v_chunk := (select jsonb_agg(e order by n) from jsonb_array_elements(v_rows) with ordinality t(e, n)
                 where n > v_at and n <= v_at + 10);
    v_ts := floor(extract(epoch from now()))::bigint::text;
    -- n = the message's position in this batch: the Worker names failed MESSAGES by it (retry), devices by id (gone)
    v_payload := jsonb_build_object('v', 1, 'messages', (select jsonb_agg(jsonb_set(e -> 'm', '{n}', to_jsonb(k)) order by k)
                                                           from jsonb_array_elements(v_chunk) with ordinality c(e, k)))::text;
    begin
      v_req := net.http_post(
        url => v_url,
        body => jsonb_build_object('ts', v_ts, 'payload', v_payload, 'sig', private.push_hmac(v_secret, v_ts || '.' || v_payload)),
        headers => '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds => 20000);
      insert into private.push_requests (request_id, items)
      values (v_req, (select jsonb_agg(e -> 'i' order by k) from jsonb_array_elements(v_chunk) with ordinality c(e, k)))
      on conflict (request_id) do nothing;
    exception when undefined_function or invalid_schema_name then
      null;                                             -- no pg_net here: these messages are dropped
    end;
    v_at := v_at + 10;
  end loop;
  return v_total;
end $$;

-- daily: devices whose session is gone, leftovers of the queues, the dispatch job's own run log
create or replace function private.purge_push()
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions s where not private.push_session_alive(s.session_id, s.profile_id);
  delete from private.push_outbox o where o.created_at < now() - interval '1 hour';
  delete from private.push_requests q where q.sent_at < now() - interval '1 hour';
  begin
    delete from cron.job_run_details d using cron.job j
     where j.jobid = d.jobid and j.jobname = 'bunprise_push_dispatch' and d.end_time < now() - interval '1 day';
  exception when undefined_table or invalid_schema_name or insufficient_privilege then
    null;
  end;
end $$;

-- THE switch (release migration / red button): the feature flag plus the dispatch job. Off empties the outbox and
-- keeps the devices (on again uses them).
create or replace function private.set_web_push(p_on boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.features set web_push = coalesce(p_on, false);
  if not coalesce(p_on, false) then delete from private.push_outbox; end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'bunprise_push_dispatch';
    if coalesce(p_on, false) then
      begin
        perform cron.schedule('bunprise_push_dispatch', '20 seconds', 'select private.push_dispatch()');
      exception when others then                         -- pg_cron < 1.5 knows no seconds: once a minute
        perform cron.schedule('bunprise_push_dispatch', '* * * * *', 'select private.push_dispatch()');
      end;
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Extensions and the daily purge job (only where available: hosted Supabase; PGlite uses the test stubs)
-- -----------------------------------------------------------------------------
do $ext$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net with schema extensions';
  else
    raise notice 'pg_net unavailable - push dispatch cannot send here (expected on PGlite; the tests stub net.http_post)';
  end if;
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable - push purge scheduling skipped (expected on PGlite)';
    return;
  end if;
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute $cmd$select cron.unschedule(jobid) from cron.job where jobname = 'bunprise_purge_push'$cmd$;
  execute $cmd$select cron.schedule('bunprise_purge_push', '57 3 * * *', 'select private.purge_push()')$cmd$;
end
$ext$;

-- -----------------------------------------------------------------------------
-- 8. Privileges: the five RPCs for authenticated only; every helper, trigger and job function for nobody
-- -----------------------------------------------------------------------------
revoke execute on function
  public.push_subscribe(text, text, text, text, text), public.push_unsubscribe(text), public.get_push_settings(text),
  public.set_push_settings(boolean), public.export_my_push()
  from public, anon;
grant execute on function
  public.push_subscribe(text, text, text, text, text), public.push_unsubscribe(text), public.get_push_settings(text),
  public.set_push_settings(boolean), public.export_my_push()
  to authenticated;

revoke execute on all functions in schema private from public, anon;
revoke execute on function
  private.web_push_on(), private.push_endpoint_ok(text), private.current_session_id(), private.push_session_alive(uuid, uuid),
  private.push_hmac(text, text), private.push_secret(), private.push_wants(uuid, text), private.push_enqueue(),
  private.push_collect(), private.push_dispatch(), private.purge_push(), private.set_web_push(boolean)
  from authenticated;
