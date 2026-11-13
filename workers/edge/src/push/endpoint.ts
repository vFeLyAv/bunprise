// Which addresses the Worker may POST a push to (docs/spec/web-push-design.md §7 P2). A subscription's endpoint comes
// from the person's browser, so it is untrusted input: only https on the default port, no user info, only the
// browser makers' push services — and only ONE spelling per subscription (Codex code review #1: "/x/../fcm/send/T",
// "%41" or a lower-case escape would reach the same subscription under another text). The database checks the same
// rules when a device subscribes (private.push_endpoint_ok, supabase/migrations/20261027150000_web_push.sql) — keep
// both in sync. The Worker then sends to exactly the text it validated.
//   Chrome, Android, Samsung Internet, Opera, Brave …  fcm.googleapis.com          (Google FCM)
//   Firefox                                            updates.push.services.mozilla.com
//   Safari (macOS 13+, iOS/iPadOS 16.4+ home screen)   *.push.apple.com (Apple: "allow any subdomain of push.apple.com")
//   Edge                                               *.notify.windows.com      (Microsoft WNS: ?token=…, base64 escapes)

const PLAIN = /^https:\/\/(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*push\.apple\.com)\/[A-Za-z0-9._~:=/-]+$/
const WNS = /^https:\/\/[a-z0-9-]+\.notify\.windows\.com\/[A-Za-z0-9._~/-]*\?(?:[A-Za-z0-9._~=&-]|%2B|%2F|%3D)+$/
const DOT_SEGMENT = /\/\.{1,2}(?:\/|\?|$)/

export const MAX_ENDPOINT_LENGTH = 1024

/** The parsed URL when `endpoint` is an allowed push-service address in its one accepted spelling, else null. */
export function pushEndpoint(endpoint: unknown): URL | null {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return null
  if (DOT_SEGMENT.test(endpoint) || !(PLAIN.test(endpoint) || WNS.test(endpoint))) return null
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return null
  }
  // the parser must not have changed a single character (no normalisation = no second spelling)
  return url.href === endpoint && url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' ? url : null
}
