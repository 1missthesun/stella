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

/**
 * Extra breathing room beyond the list's trailing slack (the chat tail +
 * measured composer height). The slack is empty scrollable padding so messages
 * can sit above the overlay — without adding it, "near bottom" never engages
 * in the normal reading position (desktop `followRearmThreshold` does the same).
 */
const SCROLL_NEAR_BOTTOM_BASE_PX = 96;
/** Base distance before showing the scroll-to-bottom FAB (plus trailing slack). */
const SCROLL_AWAY_FROM_BOTTOM_BASE_PX = 96;
/** Past the trailing slack plus this, the chat tail row is below the viewport. */
const SCROLL_TAIL_OFFSCREEN_BASE_PX = 64;
/** Re-arm stream auto-follow once the user scrolls back to the true bottom. */
const SCROLL_AT_BOTTOM_THRESHOLD = 8;
/** Quiet window after the last gesture frame before momentum is considered done. */
const MANUAL_SCROLL_SETTLE_MS = 140;

/**
 * Auto-follow motion: one native animated scroll per new target.
 *
 * The list moves with `scrollToOffset({ animated: true })`, which UIKit runs on
 * the main thread at the display's full refresh rate (120 Hz on ProMotion),
 * independent of the JS thread. A message arriving is the JS thread's busiest
 * moment (projection, row render, commit), so a follow that stepped the
 * offset from JS each frame stalled exactly when the reply landed, then
 * crawled the last pixels asymptotically. A later target (another segment, a
 * re-measured row) just issues a new animated scroll, which UIKit retargets
 * from wherever the content currently is.
 *
 * While a programmatic scroll is in flight its `onScroll` frames are ours,
 * not the user's: they neither release follow nor flip the away-from-bottom
 * state (which would flash the scroll-to-latest button mid-arrival). The
 * state settles once, from the target, when the scroll ends.
 */
const FOLLOW_NATIVE_SCROLL_MS = 420;
/** Farther than this many viewport heights, land directly rather than animate. */
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

