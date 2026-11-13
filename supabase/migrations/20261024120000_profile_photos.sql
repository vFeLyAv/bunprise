-- =============================================================================
-- Bunprise: a person's own PROFILE PHOTO (the round picture instead of the initials) and own BANNER PHOTO (instead
-- of one of the 8 preset banners) — Felix 24.10. Forward only: every earlier migration stays untouched. NOT applied
-- to the hosted project: `supabase db push` only after Felix's OK (together with the other local migrations, in
-- file order).
--
-- The occasion_photos / wish_photos / list_photos pattern (20261020160000, 20261022120000, 20261022160000; ADR
-- docs/decisions/2026-10-20-occasion-photos-in-postgres.md): own table, bytea in Postgres, no grant for anon /
-- authenticated, RLS forced without a policy, webp/jpeg only, 1 .. 409600 decoded bytes, 1 .. 2048 px parsed from the
-- bytes (private.photo_dimensions), on delete cascade from the profile (account deleted -> the photos go in the same
-- transaction). The client re-encodes on the device (features/occasions/photo/pipeline.ts preparePhoto: the avatar
-- as a 512 px square, the banner at most 1600 px; WebP/JPEG, no EXIF/GPS).
--   public.profile_photos (profile_id, kind 'avatar' | 'banner') — one row per person and kind. Quota = the primary
--   key: at most ONE profile photo and ONE banner photo per person (≤ 2 × 400 KB); replacing is always fine.
--
-- VISIBILITY RULE (the one rule, in the database): a person's profile photo and banner photo are visible to EXACTLY
-- the people who may see that person's profile card today — private.knows_profile(viewer, owner) of
-- 20261020200100_follows.sql:
--   * the person themself;
--   * a guest of the same occasion (both active members of one occasion, private.shares_occasion);
--   * a visible follow relation in either direction: an accepted follower / followee, my own outgoing request that
--     has not expired (the requester keeps seeing "Angefragt" — the cloak of a silent refusal), an incoming request
--     I can see (not expired, not hidden by my own silence);
--   * NEVER across a block (either direction), never a stranger — also not somebody who only holds the person's
--     follow link (peek_follow_link shows the card with photo = null to a stranger).
-- The meta keys are computed with the caller (auth.uid()) inside private.profile_photo_fields(), so every answer
-- that carries a profile card follows the rule by itself. Everybody else gets null meta, and get_profile_photo()
-- answers ONE not_found for "no access", "no photo", unknown person or kind.
--
--   set_profile_photo(p_kind, p_mime, p_data_base64, p_width, p_height) -> { ok, updated_at }   the own profile only
--   remove_profile_photo(p_kind)                                         -> { ok }               idempotent
--   get_profile_photo(p_profile_id, p_kind) -> { mime, data (base64), width, height, updated_at }
--   export_my_profile_photos() -> [ { kind, mime, width, height, size_bytes, updated_at, data_base64 } ]   own only
--
-- The meta `{ width, height, updated_at } | null` (the bytes: get_profile_photo, lazily, after the first paint):
--   private.profile_card()      + photo, banner_photo  (visibility rule above) — get_profile_card, get_people_screen
--                                  (requests, followers, following), get_lists_overview.following[], get_list_screen
--                                  (owner), get_free_wishes (person), peek_follow_link
--   get_lists_overview()        me + photo, banner_photo (own); suggestions[].profile + photo, banner_photo (rule)
--   get_me()                    profile + photo, banner_photo (own)
--   get_occasion_screen()       occasion.host + photo; members[] + photo (rule; co-guests always pass it)
--   export (private.my_profile_export) profile + photo, banner_photo (own meta; the bytes: export_my_profile_photos)
-- get_people_screen.blocked keeps { profile_id, display_name } only: a blocked person's photo is never shown.
-- Nothing here reads public.reservations (the secret): the photos are about a person, never about a wish.
--
-- Lock order (pilot rule): set / remove take the caller's own profile row FIRST (private.lock_profile_pair), like
-- delete_my_account and every write "between people" (block_user, follows). An upload racing the account deletion
-- therefore either commits before it (and goes with the cascade) or sees the account gone ('not_allowed') — never a
-- raw foreign-key error (packages/db-tests/test/concurrency/profile-photos.test.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table
-- -----------------------------------------------------------------------------
create table public.profile_photos (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('avatar', 'banner')),
  mime        text not null check (mime in ('image/webp', 'image/jpeg')),
  bytes       bytea not null check (octet_length(bytes) between 1 and 409600),
  width       smallint not null check (width between 1 and 2048),
  height      smallint not null check (height between 1 and 2048),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, kind)
);
alter table public.profile_photos alter column bytes set storage external;
comment on table public.profile_photos is
  'A person''s own profile photo (kind avatar) and banner photo (kind banner): one each. No grants for anon/authenticated, RLS forced without a policy: read and written only through set_/remove_/get_profile_photo() and export_my_profile_photos(). Visible exactly where the profile card is (private.knows_profile). Deleted with the profile (account) by cascade.';

