import type { LegacyDirectoryBackup as DirectoryBackup } from "./sandbox-client.js";
import { CLOUD_NATIVE_STATE_ROOT_PATTERN } from "@stella/contracts/cloud-native-state";
import { sha256Hex } from "./hash.js";

export const NATIVE_STATE_CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const EMPTY_NATIVE_HISTORY_CURSOR = "v1:empty" as const;

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const BACKUP_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_TEXT_BYTES = 512;
const MAX_NATIVE_STATE_CANDIDATES = 8;

export type NativeStateCheckpoint = {
  engine: "anthropic";
  sessionId: string;
  cursor: string;
  tree: {
    algorithm: "sha256";
    digest: string;
    entries: number;
    bytes: number;
  };
  mac: string;
};

export type NativeStateCheckpointPayload = {
  schemaVersion: typeof NATIVE_STATE_CHECKPOINT_SCHEMA_VERSION;
  checkpoint: NativeStateCheckpoint;
};

export type NativeStateCheckpointVersion = {
  checkpoint: NativeStateCheckpoint;
  descriptor: DirectoryBackup;
  requestFingerprint: string;
  receipt: string;
  createdAt: number;
};

export type NativeStateCheckpointRecord = {
  schemaVersion: typeof NATIVE_STATE_CHECKPOINT_SCHEMA_VERSION;
  committed?: NativeStateCheckpointVersion;
  candidates: NativeStateCheckpointVersion[];
};

const boundedText = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  new TextEncoder().encode(value).byteLength <= MAX_TEXT_BYTES &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/u.test(value);

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    expected.every((key, index) => actual[index] === key)
  );
};

export const parseNativeStateCheckpointPayload = (
  value: unknown,
): NativeStateCheckpointPayload | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !exactKeys(payload, ["schemaVersion", "checkpoint"]) ||
    payload.schemaVersion !== NATIVE_STATE_CHECKPOINT_SCHEMA_VERSION ||
    !payload.checkpoint ||
    typeof payload.checkpoint !== "object" ||
    Array.isArray(payload.checkpoint)
  ) {
    return null;
  }
  const checkpoint = payload.checkpoint as Record<string, unknown>;
  if (
    !exactKeys(checkpoint, ["engine", "sessionId", "cursor", "tree", "mac"]) ||
    checkpoint.engine !== "anthropic" ||
    !boundedText(checkpoint.sessionId) ||
    !boundedText(checkpoint.cursor) ||
    typeof checkpoint.mac !== "string" ||
    !HEX_SHA256.test(checkpoint.mac) ||
    !checkpoint.tree ||
    typeof checkpoint.tree !== "object" ||
    Array.isArray(checkpoint.tree)
  ) {
    return null;
  }
  const tree = checkpoint.tree as Record<string, unknown>;
  if (
    !exactKeys(tree, ["algorithm", "digest", "entries", "bytes"]) ||
    tree.algorithm !== "sha256" ||
    typeof tree.digest !== "string" ||
    !HEX_SHA256.test(tree.digest) ||
    !Number.isSafeInteger(tree.entries) ||
    Number(tree.entries) <= 0 ||
    !Number.isSafeInteger(tree.bytes) ||
    Number(tree.bytes) < 0
  ) {
    return null;
  }
  return payload as NativeStateCheckpointPayload;
};

const unsignedCheckpointPayload = (
  checkpoint: NativeStateCheckpoint,
  threadId: string,
): string =>
  JSON.stringify([
    2,
    checkpoint.engine,
    threadId,
    checkpoint.sessionId,
    checkpoint.cursor,
    checkpoint.tree.algorithm,
    checkpoint.tree.digest,
    checkpoint.tree.entries,
    checkpoint.tree.bytes,
  ]);

const bytesToHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

export const validNativeStateCheckpointMac = async (args: {
  checkpoint: NativeStateCheckpoint;
  threadId: string;
  integrityKey: string | readonly string[];
}): Promise<boolean> => {
  for (const integrityKey of typeof args.integrityKey === "string"
    ? [args.integrityKey]
    : args.integrityKey) {
    if (
      await validNativeStateCheckpointMacWith({
        checkpoint: args.checkpoint,
        threadId: args.threadId,
        integrityKey,
      })
    ) {
      return true;
    }
  }
  return false;
};

