-- =============================================================================
-- Bunprise (Felix 27.10: «Одно желание в двух местах надо делать. Сейчас.»): ONE WISH IN SEVERAL LISTS.
-- Design: docs/spec/shared-wishes-design.md v1.4 (model C "home + table of places", reviewed by Codex four times)
-- with the defaults recorded in its §8 ("Кирилл 27.10: «надо делать сейчас» → варианты по умолчанию").
-- Forward only, NOT applied to the hosted project by agents: Felix runs `npx supabase db push`. Adding a wish to a
-- second list stays OFF (private.features.shared_wishes = false) until the app that can show it is released —
-- switch it on with supabase/emergency/shared_wishes_on.sql as a new migration (docs/handoffs/2026-10-27-shared-wishes.md).
--
-- What is new
--   private.wish_placements (wish_id, wishlist_id, added_at)   EVERY place of a wish, its home included. Internal
--       schema: PostgREST never sees it, so the many-to-one embed wishes -> wishlists of the current client keeps
--       working (design §2.1). Home = wishes.wishlist_id (always a row here, INV-9). One owner (INV-8): every place
--       of a wish is a list of the wish's owner. Filled for every existing wish (its home) by this migration.
--   "Stored" places = every row (what the OWNER sees and manages: her screens, also_in, delete guard, move refusal,
--       export). "Effective" places = the home always, other places while private.features.shared_wishes_visible
--       (what the AUDIENCE sees: access, their screens, hints, "Ideen", liveness, the cap). Only the helpers below and
--       the writing functions read the table (meta-test, design §3.1).
--   A wish is readable by whoever reads at least one of its EFFECTIVE places (private.can_read_wish; policy
--       wishes_select). Only the owner of the home writes it.
--   New RPCs (authenticated): add_wishes_to_list(list, wish_ids[]) -> {ok, added}; remove_wish_from_list(wish, list)
--       -> {ok}; delete_wish_everywhere(wish) -> {ok}; dismiss_received_prompt(occasion) -> {ok}.
--   Screens: owner wish objects + home, paused, also_in[{id,title,kind,occasion_id,home,paused}]; the occasion
--       screen's owner wishlist + received_prompt; guests of an occasion + also_in[{id,title,kind}] (+ one
--       {kind:'hidden'} for places they cannot read, Q18); followers: also_in null. get_free_wishes + lists[].
--   After an occasion: one reminder for the host ("Was hast du bekommen?", day 1..7 after its end), and 7 days after
--       its end the wishes that also live elsewhere leave its list (hourly job, Q7/Q19).
--
-- THE SECRET (design §3.2, INV-7 — the default option, see the design's decisions section):
--   * LAZY LIVENESS. A reservation counts only while it is LIVE: its wish exists, the wish's recipient is the
--     reservation's recipient, and the giver reads the wish through an effective place NOW. Nothing the owner does
--     ever touches public.reservations — no foreign key, no trigger, no cascade, no update (INV-7 a: every
--     reservation counter of pg_stat_xact_user_tables stays 0 for every owner action, account deletion and block
--     included). Givers see a reservation that lost its access as "Nicht mehr verfügbar" (public reason
--     'unavailable', no context) at once; a bounded cleanup job ends such rows and erases "orphans" (rows whose giver
--     or recipient account is gone) in the background.
--   * BOUNDED ACCESS for givers (INV-7 b, Codex v1.4 #1): every function of a giver reads reservations only through
--     an index condition `wish_id = <one wish the caller reads in somebody else's list>` (the unique active index)
--     or `reserver_id = <the caller>` — always as correlated scalar subqueries (SubPlans; never an EXISTS/IN sublink
--     the planner could turn into a hash join over the whole table) and with enable_seqscan = off + enable_bitmapscan
--     = off (a lossy bitmap rechecks every row of a page — Codex 27.10 #1). A caller's own
--     wishes are never in somebody else's list, so the work never depends on reservations made on her wishes
--     (tested with counters in worlds with 0 / 20 / 200 such reservations and with real plans on PostgreSQL 17).
--   * reserve_wish stays atomic: the pair lock (giver, recipient) first — every access change (placements, deletes,
--     visibility, members, follows, blocks, the switches) takes the owner's profile lock first, so access cannot
--     change under it — then ONE active row per wish (unique partial index): a live foreign row = already_reserved,
--     a dead one is ended and replaced.
--
-- Columns that change meaning: reservations.wishlist_id = the wish's home when it was reserved, informational only (no
--   function reads it any more; it is not updated when the home changes); all
--   foreign keys of reservations are gone (their integrity is "eventual": liveness at read time + cleanup).
--   INSERT on wishes becomes a column grant WITHOUT id / created_at / updated_at / received_at: a wish's identity
--   comes from the database only (a reused id must never revive an old reservation, SW34).
-- Locks (design §4.1): the owner's profile row first in every writer here; then the list(s) FOR KEY SHARE, the
--   wishes, the places. Reservations only in a giver's own transaction (under the pair lock) and in the cleanup
--   (SKIP LOCKED, never waits for an owner).
-- Personal data: new — which lists a wish is in and since when (added_at); the dismissed reminder per occasion.
--   Both in the export (my_wishlists_export: wishes[].places, received_prompt_dismissed_at). Datenschutz notes:
--   docs/legal-drafts/pilot-5-notes.md (section "Ein Wunsch in mehreren Listen").
-- LATER MIGRATIONS that re-create get_occasion_screen / get_list_screen must keep calling
--   private.occasion_wishlist_json / private.list_wish_objects (the wish part of both screens lives there now).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tables (internal schema; no privileges for any API role; RLS enabled + forced, NOT ONE policy)
-- -----------------------------------------------------------------------------
create table private.wish_placements (
  wish_id     uuid not null references public.wishes(id)    on delete cascade,
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  added_at    timestamptz not null default clock_timestamp(),
  primary key (wish_id, wishlist_id)
);
create index wish_placements_list_idx on private.wish_placements (wishlist_id, wish_id);
comment on table private.wish_placements is
  'Every list a wish is in (its home = wishes.wishlist_id included). Internal: read only through private.effective_list_wishes / owner_list_wishes / can_read_wish / the hint helpers; written only by the shared-wish RPCs, the triggers and the unlink job.';

-- the host dismissed "Was hast du bekommen?" for this occasion
create table private.occasion_prompts (
  occasion_id  uuid primary key references public.occasions(id) on delete cascade,
  dismissed_at timestamptz not null default now()
);

-- the cleanup's cursors (design §3.2, Codex v1.4 #2): a pass covers the rows created up to pass_upper
create table private.maintenance_state (
  job                    text primary key check (job in ('stale', 'orphans', 'unlink')),
  after_id               uuid,                 -- watermark: the last id looked at (primary key order); null = start of a pass
  pass_upper             timestamptz,          -- the pass looks at rows created up to here (captured at its start)
  pass_started_at        timestamptz,
  last_pass_completed_at timestamptz,
  last_run_at            timestamptz
);
insert into private.maintenance_state (job) values ('stale'), ('orphans'), ('unlink');

alter table private.wish_placements   enable row level security;  alter table private.wish_placements   force row level security;
alter table private.occasion_prompts  enable row level security;  alter table private.occasion_prompts  force row level security;
alter table private.maintenance_state enable row level security;  alter table private.maintenance_state force row level security;
revoke all on private.wish_placements, private.occasion_prompts, private.maintenance_state from public, anon, authenticated;

-- the two switches (design §7): "add to more lists" (off until the new app ships) and "show the extra places"
alter table private.features
  add column shared_wishes         boolean not null default false,
  add column shared_wishes_visible boolean not null default true;

-- every existing wish: its home
insert into private.wish_placements (wish_id, wishlist_id, added_at)
select w.id, w.wishlist_id, w.created_at from public.wishes w
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. A wish's identity comes from the database only (SW34): INSERT without id / created_at / updated_at /
--    received_at. REVOKE on the table also drops column privileges, so revoke first, then grant.
-- -----------------------------------------------------------------------------
revoke insert on public.wishes from authenticated;
grant insert (wishlist_id, title, price_cents, currency, url, note, priority,
              description, brand, color, gtin, shop_name) on public.wishes to authenticated;

-- -----------------------------------------------------------------------------
-- 3. reservations: no link to any other table any more (design §2.4)
-- -----------------------------------------------------------------------------
alter table public.reservations drop constraint if exists reservations_wish_id_fkey;
alter table public.reservations drop constraint if exists reservations_wishlist_id_fkey;
alter table public.reservations drop constraint if exists reservations_recipient_id_fkey;
alter table public.reservations drop constraint if exists reservations_reserver_id_fkey;
drop trigger if exists wish_before_delete on public.wishes;
-- INDEXES = the access paths a giver may take (INV-7 b). Exactly three, and no two of them may be swapped by the
-- planner (Codex v1.4 #1; probe 27.10: with a second partial index of the active rows, the guests' screens scanned
-- THAT one from end to end — all active rows, those on the caller's own wishes included — instead of the lookup):
--   reservations_one_active_per_wish (wish_id) where active   the ONLY index of the active rows: lookups of one wish
--                                                              (and the one-active rule). Every per-wish query says
--                                                              `wish_id = <one wish> and status = 'active'`.
--   reservations_reserver_idx (reserver_id, status)             the giver's own rows. Every query by giver says
--                                                              `reserver_id = <the caller>` and keeps any status test
--                                                              OUT of its WHERE (in a FILTER / CASE), so the partial
--                                                              index above is never applicable to it.
--   reservations_pkey (id)                                       the cleanup's cursor (all rows; never a giver's path)
-- reservations_wishlist_idx goes: wishlist_id is read by nothing any more.
drop index if exists public.reservations_wishlist_idx;
comment on column public.reservations.wishlist_id is
  'Since 20261027200000: the wish''s home list at the moment of the reservation, informational only — read by no function, not updated when the home changes (a wish may be in several lists).';
comment on table public.reservations is
  'THE SECRET. No grants for any API role, no foreign keys, no trigger from other tables. A row counts only while it is LIVE (private.reservation_is_live); private.reservations_cleanup_run() ends dead rows and erases orphans.';

-- an ended row keeps its status and reason forever (Codex v1.4 #3: a late writer must not re-label it); wish_id may
-- only become null; parties immutable
create or replace function private.reservation_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reserver_id <> old.reserver_id or new.recipient_id <> old.recipient_id then raise exception using message = 'not_allowed'; end if;
  if old.status <> 'active' and (new.status is distinct from old.status or new.end_reason is distinct from old.end_reason) then
    raise exception using message = 'not_allowed';
  end if;
  if new.wish_id is not null and new.wish_id is distinct from old.wish_id then raise exception using message = 'not_allowed'; end if;
  return new;
end $$;

-- the policy is a second line of defence only (there is no grant): a giver's own rows, nothing else
drop policy reservations_select on public.reservations;
create policy reservations_select on public.reservations for select to authenticated
  using (reserver_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- 4. Helpers (security definer, never executable by an API role except where granted at the end)
-- -----------------------------------------------------------------------------
create or replace function private.shared_wishes_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.shared_wishes from private.features f), false);
$$;

-- a missing row reads as "hidden" (closed by default)
create or replace function private.shared_wishes_visible()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.shared_wishes_visible from private.features f), false);
$$;

