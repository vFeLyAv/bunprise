import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import type { ProfilePhotoMeta } from '../../lib/api/types'
import { feedback } from '../../lib/haptics'
import { toast } from '../../lib/toast'
import { Button, IconTrash, haptic } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { ProfileAvatar } from '../nav/ProfileAvatar'
import type { PreparedPhoto } from '../occasions/photo/pipeline'
import { GlyphCamera } from './GlyphCamera'
import { AvatarPhoto, PickedPhoto } from './PersonPhoto'
import { changeOwnPhoto, effectiveMeta, markOwnPhotoPreparing, useOwnPhotoChange } from './photos'
import { prepareProfilePhoto, profilePhotoError } from './pick'
import './profilePhotos.css'

// "Profilbild" (Felix 24.10) — OWNER module: my own picture only. Two choices with a live preview on top:
//   Foto       my own photo (choose / another one); the picked file is made small on the device first (pick.ts:
//              a centred 512 px square, WebP/JPEG, no EXIF/GPS) and only shown here until "Übernehmen"
//   Initialen  the initials avatar as before (= the stored photo is removed on "Übernehmen")
// "Übernehmen" is OPTIMISTIC like the banner sheet: every place that shows me switches at once (photos.ts keeps my
// change in memory), the server confirms, a failure brings the old picture back with a calm toast. A save belongs to
// the account that started it (captureEpoch). A server without the migration (`supported` false): the photo choice
// says "Das geht bald" and nothing is sent.

export interface AvatarSheetProps {
  open: boolean
  onClose: () => void
  userId: string
  name: string | null
  /** my stored profile photo's meta (get_me / the overview) — null without one */
  photo: ProfilePhotoMeta | null | undefined
  /** false = the server does not have profile photos yet (the meta key is missing from its answer) */
  supported: boolean
}

type Choice = 'photo' | 'initials'

export default function AvatarSheet({ open, onClose, userId, name, photo, supported }: AvatarSheetProps) {
  const { t } = useTranslation('lists')
  const queryClient = useQueryClient()
  const online = useOnline()
  const change = useOwnPhotoChange(userId, 'avatar')
  const stored = effectiveMeta(change, photo)
  // a photo on its way counts, one being removed does not
  const hasStored = change?.kind === 'upload' || (change?.kind !== 'remove' && stored !== null)
  const [choice, setChoice] = useState<Choice>(hasStored ? 'photo' : 'initials')
  const [picked, setPicked] = useState<PreparedPhoto | null>(null)
  const [preparing, setPreparing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // every opening starts from what is shown now
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setChoice(hasStored ? 'photo' : 'initials')
      setPicked(null)
    }
  }

  function pick() {
    if (!supported) {
      toast.info(t('lists.photo.soon'))
      return
    }
    // in the tap itself (a user gesture): the system picker — library or camera on a phone
    input.current?.click()
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // the same file can be picked again
    if (!file) return
    const epoch = captureEpoch()
    setPreparing(true)
    markOwnPhotoPreparing(userId, 'avatar', true)
    try {
      const prepared = await prepareProfilePhoto(file, 'avatar', t)
      if (!prepared || !epoch.isCurrent()) return
      setPicked(prepared)
      setChoice('photo')
    } finally {
      markOwnPhotoPreparing(userId, 'avatar', false)
      if (epoch.isCurrent()) setPreparing(false)
    }
  }

  function apply() {
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    onClose()
    const upload = choice === 'photo' ? picked : null
    const remove = choice === 'initials' && hasStored
    if (!upload && !remove) return
    feedback('success')
    void changeOwnPhoto({
      userId,
      kind: 'avatar',
      queryClient,
      change: upload ? { kind: 'upload', photo: upload } : { kind: 'remove' },
      onError: (err) => profilePhotoError(t, err, 'avatar'),
    }).then((ok) => {
      if (ok) toast.success(t(upload ? 'lists.photo.avatar_saved' : 'lists.photo.avatar_removed'))
    })
  }

  const canApply = online && !preparing && (choice === 'initials' || picked !== null || hasStored)

  // the preview: the picked file, else my stored photo (with my change on its way), else the initials
  const previewPhoto = choice === 'initials' ? null : picked ? <PickedPhoto blob={picked.blob} kind="avatar" /> : <AvatarPhoto profileId={userId} meta={photo} eager />

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('lists.photo.avatar_title')}
      closeLabel={t('common.close')}
      footer={
        <Button size="lg" fullWidth disabled={!canApply} onClick={apply}>
          {t('lists.banner.apply')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-2" data-avatar-sheet="">
        <div aria-hidden="true" className="pph-preview">
          <ProfileAvatar seed={userId} name={name} size={112} className="pph-preview-avatar">
            {previewPhoto}
          </ProfileAvatar>
        </div>

        <div role="radiogroup" aria-label={t('lists.photo.avatar_title')} className="pph-options">
          <Option
            selected={choice === 'photo'}
            disabled={!supported}
            label={t('lists.photo.avatar_photo')}
            hint={!supported ? t('lists.photo.soon') : !hasStored && !picked ? t('lists.photo.pick') : undefined}
            onSelect={() => {
              if (!supported || (!hasStored && !picked)) pick()
              else setChoice('photo')
            }}
          >
            <ProfileAvatar seed={userId} name={name} size={64}>
              {picked ? <PickedPhoto blob={picked.blob} kind="avatar" /> : hasStored ? <AvatarPhoto profileId={userId} meta={photo} eager /> : (
                <span className="pph-own-placeholder pph-own-fill"><GlyphCamera size={26} /></span>
              )}
            </ProfileAvatar>
          </Option>
          <Option selected={choice === 'initials'} label={t('lists.photo.avatar_initials')} onSelect={() => setChoice('initials')}>
            <ProfileAvatar seed={userId} name={name} size={64} />
          </Option>
        </div>

        {supported && (choice === 'photo' && (picked || hasStored)) ? (
          <div className="pph-actions">
            <Button variant="secondary" size="sm" icon={<GlyphCamera size={18} />} hapticKind="select" disabled={!online || preparing} onClick={pick}>
              {preparing ? t('lists.photo.preparing') : t('lists.photo.change')}
            </Button>
            <Button variant="ghost" size="sm" icon={<IconTrash />} hapticKind="select" disabled={!online || preparing} onClick={() => {
              setPicked(null)
              setChoice('initials')
            }}>
              {t('lists.photo.remove')}
            </Button>
          </div>
        ) : null}

        <p className="t-footnote text-text-2">{t('lists.photo.who_sees')}</p>
      </div>
      {/* inside the sheet: it stays open while the system picker is up */}
      <input ref={input} type="file" accept="image/*" className="pph-file" tabIndex={-1} aria-hidden="true" onChange={(event) => void onFile(event)} />
    </Sheet>
  )
}

function Option({ selected, disabled = false, label, hint, onSelect, children }: {
  selected: boolean
  disabled?: boolean
  label: string
  hint?: string
  onSelect: () => void
  children: ReactNode
}) {
  const [pressed, setPressed] = useState(false)
  useEffect(() => {
    if (!pressed) return
    const id = setTimeout(() => setPressed(false), 160)
    return () => clearTimeout(id)
  }, [pressed])
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      className="pph-option"
      data-pressed={pressed ? '' : undefined}
      onPointerDown={() => {
        haptic('select')
        setPressed(true)
      }}
      onClick={onSelect}
    >
      {children}
      <span className="pph-option-label">{label}</span>
      {hint ? <span className="pph-option-hint">{hint}</span> : null}
    </button>
  )
}
