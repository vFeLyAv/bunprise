-- =============================================================================
-- Bunprise (Felix 27.10: «письмо о приглашении»): the E-MAIL ABOUT A NEW INVITATION, opt-in, neutral
-- (docs/spec/invite-email-design.md v1.0; the shape was decided in docs/spec/in-app-invites-design.md §3.2, Р7, I6).
-- Forward only. NOT applied to the hosted project by agents: Felix runs `npx supabase db push`.
--
-- CREATED SWITCHED OFF: private.features.invite_email defaults to FALSE. While it is off nobody can switch the e-mails
-- on, no outbox row is written, nothing is sent and the dispatch job does not exist. It is switched on ONLY together with
-- the privacy text that describes it (pilot-6, docs/legal-drafts/pilot-6-notes.md) by a release migration with exactly
--     select private.set_invite_email_feature(true);
-- (template supabase/emergency/invite_email_on.sql; red button supabase/emergency/invite_email_off.sql). Sending also
-- needs the Worker secret BREVO_API_KEY (set by Felix in his own terminal; without it the Worker answers 501) and the
-- Vault secret push_dispatch_secret that Web Push already uses (docs/handoffs/2026-10-27-invite-email.md).
--
-- What a mail says (the Worker's template, workers/edge/src/email/): "Neue Einladung in Bunprise" / "Jemand hat dich in
-- Bunprise eingeladen. Öffne die App, um sie zu sehen." — no names, no titles, no dates, nothing about reservations.
-- The database sends the Worker only: the address, de|en, a one-time unsubscribe token.
--
-- How a mail travels (design §1) — the Web Push pipeline of 20261027150000, reused:
--   send_occasion_invites  --trigger-->  private.invite_email_outbox (one row for EVERY new invitation row, delivered or
--                                        silently suppressed, WITHOUT reading the invitee's choice: the sender's
--                                        transaction does the same work whatever the outcome — no timing oracle, §5)
--   pg_cron every minute   -->  private.invite_email_dispatch(): answers of earlier batches (retry), then the due rows
--                               (5 minutes after the invitation) -> private.invitation_visible (THE inbox rule: a
--                               suppressed / cloaked / withdrawn / declined / accepted / voided invitation is dropped and
--                               changes nothing) -> per person: opted in? at most one mail per 6 hours (the rest waits
--                               and goes as ONE mail) -> confirmed address from auth.users -> a fresh unsubscribe token
--                               (only its sha256 is kept) -> batches of <= 10 -> pg_net POST to the Worker
--                               /api/email/send, HMAC-SHA256 with the Vault secret over "invite-email.v1.<ts>.<payload>"
--                               (the prefix keeps push batches and mail batches apart)
--   the Worker                  verifies, builds the neutral mail (DE / EN), posts it to the Brevo HTTP API, answers
--                               { retry: [positions], sent, failed } — never an address
-- Unsubscribe without sign-in (design §7): https://bunprise.de/api/email/unsubscribe/<token> — the Worker calls
-- public.invite_email_unsubscribe(token) with the PUBLISHABLE key: the second function anon may execute (after
-- calendar_feed); it can only switch the token's own person's e-mails OFF.
--
-- Secrecy of reservations (design §6): nothing here reads or writes wishes, wishlists or reservations (meta-test); the
-- dispatch takes the invitee's profile row only FOR KEY SHARE SKIP LOCKED — a reservation's FOR NO KEY UPDATE does not
-- conflict, so a reservation never delays or skips a mail.
-- LOCKS (design §11, real-PG tests packages/db-tests/test/concurrency/invite-email.test.ts): the dispatch holds the
-- switch row FOR SHARE (the red button waits for it), then per person the profile FOR KEY SHARE SKIP LOCKED and the
-- preference FOR UPDATE SKIP LOCKED — it never waits for a person's row. Switching off waits for a running dispatch on
-- the preference row: once "off" has answered, no later dispatch decides a mail for that person.
-- No top-level LOCK TABLE anywhere (supabase db push does not wrap the statements of a file in one transaction).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Switch and configuration
-- -----------------------------------------------------------------------------
alter table private.features add column invite_email boolean not null default false;
comment on column private.features.invite_email is
  'E-mail about a new invitation (opt-in). false (the default: shipped off) = nobody can opt in, no outbox row, nothing sent. Change it ONLY through private.set_invite_email_feature(boolean), which also (un)schedules the dispatch job.';

create table private.invite_email_config (
  singleton    boolean primary key default true check (singleton),
  -- the Worker endpoint that receives the signed batches (not a secret)
  dispatch_url text not null default 'https://bunprise.de/api/email/send' check (dispatch_url ~ '^https://[a-z0-9.-]+(:[0-9]+)?/'),
  -- how long a new invitation waits before it may cause a mail (withdrawn / answered meanwhile = no mail)
  grace        interval not null default interval '5 minutes' check (grace >= interval '0' and grace <= interval '1 day'),
  -- at most one mail per person in this time; what arrives meanwhile goes as one mail afterwards
  min_gap      interval not null default interval '6 hours' check (min_gap >= interval '1 minute' and min_gap <= interval '7 days')
);
insert into private.invite_email_config default values;
alter table private.invite_email_config enable row level security;  alter table private.invite_email_config force row level security;
revoke all on private.invite_email_config from public, anon, authenticated;
comment on table private.invite_email_config is 'Invitation e-mail: Worker address, grace and minimum gap (design §4). The HMAC secret is in Supabase Vault ("push_dispatch_secret"), never here.';

-- -----------------------------------------------------------------------------
-- 2. Tables — RPC only: RLS enabled and forced, NOT ONE privilege and NOT ONE policy (like the push tables)
-- -----------------------------------------------------------------------------
-- the opt-in itself: a row = "send me an e-mail on a new invitation"; no row = no mail (switching off deletes it)
create table public.invite_email_prefs (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  lang         text not null check (lang in ('de', 'en')),       -- the mail's language (ru / uk -> de, design §8)
  -- consent evidence: which text of the switch the person agreed to (the app's locales), and when
  consent      text not null check (consent ~ '^invite-email-[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  enabled_at   timestamptz not null default now()
);
comment on table public.invite_email_prefs is
  'Invitation e-mail opt-in (20261028000000). RPC-only. Deleted on switch-off, on unsubscribe and with the account. Never linked to wishes, wishlists or reservations.';

-- one unsubscribe token per mail; only sha256 of it (the token itself is in the mail only)
create table public.invite_email_tokens (
  token_hash bytea primary key check (length(token_hash) = 32),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index invite_email_tokens_profile_idx on public.invite_email_tokens (profile_id);
-- the rate limit's memory (Codex review #3): when the person last got such a mail. Kept apart from the opt-in, so that
-- switching off and on again does not reset the 6 hours; gone with the account, purged a week after the last mail.
create table private.invite_email_sent (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  last_sent_at timestamptz not null
);
comment on table private.invite_email_sent is 'Invitation e-mail: time of the last mail per person (rate limit). Purged 7 days after it; cascades with the account.';

comment on table public.invite_email_tokens is
  'Invitation e-mail: sha256 of the unsubscribe token of each mail, valid 90 days (daily purge), gone with the account. RPC-only; read by public.invite_email_unsubscribe (anon, through our Worker).';

create table private.invite_email_outbox (
  id            bigint generated always as identity primary key,
  invitation_id uuid,                                    -- attempt 0: a new invitation row (no FK: dispatch re-checks)
  -- a retry (attempt > 0): this person. NO foreign key (Codex review #1): an account deletion must not cascade into a
  -- row the dispatch holds while the dispatch's requeue waits for that profile (a deadlock). The dispatch re-checks the
  -- person (no opt-in = dropped); switching off empties the queue; the daily purge drops rows older than 8 days.
  profile_id    uuid,
  attempt       smallint not null default 0 check (attempt between 0 and 2),
  not_before    timestamptz not null default now(),
  created_at    timestamptz not null default now(),    -- of the invitation's row / of the FIRST attempt
  check ((invitation_id is null) <> (profile_id is null)),
  check ((attempt = 0) = (invitation_id is not null))
);
create index invite_email_outbox_due_idx on private.invite_email_outbox (not_before, id);
comment on table private.invite_email_outbox is
  'Invitation e-mail work queue: ids only (no address, no names, no text). A row for EVERY new invitation, delivered or not (no timing oracle). Waits 5 minutes, up to 6 hours for the rate limit; dropped after 8 days.';

create table private.invite_email_requests (
  request_id bigint primary key,                         -- pg_net request id
  sent_at    timestamptz not null default now(),
  items      jsonb not null                              -- [{p: person, a: attempt, c: first created_at}] by position
);
comment on table private.invite_email_requests is 'Invitation e-mail batches in flight: read back by invite_email_collect (retry), at most ~1 hour.';

revoke all on public.invite_email_prefs, public.invite_email_tokens from public, anon, authenticated;
revoke all on private.invite_email_outbox, private.invite_email_requests, private.invite_email_sent from public, anon, authenticated;
alter table public.invite_email_prefs     enable row level security;  alter table public.invite_email_prefs     force row level security;
alter table public.invite_email_tokens    enable row level security;  alter table public.invite_email_tokens    force row level security;
alter table private.invite_email_outbox   enable row level security;  alter table private.invite_email_outbox   force row level security;
alter table private.invite_email_requests enable row level security;  alter table private.invite_email_requests force row level security;
alter table private.invite_email_sent     enable row level security;  alter table private.invite_email_sent     force row level security;

-- -----------------------------------------------------------------------------
-- 3. Helpers (definer-only)
-- -----------------------------------------------------------------------------
create or replace function private.invite_email_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.invite_email from private.features f), false);
$$;

-- the person's sign-in address, only when confirmed and of a plain shape; null otherwise. Read by the dispatch at
-- sending time (a changed address is used at once); the app only learns WHETHER there is one (get_invite_email_settings).
create or replace function private.invite_email_address(p_profile uuid)
returns text language sql stable security definer set search_path = '' as $$
  select u.email from auth.users u
   where u.id = p_profile and u.email_confirmed_at is not null
     and length(u.email) <= 254 and u.email ~ '^[^@[:space:]<>",;]+@[^@[:space:]<>",;]+\.[^@[:space:]<>",;]+$';
$$;

-- does the person see at least one invitation right now (the inbox rule; for a retry of an already decided mail)
create or replace function private.invite_email_has_visible(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.occasion_invitations i
                  where i.invitee_id = p_profile and i.delivered and i.outcome = 'pending'
                    and private.invitation_visible(i.id));
$$;

-- puts a person's taken rows back (locked meanwhile / waiting for the rate limit): the invitation rows keep their
-- time, a retry keeps its attempt
create or replace function private.invite_email_requeue(p_person uuid, p_retry boolean, p_attempt integer,
                                                        p_first timestamptz, p_invitations jsonb, p_at timestamptz)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into private.invite_email_outbox (invitation_id, attempt, not_before, created_at)
  select (e ->> 'i')::uuid, 0, p_at, (e ->> 'c')::timestamptz from jsonb_array_elements(coalesce(p_invitations, '[]'::jsonb)) e;
  if p_retry then
    insert into private.invite_email_outbox (profile_id, attempt, not_before, created_at)
    values (p_person, greatest(1, least(2, p_attempt)), p_at, p_first);
  end if;
exception when foreign_key_violation then
  null;                                                -- the account went meanwhile
end $$;

-- -----------------------------------------------------------------------------
-- 4. The outbox trigger: one row per new invitation row — delivered or silently suppressed alike, whoever opted in
-- -----------------------------------------------------------------------------
create or replace function private.invite_email_enqueue()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if private.invite_email_on() then
    insert into private.invite_email_outbox (invitation_id, not_before)
    values (new.id, now() + coalesce((select c.grace from private.invite_email_config c), interval '5 minutes'));
  end if;
  return null;
end $$;
create trigger occasion_invitations_invite_email after insert on public.occasion_invitations
  for each row execute function private.invite_email_enqueue();

-- -----------------------------------------------------------------------------
-- 5. RPCs of the app (authenticated)
-- -----------------------------------------------------------------------------

-- get_invite_email_settings() -> { available, enabled, address }: is the feature on, did I opt in, is there a usable
-- address (a boolean — never the address itself).
create or replace function public.get_invite_email_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'available', private.invite_email_on(),
    'enabled', exists (select 1 from public.invite_email_prefs p where p.profile_id = v_uid),
    'address', private.invite_email_address(v_uid) is not null);
end $$;

-- set_invite_email(enabled, lang, consent) -> { ok, enabled }. On: the switch, the current consents, a usable address,
-- the app language (de | en | ru | uk; stored: en -> en, else de) and the version of the text the person saw. Again
-- on = new language and consent time. Off: always (it narrows), whatever the other arguments.
create or replace function public.set_invite_email(p_enabled boolean, p_lang text, p_consent text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_enabled is null then raise exception using message = 'validation'; end if;
  if not p_enabled then
    delete from public.invite_email_prefs p where p.profile_id = v_uid;
    return jsonb_build_object('ok', true, 'enabled', false);
  end if;
  if not private.invite_email_on() then raise exception using message = 'not_found'; end if;
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if coalesce(p_lang not in ('de', 'en', 'ru', 'uk'), true)
     or coalesce(p_consent !~ '^invite-email-[0-9]{4}-[0-9]{2}-[0-9]{2}$', true) then
    raise exception using message = 'validation';
  end if;
  if private.invite_email_address(v_uid) is null then raise exception using message = 'no_address'; end if;
  insert into public.invite_email_prefs as p (profile_id, lang, consent)
  values (v_uid, case when p_lang = 'en' then 'en' else 'de' end, p_consent)
  on conflict (profile_id) do update set lang = excluded.lang, consent = excluded.consent, enabled_at = now();
  return jsonb_build_object('ok', true, 'enabled', true);
end $$;

-- export_my_invite_email(): Art. 15/20 — my choice, its language, consent and time, the last mail's time, how many of
-- my unsubscribe links still work (their hashes are useless to anybody and are left out).
create or replace function public.export_my_invite_email()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_row record;
begin
  select p.lang, p.consent, p.enabled_at into v_row from public.invite_email_prefs p where p.profile_id = v_uid;
  return jsonb_build_object(
    'enabled', v_row.lang is not null,
    'lang', v_row.lang, 'consent', v_row.consent, 'enabled_at', v_row.enabled_at,
    'last_sent_at', (select x.last_sent_at from private.invite_email_sent x where x.profile_id = v_uid),
    'unsubscribe_links', (select count(*) from public.invite_email_tokens t
                           where t.profile_id = v_uid and t.created_at > now() - interval '90 days'));
end $$;

-- -----------------------------------------------------------------------------
-- 6. Unsubscribe without sign-in (anon, through our Worker with the publishable key) — design §7
-- -----------------------------------------------------------------------------
-- invite_email_unsubscribe(token) -> { ok: true } (the e-mails of the token's person are off; again = ok) or null
-- (unknown, malformed, older than 90 days). A 43-character token (~244 random bits) is the permission; it can only
-- switch OFF. The lookup is by sha256 through the primary key (no comparison of secrets in our code). A read-only
-- transaction is refused (PostgREST runs GET calls read-only; the Worker POSTs).
create or replace function public.invite_email_unsubscribe(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_profile uuid;
begin
  if current_setting('transaction_read_only') = 'on' then raise exception using message = 'not_allowed'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then return null; end if;
  select t.profile_id into v_profile from public.invite_email_tokens t
   where t.token_hash = sha256(convert_to(p_token, 'UTF8')) and t.created_at > now() - interval '90 days';
  if v_profile is null then return null; end if;
  delete from public.invite_email_prefs p where p.profile_id = v_profile;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 7. Dispatch (pg_cron, every minute while switched on) — definer-only, never callable through the API
-- -----------------------------------------------------------------------------

-- the Worker's answers to earlier batches: the messages it asks to retry (their 1-based position n: 429 / 5xx / timeout
-- at Brevo) and every message of a batch that got no answer, a 429 / 5xx (but 501) or no status within 10 minutes, for
-- at most two more attempts, 30 s / 2 min later, within a day of the FIRST attempt, only while the person is still opted
-- in. 401 / 400 / 501 (no key) are not retried.
create or replace function private.invite_email_collect()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  r       record;
  v_body  jsonb;
  v_retry jsonb;
  v_n     integer := 0;
begin
  for r in
    select q.request_id, q.items, resp.status_code, (resp.id is not null) as answered, resp.content
      from private.invite_email_requests q
      left join net._http_response resp on resp.id = q.request_id
     where resp.id is not null or q.sent_at < now() - interval '10 minutes'
     order by q.request_id
     for update of q skip locked
  loop
    v_retry := '[]'::jsonb;                             -- [] = retry nothing, null = retry every message
    if r.answered and r.status_code = 200 then
      begin
        v_body := r.content::jsonb;
        if jsonb_typeof(v_body -> 'retry') = 'array' then v_retry := v_body -> 'retry'; end if;
      exception when data_exception then
        null;                                           -- an unreadable "200": nothing is retried blindly
      end;
    -- 429 and every 5xx (also Cloudflare's 520-524) except 501 = the Worker has no key (Codex review #5)
    elsif not r.answered or r.status_code is null or r.status_code = 429 or (r.status_code >= 500 and r.status_code <> 501) then
      v_retry := null;
    end if;
    begin
      insert into private.invite_email_outbox (profile_id, attempt, not_before, created_at)
      select (it ->> 'p')::uuid, (it ->> 'a')::smallint + 1,
             now() + make_interval(secs => 30 * power(4, (it ->> 'a')::int)), (it ->> 'c')::timestamptz
        from jsonb_array_elements(r.items) with ordinality t(it, k)
        join public.invite_email_prefs pr on pr.profile_id = (it ->> 'p')::uuid
       where (it ->> 'a')::int < 2
         and (it ->> 'c')::timestamptz > now() - interval '1 day'
         and (v_retry is null or v_retry @> to_jsonb(t.k));
      v_n := v_n + 1;
    exception when foreign_key_violation or data_exception or invalid_text_representation then
      null;                                             -- a person went meanwhile / a broken item: no retry
    end;
    delete from private.invite_email_requests q where q.request_id = r.request_id;
  end loop;
  return v_n;
exception when undefined_table or invalid_schema_name then
  return 0;                                             -- no pg_net here
end $$;

create or replace function private.invite_email_dispatch()
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_on      boolean;
  v_cfg     record;
  v_secret  text;
  v_due     jsonb;
  v_p       record;
  v_pref    record;
  v_last    timestamptz;
  v_email   text;
  v_token   text;
  v_msgs    jsonb := '[]'::jsonb;
  v_items   jsonb := '[]'::jsonb;
  v_total   integer;
  v_at      integer := 0;
  v_chunk   jsonb;
  v_ts      text;
  v_payload text;
  v_req     bigint;
begin
  perform private.invite_email_collect();
  -- the switch's row FOR SHARE: the red button (UPDATE private.features) waits for a running dispatch, and a dispatch
  -- that starts after "off" committed sees it off
  select f.invite_email into v_on from private.features f for share;
  if not coalesce(v_on, false) then
    delete from private.invite_email_outbox;            -- switched off: nothing waits for later
    delete from private.invite_email_requests;
    return 0;
  end if;
  select c.dispatch_url, c.min_gap into v_cfg from private.invite_email_config c;
  v_secret := private.push_secret();
  if v_secret is null or length(v_secret) < 32 or v_cfg.dispatch_url is null then
    delete from private.invite_email_outbox o where o.created_at < now() - interval '8 days';
    return 0;
  end if;

  -- the due rows, by person. A new invitation counts only while it is VISIBLE to its invitee (private.invitation_visible:
  -- the inbox's own rule) — suppressed, withdrawn, declined, accepted, voided or expired rows are dropped here and
  -- change nothing else (no rate-limit time, no token, no delay of other mails: design §5 item 3). A retry counts
  -- while the person still sees at least one invitation.
  -- Invisible new invitations are dropped first and without a limit (Codex review #2): however many there are, they never
  -- use up the room of a visible one in this run.
  delete from private.invite_email_outbox o
   where o.id in (select x.id from private.invite_email_outbox x
                   where x.not_before <= now() and x.invitation_id is not null
                     and not private.invitation_visible(x.invitation_id)
                   for update skip locked);
  with picked as (
    delete from private.invite_email_outbox o
     where o.id in (select x.id from private.invite_email_outbox x where x.not_before <= now()
                     order by x.id limit 500 for update skip locked)
    returning o.invitation_id, o.profile_id, o.attempt, o.created_at
  ), resolved as (
    select coalesce(i.invitee_id, p.profile_id) as person, p.invitation_id, p.attempt, p.created_at
      from picked p
      left join public.occasion_invitations i on i.id = p.invitation_id
     where p.created_at > now() - interval '8 days'
       and case when p.invitation_id is not null then private.invitation_visible(p.invitation_id)
                else private.invite_email_has_visible(p.profile_id) end
  )
  select coalesce(jsonb_agg(jsonb_build_object('person', g.person, 'retry', g.retry, 'attempt', g.attempt,
                                               'first_at', g.first_at, 'invitations', g.invitations)
                            order by g.person), '[]'::jsonb)
    into v_due
    -- first_at = when the retried mail was FIRST tried (the retry row's created_at; Codex review #6), null for a new mail
    from (select r.person, bool_or(r.attempt > 0) as retry, max(r.attempt)::int as attempt,
                 min(r.created_at) filter (where r.attempt > 0) as first_at,
                 coalesce(jsonb_agg(jsonb_build_object('i', r.invitation_id, 'c', r.created_at))
                            filter (where r.invitation_id is not null), '[]'::jsonb) as invitations
            from resolved r where r.person is not null group by r.person) g;

  for v_p in
    select * from jsonb_to_recordset(v_due) as x(person uuid, retry boolean, attempt integer, first_at timestamptz, invitations jsonb)
  loop
    -- the profile FOR KEY SHARE SKIP LOCKED: private.lock_profile_pair (FOR NO KEY UPDATE, every write between people)
    -- does not conflict, an account deletion (FOR UPDATE) does -> later; then the preference FOR UPDATE SKIP LOCKED: a
    -- switch-off that is running -> later.
    -- The dispatch never WAITS for a person's row (no deadlock with deletion or switch-off).
    perform 1 from public.profiles pr where pr.id = v_p.person for key share skip locked;
    if not found then
      if exists (select 1 from public.profiles pr where pr.id = v_p.person) then
        perform private.invite_email_requeue(v_p.person, v_p.retry, v_p.attempt, v_p.first_at, v_p.invitations, now() + interval '1 minute');
      end if;
      continue;
    end if;
    select p.lang into v_pref from public.invite_email_prefs p where p.profile_id = v_p.person
       for update skip locked;
    if not found then
      if exists (select 1 from public.invite_email_prefs p where p.profile_id = v_p.person) then
        perform private.invite_email_requeue(v_p.person, v_p.retry, v_p.attempt, v_p.first_at, v_p.invitations, now() + interval '1 minute');
      end if;
      continue;                                         -- not opted in: dropped
    end if;
    -- at most one mail per min_gap: new invitations wait and go together (a retry is the same mail: no wait)
    -- (the time lives apart from the opt-in: off and on again does not reset it — Codex review #3)
    select x.last_sent_at into v_last from private.invite_email_sent x where x.profile_id = v_p.person;
    if not v_p.retry and v_last is not null and v_last > now() - v_cfg.min_gap then
      perform private.invite_email_requeue(v_p.person, false, 0, v_p.first_at, v_p.invitations, v_last + v_cfg.min_gap);
      continue;
    end if;
    v_email := private.invite_email_address(v_p.person);
    if v_email is null then continue; end if;           -- no confirmed address: nothing to send
    v_token := private.new_calendar_token();             -- 43 characters base64url, ~244 random bits
    insert into public.invite_email_tokens (token_hash, profile_id) values (sha256(convert_to(v_token, 'UTF8')), v_p.person);
    insert into private.invite_email_sent (profile_id, last_sent_at) values (v_p.person, now())
    on conflict (profile_id) do update set last_sent_at = excluded.last_sent_at;
    v_msgs := v_msgs || jsonb_build_array(jsonb_build_object('to', v_email, 'lang', v_pref.lang, 'token', v_token));
    v_items := v_items || jsonb_build_array(jsonb_build_object('p', v_p.person, 'a', v_p.attempt, 'c', coalesce(v_p.first_at, now())));
  end loop;

  v_total := jsonb_array_length(v_msgs);
  while v_at < v_total loop
    -- n = the message's position in this batch: the Worker names the messages to retry by it
    v_chunk := (select jsonb_agg(jsonb_set(e, '{n}', to_jsonb(k - v_at)) order by k)
                  from jsonb_array_elements(v_msgs) with ordinality t(e, k) where k > v_at and k <= v_at + 10);
    v_ts := floor(extract(epoch from now()))::bigint::text;
    v_payload := jsonb_build_object('v', 1, 'messages', v_chunk)::text;
    begin
      v_req := net.http_post(
        url => v_cfg.dispatch_url,
        body => jsonb_build_object('ts', v_ts, 'payload', v_payload,
                                   'sig', private.push_hmac(v_secret, 'invite-email.v1.' || v_ts || '.' || v_payload)),
        headers => '{"Content-Type": "application/json"}'::jsonb,
        timeout_milliseconds => 20000);
      insert into private.invite_email_requests (request_id, items)
      values (v_req, (select jsonb_agg(e order by k) from jsonb_array_elements(v_items) with ordinality t(e, k)
                       where k > v_at and k <= v_at + 10))
      on conflict (request_id) do nothing;
    exception when undefined_function or invalid_schema_name then
      null;                                             -- no pg_net here: these mails are dropped
    end;
    v_at := v_at + 10;
  end loop;
  return v_total;
end $$;

-- daily: old unsubscribe tokens, leftovers of the queues, rate-limit times older than the longest gap, the dispatch job's
-- own run log
create or replace function private.purge_invite_email()
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.invite_email_tokens t where t.created_at < now() - interval '90 days';
  delete from private.invite_email_outbox o where o.created_at < now() - interval '8 days';
  delete from private.invite_email_requests q where q.sent_at < now() - interval '1 hour';
  delete from private.invite_email_sent x where x.last_sent_at < now() - interval '7 days';
  begin
    delete from cron.job_run_details d using cron.job j
     where j.jobid = d.jobid and j.jobname = 'bunprise_invite_email_dispatch' and d.end_time < now() - interval '1 day';
  exception when undefined_table or invalid_schema_name or insufficient_privilege then
    null;
  end;
end $$;

-- THE switch (release migration / red button): the feature flag plus the dispatch job. Off empties the queues at once
-- and keeps the opt-ins (on again uses them). Mails already handed to pg_net / the Worker still go out.
create or replace function private.set_invite_email_feature(p_on boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.features set invite_email = coalesce(p_on, false);
  -- off: the queue and the batches in flight go at once (their answers are not collected any more; the batch items name
  -- people, so they must not wait for the daily purge — Codex review #7)
  if not coalesce(p_on, false) then
    delete from private.invite_email_outbox;
    delete from private.invite_email_requests;
  end if;
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'bunprise_invite_email_dispatch';
    if coalesce(p_on, false) then
      perform cron.schedule('bunprise_invite_email_dispatch', '* * * * *', 'select private.invite_email_dispatch()');
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8. The daily purge job (only where pg_cron exists: hosted Supabase; PGlite skips it)
-- -----------------------------------------------------------------------------
do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable - invitation e-mail purge scheduling skipped (expected on PGlite)';
    return;
  end if;
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute $cmd$select cron.unschedule(jobid) from cron.job where jobname = 'bunprise_purge_invite_email'$cmd$;
  execute $cmd$select cron.schedule('bunprise_purge_invite_email', '7 4 * * *', 'select private.purge_invite_email()')$cmd$;
end
$cron$;

-- -----------------------------------------------------------------------------
-- 9. Privileges: three RPCs for authenticated, the unsubscribe for anon ONLY (the Worker's publishable key); every
--    helper, trigger and job function for nobody
-- -----------------------------------------------------------------------------
revoke execute on function
  public.get_invite_email_settings(), public.set_invite_email(boolean, text, text), public.export_my_invite_email(),
  public.invite_email_unsubscribe(text)
  from public, anon, authenticated;
grant execute on function
  public.get_invite_email_settings(), public.set_invite_email(boolean, text, text), public.export_my_invite_email()
  to authenticated;
grant execute on function public.invite_email_unsubscribe(text) to anon;

revoke execute on function
  private.invite_email_on(), private.invite_email_address(uuid), private.invite_email_has_visible(uuid),
  private.invite_email_requeue(uuid, boolean, integer, timestamptz, jsonb, timestamptz), private.invite_email_enqueue(),
  private.invite_email_collect(), private.invite_email_dispatch(), private.purge_invite_email(),
  private.set_invite_email_feature(boolean)
  from public, anon, authenticated;
