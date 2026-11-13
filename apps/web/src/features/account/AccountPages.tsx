import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { APP_VERSION, SUPPORT_EMAIL } from '../../lib/app'
import { deleteMyAccount, downloadJson, exportFilename, exportMyData, getAccountDetails } from '../../lib/api/account'
import { assertCurrentAccount } from '../../lib/api/identity'
import { exportMyOccasionPhotos, withOccasionPhotos } from '../../lib/api/photos'
import { exportMyListPhotos, withListPhotos } from '../../lib/api/listPhotos'
import { isBannerKey } from '../../lib/api/lists.types'
import { exportMyProfilePhotos, withProfilePhotos } from '../../lib/api/profilePhotos'
import { exportMyWishPhotos, withWishPhotos } from '../../lib/api/wishPhotos'
import { exportMyPotluck, withPotluck } from '../../lib/api/potluck'
import { potluckEnabled } from '../potluck/flag'
import { exportMyInvitations, withInvitations } from '../../lib/api/invitations'
import { invitesEnabled } from '../invitations/flag'
import { exportMyPush, withPush } from '../../lib/api/push'
import { pushEnabled } from '../push/flag'
import { PushSettingsRow } from '../push/PushSettingsRow'
import { exportMyCalendarFeed, withCalendarFeed } from '../../lib/api/calendarFeed'
import { exportMyInviteEmail, withInviteEmail } from '../../lib/api/inviteEmail'
import { inviteEmailEnabled } from '../inviteEmail/flag'
import { calendarFeedEnabled } from '../calendarFeed/flag'
import { CalendarFeedRow } from '../calendarFeed/CalendarFeedRow'
import { onAuthStateChange } from '../../lib/api/auth'
import { updateMyProfile } from '../../lib/api/profile'
import type { ExportedData, Me } from '../../lib/api/types'
import { queryKeys } from '../../lib/queryKeys'
import { changeLanguage, contentLocale, currentLanguage, ensureNamespaces, type Language } from '../../lib/i18n'
import { AppError, toAppError } from '../../lib/errors'
import { onThemeChange, readThemePreference, setThemePreference, type ThemePreference } from '../../lib/theme'
import { clearAccountDeviceState, isOfflineFeedEnabled, queryClient, setOfflineFeedEnabled, signOutEverywhere } from '../../lib/query'
import { Button, IconTile, LargeTitle, Page, Segmented, Skeleton, Switch, TextField, TopBar, useBunniesShown, useReducedMotionPref } from '../../ui'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { AuthError, useOnline, usePageTitle } from '../auth/shared'
import { GlyphPerson } from '../nav/glyphs'
import {
  GlyphBolt,
  GlyphDocument,
  GlyphDownload,
  GlyphHelp,
  GlyphInfo,
  GlyphLanguage,
  GlyphLogout,
  GlyphMail,
  GlyphMoon,
  GlyphShield,
  GlyphTrash,
} from './glyphs'
import { bannerOf } from '../lists/banners'
import { reportProfileName } from '../nav/useMyName'
import { ProfileBar, ProfileHero, useProfileCollapse } from './ProfileHeader'
import { SettingsAnchorRow, SettingsButtonRow, SettingsControlRow, SettingsGroup, SettingsLinkRow, SettingsRow } from './settingsParts'
import { RenameNameSheet } from './RenameNameSheet'
import { patchCachedName } from './meCache'
import { PrivacySettings } from './PrivacySettings'
import { AppIconPicker } from './AppIconPicker'
import { paradeTaps } from './paradeTaps'
import { ComicProfileRow } from '../comic/ComicProfileRow'
import { SammlungRow } from '../sammlung/SammlungRow'
import './settings.css'

