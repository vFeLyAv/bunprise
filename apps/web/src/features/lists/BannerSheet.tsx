import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { setMyBanner } from '../../lib/api/lists'
import type { BannerKey, ListsOverview } from '../../lib/api/lists.types'
import type { ProfilePhotoMeta } from '../../lib/api/types'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { toast } from '../../lib/toast'
import { Button, IconCheck, IconTrash, haptic } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { ProfileAvatar } from '../nav/ProfileAvatar'
import type { PreparedPhoto } from '../occasions/photo/pipeline'
import { GlyphCamera } from '../profilePhotos/GlyphCamera'
import { AvatarPhoto, BannerPhoto, PickedPhoto } from '../profilePhotos/PersonPhoto'
import { changeOwnPhoto, effectiveMeta, markOwnPhotoPreparing, useOwnPhotoChange } from '../profilePhotos/photos'
import { prepareProfilePhoto, profilePhotoError } from '../profilePhotos/pick'
import { BannerArt, GRADIENT_BANNERS, PATTERN_BANNERS } from './banners'
import { listsKeys } from './queries'

// "Dein Banner" (follows-design §2.2) — OWNER module. Since Felix 24.10 first "Eigenes Foto" (my own banner photo:
// choose / another one / remove — the picked file is made small on the device, features/profilePhotos/pick.ts), then
// the eight presets as before, with a live preview at the top (the same header in small). "Übernehmen" saves:
//   a preset   → profiles.banner through REST (OPTIMISTIC with rollback, as before) and, if I had a banner photo, it is
//                removed (the preset shows again);
//   my photo   → set_profile_photo('banner') — optimistic as well (features/profilePhotos/photos.ts keeps the change in
//                memory: the header shows it at once and goes back to the old picture if the server says no).
// The preset stays chosen underneath a photo (it is the fallback for everyone without the photo's bytes yet).
// A save belongs to the account that started it (captureEpoch): a late answer for a former account does nothing.
// A server without profile photos (`photosSupported` false): the photo choice says "Das geht bald", presets work.

export interface BannerSheetProps {
  open: boolean
  onClose: () => void
  userId: string
  name: string | null
  /** the preset banner shown now (chosen or derived) */
  current: BannerKey
  /** my stored banner photo's meta (null = none) */
  photo?: ProfilePhotoMeta | null
  /** my profile photo's meta (the preview's avatar) */
  avatarPhoto?: ProfilePhotoMeta | null
  /** false = the server does not have profile photos yet */
  photosSupported?: boolean
  /** a preset was applied (optimistic) or rolled back — for screens that keep their own copy (the Profil tab) */
  onPresetApplied?: (banner: BannerKey | null) => void
}

type Choice = { kind: 'preset'; key: BannerKey } | { kind: 'photo' }

