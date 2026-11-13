// Rules for the BUILT service worker (dist/sw.js), used by scripts/check-sw.mjs and its unit tests
// (src/test/swCheck.test.ts, src/test/attack/round1-sw-headers.test.tsx). Pure functions, no Node
// APIs: the input is the text of sw.js.
//
// CLAUDE.md "PWA cache": the service worker never caches Supabase REST/auth responses, never queues
// requests for later, and the navigation fallback (index.html for offline page loads) never answers
// the OAuth return /auth/callback or the Worker's /api/*. Workbox (generateSW) writes a fixed shape:
//   if(!self.define){…AMD loader…}define(["./workbox-…"],function(s){"use strict";
//     self.addEventListener("message",…SKIP_WAITING…), s.precacheAndRoute([{url:"…",revision:…},…],{}),
//     s.cleanupOutdatedCaches(),
//     s.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("/index.html"),{denylist:[/^\/api\//,…]})),
//     s.registerRoute(/regex/ | "path", new s.CacheFirst({…}), "GET")   ← runtime caching (none in the pilot)
//   })
// FAIL CLOSED (adversarial round 1, M4): only these reviewed statements are accepted; a runtime route needs
// a matcher this check can read (a regex literal or a same-origin path), for GET only, that matches
// nothing Supabase-like and no other origin; nothing in sw.js may queue, answer or cache requests by
// itself (background sync, a default handler, a fetch listener, Cache Storage); precached URLs are build
// files of this origin. A deliberate change of the PWA setup that trips a rule is reviewed here first.
// Round 2 — also INSIDE the accepted statements: precacheAndRoute takes only literal entries
// ({url, revision}) outside /api/ and /auth/callback and only the options generateSW writes (never
// urlManipulation); cleanupOutdatedCaches()/clientsClaim() take no arguments; a runtime regex may not be
// anchored at the start of the URL; the samples use real 20-character Supabase project refs.

/** Supabase project refs of the samples: real ones have 20 characters (a 16-character one stays as well). */
const SAMPLE_PROJECT_REFS = ['abcdefghijklmnopqrst', 'abcdefghijklmnop']

function projectUrls(paths) {
  return SAMPLE_PROJECT_REFS.flatMap((ref) => paths.map((path) => `https://${ref}.supabase.co${path}`))
}

/** URLs no runtime route may match (cloud project, custom/local hosts, REST, RPC and auth paths). */
export const FORBIDDEN_SAMPLE_URLS = [
  ...projectUrls(['/rest/v1/wishes?select=id', '/rest/v1/rpc/get_occasion_screen', '/auth/v1/token?grant_type=refresh_token', '/auth/v1/user']),
  'http://localhost:54321/rest/v1/occasions',
  'https://db.example.test/auth/v1/logout',
]

/**
 * Absolute URLs of other origins. Workbox serves a cross-origin request through a regex route only when
 * the match starts at the first character of the URL (RegExpRoute), so no runtime regex may do that here.
 */
const CROSS_ORIGIN_SAMPLE_URLS = [
  ...FORBIDDEN_SAMPLE_URLS,
  ...projectUrls(['/storage/v1/object/public/wishes/photo.png', '/functions/v1/link-preview', '/graphql/v1']),
  'https://cdn.example.test/assets/image.png',
]

/** Paths the navigation fallback must leave to the network. */
export const DENYLIST_SAMPLES = {
  '/auth/callback': ['/auth/callback', '/auth/callback?code=fixture'],
  '/api/': ['/api/health', '/api/link-preview?url=x'],
}

/**
 * Scripts sw.js may load with importScripts (vite.config.ts workbox.importScripts): ONLY our Web Push listeners
 * (public/push-sw.js, docs/spec/web-push-design.md §8), themselves checked by analyzePushWorker below.
 */
export const IMPORTED_SCRIPTS = ['/push-sw.js']

/** The calls Workbox's generateSW writes as statements of the define body (`s.<name>(…)`). */
const WORKBOX_STATEMENTS = new Set(['precacheAndRoute', 'cleanupOutdatedCaches', 'registerRoute', 'clientsClaim', 'setCacheNameDetails'])