revoke all on public.profile_photos from public, anon, authenticated;
alter table public.profile_photos enable row level security;
alter table public.profile_photos force  row level security;
-- deliberately no policy (= deny every row to every API role); the security definer RPCs are the only way in.

-- -----------------------------------------------------------------------------
-- 2. Helpers (definer; never executable by an API role). They depend on the profile and the relation only.
-- -----------------------------------------------------------------------------

-- the raw meta of one photo (no visibility check: for the person's OWN answers and the visibility helper below)
create or replace function private.profile_photo_meta(p_profile uuid, p_kind text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
    from public.profile_photos ph where ph.profile_id = p_profile and ph.kind = p_kind;
$$;

-- { photo, banner_photo } of a person AS THE CALLER MAY SEE THEM: the meta only when the caller may see the person's
-- card (private.knows_profile: self, a shared active occasion, a visible relation; never across a block), else nulls.
create or replace function private.profile_photo_fields(p_profile uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is not null and private.knows_profile(auth.uid(), p_profile)
              then jsonb_build_object('photo', private.profile_photo_meta(p_profile, 'avatar'),
                                      'banner_photo', private.profile_photo_meta(p_profile, 'banner'))
              else jsonb_build_object('photo', null, 'banner_photo', null) end;
$$;

-- the card of a person (since M1: id, display_name, banner) + the photo meta through the visibility rule
create or replace function private.profile_card(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'banner', p.banner)
         || private.profile_photo_fields(p.id)
    from public.profiles p where p.id = p_id;
$$;

-- -----------------------------------------------------------------------------
-- 3. RPCs
-- -----------------------------------------------------------------------------

-- set_profile_photo(): the person puts (or replaces) their own photo of one kind. The input is checked BEFORE any
-- lock is taken; the answer for a bad input depends on the input only.
create or replace function public.set_profile_photo(
  p_kind text, p_mime text, p_data_base64 text, p_width integer, p_height integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_bytes bytea;
  v_dimensions integer[];
  v_at    timestamptz;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;

  -- 546136 = the base64 length of 409600 bytes; the stated size must be a real one
  if p_kind is null or p_kind not in ('avatar', 'banner')
     or p_mime is null or p_mime not in ('image/webp', 'image/jpeg')
     or p_width is null or p_width not between 1 and 2048
     or p_height is null or p_height not between 1 and 2048
     or p_data_base64 is null or length(p_data_base64) not between 4 and 546136 then
    raise exception using message = 'validation';
  end if;
  begin
    v_bytes := decode(p_data_base64, 'base64');
  exception when others then
    raise exception using message = 'validation';
  end;
  v_dimensions := private.photo_dimensions(p_mime, v_bytes);
  if v_dimensions is null or v_dimensions[1] <> p_width or v_dimensions[2] <> p_height then
    raise exception using message = 'validation';
  end if;

  -- first (and only) lock: the own profile row; it re-checks that the account still exists after the wait
  perform private.lock_profile_pair(v_uid, v_uid);

  v_at := clock_timestamp();
  insert into public.profile_photos as ph (profile_id, kind, mime, bytes, width, height, updated_at)
  values (v_uid, p_kind, p_mime, v_bytes, v_dimensions[1], v_dimensions[2], v_at)
  on conflict (profile_id, kind) do update
    set mime = excluded.mime, bytes = excluded.bytes, width = excluded.width, height = excluded.height,
        updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'updated_at', v_at);
end $$;

-- remove_profile_photo(): the person takes their own photo of one kind away. Idempotent. No consent check
-- (removing own data).
create or replace function public.remove_profile_photo(p_kind text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_kind is null or p_kind not in ('avatar', 'banner') then raise exception using message = 'validation'; end if;
  perform private.lock_profile_pair(v_uid, v_uid);
  delete from public.profile_photos ph where ph.profile_id = v_uid and ph.kind = p_kind;
  return jsonb_build_object('ok', true);
end $$;

-- get_profile_photo(): the bytes, for exactly the people who may see the person's card. Everyone else, a missing
-- photo, an unknown person or kind: 'not_found' (one answer).
create or replace function public.get_profile_photo(p_profile_id uuid, p_kind text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_ph  record;
begin
  if p_profile_id is null or p_kind is null or not private.knows_profile(v_uid, p_profile_id) then
    raise exception using message = 'not_found';
  end if;
  select ph.mime, ph.bytes, ph.width, ph.height, ph.updated_at into v_ph
    from public.profile_photos ph where ph.profile_id = p_profile_id and ph.kind = p_kind;
  if not found then raise exception using message = 'not_found'; end if;
  return jsonb_build_object(
    'mime', v_ph.mime,
    'data', replace(encode(v_ph.bytes, 'base64'), E'\n', ''),   -- one line (encode() wraps at 76 chars)
    'width', v_ph.width, 'height', v_ph.height, 'updated_at', v_ph.updated_at);
end $$;

-- export_my_profile_photos(): DSGVO Art. 15 / 20 — the caller's OWN profile and banner photo, with the bytes. Needs
-- no current consents (like export_my_data).
create or replace function public.export_my_profile_photos()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', ph.kind, 'mime', ph.mime, 'width', ph.width, 'height', ph.height,
             'size_bytes', octet_length(ph.bytes), 'updated_at', ph.updated_at,
             'data_base64', replace(encode(ph.bytes, 'base64'), E'\n', ''))
             order by ph.kind), '[]'::jsonb)
    from public.profile_photos ph
    where ph.profile_id = v_uid);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Own answers: get_me() and the export profile (the 20261020200200 bodies + the own photo meta)
-- -----------------------------------------------------------------------------
create or replace function public.get_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                                          'onboarding_done_at', p.onboarding_done_at, 'banner', p.banner,
                                          'in_suggestions', p.in_suggestions,
                                          'photo', private.profile_photo_meta(p.id, 'avatar'),
                                          'banner_photo', private.profile_photo_meta(p.id, 'banner'))
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

