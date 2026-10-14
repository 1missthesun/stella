export type DpopAlgorithm = "ed25519" | "es256";

export const GATEWAY_DPOP_HEADER = "x-stella-dpop" as const;
export const GATEWAY_DPOP_KEY_HEADER = "x-stella-dpop-key" as const;
export const GATEWAY_DPOP_TS_HEADER = "x-stella-dpop-ts" as const;
export const GATEWAY_DPOP_ALG_HEADER = "x-stella-dpop-alg" as const;

export const GATEWAY_DPOP_MAX_SKEW_MS = 5 * 60_000;

export type GatewayDeviceKeyProof = {
  alg: DpopAlgorithm;
  publicKey: string;
  signature: string;
  timestamp: number;
};

export const isDpopAlgorithm = (value: unknown): value is DpopAlgorithm =>
  value === "ed25519" || value === "es256";

export const deviceExchangeSigningInput = (args: {
  ownerId: string;
  gatewayOrigin: string;
  timestamp: number;
}): string =>
  ["stella-device-exchange", args.ownerId, args.gatewayOrigin, String(args.timestamp)].join(
    "\n",
  );

export const dpopSigningInput = (args: {
  method: string;
  pathname: string;
  jti: string;
  requestId: string;
  timestamp: number;
}): string =>
  [
    "stella-dpop",
    args.method.toUpperCase(),
    args.pathname,
    args.jti,
    args.requestId,
    String(args.timestamp),
  ].join("\n");

export const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const base64UrlDecode = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const textBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const encoded = new TextEncoder().encode(value);
  const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copy.set(encoded);
  return copy;
};

export const deviceKeyHash = async (rawPublicKey: Uint8Array): Promise<string> => {
  const copy = new Uint8Array(new ArrayBuffer(rawPublicKey.byteLength));
  copy.set(rawPublicKey);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return base64UrlEncode(new Uint8Array(digest));
};

const ED25519_RAW_LENGTH = 32;
const P256_RAW_LENGTH = 65;

export const expectedRawPublicKeyLength = (alg: DpopAlgorithm): number =>
  alg === "ed25519" ? ED25519_RAW_LENGTH : P256_RAW_LENGTH;

// Literal object types rather than DOM names (`AlgorithmIdentifier`,
// `EcdsaParams`): the Workers type library spells those differently, and
// object literals satisfy both it and lib.dom.
type ImportAlgorithm =
  | { name: "Ed25519" }
  | { name: "ECDSA"; namedCurve: "P-256" };
type SignAlgorithm = { name: "Ed25519" } | { name: "ECDSA"; hash: "SHA-256" };

const importAlgorithm = (alg: DpopAlgorithm): ImportAlgorithm =>
  alg === "ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };

const signAlgorithm = (alg: DpopAlgorithm): SignAlgorithm =>
  alg === "ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };

export const importDpopPublicKey = async (
  alg: DpopAlgorithm,
  rawPublicKey: Uint8Array,
): Promise<CryptoKey> => {
  if (rawPublicKey.byteLength !== expectedRawPublicKeyLength(alg)) {
    throw new Error(`Invalid ${alg} public key length.`);
  }
  const copy = new Uint8Array(new ArrayBuffer(rawPublicKey.byteLength));
  copy.set(rawPublicKey);
  return await crypto.subtle.importKey("raw", copy, importAlgorithm(alg), true, [
    "verify",
  ]);
};

export const verifyDpopInput = async (
  alg: DpopAlgorithm,
  publicKey: CryptoKey,
  signature: string,
  input: string,
): Promise<boolean> => {
  try {
    return await crypto.subtle.verify(
      signAlgorithm(alg),
      publicKey,
      base64UrlDecode(signature),
      textBytes(input),
    );
  } catch {
    return false;
  }
};

export type DpopVerificationFailure =
  | "missing"
  | "malformed"
  | "unsupported_alg"
  | "key_mismatch"
  | "bad_signature"
  | "stale";

export type DpopVerificationResult =
  | { ok: true; deviceKeyHash: string }
  | { ok: false; reason: DpopVerificationFailure };

