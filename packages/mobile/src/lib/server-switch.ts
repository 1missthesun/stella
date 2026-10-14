import { DevSettings, Platform } from "react-native";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import type {
  PairingClaimRequest,
  PairingClaimResponse,
  PairingLink,
  ServerDiscovery,
} from "@stella/contracts/self-host";
import { parseServerDiscovery } from "@stella/contracts/self-host";
import { env } from "../config/env";
import { MOBILE_SESSION_TOKEN_KEY } from "./native-auth-client";
import { setItemForServerAsync } from "./secure-store";
import {
  HOSTED_SERVER_ID,
  launchServer,
  removeSelfHostedServer,
  setActiveServerId,
  upsertSelfHostedServer,
} from "./server-registry";
import { markOnboardingSeen } from "./onboarding";
import { clearAccountChatData } from "./chat-account-cleanup";

/** Restart the JS so every module picks up the newly active server. */
export const reloadApp = async (): Promise<void> => {
  // Release builds restart through expo-updates. In development builds it is
  // disabled and its reload resolves without restarting, so use the dev one.
  if (!__DEV__) {
    try {
      const Updates = await import("expo-updates");
      if (Updates.isEnabled) {
        await Updates.reloadAsync();
        return;
      }
    } catch {
      /* fall through */
    }
  }
  DevSettings.reload();
};

/**
 * Make `serverId` the active server and restart into it. The local chat
 * cache belongs to the account it came from, so it is cleared first; the
 * server is the source of truth and refills it.
 */
export const switchToServer = async (serverId: string): Promise<void> => {
  if (serverId === launchServer.id) return;
  await clearAccountChatData().catch(() => undefined);
  setActiveServerId(serverId);
  await reloadApp();
};

export const removeServer = async (serverId: string): Promise<void> => {
  const wasActive = serverId === launchServer.id;
  await removeSelfHostedServer(serverId);
  if (wasActive) {
    await clearAccountChatData().catch(() => undefined);
    setActiveServerId(HOSTED_SERVER_ID);
    await reloadApp();
  }
};

export class PairingError extends Error {
  constructor(
    readonly reason:
      | "expired"
      | "invalid"
      | "too_many_attempts"
      | "rate_limited"
      | "unreachable"
      | "server",
    message?: string,
  ) {
    super(message ?? reason);
  }
}

const deviceName = (): string =>
  Device.deviceName?.trim() ||
  Device.modelName?.trim() ||
  (Platform.OS === "ios" ? "iPhone" : "Android phone");

const readClaimError = (status: number, body: unknown): PairingError => {
  const code =
    body && typeof body === "object"
      ? String(
          (body as { code?: unknown; error?: unknown }).code ??
            (body as { error?: unknown }).error ??
            "",
        ).toLowerCase()
      : "";
  if (status === 429 || code.includes("rate")) return new PairingError("rate_limited");
  if (code.includes("attempt")) return new PairingError("too_many_attempts");
  if (status === 410 || code.includes("expired") || code.includes("claimed") || code.includes("canceled")) {
    return new PairingError("expired");
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return new PairingError("invalid");
  }
  return new PairingError("server");
};

/**
 * Claim a pairing link: the server mints a normal session for its owner on
 * this phone. The session is stored under the new server's scope, the
 * server joins the list, and the app restarts into it.
 */
export const claimPairingAndSwitch = async (
  link: PairingLink,
  discovery: ServerDiscovery,
): Promise<void> => {
  const request: PairingClaimRequest = {
    pairingId: link.pairingId,
    secret: link.secret,
    deviceName: deviceName(),
    platform: Platform.OS === "ios" ? "ios" : "android",
  };
  let response: Response;
  try {
    response = await fetch(`${link.server}/api/auth/device-pairing/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "expo-origin": Linking.createURL("", { scheme: env.mobileScheme }),
      },
      body: JSON.stringify(request),
    });
  } catch {
    throw new PairingError("unreachable");
  }
  const body = (await response.json().catch(() => null)) as
    | Partial<PairingClaimResponse>
    | null;
  if (!response.ok) throw readClaimError(response.status, body);
  const sessionToken =
    typeof body?.sessionToken === "string" ? body.sessionToken.trim() : "";
  if (!sessionToken) throw new PairingError("server");

  const confirmed = parseServerDiscovery(body?.server) ?? discovery;
  const entry = upsertSelfHostedServer(confirmed, link.server);
  await setItemForServerAsync(entry.id, MOBILE_SESSION_TOKEN_KEY, sessionToken);
  // The scripted first-run chat sells the hosted service; a paired
  // server's owner goes straight to their chat.
  await markOnboardingSeen().catch(() => undefined);
  await clearAccountChatData().catch(() => undefined);
  setActiveServerId(entry.id);
  await reloadApp();
};
