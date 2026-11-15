import { authClient } from "@/global/auth/lib/auth-client";
import { signOutAuthSession } from "@/global/auth/services/auth-session";
import type {
  AccountSessionSummary,
  SignOutOptions,
} from "@stella/contracts/auth-session";

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

type DeviceRow = {
  id?: unknown;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
  expiresAt?: string | number | null;
  ipAddress?: unknown;
  userAgent?: unknown;
  current?: unknown;
};

// `/devices` answers any valid session (Better Auth's `/list-sessions` only
// one under a day old) and never returns other sessions' tokens.
export const listAccountSessions =
  async (): Promise<AccountSessionSummary[]> => {
    const list = window.electronAPI?.system?.listAuthSessions;
    if (list) return list();
    const result = await authClient.$fetch<DeviceRow[]>("/devices", {
      method: "GET",
    });
    if (result.error || !Array.isArray(result.data)) {
      throw new Error(result.error?.message ?? "Session list failed.");
    }
    return result.data
      .filter((row): row is DeviceRow & { id: string } => typeof row.id === "string" && row.id.length > 0)
      .map((row) => ({
        id: row.id,
        createdAt: toMs(row.createdAt),
        updatedAt: toMs(row.updatedAt),
        expiresAt: toMs(row.expiresAt),
        ipAddress: typeof row.ipAddress === "string" ? row.ipAddress : null,
        userAgent: typeof row.userAgent === "string" ? row.userAgent : null,
        current: row.current === true,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

export const revokeAccountSession = async (sessionId: string) => {
  const revoke = window.electronAPI?.system?.revokeAuthSession;
  if (revoke) {
    await revoke(sessionId);
    return;
  }
  const result = await authClient.$fetch("/devices/revoke", {
    method: "POST",
    body: { sessionId },
  });
  if (result.error) {
    throw new Error(result.error.message ?? "Session revocation failed.");
  }
};

export const secureSignOut = async (
  scope: SignOutScope = "current_device",
  options: SignOutOptions = {},
) => {
  if (scope === "all_devices") {
    await revokeAllSessions();
  }
  await signOutAuthSession(options);
};
