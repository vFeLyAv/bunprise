/**
 * A link INSIDE running text ("… in der Datenschutzerklärung.", the consent checkbox, the legal drafts): it flows
 * with the sentence like plain text. The kit's linkClass is a 44 px inline-flex box for links that stand alone;
 * inside a sentence that box pushed the link onto its own line and made 44 px tall lines (QA ACCOUNT-8). Here the
 * vertical padding gives the same hit area without changing the line height; always underlined, so the link is
 * recognisable without its colour (WCAG 1.4.1).
 */
export const textLinkClass = 'rounded-xs py-3 text-accent-text underline underline-offset-2 active:text-(--accent-text-strong) tr-colors'
