import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { onAccountEnded } from '../../lib/accountBoundary'
import { toAppError } from '../../lib/errors'
import { Button, EmptyState, Page, Segmented, buttonClass, useBunniesShown, useReducedMotionPref } from '../../ui'
import { useProfileCollapse } from '../account/ProfileHeader'
import { usePageTitle } from '../auth/shared'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { PressLink } from '../shell/MotionLink'
import { bannerOf } from './banners'
import { listsEnabled } from './flag'
import { FriendsSection, SubscribedSection, friendsEmpty } from './FriendsSection'
import { useFollowLinks } from './links'
import { ListsBar, ListsHero } from './ListsHeader'
import { MyListsGrid } from './MyListsGrid'
import { useListsOverview } from './queries'
import { usePendingListDeletes } from './pendingListDeletes'
import { listsTabView } from './tabView'
import { useStickySegment } from './sticky'
import { onCreateRequest } from './createFlow'
import type { ListTemplate } from './templates'
import { friendCodesEnabled } from '../people/codeFlag'
import { FollowLinkSheetHost } from '../people/linkSheetHost'
// Pompon, the Lists buddy (Felix 25.10; the bunny since the evening): a thin host in this route's chunk; the package entry
// (@bunprise/mascot/buddy) is its own lazy chunk, loaded only after the tab painted. A separate lazy chunk for
// the host would change how the shared modules (haptics, layers, motion level) are split and grow /soon.
import ListsBuddy from './ListsBuddy'
import './lists.css'

// The "Wunschlisten" tab (follows-design §2.2–§2.4, §00 p. 2; Felix 22.10: wishlists only, no occasions — tabView.ts): a Telegram-style header (banner, the initials
// avatar that glides into the bar, name, the two counters, followers line, requests pill), a sticky
// "Meine · Freunde" switch and the two sections. One RPC (get_lists_overview), memory only.
// Behind the flag: without VITE_DEMO / VITE_LISTS it is a calm "Bald verfügbar" — no request at all.

const BannerSheet = lazy(() => import('./BannerSheet'))
const AvatarSheet = lazy(() => import('../profilePhotos/AvatarSheet'))
const CreateListSheet = lazy(() => import('./CreateListSheet'))

export type ListsSegment = 'mine' | 'friends'

// which section was open — tab memory only (never stored), forgotten when the account ends in this tab
let lastSegment: ListsSegment = 'mine'
onAccountEnded(() => {
  lastSegment = 'mine'
})

export function ListsPage({ userId }: { userId: string }) {
  return listsEnabled() ? <ListsTab userId={userId} /> : <ListsSoon />
}

/** The flag is off: the tab exists, its screen says calmly that it is coming (no RPC). */
export function ListsSoon() {
  const { t } = useTranslation('lists')
  const card = useRef<HTMLDivElement>(null)
  const bunnies = useBunniesShown()
  usePageTitle(t('lists.title'))
  return (
    <Page>
      <h1 className="mt-2 mb-6 t-display text-text">{t('lists.title')}</h1>
      {bunnies ? <div className="relative h-36">
        <BunnyMoment kind="peek" calm="still" cardRef={card} edgeInset={16} minSize={112} maxSize={148} className="pointer-events-none absolute inset-0" style={{ bottom: -16 }} />
      </div> : null}
      <div ref={card} className="glass-panel lt-soon flex flex-col items-center gap-3 rounded-card px-6 pb-6 pt-9 text-center">
        <h2 className="t-title-2 text-text">{t('lists.soon.title')}</h2>
        <p className="max-w-[34ch] t-body text-text-2">{t('lists.soon.text')}</p>
        <PressLink to="/soon" className={buttonClass({ variant: 'secondary', size: 'lg', fullWidth: true })}>
          {t('lists.soon.back')}
        </PressLink>
      </div>
    </Page>
  )
}

