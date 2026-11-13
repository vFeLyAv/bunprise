/** Validate the final normalized URL, including encoded separators and dot segments. */
export function internalPath(value: string | undefined | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  try {
    const decoded = decodeURIComponent(value)
    const unsafe = Array.from(decoded).some((char) => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    if (decoded.startsWith('//') || unsafe) return null
    const url = new URL(value, 'https://bunprise.invalid')
    if (url.origin !== 'https://bunprise.invalid' || url.pathname.startsWith('//')) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch { return null }
}
