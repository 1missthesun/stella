/**
 * The cloud journal of a conversation stored in the cloud, for the pi-durable
 * chat that runs it on this computer (`@stella/agent/host/desktop-journal`).
 * Turns go in through the runner's cloud transcript writer, the same durable,
 * lease-holding begin and finish the agent loops use; what other writers
 * journaled comes back through `history.read`, as the code tool's history
 * reads it.
 */
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DesktopJournal, JournalReadRecord, RelayedMessage } from "@stella/agent/host/desktop-journal";
import { BackendClient } from "@stella/contracts/backend/client";
import { attachmentContentType } from "@stella/contracts/attachment-content-type";
import type { OpenSession } from "./sessions.js";
import { JOURNAL_CHECKPOINT_PATH, type JournalCheckpointPublish } from "@stella/contracts/journal-checkpoint";
import {
  TURN_ATTACHMENTS_MAX,
  TURN_CONTEXT_DISPLAY_MAX_CHARS,
  TURN_CONTEXT_TEXT_MAX_CHARS,
  TURN_PLANE_PROTOCOL,
  turnStartPath,
  type CloudTurnContext,
  type CloudTurnStartRequest,
} from "@stella/contracts/turn-plane/turn-start";

const READ_TIMEOUT_MS = 30_000;
const TOOL_FRAME_TIMEOUT_MS = 10_000;
const RELAY_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const RELAY_UPLOAD_TIMEOUT_MS = 5 * 60_000;

type RelayUpload = { path: string; contentType: string };
type SiteAuth = { baseUrl: string; authToken: string };

const relayUploads = new Map<string, Promise<RelayUpload[]>>();

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const safeName = (name: string): string =>
  name.replace(/[\u0000-\u001f\u007f/\\]/g, "-").trim().slice(-80) || "attachment";

const relayFileBytes = async (
  file: NonNullable<RelayedMessage["files"]>[number],
): Promise<{ bytes: Buffer; contentType: string; name: string }> => {
  const source = file.url?.trim() ?? "";
  const dataMatch = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(source);
  if (dataMatch) {
    return {
      bytes: dataMatch[2] ? Buffer.from(dataMatch[3] ?? "", "base64") : Buffer.from(decodeURIComponent(dataMatch[3] ?? ""), "utf8"),
      contentType: attachmentContentType({ declared: file.mimeType || dataMatch[1], name: file.name }),
      name: file.name || "attachment",
    };
  }
  const localPath = file.path?.trim() || (source.startsWith("file:") ? fileURLToPath(source) : "");
  if (!localPath) throw new Error("An attached file has no source on this computer.");
  const bytes = await fs.readFile(localPath);
  const name = file.name || localPath.split(/[\\/]/).pop() || "attachment";
  return {
    bytes,
    contentType: attachmentContentType({ declared: file.mimeType, name, bytes }),
    name,
  };
};

