import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import {
  IPC_CHAT_EVIDENCE_CARDS,
  IPC_CHAT_EVIDENCE_DRIVE_CARDS,
} from "@stella/contracts/desktop/ipc-channels";
import type {
  DriveEvidenceSource,
  EvidenceCard,
  EvidenceCardSet,
} from "@stella/contracts/chat-evidence";
import { driveLinkPath, driveLinkTarget } from "@stella/contracts/cloud-world-paths";
import { createChatEvidenceService } from "../services/chat-evidence-service.js";
import { handleIpc } from "./typed-ipc.js";

const REQUEST_PATH_CAP = 40;

const driveSourcesFrom = (value: unknown): DriveEvidenceSource[] => {
  if (!Array.isArray(value)) return [];
  const sources: DriveEvidenceSource[] = [];
  for (const entry of value.slice(0, REQUEST_PATH_CAP)) {
    if (!entry || typeof entry !== "object") continue;
    const file = entry as Record<string, unknown>;
    if (typeof file.drivePath !== "string" || typeof file.url !== "string") continue;
    const drivePath = driveLinkPath(driveLinkTarget(file.drivePath));
    if (!drivePath) continue;
    let url: URL;
    try {
      url = new URL(file.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    sources.push({
      drivePath,
      url: url.toString(),
      sizeBytes:
        typeof file.sizeBytes === "number" && Number.isFinite(file.sizeBytes)
          ? Math.max(0, file.sizeBytes)
          : 0,
      contentType: typeof file.contentType === "string" ? file.contentType : "",
    });
  }
  return sources;
};

export const registerChatEvidenceHandlers = (options: {
  getStellaDataDir: () => string | null;
  assertPrivilegedSender: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
}) => {
  const service = createChatEvidenceService({
    getStellaDataDir: options.getStellaDataDir,
  });

  handleIpc(
    IPC_CHAT_EVIDENCE_CARDS,
    async (
      event,
      payload?: { filePaths?: unknown },
    ): Promise<EvidenceCardSet> => {
      if (!options.assertPrivilegedSender(event, IPC_CHAT_EVIDENCE_CARDS)) {
        throw new Error("Blocked untrusted chat evidence request.");
      }
      const requested = Array.isArray(payload?.filePaths)
        ? payload.filePaths
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .slice(0, REQUEST_PATH_CAP)
        : [];
      if (requested.length === 0) return { cards: [], overflowCount: 0 };
      return await service.buildCardSet(requested);
    },
  );

  handleIpc(
    IPC_CHAT_EVIDENCE_DRIVE_CARDS,
    async (event, payload?: { files?: unknown }): Promise<EvidenceCard[]> => {
      if (!options.assertPrivilegedSender(event, IPC_CHAT_EVIDENCE_DRIVE_CARDS)) {
        throw new Error("Blocked untrusted chat evidence request.");
      }
      const files = driveSourcesFrom(payload?.files);
      return files.length === 0 ? [] : await service.buildDriveCards(files);
    },
  );

  return service;
};
