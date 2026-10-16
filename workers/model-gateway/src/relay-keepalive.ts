import {
  GATEWAY_RELAY_KEEPALIVE_HEADER,
  GATEWAY_RELAY_KEEPALIVE_INTERVAL_MS,
  isKeepaliveRelayPath,
  type RelayKeepaliveEnvelope,
} from "@stella/contracts/gateway/relay-keepalive";

const SPACE = new TextEncoder().encode(" ");

const envelopeOf = async (response: Response): Promise<RelayKeepaliveEnvelope> => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== "content-length" && name !== "content-encoding") headers[name] = value;
  });
  return { stellaRelayEnvelope: 1, status: response.status, headers, body: await response.text() };
};

/**
 * Non-streaming relay responses arrive only when the model finishes, so a
 * client timing the connection on silence would cut a long think. Opted-in
 * requests get headers now, a space every interval, then the real response
 * as an envelope. `no-transform` keeps Cloudflare from compressing (and so
 * buffering) the spaces.
 */
export const withRelayKeepalive = (
  request: Request,
  ctx: Pick<ExecutionContext, "waitUntil">,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> => {
  if (
    request.method !== "POST" ||
    request.headers.get(GATEWAY_RELAY_KEEPALIVE_HEADER) !== "1" ||
    !isKeepaliveRelayPath(new URL(request.url).pathname)
  ) {
    return handle(request);
  }
  const headers = new Headers(request.headers);
  headers.delete(GATEWAY_RELAY_KEEPALIVE_HEADER);
  const forwarded = new Request(request, { headers });
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const timer = setInterval(() => {
    writer.write(SPACE).catch(() => clearInterval(timer));
  }, GATEWAY_RELAY_KEEPALIVE_INTERVAL_MS);
  const finish = async () => {
    let envelope: RelayKeepaliveEnvelope;
    try {
      envelope = await envelopeOf(await handle(forwarded));
    } finally {
      clearInterval(timer);
    }
    await writer.write(new TextEncoder().encode(JSON.stringify(envelope)));
    await writer.close();
  };
  ctx.waitUntil(finish().catch(async (error: unknown) => {
    await writer.abort(error).catch(() => undefined);
  }));
  return Promise.resolve(
    new Response(readable, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, no-transform",
        [GATEWAY_RELAY_KEEPALIVE_HEADER]: "1",
      },
    }),
  );
};
