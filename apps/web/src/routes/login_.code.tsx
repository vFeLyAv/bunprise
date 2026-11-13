import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { compact, optionalEnum, optionalString } from '../lib/search'
import { contentLocale, ensureNamespaces } from '../lib/i18n'
import { DEMO_MODE, TURNSTILE_SITE_KEY } from '../lib/app'
import { requestEmailCode, verifyEmailCode } from '../lib/api/auth'
import { AppError, toAppError } from '../lib/errors'
import { Button, LargeTitle, OtpField, Page, TopBar, linkClass, useBunniesShown } from '../ui'
import { BunnyMoment } from '../features/mascot-ui/BunnyMoment'
import { MotionScope } from '../motion/MotionScope'
import { preloadMascot } from '../features/mascot-ui/Mascot'
import { codeFromText, destinationAfterSignIn, forgetEmailAttempt, readEmailAttempt, rememberEmailAttempt, RESEND_DELAY_MS, safeNext } from '../features/auth/flow'
import { AuthError, useOnline, usePageTitle } from '../features/auth/shared'
import { keepWords } from '../features/auth/keepWords'
import { Turnstile } from '../features/auth/Turnstile'

// S3 enter the e-mail code (public). File name `login_.code` = sibling screen of /login,
// not nested inside it (TanStack "_" suffix).

export const Route = createFileRoute('/login_/code')({
  validateSearch: (search: Record<string, unknown>): { next?: string; mode?: 'signup' | 'signin' } => compact({
    next: optionalString(search.next),
    mode: optionalEnum(search.mode, ['signup', 'signin']),
  }),
  // No attempt in this tab → back to /login; a link's code rides along in the fragment (features/auth/carryLink.ts: guardCode)
  beforeLoad: async ({ location, search }) => {
    const { guardCode } = await import('../features/auth/carryLink')
    await guardCode(search, location.hash)
  },
  loader: () => ensureNamespaces('auth'),
  component: CodeRoute,
})

// animates inside its own <MotionScope> (the shell has no LazyMotion: docs/decisions/2026-10-20-motion-scope.md)
function CodeRoute() {
  return (
    <MotionScope>
      <CodePage />
    </MotionScope>
  )
}

