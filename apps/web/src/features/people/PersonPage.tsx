import { useId, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { PersonCard } from '../../lib/api/follows.types'
import type { FollowedListCard } from '../../lib/api/lists.types'
import { Button, IconButton, IconCheck, IconGift, IconMore, List, ListRow, ListRowContent, Page, Skeleton, TopBar, buttonClass, fade, haptic, listItemClass, listRowClass, useSpring, useTapScale } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { useOnline, usePageTitle } from '../auth/shared'
import { ProfileAvatar } from '../nav/ProfileAvatar'
import { AvatarPhoto, BannerPhoto } from '../profilePhotos/PersonPhoto'
import { MotionLink, PressLink } from '../shell/MotionLink'
import { BannerArt, bannerOf } from '../lists/banners'
import { CoverTile, coverToneOf } from '../lists/covers'
import { useFindGiftFor } from '../lists/findGift'
import { listsEnabled } from '../lists/flag'
import { usePeopleActions } from './actions'
import { AcceptSheet, type AcceptRequest } from './AcceptSheet'
import { BlockSheet, type BlockTarget } from './BlockSheet'
import { PersonUnavailable, RelationChip, sharedTitles, useBackToPeople, useReportHref } from './parts'
import { usePendingDeclines } from './pendingDeclines'
import { isPersonUnavailable, usePerson } from './queries'
import '../lists/lists.css'
import './people.css'

// The person card `/people/$profileId` (follows-design §2.8) — ONE RPC (get_profile_card). Banner, avatar, name,
// "Folgt dir" / "Folgt dir nicht" / "Ihr folgt euch", "Gemeinsam in: …", the main button by MY state (Folgen
// anfragen → Angefragt ✓ [Anfrage zurückziehen] → Du folgst ✓ [Nicht mehr folgen]), an incoming request
// (Annehmen / Ablehnen), their lists only while I follow them, "Geschenk finden für {{name}}" only with
// can_find_gift, and ⋯: Als Follower entfernen · Blockieren · Melden. It NEVER shows anybody's followers,
// followings or their numbers (P2), and nothing about reservations: the texts for my followers are static.

export function PersonPage({ profileId, userId }: { profileId: string; userId: string }) {
  if (!listsEnabled()) return <PersonUnavailable />
  return <PersonScreen profileId={profileId} userId={userId} />
}

type Open = 'menu' | 'withdraw' | 'unfollow' | 'remove' | 'accept' | 'block' | null

function PersonScreen({ profileId, userId }: { profileId: string; userId: string }) {
  const { t } = useTranslation('people')
  const query = usePerson(profileId, userId)
  const back = useBackToPeople()
  // a person's name is private: keep it out of the tab title / browser history
  usePageTitle(t('people.card.title'))
  if (query.isError && isPersonUnavailable(query.error)) return <PersonUnavailable />
  const card = query.data
  if (!card) {
    const topBar = <TopBar back={{ label: t('common.back'), onClick: back }} />
    return (
      <Page topBar={topBar}>
        {query.isError && !query.isFetching ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-10">
            <p className="t-headline text-text">{t('people.card.load_failed')}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>{t('common.retry')}</Button>
          </div>
        ) : <PersonSkeleton />}
      </Page>
    )
  }
  return <PersonView card={card} userId={userId} />
}

