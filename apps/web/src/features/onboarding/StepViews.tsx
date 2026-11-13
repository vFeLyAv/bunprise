import { useEffect, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { GiftInterest } from '../../lib/api/giftIdeas'
import { Button, IconCheck, IconPlus, IconShare, listItemClass, listRowClass } from '../../ui'
import type { IconProps } from '../../ui/iconBase'
import { IconBook, IconCake, IconCup, IconDice, IconEnvelope, IconHeadphones, IconHeart, IconPlant, IconSuitcase, IconTree } from './icons'
import { OccasionCard, SpeechBubble, StatusMessage, StepActions, StepHeading, StepText, WishBubble, type StepStatus } from './parts'
import type { Costume } from './pompon'

// The content of each onboarding step (product-pilot S4; Felix 25.10 — the three screens approved in the mascot
// gallery). Layout, Pompon and motion live in WelcomePage / WelcomePompon / StepFrame.
// `status` = an error of the last attempt to finish, or "needs the network"; it sits next to the action.

export interface ActionState {
  /** the control may not be used now (another one is finishing, or it would need the network) */
  disabled: boolean
  /** this control is finishing the onboarding right now */
  loading: boolean
}

export interface HelloStepProps {
  greeting: string
  disabled: boolean
  status: StepStatus | null
  /** Pompon is there to be petted (bunnies shown) and has not been petted yet: the hint may appear */
  petHint: boolean
  onNext: () => void
}

/** How long the greeting waits before it whispers "streichel mich mal" (gallery prototype: 3.5 s). */
export const PET_HINT_MS = 3500

/** Step 1: the bunny greets by name; the slogan says what the app is for (Felix 25.10: a feeling, not features). */
export function HelloStep({ greeting, disabled, status, petHint, onNext }: HelloStepProps) {
  const { t } = useTranslation('onboarding')
  // "Träumen. Wünschen. Freude schenken." — one short phrase per line
  const slogan = t('onb.slogan').split(/(?<=\.)\s+/)
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    if (!petHint) return undefined
    const timer = setTimeout(() => setWaited(true), PET_HINT_MS)
    return () => clearTimeout(timer)
  }, [petHint])
  const hint = petHint && waited
  return (
    <>
      <SpeechBubble>{greeting}</SpeechBubble>
      <p className="mx-auto mt-8 text-center t-title-1 text-text">
        {slogan.map((line) => <span key={line} className="block">{line}</span>)}
      </p>
      {/* reserved height, fades in (no layout shift); the bunny's own button carries the meaning */}
      <p
        aria-hidden="true"
        data-pet-hint={hint ? 'shown' : 'hidden'}
        className="wl-hint mt-4 text-center t-footnote text-text-3"
      >
        {t('onb.pet_hint')}
      </p>
      <StepActions>
        <StatusMessage status={status} />
        <Button size="lg" fullWidth disabled={disabled} onClick={onNext}>
          {t('onb.next')}
        </Button>
      </StepActions>
    </>
  )
}

/** The wish bubbles: each is one interest id of "Ideen" (lib/api/giftIdeas.ts GIFT_INTERESTS). */
export const WISH_CHOICES: ReadonlyArray<{ id: GiftInterest; key: string; Icon: ComponentType<IconProps> }> = [
  { id: 'books', key: 'onb.wish_books', Icon: IconBook },
  { id: 'audio', key: 'onb.wish_audio', Icon: IconHeadphones },
  { id: 'coffee', key: 'onb.wish_coffee', Icon: IconCup },
  { id: 'plants', key: 'onb.wish_plants', Icon: IconPlant },
  { id: 'games', key: 'onb.wish_games', Icon: IconDice },
  { id: 'travel', key: 'onb.wish_travel', Icon: IconSuitcase },
]

export interface WishesStepProps {
  picked: readonly GiftInterest[]
  disabled: boolean
  status: StepStatus | null
  onToggle: (id: GiftInterest, bubble: HTMLButtonElement) => void
  onNext: () => void
}

/**
 * Step 2: "Was wünschst du dir?" — Pompon holds the gift box, a tapped bubble flies into it. The bubbles are the
 * first interests of "Ideen" → "Für mich", kept ON THIS DEVICE only (features/gifts/startInterests.ts): this step
 * never writes to the server. "Später" until something is picked, then "Weiter".
 */
export function WishesStep({ picked, disabled, status, onToggle, onNext }: WishesStepProps) {
  const { t } = useTranslation('onboarding')
  return (
    <>
      <StepHeading title={t('onb.wish_title')} sub={t('onb.wish_sub')} />
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {WISH_CHOICES.map(({ id, key, Icon }) => (
          <WishBubble key={id} icon={<Icon size={22} />} label={t(key)} picked={picked.includes(id)} disabled={disabled} onPress={(bubble) => onToggle(id, bubble)} />
        ))}
      </div>
      <p className="mx-auto mt-5 max-w-[34ch] text-center t-footnote text-text-2">{t('onb.wish_note')}</p>
      <StepActions>
        <p aria-live="polite" className="wl-line text-center t-subhead text-text-2">
          {picked.length > 0 ? t('onb.wish_count', { count: picked.length }) : ''}
        </p>
        <StatusMessage status={status} />
        <Button size="lg" fullWidth variant={picked.length > 0 ? 'primary' : 'secondary'} disabled={disabled} onClick={onNext}>
          {picked.length > 0 ? t('onb.next') : t('onb.later')}
        </Button>
      </StepActions>
    </>
  )
}

