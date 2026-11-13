-- =============================================================================
-- Bunprise — RED BUTTON: switch the invitation e-mail OFF in the database (docs/spec/invite-email-design.md §11).
-- Run it in the Supabase SQL editor (or copy it into a new migration) — no deploy needed.
-- Effect at once: the dispatch job is removed, the outbox is emptied, nobody can opt in, no new mail is decided.
-- A dispatch that is running finishes first (it holds the switch row FOR SHARE); mails it already handed to pg_net
-- still go out. The opt-ins stay (switching on again uses them).
-- Even faster, without the database: remove the Worker secret (`npx wrangler secret delete BREVO_API_KEY -c
-- workers/edge/wrangler.jsonc`) — the Worker then answers 501 and sends nothing.
-- Back on: supabase/emergency/invite_email_on.sql.
-- One plain statement, no LOCK TABLE (supabase db push does not wrap a file in one transaction).
-- =============================================================================

select private.set_invite_email_feature(false);
