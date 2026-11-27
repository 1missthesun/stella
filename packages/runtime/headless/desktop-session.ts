// The installed desktop's own sign-in and saved model keys, for a headless run outside Electron
// (the launcher's Repair runner): protected values are read with Chromium os_crypt's formats, and
// the stored session mints the runtime's token the way the desktop's auth service does.

import fs from "node:fs";
import path from "node:path";
import { createOsCryptSafeStorage } from "@stella/node-shared/shared/os-crypt.js";
import {
  protectValue,
  setProtectedStorageProviderOverride,
  unprotectValue,
} from "@stella/node-shared/shared/protected-storage.js";

// Mirrors packages/desktop/electron/services/auth-service.ts.
const AUTH_STORAGE_SCOPE = "desktop-better-auth-storage";
const AUTH_STORAGE_FILE = "better-auth-storage.json";
const TOKEN_KEY = "better-auth_session_token";
const BACKEND_URL_KEY = "backend_url";
const DESKTOP_AUTH_ORIGIN = "http://127.0.0.1:57314";
const SERVER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const useDesktopProtectedStorage = (userData: string, appName = "Stella"): void => {
  setProtectedStorageProviderOverride(
    createOsCryptSafeStorage({ getName: () => appName, getUserData: () => userData }),
  );
};

export type DesktopSession =
  | { ok: true; backendUrl: string; authToken: string }
  | { ok: false; backendUrl: string | null; reason: "signed_out" | "rejected" | "unreachable" | "http" };

const authFile = (userData: string, serverId: string | null) =>
  serverId && SERVER_ID_PATTERN.test(serverId)
    ? path.join(userData, "servers", serverId, AUTH_STORAGE_FILE)
    : path.join(userData, AUTH_STORAGE_FILE);

const readStored = (file: string): Record<string, string> => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
};

/** Needs useDesktopProtectedStorage first. */
export const mintDesktopSessionToken = async (options: {
  userData: string;
  serverId?: string | null;
  backendUrl?: string | null;
}): Promise<DesktopSession> => {
  const file = authFile(options.userData, options.serverId ?? null);
  const stored = readStored(file);
  const read = (key: string) => {
    const encoded = stored[key];
    return encoded ? unprotectValue(AUTH_STORAGE_SCOPE, encoded)?.trim() || "" : "";
  };
  const bearer = read(TOKEN_KEY);
  const backendUrl = (options.backendUrl?.trim() || read(BACKEND_URL_KEY)).replace(/\/+$/, "") || null;
  if (!bearer || !backendUrl) return { ok: false, backendUrl, reason: "signed_out" };
  let response: Response;
  try {
    response = await fetch(`${backendUrl}/api/auth/token`, {
      headers: {
        accept: "application/json",
        origin: DESKTOP_AUTH_ORIGIN,
        "user-agent": `Stella Desktop (${process.platform === "darwin" ? "Macintosh" : process.platform === "win32" ? "Windows" : "Linux"})`,
        authorization: `Bearer ${bearer}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return { ok: false, backendUrl, reason: "unreachable" };
  }
  // The server may rotate the session token: keep it, or the desktop would be signed out.
  const rotated = response.headers.get("set-auth-token")?.trim();
  if (rotated && rotated !== bearer) {
    try {
      const next = { ...stored, [TOKEN_KEY]: protectValue(AUTH_STORAGE_SCOPE, rotated) };
      const staging = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(staging, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(staging, file);
    } catch {}
  }
  if (response.status === 401 || response.status === 403) return { ok: false, backendUrl, reason: "rejected" };
  if (!response.ok) return { ok: false, backendUrl, reason: "http" };
  const body = (await response.json().catch(() => null)) as { token?: unknown } | null;
  const authToken = typeof body?.token === "string" ? body.token.trim() : "";
  return authToken ? { ok: true, backendUrl, authToken } : { ok: false, backendUrl, reason: "http" };
};
