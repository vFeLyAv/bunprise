import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { buildMailto } from '../../lib/api/account'
import type { OccasionScreen } from '../../lib/api/types'
import { SUPPORT_EMAIL } from '../../lib/app'
import { IconButton, IconMore, List, ListRow, ListRowContent, listItemClass, listRowClass } from '../../ui'
import { Confirm } from '../../ui/Confirm'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import { useDeleteOccasion, useLeaveOccasion } from './actions'

// The "…" menu of the occasion screen (S7): host — edit, delete; guest — leave; everyone —
// report (mailto, product §2.1). While SUPPORT_EMAIL is still a placeholder
// the row says that the contact follows, instead of opening a broken mail link (as in settings).

export function OccasionMenu({ screen, userId, disabled }: { screen: OccasionScreen; userId: string; disabled?: boolean }) {
  const { t } = useTranslation('occasion')
  const online = useOnline()
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null)
  const isHost = screen.viewer.role === 'host'
  const occasionId = screen.occasion.id
  const reportHref = SUPPORT_EMAIL.includes('@')
    ? buildMailto(SUPPORT_EMAIL, t('occasion.report_mail_subject', { id: occasionId }), t('occasion.report_mail_body'))
    : null

  function ask(action: 'delete' | 'leave') {
    setOpen(false)
    setConfirm(action)
  }

  return (
    <>
      <IconButton label={t('occasion.menu')} disabled={disabled} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <IconMore />
      </IconButton>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('occasion.menu_title')} closeLabel={t('common.close')}>
        {/* plain text rows, destructive last and in red (iOS action list) */}
        <List className="pb-2">
          {isHost ? (
            <li className={listItemClass}>
              <Link
                to="/occasions/$occasionId/edit"
                params={{ occasionId }}
                className={listRowClass({ pressable: true })}
                onClick={() => setOpen(false)}
              >
                <ListRowContent title={t('occasion.edit')} />
              </Link>
            </li>
          ) : null}
          {reportHref ? (
            <li className={listItemClass}>
              <a href={reportHref} className={listRowClass({ pressable: true })} onClick={() => setOpen(false)}>
                <ListRowContent title={t('occasion.report')} />
              </a>
            </li>
          ) : (
            <ListRow title={t('occasion.report')} subtitle={t('occasion.report_pending')} />
          )}
          {isHost ? (
            <ListRow
              title={<span className="text-danger">{t('occasion.delete')}</span>}
              disabled={!online}
              onPress={() => ask('delete')}
            />
          ) : (
            <ListRow
              title={<span className="text-danger">{t('occasion.leave')}</span>}
              disabled={!online}
              onPress={() => ask('leave')}
            />
          )}
        </List>
      </Sheet>
      {isHost ? (
        <DeleteOccasionConfirm screen={screen} userId={userId} open={confirm === 'delete'} onClose={() => setConfirm(null)} />
      ) : (
        <LeaveOccasionConfirm screen={screen} userId={userId} open={confirm === 'leave'} onClose={() => setConfirm(null)} />
      )}
    </>
  )
}

interface ConfirmSheetProps {
  screen: OccasionScreen
  /** the account of this screen: the request is sent for it only */
  userId: string
  open: boolean
  onClose: () => void
}

/** HOST — the same question and buttons for every occasion (nothing depends on what guests did). */
export function DeleteOccasionConfirm({ screen, userId, open, onClose, onLeaving }: ConfirmSheetProps & { onLeaving?: () => void }) {
  const { t } = useTranslation('occasion')
  const removal = useDeleteOccasion(screen.occasion.id, userId, onLeaving)
  return (
    <Confirm
      open={open}
      destructive
      title={t('occasion.delete_title')}
      message={t('occasion.delete_message', { title: screen.occasion.title })}
      confirmLabel={t('common.delete')}
      cancelLabel={t('common.cancel')}
      loading={removal.busy}
      onConfirm={() => void removal.run()}
      onCancel={() => {
        if (!removal.busy) onClose()
      }}
    />
  )
}

/** GUEST — leaving ends their RSVP and their reservations in this occasion (server side). */
function LeaveOccasionConfirm({ screen, userId, open, onClose }: ConfirmSheetProps) {
  const { t } = useTranslation('occasion')
  const leaving = useLeaveOccasion(screen.occasion.id, userId)
  return (
    <Confirm
      open={open}
      destructive
      title={t('occasion.leave_title')}
      message={t('occasion.leave_message', { title: screen.occasion.title })}
      confirmLabel={t('occasion.leave')}
      cancelLabel={t('common.cancel')}
      loading={leaving.busy}
      onConfirm={() => void leaving.run()}
      onCancel={() => {
        if (!leaving.busy) onClose()
      }}
    />
  )
}
