-- =============================================================================
-- Bunprise wave 2b — M2 (agent J1): FOLLOWS — one-way, always approved by the person who is followed — the
-- "silence" after a refusal, personal follow links, and block_user for the new relations. Follows do NOT open
-- any list yet: M3 (20261020200200_follow_sharing.sql) adds the visibility 'followers'.
-- Spec: docs/spec/follows-design.md v1.2 (§00 wins over the rest), §3.3, §4.3, §5.2–§5.4; pilot-decisions §000 (v1.3).
-- Forward only. NOT applied to the hosted project: `supabase db push` only after Felix's OK, and only together
-- with the checked pilot-2 legal texts (follows-design §00 item 8).
--
-- Tables (all three RPC-ONLY, like reservations: no privilege of any kind for anon / authenticated / PUBLIC,
-- RLS enabled + forced and NOT ONE policy = deny everything; only the security definer functions below read them):
--   follows          follower_id -> followee_id, pending (expires after 30 days) | accepted. No "source" (link /
--                    occasion) is stored, no "read" flag.
--   follow_cooldowns the followee hid the follower's requests until `until` (30 days after a refusal or a removal).
--                    The requester never sees it: no answer to a user U ever reads a row whose followee is not U.
--                    `until` only grows (greatest() in both upserts); only the daily purge after `until` and the
--                    account cascade remove a row — block / unblock / withdraw / re-request never touch it (INV-6).
--   follow_links     https://<app>/f#<64 hex>: only sha256(code); 30 days; at most 5 live per owner (create_follow_link,
--                    under the owner's profile lock); at most 20 NEW requests per link (a brake when the link was
--                    forwarded into a big chat) — only the number is kept, never WHO asked.
--
-- Who sees a relation ("the relation through the viewer's eyes", INV-3 / INV-3b, follows-design §3.3 / §5.2): the same
-- helpers compute every answer — my OWN outgoing rows always (pending = silently refused: that is the cloak), an
-- incoming row only when it is accepted or a request that is VISIBLE to me (not expired, not hidden by MY silence,
-- no block). Hidden requests count nowhere (badge, people screen, cards, overview); the only deliberate exception is
-- the hider's own export (hidden_requests_received, Art. 15 — and follow_links[].use_count there, which counts every
-- NEW request through the link, a hidden one included; no screen shows use_count).
--
-- Also in this step (review #1 of v1.0): the REST policy occasion_members_select hides the ACTIVE rows of a blocked
-- pair from each other in other people's occasions (the occasion screen RPC already did). Only active rows: a guest
-- who blocked the host still reads as 'left' for the host, exactly like a voluntary exit (pilot: block looks like
-- leaving). And two neutral end reasons for reservations: access_ended (the list is not visible any more — removed
-- as follower, list hidden, blocked by the owner: ONE reason for all), unfollowed (the reserver stopped following).
--
-- RPCs of this step (exact jsonb keys in the report of agent J1 / follows-design §5.2–§5.3):
--   request_follow(p_profile_id uuid)            -> { status: 'requested' | 'following' }
--   request_follow_via_link(p_token text)        -> { status, profile_id }
--   peek_follow_link(p_token text)               -> { profile{id, display_name, banner}, relation{self, i_follow} }
--   respond_follow(p_profile_id uuid, p_accept boolean) -> { ok: true }
--   unfollow(p_profile_id uuid)                  -> { ok: true }   (also withdraws a pending request; idempotent)
--   remove_follower(p_profile_id uuid)           -> { ok: true }
--   create_follow_link()                         -> { token, expires_at }
--   revoke_follow_links()                        -> { ok: true }
--   get_profile_card(p_profile_id uuid)          -> { profile, relation{self, i_follow, follows_me, mutual}, can_request,
--                                                     can_find_gift, lists, shared_occasions[{id, title, starts_at}] }
--                                                   (lists = [] and can_find_gift = false until M3 / M4)
--   get_people_screen()                          -> { requests_in, requests_out, followers, following, blocked, links }
--   changed: block_user (follows end both ways; silence untouched), get_me (+ inbox.follow_requests),
--            get_lists_overview (+ me.live_links, stats.followers / following / requests), export_my_data (+ follows),
--            private.purge_expired_records (+ expired requests, silences, revoked / expired links).
-- Error codes: the pilot's + 'limit_reached' (only the caller's own limit: 30 open requests). Every failure of a
-- follow link, a full link included, is the existing 'invite_invalid'. "Narrowing" actions (unfollow, withdraw,
-- remove follower, refuse, block, revoke links, export) never need current consents.
-- Lock order of every write "between people" (pilot rule): private.lock_profile_pair(a, b) FIRST, then the access
-- row (membership / follow), the list, the wish, the reservations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
create table public.follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  followee_id  uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  requested_at timestamptz not null default now(),
  expires_at   timestamptz,              -- only while pending: requested_at + 30 days, then the daily purge
  accepted_at  timestamptz,
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id),
  check ((status = 'pending')  = (expires_at  is not null)),
  check ((status = 'accepted') = (accepted_at is not null))
);
create index follows_followee_idx       on public.follows (followee_id, status);
create index follows_pending_expiry_idx on public.follows (expires_at) where status = 'pending';
comment on table public.follows is 'One-way, approval-based. RPC-only. No source ("via link / via occasion") is stored.';