-- the AUDIENCE's wishes of a list: the home always, another place while the extra places are visible
create or replace function private.effective_list_wishes(p_list uuid)
returns table (wish_id uuid, added_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.wish_id, p.added_at
    from private.wish_placements p join public.wishes w on w.id = p.wish_id
   where p.wishlist_id = p_list and (w.wishlist_id = p_list or private.shared_wishes_visible());
$$;

-- the OWNER's wishes of a list: every stored place; ownership asserted inside (Codex v1.4: a guest branch calling
-- this gets nothing). paused = an extra place while the extra places are hidden (emergency only).
create or replace function private.owner_list_wishes(p_list uuid, p_owner uuid)
returns table (wish_id uuid, is_home boolean, paused boolean, added_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.wish_id, w.wishlist_id = p_list, w.wishlist_id <> p_list and not private.shared_wishes_visible(), p.added_at
    from private.wish_placements p
    join public.wishes w on w.id = p.wish_id
    join public.wishlists wl on wl.id = p.wishlist_id
   where p.wishlist_id = p_list and wl.owner_id = p_owner and p_owner is not null;
$$;

-- the number of wishes in a list: stored (owner) or effective (audience)
create or replace function private.list_wish_count(p_list uuid, p_stored boolean)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from private.wish_placements p join public.wishes w on w.id = p.wish_id
   where p.wishlist_id = p_list and (p_stored or w.wishlist_id = p_list or private.shared_wishes_visible());
$$;

-- "3 neu": effective places added within the last 7 days
create or replace function private.list_new_wish_count(p_list uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from private.wish_placements p join public.wishes w on w.id = p.wish_id
   where p.wishlist_id = p_list and p.added_at > now() - interval '7 days'
     and (w.wishlist_id = p_list or private.shared_wishes_visible());
$$;

-- is this place of the wish effective?
create or replace function private.is_effective_placement(p_wish uuid, p_list uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.wish_placements p join public.wishes w on w.id = p.wish_id
                  where p.wish_id = p_wish and p.wishlist_id = p_list
                    and (w.wishlist_id = p_list or private.shared_wishes_visible()));
$$;

-- THE READ RULE: who reads at least one effective place of the wish (the owner always: her home is effective)
create or replace function private.can_read_wish(p_wish uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_uid is not null and exists (
    select 1 from private.wish_placements p join public.wishes w on w.id = p.wish_id
     where p.wish_id = p_wish and (p.wishlist_id = w.wishlist_id or private.shared_wishes_visible())
       and private.can_read_wishlist(p.wishlist_id, p_uid));
$$;

-- does the giver read the wish through an effective place that belongs to an occasion? (the cap of 5, Q8)
create or replace function private.reads_wish_via_occasion(p_wish uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.wish_placements p
      join public.wishes w on w.id = p.wish_id
      join public.wishlists wl on wl.id = p.wishlist_id
     where p.wish_id = p_wish and wl.occasion_id is not null
       and (p.wishlist_id = w.wishlist_id or private.shared_wishes_visible())
       and private.can_read_wishlist(p.wishlist_id, p_uid));
$$;

-- LIVENESS (design §3.2): the wish exists, its recipient is the reservation's, the giver is not its owner and reads it
-- through an effective place right now. Reads wishes / lists / places / access rows only — never reservations.
create or replace function private.reservation_is_live(p_wish uuid, p_reserver uuid, p_recipient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_wish is not null
     and exists (select 1 from public.wishes w join public.wishlists h on h.id = w.wishlist_id
                  where w.id = p_wish and h.recipient_id = p_recipient and h.owner_id <> p_reserver)
     and private.can_read_wish(p_wish, p_reserver);
$$;

-- a reservation that counts for the cap of 5 per recipient (lists without an occasion only): live, not received,
-- and the giver has no readable occasion place of the wish
create or replace function private.counts_for_cap(p_wish uuid, p_reserver uuid, p_recipient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.reservation_is_live(p_wish, p_reserver, p_recipient)
     and exists (select 1 from public.wishes w where w.id = p_wish and w.received_at is null)
     and not private.reads_wish_via_occasion(p_wish, p_reserver);
$$;

-- what a giver is told about a reservation (Q1 default): live -> null; their own reasons as they are; everything
-- else (access lost, wish gone, blocked, removed, moved) -> ONE neutral 'unavailable'
create or replace function private.public_end_reason(p_status text, p_reason text, p_live boolean)
returns text language sql immutable set search_path = '' as $$
  select case when p_status = 'active' and p_live then null
              when p_status = 'ended' and p_reason in ('by_reserver', 'member_left', 'unfollowed') then p_reason
              else 'unavailable' end;
$$;

-- the place a LIVE reservation is shown in: the giver's readable effective places, the home first, then the oldest
create or replace function private.reservation_place(p_wish uuid, p_reserver uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.wishlist_id
    from private.wish_placements p join public.wishes w on w.id = p.wish_id
   where p.wish_id = p_wish and (p.wishlist_id = w.wishlist_id or private.shared_wishes_visible())
     and private.can_read_wishlist(p.wishlist_id, p_reserver)
   order by (p.wishlist_id = w.wishlist_id) desc, p.added_at, p.wishlist_id
   limit 1;
$$;

-- the owner's hint "auch in …": every stored place except this list (ownership asserted inside)
create or replace function private.wish_places_for_owner(p_wish uuid, p_except uuid, p_owner uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', wl.id, 'title', coalesce(wl.title, o.title),
           'kind', case when wl.occasion_id is null then 'standalone' else 'occasion' end,
           'occasion_id', wl.occasion_id,
           'home', wl.id = w.wishlist_id,
           'paused', wl.id <> w.wishlist_id and not private.shared_wishes_visible())
           order by (wl.id = w.wishlist_id) desc, p.added_at, wl.id), '[]'::jsonb)
    from private.wish_placements p
    join public.wishes w on w.id = p.wish_id
    join public.wishlists wl on wl.id = p.wishlist_id
    left join public.occasions o on o.id = wl.occasion_id
   where p.wish_id = p_wish and p.wishlist_id is distinct from p_except and wl.owner_id = p_owner;
$$;

-- a guest's hint (Q18 default): the other EFFECTIVE places they can read by name; places they cannot read as ONE
-- {kind: 'hidden'} entry (never how many, never which)
create or replace function private.wish_places_for_viewer(p_wish uuid, p_except uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with places as (
    select wl.id, coalesce(wl.title, o.title) as title,
           case when wl.occasion_id is null then 'standalone' else 'occasion' end as kind,
           private.can_read_wishlist(wl.id, p_viewer) as readable, p.added_at
      from private.wish_placements p
      join public.wishes w on w.id = p.wish_id
      join public.wishlists wl on wl.id = p.wishlist_id
      left join public.occasions o on o.id = wl.occasion_id
     where p.wish_id = p_wish and p.wishlist_id is distinct from p_except
       and (p.wishlist_id = w.wishlist_id or private.shared_wishes_visible()))
  select coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'kind', x.kind) order by x.added_at, x.id)
                     from places x where x.readable), '[]'::jsonb)
      || case when exists (select 1 from places x where not x.readable)
              then jsonb_build_array(jsonb_build_object('id', null, 'title', null, 'kind', 'hidden'))
              else '[]'::jsonb end;
$$;

-- the effective end of an occasion (the formula of every screen)
create or replace function private.occasion_end(p_occasion uuid)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz)
    from public.occasions o where o.id = p_occasion;
