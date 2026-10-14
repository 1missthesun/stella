import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { subscribeChatContentGrowth } from "@/shell/chat-scroll-follow";
import {
  AT_BOTTOM_TOLERANCE_PX,
  shouldFollowSend,
} from "@/shell/chat-follow-target";
import {
  captureChatPrependAnchor,
  ChatHistoryPaginationGate,
  ChatPrependAnchorStabilizer,
  emitChatHistoryPaginationDebug,
  restoreChatPrependAnchor,
  type ChatPrependAnchor,
  type HistoryPaginationMetrics,
  type HistoryScrollDirection,
} from "@/shell/chat-history-pagination";

const SCROLL_BUTTON_THRESHOLD = 180;
const THUMB_MIN_HEIGHT = 24;
const THUMB_FADE_MS = 1200;
const MANUAL_SCROLL_SETTLE_MS = 140;
const THUMB_EPSILON_PX = 0.5;

const FOLLOW_SPRING_STIFFNESS = 0.00026;
const FOLLOW_SPRING_DAMPING = 0.0322;
const FOLLOW_STREAM_IDLE_MS = 200;
const FOLLOW_MAX_FRAME_MS = 48;
const FOLLOW_DEFAULT_FRAME_MS = 16;
const FOLLOW_HARD_SNAP_PX = 240;
const FOLLOW_GENTLE_LERP_FACTOR = 0.12;
/**
 * Minimum per-frame step when the lerp would otherwise produce a
 * sub-pixel movement. Prevents the loop from stalling near the target
 * because of scrollTop rounding (most engines floor to integer at
 * the OS-compositor boundary even when CSS-side scrollTop accepts
 * fractions).
 */
const FOLLOW_MIN_STEP_PX = 0.5;

const FOLLOW_REARM_THRESHOLD_PX = 24;

const isTextEditingTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    ),
  );

type ChatScrollSurface = "full" | "compact";

type ChatScrollManagementOptions = {
  hasOlderEvents?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => boolean | void | Promise<boolean>;
  hasNewerEvents?: boolean;
  isLoadingNewer?: boolean;
  onLoadNewer?: () => boolean | void | Promise<boolean>;
  onLoadLatest?: () => boolean | void | Promise<boolean>;
  paginationKey?: string | null;
  surface?: ChatScrollSurface;
};

type FollowTargetOptions = {
  gentle?: boolean;
};

type FollowApi = {
  setTarget: (target: number, options?: FollowTargetOptions) => void;
  nudgeBy: (delta: number) => void;
  followToEnd: () => void;
  cancel: () => void;
};

