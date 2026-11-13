-- =============================================================================
-- Bunprise: a wishlist's COVER PHOTO, "Erhalten" (a wish marked as received) and MOVING a wish to another list.
-- Forward only: every earlier migration stays untouched. NOT applied to the hosted project: `supabase db push`
-- only after Felix's OK (together with the other local wave-2 migrations, in file order).
--
-- A) list_photos — a copy of the occasion_photos / wish_photos pattern (20261020160000, 20261022120000; ADR
--    docs/decisions/2026-10-20-occasion-photos-in-postgres.md): own table keyed by the list, bytea in Postgres,
--    no grant for anon / authenticated, RLS forced without a policy, webp/jpeg only, 1 .. 409600 decoded bytes,
--    1 .. 2048 px parsed from the bytes (private.photo_dimensions), on delete cascade from the list (list,
--    occasion or account deleted -> the photo goes in the same transaction). Quota: at most 30 own lists with a
--    photo ('photo_limit'; replacing is always fine). Every list may have one (a list without an occasion and an
--    occasion's list alike: "list owner only" is the one rule).
--      set_list_photo(p_list_id, p_mime, p_data_base64, p_width, p_height) -> { ok, updated_at }   list owner only
--      remove_list_photo(p_list_id)                                          -> { ok }               list owner only
--      get_list_photo(p_list_id) -> { mime, data (base64), width, height, updated_at }
--                                   exactly the list's readers (private.can_read_wishlist: the owner, an active
--                                   guest of the occasion, an accepted follower of a 'followers' list while the
--                                   red button is off, never across a block). Everybody else and "no photo": ONE
--                                   answer, not_found.
--      export_my_list_photos()   -> [ { wishlist_id, list_title, occasion_id, mime, width, height, size_bytes,
--                                       updated_at, data_base64 } ]   the caller's OWN lists only
--    Every answer that carries a list gets `photo = { width, height, updated_at } | null` (private.list_photo_meta):
--    get_lists_overview (my_lists[], upcoming[].list, following[].lists[]), get_profile_card (lists[]),
--    get_list_screen (list), get_occasion_screen (wishlist), get_free_wishes (ideas[].list), the export
--    (private.my_wishlists_export). get_feed shows occasions, not lists: unchanged.
--
-- B) wishes.received_at ("Erhalten") — set / cleared ONLY by the list owner through set_wish_received(); no REST
--    UPDATE grant (so the write always takes the owner's profile lock, the first lock of every reservation on the
--    owner's lists). REST SELECT is granted like the other wish columns (the wish's readers).
--      set_wish_received(p_wish_id, p_received boolean) -> { ok, received_at }   list owner only, else not_found
--    Semantics (the reservation secret stays intact):
--      * the owner's action never touches public.reservations: existing reservations stay exactly as they are,
--        the answer is the same with or without them, un-marking restores the wish with its reservation;
--      * reserve_wish refuses a NEW reservation of a received wish with not_allowed (the code of every wish the
--        caller may not reserve); the giver who already holds it gets the idempotent { ok } as before;
--      * every wish answer has the key received_at (via private.wish_detail_fields). The screens SPLIT the wishes:
--        `wishes` = the open ones (received_at null; order as before), `received` = the received ones (newest
--        first, the same object shape — the giver still sees reserved_by_me there, so they know). The same for
--        every role (owner: literal nulls as always). get_free_wishes leaves received wishes out entirely;
--        my_reservations() gets received_at (live while the giver may read the list, else null);
--      * the cap of 5 follower reservations no longer counts reservations of received wishes (a bought and
--        received gift should not block the giver forever). Only the giver's own rows are counted, as before.
--
-- C) move_wish(p_wish_id, p_target_list_id) -> { ok } — the caller owns BOTH lists (else not_found, one answer);
--    the same list is a no-op; moving into a list that others may read needs the current legal records
--    ('consent_required'), moving into "Nur ich" never does. The photo (wish_photos is keyed by the wish) and
--    received_at move with the wish. Reservations (INV-1 "no access, no reservation"), in the same transaction:
--      * a giver who can read the TARGET list keeps the reservation; its wishlist_id follows the wish
--        (recipient_id is the same: every list's recipient is its owner);
--      * every other active reservation ends with the NEW end_reason 'wish_moved' (the giver sees it in
--        my_reservations with the snapshot title only; no live data of a list they cannot read).
--    The owner observes nothing: the answer is always { ok: true }, no owner answer reads reservations.
--    Cases: occasion list -> list without an occasion (guests who are not accepted followers lose it), the
--    reverse, between two occasions, into "Nur ich" (everybody loses it), into a 'followers' list.
--    The pilot trigger wish_guard ("a wish cannot move") now refuses the move only for the API roles: the
--    definer function is the one way (REST has no UPDATE grant on wishlist_id either).
--
-- Lock order (pilot rule): the owner's profile row FIRST (private.lock_profile_pair) — the same first lock as
-- reserve_wish (pair lock incl. the recipient = owner), the REST deletes of wishes / lists / occasions
-- (statement trigger lock_owned_delete), every access change (unfollow, remove_follower, block, remove_member,
-- set_list_visibility) and delete_my_account — then the lists FOR KEY SHARE, the wish, the reservations.
-- So a move / mark and a reservation never interleave (packages/db-tests/test/concurrency/lists-received-move.test.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. wishes.received_at
-- -----------------------------------------------------------------------------
alter table public.wishes add column received_at timestamptz;
comment on column public.wishes.received_at is
  'When the owner marked the wish as received ("Erhalten"); null = open. Written only by set_wish_received() (no REST UPDATE grant). Never derived from reservations.';
grant select (received_at) on public.wishes to authenticated;

-- -----------------------------------------------------------------------------
-- 2. reservations: one more neutral end reason
-- -----------------------------------------------------------------------------
alter table public.reservations drop constraint reservations_end_reason_check;
alter table public.reservations add constraint reservations_end_reason_check check (end_reason is null or end_reason in
  ('by_reserver', 'member_removed', 'member_left', 'blocked', 'wish_deleted', 'access_ended', 'unfollowed',
   'wish_moved'));   -- the owner moved the wish to a list you cannot read

-- -----------------------------------------------------------------------------
-- 3. wish_guard: a wish changes its list only inside move_wish() (security definer: current_user is the
--    function's owner there, never an API role). Everything else of the pilot guard stays.
-- -----------------------------------------------------------------------------
create or replace function private.wish_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.wishlist_id is distinct from old.wishlist_id and current_user in ('anon', 'authenticated') then
    raise exception using message = 'not_allowed';
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- 4. list_photos: the table (a copy of occasion_photos / wish_photos, keyed by the list)
-- -----------------------------------------------------------------------------
create table public.list_photos (
  wishlist_id uuid primary key references public.wishlists(id) on delete cascade,
  mime        text not null check (mime in ('image/webp', 'image/jpeg')),
  bytes       bytea not null check (octet_length(bytes) between 1 and 409600),
  width       smallint not null check (width between 1 and 2048),
  height      smallint not null check (height between 1 and 2048),
  updated_at  timestamptz not null default now(),
  updated_by  uuid not null references public.profiles(id) on delete cascade
);
create index list_photos_updated_by_idx on public.list_photos (updated_by);
alter table public.list_photos alter column bytes set storage external;
comment on table public.list_photos is
  'Cover photo of a wishlist (one per list). No grants for anon/authenticated, RLS forced without a policy: read and written only through set_/remove_/get_list_photo() and export_my_list_photos(). Deleted with its list (and so with its occasion and owner account) by cascade.';

revoke all on public.list_photos from public, anon, authenticated;
alter table public.list_photos enable row level security;
alter table public.list_photos force  row level security;
-- deliberately no policy (= deny every row to every API role); the security definer RPCs are the only way in.

-- -----------------------------------------------------------------------------
-- 5. Helpers (definer; never executable by an API role). Both depend on the list / the wish only — never on
--    reservations.
-- -----------------------------------------------------------------------------

-- the cover photo's meta of a list in every answer that carries the list; null without a photo
create or replace function private.list_photo_meta(p_list uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
    from public.list_photos ph where ph.wishlist_id = p_list;
$$;

-- the 20261022120000 helper + received_at (the one place that builds the newer keys of a wish)
create or replace function private.wish_detail_fields(p_wish public.wishes)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'description', p_wish.description, 'brand', p_wish.brand, 'color', p_wish.color,
    'gtin', p_wish.gtin, 'shop_name', p_wish.shop_name,
    'received_at', p_wish.received_at,
    -- the photo's meta (the bytes: get_wish_photo); null without a photo
    'photo', (select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
                from public.wish_photos ph where ph.wish_id = p_wish.id));
$$;

-- -----------------------------------------------------------------------------
-- 6. List photo RPCs (the wish-photo bodies, keyed by the list)
-- -----------------------------------------------------------------------------

-- set_list_photo(): the list owner puts (or replaces) the cover. The input is checked BEFORE any lock is taken;
-- the answer for a bad input depends on the input only.
create or replace function public.set_list_photo(
  p_list_id uuid, p_mime text, p_data_base64 text, p_width integer, p_height integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_bytes bytea;
  v_dimensions integer[];
  v_at    timestamptz;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;

  -- 546136 = the base64 length of 409600 bytes; the stated size must be a real one
  if p_mime is null or p_mime not in ('image/webp', 'image/jpeg')
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

  -- first lock: the own profile row (lock order of v1.1); then the list FOR KEY SHARE
  perform private.lock_profile_pair(v_uid, v_uid);
  perform wl.id from public.wishlists wl where wl.id = p_list_id and wl.owner_id = v_uid for key share;
  if not found then raise exception using message = 'not_found'; end if;   -- foreign / unknown / gone: one answer

  -- quota: at most 30 own lists with a photo (replacing an existing photo is always fine)
  if not exists (select 1 from public.list_photos ph where ph.wishlist_id = p_list_id)
     and (select count(*) from public.list_photos ph
            join public.wishlists wl on wl.id = ph.wishlist_id
           where wl.owner_id = v_uid) >= 30 then
    raise exception using message = 'photo_limit';
  end if;

  v_at := clock_timestamp();
  insert into public.list_photos as ph (wishlist_id, mime, bytes, width, height, updated_at, updated_by)
  values (p_list_id, p_mime, v_bytes, v_dimensions[1], v_dimensions[2], v_at, v_uid)
  on conflict (wishlist_id) do update
    set mime = excluded.mime, bytes = excluded.bytes, width = excluded.width, height = excluded.height,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'updated_at', v_at);
end $$;

-- remove_list_photo(): the list owner takes the cover away. Idempotent. No consent check (removing own data).
create or replace function public.remove_list_photo(p_list_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  perform wl.id from public.wishlists wl where wl.id = p_list_id and wl.owner_id = v_uid for key share;
  if not found then raise exception using message = 'not_found'; end if;
  delete from public.list_photos ph where ph.wishlist_id = p_list_id;
  return jsonb_build_object('ok', true);
end $$;

-- get_list_photo(): the bytes, for exactly the people who may read the list. Everyone else, and a missing photo:
-- 'not_found' (one answer).
create or replace function public.get_list_photo(p_list_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_ph  record;
begin
  if p_list_id is null or not private.can_read_wishlist(p_list_id, v_uid) then
    raise exception using message = 'not_found';
  end if;
  select ph.mime, ph.bytes, ph.width, ph.height, ph.updated_at into v_ph
    from public.list_photos ph where ph.wishlist_id = p_list_id;
  if not found then raise exception using message = 'not_found'; end if;
  return jsonb_build_object(
    'mime', v_ph.mime,
    'data', replace(encode(v_ph.bytes, 'base64'), E'\n', ''),   -- one line (encode() wraps at 76 chars)
    'width', v_ph.width, 'height', v_ph.height, 'updated_at', v_ph.updated_at);
end $$;

-- export_my_list_photos(): DSGVO Art. 15 / 20 — the covers of the caller's OWN lists, with the bytes. Needs no
-- current consents (like export_my_data).
create or replace function public.export_my_list_photos()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'wishlist_id', ph.wishlist_id, 'list_title', coalesce(wl.title, o.title), 'occasion_id', wl.occasion_id,
             'mime', ph.mime, 'width', ph.width, 'height', ph.height, 'size_bytes', octet_length(ph.bytes),
             'updated_at', ph.updated_at,
             'data_base64', replace(encode(ph.bytes, 'base64'), E'\n', ''))
             order by wl.created_at, ph.wishlist_id), '[]'::jsonb)
    from public.list_photos ph
    join public.wishlists wl on wl.id = ph.wishlist_id
    left join public.occasions o on o.id = wl.occasion_id
    where wl.owner_id = v_uid);
end $$;

-- -----------------------------------------------------------------------------
-- 7. set_wish_received(p_wish_id, p_received) -> { ok, received_at } — the list owner only (anybody else, an
--    unknown wish: not_found). Marking keeps the first received_at (idempotent); un-marking clears it. Never
--    touches reservations: the answer is the same with or without them.
-- -----------------------------------------------------------------------------
create or replace function public.set_wish_received(p_wish_id uuid, p_received boolean)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_at  timestamptz;
begin
  if p_received is null then raise exception using message = 'validation'; end if;
  -- the owner's profile row first: reserve_wish takes it too (pair lock with the recipient = the owner), so a
  -- reservation and the mark never interleave (no new reservation lands on a just received wish)
  perform private.lock_profile_pair(v_uid, v_uid);
  update public.wishes w
     set received_at = case when p_received then coalesce(w.received_at, clock_timestamp()) end
   where w.id = p_wish_id
     and exists (select 1 from public.wishlists wl where wl.id = w.wishlist_id and wl.owner_id = v_uid)
  returning w.received_at into v_at;
  if not found then raise exception using message = 'not_found'; end if;   -- foreign / unknown / gone: one answer
  return jsonb_build_object('ok', true, 'received_at', v_at);
end $$;

-- -----------------------------------------------------------------------------
-- 8. move_wish(p_wish_id, p_target_list_id) -> { ok } — see C) in the header.
-- -----------------------------------------------------------------------------
create or replace function public.move_wish(p_wish_id uuid, p_target_list_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_from record;
  v_to   record;
begin
  -- first lock: the own profile row (every reservation on my lists, my deletes and every access change wait here)
  perform private.lock_profile_pair(v_uid, v_uid);
  -- the source: a wish on one of MY lists (the list FOR KEY SHARE)
  select wl.id, wl.recipient_id into v_from
    from public.wishes w join public.wishlists wl on wl.id = w.wishlist_id
   where w.id = p_wish_id and wl.owner_id = v_uid
     for key share of wl;
  if not found then raise exception using message = 'not_found'; end if;   -- foreign / unknown wish: one answer
  -- the target: one of MY lists (FOR KEY SHARE)
  select wl.id, wl.recipient_id, wl.visibility into v_to
    from public.wishlists wl where wl.id = p_target_list_id and wl.owner_id = v_uid
     for key share;
  if not found or v_to.recipient_id is distinct from v_from.recipient_id then
    raise exception using message = 'not_found';                              -- foreign / unknown list: one answer
  end if;
  if v_to.id = v_from.id then return jsonb_build_object('ok', true); end if;   -- nothing to do
  -- widening the audience needs the current legal records; moving into "Nur ich" never does
  if v_to.visibility <> 'private' and not private.has_consents(v_uid) then
    raise exception using message = 'consent_required';
  end if;

  update public.wishes w set wishlist_id = v_to.id where w.id = p_wish_id and w.wishlist_id = v_from.id;
  if not found then raise exception using message = 'not_found'; end if;

  -- INV-1 "no access, no reservation": the giver who can read the new list keeps the reservation (it follows the
  -- wish); every other active reservation of this wish ends as 'wish_moved'. Writes only into reservations; the
  -- answer is the same whatever happened here.
  update public.reservations r set wishlist_id = v_to.id
   where r.wish_id = p_wish_id and r.status = 'active' and private.can_read_wishlist(v_to.id, r.reserver_id);
  update public.reservations r set status = 'ended', end_reason = 'wish_moved', ended_at = now()
   where r.wish_id = p_wish_id and r.status = 'active' and r.wishlist_id is distinct from v_to.id;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 9. reserve_wish(): the 20261022120000 body + "a received wish is never newly reserved" (read under the locks,
--    after the idempotent step) + the cap of 5 counts only reservations of wishes that are not received.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_wish(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish record;                  -- not %rowtype (strict_multi_assignment): wishes grows, 10 columns are selected
  v_wl   record;                  -- not %rowtype (strict_multi_assignment, follows-design §0.4 item 4)
  v_vis  text;
  v_title text;
  v_received timestamptz;
  v_id   uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then
    -- An account deletion can commit between the initial require_user/consent checks and this statement.
    -- Preserve the deleted-account refusal instead of mislabelling it as an incomplete live profile.
    perform private.require_user();
    raise exception using message = 'profile_incomplete';
  end if;

  select w.id, w.wishlist_id, w.title, w.price_cents, w.currency, w.url, w.note, w.priority, w.created_at, w.updated_at into v_wish from public.wishes w where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  select wl.id, wl.occasion_id, wl.owner_id, wl.recipient_id, wl.title, wl.created_at, wl.updated_at into v_wl from public.wishlists wl where wl.id = v_wish.wishlist_id;
  if not found then raise exception using message = 'not_found'; end if;

  -- 1) owner / recipient: ALWAYS not_allowed, decided before the audience or reservations are looked at
  if v_uid in (v_wl.owner_id, v_wl.recipient_id) then raise exception using message = 'not_allowed'; end if;

  perform private.lock_profile_pair(v_uid, v_wl.recipient_id);
  if v_wl.occasion_id is not null then
    -- 2a) an occasion's list (the pilot access rules, plus post-lock identity checks).
    -- Revocation must wait for this transaction, then end the just-created reservation.
    perform m.profile_id from public.occasion_members m
     where m.occasion_id = v_wl.occasion_id and m.profile_id = v_uid and m.status = 'active' for share;
    if not found then raise exception using message = 'not_allowed'; end if;

    -- Client-selected UUIDs can be reused after deletion while the profile lock waits. Lock and verify the
    -- same list identity and wish membership, not merely the existence of those UUIDs (B1 / Codex #1).
    -- (A wish moved away meanwhile is no longer on this list: not_found.)
    perform wl.id from public.wishlists wl where wl.id = v_wl.id
      and wl.owner_id = v_wl.owner_id and wl.recipient_id = v_wl.recipient_id
      and wl.occasion_id is not distinct from v_wl.occasion_id for key share;
    if not found then raise exception using message = 'not_found'; end if;
    select w.title, w.received_at into v_title, v_received from public.wishes w
      where w.id = p_wish_id and w.wishlist_id = v_wl.id for key share;
    if not found then raise exception using message = 'not_found'; end if;

    -- not an active member of the occasion, or blocked with the owner/recipient: the same code
    if not private.is_active_member(v_wl.occasion_id, v_uid)
       or private.is_blocked_pair(v_uid, v_wl.owner_id)
       or private.is_blocked_pair(v_uid, v_wl.recipient_id) then
      raise exception using message = 'not_allowed';
    end if;
  else
    -- 2b) a list without an occasion: the follower path. The accepted follow row FOR SHARE — unfollow,
    --     remove_follower and block_user (they delete it) and the red button (LOCK TABLE follows) wait for us.
    perform f.follower_id from public.follows f
     where f.follower_id = v_uid and f.followee_id = v_wl.owner_id and f.status = 'accepted' for share;
    if not found then
      -- C19: deleting the owner also deletes the wish and follow while we wait. Match a wish deleted earlier.
      if not exists (select 1 from public.wishes w where w.id = p_wish_id) then
        raise exception using message = 'not_found';
      end if;
      raise exception using message = 'not_allowed';
    end if;
    -- the visibility BY NAME, under the pair lock (it changes only under the owner's profile lock)
    select wl.visibility into v_vis from public.wishlists wl where wl.id = v_wl.id
      and wl.owner_id = v_wl.owner_id and wl.recipient_id = v_wl.recipient_id
      and wl.occasion_id is not distinct from v_wl.occasion_id for key share;
    if not found then raise exception using message = 'not_found'; end if;
    select w.title, w.received_at into v_title, v_received from public.wishes w
      where w.id = p_wish_id and w.wishlist_id = v_wl.id for key share;
    if not found then raise exception using message = 'not_found'; end if;
    -- "Nur ich", the red button (§9) or a block: the same code as for everybody without access
    if v_vis <> 'followers' or not private.follower_lists_on()
       or private.is_blocked_pair(v_uid, v_wl.owner_id) or private.is_blocked_pair(v_uid, v_wl.recipient_id) then
      raise exception using message = 'not_allowed';
    end if;
  end if;

  -- 3) the same person pressing again: idempotent (also on a wish received meanwhile — nothing changes)
  if exists (select 1 from public.reservations r
             where r.wish_id = p_wish_id and r.status = 'active' and r.reserver_id = v_uid) then
    return jsonb_build_object('ok', true);
  end if;

  -- 3a) the owner marked the wish as received (read under the owner's profile lock, which set_wish_received
  --     takes first): never newly reserved — the code of every wish the caller may not reserve
  if v_received is not null then raise exception using message = 'not_allowed'; end if;

  -- 3b) the follower path only: at most 5 active reservations of one giver for one recipient on lists without an
  --     occasion (S19). Only the giver's OWN rows are counted (reservations of received wishes no longer count);
  --     the pair is locked, so two tabs cannot make a 6th (C22). The owner never gets here (step 1).
  if v_wl.occasion_id is null and (select count(*) from public.reservations r
        join public.wishlists x on x.id = r.wishlist_id
        join public.wishes cw on cw.id = r.wish_id and cw.received_at is null
       where r.reserver_id = v_uid and r.recipient_id = v_wl.recipient_id
         and r.status = 'active' and x.occasion_id is null) >= 5 then
    raise exception using message = 'limit_reached';
  end if;

  -- 4) atomic: a concurrent second insert waits for the first commit, sees the conflict → already_reserved
  insert into public.reservations (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot)
  values (p_wish_id, v_wl.id, v_wl.recipient_id, v_uid, v_title)
  on conflict (wish_id) where status = 'active' do nothing
  returning id into v_id;

  if v_id is null then raise exception using message = 'already_reserved'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 10. Screens: the previous bodies + list `photo` + the split wishes / received. One lateral builds each wish
