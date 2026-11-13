import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlacePoint } from '../../../lib/api/places'
import { IconButton } from '../../../ui'
import { IconChevron, IconClose, IconPin } from './icons'
import type { MiniMapState } from './MiniMap'
import { MINI_MAP_SIZE } from './miniMapTiles'
import { RowButton, RowIcon } from './parts'
import { PlaceSheet, type PickedPlace } from './PlaceSheet'

// "Ort" row (K4): "Ort hinzufügen" opens the place sheet; a chosen place shows here with a clear (×)
// button. The value is the free text that goes into occasions.place_text (≤ 200, validated by form.ts).
// A suggestion picked from the sheet with a point (the Worker's map switch is on) shows a small map instead of the
// pin tile (Felix 26.10: "so you see whether the right place was found"), with "Karte © OpenStreetMap" under the
// place. Since 20261027190000 the point is saved with the occasion (the occasion screen draws its mini map from it):
// the row reports it through onPoint — a pick with a point → that point; typed or recent text that differs, or
// "Ort entfernen" → none. An opened occasion's stored point shows here too (street level: its kind is not stored).
// The switch off, offline or any tile error → the plain pin tile, as before.

const MiniMap = lazy(() => import('./MiniMap'))

export interface PlaceFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  /** where `value` is (a picked suggestion's point or the stored one); null = none */
  point?: PlacePoint | null
  /** a pick with a point, or none after typed / recent / removed text (the form saves it with the occasion) */
  onPoint?: (point: PlacePoint | null) => void
  userId: string
  lang: 'de' | 'en'
  invalid?: boolean
  /** hint / error line under the group */
  describedBy?: string
}

function MiniMapSkeleton() {
  return <span aria-hidden="true" className="skeleton" style={{ display: 'block', flex: 'none', width: MINI_MAP_SIZE, height: MINI_MAP_SIZE, borderRadius: 14 }} />
}

export function PlaceField({ id, value, onChange, point = null, onPoint, userId, lang, invalid, describedBy }: PlaceFieldProps) {
  const { t } = useTranslation(['occasionForm', 'occasion'])
  const [open, setOpen] = useState(false)
  // the last picked suggestion with a point, and how its map is doing
  const [picked, setPicked] = useState<(PickedPlace & { text: string }) | null>(null)
  const [mapState, setMapState] = useState<MiniMapState>('loading')
  const place = value.trim()
  // only while the field still holds exactly that place; else the stored point (its kind unknown: street level)
  const shown = picked && picked.text === place ? picked : point && place ? { point, kind: 'other' as const } : null
  const map = shown && mapState !== 'failed' ? shown : null
  return (
    <>
      <div className="of-row-split">
        <RowButton
          id={id}
          className={place ? undefined : 'of-row-cta'}
          aria-haspopup="dialog"
          aria-describedby={describedBy}
          invalid={invalid}
          tile={
            map ? (
              <Suspense fallback={<MiniMapSkeleton />}>
                <MiniMap key={`${map.point.lat},${map.point.lon},${map.kind}`} point={map.point} kind={map.kind} onState={setMapState} />
              </Suspense>
            ) : (
              <RowIcon kind="place">
                <IconPin size={18} />
              </RowIcon>
            )
          }
          caption={place ? t('occasion.place_label') : undefined}
          label={place || t('occasionForm.place_add')}
          // the licence credit right next to the map (the sheet links the full one); screen readers get the place
          sub={map ? <span aria-hidden="true" data-map-credit="">{t('occasionForm.map_credit')}</span> : undefined}
          trailing={place ? undefined : <IconChevron size={18} className="of-row-chevron" />}
          onClick={() => setOpen(true)}
        />
        {place ? (
          <IconButton
            label={t('occasionForm.place_clear')}
            className="of-row-clear"
            hapticKind="select"
            onClick={() => {
              setPicked(null)
              onPoint?.(null)
              onChange('')
            }}
          >
            <IconClose size={18} />
          </IconButton>
        ) : null}
      </div>
      <PlaceSheet
        open={open}
        onClose={() => setOpen(false)}
        initialQuery={place}
        userId={userId}
        lang={lang}
        onPick={(text, pickedPlace) => {
          onChange(text)
          // a pick without a point keeps the stored one only for the very same text (the same place)
          if (pickedPlace) onPoint?.(pickedPlace.point)
          else if (text.trim() !== place) onPoint?.(null)
          setPicked(pickedPlace ? { ...pickedPlace, text: text.trim() } : null)
          setMapState('loading')
          setOpen(false)
        }}
      />
    </>
  )
}
