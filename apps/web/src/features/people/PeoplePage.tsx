import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { BlockedEntry, FollowerEntry, FollowingEntry, IncomingRequest, OutgoingRequest } from '../../lib/api/follows.types'
import { toAppError } from '../../lib/errors'
import { formatDate } from '../../lib/time'
import { Button, IconButton, IconForward, IconMore, LargeTitle, List, ListRow, ListRowContent, Page, Skeleton, SkeletonList, TopBar, fade, haptic, listItemClass, listRowClass, useReducedMotionPref } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { useOnline, usePageTitle } from '../auth/shared'
import { ProfileAvatar } from '../nav/ProfileAvatar'
import { AvatarPhoto } from '../profilePhotos/PersonPhoto'
import { usePeopleActions } from './actions'
import { AcceptSheet, type AcceptRequest } from './AcceptSheet'
import { BlockSheet, type BlockTarget } from './BlockSheet'
import { GlyphFollowLink } from './glyphs'
import { FollowLinkSheetHost, openFollowLinkSheet } from './linkSheetHost'
import { RelationChip, useAgo, useReportHref, useRequestContext } from './parts'
import { usePendingDeclines } from './pendingDeclines'
import { patchFollowRequestCount, usePeopleScreen } from './queries'
import './people.css'

// "Follower & Anfragen" `/people` (follows-design §2.10) — an OWNER module: MY relations only, ONE RPC
// (get_people_screen). Sections: Anfragen (requests VISIBLE to me: name, "vor 2 Tagen", the context line —
// "Gemeinsam in …" → "Du folgst {{name}}" / "Du hast {{name}} angefragt" → highlighted "Kennst du {{name}}
// persönlich?"; [Annehmen] + ⋯ Ablehnen · Ablehnen und blockieren · Melden) · Follower ("Auch folgen") · Du
// folgst · Angefragt (my own requests, the same whatever the other side did: "Zurückziehen") · Blockiert
// ("Aufheben" gives nothing back). Nothing here is about reservations; the removal text is static (S9).
// It never imports reservation code or lib/queries (W01, secrecy.test.ts).

export type PeopleSection = 'requests' | 'blocked'

export interface PeoplePageProps {
  userId: string
  /** opened for one section ("2 Anfragen ›", Profil › "Blockierte Personen"): it comes into view */
  section?: PeopleSection
}

type Menu =
  | { kind: 'request'; entry: IncomingRequest }
  | { kind: 'follower'; entry: FollowerEntry }
  | null

