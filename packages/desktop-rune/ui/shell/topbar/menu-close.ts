import { createContext, useContext } from "react";

const Close = createContext<() => void>(() => {});
export const MenuCloseProvider = Close.Provider;
export const usePanelClose = () => useContext(Close);
