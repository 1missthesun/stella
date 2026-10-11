import {
  cloudWorldDriveName,
  driveLinkPath,
  isCloudWorkspacePath,
  isCloudWorldAppPath,
} from "@stella/contracts/cloud-world-paths";
import {
  extractFileLinkTargets,
  isAbsoluteLocalFilePath,
} from "@stella/contracts/local-file-links";
import type { DriveFile } from "@stella/contracts/backend/drive";
import { generatedImageFileName } from "@stella/contracts/generated-image-name";
import { artifactPrimaryFilePath } from "./mobile-artifacts";
import {
  displayPayloadForStellaFile,
  driveFileChatArtifact,
} from "./stella-file-links";
import type { ChatArtifact } from "../types";

/**
 * Every file Stella put in front of the user in one conversation, read from
 * that conversation's cloud journal: files linked in Stella's replies and in
 * the reports agents finished with, `files` cards, files the display tools
 * (`html`, `image_gen`) produced, and the attachments sent with the user's
 * own messages. These are the same records the desktop grants a paired
 * phone's file reads from (`cloud-conversation-file-grants.ts`).
 *
 * The journal names where each one lives. A drive path is in the cloud; an
 * absolute path is on the computer whose turn wrote the record, which the
 * turn id carries (`desktop:<deviceId>:…`).
 */

export type ConversationFileSource =
  | { kind: "cloud" }
  | { kind: "computer"; deviceId: string | null }
  | { kind: "upload" };

export type ConversationFile = {
  key: string;
  artifact: ChatArtifact;
  createdAt: number;
  source: ConversationFileSource;
  /** The name the file goes by, when it is not its path's last segment. */
  name?: string;
  /** The drive folder a drive file sits in, when it is not at the root. */
  folder?: string;
};

export type JournalEntry = {
  seq: number;
  turnId: string;
  kind: string;
  role: string | null;
  createdAt: number;
  body: Record<string, unknown> | null;
};

type FoundFile = {
  path: string;
  name?: string;
  upload?: boolean;
};

const DISPLAY_TOOLS = new Set(["html", "image_gen"]);

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parseJson = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "string") return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
};

const messageTexts = (payload: Record<string, unknown>): string[] => {
  const content = payload.content;
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const entry of content) {
    const block = asRecord(entry);
    if (block?.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts;
};

const linksIn = (text: unknown): FoundFile[] =>
  typeof text === "string"
    ? extractFileLinkTargets(text).map((path) => ({ path }))
    : [];

const uploadsIn = (payload: Record<string, unknown>): FoundFile[] => {
  const found: FoundFile[] = [];
  if (Array.isArray(payload.attachments)) {
    for (const entry of payload.attachments) {
      const attachment = asRecord(entry);
      const drivePath = attachment?.drivePath;
      if (typeof drivePath !== "string" || !drivePath.trim()) continue;
      found.push({
        path: drivePath,
        upload: true,
        ...(typeof attachment?.name === "string" ? { name: attachment.name } : {}),
      });
    }
  }
  const context = asRecord(payload.providerContext)?.attachments;
  if (Array.isArray(context)) {
    for (const entry of context) {
      if (typeof entry === "string" && entry.trim()) {
        found.push({ path: entry, upload: true });
      }
    }
  }
  return found;
};

const entryFiles = (entry: JournalEntry): FoundFile[] => {
  const body = entry.body;
  if (!body) return [];
  if (entry.kind === "message") {
    const role = entry.role ?? (typeof body.role === "string" ? body.role : null);
    if (role === "assistant") return messageTexts(body).flatMap(linksIn);
    if (role === "user") {
      const reports =
        body.source === "agent-thread" ? messageTexts(body).flatMap(linksIn) : [];
      return [...reports, ...uploadsIn(body)];
    }
    const toolName =
      typeof body.toolName === "string"
        ? (body.toolName.split("__").at(-1) ?? body.toolName)
        : "";
    if (
      role === "toolResult" &&
      DISPLAY_TOOLS.has(toolName) &&
      body.isError !== true
    ) {
      const details = asRecord(body.details);
      const found: FoundFile[] = [];
      if (typeof details?.filePath === "string") {
        found.push({ path: details.filePath });
      }
      if (toolName === "image_gen") {
        const drivePaths = pathList(details?.drivePaths);
        const paths =
          drivePaths.length > 0 ? drivePaths : pathList(details?.filePaths);
        const prompt =
          typeof details?.prompt === "string" ? details.prompt : undefined;
        paths.forEach((path, index) =>
          found.push({
            path,
            name: generatedImageFileName({
              prompt,
              index,
              count: paths.length,
              extension: extensionOfPath(path),
            }),
          }),
        );
      }
      return found;
    }
    return [];
  }
  if (entry.kind === "card") {
    if (body.type === "files" && Array.isArray(body.files)) {
      return body.files.flatMap((value) => {
        const file = asRecord(value);
        return typeof file?.path === "string" && file.path.trim()
          ? [
              {
                path: file.path,
                ...(typeof file.name === "string" ? { name: file.name } : {}),
              },
            ]
          : [];
      });
    }
    if (body.type === "agent-lifecycle") {
      const event = asRecord(body.event);
      if (event?.type === "agent-completed") {
        return linksIn(asRecord(event.payload)?.result);
      }
    }
  }
  return [];
};

const pathList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];

