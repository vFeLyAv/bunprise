-- =============================================================================
-- Bunprise (Felix 26.10, «да» to "Время окончания события: делать или нет"): the END TIME of an occasion.
-- occasions.ends_at exists since the first migration (20261019120000, "not used by the pilot UI") and is already
-- writable by the host through REST (column grant 20261019120100, policy occasions_update) — but neither screen
-- returned it, so the app could not show it and an edit could not keep it. Forward only, NOT applied to the hosted
-- project by agents: Felix runs `npx supabase db push`.
--
-- The rules (docs/handoffs/2026-10-26-occasion-end-time.md)
--   * the end is optional; an all-day occasion has none                 -> check occasions_ends_at_timed
--   * the end lies after the start                                      -> the existing column check (ends_at > starts_at)
--   * the end is on the start's day or the next one, in the occasion's  -> check occasions_ends_at_next_day
--     own zone (the form asks for a time only: an end earlier than the
--     start means "the next day", a party until 02:00; the same time as
--     the start is refused by the column check)
--   * past/upcoming: unchanged code. Every function that decides it already uses
--     coalesce(ends_at, the next local midnight) — get_feed (the 30-day past window), get_free_wishes, the
--     "Aus deinen Anlässen" suggestions, the list screens. With an end set, an occasion becomes "past" at its end
--     instead of at midnight (an evening party until 23:00) or later (until 02:00 the next day).
--     The invite link's lifetime (starts_at + 7 days) depends on the START only and does not change.
--
-- What changes
--   1. the two checks above (rows that would break them lose their ends_at first — the app never wrote one, so
--      this touches no row in practice)
--   2. get_occasion_screen: + occasion.ends_at (null without an end). Re-created from 20261025150000; nothing else
--      changes — the OWNER BRANCH of the wish list is byte-for-byte the same (packages/db-tests/test/occasions/).
--   3. get_feed: + ends_at per occasion row, and member_count no longer counts people hidden by a block
--      (in-app-invites-design P-I16: the host's guest chip counted a guest that the occasion screen's member list
--      hides between a blocked pair). Re-created from 20261025150000; nothing else changes.
-- Secrecy: ends_at is a column of the occasion, the same for everybody who may see it; no reservation is read by
-- anything new. Both functions keep SECURITY DEFINER, search_path = '' and (CREATE OR REPLACE) their grants.
-- LATER MIGRATIONS that re-create either function must keep ends_at (and get_occasion_screen sections + potluck).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Constraints
-- -----------------------------------------------------------------------------
-- (occasion_guard, a BEFORE trigger, has refused an unknown zone before these checks read `tz`)
update public.occasions
   set ends_at = null
 where ends_at is not null
   and (all_day or (ends_at at time zone tz)::date > (starts_at at time zone tz)::date + 1);

alter table public.occasions
  add constraint occasions_ends_at_timed check (ends_at is null or not all_day),
  add constraint occasions_ends_at_next_day check (
    ends_at is null or (ends_at at time zone tz)::date <= (starts_at at time zone tz)::date + 1);

comment on column public.occasions.ends_at is
  'Optional end of a timed occasion (20261026180000): after starts_at, on its day or the next one in tz; null for all-day occasions. Decides "past" (else the next local midnight).';

