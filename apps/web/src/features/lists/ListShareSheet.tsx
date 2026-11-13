import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import { buildListUrl } from '../../lib/api/lists'
import type { ListVisibility } from '../../lib/api/lists.types'
import { feedback } from '../../lib/haptics'
import { canNativeShare, copyText, share, type ShareResult } from '../../lib/share'
import { toast } from '../../lib/toast'
import { Button, IconCopy, IconLink, IconShare, TextField } from '../../ui'
import { Sheet } from '../../ui/Sheet'
import { GlyphLock } from './OwnerListCard'

// "Teilen" of one of my lists (Felix 22.10) — OWNER module, the visibility rules of follows-design §2.7/§2.9:
//   - "Meine Follower": the list's own link (buildListUrl) — the system share sheet where there is one, else a copy;
//     it opens only for the people who may read the list (everybody else gets the one "nicht verfügbar" page), so
//     the sheet says so and offers the follow link (createFollowLink, features/people) for people who do not follow yet;
//   - "Nur ich": nothing to send yet — the sheet says so and leads to "Wer sieht die Liste?" (the visibility sheet with
//     its own confirm rules); nothing is widened from here directly.
// Every text depends on the owner's own setting only.

export interface ListShareSheetProps {
  open: boolean
  onClose: () => void
  list: { id: string; title: string; visibility: ListVisibility }
  userId: string
  /** "Mit Followern teilen" of a "Nur ich" list: the visibility sheet */
  onVisibility: () => void
  /** "Folgen-Link teilen": the follow-link sheet (people who do not follow yet) */
  onFollowLink: () => void
}

export function ListShareSheet({ open, onClose, list, userId, onVisibility, onFollowLink }: ListShareSheetProps) {
  const { t } = useTranslation('lists')
  const working = useRef(false)
  const url = buildListUrl(list.id)
  const native = canNativeShare()
  const shared = list.visibility === 'followers'

  async function handOut(kind: 'share' | 'copy') {
    if (working.current) return
    const epoch = captureEpoch()
    if (!epoch.isCurrent() || (epoch.userId !== undefined && epoch.userId !== userId)) return
    working.current = true
    try {
      const result: ShareResult = kind === 'share'
        ? await share({ title: list.title, text: t('lists.share.text', { title: list.title }), url })
        : (await copyText(url)) ? 'copied' : 'failed'
      if (!epoch.isCurrent()) return
      if (result === 'shared') {
        feedback('success')
        onClose()
      } else if (result === 'copied') {
        feedback('success')
        toast.success(t('lists.share.copied'))
      } else if (result === 'failed') {
        feedback('error')
        toast.error(t('lists.share.copy_failed'))
      }
    } finally {
      working.current = false
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('lists.share.title', { title: list.title })}
      closeLabel={t('common.close')}
      footer={
        shared ? (
          <div className="flex flex-col gap-2">
            {native ? (
              <Button size="lg" fullWidth icon={<IconShare />} onClick={() => void handOut('share')}>
                {t('lists.share.share')}
              </Button>
            ) : null}
            <Button size="lg" fullWidth variant={native ? 'secondary' : 'primary'} icon={<IconCopy />} onClick={() => void handOut('copy')}>
              {t('lists.share.copy')}
            </Button>
            <Button size="md" fullWidth variant="ghost" icon={<IconLink />} onClick={onFollowLink}>
              {t('lists.share.follow_link')}
            </Button>
          </div>
        ) : (
          <Button size="lg" fullWidth icon={<IconShare />} onClick={onVisibility}>
            {t('lists.share.make_visible')}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 pb-2">
        {shared ? (
          <>
            <p className="t-body text-text">{t('lists.share.hint')}</p>
            <TextField label={t('lists.share.field')} value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
            <p className="t-footnote text-text-2">{t('lists.share.follow_hint')}</p>
          </>
        ) : (
          <div className="ls-private glass-panel" role="note">
            <span aria-hidden="true" className="ls-private-icon">
              <GlyphLock />
            </span>
            <p className="min-w-0 flex-1 t-subhead text-text">{t('lists.share.private')}</p>
          </div>
        )}
      </div>
    </Sheet>
  )
}
