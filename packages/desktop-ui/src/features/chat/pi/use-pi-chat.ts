import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { piMessageText } from "@stella/contracts/pi-chat";
import {
  abortPiChat,
  piChatSnapshot,
  subscribePiChat,
  watchPiChat,
} from "./pi-chat-store";
import { projectPiChat } from "./pi-chat-records";

const NO_SUBSCRIPTION = () => () => {};

export const usePiChat = (conversationId: string | null) => {
  const enabled = Boolean(conversationId);

  useEffect(() => {
    if (!enabled || !conversationId) return;
    return watchPiChat(conversationId);
  }, [enabled, conversationId]);

  const subscribe = useCallback(
    (listener: () => void) => (enabled && conversationId ? subscribePiChat(conversationId, listener) : () => {}),
    [enabled, conversationId],
  );
  const state = useSyncExternalStore(enabled ? subscribe : NO_SUBSCRIPTION, () => piChatSnapshot(conversationId));

  const projection = useMemo(
    () => projectPiChat({ entries: state.entries, requestIds: state.requestIds }),
    [state.entries, state.requestIds],
  );
  const runningTool = useMemo(() => {
    const running = Object.entries(state.tools).filter(([, tool]) => tool.status === "running");
    const last = running[running.length - 1];
    return last ? { callId: last[0], name: last[1].name } : null;
  }, [state.tools]);
  const latestCompletedTool = useMemo(() => {
    const done = Object.entries(state.tools).filter(([, tool]) => tool.status === "done");
    const last = done[done.length - 1];
    return last ? { toolCallId: last[0], toolName: last[1].name } : null;
  }, [state.tools]);

  const lastEntry = state.entries[state.entries.length - 1];
  const lastMessage = lastEntry?.model?.[0];
  const answerLanded =
    state.running &&
    lastEntry?.kind === "pi.assistant" &&
    lastMessage?.role === "assistant" &&
    lastMessage.stopReason === "stop" &&
    piMessageText(lastMessage).trim().length > 0;

  const cancel = useCallback(() => {
    if (conversationId) abortPiChat(conversationId);
  }, [conversationId]);

  return {
    projection,
    isStreaming: state.running || state.queued.length > 0 || state.remote.length > 0,
    isRunningHere: state.running || state.queued.length > 0,
    remoteTurns: state.remote,
    runtimeStatusText: state.retry
      ? `Retrying: ${state.retry.error}`
      : state.compacting
        ? (state.engineStatus ?? "Compacting the conversation…")
        : (state.engineStatus ?? null),
    isCompacting: state.compacting,
    activeToolCallId: runningTool?.callId ?? null,
    activeToolName: runningTool?.name ?? null,
    latestCompletedTool,
    hasToolActivity: Object.keys(state.tools).length > 0,
    isToolActive: runningTool !== null,
    answerLanded,
    failure: state.failure ?? null,
    cancelCurrentStream: cancel,
  };
};
