/**
 * Hook that captures conversation events into the global trace store,
 * sub-agent tool calls and lifecycle events included.
 */
import { useEffect, useRef } from "react";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import type { EventRecord } from "@stella/contracts/local-chat";
import {
  isAgentStartedEvent,
  isAgentCompletedEvent,
  isAgentCanceledEvent,
  isAgentFailedEvent,
  isAgentProgressEvent,
  isToolRequest,
  isToolResult,
  isUserMessage,
  isAssistantMessage,
  getEventText,
} from "@/features/chat/lib/event-transforms";
import {
  traceTaskStarted,
  traceTaskCompleted,
  traceTaskCanceled,
  traceTaskFailed,
  traceTaskProgress,
  traceUserMessage,
  traceAssistantMessage,
  addTrace,
  formatTraceSnippet,
} from "@/platform/diagnostics/trace-store";
const MAX_SEEN_IDS = 5000;
/**
 * Monitors the conversation event feed and emits trace entries for
 * task lifecycle events (sub-agent delegation), tool requests/results
 * from persisted events, and message flow.
 */
export function useTraceEventMonitor(
  enabled: boolean,
  events: readonly EventRecord[],
) {
  const seenIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const seen = seenIdsRef.current;
    if (events.length === 0) seen.clear();
    if (!enabled) return;
    for (const event of events) {
      if (seen.has(event._id)) continue;
      seen.add(event._id);
      // Bound the set within a single (long) conversation: evict oldest ids
      // once over the cap. Preserves de-dup for recent events, the only ones
      // that re-appear in the rebuilt `events` list each tick.
      if (seen.size > MAX_SEEN_IDS) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      if (isAgentStartedEvent(event)) {
        const p = event.payload;
        traceTaskStarted(
          p.agentId,
          p.agentType,
          p.description,
          p.parentAgentId,
        );
        continue;
      }
      if (isAgentCompletedEvent(event)) {
        traceTaskCompleted(event.payload.agentId, event.payload.result);
        continue;
      }
      if (isAgentFailedEvent(event)) {
        traceTaskFailed(event.payload.agentId, event.payload.error);
        continue;
      }
      if (isAgentCanceledEvent(event)) {
        traceTaskCanceled(event.payload.agentId, event.payload.error);
        continue;
      }
      if (isAgentProgressEvent(event)) {
        traceTaskProgress(event.payload.agentId, event.payload.statusText);
        continue;
      }
      if (isToolRequest(event)) {
        const p = event.payload;
        // Only trace if it has agentType (sub-agent tool use) to avoid
        // duplicating the IPC tool-start events from the orchestrator
        if (p.agentType && p.agentType !== AGENT_IDS.ORCHESTRATOR) {
          addTrace("tool", "tool-request", `[${p.agentType}] ${p.toolName}`, {
            toolName: p.toolName,
            agent: p.agentType,
            data: p.args ? { args: p.args } : undefined,
          });
        }
        continue;
      }
      if (isToolResult(event)) {
        const p = event.payload;
        if (p.error) {
          addTrace(
            "error",
            "tool-error",
            `${p.toolName}: ${formatTraceSnippet(p.error, 200)}`,
            {
              toolName: p.toolName,
              agent: p.agentType,
              data: { error: p.error },
            },
          );
        }
        continue;
      }
      if (isUserMessage(event)) {
        traceUserMessage(getEventText(event), event._id);
        continue;
      }
      if (isAssistantMessage(event)) {
        traceAssistantMessage(getEventText(event), event._id);
        continue;
      }
    }
  }, [enabled, events]);
}