export default function BannerSheet({
  open, onClose, userId, name, current, photo, avatarPhoto, photosSupported = false, onPresetApplied,
}: BannerSheetProps) {
  const { t } = useTranslation('lists')
  const queryClient = useQueryClient()
  const online = useOnline()
  const change = useOwnPhotoChange(userId, 'banner')
  const stored = effectiveMeta(change, photo)
  // a photo on its way counts, one being removed does not
  const hasStored = change?.kind === 'upload' || (change?.kind !== 'remove' && stored !== null)
  const initial = (): Choice => (hasStored ? { kind: 'photo' } : { kind: 'preset', key: current })
  const [choice, setChoice] = useState<Choice>(initial)
  const [picked, setPicked] = useState<PreparedPhoto | null>(null)
  const [preparing, setPreparing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  // every opening starts from the banner shown now
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setChoice(initial())
      setPicked(null)
    }
  }
  const presetKey = choice.kind === 'preset' ? choice.key : current

  function pick() {
    if (!photosSupported) {
      toast.info(t('lists.photo.soon'))
      return
    }
    // in the tap itself (a user gesture): the system picker
    input.current?.click()
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // the same file can be picked again
    if (!file) return
    const epoch = captureEpoch()
    setPreparing(true)
    markOwnPhotoPreparing(userId, 'banner', true)
    try {
      const prepared = await prepareProfilePhoto(file, 'banner', t)
      if (!prepared || !epoch.isCurrent()) return
      setPicked(prepared)
      setChoice({ kind: 'photo' })
    } finally {
      markOwnPhotoPreparing(userId, 'banner', false)
      if (epoch.isCurrent()) setPreparing(false)
    }
  }

  /** The preset part: optimistic in the tab's overview (and the caller's copy), rolled back on a refusal. */
  async function applyPreset(key: BannerKey): Promise<boolean> {
    const before = queryClient.getQueryData<ListsOverview>(listsKeys.overview())?.me.banner ?? null
    queryClient.setQueryData<ListsOverview>(listsKeys.overview(), (overview) => (overview ? { ...overview, me: { ...overview.me, banner: key } } : overview))
    onPresetApplied?.(key)
    if (key === current && before === key) return true
    const epoch = captureEpoch()
    try {
      await setMyBanner(key, userId)
      if (!epoch.isCurrent()) return false
      // a banner for their own lists page: a costume milestone of «Pompons Sammlung» (sammlung/milestones.ts)
      void import('../sammlung/note').then((m) => m.noteMilestone('banner'), () => undefined)
      return true
    } catch (err) {
      if (!epoch.isCurrent()) return false
      // rollback: the header shows the old banner again
      queryClient.setQueryData<ListsOverview>(listsKeys.overview(), (overview) => (overview ? { ...overview, me: { ...overview.me, banner: before } } : overview))
      onPresetApplied?.(before)
      const error = toAppError(err)
      feedback('error')
      toast.error(error.code === 'network' ? t('lists.create.offline') : t('lists.banner.failed'))
      return false
    }
  }

  async function apply() {
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    onClose()
    const upload = choice.kind === 'photo' ? picked : null
    const removePhoto = choice.kind === 'preset' && hasStored
    const presetChanges = choice.kind === 'preset' && choice.key !== current
    if (!upload && !removePhoto && !presetChanges) {
      if (choice.kind === 'preset') void applyPreset(choice.key) // keeps the tab's cache in step, sends nothing
      return
    }
    feedback('success')
    const photoDone = upload || removePhoto
      ? changeOwnPhoto({
          userId,
          kind: 'banner',
          queryClient,
          change: upload ? { kind: 'upload', photo: upload } : { kind: 'remove' },
          onError: (err) => profilePhotoError(t, err, 'banner'),
        })
      : Promise.resolve(true)
    const presetDone = choice.kind === 'preset' ? applyPreset(choice.key) : Promise.resolve(true)
    const [photoOk, presetOk] = await Promise.all([photoDone, presetDone])
    if (photoOk && presetOk && epoch.isCurrent()) toast.success(t('lists.banner.saved'))
  }

  const canApply = online && !preparing && (choice.kind === 'preset' || picked !== null || hasStored)
  const photoChosen = choice.kind === 'photo'
  const previewPhoto = !photoChosen ? null : picked ? <PickedPhoto blob={picked.blob} kind="banner" /> : <BannerPhoto profileId={userId} meta={photo} eager />

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('lists.banner.title')}
      closeLabel={t('common.close')}
      footer={
        <Button size="lg" fullWidth disabled={!canApply} onClick={() => void apply()}>
          {t('lists.banner.apply')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pb-2" data-banner-sheet="">
        {/* the live preview: the header as everyone who sees my lists sees it */}
        <div aria-hidden="true" className="lb-preview">
          <BannerArt banner={presetKey} animate className="lb-preview-banner" photo={previewPhoto} />
          <div className="lb-preview-id">
            <ProfileAvatar seed={userId} name={name} size={56} className="lb-preview-avatar">
              <AvatarPhoto profileId={userId} meta={avatarPhoto} eager />
            </ProfileAvatar>
            <span className="lb-preview-name t-headline">{name ?? t('lists.header.name_fallback')}</span>
          </div>
        </div>
        <p className="t-footnote text-text-2">{t('lists.banner.hint')}</p>

        <fieldset className="flex flex-col gap-2" data-own-banner="">
          <legend className="mb-2 t-footnote font-semibold uppercase tracking-[0.04em] text-text-2">{t('lists.photo.own_title')}</legend>
          <div role="radiogroup" aria-label={t('lists.photo.own_title')} className="lb-choices">
            <SwatchButton
              label={hasStored || picked ? t('lists.photo.own_label') : t('lists.photo.pick')}
              selected={photoChosen}
              disabled={!photosSupported}
              onSelect={() => {
                if (!photosSupported || (!hasStored && !picked)) pick()
                else setChoice({ kind: 'photo' })
              }}
            >
              <BannerArt
                banner={current}
                className="lb-swatch"
                photo={picked ? <PickedPhoto blob={picked.blob} kind="banner" /> : hasStored ? <BannerPhoto profileId={userId} meta={photo} eager /> : null}
              >
                {!hasStored && !picked ? (
                  <span aria-hidden="true" className="pph-own-placeholder pph-own-centre"><GlyphCamera size={24} /></span>
                ) : null}
                {photoChosen ? (
                  <span aria-hidden="true" className="lb-swatch-check">
                    <IconCheck size={16} />
                  </span>
                ) : null}
              </BannerArt>
            </SwatchButton>
          </div>
          {!photosSupported ? <p className="t-footnote text-text-2">{t('lists.photo.soon')}</p> : null}
          {photosSupported && photoChosen && (picked || hasStored) ? (
            <div className="pph-actions" data-align="start">
              <Button variant="secondary" size="sm" icon={<GlyphCamera size={18} />} hapticKind="select" disabled={!online || preparing} onClick={pick}>
                {preparing ? t('lists.photo.preparing') : t('lists.photo.change')}
              </Button>
              <Button variant="ghost" size="sm" icon={<IconTrash />} hapticKind="select" disabled={!online || preparing} onClick={() => {
                setPicked(null)
                setChoice({ kind: 'preset', key: current })
              }}>
                {t('lists.photo.remove')}
              </Button>
            </div>
          ) : null}
          {photosSupported ? <p className="t-footnote text-text-2">{t('lists.photo.who_sees')}</p> : null}
        </fieldset>

        <BannerGroup title={t('lists.banner.gradients')} keys={GRADIENT_BANNERS} value={choice.kind === 'preset' ? choice.key : null} onChange={(key) => setChoice({ kind: 'preset', key })} />
        <BannerGroup title={t('lists.banner.patterns')} keys={PATTERN_BANNERS} value={choice.kind === 'preset' ? choice.key : null} onChange={(key) => setChoice({ kind: 'preset', key })} />
      </div>
      {/* inside the sheet: it stays open while the system picker is up */}
      <input ref={input} type="file" accept="image/*" className="pph-file" tabIndex={-1} aria-hidden="true" onChange={(event) => void onFile(event)} />
    </Sheet>
  )
}

