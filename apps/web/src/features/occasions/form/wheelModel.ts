import type { HourCycle } from './dateFormat'

// Pure model of the time wheel. The form keeps "HH:mm" (24 h) exactly as before; the wheel only maps
// it to columns: hours (0–23, or 12, 1–11 + AM/PM) and minutes in 5-minute steps. A stored minute that
// is not on the 5-minute grid (an older occasion at 18:07) stays selectable, so opening and closing the
// wheel never changes a time nobody touched.

export const MINUTE_STEP = 5

export interface TimeParts {
  hour: number
  minute: number
}

const TIME_SHAPE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseTime(value: string): TimeParts | null {
  const match = TIME_SHAPE.exec(value)
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null
}

export function toTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** 0, 5, …, 55 — plus `current` when it is off the grid (kept in order). */
export function minuteOptions(current?: number): number[] {
  const options = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP)
  if (current !== undefined && current >= 0 && current < 60 && current % MINUTE_STEP !== 0) {
    options.push(current)
    options.sort((a, b) => a - b)
  }
  return options
}

/** Wheel order of the hour column: 0–23, or 12, 1, …, 11 on a 12 h clock. */
export function hourOptions(cycle: HourCycle): number[] {
  return cycle === 'h23' ? Array.from({ length: 24 }, (_, i) => i) : [12, ...Array.from({ length: 11 }, (_, i) => i + 1)]
}

export function to12h(hour24: number): { hour12: number; pm: boolean } {
  return { hour12: hour24 % 12 === 0 ? 12 : hour24 % 12, pm: hour24 >= 12 }
}

export function from12h(hour12: number, pm: boolean): number {
  const base = hour12 % 12
  return pm ? base + 12 : base
}

/** Index of `value` in `options`, or of the nearest option (for a value that is not in the list). */
export function nearestIndex(options: readonly number[], value: number): number {
  let best = 0
  for (let i = 1; i < options.length; i += 1) {
    if (Math.abs((options[i] as number) - value) < Math.abs((options[best] as number) - value)) best = i
  }
  return best
}
