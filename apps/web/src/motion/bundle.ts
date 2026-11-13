// Lazy chunk with motion's feature bundle (see features.ts). domMax = animations + gestures + layout +
// drag: the Sheet's drag-to-dismiss needs `drag` (docs/contract-ui.md); it is a lazy chunk outside
// the initial budget (~26 KB gz).
export { domMax as default } from 'motion/react'
