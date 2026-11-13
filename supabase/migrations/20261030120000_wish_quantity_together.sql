-- =============================================================================
-- Bunprise (Felix 30.10, docs/handoffs/2026-10-30-feedback.md items 1 + 3): QUANTITY and "PASST ZUSAMMEN".
-- Forward only, NOT applied to the hosted project by agents: Felix runs `npx supabase db push`. Both features are
-- CREATED SWITCHED OFF (private.features.wish_quantity / wish_together = false) — switch them on with
-- supabase/emergency/wish_extras_on.sql as a new migration, together with the app built with VITE_WISH_QUANTITY /
-- VITE_WISH_TOGETHER = '1' (docs/handoffs/2026-10-30-quantity-together.md).
--
-- A) QUANTITY ("Anzahl"): public.wishes.quantity smallint 1..10, default 1 (e.g. "4 AirTags"). Felix 30.10, variant A:
--    ONE friend reserves the WHOLE set — the reservation logic does not change at all (one active reservation per wish).
--    The owner writes it through REST like the other columns of her wish (column grants insert / update / select);
--    the trigger wish_quantity_guard refuses a value other than 1 (insert) or a change (update) through the API roles
--    while the switch is off. Every wish answer carries it through private.wish_detail_fields (the screens of every
--    role, get_free_wishes "Ideen", the owner's export).
--
-- B) "PASST ZUSAMMEN" ("better given together"): private.wish_links (wish_a, wish_b) — an UNDIRECTED link between two
--    wishes of ONE owner with ONE recipient (steering wheel <-> handbrake). Internal schema, RLS forced, no policy,
--    no privilege for any API role: written only by set_wish_links (the owner), read only by the helpers below.
--      set_wish_links(p_wish_id, p_linked_ids[]) -> { ok, linked }   the owner REPLACES the partners of one wish
--      reserve_together(p_wish_id, p_with_ids[]) -> { ok, reserved } a giver reserves the wish AND its linked wishes
--          in ONE transaction: every wish through public.reserve_wish itself (the same rules, codes and locks), so the
--          first refusal rolls everything back (all or nothing). Online only, server-confirmed like reserve_wish.
--    Screens (private.list_wish_objects): `together` per wish, null while the switch is off.
--      owner     [{id, title}]                                 every linked wish (her own data)
--      audience  [{id, title, reserved, reserved_by_me}]       ONLY the linked wishes the viewer can read
--                (private.can_read_wish) and that are not received — a hidden / unreadable wish is never named, never
--                counted, never hinted at (no "and 1 more").
--
-- THE SECRET (CLAUDE.md, INV-7 of 20261027200000):
--   * Nothing the owner does here touches public.reservations: set_wish_links, the quantity write and her screens never
--     name the table (branch markers + counters in packages/db-tests/test/lists/wish-together*.test.ts). Deleting a
--     wish cascades its links only.
--   * reserve_together answers the owner / recipient not_allowed BEFORE anything else is looked at (like reserve_wish),
--     so a call on her own wishes tells her nothing. Every other step is reserve_wish's own (bounded access: the unique
--     active index per wish, the giver's own rows) — the giver learns exactly what one reserve_wish per wish would say.
--   * The audience's `together` reads the ONE active reservation of each linked wish through the unique active index
--     (a SubPlan per wish, like the wish itself; enable_seqscan / enable_bitmapscan off): a linked wish is somebody
--     else's wish, never the viewer's own (links join wishes of one owner only).
-- Locks: set_wish_links takes the owner's profile row first (like every owner write of 20261027200000); reserve_together
--   takes the pair lock (giver, recipient) first — the same row, so a link change and a joint reservation never
--   interleave; then reserve_wish per wish (re-entrant pair lock, wish FOR KEY SHARE, the reservation row FOR UPDATE).
-- Personal data: new — how many pieces a wish asks for and which own wishes belong together (wish data like the
--   title). Both in the owner's export (my_wishlists_export: wishes[].quantity, wishes[].together). Datenschutz pilot-6
--   must mention them (docs/handoffs/2026-10-30-quantity-together.md).
-- LATER MIGRATIONS that re-create private.list_wish_objects / private.wish_detail_fields / private.my_wishlists_export
--   must keep `together` / `quantity`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The two switches (off until the app that shows them is released)
-- -----------------------------------------------------------------------------
alter table private.features
  add column wish_quantity boolean not null default false,
  add column wish_together boolean not null default false;
