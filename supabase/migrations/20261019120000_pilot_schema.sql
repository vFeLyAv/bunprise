-- =============================================================================
-- Bunprise pilot — 1/5: schema (helper schema `private`, tables, triggers, indexes)
-- Source of truth: docs/spec/pilot-decisions.md §1 (overrides docs/spec/data-and-secrecy.md §3).
-- Runs unchanged on Supabase Postgres (15+) and on PGlite (Postgres 18) in packages/db-tests.
-- No extensions needed: sha256(bytea) and gen_random_uuid() are built in.
-- Privileges on tables are handled in 20261019120100_pilot_rls.sql, on RPCs in 20261019120200_pilot_rpc.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. schema `private`: helper functions that policies and RPCs call.
--    Never added to the Data API "exposed schemas", so PostgREST cannot reach it.
--    `authenticated` needs USAGE because RLS policies run as the caller and call private.*;
--    `anon` gets nothing.
--    The helpers take (occasion, profile) arguments, so with SQL access as `authenticated` they would answer
--    "is X a member of Y / did X say going / are X and Y blocked / has X consented" for ANY X and Y.
--    That access does not exist on Supabase (PostgREST only serves exposed schemas) — keeping `private`
--    out of the exposed schemas is therefore a hard rule (supabase/README.md checklist), not a nicety.
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- profiles: 1:1 to auth.users. No birthday, no gender. E-mail stays in auth.users only.
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  display_name       text check (display_name is null or (
                       display_name = btrim(display_name)
                       and length(display_name) between 1 and 40
                       and display_name !~ '[\n\r\t]')),
  locale             text not null default 'de' check (locale in ('de', 'en')),
  onboarding_done_at timestamptz,            -- pilot-decisions §1: onboarding finished (client sets once)
  last_seen_at       date,                   -- pilot-decisions §1: client updates ≤ once a day (mentioned in DSE)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.profiles is 'Public part of an account. E-mail lives only in auth.users.';

-- legal_versions / consents: which text version was accepted and when.
create table public.legal_versions (
  kind         text primary key check (kind in ('terms', 'privacy', 'age_18plus')),
  version      text not null check (length(version) between 1 and 40),
  published_at timestamptz not null default now()
);
comment on table public.legal_versions is 'One row per kind = the current version. Changed only by migrations (see 20261019120300_legal_versions_seed.sql).';

create table public.consents (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('terms', 'privacy', 'age_18plus')),
  version     text not null,
  locale      text not null check (locale in ('de', 'en')),   -- language the person read the text in
  accepted_at timestamptz not null default now(),
  primary key (profile_id, kind, version)
);
comment on table public.consents is 'Consent log: insert only, never update/delete. age_18plus = "I confirm I am 18+".';

