import { afterEach, describe, expect, it, vi } from 'vitest'
import mainSource from '../main.tsx?raw'
import rootSource from '../routes/__root.tsx?raw'
import layoutSource from '../features/nav/AppLayout.tsx?raw'
import startSource from '../routes/index.tsx?raw'
import loginSource from '../routes/login.tsx?raw'
import codeSource from '../routes/login_.code.tsx?raw'
import callbackSource from '../routes/auth.callback.tsx?raw'
import legalSource from '../features/legal/LegalPage.tsx?raw'
import joinSource from '../features/invite/JoinGate.tsx?raw'
import toastSource from '../ui/ToastHost.tsx?raw'
import errorSource from '../features/shell/ErrorPage.tsx?raw'

// The motion feature bundle and the per-screen-group <MotionScope> (docs/decisions/2026-10-20-motion-scope.md):
// the shell has no LazyMotion (the invite landing /i stays inside its budget); a scope that mounts after the
// bundle arrived gets it synchronously (no frame without features on the next screen); a visitor without a
// session gets it only after the first paint.

afterEach(() => {
  vi.resetModules()
})

async function fresh() {
  vi.resetModules()
  return import('./features')
}

describe('motion features', () => {
  it('waits for the boot gate, loads once, then hands the bundle over synchronously', async () => {
    const features = await fresh()
    let open: () => void = () => {}
    features.deferMotionFeatures(new Promise<void>((resolve) => (open = resolve)))
    // before: a scope gets the loader
    expect(typeof features.motionFeatures()).toBe('function')
    const first = features.loadMotionFeatures()
    expect(features.loadMotionFeatures()).toBe(first)
    let done = false
    void first.then(() => (done = true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(done).toBe(false) // the gate (first paint) is still closed
    open()
    const bundle = await first
    expect(bundle).toBeTruthy()
    // after: the bundle object itself (LazyMotion loads it during render: animated from the first frame)
    expect(features.motionFeatures()).toBe(bundle)
  })

  it('the shell (main.tsx, the root route) mounts no LazyMotion; every animated screen group has its own scope', () => {
    const shell: Array<[string, string]> = [['main.tsx', mainSource], ['routes/__root.tsx', rootSource]]
    for (const [name, code] of shell) {
      const imports = code.split('\n').filter((line: string) => line.startsWith('import '))
      expect(imports.filter((line: string) => /LazyMotion|MotionScope/.test(line)), name).toEqual([])
      expect(code, name).not.toMatch(/<(LazyMotion|MotionScope)\b/)
    }
    const scoped: Array<[string, string]> = [
      ['features/nav/AppLayout.tsx (every signed-in screen)', layoutSource],
      ['routes/index.tsx', startSource],
      ['routes/login.tsx', loginSource],
      ['routes/login_.code.tsx', codeSource],
      ['routes/auth.callback.tsx', callbackSource],
      ['features/legal/LegalPage.tsx', legalSource],
      ['features/invite/JoinGate.tsx', joinSource],
      ['ui/ToastHost.tsx', toastSource],
      ['features/shell/ErrorPage.tsx', errorSource],
    ]
    for (const [name, code] of scoped) expect(code, name).toMatch(/<MotionScope>/)
  })
})
