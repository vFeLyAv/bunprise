import { Suspense, lazy, useMemo, useState } from 'react'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { APP_NAME } from '../../../lib/app'
import { currentLanguage } from '../../../lib/i18n'
import { drawnArtId, GIFT_ART_PREFIX, isGiftIdeasError, isGiftTopic, photoFallbackArt, type GiftIdea, type GiftTopic } from '../../../lib/api/giftIdeas'
import { fetchGiftTopic, type GiftTopicIdea } from '../../../lib/api/giftTopics'
import { toast } from '../../../lib/toast'
import { Button, IconCheck, IconPlus, Page, Skeleton, TopBar, haptic, useReducedMotionPref } from '../../../ui'
import { usePageTitle } from '../../auth/shared'
import { GiftPicture } from '../GiftPicture'
import { firstName, priceRangeLabel } from '../labels'
import { rememberAddedToList, wasAddedToList } from '../session'
import { forgetIdeaFor, saveIdeaFor, useSavedFor } from '../storage'
import { ARCH_TONE, lookOf } from '../plays/looks'
import { SceneArt } from '../plays/SceneArt'
import { FilterSheet, FilterPills, SearchButton, SearchField } from './TopicFilters'
import { haystack, matchesSearch } from './search'
import { GameSheet } from './GameSheet'
import { TopicHero } from './TopicHero'
import { activeFilters, fitsFilters, NO_FILTERS, type FilterKind, type TopicFilters } from './filters'
import { topicRecipient } from './topicContext'
import { awardShort, factsLine } from './words'
import '../gifts.css'
import './topics.css'

// A topic of "Stöbern nach Thema" (`/gifts/topic/$topic`, a pushed screen; design 26.10 §2): our header drawing
// (Brettspiele: the moment «Кубик»), filters that work ON THE DEVICE, a grid of cards. A card opens the game's sheet
// (GameSheet); its "＋" does what the deck does for this recipient — "Zu meiner Wunschliste" (the wish form, a lazy
// chunk) or "Merken für Anna" (kept on this device, storage.ts; Anna never sees it). The whole shelf is one request
// (lib/api/giftTopics.ts) carrying only the topic and the language. In the grid every board game is OUR drawing (the
// end pose of its animation — the screen stays one piece); the shop's photo is the second slide of its sheet.

const AddToWishlistSheet = lazy(() => import('../AddToWishlistSheet'))

export interface TopicPageProps {
  userId: string
  /** the route's param: a known shelf, else the screen says it is not there */
  topic: string
}

/** The idea as the deck keeps it (the facts stay with the shelf). */
function plainIdea(idea: GiftTopicIdea): GiftIdea {
  const { id, title, image_url, price_min_cents, price_max_cents, offers, interests } = idea
  return { id, title, image_url, price_min_cents, price_max_cents, offers, interests }
}

export function TopicPage({ userId, topic }: TopicPageProps) {
  return isGiftTopic(topic) ? <TopicScreen userId={userId} topic={topic} /> : <UnknownTopic />
}

/** A link to a shelf we do not have (an old link, a typo): one calm page with the way back. */
function UnknownTopic() {
  const { t } = useTranslation('gifts')
  const navigate = useNavigate()
  return (
    <Page topBar={<TopBar back={{ label: t('gifts.title'), onClick: () => void navigate({ to: '/gifts', replace: true }) }} />}>
      <div className="flex flex-col items-center gap-3 rounded-(--r-card) p-6 pt-8 text-center glass-panel">
        <p className="t-headline text-text">{t('topics.unknown')}</p>
      </div>
    </Page>
  )
}

