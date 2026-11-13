-- =============================================================================
-- Bunprise: wish DETAILS (from a shop link) and a wish PHOTO, stored IN POSTGRES (not in Supabase Storage).
-- Forward only: every earlier migration stays untouched. NOT applied to the hosted project:
-- `supabase db push` only after Felix's OK (and after the privacy texts mention shop images, see below).
--
-- What (Felix 2026-10-22): a wish created from a shop link shows the product photo; tapping a wish opens a sheet
-- with description, colour, brand, the shop's name + link, and "compare in other shops" search links (idealo /
-- Google Shopping / Amazon / eBay by title or GTIN — built in the client, no live prices, no request to a shop).
--
-- 1. public.wishes gets five nullable text columns, all owner-written, readable by exactly the people who may read
--    the wish (the existing wishes_select policy / can_read_wishlist and the screen RPCs):
--      description (1..1000), brand (1..80), color (1..60), gtin (8..14 digits), shop_name (1..80; e.g. "Zalando").
--    Style of v1.1 (pilot-decisions §0 item 7): length of the raw string + btrim(...) <> '' (an empty field = null).
-- 2. The photo follows the occasion-cover pattern EXACTLY (20261020160000_occasion_photos.sql, ADR
--    docs/decisions/2026-10-20-occasion-photos-in-postgres.md; Felix's decision 2026-10-20: photos in Postgres):
--    table public.wish_photos (one per wish, bytea), no grant for anon / authenticated, RLS forced without a policy,
--    on delete cascade from the wish (wish, list, occasion or account deleted -> the photo goes in the same
--    transaction; nothing can orphan, nothing stays readable). Same limits: webp/jpeg after the client's re-encode,
--    1 .. 409600 decoded bytes, 1 .. 2048 px, dimensions parsed from the bytes (private.photo_dimensions).
--    Quota: at most 100 wishes with a photo per list owner ('photo_limit'; replacing a photo is always fine).
--    So there is NO `image_path` column: a wish's photo is `photo = { width, height, updated_at } | null` in every
--    RPC that returns wishes (like occasion.photo), and the bytes come lazily from get_wish_photo().
--      set_wish_photo(p_wish_id, p_mime, p_data_base64, p_width, p_height) -> { ok, updated_at }   list owner only
--      remove_wish_photo(p_wish_id)                                        -> { ok }               list owner only
--      get_wish_photo(p_wish_id) -> { mime, data (base64), width, height, updated_at }  whoever may read the wish
--      export_my_wish_photos()   -> [ { wish_id, wish_title, wishlist_id, mime, width, height, size_bytes,
--                                       updated_at, data_base64 } ]  photos on the caller's OWN wishes
--    Everybody who may not read the wish (outsider, former member, unfollowed, "Nur ich", blocked pair, unknown
--    wish) gets 'not_found' — the same answer as "there is no photo", so the RPC is no oracle. A write by anyone
--    but the list owner is 'not_found' too.
-- 3. Every function that returns wish rows is re-created with the new keys (one helper builds them, so later
--    columns change in ONE place): get_occasion_screen (owner + member branch; keeps occasion.photo),
--    get_list_screen (owner + follower branch), get_free_wishes, private.my_wishlists_export (the DSGVO export).
--    The new keys depend on the wish row and its photo only — never on reservations: the owner's answers stay
--    byte-identical whatever the reservations are (packages/db-tests/test/lists/owner-bytes.test.ts and
--    test/pilot/wish-details.test.ts).
-- 4. reserve_wish / cancel_reservation: `v_wish public.wishes%rowtype` becomes `record` (wishes has 15 columns
--    now, 10 are selected; strict_multi_assignment would turn the old bodies into an error). Nothing else changes.
--
-- Not touched: get_feed (counts only), my_reservations (titles only), export_my_data (calls my_wishlists_export).
--
-- Lock order of the photo writes (the same first lock as every relationship write since v1.1): own profile row
-- (private.lock_profile_pair) -> the list row FOR KEY SHARE -> the wish row FOR KEY SHARE -> the photo row.
-- A REST delete of the wish takes the owner's profile lock first (wishes_lock_owned_delete), so an upload and a
-- delete queue on the profile row: the delete then cascades the new photo away, or the upload answers not_found —
-- never a raw 23503 (packages/db-tests/test/concurrency/wish-photos.test.ts).
--
-- PRIVACY: the photo is a picture of a shop's product, fetched by OUR Worker (POST /api/link-image), downscaled
-- in the owner's browser and uploaded here; friends' browsers only ever talk to Supabase. pilot-decisions §00
-- item 3 said "link previews without shop images" — Felix changed that on 2026-10-22; the Datenschutz paragraph
-- on link previews must mention the image before this migration is pushed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. wishes: the details
-- -----------------------------------------------------------------------------
alter table public.wishes
  add column description text check (description is null or (length(description) between 1 and 1000 and btrim(description) <> '')),
  add column brand       text check (brand is null or (length(brand) between 1 and 80 and btrim(brand) <> '')),
  add column color       text check (color is null or (length(color) between 1 and 60 and btrim(color) <> '')),
  add column gtin        text check (gtin is null or gtin ~ '^[0-9]{8,14}$'),
  add column shop_name   text check (shop_name is null or (length(shop_name) between 1 and 80 and btrim(shop_name) <> ''));

comment on column public.wishes.description is 'Product description (owner-written or from the link preview), 1..1000 chars.';
comment on column public.wishes.brand is 'Brand / maker, 1..80 chars.';
comment on column public.wishes.color is 'Colour / variant, 1..60 chars.';
comment on column public.wishes.gtin is 'GTIN / EAN (8..14 digits): the client builds "compare in other shops" search links from it.';
comment on column public.wishes.shop_name is 'Display name of the shop of `url` (e.g. "Zalando"), 1..80 chars.';

-- REST: the same readers as the other wish columns (wishes_select = can_read_wishlist), the owner writes
-- (wishes_update / wishes_insert stay owner-only; INSERT is still the pilot's table grant).
grant select (description, brand, color, gtin, shop_name) on public.wishes to authenticated;
grant update (description, brand, color, gtin, shop_name) on public.wishes to authenticated;

-- -----------------------------------------------------------------------------
-- 2. wish_photos: the table (a copy of occasion_photos, keyed by the wish)
-- -----------------------------------------------------------------------------
create table public.wish_photos (
  wish_id     uuid primary key references public.wishes(id) on delete cascade,
  mime        text not null check (mime in ('image/webp', 'image/jpeg')),
  bytes       bytea not null check (octet_length(bytes) between 1 and 409600),
  width       smallint not null check (width between 1 and 2048),
  height      smallint not null check (height between 1 and 2048),
  updated_at  timestamptz not null default now(),
  updated_by  uuid not null references public.profiles(id) on delete cascade
);
create index wish_photos_updated_by_idx on public.wish_photos (updated_by);
alter table public.wish_photos alter column bytes set storage external;
comment on table public.wish_photos is
  'Product photo of a wish (one per wish). No grants for anon/authenticated, RLS forced without a policy: read and written only through set_/remove_/get_wish_photo() and export_my_wish_photos(). Deleted with its wish (and so with its list, occasion and owner account) by cascade.';

revoke all on public.wish_photos from public, anon, authenticated;
alter table public.wish_photos enable row level security;
alter table public.wish_photos force  row level security;
-- deliberately no policy (= deny every row to every API role); the security definer RPCs are the only way in.

-- -----------------------------------------------------------------------------
-- 3. The helper that builds the new keys of a wish in every RPC answer. Depends on the wish row and its photo
--    only (never on reservations). Called only from security definer code.
-- -----------------------------------------------------------------------------
create or replace function private.wish_detail_fields(p_wish public.wishes)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'description', p_wish.description, 'brand', p_wish.brand, 'color', p_wish.color,
    'gtin', p_wish.gtin, 'shop_name', p_wish.shop_name,
    -- the photo's meta (the bytes: get_wish_photo); null without a photo
    'photo', (select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
                from public.wish_photos ph where ph.wish_id = p_wish.id));
$$;

-- -----------------------------------------------------------------------------
-- 4. Photo RPCs
-- -----------------------------------------------------------------------------

-- set_wish_photo(): the list owner puts (or replaces) the photo. The input is checked BEFORE any lock is taken;
-- the answer for a bad input depends on the input only.
create or replace function public.set_wish_photo(
  p_wish_id uuid, p_mime text, p_data_base64 text, p_width integer, p_height integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_list  uuid;
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

  -- first lock: the own profile row (lock order of v1.1); then the list, then the wish (both FOR KEY SHARE).
  perform private.lock_profile_pair(v_uid, v_uid);
  select w.wishlist_id into v_list from public.wishes w where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  perform wl.id from public.wishlists wl where wl.id = v_list and wl.owner_id = v_uid for key share;
  if not found then raise exception using message = 'not_found'; end if;   -- foreign / unknown: one answer
  perform w.id from public.wishes w where w.id = p_wish_id and w.wishlist_id = v_list for key share;
  if not found then raise exception using message = 'not_found'; end if;   -- deleted while we waited

  -- quota: at most 100 own wishes with a photo (replacing an existing photo is always fine)
  if not exists (select 1 from public.wish_photos ph where ph.wish_id = p_wish_id)
     and (select count(*) from public.wish_photos ph
            join public.wishes w on w.id = ph.wish_id
            join public.wishlists wl on wl.id = w.wishlist_id
           where wl.owner_id = v_uid) >= 100 then
    raise exception using message = 'photo_limit';
  end if;

  v_at := clock_timestamp();
  insert into public.wish_photos as ph (wish_id, mime, bytes, width, height, updated_at, updated_by)
  values (p_wish_id, p_mime, v_bytes, v_dimensions[1], v_dimensions[2], v_at, v_uid)
  on conflict (wish_id) do update
    set mime = excluded.mime, bytes = excluded.bytes, width = excluded.width, height = excluded.height,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'updated_at', v_at);
end $$;

-- remove_wish_photo(): the list owner takes the photo away. Idempotent. No consent check (removing own data).
create or replace function public.remove_wish_photo(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_list uuid;
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  select w.wishlist_id into v_list from public.wishes w where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  perform wl.id from public.wishlists wl where wl.id = v_list and wl.owner_id = v_uid for key share;
  if not found then raise exception using message = 'not_found'; end if;
  perform w.id from public.wishes w where w.id = p_wish_id and w.wishlist_id = v_list for key share;
  if not found then raise exception using message = 'not_found'; end if;
  delete from public.wish_photos ph where ph.wish_id = p_wish_id;
  return jsonb_build_object('ok', true);
end $$;

-- get_wish_photo(): the bytes, for exactly the people who may read the wish (can_read_wishlist: the owner; an
-- active member of the occasion; an accepted follower of a 'followers' list while the red button is off; never
-- across a block). Everyone else, and a missing photo: 'not_found' (one answer).
create or replace function public.get_wish_photo(p_wish_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_list uuid;
  v_ph   record;
begin
  select w.wishlist_id into v_list from public.wishes w where w.id = p_wish_id;
  if not found or not private.can_read_wishlist(v_list, v_uid) then
    raise exception using message = 'not_found';
  end if;
  select ph.mime, ph.bytes, ph.width, ph.height, ph.updated_at into v_ph
    from public.wish_photos ph where ph.wish_id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  return jsonb_build_object(
    'mime', v_ph.mime,
    'data', replace(encode(v_ph.bytes, 'base64'), E'\n', ''),   -- one line (encode() wraps at 76 chars)
    'width', v_ph.width, 'height', v_ph.height, 'updated_at', v_ph.updated_at);
end $$;

-- export_my_wish_photos(): DSGVO Art. 15 / 20 — the photos on the caller's OWN wishes, with the bytes. Never
-- photos of other people's wishes. Needs no current consents (like export_my_data).
create or replace function public.export_my_wish_photos()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'wish_id', ph.wish_id, 'wish_title', w.title, 'wishlist_id', w.wishlist_id, 'mime', ph.mime,
             'width', ph.width, 'height', ph.height, 'size_bytes', octet_length(ph.bytes),
             'updated_at', ph.updated_at,
             'data_base64', replace(encode(ph.bytes, 'base64'), E'\n', ''))
             order by w.created_at, ph.wish_id), '[]'::jsonb)
    from public.wish_photos ph
    join public.wishes w on w.id = ph.wish_id
    join public.wishlists wl on wl.id = w.wishlist_id
    where wl.owner_id = v_uid);
