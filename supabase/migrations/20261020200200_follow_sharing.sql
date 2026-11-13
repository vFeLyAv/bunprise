-- =============================================================================
-- Bunprise wave 2b — M3 (agent J2): FOLLOWERS SEE AND SECRETLY RESERVE the lists "Meine Follower".
-- Spec: docs/spec/follows-design.md v1.2 (§00 wins over the rest), §3.4, §4.2, §5.2, §5.5, §6.2, §9; pilot-decisions §000.
-- Forward only: every earlier migration stays untouched. NOT applied to the hosted project: `supabase db push`
-- only after Felix's OK, and only together with the checked pilot-2 legal texts (follows-design §00 item 8).
--
-- Who sees what after this step:
--   * a list without an occasion has the audience 'private' ("Nur ich", how every list starts) or 'followers'
--     ("Meine Follower": the owner's ACCEPTED followers). 'followers' is only ever the owner's explicit choice —
--     REST insert (policy wishlists_insert) or set_list_visibility(); visibility is never updatable through REST.
--   * private.can_read_wishlist (REST policies of wishlists / wishes and every RPC) gives a 'followers' list to an
--     accepted follower of its owner — never inside a blocked pair, and never while the database "red button"
--     private.features.follower_lists is off (§9; template supabase/emergency/follower_lists_off.sql).
--   * followers reserve like the guests of an occasion: reserve_wish / cancel_reservation get a follower path.
--     The owner (= the recipient) is refused in step 1 before anything else is looked at; the owner's branches
--     never read the reservation table; the owner's answers are byte-identical whatever the reservations are (INV-2).
--   * at most 5 ACTIVE reservations of one giver for one recipient on lists without an occasion (S19, "capture"):
--     the 6th answers limit_reached to the giver only (occasion lists are not counted and not limited).
--   * INV-1 "no access, no reservation": every way of losing access ends the reservations in the same transaction —
--     unfollow ('unfollowed'), remove_follower / block / "Nur ich" / the red button ('access_ended', ONE neutral
--     reason), deleting a list or a wish ('wish_deleted'), deleting an account (cascade).
--   * suggestions "Aus deinen Anlässen" only of people who switched profiles.in_suggestions on themselves
--     (default OFF, Art. 25 Abs. 2 DSGVO), have the current legal records, and are not blocked / related / hidden.
--
-- Lock order of every write between people (pilot rule): private.lock_profile_pair(a, b) FIRST, then the access row
-- (membership FOR SHARE / follow FOR SHARE), then the list (FOR KEY SHARE), then the wish (FOR KEY SHARE), then the
-- reservations. The visibility of a list changes ONLY in set_list_visibility under the owner's profile lock — the
-- same first lock every reservation on the owner's lists takes — so a reservation can never commit on a list that
-- was just hidden (A9, C03), and reserve_wish reads the visibility by name under that lock.
--
-- RPCs of this step (exact jsonb keys: the report of agent J2, follows-design §5.2):
--   set_list_visibility(p_list_id uuid, p_visibility text) -> { ok: true }   (NEW; the same answer with or without
--       reservations; 'followers' needs the current legal records and a name, 'private' (narrowing) never does)
--   get_list_screen(p_list_id uuid)   + the FOLLOWER BRANCH (viewer.role 'follower', real reserved / reserved_by_me)
--   get_lists_overview()              + following[], upcoming[], suggestions[], stats.friends_lists
--   get_profile_card(p_profile_id)    + lists[] (only for an accepted follower), can_find_gift
--   get_me()                          + profile.in_suggestions
--   my_reservations()                 + key list {id, title, owner_name} | null (live only while the giver may read
--                                       the list; else null and the wish title is the snapshot)
--   reserve_wish / cancel_reservation  + the follower path (codes unchanged + limit_reached)
--   private.my_profile_export() + in_suggestions; private.my_reservations_export() + list.
-- New helpers (definer, never executable by an API role): private.follower_lists_on(), private.can_find_gift(viewer,
-- person) (= the not_found rule of get_free_wishes, M4: one helper for both, F21), private.follower_list_cards(owner,
-- viewer) (the cards of an owner's follower lists, shared by get_lists_overview and get_profile_card).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. wishlists: the audience 'followers'
-- -----------------------------------------------------------------------------
alter table public.wishlists drop constraint wishlists_visibility_check;
alter table public.wishlists add constraint wishlists_visibility_check
  check (visibility in ('occasion', 'private', 'followers'));
create index wishlists_followers_idx on public.wishlists (owner_id) where visibility = 'followers';
comment on column public.wishlists.visibility is
  'Exactly one audience per list: occasion (the occasion''s active members) | private (only the owner) | followers (the owner''s accepted followers). Never updatable through REST: set_list_visibility() only.';

-- the standalone branch of the insert policy: 'private' or the explicit choice 'followers' (consents + name were
-- already required for every list)
drop policy wishlists_insert on public.wishlists;
create policy wishlists_insert on public.wishlists for insert to authenticated
  with check (owner_id = (select auth.uid()) and recipient_id = (select auth.uid())
              and private.profile_complete((select auth.uid())) and private.has_consents((select auth.uid()))
              and ((occasion_id is not null and visibility = 'occasion'                 -- the pilot's branch
                    and private.is_host(occasion_id, (select auth.uid()))
                    and not private.occasion_has_wishlist(occasion_id))
                or (occasion_id is null and visibility in ('private', 'followers'))));

-- -----------------------------------------------------------------------------
-- 2. suggestions "Aus deinen Anlässen" only by the person's own choice (review #7; default OFF)
-- -----------------------------------------------------------------------------
alter table public.profiles add column in_suggestions boolean not null default false;
grant update (in_suggestions) on public.profiles to authenticated;   -- no SELECT grant: the own value comes from get_me
comment on column public.profiles.in_suggestions is
  'Appear in "Aus deinen Anlässen" of co-members of recent occasions. Default false (Art. 25 Abs. 2 DSGVO); the person''s own REST write only.';

-- -----------------------------------------------------------------------------
-- 3. The database "red button" (review #10, follows-design §9). The VITE_LISTS flag only hides the UI; this switch
--    closes reading AND reserving of followers IN THE DATABASE (can_read_wishlist below, the follower path of
--    reserve_wish). One row; RLS enabled + forced; no privilege for any API role. How to press it (and end the
--    follower reservations in the same transaction, INV-1): supabase/emergency/follower_lists_off.sql.
--    A missing row reads as OFF (closed by default).
-- -----------------------------------------------------------------------------
create table private.features (
  singleton      boolean primary key default true check (singleton),
  follower_lists boolean not null default true
);
insert into private.features default values;
alter table private.features enable row level security;  alter table private.features force row level security;
revoke all on private.features from public, anon, authenticated;
comment on table private.features is
  'One row of database switches. follower_lists = false closes every follower path (red button, supabase/emergency/follower_lists_off.sql). No API privileges.';

create or replace function private.follower_lists_on()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select f.follower_lists from private.features f), false);
$$;

-- -----------------------------------------------------------------------------
-- 4. The final read rule: the owner of any own list · an active guest of the occasion's list · an ACCEPTED follower
--    of the owner for a 'followers' list while the red button is not pressed — never inside a blocked pair.
--    wishlists_select / wishes_select / reservations_select keep calling this helper: followers READ through REST,
--    only owners write (is_wishlist_owner). The helpers it calls are definer-only (no grant needed for the policies).
-- -----------------------------------------------------------------------------
create or replace function private.can_read_wishlist(p_wishlist uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wishlists wl
     where wl.id = p_wishlist
       and (wl.owner_id = p_uid
            or (not private.is_blocked_pair(p_uid, wl.owner_id)
                and not private.is_blocked_pair(p_uid, wl.recipient_id)
                and ((wl.visibility = 'occasion' and exists (
                        select 1 from public.occasion_members m
                         where m.occasion_id = wl.occasion_id and m.profile_id = p_uid and m.status = 'active'))
                  or (wl.visibility = 'followers' and private.follower_lists_on()
                      and private.is_accepted_follower(p_uid, wl.owner_id))))));
$$;

-- -----------------------------------------------------------------------------
-- 5. Helpers of the screens (definer; NOT executable by the API roles; called only from the RPCs below)
-- -----------------------------------------------------------------------------

-- the cards of the owner's follower lists that the viewer can read (the person rows of "Freunde" and the profile
-- card). Fixed order, never from reservations: a future date first (by that day, Europe/Berlin), then the rest
-- newest first, id last. new_wish_count = wishes created within the last 7 days ("3 neu").
create or replace function private.follower_list_cards(p_owner uuid, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', wl.id, 'title', wl.title, 'cover_tone', wl.cover_tone, 'cover_icon', wl.cover_icon, 'due_on', wl.due_on,
           'wish_count', (select count(*) from public.wishes w where w.wishlist_id = wl.id),
           'new_wish_count', (select count(*) from public.wishes w
                               where w.wishlist_id = wl.id and w.created_at > now() - interval '7 days'))
           order by case when wl.due_on >= (now() at time zone 'Europe/Berlin')::date then 0 else 1 end,
                    case when wl.due_on >= (now() at time zone 'Europe/Berlin')::date then wl.due_on end asc,
                    wl.created_at desc, wl.id), '[]'::jsonb)
    from public.wishlists wl
   where wl.owner_id = p_owner and wl.visibility = 'followers' and wl.occasion_id is null
     and private.can_read_wishlist(wl.id, p_viewer);