comment on column private.features.wish_quantity is
  'Felix 30.10: the owner may set a quantity other than 1 ("Anzahl"). Off: REST writes of quantity <> 1 are refused (not_allowed); stored values stay and are still shown.';
comment on column private.features.wish_together is
  'Felix 30.10: "Passt zusammen" — set_wish_links / reserve_together work and the screens carry `together`. Off: both answer not_allowed, `together` is null; the stored links stay.';

create or replace function private.wish_quantity_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.wish_quantity from private.features f), false);
$$;

create or replace function private.wish_together_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.wish_together from private.features f), false);
$$;

-- -----------------------------------------------------------------------------
-- 2. A) wishes.quantity
-- -----------------------------------------------------------------------------
alter table public.wishes add column quantity smallint not null default 1;
alter table public.wishes add constraint wishes_quantity_check check (quantity between 1 and 10);
comment on column public.wishes.quantity is
  'Felix 30.10: how many pieces the wish asks for (1..10). One reservation covers the whole set (variant A); never derived from or used for reservations.';

-- the owner writes it like her other columns (policies wishes_insert / wishes_update stay owner-only); readers = the
-- readers of the wish
grant select (quantity), insert (quantity), update (quantity) on public.wishes to authenticated;

-- the switch: through the API roles a quantity other than 1 (insert) or a change (update) only while it is on
create or replace function private.wish_quantity_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.quantity <> 1 and not private.wish_quantity_on() then raise exception using message = 'not_allowed'; end if;
  elsif new.quantity is distinct from old.quantity and not private.wish_quantity_on() then
    raise exception using message = 'not_allowed';
  end if;
  return new;
end $$;
create trigger wish_quantity_guard before insert or update of quantity on public.wishes
  for each row when (current_user in ('anon', 'authenticated'))
  execute function private.wish_quantity_guard();

-- the 20261022160000 helper + quantity (the one place that builds the newer keys of a wish)
create or replace function private.wish_detail_fields(p_wish public.wishes)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'description', p_wish.description, 'brand', p_wish.brand, 'color', p_wish.color,
    'gtin', p_wish.gtin, 'shop_name', p_wish.shop_name,
    'received_at', p_wish.received_at,
    -- 20261030120000: how many pieces (1 = one), the owner's own value
    'quantity', p_wish.quantity,
    -- the photo's meta (the bytes: get_wish_photo); null without a photo
    'photo', (select jsonb_build_object('width', ph.width, 'height', ph.height, 'updated_at', ph.updated_at)
                from public.wish_photos ph where ph.wish_id = p_wish.id));
$$;

-- -----------------------------------------------------------------------------
-- 3. B) private.wish_links (internal schema; no privileges for any API role; RLS enabled + forced, NOT ONE policy)
-- -----------------------------------------------------------------------------
create table private.wish_links (
  wish_a     uuid not null references public.wishes(id) on delete cascade,
  wish_b     uuid not null references public.wishes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (wish_a, wish_b),
  constraint wish_links_order check (wish_a < wish_b)
);
create index wish_links_b_idx on private.wish_links (wish_b, wish_a);
alter table private.wish_links enable row level security;  alter table private.wish_links force row level security;
revoke all on private.wish_links from public, anon, authenticated;
comment on table private.wish_links is
  'Felix 30.10 "Passt zusammen": two wishes of one owner that are better given together (stored once, wish_a < wish_b). Written only by set_wish_links, read only by private.linked_wish_ids and the export; deleted with either wish (cascade). Never about reservations.';

-- the partners of a wish (either direction)
create or replace function private.linked_wish_ids(p_wish uuid)
returns table (wish_id uuid) language sql stable security definer set search_path = '' as $$
  select l.wish_b from private.wish_links l where l.wish_a = p_wish
  union
  select l.wish_a from private.wish_links l where l.wish_b = p_wish;
$$;

