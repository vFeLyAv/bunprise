import { useId, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { createList, newListId, updateList } from '../../lib/api/lists'
import {
  COVER_ICONS,
  LIST_DATE_MONTHS,
  LIST_TITLE_MAX,
  STANDALONE_LIST_LIMIT,
  type CoverIcon,
  type CoverTone,
  type ListScreen,
  type ListsOverview,
  type ListVisibility,
  type OwnerListCard,
} from '../../lib/api/lists.types'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { ensureNamespaces } from '../../lib/i18n'
import { toast } from '../../lib/toast'
import { useMotionLevel } from '../../motion/useMotionLevel'
import { Button, Chip, IconCheck, TextField, cn, haptic, tileTone, useBunniesShown, useSpring, useTapScale } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { DateField } from '../occasions/form/DateField'
import { CoverGlyph, CoverTile } from './covers'
import { noteCreated } from './createFlow'
import { addMonthsKey, todayKey } from './dates'
import { GlyphLock, GlyphPeople } from './OwnerListCard'
import { insertOwnCard, invalidateLists, listsKeys, patchOwnCard, removeOwnCard, updateListScreen, updateOverview } from './queries'
import type { ListTemplate } from './templates'
import { LIST_TEMPLATES } from './templates'

// "Neue Wunschliste" / "Liste bearbeiten" (follows-design §2.6) — OWNER module.
// - Title ≤ 80, templates fill title + symbol only (never a date, never the visibility), cover = tone 1–4 +
//   symbol, an optional date (the wave-1 date picker, today … +24 months: the day of a party, not a birthday).
// - "Wer sieht die Liste?": "Nur ich" PRESELECTED (§00 p. 4), "Meine Follower (N Personen)" one tap away; no
//   path creates a follower list without that tap (W09). Editing never touches the visibility (own sheet).
// - "Anlegen" = REST insert with a client-made id, OPTIMISTIC with rollback: the card is in "Meine" at once
//   (Pompon carries it in at motion "Voll", createFlow.ts) and the list opens once the server has it. The
//   21st list → the limit text. A save belongs to the account that started it (captureEpoch).

// the wave-1 date picker reads these namespaces; this chunk loads on idle, long before the first tap
void ensureNamespaces('occasionForm', 'occasion')

export type ListSheetMode =
  | { kind: 'create' }
  | { kind: 'edit'; list: { id: string; title: string; cover_tone: CoverTone | null; cover_icon: CoverIcon | null; due_on: string | null } }

export interface CreateListSheetProps {
  open: boolean
  onClose: () => void
  userId: string
  /** create (default) or edit an existing list (title, cover, date) */
  mode?: ListSheetMode
  /** a template tapped in "Meine" (fills title + symbol) */
  template?: ListTemplate | null
  /** stats.followers, for "Meine Follower (N Personen)" — null when unknown */
  followers?: number | null
  /** own lists without an occasion right now — null when unknown (the server decides then) */
  standaloneCount?: number | null
}

const TONES: readonly CoverTone[] = [1, 2, 3, 4]

export default function CreateListSheet({ open, onClose, userId, mode = { kind: 'create' }, template = null, followers = null, standaloneCount = null }: CreateListSheetProps) {
  const { t, i18n } = useTranslation('lists')
  const queryClient = useQueryClient()
  const online = useOnline()
  const motionLevel = useMotionLevel()
  const bunnies = useBunniesShown()
  const editing = mode.kind === 'edit' ? mode.list : null
  const ids = { title: useId(), date: useId(), dateError: useId() }
  const submitRef = useRef<HTMLDivElement>(null)

  const today = todayKey()
  const maxDate = addMonthsKey(today, LIST_DATE_MONTHS)
  const [draft, setDraft] = useState(() => initialDraft(editing, template, t))
  const [touched, setTouched] = useState(false)
  const [limitShown, setLimitShown] = useState(false)
  const [busy, setBusy] = useState(false)
  // every opening starts fresh (a new id, the template of this tap, the list as it is now)
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  const key = open ? `${editing?.id ?? 'new'}:${template?.id ?? ''}` : null
  if (key !== openedFor) {
    setOpenedFor(key)
    if (open) {
      setDraft(initialDraft(editing, template, t))
      setTouched(false)
      setLimitShown(false)
    }
  }

  const title = draft.title.trim()
  const titleLength = [...draft.title].length
  const titleError = touched && title === '' ? t('lists.create.title_required') : titleLength > LIST_TITLE_MAX ? t('lists.create.title_too_long', { max: LIST_TITLE_MAX }) : undefined
  const dateTooFar = draft.date !== '' && draft.date > maxDate
  const tone: CoverTone = draft.tone ?? tileTone(draft.id)
  const atLimit = !editing && standaloneCount !== null && standaloneCount >= STANDALONE_LIST_LIMIT

  async function submit() {
    setTouched(true)
    if (title === '' || titleLength > LIST_TITLE_MAX || dateTooFar || busy) return
    if (!online) {
      toast.error(t('lists.create.offline'))
      return
    }
    if (atLimit) {
      setLimitShown(true)
      feedback('warning')
      return
    }
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    if (editing) await saveEdit(epoch)
    else await saveNew(epoch)
  }

  async function saveNew(epoch: ReturnType<typeof captureEpoch>) {
    const id = draft.id
    const due_on = draft.date || null
    const card: OwnerListCard = {
      id, title, kind: 'standalone', visibility: draft.visibility, cover_tone: draft.tone, cover_icon: draft.icon, due_on,
      wish_count: 0, occasion: null, created_at: new Date().toISOString(),
    }
    const me = queryClient.getQueryData<ListsOverview>(listsKeys.overview())?.me
    updateOverview(queryClient, (overview) => insertOwnCard(overview, card, today))
    // the list's own screen is ready before the server answered (it opens right after the carry)
    queryClient.setQueryData<ListScreen>(listsKeys.list(id), {
      list: {
        id, title, kind: 'standalone', visibility: draft.visibility, cover_tone: draft.tone, cover_icon: draft.icon, due_on,
        created_at: card.created_at, owner: { id: userId, display_name: me?.display_name ?? null, banner: me?.banner ?? null },
      },
      viewer: { role: 'owner' },
      wishes: [],
    })
    let settle: (ok: boolean) => void = () => undefined
    const saved = new Promise<boolean>((resolve) => {
      settle = resolve
    })
    noteCreated({ listId: id, from: submitRef.current?.getBoundingClientRect() ?? null, carry: motionLevel === 'full' && bunnies, saved })
    feedback('success')
    onClose()
    try {
      await createList({ id, title, visibility: draft.visibility, cover_tone: draft.tone, cover_icon: draft.icon, due_on }, userId)
      if (!epoch.isCurrent()) return settle(false)
      settle(true)
      // a list of their own: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
      void import('../sammlung/note').then((m) => m.noteMilestone('list'), () => undefined)
      void invalidateLists(queryClient, id).catch(() => undefined)
    } catch (err) {
      settle(false)
      if (!epoch.isCurrent()) return
      // rollback: the card leaves "Meine" again, the prepared screen is dropped
      updateOverview(queryClient, (overview) => removeOwnCard(overview, id))
      queryClient.removeQueries({ queryKey: listsKeys.list(id), exact: true })
      feedback('error')
      const error = toAppError(err)
      toast.error(error.code === 'limit_reached' ? t('lists.create.limit') : error.code === 'network' ? t('lists.create.offline') : t(error.key, error.params))
    }
  }

  async function saveEdit(epoch: ReturnType<typeof captureEpoch>) {
    if (!editing) return
    const patch = { title, cover_tone: draft.tone, cover_icon: draft.icon, due_on: draft.date || null }
    const beforeOverview = queryClient.getQueryData<ListsOverview>(listsKeys.overview())
    const beforeScreen = queryClient.getQueryData<ListScreen>(listsKeys.list(editing.id))
    updateOverview(queryClient, (overview) => patchOwnCard(overview, editing.id, patch))
    updateListScreen(queryClient, editing.id, (screen) => ({ ...screen, list: { ...screen.list, ...patch } }))
    setBusy(true)
    onClose()
    try {
      await updateList(editing.id, patch, userId)
      if (!epoch.isCurrent()) return
      feedback('success')
      void invalidateLists(queryClient, editing.id).catch(() => undefined)
    } catch (err) {
      if (!epoch.isCurrent()) return
      if (beforeOverview) queryClient.setQueryData(listsKeys.overview(), beforeOverview)
      if (beforeScreen) queryClient.setQueryData(listsKeys.list(editing.id), beforeScreen)
      feedback('error')
      const error = toAppError(err)
      toast.error(error.code === 'network' ? t('lists.create.offline') : t(error.key, error.params))
    } finally {
      if (epoch.isCurrent()) setBusy(false)
    }
  }

  const locale = i18n.resolvedLanguage ?? 'de'
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? t('lists.create.edit_title') : t('lists.create.title')}
      closeLabel={t('common.close')}
      detent="full"
      footer={
        <div className="flex flex-col gap-2">
          {limitShown ? (
            <p role="alert" className="t-footnote text-danger">
              {t('lists.create.limit')}
            </p>
          ) : null}
          <div ref={submitRef}>
            <Button size="lg" fullWidth disabled={!online || busy} loading={busy} onClick={() => void submit()}>
              {editing ? t('lists.create.save') : t('lists.create.submit')}
            </Button>
          </div>
        </div>
      }
    >
      <form
        className="flex flex-col gap-6 pb-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="flex items-start gap-3">
          <CoverTile tone={tone} icon={draft.icon} size={52} className="mt-6" />
          <div className="min-w-0 flex-1">
            <TextField
              id={ids.title}
              label={t('lists.create.title_label')}
              placeholder={t('lists.create.title_placeholder')}
              value={draft.title}
              maxLength={LIST_TITLE_MAX + 20}
              enterKeyHint="done"
              autoComplete="off"
              error={titleError}
              hint={t('lists.create.count', { count: titleLength, max: LIST_TITLE_MAX })}
              onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
              onBlur={() => setTouched(true)}
            />
          </div>
        </div>

        {!editing ? (
          <Group label={t('lists.create.templates')}>
            <div className="lcs-chips">
              {LIST_TEMPLATES.map((entry) => (
                <Chip
                  key={entry.id}
                  icon={<CoverGlyph icon={entry.icon} size={16} />}
                  selected={draft.title === t(entry.titleKey) && draft.icon === entry.icon}
                  onClick={() => setDraft((value) => ({ ...value, title: t(entry.titleKey), icon: entry.icon }))}
                >
                  {t(entry.titleKey)}
                </Chip>
              ))}
            </div>
          </Group>
        ) : null}

        <Group label={t('lists.create.look')}>
          <div className="glass-panel lcs-look">
            <div role="radiogroup" aria-label={t('lists.create.tone')} className="lcs-tones">
              {TONES.map((value) => (
                <ToneChoice key={value} tone={value} selected={tone === value} label={t('lists.create.tone_option', { n: value })}
                  onSelect={() => setDraft((draftNow) => ({ ...draftNow, tone: value }))} />
              ))}
            </div>
            <div role="radiogroup" aria-label={t('lists.create.icon')} className="lcs-icons">
              {COVER_ICONS.map((value) => (
                <IconChoice key={value} icon={value} tone={tone} selected={(draft.icon ?? 'gift') === value} label={t(`lists.icons.${value}`)}
                  onSelect={() => setDraft((draftNow) => ({ ...draftNow, icon: value }))} />
              ))}
            </div>
          </div>
        </Group>

        <Group label={t('lists.create.date')}>
          <div className="glass-panel lcs-date">
            <DateField
              id={ids.date}
              value={draft.date}
              // a chosen day closes the month grid, like the occasion form (the row shows the day); a pick made
              // inside the grid (keyboard) hands the focus back to the row instead of losing it
              onChange={(date) => {
                const fromPanel = document.getElementById(`${ids.date}-panel`)?.contains(document.activeElement) ?? false
                setDraft((value) => ({ ...value, date, dateOpen: false }))
                if (fromPanel) document.getElementById(ids.date)?.focus({ preventScroll: true })
              }}
              today={today}
              min={today}
              locale={locale}
              tone={tone}
              open={draft.dateOpen}
              onOpenChange={(dateOpen) => setDraft((value) => ({ ...value, dateOpen }))}
              errorId={ids.dateError}
              error={dateTooFar ? t('lists.create.date_too_far') : undefined}
            />
          </div>
          {dateTooFar ? <p id={ids.dateError} role="alert" className="t-footnote text-danger">{t('lists.create.date_too_far')}</p> : null}
          {/* the hint stays right under the date; "Ohne Datum" sits beside it once a day is chosen */}
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 t-footnote text-text-2">{t('lists.create.date_hint')}</p>
            {draft.date ? (
              <Chip onClick={() => setDraft((value) => ({ ...value, date: '', dateOpen: false }))}>{t('lists.create.date_clear')}</Chip>
            ) : null}
          </div>
        </Group>

        {!editing ? (
          <Group label={t('lists.create.who')} hint={t('lists.create.followers_hint')}>
            <div role="radiogroup" aria-label={t('lists.create.who')} className="lcs-who">
              <WhoChoice
                selected={draft.visibility === 'private'}
                icon={<GlyphLock />}
                title={t('lists.create.private')}
                hint={t('lists.create.private_hint')}
                onSelect={() => setDraft((value) => ({ ...value, visibility: 'private' }))}
              />
              <WhoChoice
                selected={draft.visibility === 'followers'}
                icon={<GlyphPeople />}
                title={t('lists.create.followers')}
                hint={followers === null ? null : t('lists.create.followers_count', { count: followers })}
                onSelect={() => setDraft((value) => ({ ...value, visibility: 'followers' }))}
              />
            </div>
          </Group>
        ) : null}
      </form>
    </Sheet>
  )
}

