export const APP_INTEGRITY_HEADER = "x-stella-app-integrity" as const;
export const APP_INTEGRITY_CHALLENGE_PATH = "/api/auth/integrity/challenge" as const;

export const APP_INTEGRITY_NONCE_TTL_MS = 5 * 60_000;

export type AppIntegrityPurpose = "magic-link";

export const isAppIntegrityPurpose = (value: unknown): value is AppIntegrityPurpose =>
  value === "magic-link";

export type AppIntegrityChallengeRequest = { purpose: AppIntegrityPurpose };
export type AppIntegrityChallengeResponse = { nonce: string; expiresAt: number };

export const appIntegrityChallengeString = (
  purpose: AppIntegrityPurpose,
  nonce: string,
): string => ["stella-app-integrity", purpose, nonce].join("\n");

export type AppIntegrityProof =
  | {
      platform: "ios";
      purpose: AppIntegrityPurpose;
      nonce: string;
      keyId: string;
      attestation?: string;
      assertion?: string;
    }
  | {
      platform: "android";
      purpose: AppIntegrityPurpose;
      nonce: string;
      token: string;
    };

export type AppIntegrityErrorCode =
  | "integrity_required"
  | "integrity_invalid"
  | "integrity_key_unknown";

export const APP_INTEGRITY_MAX_PROOF_BYTES = 64 * 1024;

const base64UrlEncode = (text: string): string =>
  btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const base64UrlDecode = (value: string): string => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
};

export const encodeAppIntegrityProof = (proof: AppIntegrityProof): string =>
  base64UrlEncode(JSON.stringify(proof));

const isBase64Text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  /^[A-Za-z0-9+/=_-]+$/.test(value);

export const decodeAppIntegrityProof = (
  headerValue: string | null | undefined,
): AppIntegrityProof | null => {
  const raw = headerValue?.trim();
  if (!raw || raw.length > APP_INTEGRITY_MAX_PROOF_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!isAppIntegrityPurpose(record.purpose)) return null;
  if (typeof record.nonce !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(record.nonce)) {
    return null;
  }
  if (record.platform === "ios") {
    if (!isBase64Text(record.keyId, 256)) return null;
    const attestation = record.attestation;
    const assertion = record.assertion;
    if (attestation !== undefined && !isBase64Text(attestation, APP_INTEGRITY_MAX_PROOF_BYTES)) {
      return null;
    }
    if (assertion !== undefined && !isBase64Text(assertion, 8_192)) return null;
    if ((attestation === undefined) === (assertion === undefined)) return null;
    return {
      platform: "ios",
      purpose: record.purpose,
      nonce: record.nonce,
      keyId: record.keyId,
      ...(attestation !== undefined ? { attestation } : {}),
      ...(assertion !== undefined ? { assertion } : {}),
    };
  }
  if (record.platform === "android") {
    if (!isBase64Text(record.token, 16_384) && typeof record.token !== "string") return null;
    if (typeof record.token !== "string" || !record.token || record.token.length > 16_384) {
      return null;
    }
    return {
      platform: "android",
      purpose: record.purpose,
      nonce: record.nonce,
      token: record.token,
    };
  }
  return null;
};
