import type { ReactNode } from 'react'

/**
 * German copy: "E-Mail" must not split at its hyphen at a line end ("keine E-|Mail"). Each occurrence is kept
 * on one line (a nowrap span), so the visible text and its text content stay exactly the translated string.
 * "E-Mail-Adresse" may still break at its second hyphen ("E-Mail-|Adresse"), which reads naturally.
 */
export function keepWords(text: string): ReactNode {
  const parts = text.split(/(E-Mail)/)
  if (parts.length === 1) return text
  return parts.map((part, index) => (index % 2 === 1 ? <span key={index} className="whitespace-nowrap">{part}</span> : part))
}
