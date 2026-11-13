import { useTranslation } from 'react-i18next'
import { renderedAccount } from '../../lib/accountBoundary'
import type { OwnerListCard } from '../../lib/api/lists.types'
import { currentLanguage, ensureNamespaces } from '../../lib/i18n'
import { Button, List, ListRow, SkeletonList } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { coverToneOf, CoverTile } from './covers'
import { occasionDayKey, shortDate, todayKey } from './dates'
import { usePendingListDeletes } from './pendingListDeletes'
import { useListsOverview } from './queries'
import { isTabList } from './tabView'
import './lists.css'

// "In andere Liste verschieben" (Felix 22.10) — OWNER module, a lazy chunk of the wish menu (features/wishes/
// WishMenu.tsx): my OTHER lists, from the tab's overview (memory only; asked for once if the tab was not open yet) —
// never the wish's own list. Felix 25.10: also my occasions' wishlists ("Ereignisse", today and later, soonest
// first; past ones are not offered), above my lists without an occasion ("Listen"). Each row says who sees that
// list — moving a wish into a list your followers or guests see shows it to them. The move itself (moveWish) is the
// caller's; move_wish only accepts my own lists of the same recipient (anything else: one 'not_found').

// the wish menu can open on an occasion screen, before anything of the lists tab was loaded
void ensureNamespaces('lists')

export interface MoveWishSheetProps {
  open: boolean
  onClose: () => void
  wishTitle: string
  /** the list the wish is on now (left out) */
  currentListId: string
  onPick: (target: { id: string; title: string }) => void
  /** Selection mode (features/wishes/selection, Felix 30.10): its own title and lead line ("3 Wünsche …"). */
  title?: string
  lead?: string
  /** Selection mode, "Zu anderer Liste hinzufügen": only my coming occasions' lists (add_wishes_to_list's targets). */
  eventsOnly?: boolean
  emptyText?: string
}

export default function MoveWishSheet({ open, onClose, wishTitle, currentListId, onPick, title, lead, eventsOnly = false, emptyText }: MoveWishSheetProps) {
  const { t } = useTranslation('lists')
  const userId = renderedAccount() ?? ''
  const overview = useListsOverview(userId, open && userId !== '')
  const pendingDeletes = usePendingListDeletes()
  const lists = overview.data?.my_lists.filter((card) => !eventsOnly && isTabList(card) && card.id !== currentListId && !pendingDeletes.has(card.id)) ?? null
  const today = todayKey()
  const events = upcomingEventLists(overview.data?.my_lists ?? [], currentListId, pendingDeletes, today)
  const locale = currentLanguage()
  const listRow = (card: OwnerListCard) => {
    const title = card.title?.trim() || t('lists.card.untitled')
    return (
      <ListRow
        key={card.id}
        leading={<CoverTile tone={coverToneOf(card.cover_tone, card.id)} icon={card.cover_icon} size={40} />}
        title={title}
        subtitle={`${t('lists.card.wishes', { count: card.wish_count })} · ${t(`lists.card.visibility_${card.visibility}`)}`}
        onPress={() => onPick({ id: card.id, title })}
      />
    )
  }
  return (
    <Sheet open={open} onClose={onClose} title={title ?? t('lists.move.title')} closeLabel={t('common.close')}>
      <div className="flex flex-col gap-3 pb-2" data-move-picker="">
        <p className="t-subhead text-text-2 [overflow-wrap:anywhere]">{lead ?? t('lists.move.lead', { title: wishTitle })}</p>
        {lists === null ? (
          overview.isError ? (
            <div className="flex flex-col items-start gap-2">
              <p className="t-body text-text">{t('lists.card.load_failed')}</p>
              <Button size="sm" variant="secondary" onClick={() => void overview.refetch()}>
                {t('common.retry')}
              </Button>
            </div>
          ) : (
            <div className="glass-panel rounded-lg">
              <SkeletonList rows={2} />
            </div>
          )
        ) : lists.length === 0 && events.length === 0 ? (
          <p className="ls-move-empty glass-panel">{emptyText ?? t('lists.move.empty')}</p>
        ) : (
          <>
            {events.length > 0 ? (
              <section className="flex flex-col gap-1.5" data-move-group="events">
                <h3 className="px-1 t-footnote font-semibold text-text-2">{t('lists.move.group_events')}</h3>
                <List className="glass-panel rounded-lg">
                  {events.map(({ card, occasion, day }) => (
                    <ListRow
                      key={card.id}
                      leading={<CoverTile tone={coverToneOf(card.cover_tone, card.id)} icon={card.cover_icon} size={40} />}
                      title={occasion.title}
                      subtitle={`${shortDate(day, locale, today)} · ${t('lists.card.wishes', { count: card.wish_count })} · ${t('lists.card.visibility_occasion')}`}
                      onPress={() => onPick({ id: card.id, title: occasion.title })}
                    />
                  ))}
                </List>
              </section>
            ) : null}
            {lists.length > 0 ? (
              <section className="flex flex-col gap-1.5" data-move-group="lists">
                {events.length > 0 ? <h3 className="px-1 t-footnote font-semibold text-text-2">{t('lists.move.group_lists')}</h3> : null}
                <List className="glass-panel rounded-lg">{lists.map(listRow)}</List>
              </section>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  )
}

/** My occasions' wishlists from today on (local start day), soonest first; never `exclude` or one waiting for its delete. */
export function upcomingEventLists(cards: readonly OwnerListCard[], exclude: string, pendingDeletes: ReadonlySet<string>, today: string) {
  return cards
    .flatMap((card) => {
      const occasion = card.occasion
      if (!occasion || card.id === exclude || pendingDeletes.has(card.id)) return []
      const day = occasionDayKey(occasion.starts_at, occasion.tz)
      return day >= today ? [{ card, occasion, day }] : []
    })
    .sort((a, b) => (a.occasion.starts_at < b.occasion.starts_at ? -1 : a.occasion.starts_at > b.occasion.starts_at ? 1 : 0))
}