function TopicScreen({ userId, topic }: { userId: string; topic: GiftTopic }) {
  const { t } = useTranslation('gifts')
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const locale = currentLanguage()
  // the texts in the UI language (de / en / ru / uk; the Worker falls back per text) — part of the query key, so an
  // answer in one language is never shown in another
  const lang = locale
  const reduced = useReducedMotionPref()
  const [recipient] = useState(topicRecipient)
  const name = t(`topics.name.${topic}`)
  usePageTitle(name || APP_NAME)

  const shelf = useQuery({
    queryKey: ['gift-topic', userId, topic, lang],
    queryFn: ({ signal }) => fetchGiftTopic(topic, lang, { signal, expectedUserId: userId }),
    staleTime: 10 * 60_000,
    retry: (failures, err) => failures < 1 && !isGiftIdeasError(err, 'invalid_request'),
  })
  const items = useMemo(() => shelf.data?.items ?? [], [shelf.data])
  const games = items.some((item) => item.game !== null)

  const [filters, setFilters] = useState<TopicFilters>(NO_FILTERS)
  // the search inside the topic (27.10): on the device, as you type; closing it clears it
  const [search, setSearch] = useState<{ open: boolean; query: string }>({ open: false, query: '' })
  const hays = useMemo(() => new Map(items.map((item) => [item.id, haystack(item)] as const)), [items])
  const visible = (idea: GiftTopicIdea) => fitsFilters(idea, filters) && matchesSearch(hays.get(idea.id) ?? ['', ''], search.query)
  const [filterSheet, setFilterSheet] = useState<FilterKind | null>(null)
  // the sheet's idea stays while it slides away
  const [open, setOpen] = useState<{ idea: GiftTopicIdea | null; open: boolean }>({ idea: null, open: false })
  const [add, setAdd] = useState<{ idea: GiftIdea | null; open: boolean }>({ idea: null, open: false })
  const [, setAddedTick] = useState(0)

  const person = recipient.kind === 'person' ? recipient : null
  const saved = useSavedFor(userId, person?.profileId ?? null)
  const isDone = (idea: GiftIdea) => (person ? saved.some((known) => known.id === idea.id) : wasAddedToList(idea.id))

  function back() {
    if (canGoBack) router.history.back()
    else void navigate({ to: '/gifts', replace: true })
  }

  /** The "＋" of a card / the sheet's button: the deck's action for this recipient. */
  function act(idea: GiftTopicIdea) {
    if (person) {
      if (isDone(idea)) {
        haptic('tap')
        forgetIdeaFor(userId, person.profileId, idea.id)
        return
      }
      haptic('success')
      saveIdeaFor(userId, { profileId: person.profileId, name: person.name }, plainIdea(idea))
      toast.success(t('gifts.saved_toast', { name: firstName(person.name) }))
      return
    }
    if (isDone(idea)) return
    setOpen((now) => ({ ...now, open: false }))
    setAdd({ idea: plainIdea(idea), open: true })
  }

  function onAdded(idea: GiftIdea, result: { title: string; occasionId: string | null; listId: string }) {
    rememberAddedToList(idea.id)
    setAddedTick((n) => n + 1)
    setAdd((now) => ({ ...now, open: false }))
    haptic('success')
    const { occasionId, listId } = result
    toast.success(t('gifts.added_toast', { title: result.title }), {
      actionLabel: t('gifts.added_view'),
      onAction: () =>
        void (occasionId ? navigate({ to: '/occasions/$occasionId', params: { occasionId } }) : navigate({ to: '/lists/$listId', params: { listId } })),
    })
  }

  const actionLabel = (idea: GiftIdea) =>
    person ? (isDone(idea) ? t('gifts.stamp_saved') : t('gifts.like_for', { name: firstName(person.name) })) : isDone(idea) ? t('gifts.on_list') : t('gifts.add_to_list')

  const shown = items.filter(visible)
  const prices = items.length > 0 ? { price_min_cents: Math.min(...items.map((i) => i.price_min_cents)), price_max_cents: Math.max(...items.map((i) => i.price_max_cents)) } : null
  const countLabel = games ? t('topics.count_games', { count: items.length }) : t('topics.count_ideas', { count: items.length })
  const meta = prices ? `${countLabel} · ${priceRangeLabel(t, prices, locale)}` : null
  const sheetIdea = open.idea

  return (
    <Page topBar={<TopBar large title={name} back={{ label: t('gifts.title'), onClick: back }} />}>
      <div className="flex flex-col gap-4 pt-4" data-topic-screen="">
        <TopicHero topic={topic} title={name} sub={topic === 'brettspiele' ? t('topics.hero_sub_games') : t('topics.hero_sub')} meta={meta} reduced={reduced} />
        {shelf.isPending ? (
          <ul className="topic-grid" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i}>
                <Skeleton height={196} rounded="lg" />
              </li>
            ))}
          </ul>
        ) : shelf.isError ? (
          <div className="flex flex-col items-center gap-3 rounded-(--r-card) p-6 text-center glass-panel">
            <p className="t-headline text-text">{t('gifts.error_title')}</p>
            <p className="t-callout text-text-2">{isGiftIdeasError(shelf.error, 'offline') ? t('gifts.error_offline') : t('topics.error')}</p>
            <Button variant="primary" size="lg" fullWidth onClick={() => void shelf.refetch()}>
              {t('gifts.retry')}
            </Button>
          </div>
        ) : (
          <>
            <div className="topic-toolbar">
              <FilterPills filters={filters} games={games} onOpen={setFilterSheet} />
              <SearchButton open={search.open} label={t('topics.search_open')} onToggle={() => setSearch((now) => (now.open ? { open: false, query: '' } : { open: true, query: now.query }))} />
            </div>
            {search.open ? (
              <SearchField
                query={search.query}
                onQuery={(query) => setSearch({ open: true, query })}
                onClose={() => setSearch({ open: false, query: '' })}
                label={t('topics.search_label', { topic: name })}
                placeholder={t(games ? 'topics.search_placeholder_games' : topic === 'buecher' ? 'topics.search_placeholder_books' : 'topics.search_placeholder')}
              />
            ) : null}
            <p className="px-1 t-footnote text-text-2" aria-live="polite">
              {t('topics.shown', { shown: shown.length, total: items.length })}
            </p>
            {shown.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-(--r-card) p-6 text-center glass-panel">
                <p className="t-callout text-text-2">{search.query.trim() ? t('topics.search_none', { query: search.query.trim() }) : t('topics.none')}</p>
                {activeFilters(filters) > 0 ? (
                  <Button variant="secondary" size="md" onClick={() => setFilters(NO_FILTERS)}>
                    {t('topics.filter_reset')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <ul className="topic-grid" aria-label={name}>
              {items.map((idea) => (
                <li key={idea.id} hidden={!visible(idea)}>
                  <TopicCard
                    idea={idea}
                    reduced={reduced}
                    done={isDone(idea)}
                    actionLabel={actionLabel(idea)}
                    onOpen={() => {
                      haptic('tap')
                      setOpen({ idea, open: true })
                    }}
                    onAct={() => act(idea)}
                  />
                </li>
              ))}
            </ul>
            <p className="topic-foot">{t('topics.foot')}</p>
          </>
        )}
      </div>

      <FilterSheet
        kind={filterSheet}
        filters={filters}
        onChoose={(next) => {
          haptic('select')
          setFilters(next)
          setFilterSheet(null)
        }}
        onReset={activeFilters(filters) > 0 ? () => setFilters(NO_FILTERS) : null}
        onClose={() => setFilterSheet(null)}
      />
      <GameSheet
        idea={sheetIdea}
        open={open.open}
        onClose={() => setOpen((now) => ({ ...now, open: false }))}
        asOf={shelf.data?.as_of ?? null}
        reduced={reduced}
        action={
          sheetIdea ? (
            <Button
              size="lg"
              fullWidth
              variant={isDone(sheetIdea) ? 'secondary' : 'primary'}
              icon={isDone(sheetIdea) ? <IconCheck size={20} /> : <IconPlus size={20} />}
              disabled={!person && isDone(sheetIdea)}
              onClick={() => act(sheetIdea)}
            >
              {actionLabel(sheetIdea)}
            </Button>
          ) : undefined
        }
      />
      {add.idea ? (
        <Suspense fallback={null}>
          <AddToWishlistSheet userId={userId} idea={add.idea} open={add.open} onClose={() => setAdd((now) => ({ ...now, open: false }))} onAdded={onAdded} />
        </Suspense>
      ) : null}
    </Page>
  )
}

interface TopicCardProps {
  idea: GiftTopicIdea
  reduced: boolean
  done: boolean
  actionLabel: string
  onOpen: () => void
  onAct: () => void
}

/** One card of the grid: our drawing (or the idea's picture), the prize, the name, the facts, the price, "＋". */
function TopicCard({ idea, reduced, done, actionLabel, onOpen, onAct }: TopicCardProps) {
  const { t } = useTranslation('gifts')
  const locale = currentLanguage()
  const game = idea.game
  const name = game?.name ?? idea.title
  const look = lookOf(idea.id)
  const art = photoFallbackArt(idea.image_url) ?? drawnArtId(idea.image_url)
  return (
    <article className="topic-card" data-k="card" data-idea={idea.id}>
      <button type="button" className="topic-card-open" aria-label={game ? `${name}, ${factsLine(t, game, true)}` : name} onClick={onOpen} />
      <div className="topic-card-art">
        {look ? (
          <div className="tile topic-card-stage" data-tile={ARCH_TONE[look.archetype]}>
            <SceneArt look={look} reduced={reduced} className="topic-card-stage" />
          </div>
        ) : game && art ? (
          <GiftPicture idea={{ id: idea.id, image_url: `${GIFT_ART_PREFIX}${art}` }} />
        ) : (
          <GiftPicture idea={idea} credit={idea.offers[0]?.shop ?? null} />
        )}
        {game?.award ? (
          <span className="topic-award">
            <i aria-hidden="true">★</i>
            {awardShort(t, game.award)}
          </span>
        ) : null}
      </div>
      <div className="topic-card-body">
        <h3>{name}</h3>
        {game ? (
          <p className="topic-facts" aria-hidden="true">
            {factsLine(t, game)}
          </p>
        ) : idea.book ? (
          <p className="topic-facts">{idea.book.author}</p>
        ) : null}
        <div className="topic-buy">
          <b>{priceRangeLabel(t, idea, locale)}</b>
          <button type="button" className="topic-add" data-done={done ? '' : undefined} aria-pressed={done} aria-label={`${actionLabel}: ${name}`} onClick={onAct}>
            {done ? <IconCheck size={20} /> : <IconPlus size={20} />}
          </button>
        </div>
      </div>
    </article>
  )
}
