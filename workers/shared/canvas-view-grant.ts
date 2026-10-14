export const CANVAS_VIEW_GRANT_PARAM = "grant";
export const CANVAS_VIEW_COOKIE = "stella_canvas_view";
export const CANVAS_VIEW_GRANT_TTL_MS = 5 * 60 * 1000;
export const CANVAS_VIEW_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;

export type CanvasViewClaims = {
  k: "grant" | "view";
  o: string;
  s?: string;
  e: number;
};

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
};

const hmacKey = (secret: string, usage: "sign" | "verify"): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );

export const canvasOwnerTag = async (ownerId: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`stella-canvas-owner:${ownerId}`),
  );
  return toBase64Url(new Uint8Array(digest)).slice(0, 32);
};

export const signCanvasViewToken = async (
  secret: string,
  claims: CanvasViewClaims,
): Promise<string> => {
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
};

export const verifyCanvasViewToken = async (
  secret: string,
  token: string,
  now: number,
): Promise<CanvasViewClaims | null> => {
  if (token.length > 1024) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    signatureBytes,
    encoder.encode(payload),
  );
  if (!valid) return null;
  const payloadBytes = fromBase64Url(payload);
  if (!payloadBytes) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object") return null;
  const record = claims as Record<string, unknown>;
  if (record.k !== "grant" && record.k !== "view") return null;
  if (typeof record.o !== "string" || !record.o) return null;
  if (typeof record.e !== "number" || !Number.isFinite(record.e) || record.e <= now) {
    return null;
  }
  if (record.s !== undefined && typeof record.s !== "string") return null;
  return {
    k: record.k,
    o: record.o,
    e: record.e,
    ...(typeof record.s === "string" ? { s: record.s } : {}),
  };
};
