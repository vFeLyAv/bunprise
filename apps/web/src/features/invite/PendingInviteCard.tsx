import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, IconButton, IconCalendar, IconX, buttonClass, cn } from '../../ui'
import { PressLink } from '../shell/MotionLink'
import { consumePendingInvite, getPendingInvite } from './pending'

// "Eine Einladung wartet" — the way back to an invite the person put off with "Nicht jetzt" on the join screen
// (JoinGate): the link stays in this tab (pending.ts) until they join or dismiss it here. A lazy chunk of its own:
// Start mounts it only while getPendingInvite() has a token (performance budget of /soon), e.g.
//   const PendingInviteCard = lazy(() => import('../invite/PendingInviteCard'))
//   {getPendingInvite() ? <Suspense fallback={null}><PendingInviteCard /></Suspense> : null}
// It names nothing about the occasion (the link alone tells nothing before joining, like the landing /i).
// "Ansehen" opens /i, which shows the join question again for the pending link; the cross forgets the link.

export default function PendingInviteCard() {
  const { t } = useTranslation('invite')
  const [waiting, setWaiting] = useState(() => getPendingInvite() !== null)
  if (!waiting) return null
  return (
    <Card className="flex items-start gap-3" aria-labelledby="pending-invite-title">
      <span aria-hidden="true" className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-text">
        <IconCalendar size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="pending-invite-title" className="t-headline text-text">{t('invite.waiting_title')}</h2>
        <p className="mt-0.5 t-subhead text-text-2">{t('invite.waiting_text')}</p>
        <PressLink to="/i" className={cn(buttonClass({ variant: 'secondary', size: 'sm' }), 'mt-3')}>
          {t('invite.waiting_open')}
        </PressLink>
      </div>
      <IconButton
        label={t('invite.waiting_dismiss')}
        variant="plain"
        className="-mr-2 -mt-2 shrink-0 text-text-2"
        onClick={() => {
          consumePendingInvite()
          setWaiting(false)
        }}
      >
        <IconX size={20} />
      </IconButton>
    </Card>
  )
}
