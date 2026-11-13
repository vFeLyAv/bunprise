import { HttpResponse } from 'msw'

// PostgREST-shaped plumbing for the local demo server (src/mocks). Error bodies use the real
// { code, message, details, hint } shape, so src/lib/errors.ts maps them exactly like the hosted API:
// P0001 + '<code>' → errors.<code>, 42501 → forbidden, PGRST116 → not_found, PGRST301 → session_expired.

export const DEMO_SUPABASE_URL = 'http://demo.localhost'

/** The codes our RPCs raise with `raise exception using message = '<code>'` (+ the time-zone trigger). */
export type RaisedCode =
  | 'not_authenticated'
  | 'consent_required'
  | 'profile_incomplete'
  | 'not_found'
  | 'not_allowed'
  | 'already_reserved'
  // 20261025150000: the bring-along list — somebody else brings this entry already
  | 'already_claimed'
  | 'invite_invalid'
  | 'validation'
  | 'invalid_timezone'
  // wave 2 (follows-design §5.1): the caller's own limits (20 lists, 30 open requests, 5 reservations per person)
  | 'limit_reached'
  // 20261027160000: too many wrong friend codes (10 per hour, 30 per day)
  | 'rate_limited'

/** A database / PostgREST error with the HTTP status PostgREST would answer with. */
export class DemoDbError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'DemoDbError'
    this.code = code
    this.status = status
  }
}

/** `raise exception using message = '<code>'` → { code: 'P0001', message: '<code>' }, HTTP 400. */
export function raise(code: RaisedCode): DemoDbError {
  return new DemoDbError('P0001', code, 400)
}

export function permissionDenied(target: string): DemoDbError {
  return new DemoDbError('42501', `permission denied for ${target}`, 403)
}

export function policyViolation(table: string): DemoDbError {
  return new DemoDbError('42501', `new row violates row-level security policy for table "${table}"`, 403)
}

export function checkViolation(constraint: string): DemoDbError {
  return new DemoDbError('23514', `new row violates check constraint "${constraint}"`, 400)
}

export function notNullViolation(column: string): DemoDbError {
  return new DemoDbError('23502', `null value in column "${column}" violates not-null constraint`, 400)
}

export function uniqueViolation(constraint: string): DemoDbError {
  return new DemoDbError('23505', `duplicate key value violates unique constraint "${constraint}"`, 409)
}

export function invalidInput(type: string): DemoDbError {
  return new DemoDbError('22P02', `invalid input syntax for type ${type}`, 400)
}

export function invalidDatetime(): DemoDbError {
  return new DemoDbError('22007', 'invalid input syntax for type timestamp with time zone', 400)
}

export function unknownColumn(table: string, column: string): DemoDbError {
  return new DemoDbError('PGRST204', `Could not find the '${column}' column of '${table}' in the schema cache`, 400)
}

export function notSingle(): DemoDbError {
  return new DemoDbError('PGRST116', 'JSON object requested, multiple (or no) rows returned', 406)
}

export function invalidBody(): DemoDbError {
  return new DemoDbError('PGRST102', 'Invalid JSON body', 400)
}

export function sessionExpiredError(): DemoDbError {
  return new DemoDbError('PGRST301', 'Session expired', 401)
}

/** Never let an unfinished demo endpoint look like a working feature (or reach a real server). */
export function notImplemented(): DemoDbError {
  return new DemoDbError('demo_not_implemented', 'This demo endpoint is not implemented', 501)
}

function unsupported(what: string): DemoDbError {
  return new DemoDbError('PGRST100', `The demo server does not support ${what}`, 400)
}

export function restError(code: string, message: string, status = 403): Response {
  return HttpResponse.json({ code, message, details: null, hint: null }, { status })
}

export function errorResponse(error: DemoDbError): Response {
  return restError(error.code, error.message, error.status)
}

/** Runs a handler body and turns a thrown DemoDbError into its PostgREST response. */
export async function guarded(run: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof DemoDbError) return errorResponse(error)
    throw error
  }
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Lenient body for auth endpoints: anything unreadable counts as an empty object. */
export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return record(await request.json())
  } catch {
    return {}
  }
}

/** Strict JSON body for REST writes and RPCs; an empty body is `undefined`. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw invalidBody()
  }
}

export function wantsObject(request: Request): boolean {
  return request.headers.get('accept')?.includes('application/vnd.pgrst.object+json') === true
}

export function wantsRepresentation(request: Request): boolean {
  return request.headers.get('prefer')?.includes('return=representation') === true
}

export function wantsUpsert(request: Request): boolean {
  return request.headers.get('prefer')?.includes('resolution=') === true
}

// ---- table queries: ?select= · column filters · ?order= · ?limit= / ?offset= ----------------------

/** Any table row (the demo world's row interfaces). */
export type Row = object

function cell(row: Row, column: string): unknown {
  return (row as Readonly<Record<string, unknown>>)[column]
}

