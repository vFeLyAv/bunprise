import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { OccasionPhotoMeta } from '../../../lib/api/types'
import { Button, Spinner } from '../../../ui'
import { COVER_ASPECT_RATIO } from '../photo/coverGeometry'
import { preparePhoto, PhotoPrepareError, type PhotoProblem, type PreparedPhoto } from '../photo/pipeline'
import { useObjectUrl, useOccasionPhoto } from '../photo/queries'
import { usePhotoJob, type PhotoChange } from '../photo/uploads'
import type { CoverView } from '../covers/choice'
import { CoverMotif } from '../covers/CoverPicker'
import type { ThemeId } from '../covers/themes'
import { IconChevron, IconInfo, IconPhoto, IconUndo } from './icons'
import { FieldMessage, FormBlock, FrostGroup, RowButton, RowIcon } from './parts'
import './photo-field.css'

/** The preview cuts the photo like the occasion's hero will (photo/coverGeometry.ts). */
const FRAME_STYLE = { '--of-photo-ratio': COVER_ASPECT_RATIO } as CSSProperties

// The cover photo row of the occasion form (wave 2, new + edit). "Foto hinzufügen" opens the system picker
// (image/*: on a phone the library or the camera); the photo is prepared ON THE DEVICE (photo/pipeline.ts:
// ≤ 1600 px, WebP/JPEG ≤ 400 KB, without EXIF/GPS) and shown as it will be uploaded, with "Ersetzen" and
// "Entfernen". Nothing is uploaded here: the page sends the choice once the occasion is saved
// (photo/uploads.ts). A file that is no image or bigger than 20 MB is refused with a calm line; the previous
// choice stays. A change of this occasion that is still on its way shows read-only ("Wird hochgeladen …").
// With `cover` (Felix 26.10, behind VITE_COVERS): while there is no photo, the motif part (covers/CoverPicker.tsx) —
// the automatic or chosen motif as guests will see it, the strip of motifs, "Kein Motiv". A photo always wins.

/** What the form will do with the cover when it is saved. */
export type PhotoChoice = { kind: 'keep' } | { kind: 'picked'; photo: PreparedPhoto } | { kind: 'remove' }

/** The change to send after saving (null: the cover stays as it is). */
export function photoChangeOf(choice: PhotoChoice): PhotoChange | null {
  if (choice.kind === 'picked') return { kind: 'upload', photo: choice.photo }
  if (choice.kind === 'remove') return { kind: 'remove' }
  return null
}

/** The form's choice again from a kept change (a save that failed). */
export function photoChoiceOf(change: PhotoChange | undefined): PhotoChoice {
  if (change?.kind === 'upload') return { kind: 'picked', photo: change.photo }
  if (change?.kind === 'remove') return { kind: 'remove' }
  return { kind: 'keep' }
}

export interface PhotoFieldProps {
  id: string
  value: PhotoChoice
  onChange: (next: PhotoChoice) => void
  /** the occasion (edit) or its client id (new): the stored cover and a change on its way */
  occasionId: string
  userId: string
  /** the stored cover's meta (edit; null = none) */
  stored: OccasionPhotoMeta | null
  /** true while a picked file is being prepared (the form does not save meanwhile) */
  onBusyChange?: (busy: boolean) => void
  /** the motif choice (covers/): only while it is released and the server knows the column */
  cover?: PhotoFieldCover
}

/** The motif part of the group: the form computes the view (covers/choice.ts) and keeps the choice. */
export interface PhotoFieldCover {
  /** null while the detection loads: the photo row as before */
  view: CoverView | null
  /** "Motiv wählen" opened the strip */
  browsing: boolean
  onBrowse: () => void
  /** a tap in the strip or "Entfernen" (null = "Kein Motiv") */
  onPick: (choice: ThemeId | null) => void
  /** "Rückgängig" after "Kein Motiv" */
  onAuto: () => void
}

