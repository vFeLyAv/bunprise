import { useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { APP_NAME } from '../../lib/app'
import type { GiftIdeasMode } from '../../lib/api/giftIdeas'
import { relativeDayLabel } from '../../lib/time'
import { MotionScope } from '../../motion/MotionScope'
import { Avatar, Button, LargeTitle, Page, Segmented, Skeleton, TopBar, fade, haptic, useReducedMotionPref, useSpring, useTapScale } from '../../ui'
import { usePageTitle } from '../auth/shared'
import { BunnyPeek } from '../wishes/BunnyPeek'
import { DeckMessage, DeckSkeleton } from './Deck'
import { IdeasSection } from './IdeasSection'
import { firstName } from './labels'
import { lastListOf, lastMode, lastPerson, rememberListOf, rememberMode, rememberPerson } from './session'
import { useGiftPeople, useLoadedLists, useMyGiftLists, type GiftListRef, type GiftPerson } from './sources'
import './gifts.css'

// "Ideen" (Find Gift, wave 2; Felix renamed the tab, pilot-decisions §000.11): a top-level tab screen.
//   [ Für jemanden | Für mich ]
//   Für jemanden: a person whose list I can see today (pluggable sources, sources.ts) → ideas from it.
//   Für mich:     my own lists' wishes → ideas to put on my list.
// Below: "Warum diese Ideen?", Pompon, the finite deck (IdeasSection). The products are an invented demo
// catalogue behind a stable contract (lib/api/giftIdeas.ts) until a partner program is decided.
// Animated inside its own <MotionScope> (docs/decisions/2026-10-20-motion-scope.md; the _authed layout has
// one too — nesting is harmless and keeps the screen animated wherever it is mounted).

export interface GiftsPageProps {
  /** the account of the screen (the _authed guard's session) */
  userId: string
}

export function GiftsPage({ userId }: GiftsPageProps) {
  const { t, ready } = useTranslation('gifts')
  const [mode, setMode] = useState<GiftIdeasMode>(() => lastMode() ?? 'for_someone')
  const reduced = useReducedMotionPref()
  const title = ready ? t('gifts.title') : ''
  usePageTitle(title || APP_NAME)

  function choose(next: GiftIdeasMode) {
    rememberMode(next)
    setMode(next)
  }

  return (
    <MotionScope>
      <Page topBar={<TopBar large title={title} />}>
        <div className="flex flex-col gap-4 pt-4">
          <LargeTitle className="mb-0">{ready ? title : <span aria-hidden="true" className="skeleton inline-block h-8 w-44 align-middle" />}</LargeTitle>
          <Segmented
            label={t('gifts.mode_label')}
            value={mode}
            onChange={choose}
            options={[
              { value: 'for_someone', label: t('gifts.mode_someone') },
              { value: 'for_me', label: t('gifts.mode_me') },
            ]}
          />
          <AnimatePresence mode="wait" initial={false}>
            <m.div
              key={mode}
              className="flex flex-col gap-4"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ ...fade, duration: 0.2 }}
            >
              {mode === 'for_someone' ? <ForSomeone userId={userId} onSwitchToMe={() => choose('for_me')} /> : <ForMe userId={userId} />}
            </m.div>
          </AnimatePresence>
        </div>
      </Page>
    </MotionScope>
  )
}

/** Offline before anything could load: say so (TanStack waits, paused, and loads by itself once back online). */
function IdeasOffline() {
  const { t } = useTranslation('gifts')
  return <DeckMessage title={t('gifts.error_title')} text={t('gifts.error_offline')} />
}