function CodePage() {
  const { t } = useTranslation('auth')
  const { next } = Route.useSearch()
  const { queryClient } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  const [attempt, setAttempt] = useState(() => readEmailAttempt())
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [now, setNow] = useState(Date.now)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const [notice, setNotice] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const working = useRef(false)
  const verified = useRef<string | null>(null)
  const card = useRef<HTMLFormElement>(null)
  const mounted = useRef(false)
  const online = useOnline()
  const bunnies = useBunniesShown()
  const seconds = Math.max(0, Math.ceil(((attempt?.requestedAt ?? 0) + RESEND_DELAY_MS - now) / 1000))
  usePageTitle(t('code.title'))

  useEffect(() => {
    mounted.current = true
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    preloadMascot()
    return () => { mounted.current = false; window.clearInterval(timer) }
  }, [])

  async function verify(value = code) {
    if (!attempt || !online || working.current || (!verified.current && value.length !== 6)) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      if (!verified.current) {
        const session = await verifyEmailCode(attempt.email, value)
        verified.current = session.user.id
        if (!mounted.current) return
        setAuthenticated(true)
      }
      const destination = await destinationAfterSignIn(queryClient, verified.current, next)
      if (!mounted.current) return
      await navigate({ href: destination, replace: true })
      forgetEmailAttempt()
    } catch (err) {
      setError(toAppError(err))
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  async function resend() {
    if (!attempt || !online || working.current || seconds > 0 || (TURNSTILE_SITE_KEY && !captcha)) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      await requestEmailCode(attempt.email, { mode: attempt.mode, locale: contentLocale(), captchaToken: captcha ?? undefined })
      if (!mounted.current) return
      const updated = rememberEmailAttempt(attempt.email, undefined, attempt.mode)
      setAttempt(updated)
      setNow(updated.requestedAt)
      setCode('')
      setNotice(true)
    } catch (err) {
      setError(toAppError(err))
    } finally {
      working.current = false
      setBusy(false)
      setCaptcha(null)
      setCaptchaReset((value) => value + 1)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void verify()
  }

  /** Typed, autofilled or pasted: digits only, at most six; the sixth digit checks the code at once. */
  function enter(raw: string) {
    const value = raw.replace(/\D/g, '').slice(0, 6)
    setCode(value)
    setError(null)
    setNotice(false)
    if (value.length === 6 && value !== code && online) void verify(value)
  }

  // A paste is read here, before the field's own six-character limit cuts "123 456" to "12345": the code's
  // digits replace the field (fewer than six are added to what is already typed).
  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const digits = codeFromText(event.clipboardData.getData('text/plain'))
    if (!digits) return
    event.preventDefault()
    enter(digits.length === 6 ? digits : code + digits)
  }

  // sign-in keeps the neutral line (it never says whether the address has an account) next to the way forward
  const signin = attempt?.mode === 'signin'

  return (
    <Page topBar={<TopBar large title={t('code.title')} back={{ label: t('common.back'), onClick: () => {
      void navigate({ to: '/login', search: { next: safeNext(next), mode: attempt?.mode ?? 'signin', method: 'email' } })
    } }} />}>
      <div className="flex flex-col gap-6 pt-4">
        {/* the room above the card is the bunny's (none when bunnies are off: no empty hole) */}
        <div className={bunnies ? 'mb-24' : undefined}>
          <LargeTitle className="mb-3">{t('code.title')}</LargeTitle>
          <p className="break-words t-body text-text-2">{t('code.sent_to', { email: attempt?.email ?? '' })}</p>
        </div>
        <div className="relative">
        {/* Pompon keeps watch over the code slots (peeks over the card and stays; under "Weniger" the calm
            still bunny with closed eyes, pilot-decisions §000.11) */}
        <BunnyMoment kind="peek" still once="visit" onceKey="auth-entry" calm="still" cardRef={card} minSize={96} maxSize={112}
          className="pointer-events-none absolute inset-x-0 z-2" style={{ top: 16 - 124, height: 124 }} />
        <form ref={card} onSubmit={submit} className="glass-panel relative z-1 flex flex-col gap-5 rounded-card p-5 pt-7">
          {notice || signin ? <p role="status" className="t-footnote text-text-2">{t(signin ? 'auth.sent_neutral_signin' : 'auth.sent_neutral')}</p> : null}
          <div onPaste={paste}>
            <OtpField autoFocus label={t('code.label')} value={code} disabled={busy || authenticated}
              onChange={(event) => enter(event.target.value)} />
          </div>
          {DEMO_MODE ? <p className="t-footnote text-text-2">{keepWords(t('auth.demo_notice'))}</p> : null}
          <AuthError error={error} />
          {!online ? <p role="status" className="t-footnote text-text-2">{t('common.offline_short')}</p> : null}
          <Button type="submit" size="lg" fullWidth disabled={!online || (!authenticated && code.length !== 6)}
            loading={busy} loadingLabel={t('code.checking')}>{authenticated ? t('common.retry') : t('code.confirm')}</Button>
        </form>
        </div>
        <Turnstile onToken={setCaptcha} resetKey={captchaReset} label={t('auth.captcha_label')} />
        <Button variant="secondary" size="lg" fullWidth disabled={!online || busy || authenticated || seconds > 0 || Boolean(TURNSTILE_SITE_KEY && !captcha)}
          onClick={() => { void resend() }}>{seconds ? t('code.resend_in', { s: seconds }) : t('code.resend')}</Button>
        <Link to="/login" search={{ next: safeNext(next), mode: attempt?.mode ?? 'signin', method: 'email' }} className={`${linkClass} text-center`}>{t('code.other_email')}</Link>
        {signin ? <Link to="/login" search={{ next: safeNext(next), mode: 'signup', method: 'email' }} className={`${linkClass} text-center`}>{t('auth.new_account')}</Link> : null}
      </div>
    </Page>
  )
}