interface Draft {
  /** the new list's id (its colour before a tone is chosen) */
  id: string
  title: string
  tone: CoverTone | null
  icon: CoverIcon | null
  date: string
  dateOpen: boolean
  visibility: ListVisibility
}

function initialDraft(editing: Extract<ListSheetMode, { kind: 'edit' }>['list'] | null, template: ListTemplate | null, t: (key: string) => string): Draft {
  if (editing) {
    return { id: editing.id, title: editing.title, tone: editing.cover_tone, icon: editing.cover_icon, date: editing.due_on ?? '', dateOpen: false, visibility: 'private' }
  }
  // "Nur ich" first, always (follows-design §00 p. 4, W09) — a template never changes it
  return { id: newListId(), title: template ? t(template.titleKey) : '', tone: null, icon: template?.icon ?? null, date: '', dateOpen: false, visibility: 'private' }
}

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="lcs-label">{label}</h3>
      {children}
      {hint ? <p className="t-footnote text-text-2">{hint}</p> : null}
    </section>
  )
}

function ToneChoice({ tone, selected, label, onSelect }: { tone: CoverTone; selected: boolean; label: string; onSelect: () => void }) {
  const tap = useTapScale(0.92)
  const spring = useSpring('snappy')
  return (
    <m.button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      data-tone={tone}
      className="lcs-tone"
      whileTap={tap}
      transition={spring}
      onPointerDown={() => haptic('select')}
      onClick={onSelect}
    >
      {selected ? <IconCheck size={18} /> : null}
    </m.button>
  )
}

