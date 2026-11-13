import { Suspense, lazy } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Page } from '../../ui/Page'

// Shell rule: kit imports by file, not from the barrel (this file is in every route's initial chunk) —
// so no Button module (motion) either: the CTA is the kit's secondary pill as plain classes (ui/ctaClass).
// The card is a plain solid card (the frosted panel's CSS ships with the kit chunk, not with the shell).
import { SECONDARY_CTA } from '../../ui/ctaClass'

// the lost bunny is a lazy chunk (nothing of the mascot code in the shell)
const BunnyMoment = lazy(() => import('../mascot-ui/BunnyMoment').then((mod) => ({ default: mod.BunnyMoment })))

/** The lost bunny's host above the card (its paws rest 16 px onto the card; it stands in the middle, so the
 *  card's rounded corners need no clip curve). */
const BUNNY_HOST_PX = 132

/** One calm, centred message for an address that does not exist, and the way back to the start. */
export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <Page className="flex flex-col justify-center">
      <div className="relative mt-28">
        {/* a lost bunny climbs onto the card and looks left and right: "where are we?" */}
        <Suspense fallback={null}>
          <BunnyMoment
            kind="lost"
            minSize={104}
            maxSize={120}
            className="pointer-events-none absolute inset-x-0 z-2"
            style={{ top: 16 - BUNNY_HOST_PX, height: BUNNY_HOST_PX }}
          />
        </Suspense>
        <section className="relative z-1 flex flex-col items-center gap-3 rounded-card bg-surface px-5 pb-6 pt-8 text-center elev-2">
          <h1 className="t-title-1 text-text">{t('common.not_found_title')}</h1>
          <p className="max-w-[32ch] t-body text-text-2">{t('common.not_found_body')}</p>
          <div className="mt-3 w-full max-w-xs">
            <Link to="/" className={SECONDARY_CTA}>
              {t('common.to_start')}
            </Link>
          </div>
        </section>
      </div>
    </Page>
  )
}
