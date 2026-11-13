/**
 * Real-PostgreSQL harness for the concurrency tests (test/concurrency,
 * docs/decisions/0002-concurrency-tests-real-postgres.md).
 *
 * PGlite (src/harness.ts) is ONE connection, so two transactions can never interleave there. This harness
 * starts a real PostgreSQL 17 (npm package embedded-postgres; hosted Supabase runs 17.11) per test file:
 *   - data dir in a fresh folder under the OS temp dir, a random free port on 127.0.0.1, nothing persistent:
 *     close() stops the server and deletes the folder;
 *   - the PGlite shims (shims/000_supabase_shims.sql, unchanged: the superuser creates the API roles) and every
 *     supabase/migrations/*.sql in lexical order, one transaction per file (like `supabase db push`);
 *   - any number of independent connections (session()). A session runs a transaction "as" a signed-in user
 *     the way PostgREST does: SET LOCAL ROLE authenticated + request.jwt.* claims via set_config(..., true).
 *
 * Why pg_ctl and not embedded-postgres's start(): start() spawns postgres.exe directly, and PostgreSQL refuses
 * to run under an elevated Windows token ("Execution of PostgreSQL by a user with administrative permissions
 * is not permitted"). initdb and pg_ctl drop the admin rights by themselves, so the cluster is created with
 * embedded-postgres's initialise() and started / stopped with the pg_ctl shipped in the same binaries.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import type { QueryResult, QueryResultRow } from 'pg'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHIMS_FILE = join(packageRoot, 'shims', '000_supabase_shims.sql')
/** <repo>/supabase/migrations (same folder as src/harness.ts; not imported from there to keep PGlite out). */
const MIGRATIONS_DIR = join(packageRoot, '..', '..', 'supabase', 'migrations')

const SUPERUSER = 'postgres'
const HOST = '127.0.0.1'
const TEMP_PREFIX = 'bunprise-realpg-'
/** A leftover folder (killed test run) older than this is swept on the next start. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000

/**
 * Server settings. The cluster is thrown away after the test file, so durability is off (speed).
 * deadlock_timeout 200 ms: a deadlock surfaces as SQLSTATE 40P01 after 0.2 s instead of 1 s.
 * plpgsql.extra_errors = strict_multi_assignment (follows-design §7.3, M1): a SELECT INTO with a different number of
 * columns than its target fails instead of silently filling nulls, so an old `%rowtype` body cannot hide behind it.
 */
const SERVER_FLAGS = [
  '-c listen_addresses=127.0.0.1',
  '-c fsync=off',
  '-c synchronous_commit=off',
  '-c full_page_writes=off',
  '-c deadlock_timeout=200ms',
  '-c max_connections=50',
  '-c plpgsql.extra_errors=strict_multi_assignment',
].join(' ')

export interface RealPgOptions {
  /** Folder with *.sql migrations (default: supabase/migrations). `false` = shims only. */
  migrationsDir?: string | false
  /** lock_timeout of every session() connection: a lock wait that hangs fails with 55P03. Default 5000. */
  lockTimeoutMs?: number
  /** statement_timeout of every session() connection (57014). Default 20000. */
  statementTimeoutMs?: number
}

/** Result of one statement: the value, or the database error (SQLSTATE + message). Never throws. */
export type Outcome<T = unknown> = { ok: true; value: T } | { ok: false; code: string; message: string }

/** What a waiting session is stuck on (pg_blocking_pids / pg_stat_activity / pg_locks of its backend). */
export interface BlockInfo {
  /** Backend pids it waits for. */
  blockedBy: number[]
  /** pg_stat_activity wait event, e.g. "Lock:transactionid" (a row lock held by another transaction). */
  waitEvent: string | null
  /** Table of the row whose lock it is queued for (its heavyweight tuple lock), null when none. */
  rowLockOn: string | null
}

export interface RealPg {
  readonly port: number
  /** e.g. "17.10" */
  readonly serverVersion: string
  readonly appliedMigrations: readonly string[]
  /** Superuser connection (bypasses RLS): seeding, final-state checks, lock observation. */
  readonly admin: Session
  /** A new independent connection (its own backend, its own transactions). */
  session(label: string): Promise<Session>
  /** Inserts an auth.users row (the trigger creates the profile) and returns its id. */
  createUser(email: string, meta?: Record<string, unknown>): Promise<string>
  /** Runs fn in ONE transaction on the admin connection as the signed-in user (RLS applies). */
  asUser<T>(uid: string, fn: (s: Session) => Promise<T>): Promise<T>
  /** What `waiter` is waiting for right now. */
  blockInfo(waiter: Session): Promise<BlockInfo>
  /**
   * Resolves once `waiter` waits for a lock that `holder` holds. Fails when the waiter's statement finishes
   * first (it did not block) or nothing happens within timeoutMs.
   */
  waitUntilBlocked(waiter: Session, holder: Session, pending: Promise<Outcome>, timeoutMs?: number): Promise<BlockInfo>
  /** Ends every connection, stops the server, deletes the temp folder. */
  close(): Promise<void>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** One connection. Statements run in the order they are sent; a blocked statement holds back the next one. */
export class Session {
  constructor(
    readonly label: string,
    /** Backend process id (pg_backend_pid()), used to observe its locks. */
    readonly pid: number,
    private readonly client: pg.Client,
  ) {}

