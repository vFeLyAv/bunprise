import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LazyMotion, domMax } from 'motion/react'
import { expect, it, vi } from 'vitest'
import type { GiftIdea } from '../../lib/api/giftIdeas'
import { CardStack, DeckControls } from './Deck'

const ideas: GiftIdea[] = ['First idea', 'Second idea', 'Third idea'].map((title, index) => ({
  id: String(index), title, image_url: null, price_min_cents: 1000, price_max_cents: 1000,
  offers: [], interests: [],
}))
const noop = () => {}
const view = (cards: GiftIdea[]) => <LazyMotion features={domMax} strict>
  <CardStack cards={cards} position={{ at: 1, of: 3 }} likeStamp="Like" skipStamp="Not for me" hint="Swipe" newIds={[]} moreBusy={false}
    onSwipe={noop} exitDirection={1} onMoreLike={noop} onOffers={noop} />
</LazyMotion>

it('an undo during the outgoing flight returns the same card to the stack and exiting cards cannot take input', async () => {
  const rendered = render(view(ideas))
  const first = rendered.container.querySelector<HTMLElement>('[aria-label*="First idea"]')!
  expect(first.hasAttribute('inert')).toBe(false)
  rendered.rerender(view(ideas.slice(1)))
  expect(first.hasAttribute('inert')).toBe(true)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)) })
  expect(first.style.transform).toContain('translateX(')
  rendered.rerender(view(ideas))
  await waitFor(() => expect(first.style.transform).toBe('none'), { timeout: 1500 })
  expect(first.style.opacity).toBe('1')
  expect(first.hasAttribute('inert')).toBe(false)
  expect(first.getAttribute('aria-label')).toContain('First idea')
})

it('for someone the skip stamp says what the button says; without a known total the card is "Idee n"', () => {
  const rendered = render(<LazyMotion features={domMax} strict>
    <CardStack cards={ideas} position={{ at: 2, of: null }} likeStamp="Gemerkt" skipStamp="Nicht für Anna" hint="Nach rechts: für Anna merken" newIds={[]} moreBusy={false}
      onSwipe={noop} exitDirection={1} onMoreLike={noop} onOffers={noop} />
  </LazyMotion>)
  const top = rendered.container.querySelector<HTMLElement>('.gift-card[data-depth="0"]')!
  expect(within(top).getByText('Nicht für Anna')).toBeTruthy()
  expect(within(top).queryByText('Nicht für mich')).toBeNull()
  expect(top.getAttribute('aria-label')).toBe('Idee 2: First idea')
  expect(document.getElementById('gifts-card-hint')?.textContent).toBe('Nach rechts: für Anna merken')
  // the cards behind show their picture and name; only their actions wait until they are on top (gifts.css)
  const behind = rendered.container.querySelector<HTMLElement>('.gift-card[data-depth="1"]')!
  expect(within(behind).getByRole('heading', { hidden: true }).textContent).toBe('Second idea')
  expect(behind.querySelector('[data-gift-actions]')).not.toBeNull()
})

it('the counter names a total only when it is known', () => {
  const controls = (of: number | null) => <LazyMotion features={domMax} strict>
    <DeckControls position={{ at: 5, of }} likeLabel="Merken für Anna" skipLabel="Nicht für Anna" onLike={noop} onSkip={noop} onUndo={noop} canUndo />
  </LazyMotion>
  const rendered = render(controls(null))
  expect(screen.getByText('Idee 5')).toBeTruthy()
  rendered.rerender(controls(12))
  expect(screen.getByText('5 von 12')).toBeTruthy()
})

it('no round ✕ / ♥ under the deck (Felix 26.10): the decisions stay as focus-only buttons, undo only when it can', () => {
  const onLike = vi.fn()
  const onSkip = vi.fn()
  const controls = (canUndo: boolean) => <LazyMotion features={domMax} strict>
    <DeckControls position={{ at: 1, of: null }} likeLabel="Merken für Anna" skipLabel="Nicht für Anna" onLike={onLike} onSkip={onSkip} onUndo={noop} canUndo={canUndo} />
  </LazyMotion>
  const rendered = render(controls(false))
  // keyboards and screen readers still reach both decisions (WCAG 2.5.1 / 2.1.1); they show only while focused
  const like = screen.getByRole('button', { name: 'Merken für Anna' })
  const skip = screen.getByRole('button', { name: 'Nicht für Anna' })
  expect(like.className).toBe('gift-verdict')
  expect(skip.className).toBe('gift-verdict')
  expect(document.querySelector('.gift-action[data-kind="like"], .gift-action[data-kind="skip"]')).toBeNull()
  fireEvent.click(like)
  fireEvent.click(skip)
  expect(onLike).toHaveBeenCalledTimes(1)
  expect(onSkip).toHaveBeenCalledTimes(1)
  // nothing to take back yet: the undo button keeps its place but is not shown
  const undo = screen.getByRole('button', { name: 'Letzte Idee zurückholen', hidden: true }) as HTMLButtonElement
  expect(undo.disabled).toBe(true)
  expect(undo.parentElement?.className).toContain('invisible')
  rendered.rerender(controls(true))
  expect((screen.getByRole('button', { name: 'Letzte Idee zurückholen' }) as HTMLButtonElement).disabled).toBe(false)
})
