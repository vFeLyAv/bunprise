interface ModalLayerState {
  panels: HTMLElement[];
  originalInert: Map<Element, boolean>;
  lock: HTMLElement;
  overflow: string;
}
const modalLayers = new Map<HTMLElement, ModalLayerState>();

/** Keep only the top sheet interactive. Reference ownership prevents a closing lower sheet from
 * unlocking the background or making a still-open sheet inert. Existing external inert is preserved.
 * Kept with Sheet, separate from the tiny layers module used by the shell and toast host. */
export function registerSheetLayer(container: HTMLElement, layer: HTMLElement): () => void {
  let state = modalLayers.get(layer);
  if (!state) {
    const lock = layer === document.body ? document.documentElement : layer;
    state = { panels: [], originalInert: new Map(), lock, overflow: lock.style.overflow };
    modalLayers.set(layer, state);
  }
  const current = state;
  current.panels.push(container);
  const apply = () => {
    const top = current.panels.at(-1);
    for (const element of Array.from(layer.children)) {
      if (!current.originalInert.has(element)) current.originalInert.set(element, element.hasAttribute('inert'));
      element.toggleAttribute('inert', element !== top || current.originalInert.get(element) === true);
    }
    current.lock.style.overflow = 'hidden';
  };
  apply();
  return () => {
    const index = current.panels.indexOf(container);
    if (index < 0) return;
    current.panels.splice(index, 1);
    if (current.panels.length) apply();
    else {
      for (const [element, inert] of current.originalInert) element.toggleAttribute('inert', inert);
      current.lock.style.overflow = current.overflow;
      modalLayers.delete(layer);
    }
  };
}
