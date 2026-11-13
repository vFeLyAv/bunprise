import { Suspense, lazy, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { OccasionSections } from '../../../lib/api/types'
import { domainOf, formatApproxPrice } from '../../../lib/format'
import { useObjectUrl } from '../../../lib/objectUrl'
import { Chip, IconGift, IconPlus, IconTile, IconX, fade, haptic, springs } from '../../../ui'
import { listsEnabled } from '../../lists/flag'
import { POTLUCK_TITLE_MAX } from '../../potluck/cache'
import { extractLink } from '../../wishes/linkInput'
import { GiftTile, ShopTile } from '../../wishes/ShopTile'
import { WishThumb } from '../../wishes/WishPhoto'
import { useCalmMotion } from '../form/motion'
import { FieldMessage, FormBlock, FrostGroup, RowButton, useFormLayoutKey } from '../form/parts'
import {
  QUICK_WISHES_MAX,
  bringProblem,
  isReading,
  quickWishOf,
  siteOf,
  titleOf,
  wishCount,
  wishTextProblem,
  withAnswer,
  type BringProblem,
  type OccasionExtras,
  type PickedWish,
  type QuickWish,
  type WishTextProblem,
} from './model'
import { readLink } from './readLink'
import './extras.css'

// "Gleich mit eintragen" in the new-occasion form (Felix 26.10, extras/model.ts): right under "Was gibt's?" the
// parts the occasion offers get a quick field each, so the host does not have to open the occasion afterwards.
// - Wünsche: one row "Wünsche gleich eintragen" until tapped (the form stays calm for everyone who does not want
//   it), then a field for a title OR a pasted shop link — pasting a link adds it at once and our Worker reads it
//   like in the wish form (title, price, shop, photo); "Aus meinen Listen holen" picks wishes of my lists (they
//   move once the occasion exists). Each entry can be removed again.
// - Mitbringen (only while "Mitbringen" / "Beides" is chosen): the suggestions of the bring-along list as chips
//   (one tap = one entry) and a field for an own entry.
// Nothing is sent from here: the page saves it all after the occasion (extras/send.ts). Enter adds, it never
// submits the form. Rows arrive and leave with the form's springs; calm motion: a short fade only.
// Owner side (features/wishes/secrecy.test.ts): my own wishes only, nothing of the secret part.

const BringFromListsSheet = lazy(() => import('../../lists/BringFromListsSheet'))
const loadPicker = () => import('../../lists/BringFromListsSheet')

const SUGGESTIONS = ['suggest_salad', 'suggest_cake', 'suggest_drinks', 'suggest_games', 'suggest_speaker'] as const

export interface QuickExtrasProps {
  /** id base of the fields (useId of the form) */
  id: string
  value: OccasionExtras
  /** functional updates: a link's answer arrives later and must not undo what happened meanwhile */
  onChange: (update: (current: OccasionExtras) => OccasionExtras) => void
  /** what the occasion offers ("Was gibt's?"); 'wishes' while that choice is not offered */
  sections: OccasionSections
  /** the wish field is unfolded (the page keeps it: the form's layout key follows it) */
  wishesOpen: boolean
  onWishesOpen: (open: boolean) => void
}

export function QuickExtras({ id, value, onChange, sections, wishesOpen, onWishesOpen }: QuickExtrasProps) {
  const calm = useCalmMotion()
  // measured only when the form's layout key changes (not on every typed letter)
  const layoutKey = useFormLayoutKey()
  const show = (key: string, node: ReactNode) => (
    <m.div
      key={key}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={fade}
      layout={calm ? false : 'position'}
      layoutDependency={layoutKey}
    >
      {node}
    </m.div>
  )
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {sections !== 'bring'
        ? show('wishes', <WishesPart id={`${id}-wishes`} value={value} onChange={onChange} open={wishesOpen} onOpen={onWishesOpen} />)
        : null}
      {sections !== 'wishes' ? show('bring', <BringPart id={`${id}-bring`} value={value} onChange={onChange} />) : null}
    </AnimatePresence>
  )
}

/** The springs of a row that arrives in a group (calm: a fade). */
function useRowMotion() {
  const calm = useCalmMotion()
  const layoutKey = useFormLayoutKey()
  return calm
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: fade, layout: false as const }
    : {
        initial: { opacity: 0, y: -8, scale: 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, scale: 0.96, transition: { duration: 0.14 } },
        transition: { ...springs.smooth, opacity: fade },
        layout: 'position' as const,
        layoutDependency: layoutKey,
      }
}

// ---- the field ------------------------------------------------------------------------------------------

