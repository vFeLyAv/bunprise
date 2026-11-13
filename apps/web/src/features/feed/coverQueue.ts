// The Start cards' covers load through this queue (Felix 25.10, docs/handoffs/2026-10-25-feed-photos.md): at most
// MAX_PARALLEL get_occasion_photo calls at once, the rest wait in order. A feed of many occasions must never fire
// a burst of photo requests (each answer is up to ~550 KB of base64) while the first screen is still settling.

export const MAX_PARALLEL_COVERS = 2

let running = 0
const waiting: Array<() => void> = []

/** Runs `task` as soon as a slot is free; the promise settles with the task. */
export function inCoverQueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running += 1
      let promise: Promise<T>
      try {
        promise = task()
      } catch (err) {
        promise = Promise.reject(err)
      }
      promise.then(resolve, reject).finally(() => {
        running -= 1
        waiting.shift()?.()
      })
    }
    if (running < MAX_PARALLEL_COVERS) start()
    else waiting.push(start)
  })
}

/** For tests: how many covers load right now / wait. */
export function coverQueueState(): { running: number; waiting: number } {
  return { running, waiting: waiting.length }
}
