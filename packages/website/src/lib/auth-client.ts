"use client";

import { createAuthClient } from "better-auth/react";
import { jwtClient, magicLinkClient } from "better-auth/client/plugins";
import { readBackendUrl } from "./backend-url";

const SESSION_TOKEN_KEY = "better-auth_session_token";

const readSessionToken = (): string => {
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
};

const writeSessionToken = (token: string | null): void => {
  try {
    if (token) window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    else window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Storage denial leaves the session non-persistent.
  }
};

export const hasSessionToken = (): boolean => readSessionToken() !== "";

const createPlugins = () => [magicLinkClient(), jwtClient()];

type WebAuthClient = ReturnType<
  typeof createAuthClient<{ plugins: ReturnType<typeof createPlugins> }>
>;

let _instance: WebAuthClient | null = null;

export const authClient = new Proxy({} as WebAuthClient, {
  get(_target, prop, receiver) {
    if (!_instance) {
      const baseURL = readBackendUrl();
      if (!baseURL) {
        throw new Error("NEXT_PUBLIC_STELLA_BACKEND_URL is not configured.");
      }
      _instance = createAuthClient({
        baseURL,
        plugins: createPlugins(),
        fetchOptions: {
          credentials: "omit",
          onRequest(context) {
            const token = readSessionToken();
            if (token) context.headers.set("Authorization", `Bearer ${token}`);
            return context;
          },
          // onResponse sees failures too, so a rejected sign-out still
          // drops the local bearer.
          onResponse(context) {
            if (new URL(context.request.url).pathname.endsWith("/sign-out")) {
              writeSessionToken(null);
              return;
            }
            const rotated = context.response.headers
              .get("set-auth-token")
              ?.trim();
            if (rotated) writeSessionToken(rotated);
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