/** The occasion cards: three lead to the new-occasion form, the envelope to the invite. */
export const OCCASION_CHOICES: ReadonlyArray<{ id: Costume; key: string; Icon: ComponentType<IconProps> }> = [
  { id: 'birthday', key: 'onb.occ_birthday', Icon: IconCake },
  { id: 'christmas', key: 'onb.occ_christmas', Icon: IconTree },
  { id: 'justbecause', key: 'onb.occ_justbecause', Icon: IconHeart },
  { id: 'invite', key: 'onb.occ_invite', Icon: IconEnvelope },
]

export interface StartStepProps {
  /** an invite link was opened in this tab before signing in */
  pendingInvite: boolean
  selected: Costume | null
  /** the state of "Los geht's!" for the selected card */
  action: ActionState
  status: StepStatus | null
  onSelect: (card: Costume) => void
  onGo: () => void
}

/**
 * Step 3: "Was feierst du als Nächstes?" — one real action. Picking a card dresses Pompon; "Los geht's!" then opens
 * the new-occasion form (Geburtstag, Weihnachten, Einfach so) or the invite (the waiting one, or how links work).
 */
export function StartStep({ pendingInvite, selected, action, status, onSelect, onGo }: StartStepProps) {
  const { t } = useTranslation('onboarding')
  return (
    <>
      <StepHeading title={t('onb.occ_title')} sub={t('onb.occ_sub')} />
      <div className="mt-6 grid grid-cols-2 gap-3">
        {OCCASION_CHOICES.map(({ id, key, Icon }) => (
          <OccasionCard
            key={id}
            icon={<Icon size={24} />}
            label={t(key)}
            note={id === 'invite' && pendingInvite ? t('onb.occ_invite_pending') : undefined}
            selected={selected === id}
            disabled={action.loading}
            onPress={() => onSelect(id)}
          />
        ))}
      </div>
      <StepActions>
        <StatusMessage status={status} />
        <Button size="lg" fullWidth disabled={selected === null || action.disabled} loading={action.loading} loadingLabel={t('onb.finishing')} onClick={onGo}>
          {t('onb.go')}
        </Button>
      </StepActions>
    </>
  )
}

export interface ConfirmStepProps {
  action: ActionState
  status: StepStatus | null
  onConfirm: () => void
}

/** Step 3, "Ich habe eine Einladung" without a waiting invite: no input field — the link itself opens the invite. */
export function InviteStep({ action, status, onConfirm }: ConfirmStepProps) {
  const { t } = useTranslation('onboarding')
  return (
    <>
      <SpeechBubble>{t('onb.invite_title')}</SpeechBubble>
      <StepText>{t('onb.invite_text')}</StepText>
      <StepActions>
        <StatusMessage status={status} />
        <Button size="lg" fullWidth disabled={action.disabled} loading={action.loading} loadingLabel={t('onb.finishing')} onClick={onConfirm}>
          {t('common.ok')}
        </Button>
      </StepActions>
    </>
  )
}

const HOME_SCREEN_STEPS: ReadonlyArray<{ key: string; Icon: typeof IconShare }> = [
  { key: 'onb.homescreen_step_share', Icon: IconShare },
  { key: 'onb.homescreen_step_add', Icon: IconPlus },
  { key: 'onb.homescreen_step_confirm', Icon: IconCheck },
]

/** The last step, only in iOS Safari outside the Home Screen app: how to add it, honest about signing in once more. */
export function HomeScreenStep({ action, status, onConfirm }: ConfirmStepProps) {
  const { t } = useTranslation('onboarding')
  return (
    <>
      <SpeechBubble>{t('onb.homescreen_title')}</SpeechBubble>
      <StepText>{t('onb.homescreen_text')}</StepText>
      <ol className="mt-6 rounded-lg bg-surface elev-1">
        {HOME_SCREEN_STEPS.map(({ key, Icon }) => (
          <li key={key} className={listItemClass}>
            <div className={listRowClass()}>
              <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-sm bg-accent-50 text-accent-text">
                <Icon size={20} />
              </span>
              <span className="min-w-0 flex-1 t-callout">{t(key)}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 px-2 text-center t-footnote text-text-2">{t('onb.homescreen_note')}</p>
      <StepActions>
        <StatusMessage status={status} />
        <Button size="lg" fullWidth disabled={action.disabled} loading={action.loading} loadingLabel={t('onb.finishing')} onClick={onConfirm}>
          {t('onb.finish')}
        </Button>
      </StepActions>
    </>
  )
}
