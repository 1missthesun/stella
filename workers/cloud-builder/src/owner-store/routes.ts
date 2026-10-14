import { builderServiceSecrets } from "../secret-rotation.js";
import { SOCKET_TICKET_SUBPROTOCOL_PREFIX } from "@stella/contracts/socket-ticket";
import { verifySocketTicket } from "../socket-ticket.js";
import {
  LIVE_CLOSE,
  LIVE_PATH,
  LIVE_SUBPROTOCOL,
  LIVE_TOKEN_SUBPROTOCOL_PREFIX,
  RPC_PATH_PREFIX,
  rpcErrorStatus,
  type RpcResponse,
} from "@stella/contracts/backend/protocol";
import { trustedInternalRequest } from "../conversation-hub.js";
import {
  HEADER_IDENTITY_LEVEL,
  HEADER_OWNER,
  HEADER_SESSION,
  HEADER_SUBJECT,
  HEADER_TOKEN_EXP,
  HEADER_TOKEN_IAT,
} from "../conversation-types.js";
import { readJsonObject } from "../http/body.js";
import { requireCaller, verifyCaller } from "../http/caller.js";
import { ownerRegistry } from "./domains.js";
import { RpcError, toBackendError } from "./errors.js";
import type { OwnerCaller, OwnerRegistry } from "./registry.js";
import { ownerGateStub } from "../rpc-release.js";
import { stageClaudeSessionChunk } from "./domains/claude-sessions.js";

const MAX_RPC_BODY_BYTES = 1024 * 1024;

type RouteEnv = Pick<
  Cloudflare.Env,
  "OWNER_GATES" | "CLOUD_BUILDER_PUBLIC_URL" | "BUILDER_SERVICE_SECRET" | "CONVERSATION_ARCHIVE"
>;

const appendClaudeSessionChunk = async (
  env: RouteEnv,
  caller: OwnerCaller,
  args: unknown,
): Promise<RpcResponse> => {
  const staged = await stageClaudeSessionChunk(env, caller.ownerId, args);
  const response = (await ownerGateStub(env.OWNER_GATES, caller.ownerId).claudeSessionCommit({
    staged,
    caller,
  })) as RpcResponse;
  if (!response.ok) return response;
  const { head, retired } = response.value as {
    head: unknown;
    retired: string[];
  };
  if (retired.length > 0 && env.CONVERSATION_ARCHIVE) {
    await env.CONVERSATION_ARCHIVE.delete(retired).catch(() => undefined);
  }
  return { ok: true, value: head };
};

const rpcJson = (body: RpcResponse): Response =>
  Response.json(body, {
    status: body.ok ? 200 : rpcErrorStatus(body.error.code),
    headers: { "cache-control": "no-store" },
  });

const readArgs = async (request: Request, maxBytes = MAX_RPC_BODY_BYTES): Promise<unknown> => {
  const body = await readJsonObject(request, maxBytes, { allowEmpty: true });
  if (!body.ok) throw new RpcError("BAD_REQUEST", body.error);
  return body.value.args ?? {};
};