export function useChatScrollManagement({
  hasOlderEvents = false,
  isLoadingOlder = false,
  onLoadOlder,
  hasNewerEvents = false,
  isLoadingNewer = false,
  onLoadNewer,
  onLoadLatest,
  paginationKey = null,
  surface = "full",
}: ChatScrollManagementOptions = {}) {
  const onListRefChange = useRef<(() => void) | null>(null);
  const listRef = useMemo(() => {
    let value: LegendListRef | null = null;
    return {
      get current() {
        return value;
      },
      set current(next: LegendListRef | null) {
        value = next;
        onListRefChange.current?.();
      },
    };
  }, []);
  const attachedScrollNodeRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(false);
  const paginationGateRef = useRef(new ChatHistoryPaginationGate());
  const newerPaginationGateRef = useRef(new ChatHistoryPaginationGate("end"));
  const paginationActionIdRef = useRef(0);
  const prependAnchorRef = useRef<{
    node: HTMLElement;
    anchor: ChatPrependAnchor;
    gate: ChatHistoryPaginationGate;
    cancelledByUser: boolean;
  } | null>(null);
  const prependRestoreRafRef = useRef<number | null>(null);
  const anchorStabilizerRef = useRef<ChatPrependAnchorStabilizer | null>(null);
  const jumpToLatestPendingRef = useRef(false);
  const historyOptionsRef = useRef({
    hasOlderEvents,
    isLoadingOlder,
    onLoadOlder,
    hasNewerEvents,
    isLoadingNewer,
    onLoadNewer,
    onLoadLatest,
  });
  historyOptionsRef.current = {
    hasOlderEvents,
    isLoadingOlder,
    onLoadOlder,
    hasNewerEvents,
    isLoadingNewer,
    onLoadNewer,
    onLoadLatest,
  };
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [paginationCompletionVersion, setPaginationCompletionVersion] =
    useState(0);

  useEffect(() => {
    paginationGateRef.current = new ChatHistoryPaginationGate();
    newerPaginationGateRef.current = new ChatHistoryPaginationGate("end");
    prependAnchorRef.current = null;
    jumpToLatestPendingRef.current = false;
    anchorStabilizerRef.current?.stop();
    anchorStabilizerRef.current = null;
    if (prependRestoreRafRef.current !== null) {
      cancelAnimationFrame(prependRestoreRafRef.current);
      prependRestoreRafRef.current = null;
    }
  }, [paginationKey]);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const thumbElRef = useRef<HTMLDivElement | null>(null);
  const thumbVisibleRef = useRef(false);
  const thumbTopRef = useRef(0);
  const thumbHeightRef = useRef(0);
  const setThumbRef = useCallback((el: HTMLDivElement | null) => {
    thumbElRef.current = el;
  }, []);
  const thumbFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollStateRafRef = useRef<number | null>(null);
  const isAtBottomRef = useRef(true);
  const isNearBottomRef = useRef(true);
  const showScrollButtonRef = useRef(false);
  const isUserScrollingRef = useRef(false);
  const manualScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const noteManualScroll = useCallback(() => {
    if (!isUserScrollingRef.current) {
      isUserScrollingRef.current = true;
      setIsUserScrolling(true);
    }
    if (manualScrollTimerRef.current) {
      clearTimeout(manualScrollTimerRef.current);
    }
    manualScrollTimerRef.current = setTimeout(() => {
      manualScrollTimerRef.current = null;
      if (!isUserScrollingRef.current) return;
      isUserScrollingRef.current = false;
      setIsUserScrolling(false);
    }, MANUAL_SCROLL_SETTLE_MS);
  }, []);

  const followRef = useRef(true);
  const isFollowingLatestRef = useRef(true);
  const followRearmBlockedRef = useRef(false);

  const setFollow = useCallback((following: boolean) => {
    if (following) followRearmBlockedRef.current = false;
    if (
      followRef.current === following &&
      isFollowingLatestRef.current === following
    ) {
      return;
    }
    followRef.current = following;
    isFollowingLatestRef.current = following;
    setIsFollowingLatest(following);
  }, []);

  const followApi = useRef<FollowApi | null>(null);

  const hideThumb = useCallback(() => {
    if (!thumbVisibleRef.current) return;
    thumbVisibleRef.current = false;
    thumbElRef.current?.classList.remove("chat-scrollbar__thumb--visible");
  }, []);

  const updateThumb = useCallback(
    (scroll: number, scrollLength: number, contentLength: number) => {
      const el = thumbElRef.current;
      if (!el) return;
      if (contentLength <= scrollLength || scrollLength <= 0) {
        hideThumb();
        return;
      }

      const ratio = scrollLength / contentLength;
      const thumbHeight = Math.max(THUMB_MIN_HEIGHT, ratio * scrollLength);
      const maxScroll = Math.max(1, contentLength - scrollLength);
      const progress = Math.max(0, Math.min(1, scroll / maxScroll));
      const maxThumbTop = Math.max(0, scrollLength - thumbHeight);
      const thumbTop = progress * maxThumbTop;

      if (
        !thumbVisibleRef.current ||
        Math.abs(thumbTopRef.current - thumbTop) >= THUMB_EPSILON_PX ||
        Math.abs(thumbHeightRef.current - thumbHeight) >= THUMB_EPSILON_PX
      ) {
        thumbTopRef.current = thumbTop;
        thumbHeightRef.current = thumbHeight;
        el.style.top = `${thumbTop}px`;
        el.style.height = `${thumbHeight}px`;
      }
      if (!thumbVisibleRef.current) {
        thumbVisibleRef.current = true;
        el.classList.add("chat-scrollbar__thumb--visible");
      }

      if (thumbFadeRef.current) clearTimeout(thumbFadeRef.current);
      thumbFadeRef.current = setTimeout(hideThumb, THUMB_FADE_MS);
    },
    [hideThumb],
  );

  /**
   * Coalesce native scroll events without wiring Legend's public `onScroll`
   * prop. On web that prop builds a React Native-shaped event by reading the
   * content element's `scrollHeight`/`scrollWidth` every frame; those reads
   * force layout while virtualized markdown rows are mounting. We only need
   * Legend's already-maintained state snapshot, so listening passively on the
   * actual scroll node avoids that duplicate geometry pass.
   */
  const scheduleScrollStateUpdate = useCallback(() => {
    if (scrollStateRafRef.current !== null) return;
    scrollStateRafRef.current = requestAnimationFrame(() => {
      scrollStateRafRef.current = null;
      const list = listRef.current;
      if (!list) return;
      const state = list.getState();
      const { scroll, scrollLength, contentLength, isAtEnd } = state;
      const distFromEnd = Math.max(0, contentLength - scrollLength - scroll);
      const shouldShowScrollButton = distFromEnd > SCROLL_BUTTON_THRESHOLD;
      const nearBottom = isAtEnd || distFromEnd <= AT_BOTTOM_TOLERANCE_PX;

      if (isAtBottomRef.current !== isAtEnd) {
        isAtBottomRef.current = isAtEnd;
        setIsAtBottom(isAtEnd);
      }
      if (isNearBottomRef.current !== nearBottom) {
        isNearBottomRef.current = nearBottom;
        setIsNearBottom(nearBottom);
      }
      if (showScrollButtonRef.current !== shouldShowScrollButton) {
        showScrollButtonRef.current = shouldShowScrollButton;
        setShowScrollButton(shouldShowScrollButton);
      }
      updateThumb(scroll, scrollLength, contentLength);

      if (
        !followRearmBlockedRef.current &&
        (isAtEnd || distFromEnd <= FOLLOW_REARM_THRESHOLD_PX)
      ) {
        setFollow(true);
      }
    });
  }, [listRef, setFollow, updateThumb]);

  const scrollToBottom = useCallback(
    (behavior: "instant" | "smooth" = "smooth") => {
      setFollow(true);
      // Legend's own scrollToEnd owns this motion; cancel any lerp
      // so we don't write scrollTop on the same frame Legend does.
      followApi.current?.cancel();
      const history = historyOptionsRef.current;
      if (history.hasNewerEvents) {
        if (!history.onLoadLatest) return;
        jumpToLatestPendingRef.current = true;
        try {
          const accepted = history.onLoadLatest();
          if (accepted instanceof Promise) {
            void accepted.then(
              (succeeded) => {
                if (!succeeded) jumpToLatestPendingRef.current = false;
              },
              () => {
                jumpToLatestPendingRef.current = false;
              },
            );
          } else if (
            accepted === false &&
            !history.isLoadingOlder &&
            !history.isLoadingNewer &&
            paginationGateRef.current.snapshot().requestPhase === "idle" &&
            newerPaginationGateRef.current.snapshot().requestPhase === "idle"
          ) {
            jumpToLatestPendingRef.current = false;
          }
        } catch {
          jumpToLatestPendingRef.current = false;
        }
        return;
      }
      void listRef.current?.scrollToEnd({ animated: behavior !== "instant" });
    },
    [listRef, setFollow],
  );

  const getIsFollowing = useCallback(() => followRef.current, []);

  const getShouldFollowSend = useCallback(() => {
    const node =
      attachedScrollNodeRef.current ?? listRef.current?.getScrollableNode();
    if (!node) return followRef.current;
    const distanceFromBottomPx = Math.max(
      0,
      node.scrollHeight - node.clientHeight - node.scrollTop,
    );
    return shouldFollowSend({
      distanceFromBottomPx,
      isFollowingLatest: followRef.current,
    });
  }, [listRef]);

  const getIsEffectivelyAtBottom = useCallback(() => {
    const node =
      attachedScrollNodeRef.current ?? listRef.current?.getScrollableNode();
    if (!node) return isNearBottomRef.current;
    const distanceFromBottomPx = Math.max(
      0,
      node.scrollHeight - node.clientHeight - node.scrollTop,
    );
    return distanceFromBottomPx <= AT_BOTTOM_TOLERANCE_PX;
  }, [listRef]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (thumbFadeRef.current) clearTimeout(thumbFadeRef.current);
      if (manualScrollTimerRef.current) {
        clearTimeout(manualScrollTimerRef.current);
        manualScrollTimerRef.current = null;
      }
      if (scrollStateRafRef.current !== null) {
        cancelAnimationFrame(scrollStateRafRef.current);
        scrollStateRafRef.current = null;
      }
      if (prependRestoreRafRef.current !== null) {
        cancelAnimationFrame(prependRestoreRafRef.current);
        prependRestoreRafRef.current = null;
      }
      anchorStabilizerRef.current?.stop();
      anchorStabilizerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const olderTransition = paginationGateRef.current.syncGuards({
      hasMore: hasOlderEvents,
      isLoading: isLoadingOlder,
    });
    const newerTransition = newerPaginationGateRef.current.syncGuards({
      hasMore: hasNewerEvents,
      isLoading: isLoadingNewer,
    });
    if (
      jumpToLatestPendingRef.current &&
      hasNewerEvents &&
      !isLoadingOlder &&
      !isLoadingNewer
    ) {
      const loadLatest = historyOptionsRef.current.onLoadLatest;
      if (!loadLatest) {
        jumpToLatestPendingRef.current = false;
      } else {
        try {
          const accepted = loadLatest();
          if (accepted instanceof Promise) {
            void accepted.then(
              (succeeded) => {
                if (!succeeded) jumpToLatestPendingRef.current = false;
              },
              () => {
                jumpToLatestPendingRef.current = false;
              },
            );
          } else if (accepted === false) {
            jumpToLatestPendingRef.current = false;
          }
        } catch {
          jumpToLatestPendingRef.current = false;
        }
      }
    }
    if (jumpToLatestPendingRef.current && !hasNewerEvents && !isLoadingNewer) {
      jumpToLatestPendingRef.current = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          void listRef.current?.scrollToEnd({ animated: false });
        });
      });
    }
    emitChatHistoryPaginationDebug({
      type: "guards",
      surface,
      detail: {
        hasMore: hasOlderEvents,
        isLoading: isLoadingOlder,
        hasNewer: hasNewerEvents,
        isLoadingNewer,
        olderTransition,
        newerTransition,
        olderGate: paginationGateRef.current.snapshot(),
        newerGate: newerPaginationGateRef.current.snapshot(),
      },
    });

    if (!olderTransition.requestSettled && !newerTransition.requestSettled)
      return;
    const pending = prependAnchorRef.current;
    if (!pending) return;
    const pendingRequestSettled =
      (pending.gate === paginationGateRef.current &&
        olderTransition.requestSettled) ||
      (pending.gate === newerPaginationGateRef.current &&
        newerTransition.requestSettled);
    if (!pendingRequestSettled) return;
    if (
      pending.cancelledByUser ||
      pending.node !== attachedScrollNodeRef.current
    ) {
      emitChatHistoryPaginationDebug({
        type: "anchor-skip",
        surface,
        detail: {
          reason: pending.cancelledByUser
            ? "user-scrolled"
            : "scroll-node-replaced",
          rowId: pending.anchor.rowId,
        },
      });
      prependAnchorRef.current = null;
      anchorStabilizerRef.current?.stop();
      return;
    }

    let attempts = 0;
    const restore = () => {
      prependRestoreRafRef.current = null;
      const current = prependAnchorRef.current;
      if (!current || current.cancelledByUser) return;
      if (current.node !== attachedScrollNodeRef.current) {
        prependAnchorRef.current = null;
        return;
      }
      attempts += 1;
      const result = restoreChatPrependAnchor(current.node, current.anchor);
      if (!result.found && attempts < 8) {
        prependRestoreRafRef.current = requestAnimationFrame(restore);
        return;
      }
      emitChatHistoryPaginationDebug({
        type: "anchor-restored",
        surface,
        detail: {
          rowId: current.anchor.rowId,
          before: current.anchor,
          after: result,
          thresholdVisible:
            result.scrollTopAfter <= current.anchor.viewportHeight * 2,
          attempts,
        },
      });
      anchorStabilizerRef.current?.stop();
      anchorStabilizerRef.current = new ChatPrependAnchorStabilizer(
        current.node,
        current.anchor,
        (lateResult) => {
          emitChatHistoryPaginationDebug({
            type: "anchor-late-restored",
            surface,
            detail: { rowId: current.anchor.rowId, after: lateResult },
          });
        },
      );
      anchorStabilizerRef.current.start();
      prependAnchorRef.current = null;
    };

    // Let Legend's MVCP/data pass and row ResizeObservers settle first. In the
    // normal case it lands exactly and `restore` performs no scroll write.
    prependRestoreRafRef.current = requestAnimationFrame(() => {
      prependRestoreRafRef.current = requestAnimationFrame(restore);
    });
  }, [
    listRef,
    hasNewerEvents,
    hasOlderEvents,
    isLoadingNewer,
    isLoadingOlder,
    paginationCompletionVersion,
    surface,
  ]);

  const releaseFollow = useCallback(() => {
    followRearmBlockedRef.current = true;
    setFollow(false);
    followApi.current?.cancel();
  }, [setFollow]);

  /**
   * Bump the follow target by `delta` px through the same lerp loop as
   * the streaming auto-follow, so the two motions blend rather than
   * fighting via separate concurrent rAF tweens writing scrollTop on
   * alternating frames.
   *
   * The two-rAF wait lets freshly rendered rows lay out and grow
   * `scrollHeight` before we bump, so the target lands at a real
   * position rather than getting clamped to the old maxScroll.
   */
  const nudgeBy = useCallback(
    (delta: number) => {
      setFollow(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          followApi.current?.nudgeBy(delta);
        });
      });
    },
    [setFollow],
  );

  /**
   * After an accepted send, arm follow and settle to the end of content.
   * The just-sent user row (or, mid-stream, the queued follow-up item) is
   * the last list item, so the end frames it just above the composer; the
   * reply then arrives below it and the content-growth follow keeps the
   * viewport at the end. The two-rAF wait lets the optimistic row lay out
   * before the loop starts chasing the end.
   */
  const followAfterSend = useCallback(() => {
    setFollow(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        followApi.current?.followToEnd();
      });
    });
  }, [setFollow]);

  useEffect(() => {
    let attached: HTMLElement | null = null;
    let cleanup = () => {};
    let frame = 0;

    const tryAttach = (): boolean => {
      const node = listRef.current?.getScrollableNode?.() as
        | HTMLElement
        | undefined
        | null;
      if (!node) {
        cleanup();
        return false;
      }
      if (node === attached) return true;
      const previousNode = attached;
      cleanup();
      attached = node;
      attachedScrollNodeRef.current = node;

      emitChatHistoryPaginationDebug({
        type: "scroll-node-attached",
        surface,
        detail: {
          replaced: Boolean(previousNode && previousNode !== node),
        },
      });

      const WHEEL_ACTION_IDLE_MS = 160;
      const INTENT_ACTIVE_MS = 240;
      let lastObservedScrollTop = node.scrollTop;
      let wheelActionId: number | null = null;
      let lastWheelAt = -Infinity;
      let lastWheelDirection: HistoryScrollDirection = "none";
      let pointerActionId: number | null = null;
      let keyActionId: number | null = null;
      let touchActionId: number | null = null;
      let touchStartY: number | null = null;
      let activeIntent: {
        id: number;
        direction: HistoryScrollDirection;
        expiresAt: number;
      } | null = null;

      const nextActionId = () => ++paginationActionIdRef.current;
      const markActiveIntent = (
        id: number,
        direction: HistoryScrollDirection,
      ) => {
        activeIntent = {
          id,
          direction,
          expiresAt: performance.now() + INTENT_ACTIVE_MS,
        };
      };
      const cancelPendingAnchorForUserScroll = () => {
        anchorStabilizerRef.current?.stop();
        anchorStabilizerRef.current = null;
        jumpToLatestPendingRef.current = false;
        if (prependAnchorRef.current) {
          prependAnchorRef.current.cancelledByUser = true;
        }
      };
      const readPaginationMetrics = (): HistoryPaginationMetrics | null => {
        const list = listRef.current;
        if (!list) return null;
        const state = list.getState();
        return {
          scrollTop: state.scroll,
          viewportHeight: state.scrollLength,
          contentHeight: state.contentLength,
        };
      };
      const attemptHistoryLoad = (
        actionId: number | null,
        direction: HistoryScrollDirection,
        source: string,
        edge: "older" | "newer" = "older",
      ) => {
        const metrics = readPaginationMetrics();
        if (!metrics) return;
        const options = historyOptionsRef.current;
        const gate =
          edge === "older"
            ? paginationGateRef.current
            : newerPaginationGateRef.current;
        const hasMore =
          edge === "older" ? options.hasOlderEvents : options.hasNewerEvents;
        const isLoading =
          edge === "older" ? options.isLoadingOlder : options.isLoadingNewer;
        const load =
          edge === "older" ? options.onLoadOlder : options.onLoadNewer;
        const decision = gate.consider(actionId, direction, metrics, {
          hasMore: hasMore && Boolean(load),
          isLoading:
            isLoading || options.isLoadingOlder || options.isLoadingNewer,
        });
        emitChatHistoryPaginationDebug({
          type: "threshold-check",
          surface,
          detail: {
            source,
            actionId,
            direction,
            edge,
            ...metrics,
            ...decision,
            gate: gate.snapshot(),
          },
        });
        if (!decision.request || !load) return;

        anchorStabilizerRef.current?.stop();
        anchorStabilizerRef.current = null;
        const anchor = captureChatPrependAnchor(node);
        if (anchor) {
          prependAnchorRef.current = {
            node,
            anchor,
            gate,
            cancelledByUser: false,
          };
        }
        emitChatHistoryPaginationDebug({
          type: "request",
          surface,
          detail: { source, actionId, edge, metrics, anchor },
        });
        try {
          const accepted = load();
          if (accepted === false) {
            gate.rejectRequest();
            if (prependAnchorRef.current?.gate === gate) {
              prependAnchorRef.current = null;
            }
          } else if (accepted instanceof Promise) {
            void accepted.then(
              (succeeded) => {
                if (!mountedRef.current) return;
                const isCurrentGate =
                  gate === paginationGateRef.current ||
                  gate === newerPaginationGateRef.current;
                if (!isCurrentGate) return;
                const settled = gate.settleRequest();
                if (
                  (!succeeded || !node.isConnected) &&
                  prependAnchorRef.current?.gate === gate
                ) {
                  prependAnchorRef.current = null;
                }
                if (settled) {
                  setPaginationCompletionVersion((version) => version + 1);
                }
              },
              () => {
                if (!mountedRef.current) return;
                const isCurrentGate =
                  gate === paginationGateRef.current ||
                  gate === newerPaginationGateRef.current;
                if (!isCurrentGate) return;
                const settled = gate.settleRequest();
                if (prependAnchorRef.current?.gate === gate) {
                  prependAnchorRef.current = null;
                }
                if (settled) {
                  setPaginationCompletionVersion((version) => version + 1);
                }
              },
            );
          }
        } catch (error) {
          gate.rejectRequest();
          if (prependAnchorRef.current?.gate === gate) {
            prependAnchorRef.current = null;
          }
          emitChatHistoryPaginationDebug({
            type: "request-error",
            surface,
            detail: {
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      };

      let followTarget: number | null = null;
      let followRaf = 0;
      let followGentle = false;
      let followVel = 0;
      let lastFrameTime = 0;
      let lastTargetTime = 0;
      const stopLoop = () => {
        if (followRaf) cancelAnimationFrame(followRaf);
        followRaf = 0;
        followTarget = null;
        followGentle = false;
        followVel = 0;
        lastFrameTime = 0;
        lastTargetTime = 0;
      };

      const stepFollow = () => {
        followRaf = 0;
        if (!attached || followTarget === null) return;
        if (!followRef.current) {
          followTarget = null;
          followVel = 0;
          lastFrameTime = 0;
          return;
        }
        const maxScroll = Math.max(
          0,
          attached.scrollHeight - attached.clientHeight,
        );
        const target = Math.max(0, Math.min(maxScroll, followTarget));
        const current = attached.scrollTop;
        const diff = target - current;
        const absDiff = Math.abs(diff);

        if (absDiff < FOLLOW_MIN_STEP_PX) {
          attached.scrollTop = target;
          followVel = 0;
          lastFrameTime = 0;
          if (
            followGentle ||
            performance.now() - lastTargetTime > FOLLOW_STREAM_IDLE_MS
          ) {
            followTarget = null;
            return;
          }
          followRaf = requestAnimationFrame(stepFollow);
          return;
        }

        if (followGentle) {
          const lerpStep = diff * FOLLOW_GENTLE_LERP_FACTOR;
          const stepPx =
            Math.abs(lerpStep) >= FOLLOW_MIN_STEP_PX
              ? lerpStep
              : Math.sign(diff) * FOLLOW_MIN_STEP_PX;
          attached.scrollTop = current + stepPx;
          followRaf = requestAnimationFrame(stepFollow);
          return;
        }

        if (absDiff > FOLLOW_HARD_SNAP_PX) {
          attached.scrollTop = target;
          followVel = 0;
          lastFrameTime = 0;
          if (performance.now() - lastTargetTime > FOLLOW_STREAM_IDLE_MS) {
            followTarget = null;
            return;
          }
          followRaf = requestAnimationFrame(stepFollow);
          return;
        }

        const now = performance.now();
        const dt = lastFrameTime
          ? Math.min(FOLLOW_MAX_FRAME_MS, Math.max(1, now - lastFrameTime))
          : FOLLOW_DEFAULT_FRAME_MS;
        lastFrameTime = now;
        const accel =
          FOLLOW_SPRING_STIFFNESS * diff - FOLLOW_SPRING_DAMPING * followVel;
        followVel = Math.max(0, followVel + accel * dt);
        let step = followVel * dt;
        if (step < FOLLOW_MIN_STEP_PX) step = FOLLOW_MIN_STEP_PX;
        if (step >= diff) {
          attached.scrollTop = target;
          followVel = diff / dt;
        } else {
          attached.scrollTop = current + step;
        }
        followRaf = requestAnimationFrame(stepFollow);
      };

      const setTarget = (
        newTarget: number,
        options: FollowTargetOptions = {},
      ) => {
        if (!attached) return;
        if (!followRef.current) return;
        const maxScroll = Math.max(
          0,
          attached.scrollHeight - attached.clientHeight,
        );
        const clamped = Math.max(0, Math.min(maxScroll, newTarget));
        if (clamped <= attached.scrollTop + 0.5) return;
        const gentle = Boolean(options.gentle);
        if (gentle !== followGentle) followVel = 0;
        followTarget = Math.max(0, newTarget);
        followGentle = gentle;
        if (!gentle) lastTargetTime = performance.now();
        if (!followRaf) followRaf = requestAnimationFrame(stepFollow);
      };

      const nudgeBy = (delta: number, options: FollowTargetOptions = {}) => {
        if (!attached) return;
        if (!followRef.current) return;
        const base = followTarget !== null ? followTarget : attached.scrollTop;
        setTarget(base + delta, options);
      };

      const followToEnd = () => {
        setTarget(Number.POSITIVE_INFINITY, { gentle: true });
      };

      followApi.current = {
        setTarget,
        nudgeBy,
        followToEnd,
        cancel: stopLoop,
      };

      const followIdleContentGrowth = () => {
        if (!attached || !followRef.current) return;
        const distFromEnd =
          attached.scrollHeight - attached.clientHeight - attached.scrollTop;
        if (distFromEnd <= 0) return;
        if (!isAtBottomRef.current && distFromEnd > attached.clientHeight / 2) {
          return;
        }
        followToEnd();
      };
      let idleGrowthRaf = 0;
      const scheduleFollowIdleContentGrowth = () => {
        if (idleGrowthRaf) return;
        idleGrowthRaf = requestAnimationFrame(() => {
          idleGrowthRaf = 0;
          followIdleContentGrowth();
        });
      };

      const releaseLocalFollow = () => {
        followRearmBlockedRef.current = true;
        setFollow(false);
        stopLoop();
      };
      const handleWheel = (event: WheelEvent) => {
        noteManualScroll();
        const now = performance.now();
        const direction: HistoryScrollDirection =
          event.deltaY < 0 ? "up" : event.deltaY > 0 ? "down" : "none";
        if (
          wheelActionId === null ||
          now - lastWheelAt > WHEEL_ACTION_IDLE_MS ||
          direction !== lastWheelDirection
        ) {
          wheelActionId = nextActionId();
        }
        lastWheelAt = now;
        lastWheelDirection = direction;
        markActiveIntent(wheelActionId, direction);
        cancelPendingAnchorForUserScroll();
        if (direction === "up") {
          releaseLocalFollow();
          attemptHistoryLoad(wheelActionId, direction, "wheel");
        } else {
          if (direction === "down") {
            followRearmBlockedRef.current = false;
            attemptHistoryLoad(wheelActionId, direction, "wheel", "newer");
          }
          stopLoop();
        }
      };
      const handleTouchStart = (event: TouchEvent) => {
        noteManualScroll();
        setFollow(false);
        stopLoop();
        cancelPendingAnchorForUserScroll();
        touchActionId = nextActionId();
        touchStartY = event.touches[0]?.clientY ?? null;
      };
      const handleTouchMove = (event: TouchEvent) => {
        noteManualScroll();
        if (touchActionId === null || touchStartY === null) return;
        const y = event.touches[0]?.clientY;
        if (y === undefined) return;
        const direction: HistoryScrollDirection =
          y > touchStartY ? "up" : "down";
        markActiveIntent(touchActionId, direction);
        if (direction === "up") {
          attemptHistoryLoad(touchActionId, direction, "touch");
        } else {
          followRearmBlockedRef.current = false;
          attemptHistoryLoad(touchActionId, direction, "touch", "newer");
        }
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (isTextEditingTarget(event.target)) return;
        if (
          event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "PageUp" ||
          event.key === "PageDown" ||
          event.key === "Home" ||
          event.key === "End" ||
          event.key === " "
        ) {
          noteManualScroll();
        }
        if (
          event.key === "ArrowUp" ||
          event.key === "PageUp" ||
          event.key === "Home" ||
          (event.key === " " && event.shiftKey)
        ) {
          releaseLocalFollow();
          cancelPendingAnchorForUserScroll();
          if (!event.repeat || keyActionId === null)
            keyActionId = nextActionId();
          markActiveIntent(keyActionId, "up");
          attemptHistoryLoad(keyActionId, "up", `key:${event.key}`);
        } else {
          if (
            event.key === "ArrowDown" ||
            event.key === "PageDown" ||
            event.key === "End" ||
            (event.key === " " && !event.shiftKey)
          ) {
            followRearmBlockedRef.current = false;
            if (!event.repeat || keyActionId === null)
              keyActionId = nextActionId();
            markActiveIntent(keyActionId, "down");
            attemptHistoryLoad(
              keyActionId,
              "down",
              `key:${event.key}`,
              "newer",
            );
          }
          stopLoop();
        }
      };
      const handleKeyUp = () => {
        keyActionId = null;
      };
      const handlePointerDown = () => {
        pointerActionId = nextActionId();
        cancelPendingAnchorForUserScroll();
      };
      const handlePointerUp = () => {
        pointerActionId = null;
      };
      const handleDocumentPointerDown = (event: PointerEvent) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest(".chat-scrollbar__thumb")
        ) {
          handlePointerDown();
        }
      };
      const handlePaginationScroll = () => {
        const metrics = readPaginationMetrics();
        if (!metrics) return;
        const delta = metrics.scrollTop - lastObservedScrollTop;
        const direction: HistoryScrollDirection =
          delta < -0.5 ? "up" : delta > 0.5 ? "down" : "none";
        lastObservedScrollTop = metrics.scrollTop;

        const now = performance.now();
        let intent =
          activeIntent && activeIntent.expiresAt >= now ? activeIntent : null;
        if (direction !== "none" && pointerActionId !== null) {
          markActiveIntent(pointerActionId, direction);
          intent = activeIntent;
        }
        if (direction === "up" && intent?.direction === "up") {
          releaseLocalFollow();
          attemptHistoryLoad(intent.id, direction, "native-scroll");
        } else if (direction === "down" && intent?.direction === "down") {
          followRearmBlockedRef.current = false;
          attemptHistoryLoad(intent.id, direction, "native-scroll", "newer");
        }
      };
      node.addEventListener("wheel", handleWheel, { passive: true });
      node.addEventListener("touchstart", handleTouchStart, { passive: true });
      node.addEventListener("touchmove", handleTouchMove, { passive: true });
      node.addEventListener("keydown", handleKeyDown);
      node.addEventListener("keyup", handleKeyUp);
      node.addEventListener("pointerdown", handlePointerDown);
      window.addEventListener("pointerup", handlePointerUp);
      document.addEventListener("pointerdown", handleDocumentPointerDown, true);
      node.addEventListener("scroll", scheduleScrollStateUpdate, {
        passive: true,
      });
      node.addEventListener("scroll", handlePaginationScroll, {
        passive: true,
      });

      const unsubscribeGrowth = subscribeChatContentGrowth(() => {
        if (!followRef.current) return;
        scheduleFollowIdleContentGrowth();
      });

      let lastViewportHeight = node.clientHeight;
      const viewportResizeObserver = new ResizeObserver(() => {
        if (!attached) return;
        const height = attached.clientHeight;
        const shrunkBy = lastViewportHeight - height;
        lastViewportHeight = height;
        if (shrunkBy <= 0) return;
        const maxScroll = Math.max(0, attached.scrollHeight - height);
        const gapBeforeShrink = Math.max(
          0,
          maxScroll - attached.scrollTop - shrunkBy,
        );
        if (gapBeforeShrink > SCROLL_BUTTON_THRESHOLD) return;
        attached.scrollTop = Math.min(
          maxScroll,
          attached.scrollTop + shrunkBy,
        );
      });
      viewportResizeObserver.observe(node);

      // NOTE: We intentionally do NOT re-pin scrollTop on container *width*
      // changes (the display/sidebar panel sliding open/closed over 460ms).
      // Earlier versions re-ran `scrollToEnd`, or wrote `scrollTop` directly,
      // on every width tick to keep the bottom glued during the reflow — but
      // any external scroll write during the slide fights Legend's
      // `maintainVisibleContentPosition`, which independently re-anchors on
      // each reflow frame. The two controllers disagree frame-to-frame and
      // oscillate: the heavy vertical shake at the bottom while toggling the
      // sidebar. An isolated A/B harness confirmed it — with the per-frame
      // pin the reference row's on-screen Y oscillated (5 direction reversals,
      // 42px range); with no custom write Legend's MVCP held it smoothly (0
      // reversals, 21px monotonic settle). So we let MVCP own scroll position
      // across width reflows and write scrollTop only for the explicit motions
      // (send follow, stream follow, scroll-to-bottom button).

      cleanup = () => {
        if (!attached) return;
        unsubscribeGrowth();
        viewportResizeObserver.disconnect();
        if (idleGrowthRaf) {
          cancelAnimationFrame(idleGrowthRaf);
          idleGrowthRaf = 0;
        }
        attached.removeEventListener("wheel", handleWheel);
        attached.removeEventListener("touchstart", handleTouchStart);
        attached.removeEventListener("touchmove", handleTouchMove);
        attached.removeEventListener("keydown", handleKeyDown);
        attached.removeEventListener("keyup", handleKeyUp);
        attached.removeEventListener("pointerdown", handlePointerDown);
        window.removeEventListener("pointerup", handlePointerUp);
        document.removeEventListener(
          "pointerdown",
          handleDocumentPointerDown,
          true,
        );
        attached.removeEventListener("scroll", scheduleScrollStateUpdate);
        attached.removeEventListener("scroll", handlePaginationScroll);
        stopLoop();
        followApi.current = null;
        if (attachedScrollNodeRef.current === attached) {
          attachedScrollNodeRef.current = null;
        }
        attached = null;
      };
      return true;
    };

    const scheduleAttach = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        tryAttach();
      });
    };
    onListRefChange.current = scheduleAttach;
    scheduleAttach();

    return () => {
      onListRefChange.current = null;
      cancelAnimationFrame(frame);
      cleanup();
    };
  }, [
    listRef,
    noteManualScroll,
    scheduleScrollStateUpdate,
    setFollow,
    surface,
  ]);

  return {
    listRef,
    isAtBottom,
    isNearBottom,
    isFollowingLatest,
    isUserScrolling,
    noteManualScroll,
    showScrollButton: showScrollButton || hasNewerEvents,
    scrollToBottom,
    releaseFollow,
    followAfterSend,
    nudgeBy,
    getIsFollowing,
    getShouldFollowSend,
    getIsEffectivelyAtBottom,
    thumbRef: setThumbRef,
  };
}