function ListsTab({ userId }: { userId: string }) {
  const { t } = useTranslation('lists')
  usePageTitle(t('lists.title'))
  const reduced = useReducedMotionPref()
  const links = useFollowLinks()
  const query = useListsOverview(userId)
  const overview = query.data
  // what the tab shows: my lists without an occasion, minus the ones waiting for their undo (tabView.ts)
  const pendingDeletes = usePendingListDeletes()
  const view = overview ? listsTabView(overview, pendingDeletes) : undefined
  const [segment, setSegmentState] = useState<ListsSegment>(lastSegment)
  const [bannerOpen, setBannerOpen] = useState(false)
  const [create, setCreate] = useState<{ open: boolean; template: ListTemplate | null }>({ open: false, template: null })
  const [createMounted, setCreateMounted] = useState(false)
  if (create.open && !createMounted) setCreateMounted(true)
  const [bannerMounted, setBannerMounted] = useState(false)
  if (bannerOpen && !bannerMounted) setBannerMounted(true)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [avatarMounted, setAvatarMounted] = useState(false)
  if (avatarOpen && !avatarMounted) setAvatarMounted(true)

  const name = overview?.me.display_name?.trim() || null
  const banner = bannerOf(overview?.me.banner ?? null, userId)
  // 20261024120000: my own photos (a server without the migration sends no key: the sheets say "Das geht bald")
  const photo = overview?.me.photo ?? null
  const bannerPhoto = overview?.me.banner_photo ?? null
  const photosSupported = overview !== undefined && overview.me.photo !== undefined
  const glide = !reduced
  const collapse = useProfileCollapse(glide, `${name ?? ''}:${overview ? 1 : 0}`)
  const segmentRef = useRef<HTMLDivElement>(null)
  const stuck = useStickySegment(segmentRef)
  // the box the buddy (Pompon) lives in: hero, switch and section (his floors and the avatar are marked inside)
  const buddyStage = useRef<HTMLDivElement>(null)
  const bunnies = useBunniesShown()
  const myWishes = view?.stats.my_wishes
  // one mascot at a time: the empty "Freunde" card brings Tapsi with the binoculars, the empty "Meine" Pompon
  const buddyHidden = overview !== undefined && (segment === 'friends' ? friendsEmpty(overview) : (view?.myLists.length ?? 0) === 0)

  function setSegment(next: ListsSegment) {
    lastSegment = next
    setSegmentState(next)
  }

  /** A counter tile chose a section: switch to it and bring the switch under the bar. */
  function showSegment(next: ListsSegment) {
    setSegment(next)
    segmentRef.current?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
  }

  // a chosen template or the dashed tile opens the create sheet (the sheet carries the new card in, §2.6)
  function openCreate(template: ListTemplate | null) {
    setCreate({ open: true, template })
  }

  // "+ → Neue Wunschliste" (the create menu, integration step): the tab opens its sheet once it is on screen
  useEffect(
    () =>
      onCreateRequest(() => {
        lastSegment = 'mine'
        setSegmentState('mine')
        setCreate({ open: true, template: null })
      }),
    [],
  )

  useEffect(() => {
    // the sheets are lazy chunks: warm the create sheet once the tab is idle (the first tap opens at once)
    const id = setTimeout(() => {
      void import('./CreateListSheet')
    }, 1200)
    return () => clearTimeout(id)
  }, [])

  const loadError = query.isError && !overview ? toAppError(query.error) : null

  return (
    <Page
      topBar={
        <ListsBar
          barRef={collapse.bar}
          slotRef={collapse.barSlot}
          floatRef={collapse.float}
          glide={glide}
          name={name}
          seed={userId}
          photo={photo}
          onShare={links.shareFollowLink}
        />
      }
    >
      <h1 className="sr-only">{t('lists.title')}</h1>
      <div ref={buddyStage} className="lt-buddy-stage">
      <ListsHero
        heroRef={collapse.heroSlot}
        glide={glide}
        seed={userId}
        name={name}
        banner={banner}
        photo={photo}
        bannerPhoto={bannerPhoto}
        overview={overview}
        onBanner={() => setBannerOpen(true)}
        onAvatar={() => setAvatarOpen(true)}
        onSegment={showSegment}
        links={links}
        buddyRoom={bunnies}
      />

      {/* data-buddy-ceiling: the buddy never stands right under the switch (it would cover him) */}
      <div ref={segmentRef} data-stuck={stuck ? '' : undefined} data-buddy-ceiling="" className="lt-segment">
        <div className="lt-segment-inner">
          <Segmented
            label={t('lists.segments.label')}
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'mine', label: t('lists.segments.mine') },
              { value: 'friends', label: t('lists.segments.friends') },
            ]}
          />
        </div>
      </div>

      <div className="pt-4">
        {loadError ? (
          <EmptyState
            title={t('lists.card.load_failed')}
            text={loadError.code !== 'load_failed' ? t(loadError.key, loadError.params) : undefined}
            action={
              <Button variant="secondary" fullWidth onClick={() => void query.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : segment === 'mine' ? (
          <div className="flex flex-col gap-8">
            <MyListsGrid
              lists={view?.myLists ?? null}
              userId={userId}
              followers={overview?.stats.followers ?? null}
              onCreate={() => openCreate(null)}
              onTemplate={(template) => openCreate(template)}
            />
            <SubscribedSection userId={userId} overview={overview ?? null} />
          </div>
        ) : (
          <FriendsSection userId={userId} overview={overview ?? null} onShare={links.shareFollowLink} onEnterCode={friendCodesEnabled() ? links.enterFriendCode : undefined} />
        )}
      </div>
      </div>
      {bunnies && myWishes !== undefined ? <ListsBuddy stage={buddyStage} count={myWishes} hidden={buddyHidden} /> : null}

      {bannerMounted ? (
        <Suspense fallback={null}>
          <BannerSheet open={bannerOpen} onClose={() => setBannerOpen(false)} userId={userId} name={name} current={banner}
            photo={bannerPhoto} avatarPhoto={photo} photosSupported={photosSupported} />
        </Suspense>
      ) : null}
      {avatarMounted ? (
        <Suspense fallback={null}>
          <AvatarSheet open={avatarOpen} onClose={() => setAvatarOpen(false)} userId={userId} name={name} photo={photo} supported={photosSupported} />
        </Suspense>
      ) : null}
      {createMounted ? (
        <Suspense fallback={null}>
          <CreateListSheet
            open={create.open}
            template={create.template}
            userId={userId}
            followers={overview?.stats.followers ?? null}
            standaloneCount={overview ? overview.my_lists.filter((card) => card.kind === 'standalone').length : null}
            onClose={() => setCreate((state) => ({ ...state, open: false }))}
          />
        </Suspense>
      ) : null}
      {/* the follow-link sheet of [Teilen] / "Deinen Link teilen" (agent K2, features/people) */}
      <FollowLinkSheetHost userId={userId} />
    </Page>
  )
}