/** Statements generateSW writes without arguments (any argument would be code the check does not read). */
const NO_ARGUMENT_STATEMENTS = new Set(['cleanupOutdatedCaches', 'clientsClaim'])

/** setCacheNameDetails({prefix:"…"}) (generateSW `cacheId`): cache names only, plain strings. */
const CACHE_NAME_KEYS = new Set(['prefix', 'suffix', 'precache', 'runtime', 'googleAnalytics'])

/** Keys of one precache entry as generateSW writes it: `{url:"…",revision:"…"|null}` (integrity optional). */
const PRECACHE_ENTRY_KEYS = new Set(['url', 'revision', 'integrity'])

/**
 * precacheAndRoute options this check can verify: what generateSW writes (workbox-build
 * populate-sw-template: directoryIndex, ignoreURLParametersMatching) plus cleanURLs. Never
 * urlManipulation (round 2): Workbox's precache route sees a request BEFORE the navigation route, so such
 * a mapping could answer /auth/callback?code=… or /api/* from the cache although the denylist names them.
 */
const PRECACHE_OPTION_KEYS = new Set(['directoryIndex', 'ignoreURLParametersMatching', 'cleanURLs'])

/** Paths the service worker must leave to the network (the denylist of the navigation fallback). */
const NETWORK_ONLY_PATH = /^\/(?:api\/|auth\/callback)/

/** Code that would send, queue, answer or cache requests outside the checked routes — anywhere in sw.js. */
const FORBIDDEN_CODE = [
  [/BackgroundSync|\bQueue\s*\(/, 'a background-sync queue (requests replayed later; reserve/cancel are online-only, never queued)'],
  [/\bsetDefaultHandler\s*\(/, 'a default handler (every request no route matches — Supabase included — would go through a strategy)'],
  [/addEventListener\s*\(\s*(["'`])fetch\1|\bonfetch\b/, 'its own fetch handler (it would answer requests outside the checked routes)'],
  [/\bcaches\s*\./, 'direct Cache Storage access (caches.…)'],
]

/** A URL with a scheme or a protocol-relative one: another origin as far as this check knows. */
const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i

const REGEX_MAY_FOLLOW = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])

function skipString(source, start) {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') i += 2
    else if (ch === quote) return i + 1
    else i += 1
  }
  throw new Error('sw.js: unterminated string')
}

function skipRegex(source, start) {
  let i = start + 1
  let inClass = false
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') i += 2
    else if (inClass) {
      if (ch === ']') inClass = false
      i += 1
    } else if (ch === '[') {
      inClass = true
      i += 1
    } else if (ch === '/') {
      i += 1
      while (i < source.length && /[a-z]/i.test(source[i])) i += 1
      return i
    } else if (ch === '\n') {
      throw new Error('sw.js: unterminated regular expression')
    } else i += 1
  }
  throw new Error('sw.js: unterminated regular expression')
}

/**
 * Walks `source` from `start` and calls `onToken(kind, from, to)` for every string ('string'), regex
 * literal ('regex') and any other single character (kind = the character; comments are skipped);
 * stops as soon as `onToken` returns true. A small tokenizer is enough for Workbox's minified output.
 */
function walk(source, start, onToken) {
  let i = start
  let previous = ''
  while (i < source.length) {
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(source, i)
      if (onToken('string', i, end)) return end
      previous = 'x'
      i = end
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === '/' && REGEX_MAY_FOLLOW.has(previous)) {
      const end = skipRegex(source, i)
      if (onToken('regex', i, end)) return end
      previous = 'x'
      i = end
      continue
    }
    if (onToken(ch, i, i + 1)) return i + 1
    if (!/\s/.test(ch)) previous = /[\w$)\]]/.test(ch) ? 'x' : ch
    i += 1
  }
  return i
}

/** Text between the bracket at `open` and its partner (exclusive). */
function bracketed(source, open) {
  const closing = { '(': ')', '[': ']', '{': '}' }[source[open]]
  if (!closing) throw new Error(`sw.js: expected a bracket at ${open}`)
  let depth = 0
  let close = -1
  walk(source, open, (kind, from) => {
    if (kind === '(' || kind === '[' || kind === '{') depth += 1
    else if (kind === ')' || kind === ']' || kind === '}') {
      depth -= 1
      if (depth === 0) {
        close = from
        return true
      }
    }
    return false
  })
  if (close === -1) throw new Error('sw.js: unbalanced brackets')
  return source.slice(open + 1, close)
}

