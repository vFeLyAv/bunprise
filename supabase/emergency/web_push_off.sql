-- =============================================================================
-- Bunprise — RED BUTTON: switch Web Push OFF in the database (docs/spec/web-push-design.md §10).
-- Run it in the Supabase SQL editor (or copy it into a new migration) — no deploy needed.
-- Effect at once: the dispatch job is removed, the outbox is emptied, no device can subscribe, nothing more is sent.
-- Devices and preferences stay (switching on again uses them). Already delivered notifications stay on the phones.
-- Back on: supabase/emergency/web_push_on.sql.
-- =============================================================================

select private.set_web_push(false);
