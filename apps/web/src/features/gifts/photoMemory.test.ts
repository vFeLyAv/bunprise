import { afterEach, describe, expect, it } from 'vitest'
import { forgetShownPhotos, rememberShownPhoto, SHOWN_PHOTOS_MAX, shownPhotoCount, wasPhotoShown } from './photoMemory'

// Felix 28.10 «не держать все фотографии загруженными»: only the addresses of the last few photos are remembered,
// however many products are browsed — and no bytes at all (the browser's own cache keeps those).

const photo = (n: number) => `/api/gift-ideas/img/books/cat:item-${n}`

describe('photoMemory: the photos shown lately (addresses only, bounded)', () => {
  afterEach(forgetShownPhotos)

  it('stays bounded after browsing many cards: the oldest are forgotten first', () => {
    for (let n = 0; n < 500; n += 1) rememberShownPhoto(photo(n))
    expect(shownPhotoCount()).toBe(SHOWN_PHOTOS_MAX)
    expect(SHOWN_PHOTOS_MAX).toBeLessThanOrEqual(64)
    expect(wasPhotoShown(photo(499))).toBe(true)
    expect(wasPhotoShown(photo(500 - SHOWN_PHOTOS_MAX))).toBe(true)
    expect(wasPhotoShown(photo(500 - SHOWN_PHOTOS_MAX - 1))).toBe(false)
    expect(wasPhotoShown(photo(0))).toBe(false)
  })

  it('a photo shown again is the newest again (the deck on screen is never the one forgotten)', () => {
    for (let n = 0; n < SHOWN_PHOTOS_MAX; n += 1) rememberShownPhoto(photo(n))
    rememberShownPhoto(photo(0)) // the card still on screen loads again
    rememberShownPhoto(photo(1000)) // one more photo: the oldest goes — now photo 1, not photo 0
    expect(wasPhotoShown(photo(0))).toBe(true)
    expect(wasPhotoShown(photo(1))).toBe(false)
    expect(shownPhotoCount()).toBe(SHOWN_PHOTOS_MAX)
  })

  it('remembers the same photo once, ignores nothing-addresses, forgets everything at the end of the account', () => {
    rememberShownPhoto(photo(1))
    rememberShownPhoto(photo(1))
    rememberShownPhoto(null)
    rememberShownPhoto('')
    expect(shownPhotoCount()).toBe(1)
    expect(wasPhotoShown(null)).toBe(false)
    forgetShownPhotos()
    expect(wasPhotoShown(photo(1))).toBe(false)
  })
})