// the banner and avatar sheets (Felix 24.10) are lazy chunks; the `lists` strings they speak load with them
const BannerSheet = lazy(() => Promise.all([import('../lists/BannerSheet'), ensureNamespaces('lists')]).then(([mod]) => mod))
const AvatarSheet = lazy(() => Promise.all([import('../profilePhotos/AvatarSheet'), ensureNamespaces('lists')]).then(([mod]) => mod))
// «Парад» (Felix 26.10): the tower easter egg is its own lazy chunk, fetched on the 5th tap only (paradeTaps.ts)
const TowerMoment = lazy(() => import('../mascot-ui/TowerMoment'))
// «Язык списком» (Felix 27.10): the language list is a lazy sheet too, fetched on the first tap of "Sprache"
const LanguageSheet = lazy(() => import('./LanguageSheet'))

// S11–S13 account self-service (legal-pilot.md 1.5–1.7). Wave 1 (K11): the settings ARE the Profil tab —
// one screen, Telegram-style: a big profile header that collapses into the bar, then grouped frosted
// sections with coloured icon tiles. Export and delete open as pushed screens. Only the presentation
// changed: every function, the account boundary (a changed account stops every action and drops a
// ready export), export / delete online-only, the exact deletion word and sign-out everywhere are as before.

function useAccountBoundary(userId: string, onInvalidated?: () => void) {
  const alive = useRef(false)
  const [changed, setChanged] = useState(false)
  useEffect(() => {
    alive.current = true
    const stop = onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) {
        alive.current = false
        onInvalidated?.()
        setChanged(true)
      }
    })
    return () => { alive.current = false; stop() }
  }, [userId, onInvalidated])
  return { changed, isCurrent: useCallback(() => alive.current, []) }
}

/**
 * Back to the screen the page was opened from: the Profil tab, or the sign-up step's account links
 * (/welcome/profile — a person who has not finished signing up must land there again, not on the Profil tab,
 * QA ACCOUNT-4). Opened directly (no in-app history): the Profil tab.
 */
function useAccountBack(): () => void {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const navigate = useNavigate()
  return () => {
    if (canGoBack) router.history.back()
    else void navigate({ to: '/settings' })
  }
}

/** A pushed sub-page of the Profil tab: back to where it came from, a large title, a frosted intro card. */
function AccountPage({ title, intro, icon, tone, children }: { title: string; intro: ReactNode; icon: ReactNode; tone: string; children: ReactNode }) {
  const { t } = useTranslation('settings')
  const back = useAccountBack()
  usePageTitle(title)
  return <Page topBar={<TopBar large title={title} back={{ label: t('common.back'), onClick: back }} />}>
    <div className="flex flex-col gap-6 pt-4">
      <LargeTitle className="mb-0">{title}</LargeTitle>
      <div className="set-intro glass-panel">
        <span aria-hidden="true" className="set-intro-icon" style={{ backgroundColor: tone, backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,.28), rgba(255,255,255,0) 60%)' }}>{icon}</span>
        {intro}
      </div>
      {children}
    </div>
  </Page>
}

