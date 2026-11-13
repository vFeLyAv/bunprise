// A strict, independent RFC 5545 reader for the tests (not a copy of the writer): CRLF only, ≤ 75 octets per physical
// line, unfolding, content-line grammar (name, parameters, value), BEGIN/END nesting, the required properties of
// VCALENDAR / VEVENT / VTIMEZONE, value formats, TEXT escaping (every , ; \ and line break escaped), TZID references —
// and a resolver that turns a DTSTART;TZID=… back into an instant from the VTIMEZONE's OWN observances (not Intl), so
// a test can prove the zone data in the file is right. The same file is in apps/web/src/test/icsValidate.ts.

export interface IcsProperty { name: string; params: Record<string, string>; value: string }
export interface IcsComponent { name: string; props: IcsProperty[]; children: IcsComponent[] }

const NAME = /^[A-Za-z0-9-]+$/
// eslint-disable-next-line no-control-regex
const SAFE_CHAR = /^[^\u0000-\u0008\u000A-\u001F\u007F";:,]*$/
const DATE_TIME = /^\d{8}T\d{6}Z?$/
const DATE = /^\d{8}$/
const OFFSET = /^[+-]\d{4}(\d{2})?$/

function fail(message: string): never {
  throw new Error(`ICS invalid: ${message}`)
}

function parseLine(line: string): IcsProperty {
  let i = 0
  const readName = () => {
    const start = i
    while (i < line.length && /[A-Za-z0-9-]/.test(line[i] ?? '')) i++
    const name = line.slice(start, i)
    if (!NAME.test(name)) fail(`bad name in "${line}"`)
    return name
  }
  const name = readName().toUpperCase()
  const params: Record<string, string> = {}
  while (line[i] === ';') {
    i++
    const param = readName().toUpperCase()
    if (line[i] !== '=') fail(`parameter without "=" in "${line}"`)
    i++
    let value: string
    if (line[i] === '"') {
      const end = line.indexOf('"', i + 1)
      if (end < 0) fail(`unterminated quote in "${line}"`)
      value = line.slice(i + 1, end)
      i = end + 1
    } else {
      const start = i
      while (i < line.length && !';:,'.includes(line[i] ?? '')) i++
      value = line.slice(start, i)
      if (!SAFE_CHAR.test(value)) fail(`bad parameter value in "${line}"`)
    }
    if (line[i] === ',') fail(`multi-valued parameters not expected in "${line}"`)
    params[param] = value
  }
  if (line[i] !== ':') fail(`missing ":" in "${line}"`)
  const value = line.slice(i + 1)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000A-\u001F\u007F]/.test(value)) fail(`control character in "${line}"`)
  return { name, params, value }
}

/** TEXT (§3.3.11) back to the plain string; throws on an unescaped , or ; or an unknown escape. */
export function unescapeText(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '\\') {
      const next = value[++i]
      if (next === 'n' || next === 'N') out += '\n'
      else if (next === '\\' || next === ';' || next === ',') out += next
      else fail(`unknown escape \\${next ?? ''} in "${value}"`)
    } else if (c === ',' || c === ';') {
      fail(`unescaped "${c}" in TEXT "${value}"`)
    } else {
      out += c
    }
  }
  return out
}

/** Parses and validates a whole file; returns the VCALENDAR. */
export function parseIcs(text: string): IcsComponent {
  if (!text.endsWith('\r\n')) fail('must end with CRLF')
  const physical = text.slice(0, -2).split('\r\n')
  for (const line of physical) {
    if (line.includes('\n') || line.includes('\r')) fail('bare CR or LF')
    if (new TextEncoder().encode(line).length > 75) fail(`line longer than 75 octets: "${line}"`)
  }
  const logical: string[] = []
  for (const line of physical) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (logical.length === 0) fail('continuation without a line')
      logical[logical.length - 1] += line.slice(1)
    } else {
      logical.push(line)
    }
  }
  const root: IcsComponent = { name: '#root', props: [], children: [] }
  const stack: IcsComponent[] = [root]
  for (const line of logical) {
    const prop = parseLine(line)
    const top = stack[stack.length - 1] ?? fail('stack underflow')
    if (prop.name === 'BEGIN') {
      const child: IcsComponent = { name: prop.value.toUpperCase(), props: [], children: [] }
      top.children.push(child)
      stack.push(child)
    } else if (prop.name === 'END') {
      if (top.name !== prop.value.toUpperCase() || stack.length === 1) fail(`END:${prop.value} closes ${top.name}`)
      stack.pop()
    } else {
      if (stack.length === 1) fail(`property outside a component: ${prop.name}`)
      top.props.push(prop)
    }
  }
  if (stack.length !== 1) fail('unclosed component')
  if (root.children.length !== 1 || root.children[0]?.name !== 'VCALENDAR') fail('exactly one VCALENDAR expected')
  const calendar = root.children[0]
  validateCalendar(calendar)
  return calendar
}

