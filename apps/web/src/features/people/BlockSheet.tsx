import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Switch } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { useOnline } from '../auth/shared'
import type { PeopleActions } from './actions'
import './people.css'

// "Blockieren" (follows-design §2.10): the bullets say exactly what the database does — the same text whatever
// the person may have planned (S9) — and the switch "Auch alle meine Folgen-Links deaktivieren" is ON by default
// (otherwise a second account of the same person could come back through an old link, P17): then
// revoke_follow_links() goes out right after block_user with the same account. "Ablehnen und blockieren" comes
// here too (`declineFirst`: the 30-day silence stays even after an unblock, INV-6).

export interface BlockTarget {
  profileId: string
  name: string
  /** "Ablehnen und blockieren" from a request */
  declineFirst?: boolean
}

export interface BlockSheetProps {
  target: BlockTarget | null
  open: boolean
  onClose: () => void
  actions: PeopleActions
  /** the block went through (the screen leaves the card, refreshes the people screen …) */
  onBlocked?: (target: BlockTarget) => void
}

export function BlockSheet({ target, open, onClose, actions, onBlocked }: BlockSheetProps) {
  const { t } = useTranslation('people')
  const online = useOnline()
  const [revokeLinks, setRevokeLinks] = useState(true)
  const [busy, setBusy] = useState(false)
  // every opening starts with the switch ON (derived state, set during render)
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  const key = open && target ? `${target.profileId}:${target.declineFirst ? 1 : 0}` : null
  if (key !== openedFor) {
    setOpenedFor(key)
    if (key !== null) setRevokeLinks(true)
  }
  if (!target) return null
  const { name } = target

  async function block() {
    if (!target || busy || !online) return
    setBusy(true)
    const done = await actions.block(target.profileId, target.name, { revokeLinks, declineFirst: target.declineFirst === true })
    setBusy(false)
    if (done !== null) {
      onClose()
      onBlocked?.(target)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!busy) onClose()
      }}
      // short on purpose: the sheet title is clamped to two lines and the verb must stay visible at 320 px
      title={t('people.block.title', { name })}
      closeLabel={t('common.close')}
      // the default-ON links switch sits with the buttons (it changes what the button does), so it is never
      // hidden below the fold behind them on a short screen
      footer={
        <div className="flex flex-col gap-2">
          <div className="glass-panel pp-switch-card">
            <Switch checked={revokeLinks} onChange={setRevokeLinks} disabled={busy} label={t('people.block.links_switch')} description={t('people.block.links_hint')} />
          </div>
          {!online ? <p role="status" className="pp-valid">{t('errors.offline_action')}</p> : null}
          <Button variant="destructive" size="lg" fullWidth hapticKind="warning" disabled={!online} loading={busy}
            loadingLabel={t('people.block.blocking')} onClick={() => void block()}>
            {target.declineFirst ? t('people.block.confirm_decline') : t('people.block.confirm')}
          </Button>
          <Button variant="secondary" size="lg" fullWidth disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      }
    >
      <div className="pp-sheet">
        <ul className="pp-points">
          {target.declineFirst ? <li>{t('people.block.point_decline')}</li> : null}
          <li>{t('people.block.point_see')}</li>
          <li>{t('people.block.point_occasions', { name })}</li>
          <li>{t('people.block.point_others')}</li>
          <li>{t('people.block.point_message', { name })}</li>
          <li>{t('people.block.point_plans', { name })}</li>
        </ul>
      </div>
    </Sheet>
  )
}
