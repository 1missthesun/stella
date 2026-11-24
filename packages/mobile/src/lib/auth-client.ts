import { createAuthClient } from "better-auth/react";
import {
  jwtClient,
  magicLinkClient,
} from "better-auth/client/plugins";
import { REQUEST_BUDGET_MS } from "@stella/contracts/request-deadline";
import { env } from "../config/env";
import { assert } from "./assert";
import { fetchWithinDeadline } from "./cloud-request";
import { nativeBearerClient } from "./native-auth-client";

export { MOBILE_SESSION_TOKEN_KEY } from "./native-auth-client";

const plugins = [
  nativeBearerClient({
    scheme: env.mobileScheme,
  }),
  magicLinkClient(),
  jwtClient(),
];

type AuthClient = ReturnType<
  typeof createAuthClient<{ plugins: typeof plugins }>
>;

let instance: AuthClient | null = null;

export const authClient = new Proxy({} as AuthClient, {
  get(_target, prop, receiver) {
    if (!instance) {
      assert(
        env.backendUrl,
        "EXPO_PUBLIC_STELLA_BACKEND_URL is not configured.",
      );
      instance = createAuthClient({
        baseURL: env.backendUrl,
        plugins,
        fetchOptions: {
          customFetchImpl: (input, init) =>
            fetchWithinDeadline(input, init, {
              label: "Stella sign-in",
              timeoutMs:
                (init?.method ?? "GET").toUpperCase() === "GET"
                  ? REQUEST_BUDGET_MS.lookup
                  : REQUEST_BUDGET_MS.call,
            }),
        },
      });
    }

    return Reflect.get(instance, prop, receiver);
  },
});
