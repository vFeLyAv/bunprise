import type { ReactNode } from 'react'
import { AnimatePresence, useIsPresent } from 'motion/react'
import * as m from 'motion/react-m'
import { Button, IconBack, IconCheck, cn, fade, haptic, useSpring, useTapScale } from '../../ui'

// Small building blocks of the onboarding screen. Text always comes in as props (i18n in the caller).

/**
 * What the bunny says on a step: one short phrase in a bubble whose tail points up at the bunny
 * (product-pilot S4 "one phrase per bubble"). It is the step's heading; WelcomePage focuses it when
 * the step slides in, so screen readers announce the new step.
 */
export function SpeechBubble({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto w-fit max-w-full rounded-xl bg-surface px-6 py-4 elev-1">
      <span
        aria-hidden="true"
        className="absolute -top-1.5 left-1/2 size-3.5 -translate-x-1/2 rotate-45 rounded-[3px] bg-surface"
      />
      <h1 tabIndex={-1} data-step-heading="" className="relative text-center t-title-2 text-balance text-text">
        {children}
      </h1>
    </div>
  )
}

/**
 * A step's heading without a bubble (Felix 25.10: the wish box and the occasion cards speak as big titles, the
 * bubble greets). Like SpeechBubble it is the heading WelcomePage focuses when the step slides in.
 */
export function StepHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="text-center">
      <h1 tabIndex={-1} data-step-heading="" className="t-title-1 text-balance text-text">
        {title}
      </h1>
      <p className="mt-1 t-body text-text-2">{sub}</p>
    </div>
  )
}

/** The calm sentence under the bubble. */
export function StepText({ children }: { children: ReactNode }) {
  return <p className="mx-auto mt-5 max-w-[34ch] text-center t-body text-text-2">{children}</p>
}

/** Bottom of a step: the primary action sits at the same place on every step (the step fills the screen). */
export function StepActions({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-col gap-3 pt-8">{children}</div>
}

export interface StepStatus {
  tone: 'error' | 'info'
  text: string
}

/**
 * A short line next to the step's action: an error (alert) or "needs the network" (status). It fades
 * and takes room from the free space above the anchored button, so the button itself never jumps.
 */
export function StatusMessage({ status }: { status: StepStatus | null }) {
  return (
    <AnimatePresence initial={false}>
      {status ? (
        <m.p
          key={status.tone}
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={cn('text-center t-footnote', status.tone === 'error' ? 'text-danger' : 'text-text-2')}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
        >
          {status.text}
        </m.p>
      ) : null}
    </AnimatePresence>
  )
}

export interface WishBubbleProps {
  icon: ReactNode
  label: string
  picked: boolean
  disabled?: boolean
  /** the bubble element itself: Pompon catches a flying copy of it */
  onPress: (bubble: HTMLButtonElement) => void
}

/** A wish bubble on the wish step: a pill with an icon; picked = a check and the accent (aria-pressed; welcome.css). */
export function WishBubble({ icon, label, picked, disabled = false, onPress }: WishBubbleProps) {
  const tap = useTapScale(0.94)
  const spring = useSpring('bouncy')
  return (
    <m.button
      type="button"
      aria-pressed={picked}
      disabled={disabled}
      className="wl-bubble t-callout tr-colors"
      whileTap={disabled ? undefined : tap}
      transition={spring}
      onPointerDown={() => {
        if (!disabled) haptic('tap')
      }}
      onClick={(event) => onPress(event.currentTarget)}
    >
      <span aria-hidden="true" className="wl-bubble-icon">
        {picked ? <IconCheck size={22} /> : icon}
      </span>
      {label}
    </m.button>
  )
}

export interface OccasionCardProps {
  icon: ReactNode
  label: string
  /** a short second line (the invite card: "a waiting invite") */
  note?: string
  selected: boolean
  disabled?: boolean
  onPress: () => void
}

/** An occasion card on the last step (spring press .96): picking one dresses Pompon (aria-pressed; welcome.css). */
export function OccasionCard({ icon, label, note, selected, disabled = false, onPress }: OccasionCardProps) {
  const tap = useTapScale(0.96)
  const spring = useSpring('bouncy')
  return (
    <m.button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className="wl-card tr-colors"
      whileTap={disabled ? undefined : tap}
      transition={spring}
      onPointerDown={() => {
        if (!disabled) haptic('select')
      }}
      onClick={onPress}
    >
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-md bg-accent-100 text-accent-text">
        {icon}
      </span>
      <span className="t-headline [overflow-wrap:anywhere]">{label}</span>
      {note ? <span className="-mt-1 t-footnote text-text-2">{note}</span> : null}
    </m.button>
  )
}

/**
 * Page dots in the top bar. The active one is darker and full size (snappy spring; under reduced
 * motion the size simply changes); the label says "Schritt 2 von 3".
 */
export function ProgressDots({ current, total, label }: { current: number; total: number; label: string }) {
  const spring = useSpring('snappy')
  return (
    <span role="img" aria-label={label} className="flex h-11 items-center justify-center gap-2">
      {Array.from({ length: total }, (_, index) => {
        const active = index + 1 === current
        return (
          <m.span
            key={index}
            className={cn('block size-2 rounded-full tr-colors', active ? 'bg-accent-text' : 'bg-fill-3')}
            initial={false}
            animate={{ scale: active ? 1 : 0.75 }}
            transition={spring}
          />
        )
      })}
    </span>
  )
}

interface BackButtonProps {
  label: string
  disabled: boolean
  onBack: () => void
}

/** "Zurück" in the top bar from step 2 on; it fades in and out instead of popping. */
export function BackButton({ visible, ...props }: BackButtonProps & { visible: boolean }) {
  return <AnimatePresence initial={false}>{visible ? <FadingBackButton key="back" {...props} /> : null}</AnimatePresence>
}

/** While it fades out it can no longer be pressed or focused (its handler belongs to the old step). */
function FadingBackButton({ label, disabled, onBack }: BackButtonProps) {
  const present = useIsPresent()
  return (
    <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} inert={!present}>
      <Button variant="ghost" size="md" icon={<IconBack />} className="-ml-1 pl-1" disabled={disabled || !present} onClick={onBack}>
        {label}
      </Button>
    </m.div>
  )
}