export const verifyDpopRequest = async (args: {
  headers: Headers;
  method: string;
  pathname: string;
  jti: string;
  requestId: string;
  expectedDeviceKeyHash: string;
  now: number;
}): Promise<DpopVerificationResult> => {
  const signature = args.headers.get(GATEWAY_DPOP_HEADER)?.trim() ?? "";
  const rawKey = args.headers.get(GATEWAY_DPOP_KEY_HEADER)?.trim() ?? "";
  const tsRaw = args.headers.get(GATEWAY_DPOP_TS_HEADER)?.trim() ?? "";
  const alg = args.headers.get(GATEWAY_DPOP_ALG_HEADER)?.trim().toLowerCase() ?? "";
  if (!signature && !rawKey && !tsRaw && !alg) return { ok: false, reason: "missing" };
  if (!isDpopAlgorithm(alg)) return { ok: false, reason: "unsupported_alg" };
  const timestamp = Number(tsRaw);
  if (!signature || !rawKey || !Number.isFinite(timestamp)) {
    return { ok: false, reason: "malformed" };
  }
  if (Math.abs(args.now - timestamp) > GATEWAY_DPOP_MAX_SKEW_MS) {
    return { ok: false, reason: "stale" };
  }
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = base64UrlDecode(rawKey);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (publicKeyBytes.byteLength !== expectedRawPublicKeyLength(alg)) {
    return { ok: false, reason: "malformed" };
  }
  const hash = await deviceKeyHash(publicKeyBytes);
  if (hash !== args.expectedDeviceKeyHash) return { ok: false, reason: "key_mismatch" };
  let publicKey: CryptoKey;
  try {
    publicKey = await importDpopPublicKey(alg, publicKeyBytes);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const valid = await verifyDpopInput(
    alg,
    publicKey,
    signature,
    dpopSigningInput({
      method: args.method,
      pathname: args.pathname,
      jti: args.jti,
      requestId: args.requestId,
      timestamp,
    }),
  );
  return valid ? { ok: true, deviceKeyHash: hash } : { ok: false, reason: "bad_signature" };
};

export const DPOP_SIGNING_INPUT_PREFIXES = [
  "stella-dpop\n",
  "stella-device-exchange\n",
] as const;
export const DEVICE_SIGNING_PROBE_INPUT = "stella-device-key-probe" as const;

export const isDelegatedDeviceSigningInput = (input: string): boolean =>
  input === DEVICE_SIGNING_PROBE_INPUT ||
  DPOP_SIGNING_INPUT_PREFIXES.some((prefix) => input.startsWith(prefix));

export const verifyDeviceKeyProof = async (args: {
  proof: GatewayDeviceKeyProof;
  ownerId: string;
  gatewayOrigin: string;
  now: number;
}): Promise<DpopVerificationResult> => {
  const { proof } = args;
  if (!isDpopAlgorithm(proof.alg)) return { ok: false, reason: "unsupported_alg" };
  if (
    typeof proof.publicKey !== "string" ||
    typeof proof.signature !== "string" ||
    !Number.isFinite(proof.timestamp)
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (Math.abs(args.now - proof.timestamp) > GATEWAY_DPOP_MAX_SKEW_MS) {
    return { ok: false, reason: "stale" };
  }
  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = base64UrlDecode(proof.publicKey);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (publicKeyBytes.byteLength !== expectedRawPublicKeyLength(proof.alg)) {
    return { ok: false, reason: "malformed" };
  }
  let publicKey: CryptoKey;
  try {
    publicKey = await importDpopPublicKey(proof.alg, publicKeyBytes);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const valid = await verifyDpopInput(
    proof.alg,
    publicKey,
    proof.signature,
    deviceExchangeSigningInput({
      ownerId: args.ownerId,
      gatewayOrigin: args.gatewayOrigin,
      timestamp: proof.timestamp,
    }),
  );
  if (!valid) return { ok: false, reason: "bad_signature" };
  return { ok: true, deviceKeyHash: await deviceKeyHash(publicKeyBytes) };
};
