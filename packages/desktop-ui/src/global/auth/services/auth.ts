import { authClient } from "@/global/auth/lib/auth-client";
import { signOutAuthSession } from "@/global/auth/services/auth-session";
import type { AccountSessionSummary } from "@stella/contracts/auth-session";

type SignOutScope = "current_device" | "all_devices";

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

const browserSessionTokens = new Map<string, string>();

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
  if (scope === "all_devices") {
    await revokeAllSessions();
  }
  await signOutAuthSession();
};
