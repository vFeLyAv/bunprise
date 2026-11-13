import { springs } from '../../motion/springs'

// The finish of a finger gesture (edge swipe-back, swipe between the tabs): the smooth spring of springs.ts
// integrated per frame, starting with the finger's speed (semi-implicit Euler in 4 ms sub-steps); under reduced
// motion a short ease-out slide instead. A few lines of our own instead of motion's animate(): no extra chunk
// for the shared entry to list (invite budget). Returns the stop function (a new touch catches the screen).
// `clamp` (the swipe between the tabs): the page stops exactly at its place instead of swinging a few px past it —
// a fast flick released near the end would otherwise overshoot by up to ~20 px and show the empty edge behind it.

export function settleTo(from: number, to: number, velocity: number, reduced: boolean, onUpdate: (x: number) => void, onDone: () => void, clamp = false): () => void {
  const { stiffness, damping, mass } = springs.smooth
  let x = from
  let v = velocity
  let last = performance.now()
  const start = last
  const side = Math.sign(to - from)
  let frame = 0
  const step = (now: number) => {
    if (reduced) {
      const t = Math.min(1, (now - start) / 200)
      x = from + (to - from) * (1 - (1 - t) ** 3)
      onUpdate(x)
      if (t >= 1) return onDone()
    } else {
      const dt = Math.min(0.064, Math.max(0, (now - last) / 1000))
      const steps = Math.max(1, Math.ceil(dt / 0.004))
      for (let i = 0; i < steps; i += 1) {
        v += ((-stiffness * (x - to) - damping * v) / mass) * (dt / steps)
        x += v * (dt / steps)
      }
      const passed = clamp && side !== 0 && (x - to) * side >= 0
      if (passed || (Math.abs(v) < 10 && Math.abs(x - to) < 0.5)) {
        onUpdate(to)
        return onDone()
      }
      onUpdate(x)
    }
    last = now
    frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)
  return () => cancelAnimationFrame(frame)
}
