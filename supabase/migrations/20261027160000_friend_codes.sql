-- =============================================================================
-- Bunprise — short FRIEND CODES: "Mein Code" (a QR + K7M4-QX2P), "Code eingeben". docs/spec/add-friends-design.md
-- §2–§4 (Russian; Codex review recorded there). Still no people search: a code only lets somebody ASK to follow,
-- exactly like a follow link (follows-design §00 p. 3); the request waits for "Annehmen".
-- Forward only. NOT applied to the hosted project: `supabase db push` only after Felix's OK.
--
-- Tables (both RPC-ONLY like follow_links: no privilege of any kind for anon / authenticated / PUBLIC, RLS enabled +
-- forced and NOT ONE policy = deny everything; only the security definer functions below read them):
--   friend_codes        8 characters Crockford Base32 (0-9 A-Z without I L O U) = 40 bits; only sha256 of the
--                       canonical code is stored; 24 hours; at most 3 live per owner (a new one switches the oldest
--                       off; "Neuer Code" switches all off first); at most 20 NEW requests per code (use_count).
--   friend_code_misses  the caller's FAILED lookups (time only — never the guessed code): 10 per hour, 30 per 24 hours,
--                       then 'rate_limited'. Purged after a day.
--
-- RPCs (exact jsonb keys; the client: apps/web/src/lib/api/follows.ts):
--   create_friend_code(p_replace boolean)  -> { code, expires_at }        shown ONCE
--   peek_friend_code(p_code text)          -> { profile, relation{self, i_follow} } | { invalid: true }
--   request_follow_via_code(p_code text)   -> { status, profile_id } | { invalid: true }
--   revoke_friend_codes()                  -> { ok: true }
--   changed: revoke_follow_links() switches the codes off too ("Alle Links deaktivieren", the block sheet's switch);
--            private.my_follows_export() + friend_codes[], friend_code_misses[] (export_my_data -> follows).
--
-- Brute force / enumeration (design §4): one answer for everything that does not work — unknown, malformed,
-- expired, revoked, full, a block in either direction — and that answer is a VALUE ({ invalid: true }), not an
-- exception: an exception would roll the miss back. The limit is checked BEFORE the lookup, so a caller over it
-- gets 'rate_limited' for right and wrong codes alike. A read-only transaction is refused before anything else
-- (Codex review 27.10, high): PostgREST runs GET/HEAD calls read-only, where a miss cannot be written — a GET would
-- be an unlimited oracle. One caller's attempts queue on a dedicated advisory lock (parallel calls cannot slip past
-- the count). Lock order of a request: that advisory lock -> private.lock_profile_pair -> the code row.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table public.friend_codes (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  code_hash  bytea not null unique check (length(code_hash) = 32),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  use_count  integer not null default 0 check (use_count between 0 and 20),   -- only the number; never WHO asked
  check (expires_at > created_at)
);
create index friend_codes_owner_live_idx on public.friend_codes (owner_id, created_at) where revoked_at is null;
comment on table public.friend_codes is
  'Short friend codes ("Mein Code"): only sha256 of the canonical code, 24 h, <= 3 live per owner, <= 20 new requests. RPC-only. A code only lets somebody ASK to follow.';

create table public.friend_code_misses (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  missed_at  timestamptz not null default clock_timestamp()
);
create index friend_code_misses_idx on public.friend_code_misses (profile_id, missed_at);
comment on table public.friend_code_misses is
  'Failed friend-code lookups of the caller (time only, never the code): the limit 10 / hour, 30 / 24 h. Purged after a day; deleted with the account. RPC-only.';

revoke all on public.friend_codes, public.friend_code_misses from public, anon, authenticated;
alter table public.friend_codes       enable row level security;  alter table public.friend_codes       force row level security;
alter table public.friend_code_misses enable row level security;  alter table public.friend_code_misses force row level security;

-- -----------------------------------------------------------------------------
-- 2. Helpers (definer code only)
-- -----------------------------------------------------------------------------