function PersonView({ card, userId }: { card: PersonCard; userId: string }) {
  const { t } = useTranslation('people')
  const navigate = useNavigate()
  const online = useOnline()
  const back = useBackToPeople()
  const actions = usePeopleActions(userId)
  const findGiftFor = useFindGiftFor()
  const declines = usePendingDeclines()
  const reportHref = useReportHref(card.profile.id)
  const [open, setOpen] = useState<Open>(null)
  const [busy, setBusy] = useState(false)
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null)
  const { profile, relation } = card
  const name = profile.display_name?.trim() || t('people.card.name_fallback')
  const incoming = relation.follows_me === 'requested' && !declines.has(profile.id)
  const request: AcceptRequest = { profile, shared_occasions: card.shared_occasions, i_follow: relation.i_follow }
  const listsId = useId()

  async function run(task: () => Promise<unknown>) {
    if (busy || !online) return
    setBusy(true)
    try {
      await task()
    } finally {
      setBusy(false)
    }
  }

  function openBlock(declineFirst: boolean) {
    setBlockTarget({ profileId: profile.id, name, declineFirst })
    setOpen('block')
  }

  const main = relation.self ? null : relation.i_follow === 'following' ? (
    <Button size="lg" fullWidth variant="secondary" icon={<IconCheck size={20} />} aria-haspopup="dialog" onClick={() => setOpen('unfollow')}>
      {t('people.card.following')}
    </Button>
  ) : relation.i_follow === 'requested' ? (
    <Button size="lg" fullWidth variant="secondary" icon={<IconCheck size={20} />} aria-haspopup="dialog" onClick={() => setOpen('withdraw')}>
      {t('people.card.requested')}
    </Button>
  ) : card.can_request ? (
    <Button size="lg" fullWidth disabled={!online} loading={busy} loadingLabel={t('people.card.requesting')}
      onClick={() => void run(() => actions.request(profile.id, name))}>
      {t('people.card.request')}
    </Button>
  ) : incoming ? null : (
    // (with their request open, "Annehmen" first: afterwards "Auch folgen" is offered right there)
    <p className="glass-panel pp-note t-subhead text-text-2">{t('people.card.cannot_request', { name })}</p>
  )
  const unknown = incoming && card.shared_occasions.length === 0 && relation.i_follow === 'none'

  const topBar = (
    <TopBar
      back={{ label: t('common.back'), onClick: back }}
      right={relation.self ? undefined : (
        <IconButton label={t('people.card.menu')} aria-haspopup="dialog" onClick={() => setOpen('menu')}>
          <IconMore />
        </IconButton>
      )}
    />
  )

  return (
    <Page topBar={topBar}>
      <m.div className="flex flex-col gap-5 pt-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={fade}>
        <section aria-label={name} className="pp-hero">
          <BannerArt banner={bannerOf(profile.banner, profile.id)} className="pp-banner" photo={<BannerPhoto profileId={profile.id} meta={profile.banner_photo} eager />} />
          <div className="pp-id">
            <ProfileAvatar seed={profile.id} name={profile.display_name} size={80} className="pp-avatar">
              <AvatarPhoto profileId={profile.id} meta={profile.photo} eager />
            </ProfileAvatar>
          </div>
          <h1 className="pp-name">{name}</h1>
          {/* an open request of theirs speaks for itself below (no "Folgt dir nicht" next to "möchte dir folgen") */}
          {incoming ? null : (
            <div className="pp-meta">
              <RelationChip self={relation.self} iFollow={relation.i_follow} followsMe={relation.follows_me} />
            </div>
          )}
          {card.shared_occasions.length > 0 ? (
            <p className="pp-shared">{t('people.card.shared', { occasions: sharedTitles(card.shared_occasions) })}</p>
          ) : null}
        </section>

        {incoming ? (
          <section aria-label={t('people.card.incoming_title', { name })} className="glass-panel pp-incoming">
            <p className="pp-incoming-title">{t('people.card.incoming_title', { name })}</p>
            {unknown ? <p role="note" className="pp-unknown pp-unknown-block">{t('people.context.unknown', { name })}</p> : null}
            <div className="pp-buttons">
              <Button size="md" disabled={!online} onClick={() => setOpen('accept')}>{t('people.accept.accept')}</Button>
              <Button size="md" variant="secondary" disabled={!online} onClick={() => actions.decline(profile.id, name)}>
                {t('people.accept.decline')}
              </Button>
            </div>
          </section>
        ) : null}

        {main}

        {card.can_find_gift ? (
          <Button size="lg" fullWidth variant="secondary" className="h-auto min-h-13 whitespace-normal py-3 text-center" icon={<IconGift />} onClick={() => findGiftFor(profile.id)}>
            {t('people.card.find_gift', { name })}
          </Button>
        ) : null}

        {relation.i_follow === 'following' ? (
          <section aria-labelledby={listsId} className="pp-section">
            <div className="pp-section-head">
              <h2 id={listsId} className="pp-section-title">{t('people.card.lists_title', { name })}</h2>
            </div>
            {card.lists.length > 0 ? (
              <ul className="pp-lists">
                {card.lists.map((list) => (
                  <li key={list.id}>
                    <PersonListCard list={list} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="glass-panel pp-empty">{t('people.card.lists_none', { name })}</p>
            )}
          </section>
        ) : relation.self ? (
          // my own card (a link to it from elsewhere): where my lists and my followers really are
          <div className="flex flex-col gap-3">
            <p className="glass-panel pp-note t-subhead text-text-2">{t('people.card.self_hint')}</p>
            <PressLink to="/lists" className={buttonClass({ variant: 'secondary', size: 'lg', fullWidth: true })}>
              {t('people.gate.to_lists')}
            </PressLink>
          </div>
        ) : (
          <p className="pp-foot">{t('people.card.lists_hidden', { name })}</p>
        )}
      </m.div>

      <Sheet open={open === 'menu'} onClose={() => setOpen(null)} title={name} closeLabel={t('common.close')}>
        <List className="pb-2">
          {relation.follows_me === 'following' ? (
            <ListRow title={t('people.card.remove_follower')} disabled={!online} onPress={() => setOpen('remove')} />
          ) : null}
          <ListRow title={<span className="text-danger">{t('people.card.block')}</span>} disabled={!online} onPress={() => openBlock(false)} />
          {reportHref ? (
            <li className={listItemClass}>
              <a href={reportHref} className={listRowClass({ pressable: true })} onClick={() => setOpen(null)}>
                <ListRowContent title={t('people.report.action')} />
              </a>
            </li>
          ) : (
            <ListRow title={t('people.report.action')} subtitle={t('people.report.pending')} />
          )}
        </List>
      </Sheet>

      <Confirm
        open={open === 'withdraw'}
        title={t('people.card.withdraw_title', { name })}
        message={t('people.card.withdraw_message', { name })}
        confirmLabel={t('people.card.withdraw')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void run(async () => {
          await actions.withdraw(profile.id, name)
          setOpen(null)
        })}
        onCancel={() => setOpen(null)}
      />
      <Confirm
        open={open === 'unfollow'}
        destructive
        title={t('people.giver.unfollow_title', { name })}
        message={t('people.giver.unfollow_message', { name })}
        confirmLabel={t('people.giver.unfollow')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void run(async () => {
          await actions.unfollow(profile.id, name)
          setOpen(null)
        })}
        onCancel={() => setOpen(null)}
      />
      <Confirm
        open={open === 'remove'}
        destructive
        title={t('people.remove.title', { name })}
        // static: the same sentence whatever the person may have planned (S9)
        message={t('people.remove.message', { name })}
        confirmLabel={t('people.remove.confirm')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onConfirm={() => void run(async () => {
          await actions.removeFollower(profile.id, name)
          setOpen(null)
        })}
        onCancel={() => setOpen(null)}
      />
      <AcceptSheet
        request={request}
        open={open === 'accept'}
        onClose={() => setOpen(null)}
        userId={userId}
        actions={actions}
        onDeclineAndBlock={() => openBlock(true)}
      />
      <BlockSheet
        target={blockTarget}
        open={open === 'block'}
        onClose={() => setOpen(null)}
        actions={actions}
        onBlocked={() => {
          // the card is gone for me now (blocked = not_found): back to the people screen
          void navigate({ to: '/people', replace: true }).catch(() => undefined)
        }}
      />
    </Page>
  )
}

/** One of their follower lists (tap → the list's screen). Nothing about anybody's reservations. */
function PersonListCard({ list }: { list: FollowedListCard }) {
  const { t } = useTranslation('people')
  const tap = useTapScale(0.97)
  const spring = useSpring('snappy')
  const tone = coverToneOf(list.cover_tone, list.id)
  return (
    // the look of the cards under a person in "Freunde" (features/lists/lists.css .lc-card)
    <MotionLink to="/lists/$listId" params={{ listId: list.id }} className="lc-card glass-panel pp-list-card" data-tone={tone}
      whileTap={tap} transition={spring} onPointerDown={() => haptic('tap')}>
      <span className="lc-cover">
        <CoverTile tone={tone} icon={list.cover_icon} size={36} />
      </span>
      <span className="lc-title">{list.title}</span>
      <span className="lc-count">
        {t('people.card.wishes', { count: list.wish_count })}
        {list.new_wish_count > 0 ? (
          <>
            {' · '}
            <span className="pp-list-new">{t('people.card.new_count', { count: list.new_wish_count })}</span>
          </>
        ) : null}
      </span>
    </MotionLink>
  )
}

function PersonSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4 pt-2">
      <Skeleton height={112} rounded="lg" />
      <Skeleton width={80} height={80} rounded="full" className="-mt-14 ml-4" />
      <Skeleton width="55%" height={30} />
      <Skeleton width={96} height={22} rounded="full" />
      <Skeleton height={52} rounded="full" />
    </div>
  )
}