-- "Silence" after a refusal or a removal: requests of follower_id are not shown to followee_id until `until`.
-- The requester never sees it: none of their answers reads this table.
create table public.follow_cooldowns (
  followee_id uuid not null references public.profiles(id) on delete cascade,
  follower_id uuid not null references public.profiles(id) on delete cascade,
  until       timestamptz not null,        -- now() + 30 days; only grows
  primary key (followee_id, follower_id),
  check (followee_id <> follower_id)
);
create index follow_cooldowns_until_idx on public.follow_cooldowns (until);
comment on table public.follow_cooldowns is 'Hidden requests: followee hid follower until `until`. RPC-only; read only for the followee. Removed only by the daily purge and the account cascade (INV-6).';

-- Link https://<app>/f#<64 hex>: only sha256(code); 30 days; at most 5 live (create_follow_link under the lock);
-- at most 20 NEW requests, like max_uses of invites (a brake when the link was forwarded into a big chat)
create table public.follow_links (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  token_hash bytea not null unique check (length(token_hash) = 32),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  use_count  integer not null default 0 check (use_count between 0 and 20),   -- only the number; never WHO asked
  check (expires_at > created_at)
);
create index follow_links_owner_live_idx on public.follow_links (owner_id, created_at) where revoked_at is null;
comment on table public.follow_links is 'Personal follow links: only sha256 of the code. RPC-only. A link only lets somebody ASK to follow.';

-- RPC only: RLS enabled and forced, NOT ONE privilege and NOT ONE policy (deny by default)
revoke all on public.follows, public.follow_cooldowns, public.follow_links from public, anon, authenticated;
alter table public.follows          enable row level security;  alter table public.follows          force row level security;
alter table public.follow_cooldowns enable row level security;  alter table public.follow_cooldowns force row level security;
alter table public.follow_links     enable row level security;  alter table public.follow_links     force row level security;

-- -----------------------------------------------------------------------------
-- 2. Blocks and other people's occasions (review #1, in THIS migration — together with blocking in the UI).
--    The pilot policy (20261019120100_pilot_rls.sql:135–138) served the membership rows of a blocked pair through
--    REST (profile_id, rsvp, updated_at …) although the occasion screen RPC already hid them. The filter is on
--    ACTIVE rows only: the host still sees "left / removed" rows as before — otherwise a guest who blocked the host
--    would vanish from the host's list instead of reading as 'left', and the pilot deliberately makes a block look
--    like leaving (20261019120200_pilot_rpc.sql:389–392). The host's export (invoker) does not change: active rows
--    of a pair blocked with the host do not exist in the host's own occasions.
-- -----------------------------------------------------------------------------
drop policy occasion_members_select on public.occasion_members;
create policy occasion_members_select on public.occasion_members for select to authenticated
  using (profile_id = (select auth.uid())
         or (private.is_active_member(occasion_id, (select auth.uid()))
             and ((status = 'active' and not private.is_blocked_pair(profile_id, (select auth.uid())))
                  or (status <> 'active' and private.is_host(occasion_id, (select auth.uid()))))));
-- profiles_select already hides a blocked pair (20261019120100_pilot_rls.sql:69–72); now REST occasion_members too.
-- In somebody else's occasion both stay guests and see the occasion itself, but not each other.

-- Reasons a reservation ends, neutral for the reserver. (The constraint name is the one Postgres gives a column CHECK.)
alter table public.reservations drop constraint reservations_end_reason_check;
alter table public.reservations add constraint reservations_end_reason_check check (end_reason is null or end_reason in
  ('by_reserver', 'member_removed', 'member_left', 'blocked', 'wish_deleted',
   'access_ended',   -- the list is not visible to you any more: removed as follower, list hidden, blocked by the owner (ONE reason)
   'unfollowed'));   -- you stopped following yourself

-- -----------------------------------------------------------------------------
-- 3. Helpers (security definer; NOT executable by the API roles; called only from the RPCs below)
-- -----------------------------------------------------------------------------
create or replace function private.is_accepted_follower(p_follower uuid, p_followee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.follows f
                  where f.follower_id = p_follower and f.followee_id = p_followee and f.status = 'accepted');
$$;

create or replace function private.has_follow_cooldown(p_followee uuid, p_follower uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.follow_cooldowns c
                  where c.followee_id = p_followee and c.follower_id = p_follower and c.until > now());
$$;

-- a request the followee SEES and may accept (expired, hidden by silence or blocked = as if it did not exist)
create or replace function private.visible_request(p_follower uuid, p_followee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.follows f
                  where f.follower_id = p_follower and f.followee_id = p_followee
                    and f.status = 'pending' and f.expires_at > now())
     and not private.has_follow_cooldown(p_followee, p_follower)
     and not private.is_blocked_pair(p_follower, p_followee);