$$;

create or replace function private.occasion_place_ttl()
returns interval language sql immutable set search_path = '' as $$ select interval '7 days' $$;

-- "Was hast du bekommen?" (Q19 default): day 1 .. 7 after the end, not dismissed, open wishes left in the list
create or replace function private.received_prompt_due(p_list uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select now() >= private.occasion_end(wl.occasion_id) + interval '1 day'
       and now() <  private.occasion_end(wl.occasion_id) + private.occasion_place_ttl()
       and not exists (select 1 from private.occasion_prompts op where op.occasion_id = wl.occasion_id)
       and exists (select 1 from private.owner_list_wishes(wl.id, wl.owner_id) ow
                     join public.wishes w on w.id = ow.wish_id where w.received_at is null)
      from public.wishlists wl where wl.id = p_list and wl.occasion_id is not null), false);
$$;

-- -----------------------------------------------------------------------------
-- 5. Triggers
-- -----------------------------------------------------------------------------

-- a new wish gets its home place (added_at = its created_at)
create or replace function private.wish_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.wish_placements (wish_id, wishlist_id, added_at)
  values (new.id, new.wishlist_id, new.created_at)
  on conflict do nothing;
  return new;
end $$;
create trigger wish_after_insert after insert on public.wishes
  for each row execute function private.wish_after_insert();

-- deleting a list (REST, the occasion's cascade): a wish that also lives elsewhere stays — when this list was its
-- home, the home moves to its oldest other place (a list still there). Its place here goes with the list (cascade).
-- Reservations are not touched. Skipped inside an account deletion (the owner's profile is gone: everything goes).
create or replace function private.wishlist_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_wish record; v_new uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = old.owner_id) then return old; end if;
  for v_wish in select w.id from public.wishes w where w.wishlist_id = old.id order by w.id loop
    select p.wishlist_id into v_new
      from private.wish_placements p join public.wishlists wl on wl.id = p.wishlist_id
     where p.wish_id = v_wish.id and p.wishlist_id <> old.id and wl.owner_id = old.owner_id
     order by p.added_at, p.wishlist_id
     limit 1;
    if v_new is not null then
      update public.wishes w set wishlist_id = v_new where w.id = v_wish.id;
    end if;
  end loop;
  return old;
end $$;
create trigger wishlist_before_delete before delete on public.wishlists
  for each row execute function private.wishlist_before_delete();

-- an app that does not know shared wishes deletes a wish through REST: refused while it lives in more than one list
-- (stored places — what the owner sees). Only for the API roles: delete_wish_everywhere() and cascades run as the
-- table owner. The name sorts it before other delete triggers.
create or replace function private.wish_shared_delete_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from private.wish_placements p where p.wish_id = old.id) > 1 then
    raise exception using message = 'not_allowed';
  end if;
  return old;
end $$;
create trigger wish_aa_shared_delete_guard before delete on public.wishes
  for each row when (current_user in ('anon', 'authenticated'))
  execute function private.wish_shared_delete_guard();

-- -----------------------------------------------------------------------------
-- 6. The wish part of the two list screens (one place for every role; called by get_occasion_screen and
--    get_list_screen). Owner: stored places, literal nulls, reservations NOT referenced. Audience: effective places,
--    a reservation only when LIVE, read per wish through the unique active index (a SubPlan, INV-7 b).
-- -----------------------------------------------------------------------------
create or replace function private.list_wish_objects(p_list uuid, p_viewer uuid, p_owner_view boolean, p_hints boolean)
returns jsonb language plpgsql stable security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
declare
  v_wishes   jsonb;
  v_received jsonb;
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
                                   'also_in', private.wish_places_for_owner(w.id, p_list, p_viewer)) as j) x;
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
             || jsonb_build_object('also_in', case when p_hints then private.wish_places_for_viewer(w.id, p_list, p_viewer) end) as j) x;
  end if;
  return jsonb_build_object('wishes', v_wishes, 'received', v_received);
end $$;

