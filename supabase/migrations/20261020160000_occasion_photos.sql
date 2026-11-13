-- =============================================================================
-- Bunprise wave 2 (agent G): an occasion's cover PHOTO, stored IN POSTGRES (not in Supabase Storage).
-- Forward only: every earlier migration stays untouched. NOT applied to the hosted project:
-- `supabase db push` only after Felix's OK.
--
-- Why Postgres and not Storage (decision 2026-10-20, docs/decisions/2026-10-20-occasion-photos-in-postgres.md):
--   * deletion is guaranteed by the foreign keys: occasion deleted -> its photo goes (on delete cascade),
--     host account deleted -> profile -> occasions -> photos go in the same transaction; nothing can orphan;
--   * access follows EXACTLY the occasion's membership rules, in the same SQL as get_occasion_screen
--     (host or active member, not blocked with the host) - no second rule set, no storage policies,
--     no signed URLs that keep working after a member was removed, no new secrets;
--   * size is bounded twice: the client re-encodes (<= 1600 px, WebP/JPEG <= 400 KB) and the database checks
--     the decoded bytes (1 .. 409600), the type by its magic bytes, the stated size (1 .. 2048 px) and a
--     per-host quota (at most 20 hosted occasions with a photo - a safety net for the free database).
--
-- The table has NO privilege for anon / authenticated and RLS forced with no policy at all (= deny
-- everything): the only paths are the four SECURITY DEFINER RPCs below, with explicit columns.
--   set_occasion_photo(p_occasion_id, p_mime, p_data_base64, p_width, p_height) -> { ok, updated_at }   host only
--   remove_occasion_photo(p_occasion_id)                                       -> { ok }               host only
--   get_occasion_photo(p_occasion_id) -> { mime, data (base64), width, height, updated_at }  host / active member
--   export_my_occasion_photos()       -> [ { occasion_id, occasion_title, mime, width, height, size_bytes,
--                                            updated_at, data_base64 } ]  the caller's own (hosted) photos
-- Refusals are the RPC contract's codes. Everybody who may not see the photo (outsider, former member,
-- blocked pair, unknown occasion) gets 'not_found' - the same answer as "there is no photo", so the RPC is
-- no oracle. A write by anyone but the host is 'not_found' too (like create_invite).
--
-- get_occasion_screen() is re-created with ONE new key: occasion.photo = { width, height, updated_at } | null,
-- so the screen knows at once whether a cover exists and how large it is (no layout shift); the bytes come
-- lazily through get_occasion_photo() after the first paint (the documented exception to "one RPC per
-- screen"). Everything else is the 20261019120500 body, unchanged; reservations are not involved at all.
-- LATER MIGRATIONS that re-create get_occasion_screen must keep `occasion.photo`
-- (packages/db-tests/test/pilot/occasion-photos.test.ts fails otherwise).
-- export_my_data() is NOT changed: the client adds export_my_occasion_photos() to the downloaded file.
--
-- Lock order (the same first lock as every relationship write since v1.1): own profile row
-- (private.lock_profile_pair) -> the occasion row FOR KEY SHARE -> the photo row. KEY SHARE is the lock the
-- insert's foreign-key check takes anyway, taken before the checks: a concurrent delete of the occasion waits
-- for the upload (and then cascades the new photo away), or the upload waits for the delete and answers
-- not_found - never a raw 23503. Two uploads of one host (two tabs) and an account deletion queue on the
-- profile row (packages/db-tests/test/concurrency/photos.test.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
create table public.occasion_photos (
  occasion_id uuid primary key references public.occasions(id) on delete cascade,
  mime        text not null check (mime in ('image/webp', 'image/jpeg')),
  bytes       bytea not null check (octet_length(bytes) between 1 and 409600),
  width       smallint not null check (width between 1 and 2048),
  height      smallint not null check (height between 1 and 2048),
  updated_at  timestamptz not null default now(),
  updated_by  uuid not null references public.profiles(id) on delete cascade
);
-- the profile foreign key cascades: an index keeps that delete from scanning the table
create index occasion_photos_updated_by_idx on public.occasion_photos (updated_by);
-- WebP / JPEG are compressed already: store out of line without another (useless) compression attempt
alter table public.occasion_photos alter column bytes set storage external;
comment on table public.occasion_photos is
  'Cover photo of an occasion (one per occasion). No grants for anon/authenticated, RLS forced without a policy: read and written only through set_/remove_/get_occasion_photo() and export_my_occasion_photos(). Deleted with its occasion and with the host account (cascade).';

revoke all on public.occasion_photos from public, anon, authenticated;
alter table public.occasion_photos enable row level security;
alter table public.occasion_photos force  row level security;
-- deliberately no policy: with RLS forced, "no policy" denies every row to every API role, even if a grant
-- ever appears by mistake. The security definer RPCs (owner postgres, BYPASSRLS) are the only way in.

-- -----------------------------------------------------------------------------
-- 2. Bounded header parser: dimensions come from the encoded image, never from caller metadata.
-- This validates the still-image envelope, not compressed pixel data. JPEG SOF/DNL/multiple frames and
-- WebP extended canvas/bitstream mismatches must not smuggle a larger allocation to the browser.
-- Sources: ITU T.81 annex B; https://developers.google.com/speed/webp/docs/riff_container
-- and /webp_lossless_bitstream_specification. Animation and hierarchical JPEG are not canvas outputs.
-- -----------------------------------------------------------------------------
create or replace function private.photo_dimensions(p_mime text, p_bytes bytea)
returns integer[] language plpgsql immutable strict set search_path = '' as $$
declare
  n integer := octet_length(p_bytes);
  pos integer;
  mark integer;
  seg integer;
  steps integer := 0;
  width_px integer;
  height_px integer;
  canvas_w integer;
  canvas_h integer;
  frame_seen boolean := false;
  scan_seen boolean := false;
  in_scan boolean := false;
  chunk bytea;
  payload integer;
  chunk_size bigint;
  bits bigint;
begin
  if n not between 6 and 409600 then return null; end if;
  if p_mime = 'image/jpeg' then
    if substring(p_bytes from 1 for 2) <> '\xffd8'::bytea
       or substring(p_bytes from n - 1 for 2) <> '\xffd9'::bytea then return null; end if;
    pos := 2;
    while pos < n loop
      -- Each iteration consumes bytes; cap markers independently of the 400 KB input bound.
      if in_scan then
        while pos < n and get_byte(p_bytes, pos) <> 255 loop pos := pos + 1; end loop;
      end if;
      if pos >= n or get_byte(p_bytes, pos) <> 255 then return null; end if;
      while pos < n and get_byte(p_bytes, pos) = 255 loop pos := pos + 1; end loop;
      if pos >= n then return null; end if;
      mark := get_byte(p_bytes, pos);
      pos := pos + 1;
      if in_scan and (mark = 0 or mark between 208 and 215) then continue; end if;
      in_scan := false;
      steps := steps + 1;
      if steps > 2048 then return null; end if;
      if mark = 217 then
        if pos = n and frame_seen and scan_seen then return array[width_px, height_px]; end if;
        return null;
      end if;
      -- No new SOI, DNL (height redefinition), DHP/EXP (hierarchical frames), or standalone markers.
      if mark in (0, 1, 216, 220, 222, 223) or mark between 208 and 215 or pos + 2 > n then return null; end if;
      seg := get_byte(p_bytes, pos) * 256 + get_byte(p_bytes, pos + 1);
      if seg < 2 or pos + seg > n then return null; end if;
      if mark between 192 and 207 and mark not in (196, 200, 204) then
        -- Browser canvas emits baseline JPEG; progressive and extended sequential frames are safe too.
        if frame_seen or mark not in (192, 193, 194) or seg < 11 then return null; end if;
        if get_byte(p_bytes, pos + 2) <> 8
           or get_byte(p_bytes, pos + 7) not between 1 and 4
           or seg <> 8 + 3 * get_byte(p_bytes, pos + 7) then return null; end if;
        height_px := get_byte(p_bytes, pos + 3) * 256 + get_byte(p_bytes, pos + 4);
        width_px := get_byte(p_bytes, pos + 5) * 256 + get_byte(p_bytes, pos + 6);
        if width_px not between 1 and 2048 or height_px not between 1 and 2048 then return null; end if;
        frame_seen := true;
      elsif mark = 218 then
        if not frame_seen or seg < 6 or get_byte(p_bytes, pos + 2) not between 1 and 4
           or seg <> 6 + 2 * get_byte(p_bytes, pos + 2) then return null; end if;
        scan_seen := true;
        in_scan := true;
      end if;
      pos := pos + seg;
    end loop;
    return null;
  elsif p_mime = 'image/webp' then
    if n < 26 or n % 2 <> 0
       or substring(p_bytes from 1 for 4) <> '\x52494646'::bytea
       or substring(p_bytes from 9 for 4) <> '\x57454250'::bytea then return null; end if;
    bits := get_byte(p_bytes, 4)::bigint + get_byte(p_bytes, 5)::bigint * 256
          + get_byte(p_bytes, 6)::bigint * 65536 + get_byte(p_bytes, 7)::bigint * 16777216;
    if bits <> n - 8 then return null; end if;
    pos := 12;
    while pos < n loop
      steps := steps + 1;
      if steps > 2048 or pos + 8 > n then return null; end if;
      chunk := substring(p_bytes from pos + 1 for 4);
      chunk_size := get_byte(p_bytes, pos + 4)::bigint + get_byte(p_bytes, pos + 5)::bigint * 256
          + get_byte(p_bytes, pos + 6)::bigint * 65536 + get_byte(p_bytes, pos + 7)::bigint * 16777216;
      payload := pos + 8;
      if chunk_size > n - payload or payload + chunk_size + chunk_size % 2 > n then return null; end if;
      if chunk_size % 2 = 1 and get_byte(p_bytes, (payload + chunk_size)::integer) <> 0 then return null; end if;
      if pos = 12 and chunk not in ('\x56503820'::bytea, '\x5650384c'::bytea, '\x56503858'::bytea) then return null; end if;
      if chunk in ('\x414e494d'::bytea, '\x414e4d46'::bytea) then return null; end if; -- ANIM/ANMF
      if chunk = '\x56503858'::bytea then -- VP8X: must be first, exactly 10 bytes, no animation/reserved flags
        if pos <> 12 or chunk_size <> 10 or (get_byte(p_bytes, payload) & 195) <> 0
           or substring(p_bytes from payload + 2 for 3) <> '\x000000'::bytea then return null; end if;
        canvas_w := 1 + get_byte(p_bytes, payload + 4) + get_byte(p_bytes, payload + 5) * 256 + get_byte(p_bytes, payload + 6) * 65536;
        canvas_h := 1 + get_byte(p_bytes, payload + 7) + get_byte(p_bytes, payload + 8) * 256 + get_byte(p_bytes, payload + 9) * 65536;
        if canvas_w > 2048 or canvas_h > 2048 then return null; end if;
      elsif chunk in ('\x56503820'::bytea, '\x5650384c'::bytea) then
        if frame_seen then return null; end if;
        if chunk = '\x56503820'::bytea then -- VP8 key frame: frame tag, sync code, two 14-bit dimensions
          if chunk_size < 10 or (get_byte(p_bytes, payload) & 1) <> 0
             or substring(p_bytes from payload + 4 for 3) <> '\x9d012a'::bytea then return null; end if;
          width_px := (get_byte(p_bytes, payload + 6) + get_byte(p_bytes, payload + 7) * 256) & 16383;
          height_px := (get_byte(p_bytes, payload + 8) + get_byte(p_bytes, payload + 9) * 256) & 16383;
        else -- VP8L: signature + packed dimensions, alpha hint, zero version
          if chunk_size < 5 or get_byte(p_bytes, payload) <> 47 then return null; end if;
          bits := get_byte(p_bytes, payload + 1)::bigint + get_byte(p_bytes, payload + 2)::bigint * 256
              + get_byte(p_bytes, payload + 3)::bigint * 65536 + get_byte(p_bytes, payload + 4)::bigint * 16777216;
          if bits >> 29 <> 0 then return null; end if;
          width_px := 1 + (bits & 16383)::integer;
          height_px := 1 + ((bits >> 14) & 16383)::integer;
        end if;
        if width_px not between 1 and 2048 or height_px not between 1 and 2048
           or (canvas_w is not null and (canvas_w <> width_px or canvas_h <> height_px)) then return null; end if;
        frame_seen := true;
      end if;
      pos := (payload + chunk_size + chunk_size % 2)::integer;
    end loop;
    if pos = n and frame_seen then return array[width_px, height_px]; end if;
  end if;
  return null;
end;
$$;

create or replace function private.photo_bytes_match(p_mime text, p_bytes bytea)
returns boolean language sql immutable set search_path = '' as $$
  select private.photo_dimensions(p_mime, p_bytes) is not null;
$$;

-- -----------------------------------------------------------------------------
-- 3. RPCs
-- -----------------------------------------------------------------------------

-- set_occasion_photo(): the host puts (or replaces) the cover. The input is checked BEFORE any lock is
-- taken (decoding ~0.5 MB of base64 takes a moment), the answer for a bad input depends on the input only.
create or replace function public.set_occasion_photo(
  p_occasion_id uuid, p_mime text, p_data_base64 text, p_width integer, p_height integer)
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
  -- size AFTER decoding, then the type by its content
  v_dimensions := private.photo_dimensions(p_mime, v_bytes);
  if v_dimensions is null or v_dimensions[1] <> p_width or v_dimensions[2] <> p_height then
    raise exception using message = 'validation';
  end if;

  -- first lock: the own profile row (lock order of v1.1). Uploads of one host run one after the other
  -- (the quota count below is exact), an account deletion waits for the upload or the upload for it.
  perform private.lock_profile_pair(v_uid, v_uid);
  -- host only; a foreign, unknown or just deleted occasion: one answer
  perform o.id from public.occasions o where o.id = p_occasion_id and o.host_id = v_uid for key share;
  if not found then raise exception using message = 'not_found'; end if;

  -- quota: at most 20 hosted occasions with a photo (replacing an existing cover is always fine)
  if not exists (select 1 from public.occasion_photos ph where ph.occasion_id = p_occasion_id)
     and (select count(*) from public.occasion_photos ph
            join public.occasions o on o.id = ph.occasion_id
           where o.host_id = v_uid) >= 20 then
    raise exception using message = 'photo_limit';
  end if;

  -- after the locks: two uploads of one host get increasing versions in commit order
  v_at := clock_timestamp();
  insert into public.occasion_photos as ph (occasion_id, mime, bytes, width, height, updated_at, updated_by)
  values (p_occasion_id, p_mime, v_bytes, v_dimensions[1], v_dimensions[2], v_at, v_uid)
  on conflict (occasion_id) do update
    set mime = excluded.mime, bytes = excluded.bytes, width = excluded.width, height = excluded.height,
        updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  return jsonb_build_object('ok', true, 'updated_at', v_at);
end $$;

-- remove_occasion_photo(): the host takes the cover away. Idempotent ("no photo" is fine). No consent check:
-- removing own data is always possible (like export and account deletion, pilot-decisions §0 item 11).
create or replace function public.remove_occasion_photo(p_occasion_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  perform o.id from public.occasions o where o.id = p_occasion_id and o.host_id = v_uid for key share;
  if not found then raise exception using message = 'not_found'; end if;
  delete from public.occasion_photos ph where ph.occasion_id = p_occasion_id;
  return jsonb_build_object('ok', true);
end $$;

-- get_occasion_photo(): the bytes, for exactly the people who see the occasion screen (host or active
-- member, not blocked with the host). Everyone else, and a missing photo: 'not_found' (one answer).
create or replace function public.get_occasion_photo(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_host uuid;
  v_ph   record;
begin
  select o.host_id into v_host from public.occasions o where o.id = p_occasion_id;
  if not found
     or not private.is_active_member(p_occasion_id, v_uid)        -- outsider / left / removed
     or private.is_blocked_pair(v_uid, v_host) then
    raise exception using message = 'not_found';
  end if;
  select ph.mime, ph.bytes, ph.width, ph.height, ph.updated_at into v_ph
    from public.occasion_photos ph where ph.occasion_id = p_occasion_id;
  if not found then raise exception using message = 'not_found'; end if;
  return jsonb_build_object(
    'mime', v_ph.mime,
    'data', replace(encode(v_ph.bytes, 'base64'), E'\n', ''),   -- one line (encode() wraps at 76 chars)
    'width', v_ph.width, 'height', v_ph.height, 'updated_at', v_ph.updated_at);
end $$;

-- export_my_occasion_photos(): DSGVO Art. 15 / 20 — the photos the caller put on their OWN occasions, with
-- the bytes. Never photos of occasions they are only a guest of (those are the host's data). Like
-- export_my_data() it needs no current consents. The client adds it to the export file (occasion_photos).
create or replace function public.export_my_occasion_photos()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'occasion_id', ph.occasion_id, 'occasion_title', o.title, 'mime', ph.mime,
             'width', ph.width, 'height', ph.height, 'size_bytes', octet_length(ph.bytes),
             'updated_at', ph.updated_at,
             'data_base64', replace(encode(ph.bytes, 'base64'), E'\n', ''))
             order by o.starts_at, ph.occasion_id), '[]'::jsonb)
    from public.occasion_photos ph
    join public.occasions o on o.id = ph.occasion_id
    where o.host_id = v_uid);
end $$;

-- get_occasion_screen(): the 20261019120500 body + occasion.photo (meta only, or null). The photo depends on
-- nothing but the occasion: the owner's answer stays byte-identical whatever the reservations are.
create or replace function public.get_occasion_screen(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_occ       public.occasions%rowtype;
  v_me        public.occasion_members%rowtype;
  v_wl        public.wishlists%rowtype;
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
               'reserved', null::boolean, 'reserved_by_me', null::boolean)
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
               'reserved_by_me', coalesce(r.reserver_id = v_uid, false))
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

-- -----------------------------------------------------------------------------
-- 4. Privileges: the four RPCs for authenticated only; the helper for nobody but the definer functions.
--    (get_occasion_screen keeps its privileges: CREATE OR REPLACE does not touch them.)
-- -----------------------------------------------------------------------------
revoke execute on function
  public.set_occasion_photo(uuid, text, text, integer, integer), public.remove_occasion_photo(uuid),
  public.get_occasion_photo(uuid), public.export_my_occasion_photos()
  from public, anon;
grant execute on function
  public.set_occasion_photo(uuid, text, text, integer, integer), public.remove_occasion_photo(uuid),
  public.get_occasion_photo(uuid), public.export_my_occasion_photos()
  to authenticated;
revoke execute on function private.photo_bytes_match(text, bytea) from public, anon, authenticated;
revoke execute on function private.photo_dimensions(text, bytea) from public, anon, authenticated;
