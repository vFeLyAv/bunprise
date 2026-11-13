import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { LargeTitle } from '../../ui'
import { textLinkClass } from './textLink'
import './legal.css'
import { internalPath } from '../../lib/navigation'

function linkTarget(value: string): string | null {
  const internal = internalPath(value)
  if (internal) return internal
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

const EMAIL = /^[\w.%+-]+@[\w-]+(?:\.[\w-]+)+$/

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|[\w.%+-]+@[\w-]+(?:\.[\w-]+)+)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>
    // A contact address: a mail link that is never hyphenated (a "-" inside it would be copied as part of the
    // address); on a narrow phone it may only break after the "@".
    if (EMAIL.test(part)) {
      const at = part.indexOf('@')
      return <a key={index} href={`mailto:${part}`} className={`${textLinkClass} hyphens-none`}>{part.slice(0, at + 1)}<wbr />{part.slice(at + 1)}</a>
    }
    const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (match) {
      const target = linkTarget(match[2] ?? '')
      if (target) return target.startsWith('/')
        ? <Link key={index} to="." href={target} className={textLinkClass}>{match[1]}</Link>
        : <a key={index} href={target} className={textLinkClass} rel="noreferrer">{match[1]}</a>
    }
    return <Fragment key={index}>{part}</Fragment>
  })
}

/**
 * Small, non-HTML renderer for our archived drafts: headings, paragraphs, lists and links. The title scales
 * with the card so "Datenschutzerklärung" fits on a phone (legal.css); long words are hyphenated where the
 * browser can (the <article> carries the text's lang); break-words stays the last resort (addresses, URLs).
 */
export function LegalMarkdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\r?\n\s*\r?\n/)
  return (
    <div className="legal-doc space-y-5 break-words hyphens-auto t-body text-text">
      {blocks.map((block, index) => {
        const heading = /^(#{1,3}) (.+)$/.exec(block)
        if (heading) {
          const content = inline(heading[2] ?? '')
          if (heading[1] === '#') return <LargeTitle key={index} className="legal-title">{content}</LargeTitle>
          if (heading[1] === '##') return <h2 key={index} className="pt-3 t-title-2">{content}</h2>
          return <h3 key={index} className="pt-2 t-headline">{content}</h3>
        }
        const lines = block.split(/\r?\n/)
        if (lines.every((line) => line.startsWith('- '))) {
          return <ul key={index} className="list-disc space-y-2 pl-5">{lines.map((line, item) => <li key={item}>{inline(line.slice(2))}</li>)}</ul>
        }
        if (lines.every((line) => line.startsWith('> '))) {
          return <blockquote key={index} className="border-l-2 border-separator pl-4 t-footnote text-text-2">{inline(lines.map((line) => line.slice(2)).join(' '))}</blockquote>
        }
        return <p key={index} className="whitespace-pre-line">{inline(block)}</p>
      })}
    </div>
  )
}
