import {
  buildWorkingIndicatorState,
  IDLE_WORKING_ACTIVITY,
  type WorkingIndicatorState,
} from "../components/working-indicator-state";
import type { JournalIndex } from "./journal-index";
import type { LiveTurn } from "./cloud-conversation-store";
import { activeCloudTurnId, cloudTurnActivity } from "./cloud-journal-projection";

export function localSendTurn(
  index: JournalIndex,
  activeDispatchId: string | null,
  activeSendMessageId: string | null | undefined,
): { turnId: string | null; terminal: boolean } {
  const turnId = activeDispatchId || activeSendMessageId
    ? index.records.find((record) =>
        record.kind === "message" && record.role === "user" &&
        ((Boolean(activeDispatchId) && record.clientMsgId === activeDispatchId) ||
          (Boolean(activeSendMessageId) &&
            (record.clientMsgId === activeSendMessageId ||
              record.payload.originUserMessageId === activeSendMessageId))))?.turnId ?? null
    : null;
  const terminal = Boolean(turnId && index.turn(turnId)?.records.some((record) =>
    record.kind === "turn" && record.phase !== "started"));
  return { turnId, terminal };
}

export function canonicalWorkingState(args: {
  index: JournalIndex;
  live: LiveTurn | null;
  localSending: boolean;
  localIndicator: WorkingIndicatorState;
  activeDispatchId: string | null;
  activeSendMessageId?: string | null;
  hasQueuedSend?: boolean;
  caughtUp?: boolean;
  authoritativeActivity?: "idle" | "running";
}): { sending: boolean; workingIndicator: WorkingIndicatorState } {
  const trustRecords = args.caughtUp !== false;
  const runningTurnId = trustRecords
    ? activeCloudTurnId(args.index, args.live)
    : args.authoritativeActivity === "running"
      ? (args.live?.turnId ?? activeCloudTurnId(args.index, args.live))
      : null;
  const authoritativeRunning =
    !trustRecords && args.authoritativeActivity === "running";
  const { turnId: localTurnId, terminal: localTerminal } = localSendTurn(
    args.index,
    args.activeDispatchId,
    args.activeSendMessageId,
  );
  const localPending = args.localSending && !localTerminal;
  const sending =
    localPending ||
    Boolean(runningTurnId) ||
    authoritativeRunning ||
    Boolean(args.hasQueuedSend);
  if (localPending && !localTurnId) {
    return { sending, workingIndicator: args.localIndicator };
  }
  const turnId = localPending ? localTurnId : runningTurnId;
  const journal = cloudTurnActivity(
    (turnId ? args.index.turn(turnId)?.records : undefined) ?? [],
    turnId,
  );
  const live = args.live?.turnId === turnId ? args.live : null;
  const deviceTool = localPending && !journal.answerLanded
    ? args.localIndicator.toolName : undefined;
  return {
    sending,
    workingIndicator: buildWorkingIndicatorState({
      sending,
      activity: turnId ? {
        ...journal,
        answerLanded: journal.answerLanded && !args.hasQueuedSend,
        ...((!journal.answerLanded || args.hasQueuedSend) && live?.toolName
          ? {
              toolName: live.toolCallId === journal.toolCallId && journal.toolName ? journal.toolName : live.toolName,
              toolCallId: live.toolCallId ?? undefined,
            }
          : {}),
        ...((!journal.answerLanded || args.hasQueuedSend) && live?.toolLabel ? { statusText: live.toolLabel } : {}),
        ...(deviceTool ? { toolName: deviceTool,
          toolCallId: args.localIndicator.toolCallId,
          statusText: args.localIndicator.status } : {}),
        hasToolActivity: journal.hasToolActivity || Boolean(live?.toolName),
      } : { ...IDLE_WORKING_ACTIVITY, answerLanded: localTerminal && !args.hasQueuedSend },
    }),
  };
}
