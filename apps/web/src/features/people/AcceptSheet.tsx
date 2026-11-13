import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { FollowState, SharedOccasion } from '../../lib/api/follows.types'
import type { ProfileCard } from '../../lib/api/lists.types'
import { Button, Skeleton, useBunniesShown, useReducedMotionPref } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { listsOverviewQuery } from '../lists/queries'
import type { PeopleActions } from './actions'
import './people.css'

// The "Annehmen" sheet (follows-design §2.10) — an OWNER module: everything it says comes from MY data. Which of
// my lists the person will see ("Meine Wünsche, Weihnachten" — my lists for followers, from the lists tab's
// get_lists_overview, or "Du teilst gerade keine Liste mit Followern"), and — when we share no occasion and I do
// not follow them — the highlighted "Ihr habt keinen gemeinsamen Anlass. Kennst du {{name}} persönlich?" (anybody
// can call themselves "Mama" behind a forwarded link). Then "Annehmen" (waits for the server; the bunny jumps
// at full motion) and "Möchtest du {{name}} auch folgen?" [Auch folgen] [Später]. "Ablehnen" and "Ablehnen und
// blockieren" sit here too.

export interface AcceptRequest {
  profile: ProfileCard
  shared_occasions: readonly SharedOccasion[]
  /** my own state towards them: the context line and whether "Auch folgen" is offered */
  i_follow: FollowState
}

export interface AcceptSheetProps {
  request: AcceptRequest | null
  open: boolean
  onClose: () => void
  userId: string
  actions: PeopleActions
  /** "Ablehnen und blockieren": the block sheet takes over (with its bullets and the links switch) */
  onDeclineAndBlock: (request: AcceptRequest) => void
}

type Phase = 'ask' | 'accepting' | 'accepted' | 'following'

export function AcceptSheet({ request, open, onClose, userId, actions, onDeclineAndBlock }: AcceptSheetProps) {
  const { t } = useTranslation('people')
  const online = useOnline()
  const bunnies = useBunniesShown()
  const reduced = useReducedMotionPref()
  const [phase, setPhase] = useState<Phase>('ask')
  const [meeting, setMeeting] = useState(false)
  // a new request in the sheet starts over (derived state, set during render — no effect, no flash)
  const [shownFor, setShownFor] = useState<string | null>(null)
  if (request && shownFor !== request.profile.id) {
    setShownFor(request.profile.id)
    setPhase('ask')
    setMeeting(false)
  }
  const overview = useQuery({ ...listsOverviewQuery(userId), enabled: open, staleTime: 30_000 })
  useEffect(() => {
    if (!meeting) return
    // A denied or failed decorative module must not leave a blank stage in the sheet.
    const timeout = setTimeout(() => setMeeting(false), 4500)
    return () => clearTimeout(timeout)
  }, [meeting])

  if (!request) return null
  const name = request.profile.display_name?.trim() || t('people.card.name_fallback')
  const unknown = request.shared_occasions.length === 0 && request.i_follow === 'none'
  const shared = overview.data?.my_lists.filter((card) => card.kind === 'standalone' && card.visibility === 'followers') ?? null
  const titles = shared?.map((card) => card.title?.trim()).filter((title): title is string => Boolean(title)) ?? []

  async function accept() {
    if (!request || phase !== 'ask' || !online) return
    setPhase('accepting')
    const done = await actions.accept(request.profile.id)
    if (done === null) {
      setPhase('ask')
      return
    }
    setPhase('accepted')
    setMeeting(true)
  }

  async function alsoFollow() {
    if (!request || phase !== 'accepted') return
    setPhase('following')
    await actions.request(request.profile.id, name)
    onClose()
  }

  function decline() {
    if (!request) return
    actions.decline(request.profile.id, name)
    onClose()
  }

  const asking = phase === 'ask' || phase === 'accepting'
  const offerFollow = request.i_follow === 'none'
  const footer = asking ? (
    <div className="flex flex-col gap-2">
      <Button size="lg" fullWidth disabled={!online} loading={phase === 'accepting'} loadingLabel={t('people.accept.accepting')} onClick={() => void accept()}>
        {t('people.accept.accept')}
      </Button>
      <Button size="lg" fullWidth variant="secondary" disabled={phase === 'accepting'} onClick={decline}>
        {t('people.accept.decline')}
      </Button>
      <Button size="md" fullWidth variant="ghost" className="text-danger" disabled={phase === 'accepting'} onClick={() => onDeclineAndBlock(request)}>
        {t('people.accept.decline_block')}
      </Button>
    </div>
  ) : offerFollow ? (
    <div className="flex flex-col gap-2">
      <Button size="lg" fullWidth disabled={!online} loading={phase === 'following'} loadingLabel={t('people.accept.requesting')} onClick={() => void alsoFollow()}>
        {t('people.accept.also_follow')}
      </Button>
      <Button size="lg" fullWidth variant="secondary" disabled={phase === 'following'} onClick={onClose}>
        {t('people.accept.later')}
      </Button>
    </div>
  ) : (
    <Button size="lg" fullWidth onClick={onClose}>
      {t('people.accept.done_button')}
    </Button>
  )

  return (
    <Sheet open={open} onClose={() => (phase === 'accepting' || phase === 'following' ? undefined : onClose())}
      title={asking ? t('people.accept.title', { name }) : t('people.accept.accepted', { name })} closeLabel={t('common.close')} footer={footer}>
      <div className="pp-sheet">
        {asking ? (
          <>
            {unknown ? <p role="note" className="pp-unknown pp-unknown-block">{t('people.context.unknown', { name })}</p> : null}
            <p className="t-body text-text">{t('people.accept.lead', { name })}</p>
            <div className="glass-panel pp-note">
              {shared === null ? (
                overview.isError ? (
                  <span className="text-text-2">{t('people.accept.sees_unknown')}</span>
                ) : (
                  <Skeleton width="80%" height={18} />
                )
              ) : titles.length > 0 ? (
                t('people.accept.sees', { name, lists: titles.join(', ') })
              ) : (
                t('people.accept.sees_none')
              )}
            </div>
          </>
        ) : (
          <>
            {/* The stage keeps its height for the whole accepted phase: when the two bunnies have left, the
                sheet must not jump and glue the question to the title (Felix 22.10). */}
            {bunnies && !reduced ? (
              <div className="pointer-events-none -mx-5 h-30" style={{ width: 'calc(100% + 40px)' }} aria-hidden="true">
                {meeting ? <BunnyMoment kind="wave" pick={{ preset: 'meet', coat: 'fawn', edge: 'left' }} once="always" momentClass="response" calm="hide" onEnd={() => setMeeting(false)}
                  minSize={80} maxSize={96} className="h-full w-full" /> : null}
              </div>
            ) : null}
            <span role="status" className="sr-only">{t('people.accept.accepted', { name })}</span>
            {offerFollow ? (
              <>
                <h3 className={`t-title-3 text-text${bunnies && !reduced ? '' : ' mt-2'}`}>{t('people.accept.also_title', { name })}</h3>
                <p className="t-body text-text-2">{t('people.accept.also_text', { name })}</p>
              </>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  )
}
