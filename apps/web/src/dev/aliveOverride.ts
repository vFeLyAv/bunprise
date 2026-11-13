// Dev server / demo only (src/main.tsx imports it behind `import.meta.env.DEV || VITE_DEMO`, a production build
// never contains it): the quick check of «Живые анимации» (features/mascot-ui/alive.ts). The URL parameter is read
// once at boot — the router and the sign-in flow drop it later — and kept for this tab (sessionStorage):
//   ?alive=fast   the first moment after 3 s, then every 9–14 s (instead of 12 s / 30–60 s); calm ones after 5 s
//   ?alive=groom  only this one, as fast (groom, periscope, stretch, loaf, sneeze, dig, hwash, post)
//   ?alive=auto   the app's own mix again

/** = features/mascot-ui/alive.ts ALIVE_DEV_KEY (not imported: that chunk would load at boot; alive.test.ts pins it) */
export const ALIVE_DEV_KEY = 'bunprise.dev.alive'

export function captureAliveOverride(search: string = window.location.search): void {
  const value = new URLSearchParams(search).get('alive')
  if (value === null) return
  try {
    if (value === 'auto' || value === '') window.sessionStorage.removeItem(ALIVE_DEV_KEY)
    else window.sessionStorage.setItem(ALIVE_DEV_KEY, value)
  } catch {
    /* storage unavailable: the app's own mix */
  }
}