function BannerGroup({ title, keys, value, onChange }: { title: string; keys: readonly BannerKey[]; value: BannerKey | null; onChange: (key: BannerKey) => void }) {
  const { t } = useTranslation('lists')
  const name = (key: BannerKey) => t(`lists.banner.${key}`)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 t-footnote font-semibold uppercase tracking-[0.04em] text-text-2">{title}</legend>
      <div role="radiogroup" aria-label={title} className="lb-choices">
        {keys.map((key) => (
          <SwatchButton key={key} label={name(key)} selected={value === key} onSelect={() => onChange(key)}>
            <BannerArt banner={key} className="lb-swatch">
              {value === key ? (
                <span aria-hidden="true" className="lb-swatch-check">
                  <IconCheck size={16} />
                </span>
              ) : null}
            </BannerArt>
          </SwatchButton>
        ))}
      </div>
    </fieldset>
  )
}

function SwatchButton({ label, selected, disabled = false, onSelect, children }: {
  label: string
  selected: boolean
  disabled?: boolean
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
      className="lb-choice"
      data-pressed={pressed ? '' : undefined}
      onPointerDown={() => {
        haptic('select')
        setPressed(true)
      }}
      onClick={onSelect}
    >
      {children}
      <span className="lb-choice-label">{label}</span>
    </button>
  )
}