-- the occasion screen's `wishlist` object
create or replace function private.occasion_wishlist_json(p_list uuid, p_viewer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_wl    record;
  v_owner boolean;
  v_parts jsonb;
  v_out   jsonb;
begin
  select wl.id, wl.owner_id, wl.recipient_id, wl.title into v_wl from public.wishlists wl where wl.id = p_list;
  if not found then return null; end if;
  v_owner := p_viewer in (v_wl.owner_id, v_wl.recipient_id);
  v_parts := private.list_wish_objects(v_wl.id, p_viewer, v_owner, true);
  v_out := jsonb_build_object('id', v_wl.id, 'owner_id', v_wl.owner_id, 'title', v_wl.title,
                              'photo', private.list_photo_meta(v_wl.id),
                              'wishes', v_parts -> 'wishes', 'received', v_parts -> 'received');
  if v_owner then v_out := v_out || jsonb_build_object('received_prompt', private.received_prompt_due(v_wl.id)); end if;
  return v_out;
end $$;

-- -----------------------------------------------------------------------------
-- 7. get_occasion_screen(): the 20261027190000 body (place_lat / place_lon, cover_theme, ends_at, sections,
--    potluck); the wishlist object from private.occasion_wishlist_json.
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
    -- 20261027200000: the owner gets the stored places (+ home, paused, also_in, received_prompt), guests the
    -- effective places (+ also_in hints) with LIVE reservations only — private.occasion_wishlist_json
    v_wishlist := private.occasion_wishlist_json(v_wl.id, v_uid);
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

-- -----------------------------------------------------------------------------
-- 8. get_list_screen(): the 20261022160000 body; the wishes from private.list_wish_objects (followers: no hints, Q18)
-- -----------------------------------------------------------------------------
create or replace function public.get_list_screen(p_list_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_wl    record;
  v_role  text;
  v_parts jsonb;
begin
  select wl.id, wl.owner_id, wl.recipient_id, wl.title, wl.visibility, wl.cover_tone, wl.cover_icon, wl.due_on, wl.created_at
    into v_wl from public.wishlists wl where wl.id = p_list_id and wl.occasion_id is null;
  if not found or not private.can_read_wishlist(v_wl.id, v_uid) then
    raise exception using message = 'not_found';
  end if;
  if v_uid in (v_wl.owner_id, v_wl.recipient_id) then
    v_role := 'owner';
    v_parts := private.list_wish_objects(v_wl.id, v_uid, true, false);
  else
    -- (only an accepted follower of a 'followers' list gets past can_read_wishlist above)
    v_role := 'follower';
    v_parts := private.list_wish_objects(v_wl.id, v_uid, false, false);
  end if;
  return jsonb_build_object(
    'list', jsonb_build_object('id', v_wl.id, 'title', v_wl.title, 'kind', 'standalone', 'visibility', v_wl.visibility,
              'cover_tone', v_wl.cover_tone, 'cover_icon', v_wl.cover_icon, 'due_on', v_wl.due_on,
              'created_at', v_wl.created_at, 'owner', private.profile_card(v_wl.owner_id),
              'photo', private.list_photo_meta(v_wl.id)),
    'viewer', jsonb_build_object('role', v_role),
    'wishes', v_parts -> 'wishes',
    'received', v_parts -> 'received');
end $$;

-- -----------------------------------------------------------------------------
-- 9. Owner writes. Each takes the owner's profile row first; none reads or writes public.reservations; the answer
--    depends on the owner's own data and the switches only.
-- -----------------------------------------------------------------------------

-- add_wishes_to_list(p_list_id, p_wish_ids) -> { ok, added } (design §5.3, Q4/Q5/Q10 defaults)
--   target: one of MY occasion lists (else not_found); the wishes: MY wishes whose home is a list without an occasion
--   (else not_found / validation); received wishes are not added (validation); already there = nothing to do
--   ("Schon drin"); at most 50 per call and 10 places per wish (limit_reached); the switch off -> not_allowed;
--   the target has an audience -> the current legal records (consent_required).
create or replace function public.add_wishes_to_list(p_list_id uuid, p_wish_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid    uuid := private.require_user();
  v_target record;
  v_ids    uuid[];
  v_found  integer := 0;
  v_added  integer := 0;
  v_wish   record;
  v_n      integer;
begin
  if p_wish_ids is null or cardinality(p_wish_ids) = 0 or cardinality(p_wish_ids) > 50
     or exists (select 1 from unnest(p_wish_ids) x where x is null) then
    raise exception using message = 'validation';
  end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_wish_ids) x;

  perform private.lock_profile_pair(v_uid, v_uid);
  -- the switch, read under the lock (the emergency switch takes LOCK TABLE profiles first)
  if not private.shared_wishes_on() then raise exception using message = 'not_allowed'; end if;

  select wl.id, wl.occasion_id, wl.recipient_id into v_target
    from public.wishlists wl where wl.id = p_list_id and wl.owner_id = v_uid for key share;
  if not found or v_target.occasion_id is null then raise exception using message = 'not_found'; end if;
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;

  for v_wish in
    select w.id, w.wishlist_id, w.received_at, h.occasion_id as home_occasion, h.recipient_id
      from public.wishes w join public.wishlists h on h.id = w.wishlist_id
     where w.id = any(v_ids) and h.owner_id = v_uid
     order by w.id
       for key share of w
  loop
    v_found := v_found + 1;
    if v_wish.wishlist_id = v_target.id
       or exists (select 1 from private.wish_placements p where p.wish_id = v_wish.id and p.wishlist_id = v_target.id) then
      continue;                                                  -- already there ("Schon drin")
    end if;
    if v_wish.home_occasion is not null or v_wish.received_at is not null
       or v_wish.recipient_id is distinct from v_target.recipient_id then
      raise exception using message = 'validation';              -- from an occasion (Q2/Q3) / received (Q5)
    end if;
    select count(*) into v_n from private.wish_placements p where p.wish_id = v_wish.id;
    if v_n >= 10 then raise exception using message = 'limit_reached'; end if;   -- Q10
    insert into private.wish_placements (wish_id, wishlist_id) values (v_wish.id, v_target.id)
    on conflict do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;
  if v_found <> cardinality(v_ids) then raise exception using message = 'not_found'; end if;   -- not mine / gone
  return jsonb_build_object('ok', true, 'added', v_added);
end $$;

-- remove_wish_from_list(p_wish_id, p_list_id) -> { ok } — "Aus „…“ entfernen". The wish stays in its other lists;
-- when this list was its home, the home moves to the oldest other place. The last place: validation (delete it).
create or replace function public.remove_wish_from_list(p_wish_id uuid, p_list_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_home uuid;
  v_new  uuid;
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  select w.wishlist_id into v_home
    from public.wishes w join public.wishlists h on h.id = w.wishlist_id
   where w.id = p_wish_id and h.owner_id = v_uid
     for update of w;
  if not found then raise exception using message = 'not_found'; end if;
  if not exists (select 1 from private.wish_placements p where p.wish_id = p_wish_id and p.wishlist_id = p_list_id) then
    raise exception using message = 'not_found';
  end if;
  select p.wishlist_id into v_new from private.wish_placements p
   where p.wish_id = p_wish_id and p.wishlist_id <> p_list_id
   order by p.added_at, p.wishlist_id limit 1;
  if v_new is null then raise exception using message = 'validation'; end if;   -- its only list: delete instead
  if v_home = p_list_id then
    update public.wishes w set wishlist_id = v_new where w.id = p_wish_id;
  end if;
  delete from private.wish_placements p where p.wish_id = p_wish_id and p.wishlist_id = p_list_id;
  return jsonb_build_object('ok', true);
end $$;

-- delete_wish_everywhere(p_wish_id) -> { ok } — "Überall löschen" (the REST delete refuses a shared wish).
create or replace function public.delete_wish_everywhere(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  delete from public.wishes w
   where w.id = p_wish_id
     and exists (select 1 from public.wishlists h where h.id = w.wishlist_id and h.owner_id = v_uid);
  if not found then raise exception using message = 'not_found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- dismiss_received_prompt(p_occasion_id) -> { ok } — the host closes "Was hast du bekommen?" for this occasion
create or replace function public.dismiss_received_prompt(p_occasion_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  -- the occasion row FOR KEY SHARE: a concurrent delete of the occasion (REST, no profile lock) waits for this insert
  -- and then cascades it, instead of turning it into a raw FK error (Codex 27.10 #3). One lock only: no lock order.
  perform 1 from public.occasions o
   where o.id = p_occasion_id
     and exists (select 1 from public.wishlists wl where wl.occasion_id = o.id and wl.owner_id = v_uid)
     for key share of o;
  if not found then raise exception using message = 'not_found'; end if;
  insert into private.occasion_prompts (occasion_id) values (p_occasion_id) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- move_wish(): the 20261022160000 body without any reservation work; a shared wish (more than one stored place)
-- does not move (validation, Q15) — remove it from a list instead. Its home place follows the wish.
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
  -- a wish in several lists does not move (stored places: what the owner sees)
  if (select count(*) from private.wish_placements p where p.wish_id = p_wish_id) > 1 then
    raise exception using message = 'validation';
  end if;
  -- widening the audience needs the current legal records; moving into "Nur ich" never does
  if v_to.visibility <> 'private' and not private.has_consents(v_uid) then
    raise exception using message = 'consent_required';
  end if;

  update public.wishes w set wishlist_id = v_to.id where w.id = p_wish_id and w.wishlist_id = v_from.id;
  if not found then raise exception using message = 'not_found'; end if;
  update private.wish_placements p set wishlist_id = v_to.id where p.wish_id = p_wish_id and p.wishlist_id = v_from.id;
  -- reservations: untouched. A giver who cannot read the new list holds a dead reservation from now on (liveness).
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 10. Access changes WITHOUT any reservation work (INV-7 a): the bodies of their latest definitions, minus the
--     reservation statements. A giver who loses access holds a dead reservation from that moment on.
-- -----------------------------------------------------------------------------

-- no caller left; kept (empty) so that nothing can end reservations through them by accident
create or replace function private.end_list_reservations(p_list uuid, p_reason text)
returns void language sql volatile security definer set search_path = '' as $$ select null::void $$;
create or replace function private.end_follow_reservations(p_follower uuid, p_owner uuid, p_reason text)
returns void language sql volatile security definer set search_path = '' as $$ select null::void $$;
create or replace function private.end_reservations_in_occasion(p_occasion uuid, p_uid uuid, p_reason text)
returns void language sql volatile security definer set search_path = '' as $$ select null::void $$;

-- the GIVER's own action (leave / unfollow): their own active rows that are no longer live end at once with their
-- own reason — through the index on reserver_id only (INV-7 b)
create or replace function private.end_own_dead_reservations(p_uid uuid, p_reason text)
returns void language sql volatile security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
  update public.reservations r set status = 'ended', end_reason = p_reason, ended_at = now()
   where r.reserver_id = p_uid   -- (the status test inside the CASE: see the indexes in §3)
     and case when r.status = 'active' then not private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id) else false end;
$$;

-- leave_occasion trims the cap (design §3.2 "leave_occasion обрезает лимит", Codex 27.10 #2): a wish that also sits in
-- a list without an occasion stays live after leaving and now COUNTS — beyond 5 for this recipient, the giver's newest
-- counted rows end with the leave's reason, the oldest 5 stay. The giver's own rows only (index on reserver_id, INV-7 b).
create or replace function private.trim_own_cap(p_uid uuid, p_recipient uuid, p_reason text)
returns void language sql volatile security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
  update public.reservations r set status = 'ended', end_reason = p_reason, ended_at = now()
   where r.reserver_id = p_uid   -- (the status test inside the CASE: see the indexes in §3)
     and case when r.status = 'active' and r.recipient_id = p_recipient
              then private.counts_for_cap(r.wish_id, r.reserver_id, r.recipient_id)
                   and (select count(*) filter (where o.status = 'active' and o.recipient_id = p_recipient
                                                  and (o.created_at, o.id) < (r.created_at, r.id)
                                                  and private.counts_for_cap(o.wish_id, o.reserver_id, o.recipient_id))
                          from public.reservations o
                         where o.reserver_id = p_uid) >= 5
              else false end;
$$;

-- set_list_visibility(): the 20261020200200 body without end_list_reservations
create or replace function public.set_list_visibility(p_list_id uuid, p_visibility text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid       uuid := private.require_user();
  v_owner     uuid;
  v_recipient uuid;
begin
  if p_visibility is null or p_visibility not in ('private', 'followers') then
    raise exception using message = 'validation';
  end if;
  select wl.owner_id, wl.recipient_id into v_owner, v_recipient from public.wishlists wl
   where wl.id = p_list_id and wl.owner_id = v_uid and wl.occasion_id is null;
  if not found then raise exception using message = 'not_found'; end if;        -- foreign / unknown / an occasion's list
  if p_visibility = 'followers' then                                              -- widening; narrowing needs nothing
    if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
    if not private.profile_complete(v_uid) then raise exception using message = 'profile_incomplete'; end if;
  end if;
  perform private.lock_profile_pair(v_owner, v_recipient);
  update public.wishlists set visibility = p_visibility where id = p_list_id and owner_id = v_uid;
  if not found then raise exception using message = 'not_found'; end if;        -- deleted while we waited
  return jsonb_build_object('ok', true);                                          -- reservations: untouched (liveness)
end $$;

-- remove_member(): the 20261019120500 body without end_reservations_in_occasion
create or replace function public.remove_member(p_occasion_id uuid, p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, p_profile_id);
  perform o.id from public.occasions o where o.id = p_occasion_id and o.host_id = v_uid for update;
  if not private.is_host(p_occasion_id, v_uid) then raise exception using message = 'not_found'; end if;
  update public.occasion_members set status = 'removed'
   where occasion_id = p_occasion_id and profile_id = p_profile_id and role = 'member' and status = 'active';
  if not found then raise exception using message = 'not_found'; end if;
  -- the link the removed guest still has must die with the membership (F-1)
  update public.invites set revoked_at = now()
   where occasion_id = p_occasion_id and revoked_at is null;
  return jsonb_build_object('ok', true);
end $$;

-- remove_follower(): the 20261020200100 body without end_follow_reservations
create or replace function public.remove_follower(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if p_profile_id is null then raise exception using message = 'not_found'; end if;
  perform private.lock_profile_pair(v_uid, p_profile_id);
  delete from public.follows f where f.follower_id = p_profile_id and f.followee_id = v_uid and f.status = 'accepted';
  if not found then raise exception using message = 'not_found'; end if;
  insert into public.follow_cooldowns as c (followee_id, follower_id, until)
  values (v_uid, p_profile_id, now() + interval '30 days')
  on conflict (followee_id, follower_id) do update set until = greatest(c.until, excluded.until);   -- INV-6
  return jsonb_build_object('ok', true);
end $$;

-- block_user(): the 20261020200100 body without both reservation updates (design §5.4: both sides' reservations
-- become dead at once — a block closes reading — and the cleanup ends them)
create or replace function public.block_user(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, p_profile_id);
  if p_profile_id is null or p_profile_id = v_uid
     or not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception using message = 'not_found';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_uid, p_profile_id) on conflict do nothing;

  update public.occasion_members m
     set status = case when o.host_id = v_uid then 'removed' else 'left' end
    from public.occasions o
   where o.id = m.occasion_id and m.status = 'active' and m.role = 'member'
     and ((o.host_id = v_uid and m.profile_id = p_profile_id) or (o.host_id = p_profile_id and m.profile_id = v_uid));

  delete from public.follows f
   where (f.follower_id = v_uid and f.followee_id = p_profile_id)
      or (f.follower_id = p_profile_id and f.followee_id = v_uid);
  return jsonb_build_object('ok', true);
end $$;

-- delete_my_account(): the 20261019120500 body without the delete of reservations (design §5.4, Q21 default): the
-- rows where the person gives or receives are hidden from every answer at once (orphans) and erased by the cleanup
create or replace function public.delete_my_account()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  perform private.lock_profile_pair(v_uid, v_uid);
  delete from auth.users u where u.id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- leave_occasion(): the 20261019120500 body; the giver's own dead rows end as 'member_left', then the cap is trimmed
create or replace function public.leave_occasion(p_occasion_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_host uuid;
begin
  select o.host_id into v_host from public.occasions o where o.id = p_occasion_id;
  perform private.lock_profile_pair(v_uid, v_host);
  if private.is_host(p_occasion_id, v_uid) then raise exception using message = 'not_allowed'; end if;   -- the host deletes instead
  update public.occasion_members set status = 'left'
   where occasion_id = p_occasion_id and profile_id = v_uid and status = 'active';
  if not found then raise exception using message = 'not_found'; end if;
  perform private.end_own_dead_reservations(v_uid, 'member_left');
  -- the occasion's wishes are the host's (an occasion list's owner); under the pair lock (v_uid, v_host) taken above
  perform private.trim_own_cap(v_uid, v_host, 'member_left');
  return jsonb_build_object('ok', true);
end $$;

-- unfollow(): the 20261020200100 body; after an accepted follow the giver's own dead rows end as 'unfollowed'
create or replace function public.unfollow(p_profile_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.require_user(); v_status text;
begin
  if p_profile_id is null then return jsonb_build_object('ok', true); end if;
  perform private.lock_profile_pair(v_uid, p_profile_id);
  delete from public.follows f where f.follower_id = v_uid and f.followee_id = p_profile_id
  returning f.status into v_status;
  if v_status = 'accepted' then perform private.end_own_dead_reservations(v_uid, 'unfollowed'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 11. Giver: reserve, cancel, history, export — bounded access only (INV-7 b)
-- -----------------------------------------------------------------------------

-- reserve_wish(p_wish_id) -> { ok } (design §3.2). Codes as before: not_found, not_allowed, already_reserved,
-- limit_reached, consent_required, profile_incomplete.
create or replace function public.reserve_wish(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
declare
  v_uid       uuid := private.require_user();
  v_owner     uuid;
  v_recipient uuid;
  v_title     text;
  v_received  timestamptz;
  v_home      uuid;
  v_row       record;
  v_id        uuid;
  v_taken     boolean;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  if not private.profile_complete(v_uid) then
    -- An account deletion can commit between the initial require_user/consent checks and this statement.
    -- Preserve the deleted-account refusal instead of mislabelling it as an incomplete live profile.
    perform private.require_user();
    raise exception using message = 'profile_incomplete';
  end if;

  select h.owner_id, h.recipient_id into v_owner, v_recipient
    from public.wishes w join public.wishlists h on h.id = w.wishlist_id where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;

  -- 1) owner / recipient: ALWAYS not_allowed, decided before the audience or reservations are looked at
  if v_uid in (v_owner, v_recipient) then raise exception using message = 'not_allowed'; end if;

  -- 2) the pair lock first: every access change of this wish (places, deletes, visibility, members, follows,
  --    blocks, the switches) takes the owner's profile row first, so nothing below changes until we commit
  perform private.lock_profile_pair(v_uid, v_recipient);
  select w.title, w.received_at, w.wishlist_id into v_title, v_received, v_home
    from public.wishes w join public.wishlists h on h.id = w.wishlist_id
   where w.id = p_wish_id and h.recipient_id = v_recipient and h.owner_id = v_owner
     for key share of w;
  if not found then raise exception using message = 'not_found'; end if;   -- deleted / re-homed while we waited
  if not private.can_read_wish(p_wish_id, v_uid)
     or private.is_blocked_pair(v_uid, v_owner) or private.is_blocked_pair(v_uid, v_recipient) then
    raise exception using message = 'not_allowed';
  end if;

  -- 3) the ONE active row of this wish (unique index), locked; the codes keep the pilot's order: the same giver
  --    again -> idempotent { ok }; received -> not_allowed; the cap -> limit_reached; somebody else's LIVE row ->
  --    already_reserved; a DEAD row (whoever's) is ended here and replaced
  select r.id, r.reserver_id, r.recipient_id, r.wish_id,
         private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id) as live
    into v_row
    from public.reservations r where r.wish_id = p_wish_id and r.status = 'active'
     for update;
  v_taken := found;
  if v_taken and v_row.live and v_row.reserver_id = v_uid then return jsonb_build_object('ok', true); end if;

  -- 3a) the owner marked the wish as received: never newly reserved
  if v_received is not null then raise exception using message = 'not_allowed'; end if;

  -- 3b) at most 5 counted reservations of one giver for one recipient (lists without an occasion, Q8): only when
  --     this wish is reached through no occasion of the giver; only the giver's own rows (index on reserver_id)
  if not private.reads_wish_via_occasion(p_wish_id, v_uid)
     and (select count(*) filter (where r.status = 'active' and r.recipient_id = v_recipient
                                    and private.counts_for_cap(r.wish_id, r.reserver_id, r.recipient_id))
            from public.reservations r
           where r.reserver_id = v_uid) >= 5 then   -- (the status test in the FILTER: see the indexes in §3)
    raise exception using message = 'limit_reached';
  end if;

  if v_taken then
    if v_row.live then raise exception using message = 'already_reserved'; end if;
    update public.reservations r set status = 'ended', end_reason = 'access_ended', ended_at = now()
     where r.id = v_row.id and r.status = 'active';
  end if;

  -- 4) atomic: a concurrent second insert waits for the first commit, sees the conflict -> already_reserved
  insert into public.reservations (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot)
  values (p_wish_id, v_home, v_recipient, v_uid, v_title)   -- wishlist_id: the home at this moment, informational only
  on conflict (wish_id) where status = 'active' do nothing
  returning id into v_id;
  if v_id is null then raise exception using message = 'already_reserved'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- cancel_reservation(p_wish_id) -> { ok }: the giver ends their own active row of a wish they can read
create or replace function public.cancel_reservation(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
declare
  v_uid       uuid := private.require_user();
  v_owner     uuid;
  v_recipient uuid;
  v_id        uuid;
begin
  select h.owner_id, h.recipient_id into v_owner, v_recipient
    from public.wishes w join public.wishlists h on h.id = w.wishlist_id where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  if v_uid in (v_owner, v_recipient) then raise exception using message = 'not_allowed'; end if;
  if not private.can_read_wish(p_wish_id, v_uid) then raise exception using message = 'not_allowed'; end if;

  update public.reservations r
     set status = 'ended', end_reason = 'by_reserver', ended_at = now()
   where r.wish_id = p_wish_id and r.status = 'active' and r.reserver_id = v_uid and r.recipient_id = v_recipient
  returning r.id into v_id;
  if v_id is null then raise exception using message = 'not_found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- my_reservations(): the 20261022160000 keys. A LIVE row: status 'active', the place it is shown in (an occasion:
-- occasion_*; a list without an occasion: list{id,title,owner_name}), live title and received_at. Every other row:
-- the public reason (Q1: 'unavailable' unless member_left / unfollowed), wish_id null, the snapshot title, no
-- context. Rows whose recipient account is gone: not shown (orphans, erased by the cleanup). Index on reserver_id.
create or replace function public.my_reservations()
returns jsonb language plpgsql stable security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'wish_id', case when x.live then x.wish_id end,
             'wish_title', coalesce(case when x.live then w.title end, x.wish_title_snapshot),
             'occasion_id', o.id, 'occasion_title', o.title, 'starts_at', o.starts_at,
             'status', case when x.live then 'active' else 'ended' end,
             'end_reason', private.public_end_reason(x.status, x.end_reason, x.live),
             'created_at', x.created_at,
             'received_at', case when x.live then w.received_at end,
             'list', case when wl.id is not null and wl.occasion_id is null then jsonb_build_object(
                       'id', wl.id, 'title', wl.title,
                       'owner_name', (select p.display_name from public.profiles p where p.id = wl.owner_id)) end)
             order by x.created_at desc, x.id), '[]'::jsonb)
      from (select r.id, r.wish_id, r.status, r.end_reason, r.created_at, r.ended_at, r.wish_title_snapshot,
                   r.status = 'active' and private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id) as live
              from public.reservations r
             where r.reserver_id = v_uid
               and exists (select 1 from public.profiles rp where rp.id = r.recipient_id)
               and (r.status = 'active'
                    or (r.end_reason <> 'by_reserver' and r.ended_at >= now() - interval '90 days'))) x
      left join public.wishlists wl on x.live and wl.id = private.reservation_place(x.wish_id, v_uid)
      left join public.wishes w on x.live and w.id = x.wish_id
      left join public.occasions o on o.id = wl.occasion_id
  );
end $$;

-- the giver's export (Art. 15 / 20, Codex v1.4 #6): EVERY retained row of the caller, cancellations included.
-- Live rows with their context; every other row redacted to what the giver may know (public reason, snapshot title,
-- times). A row whose recipient account is gone keeps only status and times (the title was the deleted person's).
create or replace function private.my_reservations_export()
returns jsonb language sql stable security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'wish_title', case when not x.recipient_exists then null
                              else coalesce(case when x.live then w.title end, x.wish_title_snapshot) end,
           'recipient_name', case when x.live and not private.is_blocked_pair(auth.uid(), x.recipient_id) then p.display_name end,
           'occasion_title', o.title,
           'status', case when x.live then 'active' else 'ended' end,
           'end_reason', private.public_end_reason(x.status, x.end_reason, x.live),
           'created_at', x.created_at, 'ended_at', x.ended_at,
           'list', case when wl.id is not null and wl.occasion_id is null then jsonb_build_object(
                     'id', wl.id, 'title', wl.title,
                     'owner_name', (select op.display_name from public.profiles op where op.id = wl.owner_id)) end)
           order by x.created_at, x.id), '[]'::jsonb)
    from (select r.id, r.wish_id, r.recipient_id, r.status, r.end_reason, r.created_at, r.ended_at, r.wish_title_snapshot,
                 exists (select 1 from public.profiles rp where rp.id = r.recipient_id) as recipient_exists,
                 r.status = 'active' and private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id) as live
            from public.reservations r
           where r.reserver_id = auth.uid()) x
    left join public.wishlists wl on x.live and wl.id = private.reservation_place(x.wish_id, auth.uid())
    left join public.wishes w on x.live and w.id = x.wish_id
    left join public.profiles p on x.live and p.id = x.recipient_id
    left join public.occasions o on o.id = wl.occasion_id;
