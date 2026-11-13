import type { ComponentType } from 'react'
import { Canvas, Floor, Sparkle } from './kit'
import { BathsetArt, BlanketArt, CandleArt, HerbsArt, LampArt, LightsArt, MapArt, PillowArt, PlantArt, TubesArt } from './home'
import { BottleArt, GrinderArt, KnifeArt, PopcornArt, PouroverArt, SpicesArt, TeapotArt, ThermosArt, TongsArt } from './kitchen'
import {
  AlbumArt,
  BoardgameArt,
  BooksArt,
  CameraArt,
  CardsArt,
  ControllerArt,
  HeadphonesArt,
  LanternArt,
  OpenBookArt,
  PaintsArt,
  PowerbankArt,
  PuzzleArt,
  ScarfArt,
  SpeakerArt,
  ToteArt,
  UkuleleArt,
  VinylArt,
  YarnArt,
  YogaArt,
} from './leisure'

// The pictures of the demo products ("warm glass on paper": flat objects on a tinted card, our own
// drawings — never a shop's photo). `image_url` "/api/gift-ideas/demo-art/<id>" names one of these; the app
// draws it inline (no request). Anything without a picture gets the wrapped present.

export const DEMO_ART: Readonly<Record<string, ComponentType>> = {
  album: AlbumArt,
  bathset: BathsetArt,
  blanket: BlanketArt,
  boardgame: BoardgameArt,
  books: BooksArt,
  bottle: BottleArt,
  camera: CameraArt,
  candle: CandleArt,
  cards: CardsArt,
  controller: ControllerArt,
  grinder: GrinderArt,
  headphones: HeadphonesArt,
  herbs: HerbsArt,
  knife: KnifeArt,
  lamp: LampArt,
  lantern: LanternArt,
  lights: LightsArt,
  map: MapArt,
  openbook: OpenBookArt,
  paints: PaintsArt,
  pillow: PillowArt,
  plant: PlantArt,
  popcorn: PopcornArt,
  pourover: PouroverArt,
  powerbank: PowerbankArt,
  puzzle: PuzzleArt,
  scarf: ScarfArt,
  speaker: SpeakerArt,
  spices: SpicesArt,
  teapot: TeapotArt,
  thermos: ThermosArt,
  tongs: TongsArt,
  tote: ToteArt,
  tubes: TubesArt,
  ukulele: UkuleleArt,
  vinyl: VinylArt,
  yarn: YarnArt,
  yoga: YogaArt,
}

/**
 * The card tint each drawing looks best on (tile 1 apricot · 2 blush · 3 blue · 4 butter): never the
 * object's own colour family, so an orange scarf never melts into an apricot card.
 */
export const ART_TONE: Readonly<Record<string, 1 | 2 | 3 | 4>> = {
  album: 4,
  bathset: 3,
  blanket: 3,
  boardgame: 3,
  books: 4,
  bottle: 2,
  camera: 3,
  candle: 2,
  cards: 4,
  controller: 4,
  grinder: 3,
  headphones: 3,
  herbs: 4,
  knife: 2,
  lamp: 3,
  lantern: 2,
  lights: 3,
  map: 1,
  openbook: 3,
  paints: 3,
  pillow: 1,
  plant: 2,
  popcorn: 3,
  pourover: 3,
  powerbank: 1,
  puzzle: 2,
  scarf: 3,
  speaker: 1,
  spices: 2,
  teapot: 1,
  thermos: 2,
  tongs: 3,
  tote: 3,
  tubes: 3,
  ukulele: 3,
  vinyl: 4,
  yarn: 3,
  yoga: 2,
}

/** A wrapped present — for ideas without a picture (or one that failed to load). */
export function PresentArt() {
  return (
    <Canvas label="present">
      <Floor rx={34} />
      <rect x="26" y="50" width="68" height="50" rx="7" fill="var(--accent-300)" />
      <rect x="70" y="50" width="24" height="50" rx="6" fill="var(--accent-500)" opacity=".35" />
      <rect x="20" y="38" width="80" height="16" rx="5" fill="var(--accent-400)" />
      <rect x="20" y="38" width="80" height="5" rx="2.5" fill="var(--surface)" opacity=".4" />
      <rect x="54" y="38" width="12" height="62" fill="var(--surface)" opacity=".92" />
      <path d="M60 38 C54 24 38 20 36 28 C35 34 46 38 60 38 Z" fill="var(--tile-2-fg)" opacity=".86" />
      <path d="M60 38 C66 24 82 20 84 28 C85 34 74 38 60 38 Z" fill="var(--tile-2-fg)" opacity=".86" />
      <rect x="56" y="33" width="8" height="7" rx="2" fill="var(--tile-2-fg)" />
      <Sparkle x={100} y={26} r={5} />
      <Sparkle x={18} y={62} r={3.4} fill="var(--accent-500)" opacity={0.6} />
    </Canvas>
  )
}

export function DemoArt({ id }: { id: string }) {
  const Art = DEMO_ART[id] ?? PresentArt
  return <Art />
}