export function ExportPage({ userId }: { userId: string }) {
  const { t } = useTranslation('settings')
  const online = useOnline()
  const [data, setData] = useState<ExportedData | null>(null)
  const clearData = useCallback(() => setData(null), [])
  const { changed, isCurrent } = useAccountBoundary(userId, clearData)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  /** the file name of the download this page started (for the confirmation line) */
  const [saved, setSaved] = useState<string | null>(null)
  const working = useRef(false)
  const ready = data !== null && !changed

  async function build() {
    if (!online || changed || working.current) return
    working.current = true
    setBusy(true)
    setData(null)
    setSaved(null)
    setError(null)
    try {
      // the own photos with their bytes come from their own RPCs: occasion covers (lib/api/photos.ts), wish photos,
      // list covers and my profile / banner photo (a server without one of them simply has none: [])
      // + the bring-along list (features/potluck) while it is released
      // + the in-app invitations (features/invitations) while they are released
      const [result, covers, wishPhotos, listPhotos, profilePhotos, potluck, invitations, push, calendarFeed, inviteEmail] = await Promise.all([
        exportMyData(userId), exportMyOccasionPhotos(userId), exportMyWishPhotos(userId), exportMyListPhotos(userId), exportMyProfilePhotos(userId),
        potluckEnabled() ? exportMyPotluck(userId) : Promise.resolve(null),
        invitesEnabled() ? exportMyInvitations(userId) : Promise.resolve(null),
        // + the push devices and preference (features/push) while Web Push is released
        pushEnabled() ? exportMyPush(userId) : Promise.resolve(null),
        // + the Kalender-Abo's status (features/calendarFeed; never the address) while it is released
        calendarFeedEnabled() ? exportMyCalendarFeed(userId) : Promise.resolve(null),
        // + the invitation e-mail opt-in (features/inviteEmail; never the address) while it is released
        inviteEmailEnabled() ? exportMyInviteEmail(userId) : Promise.resolve(null),
      ])
      if (isCurrent()) setData(withInviteEmail(withCalendarFeed(withPush(withInvitations(withPotluck(withProfilePhotos(withListPhotos(withWishPhotos(withOccasionPhotos(result, covers), wishPhotos), listPhotos), profilePhotos), potluck), invitations), push), calendarFeed), inviteEmail))
    } catch (err) { if (isCurrent()) setError(toAppError(err)) }
    finally { working.current = false; if (isCurrent()) setBusy(false) }
  }

  async function download() {
    if (!data || !online || changed || working.current) return
    working.current = true
    setBusy(true)
    try {
      await assertCurrentAccount(userId)
      if (isCurrent()) {
        const file = exportFilename()
        downloadJson(data, file)
        setSaved(file)
      }
    } catch (err) {
      if (isCurrent()) { setData(null); setSaved(null); setError(toAppError(err)) }
    } finally { working.current = false; if (isCurrent()) setBusy(false) }
  }

  // Once the file is built, the obvious next step is the download: it takes the primary look, "Datei erstellen"
  // steps back to secondary (a rebuild stays possible), and a line says what happened (QA ACCOUNT-11).
  return <AccountPage title={t('export.title')} tone="var(--icon-sage)" icon={<GlyphDownload size={26} />} intro={<>
    <p className="t-body text-text">{t('export.intro')}</p>
    <p className="t-footnote text-text-2">{t('export.scope')}</p>
  </>}>
    <AuthError error={changed ? new AppError('session_expired') : error} />
    {!online ? <p role="status">{t('common.offline_short')}</p> : null}
    <div className="flex flex-col gap-3">
      <Button fullWidth size="lg" variant={ready ? 'secondary' : 'primary'} disabled={!online || changed} loading={busy && !ready} loadingLabel={t('export.building')} onClick={() => { void build() }}>{t('export.build')}</Button>
      {ready ? <Button fullWidth size="lg" disabled={!online || busy} onClick={() => { void download() }}>{t('export.download')}</Button> : null}
      {ready ? <p role="status" className="text-center t-footnote text-text-2">{saved ? t('export.download_started', { file: saved }) : t('export.ready')}</p> : null}
    </div>
  </AccountPage>
}

