/**
 * @bunprise/mascot/night — «Ночью маскоты спят» (Felix 31.10: «прикольно, но чтобы можно было будить»; gallery
 * `?screens=night`, approved for the app 31.10: «спящие норм, оставляем»). A separate entry, lazy like the Tower:
 * a screen that never shows a sleeping mascot never loads it. The time rules alone are `@bunprise/mascot/night-clock`.
 *
 *   const m = new NightMascot(parent, { kind: 'bunny', size: 96, now: Date.now, drip: true, hit: true, onTap })
 *   m.update()      // re-read the clock (23:00 → falls asleep, 07:00 → wakes up by himself)
 *   m.nudge()       // the person scrolls nearby: one sleepy peek, at most every 20 s
 *   m.setStill(on)  // reduced motion / battery saver: still poses, not one animate() call
 *   m.setPaused(on) // a sheet is open / another mascot holds the stage
 *   m.destroy()
 *
 * Rules: README «Ночью спят»; design docs/design/2026-10-31-mascots-night.md.
 */

export { AWAKE_MS, NIGHT, PEEK_GAP_MS, isNight, minuteOfDay, minutesToChange, wantsSleep, type NightWindow, type SleepRule } from './clock';
export { NightMascot, type NightMoment, type NightOptions, type NightState } from './controller';
export { FALL_S, PEEK_S, WAKE_S } from './moves';
export { GEO as NIGHT_GEO, type NightKind, type NightRig } from './rig';