/** The panel and the deck in their loading shape (no spinner): Pompon is already sniffing. */
function IdeasPending({ mode }: { mode: GiftIdeasMode }) {
  const { t } = useTranslation('gifts')
  return (
    <>
      <section className="flex flex-col" data-gift-mode={mode}>
        <BunnyPeek mood="sniff" says={t('gifts.bunny_sniff')} className="pl-5" />
        <DeckSkeleton label={t('gifts.loading')} />
      </section>
      <div aria-hidden="true" className="flex flex-col gap-3 rounded-(--r-card) p-4 glass-panel">
        <Skeleton height={20} width="45%" />
        <Skeleton height={14} width="70%" />
        <div className="flex gap-2">
          <Skeleton height={36} width={110} rounded="full" />
          <Skeleton height={36} width={96} rounded="full" />
          <Skeleton height={36} width={84} rounded="full" />
        </div>
      </div>
    </>
  )
}

function whenOf(list: GiftListRef): string | null {
  if (!list.startsAt || !Number.isFinite(Date.parse(list.startsAt))) return null
  return relativeDayLabel(list.startsAt)
}

function PersonChip({ person, selected, onSelect }: { person: GiftPerson; selected: boolean; onSelect: () => void }) {
  const tap = useTapScale(0.95)
  const snappy = useSpring('snappy')
  return (
    <m.button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      className="gift-person"
      whileTap={tap}
      transition={snappy}
      onPointerDown={() => haptic('select')}
      onClick={onSelect}
    >
      <Avatar name={person.name} seed={person.profileId ?? person.key} size={32} />
      <span>{firstName(person.name)}</span>
    </m.button>
  )
}

/** Up to this many people wrap and share their line with the list caption; more scroll sideways (wave 2b: follows). */
const FEW_PEOPLE = 3

function PeopleRow({ people, selected, onSelect }: { people: readonly GiftPerson[]; selected: string; onSelect: (key: string) => void }) {
  const { t } = useTranslation('gifts')
  return (
    <div
      role="radiogroup"
      aria-label={t('gifts.people_label')}
      className={people.length > FEW_PEOPLE ? 'gift-scroller' : 'flex flex-wrap gap-2'}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        if (!step) return
        const index = people.findIndex((person) => person.key === selected)
        const next = people[(index + step + people.length) % people.length]
        if (!next) return
        event.preventDefault()
        onSelect(next.key)
        const buttons = event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')
        buttons[people.indexOf(next)]?.focus()
      }}
    >
      {people.map((person) => (
        <PersonChip key={person.key} person={person} selected={person.key === selected} onSelect={() => onSelect(person.key)} />
      ))}
    </div>
  )
}

