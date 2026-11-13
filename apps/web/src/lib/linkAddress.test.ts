import { afterEach, describe, expect, it } from 'vitest'
import { dropCodeFromAddress, putCodeInAddress } from './linkAddress'

// A link's code stays in the address until it is used (add-friends-design §1): the gates clean it — only on the
// code's own screen — and put it back after a failed attempt; the history entry keeps its state (the router's key).

const CODE = '7e'.repeat(32)

afterEach(() => history.replaceState(null, '', '/'))

describe('the code in the address', () => {
  it('drop: only the fragment of the code\'s own screen goes; the entry keeps its state', () => {
    history.replaceState({ key: 'k1', __TSR_key: 'k1' }, '', `/f?x=1#${CODE}`)
    dropCodeFromAddress('/f')
    expect(`${location.pathname}${location.search}${location.hash}`).toBe('/f?x=1')
    expect(history.state).toMatchObject({ __TSR_key: 'k1' })
    history.replaceState(null, '', `/people#${CODE}`)
    dropCodeFromAddress('/f')
    expect(location.hash).toBe(`#${CODE}`)
  })

  it('put back: only into a clean address of the code\'s own screen', () => {
    history.replaceState(null, '', '/i')
    putCodeInAddress('/i', CODE)
    expect(location.hash).toBe(`#${CODE}`)
    history.replaceState(null, '', '/i#another')
    putCodeInAddress('/i', CODE)
    expect(location.hash).toBe('#another') // a newer link is never overwritten
    history.replaceState(null, '', '/soon')
    putCodeInAddress('/i', CODE)
    expect(location.hash).toBe('')
  })
})
