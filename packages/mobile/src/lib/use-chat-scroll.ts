import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";
import type { LegendListRef } from "@legendapp/list/react-native";
import {
  resolvePostSendPlacement,
  shouldPlaceLatestTurn,
} from "./chat-post-send-placement";

const SCROLL_NEAR_BOTTOM_BASE_PX = 96;
const SCROLL_AWAY_FROM_BOTTOM_BASE_PX = 96;
const SCROLL_TAIL_OFFSCREEN_BASE_PX = 64;
const SCROLL_AT_BOTTOM_THRESHOLD = 8;
const MANUAL_SCROLL_SETTLE_MS = 140;

const FOLLOW_NATIVE_SCROLL_MS = 420;
const FOLLOW_HARD_SNAP_VIEWPORTS = 2;
const FOLLOW_TARGET_EPSILON_PX = 0.5;
const FOLLOW_TOP_PEEK_PX = 56;
/**
 * How long after a send the latest user row's layout changes may re-run the
 * post-send placement. Covers the four-line clamp collapsing a long message a
 * few frames after the anchor was first computed, without letting much later
 * layout churn (e.g. a "Show more" tap) yank the scroll position around.
 */
const POST_SEND_REANCHOR_WINDOW_MS = 1500;

export function useChatScroll(
  listTrailingSlackPx: number,
  trailingMessageId: string | null,
  listLeadingInsetPx: number,
) {
  const listRef = useRef<LegendListRef>(null);
  const listTrailingSlackRef = useRef(listTrailingSlackPx);
  listTrailingSlackRef.current = listTrailingSlackPx;
  const listLeadingInsetRef = useRef(listLeadingInsetPx);
  listLeadingInsetRef.current = listLeadingInsetPx;
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [tailOffscreen, setTailOffscreen] = useState(false);
  const tailOffscreenLimit = SCROLL_TAIL_OFFSCREEN_BASE_PX + listTrailingSlackPx;
  const nearBottomLimit = SCROLL_NEAR_BOTTOM_BASE_PX + listTrailingSlackPx;
  const atBottomLimit = SCROLL_AT_BOTTOM_THRESHOLD + listTrailingSlackPx;
  const awayFromBottomLimit =
    SCROLL_AWAY_FROM_BOTTOM_BASE_PX + listTrailingSlackPx;
  const metricsRef = useRef({ offsetY: 0, contentHeight: 0, layoutHeight: 0 });
  const contentHeightRef = useRef(0);
  const followArmedRef = useRef(true);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const followRearmBlockedRef = useRef(false);
  const followTargetOffsetRef = useRef<number | null>(null);
  const followAnimatingUntilMsRef = useRef(0);
  const activeAssistantHeightRef = useRef(0);
  const latestUserLayoutRef = useRef<{ id: string; height: number } | null>(
    null,
  );
  const pendingSendAnchorRef = useRef<{
    userMessageId: string;
    placedRowHeightPx: number | null;
    staleAtMs: number;
  } | null>(null);
  const placeLatestTurnRafRef = useRef(0);
  const trailingMessageIdRef = useRef(trailingMessageId);
  trailingMessageIdRef.current = trailingMessageId;
  const assistantLayoutBaselineRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const manualScrollActiveRef = useRef(false);
  const manualScrollSettleTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const followCurrentRef = useRef(0);
  const followSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const setFollowArmed = useCallback((armed: boolean) => {
    if (followArmedRef.current === armed) return;
    followArmedRef.current = armed;
    setIsFollowingLatest(armed);
  }, []);

  const stopFollowLoop = useCallback(() => {
    if (followSettleTimerRef.current) {
      clearTimeout(followSettleTimerRef.current);
      followSettleTimerRef.current = null;
    }
    followTargetOffsetRef.current = null;
    followAnimatingUntilMsRef.current = 0;
  }, []);

  useEffect(
    () => () => {
      stopFollowLoop();
      if (manualScrollSettleTimerRef.current) {
        clearTimeout(manualScrollSettleTimerRef.current);
      }
      if (placeLatestTurnRafRef.current) {
        cancelAnimationFrame(placeLatestTurnRafRef.current);
      }
    },
    [stopFollowLoop],
  );

  const scheduleManualScrollSettle = useCallback(() => {
    if (manualScrollSettleTimerRef.current) {
      clearTimeout(manualScrollSettleTimerRef.current);
    }
    manualScrollSettleTimerRef.current = setTimeout(() => {
      manualScrollSettleTimerRef.current = null;
      if (!isDraggingRef.current) {
        manualScrollActiveRef.current = false;
      }
    }, MANUAL_SCROLL_SETTLE_MS);
  }, []);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const previousOffsetY = metricsRef.current.offsetY;
      const offsetDelta = contentOffset.y - previousOffsetY;
      metricsRef.current = {
        offsetY: contentOffset.y,
        contentHeight: contentSize.height,
        layoutHeight: layoutMeasurement.height,
      };
      contentHeightRef.current = contentSize.height;

      const maxOffsetY = Math.max(
        0,
        contentSize.height - layoutMeasurement.height,
      );
      const bouncingBackFromTail = previousOffsetY > maxOffsetY + 0.5;

      if (manualScrollActiveRef.current) {
        scheduleManualScrollSettle();
        if (offsetDelta < -0.5 && !bouncingBackFromTail) {
          followRearmBlockedRef.current = true;
        } else if (offsetDelta > 0.5) {
          followRearmBlockedRef.current = false;
        }
      }

      const hasOverflow = contentSize.height > layoutMeasurement.height + 2;
      const distFromBottom = Math.max(
        0,
        contentSize.height - contentOffset.y - layoutMeasurement.height,
      );

      if (distFromBottom <= atBottomLimit) {
        if (!isDraggingRef.current && !followRearmBlockedRef.current) {
          setFollowArmed(true);
        }
      } else if (
        distFromBottom > nearBottomLimit &&
        offsetDelta < -0.5 &&
        !bouncingBackFromTail &&
        pendingSendAnchorRef.current === null &&
        followTargetOffsetRef.current === null &&
        Date.now() > followAnimatingUntilMsRef.current
      ) {
        setFollowArmed(false);
        stopFollowLoop();
      }

      if (followTargetOffsetRef.current !== null) return;
      setAwayFromBottom(hasOverflow && distFromBottom > awayFromBottomLimit);
      setTailOffscreen(hasOverflow && distFromBottom > tailOffscreenLimit);
    },
    [
      atBottomLimit,
      awayFromBottomLimit,
      tailOffscreenLimit,
      nearBottomLimit,
      scheduleManualScrollSettle,
      setFollowArmed,
      stopFollowLoop,
    ],
  );

  const resetAssistantAutoScroll = useCallback(() => {
    assistantLayoutBaselineRef.current = null;
    activeAssistantHeightRef.current = 0;
    if (!pendingSendAnchorRef.current) stopFollowLoop();
  }, [stopFollowLoop]);

  const releaseFollow = useCallback(() => {
    pendingSendAnchorRef.current = null;
    followRearmBlockedRef.current = true;
    setFollowArmed(false);
    stopFollowLoop();
  }, [setFollowArmed, stopFollowLoop]);

  const onScrollBeginDrag = useCallback(() => {
    isDraggingRef.current = true;
    manualScrollActiveRef.current = true;
    pendingSendAnchorRef.current = null;
    if (manualScrollSettleTimerRef.current) {
      clearTimeout(manualScrollSettleTimerRef.current);
      manualScrollSettleTimerRef.current = null;
    }
    setFollowArmed(false);
    stopFollowLoop();
  }, [setFollowArmed, stopFollowLoop]);

  const onScrollSettle = useCallback(() => {
    isDraggingRef.current = false;
    scheduleManualScrollSettle();
    const { offsetY, contentHeight, layoutHeight } = metricsRef.current;
    const distFromBottom = Math.max(0, contentHeight - offsetY - layoutHeight);
    if (distFromBottom <= nearBottomLimit) {
      followRearmBlockedRef.current = false;
      setFollowArmed(true);
    }
  }, [nearBottomLimit, scheduleManualScrollSettle, setFollowArmed]);

  const prepareAssistantLayoutFollow = useCallback(() => {
    assistantLayoutBaselineRef.current = contentHeightRef.current;
  }, []);

  const updateAwayFromBottom = useCallback(
    (offset: number) => {
      const { layoutHeight } = metricsRef.current;
      const contentHeight = contentHeightRef.current;
      const dist = Math.max(0, contentHeight - offset - layoutHeight);
      setAwayFromBottom(
        contentHeight > layoutHeight + 2 && dist > awayFromBottomLimit,
      );
      setTailOffscreen(
        contentHeight > layoutHeight + 2 && dist > tailOffscreenLimit,
      );
    },
    [awayFromBottomLimit, tailOffscreenLimit],
  );

  const setFollowTarget = useCallback(
    (target: number, gentle = false) => {
      if (!followArmedRef.current) return;

      const { layoutHeight } = metricsRef.current;
      const contentHeight = contentHeightRef.current;
      const maxOffset = Math.max(0, contentHeight - layoutHeight);
      const clamped = Math.max(0, Math.min(maxOffset, target));
      const inFlight = followTargetOffsetRef.current !== null;
      const from = inFlight
        ? followCurrentRef.current
        : metricsRef.current.offsetY;

      if (!gentle && clamped <= from + FOLLOW_TARGET_EPSILON_PX) return;
      if (Math.abs(clamped - from) <= FOLLOW_TARGET_EPSILON_PX) return;

      const animated =
        layoutHeight <= 0 ||
        Math.abs(clamped - from) <= layoutHeight * FOLLOW_HARD_SNAP_VIEWPORTS;
      followCurrentRef.current = clamped;
      followTargetOffsetRef.current = clamped;
      followAnimatingUntilMsRef.current = Date.now() + FOLLOW_NATIVE_SCROLL_MS;
      listRef.current?.scrollToOffset({ offset: clamped, animated });
      if (followSettleTimerRef.current) {
        clearTimeout(followSettleTimerRef.current);
      }
      followSettleTimerRef.current = setTimeout(
        () => {
          followSettleTimerRef.current = null;
          followTargetOffsetRef.current = null;
          updateAwayFromBottom(metricsRef.current.offsetY);
        },
        animated ? FOLLOW_NATIVE_SCROLL_MS : 0,
      );
    },
    [updateAwayFromBottom],
  );

  const followActiveAssistantRow = useCallback(() => {
    const assistantHeight = activeAssistantHeightRef.current;
    if (assistantHeight <= 0) return;

    const { layoutHeight } = metricsRef.current;
    if (layoutHeight <= 0) return;

    const contentHeight = contentHeightRef.current;
    const rowBottom = Math.max(0, contentHeight - listTrailingSlackPx);
    const rowTop = Math.max(0, rowBottom - assistantHeight);
    const desiredScrollTop = Math.max(0, contentHeight - layoutHeight);
    const pinnedTop = Math.max(
      0,
      rowTop - FOLLOW_TOP_PEEK_PX - listLeadingInsetRef.current,
    );
    setFollowTarget(Math.min(pinnedTop, desiredScrollTop));
  }, [listTrailingSlackPx, setFollowTarget]);

  const onActiveAssistantLayout = useCallback(
    (event: LayoutChangeEvent) => {
      activeAssistantHeightRef.current = event.nativeEvent.layout.height;
      followActiveAssistantRow();
    },
    [followActiveAssistantRow],
  );

  const clearActiveAssistantLayout = useCallback(() => {
    activeAssistantHeightRef.current = 0;
    assistantLayoutBaselineRef.current = null;
  }, []);

  const scrollToBottom = useCallback(() => {
    pendingSendAnchorRef.current = null;
    followRearmBlockedRef.current = false;
    setFollowArmed(true);
    resetAssistantAutoScroll();
    requestAnimationFrame(() =>
      listRef.current?.scrollToEnd({ animated: true }),
    );
  }, [resetAssistantAutoScroll, setFollowArmed]);

  const getShouldPlaceLatestTurn = useCallback(() => {
    const { offsetY, layoutHeight } = metricsRef.current;
    const distanceFromBottomPx = Math.max(
      0,
      contentHeightRef.current - offsetY - layoutHeight,
    );
    return shouldPlaceLatestTurn({
      distanceFromBottomPx,
      isFollowingLatest: followArmedRef.current,
    });
  }, []);

  const placeLatestTurn = useCallback(() => {
    const pending = pendingSendAnchorRef.current;
    if (!pending) return;
    if (Date.now() > pending.staleAtMs) {
      pendingSendAnchorRef.current = null;
      return;
    }
    const metrics = metricsRef.current;
    const contentHeight = contentHeightRef.current;
    const maxOffset = Math.max(0, contentHeight - metrics.layoutHeight);
    const measurement = latestUserLayoutRef.current;
    const isInitialPlacement = pending.placedRowHeightPx === null;

    // If the optimistic row is no longer the list tail (for example, an
    // assistant placeholder landed immediately after it), settling forward
    // once is safer than using another row's height and framing the wrong
    // turn — and later row-height changes must not re-anchor either.
    if (trailingMessageIdRef.current !== pending.userMessageId) {
      pendingSendAnchorRef.current = null;
      if (isInitialPlacement) setFollowTarget(maxOffset, true);
      return;
    }

    if (measurement?.id !== pending.userMessageId) return;

    pending.placedRowHeightPx = measurement.height;
    const target = resolvePostSendPlacement({
      contentHeightPx: contentHeight,
      viewportHeightPx: metrics.layoutHeight,
      trailingSlackPx: listTrailingSlackRef.current,
      rowHeightPx: measurement.height,
      leadingInsetPx: listLeadingInsetRef.current,
    });

    setFollowTarget(target, true);
  }, [setFollowTarget]);

  /** Coalesced two-frame delay so placement reads post-layout list metrics. */
  const schedulePlaceLatestTurn = useCallback(() => {
    if (placeLatestTurnRafRef.current) {
      cancelAnimationFrame(placeLatestTurnRafRef.current);
    }
    placeLatestTurnRafRef.current = requestAnimationFrame(() => {
      placeLatestTurnRafRef.current = requestAnimationFrame(() => {
        placeLatestTurnRafRef.current = 0;
        placeLatestTurn();
      });
    });
  }, [placeLatestTurn]);

  const onListContentSizeChange = useCallback(
    (_width: number, height: number) => {
      const previousHeight = contentHeightRef.current;
      contentHeightRef.current = height;
      metricsRef.current.contentHeight = height;

      const pending = pendingSendAnchorRef.current;
      if (
        pending &&
        pending.userMessageId === trailingMessageIdRef.current &&
        Date.now() <= pending.staleAtMs
      ) {
        if (placeLatestTurnRafRef.current) {
          cancelAnimationFrame(placeLatestTurnRafRef.current);
          placeLatestTurnRafRef.current = 0;
        }
        placeLatestTurn();
        return;
      }
      pendingSendAnchorRef.current = null;

      const baseline = assistantLayoutBaselineRef.current;
      if (baseline === null || height <= baseline) {
        if (activeAssistantHeightRef.current > 0) {
          followActiveAssistantRow();
        } else if (previousHeight > 0 && height > previousHeight) {
          setFollowTarget(
            Math.max(0, height - metricsRef.current.layoutHeight),
          );
        }
        return;
      }

      assistantLayoutBaselineRef.current = null;
      if (activeAssistantHeightRef.current > 0) {
        followActiveAssistantRow();
      } else {
        setFollowTarget(Math.max(0, height - metricsRef.current.layoutHeight));
      }
    },
    [followActiveAssistantRow, placeLatestTurn, setFollowTarget],
  );

  const onLatestUserLayout = useCallback(
    (messageId: string, event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      latestUserLayoutRef.current = { id: messageId, height };
      const pending = pendingSendAnchorRef.current;
      if (!pending || pending.userMessageId !== messageId) return;
      if (Date.now() > pending.staleAtMs) return;
      if (
        pending.placedRowHeightPx === null ||
        Math.abs(pending.placedRowHeightPx - height) > 1
      ) {
        // Start moving now; the list's content size may still be a frame
        // behind, so re-place from settled metrics two frames on (a changed
        // target just retargets the native scroll).
        placeLatestTurn();
        schedulePlaceLatestTurn();
      }
    },
    [placeLatestTurn, schedulePlaceLatestTurn],
  );

  const nudgeAfterSend = useCallback(
    (userMessageId: string) => {
      pendingSendAnchorRef.current = {
        userMessageId,
        placedRowHeightPx: null,
        staleAtMs: Date.now() + POST_SEND_REANCHOR_WINDOW_MS,
      };
      followRearmBlockedRef.current = false;
      setFollowArmed(true);
      stopFollowLoop();
      schedulePlaceLatestTurn();
    },
    [schedulePlaceLatestTurn, setFollowArmed, stopFollowLoop],
  );

  return {
    listRef,
    onScroll,
    onListContentSizeChange,
    onActiveAssistantLayout,
    clearActiveAssistantLayout,
    scrollToBottom,
    resetAssistantAutoScroll,
    prepareAssistantLayoutFollow,
    onLatestUserLayout,
    onScrollBeginDrag,
    onScrollSettle,
    getShouldPlaceLatestTurn,
    releaseFollow,
    nudgeAfterSend,
    awayFromBottom,
    tailOffscreen,
    isFollowingLatest,
  };
}