$$;

-- "Geschenk finden für {{name}}": may the viewer look for a gift for the person? Not for oneself, never inside a
-- blocked pair, and only when at least one of the person's lists is readable for the viewer. Exactly the not_found
-- rule of get_free_wishes (M4, 20261020200300) — one helper for both (F21).
create or replace function private.can_find_gift(p_viewer uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_viewer is not null and p_person is not null and p_person <> p_viewer
     and not private.is_blocked_pair(p_viewer, p_person)
     and exists (select 1 from public.wishlists wl
                  where wl.owner_id = p_person and private.can_read_wishlist(wl.id, p_viewer));
$$;

-- -----------------------------------------------------------------------------
-- 6. reserve_wish(): the occasion path from M1 (20261020200000, `v_wl record`) with post-lock identity checks;
--    a list without an occasion takes the FOLLOWER PATH with the same lock order: profile pair -> the follow row
--    FOR SHARE -> the list FOR KEY SHARE (its visibility read by name, under the pair lock) -> the wish FOR KEY SHARE.
--    unfollow / remove_follower / block_user / set_list_visibility take the pair lock first, so they wait for us and
--    then end the new reservation (INV-1); the red button's LOCK TABLE follows waits for our FOR SHARE.
-- -----------------------------------------------------------------------------
create or replace function public.reserve_wish(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish public.wishes%rowtype;   -- 10 columns into 10 fields: wishes does not change
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

-- -----------------------------------------------------------------------------
-- 7. cancel_reservation(): the M1 body (`v_wl record`) + the follower path. Owner / recipient -> not_allowed;
--    an occasion's list -> active membership (as before); a list without an occasion -> may the caller read it,
--    else not_allowed; then the pilot's update … returning: no own active reservation -> not_found (taken by
--    somebody else or free: one answer). By INV-1 a giver with an active reservation can always read the list,
--    so they can always cancel it.
-- -----------------------------------------------------------------------------
create or replace function public.cancel_reservation(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish public.wishes%rowtype;
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
-- 8. set_list_visibility(p_list_id, p_visibility) -> { ok: true } — the ONLY way to change who sees a list.
--    Only my own list without an occasion (foreign / unknown / an occasion's: not_found, one answer); a bad value:
--    validation. Widening to 'followers' needs the current legal records and a name (P10); narrowing to 'private'
--    never does (follows-design §5.1). Under the owner's profile lock (the first lock of every reservation on the
--    owner's lists); -> 'private' ends every active reservation on the list as 'access_ended' (INV-1). The answer
--    is the same {ok: true} with or without reservations; switching back restores nothing.
-- -----------------------------------------------------------------------------
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
  if p_visibility = 'private' then perform private.end_list_reservations(p_list_id, 'access_ended'); end if;
  return jsonb_build_object('ok', true);                                          -- the same with or without reservations
end $$;

-- -----------------------------------------------------------------------------
-- 9. get_list_screen(p_list_id) — /lists/$listId. The M1 body + the FOLLOWER BRANCH after the owner's.
--    not_found for everything else in one answer: an unknown id, an occasion's list, "Nur ich" of somebody else,
--    not (yet) a follower, waiting, removed, blocked, the red button pressed.
-- -----------------------------------------------------------------------------
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
             'reserved', null::boolean, 'reserved_by_me', null::boolean)
             order by w.priority desc, w.created_at asc, w.id), '[]'::jsonb)
      into v_wishes from public.wishes w where w.wishlist_id = v_wl.id;
  else
    -- (only an accepted follower of a 'followers' list gets past can_read_wishlist above)
    v_role := 'follower';
    -- FOLLOWER BRANCH: only "taken" and "taken by me" — never who
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', w.id, 'title', w.title, 'url', w.url, 'price_cents', w.price_cents, 'currency', w.currency,
             'note', w.note, 'priority', w.priority, 'created_at', w.created_at,
             'reserved', (r.id is not null), 'reserved_by_me', coalesce(r.reserver_id = v_uid, false))
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