/** Top-level parts of `text`, split at any of `separators` (brackets, strings and regexes respected). */
function splitTopLevel(text, separators) {
  const parts = []
  let depth = 0
  let from = 0
  walk(text, 0, (kind, at) => {
    if (kind === '(' || kind === '[' || kind === '{') depth += 1
    else if (kind === ')' || kind === ']' || kind === '}') depth -= 1
    else if (depth === 0 && separators.includes(kind)) {
      parts.push(text.slice(from, at).trim())
      from = at + 1
    }
    return false
  })
  parts.push(text.slice(from).trim())
  return parts.filter((part) => part !== '')
}

/** Top-level, comma-separated parts of an argument list. */
function splitArguments(text) {
  return splitTopLevel(text, [','])
}

/** Every regex literal in `text` as a RegExp (an invalid one is reported, not swallowed). */
function regexLiterals(text) {
  const found = []
  walk(text, 0, (kind, from, to) => {
    if (kind !== 'regex') return false
    const literal = text.slice(from, to)
    const last = literal.lastIndexOf('/')
    found.push(new RegExp(literal.slice(1, last), literal.slice(last + 1)))
    return false
  })
  return found
}

/** The contents of every string literal in `text`. */
function stringLiterals(text) {
  const found = []
  walk(text, 0, (kind, from, to) => {
    if (kind === 'string') found.push(text.slice(from + 1, to - 1))
    return false
  })
  return found
}

/** 'regex' or 'string' when `text` is exactly one regex literal / quoted string, else 'other'. */
function literalKind(text) {
  let kind = 'other'
  try {
    walk(text, 0, (token, from, to) => {
      const quoted = token === 'string' && text[0] !== '`' // a template literal may compute its value
      if (from === 0 && to === text.length && (token === 'regex' || quoted)) kind = token
      return true // the first token decides
    })
  } catch {
    return 'other'
  }
  return kind
}

/** The same pattern without the global flag, so every test/exec starts at 0 (as before: sticky stays). */
function withoutGlobal(regex) {
  return new RegExp(regex.source, regex.flags.replace('g', ''))
}

/**
 * True when the pattern holds a start anchor (`^` outside a character class) or a lookbehind. Only a
 * route for another origin needs to match at the first character of the URL (Workbox's RegExpRoute
 * serves a cross-origin request only then); a same-origin route matches its path. The samples cannot
 * list every host such a pattern may name (round 2: /^\w+:\W\W\w{20}\.\w+\.co\// matched none of them).
 */
function anchoredAtStart(regex) {
  const source = regex.source
  let inClass = false
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '\\') i += 1
    else if (inClass) inClass = ch !== ']'
    else if (ch === '[') inClass = true
    else if (ch === '^' || source.startsWith('(?<=', i) || source.startsWith('(?<!', i)) return true
  }
  return false
}

/** The value of a plain quoted string (no escape sequence, no template literal), else null. */
function plainString(text) {
  if (literalKind(text) !== 'string') return null
  const value = text.slice(1, -1)
  return value.includes('\\') ? null : value
}

/** The text between `text`'s outer brackets when `text` is exactly one bracketed literal, else null. */
function literalBody(text, open) {
  if (!text.startsWith(open)) return null
  try {
    const inner = bracketed(text, 0)
    return inner.length + 2 === text.length ? inner : null
  } catch {
    return null
  }
}

/** The elements of an array literal `[…]`, or null when `text` is not one. */
function arrayLiteral(text) {
  const inner = literalBody(text, '[')
  return inner === null ? null : splitArguments(inner)
}

/**
 * The properties of an object literal `{key:value,…}` as [name, value text] pairs, or null when `text`
 * is anything else or holds a property this check cannot read (spread, computed key, method, shorthand).
 */
