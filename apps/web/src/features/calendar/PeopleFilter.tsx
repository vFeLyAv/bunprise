import type { PointerEvent, ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { cn, haptic, useSpring, useTapScale } from '../../ui'
import { ME, toggleSelection, type PeopleSelection, type Person, type PersonKey } from './people'
import { PersonAvatar } from './PersonMark'

// The people filter above the month (wave 2, K-cal): "Alle", "Du" and one pill per person — their initials
// in their colour, so the row is also the colour legend of the chips below. A tap on a person shows only
// theirs (then more people can join, people.ts toggleSelection); "Alle" shows everyone again. The legend
// effect: a person under the mouse or the keyboard focus lets everyone else's chips step back.
// Toggle buttons (aria-pressed) in a labelled group; 36 px pills with a 44 px hit area; the row scrolls
// sideways when there are many people.

function Pill({
  pressed,
  person,
  onPress,
  onPreview,
  children,
}: {
  pressed: boolean
  /** a person's pill: wears their colour when chosen */
  person?: Person
  onPress: () => void
  onPreview?: (on: boolean) => void
  children: ReactNode
}) {
  const tap = useTapScale(0.95)
  const spring = useSpring('snappy')
  const hover = (on: boolean) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse') onPreview?.(on)
  }
  return (
    <m.button
      type="button"
      aria-pressed={pressed}
      className={cn('cal-pill', person ? 'cal-pill-person' : 'cal-pill-all', person && pressed && 'person-tone')}
      data-person-tone={person && pressed ? person.tone : undefined}
      whileTap={tap}
      transition={spring}
      onPointerDown={() => haptic('select')}
      onPointerEnter={hover(true)}
      onPointerLeave={hover(false)}
      onFocus={() => onPreview?.(true)}
      onBlur={() => onPreview?.(false)}
      onClick={onPress}
    >
      {children}
    </m.button>
  )
}

export interface PeopleFilterProps {
  people: readonly Person[]
  selection: PeopleSelection
  onChange: (selection: PeopleSelection) => void
  /** the legend effect: the person under the pointer / focus, null when it leaves */
  onPreview: (key: PersonKey | null) => void
}

export function PeopleFilter({ people, selection, onChange, onPreview }: PeopleFilterProps) {
  const { t } = useTranslation('nav')
  return (
    <div role="group" aria-label={t('cal.filter_label')} className="cal-people" data-filtering={selection ? '' : undefined}>
      <Pill pressed={selection === null} onPress={() => (selection ? onChange(null) : undefined)}>
        {t('cal.filter_all')}
      </Pill>
      {people.map((person) => (
        <Pill
          key={person.key}
          person={person}
          pressed={selection?.has(person.key) ?? false}
          onPress={() => onChange(toggleSelection(selection, person.key, people))}
          onPreview={(on) => onPreview(on ? person.key : null)}
        >
          <PersonAvatar person={person} size={26} className="cal-pill-avatar" />
          <span className="cal-pill-name">{person.key === ME ? t('cal.filter_me') : person.short || person.initials}</span>
        </Pill>
      ))}
    </div>
  )
}