-- -----------------------------------------------------------------------------
-- 10. get_lists_overview() — the tab "Wunschlisten" in one call, complete. The M2 body (me, my_lists, followers /
--     following / requests) + the VIEWER BRANCH:
--   following[]   the people I follow (accepted), by display_name, id: { profile{id, display_name, banner},
--                 mutual (they follow me too), accepted_at, lists[{id, title, cover_tone, cover_icon, due_on,
--                 wish_count, new_wish_count}] } — the follower lists I can read ([] = "teilt gerade keine Liste")
--   upcoming[]    "Bald": the lists of occasions I am an active guest of (not ended, starting within 60 days) and
--                 the dated follower lists of the people I follow (due_on within 60 days), by date, list id:
--                 { list{id, title, cover_tone, cover_icon, wish_count, occasion_id}, owner{id, display_name},
--                 date (YYYY-MM-DD; an occasion's local start day), kind 'occasion' | 'standalone' }
--   suggestions[] "Aus deinen Anlässen": at most 10 co-members of occasions where both are active (upcoming or
--                 ended at most 30 days ago) who switched in_suggestions on, have the current legal records and a
--                 name — not blocked, no relation VISIBLE to me, not hidden by MY silence (never their silence, P4);
--                 by display_name, id: { profile{id, display_name}, shared_occasion_title } (the first shared
--                 occasion: upcoming ones by start, then past ones latest first)
--   stats.friends_lists ("Mit dir geteilt") = the cards of following[].lists + the lists of occasions I am an active
--                 guest of that are upcoming or ended at most 30 days ago.
--   The lists of other people are reached from MY follows and MY memberships only (never a scan of all lists) and
--   every one passes private.can_read_wishlist. Not one key of this answer is about the secret table, and its
--   text never names it (F18).
-- -----------------------------------------------------------------------------
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
    -- OWNER BRANCH: wishlists + wishes only
    select wl.id, wl.title, wl.occasion_id, wl.visibility, wl.cover_tone, wl.cover_icon, wl.due_on, wl.created_at,
           o.title as occasion_title, o.starts_at, o.tz, o.all_day,
           coalesce(o.ends_at, ((o.starts_at at time zone o.tz)::date + 1)::timestamp at time zone o.tz) as ends_eff,
           (select count(*) from public.wishes w where w.wishlist_id = wl.id) as wish_count
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
           (select count(*) from public.wishes w where w.wishlist_id = wl.id) as wish_count
      from public.occasion_members m
      join public.occasions o on o.id = m.occasion_id
      join public.wishlists wl on wl.occasion_id = o.id
     where m.profile_id = v_uid and m.status = 'active' and wl.owner_id <> v_uid
       and private.can_read_wishlist(wl.id, v_uid)
  ), dated as (
    -- the dated follower lists of the people I follow (due within 60 days)
    select wl.id, wl.owner_id, wl.title, wl.cover_tone, wl.cover_icon, wl.due_on as day,
           (select count(*) from public.wishes w where w.wishlist_id = wl.id) as wish_count
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
                                              'occasion_id', x.occasion_id),
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
  select coalesce(jsonb_agg(jsonb_build_object('profile', jsonb_build_object('id', s.id, 'display_name', s.display_name),
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
-- 11. get_profile_card(p_profile_id): the M2 body (20261020200100) + lists and can_find_gift.
--     lists = the person's follower lists I can read — only while I follow them (accepted), else [] (also on my own
--     card); can_find_gift = private.can_find_gift (exactly the not_found rule of get_free_wishes). Never anybody's
--     followers, followings or their numbers.
-- -----------------------------------------------------------------------------
create or replace function public.get_profile_card(p_profile_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_self boolean;
  v_i    text;
  v_me   text;
begin
  if p_profile_id is null or not private.knows_profile(v_uid, p_profile_id)
     or not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception using message = 'not_found';
  end if;
  v_self := p_profile_id = v_uid;
  v_i  := case when v_self then 'none' else private.i_follow_state(v_uid, p_profile_id) end;
  v_me := case when v_self then 'none' else private.follows_me_state(v_uid, p_profile_id) end;
  return jsonb_build_object(
    'profile', private.profile_card(p_profile_id),
    'relation', jsonb_build_object('self', v_self, 'i_follow', v_i, 'follows_me', v_me,
                                   'mutual', v_i = 'following' and v_me = 'following'),
    'can_request', not v_self and v_i = 'none'
                   and (private.shares_occasion(v_uid, p_profile_id) or v_me = 'following'),
    'can_find_gift', private.can_find_gift(v_uid, p_profile_id),
    'lists', case when v_i = 'following' then private.follower_list_cards(p_profile_id, v_uid) else '[]'::jsonb end,
    'shared_occasions', case when v_self then '[]'::jsonb else private.shared_occasions(v_uid, p_profile_id) end);
end $$;

-- -----------------------------------------------------------------------------
-- 12. get_me(): the M2 body + profile.in_suggestions (the own switch; profiles has no SELECT grant for it)
-- -----------------------------------------------------------------------------
create or replace function public.get_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                                          'onboarding_done_at', p.onboarding_done_at, 'banner', p.banner,
                                          'in_suggestions', p.in_suggestions)
                from public.profiles p where p.id = v_uid),
    'consents_ok', private.has_consents(v_uid),
    'legal_versions', jsonb_build_object(
      'terms',   (select lv.version from public.legal_versions lv where lv.kind = 'terms'),
      'privacy', (select lv.version from public.legal_versions lv where lv.kind = 'privacy_notice'),
      'age',     (select lv.version from public.legal_versions lv where lv.kind = 'age_18plus')),
    'inbox', jsonb_build_object('follow_requests', (
      select count(*) from public.follows f
       where f.followee_id = v_uid and private.visible_request(f.follower_id, v_uid))));
end $$;

-- -----------------------------------------------------------------------------
-- 13. Own data: the export profile + in_suggestions; my_reservations() and the export's reservations_made_by_me
--     + key `list` = { id, title, owner_name } of a list WITHOUT an occasion — live only while I may still read it
--     (the join already filters private.can_read_wishlist: membership or accepted follow); no access -> null and the
--     wish title is the snapshot (pilot-decisions §0 item 3, now for "access"). Occasion rows: list = null.
--     Both are the 20261019120500 bodies otherwise.
-- -----------------------------------------------------------------------------
create or replace function private.my_profile_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                            'onboarding_done_at', p.onboarding_done_at, 'banner', p.banner,
                            'in_suggestions', p.in_suggestions,
                            'created_at', p.created_at, 'updated_at', p.updated_at)
  from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.my_reservations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'wish_id', r.wish_id,
             'wish_title', coalesce(w.title, r.wish_title_snapshot),
             'occasion_id', o.id, 'occasion_title', o.title, 'starts_at', o.starts_at,
             'status', r.status, 'end_reason', r.end_reason, 'created_at', r.created_at,
             'list', case when wl.id is not null and wl.occasion_id is null then jsonb_build_object(
                       'id', wl.id, 'title', wl.title,
                       'owner_name', (select p.display_name from public.profiles p where p.id = wl.owner_id)) end)
             order by r.created_at desc, r.id), '[]'::jsonb)
    from public.reservations r
    left join public.wishlists wl on wl.id = r.wishlist_id and wl.recipient_id = r.recipient_id
      and private.can_read_wishlist(wl.id, v_uid)
    left join public.wishes w on w.id = r.wish_id and w.wishlist_id = r.wishlist_id and wl.id is not null
    left join public.occasions o on o.id = wl.occasion_id
    where r.reserver_id = v_uid
      and (r.status = 'active'
           or (r.status = 'ended' and r.end_reason <> 'by_reserver' and r.ended_at >= now() - interval '90 days'))
  );
