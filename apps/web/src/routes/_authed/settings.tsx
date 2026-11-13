import { createFileRoute } from '@tanstack/react-router'
import { ensureNamespaces } from '../../lib/i18n'
import { SettingsPage } from '../../features/account/AccountPages'
import { MotionSettingsSection } from '../../motion/MotionSettingsSection'

// S11 settings = the Profil tab (wave 1, K11: profile and settings in one Telegram-style screen, a top-level
// screen with the tab bar): profile header, account, language, motion (K9: Animationen · Kaninchen · Akku,
// src/motion/MotionSettingsSection.tsx in SettingsPage's slot), this device, your data, legal, help, sign out.
// The loader brings the `motion` strings too, so the section never shows its skeleton on the way in.

export const Route = createFileRoute('/_authed/settings')({
  staticData: { allowWithoutConsent: true },
  loader: () => ensureNamespaces('settings', 'motion'),
  component: () => <SettingsPage userId={Route.useRouteContext().session.user.id} motionSection={<MotionSettingsSection />} />,
})