-- -----------------------------------------------------------------------------
-- 2. get_occasion_screen(): the 20261025150000 body + occasion.ends_at
-- -----------------------------------------------------------------------------
create or replace function public.get_occasion_screen(p_occasion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_occ       record;   -- not %rowtype: occasions has 13 columns now (+ sections), 13 are selected (strict_multi_assignment)
  v_me        public.occasion_members%rowtype;
  v_wl        record;   -- not %rowtype: wishlists has 11 columns now, 7 are selected (strict_multi_assignment)
  v_host_name text;
  v_invite    jsonb := null;
  v_wishes    jsonb;
  v_received  jsonb;
  v_wishlist  jsonb := null;
begin
  select o.id, o.host_id, o.title, o.starts_at, o.ends_at, o.tz, o.all_day, o.place_text, o.description, o.cancelled_at, o.created_at, o.updated_at, o.sections into v_occ from public.occasions o where o.id = p_occasion_id;
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
      'host', jsonb_build_object('id', v_occ.host_id, 'display_name', v_host_name,
                                 -- the host's profile photo (the visibility rule; a guest always shares this occasion)
                                 'photo', private.profile_photo_fields(v_occ.host_id) -> 'photo'),
      -- the cover photo's meta (the bytes: get_occasion_photo); null without a photo
      'photo', (select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
                  from public.occasion_photos ph where ph.occasion_id = v_occ.id),
      -- 20261025150000: what the occasion offers (wishes | bring | both)
      'sections', v_occ.sections),
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

-- -----------------------------------------------------------------------------
-- 3. get_feed(): the 20261025150000 body + ends_at per row; member_count without people hidden by a block
-- -----------------------------------------------------------------------------
create or replace function public.get_feed()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_now timestamptz := now();
begin
  return (
    with mine as (
      select o.id, o.title, o.starts_at, o.ends_at, o.tz, o.all_day, o.place_text, o.host_id, o.sections, m.role, m.rsvp,
             coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) as ends_eff
      from public.occasion_members m
      join public.occasions o on o.id = m.occasion_id
      where m.profile_id = v_uid and m.status = 'active'
    ),
    feed_rows as (
      select x.id, x.starts_at, x.ends_eff,
        jsonb_build_object(
          'id', x.id, 'title', x.title, 'starts_at', x.starts_at, 'tz', x.tz, 'all_day', x.all_day,
          -- 20261026180000: the end of a timed occasion, null without one (the same value as on its screen)
          'ends_at', x.ends_at,
          'place_text', x.place_text, 'role', x.role, 'rsvp', x.rsvp,
          'host_id', x.host_id,
          -- 20261025150000: what the occasion offers, so the host's card does not say "no wishes yet" for a
          -- bring-along-only occasion; a column of the occasion, the same for every member, never about reservations
          'sections', x.sections,
          'host_name', (select p.display_name from public.profiles p where p.id = x.host_id),
          -- 20261026180000 (P-I16): the people the occasion screen lists — active members, not those hidden from
          -- the viewer by a block (either direction); the viewer counts themselves
          'member_count', (select count(*) from public.occasion_members mm
                           where mm.occasion_id = x.id and mm.status = 'active'
                             and not private.is_blocked_pair(v_uid, mm.profile_id)),
          'wish_count', (select count(*) from public.wishes w
                         join public.wishlists wl on wl.id = w.wishlist_id where wl.occasion_id = x.id),
          -- the host never gets a number here; a member only counts their OWN active reservations
          'my_reservation_count', case when x.role = 'host' then null::bigint
                                       else (select count(*) from public.reservations r
                                             join public.wishlists wl on wl.id = r.wishlist_id
                                             where wl.occasion_id = x.id and r.reserver_id = v_uid and r.status = 'active') end,
          -- the cover's meta (the bytes: get_occasion_photo, same access rule); null without a photo or when blocked
          'photo', case when private.is_blocked_pair(v_uid, x.host_id) then null::jsonb
                        else (select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
                                from public.occasion_photos ph where ph.occasion_id = x.id) end
        ) as j
      from mine x
    )
    select jsonb_build_object(
      'upcoming', coalesce((select jsonb_agg(f.j order by f.starts_at asc, f.id) from feed_rows f
                            where f.ends_eff >= v_now), '[]'::jsonb),
      'past',     coalesce((select jsonb_agg(f.j order by f.starts_at desc, f.id) from feed_rows f
                            where f.ends_eff < v_now and f.ends_eff >= v_now - interval '30 days'), '[]'::jsonb)
    )
  );
end $$;