-- the OWNER's `together`: every linked wish of hers (ownership asserted inside; a guest branch calling this gets [])
create or replace function private.wish_links_for_owner(p_wish uuid, p_owner uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title) order by w.created_at, w.id), '[]'::jsonb)
    from private.linked_wish_ids(p_wish) x
    join public.wishes w on w.id = x.wish_id
    join public.wishlists h on h.id = w.wishlist_id
   where h.owner_id = p_owner and p_owner is not null;
$$;

-- the AUDIENCE's `together`: only linked wishes the viewer reads right now and that are still open — a hidden one is
-- left out without a trace. Per shown wish its LIVE reservation through the unique active index (a SubPlan, INV-7 b).
create or replace function private.wish_links_for_viewer(p_wish uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
  with shown as materialized (
    select w.id, w.title, w.created_at
      from private.linked_wish_ids(p_wish) x
      join public.wishes w on w.id = x.wish_id
     where w.received_at is null and private.can_read_wish(w.id, p_viewer))
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title,
           'reserved', rr.by_id is not null, 'reserved_by_me', coalesce(rr.by_id = p_viewer, false))
           order by s.created_at, s.id), '[]'::jsonb)
    from shown s
    cross join lateral (select (select r.reserver_id from public.reservations r
                                 where r.wish_id = s.id and r.status = 'active'
                                   and private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id)
                                 limit 1) as by_id) rr;
$$;

-- -----------------------------------------------------------------------------
-- 4. The wish part of both list screens: the 20261027200000 body + `together` (null while the switch is off).
--    The quantity rides in private.wish_detail_fields.
-- -----------------------------------------------------------------------------
create or replace function private.list_wish_objects(p_list uuid, p_viewer uuid, p_owner_view boolean, p_hints boolean)
returns jsonb language plpgsql stable security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
declare
  v_wishes   jsonb;
  v_received jsonb;
  v_together boolean := private.wish_together_on();
begin
  if p_owner_view then
    -- OWNER BRANCH: literal nulls; public.reservations is not referenced at all
    select coalesce(jsonb_agg(x.j order by w.priority desc, w.created_at asc, w.id) filter (where w.received_at is null), '[]'::jsonb),
           coalesce(jsonb_agg(x.j order by w.received_at desc, w.id) filter (where w.received_at is not null), '[]'::jsonb)
      into v_wishes, v_received
      from private.owner_list_wishes(p_list, p_viewer) ow
      join public.wishes w on w.id = ow.wish_id
      cross join lateral (select jsonb_build_object(
             'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
             'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
             'reserved', null::boolean, 'reserved_by_me', null::boolean) || private.wish_detail_fields(w)
             || jsonb_build_object('home', ow.is_home, 'paused', ow.paused,
                                   'also_in', private.wish_places_for_owner(w.id, p_list, p_viewer),
                                   'together', case when v_together then private.wish_links_for_owner(w.id, p_viewer) end) as j) x;
  else
    -- AUDIENCE BRANCH: "taken" and "taken by me" only — never who; only a LIVE reservation counts
    select coalesce(jsonb_agg(x.j order by w.priority desc, w.created_at asc, w.id) filter (where w.received_at is null), '[]'::jsonb),
           coalesce(jsonb_agg(x.j order by w.received_at desc, w.id) filter (where w.received_at is not null), '[]'::jsonb)
      into v_wishes, v_received
      from private.effective_list_wishes(p_list) e
      join public.wishes w on w.id = e.wish_id
      cross join lateral (select (select r.reserver_id from public.reservations r
                                   where r.wish_id = w.id and r.status = 'active'
                                     and private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id)
                                   limit 1) as by_id) rr
      cross join lateral (select jsonb_build_object(
             'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
             'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
             'reserved', rr.by_id is not null, 'reserved_by_me', coalesce(rr.by_id = p_viewer, false))
             || private.wish_detail_fields(w)
             || jsonb_build_object('also_in', case when p_hints then private.wish_places_for_viewer(w.id, p_list, p_viewer) end,
                                   -- 20261030120000: the linked wishes this viewer can read (open ones only)
                                   'together', case when v_together then private.wish_links_for_viewer(w.id, p_viewer) end) as j) x;
  end if;
  return jsonb_build_object('wishes', v_wishes, 'received', v_received);
end $$;

