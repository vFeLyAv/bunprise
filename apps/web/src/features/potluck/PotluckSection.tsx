import { useId, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import type { OccasionScreen, PotluckItem } from '../../lib/api/types'
import { Avatar, Button, Card, Chip, IconButton, IconCheck, IconMore, IconPlus, List, listItemClass, useSpring } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { AvatarPhoto } from '../profilePhotos/PersonPhoto'
import { usePotluckActions } from './actions'
import { potluckOf, progressOf } from './cache'
import { PotluckSheet } from './PotluckSheet'
import './potluck.css'

// "Mitbringen" (docs/design/2026-10-25-bring-list.md §1.2–§1.5): the occasion's bring-along list. NOT secret —
// the opposite of the wish list: everyone in the occasion, the host included, sees who brings what. Its own words,
// never the wish list's. The rows say it all (Felix 27.10: no "Du bringst: …", no "2 von 3 verteilt", no "Alles ist
// verteilt" — you see it): the entry on the left, on the right free → the pill "Ich bring's mit"; mine → the chip
// "✓ Du" ("Doch nicht" sits in "⋯"); someone else → their small avatar and first name; a person I blocked (or who
// blocked me) → "Wird schon mitgebracht" under the entry, without a name. "⋯": "Doch nicht" (mine), rename (my
// entries), delete (mine; the host: any). The count stays for screen readers; the "open for everyone" line only
// while the list is empty (then nothing on screen shows it yet).
// Adding, renaming and deleting are optimistic; bringing waits for the server (actions.ts).
// Loaded lazily with the occasion page (only occasions that offer it).

const SUGGESTIONS = ['suggest_salad', 'suggest_cake', 'suggest_drinks', 'suggest_games', 'suggest_speaker'] as const

/** "Anna Beispiel" → "Anna": the chip is small; the whole name is in the row's screen reader text. */
function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}

export interface PotluckSectionProps {
  screen: OccasionScreen
  userId: string
}

