// Scenes that live ONLY in the mascot gallery (packages/mascot/demo, port 5180) while they are being worked on.
// Felix 23.10: "remove them until they look right, harmonious and beautiful; work on them separately, where all
// the other animations are — and the same for every new animation". The app never plays a scene on this list:
// every place that would show one shows its calm alternative instead (and MoveMoment renders nothing for it, as a
// safety net). A scene comes back into the app by leaving this list — only after Felix approved it in the gallery.
// A single variant can be held back as `<scene>-<variant>` (e.g. 'overfed-c').
//
// History: 23.10 chase + overfed went to the gallery; 24.10 Felix approved the reworked chase and all three
// «Переел» variants ("мне нравятся все, их можно в разных моментах использовать") — variant C waits for its eye
// fix; "Откусил кусочек" (nibble) went to the gallery ("абсолютно не готова и сырая"). 24.10 later: C's eyes fixed
// (Firefox paint of same-offset keyframes), Felix: "все ок с глазами" → C plays for the 5th own wish in a row.
// 27.10: Felix approved five new ones from the gallery (26.10) — each place asks playsInApp(name), so any of them can
// go back here by name: 'secret' (Tapsi «Psst», the reservation moment), 'speck' (Tapsi «Пылинка на линзе», empty
// "Freunde"), 'tower' («Парад» v2, the Profil easter egg), 'homeicon' («Здесь я буду жить», onboarding Home-Bildschirm),
// 'footing' («Твёрдая почва», the Lists buddy at a card's edge).
// 31.10: «Ночью маскоты спят» ('night', Felix: «спящие норм, оставляем») — 23:00 – 07:00 Pompon on the first Start
// card, the Lists buddy, Tapsi in "Freunde" sleep (a tap wakes them) and the "+" menu plays `sleepy` (mascot-ui/night.ts).
// 31.10: «Помпон в открытом списке» (Felix: «Мне все анимации нравятся») — each moment by name: 'list-stroke',
// 'list-boop', 'list-ear' (on every Pompon), 'shake' (every Pompon), 'list-wish', 'list-received', 'list-delete',
// 'list-select', 'list-end', 'list-empty' (the gift box; held back = the sleeping hamster again) — wishes/listPlay.ts.
// 31.10: «Живые анимации» (Felix: «Всё остальное хорошо»; flop and slump dropped) — all with 'alive', one by name:
// 'alive-groom', 'alive-periscope', 'alive-stretch', 'alive-loaf', 'alive-sneeze', 'alive-dig', 'alive-hwash',
// 'alive-post' (mascot-ui/alive.ts: the Lists buddy, Pompon awake on the Start corner).

const GALLERY_ONLY: ReadonlySet<string> = new Set([
  'nibble', // "Откусил кусочек" — the rare Start surprise (the chase plays there instead)
])

/** Whether the app may play this scene (or this `<scene>-<variant>`); false = it is still in the gallery. */
export function playsInApp(scene: string, variant?: string): boolean {
  return !GALLERY_ONLY.has(scene) && (variant === undefined || !GALLERY_ONLY.has(`${scene}-${variant}`))
}