/** The part of the row's look that changes its height (the form's layout animations follow it). */
export function photoLayoutKey(value: PhotoChoice, stored: OccasionPhotoMeta | null, busy: boolean): string {
  return `${value.kind}:${stored ? 'stored' : 'none'}:${busy ? 'busy' : ''}`
}

const PROBLEM_KEY: Record<PhotoProblem, string> = {
  not_image: 'occasionForm.photo_not_image',
  too_large: 'occasionForm.photo_too_large',
  failed: 'occasionForm.photo_failed',
}

export function PhotoField({ id, value, onChange, occasionId, userId, stored, onBusyChange, cover }: PhotoFieldProps) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const input = useRef<HTMLInputElement>(null)
  const run = useRef(0)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<PhotoProblem | null>(null)
  const job = usePhotoJob(userId, occasionId)
  const showStored = value.kind === 'keep' && !job ? stored : null
  const current = useOccasionPhoto(occasionId, showStored)

  useEffect(() => {
    onBusyChange?.(busy)
  }, [busy, onBusyChange])
  // a pick still being prepared when the form goes is simply forgotten
  useEffect(() => () => {
    run.current += 1
  }, [])

  const pick = () => {
    setProblem(null)
    input.current?.click()
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // the same file can be picked again
    if (!file) return
    const mine = ++run.current
    setProblem(null)
    setBusy(true)
    try {
      const photo = await preparePhoto(file)
      if (run.current !== mine) return
      onChange({ kind: 'picked', photo })
    } catch (err) {
      if (run.current !== mine) return
      setProblem(err instanceof PhotoPrepareError ? err.problem : 'failed')
    } finally {
      if (run.current === mine) setBusy(false)
    }
  }

  /** "Entfernen": no cover after saving (the stored one goes, a picked one is dropped). */
  const remove = () => {
    setProblem(null)
    onChange(stored || job?.change.kind === 'upload' ? { kind: 'remove' } : { kind: 'keep' })
  }

  const messageId = `${id}-msg`
  const sending = job !== undefined && (job.status === 'queued' || job.status === 'sending')

  const photoRow = (
    <RowButton
      id={id}
      className="of-row-cta"
      aria-describedby={messageId}
      tile={
        <RowIcon kind="photo">
          <IconPhoto size={18} />
        </RowIcon>
      }
      label={t('occasionForm.photo_add')}
      trailing={<IconChevron size={18} className="of-row-chevron" />}
      onClick={pick}
    />
  )
  // no photo (also: the stored one goes when saving): the motif part, when the form offers motifs
  const motif = cover?.view ? (
    <CoverMotif
      view={cover.view}
      browsing={cover.browsing}
      onBrowse={cover.onBrowse}
      onPick={(choice) => {
        setProblem(null)
        cover.onPick(choice)
      }}
      onAuto={cover.onAuto}
      onPhoto={pick}
      photoRow={photoRow}
    />
  ) : null
  // a photo shows (picked, stored, on its way): it wins over any motif
  let photoShown = true

  let body: ReactNode
  if (busy) {
    body = <Preview blob={null} caption={t('occasionForm.photo_preparing')} status={<Spinner />} />
  } else if (value.kind === 'picked') {
    body = (
      <Preview
        blob={value.photo.blob}
        caption={t('occasionForm.photo_label')}
        sub={t('occasionForm.photo_new_hint')}
        actions={<PreviewActions onReplace={pick} onRemove={remove} />}
      />
    )
  } else if (value.kind === 'remove') {
    photoShown = false
    body = (
      <>
        <div className="of-row of-row-static of-photo-removed">
          <RowIcon kind="photo">
            <IconPhoto size={18} />
          </RowIcon>
          <span className="of-row-text">
            <span className="of-row-label">{t('occasionForm.photo_removed')}</span>{' '}
            <span className="of-row-sub">{t('occasionForm.photo_removed_hint')}</span>
          </span>
          <Button size="sm" variant="ghost" icon={<IconUndo size={16} />} onClick={() => onChange({ kind: 'keep' })}>
            {t('occasionForm.photo_undo')}
          </Button>
        </div>
        {motif ? <div className="of-cover-sep">{motif}</div> : null}
      </>
    )
  } else if (job?.change.kind === 'upload') {
    body = (
      <Preview
        blob={job.change.photo.blob}
        caption={t('occasionForm.photo_label')}
        sub={
          job.status === 'offline'
            ? t('occasion.cover_offline_short')
            : job.status === 'failed'
              ? t('occasion.cover_failed_short')
              : t('occasion.cover_uploading')
        }
        status={sending ? <Spinner /> : undefined}
        actions={sending ? undefined : <PreviewActions onReplace={pick} onRemove={remove} />}
      />
    )
  } else if (job?.change.kind === 'remove' && sending) {
    body = (
      <div className="of-row of-row-static">
        <RowIcon kind="photo">
          <IconPhoto size={18} />
        </RowIcon>
        <span className="of-row-text">
          <span className="of-row-label">{t('occasion.cover_removing')}</span>
        </span>
        <Spinner />
      </div>
    )
  } else if (showStored) {
    body = (
      <Preview
        blob={current.data?.blob ?? null}
        caption={t('occasionForm.photo_label')}
        actions={<PreviewActions onReplace={pick} onRemove={remove} />}
      />
    )
  } else {
    photoShown = false
    body = motif ?? photoRow
  }

  return (
    <>
      <FrostGroup role="group" aria-label={t('occasionForm.photo_group')} className="of-photo-group" data-state={busy ? 'busy' : value.kind} data-motif={motif && !photoShown ? (cover?.view?.theme ?? 'none') : undefined}>
        {body}
        <input ref={input} type="file" accept="image/*" className="of-photo-input" tabIndex={-1} aria-hidden="true" onChange={(event) => void onFile(event)} />
      </FrostGroup>
      <FormBlock>
        <FieldMessage
          id={messageId}
          error={problem ? t(PROBLEM_KEY[problem]) : undefined}
          hint={motif && !photoShown ? t('occasionForm.cover_hint') : t('occasionForm.photo_hint')}
          icon={<IconInfo size={16} />}
        />
      </FormBlock>
    </>
  )
}

