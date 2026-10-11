export const CLAUDE_SESSION_CHUNK_MAX_BYTES = 512 * 1024;
export const CLAUDE_SESSION_APPEND_MAX_BODY_BYTES = 1024 * 1024;
export const CLAUDE_SESSION_CHAIN_GENESIS = "0".repeat(64);
export const CLAUDE_SESSION_MAX_FILES = 512;

export type ClaudeSessionEngine =
  | "claude_code_local"
  | "claude_code_local_vanilla";

export const CLAUDE_SESSION_ENGINES: readonly ClaudeSessionEngine[] = [
  "claude_code_local",
  "claude_code_local_vanilla",
];

export type ClaudeSessionSyncTag = {
  threadId: string;
  conversationId: string;
  sessionId: string;
  deviceId: string;
  cliVersion: string;
  engine: ClaudeSessionEngine;
  originCwd: string;
  journalCursor?: string;
  journalSeq?: number;
  leaseEpoch?: number;
};

export type ClaudeSessionFileHead = {
  path: string;
  generation: number;
  length: number;
  chain: string;
};

export type ClaudeSessionChunkRef = {
  index: number;
  offset: number;
  length: number;
  sha256: string;
  chain: string;
};

export type ClaudeSessionManifest = ClaudeSessionSyncTag & {
  updatedAt: number;
  files: Array<ClaudeSessionFileHead & { chunks: ClaudeSessionChunkRef[] }>;
};

export type ClaudeSessionAppendArgs = ClaudeSessionSyncTag & {
  path: string;
  generation: number;
  offset: number;
  prevChain: string;
  sha256: string;
  chain: string;
  data: string;
};

export type ClaudeSessionCalls = {
  "claudeSessions.append": {
    args: ClaudeSessionAppendArgs;
    result: ClaudeSessionFileHead;
  };
  "claudeSessions.tag": {
    args: ClaudeSessionSyncTag;
    result: null;
  };
  "claudeSessions.latest": {
    args: { threadId: string };
    result: ClaudeSessionManifest | null;
  };
  "claudeSessions.readChunk": {
    args: {
      threadId: string;
      sessionId: string;
      path: string;
      generation: number;
      index: number;
    };
    result: { data: string; sha256: string; offset: number; chain: string };
  };
};

export const CLAUDE_SESSION_CONFLICT_REASON = "claude_session_conflict";
export const CLAUDE_SESSION_STALE_LEASE_REASON = "claude_session_stale_lease";

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export const isClaudeSessionId = (value: unknown): value is string =>
  typeof value === "string" && SESSION_ID_PATTERN.test(value);

export const isClaudeSessionFilePath = (
  sessionId: string,
  path: unknown,
): path is string => {
  if (typeof path !== "string" || !isClaudeSessionId(sessionId)) return false;
  if (path === `${sessionId}.jsonl`) return true;
  const segments = path.split("/");
  if (segments.length < 2 || segments.length > 5) return false;
  if (segments[0] !== sessionId) return false;
  return segments
    .slice(1)
    .every(
      (segment) =>
        PATH_SEGMENT_PATTERN.test(segment) &&
        segment !== "." &&
        segment !== "..",
    );
};

export const claudeSessionFileMode = (path: string): "append" | "replace" =>
  path.endsWith(".jsonl") ? "append" : "replace";

export const claudeSessionChainInput = (
  prevChain: string,
  chunkSha256: string,
): string => `${prevChain}:${chunkSha256}`;

export const claudeProjectSlot = (workingFolder: string): string =>
  workingFolder.replace(/[^A-Za-z0-9]/g, "-");
