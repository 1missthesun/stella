import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LegendListRef } from "@legendapp/list/react";
import { AT_BOTTOM_TOLERANCE_PX, shouldFollowSend } from "@/shell/chat-follow-target";
import {
  ChatHistoryPaginationGate,
  emitChatHistoryPaginationDebug,
  type HistoryPaginationMetrics,
  type HistoryScrollDirection,
} from "@/shell/chat-history-pagination";
import type { ScrollPos } from "../rune";

import { rune as engine } from "./engine";
import { chatAtEnd } from "./chat-at-end";
import { onPhone } from "../shell/phone";


const SCROLL_BUTTON_THRESHOLD = 180;
const THUMB_MIN_HEIGHT = 24;
const THUMB_FADE_MS = 1200;
const MANUAL_SCROLL_SETTLE_MS = 140;
const FOLLOW_REARM_THRESHOLD_PX = 24;
const GESTURE_IDLE_MS = 160;
const PROGRAMMATIC_MS = 700;
const AT_END_PX = 1;

let nextListId = 0;

export type ChatScrollThumb = { top: number; height: number; visible: boolean };
export type ChatScrollThumbHandle = (thumb: ChatScrollThumb) => void;

/** A row the list can bring into view without it being built: `scroll_key_to` in the engine. */
export type ChatListRef = LegendListRef & {
  scrollToKey: (key: string, viewPosition?: number) => void;
};

/**
 * The Rune list binding: desktop-ui's `ChatListBinding` shape (ref, dataKey, onScroll, onReady)
 * plus what the engine's scroll box needs. `scrollId` is the `scrollY` box id and `follow` its
 * `stickBottom`.
 */
export type ChatListBinding = {
  ref: { current: ChatListRef | null };
  dataKey: string | undefined;
  onScroll: (pos?: ScrollPos) => void;
  onReady: () => void;
  scrollId: string;
  follow: boolean;
  onViewport: (pos: ScrollPos) => void;
};

type ChatScrollManagementOptions = {
  hasOlderEvents?: boolean;
  isLoadingOlder?: boolean;
  onLoadOlder?: () => boolean | void | Promise<boolean>;
  hasNewerEvents?: boolean;
  isLoadingNewer?: boolean;
  onLoadNewer?: () => boolean | void | Promise<boolean>;
  onLoadLatest?: () => boolean | void | Promise<boolean>;
  paginationKey?: string | null;
  surface?: "full" | "compact";
};

type Metrics = { y: number; maxY: number; viewport: number };

const settleLoad = (
  run: (() => boolean | void | Promise<boolean>) | undefined,
  onRejected: () => void,
  onSettled?: () => void,
) => {
  if (!run) return onRejected();
  try {
    const accepted = run();
    if (accepted instanceof Promise) {
      void accepted.then(
        (ok) => {
          if (!ok) onRejected();
          onSettled?.();
        },
        () => {
          onRejected();
          onSettled?.();
        },
      );
    } else if (accepted === false) onRejected();
  } catch {
    onRejected();
  }
};

