import { authClient } from "@/global/auth/lib/auth-client";
import { signOutAuthSession } from "@/global/auth/services/auth-session";
import type { AccountSessionSummary } from "@stella/contracts/auth-session";

type SignOutScope = "current_device" | "all_devices";

/**
 * Revoke every Better Auth session on the account. Electron routes it through
 * main, which owns the bearer; a browser shell calls Better Auth directly.
 */
const revokeAllSessions = async () => {
  const revoke = window.electronAPI?.system?.revokeAuthSessions;
  if (revoke) {
    await revoke();
    return;
  }
  const result = await authClient.revokeSessions();
  if (result.error) {
    throw new Error(result.error.message ?? "Session revocation failed.");
  }
};

const toMs = (value: Date | string | number | null | undefined): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
};

/** Browser-shell session tokens by session id; Electron never sends them here. */
const browserSessionTokens = new Map<string, string>();

/** Every live session on the account, for the account settings list. */
export const listAccountSessions =
  async (): Promise<AccountSessionSummary[]> => {
    const list = window.electronAPI?.system?.listAuthSessions;
    if (list) return list();
    const [result, current] = await Promise.all([
      authClient.listSessions(),
      authClient.getSession().catch(() => null),
    ]);
    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? "Session list failed.");
    }
    const currentId = current?.data?.session?.id ?? null;
    browserSessionTokens.clear();
    return result.data
      .map((session) => {
        if (typeof session.token === "string") {
          browserSessionTokens.set(session.id, session.token);
        }
        return {
          id: session.id,
          createdAt: toMs(session.createdAt),
          updatedAt: toMs(session.updatedAt),
          expiresAt: toMs(session.expiresAt),
          ipAddress: session.ipAddress ?? null,
          userAgent: session.userAgent ?? null,
          current: session.id === currentId,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

/** Revoke one session by id. Not best-effort, for the same reason as below. */
export const revokeAccountSession = async (sessionId: string) => {
  const revoke = window.electronAPI?.system?.revokeAuthSession;
  if (revoke) {
    await revoke(sessionId);
    return;
  }
  const token = browserSessionTokens.get(sessionId);
  if (!token) throw new Error("That session is no longer active.");
  const result = await authClient.revokeSession({ token });
  if (result.error) {
    throw new Error(result.error.message ?? "Session revocation failed.");
  }
  browserSessionTokens.delete(sessionId);
};

export const secureSignOut = async (scope: SignOutScope = "current_device") => {
  // Revocation is NOT best-effort. It deletes every Better Auth session row on
  // the account, and reporting success when it failed would leave the user
  // believing their other devices are signed out while those sessions are
  // still live. A failure propagates instead, and the local sign-out below is
  // deliberately not attempted in that case.
  if (scope === "all_devices") {
    await revokeAllSessions();
  }
  await signOutAuthSession();
};