/** The cover as it will look: a 16:10 crop (the hero shows the photo's wide middle), with its controls. */
function Preview({ blob, caption, sub, status, actions }: {
  blob: Blob | null
  caption: string
  sub?: string
  status?: ReactNode
  actions?: ReactNode
}) {
  const { t } = useTranslation('occasionForm')
  const url = useObjectUrl(blob)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  return (
    <div className="of-photo">
      <div className="of-photo-frame" style={FRAME_STYLE} data-state={url ? (loadedUrl === url ? 'ready' : 'loading') : 'loading'}>
        {url ? (
          <img
            className="of-photo-img"
            src={url}
            alt={t('occasionForm.photo_preview_alt')}
            decoding="async"
            draggable={false}
            data-loaded={loadedUrl === url ? '' : undefined}
            onLoad={() => setLoadedUrl(url)}
          />
        ) : null}
        {actions ? <div className="of-photo-actions">{actions}</div> : null}
      </div>
      <div className="of-photo-caption" aria-live="polite">
        <RowIcon kind="photo">
          <IconPhoto size={18} />
        </RowIcon>
        <span className="of-row-text">
          <span className="of-row-label">{caption}</span>{' '}
          {sub ? <span className="of-row-sub">{sub}</span> : null}
        </span>
        {status}
      </div>
    </div>
  )
}

function PreviewActions({ onReplace, onRemove }: { onReplace: () => void; onRemove: () => void }) {
  const { t } = useTranslation('occasionForm')
  return (
    <>
      <Button size="sm" variant="glass" onClick={onReplace}>
        {t('occasionForm.photo_replace')}
      </Button>
      <Button size="sm" variant="glass" onClick={onRemove}>
        {t('occasionForm.photo_remove')}
      </Button>
    </>
  )
}
