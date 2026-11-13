import type { BunnyCoat, StageEdge, WelcomePreset } from '@bunprise/mascot';
import { playsInApp } from './inGallery';

export type MomentFamily = 'create-menu' | 'screen-host:start' | 'screen-host:lists' | 'screen-host:gifts' | 'screen-host:profile' | 'surprise' | 'loading';
export interface DirectorPick {
  preset: WelcomePreset;
  coat: BunnyCoat;
  edge: StageEdge;
  special?: 'hamster' | 'chase' | 'jump-out' | 'calendar';
}
export interface DirectorContext { tab?: 'start' | 'lists' | 'gifts' | 'profile'; motion?: 'full' | 'reduced' | 'off'; requestKey?: string; placement?: 'illustration' | 'card-top' | 'compact-edge' }
const COATS: readonly BunnyCoat[] = ['fawn', 'choc', 'blue', 'himalayan', 'broken'];

/** One director per tab, with an injectable random source for reproducible tests. */
export function createDirector(random: () => number = Math.random) {
  const history = new Map<MomentFamily, { count: number; previous: string; requestKey?: string; pick: DirectorPick }>();
  return (family: MomentFamily, context: DirectorContext = {}): DirectorPick | null => {
    if (context.motion && context.motion !== 'full') return null;
    const last = history.get(family);
    // React StrictMode can evaluate an initializer twice. One logical opening gets one pick.
    if (context.requestKey && context.requestKey === last?.requestKey) return last.pick;
    const count = (last?.count ?? 0) + 1;
    const edge = count % 2 ? 'left' : 'right';
    let pool: Array<Pick<DirectorPick, 'preset' | 'special'>>;
    if (family === 'create-menu') {
      // The "+" menu is the bunny's place (Felix 22.10). Every opening — however often — is a lively moment that
      // starts hidden, comes in over the panel's own top edge (climbs out with its paws on the glass, hops along
      // it, or jumps out of the "+" behind the panel and climbs out) and ends (ducks away, or settles and
      // breathes). Not here: 'ears-only' and 'surprise' (the tall ears "look really bad"), a plain 'lift' (it
      // just sat there), side peeks 'corner-*' / 'meet' (over a floating panel they come "out of nothing"), the
      // hamster (he lives on his own screens).
      pool = [
        { preset: `climb-${edge}` },
        { preset: 'hop-across' },
        { preset: 'wave' },
        { preset: 'peek-once', special: 'jump-out' },
        context.tab === 'lists' ? { preset: 'peek-sniff' } : { preset: 'peek-sniff', special: 'calendar' },
      ];
    } else if (context.placement === 'illustration') {
      // A screen illustration reserves space in the layout. It must stay on its real bottom
      // card edge; a temporary side peek or runner leaves a blank hole after the show.
      pool = [{ preset: 'peek-once' }, { preset: 'wave' }, { preset: 'lift' }];
    } else if (context.placement === 'card-top') {
      // There is no vertical door frame above a feed card to hide a side peeker behind.
      pool = [{ preset: 'hop-across' }, { preset: 'pop-up' }, { preset: 'peek-sniff' }];
    } else if (context.placement === 'compact-edge') {
      // no 'ears-only' (22.10): the same tall ears without the bunny that Felix rejected in the "+" menu
      pool = [{ preset: 'pop-up' }, { preset: 'peek-sniff' }];
    } else if (family === 'loading') pool = [playsInApp('chase') ? { preset: 'peek-sniff', special: 'chase' } : { preset: 'peek-sniff' }];
    else if (family === 'surprise') pool = [{ preset: 'surprise' }, { preset: `corner-${edge}` }];
    else if (family === 'screen-host:lists') pool = [{ preset: 'peek-once', special: 'hamster' }, { preset: 'peek-side', special: 'hamster' }];
    else pool = [{ preset: `corner-${edge}` }, { preset: 'peek-sniff' }, { preset: 'hop-across' }];
    const key = (p: Pick<DirectorPick, 'preset' | 'special'>) => `${p.preset}:${p.special ?? ''}`;
    const candidates = pool.filter((p) => key(p) !== last?.previous);
    const choices = candidates.length ? candidates : pool;
    const selected = choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))]!;
    const coats = family === 'screen-host:profile' ? COATS.slice(1) : COATS;
    const pick: DirectorPick = { ...selected, edge, coat: coats[(count - 1) % coats.length]! };
    history.set(family, { count, previous: key(selected), ...(context.requestKey ? { requestKey: context.requestKey } : {}), pick });
    return pick;
  };
}

export const pickMoment = createDirector();
