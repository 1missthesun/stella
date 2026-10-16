import * as Crypto from "expo-crypto";
import { REQUEST_BUDGET_MS } from "@stella/contracts/request-deadline";
import { fetchWithinDeadline } from "./cloud-request";

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const generateClaimSecret = (): string =>
  toBase64Url(Crypto.getRandomBytes(32));

export const hashClaimSecret = async (secret: string): Promise<string> => {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    secret,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const claimSessionToken = async (
  backendUrl: string,
  requestId: string,
  claimSecret: string,
): Promise<string | null> => {
  const response = await fetchWithinDeadline(
    `${backendUrl}/api/auth/link/claim`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, claimSecret }),
    },
    { label: "Finishing sign-in", timeoutMs: REQUEST_BUDGET_MS.call },
  );
  if (!response.ok) {
    return null;
  }
  const data = (await response.json().catch(() => null)) as {
    token?: string;
  } | null;
  return typeof data?.token === "string" && data.token.trim()
    ? data.token.trim()
    : null;
};
