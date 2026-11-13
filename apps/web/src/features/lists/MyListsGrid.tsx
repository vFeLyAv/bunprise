import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { OwnerListCard as OwnerListCardData } from '../../lib/api/lists.types'
import { Button, Chip, IconPlus, Skeleton, useBunniesShown } from '../../ui'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { useCarry } from '../mascot-ui/carry'
import { CoverGlyph } from './covers'
import { clearCreated, useCreatedList } from './createFlow'
import { todayKey } from './dates'
import { ListMenu, type ListMenuStage } from './ListMenu'
import { NewListTile, OwnerListCard } from './OwnerListCard'
import { usePendingListDeletes } from './pendingListDeletes'
import { isTabList } from './tabView'
import { LIST_TEMPLATES, type ListTemplate } from './templates'

// "Meine" (follows-design §2.3; Felix 22.10: "in Listen keine Anlässe – nur Wunschlisten") — OWNER module: a
// two-column grid, the dashed "+ Neue Liste" first, then my lists WITHOUT an occasion (an occasion's list lives on the
// occasion's screen); the server's order (date, then newest) — never anything about reservations. Each card's ⋯
// opens the list's settings (ListMenu: one set of sheets for the whole grid). Empty: Pompon holds an empty card +
// templates.
// A just-created list (createFlow.ts): its card waits invisible in its place while Pompon carries it in
// ("Voll" only), then shows with a short glow; once the server has it, the list opens.

const GLOW_MS = 1400

export interface MyListsGridProps {
  /** null while the overview loads */
  lists: readonly OwnerListCardData[] | null
  onCreate: () => void
  onTemplate: (template: ListTemplate) => void
  /** the account of the tab (the cards' menus and thumbnails act for it) */
  userId?: string
  /** stats.followers for the visibility sheet — null when unknown */
  followers?: number | null
}

export function MyListsGrid({ lists, onCreate, onTemplate, userId, followers = null }: MyListsGridProps) {
  const { t } = useTranslation('lists')
  const headingId = useId()
  const today = todayKey()
  const created = useCreatedList()
  const navigate = useNavigate()
  const carry = useCarry()
  const [landed, setLanded] = useState<string | null>(null)
  const [glow, setGlow] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const started = useRef<string | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // a list whose delete waits for its 5 s undo is gone from the grid already
  const pendingDeletes = usePendingListDeletes()
  const current = (lists ?? []).filter((card) => isTabList(card) && !pendingDeletes.has(card.id))
  const pendingId = created && current.some((card) => card.id === created.listId) ? created.listId : null
  // the ⋯ of a card: which list's settings are open (the last one stays rendered while its sheet slides out)
  const [menu, setMenu] = useState<{ listId: string; stage: ListMenuStage } | null>(null)
  const menuCard = menu ? current.find((card) => card.id === menu.listId) ?? null : null

  // the new card is in the grid: carry it in (or just show it), then open the list once the server has it
  useEffect(() => {
    if (!created || !pendingId || started.current === pendingId) return
    started.current = pendingId
    const entry = created
    const target = listRef.current?.querySelector<HTMLElement>(`[data-list-card="${CSS.escape(entry.listId)}"]`)
    let landed: Promise<void> = Promise.resolve()
    let over: Promise<void> = Promise.resolve()
    if (entry.carry && entry.from && target) {
      let finish: () => void = () => undefined
      over = new Promise<void>((resolve) => {
        finish = resolve
      })
      landed = carry({
        from: entry.from,
        to: target.querySelector('[data-cover]') ?? target,
        item: 'card',
        tint: `var(--tint-${target.dataset.tone ?? '1'}-solid)`,
        // the list opens once Pompon has waved and hopped away (a tap anywhere skips to that moment)
        onDone: () => finish(),
      })
    }
    void landed.then(() => {
      if (!alive.current) return
      setLanded(entry.listId)
      setGlow(entry.listId)
    })
    void Promise.all([over, entry.saved]).then(([, ok]) => {
      clearCreated(entry.listId)
      if (ok && alive.current) void navigate({ to: '/lists/$listId', params: { listId: entry.listId } })
    })
  }, [created, pendingId, carry, navigate])

  useEffect(() => {
    if (!glow) return
    const id = setTimeout(() => setGlow(null), GLOW_MS)
    return () => clearTimeout(id)
  }, [glow])

  if (lists === null) return <GridSkeleton />
  if (current.length === 0) return <MineEmpty onCreate={onCreate} onTemplate={onTemplate} />

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* visible since "Abonniert" follows below (Felix 26.10: "add a label 'Meine' — the ones you created") */}
      <h2 id={headingId} className="t-title-2 text-text">{t('lists.mine.title')}</h2>
      <ul ref={listRef} className="lc-grid">
        <li data-buddy-floor="new">
          <NewListTile onPress={onCreate} />
        </li>
        {current.map((card, index) => (
          <li key={card.id} data-buddy-floor={card.id} data-buddy-card={index}>
            <OwnerListCard
              card={card}
              today={today}
              userId={userId}
              concealed={pendingId === card.id && landed !== card.id && Boolean(created?.carry)}
              highlight={glow === card.id}
              onMenu={userId ? () => setMenu({ listId: card.id, stage: 'menu' }) : undefined}
            />
          </li>
        ))}
      </ul>
      {menuCard && userId ? (
        <ListMenu
          list={{ ...menuCard, title: menuCard.title?.trim() || t('lists.card.untitled'), visibility: menuCard.visibility === 'followers' ? 'followers' : 'private' }}
          userId={userId}
          followers={followers}
          stage={menu?.stage ?? null}
          onStage={(stage) => setMenu((current) => (current ? { ...current, stage } : current))}
        />
      ) : null}
    </section>
  )
}