export const handleRpc = async (
  request: Request,
  env: RouteEnv,
  registry: OwnerRegistry = ownerRegistry,
): Promise<Response> => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
  const url = new URL(request.url);
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.slice(RPC_PATH_PREFIX.length));
  } catch {
    return rpcJson({ ok: false, error: toBackendError(new RpcError("BAD_REQUEST", "Bad function name.")) });
  }
  const def = registry.calls.get(name);
  if (!def) {
    return rpcJson({ ok: false, error: toBackendError(new RpcError("NOT_FOUND", `Unknown function ${name}.`)) });
  }
  const verified = await requireCaller(request, env);
  if (!verified.ok) return rpcJson({ ok: false, error: toBackendError(verified.error) });
  const { caller } = verified;
  let args: unknown;
  try {
    args = await readArgs(request, def.scope === "owner" ? def.maxBodyBytes : undefined);
  } catch (error) {
    return rpcJson({ ok: false, error: toBackendError(error) });
  }
  if (name === "claudeSessions.append") {
    try {
      return rpcJson(await appendClaudeSessionChunk(env, caller, args));
    } catch (error) {
      return rpcJson({ ok: false, error: toBackendError(error) });
    }
  }
  if (def.scope === "owner") {
    const response = await ownerGateStub(env.OWNER_GATES, caller.ownerId).ownerRpc({ name, args, caller });
    return rpcJson(response);
  }
  try {
    const value = await def.handler(
      { caller, env: env as unknown as Cloudflare.Env, now: Date.now() },
      def.parse(args) as never,
    );
    return rpcJson({ ok: true, value: value ?? null });
  } catch (error) {
    if (!(error instanceof RpcError)) {
      console.error(JSON.stringify({
        event: "global_call_failed",
        name,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
    return rpcJson({ ok: false, error: toBackendError(error) });
  }
};

const liveOffer = (
  request: Request,
): { offered: boolean; token: string; ticket: string } => {
  let offered = false;
  let token = "";
  let ticket = "";
  for (const part of (request.headers.get("sec-websocket-protocol") ?? "").split(",")) {
    const value = part.trim();
    if (value === LIVE_SUBPROTOCOL) offered = true;
    else if (value.startsWith(SOCKET_TICKET_SUBPROTOCOL_PREFIX)) {
      ticket = value.slice(SOCKET_TICKET_SUBPROTOCOL_PREFIX.length);
    } else if (value.startsWith(LIVE_TOKEN_SUBPROTOCOL_PREFIX)) {
      token = value.slice(LIVE_TOKEN_SUBPROTOCOL_PREFIX.length);
    }
  }
  return { offered, token, ticket };
};

const verifyLiveCaller = async (
  env: RouteEnv,
  offer: { token: string; ticket: string },
): ReturnType<typeof verifyCaller> => {
  if (!offer.ticket) return await verifyCaller(env, offer.token);
  const caller = await verifySocketTicket({
    secret: builderServiceSecrets(env),
    ticket: offer.ticket,
    purpose: "live",
    resource: "",
    now: Date.now(),
  }).catch(() => null);
  return caller
    ? { ok: true, caller }
    : {
        ok: false,
        error: new RpcError("UNAUTHENTICATED", "Your sign-in expired. Sign in again to continue."),
      };
};

/**
 * Refuse by completing the handshake and closing with a real code: an HTTP
 * error before the 101 reaches the client as 1006, which it cannot tell apart
 * from a network drop.
 */
const refuseLive = (offered: boolean, code: number, reason: string): Response => {
  const pair = new WebSocketPair();
  const server = pair[1]!;
  server.accept();
  try {
    server.close(code, reason);
  } catch {
    // The peer is already gone.
  }
  return new Response(null, {
    status: 101,
    webSocket: pair[0]!,
    headers: offered ? { "sec-websocket-protocol": LIVE_SUBPROTOCOL } : {},
  });
};

export const handleLive = async (request: Request, env: RouteEnv): Promise<Response> => {
  if (request.method !== "GET" || (request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
    return Response.json({ error: "This endpoint speaks WebSocket only." }, { status: 426 });
  }
  const offer = liveOffer(request);
  if (!offer.offered) return refuseLive(false, LIVE_CLOSE.protocol, "unsupported_client");
  const verified = await verifyLiveCaller(env, offer);
  if (!verified.ok) {
    return refuseLive(
      true,
      verified.error.code === "UNAUTHENTICATED" ? LIVE_CLOSE.unauthenticated : LIVE_CLOSE.internal,
      verified.error.code === "UNAUTHENTICATED" ? "unauthenticated" : "unavailable",
    );
  }
  const { caller } = verified;
  const forwarded = trustedInternalRequest(request, "https://owner-gate.internal/live", {
    headers: "websocket",
    subprotocol: LIVE_SUBPROTOCOL,
    identity: {
      [HEADER_OWNER]: caller.ownerId,
      [HEADER_SUBJECT]: caller.subject,
      [HEADER_SESSION]: caller.sessionId,
      [HEADER_TOKEN_EXP]: String(caller.expiresAtMs),
      ...(caller.identityLevel !== undefined
        ? { [HEADER_IDENTITY_LEVEL]: String(caller.identityLevel) }
        : {}),
      ...(caller.issuedAtMs !== undefined ? { [HEADER_TOKEN_IAT]: String(caller.issuedAtMs) } : {}),
    },
  });
  return await ownerGateStub(env.OWNER_GATES, caller.ownerId).fetch(forwarded);
};

export const handleBackendRoute = async (
  request: Request,
  env: RouteEnv,
): Promise<Response | null> => {
  const path = new URL(request.url).pathname;
  if (path.startsWith(RPC_PATH_PREFIX)) return await handleRpc(request, env);
  if (path === LIVE_PATH) return await handleLive(request, env);
  return null;
};
