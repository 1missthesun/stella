import { GATEWAY_BYOK_RELAY_PREFIX, GATEWAY_RELAY_PREFIX, GATEWAY_VALIDATED_RELAY_PREFIX } from "./api.js";

/**
 * A client that sends this on a non-streaming relay request gets headers at
 * once, a space every interval while the model works, and finally one
 * `RelayKeepaliveEnvelope` carrying the real status, headers and body.
 * JSON parsers skip the leading whitespace.
 */
export const GATEWAY_RELAY_KEEPALIVE_HEADER = "x-stella-relay-keepalive" as const;
export const GATEWAY_RELAY_KEEPALIVE_INTERVAL_MS = 15_000;

export type RelayKeepaliveEnvelope = {
  stellaRelayEnvelope: 1;
  status: number;
  headers: Record<string, string>;
  body: string;
};

export const isKeepaliveRelayPath = (pathname: string): boolean =>
  !pathname.startsWith(`${GATEWAY_BYOK_RELAY_PREFIX}/`) &&
  (pathname.startsWith(`${GATEWAY_RELAY_PREFIX}/`) || pathname.startsWith(`${GATEWAY_VALIDATED_RELAY_PREFIX}/`));

const isEnvelope = (value: unknown): value is RelayKeepaliveEnvelope =>
  !!value &&
  typeof value === "object" &&
  (value as RelayKeepaliveEnvelope).stellaRelayEnvelope === 1 &&
  typeof (value as RelayKeepaliveEnvelope).status === "number" &&
  typeof (value as RelayKeepaliveEnvelope).body === "string";

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/** Turns a keepalive response back into the response the relay produced; others pass through. */
export const unwrapRelayKeepalive = async (response: Response): Promise<Response> => {
  if (response.headers.get(GATEWAY_RELAY_KEEPALIVE_HEADER) !== "1") return response;
  const text = (await response.text()).trim();
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    envelope = null;
  }
  if (!isEnvelope(envelope)) {
    throw new Error("The connection to Stella's model gateway ended before the reply arrived.");
  }
  return new Response(NULL_BODY_STATUSES.has(envelope.status) ? null : envelope.body, {
    status: envelope.status,
    headers: envelope.headers,
  });
};