  /** BEGIN: as the superuser, or (uid) as role `authenticated` with that user's JWT claims. */
  async begin(uid?: string): Promise<void> {
    if (uid === undefined) {
      await this.client.query('begin')
      return
    }
    if (!UUID.test(uid)) throw new Error(`[realpg] begin(): not a uuid: ${uid}`)
    const claims = JSON.stringify({ sub: uid, role: 'authenticated' })
    // SET LOCAL + set_config(..., is_local = true) end with the transaction, exactly like PostgREST's
    // per-request settings. Literals are escaped; uid is a validated uuid.
    const sql = `begin;
      set local role authenticated;
      select set_config('request.jwt.claim.sub', ${this.client.escapeLiteral(uid)}, true),
             set_config('request.jwt.claim.role', 'authenticated', true),
             set_config('request.jwt.claims', ${this.client.escapeLiteral(claims)}, true)`
    try {
      await this.client.query(sql)
    } catch (err) {
      await this.client.query('rollback').catch(() => undefined)
      throw err
    }
  }

  query<R extends QueryResultRow = QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<QueryResult<R>> {
    return this.client.query<R>(text, [...params])
  }

  async rows<R extends QueryResultRow = QueryResultRow>(text: string, params: readonly unknown[] = []): Promise<R[]> {
    return (await this.query<R>(text, params)).rows
  }

  /** First column of the first row. */
  async value<T>(text: string, params: readonly unknown[] = []): Promise<T> {
    const res = await this.query(text, params)
    const field = res.fields[0]
    const row = res.rows[0]
    if (!field || !row) throw new Error(`[realpg] value(): no row for: ${text}`)
    return row[field.name] as T
  }

  /** select public.<fn>(args...) inside the open transaction; jsonb comes back parsed. */
  rpc<T = unknown>(fn: string, args: readonly unknown[] = []): Promise<T> {
    if (!IDENTIFIER.test(fn)) throw new Error(`[realpg] rpc(): bad function name: ${fn}`)
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
    return this.value<T>(`select public.${fn}(${placeholders}) as v`, args)
  }

  async commit(): Promise<void> {
    await this.client.query('commit')
  }

  async rollback(): Promise<void> {
    await this.client.query('rollback')
  }

  async end(): Promise<void> {
    await this.client.end().catch(() => undefined)
  }
}

/** Awaits a statement and turns a database error into { ok: false, code, message } instead of throwing. */
export async function settle<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await promise }
  } catch (err) {
    if (typeof err === 'object' && err !== null) {
      const { code, message } = err as { code?: unknown; message?: unknown }
      if (typeof code === 'string' && typeof message === 'string') return { ok: false, code, message }
    }
    return { ok: false, code: 'CLIENT', message: errorText(err) }
  }
}

