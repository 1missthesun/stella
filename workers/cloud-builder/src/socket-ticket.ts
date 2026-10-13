import {
  SOCKET_TICKET_PURPOSES,
  SOCKET_TICKET_TTL_MS,
  type SocketTicketPurpose,
} from "@stella/contracts/socket-ticket";
import type { VerifiedToken } from "./auth-jwt.js";

const TICKET_PREFIX = "st1";
const TICKET_DOMAIN = "stella.socket-ticket.v1";
const RESOURCE = /^[A-Za-z0-9._~:-]{0,256}$/u;
const CLAIM_KEYS = "a,e,i,l,n,o,p,r,s,t,v,x";

type SocketTicketClaims = {
  v: 1;
  p: SocketTicketPurpose;
  r: string;
  o: string;
  s: string;
  i: string;
  x: number;
  a: 0 | 1;
  l: VerifiedToken["identityLevel"];
  t: number;
  e: number;
  n: string;
};

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const decodeBase64Url = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const binary = atob(
      value
        .replaceAll("-", "+")
        .replaceAll("_", "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "="),
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
};

const hmacKey = async (
  secret: string,
  usage: "sign" | "verify",
): Promise<CryptoKey> => {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.byteLength < 32 || bytes.byteLength > 4_096)
    throw new Error("Socket ticket secret is invalid.");
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
};

const signingInput = (payload: string): Uint8Array =>
  new TextEncoder().encode(`${TICKET_DOMAIN}.${payload}`);

export const isSocketTicketPurpose = (
  value: unknown,
): value is SocketTicketPurpose =>
  typeof value === "string" &&
  (SOCKET_TICKET_PURPOSES as readonly string[]).includes(value);

export const isSocketTicketResource = (value: unknown): value is string =>
  typeof value === "string" && RESOURCE.test(value);

export const issueSocketTicket = async (args: {
  secret: string;
  token: VerifiedToken;
  purpose: SocketTicketPurpose;
  resource: string;
  now: number;
}): Promise<{ ticket: string; expiresAtMs: number }> => {
  if (!isSocketTicketResource(args.resource)) {
    throw new Error("Socket ticket resource is invalid.");
  }
  const expiresAtMs = Math.min(
    args.now + SOCKET_TICKET_TTL_MS,
    args.token.expiresAtMs,
  );
  const claims: SocketTicketClaims = {
    v: 1,
    p: args.purpose,
    r: args.resource,
    o: args.token.ownerId,
    s: args.token.subject,
    i: args.token.sessionId,
    x: args.token.expiresAtMs,
    a: args.token.isAnonymous ? 1 : 0,
    l: args.token.identityLevel,
    t: args.token.issuedAtMs,
    e: expiresAtMs,
    n: base64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(args.secret, "sign"),
    signingInput(payload),
  );
  return {
    ticket: `${TICKET_PREFIX}.${payload}.${base64Url(new Uint8Array(signature))}`,
    expiresAtMs,
  };
};

export const verifySocketTicket = async (args: {
  secret: string | readonly string[];
  ticket: string;
  purpose: SocketTicketPurpose;
  resource: string;
  now: number;
}): Promise<VerifiedToken | null> => {
  const [prefix, payload, signature, extra] = args.ticket.split(".");
  if (prefix !== TICKET_PREFIX || !payload || !signature || extra) return null;
  const payloadBytes = decodeBase64Url(payload);
  const signatureBytes = decodeBase64Url(signature);
  if (!payloadBytes || !signatureBytes || signatureBytes.byteLength !== 32)
    return null;
  let verified = false;
  for (const secret of typeof args.secret === "string" ? [args.secret] : args.secret) {
    if (
      await crypto.subtle.verify(
        "HMAC",
        await hmacKey(secret, "verify"),
        signatureBytes,
        signingInput(payload),
      )
    ) {
      verified = true;
      break;
    }
  }
  if (!verified) return null;
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        payloadBytes,
      ),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    Object.keys(value).sort().join(",") !== CLAIM_KEYS ||
    value.v !== 1 ||
    value.p !== args.purpose ||
    value.r !== args.resource ||
    typeof value.o !== "string" ||
    !value.o ||
    typeof value.s !== "string" ||
    !value.s ||
    typeof value.i !== "string" ||
    !Number.isSafeInteger(value.x) ||
    Number(value.x) <= args.now ||
    (value.a !== 0 && value.a !== 1) ||
    (value.l !== 0 && value.l !== 1 && value.l !== 2 && value.l !== 3) ||
    !Number.isSafeInteger(value.t) ||
    !Number.isSafeInteger(value.e) ||
    Number(value.e) <= args.now ||
    Number(value.e) > args.now + SOCKET_TICKET_TTL_MS ||
    typeof value.n !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/u.test(value.n)
  ) {
    return null;
  }
  return {
    ownerId: value.o,
    subject: value.s,
    sessionId: value.i,
    expiresAtMs: Number(value.x),
    isAnonymous: value.a === 1,
    identityLevel: value.l,
    issuedAtMs: Number(value.t),
  };
};