$$;

-- "The relation through the viewer's eyes" (review #3; P4, INV-3, INV-3b). The same helpers compute suggestions,
-- can_request, relation / mutual, followers[].i_follow, following[].follows_me and knows_profile — everywhere.
-- Own outgoing rows: always ("pending" = "silently refused", that is the cloak); incoming rows: only accepted ones and
-- requests VISIBLE to me. Rule: no answer to a user U reads a row of follow_cooldowns whose followee_id <> U.
create or replace function private.i_follow_state(p_viewer uuid, p_other uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select case when f.status = 'accepted' then 'following' else 'requested' end
                     from public.follows f
                    where f.follower_id = p_viewer and f.followee_id = p_other
                      and (f.status = 'accepted' or f.expires_at > now())), 'none');
$$;

create or replace function private.follows_me_state(p_viewer uuid, p_other uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when private.is_accepted_follower(p_other, p_viewer) then 'following'
              when private.visible_request(p_other, p_viewer)       then 'requested'   -- hidden by MY silence = 'none'
              else 'none' end;
$$;

create or replace function private.visible_relation(p_viewer uuid, p_other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.i_follow_state(p_viewer, p_other) <> 'none' or private.follows_me_state(p_viewer, p_other) <> 'none';
$$;

-- may the viewer see the target's card: self · a shared active occasion · a relation visible to the viewer; never when blocked
create or replace function private.knows_profile(p_viewer uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_viewer = p_target
      or (not private.is_blocked_pair(p_viewer, p_target)
          and (private.shares_occasion(p_viewer, p_target) or private.visible_relation(p_viewer, p_target)));
$$;

-- (private.profile_card(uuid) — { id, display_name, banner } — exists since M1, 20261020200000_lists_standalone.sql)

-- the occasions where BOTH are active members (the context "Gemeinsam in: …"): upcoming ones first (by start), then
-- past ones (latest first). Only occasions the viewer is in anyway; every caller has already checked that the viewer
-- may see the other person at all (knows_profile / visible_request — never for a blocked pair).
create or replace function private.shared_occasions(p_viewer uuid, p_other uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'starts_at', x.starts_at)
                            order by x.past, case when not x.past then x.starts_at end asc, x.starts_at desc, x.id), '[]'::jsonb)
    from (select o.id, o.title, o.starts_at,
                 coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) < now() as past
            from public.occasions o
           where exists (select 1 from public.occasion_members a
                          where a.occasion_id = o.id and a.profile_id = p_viewer and a.status = 'active')
             and exists (select 1 from public.occasion_members b
                          where b.occasion_id = o.id and b.profile_id = p_other and b.status = 'active')) x;
$$;

-- the relation follower -> owner is gone: end the follower's active reservations on the owner's lists WITHOUT an
-- occasion (writes only into reservations, P5). Until M3 there are none; the RPCs below already call it.
create or replace function private.end_follow_reservations(p_follower uuid, p_owner uuid, p_reason text)
returns void language sql volatile security definer set search_path = '' as $$
  update public.reservations r set status = 'ended', end_reason = p_reason, ended_at = now()
   where r.reserver_id = p_follower and r.status = 'active'
     and r.wishlist_id in (select wl.id from public.wishlists wl
                            where wl.owner_id = p_owner and wl.occasion_id is null);
$$;

create or replace function private.end_list_reservations(p_list uuid, p_reason text)
returns void language sql volatile security definer set search_path = '' as $$
  update public.reservations r set status = 'ended', end_reason = p_reason, ended_at = now()
   where r.wishlist_id = p_list and r.status = 'active';
$$;

-- Retention: the existing daily pg_cron job 'bunprise_purge_expired_records' (20261019120500) already calls this
-- function; the 20261019120500 body + the three follow tables. (Privileges are kept: nobody but the owner runs it.)
create or replace function private.purge_expired_records()
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.reservations     where status = 'ended' and ended_at < now() - interval '90 days';
  delete from public.reports          where handled_at < now() - interval '90 days';
  delete from public.follows          where status = 'pending' and expires_at < now();
  delete from public.follow_cooldowns where until < now();
  delete from public.follow_links     where revoked_at is not null or expires_at < now();
$$;