-- What a person typed (or a QR carried) -> the canonical code, or null when it cannot be one. Forgiving like the
-- client (apps/web/src/lib/friendCode.ts): case, spaces and dashes do not matter, I and L read as 1, O as 0.
create or replace function private.normalize_friend_code(p_code text)
returns text language sql immutable set search_path = '' as $$
  select case
           when p_code is null or length(p_code) > 32 then null
           else nullif(translate(upper(regexp_replace(p_code, '[[:space:]-]+', '', 'g')), 'ILO', '110'), '')
         end;
$$;

-- The shared start of both lookups: a read-write transaction (see the header), the caller's own queue, the limits.
create or replace function private.friend_code_gate(p_uid uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if current_setting('transaction_read_only') = 'on' then raise exception using message = 'not_allowed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bunprise.friend-code-attempts:' || p_uid::text, 0));
  if (select count(*) from public.friend_code_misses m
       where m.profile_id = p_uid and m.missed_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.friend_code_misses m
          where m.profile_id = p_uid and m.missed_at > now() - interval '24 hours') >= 30 then
    raise exception using message = 'rate_limited';
  end if;
end $$;

-- The owner of a live code the caller may use, else null: malformed, unknown, expired, revoked, full (only for a
-- newcomer: the owner and somebody with a live relation still see it, like follow links), a block either way.
create or replace function private.friend_code_owner(p_uid uuid, p_code text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_code text := private.normalize_friend_code(p_code); v_owner uuid;
begin
  if v_code is null or v_code !~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$' then return null; end if;
  select c.owner_id into v_owner from public.friend_codes c
   where c.code_hash = sha256(convert_to(v_code, 'UTF8')) and c.revoked_at is null and c.expires_at > now()
     and (c.use_count < 20 or c.owner_id = p_uid or private.i_follow_state(p_uid, c.owner_id) <> 'none');
  if not found or private.is_blocked_pair(p_uid, v_owner) then return null; end if;
  return v_owner;
end $$;

-- -----------------------------------------------------------------------------
-- 3. RPCs
-- -----------------------------------------------------------------------------

-- create_friend_code(p_replace) -> { code, expires_at }: shown ONCE (only its sha256 is stored). At most 3 live codes:
-- the newest 2 stay and the new one joins them; p_replace ("Neuer Code") switches every live one off first. The
-- owner's own dead rows go at once (the daily purge would remove them anyway). 40 random bits from gen_random_uuid()
-- (the first 10 hex characters of a v4 UUID are random), no pgcrypto.
create or replace function public.create_friend_code(p_replace boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_exp   timestamptz := now() + interval '24 hours';
  v_num   bigint;
  v_code  text;
  v_tries integer := 0;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  perform private.lock_profile_pair(v_uid, v_uid);      -- two tabs queue here
  delete from public.friend_codes c where c.owner_id = v_uid and (c.revoked_at is not null or c.expires_at <= now());
  update public.friend_codes set revoked_at = now()
   where id in (select c.id from public.friend_codes c
                 where c.owner_id = v_uid and c.revoked_at is null and c.expires_at > now()
                 order by c.created_at desc, c.id desc offset case when coalesce(p_replace, false) then 0 else 2 end);
  loop
    v_num := ('x' || lpad(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), 16, '0'))::bit(64)::bigint;
    v_code := '';
    for i in reverse 7..0 loop
      v_code := v_code || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((v_num >> (5 * i)) & 31)::integer + 1, 1);
    end loop;
    begin
      insert into public.friend_codes (owner_id, code_hash, created_at, expires_at)
      values (v_uid, sha256(convert_to(v_code, 'UTF8')), clock_timestamp(), v_exp);
      exit;
    exception when unique_violation then     -- the same 40 bits as another row (dead or alive): draw again
      v_tries := v_tries + 1;
      if v_tries >= 5 then raise; end if;
    end;
  end loop;
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;

