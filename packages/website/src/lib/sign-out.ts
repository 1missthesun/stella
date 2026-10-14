"use client";

import { authClient, writeSessionToken } from "./auth-client";
import { clearCachedToken } from "./auth-token";
import { reconnectBackendClient } from "./backend";

export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    writeSessionToken(null);
    clearCachedToken();
    reconnectBackendClient();
  }
}