const extensionOfPath = (path: string): string =>
  /\.([A-Za-z0-9]{1,8})$/.exec(path)?.[1] ?? "png";

const desktopDeviceOfTurn = (turnId: string): string | null => {
  const match = /^desktop:([^:]+):/.exec(turnId);
  return match?.[1] ?? null;
};

const localArtifact = (
  filePath: string,
  conversationId: string,
  createdAt: number,
  name?: string,
): ChatArtifact => {
  const payload = displayPayloadForStellaFile(filePath, createdAt, name);
  return {
    id: `${conversationId}:${payload.kind}:${filePath}`,
    conversationId,
    payload,
  };
};

const toConversationFile = (
  found: FoundFile,
  entry: JournalEntry,
  conversationId: string,
): ConversationFile | null => {
  const raw = found.path.trim();
  if (!raw || isCloudWorldAppPath(raw)) return null;
  const absolute = isAbsoluteLocalFilePath(raw);
  const drivePath =
    driveLinkPath(raw) ?? (absolute || /^[a-z][a-z0-9+.-]*:/i.test(raw) ? null : raw.replace(/^\/+/, ""));
  if (drivePath) {
    const name = found.name?.trim() || cloudWorldDriveName(drivePath);
    return {
      key: `drive:${drivePath}`,
      artifact: driveFileChatArtifact(drivePath, conversationId, entry.createdAt, name),
      createdAt: entry.createdAt,
      source: found.upload ? { kind: "upload" } : { kind: "cloud" },
      name,
    };
  }
  if (!absolute) return null;
  const name = found.name?.trim();
  return {
    key: `path:${raw}`,
    artifact: localArtifact(raw, conversationId, entry.createdAt, name),
    createdAt: entry.createdAt,
    ...(name ? { name } : {}),
    source: isCloudWorkspacePath(raw)
      ? { kind: "cloud" }
      : { kind: "computer", deviceId: desktopDeviceOfTurn(entry.turnId) },
  };
};

/** Files in `entries`, newest first, first sighting of each file winning. */
export const conversationFilesFromEntries = (
  entries: readonly JournalEntry[],
  conversationId: string,
): ConversationFile[] => {
  const ordered = [...entries].sort((a, b) => b.seq - a.seq);
  const seen = new Set<string>();
  const out: ConversationFile[] = [];
  for (const entry of ordered) {
    for (const found of entryFiles(entry)) {
      const file = toConversationFile(found, entry, conversationId);
      if (!file || seen.has(file.key)) continue;
      seen.add(file.key);
      out.push(file);
    }
  }
  return out;
};

/** The dedupe key of an artifact the chat already holds, matching the journal's. */
export const artifactFileKey = (artifact: ChatArtifact): string => {
  const filePath = artifactPrimaryFilePath(artifact.payload);
  if (!filePath) return `id:${artifact.id}`;
  const driveBacked =
    "driveBacked" in artifact.payload && artifact.payload.driveBacked === true;
  if (driveBacked) return `drive:${filePath.replace(/^\/+/, "")}`;
  const drivePath = driveLinkPath(filePath);
  return drivePath ? `drive:${drivePath}` : `path:${filePath}`;
};

/** Where a file the chat holds lives, judged from its path alone. */
export const artifactFileSource = (
  artifact: ChatArtifact,
): ConversationFileSource => {
  const key = artifactFileKey(artifact);
  if (key.startsWith("drive:") || key.startsWith("id:")) return { kind: "cloud" };
  const filePath = key.slice("path:".length);
  return isCloudWorkspacePath(filePath)
    ? { kind: "cloud" }
    : { kind: "computer", deviceId: null };
};

export const entryFromRow = (row: unknown): JournalEntry | null => {
  const value = asRecord(row);
  if (!value || typeof value.seq !== "number") return null;
  return {
    seq: value.seq,
    turnId: typeof value.turn_id === "string" ? value.turn_id : "",
    kind: typeof value.kind === "string" ? value.kind : "",
    role: typeof value.role === "string" ? value.role : null,
    createdAt: typeof value.created_at === "number" ? value.created_at : 0,
    body: parseJson(value.payload_json),
  };
};

export const entryFromRecord = (record: unknown): JournalEntry | null => {
  const value = asRecord(record);
  if (!value || typeof value.seq !== "number") return null;
  const kind = typeof value.kind === "string" ? value.kind : "";
  return {
    seq: value.seq,
    turnId: typeof value.turnId === "string" ? value.turnId : "",
    kind,
    role: typeof value.role === "string" ? value.role : null,
    createdAt: typeof value.createdAtMs === "number" ? value.createdAtMs : 0,
    body: kind === "card" ? asRecord(value.card) : parseJson(value.payload),
  };
};

/**
 * The owner's Stella Drive as Files rows: every upload, agent output and
 * file any device put there, whether or not this conversation ever named it.
 */
export const conversationFilesFromDrive = (
  files: readonly DriveFile[],
  conversationId: string,
): ConversationFile[] =>
  files.map((file) => ({
    key: `drive:${file.path}`,
    artifact: driveFileChatArtifact(file.path, conversationId, file.updatedAt, file.name),
    createdAt: file.updatedAt,
    source: { kind: "cloud" },
    name: file.name,
    folder: driveFolderOf(file.path),
  }));

const driveFolderOf = (drivePath: string): string => {
  const slash = drivePath.lastIndexOf("/");
  return slash > 0 ? drivePath.slice(0, slash) : "";
};