$$;

-- -----------------------------------------------------------------------------
-- 12. Other readers of wishes
-- -----------------------------------------------------------------------------

-- get_wish_photo(): the 20261022120000 body; the readers of the WISH (any effective place)
create or replace function public.get_wish_photo(p_wish_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_ph   record;
begin
  if not exists (select 1 from public.wishes w where w.id = p_wish_id) or not private.can_read_wish(p_wish_id, v_uid) then
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

-- private.follower_list_cards(): the 20261022160000 body; counts by effective places
create or replace function private.follower_list_cards(p_owner uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', wl.id, 'title', wl.title, 'cover_tone', wl.cover_tone, 'cover_icon', wl.cover_icon, 'due_on', wl.due_on,
           'photo', private.list_photo_meta(wl.id),
           'wish_count', private.list_wish_count(wl.id, false),
           'new_wish_count', private.list_new_wish_count(wl.id))
           order by case when wl.due_on >= (now() at time zone 'Europe/Berlin')::date then 0 else 1 end,
                    case when wl.due_on >= (now() at time zone 'Europe/Berlin')::date then wl.due_on end asc,
                    wl.created_at desc, wl.id), '[]'::jsonb)
    from public.wishlists wl
   where wl.owner_id = p_owner and wl.visibility = 'followers' and wl.occasion_id is null
     and private.can_read_wishlist(wl.id, p_viewer);
