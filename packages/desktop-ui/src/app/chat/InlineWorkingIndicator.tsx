/**
 * Inline working indicator — the Claude-style "next-line" indicator.
 *
 * Mounted (persistently) as a keyed `ChatTimeline` item
 * (`.event-list-working-indicator`), so it reads as the line directly below
 * the streaming/last assistant message and above any queued user messages.
 *
 * Behavior:
 *  - While the assistant is thinking it shows the mark alone; while a tool is
 *    running it shows that tool's friendly status. A run passes through both
 *    repeatedly — preamble, tool, answer — and the indicator stays up across
 *    the whole of it.
 *  - Long-running agent task presence lives in the composer's task chip; this
 *    inline indicator only follows the orchestrator's thinking/tool lifecycle.
 *  - It appears only after `SHOW_DELAY_MS` of continuous work, so a reply
 *    that lands sooner never shows it.
 *  - Inside a chat timeline the reply-morph controller decides how it leaves:
 *    when a reply arrives with the deactivation the indicator's bubble grows
 *    into the reply bubble (see `reply-morph.ts`) and the slot is vacated at
 *    once; otherwise it plays the short grow-out. Outside a timeline it
 *    falls back to the ordinary grow-out after the `MIN_VISIBLE_MS` floor, an
 *    immediate exit (`exitImmediately`), or the handoff clear (`handoff`).
 *  - The parent mounts the indicator unconditionally and toggles `active` so
 *    React doesn't rip the node out before the exit animation runs. If
 *    `active` flips back true mid-exit, the exit is canceled and live updates
 *    resume.
 *  - Once fully exited, the inner content is removed (`--vacated`); the
 *    timeline wrapper's `:has(--vacated)` rule then collapses the slot so an
 *    idle chat carries no ghost gutter.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { notifyChatContentGrowth } from "@/shell/chat-scroll-follow";
import {
  getInlineWorkingIndicatorExitDelayMs,
  INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS,
  INLINE_WORKING_INDICATOR_SHOW_DELAY_MS,
  type InlineWorkingIndicatorMountProps,
  type InlineWorkingIndicatorProps,
} from "@/features/chat/working-indicator-state";
import { WorkingIndicator } from "./WorkingIndicator";
import { useReplyMorphController } from "./reply-morph";
import "./indicators.css";

export type {
  InlineWorkingIndicatorMountProps,
  InlineWorkingIndicatorProps,
} from "@/features/chat/working-indicator-state";

/**
 * Exit timing. There's no hold beat anymore (the indicator used to linger
 * to show a "Done · task" state) — once work stops we want the indicator
 * gone promptly, with just a short grow-out so it doesn't snap away.
 */
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
  // Snapshot the live props the moment `active` flips false so the exit
  // animation displays a stable last-known label even though upstream
  // tool/status flags clear out.
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

  // Stay mounted until the exit animation finishes. If `active` flips back
  // to true mid-animation, cancel the exit and resume live updates.
  const [renderShell, setRenderShell] = useState(false);
  const [entering, setEntering] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const exitTimerRef = useRef<number | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const leavingRef = useRef(false);
  leavingRef.current = leaving;
  const morphController = useReplyMorphController();

  useEffect(() => {
    if (!morphController) return;
    return morphController.attachIndicator({
      pill: () =>
        leavingRef.current
          ? null
          : (rootRef.current?.querySelector<HTMLElement>(
              ".inline-working-indicator__indicator",
            ) ?? null),
      vacate: () => {
        if (exitTimerRef.current !== null) {
          window.clearTimeout(exitTimerRef.current);
          exitTimerRef.current = null;
        }
        flushSync(() => {
          setRenderShell(false);
          setLeaving(false);
          setEntering(false);
        });
      },
      exit: () => {
        if (exitTimerRef.current !== null) return;
        setLeaving(true);
        exitTimerRef.current = window.setTimeout(() => {
          exitTimerRef.current = null;
          setRenderShell(false);
          setLeaving(false);
        }, EXIT_ANIMATION_MS);
      },
    });
  }, [morphController]);
  const activatedAtRef = useRef<number | null>(null);
  const wasActiveRef = useRef(false);
  const showingThinking = active && !runningTool;
  const wasShowingThinkingRef = useRef(showingThinking);
  // Seeds the reasoning label ("Thinking" / "Mulling it over" / …). It rerolls
  // on every entry into thinking, not once per turn: a run returns to thinking
  // after each tool, and repeating the turn's first label there would read as
  // if nothing had moved.
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
      morphController?.indicatorReactivated();
      if (!wasActiveRef.current) {
        activatedAtRef.current = Date.now();
      }
      wasActiveRef.current = true;
      setLeaving(false);
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
    if (morphController) {
      if (!leavingRef.current) {
        morphController.indicatorDeactivated(Boolean(handoff));
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
  }, [active, renderShell, exitImmediately, handoff, morphController]);

  useEffect(
    () => () => {
      if (showTimerRef.current !== null)
        window.clearTimeout(showTimerRef.current);
      if (exitTimerRef.current !== null)
        window.clearTimeout(exitTimerRef.current);
    },
    [],
  );

  // The wrapper itself is always rendered with a fixed height once the
  // indicator has appeared — `renderShell` only gates the inner content,
  // so the gutter the indicator carved out below the assistant message
  // remains after the grow-out exit completes (no layout shift). A new
  // turn replaces the wrapper entirely (different React key in
  // `ChatTimeline`), at which point the new wrapper occupies the slot.
  const showInner = renderShell;

  // The indicator is its own timeline item below the assistant row, so it
  // extends the live tail without touching any subtree the keyed scroll-follow
  // watches — nothing would re-run targeting for it, and the row-only follow
  // would leave it parked under the viewport edge. Announce the growth the way
  // the inline cards do; the scroll surfaces decide whether to act on it.
  useLayoutEffect(() => {
    if (!showInner) return;
    notifyChatContentGrowth();
  }, [showInner]);

  return (
    <div
      ref={rootRef}
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
