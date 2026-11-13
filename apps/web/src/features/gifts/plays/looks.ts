import type { GameLook } from './newscenes';
import type { TileDetail, TileSpec } from './scenes';

/**
 * Which animation each board game gets (ported from the approved gallery, packages/mascot/demo/ideas/plays.ts):
 * its archetype (scenes.ts) and its own look — colours, tile shape, token. Keyed by the catalogue id
 * (workers/edge/src/giftIdeas/catalog.de.json); a game without an entry shows its drawing instead. A test keeps this
 * list = the Worker's games with facts. Since 30.10 a look can also name one of the scenes of newscenes.ts (the seven
 * Kosmos games and the iconic classics, approved by Felix in the gallery: packages/mascot/demo/ideas/newgames.ts).
 */

const T = (color: string, detail: TileDetail): TileSpec => ({ color, detail });

export const LOOKS: Readonly<Record<string, GameLook>> = {
  'cat:hig-carcassonne': { archetype: 'tiles', shape: 'square', tiles: [T('var(--gift-leaf-light)', 'city'), T('var(--gift-leaf-light)', 'road'), T('var(--gift-leaf-light)', 'field'), T('var(--gift-leaf-light)', 'road')], token: 'meeple', tokenColor: 'var(--gift-clay)' },
  'cat:dow-zug-um-zug': { archetype: 'route', wagon: 'var(--gift-clay)', cards: ['var(--gift-clay)', 'var(--gift-sky-dark)', 'var(--gift-leaf)'] },
  'cat:cge-codenames': { archetype: 'words', variant: 'codenames' },
  'cat:libellud-dixit': { archetype: 'words', variant: 'dixit' },
  'cat:nextmove-azul': { archetype: 'pattern', variant: 'azul' },
  'cat:feuerland-fluegelschlag': { archetype: 'pattern', variant: 'birds' },
  'cat:pegasus-kingdomino': { archetype: 'tiles', shape: 'square', tiles: [T('var(--gift-butter)', 'wheat'), T('var(--gift-leaf)', 'tree'), T('var(--gift-sky)', 'wave'), T('var(--gift-leaf-dark)', 'tree')], token: 'crown', tokenColor: 'var(--gift-butter-dark)' },
  'cat:repos-7-wonders-duel': { archetype: 'pattern', variant: 'wonders' },
  'cat:schmidt-quacksalber': { archetype: 'luck', variant: 'cauldron' },
  'cat:kosmos-cascadia': { archetype: 'tiles', shape: 'hex', tiles: [T('var(--gift-leaf)', 'tree'), T('var(--gift-sky)', 'wave'), T('var(--gift-steel)', 'rock'), T('var(--gift-butter)', 'wheat')], token: 'animal', tokenColor: 'var(--gift-clay)' },
  'cat:pegasus-dorfromantik': { archetype: 'tiles', shape: 'hex', tiles: [T('var(--gift-leaf)', 'tree'), T('var(--gift-butter)', 'wheat'), T('var(--gift-sky)', 'wave'), T('var(--gift-leaf-light)', 'house')], token: 'flag', tokenColor: 'var(--gift-rose-dark)' },
  'cat:repos-just-one': { archetype: 'words', variant: 'justone' },
  'cat:cocktail-hanabi': { archetype: 'coop', variant: 'hanabi' },
  'cat:nsv-the-mind': { archetype: 'coop', variant: 'mind' },
  'cat:spacecowboys-skull': { archetype: 'luck', variant: 'discs' },
  'cat:amigo-wizard': { archetype: 'luck', variant: 'trick' },
  'cat:zman-challengers': { archetype: 'luck', variant: 'duel' },
  'cat:jumbo-hitster': { archetype: 'music', variant: 'timeline' },
  'cat:kosmos-exit-verlassene-huette': { archetype: 'coop', variant: 'lock' },
  'cat:pegasus-everdell': { archetype: 'pattern', variant: 'city' },
  'cat:pegasus-bomb-busters': { archetype: 'coop', variant: 'wires' },
  'cat:gamefactory-dito': { archetype: 'words', variant: 'dito' },
  'cat:frosted-rebirth': { archetype: 'tiles', shape: 'hex', tiles: [T('var(--gift-leaf-light)', 'field'), T('var(--gift-sky)', 'wave'), T('var(--gift-wood-light)', 'rock'), T('var(--gift-leaf-light)', 'house')], token: 'house', tokenColor: 'var(--gift-clay-dark)' },
  'cat:schmidt-ganz-schoen-clever': { archetype: 'dice', variant: 'clever' },
  // 27.10: ten more games (docs/research/2026-10-27-board-games-2.md)
  'cat:schmidt-qwirkle': { archetype: 'pattern', variant: 'azul' },
  'cat:pegasus-next-station-london': { archetype: 'route', wagon: 'var(--gift-sky-dark)', cards: ['var(--gift-rose-dark)', 'var(--gift-leaf)', 'var(--gift-butter-dark)'] },
  'cat:topp-krakel-orakel': { archetype: 'words', variant: 'dixit' },
  'cat:cocktail-top-ten': { archetype: 'coop', variant: 'mind' },
  'cat:zman-love-letter': { archetype: 'luck', variant: 'duel' },
  'cat:nsv-qwixx': { archetype: 'dice', variant: 'clever' },
  'cat:feuerland-arche-nova': { archetype: 'tiles', shape: 'hex', tiles: [T('var(--gift-leaf)', 'tree'), T('var(--gift-sky)', 'wave'), T('var(--gift-steel)', 'rock'), T('var(--gift-butter)', 'field')], token: 'animal', tokenColor: 'var(--gift-butter-dark)' },
  'cat:dow-heat': { archetype: 'route', wagon: 'var(--gift-rose-dark)', cards: ['var(--gift-butter-dark)', 'var(--gift-sky-dark)', 'var(--gift-steel-dark)'] },
  'cat:kosmos-targi': { archetype: 'tiles', shape: 'square', tiles: [T('var(--gift-butter)', 'rock'), T('var(--gift-butter)', 'wheat'), T('var(--gift-wood-light)', 'house'), T('var(--gift-butter)', 'field')], token: 'meeple', tokenColor: 'var(--gift-sky-dark)' },
  'cat:amigo-6-nimmt': { archetype: 'luck', variant: 'trick' },
  // 30.10: the seven Kosmos games (scenes of newscenes.ts, approved in the gallery «Neue Spiele 30.10»)
  'cat:kosmos-sky-team': { archetype: 'coop', scene: 'cockpit' },
  'cat:kosmos-die-crew': { archetype: 'coop', scene: 'crew' },
  'cat:kosmos-flip-7': { archetype: 'luck', scene: 'flip' },
  'cat:kosmos-catan-big-box': { archetype: 'dice', scene: 'catan' },
  'cat:kosmos-cities': { archetype: 'tiles', scene: 'district' },
  'cat:kosmos-wildwuchs': { archetype: 'pattern', scene: 'garden' },
  'cat:kosmos-happy-holiday': { archetype: 'pattern', scene: 'planner' },
  // 30.10: the iconic classics (docs/handoffs/2026-10-30-iconic-games.md)
  'cat:hasbro-monopoly': { archetype: 'board', scene: 'street' },
  'cat:mattel-uno': { archetype: 'shed', scene: 'colors' },
  'cat:schmidt-mensch-aergere-dich-nicht': { archetype: 'board', scene: 'ludo' },
  'cat:hasbro-cluedo': { archetype: 'board', scene: 'detective' },
  'cat:schmidt-kniffel': { archetype: 'dice', scene: 'yahtzee' },
  'cat:jumbo-rummikub': { archetype: 'shed', scene: 'rummy' },
  'cat:zygomatic-dobble': { archetype: 'words', scene: 'spot' },
  'cat:piatnik-activity': { archetype: 'words', scene: 'activity' },
  'cat:mattel-scrabble': { archetype: 'words', scene: 'letters' },
  'cat:hasbro-jenga': { archetype: 'stack', scene: 'tower' },
};

/** The slide's tint per archetype (tiles.css --tile-1…4), as in the gallery (newgames.ts NEW_TONE). */
export const ARCH_TONE: Readonly<Record<GameLook['archetype'], 1 | 2 | 3 | 4>> = { tiles: 1, route: 3, pattern: 4, words: 2, dice: 4, coop: 3, luck: 1, music: 2, board: 3, stack: 1, shed: 2 };

export function lookOf(id: string): GameLook | null {
  return LOOKS[id] ?? null;
}
