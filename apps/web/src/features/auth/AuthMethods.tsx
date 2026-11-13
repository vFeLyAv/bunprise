import { useTranslation } from 'react-i18next'
import type { AuthMode } from '../../lib/api/auth'
import { IN_TELEGRAM } from '../../lib/telegram/detect'
import { buttonClass } from '../../ui'
import { PressLink } from '../shell/MotionLink'
import { socialProviderClass, SocialProviderContent } from './SocialProvider'

export type AuthMethod = 'google' | 'apple' | 'email'

const ALL_METHODS: readonly AuthMethod[] = ['google', 'apple', 'email']
const EMAIL_ONLY: readonly AuthMethod[] = ['email']

/**
 * The sign-in choices this tab offers. In the browser all three stay visible (the selected provider page
 * checks its configuration). Inside a Telegram Mini App only the e-mail code: Google refuses OAuth in
 * embedded web views (`disallowed_useragent`; on web.telegram.org the page is even framed) and Apple is not
 * set up (docs/spec/telegram-mini-app.md §3.5). Read at render time, not frozen at import.
 */
export function offeredAuthMethods(): readonly AuthMethod[] {
  return IN_TELEGRAM ? EMAIL_ONLY : ALL_METHODS
}

export interface AuthMethodsProps {
  mode: AuthMode
  next?: string
  /**
   * 'glass' = on the start screen's glass card over the warm scene: the e-mail button in accent glass
   * (like the "+" FAB). Google and Apple keep their opaque provider buttons in every case.
   */
  surface?: 'page' | 'glass'
}

/** Google · Apple · E-Mail (in Telegram: E-Mail only) — links to the sign-in step of the chosen method; they press like buttons. */
export function AuthMethods({ mode, next, surface = 'page' }: AuthMethodsProps) {
  const { t } = useTranslation('auth')
  const emailVariant = surface === 'glass' ? 'glass-accent' : 'primary'
  return <div className="flex flex-col gap-3">
    {offeredAuthMethods().map((method) => (
      <PressLink key={method} to="/login" search={{ mode, method, next }}
        className={`${buttonClass({ size: 'lg', fullWidth: true, variant: method === 'email' ? emailVariant : 'secondary' })} ${method === 'email' ? '' : socialProviderClass(method)}`}>
        {method === 'email' ? t('auth.continue_email') : <SocialProviderContent provider={method}>{t(`auth.continue_${method}`)}</SocialProviderContent>}
      </PressLink>
    ))}
  </div>
}
