import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

// Impressum · Datenschutz · Nutzungsbedingungen on every screen before sign-in — start, login, code,
// /auth/callback, the invite landing /i, the legal pages themselves — and on the 404 / error views
// (CLAUDE.md "Legal", legal-pilot.md 1.9, pilot-decisions §00.2). Signed in, the Profil tab's
// "Rechtliches" section has the same three links instead (the `_authed` layout sets
// staticData.legalFooter = false; the sign-up step /welcome/profile sets it back to true).
// Shell rule: kit imports by file, not from the barrel.

/** A route's word on the footer: shown or not — or decided by that route's validated search (wave 2). */
export type LegalFooterFlag = boolean | ((search: Record<string, unknown>) => boolean)

/**
 * The deepest matched route that says so decides; without a word from any route the footer shows. A function
 * decides by the match's search: the sign-up step /welcome/profile keeps the footer, but not when the Profil
 * tab opened the same screen as "Name ändern" (`?from=profile`, no consent is asked there).
 */
export function legalFooterShown(matches: ReadonlyArray<{ staticData?: { legalFooter?: LegalFooterFlag }; search?: unknown }>): boolean {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]
    const value = match?.staticData?.legalFooter
    if (typeof value === 'function') {
      const search = match?.search
      return value(search && typeof search === 'object' ? (search as Record<string, unknown>) : {})
    }
    if (typeof value === 'boolean') return value
  }
  return true
}
// Quiet secondary links (design spec §3 LegalFooter, blocker 13): --text-2 and always underlined —
// not the accent, which belongs to actions; the underline keeps them recognisable as links.
const FOOTER_LINK = 'inline-flex min-h-11 items-center rounded-xs text-text-2 underline underline-offset-2 tr-colors hover:text-text active:text-text'

export function LegalFooter() {
  const { t } = useTranslation()
  return (
    <footer className="mx-auto w-full max-w-(--page-w) px-safe pb-safe pt-6 text-center t-footnote text-text-2">
      {/* no "·" between the links: on a narrow screen the row wraps, and a separator would dangle at a line's
          end ("Impressum · Datenschutz ·"); the gap and the underlines keep the three links apart */}
      <nav aria-label={t('footer.title')} className="flex flex-wrap items-center justify-center gap-x-3">
        <Link to="/legal/impressum" className={FOOTER_LINK}>
          {t('footer.impressum')}
        </Link>
        <Link to="/legal/datenschutz" className={FOOTER_LINK}>
          {t('footer.privacy')}
        </Link>
        <Link to="/legal/nutzung" className={FOOTER_LINK}>
          {t('footer.terms')}
        </Link>
      </nav>
      <p className="mt-1">{t('footer.pilot_badge')}</p>
    </footer>
  )
}
