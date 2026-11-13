/** Make untrusted display text well formed and remove invisible direction changes. */
export function sanitize(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 0) {
      result += '\ufffd'
    } else if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      result += ' '
    } else if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
      || code === 0x200e || code === 0x200f || code === 0x061c) {
      continue
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value.slice(index, index + 2)
        index++
      } else result += '\ufffd'
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\ufffd'
    } else result += value.charAt(index)
  }
  return result.replace(/\s+/g, ' ').trim()
}

/** Keep the UTF-16 length limit without splitting a Unicode code point. */
export function cut(value: string, limit: number, atWord = false): string {
  if (limit <= 0) return ''
  if (value.length <= limit) return value
  let end = limit
  if (atWord && value[end] !== ' ') {
    const space = value.lastIndexOf(' ', end)
    if (space > 0) end = space
  }
  const previous = value.charCodeAt(end - 1)
  if (previous >= 0xd800 && previous <= 0xdbff) end--
  return value.slice(0, end).trimEnd()
}