--     object once (the 20261022120000 keys via private.wish_detail_fields, now with received_at).
-- -----------------------------------------------------------------------------

-- get_occasion_screen(): the 20261022120000 body; wishlist + photo + received.
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
      'host', jsonb_build_object('id', v_occ.host_id, 'display_name', v_host_name),
      -- the cover photo's meta (the bytes: get_occasion_photo); null without a photo
      'photo', (select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
                  from public.occasion_photos ph where ph.occasion_id = v_occ.id)),
    'viewer', jsonb_build_object('role', v_me.role, 'rsvp', v_me.rsvp),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'display_name', p.display_name, 'role', m.role, 'rsvp', m.rsvp)
                                order by m.joined_at, p.id), '[]'::jsonb)
      from public.occasion_members m
      join public.profiles p on p.id = m.profile_id
      where m.occasion_id = p_occasion_id and m.status = 'active' and not private.is_blocked_pair(v_uid, p.id)),
    'invite', v_invite,
    'wishlist', v_wishlist);
end $$;

-- get_list_screen(): the 20261022120000 body; list + photo, top-level received.
create or replace function public.get_list_screen(p_list_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_wl       record;
  v_role     text;
  v_wishes   jsonb;
  v_received jsonb;
begin
  select wl.id, wl.owner_id, wl.recipient_id, wl.title, wl.visibility, wl.cover_tone, wl.cover_icon, wl.due_on, wl.created_at
    into v_wl from public.wishlists wl where wl.id = p_list_id and wl.occasion_id is null;
  if not found or not private.can_read_wishlist(v_wl.id, v_uid) then
    raise exception using message = 'not_found';
  end if;
  if v_uid in (v_wl.owner_id, v_wl.recipient_id) then
    v_role := 'owner';
    -- OWNER BRANCH: literal nulls only, the secret table is never read here
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
    -- (only an accepted follower of a 'followers' list gets past can_read_wishlist above)
    v_role := 'follower';
    -- FOLLOWER BRANCH: only "taken" and "taken by me" — never who
    select coalesce(jsonb_agg(x.j order by w.priority desc, w.created_at asc, w.id) filter (where w.received_at is null), '[]'::jsonb),
           coalesce(jsonb_agg(x.j order by w.received_at desc, w.id) filter (where w.received_at is not null), '[]'::jsonb)
      into v_wishes, v_received
      from public.wishes w
      left join public.reservations r on r.wish_id = w.id and r.status = 'active'
      cross join lateral (select jsonb_build_object(
             'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
             'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
             'reserved', (r.id is not null), 'reserved_by_me', coalesce(r.reserver_id = v_uid, false)) || private.wish_detail_fields(w) as j) x
     where w.wishlist_id = v_wl.id;
  end if;
  return jsonb_build_object(
    'list', jsonb_build_object('id', v_wl.id, 'title', v_wl.title, 'kind', 'standalone', 'visibility', v_wl.visibility,
              'cover_tone', v_wl.cover_tone, 'cover_icon', v_wl.cover_icon, 'due_on', v_wl.due_on,
              'created_at', v_wl.created_at, 'owner', private.profile_card(v_wl.owner_id),
              'photo', private.list_photo_meta(v_wl.id)),
    'viewer', jsonb_build_object('role', v_role),
    'wishes', v_wishes,
    'received', v_received);
end $$;

-- get_free_wishes(): the 20261022120000 body; received wishes are no gift ideas any more; list + photo.
create or replace function public.get_free_wishes(p_profile_id uuid, p_max_cents integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_max_cents is not null and p_max_cents not between 0 and 100000000 then
    raise exception using message = 'validation';
  end if;
  if not private.can_find_gift(v_uid, p_profile_id) then
    raise exception using message = 'not_found';      -- myself, a stranger, a blocked person: one answer
  end if;
  return jsonb_build_object('person', private.profile_card(p_profile_id), 'ideas', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'wish_id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
             'priority', w.priority, 'created_at', w.created_at,
             'list', jsonb_build_object('id', wl.id, 'title', coalesce(wl.title, o.title),
                       'kind', case when wl.occasion_id is null then 'standalone' else 'occasion' end,
                       'date', coalesce(wl.due_on, (o.starts_at at time zone o.tz)::date),
                       'occasion_id', wl.occasion_id,
                       'photo', private.list_photo_meta(wl.id))) || private.wish_detail_fields(w)
             order by coalesce(wl.due_on, (o.starts_at at time zone o.tz)::date) asc nulls last,
                      w.priority desc, w.price_cents asc nulls last, w.created_at asc, w.id), '[]'::jsonb)
      from public.wishlists wl
      join public.wishes w on w.wishlist_id = wl.id
      left join public.occasions o on o.id = wl.occasion_id
     where wl.owner_id = p_profile_id and wl.recipient_id <> v_uid
       and private.can_read_wishlist(wl.id, v_uid)
       and (wl.occasion_id is null
            or coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) >= now())
       and w.received_at is null
       and not exists (select 1 from public.reservations r where r.wish_id = w.id and r.status = 'active')
       and (p_max_cents is null or w.price_cents is null or w.price_cents <= p_max_cents)));