export async function startRealPg(options: RealPgOptions = {}): Promise<RealPg> {
  const bin = await loadBinaries()
  await (sweep ??= sweepStaleClusters(bin.pg_ctl))

  const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX))
  const dataDir = join(root, 'data')
  const serverLog = join(root, 'server.log')
  const ctlLog = join(root, 'pg_ctl.log')
  // Throwaway password of a throwaway cluster that only listens on 127.0.0.1.
  const password = randomBytes(24).toString('base64url')
  const sessions: Session[] = []
  let started = false

  const cleanup = async () => {
    await Promise.all(sessions.map((s) => s.end()))
    if (started) await stopServer(bin.pg_ctl, dataDir, ctlLog)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => undefined)
  }

  try {
    const initLog: string[] = []
    // persistent: false documents the intent; the folder is removed by cleanup() because pg_ctl, not
    // embedded-postgres, runs the server (its stop() only cleans up servers it started itself).
    const embedded = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: SUPERUSER,
      password,
      authMethod: 'scram-sha-256',
      persistent: false,
      initdbFlags: ['--encoding=UTF8', '--locale=C', '--no-sync'],
      onLog: (message) => initLog.push(message),
      onError: (error) => initLog.push(errorText(error)),
    })
    try {
      await embedded.initialise()
    } catch (err) {
      throw new Error(`[realpg] initdb failed: ${errorText(err)}\n${initLog.join('')}`, { cause: err })
    }

    const port = await startServer(bin.pg_ctl, dataDir, serverLog, ctlLog)
    started = true

    const connectSession = async (label: string, settings: Partial<pg.ClientConfig>) => {
      const client = new pg.Client({
        host: HOST,
        port,
        user: SUPERUSER,
        password,
        database: 'postgres',
        application_name: `realpg ${label}`.slice(0, 63),
        ...settings,
      })
      // An unhandled 'error' event (e.g. the server shutting down) would crash the test process; the next
      // query on this client fails anyway, so the event itself can be ignored.
      client.on('error', () => undefined)
      await client.connect()
      const pid = (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid
      if (pid === undefined) throw new Error('[realpg] no backend pid')
      const session = new Session(label, pid, client)
      sessions.push(session)
      return session
    }

    const admin = await connectSession('admin', {})
    const serverVersion = await admin.value<string>(`select current_setting('server_version')`)

    await applyFile(admin, 'shims/000_supabase_shims.sql', await readFile(SHIMS_FILE, 'utf8'))
    const migrationsDir = options.migrationsDir === undefined ? MIGRATIONS_DIR : options.migrationsDir
    const appliedMigrations: string[] = []
    if (migrationsDir !== false) {
      const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
      for (const file of files) {
        await applyFile(admin, `migration ${file}`, await readFile(join(migrationsDir, file), 'utf8'))
        appliedMigrations.push(file)
      }
    }

    const sessionSettings: Partial<pg.ClientConfig> = {
      lock_timeout: options.lockTimeoutMs ?? 5_000,
      statement_timeout: options.statementTimeoutMs ?? 20_000,
    }

    const blockInfo = async (waiter: Session): Promise<BlockInfo> => {
      const row = (
        await admin.rows<{ pids: number[]; wait: string | null; rel: string | null }>(
          `select pg_blocking_pids($1) as pids,
                  (select a.wait_event_type || ':' || a.wait_event from pg_stat_activity a where a.pid = $1) as wait,
                  (select c.relname from pg_locks l join pg_class c on c.oid = l.relation
                    where l.pid = $1 and l.locktype = 'tuple' order by c.relname limit 1) as rel`,
          [waiter.pid],
        )
      )[0]
      return { blockedBy: row?.pids ?? [], waitEvent: row?.wait ?? null, rowLockOn: row?.rel ?? null }
    }

    return {
      port,
      serverVersion,
      appliedMigrations,
      admin,

      session: (label) => connectSession(label, sessionSettings),

      async createUser(email, meta = {}) {
        return admin.value<string>('insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id', [
          email,
          JSON.stringify(meta),
        ])
      },

      async asUser(uid, fn) {
        await admin.begin(uid)
        try {
          const result = await fn(admin)
          await admin.commit()
          return result
        } catch (err) {
          await admin.rollback().catch(() => undefined)
          throw err
        }
      },

      blockInfo,

      async waitUntilBlocked(waiter, holder, pending, timeoutMs = 5_000) {
        let finished: Outcome | undefined
        void pending.then((outcome) => {
          finished = outcome
        })
        const deadline = Date.now() + timeoutMs
        for (;;) {
          if (finished !== undefined) {
            throw new Error(`[realpg] ${waiter.label} did not block: it finished first with ${JSON.stringify(finished)}`)
          }
          const info = await blockInfo(waiter)
          if (info.blockedBy.includes(holder.pid)) return info
          if (Date.now() > deadline) {
            throw new Error(`[realpg] ${waiter.label} was not blocked by ${holder.label} within ${timeoutMs} ms: ${JSON.stringify(info)}`)
          }
          await sleep(5)
        }
      },

      close: cleanup,
    }
  } catch (err) {
    await cleanup()
    throw err
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

interface Binaries {
  pg_ctl: string
  initdb: string
  postgres: string
}

const PLATFORM_PACKAGES: Partial<Record<string, string>> = {
  'win32-x64': '@embedded-postgres/windows-x64',
  'linux-x64': '@embedded-postgres/linux-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
}

/** Paths of the bundled binaries (the platform package that embedded-postgres itself depends on). */
async function loadBinaries(): Promise<Binaries> {
  const key = `${process.platform}-${process.arch}`
  const name = PLATFORM_PACKAGES[key]
  if (name === undefined) throw new Error(`[realpg] no embedded PostgreSQL binaries for ${key}`)
  const embeddedEntry = createRequire(import.meta.url).resolve('embedded-postgres')
  const entry = createRequire(embeddedEntry).resolve(name)
  return (await import(pathToFileURL(entry).href)) as Binaries
}

let sweep: Promise<void> | undefined

/**
 * A killed test run (Ctrl+C, crashed worker) cannot run close(). Its folder stays behind and, on Windows,
 * its server keeps running. Once per process: stop and delete such leftovers. pg_ctl only signals the
 * postmaster recorded in that folder's postmaster.pid (on Windows through its own named pipe), so it can
 * never hit an unrelated process.
 */
async function sweepStaleClusters(pgCtl: string): Promise<void> {
  let names: string[]
  try {
    names = (await readdir(tmpdir())).filter((name) => name.startsWith(TEMP_PREFIX))
  } catch {
    return
  }
  for (const name of names) {
    const dir = join(tmpdir(), name)
    try {
      if (Date.now() - (await stat(dir)).mtimeMs < STALE_AFTER_MS) continue
      await runPgCtl(pgCtl, ['stop', '-D', join(dir, 'data'), '-m', 'immediate', '-w', '-t', '10', '-s'], null, 20_000).catch(() => null)
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    } catch {
      // best effort
    }
  }
}

async function startServer(pgCtl: string, dataDir: string, serverLog: string, ctlLog: string): Promise<number> {
  let lastLog = ''
  // A free port can be taken between freePort() and the server's bind: retry with a new one.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const port = await freePort()
    const code = await runPgCtl(
      pgCtl,
      ['start', '-D', dataDir, '-w', '-t', '60', '-s', '-l', serverLog, '-o', `-p ${port} ${SERVER_FLAGS}`],
      ctlLog,
      90_000,
    )
    if (code === 0) return port
    lastLog = `${await tail(serverLog)}\n${await tail(ctlLog)}`
  }
  throw new Error(`[realpg] pg_ctl could not start PostgreSQL:\n${lastLog}`)
}