create or replace function private.my_profile_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                            'onboarding_done_at', p.onboarding_done_at, 'banner', p.banner,
                            'in_suggestions', p.in_suggestions,
                            -- the meta of the own photos (the bytes: export_my_profile_photos(), added by the client)
                            'photo', private.profile_photo_meta(p.id, 'avatar'),
                            'banner_photo', private.profile_photo_meta(p.id, 'banner'),
                            'created_at', p.created_at, 'updated_at', p.updated_at)
  from public.profiles p where p.id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- 5. get_occasion_screen(): the 20261022160000 body; host + photo, members[] + photo (the visibility rule —
--    every listed member is an active co-guest, blocked pairs are already filtered out).
-- -----------------------------------------------------------------------------
create or replace function public.get_occasion_screen(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_occ       public.occasions%rowtype;
  v_me        public.occasion_members%rowtype;
  v_wl        record;   -- not %rowtype: wishlists has 11 columns now, 7 are selected (strict_multi_assignment)
  v_host_name text;
  v_invite    jsonb := null;
  v_wishes    jsonb;
  v_received  jsonb;
  v_wishlist  jsonb := null;
begin
  select o.id, o.host_id, o.title, o.starts_at, o.ends_at, o.tz, o.all_day, o.place_text, o.description, o.cancelled_at, o.created_at, o.updated_at into v_occ from public.occasions o where o.id = p_occasion_id;
  if not found then raise exception using message = 'not_found'; end if;
  select m.occasion_id, m.profile_id, m.role, m.rsvp, m.status, m.invited_via, m.joined_at, m.updated_at into v_me from public.occasion_members m
   where m.occasion_id = p_occasion_id and m.profile_id = v_uid and m.status = 'active';
  if not found then raise exception using message = 'not_found'; end if;   -- outsider / left / removed: one answer

  if private.is_blocked_pair(v_uid, v_occ.host_id) then raise exception using message = 'not_found'; end if;

  select p.display_name into v_host_name from public.profiles p where p.id = v_occ.host_id;

  if v_me.role = 'host' then
    select jsonb_build_object('active', true, 'expires_at', i.expires_at) into v_invite
      from public.invites i
     where i.occasion_id = p_occasion_id and i.revoked_at is null and i.expires_at > now() and i.use_count < i.max_uses
     order by i.created_at desc
     limit 1;
  end if;

  -- the one list of the pilot: the host's
  select wl.id, wl.occasion_id, wl.owner_id, wl.recipient_id, wl.title, wl.created_at, wl.updated_at into v_wl from public.wishlists wl
   where wl.occasion_id = p_occasion_id and wl.owner_id = v_occ.host_id
   order by wl.created_at
   limit 1;

  if found then
    if v_uid in (v_wl.owner_id, v_wl.recipient_id) then
      -- OWNER BRANCH: literal nulls, public.reservations is not referenced at all
      select coalesce(jsonb_agg(x.j order by w.priority desc, w.created_at asc, w.id) filter (where w.received_at is null), '[]'::jsonb),
             coalesce(jsonb_agg(x.j order by w.received_at desc, w.id) filter (where w.received_at is not null), '[]'::jsonb)
        into v_wishes, v_received
        from public.wishes w
        cross join lateral (select jsonb_build_object(
               'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
               'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
               'reserved', null::boolean, 'reserved_by_me', null::boolean) || private.wish_detail_fields(w) as j) x
       where w.wishlist_id = v_wl.id;
    else
      -- MEMBER BRANCH: availability and own reservation only; no reserver name.
      select coalesce(jsonb_agg(x.j order by w.priority desc, w.created_at asc, w.id) filter (where w.received_at is null), '[]'::jsonb),
             coalesce(jsonb_agg(x.j order by w.received_at desc, w.id) filter (where w.received_at is not null), '[]'::jsonb)
        into v_wishes, v_received
        from public.wishes w
        left join public.reservations r on r.wish_id = w.id and r.status = 'active'
        cross join lateral (select jsonb_build_object(
               'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
               'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
               'reserved', (r.id is not null),
               'reserved_by_me', coalesce(r.reserver_id = v_uid, false)) || private.wish_detail_fields(w) as j) x
       where w.wishlist_id = v_wl.id;
    end if;
    v_wishlist := jsonb_build_object('id', v_wl.id, 'owner_id', v_wl.owner_id, 'title', v_wl.title,
                                     'photo', private.list_photo_meta(v_wl.id),
                                     'wishes', v_wishes, 'received', v_received);
  end if;

  return jsonb_build_object(
    'occasion', jsonb_build_object(
      'id', v_occ.id, 'title', v_occ.title, 'starts_at', v_occ.starts_at, 'tz', v_occ.tz, 'all_day', v_occ.all_day,
      'place_text', v_occ.place_text, 'description', v_occ.description, 'created_at', v_occ.created_at,
      'host', jsonb_build_object('id', v_occ.host_id, 'display_name', v_host_name,
                                 -- the host's profile photo (the visibility rule; a guest always shares this occasion)
                                 'photo', private.profile_photo_fields(v_occ.host_id) -> 'photo'),
      -- the cover photo's meta (the bytes: get_occasion_photo); null without a photo
      'photo', (select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
                  from public.occasion_photos ph where ph.occasion_id = v_occ.id)),
    'viewer', jsonb_build_object('role', v_me.role, 'rsvp', v_me.rsvp),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'display_name', p.display_name, 'role', m.role, 'rsvp', m.rsvp,
                                                   'photo', private.profile_photo_fields(p.id) -> 'photo')
                                order by m.joined_at, p.id), '[]'::jsonb)
      from public.occasion_members m
      join public.profiles p on p.id = m.profile_id
      where m.occasion_id = p_occasion_id and m.status = 'active' and not private.is_blocked_pair(v_uid, p.id)),
    'invite', v_invite,
    'wishlist', v_wishlist);