// ---------------------------------------------------------------------------
// Scroll — manual by default; smooth auto-follow while assistant streams in
// near the bottom.
// ---------------------------------------------------------------------------

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
  /**
   * Live post-send anchor. Placement re-runs from the latest user row's own
   * `onLayout` and list content-size events until its geometry settles. Both
   * the four-line clamp and composer collapse can change the target after
   * the initial paint.
   */
  const pendingSendAnchorRef = useRef<{
    userMessageId: string;
    placedRowHeightPx: number | null;
    staleAtMs: number;
  } | null>(null);
  const placeLatestTurnRafRef = useRef(0);
  const trailingMessageIdRef = useRef(trailingMessageId);
  trailingMessageIdRef.current = trailingMessageId;
  /** Content height before the next assistant-driven layout pass. */
  const assistantLayoutBaselineRef = useRef<number | null>(null);
  /** True while the user's finger is actively dragging the list. */
  const isDraggingRef = useRef(false);
  /** Holds through drag momentum so an upward fling still blocks re-arming. */
  const manualScrollActiveRef = useRef(false);
  const manualScrollSettleTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  /** Offset the in-flight (or last) programmatic scroll is heading for. */
  const followCurrentRef = useRef(0);
  /** Ends the in-flight programmatic scroll's ownership of `onScroll`. */
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

      // iOS rubber-band: after overscrolling past the tail the list springs
      // back upward. That return is not a scrollback and must not block
      // re-arming, or follow stays released while the user sits at the end.
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

      // Re-arm the follow latch when the user returns to the true tail. The
      // wider near-bottom band can still follow while armed, but it should not
      // re-enable follow after an intentional scrollback. Never re-arm while a
      // drag is in flight — otherwise the first few pixels of an upward drag
      // (still inside the at-bottom band) re-engage follow and the next
      // streaming layout yanks the user straight back down.
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

      // A programmatic follow scroll owns these frames; it settles the
      // away/tail state once from its target when it lands.
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
    // Reset per-row measurements without claiming follow ownership. A fresh
    // assistant row may arrive while the user is reading history; only an
    // explicit tail action may re-arm that released latch.
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

  // The user grabbed the list — drop follow immediately and remember the drag
  // is live so `onScroll` won't re-arm until the gesture settles.
  const onScrollBeginDrag = useCallback(() => {
    isDraggingRef.current = true;
    manualScrollActiveRef.current = true;
    // The user owns the scroll now — a late post-send re-anchor must not
    // fight the gesture.
    pendingSendAnchorRef.current = null;
    if (manualScrollSettleTimerRef.current) {
      clearTimeout(manualScrollSettleTimerRef.current);
      manualScrollSettleTimerRef.current = null;
    }
    // Pause follow immediately, but only an actual upward delta should block
    // it from re-arming when a tap/drag gesture ends at the live tail.
    setFollowArmed(false);
    stopFollowLoop();
  }, [setFollowArmed, stopFollowLoop]);

  // Gesture settled (lift, or end of momentum). Clear the drag flag and re-arm
  // only if the user came to rest at the true tail.
  const onScrollSettle = useCallback(() => {
    isDraggingRef.current = false;
    scheduleManualScrollSettle();
    const { offsetY, contentHeight, layoutHeight } = metricsRef.current;
    const distFromBottom = Math.max(0, contentHeight - offsetY - layoutHeight);
    // Coming to rest anywhere inside the near-bottom band re-arms follow —
    // the same band `onScroll` uses to release it. Re-arming only at the
    // exact tail left a dead zone where the user was visibly at the bottom
    // but new messages never scrolled into view.
    if (distFromBottom <= nearBottomLimit) {
      followRearmBlockedRef.current = false;
      setFollowArmed(true);
    }
  }, [nearBottomLimit, scheduleManualScrollSettle, setFollowArmed]);

  /** Call when assistant text grows, before layout measures the new height. */
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

      // Never follow backwards on growth — that would scroll the user up
      // against their intent. The post-send placement (gentle) opts in.
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

  /**
   * Place the newest user row above the current trailing slack (chat tail +
   * reserved bottom inset). The same gentle loop owns
   * this motion and streaming follow, so the two movements blend if reply text
   * arrives before placement settles.
   */
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

    // The row hasn't reported its layout yet — `onLatestUserLayout` schedules
    // placement again as soon as (and whenever) its height commits.
    if (measurement?.id !== pending.userMessageId) return;

    pending.placedRowHeightPx = measurement.height;
    const target = resolvePostSendPlacement({
      contentHeightPx: contentHeight,
      viewportHeightPx: metrics.layoutHeight,
      trailingSlackPx: listTrailingSlackRef.current,
      rowHeightPx: measurement.height,
      leadingInsetPx: listLeadingInsetRef.current,
    });

    // Gentle one-shot ease-out on the shared spring loop. If the reply starts
    // streaming mid-nudge, its (non-gentle) target update takes over the same
    // loop — the two motions blend instead of fighting separate animations.
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

      // Composer collapse and footer changes can settle after the user
      // row measures. Re-anchor from this committed geometry as well.
      const pending = pendingSendAnchorRef.current;
      if (
        pending &&
        pending.userMessageId === trailingMessageIdRef.current &&
        Date.now() <= pending.staleAtMs
      ) {
        // This is committed post-layout geometry already: place now rather
        // than two frames later, which on a reply's arrival is two of the
        // JS thread's busiest frames.
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
          // A settled append at the live tail (a reply that lands whole as the
          // turn ends, a synced message, a row finishing its layout): keep
          // the new end in view. Released follow ignores this.
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
      // First layout after a send, or a post-anchor height change (the
      // four-line clamp collapsing a long message) — (re)place against the
      // settled height so the committed target never outlives the geometry
      // it was computed from.
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
      // The row may already be mounted and measured (a keyboard-deferred
      // nudge runs well after the optimistic append), in which case no new
      // `onLayout` will arrive — so kick off the first placement from here.
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
