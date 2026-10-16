import { createAuthClient } from "better-auth/client";
import {
  jwtClient,
  magicLinkClient,
  oneTimeTokenClient,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  fetchWithDeadline,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";
import { backendUrl } from "@/platform/backend/backend-url";
import { getStellaInteriorBridge } from "@/platform/interior/interior-bridge";
import {
  captureRotatedSessionToken,
  clearBrowserSessionToken,
  readBrowserSessionToken,
} from "@/global/auth/services/auth-storage";

const createPlugins = () => [
  jwtClient(),
  magicLinkClient(),
  oneTimeTokenClient(),
  passkeyClient(),
];

type AuthClient = ReturnType<
  typeof createAuthClient<{ plugins: ReturnType<typeof createPlugins> }>
>;

let _instance: AuthClient | null = null;

export const authClient = new Proxy({} as AuthClient, {
  get(_target, prop, receiver) {
    if (getStellaInteriorBridge()) {
      throw new Error("Use the trusted Stella shell for account changes.");
    }
    if (!_instance) {
      if (!backendUrl) {
        throw new Error(
          "Stella backend URL is not set. Cannot initialize auth client.",
        );
      }
      const usesTrustedCookieAuth =
        !window.electronAPI && window.location.origin === backendUrl;
      if (usesTrustedCookieAuth) clearBrowserSessionToken();
      _instance = createAuthClient({
        baseURL: backendUrl,
        plugins: createPlugins(),
        fetchOptions: {
          credentials: usesTrustedCookieAuth ? "include" : "omit",
          customFetchImpl: (input, init) =>
            fetchWithDeadline(
              fetch,
              typeof input === "string"
                ? input
                : input instanceof URL
                  ? input.href
                  : input.url,
              init ?? {},
              {
                label: "sign-in",
                timeoutMs: REQUEST_BUDGET_MS.call,
                signal: init?.signal,
              },
            ),
          onRequest(context) {
            if (usesTrustedCookieAuth) return context;
            const token = readBrowserSessionToken();
            if (token) {
              context.headers.set("Authorization", `Bearer ${token}`);
            }
            return context;
          },
          onSuccess(context) {
            if (!usesTrustedCookieAuth) {
              captureRotatedSessionToken(context.response);
            }
          },
        },
        sessionOptions: {
          refetchOnWindowFocus: false,
        },
      });
    }
    return Reflect.get(_instance, prop, receiver);
  },
});
