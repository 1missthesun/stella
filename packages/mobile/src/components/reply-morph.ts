import { createContext, useContext } from "react";
import type { WorkingIndicatorCharacterState } from "./working-indicator-character";

export type ReplyMorphSnapshot = {
  width: number;
  height: number;
  characterState: WorkingIndicatorCharacterState;
  label: string;
};

export type ReplyMorphIndicatorHandle = {
  snapshot: () => ReplyMorphSnapshot | null;
  vacate: () => void;
};

export function createReplyMorphController() {
  let indicator: ReplyMorphIndicatorHandle | null = null;
  return {
    attachIndicator(handle: ReplyMorphIndicatorHandle): () => void {
      indicator = handle;
      return () => {
        if (indicator === handle) indicator = null;
      };
    },
    peek(): ReplyMorphSnapshot | null {
      return indicator?.snapshot() ?? null;
    },
    vacate() {
      indicator?.vacate();
    },
  };
}

export type ReplyMorphController = ReturnType<
  typeof createReplyMorphController
>;

export const ReplyMorphContext = createContext<ReplyMorphController | null>(
  null,
);

export function useReplyMorphController(): ReplyMorphController | null {
  return useContext(ReplyMorphContext);
}
