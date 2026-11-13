import { lazy, Suspense, useDeferredValue, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as m from 'motion/react-m'
import type { OccasionScreen } from '../../lib/api/types'
import { toAppError } from '../../lib/errors'
import { fade, Page, Segmented, SkeletonList, TopBar, tileTone } from '../../ui'
import { AmbientTint } from '../../ui/AmbientTint'
import { usePageTitle } from '../auth/shared'
import { WishlistSection } from '../wishes/WishlistSection'
import { isUnavailable, useOccasionScreen } from './data'
import { MembersSection } from './MembersSection'
import { OccasionHero } from './OccasionHero'
import { OccasionMenu } from './OccasionMenu'
import { LoadError, OccasionSkeleton, OccasionUnavailable, useBackToFeed } from './parts'
import { RsvpSection } from './RsvpSection'
import { startCelebration, useSaveState, type SaveState } from './saving'
import { clearInviteFocus, peekInviteFocus } from './inviteFocus'
import { useFindGiftFor } from '../lists/findGift'
import { potluckEnabled } from '../potluck/flag'
import { hasPotluck, sectionsOf, showsWishes } from '../potluck/cache'

// the bring-along list "Mitbringen" (features/potluck): its own chunk, loaded only for occasions that offer it
const PotluckSection = lazy(() => import('../potluck/PotluckSection'))

// S7 "Anlass": one route, two views by role, ONE RPC (get_occasion_screen). The host branch
// renders no reservation state of any kind (the RPC sends literal nulls for the owner and the
// wishlist component gets viewer 'owner'); guests get RSVP and the guest wishlist.
// Loading = skeleton with the hero's transition name; "not found" and "no access" = one page.

export interface OccasionPageProps {
  occasionId: string
  userId: string
}

/** How long the "Anlass gespeichert" moment stays (in "Wer kommt", MembersSection). */
const CELEBRATION_MS = 6_000

export function OccasionPage({ occasionId, userId }: OccasionPageProps) {
  const { t } = useTranslation('occasion')
  const query = useOccasionScreen(occasionId)
  const back = useBackToFeed()
  const saveState = useSaveState(occasionId)
  // no data at mount → the skeleton shows first → the content fades in once it arrives
  const [fadeIn] = useState(() => query.data === undefined)
  // the title of an occasion is private: keep it out of the tab title / browser history
  usePageTitle(t('occasion.title'))
  // opened from the calendar's "Freunde einladen" pill (K10, ./inviteFocus.ts): the host's invite rows in "Wer kommt" come
  // into view with the focus — once (taken here, never replayed on a later visit, e.g. back from a wish)
  const [focusInvite] = useState(() => peekInviteFocus(occasionId))
  useEffect(() => {
    if (focusInvite) clearInviteFocus(occasionId)
  }, [focusInvite, occasionId])

  // "created" is celebrated once, for a moment, starting when this screen first shows it (a module
  // timer, not an unmount clean-up: StrictMode's test unmount and a late mount must not swallow the
  // moment, and coming back from the wish form must not replay it).
  useEffect(() => {
    if (saveState === 'created') startCelebration(occasionId, CELEBRATION_MS)
  }, [saveState, occasionId])

  const screen = query.data
  // A final answer wins even over cached data (e.g. the host removed me while the screen was
  // open) and stays while a later refetch runs — no flash of the old content.
  if (query.isError && isUnavailable(query.error)) return <OccasionUnavailable />

  const topBar = (
    <TopBar
      large
      title={screen?.occasion.title}
      back={{ label: t('common.back'), onClick: back }}
      right={screen ? <OccasionMenu screen={screen} userId={userId} disabled={saveState === 'saving'} /> : null}
    />
  )

  if (!screen) {
    if (query.isError && !query.isFetching) {
      return (
        <Page topBar={topBar}>
          <LoadError error={toAppError(query.error)} onRetry={() => void query.refetch()} />
        </Page>
      )
    }
    return (
      <Page topBar={topBar}>
        <OccasionSkeleton occasionId={occasionId} />
      </Page>
    )
  }

  return (
    <Page topBar={topBar}>
      {/* the scene takes the occasion's own colour (the same stable hash as its feed card) */}
      <AmbientTint tone={tileTone(occasionId)} />
      <m.div
        className="flex flex-col gap-6 pt-4"
        // skeleton → content: crossfade only, no movement (design-system 2.6)
        initial={fadeIn ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={fade}
      >
        <OccasionContent screen={screen} updatedAt={query.dataUpdatedAt} userId={userId} saveState={saveState} focusInvite={focusInvite} />
      </m.div>
    </Page>
  )
}

interface OccasionContentProps {
  screen: OccasionScreen
  updatedAt: number
  userId: string
  saveState: SaveState | undefined
  focusInvite: boolean
}

function OccasionContent({ screen, updatedAt, userId, saveState, focusInvite }: OccasionContentProps) {
  const isHost = screen.viewer.role === 'host'
  // The screen's first frame is its top: the hero (the view transition's target) and the answer / invite
  // card. The wishlist and the members follow in a deferred render right after it (interruptible, so a
  // tap is never stuck behind the whole screen — perf audit §6.5: one 150–300 ms task after opening);
  // their rows rise in one after another. Only a gate: once there, they render with the current screen.
  const lowerReady = useDeferredValue(true, false)
  // the bring-along texts are the `potluck` group of the occasion namespace (no namespace of their own: budget)
  const { t } = useTranslation('occasion')
  // What the occasion offers (design §1.2): the wish list, the bring-along list or both — both behind a switch, so
  // the secret list and the open one never share one scroll. Without the flag: the wish list, exactly as before.
  const potluck = potluckEnabled() && hasPotluck(sectionsOf(screen))
  const wishes = !potluck || showsWishes(screen)
  const both = potluck && wishes
  const [tab, setTab] = useState<'wishes' | 'bring'>('wishes')
  const showWishes = wishes && (!both || tab === 'wishes')
  const showPotluck = potluck && (!both || tab === 'bring')
  return (
    <>
      <OccasionHero screen={screen} userId={userId} />
      {/* the host's ways to invite are in "Wer kommt" (MembersSection, Felix 27.10) — no card up here */}
      {isHost ? null : <RsvpSection screen={screen} userId={userId} />}
      {!lowerReady ? (
        // one screen tall until then: the legal footer stays below the fold (no layout shift)
        <div aria-hidden="true" className="min-h-[calc(100dvh-var(--topbar-h)-var(--sa-top))]" />
      ) : (
        <>
          {both ? (
            <Segmented
              label={t('potluck.switch_label')}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'wishes', label: t('potluck.tab_wishes') },
                { value: 'bring', label: t('potluck.tab_bring') },
              ]}
            />
          ) : null}
          {!showWishes ? null : screen.wishlist ? (
            <WishlistSection
              occasionId={screen.occasion.id}
              wishlist={screen.wishlist}
              viewer={isHost ? 'owner' : 'guest'}
              entrance
            />
          ) : (
            // optimistic create: the trigger's wishlist arrives with the real screen a moment later
            <SkeletonList rows={3} />
          )}
          {showWishes && !isHost && Boolean(screen.wishlist?.wishes.length) ? <GuestGiftIdeas profileId={screen.occasion.host.id} name={screen.occasion.host.display_name} /> : null}
          {showPotluck ? (
            <Suspense fallback={<SkeletonList rows={3} />}>
              <PotluckSection screen={screen} userId={userId} />
            </Suspense>
          ) : null}
          <MembersSection screen={screen} userId={userId} updatedAt={updatedAt} saveState={saveState} focusInvite={focusInvite} />
        </>
      )}
    </>
  )
}

function GuestGiftIdeas({ profileId, name }: { profileId: string; name: string | null }) {
  const { t } = useTranslation('occasion')
  const findGift = useFindGiftFor()
  return <button type="button" className="min-h-11 self-start text-left t-subhead text-accent-text" onClick={() => findGift(profileId)}>
    {t('occasion.gift_ideas_for', { name: name?.trim() || t('occasion.name_fallback') })} <span aria-hidden="true">›</span>
  </button>
}
