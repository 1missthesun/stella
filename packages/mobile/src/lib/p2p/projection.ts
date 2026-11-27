// A computer's pi chat (its entries and the turn still streaming) as the phone's chat rows: the
// entries become journal records the way the desktop app projects them
// (desktop-ui/src/features/chat/pi/pi-chat-records.ts), and the app's own journal projection
// turns those into messages, so tool steps, files and replies look as they do everywhere else.

import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import {
  isPiAgentInput,
  isPiAskFirstInput,
  isPiScheduledInput,
  piJournalUserMessage,
  piMessageText,
  piTerminalNotice,
  type PiChatState,
} from "@stella/contracts/pi-chat";
import { toServerTime } from "@stella/contracts/server-clock";
import { projectCloudConversationMessages } from "../cloud-journal-projection";
import type { ChatMessage } from "../../types";
import type { ComputerChatState, OutboxItem } from "./computer-chat";

const piRecords = (state: PiChatState): JournalRecord[] => {
  const records: JournalRecord[] = [];
  let turnId = "pi:0";
  let hiddenTurn = false;
  let ending: JournalRecord | undefined;
  const removed = new Set<number>();
  for (const entry of state.entries) {
    const choice = entry.kind === "stella.safeguard" ? (entry.data as { state?: unknown; targets?: unknown }) : null;
    if (choice?.state === "removed" && Array.isArray(choice.targets)) {
      for (const target of choice.targets) removed.add(Number(target));
    }
  }
  let lastSeq = 0;
  for (const entry of state.entries) {
    const message = entry.model?.[0];
    lastSeq = Math.max(lastSeq, entry.id);
    if (!message || message.role === "system" || removed.has(entry.id) || entry.kind === "stella.safeguard") continue;
    const createdAtMs = toServerTime(message.timestamp);
    const base = { seq: entry.id, turnId, createdAtMs, kind: "message" as const };
    if (entry.kind === "pi.user" && message.role === "user") {
      if (ending) records.push(ending);
      ending = undefined;
      turnId = `pi:${entry.id}`;
      const journaled = piJournalUserMessage(message);
      const clientMsgId = state.requestIds[entry.id] ?? journaled.clientMsgId;
      hiddenTurn = journaled.hidden && (isPiAskFirstInput(message) || (!isPiAgentInput(message) && !isPiScheduledInput(message)));
      records.push({
        ...base,
        turnId,
        role: "user",
        hidden: journaled.hidden,
        ...(clientMsgId ? { clientMsgId } : {}),
        payload: journaled.message,
      });
    } else if (hiddenTurn || (message.role === "assistant" && message.stella?.hidden)) {
      continue;
    } else if (message.role === "assistant" && ("reminder" in message || "welcome" in message || "viewRestore" in message)) {
      continue;
    } else if (entry.kind === "pi.assistant" && message.role === "assistant") {
      records.push({ ...base, role: "assistant", hidden: false, payload: message as unknown as Record<string, unknown> });
      const terminal = piTerminalNotice(message);
      ending = terminal
        ? { seq: entry.id, turnId, createdAtMs, kind: "turn", phase: terminal.phase, notice: terminal.notice }
        : undefined;
    } else if (entry.kind === "pi.tool-result" && message.role === "toolResult") {
      records.push({ ...base, role: "toolResult", hidden: false, payload: message as unknown as Record<string, unknown> });
    }
  }
  // The reply still streaming reads as the turn's next message until the computer saves it.
  if (state.streaming && !hiddenTurn && piMessageText(state.streaming).trim()) {
    records.push({
      seq: lastSeq + 1,
      turnId,
      createdAtMs: toServerTime(state.streaming.timestamp),
      kind: "message",
      role: "assistant",
      hidden: false,
      payload: state.streaming as unknown as Record<string, unknown>,
    });
  }
  if (ending && !state.running) records.push(ending);
  return records;
};

const pendingRow = (item: OutboxItem, send?: ChatMessage["send"]): ChatMessage => ({
  id: `p2p:${item.requestId}`,
  requestId: item.requestId,
  role: "user",
  text: item.text,
  createdAt: item.createdAt,
  ...(send ? { send } : {}),
  ...(item.attachments.length
    ? {
        attachmentPreviews: item.attachments.map((attachment) => ({
          path: attachment.uri,
          name: attachment.name,
          ...(attachment.kind === "image" ? { imageUri: attachment.uri } : {}),
        })),
        hasImage: item.attachments.some((attachment) => attachment.kind === "image"),
        thumbnailUris: item.attachments.filter((a) => a.kind === "image").map((a) => a.uri),
        documentNames: item.attachments.filter((a) => a.kind !== "image").map((a) => a.name),
      }
    : {}),
});

export const computerChatMessages = (state: ComputerChatState, online: boolean): ChatMessage[] => {
  const messages = projectCloudConversationMessages({
    conversationId: state.conversationId ?? undefined,
    records: piRecords(state.pi),
    hasOlder: state.pi.hasOlder,
  });
  const rows = messages.map((message) => {
    const uris = message.role === "user" && !message.thumbnailUris?.length ? state.previews[message.id] : undefined;
    return uris?.length ? { ...message, thumbnailUris: uris, hasImage: true } : message;
  });
  for (const item of state.sent) rows.push(pendingRow(item));
  for (const item of state.outbox) {
    rows.push(pendingRow(item, item.failed ? "not_sent" : online ? undefined : "queued"));
  }
  return rows;
};
