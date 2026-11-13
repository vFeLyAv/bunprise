import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { compact, optionalString } from '../../lib/search'
import { contentLocale, ensureNamespaces } from '../../lib/i18n'
import { onAuthStateChange } from '../../lib/api/auth'
import { LIMITS, SUPPORT_EMAIL } from '../../lib/app'
import type { Me } from '../../lib/api/types'
import { AppError, toAppError } from '../../lib/errors'
import { signOutEverywhere } from '../../lib/query'
import { qk } from '../../lib/queryKeys'
import { AuthError, useOnline, usePageTitle } from '../../features/auth/shared'
import { CODE_LIFETIME_MS } from '../../features/auth/flow'
import { loadProfileSetup, profileDestination, saveProfileSetup, type ProfileSetup } from '../../features/profile/setup'
import { Button, Checkbox, LargeTitle, Page, Skeleton, TextField, buttonClass, linkClass, useBunniesShown } from '../../ui'
import { BunnyMoment } from '../../features/mascot-ui/BunnyMoment'
import { textLinkClass } from '../../features/legal/textLink'

// S3b name + consents. Reachable WITHOUT consents (that is what it collects); the _authed
// guard reads `staticData.allowWithoutConsent`. Sibling of /welcome ("_" suffix), not nested.
// The last step of signing up: the legal footer stays here (the person decides about the terms right
// now; there is no tab bar yet to reach the profile's "Rechtliches" section). Name changes have their own
// sheet inside the Profil tab; this route always remains the profile/consent setup step.

export const Route = createFileRoute('/_authed/welcome_/profile')({
  staticData: { allowWithoutConsent: true, legalFooter: true },
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    compact({ next: optionalString(search.next) }),
  loader: () => ensureNamespaces('onboarding', 'auth', 'settings'),
  component: ProfilePage,
})

function ProfilePage() {
  const { t } = useTranslation('onboarding')
  const { session, queryClient } = Route.useRouteContext()
  const userId = session.user.id
  const [activeId, setActiveId] = useState<string | null>(userId)
  const locale = contentLocale()
  const online = useOnline()
  const bunnies = useBunniesShown()
  const card = useRef<HTMLDivElement>(null)
  const setup = useQuery({
    queryKey: ['profileSetup', userId, locale], queryFn: () => loadProfileSetup(userId, locale),
    staleTime: 0, retry: false, networkMode: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
    enabled: activeId === userId,
  })
  usePageTitle(t('profile.title'))
  useEffect(() => onAuthStateChange((_event, active) => setActiveId(active?.user.id ?? null)), [])
  // The skeleton has the form's height, so "Konto und Daten" below it never jumps (perf audit: CLS
  // 0.106). Whether the form will ask for the two confirmations is known from the sign-in's get_me of
  // this account (cached by destinationAfterSignIn): legal records missing → both checkboxes.
  const [pendingChecks] = useState(() => {
    const cached = queryClient.getQueryData<Me>(qk.me())
    return cached && cached.profile.id === userId && cached.consents_ok ? 0 : 2
  })

  return <Page className="flex flex-col gap-6 pt-8">
    {/* the room above the card is the bunny's (none when bunnies are off: no empty hole) */}
    <LargeTitle className={bunnies ? 'mb-24' : 'mb-0'}>{t('profile.title')}</LargeTitle>
    {activeId !== userId ? <>
      <AuthError error={new AppError('session_expired')} />
      <Link to="/login" className={buttonClass({ size: 'lg' })}>{t('auth.title')}</Link>
    </> : <>
      <div className="relative">
      {/* Pompon peeks up over the card and waves hello while you pick your name; under "Weniger" the calm still
          bunny with closed eyes (pilot-decisions §000.11) instead of an empty hole */}
      <BunnyMoment kind="wave" once="visit" onceKey="profile" calm="still" cardRef={card} minSize={96} maxSize={112}
        className="pointer-events-none absolute inset-x-0 z-2" style={{ top: 16 - 124, height: 124 }} />
      <div ref={card} className="glass-panel relative z-1 rounded-card p-5 pt-7">
      {setup.isPending ? <ProfileFormSkeleton checks={pendingChecks} /> : setup.isError ? <>
        <AuthError error={toAppError(setup.error)} />
        <Button disabled={!online || setup.isFetching} onClick={() => { void setup.refetch() }}>{t('common.retry')}</Button>
      </> : <ProfileForm key={`${userId}:${locale}:${JSON.stringify(setup.data.versions)}`} setup={setup.data}
        reload={() => { void setup.refetch() }} />}
      </div>
      </div>
      <ProfileAccess userId={userId} reconsent={setup.data?.reconsent ?? false} />
    </>}
  </Page>
}