function IconChoice({ icon, tone, selected, label, onSelect }: { icon: CoverIcon; tone: CoverTone; selected: boolean; label: string; onSelect: () => void }) {
  const tap = useTapScale(0.92)
  const spring = useSpring('snappy')
  return (
    <m.button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      data-tone={tone}
      className={cn('lcs-icon', selected && 'lcs-icon-on')}
      whileTap={tap}
      transition={spring}
      onPointerDown={() => haptic('select')}
      onClick={onSelect}
    >
      <CoverGlyph icon={icon} size={22} />
    </m.button>
  )
}

function WhoChoice({ selected, icon, title, hint, onSelect }: { selected: boolean; icon: ReactNode; title: string; hint: string | null; onSelect: () => void }) {
  const tap = useTapScale(0.98)
  const spring = useSpring('snappy')
  return (
    <m.button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn('lcs-who-option glass-panel', selected && 'lcs-who-on')}
      whileTap={tap}
      transition={spring}
      onPointerDown={() => haptic('select')}
      onClick={onSelect}
    >
      <span className="lcs-who-head">
        <span aria-hidden="true" className="lcs-who-icon">{icon}</span>
        <span aria-hidden="true" className="lcs-who-radio">{selected ? <span className="lcs-who-dot" /> : null}</span>
      </span>
      <span className="lcs-who-title">{title}</span>
      {hint ? <span className="lcs-who-hint">{hint}</span> : null}
    </m.button>
  )
}
