export const HISTORY_START_THRESHOLD_VIEWPORTS = 2;

export type HistoryScrollDirection = "up" | "down" | "none";

export type HistoryPaginationMetrics = {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
};

export type HistoryPaginationGuards = {
  hasMore: boolean;
  isLoading: boolean;
};

export type HistoryPaginationDecision = {
  request: boolean;
  reason:
    | "request"
    | "wrong-direction"
    | "outside-threshold"
    | "action-consumed"
    | "in-flight"
    | "end-of-history";
  thresholdVisible: boolean;
};

type RequestPhase = "idle" | "awaiting-loading" | "loading";

export class ChatHistoryPaginationGate {
  private readonly edge: "start" | "end";
  private consumedActionIds = new Set<number>();
  private requestPhase: RequestPhase = "idle";

  constructor(edge: "start" | "end" = "start") {
    this.edge = edge;
  }

  syncGuards(guards: HistoryPaginationGuards): {
    requestStarted: boolean;
    requestSettled: boolean;
  } {
    const previous = this.requestPhase;

    // Subscription re-keying briefly reports `hasMore=false` while retaining
    // the prior rows. Loading wins over that transient so the accepted request
    // cannot settle until its larger window actually resolves.
    if (guards.isLoading) {
      this.requestPhase = "loading";
    } else if (this.requestPhase === "loading") {
      this.requestPhase = "idle";
    } else if (!guards.hasMore) {
      this.requestPhase = "idle";
    }

    return {
      requestStarted:
        previous === "awaiting-loading" && this.requestPhase === "loading",
      requestSettled: previous !== "idle" && this.requestPhase === "idle",
    };
  }

  consider(
    actionId: number | null,
    direction: HistoryScrollDirection,
    metrics: HistoryPaginationMetrics,
    guards: HistoryPaginationGuards,
  ): HistoryPaginationDecision {
    this.syncGuards(guards);

    const edgeDistance =
      this.edge === "start"
        ? metrics.scrollTop
        : Math.max(
            0,
            metrics.contentHeight - metrics.viewportHeight - metrics.scrollTop,
          );
    const thresholdVisible =
      edgeDistance <=
      metrics.viewportHeight * HISTORY_START_THRESHOLD_VIEWPORTS;

    const requiredDirection = this.edge === "start" ? "up" : "down";
    if (direction !== requiredDirection || actionId === null) {
      return { request: false, reason: "wrong-direction", thresholdVisible };
    }
    if (!thresholdVisible) {
      return {
        request: false,
        reason: "outside-threshold",
        thresholdVisible,
      };
    }
    if (this.consumedActionIds.has(actionId)) {
      return {
        request: false,
        reason: "action-consumed",
        thresholdVisible,
      };
    }

    this.consumedActionIds.add(actionId);
    if (this.consumedActionIds.size > 64) {
      const oldest = this.consumedActionIds.values().next().value;
      if (oldest !== undefined) this.consumedActionIds.delete(oldest);
    }

    if (guards.isLoading || this.requestPhase !== "idle") {
      return { request: false, reason: "in-flight", thresholdVisible };
    }
    if (!guards.hasMore) {
      return {
        request: false,
        reason: "end-of-history",
        thresholdVisible,
      };
    }

    this.requestPhase = "awaiting-loading";
    return { request: true, reason: "request", thresholdVisible };
  }

  rejectRequest(): void {
    if (this.requestPhase === "awaiting-loading") {
      this.requestPhase = "idle";
    }
  }

  settleRequest(): void {
    this.requestPhase = "idle";
  }

  snapshot() {
    return {
      requestPhase: this.requestPhase,
      consumedActionIds: [...this.consumedActionIds],
    };
  }
}

export type ChatHistoryPaginationDebugEvent = {
  type: string;
  surface: "full" | "compact";
  detail: Record<string, unknown>;
};

export const emitChatHistoryPaginationDebug = (
  event: ChatHistoryPaginationDebugEvent,
): void => {
  if (typeof window === "undefined") return;
  const debugWindow = window as Window & {
    __STELLA_CHAT_PAGINATION_DEBUG__?: boolean;
  };
  if (!debugWindow.__STELLA_CHAT_PAGINATION_DEBUG__) return;
  window.dispatchEvent(
    new CustomEvent("stella:chat-history-pagination", { detail: event }),
  );
  console.debug("[chat-history-pagination]", event);
};
