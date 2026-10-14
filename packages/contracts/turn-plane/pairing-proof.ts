import type { DispatchPayload } from "./placement.js";

export const MOBILE_PAIRING_PROOF_VERSION =
  "stella-mobile-bridge-pair-proof-v1" as const;

export const MOBILE_PAIRING_CHALLENGE_VERSION =
  "execution-placement-v1" as const;

export const MOBILE_PAIRING_PROOF_MAX_SKEW_MS = 5 * 60_000;

export const MOBILE_PAIRING_HEADERS = {
  mobileDeviceId: "x-stella-mobile-device-id",
  desktopDeviceId: "x-stella-mobile-desktop-device-id",
  proof: "x-stella-mobile-pair-proof",
  issuedAt: "x-stella-mobile-pair-proof-issued-at",
  challenge: "x-stella-mobile-pair-proof-challenge",
  mobilePublicKey: "x-stella-mobile-public-key",
} as const;

export const MOBILE_PAIRING_LIMITS = {
  deviceId: 256,
  challenge: 512,
  publicKey: 128,
  proof: 128,
} as const;

export type MobilePairingChallengeInput = {
  idempotencyKey: string;
  conversationId: string;
  payloadHash: string;
  kind: "chat" | "agent";
  subject: "portable" | "computer" | "cloud";
  targetMode?: "automatic" | "cloud" | "device";
  targetDeviceId?: string;
};

export const buildMobilePairingChallenge = (
  input: MobilePairingChallengeInput,
): string => {
  const parts: string[] = [
    MOBILE_PAIRING_CHALLENGE_VERSION,
    input.idempotencyKey,
    input.conversationId,
    input.payloadHash,
    input.kind,
    input.subject,
  ];
  if (input.targetMode !== undefined || input.targetDeviceId) {
    parts.push(input.targetMode ?? "automatic", input.targetDeviceId ?? "");
  }
  return parts.join(":");
};

export type MobilePairingProofMessageInput = {
  desktopDeviceId: string;
  mobileDeviceId: string;
  challenge: string;
  mobilePublicKey?: string;
  issuedAt: number;
};

export const buildMobilePairingProofMessage = (
  input: MobilePairingProofMessageInput,
): string =>
  [
    MOBILE_PAIRING_PROOF_VERSION,
    input.desktopDeviceId,
    input.mobileDeviceId,
    input.challenge,
    input.mobilePublicKey ?? "",
    String(input.issuedAt),
  ].join("\n");

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (value: string): Promise<string> =>
  toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));

export const hmacSha256Hex = async (
  key: string,
  message: string,
): Promise<string> => {
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", imported, encoder.encode(message)),
    ),
  );
};

export const constantTimeEqualHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
};

export type MobilePairingProofFields = {
  mobileDeviceId: string;
  desktopDeviceId: string;
  challenge: string;
  proof: string;
  issuedAt: number;
  mobilePublicKey?: string;
};

export const mobilePairingProofHeaders = (
  fields: MobilePairingProofFields,
): Record<string, string> => ({
  [MOBILE_PAIRING_HEADERS.mobileDeviceId]: fields.mobileDeviceId,
  [MOBILE_PAIRING_HEADERS.desktopDeviceId]: fields.desktopDeviceId,
  [MOBILE_PAIRING_HEADERS.challenge]: fields.challenge,
  [MOBILE_PAIRING_HEADERS.proof]: fields.proof,
  [MOBILE_PAIRING_HEADERS.issuedAt]: String(fields.issuedAt),
  ...(fields.mobilePublicKey
    ? { [MOBILE_PAIRING_HEADERS.mobilePublicKey]: fields.mobilePublicKey }
    : {}),
});

const bounded = (value: string | null, max: number): string => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : "";
};

export const hasMobilePairingProofHeaders = (headers: Headers): boolean =>
  Boolean(
    headers.get(MOBILE_PAIRING_HEADERS.proof)?.trim() ||
      headers.get(MOBILE_PAIRING_HEADERS.mobileDeviceId)?.trim(),
  );

