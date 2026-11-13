-- =============================================================================
-- Bunprise (Felix 27.10, «Календари сделать тоже сейчас», brief §7.4): the CALENDAR SUBSCRIPTION ("Kalender-Abo")
-- and the BIRTHDAY SUGGESTION. Design + Russian handoff: docs/handoffs/2026-10-27-calendar.md.
-- Forward only. NOT applied to the hosted project by agents: Felix runs `npx supabase db push`.
--
-- 1. Kalender-Abo: Profil -> "Kalender-Abo" creates ONE secret feed address per person,
--        https://bunprise.de/api/calendar/<token>.ics   (webcal://… for Apple / Outlook, "Per URL" for Google)
--    Our Worker (workers/edge/src/calendar/) answers it: it calls public.calendar_feed(token) with the PUBLISHABLE
--    (anon) key — no service-role key anywhere — and turns the answer into an iCalendar file (RFC 5545).
--    * the token: 32 bytes (two gen_random_uuid(), 244 random bits; no pgcrypto) as base64url, 43 characters, shown
--      ONCE by create_calendar_feed; only sha256(token) is stored (calendar_feeds.token_hash, unique). "Neuen Link
--      erstellen" replaces it (the old address stops at once), "Abo beenden" deletes it, account deletion cascades.
--    * no comparison of secrets in our code: the lookup is by sha256 through a unique index — its timing can at most
--      say something about a HASH prefix, which does not help to guess a 256-bit token (no oracle, no enumeration:
--      an unknown, malformed or revoked token is one answer, null).
--    * EXCEPTION to "anon executes nothing" (packages/db-tests/test/pilot/meta.test.ts): anon may execute exactly
--      public.calendar_feed(text). The token is the bearer secret (like an invite token); the function reads only
--      the token's own person's occasions. A read-only transaction is refused (PostgREST runs GET calls read-only,
--      where the fetch counter could not be written), so the per-token limit cannot be skipped: 30 answers per hour
--      and token, then { rate_limited: true } (a value, not an exception: the count must stay committed).
--      The Worker has its own per-address and per-token limits on top.
--    * what the feed contains (calendar_feed): the person's occasions as host, or as an active guest who did not
--      decline; not cancelled; not hidden by a block with the host (either direction); from 30 days ago to 2 years
--      ahead; at most 200. Fields: id, title, starts_at, ends_at, tz, all_day, place_text, updated_at — nothing
--      else: no description, no guests, no wishes, NOTHING about reservations (meta-test: the function body never
--      names a wish/reservation table; the feed text is identical with 0 and 5 reservations).
--    * stored per feed: profile_id, token_hash, lang (the words of the file: "Bunprise", the link line), created_at,
--      last_fetched_at (shown in the app: "zuletzt abgerufen" = the subscription works) and the hour window of the
--      rate limit. Exported by export_my_calendar_feed() (never the hash).
--
-- 2. Birthday suggestion (Felix: «Ежегодный день рождения … события не создавать … просто как предложение»):
--    get_anniversary_suggestions() — my own past occasions (host, or a guest who did not decline) whose anniversary
--    in the occasion's zone is 14–28 days ahead and that may be a birthday: the stored motif is 'birthday', or there
--    is none (null / 'none') and the APP decides from the title on the device (features/occasions/covers/detect.ts).
--    No event is ever created: the app offers "wieder feiern?" (prefilled form: title + this year's date only) or,
--    for a guest, "schau, ob sie Wünsche hat". Only data the caller has seen already: the occasion's title, day and
--    host — never members, wishes or reservations. Not cancelled, not across a block, at least 300 days old,
--    at most 6 years; one row per host and day (the newest occasion), at most 5.
--
-- Secrecy of reservations: nothing here reads or writes wishes, wishlists or reservations (meta-test).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The feed table — RPC only: RLS enabled and forced, NOT ONE privilege and NOT ONE policy
-- -----------------------------------------------------------------------------
create table public.calendar_feeds (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,   -- one feed per person
  token_hash      bytea not null unique check (length(token_hash) = 32),               -- sha256(token)
  lang            text not null check (lang in ('de', 'en', 'ru', 'uk')),
  created_at      timestamptz not null default now(),
  last_fetched_at timestamptz,
  -- the per-token limit: answers in the hour that started at window_start
  window_start    timestamptz,
  window_count    integer not null default 0 check (window_count between 0 and 1000000)
);
comment on table public.calendar_feeds is
  'Kalender-Abo (20261027170000): one secret feed address per person; only sha256 of the token. RPC-only. Read by public.calendar_feed(token) (anon, through our Worker).';

revoke all on public.calendar_feeds from public, anon, authenticated;
alter table public.calendar_feeds enable row level security;  alter table public.calendar_feeds force row level security;

-- -----------------------------------------------------------------------------
-- 2. Helpers (definer code only)
-- -----------------------------------------------------------------------------

-- The next anniversary of p_day on or after p_today (29 February -> 28 February in a common year).
create or replace function private.next_anniversary(p_day date, p_today date)
returns date language plpgsql immutable strict set search_path = '' as $$
declare
  v_year integer := extract(year from p_today)::integer;
  v_try  date;
begin
  for i in 0..1 loop
    v_try := make_date(v_year + i, extract(month from p_day)::integer, 1);
    v_try := v_try + (least(extract(day from p_day)::integer,
                            extract(day from (v_try + interval '1 month' - interval '1 day'))::integer) - 1);
    if v_try >= p_today then return v_try; end if;
  end loop;
  return v_try;
end $$;

-- A new feed token: 43 characters base64url (32 bytes from two v4 UUIDs = 244 random bits).
create or replace function private.new_calendar_token()
returns text language sql volatile set search_path = '' as $$
  select rtrim(translate(encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'),
                                'base64'), '+/', '-_'), '=');