export interface TableAccess {
  readonly table: string
  /** every column of the table, in table order */
  readonly columns: readonly string[]
  /** the column-level SELECT grant of `authenticated` (pilot v1.1 §0.1: no table-wide grants) */
  readonly readable: readonly string[]
  /**
   * Many-to-one relations PostgREST can embed (`?select=…,alias:other(col,…)`), by the referenced
   * table's name: this table's foreign-key column → `other.id`. Nothing else can be embedded here.
   */
  readonly embeds?: Readonly<Record<string, { readonly foreignKey: string; readonly access: TableAccess }>>
}

interface OrderTerm {
  readonly column: string
  readonly ascending: boolean
  readonly nullsFirst: boolean
}

/** One embedded many-to-one row in the response: `name` holds the referenced row (or null). */
export interface EmbedQuery {
  /** the alias, or the referenced table's name */
  readonly name: string
  readonly table: string
  readonly foreignKey: string
  readonly columns: readonly string[]
}

export interface RowQuery {
  /** projection for the response */
  readonly columns: readonly string[]
  /** embedded many-to-one rows (declared in TableAccess.embeds) */
  readonly embeds: readonly EmbedQuery[]
  readonly filters: readonly ((row: Row) => boolean)[]
  readonly order: readonly OrderTerm[]
  readonly limit: number | null
  readonly offset: number
}

const CONTROL_PARAMS: ReadonlySet<string> = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'])
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** Like Postgres: an unknown column is 42703, a column without SELECT grant is 42501 — before any row is touched. */
function referenceColumn(access: TableAccess, column: string): void {
  if (!access.columns.includes(column)) throw new DemoDbError('42703', `column ${access.table}.${column} does not exist`, 400)
  if (!access.readable.includes(column)) throw permissionDenied(`table ${access.table}`)
}

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : String(value)
}

function listOperand(operand: string): string[] {
  const inner = /^\((.*)\)$/s.exec(operand)?.[1]
  if (inner === undefined) throw unsupported(`the list ${operand}`)
  if (inner === '') return []
  return inner.split(',').map((item) => item.trim().replace(/^"(.*)"$/s, '$1'))
}

function filterFor(column: string, raw: string): (row: Row) => boolean {
  const match = /^(eq|neq|is|in)\.(.*)$/s.exec(raw)
  const operator = match?.[1]
  const operand = match?.[2] ?? ''
  switch (operator) {
    case 'eq':
      return (row) => cellText(cell(row, column)) === operand
    case 'neq':
      return (row) => {
        const value = cellText(cell(row, column))
        return value !== null && value !== operand
      }
    case 'is':
      if (operand === 'null') return (row) => cell(row, column) === null || cell(row, column) === undefined
      if (operand === 'true' || operand === 'false') return (row) => cell(row, column) === (operand === 'true')
      throw unsupported(`is.${operand}`)
    case 'in': {
      const values = listOperand(operand)
      return (row) => {
        const value = cellText(cell(row, column))
        return value !== null && values.includes(value)
      }
    }
    default:
      throw unsupported(`the filter ${column}=${raw}`)
  }
}

/** Splits a ?select= list at the commas outside parentheses ("a,b,l:t(x,y)" → ["a", "b", "l:t(x,y)"]). */
function selectItems(select: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const char of select) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth < 0) throw unsupported(`select=${select}`)
    if (char === ',' && depth === 0) {
      items.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (depth !== 0) throw unsupported(`select=${select}`)
  items.push(current.trim())
  return items
}

const EMBED = /^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)\((.*)\)$/s

/**
 * `alias:table(col, …)` of a declared many-to-one relation. Like Postgres, every column it touches
 * needs the SELECT grant: the parent's foreign key (the join) and each embedded column.
 */
function embedFor(access: TableAccess, item: string, select: string): EmbedQuery {
  const [, alias, table, inner] = EMBED.exec(item) ?? []
  if (table === undefined || inner === undefined || !access.embeds || !Object.prototype.hasOwnProperty.call(access.embeds, table)) {
    throw unsupported(`select=${select}`)
  }
  const relation = access.embeds[table]
  if (!relation) throw unsupported(`select=${select}`)
  const columns = inner.split(',').map((column) => column.trim())
  if (columns.some((column) => !IDENTIFIER.test(column))) throw unsupported(`select=${select}`) // no `*`, no nesting
  referenceColumn(access, relation.foreignKey)
  for (const column of columns) referenceColumn(relation.access, column)
  return { name: alias ?? table, table: relation.access.table, foreignKey: relation.foreignKey, columns }
}

/**
 * Parses projection, filters and ordering, checking every referenced column against the grants.
 * `projection: false` (a write without `return=representation`) skips the ?select= check.
 */
