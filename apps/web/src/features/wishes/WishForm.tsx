import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import { captureEpoch } from '../../lib/accountBoundary'
import type { WishInput, WishPhotoMeta, WishPriority } from '../../lib/api/types'
import { normalizeWishUrl } from '../../lib/api/wishes'
import { LIMITS } from '../../lib/app'
import { toAppError } from '../../lib/errors'
import { domainOf } from '../../lib/format'
import { toast } from '../../lib/toast'
import { Button, IconLink, IconPlus, IconTrash, cn, fade, haptic, useReducedMotionPref, useSpring } from '../../ui'
import { useOnline } from '../auth/shared'
import { BunnyPeek, type BunnyMood } from './BunnyPeek'
import { IconPaste, IconPencil, IconSparkle } from './icons'
import { LinkPill } from './LinkPill'
import { extractLink, hostOf, shouldAutoRead } from './linkInput'
import { WISH_PRICE_MAX_CENTS } from './priceText'
import { useLinkPreview, type LinkPreviewState, type SettledLinkPreview } from './useLinkPreview'
import { WishCard, type WishCardState } from './WishCard'
import { WishDetailFields, type DetailKey } from './WishDetailFields'
import { useLinkPhoto } from './useLinkPhoto'
import { preparePhoto, PhotoPrepareError, type PhotoProblem, type PreparedPhoto } from '../occasions/photo/pipeline'
import { CardPhotoView, type CardPhoto } from './WishPhoto'
import { KEEP_PHOTO, type PhotoIntent } from './wishPhotos'
import { WishOMeter } from './WishOMeter'
import { QuantityStepper } from './QuantityStepper'
import { wishQuantityEnabled } from '../../lib/api/wishExtras'
import './wishes.css'

// S8 add / edit a wish — link first (K6, wave 1). The screen opens with one big link capsule ("Link
// einfügen" + "Einfügen") and "Ohne Link hinzufügen". A pasted or typed shop link is read by our own Worker
// (lib/api/linkPreview.ts: title, price in EUR, shop name — nothing is loaded from the shop) while Pompon
// sniffs at it; the wish card springs in with the shop's letter tile and the title + price, both editable
// right in the card. Without an answer (offline, shop down, no title) the same card waits with empty fields
// and one calm line. Then the note and "Wie sehr?" (the wish-o-meter, priority 1 · 2 · 3, default 2).
// - The answer fills only what the person has not typed themselves (an explicit "Neu einlesen" fills all);
//   the cleaned link of the answer (no tracking parameters) is the one that is saved.
// - Limits = database (title 1…120 code points, link http(s) ≤ 2048, note ≤ 500, price 0 … 1 000 000 €);
//   the payload keeps its shape { title, price_cents, currency: 'EUR', url, note, priority }.
// - Saving waits for the server (the button shows its loading state); on an error the input stays.
// - Owner side: no reservation code or words here (secrecy.test.ts).
// - Wish details (2026-10-22): the answer also brings the product photo's address, the product text, colour,
//   brand, GTIN and the shop's name. The PHOTO is fetched right after the answer through our Worker only
//   (useLinkPhoto: fetchLinkImage → preparePhoto; the card shimmers meanwhile and keeps the shop's letter tile on
//   any failure) and can be removed ("Foto entfernen"); text, colour and brand fill the "Details" (editable,
//   removable); GTIN + shop name ride along unseen. onSubmit gets the photo decision next to the input: the page
//   saves the wish first and the photo after it, so a photo never loses a wish.
// - Own photo (Felix 25.10): where the link brings no picture, or there is no link, the card offers "Foto
//   hinzufügen" (gallery or camera); next to a shown picture "Ändern" replaces it. The file is prepared on the
//   device exactly like a link picture (preparePhoto: ≤ 1600 px, WebP/JPEG ≤ 400 KB, no EXIF/GPS) and saved the same
//   way (set_wish_photo). The person's own choice wins: a link picture that arrives later never replaces it.

export interface WishFormValues {
  title: string
  priceCents: number | null
  url: string
  note: string
  priority: WishPriority
  /** "Anzahl" (20261030120000): 1..10, default 1 — shown and sent only behind VITE_WISH_QUANTITY */
  quantity: number
  /** the details (from the link, editable): product text, brand, colour */
  description: string
  brand: string
  color: string
  /** from the link, not shown in the form: the product's GTIN (compare links) and the shop's name */
  gtin: string | null
  shopName: string | null
}

