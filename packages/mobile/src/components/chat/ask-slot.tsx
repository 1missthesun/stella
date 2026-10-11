import { createContext, useContext } from "react";

export type AskSlot = {
  collapsed: boolean;
  maxHeight: number | null;
  expand: () => void;
};

const DEFAULT_ASK_SLOT: AskSlot = {
  collapsed: false,
  maxHeight: null,
  expand: () => {},
};

export const AskSlotContext = createContext<AskSlot>(DEFAULT_ASK_SLOT);

export const useAskSlot = (): AskSlot => useContext(AskSlotContext);