-- -----------------------------------------------------------------------------
-- 5. set_wish_links(p_wish_id, p_linked_ids) -> { ok, linked } — "Passt gut zu …": the owner REPLACES the partners of
--    one of her wishes (an empty array removes every link of it). The partners: her own wishes with the same
--    recipient, at most 10, not the wish itself (validation); unknown / not hers: not_found (one answer); a partner
--    with more than 10 links afterwards: limit_reached; the switch off: not_allowed. Never reads public.reservations;
--    the answer depends on her own data and the switch only.
-- -----------------------------------------------------------------------------
create or replace function public.set_wish_links(p_wish_id uuid, p_linked_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_ids       uuid[];
  v_recipient uuid;
  v_found     integer;
begin
  if p_wish_id is null or p_linked_ids is null or cardinality(p_linked_ids) > 10
     or exists (select 1 from unnest(p_linked_ids) x where x is null) then
    raise exception using message = 'validation';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}'::uuid[]) into v_ids from unnest(p_linked_ids) x;
  if p_wish_id = any(v_ids) then raise exception using message = 'validation'; end if;

  -- first lock: the own profile row (every reservation on my wishes waits here, like every owner write)
  perform private.lock_profile_pair(v_uid, v_uid);
  if not private.wish_together_on() then raise exception using message = 'not_allowed'; end if;

  select h.recipient_id into v_recipient
    from public.wishes w join public.wishlists h on h.id = w.wishlist_id
   where w.id = p_wish_id and h.owner_id = v_uid
     for key share of w;
  if not found then raise exception using message = 'not_found'; end if;   -- not mine / gone: one answer

  select count(*) into v_found
    from public.wishes w join public.wishlists h on h.id = w.wishlist_id
   where w.id = any(v_ids) and h.owner_id = v_uid and h.recipient_id = v_recipient;
  if v_found <> cardinality(v_ids) then raise exception using message = 'not_found'; end if;

  delete from private.wish_links l where l.wish_a = p_wish_id or l.wish_b = p_wish_id;
  insert into private.wish_links (wish_a, wish_b)
  select least(p_wish_id, x), greatest(p_wish_id, x) from unnest(v_ids) x
  on conflict do nothing;
  -- every partner keeps at most 10 links (this wish has at most 10 by the input check)
  if exists (select 1 from unnest(v_ids) x where (select count(*) from private.linked_wish_ids(x)) > 10) then
    raise exception using message = 'limit_reached';
  end if;
  return jsonb_build_object('ok', true, 'linked', cardinality(v_ids));
end $$;