-- one and the same write whatever silence the followee holds: the cloak lives only in reading.
-- The caller already holds private.lock_profile_pair(p_follower, p_followee).
create or replace function private.make_follow_request(p_follower uuid, p_followee uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_status text;
begin
  select f.status into v_status from public.follows f
   where f.follower_id = p_follower and f.followee_id = p_followee
     and (f.status = 'accepted' or f.expires_at > now());
  if v_status = 'accepted' then return jsonb_build_object('status', 'following'); end if;
  if v_status = 'pending'  then return jsonb_build_object('status', 'requested'); end if;
  if (select count(*) from public.follows f
       where f.follower_id = p_follower and f.status = 'pending' and f.expires_at > now()) >= 30 then
    raise exception using message = 'limit_reached';
  end if;
  insert into public.follows as f (follower_id, followee_id, status, requested_at, expires_at)
  values (p_follower, p_followee, 'pending', now(), now() + interval '30 days')
  on conflict (follower_id, followee_id) do update            -- an expired row the purge has not removed yet
     set requested_at = now(), expires_at = now() + interval '30 days'
   where f.status = 'pending' and f.expires_at <= now();
  return jsonb_build_object('status', 'requested');
end $$;

-- -----------------------------------------------------------------------------
-- 4. RPCs: requests
-- -----------------------------------------------------------------------------

-- request_follow(p_profile_id): only with a shared active occasion or when the other person follows me
-- ("Auch folgen"); unknown, foreign, blocked, myself, null: ONE answer, not_found.
-- A caller who already has a live outgoing row (pending or accepted) gets its state back ('requested' /
-- 'following', follows-design §4.3 table: F -> following, P -> requested) — that only reads the caller's own row,
-- so a silently refused request answers exactly like a waiting one (INV-3).
create or replace function public.request_follow(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  if p_profile_id is null or p_profile_id = v_uid then raise exception using message = 'not_found'; end if;
  perform private.lock_profile_pair(v_uid, p_profile_id);
  if not exists (select 1 from public.profiles p where p.id = p_profile_id)
     or private.is_blocked_pair(v_uid, p_profile_id)
     or not (private.shares_occasion(v_uid, p_profile_id)
             or private.is_accepted_follower(p_profile_id, v_uid)
             or private.i_follow_state(v_uid, p_profile_id) <> 'none') then
    raise exception using message = 'not_found';     -- unknown, foreign, blocked: one answer
  end if;
  return private.make_follow_request(v_uid, p_profile_id);
end $$;

-- Pattern: accept_invite v1.1 (find the pair without a lock -> lock the pair -> re-check under the lock), but consents
-- and name FIRST: they do not depend on the pair, and an account without them must not learn whether a code exists
-- (review #8; like peek_follow_link below).
create or replace function public.request_follow_via_link(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_owner uuid; v_link record;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception using message = 'invite_invalid'; end if;
  select l.owner_id into v_owner from public.follow_links l where l.token_hash = sha256(convert_to(p_token, 'UTF8'));
  if not found then raise exception using message = 'invite_invalid'; end if;
  perform private.lock_profile_pair(v_uid, v_owner);
  select l.id, l.revoked_at, l.expires_at, l.use_count into v_link from public.follow_links l
   where l.token_hash = sha256(convert_to(p_token, 'UTF8')) for update;   -- like invites: the counter under the row lock
  if not found or v_link.revoked_at is not null or v_link.expires_at <= now()
     or v_owner = v_uid or private.is_blocked_pair(v_uid, v_owner) then
    raise exception using message = 'invite_invalid';   -- unknown / expired / revoked / own / blocked: one code
  end if;
  if private.i_follow_state(v_uid, v_owner) = 'none' then  -- a new request takes a place; the same person again does not
    if v_link.use_count >= 20 then raise exception using message = 'invite_invalid'; end if;   -- the link is full
    update public.follow_links set use_count = use_count + 1 where id = v_link.id;
  end if;   -- limit_reached in make_follow_request rolls this +1 back as well
  return private.make_follow_request(v_uid, v_owner) || jsonb_build_object('profile_id', v_owner);
end $$;

-- peek_follow_link(p_token): who is behind a live link — writes nothing, counts nothing. Order: consents -> name ->
-- shape -> a live link (a full one only for somebody who already has a live relation with its owner) -> block.
create or replace function public.peek_follow_link(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_owner uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception using message = 'invite_invalid'; end if;
  select l.owner_id into v_owner from public.follow_links l
   where l.token_hash = sha256(convert_to(p_token, 'UTF8')) and l.revoked_at is null and l.expires_at > now()
     and (l.use_count < 20 or l.owner_id = v_uid or private.i_follow_state(v_uid, l.owner_id) <> 'none');
  if not found or private.is_blocked_pair(v_uid, v_owner) then raise exception using message = 'invite_invalid'; end if;
  return jsonb_build_object('profile', private.profile_card(v_owner),
    'relation', jsonb_build_object('self', v_owner = v_uid, 'i_follow', private.i_follow_state(v_uid, v_owner)));
end $$;

-- respond_follow(p_profile_id, p_accept): only a request VISIBLE to me. Refusing = a silence row; the request row
-- stays until it expires (the requester keeps seeing "Angefragt": a silent refusal). Refusing needs no consents.
create or replace function public.respond_follow(p_profile_id uuid, p_accept boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_accept is null then raise exception using message = 'validation'; end if;
  if p_profile_id is null then raise exception using message = 'not_found'; end if;
  perform private.lock_profile_pair(v_uid, p_profile_id);
  if not private.visible_request(p_profile_id, v_uid) then
    raise exception using message = 'not_found';     -- hidden, expired, missing: one answer
  end if;
  if p_accept then
    if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
    if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
    update public.follows set status = 'accepted', accepted_at = now(), expires_at = null
     where follower_id = p_profile_id and followee_id = v_uid and status = 'pending';
    if not found then raise exception using message = 'not_found'; end if; -- the purge may have removed it
  else
    insert into public.follow_cooldowns as c (followee_id, follower_id, until)
    values (v_uid, p_profile_id, now() + interval '30 days')
    on conflict (followee_id, follower_id) do update set until = greatest(c.until, excluded.until);   -- INV-6
    -- the request row stays as it is: the requester sees "Angefragt" until it expires (silent refusal)
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- unfollow(p_profile_id): idempotent; also withdraws a pending request; after an accepted follow the caller's
-- reservations on that person's standalone lists end as 'unfollowed'. No consents: the action narrows processing.
create or replace function public.unfollow(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_status text;
begin
  if p_profile_id is null then return jsonb_build_object('ok', true); end if;
  perform private.lock_profile_pair(v_uid, p_profile_id);
  delete from public.follows f where f.follower_id = v_uid and f.followee_id = p_profile_id
  returning f.status into v_status;
  if v_status = 'accepted' then perform private.end_follow_reservations(v_uid, p_profile_id, 'unfollowed'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- remove_follower(p_profile_id): deletes an accepted follow of me; their reservations on my standalone lists end
-- as 'access_ended'; silence 30 days. The same answer whether they had reservations or not. No follower: not_found.
create or replace function public.remove_follower(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_profile_id is null then raise exception using message = 'not_found'; end if;
  perform private.lock_profile_pair(v_uid, p_profile_id);
  delete from public.follows f where f.follower_id = p_profile_id and f.followee_id = v_uid and f.status = 'accepted';
  if not found then raise exception using message = 'not_found'; end if;
  perform private.end_follow_reservations(p_profile_id, v_uid, 'access_ended');
  insert into public.follow_cooldowns as c (followee_id, follower_id, until)
  values (v_uid, p_profile_id, now() + interval '30 days')
  on conflict (followee_id, follower_id) do update set until = greatest(c.until, excluded.until);   -- INV-6
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 5. RPCs: links
-- -----------------------------------------------------------------------------

-- create_follow_link() -> { token, expires_at }: the code is shown ONCE (only its sha256 is stored); at most 5 live
-- links — the oldest live one is switched off (the share sheet warns in advance from get_lists_overview.me.live_links).
create or replace function public.create_follow_link()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_token text; v_exp timestamptz := now() + interval '30 days';
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  perform private.lock_profile_pair(v_uid, v_uid);      -- two tabs queue here
  update public.follow_links set revoked_at = now()     -- keep at most 4 live + the new one = 5
   where id in (select l.id from public.follow_links l
                 where l.owner_id = v_uid and l.revoked_at is null and l.expires_at > now()
                 order by l.created_at desc, l.id desc offset 4);
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');   -- ≈ 244 bits, like invites
  insert into public.follow_links (owner_id, token_hash, created_at, expires_at)
  values (v_uid, sha256(convert_to(v_token, 'UTF8')), clock_timestamp(), v_exp);
  return jsonb_build_object('token', v_token, 'expires_at', v_exp);
end $$;

-- revoke_follow_links() -> { ok: true }: switches off every live link of mine (no consents: it narrows).
create or replace function public.revoke_follow_links()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  update public.follow_links set revoked_at = now() where owner_id = v_uid and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 6. RPCs: screens
-- -----------------------------------------------------------------------------

-- get_profile_card(p_profile_id) — the screen /people/$profileId. not_found unless private.knows_profile(me, them)
-- (unknown, foreign, blocked, null: one answer). Never shows anybody's followers, followings or their numbers.
-- relation through MY eyes; can_request = exactly the rule of request_follow for a new request (not me, no block,
-- i_follow = 'none' and (a shared active occasion or follows_me = 'following')) — independent of their hidden rows.
-- M2: lists = [] (followers see nothing before M3) and can_find_gift = false (M3 / M4 fill them).
-- shared_occasions: occasions where both are active members; upcoming ones first (by start), then past ones
-- (latest first). Empty for my own card.
create or replace function public.get_profile_card(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_self boolean;
  v_i    text;
  v_me   text;
begin
  if p_profile_id is null or not private.knows_profile(v_uid, p_profile_id)
     or not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception using message = 'not_found';
  end if;
  v_self := p_profile_id = v_uid;
  v_i  := case when v_self then 'none' else private.i_follow_state(v_uid, p_profile_id) end;
  v_me := case when v_self then 'none' else private.follows_me_state(v_uid, p_profile_id) end;
  return jsonb_build_object(
    'profile', private.profile_card(p_profile_id),
    'relation', jsonb_build_object('self', v_self, 'i_follow', v_i, 'follows_me', v_me,
                                   'mutual', v_i = 'following' and v_me = 'following'),
    'can_request', not v_self and v_i = 'none'
                   and (private.shares_occasion(v_uid, p_profile_id) or v_me = 'following'),
    'can_find_gift', false,
    'lists', '[]'::jsonb,
    'shared_occasions', case when v_self then '[]'::jsonb else private.shared_occasions(v_uid, p_profile_id) end);
end $$;

-- get_people_screen() — the screen /people: Anfragen · Follower · Du folgst · Blockiert (+ my live links).
--   requests_in   requests VISIBLE to me (private.visible_request), newest first, with the context of §2.10:
--                 shared occasions and whether I follow / asked them;
--   requests_out  my own not yet expired requests — the SAME for "waiting", "refused" and "hidden" (the cloak);
--   followers / following  accepted relations, ordered by display_name, id;
--   blocked       the people I blocked (my own decision), newest first;  links  my live follow links, newest first.
create or replace function public.get_people_screen()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_now timestamptz := now();
begin
  return jsonb_build_object(
    'requests_in', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'profile', private.profile_card(f.follower_id),
               'requested_at', f.requested_at,
               'shared_occasions', private.shared_occasions(v_uid, f.follower_id),
               'i_follow', private.i_follow_state(v_uid, f.follower_id))
               order by f.requested_at desc, f.follower_id), '[]'::jsonb)
        from public.follows f
       where f.followee_id = v_uid and private.visible_request(f.follower_id, v_uid)),
    'requests_out', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'profile', private.profile_card(f.followee_id), 'requested_at', f.requested_at, 'expires_at', f.expires_at)
               order by f.requested_at desc, f.followee_id), '[]'::jsonb)
        from public.follows f
       where f.follower_id = v_uid and f.status = 'pending' and f.expires_at > v_now),
    'followers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'profile', private.profile_card(f.follower_id), 'accepted_at', f.accepted_at,
               'i_follow', private.i_follow_state(v_uid, f.follower_id))
               order by p.display_name, f.follower_id), '[]'::jsonb)
        from public.follows f join public.profiles p on p.id = f.follower_id
       where f.followee_id = v_uid and f.status = 'accepted'),
    'following', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'profile', private.profile_card(f.followee_id), 'accepted_at', f.accepted_at,
               'follows_me', private.follows_me_state(v_uid, f.followee_id))
               order by p.display_name, f.followee_id), '[]'::jsonb)
        from public.follows f join public.profiles p on p.id = f.followee_id
       where f.follower_id = v_uid and f.status = 'accepted'),
    'blocked', (
      select coalesce(jsonb_agg(jsonb_build_object('profile_id', b.blocked_id, 'display_name', p.display_name,
                                                   'blocked_at', b.created_at)
               order by b.created_at desc, b.blocked_id), '[]'::jsonb)
        from public.blocks b join public.profiles p on p.id = b.blocked_id
       where b.blocker_id = v_uid),
    'links', (
      select coalesce(jsonb_agg(jsonb_build_object('created_at', l.created_at, 'expires_at', l.expires_at)
               order by l.created_at desc, l.id), '[]'::jsonb)
        from public.follow_links l
       where l.owner_id = v_uid and l.revoked_at is null and l.expires_at > v_now));
