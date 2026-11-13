import type { ReactNode } from 'react'
import { LazyMotion } from 'motion/react'
import { motionFeatures } from './features'

/**
 * The <LazyMotion> of one group of screens (docs/decisions/2026-10-20-motion-scope.md): every `m.*` element
 * below it animates; the shell itself has none (the invite landing /i animates nothing — budget).
 * Mounted by: the signed-in layout (features/nav/AppLayout), the public screens that animate (start,
 * sign-in, code, OAuth callback, legal pages), the invite's join step, the toast viewport and the error view.
 * `strict`: a `motion.*` element (the full bundle) throws — always `m.*`.
 */
export function MotionScope({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={motionFeatures()} strict>
      {children}
    </LazyMotion>
  )
}