/**
 * desktop-ui's `useChatScrollManagement` on an engine scroll box. The engine keeps the view
 * pinned to the end while following (`stickBottom`, no bridge lag); this hook mirrors that
 * state, tells user scrolls from content growth, and drives history pagination, the jump
 * button and the overlay thumb exactly as the DOM version does.
 */
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
  const [scrollId] = useState(() => `chat-scroll-${++nextListId}`);
  const metricsRef = useRef<Metrics | null>(null);
  const paginationGateRef = useRef(new ChatHistoryPaginationGate());
  const newerPaginationGateRef = useRef(new ChatHistoryPaginationGate("end"));
  const jumpToLatestPendingRef = useRef(false);
  const historyOptionsRef = useRef({ hasOlderEvents, isLoadingOlder, onLoadOlder, hasNewerEvents, isLoadingNewer, onLoadNewer, onLoadLatest });
  historyOptionsRef.current = { hasOlderEvents, isLoadingOlder, onLoadOlder, hasNewerEvents, isLoadingNewer, onLoadNewer, onLoadLatest };

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isAtBottomRef = useRef(true);
  const isNearBottomRef = useRef(true);
  const showScrollButtonRef = useRef(false);
  const isUserScrollingRef = useRef(false);
  const manualScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followRef = useRef(true);
  const followRearmBlockedRef = useRef(false);
  const programmaticUntilRef = useRef(0);
  const gestureRef = useRef<{ id: number; direction: HistoryScrollDirection; at: number } | null>(null);
  const actionIdRef = useRef(0);

  const thumbRef = useRef<ChatScrollThumbHandle | null>(null);
  const thumbVisibleRef = useRef(false);
  const thumbFadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setThumbRef = useCallback((handle: ChatScrollThumbHandle | null) => {
    thumbRef.current = handle;
  }, []);

  // Scroll events come every frame: the settle and fade timers below re-arm from a timestamp
  // when they fire instead of being replaced per event.
  const manualScrollAtRef = useRef(0);
  const noteManualScroll = useCallback(() => {
    manualScrollAtRef.current = performance.now();
    if (!isUserScrollingRef.current) {
      isUserScrollingRef.current = true;
      setIsUserScrolling(true);
    }
    if (manualScrollTimerRef.current) return;
    const settle = () => {
      const left = MANUAL_SCROLL_SETTLE_MS - (performance.now() - manualScrollAtRef.current);
      if (left > 1) {
        manualScrollTimerRef.current = setTimeout(settle, left);
        return;
      }
      manualScrollTimerRef.current = null;
      if (!isUserScrollingRef.current) return;
      isUserScrollingRef.current = false;
      setIsUserScrolling(false);
    };
    manualScrollTimerRef.current = setTimeout(settle, MANUAL_SCROLL_SETTLE_MS);
  }, []);

  const setFollow = useCallback((following: boolean) => {
    if (following) followRearmBlockedRef.current = false;
    if (followRef.current === following) return;
    followRef.current = following;
    setIsFollowingLatest(following);
  }, []);

  useEffect(() => {
    paginationGateRef.current = new ChatHistoryPaginationGate();
    newerPaginationGateRef.current = new ChatHistoryPaginationGate("end");
    jumpToLatestPendingRef.current = false;
    metricsRef.current = null;
    setFollow(true);
  }, [paginationKey, setFollow]);

  const thumbShownAtRef = useRef(0);
  const hideThumb = useCallback(() => {
    if (thumbFadeRef.current) clearTimeout(thumbFadeRef.current);
    thumbFadeRef.current = null;
    if (!thumbVisibleRef.current) return;
    thumbVisibleRef.current = false;
    thumbRef.current?.({ top: 0, height: 0, visible: false });
  }, []);
  const fadeThumb = useCallback(() => {
    const left = THUMB_FADE_MS - (performance.now() - thumbShownAtRef.current);
    if (left > 1) {
      thumbFadeRef.current = setTimeout(fadeThumb, left);
      return;
    }
    thumbFadeRef.current = null;
    hideThumb();
  }, [hideThumb]);

  const updateThumb = useCallback(
    ({ y, maxY, viewport }: Metrics) => {
      const handle = thumbRef.current;
      if (!handle) return;
      const content = maxY + viewport;
      if (maxY <= 0 || viewport <= 0) return hideThumb();
      const thumbHeight = Math.max(THUMB_MIN_HEIGHT, (viewport / content) * viewport);
      const progress = Math.max(0, Math.min(1, y / Math.max(1, maxY)));
      thumbVisibleRef.current = true;
      handle({ top: progress * Math.max(0, viewport - thumbHeight), height: thumbHeight, visible: true });
      thumbShownAtRef.current = performance.now();
      if (!thumbFadeRef.current) thumbFadeRef.current = setTimeout(fadeThumb, THUMB_FADE_MS);
    },
    [fadeThumb, hideThumb],
  );

  const paginationMetrics = (m: Metrics): HistoryPaginationMetrics => ({ scrollTop: m.y, viewportHeight: m.viewport, contentHeight: m.maxY + m.viewport });

  const attemptHistoryLoad = useCallback(
    (actionId: number, direction: HistoryScrollDirection, edge: "older" | "newer") => {
      const m = metricsRef.current;
      if (!m) return;
      const options = historyOptionsRef.current;
      const gate = edge === "older" ? paginationGateRef.current : newerPaginationGateRef.current;
      const load = edge === "older" ? options.onLoadOlder : options.onLoadNewer;
      const metrics = paginationMetrics(m);
      const decision = gate.consider(actionId, direction, metrics, {
        hasMore: (edge === "older" ? options.hasOlderEvents : options.hasNewerEvents) && Boolean(load),
        isLoading: options.isLoadingOlder || options.isLoadingNewer,
      });
      emitChatHistoryPaginationDebug({ type: "threshold-check", surface, detail: { source: "rune-scroll", actionId, direction, edge, ...metrics, ...decision, gate: gate.snapshot() } });
      if (!decision.request || !load) return;
      emitChatHistoryPaginationDebug({ type: "request", surface, detail: { source: "rune-scroll", actionId, edge, metrics } });
      settleLoad(
        load,
        () => gate.rejectRequest(),
        () => {
          if (gate === paginationGateRef.current || gate === newerPaginationGateRef.current) gate.settleRequest();
        },
      );
    },
    [surface],
  );

  const handleScroll = useCallback(
    (pos?: ScrollPos) => {
      if (!pos) return;
      const next: Metrics = { y: pos.y, maxY: pos.maxY, viewport: pos.viewport[1] };
      const prev = metricsRef.current;
      metricsRef.current = next;
      // The viewport shrank or grew under a list that follows its end (the phone's keyboard rising,
      // a window resized): it stays on the latest message, frame by frame as the edge moves.
      if (prev && Math.abs(next.viewport - prev.viewport) >= 0.5 && followRef.current && prev.maxY - prev.y <= AT_END_PX && next.maxY - next.y > AT_END_PX) {
        programmaticUntilRef.current = performance.now() + PROGRAMMATIC_MS;
        void engine().scroll.to(scrollId, "end", { animate: false });
      }
      const distFromEnd = Math.max(0, next.maxY - next.y);
      const atEnd = distFromEnd <= AT_END_PX;
      const nearBottom = atEnd || distFromEnd <= AT_BOTTOM_TOLERANCE_PX;
      chatAtEnd.current = nearBottom;
      const showButton = distFromEnd > SCROLL_BUTTON_THRESHOLD;
      if (isAtBottomRef.current !== atEnd) {
        isAtBottomRef.current = atEnd;
        setIsAtBottom(atEnd);
      }
      if (isNearBottomRef.current !== nearBottom) {
        isNearBottomRef.current = nearBottom;
        setIsNearBottom(nearBottom);
      }
      if (showScrollButtonRef.current !== showButton) {
        showScrollButtonRef.current = showButton;
        setShowScrollButton(showButton);
      }
      if (prev) {
        const moved = next.y - prev.y;
        const shifted = next.maxY - prev.maxY;
        const byContent = Math.abs(moved - shifted) < 0.5 && shifted !== 0;
        const byUser = !byContent && Math.abs(moved) > 0.5 && performance.now() > programmaticUntilRef.current;
        if (moved !== 0 || shifted !== 0) updateThumb(next);
        if (byUser) {
          noteManualScroll();
          jumpToLatestPendingRef.current = false;
          const direction: HistoryScrollDirection = moved < 0 ? "up" : "down";
          const now = performance.now();
          const g = gestureRef.current;
          const gesture = g && g.direction === direction && now - g.at <= GESTURE_IDLE_MS ? g : { id: ++actionIdRef.current, direction, at: now };
          gesture.at = now;
          gestureRef.current = gesture;
          if (direction === "up") {
            followRearmBlockedRef.current = true;
            setFollow(false);
            attemptHistoryLoad(gesture.id, "up", "older");
          } else {
            followRearmBlockedRef.current = false;
            attemptHistoryLoad(gesture.id, "down", "newer");
          }
        }
      }
      if (!followRearmBlockedRef.current && (atEnd || distFromEnd <= FOLLOW_REARM_THRESHOLD_PX)) setFollow(true);
    },
    [attemptHistoryLoad, noteManualScroll, scrollId, setFollow, updateThumb],
  );

  const markProgrammatic = () => {
    programmaticUntilRef.current = performance.now() + PROGRAMMATIC_MS;
  };

  const listRef = useMemo(() => {
    const ref: ChatListRef = {
      getState: () => {
        const m = metricsRef.current ?? { y: 0, maxY: 0, viewport: 0 };
        return { scroll: m.y, scrollLength: m.viewport, contentLength: m.maxY + m.viewport, isAtEnd: m.maxY - m.y <= AT_END_PX } as ReturnType<LegendListRef["getState"]>;
      },
      scrollToEnd: async ({ animated = true } = {}) => {
        markProgrammatic();
        await engine().scroll.to(scrollId, "end", { animate: animated });
      },
      scrollToOffset: async ({ offset, animated = false }: { offset: number; animated?: boolean }) => {
        markProgrammatic();
        await engine().scroll.to(scrollId, offset, { animate: animated });
      },
      scrollToKey: (key: string, viewPosition = 0.2) => {
        markProgrammatic();
        void engine().scroll.toKey(scrollId, key, (metricsRef.current?.viewport ?? 0) * viewPosition);
      },
      getScrollableNode: () => null,
    } as unknown as ChatListRef;
    return { current: ref as ChatListRef | null };
  }, [scrollId]);

  const dataKey = paginationKey ?? undefined;
  const dataKeyRef = useRef(dataKey);
  dataKeyRef.current = dataKey;
  const [placedDataKey, setPlacedDataKey] = useState<string | undefined>();
  const handleListReady = useCallback(() => setPlacedDataKey(dataKeyRef.current), []);

  const [follow, setEngineFollow] = useState(true);
  useEffect(() => setEngineFollow(isFollowingLatest), [isFollowingLatest]);

  const list = useMemo<ChatListBinding>(
    () => ({ ref: listRef, dataKey, onScroll: handleScroll, onReady: handleListReady, scrollId, follow, onViewport: handleScroll }),
    [dataKey, follow, handleListReady, handleScroll, listRef, scrollId],
  );

  const scrollToBottom = useCallback(
    (behavior: "instant" | "smooth" = "smooth") => {
      setFollow(true);
      const history = historyOptionsRef.current;
      if (history.hasNewerEvents) {
        if (!history.onLoadLatest) return;
        jumpToLatestPendingRef.current = true;
        settleLoad(history.onLoadLatest, () => {
          jumpToLatestPendingRef.current = false;
        });
        return;
      }
      void listRef.current?.scrollToEnd({ animated: behavior !== "instant" });
    },
    [listRef, setFollow],
  );

  const getIsFollowing = useCallback(() => followRef.current, []);
  const distanceFromBottom = () => {
    const m = metricsRef.current;
    return m ? Math.max(0, m.maxY - m.y) : null;
  };
  const getShouldFollowSend = useCallback(() => {
    // On a phone a sent message always comes into view, as in the phone app.
    if (onPhone()) return true;
    const d = distanceFromBottom();
    return d === null ? followRef.current : shouldFollowSend({ distanceFromBottomPx: d, isFollowingLatest: followRef.current });
  }, []);
  const getIsEffectivelyAtBottom = useCallback(() => {
    const d = distanceFromBottom();
    return d === null ? isNearBottomRef.current : d <= AT_BOTTOM_TOLERANCE_PX;
  }, []);

  useEffect(
    () => () => {
      if (thumbFadeRef.current) clearTimeout(thumbFadeRef.current);
      if (manualScrollTimerRef.current) clearTimeout(manualScrollTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    paginationGateRef.current.syncGuards({ hasMore: hasOlderEvents, isLoading: isLoadingOlder });
    newerPaginationGateRef.current.syncGuards({ hasMore: hasNewerEvents, isLoading: isLoadingNewer });
    if (jumpToLatestPendingRef.current && hasNewerEvents && !isLoadingOlder && !isLoadingNewer) {
      settleLoad(historyOptionsRef.current.onLoadLatest, () => {
        jumpToLatestPendingRef.current = false;
      });
    }
    if (jumpToLatestPendingRef.current && !hasNewerEvents && !isLoadingNewer) {
      jumpToLatestPendingRef.current = false;
      void listRef.current?.scrollToEnd({ animated: false });
    }
  }, [listRef, hasNewerEvents, hasOlderEvents, isLoadingNewer, isLoadingOlder]);

  const releaseFollow = useCallback(() => {
    followRearmBlockedRef.current = true;
    setFollow(false);
  }, [setFollow]);

  const followAfterSend = useCallback(() => {
    setFollow(true);
    markProgrammatic();
    void engine().scroll.to(scrollId, "end", { animate: true });
  }, [scrollId, setFollow]);

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
    thumbRef: setThumbRef as unknown as (el: HTMLDivElement | null) => void,
  };
}