end $$;

-- private.my_wishlists_export(): the 20261022120000 body + the list's photo meta (the bytes:
-- export_my_list_photos(), added to the export file by the client). received_at comes with wish_detail_fields.
create or replace function private.my_wishlists_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', wl.id, 'occasion_id', wl.occasion_id, 'owner_id', wl.owner_id, 'recipient_id', wl.recipient_id,
           'title', wl.title, 'visibility', wl.visibility, 'cover_tone', wl.cover_tone, 'cover_icon', wl.cover_icon,
           'due_on', wl.due_on, 'created_at', wl.created_at, 'updated_at', wl.updated_at,
           'photo', private.list_photo_meta(wl.id),
           'wishes', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', w.id, 'wishlist_id', w.wishlist_id, 'title', w.title, 'price_cents', w.price_cents,
                        'currency', w.currency, 'url', w.url, 'note', w.note, 'priority', w.priority,
                        'created_at', w.created_at, 'updated_at', w.updated_at) || private.wish_detail_fields(w)
                        order by w.priority desc, w.created_at, w.id), '[]'::jsonb)
                      from public.wishes w where w.wishlist_id = wl.id))
           order by wl.created_at, wl.id), '[]'::jsonb)
  from public.wishlists wl where wl.owner_id = auth.uid();
