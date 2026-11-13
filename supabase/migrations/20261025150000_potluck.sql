-- =============================================================================
-- Bunprise (Felix 25.10): "Mitbringen" — a bring-along list per occasion (docs/design/2026-10-25-bring-list.md).
-- Felix's words: «кто-то нажимает "я принесу" и другие видят, кто должен это принести». The OPPOSITE of a
-- reservation: a commitment ("Ich bring's mit") is visible to every active member of the occasion, the host
-- included. It therefore lives in its own table and knows nothing about the secret part of the app.
-- Code name `potluck` (not `bring`: that word belongs to "Aus meinen Listen holen", BringFromListsSheet.tsx).
-- Forward only, NOT applied to the hosted project by agents: Felix runs `npx supabase db push`, together with the
-- pilot-3 legal texts (decision 4 of the design: release only with pilot-3).
--
-- What is new
--   occasions.sections   'wishes' (default: every occasion as before) | 'bring' | 'both'. The host sets it through
--                        REST (column grant like the other occasion fields; occasions_update allows the host only).
--   potluck_items        id, occasion_id, title (1..80, one line), created_by, claimed_by (null = free), created_at.
--                        NO privilege for anon / authenticated, RLS forced without a policy (= deny everything,
--                        like the photo tables): the only paths are the SECURITY DEFINER functions below.
--   get_occasion_screen  + occasion.sections, + potluck = null | { max_items, items[] } (the shared part of the
--                        answer — the OWNER BRANCH of the wish list is not touched by a single line).
--   get_feed             + sections per occasion row (section 8; the host's Start card stops saying "Noch keine
--                        Wünsche" for a bring-along-only occasion). Nothing else in it changes.
--   add_potluck_item(p_occasion_id, p_title, p_claim)  -> { id }     host + active members (decision 1)
--   rename_potluck_item(p_item_id, p_title)            -> { ok }     the author only
--   delete_potluck_item(p_item_id)                     -> { ok }     the author or the host
--   claim_potluck_item(p_item_id)                      -> { ok }     one bringer per item (decision 2), atomic
--   unclaim_potluck_item(p_item_id)                    -> { ok }     only the own commitment
--   export_my_potluck()                                -> the caller's own entries and commitments (export_my_data
--                                                         is NOT changed: the client adds this to the download, like
--                                                         the photo exports)
-- Error codes: the contract's not_found / not_allowed / validation / limit_reached / consent_required, plus ONE new
-- code: already_claimed ("Das bringt schon jemand anderes mit"). Everybody without access (outsider, former or
-- removed member, blocked with the host, unknown item) gets not_found — one answer, no oracle.
-- Consents: add, rename and claim need the current consents (like reserve_wish and adding a wish); withdrawing
-- (unclaim) and deleting do not — taking something back must always be possible. Reading never needs them.
--
-- Leaving, removal, block, deletion (design §2.6)
--   * a membership that stops being active (leave_occasion, remove_member, block_user) releases that person's
--     commitments in that occasion: one AFTER UPDATE OF status trigger on occasion_members — those three RPCs are
--     NOT re-created (they touch reservations; this migration never does). Returning later restores nothing.
--   * account deletion: created_by cascades (the own entries go), claimed_by is set null (the entry is free again);
--     delete_my_account is unchanged.
--   * the host switches the list off (sections back to 'wishes'): an AFTER UPDATE OF sections trigger deletes the
--     occasion's entries; deleting the occasion cascades.
--
-- Why this cannot touch the secret of reservations (design §2.7, tests packages/db-tests/test/potluck/)
--   * potluck_items references occasions and profiles only; no column, foreign key or trigger leads to wishes,
--     wishlists or reservations, and nothing there writes here. The bodies of every function of this feature never
--     mention them (checked on pg_proc.prosrc, like lists/branch-markers.test.ts).
--   * the host's answer depends on entries, members and blocks — never on reservations; the new keys contain no
--     "reserv". The owner branch of get_occasion_screen is byte-for-byte the 20261024120000 one.
--   * the locks: the profile pair (the caller and the host, private.lock_profile_pair — the first lock of every
--     relationship write since v1.1) -> the caller's membership row FOR SHARE (add: the occasion row FOR SHARE first,
--     so it waits for a concurrent "switch off" or delete instead of failing with a raw 23503) -> the entry row.
--     Never a wish, list or reservation row. Every write in one occasion queues on the host's profile row, so the
--     50-entry limit cannot be raced and "leave <-> claim" cannot deadlock (concurrency/potluck.test.ts).
--
-- get_occasion_screen is re-created from 20261024120000 with exactly three changes:
--   v_occ is a `record` (not occasions%rowtype: the new column + strict_multi_assignment would break the old
--   12-column select), the select reads o.sections too, and the answer gets occasion.sections + potluck.
-- LATER MIGRATIONS that re-create get_occasion_screen must keep both keys (packages/db-tests/test/potluck/*).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. occasions.sections — what the occasion offers: the wish list, the bring-along list or both
-- -----------------------------------------------------------------------------
alter table public.occasions add column sections text not null default 'wishes'
  check (sections in ('wishes', 'bring', 'both'));
comment on column public.occasions.sections is
  'What the occasion shows: wishes (default, as before) | bring (only the bring-along list "Mitbringen") | both. Switching back to wishes deletes the potluck_items of the occasion (trigger occasions_potluck_off).';
-- column grants, like the other occasion fields (20261019120500 §grants, 20261019120100 occasions_update: host only)
grant select (sections) on public.occasions to authenticated;
grant update (sections) on public.occasions to authenticated;

-- -----------------------------------------------------------------------------
-- 2. potluck_items — RPC only
-- -----------------------------------------------------------------------------
create table public.potluck_items (
  id          uuid primary key default gen_random_uuid(),            -- always made by the server
  occasion_id uuid not null references public.occasions(id) on delete cascade,
  title       text not null check (length(title) between 1 and 80 and btrim(title) <> '' and title !~ '[\n\r\t]'),
  created_by  uuid not null references public.profiles(id) on delete cascade,
  claimed_by  uuid references public.profiles(id) on delete set null, -- "Ich bring's mit"; null = free
  created_at  timestamptz not null default now()
);
create index potluck_items_occasion_idx   on public.potluck_items (occasion_id, created_at, id);
-- the profile foreign keys cascade / set null: indexes keep an account deletion from scanning the table
create index potluck_items_created_by_idx on public.potluck_items (created_by);
create index potluck_items_claimed_by_idx on public.potluck_items (claimed_by) where claimed_by is not null;
comment on table public.potluck_items is
  'Bring-along list ("Mitbringen") of an occasion. NOT secret: every active member sees who brings what. No grants for anon/authenticated, RLS forced without a policy: read and written only through get_occasion_screen() and the *_potluck_item() / export_my_potluck() functions. No link to wishes, wishlists or reservations.';

revoke all on public.potluck_items from public, anon, authenticated;
alter table public.potluck_items enable row level security;
alter table public.potluck_items force  row level security;
-- deliberately no policy (see occasion_photos): "no policy" denies every row to every API role.

-- -----------------------------------------------------------------------------
-- 3. Helpers (definer-only, never executable by an API role)
-- -----------------------------------------------------------------------------

-- The caller must be an active member of the occasion and not blocked with its host; otherwise not_found.
-- Takes the caller's membership row FOR SHARE: leave_occasion / remove_member / block_user wait for this
-- transaction (and their trigger then releases what it just did), or this waits for them and answers not_found.
create or replace function private.potluck_gate(p_occasion uuid, p_uid uuid, p_host uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform m.profile_id from public.occasion_members m
   where m.occasion_id = p_occasion and m.profile_id = p_uid and m.status = 'active' for share;
  if not found or private.is_blocked_pair(p_uid, p_host) then
    raise exception using message = 'not_found';
  end if;
end $$;

-- A title as stored: trimmed, 1..80 characters, one line; otherwise validation.
create or replace function private.potluck_title(p_title text)
returns text language plpgsql immutable set search_path = '' as $$
declare v_title text := btrim(coalesce(p_title, ''));
begin
  if length(v_title) not between 1 and 80 or v_title ~ '[\n\r\t]' then
    raise exception using message = 'validation';
  end if;
  return v_title;
end $$;

-- The list as the viewer sees it (the caller has already passed get_occasion_screen's access rules).
-- The same shape for the host and a guest; only can_edit / can_delete / claimed_by_me differ, and the bringer's
-- name is hidden between a blocked pair (the members[] rule: claimed stays true, bringer is null).
-- Who CREATED an entry is never shown.
create or replace function private.potluck_screen(p_occasion uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'max_items', 50,
    'items', coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', i.title, 'created_at', i.created_at,
        'can_edit', i.created_by = p_viewer,
        'can_delete', i.created_by = p_viewer or o.host_id = p_viewer,
        'claimed', i.claimed_by is not null,
        'claimed_by_me', coalesce(i.claimed_by = p_viewer, false),
        'bringer', case when p.id is null or private.is_blocked_pair(p_viewer, p.id) then null
                        else jsonb_build_object('profile_id', p.id, 'display_name', p.display_name,
                                                'photo', private.profile_photo_fields(p.id) -> 'photo') end)
      order by i.created_at, i.id) filter (where i.id is not null), '[]'::jsonb))
  from public.occasions o
  left join public.potluck_items i on i.occasion_id = o.id
  left join public.profiles p on p.id = i.claimed_by
  where o.id = p_occasion;
$$;

-- -----------------------------------------------------------------------------
-- 4. Triggers
-- -----------------------------------------------------------------------------

-- A membership that stops being active releases that person's commitments in that occasion
-- (leave_occasion, remove_member, block_user — under their profile-pair lock).
create or replace function private.potluck_release_on_leave()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if old.status = 'active' and new.status <> 'active' then
    update public.potluck_items set claimed_by = null
     where occasion_id = new.occasion_id and claimed_by = new.profile_id;
  end if;
  return null;
end $$;
create trigger occasion_members_potluck_release after update of status on public.occasion_members
  for each row execute function private.potluck_release_on_leave();

-- The host switches the bring-along list off: its entries go.
create or replace function private.potluck_off()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  if new.sections not in ('bring', 'both') and old.sections in ('bring', 'both') then
    delete from public.potluck_items where occasion_id = new.id;
  end if;
  return null;
end $$;
create trigger occasions_potluck_off after update of sections on public.occasions
  for each row execute function private.potluck_off();

-- -----------------------------------------------------------------------------
-- 5. RPCs
-- -----------------------------------------------------------------------------

create or replace function public.add_potluck_item(p_occasion_id uuid, p_title text, p_claim boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid      uuid := private.require_user();
  v_host     uuid;
  v_sections text;
  v_title    text;
  v_id       uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  select o.host_id into v_host from public.occasions o where o.id = p_occasion_id;
  if not found then raise exception using message = 'not_found'; end if;
  perform private.lock_profile_pair(v_uid, v_host);
  -- the occasion row FOR SHARE: a concurrent switch-off (REST update) or delete waits for us, or we wait for it
  select o.sections into v_sections from public.occasions o
   where o.id = p_occasion_id and o.host_id = v_host for share;
  if not found then raise exception using message = 'not_found'; end if;
  perform private.potluck_gate(p_occasion_id, v_uid, v_host);
  if v_sections not in ('bring', 'both') then raise exception using message = 'not_allowed'; end if;
  v_title := private.potluck_title(p_title);
  -- every write of this occasion holds the host's profile row: the count cannot be raced
  if (select count(*) from public.potluck_items i where i.occasion_id = p_occasion_id) >= 50 then
    raise exception using message = 'limit_reached';
  end if;
  insert into public.potluck_items (occasion_id, title, created_by, claimed_by)
  values (p_occasion_id, v_title, v_uid, case when coalesce(p_claim, false) then v_uid end)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.rename_potluck_item(p_item_id uuid, p_title text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid   uuid := private.require_user();
  v_item  record;
  v_title text;
  v_id    uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  select i.occasion_id, o.host_id into v_item
    from public.potluck_items i join public.occasions o on o.id = i.occasion_id where i.id = p_item_id;
  if not found then raise exception using message = 'not_found'; end if;
  perform private.lock_profile_pair(v_uid, v_item.host_id);
  perform private.potluck_gate(v_item.occasion_id, v_uid, v_item.host_id);
  v_title := private.potluck_title(p_title);
  update public.potluck_items set title = v_title
   where id = p_item_id and occasion_id = v_item.occasion_id and created_by = v_uid
  returning id into v_id;
  if v_id is null then
    if exists (select 1 from public.potluck_items i where i.id = p_item_id and i.occasion_id = v_item.occasion_id) then
      raise exception using message = 'not_allowed';   -- somebody else's entry
    end if;
    raise exception using message = 'not_found';       -- deleted while we waited
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.delete_potluck_item(p_item_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_item record;
  v_id   uuid;
begin
  select i.occasion_id, o.host_id into v_item
    from public.potluck_items i join public.occasions o on o.id = i.occasion_id where i.id = p_item_id;
  if not found then raise exception using message = 'not_found'; end if;
  perform private.lock_profile_pair(v_uid, v_item.host_id);
  perform private.potluck_gate(v_item.occasion_id, v_uid, v_item.host_id);
  delete from public.potluck_items
   where id = p_item_id and occasion_id = v_item.occasion_id and (created_by = v_uid or v_item.host_id = v_uid)
  returning id into v_id;
  if v_id is null then
    if exists (select 1 from public.potluck_items i where i.id = p_item_id and i.occasion_id = v_item.occasion_id) then
      raise exception using message = 'not_allowed';   -- a guest and somebody else's entry
    end if;
    raise exception using message = 'not_found';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- "Ich bring's mit": atomic. Two presses at the same moment: the second UPDATE waits for the first row lock, then
-- re-checks `claimed_by is null` on the new row version, changes nothing and answers already_claimed.
create or replace function public.claim_potluck_item(p_item_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_item record;
  v_id   uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;
  select i.occasion_id, o.host_id into v_item
    from public.potluck_items i join public.occasions o on o.id = i.occasion_id where i.id = p_item_id;
  if not found then raise exception using message = 'not_found'; end if;
  perform private.lock_profile_pair(v_uid, v_item.host_id);
  perform private.potluck_gate(v_item.occasion_id, v_uid, v_item.host_id);
  update public.potluck_items set claimed_by = v_uid
   where id = p_item_id and occasion_id = v_item.occasion_id and claimed_by is null
  returning id into v_id;
  if v_id is null then
    if exists (select 1 from public.potluck_items i where i.id = p_item_id and i.claimed_by = v_uid) then
      return jsonb_build_object('ok', true);           -- the same person again: nothing changes
    end if;
    if not exists (select 1 from public.potluck_items i where i.id = p_item_id) then
      raise exception using message = 'not_found';     -- deleted while we waited
    end if;
    raise exception using message = 'already_claimed';
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.unclaim_potluck_item(p_item_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_item record;
  v_id   uuid;
begin
  select i.occasion_id, o.host_id into v_item
    from public.potluck_items i join public.occasions o on o.id = i.occasion_id where i.id = p_item_id;
  if not found then raise exception using message = 'not_found'; end if;
  perform private.lock_profile_pair(v_uid, v_item.host_id);
  perform private.potluck_gate(v_item.occasion_id, v_uid, v_item.host_id);
  update public.potluck_items set claimed_by = null
   where id = p_item_id and occasion_id = v_item.occasion_id and claimed_by = v_uid
  returning id into v_id;
  if v_id is null then raise exception using message = 'not_found'; end if;   -- not mine (or gone)
  return jsonb_build_object('ok', true);
end $$;

-- The caller's own part for the data download: the entries they created and the entries they said they bring.
-- No other person's name. The occasion's title only while the caller is an active member (pilot-decisions §0.3);
-- `sections` only for occasions they host.
create or replace function public.export_my_potluck()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'format', 'bunprise-potluck-v1',
    'occasions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'occasion_id', o.id,
               'occasion_title', case when private.is_active_member(o.id, v_uid) then o.title end,
               'sections', case when o.host_id = v_uid then o.sections end,
               'items_created', coalesce((
                  select jsonb_agg(jsonb_build_object('title', i.title, 'created_at', i.created_at,
                                                      'claimed', i.claimed_by is not null) order by i.created_at, i.id)
                    from public.potluck_items i where i.occasion_id = o.id and i.created_by = v_uid), '[]'::jsonb),
               'my_claims', coalesce((
                  select jsonb_agg(jsonb_build_object('title', i.title) order by i.created_at, i.id)
                    from public.potluck_items i where i.occasion_id = o.id and i.claimed_by = v_uid), '[]'::jsonb))
             order by o.starts_at, o.id)
        from public.occasions o
       where exists (select 1 from public.potluck_items i
                      where i.occasion_id = o.id and (i.created_by = v_uid or i.claimed_by = v_uid))), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
-- 6. get_occasion_screen(): the 20261024120000 body; v_occ is a record (+ o.sections), and the answer gets
--    occasion.sections and potluck. The OWNER and MEMBER branches of the wish list are unchanged.
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
-- 7. Privileges: the six RPCs for authenticated only; the helpers and trigger functions for nobody
--    (CREATE OR REPLACE keeps get_occasion_screen's grants).
-- -----------------------------------------------------------------------------
revoke execute on function
  public.add_potluck_item(uuid, text, boolean), public.rename_potluck_item(uuid, text), public.delete_potluck_item(uuid),
  public.claim_potluck_item(uuid), public.unclaim_potluck_item(uuid), public.export_my_potluck()
  from public, anon;
grant execute on function
  public.add_potluck_item(uuid, text, boolean), public.rename_potluck_item(uuid, text), public.delete_potluck_item(uuid),
  public.claim_potluck_item(uuid), public.unclaim_potluck_item(uuid), public.export_my_potluck()
  to authenticated;

revoke execute on all functions in schema private from public, anon;
revoke execute on function
  private.potluck_gate(uuid, uuid, uuid), private.potluck_title(text), private.potluck_screen(uuid, uuid),
  private.potluck_release_on_leave(), private.potluck_off()
  from authenticated;

-- -----------------------------------------------------------------------------
-- 8. get_feed(): re-created from 20261025130000_feed_occasion_photos.sql with ONE new key per occasion row,
--    'sections' (wishes | bring | both). Everything else is that body, unchanged. CREATE OR REPLACE keeps its grants.
-- -----------------------------------------------------------------------------
create or replace function public.get_feed()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_user();
  v_now timestamptz := now();
begin
  return (
    with mine as (
      select o.id, o.title, o.starts_at, o.tz, o.all_day, o.place_text, o.host_id, o.sections, m.role, m.rsvp,
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
          -- 20261025150000: what the occasion offers, so the host's card does not say "no wishes yet" for a
          -- bring-along-only occasion; a column of the occasion, the same for every member, never about reservations
          'sections', x.sections,
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
