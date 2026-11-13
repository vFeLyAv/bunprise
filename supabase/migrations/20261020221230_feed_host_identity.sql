-- Feed identity for calendar colours and gift recipient selection.
-- Additive, local-only migration. Existing membership filters, ordering and owner secrecy stay identical.
-- The host profile ID is already visible to these active members in get_occasion_screen().
-- Created using Supabase CLI migration new; no database was contacted or changed.
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
                                             where wl.occasion_id = x.id and r.reserver_id = v_uid and r.status = 'active') end
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
