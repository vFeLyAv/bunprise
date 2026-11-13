import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LargeTitle, Page } from '../../ui/Page'
import { APP_NAME } from '../../lib/app'
import type { Namespace } from '../../lib/i18n'

// Unimplemented route slot: its title stays visible until the feature component is ready.
// Feature agents replace the route's component; this file can go once no stub uses it.

export interface WipPageProps {
  /** full i18n key of the screen title, e.g. 'feed.title' */
  titleKey: string
  /** namespace that holds the title (loaded by the route loader) */
  ns?: Namespace
}

export function WipPage({ titleKey, ns = 'common' }: WipPageProps) {
  const { t } = useTranslation(ns)
  const title = t(titleKey)
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`
  }, [title])
  return (
    <Page>
      <LargeTitle>{title}</LargeTitle>
    </Page>
  )
}
