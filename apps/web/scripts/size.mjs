// Bundle budget check (framework-decision 9.7, performance-plan 1.3). Part of `npm run check`.
//
// Reads dist/.vite/manifest.json, walks the STATIC import graph from the entry (src/main.tsx)
// plus the chunks a route needs (its code-split component + loader + their static imports),
// sums gzip (level 9) of JS + CSS and compares with the budget per route:
//   '/' and '/soon' ≤ 200 KB gz target / 210 KB hard limit (Felix 31.10: «Поднять до 210 КБ» — /soon was at
//   199.995 after the night port; optimise when he notices slowness),  '/i' (invite landing) ≤ 140 KB gz target / 150 KB hard limit.
// Dynamic imports (motion features, mascots, other locales, other routes) are NOT counted;
// the German `common` + `errors` translations ARE (loaded before the first render; vite.config.ts
// FIRST_SCREEN_PRELOADS gives them a modulepreload — a missing one is reported below as a warning).
// Exit code 1 on any breach.
// Usage: node scripts/size.mjs [distDir] — default apps/web/dist (another dir: e.g. a scratch build).

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'dist')
const manifestPath = resolve(dist, '.vite', 'manifest.json')

if (!existsSync(manifestPath)) {
  console.error(`size: ${manifestPath} not found — run "npm run build" first`)
  process.exit(1)
}

/** @type {Record<string, { file: string, css?: string[], imports?: string[], isEntry?: boolean }>} */
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

const ENTRY = 'src/main.tsx'
const BOOT_LOCALES = ['src/locales/de/common.json', 'src/locales/de/errors.json']
// targetKb = the number from the spec (warns when exceeded); limitKb = hard gate (exit 1).
// The invite landing shares the whole shell (react-dom ≈ 60 KB gz, router ≈ 22, i18next ≈ 16,
// query ≈ 9, motion core ≈ 8, CSS ≈ 7) and measured 145 KB gz on 2026-10-19 with stub routes,
// so its spec target of 140 KB is a warning until Felix confirms the number (docs/contract.md,
// "Open items"); the hard limit is 150 KB. Levers if it turns red: framework-decision.md 9.7.
// Perf audit 2026-10-20 (docs/perf-report-2026-10-20.md): LazyMotion in main.tsx alone cost /i 10.2 KB gz
// (it imports motion-dom's VisualElement module); since wave 1 each animated screen group has its own
// <MotionScope> instead (docs/decisions/2026-10-20-motion-scope.md) and the shell has none.
const BUDGETS = [
  { route: '/', routeFiles: ['src/routes/index.tsx'], targetKb: 200, limitKb: 210 },
  { route: '/soon', routeFiles: ['src/routes/_authed.tsx', 'src/routes/_authed/soon.tsx'], targetKb: 200, limitKb: 210 },
  { route: '/i (invite landing)', routeFiles: ['src/routes/i.tsx'], targetKb: 140, limitKb: 150 },
]

/** manifest keys that belong to a source file, including the router plugin's split variants (`?tsr-split=…`) */
function keysFor(sourceFiles) {
  return Object.keys(manifest).filter((key) => sourceFiles.some((file) => key === file || key.startsWith(`${file}?`)))
}

/** all output files reachable through static imports from the given manifest keys */
function collect(startKeys) {
  const seen = new Set()
  const files = new Set()
  const walk = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = manifest[key]
    if (!chunk) return
    files.add(chunk.file)
    for (const css of chunk.css ?? []) files.add(css)
    for (const dep of chunk.imports ?? []) walk(dep)
  }
  startKeys.forEach(walk)
  return files
}

const gzipCache = new Map()
function gzipKb(file) {
  if (!gzipCache.has(file)) {
    gzipCache.set(file, gzipSync(readFileSync(resolve(dist, file)), { level: 9 }).length / 1024)
  }
  return gzipCache.get(file)
}

// Vite keys the HTML entry as "index.html" (its script is src/main.tsx); accept both.
const entryKey = Object.keys(manifest).find((key) => key === ENTRY || (manifest[key].isEntry && key === 'index.html'))
if (!entryKey) {
  console.error(`size: no entry for "${ENTRY}" / index.html in the manifest`)
  process.exit(1)
}
const entryKeys = [entryKey, ...keysFor(BOOT_LOCALES)]
const shellFiles = collect(entryKeys)

const rows = []
let failed = false
for (const budget of BUDGETS) {
  const routeKeys = keysFor(budget.routeFiles)
  const files = new Set([...shellFiles, ...collect(routeKeys)])
  const totalKb = [...files].reduce((sum, file) => sum + gzipKb(file), 0)
  const ok = totalKb <= budget.limitKb
  if (!ok) failed = true
  rows.push({
    route: budget.route,
    'route chunks': routeKeys.length,
    files: files.size,
    'gzip KB': Number(totalKb.toFixed(1)),
    'target KB': budget.targetKb,
    'limit KB': budget.limitKb,
    status: !ok ? 'OVER BUDGET' : totalKb > budget.targetKb ? 'WARN: over target' : 'OK',
  })
}

console.log('\nInitial bundle per route (gzip, JS + CSS, static imports only):')
console.table(rows)

console.log('Shell (src/main.tsx + static imports + boot translations):')
const shellRows = [...shellFiles]
  .map((file) => ({ file, 'gzip KB': Number(gzipKb(file).toFixed(1)) }))
  .sort((a, b) => b['gzip KB'] - a['gzip KB'])
console.table(shellRows)

// The boot translations are lazy chunks: without the modulepreload in index.html the browser asks for
// them only after the shell has run — one more round trip before the first screen (perf audit 2026-10-20).
const indexHtmlPath = resolve(dist, 'index.html')
if (existsSync(indexHtmlPath)) {
  const html = readFileSync(indexHtmlPath, 'utf8')
  for (const key of keysFor(BOOT_LOCALES)) {
    const file = manifest[key].file
    if (!new RegExp(`<link rel="modulepreload"[^>]*href="[^"]*${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html)) {
      console.warn(`size: WARN ${key} (${file}) has no <link rel="modulepreload"> in index.html — see vite.config.ts FIRST_SCREEN_PRELOADS`)
    }
  }
}

if (failed) {
  console.error('size: budget exceeded — see framework-decision.md 9.7 for the levers (lean Supabase client, lazy imports)')
  process.exit(1)
}
console.log('size: all routes within budget')
