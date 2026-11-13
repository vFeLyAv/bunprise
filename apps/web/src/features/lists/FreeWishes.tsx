import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { getFreeWishes } from '../../lib/api/lists'
import { captureEpoch } from '../../lib/accountBoundary'
import { Button, Skeleton } from '../../ui'
import { requestOpenWish } from '../wishes/openWish'
import { listsEnabled } from './flag'

/** Kept outside gift inference: availability can change this block, never interests or product payloads. */
export default function FreeWishes({ userId, profileId, name, maxCents }: { userId: string; profileId: string; name: string; maxCents: number }) {
  if (!listsEnabled() || userId === profileId) return null
  return <GiverWishes userId={userId} profileId={profileId} name={name} maxCents={maxCents} />
}

function GiverWishes({ userId, profileId, name, maxCents }: { userId: string; profileId: string; name: string; maxCents: number }) {
  const { t } = useTranslation('gifts')
  const navigate = useNavigate()
  const query = useQuery({ queryKey: ['free-wishes', userId, profileId, maxCents], queryFn: () => getFreeWishes(profileId, maxCents, userId), staleTime: 0 })
  return <section className="flex flex-col gap-2 rounded-(--r-card) p-4 glass-panel" aria-label={t('gifts.free_title', { name })} data-free-wishes="">
    <h2 className="t-headline">{t('gifts.free_title', { name })}</h2>
    {query.isPending ? <Skeleton height={48} /> : query.isError ? <Button variant="ghost" onClick={() => void query.refetch()}>{t('gifts.retry')}</Button> : query.data.ideas.length === 0 ? <p className="t-callout text-text-2">{t('gifts.free_empty', { name })}</p> :
      <ul className="flex flex-col gap-1">{query.data.ideas.slice(0, 5).map((wish) => <li key={wish.wish_id}>
        <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left" onClick={() => {
          const epoch = captureEpoch()
          if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
          requestOpenWish(wish.list.id, wish.wish_id)
          if (wish.list.occasion_id) void navigate({ to: '/occasions/$occasionId', params: { occasionId: wish.list.occasion_id } })
          else void navigate({ to: '/lists/$listId', params: { listId: wish.list.id } })
        }}><span className="min-w-0 flex-1 truncate">{wish.title}</span><span aria-hidden="true">›</span></button>
      </li>)}</ul>}
  </section>
}