export const EMPTY_WISH_FORM: WishFormValues = {
  title: '',
  priceCents: null,
  url: '',
  note: '',
  priority: 2,
  quantity: 1,
  description: '',
  brand: '',
  color: '',
  gtin: null,
  shopName: null,
}

/** Would leaving lose input? Spaces at the ends do not count ("Änderungen verwerfen?" asks only then). */
export function sameWishValues(a: WishFormValues, b: WishFormValues): boolean {
  return (
    a.title.trim() === b.title.trim() &&
    a.priceCents === b.priceCents &&
    a.url.trim() === b.url.trim() &&
    a.note.trim() === b.note.trim() &&
    a.priority === b.priority &&
    a.quantity === b.quantity &&
    a.description.trim() === b.description.trim() &&
    a.brand.trim() === b.brand.trim() &&
    a.color.trim() === b.color.trim() &&
    a.gtin === b.gtin &&
    a.shopName === b.shopName
  )
}

type FieldName = 'title' | 'price' | 'url' | 'note'
/** i18n keys (wishes namespace) per field */
export type WishFormErrors = Partial<Record<FieldName, string>>

export type WishFormResult = { ok: true; input: WishInput } | { ok: false; errors: WishFormErrors }

const codePoints = (text: string) => [...text].length

/** Pure validation + normalisation (the same rules as the database checks). */
export function validateWishForm(values: WishFormValues, options: { priceInvalid?: boolean } = {}): WishFormResult {
  const errors: WishFormErrors = {}
  const title = values.title.trim()
  if (title === '') errors.title = 'wish.title_required'
  else if (codePoints(title) > LIMITS.wishTitle) errors.title = 'wish.title_too_long'

  const cents = values.priceCents
  if (options.priceInvalid || (cents !== null && (!Number.isInteger(cents) || cents < 0 || cents > WISH_PRICE_MAX_CENTS))) {
    errors.price = 'wish.price_invalid'
  }

  const url = normalizeWishUrl(values.url)
  if (url === 'invalid') errors.url = 'wish.url_invalid'

  const note = values.note.trim()
  if (codePoints(note) > LIMITS.wishNote) errors.note = 'wish.note_too_long'

  if (url === 'invalid' || Object.keys(errors).length > 0) return { ok: false, errors }
  // the details only when there is one (an empty one is simply absent: the edit page turns absent into "clear");
  // GTIN and shop name belong to the link and go with it
  const details: Pick<WishInput, 'description' | 'brand' | 'color' | 'gtin' | 'shop_name'> = {}
  const description = values.description.trim()
  if (description !== '') details.description = description
  const brand = values.brand.trim()
  if (brand !== '') details.brand = brand
  const color = values.color.trim()
  if (color !== '') details.color = color
  if (url !== null && values.gtin) details.gtin = values.gtin
  const shop = values.shopName?.trim() ?? ''
  if (url !== null && shop !== '') details.shop_name = shop
  return {
    ok: true,
    input: {
      title,
      price_cents: cents,
      currency: 'EUR',
      url,
      note: note === '' ? null : note,
      priority: values.priority,
      // "Anzahl": only behind its flag, then always (an edit back to 1 must reach the server)
      ...(wishQuantityEnabled() ? { quantity: values.quantity } : {}),
      ...details,
    },
  }
}

/** Domain preview of what the person typed ("amazon.de/dp/1" → "amazon.de"), null while invalid/empty. */
export function previewDomain(raw: string): string | null {
  const url = normalizeWishUrl(raw)
  return url === null || url === 'invalid' ? null : domainOf(url)
}

/** The preview that belongs to the link now in the field (asked for it, or its cleaned answer is it). */
function previewFor(state: LinkPreviewState, link: string | null | 'invalid'): Exclude<LinkPreviewState, { status: 'idle' }> | null {
  if (state.status === 'idle' || link === null || link === 'invalid') return null
  if (state.url === link) return state
  return state.status === 'ready' && state.preview.url === link ? state : null
}