export default function PotluckSection({ screen, userId }: PotluckSectionProps) {
  const { t } = useTranslation('occasion')
  const titleId = useId()
  const online = useOnline()
  const snappy = useSpring('snappy')
  const actions = usePotluckActions(screen.occasion.id, userId)
  const list = potluckOf(screen)
  const isHost = screen.viewer.role === 'host'
  const host = screen.occasion.host.display_name?.trim() || t('potluck.name_fallback')
  const [sheet, setSheet] = useState<{ mode: 'add' } | { mode: 'rename'; item: PotluckItem } | null>(null)
  const [menuFor, setMenuFor] = useState<PotluckItem | null>(null)
  const [deleting, setDeleting] = useState<PotluckItem | null>(null)
  if (!list) return null

  const items = list.items
  const { claimed, total } = progressOf(items)
  const full = total >= list.max_items
  const canAdd = online && !full
  const nameOf = (item: PotluckItem) => item.bringer?.display_name?.trim() || t('potluck.name_fallback')
  const hasMenu = (item: PotluckItem) => item.claimed_by_me || item.can_edit || item.can_delete

  const deleteMessage = (item: PotluckItem) => {
    if (!item.claimed || item.claimed_by_me) return t('potluck.delete_message')
    return item.bringer ? t('potluck.delete_claimed', { name: nameOf(item) }) : t('potluck.delete_claimed_someone')
  }

  /** The right side of a row: who brings it, or the way to bring it. */
  const trailingOf = (item: PotluckItem) => {
    if (item.claimed_by_me) {
      return (
        <span className="potluck-chip potluck-chip-me t-subhead font-semibold" data-potluck-me="">
          <IconCheck size={16} />
          {t('potluck.you')}
        </span>
      )
    }
    if (!item.claimed) {
      return (
        <Button
          variant="secondary"
          size="sm"
          className="potluck-bring"
          icon={<IconPlus />}
          disabled={!online || actions.busyId !== null}
          loading={actions.busyId === item.id}
          aria-label={t('potluck.bring_label', { title: item.title })}
          onClick={() => void actions.claim(item.id)}
        >
          {t('potluck.bring')}
        </Button>
      )
    }
    if (!item.bringer) return null
    const name = nameOf(item)
    return (
      <span className="potluck-chip t-subhead">
        <span className="sr-only">{t('potluck.brings', { name })}</span>
        <Avatar size={24} name={name} seed={item.bringer.profile_id}>
          <AvatarPhoto profileId={item.bringer.profile_id} meta={item.bringer.photo} />
        </Avatar>
        <span aria-hidden="true" className="truncate">{firstName(name)}</span>
      </span>
    )
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3" data-potluck="">
      <div className="min-w-0">
        <h2 id={titleId} className="t-title-2 text-text">
          {t('potluck.title')}
        </h2>
        {/* the rows show it; a screen reader still hears how much is taken */}
        {total > 0 ? <p className="sr-only">{t('potluck.progress', { claimed, total })}</p> : null}
      </div>

      {items.length === 0 ? (
        <>
          {/* open for everyone (the counterpart of the wish list's secrecy line) — said while no row shows it yet */}
          <p className="t-footnote text-text-2">{isHost ? t('potluck.public_host') : t('potluck.public_guest', { host })}</p>
          <Card className="flex flex-col gap-3">
            {isHost ? (
              <>
                <p className="t-headline text-text">{t('potluck.empty_host_title')}</p>
                <p className="t-subhead text-text-2">{t('potluck.empty_host_text')}</p>
                <div role="group" aria-label={t('potluck.suggestions_label')} className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((key) => (
                    <Chip key={key} disabled={!canAdd} icon={<IconPlus size={16} />} onClick={() => actions.add(t(`potluck.${key}`), false)}>
                      {t(`potluck.${key}`)}
                    </Chip>
                  ))}
                  <Chip disabled={!canAdd} onClick={() => setSheet({ mode: 'add' })}>
                    {t('potluck.own_entry')}
                  </Chip>
                </div>
              </>
            ) : (
              <>
                <p className="t-subhead text-text-2">{t('potluck.empty_guest', { host })}</p>
                <Button variant="secondary" disabled={!canAdd} icon={<IconPlus size={20} />} onClick={() => setSheet({ mode: 'add' })}>
                  {t('potluck.guest_add')}
                </Button>
              </>
            )}
          </Card>
        </>
      ) : (
        <Card padding="none">
          <List>
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <m.li
                  key={item.id}
                  layout="position"
                  className={`${listItemClass} flex items-center`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={snappy}
                  data-potluck-item={item.id}
                >
                  <div className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 ${hasMenu(item) ? 'pr-1' : 'pr-4'}`}>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block t-headline text-text hyphens-auto [overflow-wrap:anywhere]">{item.title}</span>
                      {item.claimed && !item.claimed_by_me && !item.bringer ? (
                        <span className="mt-0.5 block t-subhead text-text-2">{t('potluck.someone')}</span>
                      ) : null}
                    </span>
                    {trailingOf(item)}
                  </div>
                  {hasMenu(item) ? (
                    <IconButton variant="plain" className="mr-1 shrink-0" label={t('potluck.menu_label', { title: item.title })} disabled={!online} onClick={() => setMenuFor(item)}>
                      <IconMore size={20} />
                    </IconButton>
                  ) : null}
                </m.li>
              ))}
            </AnimatePresence>
          </List>
        </Card>
      )}

      {items.length > 0 ? (
        <Button variant="ghost" className="self-start" disabled={!canAdd} icon={<IconPlus size={20} />} onClick={() => setSheet({ mode: 'add' })}>
          {isHost ? t('potluck.add') : t('potluck.guest_add')}
        </Button>
      ) : null}
      {full ? <p className="t-footnote text-text-2">{t('potluck.full', { max: list.max_items })}</p> : null}
      {!online ? <p role="status" className="t-footnote text-text-2">{t('potluck.offline')}</p> : null}

      <PotluckSheet
        open={sheet !== null}
        mode={sheet?.mode ?? 'add'}
        initialTitle={sheet?.mode === 'rename' ? sheet.item.title : ''}
        bringByDefault={!isHost}
        onClose={() => setSheet(null)}
        onSubmit={(title, bring) => {
          if (sheet?.mode === 'rename') actions.rename(sheet.item.id, title)
          else actions.add(title, bring)
          setSheet(null)
        }}
      />

      <Sheet open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor?.title} closeLabel={t('potluck.close')}>
        <div className="flex flex-col gap-2 pb-2">
          {menuFor?.claimed_by_me ? (
            // "Doch nicht" waits for the server like "Ich bring's mit" (the sheet stays with the spinner until it answered)
            <Button
              variant="secondary"
              fullWidth
              disabled={!online || (actions.busyId !== null && actions.busyId !== menuFor.id)}
              loading={actions.busyId === menuFor.id}
              aria-label={t('potluck.not_me_label', { title: menuFor.title })}
              onClick={() => { const id = menuFor.id; void actions.unclaim(id).then(() => setMenuFor((open) => (open?.id === id ? null : open))) }}
            >
              {t('potluck.not_me')}
            </Button>
          ) : null}
          {menuFor?.can_edit ? (
            <Button variant="secondary" fullWidth onClick={() => { const item = menuFor; setMenuFor(null); setSheet({ mode: 'rename', item }) }}>
              {t('potluck.rename')}
            </Button>
          ) : null}
          {menuFor?.can_delete ? (
            <Button variant="destructive" fullWidth onClick={() => { setDeleting(menuFor); setMenuFor(null) }}>
              {t('potluck.delete')}
            </Button>
          ) : null}
        </div>
      </Sheet>

      <Confirm
        open={deleting !== null}
        destructive
        title={t('potluck.delete_title', { title: deleting?.title ?? '' })}
        message={deleting ? deleteMessage(deleting) : undefined}
        confirmLabel={t('potluck.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (deleting) actions.remove(deleting.id)
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
    </section>
  )
}
