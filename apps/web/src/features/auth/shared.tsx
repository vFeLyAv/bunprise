import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_NAME } from '../../lib/app'
import type { AppError } from '../../lib/errors'

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

export function usePageTitle(title: string): void {
  useEffect(() => { document.title = title === APP_NAME ? APP_NAME : `${title} · ${APP_NAME}` }, [title])
}

export function AuthError({ error }: { error: AppError | null }) {
  const { t } = useTranslation('errors')
  return error ? <p role="alert" className="t-footnote text-danger">{t(error.key, error.params)}</p> : null
}