/** The details a link answer can fill (only where the person has not typed, unless "Neu einlesen"). */
const DETAIL_KEYS: readonly DetailKey[] = ['description', 'brand', 'color']

/** How long typing has to pause before a typed link is read. */
const TYPE_PAUSE_MS = 700

/** Why a picked file could not become the wish's photo (wishes namespace). */
const PHOTO_PROBLEM_KEY: Record<PhotoProblem, string> = {
  not_image: 'wish.photo_not_image',
  too_large: 'wish.photo_too_large',
  failed: 'wish.photo_failed',
}

export interface WishFormProps {
  initial: WishFormValues
  submitLabel: string
  /**
   * Saves (throws an AppError when the server says no — the form keeps the input). `extras.photo` = what to do
   * with the photo AFTER the wish is saved (wishPhotos.ts saveWishPhoto).
   */
  onSubmit: (input: WishInput, extras: { photo: PhotoIntent }) => Promise<void>
  /** Edit: the wish's stored photo (meta undefined = not known, e.g. a deep link: asked once). */
  savedPhoto?: { wishId: string; meta: WishPhotoMeta | null | undefined }
  /** Edit mode: "Wunsch löschen" at the end of the form. */
  onDelete?: () => void
  /** 'new': link first (the card opens with a link or "Ohne Link hinzufügen"); 'edit': all open at once */
  variant?: 'new' | 'edit'
  /** Whether the values differ from `initial` (the page asks "Änderungen verwerfen?" before leaving). */
  onDirtyChange?: (dirty: boolean) => void
}