$$;

-- private.follower_list_cards(): the 20261020200200 body + photo (get_lists_overview.following[].lists and
-- get_profile_card.lists).
create or replace function private.follower_list_cards(p_owner uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', wl.id, 'title', wl.title, 'cover_tone', wl.cover_tone, 'cover_icon', wl.cover_icon, 'due_on', wl.due_on,
           'photo', private.list_photo_meta(wl.id),
           'wish_count', (select count(*) from public.wishes w where w.wishlist_id = wl.id),
           'new_wish_count', (select count(*) from public.wishes w
                               where w.wishlist_id = wl.id and w.created_at > now() - interval '7 days'))
           order by case when wl.due_on >= (now() at time zone 'Europe/Berlin')::date then 0 else 1 end,
                    case when wl.due_on >= (now() at time zone 'Europe/Berlin')::date then wl.due_on end asc,
                    wl.created_at desc, wl.id), '[]'::jsonb)
    from public.wishlists wl
   where wl.owner_id = p_owner and wl.visibility = 'followers' and wl.occasion_id is null
     and private.can_read_wishlist(wl.id, p_viewer);
$$;

-- get_lists_overview(): the 20261020200200 body + my_lists[].photo and upcoming[].list.photo (following[].lists
-- through follower_list_cards above). Still not one word about the secret table (F18).
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
  select coalesce(jsonb_agg(jsonb_build_object('profile', jsonb_build_object('id', s.id, 'display_name', s.display_name),
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

-- my_reservations(): the 20261020200200 body + received_at of the wish (live while the giver may read the list,
-- like the title; else null). The giver sees "Erhalten" next to their reservation.
create or replace function public.my_reservations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'wish_id', r.wish_id,
             'wish_title', coalesce(w.title, r.wish_title_snapshot),
             'occasion_id', o.id, 'occasion_title', o.title, 'starts_at', o.starts_at,
             'status', r.status, 'end_reason', r.end_reason, 'created_at', r.created_at,
             'received_at', w.received_at,
             'list', case when wl.id is not null and wl.occasion_id is null then jsonb_build_object(
                       'id', wl.id, 'title', wl.title,
                       'owner_name', (select p.display_name from public.profiles p where p.id = wl.owner_id)) end)
             order by r.created_at desc, r.id), '[]'::jsonb)
    from public.reservations r
    left join public.wishlists wl on wl.id = r.wishlist_id and wl.recipient_id = r.recipient_id
      and private.can_read_wishlist(wl.id, v_uid)
    left join public.wishes w on w.id = r.wish_id and w.wishlist_id = r.wishlist_id and wl.id is not null
    left join public.occasions o on o.id = wl.occasion_id
    where r.reserver_id = v_uid
      and (r.status = 'active'
           or (r.status = 'ended' and r.end_reason <> 'by_reserver' and r.ended_at >= now() - interval '90 days'))
  );
end $$;

-- -----------------------------------------------------------------------------
-- 11. Privileges: the new RPCs for authenticated only; the new helper for nobody but the definer functions.
--     (Re-created functions keep their privileges: CREATE OR REPLACE does not touch them.)
-- -----------------------------------------------------------------------------
revoke execute on function
  public.set_list_photo(uuid, text, text, integer, integer), public.remove_list_photo(uuid),
  public.get_list_photo(uuid), public.export_my_list_photos(),
  public.set_wish_received(uuid, boolean), public.move_wish(uuid, uuid)
  from public, anon;
grant execute on function
  public.set_list_photo(uuid, text, text, integer, integer), public.remove_list_photo(uuid),
  public.get_list_photo(uuid), public.export_my_list_photos(),
  public.set_wish_received(uuid, boolean), public.move_wish(uuid, uuid)
  to authenticated;
revoke execute on all functions in schema private from public, anon;
revoke execute on function private.list_photo_meta(uuid) from authenticated;
