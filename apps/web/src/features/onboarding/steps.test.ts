import { describe, expect, it } from 'vitest'
import {
  INITIAL_STATE,
  advance,
  canGoBack,
  canGoForward,
  currentView,
  destinationOf,
  finishesNow,
  progressOf,
  type OnboardingContext,
  type OnboardingEvent,
  type OnboardingState,
  type OnboardingStep,
} from './steps'

const DESKTOP: OnboardingContext = { homeScreen: false, pendingInvite: false }
const IOS: OnboardingContext = { homeScreen: true, pendingInvite: false }

/** Runs events from the start; throws if one of them finishes early. */
function walk(context: OnboardingContext, ...events: OnboardingEvent[]): OnboardingState {
  let state = INITIAL_STATE
  for (const event of events) {
    const step = advance(state, event, context)
    if (step.kind !== 'view') throw new Error(`finished early on ${event.type}`)
    state = step.state
  }
  return state
}

/** hello → wishes → start (the occasion cards) */
const NEXT: OnboardingEvent = { type: 'next' }

function finishOf(step: OnboardingStep): string | null {
  return step.kind === 'finish' ? step.to : null
}

describe('onboarding steps (product-pilot S4/F3)', () => {
  it('starts with the greeting; it can only go forward, not back', () => {
    expect(currentView(INITIAL_STATE)).toBe('hello')
    expect(INITIAL_STATE.direction).toBe(0)
    expect(canGoBack(INITIAL_STATE)).toBe(false)
    expect(canGoForward(INITIAL_STATE)).toBe(true)
    // Felix 25.10: the wish box comes second; it only moves on ("Später" / "Weiter"), so it swipes forward too
    const wishes = walk(DESKTOP, NEXT)
    expect(currentView(wishes)).toBe('wishes')
    expect(canGoForward(wishes)).toBe(true)
    expect(canGoBack(wishes)).toBe(true)
    const start = walk(DESKTOP, NEXT, NEXT)
    expect(currentView(start)).toBe('start')
    expect(start.direction).toBe(1)
    expect(canGoForward(start)).toBe(false) // step 3 needs a decision
    expect(canGoBack(start)).toBe(true)
  })

  it('has three steps outside iOS Safari and four with the Home Screen hint', () => {
    expect(progressOf('hello', DESKTOP)).toEqual({ current: 1, total: 3 })
    expect(progressOf('wishes', DESKTOP)).toEqual({ current: 2, total: 3 })
    expect(progressOf('start', DESKTOP)).toEqual({ current: 3, total: 3 })
    expect(progressOf('invite', DESKTOP)).toEqual({ current: 3, total: 3 })
    expect(progressOf('homescreen', IOS)).toEqual({ current: 4, total: 4 })
  })

  it('the wish box never finishes the onboarding and never decides anything', () => {
    const wishes = walk(DESKTOP, NEXT)
    expect(finishesNow(wishes, NEXT, DESKTOP)).toBe(false)
    expect((advance(wishes, { type: 'choose', choice: 'create' }, DESKTOP) as { state: OnboardingState }).state).toBe(wishes)
    expect(walk(DESKTOP, NEXT, NEXT).choice).toBeNull()
    // skipping from it is the usual "just take me in"
    expect(finishOf(advance(wishes, { type: 'skip' }, DESKTOP))).toBe('/soon')
  })

  it('"Ersten Anlass anlegen" ends on the new-occasion form — after the iOS hint where it applies', () => {
    const start = walk(DESKTOP, NEXT, NEXT)
    expect(finishOf(advance(start, { type: 'choose', choice: 'create' }, DESKTOP))).toBe('/occasions/new')

    const iosStart = walk(IOS, NEXT, NEXT)
    const hint = advance(iosStart, { type: 'choose', choice: 'create' }, IOS)
    expect(hint.kind === 'view' && currentView(hint.state)).toBe('homescreen')
    if (hint.kind !== 'view') return
    expect(finishOf(advance(hint.state, { type: 'confirm' }, IOS))).toBe('/occasions/new')
    // skipping the hint keeps the decision that was already made
    expect(finishOf(advance(hint.state, { type: 'skip' }, IOS))).toBe('/occasions/new')
  })

  it('"Ich habe einen Einladungslink" without a waiting invite explains the link, then opens the feed', () => {
    const explained = walk(DESKTOP, NEXT, NEXT, { type: 'choose', choice: 'invite' })
    expect(currentView(explained)).toBe('invite')
    expect(explained.choice).toBe('invite')
    expect(finishOf(advance(explained, { type: 'confirm' }, DESKTOP))).toBe('/soon')

    const iosExplained = walk(IOS, NEXT, NEXT, { type: 'choose', choice: 'invite' }, { type: 'confirm' })
    expect(currentView(iosExplained)).toBe('homescreen')
    expect(finishOf(advance(iosExplained, { type: 'confirm' }, IOS))).toBe('/soon')
  })

  it('a waiting invite goes straight to /i, which still asks for an explicit "Beitreten"', () => {
    const invited: OnboardingContext = { homeScreen: false, pendingInvite: true }
    const start = walk(invited, NEXT, NEXT)
    expect(finishOf(advance(start, { type: 'choose', choice: 'invite' }, invited))).toBe('/i')
    expect(finishOf(advance(INITIAL_STATE, { type: 'skip' }, invited))).toBe('/i')
    // creating an occasion stays possible
    expect(finishOf(advance(start, { type: 'choose', choice: 'create' }, invited))).toBe('/occasions/new')
  })

  it('never puts the Home Screen hint before a waiting invite (the installed app would not have it)', () => {
    const iosInvited: OnboardingContext = { homeScreen: true, pendingInvite: true }
    const start = walk(iosInvited, NEXT, NEXT)
    expect(finishOf(advance(start, { type: 'choose', choice: 'invite' }, iosInvited))).toBe('/i')
    const hint = advance(start, { type: 'choose', choice: 'create' }, iosInvited)
    expect(hint.kind === 'view' && currentView(hint.state)).toBe('homescreen')
  })

  it('"Überspringen" finishes from every step: the feed, or the waiting invite', () => {
    expect(finishOf(advance(INITIAL_STATE, { type: 'skip' }, DESKTOP))).toBe('/soon')
    expect(finishOf(advance(walk(DESKTOP, NEXT, NEXT), { type: 'skip' }, DESKTOP))).toBe('/soon')
    expect(finishOf(advance(walk(DESKTOP, NEXT, NEXT, { type: 'choose', choice: 'invite' }), { type: 'skip' }, DESKTOP))).toBe('/soon')
  })

  it('"Zurück" retraces the visited steps and slides the other way', () => {
    const hint = walk(IOS, NEXT, NEXT, { type: 'choose', choice: 'invite' }, { type: 'confirm' })
    const back = advance(hint, { type: 'back' }, IOS)
    expect(back.kind === 'view' && currentView(back.state)).toBe('invite')
    expect(back.kind === 'view' && back.state.direction).toBe(-1)
    const home = walk(DESKTOP, NEXT, NEXT, { type: 'back' }, { type: 'back' })
    expect(currentView(home)).toBe('hello')
    expect(canGoBack(home)).toBe(false)
  })

  it('ignores events that do not fit the current step (same state object)', () => {
    const start = walk(DESKTOP, NEXT, NEXT)
    expect(advance(start, { type: 'next' }, DESKTOP)).toEqual({ kind: 'view', state: start })
    expect((advance(start, { type: 'next' }, DESKTOP) as { state: OnboardingState }).state).toBe(start)
    expect((advance(INITIAL_STATE, { type: 'back' }, DESKTOP) as { state: OnboardingState }).state).toBe(INITIAL_STATE)
    expect((advance(INITIAL_STATE, { type: 'confirm' }, DESKTOP) as { state: OnboardingState }).state).toBe(INITIAL_STATE)
    expect((advance(INITIAL_STATE, { type: 'choose', choice: 'create' }, DESKTOP) as { state: OnboardingState }).state).toBe(INITIAL_STATE)
  })

  it('knows which buttons end the onboarding (they need the network)', () => {
    const start = walk(DESKTOP, NEXT, NEXT)
    expect(finishesNow(INITIAL_STATE, { type: 'next' }, DESKTOP)).toBe(false)
    expect(finishesNow(INITIAL_STATE, { type: 'skip' }, DESKTOP)).toBe(true)
    expect(finishesNow(start, { type: 'choose', choice: 'create' }, DESKTOP)).toBe(true)
    expect(finishesNow(start, { type: 'choose', choice: 'invite' }, DESKTOP)).toBe(false)
    expect(finishesNow(walk(IOS, NEXT, NEXT), { type: 'choose', choice: 'create' }, IOS)).toBe(false)
  })

  it('maps decisions to destinations', () => {
    expect(destinationOf('create', true)).toBe('/occasions/new')
    expect(destinationOf('invite', true)).toBe('/i')
    expect(destinationOf('invite', false)).toBe('/soon')
    expect(destinationOf(null, false)).toBe('/soon')
    expect(destinationOf(null, true)).toBe('/i')
  })
})
