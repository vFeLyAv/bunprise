import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { routeDiagnosticsPlugin } from './routeDiagnosticsPlugin.ts'
import { APP_ICON_VARIANTS, appIconLinks, variantManifest } from './src/features/account/appIconVariants.ts'

// Pure Vite SPA — no @cloudflare/vite-plugin, no SSR (docs/spec/framework-decision.md section 9.3).
// The Cloudflare Worker lives in workers/edge and serves ./dist as static assets.

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * The comic reader's chunk (features/comic/ComicBody.tsx, the lazy entry that brings @bunprise/mascot/comic) gets an
 * explicit name, `comic-*.js` like the comic's translations, so the service worker leaves it out by name (workbox
 * globIgnores; an import() alone would name it after its file). Only the name: what is in the chunk stays Rolldown's.
 */
const COMIC_ENTRY = /[\\/]src[\\/]features[\\/]comic[\\/]ComicBody\.tsx$/

/**
 * Lazy chunks that the first screen of a first visit cannot do without. They get a
 * `<link rel="modulepreload">` in the built index.html, so the browser fetches them together with the
 * shell instead of one or two round trips later (perf audit 2026-10-20, docs/perf-report-2026-10-20.md).
 *   - The German boot translations: src/lib/i18n.ts loads `common` + `errors` before the first render
 *     (German is the default language; other languages load after boot as before). scripts/size.mjs
 *     counts the same two files (BOOT_LOCALES) and warns when the preload is missing.
 *   - The invite landing /i, the first screen of almost every pilot user (budget: visible < 2 s on
 *     4G): its route chunk and its translations. A first visit of another page pays ≈ 2.5 KB gz for it.
 * The build fails when one of them no longer has a chunk of its own (renamed, or now imported statically).
 */
const FIRST_SCREEN_PRELOADS = [
  'src/locales/de/common.json',
  'src/locales/de/errors.json',
  'src/routes/i.tsx?tsr-split=component',
  'src/locales/de/invite.json',
]

function preloadFirstScreenChunks(files: readonly string[]): Plugin {
  let base = '/'
  return {
    name: 'bunprise:preload-first-screen',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const chunks = Object.values(ctx.bundle ?? {}).flatMap((output) => (output.type === 'chunk' ? [output] : []))
        return files.map((file) => {
          const chunk = chunks.find((candidate) => candidate.facadeModuleId?.replace(/\\/g, '/').endsWith(`/${file}`))
          if (!chunk) {
            throw new Error(`preload-first-screen: "${file}" has no chunk of its own — update FIRST_SCREEN_PRELOADS in vite.config.ts`)
          }
          return { tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `${base}${chunk.fileName}` }, injectTo: 'head' as const }
        })
      },
    },
  }
}

/**
 * public/mockServiceWorker.js is the demo backend's worker (MSW, docs/demo-mode.md). The dev server needs it; a real
 * build (VITE_DEMO ≠ '1') never registers it, so it is not published either (release 24.10, docs/release-web.md).
 */
function dropDemoWorkerFromBuild(): Plugin {
  let outFile = ''
  let demo = false
  return {
    name: 'bunprise:drop-demo-worker',
    apply: 'build',
    configResolved(config) {
      outFile = resolve(config.root, config.build.outDir, 'mockServiceWorker.js')
      demo = config.env.VITE_DEMO === '1'
    },
    closeBundle() {
      if (!demo) rmSync(outFile, { force: true })
    },
  }
}

/**
 * The home-screen icons to choose from (Felix 27.10, Einstellungen → App-Symbol, src/features/account/appIconVariants.ts):
 * one web manifest per variant next to its icons (public/icons/variants/<id>/, scripts/app-icons.mjs). Each is the
 * default manifest exactly as vite-plugin-pwa wrote it with only the icons swapped — the same id / start_url / scope,
 * so an installed app stays the same app. Runs after vite-plugin-pwa (both 'post'; this one is listed after it) and
 * fails the build when the default manifest is missing. Not precached (workbox globIgnores 'icons/variants/**').
 */
function appIconManifests(): Plugin {
  return {
    name: 'bunprise:app-icon-manifests',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const asset = bundle['manifest.webmanifest']
        if (asset?.type !== 'asset') throw new Error('app-icon-manifests: manifest.webmanifest was not generated (vite-plugin-pwa)')
        const base = JSON.parse(String(asset.source)) as Record<string, unknown>
        for (const id of APP_ICON_VARIANTS) {
          this.emitFile({ type: 'asset', fileName: appIconLinks(id).manifest.slice(1), source: JSON.stringify(variantManifest(base, id)) })
        }
      },
    },
  }
}