export function PeoplePage({ userId, section }: PeoplePageProps) {
  const { t } = useTranslation('people')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const reduced = useReducedMotionPref()
  const query = usePeopleScreen(userId)
  const actions = usePeopleActions(userId)
  const declines = usePendingDeclines()
  const title = t('people.screen.title')
  usePageTitle(title)

  const [menu, setMenu] = useState<Menu>(null)
  const [accept, setAccept] = useState<{ open: boolean; request: AcceptRequest | null }>({ open: false, request: null })
  const [block, setBlock] = useState<{ open: boolean; target: BlockTarget | null }>({ open: false, target: null })
  const [remove, setRemove] = useState<FollowerEntry | null>(null)
  const [unblock, setUnblock] = useState<BlockedEntry | null>(null)
  const [busy, setBusy] = useState(false)

  const screen = query.data
  const requests = screen?.requests_in.filter((entry) => !declines.has(entry.profile.id)) ?? []

  // the screen saw the server's truth: the request dot (get_me.inbox) follows without a request of its own
  const seen = screen?.requests_in.length
  useEffect(() => {
    if (seen !== undefined) patchFollowRequestCount(queryClient, userId, () => seen)
  }, [seen, queryClient, userId])

  // "2 Anfragen ›" / "Blockierte Personen": the section comes into view once the data is there
  const scrolled = useRef(false)
  useEffect(() => {
    if (!section || !screen || scrolled.current) return
    scrolled.current = true
    const frame = requestAnimationFrame(() => {
      document.getElementById(`people-${section}`)?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [section, screen, reduced])

  function back() {
    if (canGoBack) router.history.back()
    else void navigate({ to: '/lists', replace: true })
  }

  async function run(task: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }

  function nameOf(display: string | null): string {
    return display?.trim() || t('people.card.name_fallback')
  }

  function openBlock(target: BlockTarget) {
    setMenu(null)
    setAccept((state) => ({ ...state, open: false }))
    setBlock({ open: true, target })
  }

  const loadError = query.isError && !screen ? toAppError(query.error) : null

  return (
    <Page topBar={<TopBar large title={title} back={{ label: t('common.back'), onClick: back }} />}>
      <div className="flex flex-col gap-7 pt-4">
        <LargeTitle className="mb-0">{title}</LargeTitle>
        <LinkCard count={screen?.links.length ?? null} />

        {loadError ? (
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="t-headline text-text">{t('people.screen.load_failed')}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>{t('common.retry')}</Button>
          </div>
        ) : !screen ? (
          <PeopleSkeleton />
        ) : (
          <m.div className="flex flex-col gap-7" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
            <Section id="people-requests" title={t('people.screen.requests')} count={requests.length} empty={t('people.screen.requests_empty')}>
              {requests.map((entry) => (
                <RequestRow key={entry.profile.id} entry={entry}
                  onAccept={() => setAccept({ open: true, request: entry })}
                  onMenu={() => setMenu({ kind: 'request', entry })} />
              ))}
            </Section>

            <Section title={t('people.screen.followers')} count={screen.followers.length} empty={t('people.screen.followers_empty')}>
              {screen.followers.map((entry) => (
                <FollowerRow key={entry.profile.id} entry={entry} busy={busy}
                  onFollow={() => void run(() => actions.request(entry.profile.id, nameOf(entry.profile.display_name)))}
                  onMenu={() => setMenu({ kind: 'follower', entry })} />
              ))}
            </Section>

            <Section title={t('people.screen.following')} count={screen.following.length} empty={t('people.screen.following_empty')}>
              {screen.following.map((entry) => <FollowingRow key={entry.profile.id} entry={entry} />)}
            </Section>

            {screen.requests_out.length > 0 ? (
              <Section title={t('people.screen.outgoing')} count={screen.requests_out.length}>
                {screen.requests_out.map((entry) => (
                  <OutgoingRow key={entry.profile.id} entry={entry} busy={busy}
                    onWithdraw={() => void run(() => actions.withdraw(entry.profile.id, nameOf(entry.profile.display_name)))} />
                ))}
              </Section>
            ) : null}

            <Section id="people-blocked" title={t('people.screen.blocked')} count={screen.blocked.length} empty={t('people.screen.blocked_empty')}>
              {screen.blocked.map((entry) => <BlockedRow key={entry.profile_id} entry={entry} onUnblock={() => setUnblock(entry)} />)}
            </Section>

            <p className="pp-foot">{t('people.screen.no_search')}</p>
          </m.div>
        )}
      </div>

      <RowMenu menu={menu} onClose={() => setMenu(null)}
        onDecline={(entry) => {
          setMenu(null)
          actions.decline(entry.profile.id, nameOf(entry.profile.display_name))
        }}
        onDeclineAndBlock={(entry) => openBlock({ profileId: entry.profile.id, name: nameOf(entry.profile.display_name), declineFirst: true })}
        onRemove={(entry) => {
          setMenu(null)
          setRemove(entry)
        }}
        onBlock={(profileId, name) => openBlock({ profileId, name })}
      />

      <AcceptSheet
        request={accept.request}
        open={accept.open}
        onClose={() => setAccept((state) => ({ ...state, open: false }))}
        userId={userId}
        actions={actions}
        onDeclineAndBlock={(request) => openBlock({ profileId: request.profile.id, name: nameOf(request.profile.display_name), declineFirst: true })}
      />
      <BlockSheet target={block.target} open={block.open} onClose={() => setBlock((state) => ({ ...state, open: false }))} actions={actions} />
      <Confirm
        open={remove !== null}
        destructive
        title={t('people.remove.title', { name: nameOf(remove?.profile.display_name ?? null) })}
        // static: the same sentence whatever the person may have planned (S9)
        message={t('people.remove.message', { name: nameOf(remove?.profile.display_name ?? null) })}
        confirmLabel={t('people.remove.confirm')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => {
          const entry = remove
          if (!entry) return
          void run(async () => {
            await actions.removeFollower(entry.profile.id, nameOf(entry.profile.display_name))
            setRemove(null)
          })
        }}
        onCancel={() => setRemove(null)}
      />
      <Confirm
        open={unblock !== null}
        title={t('people.unblock.title', { name: nameOf(unblock?.display_name ?? null) })}
        message={t('people.unblock.message')}
        confirmLabel={t('people.unblock.confirm')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => {
          const entry = unblock
          if (!entry) return
          void run(async () => {
            await actions.unblock(entry.profile_id, nameOf(entry.display_name))
            setUnblock(null)
          })
        }}
        onCancel={() => setUnblock(null)}
      />
      <FollowLinkSheetHost userId={userId} />
    </Page>
  )
}

// ---- parts ---------------------------------------------------------------------------------------------------

function Section({ id, title, count, empty, children }: { id?: string; title: string; count: number; empty?: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section id={id} aria-labelledby={headingId} className="pp-section scroll-mt-24">
      <div className="pp-section-head">
        <h2 id={headingId} className="pp-section-title">{title}</h2>
        {count > 0 ? <span className="pp-section-count">{count}</span> : null}
      </div>
      {count > 0 ? <ul className="glass-panel pp-panel">{children}</ul> : empty ? <p className="glass-panel pp-empty">{empty}</p> : null}
    </section>
  )
}

/** "Mein Folgen-Link": how many live links I have (never a code) and [Teilen] → the link sheet. */
function LinkCard({ count }: { count: number | null }) {
  const { t } = useTranslation('people')
  return (
    <div className="glass-panel pp-link-card">
      <span aria-hidden="true" className="pp-link-icon"><GlyphFollowLink size={22} /></span>
      <div className="min-w-0 flex-1">
        <p className="t-headline text-text">{t('people.screen.link_title')}</p>
        {count === null ? (
          <Skeleton width={110} height={12} className="mt-1" />
        ) : (
          <p className="t-footnote text-text-2">{count > 0 ? t('people.link.live_count', { count }) : t('people.link.none_live')}</p>
        )}
      </div>
      <Button size="sm" onClick={() => openFollowLinkSheet()}>{t('people.screen.link_share')}</Button>
    </div>
  )
}

function PersonLink({ profileId, name, children }: { profileId: string; name: string; children: ReactNode }) {
  return (
    <Link to="/people/$profileId" params={{ profileId }} className="pp-row-main" aria-label={name} onPointerDown={() => haptic('tap')}>
      {children}
    </Link>
  )
}

function RequestRow({ entry, onAccept, onMenu }: { entry: IncomingRequest; onAccept: () => void; onMenu: () => void }) {
  const { t } = useTranslation('people')
  const online = useOnline()
  const ago = useAgo()
  const contextOf = useRequestContext()
  const name = entry.profile.display_name?.trim() || t('people.card.name_fallback')
  const context = contextOf(name, entry.shared_occasions, entry.i_follow)
  return (
    <li className="pp-request">
      <PersonLink profileId={entry.profile.id} name={name}>
        <ProfileAvatar seed={entry.profile.id} name={entry.profile.display_name} size={44}>
          <AvatarPhoto profileId={entry.profile.id} meta={entry.profile.photo} />
        </ProfileAvatar>
        <span className="pp-row-text">
          <span className="pp-row-line">
            <span className="pp-row-name">{name}</span>
            <span className="pp-time">{ago(entry.requested_at)}</span>
          </span>
          {context.kind === 'unknown' ? null : <span className="pp-row-sub">{context.text}</span>}
        </span>
      </PersonLink>
      {/* no shared occasion, no follow of mine: the highlighted question, the full width under the name (P7) */}
      {context.kind === 'unknown' ? <p className="pp-unknown pp-request-note">{context.text}</p> : null}
      <div className="pp-request-actions">
        <Button size="sm" disabled={!online} onClick={onAccept}>{t('people.accept.accept')}</Button>
        <span className="pp-spacer" />
        <IconButton label={t('people.screen.more', { name })} aria-haspopup="dialog" onClick={onMenu}>
          <IconMore />
        </IconButton>
      </div>
    </li>
  )
}

function FollowerRow({ entry, busy, onFollow, onMenu }: { entry: FollowerEntry; busy: boolean; onFollow: () => void; onMenu: () => void }) {
  const { t } = useTranslation('people')
  const online = useOnline()
  const name = entry.profile.display_name?.trim() || t('people.card.name_fallback')
  return (
    // with [Auch folgen] / "Angefragt" in the trail the row stacks at 320 px (people.css), like a request
    <li className="pp-row" data-stack={entry.i_follow === 'following' ? undefined : ''}>
      <PersonLink profileId={entry.profile.id} name={name}>
        <ProfileAvatar seed={entry.profile.id} name={entry.profile.display_name} size={40}>
          <AvatarPhoto profileId={entry.profile.id} meta={entry.profile.photo} />
        </ProfileAvatar>
        <span className="pp-row-text">
          <span className="pp-row-name">{name}</span>
          <RelationChip iFollow={entry.i_follow} followsMe="following" />
        </span>
      </PersonLink>
      <span className="pp-row-trail">
        {entry.i_follow === 'none' ? (
          <Button size="sm" variant="secondary" disabled={!online || busy} onClick={onFollow}>{t('people.screen.also_follow')}</Button>
        ) : entry.i_follow === 'requested' ? (
          <span className="pp-chip">{t('people.card.requested')}</span>
        ) : null}
        <IconButton label={t('people.screen.more', { name })} aria-haspopup="dialog" onClick={onMenu}>
          <IconMore />
        </IconButton>
      </span>
    </li>
  )
}

function FollowingRow({ entry }: { entry: FollowingEntry }) {
  const { t } = useTranslation('people')
  const name = entry.profile.display_name?.trim() || t('people.card.name_fallback')
  return (
    <li className="pp-row">
      <PersonLink profileId={entry.profile.id} name={name}>
        <ProfileAvatar seed={entry.profile.id} name={entry.profile.display_name} size={40}>
          <AvatarPhoto profileId={entry.profile.id} meta={entry.profile.photo} />
        </ProfileAvatar>
        <span className="pp-row-text">
          <span className="pp-row-name">{name}</span>
          <RelationChip iFollow="following" followsMe={entry.follows_me} />
        </span>
        <IconForward size={16} className="shrink-0 text-text-3" />
      </PersonLink>
    </li>
  )
}

function OutgoingRow({ entry, busy, onWithdraw }: { entry: OutgoingRequest; busy: boolean; onWithdraw: () => void }) {
  const { t } = useTranslation('people')
  const online = useOnline()
  const ago = useAgo()
  const name = entry.profile.display_name?.trim() || t('people.card.name_fallback')
  return (
    <li className="pp-row" data-stack="">
      <PersonLink profileId={entry.profile.id} name={name}>
        <ProfileAvatar seed={entry.profile.id} name={entry.profile.display_name} size={40}>
          <AvatarPhoto profileId={entry.profile.id} meta={entry.profile.photo} />
        </ProfileAvatar>
        <span className="pp-row-text">
          <span className="pp-row-name">{name}</span>
          <span className="pp-row-sub">{t('people.screen.requested_ago', { ago: ago(entry.requested_at) })}</span>
        </span>
      </PersonLink>
      <span className="pp-row-trail">
        <Button size="sm" variant="secondary" disabled={!online || busy} onClick={onWithdraw}>{t('people.screen.withdraw')}</Button>
      </span>
    </li>
  )
}

function BlockedRow({ entry, onUnblock }: { entry: BlockedEntry; onUnblock: () => void }) {
  const { t } = useTranslation('people')
  const online = useOnline()
  const name = entry.display_name?.trim() || t('people.card.name_fallback')
  return (
    <li className="pp-row" data-stack="">
      <div className="pp-row-main">
        <ProfileAvatar seed={entry.profile_id} name={entry.display_name} size={40} />
        <span className="pp-row-text">
          <span className="pp-row-name">{name}</span>
          <span className="pp-row-sub">{t('people.screen.blocked_since', { date: formatDate(entry.blocked_at) })}</span>
        </span>
      </div>
      <span className="pp-row-trail">
        <Button size="sm" variant="secondary" disabled={!online} onClick={onUnblock}>{t('people.unblock.confirm')}</Button>
      </span>
    </li>
  )
}

interface RowMenuProps {
  menu: Menu
  onClose: () => void
  onDecline: (entry: IncomingRequest) => void
  onDeclineAndBlock: (entry: IncomingRequest) => void
  onRemove: (entry: FollowerEntry) => void
  onBlock: (profileId: string, name: string) => void
}

/** ⋯ of a request (Ablehnen · Ablehnen und blockieren · Melden) or of a follower (entfernen · blockieren · Melden). */
function RowMenu({ menu, onClose, onDecline, onDeclineAndBlock, onRemove, onBlock }: RowMenuProps) {
  const { t } = useTranslation('people')
  const online = useOnline()
  const profileId = menu?.entry.profile.id ?? ''
  const reportHref = useReportHref(profileId)
  const name = menu?.entry.profile.display_name?.trim() || t('people.card.name_fallback')
  return (
    <Sheet open={menu !== null} onClose={onClose} title={name} closeLabel={t('common.close')}>
      <List className="pb-2">
        {menu?.kind === 'request' ? (
          <>
            <ListRow title={t('people.accept.decline')} disabled={!online} onPress={() => onDecline(menu.entry)} />
            <ListRow title={<span className="text-danger">{t('people.accept.decline_block')}</span>} disabled={!online}
              onPress={() => onDeclineAndBlock(menu.entry)} />
          </>
        ) : menu?.kind === 'follower' ? (
          <>
            <ListRow title={t('people.card.remove_follower')} disabled={!online} onPress={() => onRemove(menu.entry)} />
            <ListRow title={<span className="text-danger">{t('people.card.block')}</span>} disabled={!online} onPress={() => onBlock(profileId, name)} />
          </>
        ) : null}
        {reportHref ? (
          <li className={listItemClass}>
            <a href={reportHref} className={listRowClass({ pressable: true })} onClick={onClose}>
              <ListRowContent title={t('people.report.action')} />
            </a>
          </li>
        ) : (
          <ListRow title={t('people.report.action')} subtitle={t('people.report.pending')} />
        )}
      </List>
    </Sheet>
  )
}

function PeopleSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-7">
      {[0, 1, 2].map((key) => (
        <div key={key} className="flex flex-col gap-2">
          <Skeleton width={120} height={22} />
          <div className="glass-panel rounded-[22px]">
            <SkeletonList rows={key === 0 ? 2 : 1} rowHeight={72} />
          </div>
        </div>
      ))}
    </div>
  )
}
