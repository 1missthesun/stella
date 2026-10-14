import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import type { LiveTurn } from "@stella/contracts/conversation-store-reducer";
import type { PiRemoteTurn } from "@stella/contracts/pi-chat";

const AGENT_OPERATION = /^pia:/;

const ownTurn = (turnId: string, deviceId: string) =>
  turnId.startsWith(`desktop:${deviceId}:`) || turnId.startsWith(`voice:${deviceId}:`);

export const remoteTurnRunning = ({
  socketLive,
  live,
  records,
  polled,
  ownDeviceId,
}: {
  socketLive: boolean;
  live: LiveTurn | null;
  records: readonly JournalRecord[];
  polled: readonly PiRemoteTurn[];
  ownDeviceId: string | null;
}): boolean => {
  if (!socketLive) return polled.length > 0;
  const ended = new Set<string>();
  const agentOperations = new Set<string>();
  for (const record of records) {
    if (record.kind === "turn" && record.phase !== "started") ended.add(record.turnId);
    else if (record.kind === "message" && record.role === "user" && AGENT_OPERATION.test(record.clientMsgId ?? "")) {
      agentOperations.add(record.turnId);
    }
  }
  if (polled.some((turn) => !ended.has(turn.turnId))) return true;
  if (!live || !ownDeviceId) return false;
  return !ownTurn(live.turnId, ownDeviceId) && !agentOperations.has(live.turnId) && !ended.has(live.turnId);
};
