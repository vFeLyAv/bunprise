/**
 * `<DevFrame>` — wrap the app with it in main.tsx. In production builds it is
 * a pass-through and the PhoneFrame code is not even emitted (the dynamic
 * import sits behind `import.meta.env.DEV`, which Vite folds to a constant).
 */
import { lazy, Suspense, type ReactNode } from 'react';

const PhoneFrameLazy = import.meta.env.DEV
  ? lazy(() => import('./PhoneFrame').then((mod) => ({ default: mod.PhoneFrame })))
  : null;

export function DevFrame({ children }: { children: ReactNode }) {
  if (!PhoneFrameLazy) return children;
  return (
    <Suspense fallback={null}>
      <PhoneFrameLazy>{children}</PhoneFrameLazy>
    </Suspense>
  );
}
