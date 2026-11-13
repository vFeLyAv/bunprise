import { ApiError, isRecord, readBytes, withDeadline } from '../http'
import type { Fetch } from '../http'

export type Resolver = (hostname: string, signal: AbortSignal) => Promise<readonly string[]>

const trackingParameters = new Set([
  'gclid', 'dclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', '_ga', '_gl',
  'ref', 'ref_', 'tag', 'ascsubtag', 'linkcode', 'gbraid', 'wbraid', 'epik',
  'aff', 'affid', 'aff_id', 'affiliate', 'affiliateid', 'affiliate_id', 'affsrc',
  'aff_source', 'referrer', 'referral', 'referral_code', 'clickid', 'click_id',
  'irclickid', 'irgwc', 'ranmid', 'raneaid', 'ransiteid', 'sc_cid', 'spm', 'trk',
  'trackingid', 'tracking_id', 'campaignid', 'campaign_id', 'adid', 'ad_id',
  'adgroupid', 'adgroup_id', 'partnerid', 'partner_id',
])

function canonicalHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '')
}

function ipv4Parts(address: string): number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return undefined
  const parts = address.split('.').map(Number)
  return parts.every((part) => part <= 255) ? parts : undefined
}

function publicIpv4(parts: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = parts
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

function ipv6Parts(address: string): number[] | undefined {
  // WHATWG normalizes embedded dotted IPv4 and rejects zones / malformed IPv6.
  let normalized: string
  try {
    normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  } catch {
    return undefined
  }
  const halves = normalized.split('::')
  const left = (halves[0] ?? '').split(':').filter(Boolean).map((part) => Number.parseInt(part, 16))
  if (halves.length === 1) return left.length === 8 ? left : undefined
  const right = (halves[1] ?? '').split(':').filter(Boolean).map((part) => Number.parseInt(part, 16))
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right]
}

export function isPublicIp(address: string): boolean {
  const plain = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
  const ipv4 = ipv4Parts(plain)
  if (ipv4) return publicIpv4(ipv4)
  if (!plain.includes(':')) return false
  const parts = ipv6Parts(plain)
  if (!parts) return false
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, h = 0] = parts
  const embedded = [g >>> 8, g & 255, h >>> 8, h & 255]
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
    return publicIpv4(embedded)
  }
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return publicIpv4(embedded)
  }
  // Permit globally routed unicast only; excludes unspecified, loopback, discard,
  // unique-local, link-local, site-local and multicast address space.
  if ((a & 0xe000) !== 0x2000) return false
  if (a === 0x2001 && ((b & 0xfe00) === 0 || b === 0xdb8)) return false
  // Do not follow deprecated 6to4 tunnels, including embedded private IPv4.
  if (a === 0x2002) return false
  // Documentation prefix, in addition to 2001:db8::/32.
  if (a === 0x3fff && (b & 0xf000) === 0) return false
  return true
}

function isLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || ipv4Parts(hostname) !== undefined
}

export function validateUrl(input: string, ownHost: string): URL {
  // Reject URL parser trimming/normalization of controls before validating.
  // eslint-disable-next-line no-control-regex
  if (!input || input.length > 2048 || /[\u0000-\u0020\u007f]/.test(input)) {
    throw new ApiError('invalid_request')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new ApiError('invalid_request')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(input) || url.href.length > 2048
  ) {
    throw new ApiError('invalid_request')
  }
  if (url.port && url.port !== '80' && url.port !== '443') throw new ApiError('blocked_target')
  const hostname = canonicalHost(url.hostname)
  if (hostname === canonicalHost(ownHost)) throw new ApiError('blocked_target')
  if (isLiteral(hostname)) {
    if (!isPublicIp(hostname)) throw new ApiError('blocked_target')
  } else {
    const forbidden = ['localhost', 'local', 'internal', 'lan', 'home.arpa', 'onion']
    const labels = hostname.split('.')
    if (
      labels.length < 2 || hostname.length > 253 ||
      forbidden.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)) ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    ) throw new ApiError('blocked_target')
  }
  url.hostname = hostname
  return url
}

function isTracking(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('utm_') || lower.startsWith('_ga_') || lower.startsWith('_gac_') ||
    lower.startsWith('pf_rd_') || lower.startsWith('pd_rd_') || trackingParameters.has(lower)
}

function parameterName(segment: string): string {
  const raw = segment.split('=', 1)[0] ?? ''
  try {
    return decodeURIComponent(raw.replaceAll('+', ' '))
  } catch {
    return raw
  }
}

export function stripTracking(input: URL): URL {
  const url = new URL(input.href)
  // Filter the raw query instead of re-serialising it through URLSearchParams: the remaining
  // parameters keep their exact order and encoding, so signed or order-sensitive links still work.
  if (url.search) {
    const kept = url.search.slice(1).split('&').filter((segment) => segment && !isTracking(parameterName(segment)))
    url.search = kept.length ? `?${kept.join('&')}` : ''
  }
  url.hash = ''
  if (url.href.length > 2048) throw new ApiError('invalid_request')
  return url
}

export function createResolver(fetch: Fetch): Resolver {
  return async (hostname, signal) => {
    try {
      return await withDeadline(1500, async (dnsSignal) => {
        const answers = await Promise.all(['A', 'AAAA'].map(async (type) => {
          const url = new URL('https://cloudflare-dns.com/dns-query')
          url.searchParams.set('name', hostname)
          url.searchParams.set('type', type)
          const response = await fetch(url.href, {
            headers: { accept: 'application/dns-json' },
            redirect: 'manual',
            signal: dnsSignal,
          })
          if (!response.ok) {
            void response.body?.cancel().catch(() => {})
            throw new ApiError('fetch_failed')
          }
          const bytes = await readBytes(response, 64 * 1024, dnsSignal)
          const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
          if (!isRecord(body) || (body.Status !== 0 && body.Status !== 3)) {
            throw new ApiError('fetch_failed')
          }
          if (!Array.isArray(body.Answer)) return []
          return body.Answer.flatMap((answer: unknown): string[] => {
            if (!isRecord(answer) || (answer.type !== 1 && answer.type !== 28)) return []
            if (typeof answer.data !== 'string') throw new ApiError('fetch_failed')
            return [answer.data.trim()]
          })
        }))
        return answers.flat()
      }, signal)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'timeout') throw error
      throw new ApiError('fetch_failed')
    }
  }
}

export async function assertPublicResolution(url: URL, resolve: Resolver, signal: AbortSignal): Promise<void> {
  if (isLiteral(url.hostname)) {
    if (!isPublicIp(url.hostname)) throw new ApiError('blocked_target')
    return
  }
  const addresses = await resolve(url.hostname, signal)
  if (!addresses.length) throw new ApiError('fetch_failed')
  if (addresses.some((address) => !isPublicIp(address))) throw new ApiError('blocked_target')
}
