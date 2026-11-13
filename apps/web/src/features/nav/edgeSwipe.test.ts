import { describe, expect, it } from 'vitest'
import {
  CANCEL_VELOCITY,
  COMPLETE_RATIO,
  DIM_MAX,
  EDGE_ZONE_PX,
  FLING_VELOCITY,
  PARALLAX,
  classifyMove,
  followOffset,
  isEdgeStart,
  releaseVelocity,
  shouldComplete,
  swipeProgress,
  underlayDim,
  underlayOffset,
} from './edgeSwipe'

describe('edge swipe-back: where it starts', () => {
  it('starts within 24 px of the screen’s left edge only', () => {
    expect(EDGE_ZONE_PX).toBe(24)
    expect(isEdgeStart(0)).toBe(true)
    expect(isEdgeStart(24)).toBe(true)
    expect(isEdgeStart(25)).toBe(false)
    expect(isEdgeStart(-1)).toBe(false)
    // the dev phone frame: the screen's left edge is not the window's
    expect(isEdgeStart(410, 400)).toBe(true)
    expect(isEdgeStart(430, 400)).toBe(false)
  })

  it('a tap stays a tap, a vertical move stays scrolling, only a move to the right is the gesture', () => {
    expect(classifyMove(4, 3)).toBe('pending')
    expect(classifyMove(30, 4)).toBe('swipe')
    expect(classifyMove(3, 30)).toBe('scroll')
    expect(classifyMove(-30, 0)).toBe('scroll')
    // a diagonal move needs horizontal to win clearly
    expect(classifyMove(20, 18)).toBe('scroll')
  })

  it('the screen never moves left of its resting place', () => {
    expect(followOffset(-40)).toBe(0)
    expect(followOffset(120)).toBe(120)
  })
})

describe('edge swipe-back: release', () => {
  const width = 390

  it('completes past 40 % of the width, springs back below it', () => {
    expect(COMPLETE_RATIO).toBe(0.4)
    expect(shouldComplete(width * 0.41, 0, width)).toBe(true)
    expect(shouldComplete(width * 0.39, 0, width)).toBe(false)
  })

  it('a flick to the right completes from any distance, a flick back cancels from any distance', () => {
    expect(shouldComplete(30, FLING_VELOCITY, width)).toBe(true)
    expect(shouldComplete(30, FLING_VELOCITY - 1, width)).toBe(false)
    expect(shouldComplete(width * 0.8, CANCEL_VELOCITY, width)).toBe(false)
    expect(shouldComplete(width * 0.8, CANCEL_VELOCITY + 1, width)).toBe(true)
  })

  it('nothing to complete without a width or without an offset', () => {
    expect(shouldComplete(0, 2000, width)).toBe(false)
    expect(shouldComplete(200, 2000, 0)).toBe(false)
  })

  it('measures the release velocity over the last 90 ms only', () => {
    expect(releaseVelocity([])).toBe(0)
    expect(releaseVelocity([{ t: 0, x: 0 }])).toBe(0)
    // slow for a long time, then fast at the end: the end counts
    const samples = [
      { t: 0, x: 0 },
      { t: 400, x: 20 },
      { t: 450, x: 45 },
      { t: 500, x: 95 },
    ]
    expect(releaseVelocity(samples)).toBeCloseTo(((95 - 45) / 50) * 1000)
  })
})

describe('edge swipe-back: the previous screen underneath', () => {
  const width = 400

  it('slides in from 28 % to the left (parallax) and loses its dim on the way', () => {
    expect(underlayOffset(0, width, false)).toBe(-PARALLAX * width)
    expect(underlayOffset(0.5, width, false)).toBe(-PARALLAX * width * 0.5)
    expect(underlayOffset(1, width, false)).toBe(-0)
    expect(underlayDim(0)).toBe(DIM_MAX)
    expect(underlayDim(1)).toBe(0)
    expect(swipeProgress(200, width)).toBe(0.5)
    expect(swipeProgress(900, width)).toBe(1)
    expect(swipeProgress(-5, width)).toBe(0)
  })

  it('reduced motion: no parallax, a plain slide', () => {
    expect(underlayOffset(0, width, true)).toBe(0)
    expect(underlayOffset(0.3, width, true)).toBe(0)
  })
})
