import type { ClaudeSessionEngine } from "@stella/contracts/backend/claude-sessions";

export type ClaudeSessionCheckpoint = {
  threadId: string;
  conversationId: string;
  sessionId: string;
  engine: ClaudeSessionEngine;
  configDir: string | null;
  cwd: string;
  final?: boolean;
  journalCursor?: string;
  journalSeq?: number;
  leaseEpoch?: number;
};

export type RestoredClaudeSession = {
  threadId: string;
  sessionId: string;
  engine: ClaudeSessionEngine;
  cwd: string;
  cliVersion: string;
  replyHashes: ReadonlySet<string>;
};

export type ClaudeSessionSyncSink = {
  noteCheckpoint(checkpoint: ClaudeSessionCheckpoint): void;
  takeRestored(args: {
    threadId: string;
    engine: ClaudeSessionEngine;
  }): RestoredClaudeSession | null;
  consumeRestored(args: { threadId: string; sessionId: string }): void;
  restoreForResume(args: {
    threadId: string;
    configDir: string | null;
    cwd: string;
    atJournalSeq: number;
  }): Promise<"native" | "rebuild" | "none">;
  prepareLocalResume(args: {
    threadId: string;
    engine: ClaudeSessionEngine;
    configDir: string | null;
    cwd: string;
  }): Promise<boolean>;
};

let activeSink: ClaudeSessionSyncSink | null = null;

export const setClaudeSessionSyncSink = (sink: ClaudeSessionSyncSink | null): void => {
  activeSink = sink;
};

export const claudeSessionSyncSink = (): ClaudeSessionSyncSink | null => activeSink;
