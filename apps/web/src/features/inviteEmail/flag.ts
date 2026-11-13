// The release flag of the invitation e-mail "Bei neuen Einladungen eine E-Mail schicken" (docs/spec/invite-email-design.md
// §11): on in the demo (`VITE_DEMO=1`, no real mail: the switch is simulated) and when `VITE_INVITE_EMAIL=1`; otherwise
// the Profil row is not shown and the app never calls its RPCs. It also needs the invitations themselves (VITE_INVITES).
// The flag hides the interface only — the database decides (private.features.invite_email, switched by
// private.set_invite_email_feature; red button supabase/emergency/invite_email_off.sql), and the Worker answers 501
// without BREVO_API_KEY.

export function inviteEmailEnabled(env: { VITE_DEMO?: unknown; VITE_INVITE_EMAIL?: unknown } = import.meta.env): boolean {
  return env.VITE_DEMO === '1' || env.VITE_INVITE_EMAIL === '1'
}
