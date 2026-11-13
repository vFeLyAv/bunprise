-- =============================================================================
-- Bunprise wave 2b — M4 (agent J2): "Noch frei auf {{name}}s Listen" — the still free wishes of a person, for the
-- GIVER only (Find Gift tab, mode "Für jemanden"; follows-design §00 item 2, §2.5, §5.5, §6.3 group G).
-- The spec calls it get_gift_ideas; renamed get_free_wishes because lib/api/giftIdeas.ts is the contract of the
-- Worker /api/gift-ideas (product ideas). Behaviour, answer, can_find_gift and F21: as written for get_gift_ideas.
-- Forward only. NOT applied to the hosted project: `supabase db push` only after Felix's OK, and only together with
-- the checked pilot-2 legal texts (follows-design §00 item 8).
--
-- get_free_wishes(p_profile_id uuid, p_max_cents integer default null)
--   -> { person{id, display_name, banner},
--        ideas[{wish_id, title, url, price_cents, currency, priority, created_at,
--               list{id, title, kind 'standalone' | 'occasion', date (YYYY-MM-DD) | null, occasion_id | null}}] }
--   * a bad budget (not 0 … 100 000 000 cents): validation — before anything else, it depends on the input only;
--   * yourself, null, an unknown id, a stranger, a blocked person, somebody without a list I can read: ONE answer,
--     not_found — exactly private.can_find_gift(), the same helper as get_profile_card.can_find_gift (F21);
--   * only lists I can read anyway (private.can_read_wishlist: an occasion's list as its active guest, a follower
--     list as an accepted follower, never while the red button is pressed), never a list whose recipient I am;
--     occasion lists only until the occasion has ended; wishes with an ACTIVE reservation are left out (the giver's
--     view, G1: what the occasion / list screen already shows them as "Reserviert");
--   * budget: price ≤ p_max_cents; wishes without a price stay in (at the end of their group);
--   * order: the list's date (due_on, or the occasion's local start day) ascending, undated last, then priority
--     desc, price asc (no price last), created_at, id.
--   * list.occasion_id (added to the spec's keys): an occasion list's "Ansehen" opens /occasions/$id — the giver is
--     an active guest of that occasion anyway; null for a list without an occasion (/lists/$id).
--   Nothing is stored (the choice and the budget live in the tab's memory). The owner can never ask about themself,
--   so nothing derived from reservations ever reaches the person the gifts are for (G1, G6, G7).
-- =============================================================================

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
                       'occasion_id', wl.occasion_id))
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

-- Privileges: authenticated only (Supabase's default privileges and PUBLIC would give anon EXECUTE).
revoke execute on function public.get_free_wishes(uuid, integer) from public, anon;
grant execute on function public.get_free_wishes(uuid, integer) to authenticated;
