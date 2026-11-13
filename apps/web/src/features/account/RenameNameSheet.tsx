import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { LIMITS } from '../../lib/app'
import { getMe, updateMyProfile } from '../../lib/api/profile'
import { toAppError, type AppError } from '../../lib/errors'
import { Button, Skeleton, TextField } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { AuthError, useOnline } from '../auth/shared'

/** A fresh, account-pinned editor. Keep mounted while closing so the sheet can finish its exit. */
export function RenameNameSheet({ userId, open = true, onClose, onSaved }: {
  userId: string; open?: boolean; onClose: () => void; onSaved: (name: string) => void
}) {
  const { t } = useTranslation('settings')
  const online = useOnline()
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(false)
  const opening = useRef(0)
  const working = useRef(false)
  const [renderedOpening, setRenderedOpening] = useState(open ? userId : null)
  const openingAccount = open ? userId : null
  // Reset a new opening before it paints, while retaining the old fields throughout the close animation.
  if (openingAccount !== renderedOpening) {
    setRenderedOpening(openingAccount)
    if (open) { setName(null); setError(null); setBusy(false) }
  }
  const overLimit = name !== null && [...name].length > LIMITS.displayName
  const valid = name !== null && Boolean(name.trim()) && !overLimit && !/[\n\r\t]/.test(name)

  useEffect(() => {
    if (!open) return
    opening.current += 1
    alive.current = true
    let currentOpening = true
    working.current = false
    const epoch = captureEpoch()
    void getMe(userId).then((me) => {
      if (currentOpening && alive.current && epoch.isCurrent()) setName(me.profile.display_name ?? '')
    }).catch((err: unknown) => {
      if (currentOpening && alive.current && epoch.isCurrent()) setError(toAppError(err))
    })
    return () => { currentOpening = false; alive.current = false }
  }, [userId, open])

  async function save(event: FormEvent) {
    event.preventDefault()
    const epoch = captureEpoch()
    if (!open || !valid || !online || working.current || !epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    const startedIn = opening.current
    const isCurrentOpening = () => alive.current && opening.current === startedIn && epoch.isCurrent()
    working.current = true
    setBusy(true)
    setError(null)
    try {
      const profile = await updateMyProfile({ display_name: name!.trim() }, userId)
      if (isCurrentOpening()) {
        onSaved(profile.display_name ?? name!.trim())
        onClose()
      }
    } catch (err) {
      if (isCurrentOpening()) setError(toAppError(err))
    } finally {
      if (opening.current === startedIn) working.current = false
      if (isCurrentOpening()) setBusy(false)
    }
  }

  return <Sheet open={open} title={t('settings.change_name')} closeLabel={t('common.close')} onClose={onClose}>
    <form onSubmit={(event) => { void save(event) }} className="flex flex-col gap-4">
      {name === null ? <Skeleton height={64} /> : <TextField autoFocus label={t('settings.name')} autoComplete="nickname" value={name}
        onChange={(event) => setName(event.target.value)} disabled={busy}
        error={overLimit ? t('settings.name_too_long', { max: LIMITS.displayName }) : undefined} />}
      <AuthError error={error} />
      <Button type="submit" size="lg" fullWidth disabled={!valid || !online} loading={busy}>{t('common.save')}</Button>
      <Button variant="ghost" fullWidth onClick={onClose}>{t('common.cancel')}</Button>
    </form>
  </Sheet>
}