$$;

-- -----------------------------------------------------------------------------
-- 3. RPCs of the app (authenticated)
-- -----------------------------------------------------------------------------

-- create_calendar_feed(p_lang) -> { token, created_at }: the address is shown ONCE. A second call replaces the feed
-- (the old address stops at once). p_lang = the words of the file (de | en | ru | uk).
create or replace function public.create_calendar_feed(p_lang text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_token text;
  v_at    timestamptz := now();
  v_tries integer := 0;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if p_lang is null or p_lang not in ('de', 'en', 'ru', 'uk') then raise exception using message = 'validation'; end if;
  perform private.lock_profile_pair(v_uid, v_uid);       -- two tabs queue here
  delete from public.calendar_feeds f where f.profile_id = v_uid;
  loop
    v_token := private.new_calendar_token();
    begin
      insert into public.calendar_feeds (profile_id, token_hash, lang, created_at)
      values (v_uid, sha256(convert_to(v_token, 'UTF8')), p_lang, v_at);
      exit;
    exception when unique_violation then                 -- 244 random bits: never in practice
      v_tries := v_tries + 1;
      if v_tries >= 3 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('token', v_token, 'created_at', v_at);
end $$;

-- get_calendar_feed() -> { active, created_at, last_fetched_at, lang } — never the token (it is not stored).
create or replace function public.get_calendar_feed()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_row record;
begin
  select f.created_at, f.last_fetched_at, f.lang into v_row from public.calendar_feeds f where f.profile_id = v_uid;
  if not found then
    return jsonb_build_object('active', false, 'created_at', null, 'last_fetched_at', null, 'lang', null);
  end if;
  return jsonb_build_object('active', true, 'created_at', v_row.created_at, 'last_fetched_at', v_row.last_fetched_at, 'lang', v_row.lang);
end $$;

-- revoke_calendar_feed() -> { ok: true }: "Abo beenden" — the address stops at once (no consents needed: it narrows).
create or replace function public.revoke_calendar_feed()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  delete from public.calendar_feeds f where f.profile_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- export_my_calendar_feed() -> { created_at, last_fetched_at, lang } | null — "Meine Daten herunterladen" (Art. 15).
create or replace function public.export_my_calendar_feed()
returns jsonb language sql stable security definer set search_path = '' as $$
  select (select jsonb_build_object('created_at', f.created_at, 'last_fetched_at', f.last_fetched_at, 'lang', f.lang)
            from public.calendar_feeds f where f.profile_id = private.require_user());
$$;

-- get_anniversary_suggestions() -> [{ occasion_id, title, starts_at, tz, all_day, cover_theme, role, host_id,
-- host_name, anniversary, days_ahead }] — see the header (2.). The app filters by the title on the device and drops
-- a suggestion when this year's occasion of the same host is already in its feed.
create or replace function public.get_anniversary_suggestions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return coalesce((
    select jsonb_agg(y.j order by y.days_ahead, y.id)
      from (
      select x.id, x.days_ahead, x.j
      from (
        select distinct on (c.host_id, c.anniversary)
               c.id, c.days_ahead,
               jsonb_build_object(
                 'occasion_id', c.id, 'title', c.title, 'starts_at', c.starts_at, 'tz', c.tz, 'all_day', c.all_day,
                 'cover_theme', c.cover_theme, 'role', c.role, 'host_id', c.host_id,
                 'host_name', (select p.display_name from public.profiles p where p.id = c.host_id),
                 'anniversary', c.anniversary, 'days_ahead', c.days_ahead) as j
          from (
            select o.id, o.title, o.starts_at, o.tz, o.all_day, o.cover_theme, o.host_id, m.role, a.anniversary,
                   (a.anniversary - a.today) as days_ahead
              from public.occasion_members m
              join public.occasions o on o.id = m.occasion_id
             cross join lateral (select (now() at time zone o.tz)::date as today) d
             cross join lateral (select d.today, private.next_anniversary((o.starts_at at time zone o.tz)::date, d.today) as anniversary) a
             where m.profile_id = v_uid and m.status = 'active' and (m.role = 'host' or m.rsvp <> 'declined')
               and o.cancelled_at is null
               and (o.cover_theme is null or o.cover_theme in ('birthday', 'none'))
               and o.starts_at < now() - interval '300 days'
               and o.starts_at > now() - interval '6 years'
               and not private.is_blocked_pair(v_uid, o.host_id)
          ) c
         where c.days_ahead between 14 and 28
         order by c.host_id, c.anniversary, c.starts_at desc, c.id
      ) x
     order by x.days_ahead, x.id
     limit 5
      ) y
  ), '[]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- 4. The feed itself (anon, through our Worker) — see the header (1.)
-- -----------------------------------------------------------------------------
create or replace function public.calendar_feed(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_row record;
begin
  if current_setting('transaction_read_only') = 'on' then raise exception using message = 'not_allowed'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then return null; end if;
  update public.calendar_feeds f
     set last_fetched_at = v_now,
         window_start = case when f.window_start > v_now - interval '1 hour' then f.window_start else v_now end,
         window_count = case when f.window_start > v_now - interval '1 hour' then least(f.window_count + 1, 1000000) else 1 end
   where f.token_hash = sha256(convert_to(p_token, 'UTF8'))
  returning f.profile_id, f.lang, f.window_count into v_row;
  if not found then return null; end if;                       -- unknown / revoked: one answer
  if v_row.window_count > 30 then return jsonb_build_object('rate_limited', true); end if;

  return jsonb_build_object('lang', v_row.lang, 'occasions', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'title', o.title, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'tz', o.tz,
             'all_day', o.all_day, 'place_text', o.place_text, 'updated_at', o.updated_at)
             order by o.starts_at, o.id)
      from (
        select o.id, o.title, o.starts_at, o.ends_at, o.tz, o.all_day, o.place_text, o.updated_at
          from public.occasion_members m
          join public.occasions o on o.id = m.occasion_id
         where m.profile_id = v_row.profile_id and m.status = 'active' and (m.role = 'host' or m.rsvp <> 'declined')
           and o.cancelled_at is null
           and not private.is_blocked_pair(v_row.profile_id, o.host_id)
           and coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) >= v_now - interval '30 days'
           and o.starts_at < v_now + interval '2 years'
         order by o.starts_at, o.id
         limit 200
      ) o), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
-- 5. Privileges: the app's RPCs for authenticated; calendar_feed for anon ONLY (the Worker's publishable key);
--    the helpers for nobody but the definer code.
-- -----------------------------------------------------------------------------
revoke execute on function
  public.create_calendar_feed(text), public.get_calendar_feed(), public.revoke_calendar_feed(),
  public.export_my_calendar_feed(), public.get_anniversary_suggestions(), public.calendar_feed(text)
  from public, anon, authenticated;
grant execute on function
  public.create_calendar_feed(text), public.get_calendar_feed(), public.revoke_calendar_feed(),
  public.export_my_calendar_feed(), public.get_anniversary_suggestions()
  to authenticated;
grant execute on function public.calendar_feed(text) to anon;

revoke execute on function private.next_anniversary(date, date), private.new_calendar_token()
  from public, anon, authenticated;
