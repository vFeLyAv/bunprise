import { useRef, useState, type ReactNode } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { setListVisibility } from '../../lib/api/lists'
import type { ListVisibility } from '../../lib/api/lists.types'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { toast } from '../../lib/toast'
import { Button, cn, fade, haptic, useReducedMotionPref, useSpring } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { GlyphLock, GlyphPeople } from './OwnerListCard'

// "Wer sieht die Liste?" of an existing list (follows-design §2.7) — OWNER module. The visibility changes ONLY
// through set_list_visibility and waits for the server (not optimistic). "Meine Follower → Nur ich" goes
// through a SEPARATE confirm step with a STATIC sentence ("Was deine Follower hier heimlich geplant haben …")
// and the button "Nur für mich sichtbar machen" — the same words and the same step whatever is on the list
// and however many followers there are (W01: nothing here depends on anyone else's actions). The way back
// ("Nur ich → Meine Follower") needs no confirmation and brings nothing back.

export interface VisibilitySheetProps {
  open: boolean
  onClose: () => void
  listId: string
  visibility: ListVisibility
  /** stats.followers for "(N Personen)" — null when unknown */
  followers: number | null
  userId: string
  /** the server confirmed the change */
  onChanged: (visibility: ListVisibility) => void
}

export function VisibilitySheet({ open, onClose, listId, visibility, followers, userId, onChanged }: VisibilitySheetProps) {
  const { t } = useTranslation('lists')
  const online = useOnline()
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<ListVisibility | null>(null)
  const working = useRef(false)
  // every opening starts on the list's current state, without the confirm step
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setConfirming(false)
  }

  async function change(next: ListVisibility) {
    if (working.current || !online || next === visibility) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    working.current = true
    setBusy(next)
    try {
      await setListVisibility(listId, next, userId)
      if (!epoch.isCurrent()) return
      onChanged(next)
      feedback('success')
      toast.success(next === 'followers' ? t('lists.screen.shared_now') : t('lists.screen.private_now'))
      onClose()
    } catch (err) {
      if (!epoch.isCurrent()) return
      const error = toAppError(err)
      feedback('error')
      toast.error(t(error.key, error.params))
    } finally {
      working.current = false
      if (epoch.isCurrent()) setBusy(null)
    }
  }

  function pick(next: ListVisibility) {
    if (next === visibility || busy) return
    // narrowing a shared list needs its own explicit step; widening goes at once
    if (next === 'private') setConfirming(true)
    else void change('followers')
  }

  const enter = reduced ? { opacity: 0 } : { opacity: 0, y: 10 }
  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={t('lists.visibility.title')}
      closeLabel={t('common.close')}
      footer={
        <AnimatePresence initial={false} mode="popLayout">
          {confirming ? (
            <m.div key="confirm" className="flex flex-col gap-3" initial={enter} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={reduced ? fade : { ...smooth, opacity: fade }}>
              {/* STATIC: the same sentence for every list, with or without anything planned on it */}
              <p className="ls-warning" role="note">{t('lists.visibility.warning')}</p>
              <Button variant="destructive" size="lg" fullWidth loading={busy === 'private'} disabled={!online} hapticKind="warning" onClick={() => void change('private')}>
                {t('lists.visibility.confirm')}
              </Button>
              <Button variant="secondary" size="lg" fullWidth disabled={busy !== null} onClick={() => setConfirming(false)}>
                {t('common.cancel')}
              </Button>
            </m.div>
          ) : null}
        </AnimatePresence>
      }
    >
      <div role="radiogroup" aria-label={t('lists.visibility.title')} className="flex flex-col gap-3 pb-2">
        <Choice
          selected={(confirming ? 'private' : visibility) === 'private'}
          current={visibility === 'private'}
          busy={false}
          icon={<GlyphLock />}
          title={t('lists.visibility.private')}
          hint={t('lists.visibility.private_hint')}
          onSelect={() => pick('private')}
        />
        <Choice
          selected={(confirming ? 'private' : visibility) === 'followers'}
          current={visibility === 'followers'}
          busy={busy === 'followers'}
          icon={<GlyphPeople />}
          title={followers === null ? t('lists.visibility.followers') : `${t('lists.visibility.followers')} (${t('lists.create.followers_count', { count: followers })})`}
          hint={t('lists.visibility.followers_hint')}
          onSelect={() => {
            setConfirming(false)
            pick('followers')
          }}
        />
      </div>
    </Sheet>
  )
}

function Choice({ selected, current, busy, icon, title, hint, onSelect }: {
  selected: boolean
  current: boolean
  busy: boolean
  icon: ReactNode
  title: string
  hint: string
  onSelect: () => void
}) {
  const { t } = useTranslation('lists')
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-busy={busy || undefined}
      className={cn('ls-choice glass-panel', selected && 'ls-choice-on')}
      onPointerDown={() => haptic('select')}
      onClick={onSelect}
    >
      <span aria-hidden="true" className="lcs-who-icon">{icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block t-headline text-text">{title}</span>
        <span className="block t-footnote text-text-2">{hint}</span>
      </span>
      {busy ? <span aria-hidden="true" className="spinner text-accent-text" /> : (
        <span aria-hidden="true" className="lcs-who-radio">{selected ? <span className="lcs-who-dot" /> : null}</span>
      )}
      {current ? <span className="sr-only">{t('lists.visibility.current')}</span> : null}
    </button>
  )
}
