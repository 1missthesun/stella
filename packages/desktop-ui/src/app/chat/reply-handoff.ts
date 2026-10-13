import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

export type ReplyHandoffIndicatorHandle = {
  shown: () => boolean;
  vacate: () => void;
  exit: () => void;
  /** Lets an indicator a reply vacated show again. */
  release: () => void;
};

const HANDOFF_WAIT_MS = 600;
const RUN_END_WAIT_MS = 80;

export function createReplyHandoffController() {
  let indicator: ReplyHandoffIndicatorHandle | null = null;
  let deactivation: number | null = null;

  const clearDeactivation = () => {
    if (deactivation === null) return;
    window.clearTimeout(deactivation);
    deactivation = null;
  };

  return {
    attachIndicator(handle: ReplyHandoffIndicatorHandle): () => void {
      indicator = handle;
      return () => {
        if (indicator !== handle) return;
        indicator = null;
        clearDeactivation();
      };
    },
    indicatorDeactivated(handoff: boolean) {
      if (deactivation !== null) return;
      deactivation = window.setTimeout(
        () => {
          deactivation = null;
          indicator?.exit();
        },
        handoff ? HANDOFF_WAIT_MS : RUN_END_WAIT_MS,
      );
    },
    indicatorReactivated() {
      clearDeactivation();
    },
    /** The user sent a message: what follows is new work, not the reply's. */
    userMessageSent() {
      indicator?.release();
    },
    replyArrived() {
      if (!indicator?.shown()) return;
      clearDeactivation();
      indicator.vacate();
    },
  };
}

export type ReplyHandoffController = ReturnType<
  typeof createReplyHandoffController
>;

export const ReplyHandoffContext = createContext<ReplyHandoffController | null>(
  null,
);

export function useReplyHandoffController(): ReplyHandoffController | null {
  return useContext(ReplyHandoffContext);
}

export function useReplyHandoffArrival(
  rowRef: RefObject<HTMLElement | null>,
  justArrived: boolean,
  finalAnswer: boolean,
) {
  const controller = useReplyHandoffController();
  const arrivedOnMountRef = useRef(justArrived && finalAnswer);
  useLayoutEffect(() => {
    if (!controller || !rowRef.current || !arrivedOnMountRef.current) return;
    controller.replyArrived();
  }, [controller, rowRef]);
}
