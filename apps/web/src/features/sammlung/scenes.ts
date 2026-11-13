// «Pompons Sammlung» — the hidden scenes that count (docs/design/2026-10-27-pompons-sammlung.md §3; the gallery's
// demo/sammlung/scenes.ts). Only scenes that really play in the app today; an approved gallery scene becomes a new
// card here (Felix 28.10, §0 #10). The texts (name, where it lives, the spoiler-free hint) are in the locales
// (settings.json → sammlung.scene.<id>); this list has no imports, so the store and the recorder stay tiny.

export const SCENE_IDS = ['tower', 'speck', 'psst', 'footing', 'homeicon', 'chase', 'overfed-a', 'overfed-b', 'overfed-c'] as const
export type SceneId = (typeof SCENE_IDS)[number]

export const isSceneId = (v: unknown): v is SceneId => typeof v === 'string' && (SCENE_IDS as readonly string[]).includes(v)

export interface SceneCard {
  id: SceneId
  /** the scene's natural box in the app, px (the card scales it down) */
  box: { w: number; h: number }
  /** a card ledge under the scene: its top, px from the box's top */
  ledge?: number
  /** the still frame on the card (s) */
  poster: number
  /** a little extra zoom on the card (the scene reads at a glance) */
  zoom?: number
  /** can only be found on an iPhone (Felix 28.10, §0 #6: elsewhere it is not counted) */
  iphoneOnly?: boolean
}

/** The tower's own host height (the package's tower-plan HOST_H). */
export const TOWER_BOX_H = 390

export const SCENES: readonly SceneCard[] = [
  { id: 'tower', box: { w: 390, h: TOWER_BOX_H + 24 }, ledge: TOWER_BOX_H - 16, poster: 2.75, zoom: 1.08 },
  { id: 'speck', box: { w: 240, h: 190 }, ledge: 170, poster: 0, zoom: 1.05 },
  { id: 'psst', box: { w: 240, h: 190 }, ledge: 170, poster: 0, zoom: 1.05 },
  { id: 'footing', box: { w: 260, h: 176 }, poster: 0.42 },
  { id: 'homeicon', box: { w: 390, h: 300 }, ledge: 266, poster: 0, zoom: 1.25, iphoneOnly: true },
  { id: 'chase', box: { w: 390, h: 150 }, ledge: 120, poster: 1.5, zoom: 1.1 },
  { id: 'overfed-a', box: { w: 358, h: 150 }, poster: 1.9 },
  { id: 'overfed-b', box: { w: 358, h: 150 }, poster: 3.2 },
  { id: 'overfed-c', box: { w: 358, h: 150 }, poster: 1.1 },
]

export const scene = (id: SceneId): SceneCard => SCENES.find((s) => s.id === id) as SceneCard
