import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import {
  AT_BOTTOM_TOLERANCE_PX,
  shouldFollowSend,
} from "@/shell/chat-follow-target";
import {
  ChatHistoryPaginationGate,
  emitChatHistoryPaginationDebug,
  type HistoryPaginationMetrics,
  type HistoryScrollDirection,
} from "@/shell/chat-history-pagination";

const SCROLL_BUTTON_THRESHOLD = 180;
const THUMB_MIN_HEIGHT = 24;
const THUMB_FADE_MS = 1200;
const MANUAL_SCROLL_SETTLE_MS = 140;
const THUMB_EPSILON_PX = 0.5;

const FOLLOW_LERP_FACTOR = 0.12;
const FOLLOW_SNAP_TOLERANCE_PX = 1;

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

type FollowApi = {
  followToEnd: () => void;
  followSend: () => void;
  cancel: () => void;
};

const SEND_ENTRANCE_ANIMATION = "bubble-pop";
const SEND_ROW_SELECTOR = ".event-row--user--just-sent .event-item.user";
const SEND_ROW_WAIT_FRAMES = 8;

type SendClock = {
  progress: () => number | null;
};

const findSendEntrance = (node: HTMLElement): SendClock | null => {
  const bubbles = node.querySelectorAll<HTMLElement>(SEND_ROW_SELECTOR);
  const bubble = bubbles[bubbles.length - 1];
  if (!bubble) return null;
  const animation = bubble
    .getAnimations()
    .find(
      (candidate): candidate is CSSAnimation =>
        candidate instanceof CSSAnimation &&
        candidate.animationName === SEND_ENTRANCE_ANIMATION,
    );
  if (!animation?.effect) return null;
  const effect = animation.effect;
  return {
    progress: () => {
      if (animation.playState === "finished" || !bubble.isConnected) return 1;
      return effect.getComputedTiming().progress ?? null;
    },
  };
};