$$;

-- get_free_wishes() ("Ideen" / "Noch frei"): the 20261022160000 body, one entry per WISH (not per place): the
-- wishes the viewer reads through effective places of the person's lists (occasions not ended), open, not
-- reserved by a LIVE reservation; `list` = the first place (by date, the home first), `lists` = every such place
-- (each the shape of `list`, design §5.6). The reservation is looked up per wish (SubPlan, INV-7 b).
create or replace function public.get_free_wishes(p_profile_id uuid, p_max_cents integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
declare v_uid uuid := private.require_user();
begin
  if p_max_cents is not null and p_max_cents not between 0 and 100000000 then
    raise exception using message = 'validation';
  end if;
  if not private.can_find_gift(v_uid, p_profile_id) then
    raise exception using message = 'not_found';      -- myself, a stranger, a blocked person: one answer
  end if;
  return jsonb_build_object('person', private.profile_card(p_profile_id), 'ideas', (
    with places as (
      select e.wish_id, wl.id as list_id, (e.wish_id is not null and w.wishlist_id = wl.id) as is_home,
             coalesce(wl.due_on, (o.starts_at at time zone o.tz)::date) as day,
             jsonb_build_object('id', wl.id, 'title', coalesce(wl.title, o.title),
                       'kind', case when wl.occasion_id is null then 'standalone' else 'occasion' end,
                       'date', coalesce(wl.due_on, (o.starts_at at time zone o.tz)::date),
                       'occasion_id', wl.occasion_id,
                       'photo', private.list_photo_meta(wl.id)) as j
        from public.wishlists wl
        left join public.occasions o on o.id = wl.occasion_id
        cross join lateral private.effective_list_wishes(wl.id) e
        join public.wishes w on w.id = e.wish_id
       where wl.owner_id = p_profile_id and wl.recipient_id <> v_uid
         and private.can_read_wishlist(wl.id, v_uid)
         and (wl.occasion_id is null
              or coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) >= now())
    ), per_wish as (
      select pl.wish_id,
             jsonb_agg(pl.j order by pl.day asc nulls last, pl.is_home desc, pl.list_id) as lists,
             (array_agg(pl.j order by pl.day asc nulls last, pl.is_home desc, pl.list_id))[1] as first_list,
             min(pl.day) as day
        from places pl group by pl.wish_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'wish_id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
             'priority', w.priority, 'created_at', w.created_at,
             'list', pw.first_list, 'lists', pw.lists) || private.wish_detail_fields(w)
             order by pw.day asc nulls last, w.priority desc, w.price_cents asc nulls last, w.created_at asc, w.id), '[]'::jsonb)
      from per_wish pw
      join public.wishes w on w.id = pw.wish_id
     where w.received_at is null
       and (select r.id from public.reservations r
             where r.wish_id = w.id and r.status = 'active'
               and private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id)
             limit 1) is null
       and (p_max_cents is null or w.price_cents is null or w.price_cents <= p_max_cents)));