async function stopServer(pgCtl: string, dataDir: string, ctlLog: string): Promise<void> {
  for (const mode of ['fast', 'immediate']) {
    const code = await runPgCtl(pgCtl, ['stop', '-D', dataDir, '-m', mode, '-w', '-t', '30', '-s'], ctlLog, 45_000).catch(() => null)
    if (code === 0) return
  }
  await killVerifiedPostmaster(dataDir)
}

/** Last resort (Windows): kill our postmaster by the PID in its postmaster.pid — only if it IS a postgres.exe. */
async function killVerifiedPostmaster(dataDir: string): Promise<void> {
  if (process.platform !== 'win32') return
  const pid = Number.parseInt((await readFile(join(dataDir, 'postmaster.pid'), 'utf8').catch(() => '')).split(/\r?\n/)[0] ?? '', 10)
  if (!Number.isInteger(pid) || pid <= 0) return
  // A stale postmaster.pid may name a PID that Windows has reused for another program.
  const listing = await capture('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
  if (!listing.trim().toLowerCase().startsWith('"postgres.exe"')) return
  await capture('taskkill', ['/PID', String(pid), '/T', '/F'])
}

/** Runs pg_ctl with its output appended to logFile (files, not pipes: the server it starts inherits them). */
function runPgCtl(pgCtl: string, args: readonly string[], logFile: string | null, timeoutMs: number): Promise<number | null> {
  const fd = logFile === null ? 'ignore' : openSync(logFile, 'a')
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(pgCtl, args, { stdio: ['ignore', fd, fd], windowsHide: true, env: { ...process.env, LC_MESSAGES: 'C' } })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`[realpg] pg_ctl ${args[0] ?? ''} did not finish within ${timeoutMs} ms`))
    }, timeoutMs)
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  }).finally(() => {
    if (typeof fd === 'number') closeSync(fd)
  })
}

function capture(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.once('error', () => resolve(out))
    child.once('close', () => resolve(out))
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, HOST, () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address !== null) resolve(address.port)
        else reject(new Error('[realpg] no free port'))
      })
    })
  })
}

async function applyFile(admin: Session, label: string, sql: string): Promise<void> {
  // One transaction per file, like `supabase db push`.
  await admin.begin()
  try {
    await admin.query(sql)
    await admin.commit()
  } catch (err) {
    await admin.rollback().catch(() => undefined)
    throw new Error(`[realpg] ${label} failed: ${errorText(err)}`, { cause: err })
  }
}

async function tail(file: string): Promise<string> {
  return (await readFile(file, 'utf8').catch(() => '')).slice(-2_000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
