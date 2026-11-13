/**
 * Layer root: where overlays (Sheet, Toast) portal into.
 *
 * Defaults to document.body. The dev PhoneFrame provides the phone "screen"
 * element instead, so overlays stay inside the simulated phone.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';

const LayerRootContext = createContext<HTMLElement | null>(null);

export const LayerRootProvider = LayerRootContext.Provider;

/** The element overlays should be portalled into (null during SSR / before mount). */
export function useLayerRoot(): HTMLElement | null {
  const provided = useContext(LayerRootContext);
  if (provided) return provided;
  return typeof document === 'undefined' ? null : document.body;
}

// How many sheets are open right now. Toasts move to the top while a sheet covers the bottom
// of the screen, so a confirmation never hides the sheet's buttons.
let openSheets = 0;
const sheetListeners = new Set<() => void>();

function emitSheets(): void {
  for (const listener of sheetListeners) listener();
}

/** Called by Sheet while it is open; returns the release function. */
export function registerOpenSheet(): () => void {
  openSheets += 1;
  emitSheets();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openSheets -= 1;
    emitSheets();
  };
}

function subscribeSheets(listener: () => void): () => void {
  sheetListeners.add(listener);
  return () => sheetListeners.delete(listener);
}

/** True while at least one sheet is open. */
export function useSheetOpen(): boolean {
  return useSyncExternalStore(subscribeSheets, () => openSheets > 0, () => false);
}