const validNativeStateCheckpointMacWith = async (args: {
  checkpoint: NativeStateCheckpoint;
  threadId: string;
  integrityKey: string;
}): Promise<boolean> => {
  if (!HEX_SHA256.test(args.integrityKey) || !boundedText(args.threadId)) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(args.integrityKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = unsignedCheckpointPayload(args.checkpoint, args.threadId);
  const expected = bytesToHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  // Equal-length, fixed-work comparison. Web Crypto does not expose a
  // constant-time compare operation in Workers.
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |=
      expected.charCodeAt(index) ^ args.checkpoint.mac.charCodeAt(index);
  }
  return difference === 0;
};

export const nativeHistoryCursorFromRows = async (
  rows: Array<{ turnId: string; role: string; payloadJson: string }>,
): Promise<string> => {
  const last = rows.at(-1);
  if (!last) return EMPTY_NATIVE_HISTORY_CURSOR;
  return `v1:${await sha256Hex(
    JSON.stringify({
      turnId: last.turnId,
      role: last.role,
      payloadJson: last.payloadJson,
    }),
  )}`;
};

export const nativeStateCheckpointPrefix = (workspaceKey: string): string =>
  `${workspaceKey}:native-state:`;

export const nativeStateBackupName = async (
  checkpointKey: string,
): Promise<string> =>
  `native-state-${(await sha256Hex(checkpointKey)).slice(0, 40)}`;

const parseDirectoryBackup = (value: unknown): DirectoryBackup | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort().join(",");
  if (
    keys !== "dir,id,localBucket" ||
    typeof candidate.id !== "string" ||
    !BACKUP_ID.test(candidate.id) ||
    typeof candidate.dir !== "string" ||
    !CLOUD_NATIVE_STATE_ROOT_PATTERN.test(candidate.dir) ||
    candidate.localBucket !== true
  ) {
    return null;
  }
  return candidate as unknown as DirectoryBackup;
};

const parseNativeStateCheckpointVersion = (
  value: unknown,
): NativeStateCheckpointVersion | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !exactKeys(candidate, [
      "checkpoint",
      "descriptor",
      "requestFingerprint",
      "receipt",
      "createdAt",
    ]) ||
    typeof candidate.requestFingerprint !== "string" ||
    !HEX_SHA256.test(candidate.requestFingerprint) ||
    typeof candidate.receipt !== "string" ||
    !HEX_SHA256.test(candidate.receipt) ||
    !Number.isSafeInteger(candidate.createdAt) ||
    Number(candidate.createdAt) < 0
  ) {
    return null;
  }
  const parsedCheckpoint = parseNativeStateCheckpointPayload({
    schemaVersion: NATIVE_STATE_CHECKPOINT_SCHEMA_VERSION,
    checkpoint: candidate.checkpoint,
  });
  const descriptor = parseDirectoryBackup(candidate.descriptor);
  if (!parsedCheckpoint || !descriptor) return null;
  return {
    checkpoint: parsedCheckpoint.checkpoint,
    descriptor,
    requestFingerprint: candidate.requestFingerprint,
    receipt: candidate.receipt,
    createdAt: Number(candidate.createdAt),
  };
};

export const parseNativeStateCheckpointRecord = (
  value: unknown,
): NativeStateCheckpointRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const expectedKeys =
    candidate.committed === undefined
      ? ["schemaVersion", "candidates"]
      : ["schemaVersion", "committed", "candidates"];
  if (
    !exactKeys(candidate, expectedKeys) ||
    candidate.schemaVersion !== NATIVE_STATE_CHECKPOINT_SCHEMA_VERSION ||
    !Array.isArray(candidate.candidates) ||
    candidate.candidates.length > MAX_NATIVE_STATE_CANDIDATES
  ) {
    return null;
  }
  const committed =
    candidate.committed === undefined
      ? undefined
      : parseNativeStateCheckpointVersion(candidate.committed);
  if (candidate.committed !== undefined && !committed) return null;
  const candidates = candidate.candidates.map(
    parseNativeStateCheckpointVersion,
  );
  if (candidates.some((version) => version === null)) return null;
  const parsedCandidates = candidates as NativeStateCheckpointVersion[];
  const cursors = [
    ...(committed ? [committed.checkpoint.cursor] : []),
    ...parsedCandidates.map((version) => version.checkpoint.cursor),
  ];
  if (new Set(cursors).size !== cursors.length) return null;
  return {
    schemaVersion: NATIVE_STATE_CHECKPOINT_SCHEMA_VERSION,
    ...(committed ? { committed } : {}),
    candidates: parsedCandidates,
  };
};