export function parseQuery(request: Request, access: TableAccess, { projection = true }: { projection?: boolean } = {}): RowQuery {
  const params = new URL(request.url).searchParams
  const select = params.get('select') ?? '*'
  let columns: string[]
  const embeds: EmbedQuery[] = []
  if (!projection) {
    columns = []
  } else if (select === '*') {
    // `*` expands to every column; with a column-level grant that misses one, Postgres refuses the whole query.
    if (access.columns.some((column) => !access.readable.includes(column))) throw permissionDenied(`table ${access.table}`)
    columns = [...access.columns]
  } else {
    columns = []
    for (const item of selectItems(select)) {
      if (item.includes('(')) {
        embeds.push(embedFor(access, item, select))
        continue
      }
      if (!IDENTIFIER.test(item)) throw unsupported(`select=${select}`)
      referenceColumn(access, item)
      columns.push(item)
    }
  }
  const filters: ((row: Row) => boolean)[] = []
  for (const [key, raw] of params) {
    if (CONTROL_PARAMS.has(key)) continue
    if (!IDENTIFIER.test(key)) throw unsupported(`the parameter ${key}`)
    referenceColumn(access, key)
    filters.push(filterFor(key, raw))
  }
  const order: OrderTerm[] = []
  for (const term of (params.get('order') ?? '').split(',').filter((part) => part !== '')) {
    const [column = '', ...modifiers] = term.split('.')
    referenceColumn(access, column)
    if (modifiers.some((modifier) => !['asc', 'desc', 'nullsfirst', 'nullslast'].includes(modifier))) throw unsupported(`order=${term}`)
    const ascending = !modifiers.includes('desc')
    // Postgres default: NULLS LAST for ascending, NULLS FIRST for descending
    const nullsFirst = modifiers.includes('nullsfirst') || (!modifiers.includes('nullslast') && !ascending)
    order.push({ column, ascending, nullsFirst })
  }
  const limitParam = params.get('limit')
  const limit = limitParam === null ? null : Number(limitParam)
  const offset = Number(params.get('offset') ?? 0)
  if ((limit !== null && (!Number.isInteger(limit) || limit < 0)) || !Number.isInteger(offset) || offset < 0) throw unsupported('this limit/offset')
  return { columns, embeds, filters, order, limit, offset }
}

function compareCells(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  const left = String(a)
  const right = String(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/** WHERE only — for PATCH / DELETE targets. */
export function applyFilters<T extends Row>(rows: readonly T[], query: RowQuery): T[] {
  return rows.filter((row) => query.filters.every((matches) => matches(row)))
}

/** WHERE + ORDER BY + OFFSET/LIMIT — for reads. */
export function applyQuery<T extends Row>(rows: readonly T[], query: RowQuery): T[] {
  const sorted = applyFilters(rows, query).sort((a, b) => {
    for (const term of query.order) {
      const left = cell(a, term.column)
      const right = cell(b, term.column)
      const leftNull = left === null || left === undefined
      const rightNull = right === null || right === undefined
      if (leftNull || rightNull) {
        if (leftNull && rightNull) continue
        return leftNull === term.nullsFirst ? -1 : 1
      }
      const result = compareCells(left, right)
      if (result !== 0) return term.ascending ? result : -result
    }
    return 0
  })
  return sorted.slice(query.offset, query.limit === null ? undefined : query.offset + query.limit)
}

/** The embedded rows of one parent row, by response key. */
export type Embedder = (row: Row) => Record<string, unknown>

/**
 * PostgREST's many-to-one embedding: the referenced row (projected to its columns) or null when
 * there is none or the referenced table's RLS hides it from this viewer — `visible(table)` must
 * return exactly the rows that table's SELECT policy shows.
 */
export function embedder(query: RowQuery, visible: (table: string) => readonly Row[]): Embedder | undefined {
  if (query.embeds.length === 0) return undefined
  const sources = query.embeds.map((embed) => ({ embed, rows: visible(embed.table) }))
  return (row) => Object.fromEntries(sources.map(({ embed, rows }) => {
    const key = cell(row, embed.foreignKey)
    const target = key === null || key === undefined ? undefined : rows.find((candidate) => cell(candidate, 'id') === key)
    return [embed.name, target ? project([target], embed.columns)[0] ?? null : null]
  }))
}

/** Copies the projected columns (live rows never leave the demo world), plus embedded rows. */
export function project(rows: readonly Row[], columns: readonly string[], embed?: Embedder): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...Object.fromEntries(columns.map((column) => [column, cell(row, column) ?? null])),
    ...embed?.(row),
  }))
}

/** A JSON array, or one object for `Accept: application/vnd.pgrst.object+json` (.single()). */
export function respondRows(request: Request, rows: readonly Row[], columns: readonly string[], status = 200, embed?: Embedder): Response {
  const projected = project(rows, columns, embed)
  if (wantsObject(request)) {
    if (projected.length !== 1) return errorResponse(notSingle())
    return HttpResponse.json(projected[0], { status })
  }
  return HttpResponse.json(projected, { status })
}
