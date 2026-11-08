import { Notification } from "electron";
import { FINISH_CONNECT_PATH } from "@stella/contracts/backend/integrations";

/**
 * Finishes a Google connection whose browser sign-in handed this app a
 * one-time code (stella://connect?code=…). The code is redeemed as this
 * app's own signed-in Stella user, so a code made for anyone else does
 * nothing.
 */
export type ConnectClaimDeps = {
  getBackendUrl: () => string | null;
  getAuthToken: () => Promise<string | null>;
  focusApp: () => void;
};

const notify = (title: string, body: string) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
};

export const redeemConnectClaim = async (deps: ConnectClaimDeps, code: string): Promise<boolean> => {
  deps.focusApp();
  const backendUrl = deps.getBackendUrl();
  const token = await deps.getAuthToken().catch(() => null);
  if (!backendUrl || !token) {
    notify("Google didn't connect", "Sign in to Stella, then connect Google again.");
    return false;
  }
  try {
    const response = await fetch(`${backendUrl.replace(/\/+$/u, "")}${FINISH_CONNECT_PATH}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ connectCode: code }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => null)) as {
      email?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok || typeof payload?.email !== "string") {
      notify(
        "Google didn't connect",
        typeof payload?.error === "string" && payload.error
          ? payload.error
          : "Start connecting Google again from Stella.",
      );
      return false;
    }
    notify("Google connected", `${payload.email} is connected to Stella.`);
    return true;
  } catch {
    notify("Google didn't connect", "Check your connection and try again.");
    return false;
  }
};