function objectLiteral(text) {
  const inner = literalBody(text, '{')
  if (inner === null) return null
  const properties = []
  for (const part of splitArguments(inner)) {
    const pieces = splitTopLevel(part, [':'])
    const name = pieces.length === 2 ? /^(?:([A-Za-z_$][\w$]*)|"([\w$]+)"|'([\w$]+)')$/.exec(pieces[0]) : null
    if (!name) return null
    properties.push([name[1] ?? name[2] ?? name[3], pieces[1]])
  }
  return properties
}

/** A literal object whose keys are all in `allowed` and whose values all pass `valueOk(key, value)`. */
function literalObjectOk(text, allowed, valueOk) {
  const properties = objectLiteral(text)
  if (properties === null) return false
  const keys = properties.map(([key]) => key)
  return new Set(keys).size === keys.length && properties.every(([key, value]) => allowed.has(key) && valueOk(key, value))
}

function precacheEntryOk(entry) {
  const properties = objectLiteral(entry)
  return properties !== null && properties.some(([key]) => key === 'url') &&
    literalObjectOk(entry, PRECACHE_ENTRY_KEYS, (key, value) => plainString(value) !== null || (key === 'revision' && value === 'null'))
}

function precacheOptionOk(key, value) {
  if (key === 'directoryIndex') return /^[\w-]+(?:\.[\w-]+)*$/.test(plainString(value) ?? '')
  if (key === 'cleanURLs') return /^(?:true|false|!0|!1)$/.test(value)
  const patterns = arrayLiteral(value) // ignoreURLParametersMatching: regex literals only
  if (patterns === null || !patterns.every((pattern) => literalKind(pattern) === 'regex')) return false
  try {
    regexLiterals(value)
    return true
  } catch {
    return false
  }
}

/** Problems of one precacheAndRoute(entries, options) call: only literal, reviewed shapes (fail closed). */
function precacheProblems(args) {
  const parts = splitArguments(args)
  if (parts.length < 1 || parts.length > 2) {
    return [`precacheAndRoute(…) with ${parts.length} arguments (the reviewed setup passes its entries and its options)`]
  }
  const problems = []
  const [entries, options] = parts
  const items = arrayLiteral(entries)
  if (items === null) problems.push(`precache entries this check cannot read (expected [{url:"…",revision:…},…]): ${short(entries)}`)
  for (const item of items ?? []) {
    if (!precacheEntryOk(item)) {
      problems.push(`precache entry this check cannot verify (only {url:"…",revision:"…"|null}): ${short(item)}`)
      continue
    }
    const url = plainString(objectLiteral(item)?.find(([key]) => key === 'url')?.[1] ?? '') ?? ''
    // absolute URLs are reported below (another origin); a relative one must stay out of the network-only paths
    if (!ABSOLUTE_URL.test(url) && NETWORK_ONLY_PATH.test(new URL(url, 'https://sw.invalid/').pathname)) {
      problems.push(`precached URL inside /api/ or /auth/callback (it would be answered from the cache, not the network): ${short(url)}`)
    }
  }
  if (options !== undefined) {
    const properties = objectLiteral(options)
    if (properties === null) problems.push(`precacheAndRoute options this check cannot read: ${short(options)}`)
    for (const [key, value] of properties ?? []) {
      if (!PRECACHE_OPTION_KEYS.has(key)) {
        problems.push(`precacheAndRoute option "${key}" is not reviewed (the precache route answers before the navigation fallback and its denylist): ${short(options)}`)
      } else if (!precacheOptionOk(key, value)) {
        problems.push(`precacheAndRoute option "${key}" with a value this check cannot verify: ${short(value)}`)
      }
    }
  }
  return problems
}

function short(text) {
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

function message(err) {
  return err instanceof Error ? err.message : String(err)
}

/** The argument lists of every `name(` call. */
function callArguments(source, name) {
  const calls = []
  const pattern = new RegExp(`\\b${name}\\s*\\(`, 'g')
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const open = match.index + match[0].length - 1
    calls.push(bracketed(source, open))
  }
  return calls
}

/** The argument lists of every `registerRoute(` call. */
export function registerRouteCalls(source) {
  return callArguments(source, 'registerRoute')
}