export function WishForm({ initial, submitLabel, onSubmit, onDelete, variant = 'new', onDirtyChange, savedPhoto }: WishFormProps) {
  const { t } = useTranslation('wishes')
  const online = useOnline()
  const reduced = useReducedMotionPref()
  const smooth = useSpring('smooth')
  const baseId = useId()
  const ids = {
    link: `${baseId}-link`,
    title: `${baseId}-card-title`,
    price: `${baseId}-card-price`,
    note: `${baseId}-note`,
    priority: `${baseId}-priority`,
    quantity: `${baseId}-quantity`,
  }
  const formRef = useRef<HTMLFormElement>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  // A ref mirrors the state so a submit right after a blur (price field) sees the committed value.
  const valuesRef = useRef(initial)
  const priceInvalidRef = useRef(false)
  const [values, setValues] = useState(initial)
  const linkPhoto = useLinkPhoto()
  /** the person took the shown photo away ("Rückgängig" until saving) */
  const [photoRemoved, setPhotoRemoved] = useState(false)
  /** the person's own photo from the device (wins over any picture of the link); the ref for late link answers */
  const [ownPhoto, setOwnPhoto] = useState<PreparedPhoto | null>(null)
  const ownPhotoRef = useRef<PreparedPhoto | null>(null)
  /** a picked file is being prepared (the card shimmers, saving waits) */
  const [picking, setPicking] = useState(false)
  const pickRun = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const dirty = !sameWishValues(values, initial) || photoRemoved || ownPhoto !== null || linkPhoto.state.status === 'ready'
  const dirtyListener = useRef(onDirtyChange)
  useEffect(() => {
    dirtyListener.current = onDirtyChange
  })
  useEffect(() => {
    dirtyListener.current?.(dirty)
  }, [dirty])
  const [errors, setErrors] = useState<WishFormErrors>({})
  const [linkTouched, setLinkTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  // new: the details open with the first link or "Ohne Link hinzufügen"; they stay open from then on
  const [revealed, setRevealed] = useState(variant === 'edit')
  const [note, setNote] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  /** the title field takes the focus as soon as it is on screen (after "Ohne Link" or a read without a title) */
  const titleFocusWanted = useRef(false)
  // fields the person typed themselves; an automatic read never overwrites them (edit: the saved ones count)
  const typed = useRef({
    title: variant === 'edit' && initial.title !== '',
    price: variant === 'edit' && initial.priceCents !== null,
    description: variant === 'edit' && initial.description !== '',
    brand: variant === 'edit' && initial.brand !== '',
    color: variant === 'edit' && initial.color !== '',
  })
  // the details panel: open when the wish has details or the link brought some, or the person asked for it
  const [detailsOpen, setDetailsOpen] = useState(initial.description !== '' || initial.brand !== '' || initial.color !== '')
  const submitting = useRef(false)
  const mounted = useRef(false)
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readIntent = useRef<{ focusAfter: boolean; force: boolean }>({ focusAfter: false, force: false })
  const { state: preview, request, reset } = useLinkPreview({ onSettled: applyAnswer })

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (typeTimer.current) clearTimeout(typeTimer.current)
      // a file still being prepared when the screen goes is simply forgotten
      pickRun.current += 1
    }
  }, [])

  function setOwn(photo: PreparedPhoto | null) {
    ownPhotoRef.current = photo
    setOwnPhoto(photo)
  }

  /** "Foto hinzufügen" / "Ändern": the device's picker (on a phone: the library or the camera). */
  function pickPhoto() {
    fileRef.current?.click()
  }

  async function onPhotoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // the same file can be picked again
    if (!file) return
    const mine = ++pickRun.current
    const epoch = captureEpoch()
    setPicking(true)
    try {
      const photo = await preparePhoto(file)
      if (pickRun.current !== mine || !epoch.isCurrent()) return
      setOwn(photo)
      setPhotoRemoved(false)
      // the link's picture is not needed any more (one still on its way is dropped)
      linkPhoto.reset()
      haptic('success')
    } catch (err) {
      if (pickRun.current !== mine || !epoch.isCurrent()) return
      haptic('error')
      toast.error(t(PHOTO_PROBLEM_KEY[err instanceof PhotoPrepareError ? err.problem : 'failed']))
    } finally {
      if (pickRun.current === mine && mounted.current) setPicking(false)
    }
  }

  /** Another link: a removed picture is gone for good (a saved photo keeps its "Rückgängig"). */
  function forgetRemovedPhoto() {
    if (savedPhoto) return
    if (photoRemoved) setOwn(null)
    setPhotoRemoved(false)
  }

  function update(patch: Partial<WishFormValues>, clear?: FieldName | readonly FieldName[]) {
    valuesRef.current = { ...valuesRef.current, ...patch }
    setValues(valuesRef.current)
    const fields = clear === undefined ? [] : typeof clear === 'string' ? [clear] : clear
    if (fields.length > 0) {
      setErrors((prev) => (fields.some((field) => prev[field]) ? { ...prev, ...Object.fromEntries(fields.map((f) => [f, undefined])) } : prev))
    }
  }

  function reveal() {
    setRevealed(true)
  }

  function cancelTyping() {
    if (typeTimer.current) clearTimeout(typeTimer.current)
    typeTimer.current = null
  }

  /** Reads `link` (normalised) through the Worker; the card shows the result. */
  function read(link: string, intent: { focusAfter?: boolean; force?: boolean } = {}) {
    cancelTyping()
    reveal()
    readIntent.current = { focusAfter: intent.focusAfter ?? true, force: intent.force ?? false }
    request(link)
  }

  const linkNow = normalizeWishUrl(values.url)
  const current = previewFor(preview, linkNow)
  const reading = current?.status === 'loading'

  /**
   * An answer for the link in the field (useLinkPreview calls this once per answer that counts): fill what
   * the person has not typed, show the cleaned link, and hand over to the title field when the shop told us
   * no title.
   */
  function applyAnswer(settled: SettledLinkPreview) {
    const { focusAfter, force } = readIntent.current
    readIntent.current = { focusAfter: false, force: false }
    if (previewFor(settled, normalizeWishUrl(valuesRef.current.url)) === null) return
    if (settled.status === 'ready') {
      const answer = settled.preview
      // "Gefunden!": a light buzz where the phone can (the card and Pompon say it visually)
      if (!answer.partial) haptic('success')
      const patch: Partial<WishFormValues> = {}
      const cleared: FieldName[] = []
      if (answer.title && (force || !typed.current.title || valuesRef.current.title.trim() === '')) {
        patch.title = answer.title
        typed.current.title = false
        cleared.push('title')
      }
      if (answer.priceCents !== null && (force || !typed.current.price || valuesRef.current.priceCents === null)) {
        patch.priceCents = answer.priceCents
        typed.current.price = false
        priceInvalidRef.current = false
        cleared.push('price')
      }
      if (answer.url !== normalizeWishUrl(valuesRef.current.url) && document.activeElement !== linkRef.current) patch.url = answer.url
      let details = false
      for (const key of DETAIL_KEYS) {
        const text = answer[key]
        if (text && (force || !typed.current[key] || valuesRef.current[key].trim() === '')) {
          patch[key] = text
          typed.current[key] = false
          details = true
        }
      }
      // GTIN and the shop's name belong to the link: a new answer brings its own
      patch.gtin = answer.gtin ?? null
      patch.shopName = answer.site.trim() || null
      if (details) setDetailsOpen(true)
      update(patch, cleared)
      // the product photo: only through our Worker, right now (the card shimmers meanwhile) — unless the person
      // has picked their own: that one stays, even after "Neu einlesen"
      const imageUrl = answer.imageUrl ?? null
      const photo = linkPhoto.state
      const same = photo.status !== 'idle' && photo.status !== 'failed' && photo.imageUrl === imageUrl
      if (ownPhotoRef.current) linkPhoto.reset()
      else if (!imageUrl) linkPhoto.reset()
      else if (force || !same) {
        setPhotoRemoved(false)
        linkPhoto.request(imageUrl)
      }
    } else {
      linkPhoto.reset()
    }
    const titleMissing = valuesRef.current.title.trim() === ''
    if (focusAfter && titleMissing && (settled.status === 'failed' || settled.preview.partial)) titleFocusWanted.current = true
  }

  // the wanted focus moves to the title field once the card shows its fields (no state: a ref + this effect)
  useEffect(() => {
    if (!titleFocusWanted.current || !revealed || reading) return
    titleFocusWanted.current = false
    titleRef.current?.focus({ preventScroll: false })
  })

  function onLinkType(text: string) {
    setNote(null)
    update({ url: text }, 'url')
    cancelTyping()
    const link = normalizeWishUrl(text)
    if (text.trim() === '' || previewFor(preview, link) === null) {
      reset()
      linkPhoto.reset()
      forgetRemovedPhoto()
    }
    if (shouldAutoRead(text) && link !== null && link !== 'invalid') {
      typeTimer.current = setTimeout(() => {
        typeTimer.current = null
        if (normalizeWishUrl(valuesRef.current.url) === link) read(link, { focusAfter: false })
      }, TYPE_PAUSE_MS)
    }
  }

  function onPasteLink(link: string) {
    setNote(null)
    if (previewFor(preview, normalizeWishUrl(link)) === null) forgetRemovedPhoto()
    update({ url: link }, 'url')
    read(link)
  }

  /** Enter or leaving the field: read a valid link that has no answer yet. */
  function onLinkCommit() {
    const text = valuesRef.current.url
    if (text.trim() === '') return
    setLinkTouched(true)
    const link = normalizeWishUrl(text)
    if (link === null || link === 'invalid') return
    if (previewFor(preview, link) !== null) return
    read(link)
  }

  function onLinkClear() {
    setNote(null)
    cancelTyping()
    reset()
    linkPhoto.reset()
    forgetRemovedPhoto()
    setLinkTouched(false)
    update({ url: '' }, 'url')
    linkRef.current?.focus()
  }

  async function onPasteButton() {
    setNote(null)
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard || typeof clipboard.readText !== 'function') {
      linkRef.current?.focus()
      setNote(t('wish.link_paste_manual'))
      return
    }
    const epoch = captureEpoch()
    setPasting(true)
    try {
      const text = await clipboard.readText()
      if (!epoch.isCurrent() || !mounted.current) return
      const link = extractLink(text)
      if (link) onPasteLink(link)
      else {
        linkRef.current?.focus()
        setNote(t('wish.link_clipboard_empty'))
      }
    } catch {
      // not allowed here (or the person said no): the field takes the long-press paste
      if (!epoch.isCurrent() || !mounted.current) return
      linkRef.current?.focus()
      setNote(t('wish.link_paste_manual'))
    } finally {
      if (mounted.current) setPasting(false)
    }
  }

  function openManual() {
    reveal()
    titleFocusWanted.current = true
  }

  function rereadLink() {
    const link = normalizeWishUrl(valuesRef.current.url)
    if (link === null || link === 'invalid') return
    read(link, { force: true })
  }

  function skipReading() {
    reset()
    titleFocusWanted.current = true
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || !online || !revealed || reading || picking) return
    // Enter inside the price field: commit its text first (it parses on blur).
    const active = document.activeElement
    if (active instanceof HTMLElement && formRef.current?.contains(active)) active.blur()
    const now = valuesRef.current
    const answer = previewFor(preview, normalizeWishUrl(now.url))
    // the cleaned link of the answer is the one to keep
    const url = answer?.status === 'ready' ? answer.preview.url : now.url
    const result = validateWishForm({ ...now, url }, { priceInvalid: priceInvalidRef.current })
    if (!result.ok) {
      setErrors(result.errors)
      setLinkTouched(true)
      const first = (['title', 'price', 'url', 'note'] as const).find((field) => result.errors[field])
      if (first) document.getElementById(first === 'url' ? ids.link : first === 'title' ? ids.title : first === 'price' ? ids.price : ids.note)?.focus()
      return
    }
    const epoch = captureEpoch()
    if (!epoch.isCurrent()) return
    submitting.current = true
    setBusy(true)
    setErrors({})
    try {
      // a photo still on its way gets a moment (it is part of what the person saw); then what is there counts
      const own = ownPhotoRef.current
      const photo = photoRemoved || own ? linkPhoto.state : await linkPhoto.settle()
      if (!epoch.isCurrent() || !mounted.current) {
        submitting.current = false
        return
      }
      const intent: PhotoIntent = photoRemoved
        ? savedPhoto && savedPhoto.meta !== null
          ? { kind: 'remove' }
          : KEEP_PHOTO
        : own
          ? { kind: 'upload', photo: own }
          : photo.status === 'ready'
            ? { kind: 'upload', photo: photo.photo }
            : KEEP_PHOTO
      await onSubmit(result.input, { photo: intent })
      // success: the page navigates away; keep the button busy so nothing is sent twice
    } catch (err) {
      submitting.current = false
      if (!epoch.isCurrent()) return // the account of this form ended: no toast for it
      if (mounted.current) setBusy(false)
      const error = toAppError(err)
      toast.error(t(error.key, error.params))
    }
  }

  const urlError = errors.url ?? (linkTouched && linkNow === 'invalid' ? 'wish.url_invalid' : undefined)
  const cardState: WishCardState = (() => {
    if (linkNow === null || linkNow === 'invalid') return { kind: 'plain' }
    const site = hostOf(linkNow)
    if (!current) return { kind: 'link', site }
    if (current.status === 'loading') return { kind: 'loading', site }
    if (current.status === 'failed') return { kind: 'failed', site, code: current.code }
    return { kind: current.preview.partial ? 'partial' : 'filled', site: current.preview.site || site }
  })()
  // the person's own choice first (removed / being prepared / picked), then the link's picture, then the saved one
  const cardPhoto: CardPhoto = photoRemoved
    ? { kind: 'removed' }
    : picking
      ? { kind: 'loading', preparing: true }
      : ownPhoto
        ? { kind: 'new', blob: ownPhoto.blob, source: 'own' }
        : linkPhoto.state.status === 'loading'
          ? { kind: 'loading' }
          : linkPhoto.state.status === 'ready'
            ? { kind: 'new', blob: linkPhoto.state.photo.blob, source: 'link' }
            : savedPhoto && savedPhoto.meta !== null
              ? { kind: 'saved', wishId: savedPhoto.wishId, meta: savedPhoto.meta }
              : { kind: 'none' }
  const mood: BunnyMood =
    preview.status === 'loading' ? 'sniff' : preview.status === 'ready' ? 'joy' : variant === 'new' && !revealed ? 'hello' : 'calm'
  // what Pompon says about it (decorative; the card's status line is the accessible one)
  const says =
    cardState.kind === 'loading'
      ? t('wish.bunny_sniff')
      : cardState.kind === 'filled'
        ? t('wish.bunny_found')
        : cardState.kind === 'partial'
          ? t('wish.bunny_partial')
          : cardState.kind === 'failed'
            ? t('wish.bunny_failed')
            : !revealed
              ? t('wish.bunny_hello')
              : variant === 'edit'
                ? t('wish.bunny_edit')
                : cardState.kind === 'plain' && values.url.trim() === ''
                  ? t('wish.bunny_manual')
                  : null
  const noteLength = codePoints(values.note)

  /**
   * The details rise in one after another when they open (they mount once and stay, so this plays once);
   * the edit screen has them from the start, reduced motion fades them in.
   */
  function rise(index: number) {
    const delay = index * 0.05
    if (variant === 'edit') return { initial: false as const, animate: { opacity: 1, y: 0 } }
    if (reduced) return { initial: { opacity: 0 }, animate: { opacity: 1, y: 0 }, transition: fade }
    return {
      initial: { opacity: 0, y: 18 },
      animate: { opacity: 1, y: 0 },
      transition: { ...smooth, delay, opacity: { ...fade, duration: 0.22, delay } },
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="flex flex-col">
        <BunnyPeek mood={mood} says={says} className="pl-4" />
        <LinkPill
          id={ids.link}
          value={values.url}
          inputRef={linkRef}
          onType={onLinkType}
          onPasteLink={onPasteLink}
          onCommit={onLinkCommit}
          onClear={onLinkClear}
          onPasteButton={() => void onPasteButton()}
          pasting={pasting}
          error={urlError ? t(urlError) : undefined}
          note={note}
          hint={revealed ? undefined : t('wish.url_hint')}
        />
      </div>

      {!revealed ? (
        <>
          <div className="flex justify-center">
            <Button variant="ghost" icon={<IconPencil />} onClick={openManual}>
              {t('wish.link_manual')}
            </Button>
          </div>
          <HowItWorks />
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <m.div {...rise(0)}>
            <WishCard
              idPrefix={`${baseId}-card`}
              state={cardState}
              host={linkNow === null || linkNow === 'invalid' ? null : hostOf(linkNow)}
              title={values.title}
              onTitle={(text) => {
                typed.current.title = true
                update({ title: text }, 'title')
              }}
              priceCents={values.priceCents}
              onPrice={(cents, { invalid }) => {
                priceInvalidRef.current = invalid
                if (invalid) setErrors((prev) => ({ ...prev, price: 'wish.price_invalid' }))
                else {
                  if (cents !== valuesRef.current.priceCents) typed.current.price = true
                  update({ priceCents: cents }, 'price')
                }
              }}
              titleError={errors.title ? t(errors.title, { max: LIMITS.wishTitle }) : undefined}
              priceError={errors.price ? t(errors.price) : undefined}
              titleRef={titleRef}
              onReread={rereadLink}
              onSkip={skipReading}
              photo={<CardPhotoView photo={cardPhoto} onRemove={() => setPhotoRemoved(true)} onRestore={() => setPhotoRemoved(false)} onPick={pickPhoto} />}
            />
            {/* the device's picker (image/*: on a phone the library or the camera); prepared here, nothing uploads yet */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-wish-photo-input=""
              onChange={(event) => void onPhotoFile(event)}
            />
          </m.div>

          <m.div {...rise(1)}>
            {detailsOpen ? (
              <Panel>
                <WishDetailFields
                  values={values}
                  onChange={(key, text) => {
                    typed.current[key] = true
                    update({ [key]: text })
                  }}
                />
              </Panel>
            ) : (
              <div className="flex justify-center">
                <Button variant="ghost" size="sm" icon={<IconPlus />} onClick={() => setDetailsOpen(true)}>
                  {t('wish.details_add')}
                </Button>
              </div>
            )}
          </m.div>

          <m.div {...rise(2)}>
            <Panel>
              <label htmlFor={ids.note} className="px-1 t-caption-1 font-semibold uppercase tracking-[0.06em] text-text-2">
                {t('wish.note_label')}
              </label>
              <div className="wish-inline -mx-1 mt-1 px-1" data-invalid={errors.note ? '' : undefined}>
                <textarea
                  id={ids.note}
                  rows={2}
                  value={values.note}
                  maxLength={LIMITS.wishNote}
                  placeholder={t('wish.note_placeholder')}
                  aria-invalid={errors.note ? true : undefined}
                  aria-describedby={errors.note ? `${ids.note}-error` : undefined}
                  className="wish-title-input block max-h-48 min-h-12 w-full resize-none bg-transparent px-1 py-1.5 t-body text-text outline-none placeholder:text-text-3"
                  onChange={(event) => update({ note: event.target.value }, 'note')}
                />
              </div>
              {errors.note ? (
                <p id={`${ids.note}-error`} className="mt-1 px-1 t-footnote text-danger">
                  {t(errors.note, { max: LIMITS.wishNote })}
                </p>
              ) : noteLength >= LIMITS.wishNote - 50 ? (
                <p className="mt-1 px-1 text-right t-footnote tabular-nums text-text-2">
                  {t('wish.char_count', { count: noteLength, max: LIMITS.wishNote })}
                </p>
              ) : null}
            </Panel>
          </m.div>

          <m.div {...rise(3)}>
            <Panel>
              <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
                <h3 id={ids.priority} className="t-headline text-text">
                  {t('wish.priority_label')}
                </h3>
              </div>
              <WishOMeter value={values.priority} onChange={(priority) => update({ priority })} labelledBy={ids.priority} />
            </Panel>
          </m.div>

          {wishQuantityEnabled() ? (
            <m.div {...rise(4)}>
              <Panel>
                <div className="flex items-center justify-between gap-3 px-1">
                  <div className="min-w-0">
                    <h3 id={ids.quantity} className="t-headline text-text">
                      {t('wish.quantity_label')}
                    </h3>
                    <p id={`${ids.quantity}-hint`} className="t-footnote text-text-2">
                      {t('wish.quantity_hint')}
                    </p>
                  </div>
                  <QuantityStepper
                    value={values.quantity}
                    onChange={(quantity) => update({ quantity })}
                    labelledBy={ids.quantity}
                    describedBy={`${ids.quantity}-hint`}
                  />
                </div>
              </Panel>
            </m.div>
          ) : null}

          <m.div {...rise(5)} className="flex flex-col gap-3 pt-2">
            {!online ? (
              <p role="status" className="text-center t-footnote text-text-2">
                {t('wish.offline_save')}
              </p>
            ) : null}
            <Button type="submit" size="lg" fullWidth loading={busy} loadingLabel={t('wish.saving')} disabled={!online || reading || picking}>
              {submitLabel}
            </Button>
            {onDelete ? (
              <Button
                variant="ghost"
                size="lg"
                fullWidth
                icon={<IconTrash className="text-danger" />}
                hapticKind="warning"
                disabled={busy}
                onClick={onDelete}
              >
                <span className="text-danger">{t('wish.delete')}</span>
              </Button>
            ) : null}
          </m.div>
        </div>
      )}
    </form>
  )
}

/** A frosted, grouped section of the form (note, "Wie sehr?"). */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('glass-panel rounded-[24px] px-4 pb-4 pt-3.5', className)}>{children}</div>
}

const STEPS = [
  { key: 'wish.how_1', tone: 1, icon: <IconLink size={18} /> },
  { key: 'wish.how_2', tone: 3, icon: <IconPaste size={18} /> },
  { key: 'wish.how_3', tone: 2, icon: <IconSparkle size={18} /> },
] as const

/** The empty link screen explains the three steps (grouped rows with small tinted icon tiles, like settings). */
function HowItWorks() {
  const { t } = useTranslation('wishes')
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="glass-panel mt-2 rounded-[24px] px-4 pb-2 pt-3.5">
      <h2 id={headingId} className="px-1 pb-1 t-footnote font-semibold uppercase tracking-[0.06em] text-text-2">
        {t('wish.how_title')}
      </h2>
      <ol className="m-0 list-none p-0">
        {STEPS.map((step, index) => (
          <li key={step.key} className={cn('flex min-h-14 items-center gap-3 px-1 py-2', index > 0 && 'border-t border-separator')}>
            <span aria-hidden="true" data-tile={step.tone} className="tile grid h-8 w-8 shrink-0 place-items-center rounded-[9px]">
              {step.icon}
            </span>
            <span className="min-w-0 flex-1 t-subhead text-text">
              <span className="sr-only">{index + 1}. </span>
              {t(step.key)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