-- occasions: birthday, wedding, ... Limits = client limits (pilot-decisions §7).
create table public.occasions (
  id           uuid primary key default gen_random_uuid(),      -- client may supply its own uuid v4
  host_id      uuid not null references public.profiles(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 80),
  starts_at    timestamptz not null,
  ends_at      timestamptz check (ends_at is null or ends_at > starts_at),   -- not used by the pilot UI
  tz           text not null default 'Europe/Berlin' check (length(tz) between 1 and 64),
  all_day      boolean not null default true,
  place_text   text check (place_text is null or length(place_text) <= 200),   -- public part: "bei mir zu Hause"
  description  text check (description is null or length(description) <= 500),
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index occasions_host_idx   on public.occasions (host_id);
create index occasions_starts_idx on public.occasions (starts_at);

-- occasion_addresses: exact address (host + rsvp = going). Groundwork, not used by the pilot UI.
create table public.occasion_addresses (
  occasion_id uuid primary key references public.occasions(id) on delete cascade,
  address     text not null check (length(btrim(address)) between 1 and 300),
  updated_at  timestamptz not null default now()
);

-- invites: invite link; only the sha256 of the token is stored.
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  occasion_id uuid not null references public.occasions(id) on delete cascade,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  token_hash  bytea not null unique check (length(token_hash) = 32),   -- sha256(token)
  expires_at  timestamptz not null,
  max_uses    integer not null default 50 check (max_uses between 1 and 100),
  use_count   integer not null default 0 check (use_count >= 0),
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index invites_occasion_idx on public.invites (occasion_id);

-- occasion_members: who is in an occasion, role, RSVP, status.
create table public.occasion_members (
  occasion_id uuid not null references public.occasions(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member' check (role in ('host', 'member')),
  rsvp        text not null default 'none' check (rsvp in ('none', 'going', 'maybe', 'declined')),
  status      text not null default 'active' check (status in ('active', 'left', 'removed')),
  invited_via uuid references public.invites(id) on delete set null,
  joined_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (occasion_id, profile_id),
  check (role <> 'host' or status = 'active')          -- the host cannot leave; they delete the occasion
);
create unique index occasion_members_one_host on public.occasion_members (occasion_id) where role = 'host';
-- feed index: "my active memberships" → occasions (performance-plan §3.6 translated to this schema)
create index occasion_members_feed_idx on public.occasion_members (profile_id, occasion_id) where status = 'active';

-- wishlists: owner maintains the list, recipient receives the gifts (pilot: same person, one list per occasion).
create table public.wishlists (
  id           uuid primary key default gen_random_uuid(),
  occasion_id  uuid not null references public.occasions(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title        text check (title is null or length(btrim(title)) between 1 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (occasion_id, owner_id)
);
create index wishlists_owner_idx on public.wishlists (owner_id);

-- wishes: manual wish (title, price, link, note, priority). No `position` column (pilot-decisions §1).
create table public.wishes (
  id          uuid primary key default gen_random_uuid(),
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  title       text not null check (length(btrim(title)) between 1 and 120),
  price_cents integer check (price_cents is null or price_cents between 0 and 100000000),
  currency    char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  url         text check (url is null or (length(url) <= 2048 and url ~* '^https?://[^\s]+$')),
  note        text check (note is null or length(note) <= 500),
  priority    smallint not null default 2 check (priority between 1 and 3),   -- 1 = Kann, 2 = Gern, 3 = Unbedingt
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- the one ordering every role gets: priority desc, created_at asc
create index wishes_list_idx on public.wishes (wishlist_id, priority desc, created_at);
comment on column public.wishes.url is 'http/https only. Link previews = separate Worker (SSRF checklist), not in the pilot.';

-- reservations: THE SECRET. Own table; owner/recipient never read a row of it (not even through REST — no grants at all).
create table public.reservations (
  id                  uuid primary key default gen_random_uuid(),
  wish_id             uuid references public.wishes(id) on delete set null,       -- set null, not restrict (P6)
  wishlist_id         uuid references public.wishlists(id) on delete set null,
  recipient_id        uuid not null references public.profiles(id) on delete cascade, -- gift receiver (copied from the list)
  reserver_id         uuid not null references public.profiles(id) on delete cascade, -- who reserves
  status              text not null default 'active' check (status in ('active', 'ended')),
  end_reason          text check (end_reason is null or end_reason in
                        ('by_reserver', 'member_removed', 'member_left', 'blocked', 'wish_deleted')),
  wish_title_snapshot text not null,                       -- the reserver still sees "what" after the wish is deleted
  created_at          timestamptz not null default now(),
  ended_at            timestamptz,
  check (reserver_id <> recipient_id),
  check ((status = 'active') = (ended_at is null)),
  check ((status = 'active') = (end_reason is null)),
  check (status <> 'active' or wish_id is not null)
);
-- ONE active reservation per wish: the rule lives in the database, not in the app.
create unique index reservations_one_active_per_wish on public.reservations (wish_id) where status = 'active';
create index reservations_reserver_idx on public.reservations (reserver_id, status);
create index reservations_wishlist_idx on public.reservations (wishlist_id) where status = 'active';
comment on table public.reservations is 'No trigger/FK ever writes back into wishes (P5). Read only through get_occasion_screen() / my_reservations().';

-- blocks / reports: groundwork (no "Blockieren" in the pilot UI; "Melden" = mailto).
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_kind text not null check (target_kind in ('profile', 'occasion', 'wish')),
  target_id   uuid not null,
  reason      text not null check (length(btrim(reason)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  outcome     text check (outcome is null or length(outcome) <= 1000)
);
create index reports_open_idx on public.reports (created_at) where handled_at is null;

-- -----------------------------------------------------------------------------
-- 2. Helper functions (P3/P4: security definer, stable, search_path pinned, names qualified).
--    Created after the tables: SQL-language bodies are validated against the catalog at creation time.
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Who am I? Raises when there is no session (RPCs call this first).
create or replace function private.require_user()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception using message = 'not_authenticated'; end if;
  return v_uid;
end $$;

create or replace function private.is_active_member(p_occasion uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.occasion_members m
    where m.occasion_id = p_occasion and m.profile_id = p_uid and m.status = 'active');
$$;

create or replace function private.is_going_member(p_occasion uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.occasion_members m
    where m.occasion_id = p_occasion and m.profile_id = p_uid and m.status = 'active' and m.rsvp = 'going');
$$;

create or replace function private.is_host(p_occasion uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.occasions o where o.id = p_occasion and o.host_id = p_uid);
$$;

create or replace function private.is_blocked_pair(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = p_a and b.blocked_id = p_b) or (b.blocker_id = p_b and b.blocked_id = p_a));
$$;

-- All current legal texts accepted (terms, privacy, age_18plus) — one row per kind in legal_versions.
create or replace function private.has_consents(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_uid is not null and not exists (
    select 1 from public.legal_versions lv
    where not exists (
      select 1 from public.consents c
      where c.profile_id = p_uid and c.kind = lv.kind and c.version = lv.version));
$$;

-- display_name set (G-34): required to create an occasion / list and to accept an invite.
create or replace function private.profile_complete(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_uid and p.display_name is not null);
$$;

create or replace function private.can_read_wishlist(p_wishlist uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wishlists wl
    join public.occasion_members m on m.occasion_id = wl.occasion_id
    where wl.id = p_wishlist and m.profile_id = p_uid and m.status = 'active'
      and not private.is_blocked_pair(p_uid, wl.owner_id));
$$;

create or replace function private.is_wishlist_owner(p_wishlist uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wishlists wl where wl.id = p_wishlist and wl.owner_id = p_uid);
$$;

-- Pilot: exactly one wishlist per occasion (pilot-decisions §1).
create or replace function private.occasion_has_wishlist(p_occasion uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wishlists wl where wl.occasion_id = p_occasion);
$$;

create or replace function private.shares_occasion(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.occasion_members a
    join public.occasion_members b on b.occasion_id = a.occasion_id
    where a.profile_id = p_a and b.profile_id = p_b and a.status = 'active' and b.status = 'active');
$$;

-- -----------------------------------------------------------------------------
-- 3. Triggers
-- -----------------------------------------------------------------------------
create trigger set_updated_at before update on public.profiles           for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.occasions          for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.occasion_addresses for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.occasion_members   for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.wishlists          for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.wishes             for each row execute function private.set_updated_at();

-- Profile is created together with the account; only the name is taken from Google metadata.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  v_name := nullif(btrim(left(btrim(regexp_replace(
              coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
              '[\n\r\t]', ' ', 'g')), 40)), '');
  insert into public.profiles (id, display_name)
  values (new.id, v_name)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- The host becomes a member of their own occasion (role host, rsvp going) and gets THE wishlist
-- (owner = recipient = host, title = occasion title). pilot-decisions §1: one list per occasion.
create or replace function private.occasion_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.occasion_members (occasion_id, profile_id, role, rsvp, status)
  values (new.id, new.host_id, 'host', 'going', 'active');
  insert into public.wishlists (occasion_id, owner_id, recipient_id, title)
  values (new.id, new.host_id, new.host_id, new.title);
  return new;
end $$;
create trigger occasion_after_insert after insert on public.occasions
  for each row execute function private.occasion_after_insert();

-- host_id is immutable; the time zone must exist.
create or replace function private.occasion_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.host_id <> old.host_id then
    raise exception using message = 'not_allowed';
  end if;
  begin
    perform now() at time zone new.tz;          -- unknown zone → error
  exception when others then
    raise exception using message = 'invalid_timezone';
  end;
  return new;
end $$;
create trigger occasion_guard before insert or update on public.occasions
  for each row execute function private.occasion_guard();

-- wishlist: owner / recipient / occasion are immutable (changing the recipient would reveal reservations).
create or replace function private.wishlist_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.owner_id <> old.owner_id or new.recipient_id <> old.recipient_id or new.occasion_id <> old.occasion_id then
    raise exception using message = 'not_allowed';
  end if;
  return new;
end $$;
create trigger wishlist_guard before update on public.wishlists
  for each row execute function private.wishlist_guard();

-- a wish cannot move to another list
create or replace function private.wish_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.wishlist_id <> old.wishlist_id then raise exception using message = 'not_allowed'; end if;
  return new;
end $$;
create trigger wish_guard before update on public.wishes
  for each row execute function private.wish_guard();

-- DELETING A WISH (hard delete through REST): the active reservation ends with 'wish_deleted'.
-- security definer because the owner who deletes has no privileges on reservations at all.
create or replace function private.wish_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.reservations r
     set status = 'ended', end_reason = 'wish_deleted', ended_at = now(), wish_id = null
   where r.wish_id = old.id and r.status = 'active';
  return old;
end $$;
create trigger wish_before_delete before delete on public.wishes
  for each row execute function private.wish_before_delete();

-- invite: revocation is irreversible
create or replace function private.invite_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception using message = 'not_allowed';
  end if;
  return new;
end $$;
create trigger invite_guard before update on public.invites
  for each row execute function private.invite_guard();

-- reservation: only active → ended; parties immutable; wish_id can only become null (safety net; only RPCs write here)
create or replace function private.reservation_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reserver_id <> old.reserver_id or new.recipient_id <> old.recipient_id then raise exception using message = 'not_allowed'; end if;
  if old.status <> 'active' and new.status <> old.status then raise exception using message = 'not_allowed'; end if;
  if new.wish_id is not null and new.wish_id is distinct from old.wish_id then raise exception using message = 'not_allowed'; end if;
  return new;
end $$;
create trigger reservation_guard before update on public.reservations
  for each row execute function private.reservation_guard();

-- -----------------------------------------------------------------------------
-- 4. Privileges on private.* functions.
--    Postgres grants EXECUTE to PUBLIC on every new function, and per-schema default privileges
--    cannot take that away (they are merged with the built-in default) → revoke explicitly here
--    and again at the end of every migration that adds functions.
--    Policies run as `authenticated`, so the helpers they use are granted to it.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.is_active_member(uuid, uuid), private.is_going_member(uuid, uuid), private.is_host(uuid, uuid),
  private.is_blocked_pair(uuid, uuid), private.has_consents(uuid), private.profile_complete(uuid),
  private.can_read_wishlist(uuid, uuid), private.is_wishlist_owner(uuid, uuid),
  private.occasion_has_wishlist(uuid), private.shares_occasion(uuid, uuid),
  -- trigger functions (EXECUTE is checked when the trigger is created; granting is a safety net,
  -- calling them directly fails with "trigger functions can only be called as triggers")
  private.set_updated_at(), private.occasion_guard(), private.wishlist_guard(), private.wish_guard(),
  private.invite_guard(), private.reservation_guard()
  to authenticated;
