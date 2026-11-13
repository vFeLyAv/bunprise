-- Bunprise (Felix 25.10): the occasion's cover photo on Start ("die Startseite lebendiger und verständlicher").
-- get_feed() is re-created from 20261020221230 with ONE new key per occasion row:
--   photo = { width, height, updated_at } | null   — the cover's META only, exactly the shape of
--           get_occasion_screen().occasion.photo; the bytes come lazily through get_occasion_photo() (the client
--           loads them after the first paint, only for cards near the viewport, and keeps them in memory only —
--           the persisted ['feed'] cache gets this meta and nothing else).
-- Access: the same people who may load the bytes (get_occasion_photo: active member — which every feed row
-- already is — and not blocked with the host). For a blocked pair the key is null, so the feed never announces
-- a cover that get_occasion_photo would refuse (no oracle, one rule). The photo depends on nothing but the
-- occasion: reservations are not involved, the host's answer stays byte-identical whatever is reserved.
-- Everything else (membership filter, counts, my_reservation_count null for the host, ordering, the 30-day past
-- window) is the 20261020221230 body, unchanged. NOT applied to the hosted project by agents:
-- Felix runs `npx supabase db push`.
create or replace function public.get_feed()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_now timestamptz := now();
begin
  return (
    with mine as (
      select o.id, o.title, o.starts_at, o.tz, o.all_day, o.place_text, o.host_id, m.role, m.rsvp,
             coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) as ends_eff
      from public.occasion_members m
      join public.occasions o on o.id = m.occasion_id
      where m.profile_id = v_uid and m.status = 'active'
    ),
    feed_rows as (
      select x.id, x.starts_at, x.ends_eff,
        jsonb_build_object(
          'id', x.id, 'title', x.title, 'starts_at', x.starts_at, 'tz', x.tz, 'all_day', x.all_day,
          'place_text', x.place_text, 'role', x.role, 'rsvp', x.rsvp,
          'host_id', x.host_id,
          'host_name', (select p.display_name from public.profiles p where p.id = x.host_id),
          'member_count', (select count(*) from public.occasion_members mm
                           where mm.occasion_id = x.id and mm.status = 'active'),
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