const all = (c: IcsComponent, name: string) => c.props.filter((p) => p.name === name)
export function one(c: IcsComponent, name: string): IcsProperty {
  const found = all(c, name)
  if (found.length !== 1) fail(`${c.name}: ${name} ${found.length} times`)
  return found[0] as IcsProperty
}
export function maybe(c: IcsComponent, name: string): IcsProperty | undefined {
  const found = all(c, name)
  if (found.length > 1) fail(`${c.name}: ${name} ${found.length} times`)
  return found[0]
}

function checkTime(c: IcsComponent, prop: IcsProperty, zones: Set<string>): void {
  if (prop.params.VALUE === 'DATE') {
    if (!DATE.test(prop.value)) fail(`${c.name} ${prop.name}: bad DATE ${prop.value}`)
    return
  }
  if (!DATE_TIME.test(prop.value)) fail(`${c.name} ${prop.name}: bad DATE-TIME ${prop.value}`)
  const tzid = prop.params.TZID
  if (tzid !== undefined) {
    if (prop.value.endsWith('Z')) fail(`${prop.name}: TZID with a UTC time`)
    if (!zones.has(tzid)) fail(`${prop.name}: TZID ${tzid} has no VTIMEZONE`)
  }
}

function validateCalendar(cal: IcsComponent): void {
  if (one(cal, 'VERSION').value !== '2.0') fail('VERSION must be 2.0')
  one(cal, 'PRODID')
  const zones = new Set<string>()
  for (const tz of cal.children.filter((c) => c.name === 'VTIMEZONE')) {
    const id = one(tz, 'TZID').value
    if (zones.has(id)) fail(`VTIMEZONE ${id} twice`)
    zones.add(id)
    const observances = tz.children.filter((o) => o.name === 'STANDARD' || o.name === 'DAYLIGHT')
    if (observances.length === 0 || observances.length !== tz.children.length) fail(`VTIMEZONE ${id}: observances`)
    for (const o of observances) {
      if (!/^\d{8}T\d{6}$/.test(one(o, 'DTSTART').value)) fail(`${id}: observance DTSTART must be local`)
      if (!OFFSET.test(one(o, 'TZOFFSETFROM').value) || !OFFSET.test(one(o, 'TZOFFSETTO').value)) fail(`${id}: offsets`)
    }
  }
  for (const child of cal.children) {
    if (child.name !== 'VEVENT' && child.name !== 'VTIMEZONE') fail(`unexpected ${child.name}`)
    if (child.name !== 'VEVENT') continue
    one(child, 'UID')
    if (!/^\d{8}T\d{6}Z$/.test(one(child, 'DTSTAMP').value)) fail('DTSTAMP must be UTC')
    const start = one(child, 'DTSTART')
    checkTime(child, start, zones)
    const end = maybe(child, 'DTEND')
    if (end) {
      checkTime(child, end, zones)
      if ((end.params.VALUE === 'DATE') !== (start.params.VALUE === 'DATE')) fail('DTSTART and DTEND of different types')
    }
    if (end && maybe(child, 'DURATION')) fail('DTEND and DURATION')
    for (const name of ['SUMMARY', 'LOCATION', 'DESCRIPTION']) {
      const prop = maybe(child, name)
      if (prop) unescapeText(prop.value)
    }
    const url = maybe(child, 'URL')
    if (url && !/^https?:\/\/\S+$/.test(url.value)) fail(`bad URL ${url.value}`)
  }
}

function parseLocal(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value) ?? fail(`time ${value}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
}

function offsetMs(value: string): number {
  const sign = value.startsWith('-') ? -1 : 1
  return sign * (Number(value.slice(1, 3)) * 60 + Number(value.slice(3, 5))) * 60_000
}

/** The instant of a DTSTART / DTEND: UTC, a TZID resolved through the file's own VTIMEZONE, or a DATE (midnight UTC). */
export function instantOf(cal: IcsComponent, prop: IcsProperty): number {
  if (prop.params.VALUE === 'DATE') return parseLocal(`${prop.value}T000000`)
  if (prop.value.endsWith('Z')) return parseLocal(prop.value)
  const tzid = prop.params.TZID ?? fail('floating time')
  const zone = cal.children.find((c) => c.name === 'VTIMEZONE' && one(c, 'TZID').value === tzid) ?? fail(`no VTIMEZONE ${tzid}`)
  const onsets = zone.children
    .map((o) => ({ at: parseLocal(one(o, 'DTSTART').value) - offsetMs(one(o, 'TZOFFSETFROM').value), to: offsetMs(one(o, 'TZOFFSETTO').value) }))
    .sort((a, b) => a.at - b.at)
  const local = parseLocal(prop.value)
  // the observance in force at the resulting instant is the one whose offset produced it
  const fits = onsets.filter((o, i) => {
    const utc = local - o.to
    const next = onsets[i + 1]
    return utc >= o.at && (next === undefined || utc < next.at)
  })
  const chosen = fits[0] ?? fail(`${prop.value} ${tzid}: no observance (a skipped hour or outside the zone's range)`)
  return local - chosen.to
}

export function events(cal: IcsComponent): IcsComponent[] {
  return cal.children.filter((c) => c.name === 'VEVENT')
}
