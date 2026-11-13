-- =============================================================================
-- Bunprise (27.10, 5th release): "Meine Daten herunterladen" (DSGVO Art. 15 / 20) catches up with the columns the
-- 25.–27.10 work added. Forward only, NOT applied to the hosted project by agents: Felix runs `npx supabase db push`.
--
-- What changes (nothing else; both functions are their previous bodies plus the new keys):
--   export_my_data()            occasions_hosted[] + place_lat, place_lon (20261027190000), sections (20261025150000),
--                               cover_theme (20261027140000), guests_can_invite (20261027120000). The format stays
--                               'bunprise-export-v2' (keys are only added). Previous body: 20261020200100_follows.sql.
--   private.my_profile_export() + invitations_from (20261027120000). Previous body: 20261024120000_profile_photos.sql.
-- Secrecy: only the caller's own occasions and profile; nothing reads a reservation, no count, no order.
-- Both keep their security mode, search_path = '' and (CREATE OR REPLACE) their grants.
-- LATER MIGRATIONS that re-create either function must keep these keys.
-- =============================================================================

create or replace function public.export_my_data()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  return jsonb_build_object(
    'format', 'bunprise-export-v2',
    'exported_at', now(),
    'profile', private.my_profile_export(),
    'consents', (select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'version', c.version, 'locale', c.locale,
                                                              'accepted_at', c.accepted_at) order by c.accepted_at, c.kind), '[]'::jsonb)
                 from public.consents c where c.profile_id = v_uid),
    'occasions_hosted', (
      select coalesce(jsonb_agg((jsonb_build_object('id', o.id, 'host_id', o.host_id, 'title', o.title, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'tz', o.tz, 'all_day', o.all_day, 'place_text', o.place_text, 'place_lat', o.place_lat, 'place_lon', o.place_lon, 'description', o.description, 'cancelled_at', o.cancelled_at, 'sections', o.sections, 'cover_theme', o.cover_theme, 'guests_can_invite', o.guests_can_invite, 'created_at', o.created_at, 'updated_at', o.updated_at) || jsonb_build_object(
               'invites', (select coalesce(jsonb_agg(jsonb_build_object(               -- never token_hash
                             'id', i.id, 'expires_at', i.expires_at, 'max_uses', i.max_uses, 'use_count', i.use_count,
                             'revoked_at', i.revoked_at, 'created_at', i.created_at) order by i.created_at), '[]'::jsonb)
                           from public.invites i where i.occasion_id = o.id),
               'members', (select coalesce(jsonb_agg(jsonb_build_object(
                             'display_name', p.display_name, 'role', m.role, 'rsvp', m.rsvp, 'status', m.status,
                             'joined_at', m.joined_at) order by m.joined_at), '[]'::jsonb)
                           from public.occasion_members m
                           left join public.profiles p on p.id = m.profile_id
                           where m.occasion_id = o.id)
             )) order by o.starts_at, o.id), '[]'::jsonb)
      from public.occasions o where o.host_id = v_uid),
    'memberships', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'occasion_id', m.occasion_id, 'occasion_title', o.title, 'starts_at', o.starts_at,
               'role', m.role, 'rsvp', m.rsvp, 'status', m.status, 'joined_at', m.joined_at)
               order by m.joined_at, m.occasion_id), '[]'::jsonb)
      from public.occasion_members m
      left join public.occasions o on o.id = m.occasion_id
      where m.profile_id = v_uid and m.role = 'member'),
    'wishlists', private.my_wishlists_export(),
    'reservations_made_by_me', private.my_reservations_export(),
    'follows', private.my_follows_export(),
    'blocks', (select coalesce(jsonb_agg(jsonb_build_object('blocked_name', p.display_name, 'created_at', b.created_at)
                                         order by b.created_at), '[]'::jsonb)
               from public.blocks b left join public.profiles p on p.id = b.blocked_id where b.blocker_id = v_uid),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reporter_id', r.reporter_id, 'target_kind', r.target_kind, 'target_id', r.target_id, 'reason', r.reason, 'created_at', r.created_at, 'handled_at', r.handled_at, 'outcome', r.outcome) order by r.created_at), '[]'::jsonb)
                from public.reports r where r.reporter_id = v_uid)
  );
end $$;

create or replace function private.my_profile_export()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name, 'locale', p.locale,
                            'onboarding_done_at', p.onboarding_done_at, 'banner', p.banner,
                            'in_suggestions', p.in_suggestions, 'invitations_from', p.invitations_from,
                            -- the meta of the own photos (the bytes: export_my_profile_photos(), added by the client)
                            'photo', private.profile_photo_meta(p.id, 'avatar'),
                            'banner_photo', private.profile_photo_meta(p.id, 'banner'),
                            'created_at', p.created_at, 'updated_at', p.updated_at)
  from public.profiles p where p.id = auth.uid();
$$;
