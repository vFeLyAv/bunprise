import { render, screen } from '@testing-library/react'
import { LazyMotion, domMax } from 'motion/react'
import { describe, expect, it } from 'vitest'
import { ExplainSheet } from './InterestSheets'

// "Warum diese Ideen?" says honestly where the ideas come from: the invented demo catalogue, or (25.10)
// our own checked catalogue of real products — never both.

describe('"Warum diese Ideen?" names the source of the ideas', () => {
  it.each([
    [true, /erfunden \(Demo\)/, /Echte Produkte aus echten Shops/],
    [false, /Echte Produkte aus echten Shops/, /erfunden \(Demo\)/],
  ])('demo = %s', (demo, shown, hidden) => {
    render(
      <LazyMotion features={domMax}>
        <ExplainSheet open onClose={() => {}} name={null} inferred={[]} personalize onPersonalize={() => {}} demo={demo} />
      </LazyMotion>,
    )
    expect(screen.getByText(shown)).toBeTruthy()
    expect(screen.queryByText(hidden)).toBeNull()
  })
})