const uploadRelayed = async (auth: () => SiteAuth | null, message: RelayedMessage): Promise<RelayUpload[]> => {
  const first = auth();
  if (!first) throw new Error("Sign in to send this message on to where Stella runs.");
  const items = [
    ...(message.images ?? []).map((image, index) => ({
      bytes: Buffer.from(image.data, "base64"),
      contentType: image.mimeType,
      name: `image-${index + 1}.${IMAGE_EXTENSIONS[image.mimeType.toLowerCase()] ?? "img"}`,
    })),
    ...(await Promise.all((message.files ?? []).map(relayFileBytes))),
  ];
  if (items.length === 0) return [];
  const client = new BackendClient({
    baseUrl: first.baseUrl,
    getToken: async () => auth()?.authToken ?? first.authToken,
  });
  try {
    const uploaded: RelayUpload[] = [];
    for (const [index, item] of items.entries()) {
      if (item.bytes.byteLength <= 0 || item.bytes.byteLength > RELAY_ATTACHMENT_MAX_BYTES) {
        throw new Error(`${item.name} is too large to send on to where Stella runs.`);
      }
      const prepared = await client.call("drive.prepareUpload", {
        path: `Chat Attachments/relayed/${message.clientMsgId}/${String(index + 1).padStart(2, "0")}-${safeName(item.name)}`,
        sizeBytes: item.bytes.byteLength,
        contentType: item.contentType,
      });
      const response = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": prepared.contentType },
        body: item.bytes,
        signal: AbortSignal.timeout(RELAY_UPLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Uploading ${item.name} failed (${response.status}).`);
      const record = await client.call("drive.finalizeUpload", {
        path: prepared.path,
        uploadId: prepared.uploadId,
        contentType: prepared.contentType,
        source: "desktop-relay",
      });
      uploaded.push({ path: record.path, contentType: record.contentType });
    }
    return uploaded;
  } finally {
    client.dispose();
  }
};

const relayContext = (context: RelayedMessage["context"]): CloudTurnContext | undefined => {
  if (!context) return undefined;
  const text = context.text?.trim() ? context.text : undefined;
  if (text && text.length > TURN_CONTEXT_TEXT_MAX_CHARS) {
    // Refused, not shortened: the user is told it did not go.
    throw new Error(
      `The pasted text is too long to send on to where Stella runs (${text.length} characters; the limit is ${TURN_CONTEXT_TEXT_MAX_CHARS}).`,
    );
  }
  // Chip labels and previews only: a display too large to carry is left off.
  const display =
    context.display && JSON.stringify(context.display).length <= TURN_CONTEXT_DISPLAY_MAX_CHARS
      ? context.display
      : undefined;
  return text || display ? { ...(text ? { text } : {}), ...(display ? { display } : {}) } : undefined;
};

const promptSeqs = new Map<string, number>();
export const latestPromptSeq = (conversationId: string): number | undefined => promptSeqs.get(conversationId);

export const cloudJournalFor = (
  session: OpenSession,
  conversationId: string,
): DesktopJournal | undefined => {
  // A conversation kept on this computer has no journal.
  if (conversationId.startsWith("local_")) return undefined;
  const deviceId = session.config.deviceId;
  let toolFrames: Promise<void> = Promise.resolve();
  const runner = () => {
    const current = session.runnerCell.get();
    if (!current) throw new Error("Stella's runtime is restarting.");
    return current;
  };
  return {
    deviceId,
    start: async () => {
      const window = await runner().cloudJournal.history(conversationId);
      return {
        contextStartSeq: window.contextStartSeq,
        ...(window.checkpoint ? { checkpoint: window.checkpoint } : {}),
      };
    },
    publishCheckpoint: async ({ summary, firstKept }) => {
      const auth = runner().getStellaSiteAuth();
      if (!auth) throw new Error("Sign in to sync this conversation.");
      const body: JournalCheckpointPublish = {
        expectedOwnerGeneration: await runner().cloudJournal.ownerGeneration(),
        deviceId,
        summary,
        firstKept,
      };
      const response = await fetch(
        `${auth.baseUrl.replace(/\/+$/, "")}/conversations/${encodeURIComponent(conversationId)}${JOURNAL_CHECKPOINT_PATH}`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${auth.authToken}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        },
      );
      // A refusal is final for this compaction; the next one publishes anew.
      if (response.status >= 500 || response.status === 401 || response.status === 429) {
        throw new Error(`The conversation's checkpoint was not saved (${response.status}).`);
      }
    },
    read: async (afterSeq) => {
      const auth = runner().getStellaSiteAuth();
      if (!auth) throw new Error("Sign in to sync this conversation.");
      const response = await fetch(
        `${auth.baseUrl.replace(/\/+$/, "")}/conversations/${encodeURIComponent(conversationId)}/history/query`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${auth.authToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            op: "read",
            fromSeq: afterSeq + 1,
            toSeq: Number.MAX_SAFE_INTEGER,
          }),
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        records?: JournalReadRecord[];
        complete?: boolean;
        error?: string;
      } | null;
      if (!response.ok || !body) {
        throw new Error(body?.error ?? `The conversation's history did not load (${response.status}).`);
      }
      return { records: body.records ?? [], complete: body.complete !== false };
    },
    usageLimitHolds: async () => {
      const auth = runner().getStellaSiteAuth();
      if (!auth) throw new Error("Sign in to sync this conversation.");
      const response = await fetch(
        `${auth.baseUrl.replace(/\/+$/, "")}/conversations/${encodeURIComponent(conversationId)}/history/query`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${auth.authToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ op: "usageLimitHolds" }),
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        },
      );
      const body = (await response.json().catch(() => null)) as {
        holds?: Array<{ threadId?: string; until?: number; createdAtMs: number }>;
        error?: string;
      } | null;
      if (!response.ok || !body) {
        throw new Error(body?.error ?? `The conversation's held work did not load (${response.status}).`);
      }
      return body.holds ?? [];
    },
    ownTurn: (turnId) =>
      turnId.startsWith(`desktop:${deviceId}:pi:`) ||
      turnId.startsWith(`voice:${deviceId}:pi:`),
    begin: async (turn) => {
      const ownerGeneration =
        turn.ownerGeneration ?? (await runner().cloudJournal.ownerGeneration());
      const ack = await runner().cloudJournal.begin({
        conversationId,
        ownerGeneration,
        localTurnId: turn.localTurnId,
        clientMsgId: turn.clientMsgId,
        userMessageJson: turn.userMessageJson,
        ...(turn.hidden ? { hidden: true } : {}),
        ...(turn.adopt ? { adoptExisting: true } : {}),
        ...(turn.onLeaseLost ? { onLeaseLost: turn.onLeaseLost } : {}),
      });
      const promptSeq = turn.hidden ? undefined : await runner().cloudJournal.promptSeq(conversationId, ack);
      if (promptSeq !== undefined) promptSeqs.set(conversationId, Math.max(promptSeqs.get(conversationId) ?? 0, promptSeq));
      return { leaseToken: ack.leaseToken, ownerGeneration, ...(promptSeq === undefined ? {} : { promptSeq }) };
    },
    finish: async (turn) => {
      const status = await runner().cloudJournal.finish({
        conversationId,
        ownerGeneration: turn.ownerGeneration,
        localTurnId: turn.localTurnId,
        leaseToken: turn.leaseToken,
        records: turn.records,
        phase: turn.phase,
        ...(turn.notice ? { notice: turn.notice } : {}),
      });
      if (!status.queued) {
        throw new Error(`A turn was too large for the cloud journal (${status.reason}).`);
      }
    },
    relay: async (message) => {
      const { clientMsgId } = message;
      const auth = runner().getStellaSiteAuth();
      if (!auth) throw new Error("Sign in to send this message on to where Stella runs.");
      let uploads = relayUploads.get(clientMsgId);
      if (!uploads) {
        uploads = uploadRelayed(() => runner().getStellaSiteAuth(), message);
        relayUploads.set(clientMsgId, uploads);
        uploads.catch(() => relayUploads.delete(clientMsgId));
      }
      const uploaded = await uploads;
      const attachments = uploaded.slice(0, TURN_ATTACHMENTS_MAX).map((upload) => upload.path);
      const listed = message.prompt ? uploaded.slice(TURN_ATTACHMENTS_MAX) : uploaded;
      const prompt = listed.length
        ? `${message.prompt}\n\nAttached in my drive:\n${listed.map((upload) => `- ${upload.path}`).join("\n")}`
        : message.prompt;
      const context = relayContext(message.context);
      const body: CloudTurnStartRequest = {
        protocol: TURN_PLANE_PROTOCOL,
        clientMsgId,
        // A cloud turn needs typed text; a message of only pasted text or files reads as this.
        prompt: prompt || (context?.text ? "(Pasted text)" : "(Attached files)"),
        ...(attachments.length ? { attachments } : {}),
        ...(context ? { context } : {}),
        lane: "chat",
        source: "desktop",
      };
      const response = await fetch(`${auth.baseUrl.replace(/\/+$/, "")}${turnStartPath(conversationId)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${auth.authToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Where Stella runs did not take this message (${response.status}): ${detail.slice(0, 300)}`);
      }
      relayUploads.delete(clientMsgId);
      await response.body?.cancel().catch(() => undefined);
    },
    tools: (update) => {
      toolFrames = toolFrames
        .then(async () => {
          const auth = runner().getStellaSiteAuth();
          if (!auth) return;
          const response = await fetch(
            `${auth.baseUrl.replace(/\/+$/, "")}/conversations/${encodeURIComponent(conversationId)}/local-turns/tool`,
            {
              method: "POST",
              headers: { authorization: `Bearer ${auth.authToken}`, "content-type": "application/json" },
              body: JSON.stringify({ deviceId, ...update }),
              signal: AbortSignal.timeout(TOOL_FRAME_TIMEOUT_MS),
            },
          );
          await response.body?.cancel().catch(() => undefined);
        })
        .catch(() => undefined);
    },
    appendVoice: async (said) => {
      await runner().cloudJournal.append({
        conversationId,
        appendId: said.appendId,
        records: [
          {
            kind: "message",
            role: said.role,
            payloadJson: said.payloadJson,
            ...(said.hidden ? { hidden: true } : {}),
          },
        ],
      });
    },
  };
};
