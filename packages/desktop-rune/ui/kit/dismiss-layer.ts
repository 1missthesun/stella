import { createContext, useContext } from "react";

/** Closes the innermost open overlay (dialog, menu, popover, panel): Radix's DismissableLayer takes Escape in the capture phase, before any field inside it sees the key. */
export const DismissLayer = createContext<(() => void) | null>(null);
export const useDismissLayer = () => useContext(DismissLayer);
