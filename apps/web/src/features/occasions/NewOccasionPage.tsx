import { useEffect, useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { newOccasionId } from '../../lib/api/occasions'
import { browserTimeZone } from '../../lib/time'
import { Banner, Button, Page, TopBar, tileTone } from '../../ui'
import { usePageTitle } from '../auth/shared'
import { useCreateOccasion, useGoBack } from './actions'
import { emptyOccasionValues, sameOccasionValues, type OccasionFormValues } from './form'
import { useLeaveGuard } from './leaveGuard'
import { AmbientTint } from '../../ui/AmbientTint'
import { OccasionForm } from './OccasionForm'
import { photoChangeOf, photoChoiceOf, type PhotoChoice } from './form/PhotoField'
import { clearPhotoDraftOf, keepPhotoDraft, peekPhotoDraft, startPhotoJob } from './photo/uploads'
import { clearDraft, peekDraft } from './saving'
import { clearOccasionPrefill, peekOccasionPrefill } from './prefill'
import type { OccasionSections } from '../../lib/api/types'
import { potluckEnabled } from '../potluck/flag'
import { NO_EXTRAS, extrasCount, extrasFor, extrasLayoutKey, wishCount, type OccasionExtras } from './extras/model'
import { QuickExtras } from './extras/QuickExtras'
import { AUTO_PICK, coverToSave, coverView, type CoverPick } from './covers/choice'
import { coversEnabled } from './covers/flag'
import { useCoverDetect } from './covers/useCoverDetect'

// S6 "Neuer Anlass" (F4). Saving opens the new occasion at once (optimistic, client id);
// the database trigger adds the host membership and THE wishlist. A failed save returns here
// with the input restored from memory.
// The client id exists from the first frame on (a failed draft brings its own back): the scene of the
// form is tinted by it (tileTone), and the occasion keeps that tint once it is saved under the same id.

export function NewOccasionPage({ userId }: { userId: string }) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const router = useRouter()
  const create = useCreateOccasion(userId)
  const cancel = useGoBack(() => {
    void router.navigate({ to: '/soon', replace: true })
  })
  const [draft] = useState(() => peekDraft(userId, 'new'))
  // "wieder feiern?" from the birthday suggestion on Start (./prefill.ts): title + this year's date, nothing else
  const [prefill] = useState(() => peekOccasionPrefill(userId))
  const [clientId] = useState(() => draft?.id ?? newOccasionId())
  const tone = tileTone(clientId || 'new')
  const [timeZone] = useState(browserTimeZone)
  // One occasion per tap: the form stays locked until the new screen has opened.
  const [submitting, setSubmitting] = useState(false)
  const queryClient = useQueryClient()
  // the cover photo (wave 2): a failed save brings its picked photo back together with the values
  const [photo, setPhoto] = useState<PhotoChoice>(() => {
    const kept = peekPhotoDraft(userId, 'new')
    return draft && kept?.occasionId === clientId ? photoChoiceOf(kept.change) : { kind: 'keep' }
  })
  // "Was gibt's?" (the bring-along list): only while it is released; the default is every occasion as before
  const [sections, setSections] = useState<OccasionSections>(() => draft?.sections ?? 'wishes')
  const offerSections = potluckEnabled()
  // wishes and bring-along entries added right here (Felix 26.10, extras/): saved after the occasion itself
  const [extras, setExtras] = useState<OccasionExtras>(() => draft?.extras ?? NO_EXTRAS)
  const [wishesOpen, setWishesOpen] = useState(() => wishCount(draft?.extras ?? NO_EXTRAS) > 0)
  const extrasId = useId()
  const offered: OccasionSections = offerSections ? sections : 'wishes'
  // the motif without a photo (Felix 26.10, covers/): automatic from the title until the host picks one
  const offerCovers = coversEnabled()
  const [cover, setCover] = useState<CoverPick>(AUTO_PICK)
  const detectCover = useCoverDetect(offerCovers)
  usePageTitle(t('occasion.new_title'))
  // "Anlass verwerfen?" before typed input (or a picked photo) is thrown away by a back tap or gesture
  // the starting values: leaving them untouched asks nothing (a prefilled title and date count as untouched)
  const [empty] = useState(() => prefill ? { ...emptyOccasionValues(), title: prefill.title, date: prefill.date } : emptyOccasionValues())
  const [typed, setTyped] = useState<OccasionFormValues | null>(null)
  const dirty = (typed !== null && !sameOccasionValues(typed, empty)) || photo.kind !== 'keep' || sections !== 'wishes' || cover !== AUTO_PICK || extrasCount(extras) > 0
  const guard = useLeaveGuard(dirty, {
    title: t('occasionForm.discard_new_title'),
    message: t('occasionForm.discard_message'),
    confirm: t('occasionForm.discard_confirm'),
    cancel: t('occasionForm.discard_cancel'),
  })

  // The restored draft belongs to this form instance now.
  useEffect(() => {
    clearDraft(userId, 'new')
    clearOccasionPrefill(userId)
    clearPhotoDraftOf(userId, 'new', clientId)
  }, [userId, clientId])

  return (
    <Page
      topBar={
        <TopBar
          large
          title={t('occasion.new_title')}
          left={
            <Button variant="ghost" onClick={() => guard.leave(cancel)} hapticKind={null}>
              {t('common.cancel')}
            </Button>
          }
        />
      }
    >
      <AmbientTint tone={tone} />
      <div className="of-page">
        <h1 className="of-eyebrow">{t('occasion.new_title')}</h1>
        <OccasionForm
          initial={draft?.values ?? empty}
          timeZone={timeZone}
          userId={userId}
          tone={tone}
          notice={draft ? <Banner kind="error">{t('occasion.save_failed')}</Banner> : null}
          busy={submitting}
          photo={{ value: photo, onChange: setPhoto, occasionId: clientId, stored: null, cover: offerCovers ? { pick: cover, onChange: setCover } : undefined }}
          sections={offerSections ? { value: sections, onChange: setSections, bringLocked: wishCount(extras) > 0 } : undefined}
          extras={{
            node: <QuickExtras id={extrasId} value={extras} onChange={setExtras} sections={offered} wishesOpen={wishesOpen} onWishesOpen={setWishesOpen} />,
            layoutKey: extrasLayoutKey(extras, offered, wishesOpen),
          }}
          onValuesChange={setTyped}
          onSubmit={(values) => {
            if (submitting) return
            setSubmitting(true)
            // saving leaves on purpose (a failed save comes back to a new form with the input)
            guard.allow()
            const change = photoChangeOf(photo)
            const chosen = offerSections ? sections : undefined
            // the motif the form showed (null: automatic found nothing; undefined: not offered / not detected yet)
            const chosenCover = offerCovers ? coverToSave(coverView(cover, detectCover, values.title, values.date)) : undefined
            // only what the chosen "Was gibt's?" offers goes out with it
            const added = extrasFor(extras, offered)
            if (!change) {
              create(values, clientId, undefined, chosen, chosenCover, added)
              return
            }
            // kept until the server confirmed the occasion; then the upload starts (photo/uploads.ts)
            keepPhotoDraft(userId, 'new', { occasionId: clientId, change })
            create(values, clientId, () => {
              clearPhotoDraftOf(userId, 'new', clientId)
              void startPhotoJob(userId, clientId, change, queryClient)
            }, chosen, chosenCover, added)
          }}
        />
      </div>
      {guard.sheet}
    </Page>
  )
}
