import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { contentLocale } from '../../lib/i18n'
import { DEMO_MODE, TURNSTILE_SITE_KEY } from '../../lib/app'
import { isOAuthProviderAvailable, requestEmailCode, signInWithProvider, type AuthMode } from '../../lib/api/auth'
import { AppError, toAppError } from '../../lib/errors'
import { IN_TELEGRAM } from '../../lib/telegram/detect'
import { Button, Checkbox, LargeTitle, Page, TextField, TopBar, buttonClass, linkClass, useBunniesShown } from '../../ui'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { forgetPendingConsent, readEmailAttempt, readLoginDraft, rememberEmailAttempt, rememberLoginDraft, rememberPendingConsent, signInTarget } from './flow'
import { AuthError, useOnline, usePageTitle } from './shared'
import { AuthMethods, offeredAuthMethods, type AuthMethod } from './AuthMethods'
import { Turnstile } from './Turnstile'
import { socialProviderClass, SocialProviderContent } from './SocialProvider'
import { PressLink } from '../shell/MotionLink'
import { textLinkClass } from '../legal/textLink'
import { keepWords } from './keepWords'

/** The peeking bunny's host above the card (its bottom reaches 16 px onto the card). */
const BUNNY_HOST_PX = 124

export function LoginForm({ mode, method: requested, next }: { mode: AuthMode; method?: AuthMethod; next?: string }) {
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const [initialDraft] = useState(readLoginDraft)
  const [email, setEmail] = useState(() => initialDraft?.email ?? readEmailAttempt()?.email ?? '')
  const [adult, setAdult] = useState(mode === 'signup' && (initialDraft?.adult ?? false))
  const [terms, setTerms] = useState(mode === 'signup' && (initialDraft?.terms ?? false))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const sending = useRef(false)
  const card = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  const online = useOnline()
  const bunnies = useBunniesShown()
  const offered = offeredAuthMethods()
  // A choice of one is no choice: with only the e-mail code (Telegram) "/login" opens the e-mail form directly.
  const chooser = offered.length > 1
  const method = requested ?? (chooser ? undefined : offered[0])
  const accepted = mode === 'signin' || (adult && terms)
  const ready = accepted && online && (method !== 'email' || !TURNSTILE_SITE_KEY || Boolean(captcha))
  const provider = method === 'google' || method === 'apple' ? method : null
  // A link to Google / Apple opened inside Telegram (?method=google): say why not and offer the e-mail code
  // instead of a provider button that can only fail there (docs/spec/telegram-mini-app.md §3.5).
  const blockedInTelegram = provider !== null && IN_TELEGRAM
  const available = provider && !blockedInTelegram ? isOAuthProviderAvailable(provider) : false
  const providerName = provider === 'google' ? 'Google' : 'Apple'
  const title = mode === 'signup' ? t('auth.signup_title') : t('auth.title')
  const target = signInTarget(next)
  usePageTitle(title)

  useEffect(() => {
    mounted.current = true
    if (mode === 'signin') forgetPendingConsent()
    return () => { mounted.current = false }
  }, [mode])
  useEffect(() => { rememberLoginDraft({ email, adult, terms }) }, [email, adult, terms])

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    const locale = contentLocale()
    forgetPendingConsent()
    try {
      await requestEmailCode(email, { mode, locale, captchaToken: captcha ?? undefined })
      if (!mounted.current) return
      rememberEmailAttempt(email, undefined, mode)
      if (mode === 'signup') rememberPendingConsent(locale)
      await navigate({ to: '/login/code', search: { next: target, mode } })
    } catch (err) { if (mounted.current) setError(toAppError(err)) }
    finally {
      sending.current = false
      if (mounted.current) {
        setBusy(false)
        setCaptcha(null)
        setCaptchaReset((value) => value + 1)
      }
    }
  }

  async function oauth() {
    if (!provider || !available || !ready || sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    forgetPendingConsent()
    if (mode === 'signup') rememberPendingConsent(contentLocale())
    try { await signInWithProvider(provider, target) }
    catch (err) {
      if (mounted.current) {
        forgetPendingConsent()
        setError(toAppError(err))
        sending.current = false
        setBusy(false)
      }
    }
  }

  const checks = mode === 'signup' ? <div className="flex flex-col gap-1">
    <Checkbox checked={adult} disabled={busy} onChange={setAdult}>{t('auth.age18')}</Checkbox>
    <Checkbox checked={terms} disabled={busy} onChange={setTerms}>
      {t('auth.terms_accept')} <Link to="/legal/nutzung" className={textLinkClass}>{t('auth.terms_link')}</Link>
    </Checkbox>
    <p className="t-footnote text-text-2">{t('auth.privacy_notice')} <Link to="/legal/datenschutz" className={textLinkClass}>{t('auth.privacy_link')}</Link>.</p>
  </div> : null
  const emailFallback = <PressLink to="/login" search={{ mode, method: 'email', next: target }}
    className={buttonClass({ size: 'lg', fullWidth: true })}>{t('auth.continue_email')}</PressLink>

  return <Page topBar={<TopBar large title={title} back={{ label: t('common.back'), onClick: () => {
    void navigate(requested && chooser ? { to: '/login', search: { mode, next: target } } : { to: '/' })
  } }} />}>
    <div className="flex flex-col gap-6 pt-4">
      {/* the room above the card is the bunny's (none when bunnies are off: no empty hole) */}
      <div className={bunnies ? 'mb-24' : undefined}><LargeTitle className="mb-3">{title}</LargeTitle><p className="t-body text-text-2">{method === 'email' || blockedInTelegram ? keepWords(t('auth.no_password_hint')) : t('auth.choose_method_hint')}</p></div>
      <div className="relative">
      {/* Pompon peeks over the card and stays (blinks, twitches an ear) while you sign in; under "Weniger" the
          calm still bunny with closed eyes (pilot-decisions §000.11) */}
      <BunnyMoment kind="peek" once="visit" onceKey="auth-entry" calm="still" cardRef={card} minSize={96} maxSize={112}
        className="pointer-events-none absolute inset-x-0 z-2" style={{ top: 16 - BUNNY_HOST_PX, height: BUNNY_HOST_PX }} />
      <div ref={card} className="glass-panel relative z-1 rounded-card p-5 pt-7">
      {!method ? <AuthMethods mode={mode} next={target} /> : method === 'email' ? (
        <form onSubmit={(event) => { void sendCode(event) }} className="flex flex-col gap-5">
          <TextField label={t('auth.email_label')} type="email" inputMode="email" autoComplete="email"
            autoCapitalize="none" spellCheck={false} required maxLength={254} value={email}
            onChange={(event) => setEmail(event.target.value)} disabled={busy} placeholder={t('auth.email_placeholder')} />
          {DEMO_MODE ? <p className="t-footnote text-text-2">{keepWords(t('auth.demo_notice'))}</p> : null}
          <Turnstile onToken={setCaptcha} resetKey={captchaReset} label={t('auth.captcha_label')} />
          <AuthError error={error} />
          <Button type="submit" size="lg" fullWidth disabled={!ready || !email.trim()} loading={busy}
            loadingLabel={t('auth.sending')}>{t('auth.get_code')}</Button>
          {!accepted ? <p className="t-footnote text-text-2">{t('auth.consent_required')}</p> : null}
          {/* Felix 25.10: the consent boxes sit under the button, quieter than a wall of checkboxes before it */}
          {checks}
        </form>
      ) : blockedInTelegram ? (
        <div className="flex flex-col gap-5">
          <p role="status" className="t-body text-text-2">{keepWords(t('auth.provider_telegram', { provider: providerName }))}</p>
          {emailFallback}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {available ? null : <p role="status" className="t-body text-text-2">{keepWords(t('auth.provider_unavailable', { provider: providerName }))}</p>}
          <AuthError error={error} />
          <Button size="lg" variant="secondary" fullWidth disabled={!available || !ready} loading={busy}
            className={socialProviderClass(method)} onClick={() => { void oauth() }}>
            <SocialProviderContent provider={method}>{t(`auth.continue_${method}`)}</SocialProviderContent>
          </Button>
          {!available ? emailFallback : null}
          {available && !accepted ? <p className="t-footnote text-text-2">{t('auth.consent_required')}</p> : null}
          {available ? checks : null}
        </div>
      )}
      </div>
      </div>
      {!online ? <p role="status" className="t-footnote text-text-2">{t('common.offline_short')}</p> : null}
      {method && chooser && offered.some((option) => option !== method) ? <Link to="/login" search={{ mode, next: target }} className={`${linkClass} text-center`}>{t('auth.other_methods')}</Link> : null}
      <Link to="/login" search={{ mode: mode === 'signup' ? 'signin' : 'signup', method: blockedInTelegram ? 'email' : requested, next: target }}
        className={`${linkClass} text-center`}>{mode === 'signup' ? t('auth.already_account') : t('auth.new_account')}</Link>
    </div>
  </Page>
}