interface AddFieldProps {
  id: string
  tile: ReactNode
  label: string
  placeholder: string
  addLabel: string
  value: string
  onValueChange: (next: string) => void
  onAdd: (text: string) => void
  /** a paste that is a whole entry by itself (a shop link) is added at once */
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void
  invalid?: boolean
  describedBy?: string
  maxLength?: number
  inputRef?: Ref<HTMLInputElement>
}

/** Tile + one-line field + round "+": Enter adds (never submits the occasion), the field stays for the next one. */
function AddField({ id, tile, label, placeholder, addLabel, value, onValueChange, onAdd, onPaste, invalid, describedBy, maxLength, inputRef }: AddFieldProps) {
  const empty = value.trim() === ''
  return (
    <div className="of-row ox-field">
      {tile}
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="ox-input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        enterKeyHint="done"
        autoComplete="off"
        maxLength={maxLength}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onValueChange(event.target.value)}
        onPaste={onPaste}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          // a field inside the occasion form: Enter must never save the occasion
          event.preventDefault()
          onAdd(value)
        }}
      />
      <button type="button" className="ox-add" aria-label={addLabel} disabled={empty} onClick={() => onAdd(value)}>
        <span className="ox-add-dot" aria-hidden="true">
          <IconPlus size={18} />
        </span>
      </button>
    </div>
  )
}

function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      className="ox-remove"
      aria-label={label}
      onClick={() => {
        haptic('tap')
        onPress()
      }}
    >
      <IconX size={18} />
    </button>
  )
}

// ---- Wünsche ----------------------------------------------------------------------------------------------

