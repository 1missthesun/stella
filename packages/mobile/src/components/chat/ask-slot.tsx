import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

export type AskRoom = {
  belowTopBar: number;
  topBar: number;
  keyboardLift: SharedValue<number>;
  keyboardOpenLift: SharedValue<number>;
};

export type AskSlot = {
  collapsed: boolean;
  maxHeight: SharedValue<number> | null;
  naturalHeight: SharedValue<number> | null;
  expand: () => void;
};

const DEFAULT_ASK_SLOT: AskSlot = {
  collapsed: false,
  maxHeight: null,
  naturalHeight: null,
  expand: () => {},
};

export const AskSlotContext = createContext<AskSlot>(DEFAULT_ASK_SLOT);

export const useAskSlot = (): AskSlot => useContext(AskSlotContext);