export function DeletePage({ userId }: { userId: string }) {
  const { t } = useTranslation('settings')
  const online = useOnline()
  const { changed, isCurrent } = useAccountBoundary(userId)
  const back = useAccountBack()
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const working = useRef(false)
  const confirmation = t('delete.word')
  const ready = word.trim().toLocaleUpperCase(currentLanguage()) === confirmation.toLocaleUpperCase(currentLanguage()) && online && !changed && !done
  // «Pompons Sammlung» survives a sign-out on purpose — it goes with the account (features/sammlung/key.ts). Fetched
  // with this page (a tiny chunk; long before the deletion word is typed), so the Profil screen's preload list stays short.
  const forgetSammlung = useRef<(accountId: string) => void>(() => undefined)
  useEffect(() => {
    void import('../sammlung/key').then((m) => { forgetSammlung.current = m.forgetSammlung }, () => undefined)
  }, [])

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    try {
      await deleteMyAccount({ expectedUserId: userId, onDeleted: (accountId) => forgetSammlung.current(accountId) })
      if (isCurrent()) setDone(true)
    } catch (err) { if (isCurrent()) { setError(toAppError(err)); working.current = false } }
    finally { if (isCurrent()) setBusy(false) }
  }

  return <AccountPage title={t('delete.title')} tone="var(--icon-rose)" icon={<GlyphTrash size={26} />} intro={<p className="t-body text-text">{t('delete.intro')}</p>}>
    <form onSubmit={(event) => { void remove(event) }} className="flex flex-col gap-5">
      <TextField label={t('delete.type_word', { word: confirmation })} autoComplete="off" spellCheck={false}
        value={word} disabled={busy || done || changed} onChange={(event) => setWord(event.target.value)} />
      <AuthError error={changed ? new AppError('session_expired') : error} />
      {!online ? <p role="status">{t('common.offline_short')}</p> : null}
      {done ? <p role="status">{t('delete.done')}</p> : null}
      <Button type="submit" fullWidth size="lg" variant="destructive" disabled={!ready} loading={busy} loadingLabel={t('delete.deleting')}>{t('delete.confirm')}</Button>
    </form>
    {/* "Abbrechen" = back to where the page was opened from (the Profil tab or the sign-up step) */}
    <Button fullWidth size="lg" variant="secondary" disabled={busy} onClick={back}>{t('common.cancel')}</Button>
  </AccountPage>
}

/** The motion card's top edge inside its section (caption line + gap) and the bunny host above it. */
const MOTION_CARD_TOP_PX = 26
const SETTINGS_BUNNY_PX = 120

export interface SettingsPageProps {
  userId: string
  /**
   * SLOT for the motion settings ("Animationen · Kaninchen · Akku", agent D's src/motion/MotionSettingsSection.tsx;
   * agent E mounts it from routes/_authed/settings.tsx). Rendered right after "Darstellung"; build it from
   * ./settingsParts (SettingsGroup + rows + ui/IconTile) so it looks like its neighbours.
   */
  motionSection?: ReactNode
}

/** The device's theme choice (lib/theme.ts), re-read after every theme change (this tab, another tab, the system). */
function useThemePreference(): ThemePreference {
  return useSyncExternalStore(onThemeChange, readThemePreference, () => 'system')
}

/** The choices of "Farbschema", in this order (settings.css .theme-swatch draws each one). */
const THEME_CHOICES: readonly ThemePreference[] = ['system', 'light', 'dark', 'navy', 'ocean', 'black']

/** The profile's sheets that open from a row or the header (lazy chunks, mounted on first use). */
type ProfileSheet = 'banner' | 'avatar' | 'language'

type AccountDetails = Awaited<ReturnType<typeof getAccountDetails>>

/** My account's details on the Profil tab (get_me + e-mail + sign-in method): memory only, one entry per account. */
export const accountDetailsKey = (userId: string) => ['account', userId] as const

function accountDetailsQuery(userId: string) {
  return {
    queryKey: accountDetailsKey(userId),
    queryFn: () => getAccountDetails(userId),
    staleTime: 30_000,
    // one small entry of the signed-in account: a later visit never starts empty again (the account boundary clears it)
    gcTime: Infinity,
    // as before: one try — offline or failing, the screen says so at once (with "Erneut versuchen")
    retry: false,
    networkMode: 'always' as const,
  }
}

/** The cached get_me of `userId` (the _authed guard keeps it), if it is this account's. */
function cachedOwnMe(userId: string): Me | undefined {
  const me = queryClient.getQueryData<Me>(queryKeys.me())
  return me?.profile?.id === userId ? me : undefined
}

