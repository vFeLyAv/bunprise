// Step logic of the onboarding /welcome (product-pilot S4/F3, brief 5.4: one real action, "Überspringen"
// from the first frame; Felix 25.10: the three screens of docs/design/2026-10-25-welcome-ideas.md).
// Pure functions: no React, no storage, no network.
//
//   hello ──"Weiter"──▶ wishes ──"Weiter"/"Später"──▶ start ──a celebration, "Los geht's!"──▶ [homescreen] ──▶ /occasions/new
//                                                       └──"Ich habe eine Einladung"──┬─ invite waiting ───────────▶ /i
//                                                                                     └─▶ invite (how links work) ─▶ [homescreen] ──▶ /soon
//
// "wishes" picks interests for "Ideen" on the device only (the step itself never writes to the server).
// [homescreen] = only in iOS Safari outside the installed app (platform.ts), never right before a
// waiting invite. "invite" is a sub-view of step 3, so the progress shows three steps (four with the hint).
// "Überspringen" finishes from every view; finishing = markOnboardingDone() + navigation
// (useFinishOnboarding.ts).

export type OnboardingView = 'hello' | 'wishes' | 'start' | 'invite' | 'homescreen'
export type OnboardingChoice = 'create' | 'invite'
export type OnboardingDestination = '/soon' | '/i' | '/occasions/new'

export interface OnboardingContext {
  /** iOS Safari outside the Home Screen app: show the "Zum Home-Bildschirm" step */
  homeScreen: boolean
  /** an invite token from /i#… waits in this tab (features/invite/pending.ts) */
  pendingInvite: boolean
}

export interface OnboardingState {
  /** visited views, the current one last ("Zurück" pops it) */
  trail: readonly OnboardingView[]
  /** what the person picked on step 3 (decides where finishing leads) */
  choice: OnboardingChoice | null
  /** how the last change moved: 1 forward, -1 back, 0 = first appearance */
  direction: -1 | 0 | 1
}

export type OnboardingEvent =
  | { type: 'next' }
  | { type: 'choose'; choice: OnboardingChoice }
  | { type: 'confirm' }
  | { type: 'back' }
  | { type: 'skip' }

export type OnboardingStep =
  | { kind: 'view'; state: OnboardingState }
  | { kind: 'finish'; to: OnboardingDestination }

export const INITIAL_STATE: OnboardingState = { trail: ['hello'], choice: null, direction: 0 }

export function currentView(state: OnboardingState): OnboardingView {
  return state.trail[state.trail.length - 1] ?? 'hello'
}

export function canGoBack(state: OnboardingState): boolean {
  return state.trail.length > 1
}

/** The greeting and the wish box can be swiped forward (both just move on); later steps need a decision first. */
export function canGoForward(state: OnboardingState): boolean {
  const view = currentView(state)
  return view === 'hello' || view === 'wishes'
}

/** 1-based position for the progress dots; the invite explanation belongs to step 3. */
export function progressOf(view: OnboardingView, context: OnboardingContext): { current: number; total: number } {
  const current = view === 'hello' ? 1 : view === 'wishes' ? 2 : view === 'homescreen' ? 4 : 3
  return { current, total: context.homeScreen ? 4 : 3 }
}

/** Where finishing leads: the new-occasion form, the waiting invite (its explicit "Beitreten"), or the feed. */
export function destinationOf(choice: OnboardingChoice | null, pendingInvite: boolean): OnboardingDestination {
  if (choice === 'create') return '/occasions/new'
  return pendingInvite ? '/i' : '/soon'
}

function show(state: OnboardingState): OnboardingStep {
  return { kind: 'view', state }
}

function finish(to: OnboardingDestination): OnboardingStep {
  return { kind: 'finish', to }
}

function forward(state: OnboardingState, view: OnboardingView): OnboardingState {
  return { ...state, trail: [...state.trail, view], direction: 1 }
}

/**
 * After the decision of step 3: the iOS hint comes last, otherwise the onboarding ends right away.
 * Never between a person and a waiting invite: the Home Screen app has its own storage, so the
 * invite (and the session) would not travel with it (performance-plan §6.1).
 */
function afterDecision(state: OnboardingState, context: OnboardingContext): OnboardingStep {
  const to = destinationOf(state.choice, context.pendingInvite)
  return context.homeScreen && to !== '/i' ? show(forward(state, 'homescreen')) : finish(to)
}

/**
 * One transition. An event that does not fit the current view returns the SAME state object,
 * so callers can ignore it (`step.state === state`).
 */
export function advance(state: OnboardingState, event: OnboardingEvent, context: OnboardingContext): OnboardingStep {
  const view = currentView(state)
  switch (event.type) {
    case 'next':
      if (view === 'hello') return show(forward(state, 'wishes'))
      return view === 'wishes' ? show(forward(state, 'start')) : show(state)
    case 'choose': {
      if (view !== 'start') return show(state)
      const chosen: OnboardingState = { ...state, choice: event.choice }
      // Without a waiting invite there is nothing to open yet: explain how the link works instead
      // of asking for it (no input field — the link itself opens the invite).
      if (event.choice === 'invite' && !context.pendingInvite) return show(forward(chosen, 'invite'))
      return afterDecision(chosen, context)
    }
    case 'confirm':
      if (view === 'invite') return afterDecision(state, context)
      if (view === 'homescreen') return finish(destinationOf(state.choice, context.pendingInvite))
      return show(state)
    case 'back':
      return canGoBack(state) ? show({ ...state, trail: state.trail.slice(0, -1), direction: -1 }) : show(state)
    case 'skip':
      // On the last step the decision is already made; earlier, skipping means "just take me in".
      return finish(destinationOf(view === 'homescreen' ? state.choice : null, context.pendingInvite))
  }
}

/** True when this event would end the onboarding now (it then needs the network). */
export function finishesNow(state: OnboardingState, event: OnboardingEvent, context: OnboardingContext): boolean {
  return advance(state, event, context).kind === 'finish'
}