-- peek_friend_code(p_code): who is behind a live code — the same answer as peek_follow_link (banner, avatar, name,
-- my relation). Order: consents -> name -> gate (read-write, queue, limit) -> lookup. Writes nothing but a miss.
create or replace function public.peek_friend_code(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_owner uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  perform private.friend_code_gate(v_uid);
  v_owner := private.friend_code_owner(v_uid, p_code);
  if v_owner is null then
    insert into public.friend_code_misses (profile_id) values (v_uid);
    return jsonb_build_object('invalid', true);
  end if;
  return jsonb_build_object('profile', private.profile_card(v_owner),
    'relation', jsonb_build_object('self', v_owner = v_uid, 'i_follow', private.i_follow_state(v_uid, v_owner)));
end $$;

-- request_follow_via_code(p_code) -> { status, profile_id }: "Folgen anfragen" after a code. Like
-- request_follow_via_link: find the owner without a lock -> lock the pair -> re-check the code row under its lock.
-- A miss is recorded (a value, not an exception); the own code and a code that died while we waited are the same
-- one answer without a miss (nobody guessed). A new request takes one of the code's 20 places; the same person
-- again does not; limit_reached (30 open requests) rolls the +1 back.
create or replace function public.request_follow_via_code(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_owner uuid; v_row record;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  perform private.friend_code_gate(v_uid);
  v_owner := private.friend_code_owner(v_uid, p_code);
  if v_owner is null then
    insert into public.friend_code_misses (profile_id) values (v_uid);
    return jsonb_build_object('invalid', true);
  end if;
  if v_owner = v_uid then return jsonb_build_object('invalid', true); end if;   -- my own code: nothing to ask
  perform private.lock_profile_pair(v_uid, v_owner);
  select c.id, c.owner_id, c.revoked_at, c.expires_at, c.use_count into v_row from public.friend_codes c
   where c.code_hash = sha256(convert_to(private.normalize_friend_code(p_code), 'UTF8')) for update;
  if not found or v_row.owner_id <> v_owner or v_row.revoked_at is not null or v_row.expires_at <= now()
     or private.is_blocked_pair(v_uid, v_owner) then
    return jsonb_build_object('invalid', true);         -- it died while we waited: one answer
  end if;
  if private.i_follow_state(v_uid, v_owner) = 'none' then
    if v_row.use_count >= 20 then return jsonb_build_object('invalid', true); end if;   -- the code is full
    update public.friend_codes set use_count = use_count + 1 where id = v_row.id;
  end if;
  return private.make_follow_request(v_uid, v_owner) || jsonb_build_object('profile_id', v_owner);
end $$;

-- revoke_friend_codes() -> { ok: true }: switches off every live code of mine (no consents: it narrows).
create or replace function public.revoke_friend_codes()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  update public.friend_codes set revoked_at = now() where owner_id = v_uid and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- revoke_follow_links() (20261020200100) + the codes: "Alle Links deaktivieren" and the block sheet's switch
-- "Auch alle meine Folgen-Links deaktivieren" (otherwise a second account of a blocked person comes back by code).
create or replace function public.revoke_follow_links()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  update public.follow_links set revoked_at = now() where owner_id = v_uid and revoked_at is null;
  update public.friend_codes set revoked_at = now() where owner_id = v_uid and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Export: private.my_follows_export() (20261020200100) + friend_codes[{created_at, expires_at, revoked_at,
--    use_count}] (never the hash) + friend_code_misses[{missed_at}] — my own data (Art. 15).
-- -----------------------------------------------------------------------------
create or replace function private.my_follows_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'following', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'display_name', p.display_name,
               'status', case when f.status = 'accepted' then 'accepted' else 'requested' end,
               'requested_at', f.requested_at, 'accepted_at', f.accepted_at, 'expires_at', f.expires_at)
               order by f.requested_at, f.followee_id), '[]'::jsonb)
        from public.follows f join public.profiles p on p.id = f.followee_id
       where f.follower_id = auth.uid() and (f.status = 'accepted' or f.expires_at > now())),
    'followers', (
      select coalesce(jsonb_agg(jsonb_build_object('display_name', p.display_name, 'accepted_at', f.accepted_at)
               order by f.accepted_at, f.follower_id), '[]'::jsonb)
        from public.follows f join public.profiles p on p.id = f.follower_id
       where f.followee_id = auth.uid() and f.status = 'accepted'),
    'requests_received', (
      select coalesce(jsonb_agg(jsonb_build_object('display_name', p.display_name, 'requested_at', f.requested_at)
               order by f.requested_at, f.follower_id), '[]'::jsonb)
        from public.follows f join public.profiles p on p.id = f.follower_id
       where f.followee_id = auth.uid() and private.visible_request(f.follower_id, auth.uid())),
    'hidden_requests_received', (
      select coalesce(jsonb_agg(jsonb_build_object('display_name', p.display_name, 'requested_at', f.requested_at)
               order by f.requested_at, f.follower_id), '[]'::jsonb)
        from public.follows f join public.profiles p on p.id = f.follower_id
       where f.followee_id = auth.uid() and f.status = 'pending' and f.expires_at > now()
         and private.has_follow_cooldown(auth.uid(), f.follower_id)
         and not private.is_blocked_pair(auth.uid(), f.follower_id)),
    'hidden_requesters', (
      select coalesce(jsonb_agg(jsonb_build_object('display_name', p.display_name, 'until', c.until)
               order by c.until, c.follower_id), '[]'::jsonb)
        from public.follow_cooldowns c join public.profiles p on p.id = c.follower_id
       where c.followee_id = auth.uid()),
    'follow_links', (
      select coalesce(jsonb_agg(jsonb_build_object('created_at', l.created_at, 'expires_at', l.expires_at,
                                                   'revoked_at', l.revoked_at, 'use_count', l.use_count)
               order by l.created_at, l.id), '[]'::jsonb)
        from public.follow_links l
       where l.owner_id = auth.uid()),
    'friend_codes', (
      select coalesce(jsonb_agg(jsonb_build_object('created_at', c.created_at, 'expires_at', c.expires_at,
                                                   'revoked_at', c.revoked_at, 'use_count', c.use_count)
               order by c.created_at, c.id), '[]'::jsonb)
        from public.friend_codes c
       where c.owner_id = auth.uid()),
    'friend_code_misses', (
      select coalesce(jsonb_agg(jsonb_build_object('missed_at', m.missed_at) order by m.missed_at), '[]'::jsonb)
        from public.friend_code_misses m
       where m.profile_id = auth.uid()));