end $$;

create or replace function private.my_reservations_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'wish_title', coalesce(w.title, r.wish_title_snapshot),
           'recipient_name', p.display_name,
           'occasion_title', o.title,
           'status', r.status, 'end_reason', r.end_reason, 'created_at', r.created_at, 'ended_at', r.ended_at,
           'list', case when wl.id is not null and wl.occasion_id is null then jsonb_build_object(
                     'id', wl.id, 'title', wl.title,
                     'owner_name', (select op.display_name from public.profiles op where op.id = wl.owner_id)) end)
           order by r.created_at, r.id), '[]'::jsonb)
  from public.reservations r
  left join public.wishlists wl on wl.id = r.wishlist_id and wl.recipient_id = r.recipient_id
    and private.can_read_wishlist(wl.id, auth.uid())
  left join public.wishes w on w.id = r.wish_id and w.wishlist_id = r.wishlist_id and wl.id is not null
  left join public.profiles p on p.id = r.recipient_id and wl.id is not null and not private.is_blocked_pair(auth.uid(), r.recipient_id)
  left join public.occasions o on o.id = wl.occasion_id
  where r.reserver_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- 14. Privileges. The new RPC for authenticated only (Supabase's default privileges and PUBLIC would give anon
--     EXECUTE). schema private: PUBLIC execute off again; the new helpers are called only from definer code and are
--     NEVER executable by the API roles (they answer "may X read / find a gift for Y" for ANY X and Y, and the red
--     button's state). CREATE OR REPLACE keeps the privileges of the re-created functions (can_read_wishlist stays
--     granted for the policies; the export helpers stay granted for the invoker export).
-- -----------------------------------------------------------------------------
-- REST deletions must take the owner's profile lock BEFORE locking any target row. Row-level triggers are too
-- late: a bulk delete/cascade can hold one reservation while an access-revocation RPC holds another, producing
-- a reservation-dependent 40P01 (B1 D3–D6). The same statement trigger also covers an occasion's cascade.
-- Lock the caller only: RLS already restricts these deletes to owned rows. During account-deletion cascades the
-- profile has gone, so this is a no-op (delete_my_account acquired its profile lock before deleting it). No
-- require_user() here: that would reject the legitimate cascade of the just-deleted account.
create or replace function private.lock_owned_delete()
returns trigger language plpgsql volatile security definer set search_path = '' as $$
begin
  perform p.id from public.profiles p where p.id = auth.uid() for no key update;
  return null;
end $$;

create trigger occasions_lock_owned_delete before delete on public.occasions
  for each statement execute function private.lock_owned_delete();
create trigger wishlists_lock_owned_delete before delete on public.wishlists
  for each statement execute function private.lock_owned_delete();
create trigger wishes_lock_owned_delete before delete on public.wishes
  for each statement execute function private.lock_owned_delete();

revoke execute on function public.set_list_visibility(uuid, text) from public, anon;
grant execute on function public.set_list_visibility(uuid, text) to authenticated;

revoke execute on all functions in schema private from public, anon;
revoke execute on function private.follower_lists_on(), private.can_find_gift(uuid, uuid),
  private.follower_list_cards(uuid, uuid), private.lock_owned_delete() from authenticated;
