// Pompon's own look in the app — the ONE place it is decided (31.10). Every loader of a mascot entry imports this
// module together with the package (Mascot.tsx, WelcomeBunnies.tsx, TowerMoment.tsx, ListsBuddy.tsx, HomeIconScene.tsx),
// so it has run before the first puppet is built: a lazy chunk next to the package, never in a first screen.
//
// Fluffy cheeks (Felix 31.10, gallery «Эксперименты с Помпоном»: «наверное, только с щёчками лучше» — the cheeks
// alone, without ear tufts): every fawn bunny is Pompon — the mascot itself, the Lists buddy and every stage actor
// (welcome / "+" menu peeks, the carry, the chase, the tower, the home-screen icon, «Переел»). The other coats are
// his friends and stay as they are. The package's default is unchanged (@bunprise/mascot/fur, opt-in).
import { setBunnyFur } from '@bunprise/mascot/fur'

setBunnyFur({ fawn: ['cheeks'] })

export const POMPON_FUR = 'cheeks'