-- -----------------------------------------------------------------------------
-- 6. reserve_together(p_wish_id, p_with_ids) -> { ok, reserved } — "Beides reservieren" / "Alle reservieren".
--    Order of the answers:
--      the switch off -> not_allowed; bad input (null inside, nothing besides the wish, more than 10 — the most links a wish can have, Codex review 31.10 #1) -> validation;
--      the wish unknown -> not_found; the caller is its owner / recipient -> not_allowed (BEFORE anything else);
--      then the pair lock (giver, recipient); the wish not readable for the caller -> not_allowed (reserve_wish's code);
--      a partner unknown or not readable for the caller -> not_found (one answer: never "it exists but is hidden");
--      a partner not linked to the wish -> validation;
--      then public.reserve_wish for the wish and each partner (ascending id): its codes as they are — the first
--      refusal aborts the transaction, so either every wish is reserved by the caller or none (all or nothing).
-- -----------------------------------------------------------------------------
create or replace function public.reserve_together(p_wish_id uuid, p_with_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_ids       uuid[];
  v_owner     uuid;
  v_recipient uuid;
  v_id        uuid;
begin
  if not private.wish_together_on() then raise exception using message = 'not_allowed'; end if;
  if p_wish_id is null or p_with_ids is null or cardinality(p_with_ids) > 10
     or exists (select 1 from unnest(p_with_ids) x where x is null) then
    raise exception using message = 'validation';
  end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_with_ids) x where x <> p_wish_id;
  if v_ids is null then raise exception using message = 'validation'; end if;

  select h.owner_id, h.recipient_id into v_owner, v_recipient
    from public.wishes w join public.wishlists h on h.id = w.wishlist_id where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  -- owner / recipient: ALWAYS not_allowed, decided before links, partners or reservations are looked at
  if v_uid in (v_owner, v_recipient) then raise exception using message = 'not_allowed'; end if;

  -- the pair lock first (the owner's link changes, deletes and access changes take the same profile row)
  perform private.lock_profile_pair(v_uid, v_recipient);
  -- the wish itself unreadable: reserve_wish's code, before its partners are looked at (an outsider who kept an old id
  -- learns nothing about its links)
  if not private.can_read_wish(p_wish_id, v_uid) then raise exception using message = 'not_allowed'; end if;
  if (select count(*) from public.wishes w where w.id = any(v_ids) and private.can_read_wish(w.id, v_uid)) <> cardinality(v_ids) then
    raise exception using message = 'not_found';
  end if;
  if exists (select 1 from unnest(v_ids) x
              where not exists (select 1 from private.linked_wish_ids(p_wish_id) l where l.wish_id = x)) then
    raise exception using message = 'validation';
  end if;

  -- every wish with the one reservation rule there is (its own checks, codes and locks; idempotent for own rows)
  perform public.reserve_wish(p_wish_id);
  foreach v_id in array v_ids loop
    perform public.reserve_wish(v_id);
  end loop;
  return jsonb_build_object('ok', true, 'reserved', cardinality(v_ids) + 1);
end $$;

-- -----------------------------------------------------------------------------
-- 7. The owner's export: the 20261027200000 body + wishes[].together (the linked wish ids; quantity comes with
--    private.wish_detail_fields). Still not one word about the secret table.
-- -----------------------------------------------------------------------------
create or replace function private.my_wishlists_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', wl.id, 'occasion_id', wl.occasion_id, 'owner_id', wl.owner_id, 'recipient_id', wl.recipient_id,
           'title', wl.title, 'visibility', wl.visibility, 'cover_tone', wl.cover_tone, 'cover_icon', wl.cover_icon,
           'due_on', wl.due_on, 'created_at', wl.created_at, 'updated_at', wl.updated_at,
           'photo', private.list_photo_meta(wl.id),
           'received_prompt_dismissed_at', (select op.dismissed_at from private.occasion_prompts op
                                             where op.occasion_id = wl.occasion_id),
           'wishes', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', w.id, 'wishlist_id', w.wishlist_id, 'title', w.title, 'price_cents', w.price_cents,
                        'currency', w.currency, 'url', w.url, 'note', w.note, 'priority', w.priority,
                        'created_at', w.created_at, 'updated_at', w.updated_at) || private.wish_detail_fields(w)
                        || jsonb_build_object('places', (
                             select coalesce(jsonb_agg(jsonb_build_object('wishlist_id', p.wishlist_id, 'added_at', p.added_at,
                                                                          'home', p.wishlist_id = w.wishlist_id)
                                                       order by p.added_at, p.wishlist_id), '[]'::jsonb)
                               from private.wish_placements p where p.wish_id = w.id),
                           -- 20261030120000: "Passt zusammen" — the ids of the wishes linked to this one
                           'together', (select coalesce(jsonb_agg(l.wish_id order by l.wish_id), '[]'::jsonb)
                                          from private.linked_wish_ids(w.id) l))
                        order by w.priority desc, w.created_at, w.id), '[]'::jsonb)
                      from public.wishes w where w.wishlist_id = wl.id))
           order by wl.created_at, wl.id), '[]'::jsonb)
  from public.wishlists wl where wl.owner_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- 8. Privileges. New public RPCs: authenticated only. Every new private helper: no API role (they answer "who reads /
--    linked what" for ANY wish and person).
-- -----------------------------------------------------------------------------
revoke execute on function public.set_wish_links(uuid, uuid[]), public.reserve_together(uuid, uuid[]) from public, anon;
grant execute on function public.set_wish_links(uuid, uuid[]), public.reserve_together(uuid, uuid[]) to authenticated;

revoke execute on all functions in schema private from public, anon;
revoke execute on function
  private.wish_quantity_on(), private.wish_together_on(), private.wish_quantity_guard(),
  private.linked_wish_ids(uuid), private.wish_links_for_owner(uuid, uuid), private.wish_links_for_viewer(uuid, uuid)
  from authenticated;