export default defineConfig({
  // Local review/CI can explicitly use only fixture process variables, without loading any .env files.
  ...(process.env.BUNPRISE_ISOLATED_CHECK === '1' ? { envDir: false as const } : {}),
  define: {
    // exposed as APP_VERSION in src/lib/app.ts (cache buster for the persisted query cache)
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    routeDiagnosticsPlugin(),
    // strictly BEFORE react(): the router plugin rewrites route files (code splitting) first
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    preloadFirstScreenChunks(FIRST_SCREEN_PRELOADS),
    dropDemoWorkerFromBuild(),
    VitePWA({
      // prompt mode (pilot-decisions §7, performance-plan 2.4): a new version never reloads the page
      // by itself; src/lib/pwa.ts registers the worker (src/main.tsx loads it once the first screen
      // is painted and the browser is idle) and shows the "update" toast.
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        // keep name/short_name in sync with APP_NAME in src/lib/app.ts and index.html
        id: '/',
        name: 'Bunprise',
        short_name: 'Bunprise',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'de',
        dir: 'ltr',
        background_color: '#F4F1EC',
        // = --theme-color in src/styles/tokens.css and index.html (top of the paper page)
        theme_color: '#F5EEE2',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // the Worker (/api/*) and the OAuth return must reach the network untouched
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\/callback/],
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest,png}'],
        // the MSW worker is only for `npm run dev:demo`; og.png (55 KB) only serves link previews; the home-screen icon
        // variants (≈ 1.1 MB, each with its manifest) are fetched only by the device that chose one (scripts/check-sw.mjs)
        // push-sw.js is not a page asset: the service worker imports it itself (importScripts below)
        // the comic «Pompon & Tapsi» (its reader + episodes chunk and its `comic` translations, all named comic-*) is
        // fetched only when someone opens it: 0 bytes of it in the precache (COMIC_ENTRY above, scripts/check-sw.mjs)
        globIgnores: ['**/mockServiceWorker.js', 'og.png', 'email/**', 'icons/variants/**', 'push-sw.js', 'assets/comic-*'],
        maximumFileSizeToCacheInBytes: 1_000_000,
        cleanupOutdatedCaches: true,
        // intentionally empty: the service worker never caches Supabase responses (brief 7.5a)
        runtimeCaching: [],
        // Web Push (docs/spec/web-push-design.md §8): public/push-sw.js adds the push / notificationclick / sign-out
        // listeners and nothing else (scripts/sw-rules.mjs checks both files after every build). Inert while this
        // browser has no subscription (VITE_PUSH off = nobody subscribes).
        importScripts: ['/push-sw.js'],
      },
      devOptions: { enabled: false },
    }),
    appIconManifests(),
  ],
  build: {
    target: 'es2022',
    manifest: true, // dist/.vite/manifest.json feeds scripts/size.mjs (framework-decision 9.7)
    sourcemap: false,
    rolldownOptions: {
      // The UI kit is imported through its barrel (ui/index.ts, which re-exports every component). A component
      // module that imports a stylesheet counts as having side effects, so the barrel dragged the FORM CONTROLS into
      // every chunk that uses it — the Start screen /soon shipped OtpField, Checkbox, Switch, Chip, Field … that it
      // never renders (2026-10-22: /soon 200.7 → 198.8 KB gz, '/' 181.2 → 179.3). These files do nothing at import
      // time except importing CSS (kit.css also comes with the barrel itself; otp.css is used by OtpField only), so
      // an UNUSED one may be dropped. Deliberately only these: marking the whole kit re-splits the chunks and the
      // extra import glue grows the shell (/i +0.4 KB gz, measured).
      treeshake: {
        moduleSideEffects: [{ test: /[\\/]src[\\/]ui[\\/](?:OtpField|Checkbox|Switch|Chip|Field|TextField|TextArea|PriceField)\.tsx$/, sideEffects: false }],
      },
      output: {
        // Everything the entry imports statically is downloaded at boot anyway. Without this group
        // Rolldown splits those modules into ~15 small "common" chunks (router, i18n, app, …) because
        // lazy route chunks share them; every extra file compresses worse and adds import glue —
        // measured +5 KB gz on the invite landing /i (hard limit 150 KB). One shell chunk instead.
        // Lazy chunks (routes, Supabase client, mascots, motion features) are not affected.
        codeSplitting: { groups: [{ name: 'shell', tags: ['$initial'] }] },
        // Vite's default name for every chunk, except the comic reader's: `comic-*` (COMIC_ENTRY above)
        chunkFileNames: (chunk) => (chunk.facadeModuleId && COMIC_ENTRY.test(chunk.facadeModuleId) ? 'assets/comic-[hash].js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: {
    // wrangler dev (workers/edge) when /api/* is needed; not required for the pilot
    proxy: { '/api': 'http://localhost:8787' },
  },
})