end $$;

-- get_feed(): the 20261027140000 body; wish_count by places (the host: stored, guests: effective); a guest's
-- my_reservation_count = their own LIVE reservations of wishes in the occasion's lists (index on reserver_id)
create or replace function public.get_feed()
returns jsonb language plpgsql stable security definer set search_path = '' set enable_seqscan = off set enable_bitmapscan = off as $$
declare
  v_uid uuid := private.require_user();
  v_now timestamptz := now();
begin
  return (
    with mine as (
      select o.id, o.title, o.starts_at, o.ends_at, o.tz, o.all_day, o.place_text, o.host_id, o.sections, o.cover_theme, m.role, m.rsvp,
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
          -- 20261027140000: the cover motif (allow-list key | 'none' | null), the same value as on its screen
          'cover_theme', x.cover_theme,
          'host_name', (select p.display_name from public.profiles p where p.id = x.host_id),
          -- 20261026180000 (P-I16): the people the occasion screen lists — active members, not those hidden from
          -- the viewer by a block (either direction); the viewer counts themselves
          'member_count', (select count(*) from public.occasion_members mm
                           where mm.occasion_id = x.id and mm.status = 'active'
                             and not private.is_blocked_pair(v_uid, mm.profile_id)),
          -- 20261027200000: by places — the host counts every stored place, a guest the effective ones
          'wish_count', (select coalesce(sum(private.list_wish_count(wl.id, x.role = 'host')), 0)::bigint
                           from public.wishlists wl where wl.occasion_id = x.id),
          -- the host never gets a number here; a member only counts their OWN LIVE reservations (index on reserver_id)
          'my_reservation_count', case when x.role = 'host' then null::bigint
                                       else (select count(*) filter (
                                                       where r.status = 'active'
                                                         and private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id)
                                                         and (select bool_or(private.is_effective_placement(r.wish_id, wl.id))
                                                                from public.wishlists wl where wl.occasion_id = x.id))
                                               from public.reservations r
                                              where r.reserver_id = v_uid) end,   -- (status in the FILTER: §3)
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

-- private.my_wishlists_export(): the 20261022160000 body + wishes[].places (every stored place, with added_at and
-- home) and the occasion list's received_prompt_dismissed_at. Wishes stay listed under their home list.
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
                               from private.wish_placements p where p.wish_id = w.id))
                        order by w.priority desc, w.created_at, w.id), '[]'::jsonb)
                      from public.wishes w where w.wishlist_id = wl.id))
           order by wl.created_at, wl.id), '[]'::jsonb)
  from public.wishlists wl where wl.owner_id = auth.uid();
$$;

-- get_lists_overview(): the 20261024120000 body; wish counts by places (my lists: stored; other people's: effective).
-- Still not one word about the secret table.
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
    -- OWNER BRANCH: wishlists + stored places only
    select wl.id, wl.title, wl.occasion_id, wl.visibility, wl.cover_tone, wl.cover_icon, wl.due_on, wl.created_at,
           o.title as occasion_title, o.starts_at, o.tz, o.all_day,
           coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) as ends_eff,
           private.list_wish_count(wl.id, true) as wish_count
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
           private.list_wish_count(wl.id, false) as wish_count
      from public.occasion_members m
      join public.occasions o on o.id = m.occasion_id
      join public.wishlists wl on wl.occasion_id = o.id
     where m.profile_id = v_uid and m.status = 'active' and wl.owner_id <> v_uid
       and private.can_read_wishlist(wl.id, v_uid)
  ), dated as (
    -- the dated follower lists of the people I follow (due within 60 days)
    select wl.id, wl.owner_id, wl.title, wl.cover_tone, wl.cover_icon, wl.due_on as day,
           private.list_wish_count(wl.id, false) as wish_count
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
-- 13. Read rule of wishes through REST: the owner's short path first (insert … returning), then any effective place
-- -----------------------------------------------------------------------------
drop policy wishes_select on public.wishes;
create policy wishes_select on public.wishes for select to authenticated
  using (private.is_wishlist_owner(wishlist_id, (select auth.uid())) or private.can_read_wish(id, (select auth.uid())));

-- -----------------------------------------------------------------------------
-- 14. Background jobs (owner = the migration role; pg_cron runs them as that role, one transaction per run;
--     never executable by an API role). Neither waits for an owner: SKIP LOCKED on reservations, no profile lock
--     in the cleanup.
-- -----------------------------------------------------------------------------

-- one bounded batch per run (design §3.2 + Codex v1.4 #2/#3): the cursor row is locked FIRST (two overlapping runs
-- serialize, SC28); a pass looks at rows created up to the moment it started (pass_upper) — finite; rows that arrive
-- or become dead behind the cursor, and rows skipped because they were locked, are seen by the next pass.
-- Step 'stale': active rows that are not live -> ended ('wish_deleted' when the wish is gone, else 'access_ended');
-- re-checked after the row lock (status AND liveness, a fresh statement). Step 'orphans': rows of ANY status whose
-- giver or recipient account is gone -> deleted.
create or replace function private.reservations_cleanup_run(p_window integer default 2000)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_job     text;
  v_st      record;
  v_row     record;
  v_seen    integer;
  v_done    integer;
  v_last_id uuid;
  v_out     jsonb := '{}'::jsonb;
  v_upper   timestamptz;
begin
  if p_window is null or p_window < 1 or p_window > 10000 then raise exception using message = 'validation'; end if;
  foreach v_job in array array['stale', 'orphans'] loop
    select s.after_id, s.pass_upper into v_st
      from private.maintenance_state s where s.job = v_job for update;
    v_upper := coalesce(v_st.pass_upper, clock_timestamp());
    v_seen := 0; v_done := 0; v_last_id := null;
    -- the cursor walks the primary key (the only index of ALL rows; a giver never has a reason to scan it)
    for v_row in
      select r.id, r.wish_id, r.reserver_id, r.recipient_id
        from public.reservations r
       where (v_st.after_id is null or r.id > v_st.after_id)
         and (v_job <> 'stale' or r.status = 'active')
         and r.created_at <= v_upper
       order by r.id
       limit p_window
    loop
      v_seen := v_seen + 1; v_last_id := v_row.id;
      if v_job = 'stale' then
        continue when private.reservation_is_live(v_row.wish_id, v_row.reserver_id, v_row.recipient_id);
        perform 1 from public.reservations x where x.id = v_row.id and x.status = 'active' for update skip locked;
        continue when not found;
        update public.reservations x
           set status = 'ended', ended_at = now(),
               end_reason = case when exists (select 1 from public.wishes w where w.id = x.wish_id) then 'access_ended' else 'wish_deleted' end,
               wish_id = case when exists (select 1 from public.wishes w where w.id = x.wish_id) then x.wish_id end
         where x.id = v_row.id and x.status = 'active'
           and not private.reservation_is_live(x.wish_id, x.reserver_id, x.recipient_id);
        if found then v_done := v_done + 1; end if;
      else
        continue when exists (select 1 from public.profiles p where p.id = v_row.reserver_id)
                  and exists (select 1 from public.profiles p where p.id = v_row.recipient_id);
        perform 1 from public.reservations x where x.id = v_row.id for update skip locked;
        continue when not found;
        delete from public.reservations x where x.id = v_row.id
           and (not exists (select 1 from public.profiles p where p.id = x.reserver_id)
                or not exists (select 1 from public.profiles p where p.id = x.recipient_id));
        if found then v_done := v_done + 1; end if;
      end if;
    end loop;
    if v_seen < p_window then
      -- the pass is complete: the next run starts a new one
      update private.maintenance_state s
         set after_id = null, pass_upper = null, pass_started_at = null,
             last_pass_completed_at = now(), last_run_at = now()
       where s.job = v_job;
    else
      update private.maintenance_state s
         set after_id = v_last_id, pass_upper = v_upper,
             pass_started_at = coalesce(s.pass_started_at, now()), last_run_at = now()
       where s.job = v_job;
    end if;
    v_out := v_out || jsonb_build_object(v_job, jsonb_build_object('seen', v_seen, 'done', v_done, 'pass_complete', v_seen < p_window));
  end loop;
  return v_out;
end $$;

-- 7 days after an occasion's end the wishes that ALSO live elsewhere leave its list (Q7/Q19 defaults, Codex v1.4 #5:
-- any stored place whose wish has another stored place — a promoted home included). At most 200 occasions per run.
-- Locks: the owners' profile rows (one statement, by id), then the occasion rows FOR SHARE (a REST change of the
-- date waits / is kept out), then a fresh re-check of the end; reservations are never read.
create or replace function private.unlink_past_occasion_places_run()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_occ   uuid[];
  v_list  record;
  v_wish  record;
  v_new   uuid;
  v_done  integer := 0;
