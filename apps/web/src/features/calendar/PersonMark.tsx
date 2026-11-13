import type { CSSProperties } from 'react'
import { cn } from '../../ui'
import { GlyphPerson } from '../nav/glyphs'
import type { Person, PersonTone } from './people'
// the person tones (.person-tone, --person-*) live with the tile tints
import '../../styles/tiles.css'

// A person's colour as a mark (wave 2, K-cal): the initials avatar of the people filter and of Start's feed
// cards, and the small dot in front of "Anna lädt ein". Decorative — the text next to it names the person.

export interface PersonAvatarProps {
  person: Pick<Person, 'key' | 'initials' | 'tone'>
  /** px */
  size: number
  className?: string
  style?: CSSProperties
}

/** Initials on the person's chip colour (you: a person glyph on the accent). */
export function PersonAvatar({ person, size, className, style }: PersonAvatarProps) {
  const letters = person.initials
  return (
    <span
      aria-hidden="true"
      data-person-tone={person.tone}
      className={cn('person-tone inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * (letters.length > 1 ? 0.4 : 0.46)), letterSpacing: '-0.01em', ...style }}
    >
      {letters || <GlyphPerson size={Math.round(size * 0.66)} strokeWidth={2} />}
    </span>
  )
}

/** A 10 px dot in the person's colour, ringed with its ink: the same colour as their day chips. */
export function PersonDot({ tone, className }: { tone: PersonTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-person-tone={tone}
      className={cn('person-tone inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ boxShadow: 'inset 0 0 0 1.5px var(--person-ink, currentColor)' }}
    />
  )
}

/**
 * "Ben Mustermann lädt ein" in a narrow row: only the name gives way (ellipsis), the words around it stay —
 * wherever the language puts the name. `text` is the whole translated line, `name` the name inside it.
 */
export function HostLine({ text, name }: { text: string; name: string }) {
  const at = name ? text.indexOf(name) : -1
  if (at < 0) return <span className="truncate">{text}</span>
  return (
    <span className="flex min-w-0 whitespace-pre">
      {text.slice(0, at)}
      <span className="truncate">{name}</span>
      {text.slice(at + name.length)}
    </span>
  )
}
