-- =============================================================================
-- Bunprise pilot: concurrency fix found by the real-PostgreSQL tests
-- (packages/db-tests/test/concurrency, docs/decisions/0002-concurrency-tests-real-postgres.md).
-- Forward only: the six applied migrations 20261019120000-120500 stay untouched.
-- NOT applied to the hosted project: `supabase db push` only after Felix's OK.
--
-- Finding: reserve_wish racing the host's hard delete of the same wish (REST delete, trigger
-- wish_before_delete). When the delete holds the wish row first, reserve_wish has already read the wish (its
-- snapshot predates the delete), passes every check and inserts; only the foreign-key check of that insert
-- waits for the delete and then fails with a raw 23503 'insert or update on table "reservations" violates
-- foreign key constraint "reservations_wish_id_fkey"'. That is an error outside the RPC contract
-- (pilot-decisions §2: codes only; a wish deleted a moment earlier answers not_found). The data stayed
-- correct (the insert rolls back); the guest got an unmapped error instead of not_found.
--
-- Fix: after the membership lock, reserve_wish locks the wishlist row, then the wish row FOR KEY SHARE. That is
-- the lock the insert's foreign-key checks take anyway, now taken earlier and parent before child (the order of
-- a cascading delete: wishlist -> wishes), so a REST delete of the list cannot deadlock with it either. A row
-- that vanished while we waited -> not_found. A delete that comes second waits for this transaction and then
-- ends the new reservation as wish_deleted (trigger), as before.
-- Nothing new is observable for the owner: the FK checks always took exactly these KEY SHARE locks (and xmax is
-- not readable since v1.1, S1); owner updates of wish or list (NO KEY UPDATE) never wait for them.
-- Lock order of reserve_wish now: profile pair -> own membership (FOR SHARE) -> wishlist -> wish (KEY SHARE).
-- Everything else is the 20261019120500 version, unchanged. CREATE OR REPLACE keeps owner and privileges.
-- =============================================================================
create or replace function public.reserve_wish(p_wish_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := private.require_user();
  v_wish public.wishes%rowtype;
  v_wl   public.wishlists%rowtype;
  v_id   uuid;
begin
  if not private.has_consents(v_uid) then raise exception using message = 'consent_required'; end if;

  select w.id, w.wishlist_id, w.title, w.price_cents, w.currency, w.url, w.note, w.priority, w.created_at, w.updated_at into v_wish from public.wishes w where w.id = p_wish_id;
  if not found then raise exception using message = 'not_found'; end if;
  select wl.id, wl.occasion_id, wl.owner_id, wl.recipient_id, wl.title, wl.created_at, wl.updated_at into v_wl from public.wishlists wl where wl.id = v_wish.wishlist_id;

  -- 1) owner / recipient: ALWAYS not_allowed, decided before reservations are looked at
  if v_uid in (v_wl.owner_id, v_wl.recipient_id) then raise exception using message = 'not_allowed'; end if;

  perform private.lock_profile_pair(v_uid, v_wl.recipient_id);
  -- Revocation must wait for this transaction, then end the just-created reservation.
  perform m.profile_id from public.occasion_members m
   where m.occasion_id = v_wl.occasion_id and m.profile_id = v_uid and m.status = 'active' for share;
  if not found then raise exception using message = 'not_allowed'; end if;

  -- List and wish must still exist; a delete of either waits for this transaction (see the header).
  perform wl.id from public.wishlists wl where wl.id = v_wl.id for key share;
  if not found then raise exception using message = 'not_found'; end if;
  perform w.id from public.wishes w where w.id = p_wish_id for key share;
  if not found then raise exception using message = 'not_found'; end if;

  -- 2) not an active member of the occasion, or blocked with the owner/recipient: the same code
  if not private.is_active_member(v_wl.occasion_id, v_uid)
     or private.is_blocked_pair(v_uid, v_wl.owner_id)
     or private.is_blocked_pair(v_uid, v_wl.recipient_id) then
    raise exception using message = 'not_allowed';
  end if;

  -- 3) the same person pressing again: idempotent
  if exists (select 1 from public.reservations r
             where r.wish_id = p_wish_id and r.status = 'active' and r.reserver_id = v_uid) then
    return jsonb_build_object('ok', true);
  end if;

  -- 4) atomic: a concurrent second insert waits for the first commit, sees the conflict → already_reserved
  insert into public.reservations (wish_id, wishlist_id, recipient_id, reserver_id, wish_title_snapshot)
  values (p_wish_id, v_wl.id, v_wl.recipient_id, v_uid, v_wish.title)
  on conflict (wish_id) where status = 'active' do nothing
  returning id into v_id;

  if v_id is null then raise exception using message = 'already_reserved'; end if;
  return jsonb_build_object('ok', true);
end $$;