begin
  select coalesce(array_agg(c.id order by c.ends, c.id), '{}') into v_occ from (
    select o.id, private.occasion_end(o.id) as ends
      from public.occasions o
     where private.occasion_end(o.id) + private.occasion_place_ttl() <= now()
       and exists (select 1 from public.wishlists wl join private.wish_placements p on p.wishlist_id = wl.id
                    where wl.occasion_id = o.id
                      and exists (select 1 from private.wish_placements q where q.wish_id = p.wish_id and q.wishlist_id <> wl.id))
     order by 2, 1
     limit 200) c;
  if cardinality(v_occ) = 0 then
    update private.maintenance_state s set last_run_at = now(), last_pass_completed_at = now() where s.job = 'unlink';
    return jsonb_build_object('occasions', 0, 'removed', 0);
  end if;
  perform p.id from public.profiles p
   where p.id in (select o.host_id from public.occasions o where o.id = any(v_occ))
   order by p.id for no key update;
  perform o.id from public.occasions o where o.id = any(v_occ) order by o.id for share;
  for v_list in
    select wl.id, wl.owner_id from public.wishlists wl join public.occasions o on o.id = wl.occasion_id
     where o.id = any(v_occ)
       and private.occasion_end(o.id) + private.occasion_place_ttl() <= now()   -- fresh re-check (a moved date)
     order by wl.id
  loop
    for v_wish in
      select p.wish_id, w.wishlist_id as home from private.wish_placements p join public.wishes w on w.id = p.wish_id
       where p.wishlist_id = v_list.id
         and exists (select 1 from private.wish_placements q where q.wish_id = p.wish_id and q.wishlist_id <> v_list.id)
       order by p.wish_id
         for update of w
    loop
      if v_wish.home = v_list.id then
        select q.wishlist_id into v_new from private.wish_placements q
         where q.wish_id = v_wish.wish_id and q.wishlist_id <> v_list.id
         order by q.added_at, q.wishlist_id limit 1;
        update public.wishes w set wishlist_id = v_new where w.id = v_wish.wish_id;
      end if;
      delete from private.wish_placements p where p.wish_id = v_wish.wish_id and p.wishlist_id = v_list.id;
      v_done := v_done + 1;
    end loop;
  end loop;
  update private.maintenance_state s set last_run_at = now(), last_pass_completed_at = now() where s.job = 'unlink';
  return jsonb_build_object('occasions', cardinality(v_occ), 'removed', v_done);
end $$;

-- the daily check for the admin (design §7 item 8, Q25): numbers and times only
create or replace function private.shared_wishes_health()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'dead_active', (select count(*) from public.reservations r
                     where r.status = 'active' and not private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id)),
    'oldest_dead_age', (select now() - min(r.created_at) from public.reservations r
                         where r.status = 'active' and not private.reservation_is_live(r.wish_id, r.reserver_id, r.recipient_id)),
    'orphans', (select count(*) from public.reservations r
                 where not exists (select 1 from public.profiles p where p.id = r.reserver_id)
                    or not exists (select 1 from public.profiles p where p.id = r.recipient_id)),
    'stale_pass_completed_at', (select s.last_pass_completed_at from private.maintenance_state s where s.job = 'stale'),
    'orphans_pass_completed_at', (select s.last_pass_completed_at from private.maintenance_state s where s.job = 'orphans'),
    'last_cleanup_run_at', (select s.last_run_at from private.maintenance_state s where s.job = 'stale'),
    'last_unlink_run_at', (select s.last_run_at from private.maintenance_state s where s.job = 'unlink'),
    'overdue_unlinks', (select count(*) from public.occasions o
                         where private.occasion_end(o.id) + private.occasion_place_ttl() + interval '2 hours' <= now()
                           and exists (select 1 from public.wishlists wl join private.wish_placements p on p.wishlist_id = wl.id
                                        where wl.occasion_id = o.id
                                          and exists (select 1 from private.wish_placements q
                                                       where q.wish_id = p.wish_id and q.wishlist_id <> wl.id))));
$$;

-- schedule (only where pg_cron exists — Supabase; PGlite skips it). The exact command strings are part of the
-- release check (docs/handoffs/2026-10-27-shared-wishes.md).
do $cron$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable - shared-wish jobs not scheduled (expected on PGlite)';
    return;
  end if;
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute $cmd$select cron.unschedule(jobid) from cron.job
    where jobname in ('bunprise_reservations_cleanup', 'bunprise_unlink_past_occasion_places')$cmd$;
  execute $cmd$select cron.schedule('bunprise_reservations_cleanup', '* * * * *', 'select private.reservations_cleanup_run();')$cmd$;
  execute $cmd$select cron.schedule('bunprise_unlink_past_occasion_places', '17 * * * *', 'select private.unlink_past_occasion_places_run();')$cmd$;
end
$cron$;

-- -----------------------------------------------------------------------------
-- 15. Privileges. New public RPCs: authenticated only. schema private: PUBLIC execute off again; nothing new is
--     executable by an API role (the helpers answer "who reads what" for ANY person, and the jobs are admin-only).
-- -----------------------------------------------------------------------------
revoke execute on function
  public.add_wishes_to_list(uuid, uuid[]), public.remove_wish_from_list(uuid, uuid),
  public.delete_wish_everywhere(uuid), public.dismiss_received_prompt(uuid)
  from public, anon;
grant execute on function
  public.add_wishes_to_list(uuid, uuid[]), public.remove_wish_from_list(uuid, uuid),
  public.delete_wish_everywhere(uuid), public.dismiss_received_prompt(uuid)
  to authenticated;

revoke execute on all functions in schema private from public, anon;
revoke execute on function
  private.shared_wishes_on(), private.shared_wishes_visible(), private.effective_list_wishes(uuid),
  private.owner_list_wishes(uuid, uuid), private.list_wish_count(uuid, boolean), private.list_new_wish_count(uuid),
  private.is_effective_placement(uuid, uuid), private.can_read_wish(uuid, uuid), private.reads_wish_via_occasion(uuid, uuid),
  private.reservation_is_live(uuid, uuid, uuid), private.counts_for_cap(uuid, uuid, uuid),
  private.public_end_reason(text, text, boolean), private.reservation_place(uuid, uuid),
  private.wish_places_for_owner(uuid, uuid, uuid), private.wish_places_for_viewer(uuid, uuid, uuid),
  private.occasion_end(uuid), private.occasion_place_ttl(), private.received_prompt_due(uuid),
  private.wish_after_insert(), private.wishlist_before_delete(), private.wish_shared_delete_guard(),
  private.list_wish_objects(uuid, uuid, boolean, boolean), private.occasion_wishlist_json(uuid, uuid),
  private.end_own_dead_reservations(uuid, text), private.trim_own_cap(uuid, uuid, text),
  private.reservations_cleanup_run(integer), private.unlink_past_occasion_places_run(), private.shared_wishes_health()
  from authenticated;
-- the policy wishes_select runs as the caller: it needs the read rule (it answers only for auth.uid() there; through
-- SQL it would answer for any person — `private` is never an exposed schema, supabase/README.md)
grant execute on function private.can_read_wish(uuid, uuid) to authenticated;
-- the invoker export calls these (no argument / auth.uid() only)
grant execute on function private.my_wishlists_export(), private.my_reservations_export() to authenticated;
