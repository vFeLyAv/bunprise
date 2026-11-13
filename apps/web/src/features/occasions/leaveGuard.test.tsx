import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { LazyMotion, domMax } from 'motion/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Blocker = { blockerFn: () => boolean | Promise<boolean>; enableBeforeUnload?: boolean }
const history = vi.hoisted(() => ({ blockers: [] as Blocker[] }))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    history: {
      block: (blocker: Blocker) => {
        history.blockers.push(blocker)
        return () => {
          history.blockers = history.blockers.filter((b) => b !== blocker)
        }
      },
    },
  }),
}))

import { onClosingChange } from '../../lib/telegram/closing'
import { useLeaveGuard } from './leaveGuard'

const TEXT = { title: 'Änderungen verwerfen?', message: 'Was du eingetragen hast, wird nicht gespeichert.', confirm: 'Verwerfen', cancel: 'Weiter bearbeiten' }

function Screen({ dirty, go, onAllow }: { dirty: boolean; go: () => void; onAllow?: (allow: () => void) => void }) {
  const guard = useLeaveGuard(dirty, TEXT)
  onAllow?.(guard.allow)
  return (
    <LazyMotion features={domMax} strict>
      <button type="button" onClick={() => guard.leave(go)}>
        Abbrechen
      </button>
      {guard.sheet}
    </LazyMotion>
  )
}

const dialog = () => screen.getByRole('dialog', { name: TEXT.title })
const choose = (label: string) => fireEvent.click(within(dialog()).getAllByRole('button', { name: label }).at(-1)!)

beforeEach(() => {
  history.blockers = []
})
afterEach(() => vi.restoreAllMocks())

describe('leave guard ("Änderungen verwerfen?")', () => {
  it('lets an untouched screen go at once, from the button and from a back gesture', async () => {
    const go = vi.fn()
    render(<Screen dirty={false} go={go} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(go).toHaveBeenCalledTimes(1)
    expect(await history.blockers[0]!.blockerFn()).toBe(false)
    // never the browser's own "leave site?" dialog
    expect(history.blockers[0]!.enableBeforeUnload).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks first while there are changes: "Weiter bearbeiten" stays, "Verwerfen" goes', () => {
    const go = vi.fn()
    render(<Screen dirty go={go} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(dialog()).toBeTruthy()
    expect(go).not.toHaveBeenCalled()
    choose('Weiter bearbeiten')
    expect(go).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    choose('Verwerfen')
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('holds a back gesture with the same question (true = stay, false = go on)', async () => {
    render(<Screen dirty go={vi.fn()} />)
    let answer: Promise<boolean | undefined> = Promise.resolve(undefined)
    act(() => {
      answer = Promise.resolve(history.blockers[0]!.blockerFn())
    })
    choose('Weiter bearbeiten')
    expect(await answer).toBe(true)
    act(() => {
      answer = Promise.resolve(history.blockers[0]!.blockerFn())
    })
    choose('Verwerfen')
    expect(await answer).toBe(false)
    // discarded once: nothing asks again on the way out
    expect(await history.blockers[0]!.blockerFn()).toBe(false)
  })

  it('a save or delete (allow) leaves without a question', async () => {
    let allow: () => void = () => {}
    const go = vi.fn()
    render(<Screen dirty go={go} onAllow={(fn) => (allow = fn)} />)
    allow()
    expect(await history.blockers[0]!.blockerFn()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('removes its blocker with the screen', () => {
    const { unmount } = render(<Screen dirty go={vi.fn()} />)
    expect(history.blockers).toHaveLength(1)
    unmount()
    expect(history.blockers).toHaveLength(0)
  })
})

describe('leave guard → Telegram closing confirmation (lib/telegram/closing.ts)', () => {
  // stands in for the bridge: records what it would send as web_app_setup_closing_behavior
  let need: boolean[] = []
  let unsubscribe = () => {}
  beforeEach(() => {
    need = []
    unsubscribe = onClosingChange((value) => need.push(value))
  })
  afterEach(() => unsubscribe())

  it('on while the form has changes, off again after a save (allow)', () => {
    let allow: () => void = () => {}
    const { rerender } = render(<Screen dirty={false} go={vi.fn()} onAllow={(fn) => (allow = fn)} />)
    expect(need).toEqual([false])
    rerender(<Screen dirty go={vi.fn()} onAllow={(fn) => (allow = fn)} />)
    expect(need).toEqual([false, true])
    act(() => allow())
    expect(need).toEqual([false, true, false])
  })

  it('off when the screen goes, and after "Verwerfen"', () => {
    const { unmount } = render(<Screen dirty go={vi.fn()} />)
    expect(need.at(-1)).toBe(true)
    unmount()
    expect(need.at(-1)).toBe(false)

    render(<Screen dirty go={vi.fn()} />)
    expect(need.at(-1)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    choose('Verwerfen')
    expect(need.at(-1)).toBe(false)
  })
})
