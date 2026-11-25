import { createContext, useContext } from "react";

/** Where menus and popovers are drawn; null is the page's own body. */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export const usePortalContainer = (): HTMLElement | undefined =>
  useContext(PortalContainerContext) ?? undefined;