end $$;

-- -----------------------------------------------------------------------------
-- 6. get_lists_overview(): the 20261022160000 body; me + the own photo meta, suggestions[].profile + the photo
--    fields (the visibility rule: a suggestion is an active co-guest). Still not one word about the secret table.
-- -----------------------------------------------------------------------------
create or replace function public.get_lists_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_now       timestamptz := now();
  v_today     date := (now() at time zone 'Europe/Berlin')::date;
  v_mine      jsonb;
  v_lists     bigint;
  v_wishes    bigint;
  v_following jsonb;
  v_upcoming  jsonb;
  v_guest     bigint;
  v_suggest   jsonb;
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
           'photo', private.list_photo_meta(s.id),
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

  -- VIEWER BRANCH: lists of other people, driven from my accepted follows and my active guest memberships.
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile', private.profile_card(f.followee_id),
           'mutual', private.follows_me_state(v_uid, f.followee_id) = 'following',
           'accepted_at', f.accepted_at,
           'lists', private.follower_list_cards(f.followee_id, v_uid))
           order by p.display_name, f.followee_id), '[]'::jsonb)
    into v_following
    from public.follows f join public.profiles p on p.id = f.followee_id
   where f.follower_id = v_uid and f.status = 'accepted';

  with guest as (
    -- the lists of occasions I am an active guest of (the host owns an occasion's list, so never my own)
    select wl.id, wl.owner_id, coalesce(wl.title, o.title) as title, wl.cover_tone, wl.cover_icon, o.id as occasion_id,
           (o.starts_at at time zone o.tz)::date as day,
           coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) as ends_eff,
           (select count(*) from public.wishes w where w.wishlist_id = wl.id) as wish_count
      from public.occasion_members m
      join public.occasions o on o.id = m.occasion_id
      join public.wishlists wl on wl.occasion_id = o.id
     where m.profile_id = v_uid and m.status = 'active' and wl.owner_id <> v_uid
       and private.can_read_wishlist(wl.id, v_uid)
  ), dated as (
    -- the dated follower lists of the people I follow (due within 60 days)
    select wl.id, wl.owner_id, wl.title, wl.cover_tone, wl.cover_icon, wl.due_on as day,
           (select count(*) from public.wishes w where w.wishlist_id = wl.id) as wish_count
      from public.follows f
      join public.wishlists wl on wl.owner_id = f.followee_id and wl.visibility = 'followers' and wl.occasion_id is null
     where f.follower_id = v_uid and f.status = 'accepted'
       and wl.due_on between v_today and v_today + 60
       and private.can_read_wishlist(wl.id, v_uid)
  ), soon as (
    select g.id, g.owner_id, g.title, g.cover_tone, g.cover_icon, g.occasion_id, g.day, g.wish_count, 'occasion'::text as kind
      from guest g
     where g.ends_eff >= v_now and g.day between v_today and v_today + 60
    union all
    select d.id, d.owner_id, d.title, d.cover_tone, d.cover_icon, null::uuid, d.day, d.wish_count, 'standalone'::text
      from dated d
  )
  select (select count(*) from guest g where g.ends_eff >= v_now - interval '30 days'),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'list', jsonb_build_object('id', x.id, 'title', x.title, 'cover_tone', x.cover_tone,
                                              'cover_icon', x.cover_icon, 'wish_count', x.wish_count,
                                              'occasion_id', x.occasion_id,
                                              'photo', private.list_photo_meta(x.id)),
                   'owner', jsonb_build_object('id', x.owner_id, 'display_name', p.display_name),
                   'date', x.day, 'kind', x.kind)
                   order by x.day, x.id), '[]'::jsonb)
            from soon x join public.profiles p on p.id = x.owner_id)
    into v_guest, v_upcoming;

  with recent as (
    -- the occasions I am an active member of: upcoming or ended at most 30 days ago
    select o.id, o.title, o.starts_at,
           coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) < v_now as past
      from public.occasion_members m join public.occasions o on o.id = m.occasion_id
     where m.profile_id = v_uid and m.status = 'active'
       and coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) >= v_now - interval '30 days'
  ), cand as (
    -- every other active member of them, with the first shared occasion (upcoming by start, then past latest first)
    select distinct on (b.profile_id) b.profile_id, r.title
      from recent r join public.occasion_members b on b.occasion_id = r.id and b.status = 'active' and b.profile_id <> v_uid
     order by b.profile_id, r.past, case when not r.past then r.starts_at end asc, r.starts_at desc, r.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('profile', jsonb_build_object('id', s.id, 'display_name', s.display_name)
                                                          || private.profile_photo_fields(s.id),
                                               'shared_occasion_title', s.title)
                            order by s.display_name, s.id), '[]'::jsonb)
    into v_suggest
    from (select p.id, p.display_name, c.title
            from cand c join public.profiles p on p.id = c.profile_id
           where p.in_suggestions and p.display_name is not null and private.has_consents(p.id)
             and not private.is_blocked_pair(v_uid, p.id)
             and not private.visible_relation(v_uid, p.id)
             and not private.has_follow_cooldown(v_uid, p.id)   -- only MY OWN silence, never theirs (P4)
           order by p.display_name, p.id
           limit 10) s;

  return jsonb_build_object(
    'me', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'banner', p.banner,
                                     'photo', private.profile_photo_meta(p.id, 'avatar'),
                                     'banner_photo', private.profile_photo_meta(p.id, 'banner'),
                                     'live_links', (select count(*) from public.follow_links l
                                                     where l.owner_id = v_uid and l.revoked_at is null and l.expires_at > v_now))
             from public.profiles p where p.id = v_uid),
    'stats', jsonb_build_object(
      'my_wishes', v_wishes, 'my_lists', v_lists,
      'friends_lists', v_guest + (select coalesce(sum(jsonb_array_length(e -> 'lists')), 0) from jsonb_array_elements(v_following) e),
      'followers', (select count(*) from public.follows f where f.followee_id = v_uid and f.status = 'accepted'),
      'following', (select count(*) from public.follows f where f.follower_id = v_uid and f.status = 'accepted'),
      'requests',  (select count(*) from public.follows f
                     where f.followee_id = v_uid and private.visible_request(f.follower_id, v_uid))),
    'my_lists', v_mine,
    'following', v_following,
    'upcoming', v_upcoming,
    'suggestions', v_suggest);
end $$;

-- -----------------------------------------------------------------------------
-- 7. Privileges: the new RPCs for authenticated only; the new helpers for nobody but the definer functions.
--    (Re-created functions keep their privileges: CREATE OR REPLACE does not touch them.)
-- -----------------------------------------------------------------------------
revoke execute on function
  public.set_profile_photo(text, text, text, integer, integer), public.remove_profile_photo(text),
  public.get_profile_photo(uuid, text), public.export_my_profile_photos()
  from public, anon;
grant execute on function
  public.set_profile_photo(text, text, text, integer, integer), public.remove_profile_photo(text),
  public.get_profile_photo(uuid, text), public.export_my_profile_photos()
  to authenticated;
revoke execute on all functions in schema private from public, anon;
revoke execute on function private.profile_photo_meta(uuid, text), private.profile_photo_fields(uuid) from authenticated;
