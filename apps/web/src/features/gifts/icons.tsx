import { makeIcon } from '../../ui/iconBase'

// Small icons of "Geschenk finden" (own drawings on the kit's 24 px grid, 2 px round strokes; decorative —
// the control around them carries the accessible name). Kept here so the kit's icon module stays as it is.

/** Bent arrow back: undo the last verdict. */
export const IconUndo = /* @__PURE__ */ makeIcon('undo', 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11')
/** "i" in a circle: how the ideas come about. */
export const IconInfo = /* @__PURE__ */ makeIcon('info', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6h.01')
/** A little shop front: where to get it. */
export const IconShop = /* @__PURE__ */ makeIcon('shop', 'M3 7l2-3.5h14L21 7a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM4.5 10.5V20h15v-9.5M10 20v-5h4v5')
/** Two cards fanned with a plus: more like this. */
export const IconMoreLike = /* @__PURE__ */ makeIcon('more-like', 'M8 7.5V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-2M4 9.5A1.5 1.5 0 0 1 5.5 8h9A1.5 1.5 0 0 1 16 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 18.5zM10 11.5v5M7.5 14h5')
/** A bookmark: kept for someone. */
export const IconBookmark = /* @__PURE__ */ makeIcon('bookmark', 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z')
/** Sliders: fine-tune the budget. */
export const IconSliders = /* @__PURE__ */ makeIcon('sliders', 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5')
/** A magnifier: search inside a topic. */
export const IconSearch = /* @__PURE__ */ makeIcon('search', 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8')
