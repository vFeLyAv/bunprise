import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { WISH_DETAIL_LIMITS } from '../../lib/api/wishes'
import { IconButton, IconX } from '../../ui'
import { IconPencil } from './icons'
import './wishes.css'

// "Details" of the wish form: the product text, the colour and the brand — usually read from the link (the
// preview), always editable and removable here (a wrong text from the shop is one tap away from gone). The limits
// are the database's (WISH_DETAIL_LIMITS). Shown when the link brought details or the wish has some; otherwise the
// form offers "Details hinzufügen" (WishForm).

export interface DetailValues {
  description: string
  brand: string
  color: string
}

export type DetailKey = keyof DetailValues

export function WishDetailFields({ values, onChange }: { values: DetailValues; onChange: (key: DetailKey, text: string) => void }) {
  const { t } = useTranslation('wishes')
  const baseId = useId()
  const descId = `${baseId}-description`
  return (
    <div className="flex flex-col" data-wish-detail-fields="">
      <div className="flex items-center justify-between gap-2 px-1">
        <label htmlFor={descId} className="t-caption-1 font-semibold uppercase tracking-[0.06em] text-text-2">
          {t('wish.description_label')}
        </label>
        {values.description !== '' ? (
          <IconButton label={t('wish.detail_clear', { field: t('wish.description_label') })} variant="plain" hapticKind="select" onClick={() => onChange('description', '')} className="wish-clear text-text-2">
            <IconX size={18} />
          </IconButton>
        ) : null}
      </div>
      <div className="wish-inline -mx-1 mt-1 px-1">
        <textarea
          id={descId}
          rows={2}
          value={values.description}
          maxLength={WISH_DETAIL_LIMITS.description}
          placeholder={t('wish.description_placeholder')}
          className="wish-title-input block max-h-48 min-h-12 w-full resize-none bg-transparent px-1 py-1.5 t-body text-text outline-none placeholder:text-text-3"
          onChange={(event) => onChange('description', event.target.value)}
        />
      </div>
      <DetailLine id={`${baseId}-color`} label={t('wish.color_label')} placeholder={t('wish.color_placeholder')} value={values.color} max={WISH_DETAIL_LIMITS.color} onChange={(text) => onChange('color', text)} />
      <DetailLine id={`${baseId}-brand`} label={t('wish.brand_label')} placeholder={t('wish.brand_placeholder')} value={values.brand} max={WISH_DETAIL_LIMITS.brand} onChange={(text) => onChange('brand', text)} />
    </div>
  )
}

/** A receipt line under a hairline, like the card's price: "Farbe ……… Salbeigrün ✕". */
function DetailLine({ id, label, placeholder, value, max, onChange }: { id: string; label: string; placeholder: string; value: string; max: number; onChange: (text: string) => void }) {
  const { t } = useTranslation('wishes')
  return (
    <div className="mt-2 border-t border-separator pt-1.5">
      <div className="wish-inline -mx-2 flex h-12 cursor-text items-center gap-2 px-2" onClick={() => document.getElementById(id)?.focus()}>
        <label htmlFor={id} className="shrink-0 cursor-text t-callout text-text-2">
          {label}
        </label>
        <input
          id={id}
          type="text"
          autoComplete="off"
          enterKeyHint="next"
          value={value}
          maxLength={max}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent text-right t-body text-text outline-none placeholder:text-text-3"
          onChange={(event) => onChange(event.target.value)}
        />
        {value !== '' ? (
          <IconButton
            label={t('wish.detail_clear', { field: label })}
            variant="plain"
            hapticKind="select"
            onClick={(event) => {
              event.stopPropagation()
              onChange('')
            }}
            className="-mr-2 shrink-0 text-text-2"
          >
            <IconX size={18} />
          </IconButton>
        ) : (
          <IconPencil size={16} className="shrink-0 text-text-3" />
        )}
      </div>
    </div>
  )
}
