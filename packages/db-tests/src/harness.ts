/**
 * Test harness: Postgres-in-WASM (PGlite) that looks like Supabase.
 *
 * - applies shims/000_supabase_shims.sql (auth schema, roles, grants)
 * - applies every *.sql from supabase/migrations/ in lexical order
 * - lets a test run SQL "as" a signed-in user, as anon or as the service role
 *
 * RLS is only enforced for non-superusers, so asUser/asAnon switch the role
 * with SET LOCAL ROLE inside one transaction (verified in test/harness.test.ts).
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** shims/ inside this package. */
export const SHIMS_DIR = join(packageRoot, 'shims')
/** <repo>/supabase/migrations, resolved relative to this package. */
export const MIGRATIONS_DIR = join(packageRoot, '..', '..', 'supabase', 'migrations')

/** The subset of the PGlite API a test may use (works for the db and for a tx). */
export type Querier = Pick<Transaction, 'query' | 'sql' | 'exec'>

export type Row = Record<string, unknown>

export interface CreateTestDbOptions {
  /** Folder with *.sql migrations. `false` skips migrations entirely. */
  migrationsDir?: string | false
  /** Extra SQL (fixtures, scratch tables) run as superuser after the migrations. */
  extraSql?: readonly string[]
  /** Suppress the console note when no migrations are found. */
  quiet?: boolean
}

export interface TestDb {
  /** Raw superuser handle (bypasses RLS). Prefer asService for readability. */
  db: PGlite
  /** Migration file names that were applied, in order. */
  appliedMigrations: readonly string[]
  /** Inserts a row into auth.users (as superuser) and returns its id. */
  createUser(email: string, meta?: Record<string, unknown>): Promise<string>
  /** Runs fn inside ONE transaction as role `authenticated` with the user's JWT claims. */
  asUser<T>(userId: string, fn: (tx: Querier) => Promise<T>): Promise<T>
  /** Runs fn inside ONE transaction as role `anon` (no sub). */
  asAnon<T>(fn: (tx: Querier) => Promise<T>): Promise<T>
  /** Runs fn inside ONE transaction as the superuser (no SET ROLE, bypasses RLS). */
  asService<T>(fn: (tx: Querier) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function createTestDb(options: CreateTestDbOptions = {}): Promise<TestDb> {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } })
  await db.waitReady

  let appliedMigrations: string[]
  try {
    // Like the real-PostgreSQL suite (src/realpg.ts, follows-design §7.3): a SELECT INTO with a different number of
    // columns than its target is an ERROR, not a silent null fill (old `%rowtype` bodies after new columns).
    // Session-level, set before any function is compiled; PGlite 0.5.10 (PG 18) accepts it (probe J1, 2026-10-20).
    await db.exec(`set plpgsql.extra_errors = 'strict_multi_assignment'`)
    await db.exec(await readFile(join(SHIMS_DIR, '000_supabase_shims.sql'), 'utf8'))

    const migrationsDir = options.migrationsDir === undefined ? MIGRATIONS_DIR : options.migrationsDir
    appliedMigrations = migrationsDir === false ? [] : await applyMigrations(db, migrationsDir, options.quiet ?? false)

    for (const sql of options.extraSql ?? []) {
      await db.exec(sql)
    }
  } catch (err) {
    // Do not leak a WASM Postgres when the shims, a migration or extraSql fail.
    await db.close()
    throw err
  }

  const runAs = <T>(role: 'authenticated' | 'anon' | null, claims: Record<string, string>, fn: (tx: Querier) => Promise<T>) =>
    db.transaction(async (tx) => {
      // SET LOCAL + set_config(..., is_local = true) both end with the transaction,
      // so the next statement outside runs as the superuser again.
      if (role !== null) await tx.exec(`set local role ${role}`)
      await tx.query(
        `select set_config('request.jwt.claim.sub', $1, true),
                set_config('request.jwt.claim.role', $2, true),
                set_config('request.jwt.claims', $3, true)`,
        [claims['sub'] ?? '', claims['role'] ?? '', JSON.stringify(claims)],
      )
      return fn(tx)
    })

  return {
    db,
    appliedMigrations,

    async createUser(email, meta = {}) {
      const res = await db.query<{ id: string }>(
        'insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id',
        [email, JSON.stringify(meta)],
      )
      const id = res.rows[0]?.id
      if (!id) throw new Error(`createUser(${email}): insert returned no id`)
      return id
    },

    asUser: (userId, fn) => runAs('authenticated', { sub: userId, role: 'authenticated' }, fn),
    asAnon: (fn) => runAs('anon', { role: 'anon' }, fn),
    asService: (fn) => runAs(null, { role: 'service_role' }, fn),

    close: () => db.close(),
  }
}

async function applyMigrations(db: PGlite, dir: string, quiet: boolean): Promise<string[]> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') files = []
    else throw err
  }

  if (files.length === 0) {
    if (!quiet) console.info(`[db-tests] no migrations found in ${dir} - running with shims only`)
    return []
  }

  for (const file of files) {
    const sql = await readFile(join(dir, file), 'utf8')
    try {
      // One transaction per file, like `supabase db push`.
      await db.transaction((tx) => tx.exec(sql))
    } catch (err) {
      throw new Error(`[db-tests] migration ${file} failed: ${errorMessage(err)}`, { cause: err })
    }
  }
  return files
}

// ---------------------------------------------------------------------------
// Small typed helpers
// ---------------------------------------------------------------------------

/** Runs a query and returns only the rows, typed. */
export async function rows<T extends Row = Row>(q: Querier, text: string, params?: readonly unknown[]): Promise<T[]> {
  const res = await q.query<T>(text, params ? [...params] : undefined)
  return res.rows
}

/** Runs a query that returns at most one row. */
export async function one<T extends Row = Row>(q: Querier, text: string, params?: readonly unknown[]): Promise<T | null> {
  const r = await rows<T>(q, text, params)
  if (r.length > 1) throw new Error(`one(): expected at most 1 row, got ${r.length}`)
  return r[0] ?? null
}

/** Runs a query that returns one row with one column and returns that value. */
export async function scalar<T>(q: Querier, text: string, params?: readonly unknown[]): Promise<T> {
  const res = await q.query<Record<string, T>>(text, params ? [...params] : undefined)
  const row = res.rows[0]
  const field = res.fields[0]
  if (!row || !field) throw new Error(`scalar(): query returned no row`)
  return row[field.name] as T
}

/** Shape of the error PGlite throws for a Postgres error (SQLSTATE in `code`). */
export interface DbError {
  code: string
  message: string
}

export function isDbError(err: unknown): err is DbError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { code?: unknown }).code === 'string' &&
    typeof (err as { message?: unknown }).message === 'string'
  )
}

/**
 * Awaits a promise that must fail with the given SQLSTATE and returns the error.
 * Common codes: 42501 = insufficient_privilege (RLS / GRANT),
 * 23505 = unique_violation, 23503 = foreign_key_violation, 23514 = check_violation.
 */
export async function expectDbError(promise: Promise<unknown>, code: string): Promise<DbError> {
  let result: unknown
  try {
    result = await promise
  } catch (err) {
    if (!isDbError(err)) throw new Error(`expected a database error, got: ${errorMessage(err)}`, { cause: err })
    if (err.code !== code) throw new Error(`expected SQLSTATE ${code}, got ${err.code}: ${err.message}`, { cause: err })
    return err
  }
  throw new Error(`expected SQLSTATE ${code}, but the query succeeded with ${JSON.stringify(result)}`)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
