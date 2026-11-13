import { useTranslation } from 'react-i18next'
import { countedScenes, newCostumes, useSammlung } from './store'

// The right side of the Profil row: «4/9», and a small orange dot while there are finds — or new costumes (31.10) —
// the person has not looked at yet (no pop-up, no toast — Felix 28.10, §0 #8). Its own lazy chunk (the row's label
// is there at once): the Profil screen's preload list stays as it was (/soon budget).
export default function SammlungCount({ userId }: { userId: string }) {
  const { t } = useTranslation('settings')
  const rec = useSammlung(userId)
  const counted = countedScenes(rec.found)
  const n = rec.found.filter((id) => counted.includes(id)).length
  const newFind = rec.found.length > rec.seen
  const fresh = newFind || newCostumes(rec).length > 0
  return (
    <span data-sammlung-count="" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {fresh ? <span data-sammlung-new="" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-400)' }} /> : null}
      <span aria-hidden="true">{n}/{counted.length}</span>
      <span className="sr-only">{fresh ? `${t(newFind ? 'sammlung.row_new' : 'sammlung.row_new_costume')}, ` : ''}{t('sammlung.count', { n, m: counted.length })}</span>
    </span>
  )
}
