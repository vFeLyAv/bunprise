// One error type for the UI: every failure becomes an AppError whose `key` is an i18n key
// in the `errors` namespace (t(error.key)). The mapping only looks at error CODES, never
// forwards server messages, so nothing about reservations can leak through an error text.

export type ErrorCode =
  // RPC codes raised by the database (data-and-secrecy.md section 5)
  | 'not_authenticated'
  | 'consent_required'
  | 'profile_incomplete'
  | 'not_found'
  | 'not_allowed'
  | 'already_reserved'
  // 20261025150000: the bring-along list "Mitbringen" — somebody else brings this entry already
  | 'already_claimed'
  | 'invite_invalid'
  | 'invite_limit'
  | 'validation'
  // wave 2 (follows-design §5.1): only the caller's OWN limits — 20 lists, 30 open requests, 5 reservations per person
  | 'limit_reached'
  // client / auth / transport
  | 'generic'
  | 'network'
  | 'offline_action'
  | 'email_invalid'
  | 'rate_limited'
  | 'code_wrong'
  | 'code_expired'
  | 'code_invalid'
  | 'captcha'
  | 'oauth_cancelled'
  | 'oauth_failed'
  | 'provider_unavailable'
  | 'forbidden'
  | 'session_expired'
  | 'load_failed'
  | 'conflict'
  | 'invalid_input'

export type ErrorKey = `errors.${ErrorCode}`

const RPC_CODES: ReadonlySet<string> = new Set([
  'not_authenticated',
  'consent_required',
  'profile_incomplete',
  'not_found',
  'not_allowed',
  'already_reserved',
  'already_claimed',
  'invite_invalid',
  'invite_limit',
  'validation',
  'limit_reached',
])

export class AppError extends Error {
  readonly code: ErrorCode
  /** i18n key, e.g. 'errors.not_found' */
  readonly key: ErrorKey
  /** HTTP status when known */
  readonly status: number | undefined
  /** interpolation values for the message, e.g. { minutes: 5 } */
  readonly params: Record<string, string | number> | undefined

  constructor(
    code: ErrorCode,
    options: { status?: number; params?: Record<string, string | number>; cause?: unknown } = {},
  ) {
    super(`errors.${code}`, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.key = `errors.${code}`
    this.status = options.status
    this.params = options.params
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPostgrestError(err: unknown): err is { code: string; message: string; details?: string; hint?: string } {
  return isRecord(err) && typeof err.code === 'string' && typeof err.message === 'string' && ('details' in err || 'hint' in err)
}

function isAuthError(err: unknown): err is { message: string; code?: string; status?: number; name?: string } {
  return isRecord(err) && err.__isAuthError === true
}

function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (!isRecord(err)) return false
  const message = typeof err.message === 'string' ? err.message : ''
  return (
    err.name === 'AuthRetryableFetchError' ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(message)
  )
}

function mapPostgrestCode(code: string, message: string): AppError {
  if (code === 'P0001' && RPC_CODES.has(message)) return new AppError(message as ErrorCode)
  if (code === 'P0001' && message === 'invalid_timezone') return new AppError('invalid_input')
  // 20261027160000: too many wrong friend codes (10 per hour, 30 per day) — "warte bitte 60 Min."
  if (code === 'P0001' && message === 'rate_limited') return new AppError('rate_limited', { params: { minutes: 60 } })
  switch (code) {
    case '42501':
      return new AppError('forbidden')
    case 'PGRST116':
      return new AppError('not_found')
    case 'PGRST301':
    case 'PGRST302':
      return new AppError('session_expired')
    case '23505':
      return new AppError('conflict')
    case '23502':
    case '23514':
    case '22P02':
    case '22001':
      return new AppError('invalid_input')
    default:
      return new AppError('generic')
  }
}

function mapAuthError(err: { message: string; code?: string; status?: number }): AppError {
  const { code, status, message } = err
  switch (code) {
    case 'otp_expired':
      return new AppError('code_invalid', { status }) // Supabase cannot tell "wrong" from "expired"
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_sms_send_rate_limit': {
      const seconds = Number(/after (\d+) seconds/.exec(message)?.[1] ?? 60)
      return new AppError('rate_limited', { status, params: { minutes: Math.max(1, Math.ceil(seconds / 60)) } })
    }
    case 'email_address_invalid':
    case 'email_address_not_authorized':
      return new AppError('email_invalid', { status })
    case 'validation_failed':
      return new AppError(/email/i.test(message) ? 'email_invalid' : 'invalid_input', { status })
    case 'captcha_failed':
      return new AppError('captcha', { status })
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'bad_jwt':
      return new AppError('session_expired', { status })
    case 'invalid_credentials':
      return new AppError('code_invalid', { status })
    case 'bad_oauth_callback':
    case 'bad_oauth_state':
      return new AppError('oauth_failed', { status })
    case 'oauth_provider_not_supported':
    case 'provider_disabled':
      return new AppError('provider_unavailable', { status })
    case 'user_banned':
      return new AppError('forbidden', { status })
    default:
      if (status === 429) return new AppError('rate_limited', { status, params: { minutes: 1 } })
      if (status === 401 || status === 403) return new AppError('session_expired', { status })
      return new AppError('generic', { status })
  }
}

/**
 * What the DEV console may show of a server error: our key plus its code and HTTP status. Never the
 * raw object — its message/details/hint may describe private rows (Codex review 2, L5).
 */
export function safeErrorSummary(mapped: AppError, err: unknown): { key: ErrorKey; code?: string; status?: number } {
  const raw = isRecord(err) ? err : {}
  const code = typeof raw.code === 'string' && /^[\w.-]{1,64}$/.test(raw.code) ? raw.code : undefined
  const rawStatus = typeof raw.status === 'number' && Number.isFinite(raw.status) ? raw.status : undefined
  const status = mapped.status ?? rawStatus
  return { key: mapped.key, ...(code === undefined ? {} : { code }), ...(status === undefined ? {} : { status }) }
}

/** Normalises anything thrown by supabase-js / fetch / our own code into an AppError. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  let mapped: AppError
  if (isNetworkError(err)) mapped = new AppError('network')
  else if (isAuthError(err)) mapped = mapAuthError(err)
  else if (isPostgrestError(err)) mapped = mapPostgrestCode(err.code, err.message)
  else mapped = new AppError('generic')
  if (import.meta.env.DEV) console.debug('[AppError]', safeErrorSummary(mapped, err))
  // `cause` stays for debugging in code; no screen renders it (texts come from errors.json only)
  return Object.assign(mapped, { cause: err })
}

export function isAppError(err: unknown, code?: ErrorCode): err is AppError {
  return err instanceof AppError && (code === undefined || err.code === code)
}