end $$;

-- -----------------------------------------------------------------------------
-- 5. RPCs that return wishes: the previous bodies + `|| private.wish_detail_fields(w)`. Nothing else changes.
-- -----------------------------------------------------------------------------

-- get_occasion_screen(): the 20261020200000 body (keeps occasion.photo of 20261020160000).
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
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
               'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
               'reserved', null::boolean, 'reserved_by_me', null::boolean) || private.wish_detail_fields(w)
               order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
        into v_wishes
        from public.wishes w
       where w.wishlist_id = v_wl.id;
    else
      -- MEMBER BRANCH: availability and own reservation only; no reserver name.
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
               'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
               'reserved', (r.id is not null),
               'reserved_by_me', coalesce(r.reserver_id = v_uid, false)) || private.wish_detail_fields(w)
               order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
        into v_wishes
        from public.wishes w
        left join public.reservations r on r.wish_id = w.id and r.status = 'active'
       where w.wishlist_id = v_wl.id;
    end if;
    v_wishlist := jsonb_build_object('id', v_wl.id, 'owner_id', v_wl.owner_id, 'title', v_wl.title, 'wishes', v_wishes);
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

-- get_list_screen(): the 20261020200200 body.
create or replace function public.get_list_screen(p_list_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_wl     record;
  v_role   text;
  v_wishes jsonb;
begin
  select wl.id, wl.owner_id, wl.recipient_id, wl.title, wl.visibility, wl.cover_tone, wl.cover_icon, wl.due_on, wl.created_at
    into v_wl from public.wishlists wl where wl.id = p_list_id and wl.occasion_id is null;
  if not found or not private.can_read_wishlist(v_wl.id, v_uid) then
    raise exception using message = 'not_found';
  end if;
  if v_uid in (v_wl.owner_id, v_wl.recipient_id) then
    v_role := 'owner';
    -- OWNER BRANCH: literal nulls only, the secret table is never read here
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
             'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
             'reserved', null::boolean, 'reserved_by_me', null::boolean) || private.wish_detail_fields(w)
             order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
      into v_wishes from public.wishes w where w.wishlist_id = v_wl.id;
  else
    -- (only an accepted follower of a 'followers' list gets past can_read_wishlist above)
    v_role := 'follower';
    -- FOLLOWER BRANCH: only "taken" and "taken by me" — never who
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
             'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
             'reserved', (r.id is not null), 'reserved_by_me', coalesce(r.reserver_id = v_uid, false)) || private.wish_detail_fields(w)
             order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
      into v_wishes
      from public.wishes w left join public.reservations r on r.wish_id = w.id and r.status = 'active'
     where w.wishlist_id = v_wl.id;
  end if;
  return jsonb_build_object(
    'list', jsonb_build_object('id', v_wl.id, 'title', v_wl.title, 'kind', 'standalone', 'visibility', v_wl.visibility,
              'cover_tone', v_wl.cover_tone, 'cover_icon', v_wl.cover_icon, 'due_on', v_wl.due_on,
              'created_at', v_wl.created_at, 'owner', private.profile_card(v_wl.owner_id)),
    'viewer', jsonb_build_object('role', v_role),
    'wishes', v_wishes);