/** One text line of the skeleton at the real line height (the block keeps its text's height). */
function SkeletonLine({ width }: { width: string }) {
  return (
    <span className="flex h-(--lh-footnote) items-center">
      <Skeleton width={width} height={11} />
    </span>
  )
}

/**
 * The form's shape while its data loads — field (label, box, hint), the hint line, the button, `checks`
 * checkbox rows, the privacy line — at the same heights, so nothing under it moves (CLS 0).
 */
function ProfileFormSkeleton({ checks }: { checks: number }) {
  const { t } = useTranslation('onboarding')
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <span role="status" className="sr-only">{t('common.loading')}</span>
      <div aria-hidden="true" className="flex flex-col">
        <span className="mb-1"><SkeletonLine width="16%" /></span>
        <span className="block h-12 rounded-md bg-fill" />
        <span className="mt-1"><SkeletonLine width="62%" /></span>
      </div>
      <span aria-hidden="true"><SkeletonLine width="70%" /></span>
      <Skeleton height={52} rounded="full" />
      {Array.from({ length: checks }, (_, index) => (
        <span key={index} aria-hidden="true" className="flex min-h-11 items-start gap-3 py-2">
          <Skeleton width={20} height={20} className="mt-0.5 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col">
            <SkeletonLine width={index === 0 ? '58%' : '86%'} />
            {index === 0 ? null : <SkeletonLine width="34%" />}
          </span>
        </span>
      ))}
      <span aria-hidden="true" className="flex flex-col">
        <SkeletonLine width="92%" />
        <SkeletonLine width="40%" />
      </span>
    </div>
  )
}