function ForSomeone({ userId, onSwitchToMe }: { userId: string; onSwitchToMe: () => void }) {
  const { t } = useTranslation('gifts')
  const people = useGiftPeople(userId)
  const all = people.data ?? []
  const [personKey, setPersonKey] = useState<string | null>(() => lastPerson())
  const person = all.find((candidate) => candidate.key === personKey) ?? all[0] ?? null
  const [listKeys, setListKeys] = useState<Record<string, string>>({})
  const listKey = person ? (listKeys[person.key] ?? lastListOf(person.key)) : null
  const ref = person ? (person.lists.find((list) => list.key === listKey) ?? person.lists[0] ?? null) : null
  const refs = useMemo(() => (ref ? [ref] : []), [ref])
  const loaded = useLoadedLists(userId, refs)

  if (people.isPending && people.fetchStatus === 'paused') return <IdeasOffline />
  if (people.isPending) {
    return (
      <>
        <div aria-hidden="true" className="flex gap-2">
          <Skeleton height={44} width={112} rounded="full" />
          <Skeleton height={44} width={96} rounded="full" />
        </div>
        <IdeasPending mode="for_someone" />
      </>
    )
  }
  if (people.isError) {
    return (
      <DeckMessage title={t('gifts.error_title')} text={t('gifts.people_error')}>
        <Button variant="primary" size="lg" fullWidth onClick={() => void people.refetch()}>
          {t('gifts.retry')}
        </Button>
      </DeckMessage>
    )
  }
  if (!person || !ref) {
    return (
      <section className="flex flex-col">
        <BunnyPeek mood="hello" says={t('gifts.people_empty_title')} className="pl-5" />
        <DeckMessage title={t('gifts.people_empty_title')} text={t('gifts.people_empty_text')}>
          <Button variant="secondary" size="lg" fullWidth onClick={onSwitchToMe}>
            {t('gifts.people_empty_switch')}
          </Button>
        </DeckMessage>
      </section>
    )
  }

  const when = whenOf(ref)
  return (
    <>
      <div className="flex flex-col gap-2">
        {/* the people (they wrap; the pilot has a few), and — when there is one list — where it comes from,
            on the same line while it fits */}
        <div className={all.length > FEW_PEOPLE ? 'flex flex-col gap-1.5' : 'flex flex-wrap items-center gap-x-3 gap-y-1.5'}>
          <PeopleRow
            people={all}
            selected={person.key}
            onSelect={(key) => {
              rememberPerson(key)
              setPersonKey(key)
            }}
          />
          {person.lists.length > 1 ? null : (
            <p className="min-w-0 flex-1 basis-48 px-1 t-footnote text-text-2 [overflow-wrap:anywhere]">
              {when ? t('gifts.list_from_when', { list: ref.title, when }) : t('gifts.list_from', { list: ref.title })}
            </p>
          )}
        </div>
        {person.lists.length > 1 ? (
          <div role="radiogroup" aria-label={t('gifts.list_label')} className="gift-scroller">
            {person.lists.map((list) => {
              const on = list.key === ref.key
              return (
                <button
                  key={list.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  className="gift-interest hit-expand shrink-0"
                  data-kind="toggle"
                  onPointerDown={() => haptic('select')}
                  onClick={() => {
                    rememberListOf(person.key, list.key)
                    setListKeys((known) => ({ ...known, [person.key]: list.key }))
                  }}
                >
                  {list.title}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      {loaded.failed ? (
        <DeckMessage title={t('gifts.error_title')} text={t('gifts.list_error')}>
          <Button variant="primary" size="lg" fullWidth onClick={loaded.refetchFailed}>
            {t('gifts.retry')}
          </Button>
        </DeckMessage>
      ) : loaded.offline ? (
        <IdeasOffline />
      ) : (
        <IdeasSection
          key={`${person.key}|${ref.key}`}
          userId={userId}
          recipient={{ kind: 'person', key: person.key, name: person.name, profileId: person.profileId, listKey: ref.key }}
          lists={loaded.lists}
          listsReady={!loaded.pending && loaded.lists.length > 0}
        />
      )}
    </>
  )
}

/** "Für mich" looks at my nearest lists (at most three: one request each, shared with the occasion screens). */
const MY_LISTS_MAX = 3

function ForMe({ userId }: { userId: string }) {
  const { t } = useTranslation('gifts')
  const mine = useMyGiftLists(userId)
  const refs = useMemo(() => (mine.data ?? []).slice(0, MY_LISTS_MAX), [mine.data])
  const loaded = useLoadedLists(userId, refs)
  const first = refs[0]

  if ((mine.isPending && mine.fetchStatus === 'paused') || loaded.offline) return <IdeasOffline />
  if (mine.isPending) return <IdeasPending mode="for_me" />
  if (mine.isError || loaded.failed) {
    return (
      <DeckMessage title={t('gifts.error_title')} text={t('gifts.me_error')}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => {
            if (mine.isError) void mine.refetch()
            loaded.refetchFailed()
          }}
        >
          {t('gifts.retry')}
        </Button>
      </DeckMessage>
    )
  }
  const others = Math.max(0, refs.length - 1)
  return (
    <>
      <p className="-mt-1 px-1 t-footnote text-text-2 [overflow-wrap:anywhere]">
        {!first ? t('gifts.me_no_lists') : others > 0 ? t('gifts.me_from_more', { list: first.title, count: others }) : t('gifts.me_from', { list: first.title })}
      </p>
      <IdeasSection key="me" userId={userId} recipient={{ kind: 'me', key: 'me' }} lists={loaded.lists} listsReady={!loaded.pending} />
    </>
  )
}