export const readMobilePairingProofHeaders = (
  headers: Headers,
): MobilePairingProofFields | null => {
  const mobileDeviceId = bounded(
    headers.get(MOBILE_PAIRING_HEADERS.mobileDeviceId),
    MOBILE_PAIRING_LIMITS.deviceId,
  );
  const desktopDeviceId = bounded(
    headers.get(MOBILE_PAIRING_HEADERS.desktopDeviceId),
    MOBILE_PAIRING_LIMITS.deviceId,
  );
  const challenge = bounded(
    headers.get(MOBILE_PAIRING_HEADERS.challenge),
    MOBILE_PAIRING_LIMITS.challenge,
  );
  const proof = bounded(
    headers.get(MOBILE_PAIRING_HEADERS.proof),
    MOBILE_PAIRING_LIMITS.proof,
  );
  const rawIssuedAt = headers.get(MOBILE_PAIRING_HEADERS.issuedAt)?.trim() ?? "";
  const issuedAt = Number(rawIssuedAt);
  if (
    !mobileDeviceId ||
    !desktopDeviceId ||
    !challenge ||
    !proof ||
    !rawIssuedAt ||
    !Number.isFinite(issuedAt)
  ) {
    return null;
  }
  const mobilePublicKeyRaw = bounded(
    headers.get(MOBILE_PAIRING_HEADERS.mobilePublicKey),
    MOBILE_PAIRING_LIMITS.publicKey,
  );
  const mobilePublicKey = /^[A-Za-z0-9_-]+$/.test(mobilePublicKeyRaw)
    ? mobilePublicKeyRaw
    : "";
  return {
    mobileDeviceId,
    desktopDeviceId,
    challenge,
    proof,
    issuedAt,
    ...(mobilePublicKey ? { mobilePublicKey } : {}),
  };
};

export type MobilePairingProofRejection =
  | "missing"
  | "malformed"
  | "expired"
  | "challenge_mismatch"
  | "unpaired"
  | "signature";

export type MobilePairingProofResult =
  | {
      ok: true;
      mobileDeviceId: string;
      desktopDeviceId: string;
      challenge: string;
      issuedAt: number;
    }
  | { ok: false; reason: MobilePairingProofRejection };

/**
 * Verify a phone's proof. `publicKey` is the pairing key the owner snapshot
 * carries for this (mobile, desktop) pair — absent means "not paired", which
 * is refused before any HMAC work so an unpaired phone learns nothing.
 *
 * `expectedChallenge` is the challenge the server derived from the request it
 * is about to act on, so a proof minted for one payload never authorizes
 * another.
 */
export const verifyMobilePairingProof = async (input: {
  headers?: Headers;
  fields?: MobilePairingProofFields | null;
  publicKey?: string | null;
  expectedChallenge: string;
  now?: number;
  maxSkewMs?: number;
}): Promise<MobilePairingProofResult> => {
  const fields =
    input.fields ??
    (input.headers ? readMobilePairingProofHeaders(input.headers) : null);
  if (!fields) {
    return {
      ok: false,
      reason:
        input.headers && hasMobilePairingProofHeaders(input.headers)
          ? "malformed"
          : "missing",
    };
  }
  const pairingKey = input.publicKey?.trim() ?? "";
  if (!pairingKey) return { ok: false, reason: "unpaired" };
  const now = input.now ?? Date.now();
  const skew = input.maxSkewMs ?? MOBILE_PAIRING_PROOF_MAX_SKEW_MS;
  if (!(fields.issuedAt > 0) || Math.abs(now - fields.issuedAt) > skew) {
    return { ok: false, reason: "expired" };
  }
  if (input.expectedChallenge !== fields.challenge) {
    return { ok: false, reason: "challenge_mismatch" };
  }
  const expected = await hmacSha256Hex(
    pairingKey,
    buildMobilePairingProofMessage({
      desktopDeviceId: fields.desktopDeviceId,
      mobileDeviceId: fields.mobileDeviceId,
      challenge: fields.challenge,
      ...(fields.mobilePublicKey !== undefined
        ? { mobilePublicKey: fields.mobilePublicKey }
        : {}),
      issuedAt: fields.issuedAt,
    }),
  );
  if (!constantTimeEqualHex(expected, fields.proof.toLowerCase())) {
    return { ok: false, reason: "signature" };
  }
  return {
    ok: true,
    mobileDeviceId: fields.mobileDeviceId,
    desktopDeviceId: fields.desktopDeviceId,
    challenge: fields.challenge,
    issuedAt: fields.issuedAt,
  };
};

export const canonicalDispatchPayloadJson = (
  payload: DispatchPayload,
): string =>
  JSON.stringify({
    schemaVersion: 1,
    prompt: payload.prompt,
    conversationId: payload.conversationId,
    clientMsgId: payload.clientMsgId,
    ...(payload.userMessageEventId
      ? { userMessageEventId: payload.userMessageEventId }
      : {}),
    ...(payload.locale ? { locale: payload.locale } : {}),
    ...(payload.attachments && payload.attachments.length > 0
      ? { attachments: payload.attachments }
      : {}),
    ...(payload.context && (payload.context.text || payload.context.display)
      ? {
          context: {
            ...(payload.context.text ? { text: payload.context.text } : {}),
            ...(payload.context.display
              ? { display: payload.context.display }
              : {}),
          },
        }
      : {}),
    ...(payload.execution
      ? {
          execution: {
            engine: payload.execution.engine,
            provider: payload.execution.provider,
            model: payload.execution.model,
            reasoningEffort: payload.execution.reasoningEffort,
          },
        }
      : {}),
    ...(payload.description ? { description: payload.description } : {}),
    ...(payload.threadId ? { threadId: payload.threadId } : {}),
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.handoff === true ? { handoff: true } : {}),
  });

