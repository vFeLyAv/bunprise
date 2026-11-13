import type { ComponentType, ReactNode } from 'react'

// DEV ONLY. Loads the phone-shaped preview frame that the design agent provides in
// src/dev/PhoneFrame.tsx (so Felix sees the app at phone size in the browser).
// `import.meta.glob` instead of a plain import: the build and typecheck also pass while the
// file does not exist yet, and production never includes this module (main.tsx only imports
// it inside `if (import.meta.env.DEV)`, which Vite removes from the production bundle).

type PhoneFrameComponent = ComponentType<{ children: ReactNode }>
type PhoneFrameModule = { PhoneFrame?: PhoneFrameComponent; default?: PhoneFrameComponent }

const candidates = import.meta.glob<PhoneFrameModule>('../dev/PhoneFrame.tsx')

export async function loadPhoneFrame(): Promise<PhoneFrameComponent | null> {
  const load = candidates['../dev/PhoneFrame.tsx']
  if (!load) return null
  const mod = await load()
  return mod.PhoneFrame ?? mod.default ?? null
}
