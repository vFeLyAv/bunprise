import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ownImagePath, photoFallbackArt } from '../../lib/api/giftIdeas'
import { ART_TONE } from './art'
import { GiftPicture } from './GiftPicture'
import { forgetShownPhotos, rememberShownPhoto, wasPhotoShown } from './photoMemory'

// Real catalogue photos (Felix 25.10, closed pilot): loaded only from our Worker's path, "Bild: <Shop>" once
// the photo is there, and the item's drawing — never a shop URL — when the photo fails.

const PHOTO = '/api/gift-ideas/img/books/cat:thalia-buch'

describe('GiftPicture with a catalogue photo', () => {
  it('loads the photo from our own path and names the shop only once it is there', () => {
    const { container, queryByText } = render(<GiftPicture idea={{ id: 'cat:thalia-buch', image_url: PHOTO }} credit="Thalia" />)
    const image = container.querySelector('img')!
    expect(image.getAttribute('src')).toBe(PHOTO)
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(container.querySelector('.gift-picture')!.hasAttribute('data-photo')).toBe(true)
    expect(queryByText('Bild: Thalia')).toBeNull()
    fireEvent.load(image)
    expect(queryByText('Bild: Thalia')).not.toBeNull()
  })

  it('falls back to the item’s own drawing when the photo fails', () => {
    const { container, queryByText } = render(<GiftPicture idea={{ id: 'cat:thalia-buch', image_url: PHOTO }} credit="Thalia" />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    const picture = container.querySelector<HTMLElement>('.gift-picture')!
    expect(picture.querySelector('.gift-picture-art svg')).not.toBeNull()
    expect(picture.dataset.tone).toBe(String(ART_TONE.books))
    expect(picture.hasAttribute('data-photo')).toBe(false)
    expect(queryByText('Bild: Thalia')).toBeNull()
  })

  it('shows no shop name on the small thumbnails', () => {
    const { container, queryByText } = render(<GiftPicture idea={{ id: 'x', image_url: PHOTO }} size="thumb" credit="Thalia" />)
    fireEvent.load(container.querySelector('img')!)
    expect(queryByText('Bild: Thalia')).toBeNull()
  })

  it('never takes a picture from another origin, even under a photo-like path', () => {
    expect(ownImagePath('https://shop.test/api/gift-ideas/img/books/x', 'https://app.test')).toBeNull()
    expect(ownImagePath('//shop.test/api/gift-ideas/img/books/x', 'https://app.test')).toBeNull()
  })
})

// Felix 28.10 «фотки дёргаются» (Ideen → Profil → Ideen): the card's photo that the browser already has comes
// back in the first frame — not lazy, decoded with that frame, its credit with it (no plate first, nothing pops).
describe('GiftPicture coming back to the tab', () => {
  beforeEach(forgetShownPhotos)
  afterEach(() => {
    forgetShownPhotos()
    vi.restoreAllMocks()
  })

  it('a photo shown before and still in the browser’s cache: eager, sync decode, the credit in the first render', () => {
    const first = render(<GiftPicture idea={{ id: 'cat:thalia-buch', image_url: PHOTO }} credit="Thalia" />)
    const img = first.container.querySelector('img')!
    // a first visit: lazy and decoded off the main thread, the credit once it is there
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')
    fireEvent.load(img)
    expect(wasPhotoShown(PHOTO)).toBe(true)
    first.unmount()

    // back on the tab: the browser has the picture already (complete before the first paint)
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(400)
    const again = render(<GiftPicture idea={{ id: 'cat:thalia-buch', image_url: PHOTO }} credit="Thalia" />)
    const back = again.container.querySelector('img')!
    expect(back.getAttribute('src')).toBe(PHOTO)
    expect(back.getAttribute('loading')).toBe('eager')
    expect(back.getAttribute('decoding')).toBe('sync')
    // no load event needed: the credit is there with the photo
    expect(again.queryByText('Bild: Thalia')).not.toBeNull()
  })

  it('a photo the browser no longer has still waits for its load before naming the shop', () => {
    rememberShownPhoto(PHOTO)
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false)
    const view = render(<GiftPicture idea={{ id: 'cat:thalia-buch', image_url: PHOTO }} credit="Thalia" />)
    expect(view.container.querySelector('img')!.getAttribute('decoding')).toBe('sync')
    expect(view.queryByText('Bild: Thalia')).toBeNull()
    fireEvent.load(view.container.querySelector('img')!)
    expect(view.queryByText('Bild: Thalia')).not.toBeNull()
  })
})

describe('photoFallbackArt', () => {
  it.each([
    [PHOTO, 'books'],
    ['/api/gift-ideas/img/lamp/cat:x', 'lamp'],
    ['/api/gift-ideas/img/BAD!/cat:x', null],
    ['/api/gift-ideas/art/books', null],
    ['/api/gift-ideas/demo-art/books', null],
    [null, null],
  ])('%s → %s', (url, art) => {
    expect(photoFallbackArt(url)).toBe(art)
  })
})
