/**
 * Expo push sends: authenticated with EXPO_ACCESS_TOKEN when set (required
 * once the Expo project turns on Enhanced Push Security), and off entirely on
 * owner-mode servers, which have no push relay.
 */

import { ownerModeEnabled } from "./selfhost/owner-mode.js";

export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

export const expoPushEnabled = (env: unknown): boolean => !ownerModeEnabled(env);

export const expoPushHeaders = (env: unknown): Record<string, string> => {
  const raw = (env as Record<string, unknown>).EXPO_ACCESS_TOKEN;
  const token = typeof raw === "string" ? raw.trim() : "";
  return {
    "content-type": "application/json",
    accept: "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
};
