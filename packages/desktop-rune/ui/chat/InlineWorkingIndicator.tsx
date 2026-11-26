import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getInlineWorkingIndicatorExitDelayMs,
  INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS,
  INLINE_WORKING_INDICATOR_SHOW_DELAY_MS,
  type InlineWorkingIndicatorMountProps,
  type InlineWorkingIndicatorProps,
} from "@/features/chat/working-indicator-state";
import { useT } from "@/shared/i18n";
import { fontSize, radius, useTokens } from "../theme";
import { WorkingIndicator } from "./WorkingIndicator";
import { useReplyHandoffController } from "@/app/chat/reply-handoff";
import { useChatSurfaceLook } from "./chat-text";

export type { InlineWorkingIndicatorMountProps, InlineWorkingIndicatorProps } from "@/features/chat/working-indicator-state";

export const EXIT_ANIMATION_MS = 240;
export const ENTER_ANIMATION_MS = 320;
const LEAVE_MS = 220;
const MIN_VISIBLE_MS = INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS;
const SHOW_DELAY_MS = INLINE_WORKING_INDICATOR_SHOW_DELAY_MS;

function newReasoningSeed(): string {
  return `${Date.now()}-${Math.random()}`;
}

export type InlineIndicatorPhase = "shown" | "entering" | "leaving" | "handoff" | "reserved" | "vacated";

/**
 * desktop-ui's `InlineWorkingIndicator`: the delayed, minimum-visible working bubble at the end
 * of the timeline, which hands its place to the reply that lands. `onPhase` reports what the row
 * around it needs (its top padding collapses while leaving, and it vanishes when vacated).
 */
export function InlineWorkingIndicator({
  active,
  exitImmediately,
  handoff,
  runningTool,
  runningToolId,
  status,
  compacting,
  minimumVisibleMs,
  onStop,
  onPhase,
}: InlineWorkingIndicatorMountProps & { onPhase?: (phase: InlineIndicatorPhase) => void }) {
  const t = useT();
  const tokens = useTokens();
  const liveProps = useMemo<InlineWorkingIndicatorProps>(
    () => ({ runningTool, runningToolId, status, compacting, minimumVisibleMs }),
    [runningTool, runningToolId, status, compacting, minimumVisibleMs],
  );
  const frozenPropsRef = useRef<InlineWorkingIndicatorProps>(liveProps);
  useEffect(() => {
    if (active) frozenPropsRef.current = liveProps;
  }, [active, liveProps]);
  const displayProps = active ? liveProps : frozenPropsRef.current;

  const [renderShell, setRenderShell] = useState(false);
  const [entering, setEntering] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          clearTimeout(exitTimerRef.current);
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
        exitTimerRef.current = setTimeout(() => {
          exitTimerRef.current = null;
          setRenderShell(false);
          setLeaving(false);
        }, EXIT_ANIMATION_MS);
      },
    });
  }, [handoffController]);
  useEffect(() => {
    if (!replyHeld) return;
    if (!active || (runningToolId && runningToolId !== heldToolIdRef.current)) setReplyHeld(false);
  }, [active, replyHeld, runningToolId]);
  const activatedAtRef = useRef<number | null>(null);
  const wasActiveRef = useRef(false);
  const showingThinking = active && !runningTool;
  const wasShowingThinkingRef = useRef(showingThinking);
  const [reasoningSeed, setReasoningSeed] = useState(newReasoningSeed);
  useEffect(() => {
    if (showingThinking && !wasShowingThinkingRef.current) setReasoningSeed(newReasoningSeed());
    wasShowingThinkingRef.current = showingThinking;
  }, [showingThinking]);
  useEffect(() => {
    if (!entering) return;
    const timer = setTimeout(() => setEntering(false), ENTER_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [entering]);

  useLayoutEffect(() => {
    const clearTimer = () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };
    if (active) {
      clearTimer();
      handoffController?.indicatorReactivated();
      if (!wasActiveRef.current) activatedAtRef.current = performance.now();
      wasActiveRef.current = true;
      setLeaving(false);
      if (replyHeld) {
        clearShowTimer();
        return;
      }
      if (renderShell || showTimerRef.current !== null) return;
      showTimerRef.current = setTimeout(() => {
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
      if (!leavingRef.current) handoffController.indicatorDeactivated(Boolean(handoff));
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
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = null;
        setRenderShell(false);
        setLeaving(false);
      }, EXIT_ANIMATION_MS);
    };
    const remainingMs = exitImmediately
      ? 0
      : getInlineWorkingIndicatorExitDelayMs({ activatedAtMs: activatedAtRef.current ?? performance.now(), nowMs: performance.now(), minVisibleMs: MIN_VISIBLE_MS });
    if (remainingMs > 0) exitTimerRef.current = setTimeout(startExit, remainingMs);
    else startExit();
    return () => clearTimer();
  }, [active, renderShell, replyHeld, exitImmediately, handoff, handoffController]);

  useEffect(
    () => () => {
      if (showTimerRef.current !== null) clearTimeout(showTimerRef.current);
      if (exitTimerRef.current !== null) clearTimeout(exitTimerRef.current);
    },
    [],
  );

  const showInner = renderShell;
  const reserving = active && !renderShell && !replyHeld;
  const handingOff = leaving && Boolean(handoff);
  const phase: InlineIndicatorPhase = leaving ? (handingOff ? "handoff" : "leaving") : showInner ? (entering ? "entering" : "shown") : reserving ? "reserved" : "vacated";
  useLayoutEffect(() => onPhase?.(phase), [onPhase, phase]);

  const minHeight = useChatSurfaceLook().line + 16;
  const leaveLook = handingOff ? { opacity: 0, y: -5, scale: 0.97 } : { opacity: 0, y: -3, scale: 0.94, blur: 2 };
  return (
    <row
      w="full"
      align="center"
      minH={leaving && !handingOff ? 0 : minHeight}
      h={leaving && !handingOff ? 0 : undefined}
      clip={leaving && !handingOff ? 0 : undefined}
      origin={handingOff ? [0, 0.5] : [0, 0]}
      enter={entering ? { opacity: 0, y: 4, scale: 0.96, dur: ENTER_ANIMATION_MS / 1000 } : undefined}
      {...(leaving ? leaveLook : { opacity: 1, y: 0, scale: 1, blur: 0 })}
      motion={{ dur: (handingOff ? EXIT_ANIMATION_MS : LEAVE_MS) / 1000, bounce: 0 }}
      layout={leaving && !handingOff ? LEAVE_MS / 1000 : undefined}
      role="status"
    >
      {showInner ? (
        <WorkingIndicator
          status={displayProps.status ?? undefined}
          toolName={displayProps.runningTool}
          toolCallId={displayProps.runningToolId}
          compacting={displayProps.compacting}
          isReasoning={!displayProps.runningTool}
          reasoningSeed={reasoningSeed}
          minimumVisibleMs={displayProps.minimumVisibleMs}
          animationActive={active && !leaving}
        />
      ) : null}
      {showInner && onStop && !leaving ? (
        <box ml={4} px={10} py={4} radius={radius["3xl"]} hoverColor={tokens.c.textStrong} hoverGroup enter={{ opacity: 0, y: 4, dur: 0.4 }} onPress={onStop} role="button" focusable label={t("app.chat.composer.stop")}>
          <text size={fontSize.sm} color={tokens.c.textWeak} hoverColor={tokens.c.textStrong}>
            {t("app.chat.composer.stop")}
          </text>
        </box>
      ) : null}
    </row>
  );
}