end $$;

-- -----------------------------------------------------------------------------
-- 7. Changed RPCs
-- -----------------------------------------------------------------------------

-- block_user(): the 20261019120500 body, and its precondition "any existing profile" (otherwise the race pair
-- accept_invite <-> block_user breaks; P8 residual risk). New after the memberships: follows end in BOTH directions,
-- accepted and pending (INV-5). The silence (follow_cooldowns) is NOT touched — neither mine nor theirs: it ends by
-- itself after 30 days (review #2, INV-6; in v1.0 a refused person could erase somebody's silence by block -> unblock).
-- "Auch alle Folgen-Links deaktivieren" (§2.10) is a separate revoke_follow_links() call from the client.
-- The blocked person's reservations on MY lists end as access_ended (standalone list) or member_removed (occasion
-- list, as in the pilot); MY reservations on THEIR lists end as 'blocked' (my own action), as in the pilot.
create or replace function public.block_user(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, p_profile_id);
  if p_profile_id is null or p_profile_id = v_uid
     or not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception using message = 'not_found';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_uid, p_profile_id) on conflict do nothing;

  update public.occasion_members m
     set status = case when o.host_id = v_uid then 'removed' else 'left' end
    from public.occasions o
   where o.id = m.occasion_id and m.status = 'active' and m.role = 'member'
     and ((o.host_id = v_uid and m.profile_id = p_profile_id) or (o.host_id = p_profile_id and m.profile_id = v_uid));

  delete from public.follows f
   where (f.follower_id = v_uid and f.followee_id = p_profile_id)
      or (f.follower_id = p_profile_id and f.followee_id = v_uid);

  update public.reservations r set status = 'ended', end_reason = 'blocked', ended_at = now()
   where r.status = 'active' and r.reserver_id = v_uid and r.recipient_id = p_profile_id;
  update public.reservations r set status = 'ended', ended_at = now(),
         end_reason = case when exists (select 1 from public.wishlists wl
                                         where wl.id = r.wishlist_id and wl.occasion_id is null)
                           then 'access_ended' else 'member_removed' end
   where r.status = 'active' and r.reserver_id = p_profile_id and r.recipient_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- get_me(): the M1 body (20261020200000) + inbox.follow_requests = the number of requests VISIBLE to me (the dot on
-- the "Listen" tab; a request hidden by my silence never counts).
create or replace function public.get_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                                          'onboarding_done_at', p.onboarding_done_at, 'banner', p.banner)
                from public.profiles p where p.id = v_uid),
    'consents_ok', private.has_consents(v_uid),
    'legal_versions', jsonb_build_object(
      'terms',   (select lv.version from public.legal_versions lv where lv.kind = 'terms'),
      'privacy', (select lv.version from public.legal_versions lv where lv.kind = 'privacy_notice'),
      'age',     (select lv.version from public.legal_versions lv where lv.kind = 'age_18plus')),
    'inbox', jsonb_build_object('follow_requests', (
      select count(*) from public.follows f
       where f.followee_id = v_uid and private.visible_request(f.follower_id, v_uid))));
