/**
 * Walks an `EventRecord[]` for a conversation and returns the unique files
 * the assistant touched, most-recent first. Files the response text links
 * come from its links (local paths, and `stella://drive/...` or cloud world
 * drive links, which name drive files); cloud-lane files also arrive
 * as `cloudDriveFiles` on the event payload (projected from backend
 * `output_files` events).
 *
 * Used by both the inline chat home overview's Recent files list AND the
 * "See all" dialog's paginated full file history (both fed by
 * `useConversationFiles` / `conversation.files`). Keeping the derivation
 * in one place means the dialog's paged view stays byte-identical to the
 * inline view for the same input window.
 */

import type { EventRecord } from "@/features/chat/lib/event-transforms";
import { extractFileLinkTargets } from "@stella/contracts/local-file-links";
import {
  cloudWorldDriveName,
  driveLinkPath,
  isCloudWorldAppPath,
} from "@stella/contracts/cloud-world-paths";
import {
  isDisplayTabPayload,
  type DisplayTabPayload,
} from "@stella/contracts/desktop/display-payload";
import { buildPayloadFromBarePath } from "@/features/chat/lib/derive-turn-resource";

export type ConversationFileEntry = {
  path: string;
  timestamp: number;
  payload: DisplayTabPayload;
  /** Canonical cloud-drive identity. Opening resolves a signed drive URL. */
  cloudDriveFile?: CloudDriveConversationFile;
};

export type CloudDriveConversationFile = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  stored?: boolean;
};

const cloudDriveFilesFrom = (value: unknown): CloudDriveConversationFile[] => {
  if (!Array.isArray(value)) return [];
  const files: CloudDriveConversationFile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const file = entry as {
      path?: unknown;
      name?: unknown;
      sizeBytes?: unknown;
      contentType?: unknown;
      stored?: unknown;
    };
    if (typeof file.path !== "string" || !file.path) continue;
    files.push({
      path: file.path,
      name:
        typeof file.name === "string" && file.name
          ? file.name
          : (file.path.split("/").pop() ?? file.path),
      sizeBytes:
        typeof file.sizeBytes === "number" && Number.isFinite(file.sizeBytes)
          ? file.sizeBytes
          : 0,
      contentType:
        typeof file.contentType === "string" && file.contentType
          ? file.contentType
          : "application/octet-stream",
      ...(file.stored === false ? { stored: false } : {}),
    });
  }
  return files;
};

export const responseTextForFileLinks = (event: EventRecord): string => {
  if (!event.payload || typeof event.payload !== "object") return "";
  if (event.type === "assistant_message") {
    return typeof event.payload.text === "string" ? event.payload.text : "";
  }
  if (event.type === "agent-completed") {
    return typeof event.payload.result === "string" ? event.payload.result : "";
  }
  return "";
};

/**
 * A drive file as a conversation entry. The payload only chooses the icon
 * (it is never opened locally: `cloudDriveFile` routes the open through a
 * drive URL), so it takes the viewer kind the name implies and falls back
 * to a plain download.
 */
export const cloudDriveEntry = (
  file: CloudDriveConversationFile,
  timestamp: number,
): ConversationFileEntry => {
  const iconPath = file.path.startsWith("/") ? file.path : `/${file.path}`;
  const typed = buildPayloadFromBarePath(iconPath, timestamp);
  return {
    path: file.path,
    timestamp,
    payload:
      typed && isDisplayTabPayload(typed) && typed.kind !== "source-diff"
        ? typed
        : {
            kind: "media",
            asset: { kind: "download", filePath: iconPath, label: file.name },
            createdAt: timestamp,
          },
    cloudDriveFile: file,
  };
};

export function deriveConversationFiles(
  events: ReadonlyArray<EventRecord>,
  options?: { cap?: number },
): ConversationFileEntry[] {
  const seen = new Map<string, ConversationFileEntry>();

  for (const event of events) {
    const eventPayload = event.payload as
      | { cloudDriveFiles?: unknown }
      | undefined;
    for (const file of cloudDriveFilesFrom(eventPayload?.cloudDriveFiles)) {
      seen.set(`cloud:${file.path}`, cloudDriveEntry(file, event.timestamp));
    }

    for (const filePath of extractFileLinkTargets(
      responseTextForFileLinks(event),
    )) {
      if (isCloudWorldAppPath(filePath)) continue;
      // A drive link names a drive file, never a
      // file on this machine. The journal's files card for the same path
      // (with real size and type) is the richer record: keep it when the
      // link arrives later, and let it replace this entry when it arrives
      // after.
      const drivePath = driveLinkPath(filePath);
      if (drivePath) {
        const key = `cloud:${drivePath}`;
        if (!seen.has(key)) {
          seen.set(
            key,
            cloudDriveEntry(
              {
                path: drivePath,
                name: cloudWorldDriveName(drivePath),
                sizeBytes: 0,
                contentType: "application/octet-stream",
              },
              event.timestamp,
            ),
          );
        }
        continue;
      }
      const payload = buildPayloadFromBarePath(filePath, event.timestamp, {
        developerResourcesEnabled: true,
      });
      if (!payload || !isDisplayTabPayload(payload)) continue;
      seen.set(filePath, { path: filePath, timestamp: event.timestamp, payload });
    }
  }

  const all = Array.from(seen.values()).sort(
    (a, b) => b.timestamp - a.timestamp,
  );
  return options?.cap === undefined ? all : all.slice(0, options.cap);
}
