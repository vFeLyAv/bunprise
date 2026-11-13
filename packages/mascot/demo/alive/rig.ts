// «Живые анимации» — approved 31.10 and moved into the package (src/alive/rig.ts, entry @bunprise/mascot/alive).
// The gallery page ?screens=alive keeps importing it from here; its own puppets also carry the archived flop's lying
// drawing (./lying.ts, shown only with &archive=1).
import { mountAlive as mountPackage, type AliveRig, type RigOptions } from '../../src/alive/rig';
import { lyingCss, lyingMarkup } from './lying';

export * from '../../src/alive/rig';

/** The package's mountAlive, with the archived flop's lying drawing in the puppet. */
export function mountAlive(parent: HTMLElement, o: RigOptions): AliveRig {
  return mountPackage(parent, { ...o, lying: { css: lyingCss(), markup: lyingMarkup } });
}