end $$;

-- get_lists_overview(): the M1 body + me.live_links (my live follow links, for the "5 active links" warning) and
-- stats.followers / following (accepted relations) / requests (VISIBLE requests to me, = get_me.inbox).
-- Unchanged until M3: following = upcoming = suggestions = [] and stats.friends_lists = 0.
-- The text of this function must never mention the reservation table (F18).
create or replace function public.get_lists_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_now    timestamptz := now();
  v_today  date := (now() at time zone 'Europe/Berlin')::date;
  v_mine   jsonb;
  v_lists  bigint;
  v_wishes bigint;
begin
  with my_lists as (
    -- OWNER BRANCH: wishlists + wishes only
    select wl.id, wl.title, wl.occasion_id, wl.visibility, wl.cover_tone, wl.cover_icon, wl.due_on, wl.created_at,
           o.title as occasion_title, o.starts_at, o.tz, o.all_day,
           coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) as ends_eff,
           (select count(*) from public.wishes w where w.wishlist_id = wl.id) as wish_count
      from public.wishlists wl
      left join public.occasions o on o.id = wl.occasion_id
     where wl.owner_id = v_uid
  ), shown as (
    select m.*,
           case when m.occasion_id is null then (case when m.due_on >= v_today then 0 else 1 end)
                when m.ends_eff >= v_now then 0
                else 2 end as grp,
           case when m.occasion_id is null then (m.due_on::timestamp at time zone 'Europe/Berlin') else m.starts_at end as dated_at
      from my_lists m
     where m.occasion_id is null or m.ends_eff >= v_now - interval '30 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'title', s.title,
           'kind', case when s.occasion_id is null then 'standalone' else 'occasion' end,
           'visibility', s.visibility, 'cover_tone', s.cover_tone, 'cover_icon', s.cover_icon, 'due_on', s.due_on,
           'wish_count', s.wish_count,
           'occasion', case when s.occasion_id is null then null::jsonb
                            else jsonb_build_object('id', s.occasion_id, 'title', s.occasion_title, 'starts_at', s.starts_at,
                                                    'tz', s.tz, 'all_day', s.all_day) end,
           'created_at', s.created_at)
           order by s.grp,
                    case when s.grp = 0 then s.dated_at end asc,
                    case when s.grp = 1 then s.created_at end desc,
                    case when s.grp = 2 then s.starts_at end desc,
                    s.id), '[]'::jsonb),
         count(*),
         coalesce(sum(s.wish_count), 0)::bigint
    into v_mine, v_lists, v_wishes
    from shown s;

  return jsonb_build_object(
    'me', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'banner', p.banner,
                                     'live_links', (select count(*) from public.follow_links l
                                                     where l.owner_id = v_uid and l.revoked_at is null and l.expires_at > v_now))
             from public.profiles p where p.id = v_uid),
    'stats', jsonb_build_object(
      'my_wishes', v_wishes, 'my_lists', v_lists, 'friends_lists', 0,
      'followers', (select count(*) from public.follows f where f.followee_id = v_uid and f.status = 'accepted'),
      'following', (select count(*) from public.follows f where f.follower_id = v_uid and f.status = 'accepted'),
      'requests',  (select count(*) from public.follows f
                     where f.followee_id = v_uid and private.visible_request(f.follower_id, v_uid))),
    'my_lists', v_mine,
    'following', '[]'::jsonb,
    'upcoming', '[]'::jsonb,
    'suggestions', '[]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- 8. Export: private.my_follows_export() (no argument, auth.uid() only; display names, never somebody's id) and