end $$;

-- get_free_wishes(): the 20261020200300 body. Only free wishes are listed (as before); the new keys describe the
-- wish itself and say nothing about reservations.
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
                       'occasion_id', wl.occasion_id)) || private.wish_detail_fields(w)
             order by coalesce(wl.due_on, (o.starts_at at time zone o.tz)::date) asc nulls last,
                      w.priority desc, w.price_cents asc nulls last, w.created_at asc, w.id), '[]'::jsonb)
      from public.wishlists wl
      join public.wishes w on w.wishlist_id = wl.id
      left join public.occasions o on o.id = wl.occasion_id
     where wl.owner_id = p_profile_id and wl.recipient_id <> v_uid
       and private.can_read_wishlist(wl.id, v_uid)
       and (wl.occasion_id is null
            or coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) >= now())
       and not exists (select 1 from public.reservations r where r.wish_id = w.id and r.status = 'active')
       and (p_max_cents is null or w.price_cents is null or w.price_cents <= p_max_cents)));
end $$;

-- private.my_wishlists_export(): the 20261020200000 body + the new keys (the photo's bytes:
-- export_my_wish_photos(), added to the export file by the client).
create or replace function private.my_wishlists_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', wl.id, 'occasion_id', wl.occasion_id, 'owner_id', wl.owner_id, 'recipient_id', wl.recipient_id,
           'title', wl.title, 'visibility', wl.visibility, 'cover_tone', wl.cover_tone, 'cover_icon', wl.cover_icon,
           'due_on', wl.due_on, 'created_at', wl.created_at, 'updated_at', wl.updated_at,
           'wishes', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', w.id, 'wishlist_id', w.wishlist_id, 'title', w.title, 'price_cents', w.price_cents,
                        'currency', w.currency, 'url', w.url, 'note', w.note, 'priority', w.priority,
                        'created_at', w.created_at, 'updated_at', w.updated_at) || private.wish_detail_fields(w)
                        order by w.priority desc, w.created_at, w.id), '[]'::jsonb)
                      from public.wishes w where w.wishlist_id = wl.id))
           order by wl.created_at, wl.id), '[]'::jsonb)
  from public.wishlists wl where wl.owner_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- 6. reserve_wish / cancel_reservation: `v_wish record` instead of `public.wishes%rowtype` (wishes has 15 columns
--    now; the 10 selected columns into a 15-field rowtype is an error under strict_multi_assignment). The bodies of
--    20261020200200_follow_sharing.sql otherwise unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_wish(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish record;                  -- not %rowtype (strict_multi_assignment): wishes grows, 10 columns are selected
  v_wl   record;                  -- not %rowtype (strict_multi_assignment, follows-design §0.4 item 4)
  v_vis  text;
  v_title text;
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
    perform wl.id from public.wishlists wl where wl.id = v_wl.id
      and wl.owner_id = v_wl.owner_id and wl.recipient_id = v_wl.recipient_id
      and wl.occasion_id is not distinct from v_wl.occasion_id for key share;
    if not found then raise exception using message = 'not_found'; end if;
    select w.title into v_title from public.wishes w
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
    select w.title into v_title from public.wishes w
      where w.id = p_wish_id and w.wishlist_id = v_wl.id for key share;
    if not found then raise exception using message = 'not_found'; end if;
    -- "Nur ich", the red button (§9) or a block: the same code as for everybody without access
    if v_vis <> 'followers' or not private.follower_lists_on()
       or private.is_blocked_pair(v_uid, v_wl.owner_id) or private.is_blocked_pair(v_uid, v_wl.recipient_id) then
      raise exception using message = 'not_allowed';
    end if;
  end if;

  -- 3) the same person pressing again: idempotent
  if exists (select 1 from public.reservations r
             where r.wish_id = p_wish_id and r.status = 'active' and r.reserver_id = v_uid) then
    return jsonb_build_object('ok', true);
  end if;

  -- 3b) the follower path only: at most 5 active reservations of one giver for one recipient on lists without an
  --     occasion (S19). Only the giver's OWN rows are counted; the pair is locked, so two tabs cannot make a 6th
  --     (C22). The owner never gets here (step 1): their answers do not move with the limit (F24).
  if v_wl.occasion_id is null and (select count(*) from public.reservations r
        join public.wishlists x on x.id = r.wishlist_id
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

create or replace function public.cancel_reservation(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish record;   -- not %rowtype (strict_multi_assignment): wishes grows, 10 columns are selected
  v_wl   record;   -- not %rowtype (strict_multi_assignment)
  v_id   uuid;
begin
  select w.id, w.wishlist_id, w.title, w.price_cents, w.currency, w.url, w.note, w.priority, w.created_at, w.updated_at into v_wish from public.wishes w where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  select wl.id, wl.occasion_id, wl.owner_id, wl.recipient_id, wl.title, wl.created_at, wl.updated_at into v_wl from public.wishlists wl where wl.id = v_wish.wishlist_id;

  if v_uid in (v_wl.owner_id, v_wl.recipient_id) then raise exception using message = 'not_allowed'; end if;
  if v_wl.occasion_id is not null then
    if not private.is_active_member(v_wl.occasion_id, v_uid) then raise exception using message = 'not_allowed'; end if;
  elsif not private.can_read_wishlist(v_wl.id, v_uid) then
    raise exception using message = 'not_allowed';
  end if;

  update public.reservations r
     set status = 'ended', end_reason = 'by_reserver', ended_at = now()
   where r.wish_id = p_wish_id and r.wishlist_id = v_wl.id and r.reserver_id = v_uid and r.status = 'active'
  returning r.id into v_id;
  if v_id is null then raise exception using message = 'not_found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 7. Privileges: the four photo RPCs for authenticated only; the helper for nobody but the definer functions.
--    (Re-created functions keep their privileges: CREATE OR REPLACE does not touch them.)
-- -----------------------------------------------------------------------------
revoke execute on function
  public.set_wish_photo(uuid, text, text, integer, integer), public.remove_wish_photo(uuid),
  public.get_wish_photo(uuid), public.export_my_wish_photos()
  from public, anon;
grant execute on function
  public.set_wish_photo(uuid, text, text, integer, integer), public.remove_wish_photo(uuid),
  public.get_wish_photo(uuid), public.export_my_wish_photos()
  to authenticated;
revoke execute on function private.wish_detail_fields(public.wishes) from public, anon, authenticated;
