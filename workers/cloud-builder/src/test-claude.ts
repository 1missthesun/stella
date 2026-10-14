// Only `@test.stella.local` owners on a deployment with STELLA_TEST_ACCOUNTS=1.

export const TEST_CLAUDE_EMAIL = "claude@test.stella.local";

const TEST_ACCOUNT_SUFFIX = "@test.stella.local";

const testClaudeToken = (env: unknown): string | null => {
  const record = env as Record<string, unknown>;
  if (record.STELLA_TEST_ACCOUNTS !== "1") return null;
  const token = record.STELLA_TEST_CLAUDE_OAUTH_TOKEN;
  return typeof token === "string" && token.trim().startsWith("sk-ant-oat") ? token.trim() : null;
};

export const testClaudeConfigured = (env: unknown): boolean => testClaudeToken(env) !== null;

export const isTestAccountOwner = async (env: unknown, ownerId: string): Promise<boolean> => {
  if (!testClaudeConfigured(env)) return false;
  const db = (env as { DB?: D1Database }).DB;
  if (!db) return false;
  const row = await db
    .prepare('SELECT "email", "emailVerified" FROM "user" WHERE "id" = ?')
    .bind(ownerId)
    .first<{ email: string | null; emailVerified: number | boolean | null }>();
  const email = row?.email?.trim().toLowerCase() ?? "";
  return Boolean(row?.emailVerified) && email.endsWith(TEST_ACCOUNT_SUFFIX);
};

/** 2100-01-01: a setup token has no refresh, and this one never needs one. */
const TEST_CREDENTIALS_EXPIRE_AT = 4_102_444_800_000;

export const testClaudeCredentials = (env: unknown): string | null => {
  const token = testClaudeToken(env);
  if (!token) return null;
  return JSON.stringify({
    claudeAiOauth: {
      accessToken: token,
      refreshToken: null,
      expiresAt: TEST_CREDENTIALS_EXPIRE_AT,
      scopes: ["user:inference"],
    },
  });
};