--    export_my_data() (the M1 body + 'follows'). Never in it: other people's ids, a silence set by somebody else,
--    reservations on own wishes, token_hash.
--      following[{display_name, status: requested | accepted, requested_at, accepted_at, expires_at}]
--        only live rows: accepted, or a request that has not expired (an expired row the purge has not removed yet
--        is not "angefragt" any more);
--      followers[{display_name, accepted_at}];
--      requests_received[{display_name, requested_at}] — the ones visible to me;
--      hidden_requests_received[{display_name, requested_at}] — live requests TO ME hidden by MY silence: my data
--        (Art. 15; possibly evidence of harassment). The requester's own export keeps the cloak ("requested");
--      hidden_requesters[{display_name, until}] — MY decisions only (my silence rows);
--      follow_links[{created_at, expires_at, revoked_at, use_count}] — never token_hash.
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
       where l.owner_id = auth.uid()));
$$;

-- export_my_data(): the M1 body (format v2) + 'follows'.
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'format', 'bunprise-export-v2',
    'exported_at', now(),
    'profile', private.my_profile_export(),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'version', c.version, 'locale', c.locale,
                                                              'accepted_at', c.accepted_at) order by c.accepted_at, c.kind), '[]'::jsonb)
                 from public.consents c where c.profile_id = v_uid),
    'occasions_hosted', (
      select coalesce(jsonb_agg((jsonb_build_object('id', o.id, 'host_id', o.host_id, 'title', o.title, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'tz', o.tz, 'all_day', o.all_day, 'place_text', o.place_text, 'description', o.description, 'cancelled_at', o.cancelled_at, 'created_at', o.created_at, 'updated_at', o.updated_at) || jsonb_build_object(
               'invites', (select coalesce(jsonb_agg(jsonb_build_object(               -- never token_hash
                             'id', i.id, 'expires_at', i.expires_at, 'max_uses', i.max_uses, 'use_count', i.use_count,
                             'revoked_at', i.revoked_at, 'created_at', i.created_at) order by i.created_at), '[]'::jsonb)
                           from public.invites i where i.occasion_id = o.id),
               'members', (select coalesce(jsonb_agg(jsonb_build_object(
                             'display_name', p.display_name, 'role', m.role, 'rsvp', m.rsvp, 'status', m.status,
                             'joined_at', m.joined_at) order by m.joined_at), '[]'::jsonb)
                           from public.occasion_members m
                           left join public.profiles p on p.id = m.profile_id
                           where m.occasion_id = o.id)
             )) order by o.starts_at, o.id), '[]'::jsonb)
      from public.occasions o where o.host_id = v_uid),
    'memberships', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'occasion_id', m.occasion_id, 'occasion_title', o.title, 'starts_at', o.starts_at,
               'role', m.role, 'rsvp', m.rsvp, 'status', m.status, 'joined_at', m.joined_at)
               order by m.joined_at, m.occasion_id), '[]'::jsonb)
      from public.occasion_members m
      left join public.occasions o on o.id = m.occasion_id
      where m.profile_id = v_uid and m.role = 'member'),
    'wishlists', private.my_wishlists_export(),
    'reservations_made_by_me', private.my_reservations_export(),
    'follows', private.my_follows_export(),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('blocked_name', p.display_name, 'created_at', b.created_at)
                                         order by b.created_at), '[]'::jsonb)
               from public.blocks b left join public.profiles p on p.id = b.blocked_id where b.blocker_id = v_uid),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reporter_id', r.reporter_id, 'target_kind', r.target_kind, 'target_id', r.target_id, 'reason', r.reason, 'created_at', r.created_at, 'handled_at', r.handled_at, 'outcome', r.outcome) order by r.created_at), '[]'::jsonb)
                from public.reports r where r.reporter_id = v_uid)
  );
