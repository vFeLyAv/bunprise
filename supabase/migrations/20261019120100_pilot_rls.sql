-- =============================================================================
-- Bunprise pilot — 2/5: privileges + Row Level Security
-- Source: docs/spec/data-and-secrecy.md §4, changed by docs/spec/pilot-decisions.md §1:
--   * reservations: NO REST access at all (no grants for anon/authenticated); the select policy stays as a safety net
--   * wishlists_insert: only the host, only while the occasion has no list
--   * occasions_insert / wishlists_insert: display_name set + all consents
--   * wishes: `priority` instead of `position` in the column grant
--   * profiles: co-members may read ONLY id + display_name (column grant); locale / onboarding_done_at /
--     last_seen_at / timestamps are served to the person themself by get_me() and export_my_data()
--     (attack round 1, F-2: data minimisation — friends must not see when you last used the app)
--   * consents: insert is a column grant without accepted_at, so the consent timestamp is always set by
--     the database (attack round 1, F-3: the consent record is proof, the client cannot backdate it)
-- Two layers: role privileges (grant/revoke, incl. column level) and policies (which rows).
-- Supabase gives anon/authenticated every privilege on new tables in public — first take everything away,
-- then grant precisely. `postgres` (owner, BYPASSRLS) and `service_role` are untouched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Reset
-- -----------------------------------------------------------------------------
revoke all on
  public.profiles, public.legal_versions, public.consents, public.occasions, public.occasion_addresses,
  public.invites, public.occasion_members, public.wishlists, public.wishes, public.reservations,
  public.blocks, public.reports
from public, anon, authenticated;

-- future tables in public: no automatic privileges for the API roles
-- (works for tables because the built-in default grants PUBLIC nothing on tables)
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- RLS on and FORCED on every table (the owner `postgres` has BYPASSRLS on Supabase and is a superuser
-- on PGlite, so security definer functions keep working either way).
alter table public.profiles           enable row level security;
alter table public.profiles           force  row level security;
alter table public.legal_versions     enable row level security;
alter table public.legal_versions     force  row level security;
alter table public.consents           enable row level security;
alter table public.consents           force  row level security;
alter table public.occasions          enable row level security;
alter table public.occasions          force  row level security;
alter table public.occasion_addresses enable row level security;
alter table public.occasion_addresses force  row level security;
alter table public.invites            enable row level security;
alter table public.invites            force  row level security;
alter table public.occasion_members   enable row level security;
alter table public.occasion_members   force  row level security;
alter table public.wishlists          enable row level security;
alter table public.wishlists          force  row level security;
alter table public.wishes             enable row level security;
alter table public.wishes             force  row level security;
alter table public.reservations       enable row level security;
alter table public.reservations       force  row level security;
alter table public.blocks             enable row level security;
alter table public.blocks             force  row level security;
alter table public.reports            enable row level security;
alter table public.reports            force  row level security;

-- -----------------------------------------------------------------------------
-- 1. Grants + policies. Rule P2: `to authenticated`, `(select auth.uid())` so it is evaluated once per query.
-- -----------------------------------------------------------------------------

-- ===== profiles: me + people from shared occasions (not blocked). insert = trigger, delete = delete_my_account =====
-- Column grant, not table grant: through REST a signed-in user reads id + display_name of visible rows and
-- nothing else (no last_seen_at / onboarding_done_at / locale / created_at / updated_at — not even of their
-- own row; those come from get_me() and export_my_data()). A whole-row read (`select *`, to_jsonb) is denied.
grant select (id, display_name) on public.profiles to authenticated;
grant update (display_name, locale, onboarding_done_at, last_seen_at) on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid())
         or (private.shares_occasion(id, (select auth.uid()))
             and not private.is_blocked_pair(id, (select auth.uid()))));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ===== legal_versions: readable by every signed-in user; changed only by migrations =====
grant select on public.legal_versions to authenticated;
create policy legal_versions_select on public.legal_versions for select to authenticated using (true);

-- ===== consents: own rows; insert only the current version of a text; accepted_at is always set by the DB =====
grant select on public.consents to authenticated;
grant insert (profile_id, kind, version, locale) on public.consents to authenticated;   -- never accepted_at
create policy consents_select on public.consents for select to authenticated
  using (profile_id = (select auth.uid()));
create policy consents_insert on public.consents for insert to authenticated
  with check (profile_id = (select auth.uid())
              and exists (select 1 from public.legal_versions lv
                          where lv.kind = consents.kind and lv.version = consents.version));

-- ===== occasions: active members read; host creates (with name + consents), updates, deletes =====
grant select, insert, delete on public.occasions to authenticated;
grant update (title, starts_at, ends_at, tz, all_day, place_text, description, cancelled_at) on public.occasions to authenticated;
-- host_id = me first: the host's membership row is created by an AFTER INSERT trigger, and
-- `insert ... returning` (supabase-js .insert().select()) checks the SELECT policy before that trigger runs.
create policy occasions_select on public.occasions for select to authenticated
  using (host_id = (select auth.uid()) or private.is_active_member(id, (select auth.uid())));
create policy occasions_insert on public.occasions for insert to authenticated
  with check (host_id = (select auth.uid())
              and private.profile_complete((select auth.uid()))
              and private.has_consents((select auth.uid())));
create policy occasions_update on public.occasions for update to authenticated
  using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy occasions_delete on public.occasions for delete to authenticated
  using (host_id = (select auth.uid()));