/** Pompon holds an empty card (§2.3): "Leg deine erste Wunschliste an" + templates (they fill the sheet only). */
function MineEmpty({ onCreate, onTemplate }: { onCreate: () => void; onTemplate: (template: ListTemplate) => void }) {
  const { t } = useTranslation('lists')
  const card = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bunnies = useBunniesShown()
  return (
    <section aria-labelledby={titleId} className="flex flex-col">
      {bunnies ? <div className="relative h-28">
        <BunnyMoment
          kind="peek"
          calm="still"
          once="visit"
          onceKey="lists-empty"
          cardRef={card}
          edgeInset={16}
          minSize={104}
          maxSize={128}
          className="pointer-events-none absolute inset-0"
          style={{ bottom: -16 }}
        />
      </div> : null}
      <div ref={card} className="lc-empty glass-panel">
        <span aria-hidden="true" className="lc-empty-card">
          <span className="lc-empty-line" />
          <span className="lc-empty-line lc-empty-line-short" />
        </span>
        <h2 id={titleId} className="t-title-2 text-text">{t('lists.mine.empty_title')}</h2>
        <p className="max-w-[32ch] t-body text-text-2">{t('lists.mine.empty_text')}</p>
        <div role="group" aria-label={t('lists.mine.templates')} className="lc-templates">
          {LIST_TEMPLATES.map((template) => (
            <Chip key={template.id} icon={<CoverGlyph icon={template.icon} size={18} />} onClick={() => onTemplate(template)}>
              {t(template.titleKey)}
            </Chip>
          ))}
        </div>
        <Button size="lg" fullWidth icon={<IconPlus size={20} />} onClick={onCreate} className="mt-1">
          {t('lists.mine.new')}
        </Button>
      </div>
    </section>
  )
}

function GridSkeleton() {
  return (
    <div aria-busy="true" className="lc-grid">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="lc-card glass-panel" aria-hidden="true">
          <Skeleton width={40} height={40} rounded="lg" />
          <Skeleton width="80%" height={16} className="mt-3" />
          <Skeleton width="44%" height={12} className="mt-2" />
          <Skeleton width="60%" height={20} rounded="full" className="mt-3" />
        </div>
      ))}
    </div>
  )
}
