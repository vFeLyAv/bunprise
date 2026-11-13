import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { OccasionScreen, OccasionSections } from '../../lib/api/types'
import { toAppError } from '../../lib/errors'
import { Banner, Button, IconTrash, Page, Skeleton, TopBar, tileTone } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { useOnline, usePageTitle } from '../auth/shared'
import { useGoBack, useUpdateOccasion } from './actions'
import { isUnavailable, useOccasionScreen } from './data'
import { sameOccasionValues, valuesFromOccasion, type OccasionFormValues } from './form'
import { useLeaveGuard, type LeaveGuard } from './leaveGuard'
import { FormBlock, FrostGroup, RowButton, RowIcon } from './form/parts'
import { AmbientTint } from '../../ui/AmbientTint'
import { OccasionForm } from './OccasionForm'
import { DeleteOccasionConfirm } from './OccasionMenu'
import { LoadError, OccasionUnavailable } from './parts'
import { photoChangeOf, photoChoiceOf, type PhotoChoice } from './form/PhotoField'
import { clearPhotoDraftOf, keepPhotoDraft, peekPhotoDraft, startPhotoJob } from './photo/uploads'
import { clearDraft, peekDraft } from './saving'
import { potluckEnabled } from '../potluck/flag'
import { hasPotluck, sectionsOf } from '../potluck/cache'
import { coverToSave, coverView, initialCoverPick, type CoverPick } from './covers/choice'
import { coversEnabled } from './covers/flag'
import { storedCover } from './covers/themes'
import { useCoverDetect } from './covers/useCoverDetect'

// S6 "Anlass bearbeiten" — host only (anyone else gets the one "not found or no access" page).
// Prefilled from the occasion screen query (same cache entry as S7); saving is optimistic and
// returns to the occasion at once. "Delete occasion" at the bottom asks first.
// The scene carries the occasion's own tint (tileTone of its id), like its screen.

export interface EditOccasionPageProps {
  occasionId: string
  userId: string
}

