import { describe, expect, it } from 'vitest'

// ./ics.ts is a copy of workers/edge/src/calendar/ics.ts (no shared package between the app and the Worker): the
// "Zum Kalender hinzufügen" file and the Kalender-Abo feed must write events the same way. Everything from the line
// "// What an event says" on must be identical; only the header above it may differ. The same for the test reader.

interface NodeFs { readFileSync(path: string, encoding: 'utf8'): string; existsSync(path: string): boolean }
const nodeProcess = (globalThis as { process?: { cwd(): string; getBuiltinModule?: (id: string) => unknown } }).process
const fs = nodeProcess?.getBuiltinModule?.('node:fs') as NodeFs | undefined
const repo = [nodeProcess?.cwd() ?? '', `${nodeProcess?.cwd() ?? ''}/../..`].find((dir) => fs?.existsSync(`${dir}/workers/edge/src/calendar/ics.ts`)) ?? ''
const read = (file: string) => (fs?.readFileSync(`${repo}/${file}`, 'utf8') ?? '').replace(/\r\n/g, '\n')
const body = (text: string, marker: string) => text.slice(Math.max(0, text.indexOf(marker)))

describe('the two ICS writers', () => {
  it('app and Worker share the same code below the header', () => {
    const marker = '// What an event says'
    const app = read('apps/web/src/features/calendarExport/ics.ts')
    const worker = read('workers/edge/src/calendar/ics.ts')
    expect(app.indexOf(marker)).toBeGreaterThan(0)
    expect(body(app, marker)).toBe(body(worker, marker))
  })

  it('the two test readers are the same', () => {
    const marker = 'export interface IcsProperty'
    const app = read('apps/web/src/test/icsValidate.ts')
    const worker = read('workers/edge/test/icsValidate.ts')
    expect(app.indexOf(marker)).toBeGreaterThan(0)
    expect(body(app, marker)).toBe(body(worker, marker))
  })
})