function WishesPart({ id, value, onChange, open, onOpen }: { id: string; value: OccasionExtras; onChange: QuickExtrasProps['onChange']; open: boolean; onOpen: (open: boolean) => void }) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<WishTextProblem | 'full' | null>(null)
  const [picker, setPicker] = useState<'closed' | 'open' | 'shut'>('closed')
  const inputRef = useRef<HTMLInputElement>(null)
  const focusNext = useRef(false)
  const row = useRowMotion()
  const count = wishCount(value)
  const lists = listsEnabled()
  const msgId = `${id}-msg`

  // unfolded by a tap: the field takes the focus (the keyboard comes up for the first wish)
  useEffect(() => {
    if (open && focusNext.current) {
      focusNext.current = false
      inputRef.current?.focus()
    }
  }, [open])

  function add(raw: string) {
    const found = wishTextProblem(raw)
    if (found === 'empty') return
    if (found) {
      setProblem(found)
      return
    }
    if (value.wishes.length >= QUICK_WISHES_MAX) {
      setProblem('full')
      return
    }
    const key = crypto.randomUUID()
    const wish = quickWishOf(raw, key, null)
    const read = wish.url ? readLink(wish.url) : null
    onChange((current) => ({ ...current, wishes: [...current.wishes, { ...wish, read }] }))
    if (read) void read.then((answer) => onChange((current) => withAnswer(current, key, answer)))
    setText('')
    setProblem(null)
    haptic('tap')
  }

  if (!open && count === 0) {
    return (
      <FrostGroup className="ox-group">
        <RowButton
          className="of-row-cta"
          tile={
            <IconTile tone="apricot">
              <IconGift size={18} />
            </IconTile>
          }
          label={t('occasionForm.extras_wishes_add')}
          sub={t('occasionForm.extras_wishes_add_hint')}
          trailing={<IconPlus size={20} className="of-row-chevron" />}
          onClick={() => {
            focusNext.current = true
            onOpen(true)
          }}
        />
      </FrostGroup>
    )
  }

  const problemText =
    problem === 'too_long'
      ? t('potluck.error_too_long', { ns: 'occasion', max: 120 })
      : problem === 'full'
        ? t('occasionForm.extras_wishes_full')
        : undefined
  const pickedIds = new Set(value.picked.map((picked) => picked.wish.id))

  return (
    <>
      <FrostGroup className="ox-group" role="group" aria-label={t('occasionForm.extras_wishes_title')}>
        <AddField
          id={`${id}-field`}
          inputRef={inputRef}
          tile={
            <IconTile tone="apricot">
              <IconGift size={18} />
            </IconTile>
          }
          label={t('occasionForm.extras_wish_label')}
          placeholder={t('occasionForm.extras_wish_placeholder')}
          addLabel={t('occasionForm.extras_wish_add')}
          value={text}
          onValueChange={(next) => {
            setText(next)
            if (problem) setProblem(null)
          }}
          onAdd={add}
          onPaste={(event) => {
            // a pasted shop link is a wish by itself: in at once (typed text first? then it joins the field)
            const pasted = event.clipboardData.getData('text')
            if (text.trim() !== '' || !extractLink(pasted)) return
            event.preventDefault()
            add(pasted)
          }}
          invalid={Boolean(problemText)}
          describedBy={msgId}
        />
        <ul className="ox-list ox-list-wishes" aria-label={t('occasionForm.extras_wishes_title')}>
          <AnimatePresence initial={false}>
            {value.wishes.map((wish) => (
              <m.li key={wish.key} className="of-item" {...row}>
                <QuickWishRow
                  wish={wish}
                  onRemove={() => onChange((current) => ({ ...current, wishes: current.wishes.filter((other) => other.key !== wish.key) }))}
                />
              </m.li>
            ))}
            {value.picked.map((picked) => (
              <m.li key={`picked-${picked.wish.id}`} className="of-item" {...row}>
                <PickedRow
                  picked={picked}
                  onRemove={() => onChange((current) => ({ ...current, picked: current.picked.filter((other) => other.wish.id !== picked.wish.id) }))}
                />
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
        {lists ? (
          <div className="of-item ox-from-lists">
            <RowButton
              className="of-row-cta"
              tile={
                <IconTile tone="lilac">
                  <IconFromLists size={18} />
                </IconTile>
              }
              label={t('occasionForm.extras_from_lists')}
              onPointerEnter={() => void loadPicker().catch(() => undefined)}
              onFocus={() => void loadPicker().catch(() => undefined)}
              onClick={() => setPicker('open')}
            />
          </div>
        ) : null}
      </FrostGroup>
      <FormBlock>
        <FieldMessage id={msgId} error={problemText} hint={count > 0 ? t('occasionForm.extras_saved_with') : t('occasionForm.extras_wish_hint')} />
      </FormBlock>
      {lists && picker !== 'closed' ? (
        <Suspense fallback={null}>
          <BringFromListsSheet
            open={picker === 'open'}
            onClose={() => setPicker('shut')}
            exclude={pickedIds}
            onPick={({ wishes, listId, listTitle }) =>
              onChange((current) => {
                const have = new Set(current.picked.map((picked) => picked.wish.id))
                const fresh: PickedWish[] = wishes.filter((wish) => !have.has(wish.id)).map((wish) => ({ wish, listId, listTitle }))
                return { ...current, picked: [...current.picked, ...fresh] }
              })
            }
          />
        </Suspense>
      ) : null}
    </>
  )
}

/** The product photo our Worker brought for the link (prepared on the device): an object URL of OUR bytes. */
function PreparedThumb({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  return <span className="ox-lead ox-lead-photo">{url ? <img src={url} alt="" draggable={false} className="ox-lead-img" /> : null}</span>
}

function QuickWishRow({ wish, onRemove }: { wish: QuickWish; onRemove: () => void }) {
  const { t } = useTranslation('occasionForm')
  const reading = isReading(wish)
  const site = siteOf(wish)
  const title = titleOf(wish)
  const preview = wish.answer?.preview ?? null
  const photo = wish.answer?.photo ?? null
  const price = formatApproxPrice(preview?.priceCents ?? null)
  let sub: ReactNode = null
  if (reading) {
    sub = <span className="ox-reading">{t('occasionForm.extras_reading')}</span>
  } else if (wish.url && !preview) {
    sub = t('occasionForm.extras_link_unread')
  } else if (wish.url && !wish.typed.trim() && !preview?.title) {
    sub = [site, t('occasionForm.extras_link_no_title')].filter(Boolean).join(' · ')
  } else if (wish.url) {
    sub = [price, site].filter(Boolean).join(' · ') || null
  }
  return (
    <div className="of-row ox-entry" data-reading={reading ? '' : undefined}>
      {photo ? (
        <PreparedThumb blob={photo.blob} />
      ) : site ? (
        <ShopTile site={site} host={domainOf(wish.answer?.preview?.url ?? wish.url)} className="ox-lead" />
      ) : (
        <GiftTile seed={wish.key} className="ox-lead" />
      )}
      <span className="of-row-text">
        <span className="of-row-label ox-entry-title">{title}</span>
        {sub ? <span className="of-row-sub">{sub}</span> : null}
      </span>
      <RemoveButton label={t('occasionForm.extras_remove', { title: title || site || '' })} onPress={onRemove} />
    </div>
  )
}

function PickedRow({ picked, onRemove }: { picked: PickedWish; onRemove: () => void }) {
  const { t } = useTranslation('occasionForm')
  const { wish } = picked
  const price = formatApproxPrice(wish.price_cents, { currency: wish.currency })
  const from = t('occasionForm.extras_from_list', { list: picked.listTitle })
  return (
    <div className="of-row ox-entry">
      <WishThumb wish={wish} className="ox-lead ox-lead-photo" imgClassName="ox-lead-img">
        <GiftTile seed={wish.id} className="ox-lead" />
      </WishThumb>
      <span className="of-row-text">
        <span className="of-row-label ox-entry-title">{wish.title}</span>
        <span className="of-row-sub">{[price, from].filter(Boolean).join(' · ')}</span>
      </span>
      <RemoveButton label={t('occasionForm.extras_remove', { title: wish.title })} onPress={onRemove} />
    </div>
  )
}

// ---- Mitbringen -------------------------------------------------------------------------------------------

function BringPart({ id, value, onChange }: { id: string; value: OccasionExtras; onChange: QuickExtrasProps['onChange'] }) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<BringProblem | null>(null)
  const row = useRowMotion()
  const msgId = `${id}-msg`
  const taken = new Set(value.items.map((item) => item.title.toLocaleLowerCase()))
  const suggestions = SUGGESTIONS.map((key) => t(`potluck.${key}`, { ns: 'occasion' })).filter((label) => !taken.has(label.toLocaleLowerCase()))

  function add(raw: string, fromField: boolean) {
    const found = bringProblem(raw, value.items)
    if (found === 'empty') return
    if (found) {
      if (fromField) setProblem(found)
      return
    }
    const title = raw.trim()
    onChange((current) => ({ ...current, items: [...current.items, { key: crypto.randomUUID(), title }] }))
    if (fromField) setText('')
    setProblem(null)
    haptic('tap')
  }

  const problemText =
    problem === 'too_long'
      ? t('potluck.error_too_long', { ns: 'occasion', max: POTLUCK_TITLE_MAX })
      : problem === 'one_line'
        ? t('potluck.error_one_line', { ns: 'occasion' })
        : problem === 'duplicate'
          ? t('occasionForm.extras_bring_duplicate')
          : problem === 'full'
            ? t('potluck.full', { ns: 'occasion', max: 50 })
            : undefined

  return (
    <>
      <FrostGroup className="ox-group" role="group" aria-label={t('potluck.title', { ns: 'occasion' })}>
        <AddField
          id={`${id}-field`}
          tile={
            <IconTile tone="sage">
              <IconBasket size={18} />
            </IconTile>
          }
          label={t('occasionForm.extras_bring_label')}
          placeholder={t('occasionForm.extras_bring_placeholder')}
          addLabel={t('occasionForm.extras_bring_add')}
          value={text}
          maxLength={POTLUCK_TITLE_MAX * 2}
          onValueChange={(next) => {
            setText(next)
            if (problem) setProblem(null)
          }}
          onAdd={(raw) => add(raw, true)}
          invalid={Boolean(problemText)}
          describedBy={msgId}
        />
        <AnimatePresence initial={false}>
          {suggestions.length > 0 ? (
            <m.div key="chips" className="of-item ox-chips-item" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
              <div role="group" aria-label={t('potluck.suggestions_label', { ns: 'occasion' })} className="ox-chips">
                {suggestions.map((label) => (
                  <Chip key={label} icon={<IconPlus size={16} />} onClick={() => add(label, false)}>
                    {label}
                  </Chip>
                ))}
              </div>
            </m.div>
          ) : null}
        </AnimatePresence>
        <ul className="ox-list ox-list-bring" aria-label={t('potluck.title', { ns: 'occasion' })}>
          <AnimatePresence initial={false}>
            {value.items.map((item) => (
              <m.li key={item.key} className="of-item" {...row}>
                <div className="of-row ox-entry ox-entry-plain">
                  <span className="of-row-text">
                    <span className="of-row-label ox-entry-title">{item.title}</span>
                  </span>
                  <RemoveButton
                    label={t('occasionForm.extras_remove', { title: item.title })}
                    onPress={() => onChange((current) => ({ ...current, items: current.items.filter((other) => other.key !== item.key) }))}
                  />
                </div>
              </m.li>
            ))}
          </AnimatePresence>
        </ul>
      </FrostGroup>
      <FormBlock>
        <FieldMessage id={msgId} error={problemText} hint={t('potluck.gift_hint', { ns: 'occasion' })} />
      </FormBlock>
    </>
  )
}

// ---- icons (own drawings on the kit's 24 px grid; only this chunk needs them) ------------------------------

function IconPath({ d, size = 24 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  )
}

/** a basket: things to bring */
function IconBasket({ size }: { size?: number }) {
  return <IconPath size={size} d="M3.5 10h17l-1.7 8.3a2 2 0 0 1-2 1.7H7.2a2 2 0 0 1-2-1.7zM8.5 10 11 4.5M15.5 10 13 4.5M9.5 14v2.5M14.5 14v2.5" />
}

/** an arrow into a tray: wishes come over from my lists */
function IconFromLists({ size }: { size?: number }) {
  return <IconPath size={size} d="M12 3.5v10M8 9.5l4 4 4-4M4 14.5v3a2.5 2.5 0 0 0 2.5 2.5h11a2.5 2.5 0 0 0 2.5-2.5v-3" />
}