export function EditOccasionPage({ occasionId, userId }: EditOccasionPageProps) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const router = useRouter()
  const query = useOccasionScreen(occasionId)
  const cancel = useGoBack(() => {
    void router.navigate({ to: '/occasions/$occasionId', params: { occasionId }, replace: true })
  })
  usePageTitle(t('occasion.edit_title'))
  // "Änderungen verwerfen?" before edited fields (or a new photo choice) are thrown away (EditForm reports them)
  const [dirty, setDirty] = useState(false)
  const guard = useLeaveGuard(dirty, {
    title: t('occasionForm.discard_edit_title'),
    message: t('occasionForm.discard_message'),
    confirm: t('occasionForm.discard_confirm'),
    cancel: t('occasionForm.discard_cancel'),
  })

  const screen = query.data
  if ((query.isError && isUnavailable(query.error)) || (screen && screen.viewer.role !== 'host')) {
    return <OccasionUnavailable />
  }

  return (
    <Page
      topBar={
        <TopBar
          large
          title={t('occasion.edit_title')}
          left={
            <Button variant="ghost" onClick={() => guard.leave(cancel)} hapticKind={null}>
              {t('common.cancel')}
            </Button>
          }
        />
      }
    >
      <AmbientTint tone={tileTone(occasionId)} />
      <div className="of-page">
        <h1 className="of-eyebrow">{t('occasion.edit_title')}</h1>
        {screen ? (
          <EditForm screen={screen} userId={userId} guard={guard} onDirtyChange={setDirty} />
        ) : query.isError && !query.isFetching ? (
          <LoadError error={toAppError(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <FormSkeleton />
        )}
      </div>
      {guard.sheet}
    </Page>
  )
}

interface EditFormProps {
  screen: OccasionScreen
  userId: string
  /** the page's leave guard: saving and deleting leave on purpose */
  guard: Pick<LeaveGuard, 'allow'>
  /** unsaved edits (values different from the stored occasion, or a photo change) */
  onDirtyChange: (dirty: boolean) => void
}

function EditForm({ screen, userId, guard, onDirtyChange }: EditFormProps) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const online = useOnline()
  const occasionId = screen.occasion.id
  const save = useUpdateOccasion(userId, occasionId)
  // the form starts from the values at opening time; later refetches do not overwrite typing
  const [original] = useState(() => valuesFromOccasion(screen.occasion))
  const [draft] = useState(() => peekDraft(userId, occasionId))
  const [submitting, setSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const queryClient = useQueryClient()
  // the cover photo (wave 2): the stored one stays unless the person picks or removes; a failed save brings
  // that choice back with the values
  const [photo, setPhoto] = useState<PhotoChoice>(() => {
    const kept = peekPhotoDraft(userId, occasionId)
    return draft && kept ? photoChoiceOf(kept.change) : { kind: 'keep' }
  })

  // "Was gibt's?" (the bring-along list, features/potluck): only while it is released. Switching the list off
  // deletes its entries — the page asks first when there are any (design §1.1).
  const offerSections = potluckEnabled()
  const [originalSections] = useState(() => sectionsOf(screen))
  const [sections, setSections] = useState<OccasionSections>(originalSections)
  const [confirmOff, setConfirmOff] = useState<OccasionFormValues | null>(null)
  // the motif without a photo (Felix 26.10, covers/): only when released AND the server sent cover_theme (an older
  // server has no column: the form then offers no motif and never writes it). A stored motif that is still its
  // title's own motif keeps following the title; one the host picked stays.
  const [storedTheme] = useState(() => storedCover(screen.occasion.cover_theme))
  const offerCovers = coversEnabled() && storedTheme !== undefined
  const [initialCover] = useState<CoverPick>(() => initialCoverPick(storedTheme ?? null, original.title, original.date))
  const [cover, setCover] = useState<CoverPick>(initialCover)
  const detectCover = useCoverDetect(offerCovers)
  const entries = screen.potluck?.items.length ?? 0
  // a restored draft (a failed save) counts as unsaved too: it differs from the stored values
  const [typed, setTyped] = useState<OccasionFormValues | null>(null)
  const dirty = (typed !== null && !sameOccasionValues(typed, original)) || photo.kind !== 'keep' || sections !== originalSections || cover !== initialCover
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    clearDraft(userId, occasionId)
    clearPhotoDraftOf(userId, occasionId, occasionId)
  }, [userId, occasionId])

  function submit(values: OccasionFormValues) {
    if (submitting) return
    setSubmitting(true)
    // saving leaves on purpose (a failed save offers the form again with the input)
    guard.allow()
    // `sections` goes out only when the host changed it (an older database has no such column)
    const changedSections = offerSections && sections !== originalSections ? sections : undefined
    // `cover_theme` only when the motif differs from the stored one (also when the title took the automatic one along)
    const nextCover = offerCovers ? coverToSave(coverView(cover, detectCover, values.title, values.date)) : undefined
    const changedCover = nextCover !== undefined && nextCover !== storedTheme ? nextCover : undefined
    const change = photoChangeOf(photo)
    if (!change) {
      void save(values, screen.occasion.tz, undefined, changedSections, changedCover)
      return
    }
    // kept until the update is confirmed; then the upload / removal starts (photo/uploads.ts)
    keepPhotoDraft(userId, occasionId, { occasionId, change })
    void save(values, screen.occasion.tz, () => {
      clearPhotoDraftOf(userId, occasionId, occasionId)
      void startPhotoJob(userId, occasionId, change, queryClient)
    }, changedSections, changedCover)
  }

  return (
    <>
      <OccasionForm
        initial={draft?.values ?? original}
        timeZone={screen.occasion.tz}
        originalDate={original.date}
        userId={userId}
        tone={tileTone(occasionId)}
        notice={draft ? <Banner kind="error">{t('occasion.save_failed')}</Banner> : null}
        busy={submitting}
        photo={{ value: photo, onChange: setPhoto, occasionId, stored: screen.occasion.photo ?? null, cover: offerCovers ? { pick: cover, onChange: setCover } : undefined }}
        sections={offerSections ? { value: sections, onChange: setSections, bringLocked: Boolean(screen.wishlist && screen.wishlist.wishes.length > 0) } : undefined}
        onValuesChange={setTyped}
        onSubmit={(values) => {
          if (submitting) return
          if (offerSections && entries > 0 && hasPotluck(originalSections) && !hasPotluck(sections)) {
            setConfirmOff(values)
            return
          }
          submit(values)
        }}
      >
        <FrostGroup>
          <RowButton
            className="of-row-danger"
            disabled={!online}
            tile={
              <RowIcon kind="danger">
                <IconTrash size={18} />
              </RowIcon>
            }
            label={t('occasion.delete')}
            onClick={() => setConfirmDelete(true)}
          />
        </FrostGroup>
      </OccasionForm>
      <DeleteOccasionConfirm screen={screen} userId={userId} open={confirmDelete} onClose={() => setConfirmDelete(false)} onLeaving={guard.allow} />
      {offerSections ? (
        <Confirm
          open={confirmOff !== null}
          destructive
          title={t('occasionForm.sections_off_title')}
          message={t('occasionForm.sections_off_message', { count: entries })}
          confirmLabel={t('occasionForm.sections_off_confirm')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            const values = confirmOff
            setConfirmOff(null)
            if (values) submit(values)
          }}
          onCancel={() => setConfirmOff(null)}
        />
      ) : null}
    </>
  )
}

/** Same rhythm as the form (title, three groups), so nothing jumps when it arrives. */
function FormSkeleton() {
  return (
    <FormBlock>
      <div aria-busy="true" className="of-skeleton">
        <Skeleton width="72%" height={36} rounded="md" />
        <Skeleton height={164} rounded="lg" />
        <Skeleton height={54} rounded="lg" />
        <Skeleton height={104} rounded="lg" />
      </div>
    </FormBlock>
  )
}
