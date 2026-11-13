-- =============================================================================
-- Bunprise (Felix 27.10): the MINI MAP on the occasion screen.
-- Felix's words: «Карта в событии … Именно как мини-карта. Просто где точка. То есть не надо прям открывать карту».
-- The occasion screen shows a small static map with a dot where the place is (the "Google Maps / Apple Karten"
-- buttons stay for a real map). Until now the point of a picked place lived only in the form's memory
-- (docs/handoffs/2026-10-27-place-minimap.md); this migration lets the host store it with the occasion.
-- Forward only, NOT applied to the hosted project by agents: Felix runs `npx supabase db push`. The app writes the
-- columns only when a place WITH a point was picked, and the place search sends points only while the Worker's map
-- switch is on (MAP_TILES=osm, together with the pilot-5 texts) — an app without the switch never writes them.
--
-- What is new
--   occasions.place_lat / place_lon   numeric, rounded to 5 decimals (~1 m; the Worker already rounds), both or none,
--                          lat −90…90, lon −180…180 (NaN and ±Infinity are refused), only together with a place_text.
--                          Written by the host through REST like place_text: the table-level INSERT grant covers them,
--                          plus a column UPDATE grant; occasions_insert / occasions_update allow the host only.
--                          Read like place_text: host and active members (policy occasions_select + column SELECT grant).
--   trigger occasion_place_point_reset   a NEW place_text without a new point drops the old point (typed text, a
--                          recent place, or "Ort entfernen" — the map would otherwise show the previous place).
--                          Known edge: a new text with exactly the same rounded point counts as "no new point".
--   get_occasion_screen    + occasion.place_lat / place_lon (null without a point). Re-created from 20261027140000;
--                          nothing else changes — the OWNER BRANCH of the wish list is byte-for-byte the same.
--   get_feed               unchanged (the feed card shows no map).
-- Secrecy: the point is a column of the occasion, like its place text — the same for everybody who may see the
-- occasion; nothing reads a reservation for it, no count, no order. The function keeps SECURITY DEFINER,
-- search_path = '' and (CREATE OR REPLACE) its grants.
-- Personal data: NEW — the coordinates of the place the host picked (often a café or a park, sometimes a home
-- address, which place_text already shows in words). Shown to the occasion's guests. Datenschutz:
-- docs/legal-drafts/pilot-5-notes.md (map section).
-- LATER MIGRATIONS that re-create get_occasion_screen must keep place_lat / place_lon (and cover_theme, ends_at,
-- sections, potluck).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. occasions.place_lat / place_lon
-- -----------------------------------------------------------------------------
alter table public.occasions
  add column place_lat numeric(7, 5),
  add column place_lon numeric(8, 5);
alter table public.occasions
  add constraint occasions_place_point_check check (
    (place_lat is null and place_lon is null)
    or (place_lat is not null and place_lon is not null and place_text is not null
        and place_lat between -90 and 90 and place_lon between -180 and 180));
comment on column public.occasions.place_lat is
  'Latitude of the picked place (20261027190000), 5 decimals; null = no point (typed text, a recent place, the map switch off). Both or none, only with place_text. Read like place_text (host + members); the occasion screen draws a mini map from it.';
comment on column public.occasions.place_lon is
  'Longitude of the picked place (20261027190000), 5 decimals; see place_lat.';

-- column grants, like place_text (policy occasions_update: the host only; occasions_select: host + active members)
grant select (place_lat, place_lon) on public.occasions to authenticated;
grant update (place_lat, place_lon) on public.occasions to authenticated;

-- -----------------------------------------------------------------------------
-- 2. A new place text without a new point drops the old point
-- -----------------------------------------------------------------------------
create or replace function private.occasion_place_point_reset()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.place_text is distinct from old.place_text
     and new.place_lat is not distinct from old.place_lat
     and new.place_lon is not distinct from old.place_lon then
    new.place_lat := null;
    new.place_lon := null;
  end if;
  return new;
end $$;
create trigger occasion_place_point_reset before update on public.occasions
  for each row execute function private.occasion_place_point_reset();
-- a trigger function: nobody may call it (Postgres grants EXECUTE to PUBLIC on every new function)
revoke execute on function private.occasion_place_point_reset() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. get_occasion_screen(): the 20261027140000 body + occasion.place_lat / place_lon
-- -----------------------------------------------------------------------------
create or replace function public.get_occasion_screen(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_occ       record;   -- not %rowtype: occasions has 17 columns now (+ place_lat, place_lon), 16 are selected (strict_multi_assignment)
  v_me        public.occasion_members%rowtype;
  v_wl        record;   -- not %rowtype: wishlists has 11 columns now, 7 are selected (strict_multi_assignment)
  v_host_name text;
  v_invite    jsonb := null;
  v_wishes    jsonb;
  v_received  jsonb;
  v_wishlist  jsonb := null;
begin
  select o.id, o.host_id, o.title, o.starts_at, o.ends_at, o.tz, o.all_day, o.place_text, o.description, o.cancelled_at, o.created_at, o.updated_at, o.sections, o.cover_theme, o.place_lat, o.place_lon into v_occ from public.occasions o where o.id = p_occasion_id;
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
      -- 20261026180000: the end of a timed occasion, null without one (always null for an all-day occasion)
      'ends_at', v_occ.ends_at,
      'place_text', v_occ.place_text, 'description', v_occ.description, 'created_at', v_occ.created_at,
      -- 20261027190000: where the place is (both or none; null without a point), for the screen's mini map; a column
      -- of the occasion like its place text, the same for host and guests, never about reservations
      'place_lat', v_occ.place_lat, 'place_lon', v_occ.place_lon,
      'host', jsonb_build_object('id', v_occ.host_id, 'display_name', v_host_name,
                                 -- the host's profile photo (the visibility rule; a guest always shares this occasion)
                                 'photo', private.profile_photo_fields(v_occ.host_id) -> 'photo'),
      -- the cover photo's meta (the bytes: get_occasion_photo); null without a photo
      'photo', (select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
                  from public.occasion_photos ph where ph.occasion_id = v_occ.id),
      -- 20261025150000: what the occasion offers (wishes | bring | both)
      'sections', v_occ.sections,
      -- 20261027140000: the cover motif (a key of the allow-list | 'none' = switched off by the host | null = never
      -- chosen); a column of the occasion like its title, the same for host and guests, never about reservations
      'cover_theme', v_occ.cover_theme),
    'viewer', jsonb_build_object('role', v_me.role, 'rsvp', v_me.rsvp),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'display_name', p.display_name, 'role', m.role, 'rsvp', m.rsvp,
                                                   'photo', private.profile_photo_fields(p.id) -> 'photo')
                                order by m.joined_at, p.id), '[]'::jsonb)
      from public.occasion_members m
      join public.profiles p on p.id = m.profile_id
      where m.occasion_id = p_occasion_id and m.status = 'active' and not private.is_blocked_pair(v_uid, p.id)),
    'invite', v_invite,
    'wishlist', v_wishlist,
    -- 20261025150000: the bring-along list ("Mitbringen"), null while the occasion offers wishes only.
    -- The same shape for host and guests; it never depends on reservations.
    'potluck', case when v_occ.sections in ('bring', 'both') then private.potluck_screen(p_occasion_id, v_uid) end);
end $$;
