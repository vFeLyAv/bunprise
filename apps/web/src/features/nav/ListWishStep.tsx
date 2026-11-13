import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { createList, getListScreen, newListId } from '../../lib/api/lists'
import type { ListScreen } from '../../lib/api/lists.types'
import { toAppError } from '../../lib/errors'
import { feedQuery } from '../../lib/queries'
import { Button, Skeleton } from '../../ui'
import { useOnline } from '../auth/shared'
import { CoverTile, coverToneOf } from '../lists/covers'
import { useListsOverview, listsKeys } from '../lists/queries'
import { createMenu } from './createMenuStore'
import { GlyphChevronLeft, GlyphChevronRight } from './glyphs'
import { MenuDate, whenLabel } from './MenuDate'
import { wishCandidates } from './occasionPicker'

/** Owner-only targets, in presentation order: standalone lists, then upcoming hosted occasions. */
export function ListWishStep({ userId, titleId, onBack }: { userId: string; titleId: string; onBack: () => void }) {
  const { t } = useTranslation(['lists', 'nav'])
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const overview = useListsOverview(userId)
  const feed = useQuery(feedQuery())
  const online = useOnline()
  const lists = overview.data?.my_lists.filter((list) => list.kind === 'standalone') ?? []
  const occasions = feed.data ? wishCandidates(feed.data) : []
  const ready = !!overview.data && !!feed.data
  const count = lists.length + occasions.length
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const picked = useRef(false)
  const submitId = useRef<string | null>(null)
  const opening = useRef(createMenu.openingKey())

  function go(listId: string, occasionId: string | null) {
    const epoch = captureEpoch()
    if (!createMenu.isOpen() || createMenu.openingKey() !== opening.current || !epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    createMenu.close()
    if (occasionId) void navigate({ to: '/occasions/$occasionId/wishes/new', params: { occasionId }, viewTransition: false })
    else void navigate({ to: '/lists/$listId/wishes/new', params: { listId }, viewTransition: false })
  }

  useEffect(() => {
    if (!ready || count !== 1 || picked.current) return
    picked.current = true
    const list = lists[0]
    const occasion = occasions[0]
    if (list) go(list.id, null)
    else if (occasion) go('', occasion.id)
  })

  async function createFirst() {
    if (busy || !online) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    setBusy(true)
    setError(null)
    const id = submitId.current ??= newListId()
    const title = t('lists.first_wish.default_title')
    try {
      // A response may be lost after the insert committed. Reuse the client ID, then recover our own
      // exact row after an ambiguous retry instead of creating another list or getting stuck on conflict.
      let saved: { created_at: string }
      let recoveredScreen: ListScreen | null = null
      try {
        saved = await createList({ id, title, visibility: 'private', cover_tone: null, cover_icon: 'gift', due_on: null }, userId)
      } catch (err) {
        if (!epoch.isCurrent()) return
        const recovered = await getListScreen(id, userId).catch(() => null)
        if (!recovered || recovered.viewer.role !== 'owner' || recovered.list.owner.id !== userId) throw err
        saved = recovered.list
        recoveredScreen = recovered
      }
      if (!epoch.isCurrent()) return
      // a list of their own: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
      void import('../sammlung/note').then((m) => m.noteMilestone('list'), () => undefined)
      queryClient.setQueryData<ListScreen>(listsKeys.list(id), recoveredScreen ?? {
        list: { id, title, kind: 'standalone', visibility: 'private', cover_tone: null, cover_icon: 'gift', due_on: null,
          created_at: saved.created_at, owner: { id: userId, display_name: overview.data?.me.display_name ?? null, banner: overview.data?.me.banner ?? null } },
        viewer: { role: 'owner' }, wishes: [],
      })
      void queryClient.invalidateQueries({ queryKey: listsKeys.overview() })
      go(id, null)
    } catch (err) {
      if (!epoch.isCurrent()) return
      const failure = toAppError(err)
      setError(t(failure.key, failure.params))
    } finally {
      if (epoch.isCurrent()) setBusy(false)
    }
  }

  return <div className="flex flex-col gap-3">
    <div className="cm-step-head">
      <button type="button" className="cm-back" onClick={onBack} aria-label={t('nav:newmenu.back')} data-tg-back=""><GlyphChevronLeft size={22} /></button>
      <h2 id={titleId} className="min-w-0 flex-1 text-center t-title-3 text-text">{t(ready && count === 0 ? 'lists.first_wish.create' : 'lists.first_wish.choose')}</h2>
      <span aria-hidden="true" className="w-11 shrink-0" />
    </div>
    {ready ? count === 0 ? <>
      <p className="text-center t-callout text-text-2">{t('lists.first_wish.private')}</p>
      <Button variant="primary" fullWidth disabled={busy || !online} onClick={() => void createFirst()}>{t('lists.first_wish.create')}</Button>
      {!online ? <p role="status">{t('nav:newmenu.offline')}</p> : null}
      {error ? <p role="alert" className="t-callout text-danger">{error}</p> : null}
    </> : <ul className="cm-choices" data-cm-scroll="">
      {lists.map((list) => <li key={list.id}><button type="button" className="cm-choice" onClick={() => go(list.id, null)}>
        <CoverTile tone={coverToneOf(list.cover_tone, list.id)} icon={list.cover_icon} />
        <span className="min-w-0 flex-1 text-left"><span className="block truncate t-headline">{list.title}</span><span className="t-footnote text-text-2">{t(list.visibility === 'followers' ? 'lists.card.visibility_followers' : 'lists.card.visibility_private')}</span></span>
        <GlyphChevronRight size={18} />
      </button></li>)}
      {/* an occasion's wishlist says what it is: its date page and "Anlass · In 3 Tagen" (like a list's "Nur ich") */}
      {occasions.map((occasion) => <li key={occasion.id}><button type="button" className="cm-choice" onClick={() => go('', occasion.id)}>
        <MenuDate occasion={occasion} />
        <span className="min-w-0 flex-1 text-left"><span className="block truncate t-headline">{occasion.title}</span><span className="t-footnote text-text-2">{t('nav:newmenu.occasion_line', { when: whenLabel(occasion) })}</span></span>
        <GlyphChevronRight size={18} />
      </button></li>)}
    </ul> : overview.isError || feed.isError ? <div role="alert">
      <p>{t('nav:newmenu.error')}</p><Button onClick={() => { void overview.refetch(); void feed.refetch() }}>{t('nav:newmenu.retry')}</Button>
    </div> : <div aria-busy="true"><Skeleton height={100} /><span role="status" className="sr-only">{t('nav:newmenu.loading')}</span></div>}
  </div>
}
