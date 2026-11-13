import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button, LargeTitle, Page, SkeletonList, TopBar } from '../../ui'
import { APP_NAME } from '../../lib/app'
import { contentLocale, currentLanguage } from '../../lib/i18n'
import type { Locale } from '../../lib/api/types'
import { IMPRINT_VERSION, loadLegalText, type LegalDocumentKind, type LegalText } from './archive'
import { LegalMarkdown } from './LegalMarkdown'
import { BunnyMoment } from '../mascot-ui/BunnyMoment'
import { MotionScope } from '../../motion/MotionScope'

/** The sleepy bunny's host above the reading card (its paws rest 16 px onto the card). */
const BUNNY_HOST_PX = 124

const titles: Record<LegalDocumentKind, string> = {
  terms: 'legal.terms_title', privacy_notice: 'legal.privacy_title',
  age_18plus: 'legal.age_title', impressum: 'legal.impressum_title',
}

interface Loaded {
  key: string
  document: LegalText | null
  failed: boolean
}

// Texts the route loader already fetched (memory only; they are public, archived and immutable).
const warmed = new Map<string, Loaded>()

function textKey(kind: LegalDocumentKind, version: string, locale: Locale): string {
  return `${kind}:${version}:${locale}`
}

/**
 * The route loaders call this (legal.*.tsx, split into the page's lazy chunk): the page then renders
 * with its text at once — no skeleton that the text replaces, so the footer never jumps (perf audit:
 * CLS 0.019). A failure is not thrown: the page shows its own message and retry.
 */
export async function warmLegalText(kind: LegalDocumentKind, version: string, locale: Locale = contentLocale()): Promise<void> {
  const key = textKey(kind, version, locale)
  if (warmed.has(key)) return
  try {
    warmed.set(key, { key, document: await loadLegalText(kind, version, locale), failed: false })
  } catch {
    /* the page loads it again and shows the retry */
  }
}

export interface LegalPageProps {
  kind: LegalDocumentKind
  version: string
  locale?: Locale
}

export function LegalPage({ kind, version, locale: requestedLocale }: LegalPageProps) {
  const { t } = useTranslation('legal')
  const router = useRouter()
  const language = currentLanguage()
  // a UI language without legal texts of its own (Russian, Ukrainian) shows the German ones, with a note in its language
  const locale = requestedLocale ?? contentLocale(language)
  const foreignText = contentLocale(language) !== language
  const key = textKey(kind, version, locale)
  const [result, setResult] = useState<Loaded | null>(null)
  const [retry, setRetry] = useState(0)
  const title = t(titles[kind])
  // the text the loader warmed counts until the page loads its own (a retry)
  const ready = retry === 0 ? warmed.get(key) : undefined
  const preloaded = ready?.document ? ready : null

  useEffect(() => { document.title = `${title} · ${APP_NAME}` }, [title])
  useEffect(() => {
    if (preloaded) return
    let cancelled = false
    void loadLegalText(kind, version, locale).then(
      (document) => { if (!cancelled) setResult({ key, document, failed: false }) },
      () => { if (!cancelled) setResult({ key, document: null, failed: true }) },
    )
    return () => { cancelled = true }
  }, [key, kind, version, locale, retry, preloaded])

  const current = result?.key === key ? result : preloaded
  const card = useRef<HTMLElement>(null)
  // its own motion scope (the shell has no LazyMotion: docs/decisions/2026-10-20-motion-scope.md)
  return (
    <MotionScope>
    <Page topBar={<TopBar title={title} back={{ label: t('common.back'), onClick: () => {
      if (router.history.canGoBack()) router.history.back()
      else void router.navigate({ to: '/' })
    } }} />} className="pb-10">
      {/* legal texts are long: Pompon's friend nods off on the edge of the reading card (a floating z) */}
      <div className="relative mt-24">
      <BunnyMoment kind="sleepy" cardRef={card} minSize={96} maxSize={112}
        className="pointer-events-none absolute inset-x-0 z-2" style={{ top: 16 - BUNNY_HOST_PX, height: BUNNY_HOST_PX }} />
      <article ref={card} lang={locale} className="glass-panel relative z-1 space-y-5 rounded-card px-5 pb-6 pt-7">
        {current?.document ? <>
          {foreignText && current.document.locale === 'de'
            ? <p lang={language} className="t-footnote rounded-control bg-fill-2 px-3 py-2 text-text-2">{t('legal.only_de_en')}</p>
            : null}
          <LegalMarkdown text={current.document.text} />
          <p className="t-caption-1 text-text-2">{t('legal.archive_version', { version: current.document.version, language: locale.toUpperCase() })}</p>
        </> : current ? <>
          <LargeTitle>{title}</LargeTitle>
          <p role="alert" className="t-body">{t(current.failed ? 'legal.load_failed' : 'legal.version_unavailable', { version })}</p>
          {current.failed ? <Button onClick={() => setRetry((value) => value + 1)}>{t('common.retry')}</Button> : null}
        </> : (
          // only when the text was not warmed (a slow chunk): one screen tall, so the footer stays below the fold
          <div role="status" aria-label={t('common.loading')} className="min-h-[calc(100dvh-var(--topbar-h)-var(--sa-top))]">
            <SkeletonList rows={5} rowHeight={72} />
          </div>
        )}
      </article>
      </div>
    </Page>
    </MotionScope>
  )
}

export { IMPRINT_VERSION }
