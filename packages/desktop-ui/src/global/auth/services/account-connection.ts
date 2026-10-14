import { authClient } from "@/global/auth/lib/auth-client";
import {
  getAuthSessionSnapshot,
  refreshAuthSession,
} from "@/global/auth/services/auth-session";
import { writeBrowserSessionToken } from "@/global/auth/services/auth-storage";
import { backendUrl } from "@/platform/backend/backend-url";
import { platformCapabilities } from "@/platform/capabilities";
import { captchaHeaders } from "@/platform/auth/challenge-token";

type BrowserCallbackLocation = Pick<Location, "origin" | "pathname">;

export const getBrowserSocialCallbackUrl = (
  location: BrowserCallbackLocation,
  website = platformCapabilities.website,
): string =>
  new URL(website ? "/chat" : location.pathname, location.origin).toString();

const readBrowserSocialBridgeCallback = (
  raw: unknown,
  expectedSiteUrl: string,
): string | null => {
  if (typeof raw !== "string") return null;
  try {
    const callback = new URL(raw);
    const expectedOrigin = new URL(expectedSiteUrl).origin;
    const requestIds = callback.searchParams.getAll("requestId");
    if (
      callback.origin !== expectedOrigin ||
      callback.username ||
      callback.password ||
      (callback.protocol !== "https:" &&
        !(
          callback.protocol === "http:" &&
          (callback.hostname === "localhost" ||
            callback.hostname === "127.0.0.1")
        )) ||
      callback.pathname !== "/api/auth/browser-social/verify" ||
      callback.hash ||
      callback.searchParams.has("ott") ||
      requestIds.length !== 1 ||
      !/^[A-Za-z0-9_-]{32,64}$/.test(requestIds[0] ?? "") ||
      Array.from(callback.searchParams.keys()).some(
        (key) => key !== "requestId",
      )
    ) {
      return null;
    }
    return callback.toString();
  } catch {
    return null;
  }
};

export const startBrowserGoogleSignIn = async () => {
  const siteUrl = backendUrl || null;
  if (!siteUrl) {
    throw new Error("Stella's sign-in service is not configured.");
  }
  const response = await fetch(`${siteUrl}/api/auth/browser-social/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      returnTo: getBrowserSocialCallbackUrl(window.location),
    }),
  });
  const data = (await response.json().catch(() => null)) as {
    callbackURL?: unknown;
  } | null;
  const callbackURL = readBrowserSocialBridgeCallback(
    data?.callbackURL,
    siteUrl,
  );
  if (!response.ok || !callbackURL) {
    throw new Error("Browser account callback could not be registered.");
  }
  return authClient.signIn.social({
    provider: "google",
    callbackURL,
  });
};

export type MagicLinkSendRequest = {
  headers: Record<string, string>;
  body: { email: string };
};

export const buildMagicLinkSendRequest = (
  email: string,
  turnstileToken?: string,
): MagicLinkSendRequest => ({
  headers: {
    "Content-Type": "application/json",
    ...captchaHeaders(turnstileToken),
  },
  body: { email },
});

const readConnectedAccountOwnerId = (): string | null => {
  const data = getAuthSessionSnapshot().data as
    | {
        user?: {
          id?: string | null;
          isAnonymous?: boolean | null;
        } | null;
      }
    | null
    | undefined;
  const ownerId = data?.user?.id?.trim();
  return ownerId && data?.user?.isAnonymous !== true ? ownerId : null;
};

export const applyAndVerifyAccountSessionToken = async (
  sessionToken: string,
): Promise<void> => {
  const normalized = sessionToken.trim();
  if (!normalized) {
    throw new Error("Missing account session token.");
  }

  if (window.electronAPI) {
    const applySessionToken = window.electronAPI.system.applyAuthSessionToken;
    if (!applySessionToken) {
      throw new Error("Desktop account session storage is unavailable.");
    }
    const result = await applySessionToken(normalized);
    if (!result?.ok) {
      throw new Error("Desktop account session storage rejected the token.");
    }
  } else {
    writeBrowserSessionToken(normalized);
    authClient.updateSession();
  }

  await refreshAuthSession();
  if (!readConnectedAccountOwnerId()) {
    throw new Error("The connected account session could not be verified.");
  }
};
