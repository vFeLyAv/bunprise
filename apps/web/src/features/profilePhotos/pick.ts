import type { TFunction } from 'i18next'
import type { ProfilePhotoKind } from '../../lib/api/profilePhotos'
import { isFeatureUnavailableError } from '../../lib/api/unavailable'
import { toAppError } from '../../lib/errors'
import { feedback } from '../../lib/haptics'
import { toast } from '../../lib/toast'
import type { PreparedPhoto } from '../occasions/photo/pipeline'

// Picking my own profile / banner photo: the picked file is made small ON THE DEVICE (the shared pipeline,
// features/occasions/photo/pipeline.ts — re-encoded WebP/JPEG ≤ 400 KB, no EXIF/GPS). The profile photo is shown
// round and small: a centred 512 px square; the banner keeps the whole picture at up to 1600 px (shown with cover).

/** The avatar's square side (≈ 3× the biggest avatar of 88 px, sharp on every phone). */
export const AVATAR_SIDE = 512

const PROBLEM_KEY = { not_image: 'lists.cover.not_image', too_large: 'lists.cover.too_large', failed: 'lists.cover.failed' } as const

/** The prepared photo, or null after the calm "not this file" toast. */
export async function prepareProfilePhoto(file: Blob, kind: ProfilePhotoKind, t: TFunction<'lists'>): Promise<PreparedPhoto | null> {
  const { preparePhoto, browserPhotoDeps, PhotoPrepareError } = await import('../occasions/photo/pipeline')
  try {
    return await preparePhoto(file, browserPhotoDeps(), kind === 'avatar' ? { square: true, maxSide: AVATAR_SIDE } : {})
  } catch (err) {
    feedback('error')
    toast.error(t(err instanceof PhotoPrepareError ? PROBLEM_KEY[err.problem] : PROBLEM_KEY.failed))
    return null
  }
}

/** Says calmly why saving my photo did not work (the stored picture is back already). */
export function profilePhotoError(t: TFunction<'lists'>, err: unknown, kind: ProfilePhotoKind): void {
  feedback('error')
  if (isFeatureUnavailableError(err)) {
    toast.info(t('lists.photo.soon'))
    return
  }
  const error = toAppError(err)
  if (error.code === 'network') toast.error(t('lists.create.offline'))
  else toast.error(t(kind === 'avatar' ? 'lists.photo.avatar_failed' : 'lists.banner.failed'))
}
