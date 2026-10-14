import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getInlineWorkingIndicatorExitDelayMs,
  INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS,
  INLINE_WORKING_INDICATOR_SHOW_DELAY_MS,
  type InlineWorkingIndicatorMountProps,
  type InlineWorkingIndicatorProps,
} from "@/features/chat/working-indicator-state";
import { WorkingIndicator } from "./WorkingIndicator";
import { useReplyHandoffController } from "./reply-handoff";
import "./indicators.css";

export type {
  InlineWorkingIndicatorMountProps,
  InlineWorkingIndicatorProps,
} from "@/features/chat/working-indicator-state";

export const EXIT_ANIMATION_MS = 240;
export const ENTER_ANIMATION_MS = 320;
const MIN_VISIBLE_MS = INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS;
const SHOW_DELAY_MS = INLINE_WORKING_INDICATOR_SHOW_DELAY_MS;

function newReasoningSeed(): string {
  return `${Date.now()}-${Math.random()}`;
}

export function InlineWorkingIndicator({
  active,
  exitImmediately,
  handoff,
  runningTool,
  runningToolId,
  status,
  compacting,
  minimumVisibleMs,
}: InlineWorkingIndicatorMountProps) {
  const liveProps = useMemo<InlineWorkingIndicatorProps>(
    () => ({
      runningTool,
      runningToolId,
      status,
      compacting,
      minimumVisibleMs,
    }),
    [runningTool, runningToolId, status, compacting, minimumVisibleMs],
  );
  const frozenPropsRef = useRef<InlineWorkingIndicatorProps>(liveProps);

  useEffect(() => {
    if (active) {
      frozenPropsRef.current = liveProps;
    }
  }, [active, liveProps]);

  const displayProps = active ? liveProps : frozenPropsRef.current;

  const [renderShell, setRenderShell] = useState(false);
  const [entering, setEntering] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const exitTimerRef = useRef<number | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const leavingRef = useRef(false);
  leavingRef.current = leaving;
  const handoffController = useReplyHandoffController();
  const renderShellRef = useRef(renderShell);
  renderShellRef.current = renderShell;
  const [replyHeld, setReplyHeld] = useState(false);
  const heldToolIdRef = useRef<string | undefined>(undefined);
  const runningToolIdRef = useRef(runningToolId);
  runningToolIdRef.current = runningToolId;

  useEffect(() => {
    if (!handoffController) return;
    return handoffController.attachIndicator({
      shown: () => renderShellRef.current,
      vacate: () => {
        if (exitTimerRef.current !== null) {
          window.clearTimeout(exitTimerRef.current);
          exitTimerRef.current = null;
        }
        setRenderShell(false);
        setLeaving(false);
        setEntering(false);
        heldToolIdRef.current = runningToolIdRef.current;
        setReplyHeld(true);
      },
      release: () => setReplyHeld(false),
      exit: () => {
        if (!renderShellRef.current || exitTimerRef.current !== null) return;
        setLeaving(true);
        exitTimerRef.current = window.setTimeout(() => {
          exitTimerRef.current = null;
          setRenderShell(false);
          setLeaving(false);
        }, EXIT_ANIMATION_MS);
      },
    });
  }, [handoffController]);
  useEffect(() => {
    if (!replyHeld) return;
    if (!active || (runningToolId && runningToolId !== heldToolIdRef.current)) {
      setReplyHeld(false);
    }
  }, [active, replyHeld, runningToolId]);
  const activatedAtRef = useRef<number | null>(null);
  const wasActiveRef = useRef(false);
  const showingThinking = active && !runningTool;
  const wasShowingThinkingRef = useRef(showingThinking);
  const [reasoningSeed, setReasoningSeed] = useState(newReasoningSeed);

  useEffect(() => {
    if (showingThinking && !wasShowingThinkingRef.current) {
      setReasoningSeed(newReasoningSeed());
    }
    wasShowingThinkingRef.current = showingThinking;
  }, [showingThinking]);

  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(() => {
      setEntering(false);
    }, ENTER_ANIMATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [entering]);

  useLayoutEffect(() => {
    const clearTimer = () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };

    if (active) {
      clearTimer();
      handoffController?.indicatorReactivated();
      if (!wasActiveRef.current) {
        activatedAtRef.current = Date.now();
      }
      wasActiveRef.current = true;
      setLeaving(false);
      if (replyHeld) {
        clearShowTimer();
        return;
      }
      if (renderShell || showTimerRef.current !== null) return;
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        setEntering(true);
        setRenderShell(true);
      }, SHOW_DELAY_MS);
      return;
    }

    clearShowTimer();
    wasActiveRef.current = false;
    setEntering(false);
    if (!renderShell) return;
    if (handoffController) {
      if (!leavingRef.current) {
        handoffController.indicatorDeactivated(Boolean(handoff));
      }
      return;
    }
    if (handoff) {
      clearTimer();
      setRenderShell(false);
      setLeaving(false);
      return;
    }

    const startExit = () => {
      setLeaving(true);
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        setRenderShell(false);
        setLeaving(false);
      }, EXIT_ANIMATION_MS);
    };
    const remainingMs = exitImmediately
      ? 0
      : getInlineWorkingIndicatorExitDelayMs({
          activatedAtMs: activatedAtRef.current ?? Date.now(),
          nowMs: Date.now(),
          minVisibleMs: MIN_VISIBLE_MS,
        });
    if (remainingMs > 0) {
      exitTimerRef.current = window.setTimeout(startExit, remainingMs);
    } else {
      startExit();
    }

    return () => {
      clearTimer();
    };
  }, [
    active,
    renderShell,
    replyHeld,
    exitImmediately,
    handoff,
    handoffController,
  ]);

  useEffect(
    () => () => {
      if (showTimerRef.current !== null)
        window.clearTimeout(showTimerRef.current);
      if (exitTimerRef.current !== null)
        window.clearTimeout(exitTimerRef.current);
    },
    [],
  );

  const showInner = renderShell;

  return (
    <div
      className={`inline-working-indicator${entering ? " inline-working-indicator--entering" : ""}${leaving ? " inline-working-indicator--leaving" : ""}${leaving && handoff ? " inline-working-indicator--handoff" : ""}${showInner ? "" : " inline-working-indicator--vacated"}`}
      aria-live="polite"
    >
      {showInner && (
        <WorkingIndicator
          className="inline-working-indicator__indicator"
          status={displayProps.status ?? undefined}
          toolName={displayProps.runningTool}
          toolCallId={displayProps.runningToolId}
          compacting={displayProps.compacting}
          isReasoning={!displayProps.runningTool}
          reasoningSeed={reasoningSeed}
          minimumVisibleMs={displayProps.minimumVisibleMs}
          animationActive={active && !leaving}
        />
      )}
    </div>
  );
}