function ProfileForm({ setup, reload }: { setup: ProfileSetup; reload: () => void }) {
  const { t } = useTranslation('onboarding')
  const { next } = Route.useSearch()
  const { queryClient } = Route.useRouteContext()
  const navigate = Route.useNavigate()
  const [initial] = useState(() => {
    const savedName = queryClient.getQueryData<{ value: string; at: number }>(['profileNameDraft', setup.me.profile.id])
    const checks = queryClient.getQueryData<{ age: boolean; terms: boolean; at: number }>(['profileChecksDraft', setup.me.profile.id, setup.locale, setup.versions])
    const fresh = (at: number) => at <= Date.now() && Date.now() - at <= CODE_LIFETIME_MS
    return {
      name: savedName && fresh(savedName.at) ? savedName.value : setup.me.profile.display_name ?? '',
      age: checks && fresh(checks.at) ? checks.age : setup.checkedAge,
      terms: checks && fresh(checks.at) ? checks.terms : setup.checkedTerms,
    }
  })
  const [name, setName] = useState(initial.name)
  const [age, setAge] = useState(initial.age)
  const [terms, setTerms] = useState(initial.terms)
  const [error, setError] = useState<AppError | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const mounted = useRef(false)
  const online = useOnline()
  const needAge = setup.missing.includes('age_18plus')
  const needTerms = setup.missing.includes('terms')
  const validName = Boolean(name.trim()) && [...name].length <= LIMITS.displayName && !/[\n\r\t]/.test(name)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    // Memory only: reading legal pages keeps the form; a changed version resets its checkboxes.
    const at = Date.now()
    queryClient.setQueryData(['profileNameDraft', setup.me.profile.id], { value: name, at })
    queryClient.setQueryData(['profileChecksDraft', setup.me.profile.id, setup.locale, setup.versions], { age, terms, at })
  }, [queryClient, setup.me.profile.id, setup.locale, setup.versions, name, age, terms])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !online || !validName || !setup.legalAvailable || (needAge && !age) || (needTerms && !terms)) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const me = await saveProfileSetup(setup, { name, age, terms })
      if (!mounted.current) return
      queryClient.setQueryData(qk.me(), me)
      queryClient.removeQueries({ queryKey: ['profileNameDraft', setup.me.profile.id] })
      queryClient.removeQueries({ queryKey: ['profileChecksDraft', setup.me.profile.id] })
      await navigate({ href: profileDestination(me, next), replace: true })
    } catch (err) {
      if (!mounted.current) return
      const failure = toAppError(err)
      setError(failure)
      if (failure.code === 'conflict') reload()
    } finally {
      submitting.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <form className="flex flex-col gap-5" onSubmit={(event) => { void save(event) }}>
    <TextField autoFocus label={t('profile.name_label')} hint={t('profile.name_hint')} autoComplete="nickname" required
      value={name} disabled={busy} onChange={(event) => setName(event.target.value)}
      error={name && !validName ? t('profile.name_error', { max: LIMITS.displayName }) : undefined} />
    <p className="t-footnote text-text-2">{t('profile.no_birthday_hint')}</p>
    {!setup.legalAvailable && <p role="alert" className="t-footnote text-danger">{t('profile.legal_unavailable')}</p>}
    <AuthError error={error} />
    {!online && <p role="status" className="t-footnote text-text-2">{t('errors.offline_action')}</p>}
    <Button type="submit" size="lg" fullWidth loading={busy} loadingLabel={t('profile.saving')}
      disabled={!online || !validName || !setup.legalAvailable || (needAge && !age) || (needTerms && !terms)}>{t('profile.done')}</Button>
    {/* Felix 25.10: the consent boxes sit under the button (as on the sign-in form) */}
    {needAge && <Checkbox checked={age} disabled={busy} onChange={setAge}>{t('auth.age18')}</Checkbox>}
    {needTerms && <Checkbox checked={terms} disabled={busy} onChange={setTerms}>
      {t('auth.terms_accept')} <Link to="/legal/nutzung" search={{ version: setup.versions.terms, lang: setup.locale }}
        className={textLinkClass}>{t('auth.terms_link')}</Link>
    </Checkbox>}
    <p className="t-footnote text-text-2">{t('auth.privacy_notice')} <Link to="/legal/datenschutz"
      search={{ version: setup.versions.privacy_notice, lang: setup.locale }}
      className={textLinkClass}>{t('auth.privacy_link')}</Link>.</p>
  </form>
}

function ProfileAccess({ userId, reconsent }: { userId: string; reconsent: boolean }) {
  const { t } = useTranslation('onboarding')
  const [error, setError] = useState<AppError | null>(null)
  const [busy, setBusy] = useState(false)
  return <nav aria-label={t('profile.account_actions')} className="flex flex-col items-start gap-3 border-t border-separator pt-5">
    {/* only a re-consent speaks of new terms; a first sign-up gets the neutral line */}
    <p className="t-footnote text-text-2">{t(reconsent ? 'profile.account_access' : 'profile.account_access_first')}</p>
    <Link to="/settings/export" className={linkClass}>{t('settings.export')}</Link>
    <Link to="/settings/delete" className={linkClass}>{t('settings.delete_account')}</Link>
    {SUPPORT_EMAIL.includes('@') ? <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>{t('settings.report')}</a>
      : <p className="t-footnote text-text-2">{t('profile.contact_pending')}</p>}
    <AuthError error={error} />
    <Button variant="secondary" disabled={busy} onClick={() => {
      setBusy(true)
      void signOutEverywhere({ expectedUserId: userId }).catch((err: unknown) => { setError(toAppError(err)); setBusy(false) })
    }}>{t('settings.logout')}</Button>
  </nav>
}