end $$;

-- -----------------------------------------------------------------------------
-- 9. Privileges (follows-design §3.3 end, §4.4): the new RPCs for authenticated only; schema private: PUBLIC execute
--    off again; the relation helpers are called only from definer functions and are NEVER executable by the API
--    roles; the export helper is needed by the invoker export. CREATE OR REPLACE keeps existing privileges.
-- -----------------------------------------------------------------------------
revoke execute on function
  public.request_follow(uuid), public.request_follow_via_link(text), public.peek_follow_link(text),
  public.respond_follow(uuid, boolean), public.unfollow(uuid), public.remove_follower(uuid),
  public.create_follow_link(), public.revoke_follow_links(), public.get_profile_card(uuid), public.get_people_screen()
  from public, anon;
grant execute on function
  public.request_follow(uuid), public.request_follow_via_link(text), public.peek_follow_link(text),
  public.respond_follow(uuid, boolean), public.unfollow(uuid), public.remove_follower(uuid),
  public.create_follow_link(), public.revoke_follow_links(), public.get_profile_card(uuid), public.get_people_screen()
  to authenticated;

revoke execute on all functions in schema private from public, anon;
revoke execute on function
  private.is_accepted_follower(uuid, uuid), private.has_follow_cooldown(uuid, uuid), private.visible_request(uuid, uuid),
  private.i_follow_state(uuid, uuid), private.follows_me_state(uuid, uuid), private.visible_relation(uuid, uuid),
  private.knows_profile(uuid, uuid), private.profile_card(uuid), private.make_follow_request(uuid, uuid),
  private.end_follow_reservations(uuid, uuid, text), private.end_list_reservations(uuid, text),
  private.shared_occasions(uuid, uuid)
  from authenticated;
grant execute on function private.my_follows_export() to authenticated;   -- no argument, auth.uid() only; the invoker export needs it