export type ChatListBinding = {
  ref: { current: LegendListRef | null };
  dataKey: string | undefined;
  onScroll: () => void;
  onReady: () => void;
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
  const paginationGateRef = useRef(new ChatHistoryPaginationGate());
  const newerPaginationGateRef = useRef(new ChatHistoryPaginationGate("end"));
  const paginationActionIdRef = useRef(0);
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

  useEffect(() => {
    paginationGateRef.current = new ChatHistoryPaginationGate();
    newerPaginationGateRef.current = new ChatHistoryPaginationGate("end");
    jumpToLatestPendingRef.current = false;
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

  useEffect(() => {
    followApi.current?.cancel();
    setFollow(true);
  }, [paginationKey, setFollow]);

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

  const updateScrollState = useCallback(() => {
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
  }, [listRef, setFollow, updateThumb]);

  const listScrollHandlerRef = useRef<(() => void) | null>(null);
  const handleListScroll = useCallback(() => {
    updateScrollState();
    listScrollHandlerRef.current?.();
  }, [updateScrollState]);

  const dataKey = paginationKey ?? undefined;
  const dataKeyRef = useRef(dataKey);
  dataKeyRef.current = dataKey;
  const [placedDataKey, setPlacedDataKey] = useState<string | undefined>();
  const handleListReady = useCallback(() => {
    setPlacedDataKey(dataKeyRef.current);
  }, []);
  const list = useMemo<ChatListBinding>(
    () => ({
      ref: listRef,
      dataKey,
      onScroll: handleListScroll,
      onReady: handleListReady,
    }),
    [dataKey, handleListReady, handleListScroll, listRef],
  );

  const scrollToBottom = useCallback(
    (behavior: "instant" | "smooth" = "smooth") => {
      setFollow(true);
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
    return () => {
      if (thumbFadeRef.current) clearTimeout(thumbFadeRef.current);
      if (manualScrollTimerRef.current) {
        clearTimeout(manualScrollTimerRef.current);
        manualScrollTimerRef.current = null;
      }
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
      void listRef.current?.scrollToEnd({ animated: false });
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
  }, [
    listRef,
    hasNewerEvents,
    hasOlderEvents,
    isLoadingNewer,
    isLoadingOlder,
    surface,
  ]);

  const releaseFollow = useCallback(() => {
    followRearmBlockedRef.current = true;
    setFollow(false);
    followApi.current?.cancel();
  }, [setFollow]);

  const followAfterSend = useCallback(() => {
    setFollow(true);
    followApi.current?.followSend();
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
      const cancelPendingJumpForUserScroll = () => {
        jumpToLatestPendingRef.current = false;
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

        emitChatHistoryPaginationDebug({
          type: "request",
          surface,
          detail: { source, actionId, edge, metrics },
        });
        try {
          const accepted = load();
          if (accepted === false) {
            gate.rejectRequest();
          } else if (accepted instanceof Promise) {
            const settle = () => {
              if (
                gate === paginationGateRef.current ||
                gate === newerPaginationGateRef.current
              ) {
                gate.settleRequest();
              }
            };
            void accepted.then(settle, settle);
          }
        } catch (error) {
          gate.rejectRequest();
          emitChatHistoryPaginationDebug({
            type: "request-error",
            surface,
            detail: {
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      };

      let followRaf = 0;
      let lastStepFrom: number | null = null;
      let sendMotion: {
        clock: SendClock | null;
        firstProgress: number | null;
        waitedFrames: number;
      } | null = null;
      const stopLoop = () => {
        if (followRaf) cancelAnimationFrame(followRaf);
        followRaf = 0;
        lastStepFrom = null;
        sendMotion = null;
      };

      // One motion for a send: the scroll holds still through the sent
      // bubble's first frames (the list may still show an estimated height for
      // the new row), then starts on the frame the bubble starts to move and
      // glides with the follow lerp, aiming at the live end each frame so late
      // layout lands inside the same motion.
      const stepSend = () => {
        followRaf = 0;
        const motion = sendMotion;
        if (!attached || !followRef.current || !motion) {
          sendMotion = null;
          return;
        }
        motion.clock ??= findSendEntrance(attached);
        const waiting = motion.waitedFrames < SEND_ROW_WAIT_FRAMES;
        if (!motion.clock && waiting) {
          motion.waitedFrames += 1;
          followRaf = requestAnimationFrame(stepSend);
          return;
        }
        if (motion.clock && waiting) {
          const progress = motion.clock.progress();
          if (
            progress === null ||
            motion.firstProgress === null ||
            progress === motion.firstProgress
          ) {
            motion.firstProgress ??= progress;
            motion.waitedFrames += 1;
            followRaf = requestAnimationFrame(stepSend);
            return;
          }
        }
        sendMotion = null;
        stepFollow();
      };

      const followSend = () => {
        if (!attached || !followRef.current) return;
        stopLoop();
        sendMotion = { clock: null, firstProgress: null, waitedFrames: 0 };
        followRaf = requestAnimationFrame(stepSend);
      };

      const stepFollow = () => {
        followRaf = 0;
        if (!attached || !followRef.current) {
          lastStepFrom = null;
          return;
        }
        const end = Math.max(0, attached.scrollHeight - attached.clientHeight);
        const current = attached.scrollTop;
        if (
          end - current <= FOLLOW_SNAP_TOLERANCE_PX ||
          current === lastStepFrom
        ) {
          attached.scrollTop = end;
          lastStepFrom = null;
          return;
        }
        lastStepFrom = current;
        attached.scrollTop = current + (end - current) * FOLLOW_LERP_FACTOR;
        followRaf = requestAnimationFrame(stepFollow);
      };

      const followToEnd = () => {
        if (!attached || !followRef.current || followRaf) return;
        const end = Math.max(0, attached.scrollHeight - attached.clientHeight);
        if (end - attached.scrollTop <= FOLLOW_SNAP_TOLERANCE_PX) return;
        followRaf = requestAnimationFrame(stepFollow);
      };

      followApi.current = { followToEnd, followSend, cancel: stopLoop };

      // Judge "was at the bottom" against the end before this growth: a long
      // reply can land in one layout, so the distance after it says nothing
      // about where the reader was.
      let lastSeenEnd = Math.max(0, node.scrollHeight - node.clientHeight);
      const followContentGrowth = () => {
        if (!attached) return;
        const end = Math.max(0, attached.scrollHeight - attached.clientHeight);
        const previousEnd = lastSeenEnd;
        lastSeenEnd = end;
        if (!followRef.current) return;
        const distFromEnd = end - attached.scrollTop;
        if (distFromEnd <= 0) return;
        const distFromPreviousEnd = previousEnd - attached.scrollTop;
        if (
          !followRaf &&
          !isAtBottomRef.current &&
          distFromPreviousEnd > AT_BOTTOM_TOLERANCE_PX
        ) {
          return;
        }
        followToEnd();
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
        cancelPendingJumpForUserScroll();
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
        cancelPendingJumpForUserScroll();
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
          cancelPendingJumpForUserScroll();
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
        cancelPendingJumpForUserScroll();
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
      listScrollHandlerRef.current = handlePaginationScroll;

      const contentResizeObserver = new ResizeObserver(followContentGrowth);
      for (const child of node.children) contentResizeObserver.observe(child);

      let lastViewportHeight = node.clientHeight;
      const viewportResizeObserver = new ResizeObserver(() => {
        if (!attached) return;
        const height = attached.clientHeight;
        const shrunkBy = lastViewportHeight - height;
        lastViewportHeight = height;
        lastSeenEnd = Math.max(0, attached.scrollHeight - height);
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

      cleanup = () => {
        if (!attached) return;
        contentResizeObserver.disconnect();
        viewportResizeObserver.disconnect();
        if (listScrollHandlerRef.current === handlePaginationScroll) {
          listScrollHandlerRef.current = null;
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
    setFollow,
    surface,
  ]);

  return {
    list,
    listRef,
    isPlacingInitialScroll: placedDataKey !== dataKey,
    isAtBottom,
    isNearBottom,
    isFollowingLatest,
    isUserScrolling,
    noteManualScroll,
    showScrollButton: showScrollButton || hasNewerEvents,
    scrollToBottom,
    releaseFollow,
    followAfterSend,
    getIsFollowing,
    getShouldFollowSend,
    getIsEffectivelyAtBottom,
    thumbRef: setThumbRef,
  };
}
