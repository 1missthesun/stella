import { createContext, useContext } from "react";

export type ReplyHandoffIndicatorHandle = {
  shown: () => boolean;
  hold: () => void;
  vacate: () => void;
};

export type ReplyHandoffRoom = {
  make: (heightPx: number) => Promise<void>;
  revealed: () => void;
  settle: () => void;
};

const ROW_LAYOUT_TIMEOUT_MS = 300;

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
    holdIndicator() {
      indicator?.hold();
    },
    land(heightPx: number, reveal: () => boolean): () => void {
      const target = room;
      if (!target) {
        reveal();
        indicator?.vacate();
        return () => undefined;
      }
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        target.settle();
      };
      void target
        .make(heightPx)
        .catch(() => undefined)
        .then(() => {
          if (reveal()) {
            target.revealed();
            indicator?.vacate();
            timer = setTimeout(settle, ROW_LAYOUT_TIMEOUT_MS);
          } else {
            indicator?.vacate();
            settle();
          }
        });
      return settle;
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
