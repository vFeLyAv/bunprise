import { Component, Suspense, lazy, type ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChunkBoundary, isChunkLoadError } from './ChunkBoundary'

afterEach(() => vi.restoreAllMocks())

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: http://localhost/src/features/nav/ListWishStep.tsx')

class Outer extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null }
  static getDerivedStateFromError(error: Error) { return { message: error.message } }
  render() { return this.state.message ? <p>outer: {this.state.message}</p> : this.props.children }
}

it('knows the chunk-load messages of Chrome, Safari and Firefox', () => {
  expect(isChunkLoadError(chunkError())).toBe(true)
  expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
  expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
  expect(isChunkLoadError(new Error('boom'))).toBe(false)
})

it('a chunk that cannot load shows the fallback in place; the retry loads it afresh', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  let Step = lazy(() => Promise.reject(chunkError()))
  render(
    <Outer>
      <ChunkBoundary onRetry={() => { Step = lazy(async () => ({ default: () => <p>step</p> })) }} fallback={(retry) => <button type="button" onClick={retry}>offline, retry</button>}>
        {() => <Suspense fallback={<p>loading</p>}><Step /></Suspense>}
      </ChunkBoundary>
    </Outer>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'offline, retry' }))
  expect(await screen.findByText('step')).toBeTruthy()
  expect(screen.queryByText(/outer:/)).toBeNull()
})

it('any other error still goes on to the error page above', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  function Broken(): ReactNode { throw new Error('boom') }
  render(
    <Outer>
      <ChunkBoundary fallback={() => <p>fallback</p>}>{() => <Broken />}</ChunkBoundary>
    </Outer>,
  )
  expect(await screen.findByText('outer: boom')).toBeTruthy()
  expect(screen.queryByText('fallback')).toBeNull()
})
