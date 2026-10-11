import { createContext, useContext } from "react";

export type ReplyHandoffIndicatorHandle = {
  shown: () => boolean;
  vacate: () => void;
};

export function createReplyHandoffController() {
  let indicator: ReplyHandoffIndicatorHandle | null = null;
  let onArrival: (() => void) | null = null;
  return {
    setArrivalListener(listener: (() => void) | null) {
      onArrival = listener;
    },
    attachIndicator(handle: ReplyHandoffIndicatorHandle): () => void {
      indicator = handle;
      return () => {
        if (indicator === handle) indicator = null;
      };
    },
    replyArrived() {
      onArrival?.();
      if (indicator?.shown()) indicator.vacate();
    },
  };
}

export type ReplyHandoffController = ReturnType<
  typeof createReplyHandoffController
>;

export const ReplyHandoffContext =
  createContext<ReplyHandoffController | null>(null);

export function useReplyHandoffController(): ReplyHandoffController | null {
  return useContext(ReplyHandoffContext);
}
