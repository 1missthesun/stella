import { createContext, useContext } from "react";

export type ReplyHandoffIndicatorHandle = {
  shown: () => boolean;
  vacate: () => void;
};

export type ReplyHandoffRoom = {
  make: (heightPx: number) => Promise<void>;
  revealed: () => void;
  settle: (heightPx: number) => Promise<void>;
};

export function createReplyHandoffController() {
  let indicator: ReplyHandoffIndicatorHandle | null = null;
  let room: ReplyHandoffRoom | null = null;
  return {
    attachIndicator(handle: ReplyHandoffIndicatorHandle): () => void {
      indicator = handle;
      return () => {
        if (indicator === handle) indicator = null;
      };
    },
    attachRoom(next: ReplyHandoffRoom): () => void {
      room = next;
      return () => {
        if (room === next) room = null;
      };
    },
    canStage(): boolean {
      return Boolean(room && indicator?.shown());
    },
    land(heightPx: number, reveal: () => boolean) {
      const target = room;
      if (!target) {
        reveal();
        indicator?.vacate();
        return;
      }
      void target
        .make(heightPx)
        .catch(() => undefined)
        .then(() => {
          if (reveal()) {
            target.revealed();
            indicator?.vacate();
          }
          return target.settle(heightPx);
        });
    },
    replyArrived() {
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
