import { Suspense, lazy, useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { APP_NAME, APP_URL } from '../../lib/app'
import { buildFollowUrl, createFollowLink, createFriendCode, peekFriendCode, revokeFollowLinks } from '../../lib/api/follows'
import { LIVE_LINK_LIMIT, FOLLOW_LINK_DAYS } from '../../lib/api/follows.types'
import { toAppError, type AppError } from '../../lib/errors'
import { FRIEND_CODE_LENGTH, formatFriendCode, isFriendCode, normalizeFriendCode } from '../../lib/friendCode'
import { feedback } from '../../lib/haptics'
import { canNativeShare, copyText, share, type ShareResult } from '../../lib/share'
import { formatDateTime, formatNumericDate } from '../../lib/time'
import { toast } from '../../lib/toast'
import { Button, IconCopy, IconShare, Segmented, Skeleton, TextField, useBunniesShown } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { Mascot, type MascotHandle } from '../mascot-ui/Mascot'
import { listsKeys, listsOverviewQuery } from '../lists/queries'
import { forgetFollowLink, rememberFollowLink, rememberedFollowLink, useRememberedFollowLink } from './followLinkMemory'
import { forgetFriendCode, rememberFriendCode, rememberedFriendCode, useRememberedFriendCode } from './friendCodeMemory'
import { friendCodesEnabled } from './codeFlag'
import type { FollowSheetTab } from './linkSheetHost'
import { peopleKeys, peopleScreenQuery } from './queries'
import './people.css'

// "Freunde hinzufügen" — the follow-link sheet (follows-design §2.9) with three tabs since 27.10
// (docs/spec/add-friends-design.md §2.1). Still no people search: every way only lets somebody ASK.
//   Link — "Link teilen" (the system sheet, else a copy), "Link kopieren", how long it is valid, the hint, the
//     advance warning at 5 live links, the toast after sharing. Always the plain https://<app>/f#… link — never a
//     t.me/…?startapp link (Felix 27.10: «открытие внутри Telegram не нужно» — somebody may not want Telegram). The
//     fresh code lives in this tab's memory per account (followLinkMemory.ts); a reload shares a NEW link and the old
//     ones keep working.
//   QR-Code — "Mein Code": a QR of https://<app>/f#<code> (drawn on the device, a lazy chunk) and the short code
//     K7M4-QX2P to read aloud; 24 hours; "Neuer Code" switches the old ones off. Created when the tab is shown (memory
//     per account, friendCodeMemory.ts). No camera of our own: the friend's phone camera reads it (design §2.3).
//   Code eingeben — somebody's short code → the same gate /f a link opens (name, photo, "Folgen anfragen").
// From Profil › Privatsphäre (`manage`) also "Alle Links deaktivieren" (links AND codes, 20261027160000).
// Profil's ONE row "Mein Code & Link" (Felix 27.10: «сделай это одним пунктом … главное QR-код, ссылка второстепенна»)
// opens it with `manage`: with the codes on there are two tabs, "Mein Code" · "Eingeben", and "Mein Code" shows the
// QR and the short code first and, below, a secondary section "Oder als Link" (share / copy / how long / "Alle Links
// deaktivieren"). A request for the Link tab lands there too. Without the codes it is the link alone, as before.
// Account boundary: a code created for this account is never remembered, shared or copied — no toast, no bunny —
// once the account ended in this tab (captureEpoch).

const QrImage = lazy(() => import('./qr/QrImage'))

export interface FollowLinkSheetProps {
  open: boolean
  onClose: () => void
  userId: string
  /** "Alle Links deaktivieren" too */
  manage?: boolean
  /** the tab an opening starts on (default: Link) */
  tab?: FollowSheetTab
}

export default function FollowLinkSheet({ open, onClose, userId, manage = false, tab: requestedTab = 'link' }: FollowLinkSheetProps) {
  const { t } = useTranslation('people')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const online = useOnline()
  const bunnies = useBunniesShown()
  const bunny = useRef<MascotHandle | null>(null)
  const remembered = useRememberedFollowLink(userId)
  const friendCode = useRememberedFriendCode(userId)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<'confirm' | 'busy' | null>(null)
  const working = useRef(false)
  const [checkedAt, setCheckedAt] = useState(Date.now)
  // every opening starts on the tab it was asked for (the host keeps this sheet mounted between openings); without
  // the codes' flag (codeFlag.ts) there is only the link
  const codesOn = friendCodesEnabled()
  const [chosenTab, setTab] = useState<FollowSheetTab>(requestedTab)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setTab(requestedTab)
  }
  // Profil's "Mein Code & Link": the link is a section of "Mein Code", not a tab of its own
  const merged = manage && codesOn
  const tab: FollowSheetTab = !codesOn ? 'link' : merged && chosenTab === 'link' ? 'code' : chosenTab
  useEffect(() => {
    if (!open) return
    const initial = setTimeout(() => setCheckedAt(Date.now()), 0)
    const timer = setInterval(() => setCheckedAt(Date.now()), 1_000)
    return () => { clearTimeout(initial); clearInterval(timer) }
  }, [open])

  // Observe the cached overview without another lists request. An invalidated/old overview cannot hide
  // a fresher count from the people screen (for example after revoking or creating links elsewhere).
  const overview = useQuery({ ...listsOverviewQuery(userId), enabled: false, notifyOnChangeProps: 'all' })
  const overviewUsable = overview.data?.me.id === userId && overview.isSuccess
    && !queryClient.getQueryState(listsKeys.overview())?.isInvalidated && checkedAt - overview.dataUpdatedAt < 30_000
  const people = useQuery({ ...peopleScreenQuery(userId), enabled: open && !overviewUsable, staleTime: 30_000 })
  const liveLinks = people.data && (!overviewUsable || people.dataUpdatedAt > overview.dataUpdatedAt)
    ? people.data.links.length : overviewUsable ? overview.data?.me.live_links ?? null : null
  const willRetireOldest = remembered === null && liveLinks !== null && liveLinks >= LIVE_LINK_LIMIT
  // the day a link created now would end (the server sets exactly now + 30 days)
  const [expectedUntil] = useState(() => new Date(Date.now() + FOLLOW_LINK_DAYS * 86_400_000).toISOString())
  const shareText = t('people.link.share_text', { app: APP_NAME })

  function refreshCounts() {
    void queryClient.invalidateQueries({ queryKey: listsKeys.overview() }).catch(() => undefined)
    void queryClient.invalidateQueries({ queryKey: peopleKeys.screen() }).catch(() => undefined)
  }

  /** Share or copy the remembered link — or create one first (the server answers once, then the code lives here). */
  async function handOut(kind: 'share' | 'copy') {
    if (working.current) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    working.current = true
    try {
      let link = rememberedFollowLink(userId)
      if (!link) {
        if (!online) return
        setCreating(true)
        try {
          const created = await createFollowLink(userId)
          if (!epoch.isCurrent()) return // never remember, share or copy a code for an account that ended here
          link = { url: buildFollowUrl(created.token), expiresAt: created.expires_at }
          rememberFollowLink(userId, link)
          refreshCounts()
        } catch (err) {
          if (!epoch.isCurrent()) return
          const error = toAppError(err)
          feedback('error')
          toast.error(t(error.key, error.params))
          return
        } finally {
          if (epoch.isCurrent()) setCreating(false)
        }
      }
      const url = link.url
      const result: ShareResult = kind === 'share'
        ? await share({ title: t('people.link.share_title'), text: shareText, url })
        : (await copyText(url)) ? 'copied' : 'failed'
      if (!epoch.isCurrent()) return
      if (result === 'shared' || result === 'copied') {
        // their own follow link is out: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
        void import('../sammlung/note').then((m) => m.noteMilestone('friends'), () => undefined)
        feedback('success')
        toast.success(t('people.link.shared_toast'))
        void bunny.current?.play('jump')
      } else if (result === 'failed') toast.error(t('people.link.copy_failed'))
    } finally {
      working.current = false
    }
  }

  async function revokeAll() {
    if (revoking === 'busy') return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    setRevoking('busy')
    try {
      await revokeFollowLinks(userId)
      if (!epoch.isCurrent()) return
      forgetFollowLink(userId)
      forgetFriendCode(userId) // the server switched the codes off too
      feedback('success')
      toast.info(t('people.link.revoked'))
      setRevoking(null)
      refreshCounts()
    } catch (err) {
      if (!epoch.isCurrent()) return
      const error = toAppError(err)
      toast.error(t(error.key, error.params))
      setRevoking('confirm')
    }
  }

  // ---- QR-Code: "Mein Code" -----------------------------------------------------------------------------------
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeError, setCodeError] = useState<AppError | null>(null)
  const codeWorking = useRef(false)

  const makeCode = useCallback(async (replace: boolean) => {
    if (codeWorking.current || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    codeWorking.current = true
    setCodeBusy(true)
    setCodeError(null)
    try {
      const created = await createFriendCode(replace, userId)
      if (!epoch.isCurrent()) return
      rememberFriendCode(userId, { code: created.code, expiresAt: created.expires_at })
      // their own friend code: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
      void import('../sammlung/note').then((m) => m.noteMilestone('friends'), () => undefined)
      if (replace) {
        feedback('success')
        toast.info(t('people.code.renewed'))
      }
    } catch (err) {
      if (!epoch.isCurrent()) return
      setCodeError(toAppError(err))
    } finally {
      codeWorking.current = false
      if (epoch.isCurrent()) setCodeBusy(false)
    }
  }, [online, t, userId])

  // the QR tab shows a code at once: created when it is shown and none is remembered (one try per showing)
  const autoTried = useRef(false)
  useEffect(() => {
    if (!open || tab !== 'code') {
      autoTried.current = false
      return
    }
    if (friendCode || autoTried.current || !online) return
    autoTried.current = true
    void makeCode(false)
  }, [open, tab, friendCode, online, makeCode])

  async function copyCode() {
    const code = rememberedFriendCode(userId)
    if (!code) return
    if (await copyText(formatFriendCode(code.code))) {
      feedback('success')
      toast.success(t('people.code.copied'))
    } else toast.error(t('people.link.copy_failed'))
  }

  // ---- Code eingeben ------------------------------------------------------------------------------------------
  const formId = useId()
  const [typed, setTyped] = useState('')
  const [enterError, setEnterError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  async function submitCode(event?: FormEvent) {
    event?.preventDefault()
    if (checking) return
    const code = normalizeFriendCode(typed)
    if (!isFriendCode(code)) {
      setEnterError(t('people.enter.shape', { count: FRIEND_CODE_LENGTH }))
      return
    }
    if (!online) {
      setEnterError(t('errors.offline_action'))
      return
    }
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    setChecking(true)
    setEnterError(null)
    try {
      await peekFriendCode(code, userId)
      if (!epoch.isCurrent()) return
      // the same gate a link opens: name, photo, the three facts and the explicit "Folgen anfragen"
      onClose()
      setTyped('')
      void navigate({ to: '/f', hash: code })
    } catch (err) {
      if (!epoch.isCurrent()) return
      const error = toAppError(err)
      feedback('error')
      setEnterError(error.code === 'invite_invalid' ? t('people.enter.invalid') : t(error.key, error.params))
    } finally {
      if (epoch.isCurrent()) setChecking(false)
    }
  }

  const native = canNativeShare()
  const linkDisabled = !online && !remembered

  // ---- pieces shared by the tabs and Profil's merged "Mein Code" -----------------------------------------------
  const linkFacts = (
    <>
      {remembered ? (
        <div className="flex flex-col gap-2">
          <TextField label={t('people.link.field')} value={remembered.url} readOnly onFocus={(event) => event.currentTarget.select()} />
          <p className="pp-valid">{t('people.link.valid_until', { date: formatNumericDate(remembered.expiresAt) })}</p>
        </div>
      ) : (
        <p className="pp-valid">{t('people.link.valid_new', { days: FOLLOW_LINK_DAYS, date: formatNumericDate(expectedUntil) })}</p>
      )}
      {willRetireOldest ? <p role="note" className="pp-warning">{t('people.link.five_links', { max: LIVE_LINK_LIMIT })}</p> : null}
      {manage && liveLinks !== null ? (
        <p className="pp-valid">{liveLinks > 0 ? t('people.link.live_count', { count: liveLinks }) : t('people.link.none_live')}</p>
      ) : null}
    </>
  )
  const revokeButton = manage ? (
    <Button size="md" fullWidth variant="ghost" disabled={!online || liveLinks === 0} className="text-danger"
      onClick={() => setRevoking('confirm')}>
      {t('people.link.revoke_all')}
    </Button>
  ) : null
  const codeView = (
    <div className="pp-code">
      <div className="pp-qr-frame">
        {friendCode ? (
          <Suspense fallback={<Skeleton width={208} height={208} rounded="lg" />}>
            <QrImage value={`${APP_URL}/f#${friendCode.code}`} label={t('people.code.qr_label', { code: formatFriendCode(friendCode.code) })} />
          </Suspense>
        ) : codeError ? null : (
          <Skeleton width={208} height={208} rounded="lg" />
        )}
      </div>
      {friendCode ? (
        <>
          <p className="pp-code-text" aria-label={t('people.code.code_label', { code: friendCode.code.split('').join(' ') })}>
            {formatFriendCode(friendCode.code)}
          </p>
          <p className="pp-valid text-center">{t('people.code.valid_until', { date: formatDateTime(friendCode.expiresAt) })}</p>
        </>
      ) : null}
      {codeError ? (
        <div role="alert" className="flex flex-col items-center gap-2 text-center">
          <p className="t-body text-text-2">{t(codeError.key, codeError.params)}</p>
          <Button size="sm" variant="secondary" onClick={() => void makeCode(false)}>{t('common.retry')}</Button>
        </div>
      ) : null}
      <p className="t-subhead text-text-2 text-center [text-wrap:balance]">{t('people.code.hint', { app: APP_NAME })}</p>
    </div>
  )
  const copyCodeButton = (size: 'lg' | 'md') => (
    <Button size={size} fullWidth variant="secondary" icon={<IconCopy />} disabled={!friendCode} onClick={() => void copyCode()}>
      {t('people.code.copy')}
    </Button>
  )
  const renewButton = (
    <Button size="md" fullWidth variant="ghost" disabled={!online || codeBusy} loading={codeBusy && friendCode !== null}
      loadingLabel={t('people.code.creating')} onClick={() => void makeCode(true)}>
      {t('people.code.renew')}
    </Button>
  )

  const footer = tab === 'link' ? (
    <div className="flex flex-col gap-2">
      {native ? (
        <Button size="lg" fullWidth icon={<IconShare />} disabled={linkDisabled} loading={creating}
          loadingLabel={t('people.link.creating')} onClick={() => void handOut('share')}>
          {t('people.link.share')}
        </Button>
      ) : null}
      <Button size="lg" fullWidth variant={native ? 'secondary' : 'primary'} icon={<IconCopy />} disabled={linkDisabled}
        loading={!native && creating} loadingLabel={t('people.link.creating')} onClick={() => void handOut('copy')}>
        {t('people.link.copy')}
      </Button>
      {revokeButton}
    </div>
  ) : tab === 'code' ? (
    // the merged "Mein Code" keeps its buttons next to what they act on (the code first, the link below)
    merged ? undefined : (
      <div className="flex flex-col gap-2">
        {copyCodeButton('lg')}
        {renewButton}
      </div>
    )
  ) : (
    <Button type="submit" form={formId} size="lg" fullWidth loading={checking} loadingLabel={t('people.enter.checking')}
      disabled={normalizeFriendCode(typed).length === 0}>
      {t('people.enter.submit')}
    </Button>
  )

  return (
    <>
      <Sheet
        open={open && revoking === null}
        onClose={onClose}
        title={t('people.add.title')}
        closeLabel={t('common.close')}
        footer={footer}
      >
        <div className="pp-sheet">
          {codesOn ? (
            <Segmented<FollowSheetTab>
              label={t('people.add.tabs')}
              value={tab}
              onChange={setTab}
              options={merged ? [
                { value: 'code', label: t('people.add.tab_mine') },
                { value: 'enter', label: t('people.add.tab_enter') },
              ] : [
                { value: 'link', label: t('people.add.tab_link') },
                { value: 'code', label: t('people.add.tab_code') },
                { value: 'enter', label: t('people.add.tab_enter') },
              ]}
            />
          ) : null}
          {tab === 'link' ? (
            <>
              {bunnies ? (
                <div className="pp-mascot">
                  <Mascot kind="bunny" size="s" ref={bunny} />
                </div>
              ) : null}
              <p className="t-body text-text">{t('people.link.hint')}</p>
              {linkFacts}
            </>
          ) : tab === 'code' && merged ? (
            <>
              {codeView}
              <div className="pp-pair" data-code-actions="">
                {copyCodeButton('md')}
                {renewButton}
              </div>
              {/* the link: secondary, under the code (Felix 27.10) */}
              <section className="pp-link-section" aria-labelledby={`${formId}-link`} data-link-section="">
                <h3 id={`${formId}-link`} className="t-headline text-text">{t('people.link.section')}</h3>
                <p className="t-subhead text-text-2">{t('people.link.hint')}</p>
                {linkFacts}
                <div className="pp-pair">
                  {native ? (
                    <Button size="md" fullWidth variant="secondary" icon={<IconShare />} disabled={linkDisabled} loading={creating}
                      loadingLabel={t('people.link.creating')} onClick={() => void handOut('share')}>
                      {t('people.link.share')}
                    </Button>
                  ) : null}
                  <Button size="md" fullWidth variant="secondary" icon={<IconCopy />} disabled={linkDisabled}
                    loading={!native && creating} loadingLabel={t('people.link.creating')} onClick={() => void handOut('copy')}>
                    {t('people.link.copy')}
                  </Button>
                </div>
                {revokeButton}
              </section>
            </>
          ) : tab === 'code' ? (
            codeView
          ) : (
            <form id={formId} className="flex flex-col gap-3" onSubmit={(event) => void submitCode(event)} noValidate>
              <p className="t-body text-text">{t('people.enter.lead')}</p>
              <TextField
                label={t('people.enter.label')}
                value={typed}
                placeholder={t('people.enter.placeholder')}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={16}
                inputClassName="pp-code-input"
                error={enterError ?? undefined}
                hint={enterError ? undefined : t('people.enter.hint')}
                onChange={(event) => {
                  setTyped(event.currentTarget.value.toUpperCase())
                  if (enterError) setEnterError(null)
                }}
              />
            </form>
          )}
          {!online ? <p role="status" className="pp-valid">{t('errors.offline_action')}</p> : null}
        </div>
      </Sheet>
      <Confirm
        open={open && revoking !== null}
        destructive
        title={t('people.link.revoke_title')}
        message={t('people.link.revoke_message')}
        confirmLabel={t('people.link.revoke_confirm')}
        cancelLabel={t('common.cancel')}
        loading={revoking === 'busy'}
        onConfirm={() => void revokeAll()}
        onCancel={() => {
          if (revoking !== 'busy') setRevoking(null)
        }}
      />
    </>
  )
}