export function SettingsPage({ userId, motionSection }: SettingsPageProps) {
  const { t } = useTranslation('settings')
  const themePref = useThemePreference()
  const online = useOnline()
  const reduced = useReducedMotionPref()
  const bunnies = useBunniesShown()
  const { changed, isCurrent } = useAccountBoundary(userId)
  const [error, setError] = useState<AppError | null>(null)
  const [busy, setBusy] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  // the banner / avatar / language sheet (mounted on first use, kept for their closing animation)
  const [sheet, setSheet] = useState<ProfileSheet | null>(null)
  const [sheetsMounted, setSheetsMounted] = useState<ReadonlySet<ProfileSheet>>(() => new Set())
  if (sheet && !sheetsMounted.has(sheet)) setSheetsMounted(new Set([...sheetsMounted, sheet]))
  const [offline, setOffline] = useState(isOfflineFeedEnabled)
  const working = useRef(false)
  // «Парад»: 5 quick taps on the version line → the bunnies' tower over the "Abmelden" card (a secret: no hint)
  const logoutCard = useRef<HTMLDivElement>(null)
  const [parade, setParade] = useState(0)
  usePageTitle(t('settings.title'))
  // Felix 31.10 «пропадает баннер, аватарка, имя, эл. почта, вход»: the details were asked for on every visit and the
  // screen stood empty until the answer came (300–600 ms on the preview — every time the tab came back). They live in
  // the query cache now (memory only, never on disk; cleared when the account ends, lib/query.ts): a return shows
  // them in its first frame and refreshes them quietly once stale — an identical answer changes nothing on screen
  // (structural sharing). A failed refresh keeps what is shown; only a first load that fails says so (as before).
  const account = useQuery(accountDetailsQuery(userId), queryClient)
  const details = changed ? undefined : account.data
  const loadError = account.error && !account.data && !changed ? toAppError(account.error) : null
  // the guard's own get_me of this account (the very answer the details carry): the header — banner, photo, name —
  // is there on the first visit too; only the e-mail and the sign-in method wait for the details
  const me = changed ? undefined : (details?.me ?? cachedOwnMe(userId))
  useEffect(() => {
    // the tab bar's avatar (when the guard's get_me cache is empty: this screen skips the consent check)
    if (account.data && isCurrent()) reportProfileName(userId, account.data.me.profile.display_name)
  }, [account.data, userId, isCurrent])
  const patchDetails = (patch: (current: AccountDetails) => AccountDetails) =>
    queryClient.setQueryData<AccountDetails>(accountDetailsKey(userId), (current) => (current ? patch(current) : current))

  async function language(next: Language) {
    if (changed || working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    const previous = currentLanguage()
    try {
      await changeLanguage(next)
      // the profile keeps a server language (DE / EN only): Russian and Ukrainian are stored as 'de', like their legal texts
      if (online) await updateMyProfile({ locale: contentLocale(next) }, userId)
    } catch (err) {
      if (isCurrent()) { await changeLanguage(previous); setError(toAppError(err)) }
    } finally { working.current = false; if (isCurrent()) setBusy(false) }
  }

  async function offlineFeed(enabled: boolean) {
    if (changed || working.current) return
    working.current = true
    try {
      await assertCurrentAccount(userId)
      if (!isCurrent()) return
      await setOfflineFeedEnabled(enabled)
      setOffline(isOfflineFeedEnabled())
      if (enabled && !isOfflineFeedEnabled()) setError(new AppError('generic'))
    } catch (err) { if (isCurrent()) setError(toAppError(err)) }
    finally { working.current = false }
  }

  async function logout() {
    if (changed || working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    // Web Push: this browser's subscription and what it shows go with the account — also offline (features/push/signOut.ts).
    // Only where the browser ever allowed notifications (nothing else to clean up, and no wait at all)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      await Promise.race([import('../push/signOut').then((m) => m.forgetPushOnThisDevice()), new Promise((done) => setTimeout(done, 1500))]).catch(() => undefined)
    }
    try {
      if (online) await signOutEverywhere({ expectedUserId: userId, redirectTo: '/' })
      else clearAccountDeviceState(userId, '/')
    } catch (err) { if (isCurrent()) { setError(toAppError(err)); setBusy(false); working.current = false } }
  }

  const shownError = changed ? new AppError('session_expired') : (error ?? loadError)
  const loading = !details && !loadError && !error && !changed
  const name = me ? (me.profile.display_name?.trim() || null) : null
  const email = details ? details.email : null
  const valueOf = (value: string | null | undefined, known: boolean = details !== undefined): ReactNode =>
    known ? (value ?? '—') : loading ? <Skeleton width={120} height={16} className="ml-auto" /> : '—'
  const contactConfigured = SUPPORT_EMAIL.includes('@')
  const glide = !reduced
  const collapse = useProfileCollapse(glide, name)
  // my banner and photos (20261024120000; a server without the migration sends no photo keys: "Das geht bald")
  const profile = me ? me.profile : null
  const banner = bannerOf(isBannerKey(profile?.banner) ? profile.banner : null, userId)
  const photo = profile?.photo ?? null
  const bannerPhoto = profile?.banner_photo ?? null
  const photosSupported = profile !== null && profile.photo !== undefined

  return <Page topBar={<ProfileBar barRef={collapse.bar} slotRef={collapse.barSlot} floatRef={collapse.float} glide={glide} name={name} seed={userId} photo={photo} />}>
    <ProfileHero heroRef={collapse.heroSlot} nameRef={collapse.heroName} glide={glide} name={name} seed={userId} loading={loading} title={t('settings.title')} editLabel={t('settings.change_name')}
      onEdit={() => { if (!changed) setRenameOpen(true) }} email={email ?? (loading ? <Skeleton width={180} height={14} className="mx-auto mt-1" /> : '—')}
      banner={banner} photo={photo} bannerPhoto={bannerPhoto}
      onBanner={() => { if (!changed) setSheet('banner') }} onAvatar={() => { if (!changed) setSheet('avatar') }} />
    {!changed && sheetsMounted.has('banner') ? <Suspense fallback={null}>
      <BannerSheet open={sheet === 'banner'} onClose={() => setSheet(null)} userId={userId} name={name} current={banner}
        photo={bannerPhoto} avatarPhoto={photo} photosSupported={photosSupported}
        onPresetApplied={(key) => {
          if (!isCurrent()) return
          patchDetails((current) => ({ ...current, me: { ...current.me, profile: { ...current.me.profile, banner: key } } }))
        }} />
    </Suspense> : null}
    {!changed && sheetsMounted.has('avatar') ? <Suspense fallback={null}>
      <AvatarSheet open={sheet === 'avatar'} onClose={() => setSheet(null)} userId={userId} name={name} photo={photo} supported={photosSupported} />
    </Suspense> : null}
    {!changed && sheetsMounted.has('language') ? <Suspense fallback={null}>
      <LanguageSheet open={sheet === 'language'} onClose={() => setSheet(null)} current={currentLanguage()} disabled={busy}
        offline={!online} onPick={(next) => { void language(next) }} />
    </Suspense> : null}
    {!changed ? <RenameNameSheet open={renameOpen} userId={userId} onClose={() => setRenameOpen(false)} onSaved={(savedName) => {
      if (!isCurrent()) return
      patchDetails((current) => ({ ...current, me: { ...current.me, profile: { ...current.me.profile, display_name: savedName } } }))
      reportProfileName(userId, savedName)
      // the tab bar's avatar reads the cached get_me first: give it the confirmed name now, not on the next tab
      patchCachedName(queryClient, userId, savedName)
      void account.refetch()
    }} /> : null}
    <div className="flex flex-col gap-7 pt-5">
      <AuthError error={shownError} />
      {shownError && !changed ? <Button variant="secondary" onClick={() => { setError(null); void account.refetch() }}>{t('common.retry')}</Button> : null}

      <SettingsGroup title={t('settings.account')}>
        <SettingsButtonRow onClick={() => setRenameOpen(true)} disabled={changed}
          icon={<IconTile tone="apricot"><GlyphPerson /></IconTile>} label={t('settings.name')} value={valueOf(me?.profile.display_name, me !== undefined)} />
        <SettingsRow icon={<IconTile tone="sky"><GlyphMail /></IconTile>} label={t('settings.email')} value={valueOf(details?.email)} />
        <SettingsRow icon={<IconTile tone="sage"><GlyphShield /></IconTile>} label={t('settings.login_method')} value={valueOf(details ? t(details.loginMethod === 'google' ? 'settings.login_google' : 'settings.login_email') : undefined)} />
      </SettingsGroup>

      <PrivacySettings userId={userId} disabled={changed} />

      <SettingsGroup title={t('settings.appearance')} footer={!online ? <span role="status">{t('settings.language_offline')}</span> : undefined}>
        {/* Felix 27.10 «выбор языка списком»: one row with the current language by its own name; a tap opens the list
            (LanguageSheet.tsx) — four chips in a grid would not grow with more languages */}
        <SettingsButtonRow onClick={() => setSheet('language')} disabled={busy || changed}
          icon={<IconTile tone="sage"><GlyphLanguage /></IconTile>} label={t('settings.language')}
          value={<span lang={currentLanguage()} data-language-name="">{t(`settings.lang_${currentLanguage()}`)}</span>} />
        {/* Felix 25.10: the theme of this device — System (default) · Hell · Dunkel · Blau · Ozean · Schwarz (27.10)
            (lib/theme.ts); no server, no account. Six words do not fit one row: each choice is a colour swatch (its name for screen
            readers), the chosen theme's name stands next to the title. */}
        <SettingsControlRow>
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <IconTile tone="lilac"><GlyphMoon /></IconTile>
              <span className="t-body text-text">{t('settings.theme')}</span>
              <span className="ml-auto t-subhead text-text-2" data-theme-name="">{t(`settings.theme_${themePref}`)}</span>
            </div>
            <Segmented label={t('settings.theme')} value={themePref}
              options={THEME_CHOICES.map((value) => ({ value, icon: <span className="theme-swatch" data-swatch={value} />, label: <span className="sr-only">{t(`settings.theme_${value}`)}</span> }))}
              onChange={(value) => { setThemePreference(value) }} />
            {/* "Schwarz" (Felix 27.10): one line on what it is good for (OLED) — only while it is chosen */}
            {themePref === 'black' ? <p className="t-footnote text-text-2">{t('settings.theme_black_hint')}</p> : null}
          </div>
        </SettingsControlRow>
        {/* Felix 27.10: the home-screen icon of this device (AppIconPicker.tsx; not in Telegram) */}
        <AppIconPicker />
      </SettingsGroup>

      {/* the motion settings (K9, src/motion/MotionSettingsSection.tsx) — and, once per visit, Pompon pops up
          over their card's right end: "Kaninchen zeigen" is right there (K8; never with it off or motion off).
          He fits into the free room between the cards (caption line + section gap), so no extra margin stays
          behind once he ducked away; the host clips only its bottom edge (behind the card), never his ears or
          cheeks at its sides (QA ACCOUNT-10). */}
      {motionSection ? (
        <div data-settings-slot="motion" className="relative">
          {bunnies ? (
            <BunnyMoment
              kind="pop-up"
              family="screen-host:profile"
              once="visit"
              onceKey="settings"
              minSize={42}
              maxSize={46}
              edgeInset={0}
              className="pointer-events-none absolute right-0 z-0"
              style={{ top: MOTION_CARD_TOP_PX - SETTINGS_BUNNY_PX, height: SETTINGS_BUNNY_PX, width: 112, clipPath: 'inset(-100% -100% 0 -100%)' }}
            />
          ) : null}
          <div className="relative z-1">{motionSection}</div>
        </div>
      ) : null}

      <SettingsGroup title={t('settings.on_this_device')}>
        <SettingsControlRow>
          <div className="set-switch">
            <IconTile tone="honey" className="self-start mt-0.5"><GlyphBolt /></IconTile>
            {/* the kit switch is a <label> around its text and the toggle: that whole part is the hit area */}
            <Switch className="min-w-0 flex-1" checked={offline} disabled={busy || changed} label={t('settings.offline_feed')}
              description={t('settings.offline_feed_hint')} onChange={(enabled) => { void offlineFeed(enabled) }} />
          </div>
        </SettingsControlRow>
        {/* Web Push: Benachrichtigungen on this device (features/push; nothing without VITE_PUSH or in Telegram) */}
        <PushSettingsRow userId={userId} disabled={changed} />
      </SettingsGroup>

      <SettingsGroup title={t('settings.data')}>
        {/* Kalender-Abo (features/calendarFeed, Felix 27.10): my occasions in Apple / Google / Outlook */}
        <CalendarFeedRow userId={userId} disabled={changed} />
        <SettingsLinkRow to="/settings/export" icon={<IconTile tone="sage"><GlyphDownload /></IconTile>} label={t('settings.export')} />
        <SettingsLinkRow to="/settings/delete" danger icon={<IconTile tone="rose"><GlyphTrash /></IconTile>} label={t('settings.delete_account')} />
      </SettingsGroup>

      {/* «Pompon & Tapsi – ihre Geschichte»: the comic's permanent home (features/comic, decided 26.10) */}
      <SettingsGroup title={t('about.title')}>
        <ComicProfileRow />
      </SettingsGroup>

      {/* «Pompons Sammlung» (features/sammlung, Felix 28.10): above «Rechtliches»; no bunnies, no collection */}
      {bunnies ? <SammlungRow userId={userId} /> : null}

      {/* signed in, this section replaces the legal footer of the screens before sign-in (pilot-decisions
          §00.2): the same three routes, one tap from the Profil tab */}
      <SettingsGroup title={t('settings.legal')}>
        <SettingsLinkRow to="/legal/impressum" icon={<IconTile tone="ink"><GlyphInfo /></IconTile>} label={t('settings.impressum')} />
        <SettingsLinkRow to="/legal/datenschutz" icon={<IconTile tone="lilac"><GlyphShield /></IconTile>} label={t('settings.privacy')} />
        <SettingsLinkRow to="/legal/nutzung" icon={<IconTile tone="sky"><GlyphDocument /></IconTile>} label={t('settings.terms')} />
      </SettingsGroup>

      <SettingsGroup title={t('settings.help')}>
        {contactConfigured
          ? <SettingsAnchorRow href={`mailto:${SUPPORT_EMAIL}`} icon={<IconTile tone="honey"><GlyphHelp /></IconTile>} label={t('settings.report')} />
          : <SettingsRow icon={<IconTile tone="ink"><GlyphHelp /></IconTile>} label={t('settings.contact')} hint={t('settings.contact_pending')} />}
      </SettingsGroup>

      <div className="relative flex flex-col items-center gap-3">
        {parade ? <Suspense fallback={null}><TowerMoment key={parade} cardRef={logoutCard} onEnd={() => setParade(0)} /></Suspense> : null}
        <div ref={logoutCard} className="glass-panel w-full rounded-[22px]">
          <button type="button" className="set-logout" disabled={changed || busy} aria-busy={busy || undefined} onClick={() => { void logout() }}>
            {busy ? <span aria-hidden="true" className="spinner" /> : <GlyphLogout size={20} />}
            {t('settings.logout')}
          </button>
        </div>
        {/* the very bottom: the pilot line of the former footer, with the app version */}
        <p data-pilot-line="" className="text-center t-caption-1 text-text-3 [text-wrap:balance]"
          onClick={() => { if (bunnies && !parade && paradeTaps.tap()) setParade((n) => n + 1) }}>
          {t('footer.pilot_badge')} · {t('settings.version', { version: APP_VERSION })}
        </p>
      </div>
    </div>
  </Page>
}
