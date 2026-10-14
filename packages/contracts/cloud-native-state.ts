export const CLOUD_NATIVE_STATE_ANCHOR = "/home/stella-native-state";

export const CLOUD_NATIVE_STATE_ROOT_PATTERN =
  /^\/home\/stella-native-state\/anthropic-[0-9a-f]{64}$/u;

export const cloudNativeStateRoot = (threadHash: string): string => {
  if (!/^[0-9a-f]{64}$/u.test(threadHash)) {
    throw new Error("Native state thread hash is invalid.");
  }
  return `${CLOUD_NATIVE_STATE_ANCHOR}/anthropic-${threadHash}`;
};

export const CLOUD_ADOPTED_SESSION_DIR = ".adopted-session";

export const claudeHydratedSessionKey = (ownerId: string, conversationId: string, sessionId: string): string =>
  `claude-code-hydrated/v1/${encodeURIComponent(ownerId)}/${encodeURIComponent(conversationId)}/${sessionId}.jsonl`;

export const CLOUD_CLAUDE_ACCOUNTS_ROOT = "/home/stella-host-state/claude-accounts";

export const CLOUD_CLAUDE_LOGINS_ROOT = "/home/stella-host-state/claude-logins";

export const isCloudClaudeAccountKey = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);

export const CLOUD_CLAUDE_LOGIN_BACKUP_PREFIX = "claude-code-logins/v1";