const DEFINE_HEAD = /\bdefine\s*\(\s*\[[^\]]*\]\s*,\s*function\s*\(\s*[\w$]*\s*\)\s*\{/

/** Workbox's AMD loader prelude: `if(!self.define){…}` and nothing else. */
function isAmdLoader(text) {
  const head = /^if\s*\(\s*!\s*self\.define\s*\)\s*\{/.exec(text)
  if (!head) return false
  const open = head[0].length - 1
  return open + bracketed(text, open).length + 2 === text.length
}

/** The statements of Workbox's `define([…], function (workbox) { … })` body — the whole generated worker. */
function workerStatements(source) {
  const head = DEFINE_HEAD.exec(source)
  if (!head) throw new Error('no Workbox define([…], function(…){…}) block')
  const open = head.index + head[0].length - 1
  const body = bracketed(source, open)
  const after = source.slice(open + body.length + 2)
  if (!/^\s*\)\s*;?\s*(?:\/\/[^\n]*\s*)*$/.test(after)) throw new Error('code after the Workbox define(…) block')
  const before = source.slice(0, head.index).trim()
  if (before !== '' && !isAmdLoader(before)) throw new Error('code before the Workbox define(…) block')
  return splitTopLevel(body, [',', ';'])
}

/** `callee(…)` with nothing after it: the callee path and the argument text, else null. */
function callOf(statement) {
  const head = /^([\w$]+(?:\.[\w$]+)*)\s*\(/.exec(statement)
  if (!head) return null
  const open = head[0].length - 1
  const args = bracketed(statement, open)
  return open + args.length + 2 === statement.length ? { callee: head[1], args } : null
}

/** null for one of the reviewed Workbox statements, else the problem. */
function statementProblem(statement) {
  if (/^(["'])use strict\1$/.test(statement)) return null
  const call = callOf(statement)
  if (call) {
    if (call.callee === 'self.skipWaiting' && call.args.trim() === '') return null
    // Web Push: exactly the reviewed listener file(s), as one literal path each
    // (any other importScripts falls through to "unexpected statement" below)
    if (call.callee === 'importScripts') {
      const paths = splitArguments(call.args)
      if (paths.length > 0 && paths.every((arg) => IMPORTED_SCRIPTS.includes(plainString(arg) ?? ''))) return null
    }
    // prompt mode: the update toast asks the waiting worker to take over (lib/pwa.ts)
    if (call.callee === 'self.addEventListener' && /^\s*(["'])message\1\s*,/.test(call.args)) return null
    const path = call.callee.split('.')
    if (path.length === 2 && WORKBOX_STATEMENTS.has(path[1])) {
      const name = path[1]
      if (NO_ARGUMENT_STATEMENTS.has(name) && call.args.trim() !== '') {
        return `${name}(…) with arguments (the reviewed setup calls it without any): ${short(statement)}`
      }
      if (name === 'setCacheNameDetails' && !literalObjectOk(call.args.trim(), CACHE_NAME_KEYS, (_key, value) => plainString(value) !== null)) {
        return `setCacheNameDetails(…) with options this check cannot verify (only plain cache-name strings): ${short(statement)}`
      }
      return null // precacheAndRoute and registerRoute: their arguments are checked below
    }
  }
  return `unexpected statement in sw.js (not part of the reviewed Workbox setup; review scripts/sw-rules.mjs first): ${short(statement)}`
}

const NAVIGATION_ROUTE = /^new\s+[\w$.]*NavigationRoute\s*\(/

/**
 * Checks the text of a built sw.js. Returns the problems found (empty = fine) and what was read,
 * so the CLI can print a short summary.
 */
export function analyzeServiceWorker(source) {
  const problems = []
  let calls
  let precacheCalls
  try {
    calls = registerRouteCalls(source)
    precacheCalls = callArguments(source, 'precacheAndRoute')
  } catch (err) {
    return { problems: [`could not read the routes of sw.js: ${message(err)}`], runtimeRoutes: 0, denylist: [] }
  }

  // 1. only the reviewed Workbox statements (fail closed)
  try {
    for (const statement of workerStatements(source)) {
      const problem = statementProblem(statement)
      if (problem) problems.push(problem)
    }
  } catch (err) {
    problems.push(`could not read the statements of sw.js: ${message(err)}`)
  }

  // 2. nothing that queues, answers or caches requests by itself — anywhere in the file
  for (const [pattern, what] of FORBIDDEN_CODE) {
    if (pattern.test(source)) problems.push(`sw.js contains ${what}`)
  }

  // 3. the precache holds build files of this origin only — literal entries outside the network-only
  //    paths, and only the options generateSW writes (round 2: never urlManipulation)
  for (const args of precacheCalls) {
    const [entries = ''] = splitArguments(args)
    for (const value of stringLiterals(entries)) {
      if (ABSOLUTE_URL.test(value)) problems.push(`precached URL of another origin: ${short(value)}`)
    }
    try {
      problems.push(...precacheProblems(args))
    } catch (err) {
      problems.push(`could not read precacheAndRoute(…): ${message(err)}`)
    }
  }

  const navigation = []
  const runtime = []
  for (const args of calls) {
    const [first = ''] = splitArguments(args)
    if (NAVIGATION_ROUTE.test(first)) navigation.push(first)
    else runtime.push(args)
  }

  // 4. runtime routes
  for (const args of runtime) {
    const [matcher = '', , method] = splitArguments(args)
    const plain = matcher.replace(/\\\//g, '/')
    const shown = short(matcher)
    if (/supabase|\/rest\/|\/auth\//i.test(plain)) problems.push(`runtime route mentions Supabase REST/auth: ${shown}`)
    let regexes = []
    try {
      regexes = regexLiterals(matcher)
    } catch (err) {
      problems.push(`runtime route with an unreadable pattern: ${shown} (${message(err)})`)
    }
    for (const regex of regexes) {
      const hit = FORBIDDEN_SAMPLE_URLS.find((url) => withoutGlobal(regex).test(url))
      if (hit) problems.push(`runtime route ${regex} would cache ${hit}`)
    }
    // fail closed: only a matcher this check can read — a regex literal or a same-origin path
    const kind = literalKind(matcher)
    if (kind === 'regex') {
      for (const regex of regexes) {
        const other = CROSS_ORIGIN_SAMPLE_URLS.find((url) => withoutGlobal(regex).exec(url)?.index === 0)
        if (other) problems.push(`runtime route ${regex} would serve another origin (it matches ${other} from its first character)`)
        if (anchoredAtStart(regex)) {
          problems.push(`runtime route ${regex} is anchored at the start of the URL (^ or a lookbehind): only a route for another origin needs that, a same-origin route matches its path`)
        }
      }
      if (/https?:|:\/\//i.test(plain)) problems.push(`runtime route pattern names an absolute URL (another origin): ${shown}`)
    } else if (kind === 'string') {
      if (ABSOLUTE_URL.test(matcher.slice(1, -1))) problems.push(`runtime route for an absolute URL (another origin): ${shown}`)
    } else {
      problems.push(`runtime route with a matcher this check cannot verify (a function, new RegExp(…), a Route object …; allowed: a regex literal or a same-origin path): ${shown}`)
    }
    if (method !== undefined && !/^(["'])GET\1$/.test(method)) {
      problems.push(`runtime route for ${short(method)} requests (the service worker handles GET only; it never sends, retries or queues anything else): ${shown}`)
    }
  }

  // 5. the navigation fallback leaves /auth/callback and /api/ to the network
  const denylist = []
  if (navigation.length !== 1) {
    problems.push(`expected exactly one navigation fallback route, found ${navigation.length} (update scripts/sw-rules.mjs if the PWA setup changed on purpose)`)
  } else {
    const route = navigation[0]
    const key = route.search(/\bdenylist\s*:\s*\[/)
    if (key === -1) {
      problems.push('the navigation fallback has no denylist: /auth/callback and /api/ would get index.html')
    } else {
      const open = route.indexOf('[', key)
      try {
        denylist.push(...regexLiterals(bracketed(route, open)))
      } catch (err) {
        problems.push(`unreadable navigation denylist (${message(err)})`)
      }
      for (const [path, samples] of Object.entries(DENYLIST_SAMPLES)) {
        const covered = samples.every((sample) => denylist.some((regex) => withoutGlobal(regex).test(sample)))
        if (!covered) problems.push(`the navigation fallback denylist does not exclude ${path}`)
      }
    }
  }

  return { problems, runtimeRoutes: runtime.length, denylist: denylist.map(String) }
}

/** The literal paths sw.js loads with importScripts("…") (the AMD loader's own importScripts(e) is no literal). */
export function importedScripts(source) {
  // the same reading as the statement check (any quote style plainString accepts — Codex code review #7); the AMD
  // loader's own importScripts(e) has no literal and is skipped
  try {
    return callArguments(source, 'importScripts').flatMap((args) =>
      splitArguments(args).map((arg) => plainString(arg)).filter((path) => path !== null))
  } catch {
    return []
  }
}

/** The source without comments (strings, regexes and code untouched), so a word in a comment never counts. */
function withoutComments(source) {
  let out = ''
  walk(source, 0, (_kind, from, to) => {
    out += source.slice(from, to)
    return false
  })
  return out
}

/** Events public/push-sw.js may listen to. */
const PUSH_WORKER_EVENTS = new Set(['push', 'notificationclick'])

/** What the push listeners must never do (they only show, focus/open and unsubscribe). */
const PUSH_WORKER_FORBIDDEN = [
  // any mention of fetch (also an alias such as `const f = self.fetch`), not only a call (Codex code review #7)
  [/\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b/, 'a network request (it only shows what the push brought)'],
  // indirection that would hide a capability from the word checks: a property named by a string, the global object,
  // reflection, a dynamic import, addEventListener passed around instead of called
  [/\[\s*["'`]|\bglobalThis\b|\bReflect\b|\bProxy\b|\bimport\s*\(|\baddEventListener\b(?!\s*\()/, 'indirect access this check cannot read (self["…"], globalThis, Reflect, import(), an aliased addEventListener)'],
  [/\bimportScripts\b/, 'importScripts (no further scripts)'],
  [/\bcaches\b/, 'Cache Storage'],
  [/\bindexedDB\b|\blocalStorage\b|\bsessionStorage\b/, 'storage'],
  [/\beval\s*\(|\bFunction\s*\(|\bset(?:Timeout|Interval)\s*\(\s*["'`]/, 'code built from strings'],
  [/\bon[a-z]+\s*=(?!=)/, 'an on<event> handler property (only addEventListener with a reviewed event)'],
  [/\bskipWaiting\b|\.claim\s*\(|\bregistration\s*\.\s*(?:update|unregister)\s*\(/, 'service worker lifecycle changes (Workbox and the update toast decide)'],
  [/\bnavigate\s*\(/, 'client.navigate (the app moves itself after a postMessage)'],
  [/BackgroundSync|\bsync\s*\.\s*register/, 'background sync'],
]

/**
 * Checks public/push-sw.js (dist/push-sw.js): only listeners for push and notificationclick, nothing that
 * sends, stores or caches anything, and the push listener exists. Returns the problems (empty = fine).
 */
export function analyzePushWorker(source) {
  const problems = []
  let code
  try {
    code = withoutComments(source)
  } catch (err) {
    return [`could not read push-sw.js: ${message(err)}`]
  }
  for (const [pattern, what] of PUSH_WORKER_FORBIDDEN) {
    if (pattern.test(code)) problems.push(`push-sw.js contains ${what}`)
  }
  const events = []
  try {
    for (const args of callArguments(code, 'addEventListener')) {
      const [event = ''] = splitArguments(args)
      const name = plainString(event)
      if (name === null) problems.push(`push-sw.js listens to an event this check cannot read: ${short(event)}`)
      else if (!PUSH_WORKER_EVENTS.has(name)) problems.push(`push-sw.js listens to "${name}" (allowed: ${[...PUSH_WORKER_EVENTS].join(', ')})`)
      else events.push(name)
    }
  } catch (err) {
    problems.push(`could not read the listeners of push-sw.js: ${message(err)}`)
  }
  if (!events.includes('push')) problems.push('push-sw.js has no push listener')
  return problems
}