-- ===== occasion_addresses (exact address): host, and members who said "going" =====
grant select, insert, delete on public.occasion_addresses to authenticated;
grant update (address) on public.occasion_addresses to authenticated;
create policy occasion_addresses_select on public.occasion_addresses for select to authenticated
  using (private.is_host(occasion_id, (select auth.uid()))
         or private.is_going_member(occasion_id, (select auth.uid())));
create policy occasion_addresses_insert on public.occasion_addresses for insert to authenticated
  with check (private.is_host(occasion_id, (select auth.uid())));
create policy occasion_addresses_update on public.occasion_addresses for update to authenticated
  using (private.is_host(occasion_id, (select auth.uid())))
  with check (private.is_host(occasion_id, (select auth.uid())));
create policy occasion_addresses_delete on public.occasion_addresses for delete to authenticated
  using (private.is_host(occasion_id, (select auth.uid())));

-- ===== invites: the host sees metadata but never token_hash; insert only through create_invite() =====
grant select (id, occasion_id, created_by, expires_at, max_uses, use_count, revoked_at, created_at) on public.invites to authenticated;
grant update (revoked_at) on public.invites to authenticated;
grant delete on public.invites to authenticated;
create policy invites_select on public.invites for select to authenticated
  using (private.is_host(occasion_id, (select auth.uid())));
create policy invites_update on public.invites for update to authenticated
  using (private.is_host(occasion_id, (select auth.uid())))
  with check (private.is_host(occasion_id, (select auth.uid())));
create policy invites_delete on public.invites for delete to authenticated
  using (private.is_host(occasion_id, (select auth.uid())));

-- ===== occasion_members: own row; active rows for active members; every row for the host. RSVP = own update =====
grant select on public.occasion_members to authenticated;
grant update (rsvp) on public.occasion_members to authenticated;
create policy occasion_members_select on public.occasion_members for select to authenticated
  using (profile_id = (select auth.uid())
         or (private.is_active_member(occasion_id, (select auth.uid()))
             and (status = 'active' or private.is_host(occasion_id, (select auth.uid())))));
create policy occasion_members_update on public.occasion_members for update to authenticated
  using (profile_id = (select auth.uid()) and status = 'active')
  with check (profile_id = (select auth.uid()) and status = 'active');
-- insert/delete: only the trigger occasion_after_insert, accept_invite, leave_occasion, remove_member

-- ===== wishlists: members read; pilot = exactly one list per occasion, created by the trigger for the host =====
grant select, insert, delete on public.wishlists to authenticated;
grant update (title) on public.wishlists to authenticated;
create policy wishlists_select on public.wishlists for select to authenticated
  using (private.can_read_wishlist(id, (select auth.uid())));
create policy wishlists_insert on public.wishlists for insert to authenticated
  with check (owner_id = (select auth.uid())
              and recipient_id = (select auth.uid())                   -- pilot: recipient = owner
              and private.is_host(occasion_id, (select auth.uid()))     -- only the host of the occasion
              and not private.occasion_has_wishlist(occasion_id)        -- and only while there is no list yet
              and private.profile_complete((select auth.uid()))
              and private.has_consents((select auth.uid())));
create policy wishlists_update on public.wishlists for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy wishlists_delete on public.wishlists for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ===== wishes: like wishlists; the owner writes (hard delete → trigger ends reservations) =====
grant select, insert, delete on public.wishes to authenticated;
grant update (title, price_cents, currency, url, note, priority) on public.wishes to authenticated;
create policy wishes_select on public.wishes for select to authenticated
  using (private.can_read_wishlist(wishlist_id, (select auth.uid())));
create policy wishes_insert on public.wishes for insert to authenticated
  with check (private.is_wishlist_owner(wishlist_id, (select auth.uid()))
              and private.has_consents((select auth.uid())));
create policy wishes_update on public.wishes for update to authenticated
  using (private.is_wishlist_owner(wishlist_id, (select auth.uid())))
  with check (private.is_wishlist_owner(wishlist_id, (select auth.uid())));
create policy wishes_delete on public.wishes for delete to authenticated
  using (private.is_wishlist_owner(wishlist_id, (select auth.uid())));

-- ===== reservations: THE MAIN RULE =====
-- No REST access whatsoever: not one grant for anon/authenticated (pilot-decisions §1, closes count=planned, G-26).
-- Reservations are read only through get_occasion_screen() and my_reservations(), written only by
-- reserve_wish() / cancel_reservation() / triggers / lifecycle RPCs (all security definer).
-- The policy below is a second line of defence in case a grant ever appears by mistake:
-- the reserver sees own rows; an active member sees active rows; owner/recipient see nothing.
create policy reservations_select on public.reservations for select to authenticated
  using (
    reserver_id = (select auth.uid())
    or (
      status = 'active'
      and recipient_id <> (select auth.uid())
      and private.can_read_wishlist(wishlist_id, (select auth.uid()))
      and not private.is_wishlist_owner(wishlist_id, (select auth.uid()))
    )
  );

-- ===== blocks: own (as blocker); write only through block_user / unblock_user =====
grant select on public.blocks to authenticated;
create policy blocks_select on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

-- ===== reports: own; insert with consents =====
grant select, insert on public.reports to authenticated;
create policy reports_select on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and private.has_consents((select auth.uid())));