$$;

-- -----------------------------------------------------------------------------
-- 5. Retention: its own daily job (like private.purge_invitations). Rows a running RPC holds are skipped (SKIP
--    LOCKED): the job never waits, so it is never part of a deadlock; what it skips today it removes tomorrow.
-- -----------------------------------------------------------------------------
create or replace function private.purge_friend_codes()
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.friend_codes c
   where c.id in (select x.id from public.friend_codes x
                   where x.revoked_at is not null or x.expires_at < now() for update skip locked);
  delete from public.friend_code_misses m where m.missed_at < now() - interval '24 hours';
$$;

do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable - friend code retention scheduling skipped (expected on PGlite)';
    return;
  end if;
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute $cmd$select cron.unschedule(jobid) from cron.job where jobname = 'bunprise_purge_friend_codes'$cmd$;
  execute $cmd$select cron.schedule('bunprise_purge_friend_codes', '53 3 * * *', 'select private.purge_friend_codes()')$cmd$;
end
$cron$;

-- -----------------------------------------------------------------------------
-- 6. Privileges: the new RPCs for authenticated only; every helper for nobody but the definer code (CREATE OR
--    REPLACE keeps the grants of revoke_follow_links and my_follows_export).
-- -----------------------------------------------------------------------------
revoke execute on function
  public.create_friend_code(boolean), public.peek_friend_code(text), public.request_follow_via_code(text),
  public.revoke_friend_codes()
  from public, anon;
grant execute on function
  public.create_friend_code(boolean), public.peek_friend_code(text), public.request_follow_via_code(text),
  public.revoke_friend_codes()
  to authenticated;

revoke execute on all functions in schema private from public, anon;
revoke execute on function
  private.normalize_friend_code(text), private.friend_code_gate(uuid), private.friend_code_owner(uuid, text),
  private.purge_friend_codes()
  from authenticated;
