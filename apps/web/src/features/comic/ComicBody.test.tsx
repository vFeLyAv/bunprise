import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSeenHint } from '../../lib/hints'
import { activeMascot, resetStage } from '../mascot-ui/stage'
import ComicBody from './ComicBody'
import { readComicProgress } from './progress'

// The reader's inside with the real comic of the package (@bunprise/mascot/comic), in jsdom: "Weniger" (no Web
// Animations here), so the ribbon is the still picture. The drawings, timings and the scroll-linked roll are tested in
// packages/mascot (comic.test.ts, story.test.ts).

function mount(onLoaded = vi.fn(), start: { episode: 1 | 2; panel: number } | null = null) {
  render(<div style={{ overflowY: 'auto', height: '600px' }} data-testid="scroller">
    <ComicBody start={start} onClose={vi.fn()} onLoaded={onLoaded} />
  </div>)
  return onLoaded
}

beforeEach(() => {
  localStorage.clear()
  resetStage()
  document.documentElement.dataset.motion = 'reduce'
})
afterEach(async () => {
  delete document.documentElement.dataset.motion
  await act(async () => { await i18next.changeLanguage('de') })
})

describe('the comic reader', () => {
  it('builds episode 1 as a labelled group with its texts; the Start card is done; the mascots under it stand still', async () => {
    const onLoaded = mount()
    const ribbon = await screen.findByRole('group', { name: 'Comic: Folge 1 · Ein Wunsch rollt an' }, { timeout: 5000 })
    expect(ribbon.textContent).toContain('Pompon weiß, wann.')
    expect(ribbon.textContent).toContain('Die Gießkanne schenke ich Mila!')
    // the drawings are decoration; the scene sentences are there for screen readers
    expect(ribbon.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(20)
    expect(ribbon.textContent).toContain('Auf dem Hügel reicht Mila Tapsi einen leuchtenden Stern')
    expect(onLoaded).toHaveBeenCalled()
    expect(hasSeenHint('story-1')).toBe(true)
    expect(activeMascot()).not.toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'Folgen' })).toBeTruthy()
  })

  it('«Weiter: Folge 2» switches to episode 2 and moves the focus to its start; «Von vorn» back to episode 1', async () => {
    mount()
    await screen.findByRole('group', { name: /Folge 1/ }, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: /Weiter: Folge 2/ }))
    const two = await screen.findByRole('group', { name: 'Comic: Folge 2 · Zweimal derselbe Schal' }, { timeout: 5000 })
    await waitFor(() => expect(two.parentElement).toBe(document.activeElement))
    expect(two.textContent).toContain('Momo hat Geburtstag.')
    expect(screen.queryByRole('group', { name: /Folge 1/ })).toBeNull()
    expect(screen.getByText('Die nächste Folge kommt bald.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Von vorn' }))
    expect(await screen.findByRole('group', { name: /Folge 1/ }, { timeout: 5000 })).toBeTruthy()
  })

  it('"Weiterlesen": opens at the remembered episode and keeps the place it reads', async () => {
    mount(vi.fn(), { episode: 2, panel: 4 })
    expect(await screen.findByRole('group', { name: /Folge 2/ }, { timeout: 5000 })).toBeTruthy()
    await waitFor(() => expect(readComicProgress()?.episode).toBe(2))
  })

  it('the texts follow the app\'s language (here Ukrainian)', async () => {
    // the test setup bundles German only: the Ukrainian reader strings this test needs
    i18next.addResourceBundle('uk', 'comic', { comic: { frame: 'Комікс: {{episode}}', episodes: 'Серії', episode: 'Серія {{n}}' } }, true, true)
    await act(async () => { await i18next.changeLanguage('uk') })
    mount()
    const ribbon = await screen.findByRole('group', { name: 'Комікс: Серія 1 · Бажання прикотилося' }, { timeout: 5000 })
    expect(ribbon.getAttribute('lang')).toBe('uk')
    expect(ribbon.textContent).toContain('Помпон знає, коли.')
    expect(ribbon.textContent).toContain('Тапсі береже бажання.')
    expect(screen.getByRole('radiogroup', { name: 'Серії' })).toBeTruthy()
  })

  it('closing it gives the stage back', async () => {
    const view = render(<div style={{ overflowY: 'auto' }}><ComicBody start={null} onClose={vi.fn()} onLoaded={vi.fn()} /></div>)
    await screen.findByRole('group', { name: /Folge 1/ }, { timeout: 5000 })
    expect(activeMascot()).not.toBeNull()
    view.unmount()
    expect(activeMascot()).toBeNull()
  })
})
