import { createContext, useContext } from "react";
import type { WindowSnapshot } from "../../host/electron/browser-window";
import type { ElectronApi } from "../../host/services/renderer-api";

/** The window an aux tree (companion, overlay) draws into, and that window's own `electronAPI`. */
export type AuxWindow = { snapshot: WindowSnapshot; api: ElectronApi | null };

const Context = createContext<AuxWindow | null>(null);
export const AuxWindowProvider = Context.Provider;

export function useAuxWindow(): AuxWindow {
  const value = useContext(Context);
  if (!value) throw new Error("useAuxWindow outside an aux window");
  return value;
}
