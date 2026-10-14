import {
  mintWorkspaceAppAccess,
  serveWorkspaceApp,
  serveWorkspaceAppPreview,
} from "../workspace-app-access.js";
import { worldName } from "../workspace.js";

import { handleSlackRoute } from "../slack/routes.js";
import { Hono, type MiddlewareHandler } from "hono";
import { TURN_BROKER_HEADERS } from "@stella/contracts/turn-credential-broker";
import { JOURNAL_CHECKPOINT_PATH, JOURNAL_CHECKPOINT_SUMMARY_MAX_BYTES } from "@stella/contracts/journal-checkpoint";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import {
  buildMobilePairingChallenge,
  canonicalDispatchPayloadJson,
  hasMobilePairingProofHeaders,
  sha256Hex as pairingSha256Hex,
  readMobilePairingProofHeaders,
  verifyMobilePairingProof,
} from "@stella/contracts/turn-plane/pairing-proof";
import type { DispatchSubmitRequest } from "@stella/contracts/turn-plane/placement";
import {
  DEVICES_PATH,
  DISPATCH_SUBMIT_PATH,
  PLACEMENT_PROTOCOL,
} from "@stella/contracts/turn-plane/placement";
import {
  CONVERSATION_ID_PATTERN,
  TURN_OWNER_GENERATION_HEADER,
  TURN_OWNER_ID_HEADER,
} from "@stella/contracts/turn-plane/turn-start";
import { bearerCredential } from "../../../shared/bearer.js";
import { verifyUserToken } from "../auth-jwt.js";
import { noteOwnerIdentity } from "../owner-identity.js";
import { readBoundedRequestText } from "../bounded-body.js";
import { withBrowserCors } from "../browser-cors.js";
import { withSecurityHeaders } from "../http/security-headers.js";
import { handleVoiceRoute, ownerDictationControl } from "../voice/routes.js";
import { handleBackendRoute } from "../owner-store/routes.js";
import { handleMediaRoute } from "../media/routes.js";
import { handleMapsRoute } from "../maps/routes.js";
import { handleDictationTranscribeRoute } from "../dictation/transcribe-route.js";
import { handleIntegrationsRoute } from "../integrations/routes.js";
import { handleProjectsRoute } from "../projects/routes.js";
import { handleAppSourceBootstrap } from "../app-source-bootstrap.js";
import { handleAppSourceReleases } from "../app-source-releases.js";
import { handleWebRendererRoute } from "../web-renderer.js";
import { handleUserCloudHomeRoute, ownerAccess } from "../cloud-home-routes.js";
import {
  HEADER_ISSUER,
  HEADER_OWNER,
  HEADER_SESSION,
  HEADER_SUBJECT,
  HEADER_TOKEN_EXP,
  isWebSocketUpgrade,
  refuseUpgrade,
  trustedInternalRequest,
  SUBPROTOCOL,
  tokenFromSubprotocol,
} from "../conversation-hub.js";
import {
  CLOSE_BAD_REQUEST,
  CLOSE_INTERNAL,
  CLOSE_UNAUTHENTICATED,
} from "../conversation-types.js";
import { devAcceptanceProbesEnabled } from "../dev-acceptance-probes.js";
import {
  dispatchErrorResponse,
  parseDispatchSubmitRequest,
} from "../dispatch-policy.js";
import { handleMuseTranscribeSocket } from "../muse-transcribe-socket.js";
import { STELLA_PROMPTS_PATH } from "@stella/contracts/stella-api";
import { stellaPromptsResponse } from "../prompts/route.js";
import {
  HEADER_PRESENCE_DEVICE_ID,
  OwnerGate,
} from "../owner-gate.js";
import { normalizeOwnerGeneration } from "../owner-generation.js";
import { evaluateCloudBuilderReadiness } from "../readiness.js";
import {
  boundedBodyStatus,
  CLOUD_BUILDER_BODY_LIMITS,
} from "../request-ingress.js";
import { verifyServiceBearerRequestWithAny } from "../service-bearer.js";
import { builderServiceSecret, builderServiceSecrets } from "../secret-rotation.js";
import { handleBillingRoute } from "../billing/routes.js";
import { handleAdminRoute } from "../admin/routes.js";
import { handleStellaModelsRoute } from "../catalog/models.js";
import { handlePreviewSessionCapabilityRoute } from "../billing/preview-session-capability.js";
import { handleDevicesRoute } from "../devices/routes.js";
import { handleUserAsksRoute } from "../user-asks/routes.js";
import { handleDeviceRequestRoute } from "../devices/device-request-route.js";
import { DEVICE_REQUEST_LIMITS } from "@stella/contracts/turn-plane/device-requests";
import { validateTurnBrokerTarget } from "../turn-credential-broker.js";
import type { TurnAuthKind } from "../turn-start-request.js";
import {
  HEADER_TURN_AUTH_KIND,
  parseCloudTurnStartRequest,
  serviceOnlyTurnFields,
  turnStartErrorResponse,
} from "../turn-start-request.js";
import {
  boundedIngressRequest,
  cloudHomeLeaseRunner,
  handleWorldRoute,
} from "./owner-purge-transfer.js";
import { retireSandboxInstance } from "./session-sandbox.js";
import type { Env } from "./shared/env.js";
import {
  HEADER_CONVERSATION_ID,
  json,
  log,
  ORCHESTRATOR_INTERNAL_ORIGIN,
  withInfrastructureDeadline,
} from "./shared/keys.js";
import type { ConversationCaller, DispatchCaller } from "./shared/types.js";
import {
  SOCKET_TICKET_PATH,
  type SocketTicketPurpose,
} from "@stella/contracts/socket-ticket";
import {
  isSocketTicketPurpose,
  isSocketTicketResource,
  issueSocketTicket,
  verifySocketTicket,
} from "../socket-ticket.js";
import { ownerGateStub, released } from "../rpc-release.js";

// ---------------------------------------------------------------------------
// The user-authenticated conversation surfaces
//
// Every other route on this worker is server-to-server and gated by the shared
// service secret. These two are the exception: they carry a signed-in user's
// user JWT, which is NOT the service secret, so they are matched before that
// gate. Verification happens here rather than in the Durable Object so an
// unauthenticated connect never instantiates one, never takes a socket slot,
// and never touches the agent's thread.
// ---------------------------------------------------------------------------

const SOCKET_HANDOFF_TIMEOUT_MS = 15_000;

/**
 * Verify the caller. `wantsSocket` decides only how a refusal is shaped: a
 * WebSocket client that gets an HTTP 4xx before the 101 sees close code 1006
 * and cannot tell "refresh your token" from "the network dropped" — opposite
 * responses — so refusals there complete the handshake and close with a real
 * code instead.
 */
const authenticateConversationCaller = async (
  request: Request,
  env: Env,
  wantsSocket: boolean,
  requestId: string,
  socketScope?: { purpose: SocketTicketPurpose; resource: string },
): Promise<
  { ok: true; caller: ConversationCaller } | { ok: false; response: Response }
> => {
  const issuer = (env.CLOUD_BUILDER_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  const deny = (
    closeCode: number,
    status: number,
    message: string,
    retryable: boolean,
  ): { ok: false; response: Response } => ({
    ok: false,
    response: wantsSocket
      ? refuseUpgrade(request, closeCode, message, {
          retryable,
          ref: requestId,
        })
      : json({ error: message, retryable, ref: requestId }, status),
  });

  if (!issuer) {
    log("error", "conversation_auth_unconfigured", { requestId });
    return deny(
      CLOSE_INTERNAL,
      503,
      "Stella can't open live conversations right now. Try again shortly.",
      true,
    );
  }

  let token = "";
  let ticket = "";
  if (wantsSocket) {
    // The credential rides in Sec-WebSocket-Protocol, never the query string:
    // browsers and React Native cannot set WebSocket request headers, and a
    // URL is the one part of a request that gets logged everywhere.
    const offer = tokenFromSubprotocol(request);
    if (!offer.offered) {
      return deny(CLOSE_BAD_REQUEST, 400, "Unsupported client.", false);
    }
    token = offer.token;
    ticket = offer.ticket;
  } else {
    token = bearerCredential(request.headers.get("authorization")) ?? "";
  }
  if (!token && !ticket) {
    return deny(
      CLOSE_UNAUTHENTICATED,
      401,
      "Sign in to open this conversation.",
      false,
    );
  }

  const authStartedAt = Date.now();
  if (ticket) {
    const ticketCaller = socketScope
      ? await verifySocketTicket({
          secret: builderServiceSecrets(env),
          ticket,
          purpose: socketScope.purpose,
          resource: socketScope.resource,
          now: Date.now(),
        }).catch(() => null)
      : null;
    if (!ticketCaller) {
      log("info", "conversation_auth_rejected", {
        requestId,
        reason: "bad_socket_ticket",
      });
      return deny(
        CLOSE_UNAUTHENTICATED,
        401,
        "Your sign-in expired. Sign in again to continue.",
        false,
      );
    }
    await noteOwnerIdentity(env, ticketCaller);
    logCallerAuthenticated(requestId, wantsSocket, "ticket", Date.now() - authStartedAt);
    return { ok: true, caller: { ...ticketCaller, issuer } };
  }
  const verified = await verifyUserToken(token, env);
  if (!verified.ok) {
    log(verified.retryable ? "error" : "info", "conversation_auth_rejected", {
      requestId,
      reason: verified.reason,
    });
    return verified.retryable
      ? deny(
          CLOSE_INTERNAL,
          503,
          "Stella couldn't check your sign-in. Try again shortly.",
          true,
        )
      : deny(
          CLOSE_UNAUTHENTICATED,
          401,
          "Your sign-in expired. Sign in again to continue.",
          false,
        );
  }
  await noteOwnerIdentity(env, verified.token);
  logCallerAuthenticated(
    requestId,
    wantsSocket,
    wantsSocket ? "legacy_token" : "bearer",
    Date.now() - authStartedAt,
  );
  return { ok: true, caller: { ...verified.token, issuer } };
};

const SLOW_CALLER_AUTH_MS = 250;

const logCallerAuthenticated = (
  requestId: string,
  socket: boolean,
  credential: "ticket" | "legacy_token" | "bearer",
  ms: number,
): void => {
  if (!socket && ms < SLOW_CALLER_AUTH_MS) return;
  log("info", "conversation_caller_authenticated", { requestId, socket, credential, ms });
};


const forwardToConversation = async (
  request: Request,
  env: Env,
  conversationId: string,
  doPath: string,
  caller: ConversationCaller,
): Promise<Response> => {
  const source = new URL(request.url);
  const target = new URL(ORCHESTRATOR_INTERNAL_ORIGIN);
  target.pathname = doPath;
  target.search = source.search;
  const forwarded = trustedInternalRequest(request, target.toString(), {
    headers: "http",
    subprotocol: SUBPROTOCOL,
    identity: {
      [HEADER_OWNER]: caller.ownerId,
      [HEADER_SUBJECT]: caller.subject,
      ...(caller.sessionId ? { [HEADER_SESSION]: caller.sessionId } : {}),
      [HEADER_TOKEN_EXP]: String(caller.expiresAtMs),
      [HEADER_ISSUER]: caller.issuer,
      [HEADER_CONVERSATION_ID]: conversationId,
    },
  });
  return await env.ORCHESTRATOR_SESSIONS.getByName(conversationId).fetch(
    forwarded,
  );
};

const handleTurnStartRoute = async (
  request: Request,
  env: Env,
  conversationId: string,
  requestId: string,
): Promise<Response> => {
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) {
    return turnStartErrorResponse(
      "bad_request",
      "conversationId must be 8-128 URL-safe characters.",
      false,
    );
  }
  let ownerId: string;
  let authKind: TurnAuthKind;
  let ownerGeneration: string | null = null;
  let tokenExpiresAtMs: number | null = null;
  if (await verifyServiceBearerRequestWithAny(request, builderServiceSecrets(env))) {
    const headerOwner = request.headers.get(TURN_OWNER_ID_HEADER)?.trim() ?? "";
    ownerGeneration = normalizeOwnerGeneration(
      request.headers.get(TURN_OWNER_GENERATION_HEADER),
    );
    if (!headerOwner || headerOwner.length > 512 || !ownerGeneration) {
      return turnStartErrorResponse(
        "bad_request",
        `Service callers must send ${TURN_OWNER_ID_HEADER} and ${TURN_OWNER_GENERATION_HEADER}.`,
        false,
      );
    }
    ownerId = headerOwner;
    authKind = "service";
  } else {
    const auth = await authenticateConversationCaller(
      request,
      env,
      false,
      requestId,
    );
    if (!auth.ok) {
      const status = auth.response.status;
      await auth.response.body?.cancel().catch(() => undefined);
      return status === 503
        ? turnStartErrorResponse(
            "internal",
            "Stella couldn't check your sign-in. Try again shortly.",
            true,
          )
        : turnStartErrorResponse(
            "unauthorized",
            "Sign in to send messages.",
            false,
          );
    }
    ownerId = auth.caller.ownerId;
    tokenExpiresAtMs = auth.caller.expiresAtMs;
    authKind = "user";
  }
  let text: string;
  try {
    text = await readBoundedRequestText(
      request,
      CLOUD_BUILDER_BODY_LIMITS.turn,
      { requireBody: true },
    );
  } catch (error) {
    const status = boundedBodyStatus(error);
    if (status === null) throw error;
    return turnStartErrorResponse(
      "bad_request",
      status === 413 ? "Request body is too large." : "Malformed request body.",
      false,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return turnStartErrorResponse(
      "bad_request",
      "Malformed JSON request.",
      false,
    );
  }
  const parsed = parseCloudTurnStartRequest(body);
  if (!parsed.ok) {
    return turnStartErrorResponse("bad_request", parsed.message, false);
  }
  if (authKind === "user") {
    const restricted = serviceOnlyTurnFields(parsed.request);
    if (restricted.length > 0) {
      return turnStartErrorResponse(
        "forbidden",
        `${restricted.join(", ")} require service authentication.`,
        false,
      );
    }
  }
  const headers = new Headers({ "content-type": "application/json" });
  headers.set(HEADER_OWNER, ownerId);
  headers.set(HEADER_TURN_AUTH_KIND, authKind);
  headers.set(HEADER_CONVERSATION_ID, conversationId);
  if (ownerGeneration)
    headers.set(TURN_OWNER_GENERATION_HEADER, ownerGeneration);
  if (tokenExpiresAtMs !== null) {
    headers.set(HEADER_TOKEN_EXP, String(tokenExpiresAtMs));
  }
  const response = await env.ORCHESTRATOR_SESSIONS.getByName(
    conversationId,
  ).fetch(`${ORCHESTRATOR_INTERNAL_ORIGIN}/turn`, {
    method: "POST",
    headers,
    body: text,
  });
  log("info", "conversation_turn_start", {
    requestId,
    authKind,
    lane: parsed.request.lane ?? "chat",
    status: response.status,
  });
  return response;
};

const forwardToDevicePresence = async (
  request: Request,
  env: Env,
  deviceId: string,
  caller: ConversationCaller,
): Promise<Response> => {
  const forwarded = trustedInternalRequest(request, "https://owner-gate/presence", {
    headers: "websocket",
    subprotocol: SUBPROTOCOL,
    identity: {
      [HEADER_OWNER]: caller.ownerId,
      [HEADER_TOKEN_EXP]: String(caller.expiresAtMs),
      [HEADER_PRESENCE_DEVICE_ID]: deviceId,
    },
  });
  return await ownerGateStub(env.OWNER_GATES, caller.ownerId).fetch(forwarded);
};

const handleDispatchSubmitRoute = async (
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> => {
  const receivedAt = Date.now();
  const startedAt = performance.now();
  let caller: DispatchCaller;
  if (await verifyServiceBearerRequestWithAny(request, builderServiceSecrets(env))) {
    const ownerId = request.headers.get(TURN_OWNER_ID_HEADER)?.trim() ?? "";
    const ownerGeneration = normalizeOwnerGeneration(
      request.headers.get(TURN_OWNER_GENERATION_HEADER),
    );
    if (!ownerId || ownerId.length > 512 || !ownerGeneration) {
      return dispatchErrorResponse(
        "bad_request",
        `Service callers must send ${TURN_OWNER_ID_HEADER} and ${TURN_OWNER_GENERATION_HEADER}.`,
        false,
      );
    }
    caller = { kind: "service", ownerId, ownerGeneration };
  } else {
    const auth = await authenticateConversationCaller(
      request,
      env,
      false,
      requestId,
    );
    if (!auth.ok) {
      const status = auth.response.status;
      await auth.response.body?.cancel().catch(() => undefined);
      return status === 503
        ? dispatchErrorResponse(
            "internal",
            "Stella couldn't check your sign-in. Try again shortly.",
            true,
          )
        : dispatchErrorResponse(
            "unauthorized",
            "Sign in to run this somewhere.",
            false,
          );
    }
    caller = { kind: "user", ownerId: auth.caller.ownerId };
  }
  const authMs = Math.round(performance.now() - startedAt);
  let text: string;
  try {
    text = await readBoundedRequestText(
      request,
      CLOUD_BUILDER_BODY_LIMITS.turn,
      { requireBody: true },
    );
  } catch (error) {
    const status = boundedBodyStatus(error);
    if (status === null) throw error;
    return dispatchErrorResponse(
      "bad_request",
      status === 413 ? "Request body is too large." : "Malformed request body.",
      false,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return dispatchErrorResponse(
      "bad_request",
      "Malformed JSON request.",
      false,
    );
  }
  const parsed = parseDispatchSubmitRequest(body);
  if (!parsed.ok) {
    return dispatchErrorResponse("bad_request", parsed.message, false);
  }
  let submitted: DispatchSubmitRequest = parsed.request;
  const gate = ownerGateStub(env.OWNER_GATES, caller.ownerId);

  if (caller.kind === "user" && hasMobilePairingProofHeaders(request.headers)) {
    const fields = readMobilePairingProofHeaders(request.headers);
    if (!fields) {
      return dispatchErrorResponse(
        "forbidden",
        "This phone credential is incomplete.",
        false,
      );
    }
    let snapshot: OwnerSnapshot;
    try {
      snapshot = await gate.snapshot();
    } catch {
      return dispatchErrorResponse(
        "internal",
        "Stella can't check your pairing right now. Try again shortly.",
        true,
      );
    }
    const pairing = (snapshot.pairedDevices ?? []).find(
      (candidate) =>
        candidate.mobileDeviceId === fields.mobileDeviceId &&
        candidate.desktopDeviceId === fields.desktopDeviceId,
    );
    const payloadHash = await pairingSha256Hex(
      canonicalDispatchPayloadJson(submitted.payload),
    );
    const verified = await verifyMobilePairingProof({
      fields,
      publicKey: pairing?.mobilePublicKey,
      expectedChallenge: buildMobilePairingChallenge({
        idempotencyKey: submitted.idempotencyKey,
        conversationId: submitted.conversationId,
        payloadHash,
        kind: submitted.kind,
        subject: submitted.subject,
        ...(submitted.targetMode !== undefined
          ? { targetMode: submitted.targetMode }
          : {}),
        ...(submitted.targetDeviceId
          ? { targetDeviceId: submitted.targetDeviceId }
          : {}),
      }),
    });
    if (!verified.ok) {
      log("error", "dispatch_pairing_proof_rejected", {
        requestId,
        reason: verified.reason,
      });
      return dispatchErrorResponse(
        "forbidden",
        "This phone credential is invalid.",
        false,
      );
    }
    caller = {
      kind: "mobile",
      ownerId: caller.ownerId,
      mobileDeviceId: verified.mobileDeviceId,
      desktopDeviceId: verified.desktopDeviceId,
    };
    submitted = {
      ...submitted,
      ingress: "mobile",
      requestingDeviceId: verified.mobileDeviceId,
    };
  } else if (
    caller.kind === "user" &&
    submitted.ingress !== "desktop" &&
    submitted.ingress !== "browser" &&
    submitted.ingress !== "mobile"
  ) {
    return dispatchErrorResponse(
      "forbidden",
      `${submitted.ingress} ingress requires service authentication or a paired phone credential.`,
      false,
    );
  }

  if (caller.kind === "user" && submitted.ingress === "mobile") {
    const { requestingDeviceId: _unverifiedDeviceId, ...unpaired } = submitted;
    submitted = unpaired;
  }

  const gateAt = Date.now();
  const preparationMs = Math.round(performance.now() - startedAt);
  let result: Awaited<ReturnType<OwnerGate["submit"]>>;
  try {
    result = await gate.submit({
      request: submitted,
      ...(caller.kind === "service"
        ? { expectedGeneration: caller.ownerGeneration }
        : {}),
      ...(caller.kind === "mobile"
        ? { pairGrantDeviceId: caller.desktopDeviceId }
        : {}),
    });
  } catch (error) {
    log("error", "dispatch_submit_failed", {
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return dispatchErrorResponse(
      "internal",
      "Stella can't place this right now. Try again shortly.",
      true,
    );
  }
  if (!result.ok) {
    return dispatchErrorResponse(
      result.error.code,
      result.error.message,
      result.error.retryable,
      result.error.retryAfterMs,
    );
  }
  log("info", "dispatch_submitted", {
    requestId,
    dispatchId: result.response.dispatch.dispatchId,
    originUserMessageId: submitted.payload.userMessageEventId,
    ingress: submitted.ingress,
    kind: submitted.kind,
    state: result.response.dispatch.state,
    replayed: result.response.replayed,
    receivedAt,
    gateAt,
    authMs,
    preparationMs,
    totalMs: Math.round(performance.now() - startedAt),
  });
  return Response.json(result.response, {
    status: result.response.replayed ? 200 : 201,
    headers: { "cache-control": "no-store" },
  });
};

const handleDispatchControlRoute = async (
  request: Request,
  env: Env,
  dispatchId: string,
  action: "status" | "cancel",
  requestId: string,
): Promise<Response> => {
  let ownerId: string;
  if (await verifyServiceBearerRequestWithAny(request, builderServiceSecrets(env))) {
    ownerId = request.headers.get(TURN_OWNER_ID_HEADER)?.trim() ?? "";
    if (!ownerId || ownerId.length > 512) {
      return dispatchErrorResponse(
        "bad_request",
        `Service callers must send ${TURN_OWNER_ID_HEADER}.`,
        false,
      );
    }
  } else {
    const auth = await authenticateConversationCaller(
      request,
      env,
      false,
      requestId,
    );
    if (!auth.ok) {
      const status = auth.response.status;
      await auth.response.body?.cancel().catch(() => undefined);
      return status === 503
        ? dispatchErrorResponse(
            "internal",
            "Stella couldn't check your sign-in. Try again shortly.",
            true,
          )
        : dispatchErrorResponse("unauthorized", "Sign in to continue.", false);
    }
    ownerId = auth.caller.ownerId;
  }
  const gate = ownerGateStub(env.OWNER_GATES, ownerId);
  try {
    if (action === "status") {
      const status = await gate.dispatchStatus(dispatchId);
      return status.ok
        ? Response.json(status.response, {
            headers: { "cache-control": "no-store" },
          })
        : dispatchErrorResponse(
            status.error.code,
            status.error.message,
            status.error.retryable,
          );
    }
    let raw: { cancelRequestId?: unknown; reason?: unknown } | null = null;
    try {
      raw = JSON.parse(
        await readBoundedRequestText(
          request,
          CLOUD_BUILDER_BODY_LIMITS.tinyControl,
          { requireBody: true },
        ),
      ) as { cancelRequestId?: unknown; reason?: unknown };
    } catch (error) {
      const status = boundedBodyStatus(error);
      return dispatchErrorResponse(
        "bad_request",
        status === 413
          ? "Request body is too large."
          : "Malformed JSON request.",
        false,
      );
    }
    const cancelRequestId =
      typeof raw?.cancelRequestId === "string"
        ? raw.cancelRequestId.trim()
        : "";
    if (!cancelRequestId || cancelRequestId.length > 128) {
      return dispatchErrorResponse(
        "bad_request",
        "cancelRequestId is required.",
        false,
      );
    }
    const canceled = await gate.cancelDispatch({
      dispatchId,
      cancelRequestId,
      ...(typeof raw?.reason === "string" && raw.reason.trim()
        ? { reason: raw.reason.trim() }
        : {}),
    });
    return canceled.ok
      ? Response.json(canceled.response, {
          headers: { "cache-control": "no-store" },
        })
      : dispatchErrorResponse(
          canceled.error.code,
          canceled.error.message,
          canceled.error.retryable,
        );
  } catch (error) {
    log("error", "dispatch_control_failed", {
      requestId,
      action,
      message: error instanceof Error ? error.message : String(error),
    });
    return dispatchErrorResponse(
      "internal",
      "Stella can't reach this dispatch right now. Try again shortly.",
      true,
    );
  }
};

// ---------------------------------------------------------------------------
// The route table
//
// Hono runs handlers in registration order, and the order below is load
// bearing: every self-authenticating route (user JWT, signed callback, public)
// is registered before the service-secret gate, and every server-to-server
// route after it. A request that matches nothing above the gate is answered
// 401 unless it carries the service secret, so an unknown path never reveals
// whether it exists.
// ---------------------------------------------------------------------------

type RouterEnv = {
  Bindings: Env;
  Variables: { requestId: string; caller: ConversationCaller };
};

type SubRouter = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<Response | null | undefined>;

const mount = (handle: SubRouter): MiddlewareHandler<RouterEnv> =>
  async (c, next) => {
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => c.executionCtx.waitUntil(promise),
      passThroughOnException: () => c.executionCtx.passThroughOnException(),
    } as ExecutionContext;
    const response = await handle(c.req.raw, c.env, ctx);
    if (response) return response;
    await next();
  };

const userAuth = (
  { socket }: { socket?: "conversation" | "presence" } = {},
): MiddlewareHandler<RouterEnv> =>
  async (c, next) => {
    const auth = await authenticateConversationCaller(
      c.req.raw,
      c.env,
      socket !== undefined,
      c.var.requestId,
      socket === "conversation"
        ? { purpose: "conversation", resource: c.req.param("id") ?? "" }
        : socket === "presence"
          ? { purpose: "presence", resource: c.req.param("deviceId") ?? "" }
          : undefined,
    );
    if (!auth.ok) return auth.response;
    c.set("caller", auth.caller);
    await next();
  };

const jsonBody = (maxBytes: number): MiddlewareHandler<RouterEnv> =>
  async (c, next) => {
    const bounded = await boundedIngressRequest(c.req.raw, maxBytes);
    if (bounded instanceof Response) return bounded;
    c.req.raw = bounded;
    await next();
  };

const socketOnly: MiddlewareHandler<RouterEnv> = async (c, next) => {
  if (c.req.method !== "GET" || !isWebSocketUpgrade(c.req.raw)) {
    return json({ error: "This endpoint speaks WebSocket only." }, 426);
  }
  await next();
};

const methodNotAllowed = (message = "Method not allowed.") => () =>
  json({ error: message }, 405);

const serviceSecret: MiddlewareHandler<RouterEnv> = async (c, next) => {
  if (!(await verifyServiceBearerRequestWithAny(c.req.raw, builderServiceSecrets(c.env)))) {
    return json({ error: "Unauthorized." }, 401);
  }
  await next();
};

const forwardBody = async (
  stub: { fetch(url: string, init: RequestInit): Promise<Response> },
  url: string,
  request: Request,
  headers: Record<string, string> = {},
): Promise<Response> =>
  await stub.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: await request.text(),
  });

const WORLD_KEY = "[0-9a-f]{64}:[0-9a-f]{64}";
const APP_SLUG = "[a-z][a-z0-9-]{0,31}";
const BROKER_SESSION_ID = "(?:[A-Za-z0-9._~-]|%3[Aa]){1,160}";
const { tinyControl } = CLOUD_BUILDER_BODY_LIMITS;

const app = new Hono<RouterEnv>();

app.use(async (c, next) => {
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  const startedAt = Date.now();
  try {
    await next();
  } finally {
    log(c.res.status >= 500 ? "error" : "info", "request", {
      requestId,
      method: c.req.method,
      path: c.req.path.startsWith("/workspace-apps/")
        ? "/workspace-apps/[session]"
        : new URL(c.req.url).pathname,
      status: c.res.status,
      ms: Date.now() - startedAt,
    });
  }
});

app.get("/healthz", () => json({ ok: true, service: "stella-v2-cloud-builder" }));
app.get("/version", (c) => {
  const env = c.env as unknown as Record<string, unknown>;
  const metadata = env.CF_VERSION_METADATA as
    | { id?: string; tag?: string; timestamp?: string }
    | undefined;
  const commit =
    typeof env.STELLA_BUILD_COMMIT === "string" ? env.STELLA_BUILD_COMMIT : null;
  return json({
    service: "stella-v2-cloud-builder",
    versionId: metadata?.id ?? null,
    versionTag: metadata?.tag ?? null,
    deployedAt: metadata?.timestamp ?? null,
    commit,
    source: "https://github.com/1missthesun/stella-v2",
    ...(commit
      ? { commitUrl: `https://github.com/1missthesun/stella-v2/commit/${commit}` }
      : {}),
  });
});
app.get("/readyz", (c) => {
  const readiness = evaluateCloudBuilderReadiness(c.env);
  return json(
    {
      ok: readiness.ready,
      service: "stella-v2-cloud-builder",
      checks: { missing: readiness.missing, invalid: readiness.invalid },
    },
    readiness.ready ? 200 : 503,
  );
});
app.get(STELLA_PROMPTS_PATH, (c) => stellaPromptsResponse(c.req.raw));
app.get("/.well-known/stella", async (c) => {
  const { discoveryRoute } = await import("../selfhost/discovery.js");
  return await discoveryRoute(c.env as unknown as Cloudflare.Env);
});
app.all("/api/r2/:rest{.*}", async (c) => {
  const { handleR2ProxyRoute } = await import("../r2-proxy.js");
  return (await handleR2ProxyRoute(c.req.raw, c.env)) ?? json({ error: "Not found." }, 404);
});
app.all("/api/auth/device-pairing/:name", async (c) => {
  const { handleDevicePairingRoute } = await import("../selfhost/pairing.js");
  return await handleDevicePairingRoute(c.req.raw, c.env as unknown as Cloudflare.Env);
});
app.all("/api/auth/:rest{.*}", async (c) => {
  const { handleAuthRoute } = await import("../auth/routes.js");
  return await handleAuthRoute(c.req.raw, c.env);
});

app.all(`/internal/worlds/:world{${WORLD_KEY}}/:op{export|changes|push}`, (c) => {
  const op = c.req.param("op") as "export" | "changes" | "push";
  return handleWorldRoute(c.req.raw, c.env, c.req.param("world"), { kind: op });
});
app.all(`/internal/worlds/:world{${WORLD_KEY}}/blob/:sha256{[0-9a-f]{64}}`, (c) =>
  handleWorldRoute(c.req.raw, c.env, c.req.param("world"), {
    kind: "blob",
    sha256: c.req.param("sha256"),
  }),
);

app.all("/workspace-apps/:rest{.*}", (c) => serveWorkspaceApp(c.req.raw, c.env));

// ── User-authenticated ────────────────────────────────────────────────────
// A signed-in user presents a user JWT, not the shared secret. Each route
// verifies it and forwards the proven identity to the DO in x-stella-*
// headers, stripping whatever the client sent under those names first.

const listOwnerApps = async (env: Env, ownerId: string) => {
  const world = env.WORLDS.getByName(await worldName(ownerId));
  await ownerAccess(env, ownerId);
  const apps = released(await world.listWorkspaceApps());
  return { world, apps };
};
app.get("/owners/me/apps", userAuth(), async (c) => {
  const { apps } = await listOwnerApps(c.env, c.var.caller.ownerId);
  return json({ apps });
});
app.all("/owners/me/apps", methodNotAllowed("Method not allowed"));
app.post(`/owners/me/apps/:slug{${APP_SLUG}}/session`, userAuth(), async (c) => {
  const { ownerId } = c.var.caller;
  const slug = c.req.param("slug");
  const { apps } = await listOwnerApps(c.env, ownerId);
  if (!apps.some((app) => app.slug === slug && app.status === "ready"))
    return json({ error: "App not found" }, 404);
  return json(await mintWorkspaceAppAccess(c.env, ownerId, slug));
});
app.all(`/owners/me/apps/:slug{${APP_SLUG}}/session`, methodNotAllowed("Method not allowed"));
app.get(`/owners/me/apps/:slug{${APP_SLUG}}/preview`, userAuth(), async (c) => {
  const { ownerId } = c.var.caller;
  const slug = c.req.param("slug");
  const { world, apps } = await listOwnerApps(c.env, ownerId);
  const app = apps.find((entry) => entry.slug === slug && entry.status === "ready");
  if (!app) return json({ error: "App not found" }, 404);
  return await serveWorkspaceAppPreview(c.env, ownerId, app, world);
});
app.all(`/owners/me/apps/:slug{${APP_SLUG}}/preview`, methodNotAllowed("Method not allowed"));

app.use(mount(handleBackendRoute));
app.use(mount(handleStellaModelsRoute));
app.use(mount(handlePreviewSessionCapabilityRoute));
app.use(mount(handleMediaRoute));
app.use(mount(handleMapsRoute));
app.use(mount(handleDictationTranscribeRoute));
app.use(mount(handleProjectsRoute));
app.use(mount(handleAppSourceBootstrap));
app.use(mount(handleAppSourceReleases));
app.use(
  mount((request, env, ctx) =>
    handleWebRendererRoute(request, env, (promise) => ctx.waitUntil(promise)),
  ),
);
app.use(mount(handleBillingRoute));
app.use(mount(handleAdminRoute));
app.use(mount(handleDevicesRoute));
app.use(mount(handleUserAsksRoute));
app.use(mount(handleVoiceRoute));
app.use(mount(handleIntegrationsRoute));
app.use(mount(handleSlackRoute));

app.all("/dictation/socket", socketOnly, async (c) => {
  const receivedAt = Date.now();
  const auth = await authenticateConversationCaller(
    c.req.raw,
    c.env,
    true,
    c.var.requestId,
    { purpose: "dictation", resource: "" },
  );
  if (!auth.ok) return auth.response;
  return await handleMuseTranscribeSocket({
    request: c.req.raw,
    env: c.env,
    control: ownerDictationControl(c.env, auth.caller.ownerId),
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
    timing: {
      requestId: c.var.requestId,
      receivedAt,
      authMs: Date.now() - receivedAt,
    },
  });
});
app.all(
  "/owners/me/devices/:deviceId{[A-Za-z0-9._~-]{1,256}}/presence",
  socketOnly,
  userAuth({ socket: "presence" }),
  (c) =>
    forwardToDevicePresence(c.req.raw, c.env, c.req.param("deviceId"), c.var.caller),
);
app.post(
  "/owners/me/devices/:deviceId{[A-Za-z0-9._~-]{1,256}}/requests",
  userAuth(),
  jsonBody(DEVICE_REQUEST_LIMITS.paramsBytes + 1024),
  (c) =>
    handleDeviceRequestRoute(c.req.raw, c.env, c.req.param("deviceId"), c.var.caller),
);
app.get(DEVICES_PATH, userAuth(), async (c) => {
  try {
    return Response.json(
      await ownerGateStub(c.env.OWNER_GATES, c.var.caller.ownerId).devices(),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    log("error", "owner_devices_failed", {
      requestId: c.var.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      {
        protocol: PLACEMENT_PROTOCOL,
        error: "Stella can't list your computers right now.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
});

// Placement and turn starts accept the service secret as well as a user JWT,
// so they authenticate inside their handlers and sit above the gate.
app.post(DISPATCH_SUBMIT_PATH, (c) =>
  handleDispatchSubmitRoute(c.req.raw, c.env, c.var.requestId),
);
const DISPATCH_ID = "[A-Za-z0-9._:~%-]{1,96}";
app.get(`${DISPATCH_SUBMIT_PATH}/:dispatchId{${DISPATCH_ID}}`, (c) =>
  handleDispatchControlRoute(c.req.raw, c.env, c.req.param("dispatchId"), "status", c.var.requestId),
);
app.post(`${DISPATCH_SUBMIT_PATH}/:dispatchId{${DISPATCH_ID}}/cancel`, (c) =>
  handleDispatchControlRoute(c.req.raw, c.env, c.req.param("dispatchId"), "cancel", c.var.requestId),
);
app.all(`${DISPATCH_SUBMIT_PATH}/:dispatchId{${DISPATCH_ID}}`, methodNotAllowed());
app.all(`${DISPATCH_SUBMIT_PATH}/:dispatchId{${DISPATCH_ID}}/cancel`, methodNotAllowed());

app.post(SOCKET_TICKET_PATH, userAuth(), jsonBody(1024), async (c) => {
  const body = (await c.req.raw.json().catch(() => null)) as {
    purpose?: unknown;
    resource?: unknown;
  } | null;
  const purpose = body?.purpose;
  const resource = body?.resource ?? "";
  if (
    !isSocketTicketPurpose(purpose) ||
    !isSocketTicketResource(resource) ||
    ((purpose === "conversation" || purpose === "presence") && !resource) ||
    ((purpose === "live" || purpose === "dictation") && resource)
  ) {
    return json({ error: "Invalid socket ticket request." }, 400);
  }
  const issued = await issueSocketTicket({
    secret: builderServiceSecret(c.env),
    token: c.var.caller,
    purpose,
    resource,
    now: Date.now(),
  });
  return new Response(JSON.stringify(issued), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});
app.all(SOCKET_TICKET_PATH, methodNotAllowed());

app.all("/conversations/:id/socket", socketOnly, userAuth({ socket: "conversation" }), async (c) => {
  const conversationId = c.req.param("id");
  const requestId = c.var.requestId;
  const startedAt = Date.now();
  log("info", "conversation_socket_forwarding", { requestId, conversationId });
  try {
    return await withInfrastructureDeadline(
      forwardToConversation(c.req.raw, c.env, conversationId, "/socket", c.var.caller),
      SOCKET_HANDOFF_TIMEOUT_MS,
      "conversation socket hand-off timed out",
    );
  } catch (error) {
    log("error", "conversation_socket_forward_failed", {
      requestId,
      conversationId,
      ms: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    return refuseUpgrade(
      c.req.raw,
      CLOSE_INTERNAL,
      "Stella couldn't open this conversation. Try again.",
      { retryable: true, ref: requestId },
    );
  }
});
app.post("/conversations/:id/turns", (c) =>
  handleTurnStartRoute(c.req.raw, c.env, c.req.param("id"), c.var.requestId),
);
app.get("/conversations/:id/history", userAuth(), (c) =>
  forwardToConversation(c.req.raw, c.env, c.req.param("id"), "/history", c.var.caller),
);
app.post("/conversations/:id/history/query", userAuth(), jsonBody(tinyControl), (c) =>
  forwardToConversation(c.req.raw, c.env, c.req.param("id"), "/history/query", c.var.caller),
);
app.post(
  `/conversations/:id${JOURNAL_CHECKPOINT_PATH}`,
  userAuth(),
  jsonBody(JOURNAL_CHECKPOINT_SUMMARY_MAX_BYTES + 4096),
  (c) => forwardToConversation(c.req.raw, c.env, c.req.param("id"), JOURNAL_CHECKPOINT_PATH, c.var.caller),
);
app.get("/conversations/:id/pi-brain", userAuth(), (c) =>
  forwardToConversation(c.req.raw, c.env, c.req.param("id"), "/pi-brain", c.var.caller),
);
app.post("/conversations/:id/pi-brain", userAuth(), jsonBody(tinyControl), (c) =>
  forwardToConversation(c.req.raw, c.env, c.req.param("id"), "/pi-brain", c.var.caller),
);
app.post("/conversations/:id/prewarm", userAuth(), jsonBody(tinyControl), (c) =>
  forwardToConversation(c.req.raw, c.env, c.req.param("id"), "/prewarm", c.var.caller),
);
app.post(
  "/conversations/:id/journal",
  userAuth(),
  jsonBody(CLOUD_BUILDER_BODY_LIMITS.conversationAppend),
  (c) => forwardToConversation(c.req.raw, c.env, c.req.param("id"), "/journal", c.var.caller),
);
const localTurn = (operation: "begin" | "finish" | "tool", maxBytes: number) => {
  app.post(`/conversations/:id/local-turns/${operation}`, async (c) => {
    const timingStartedAt = performance.now();
    const auth = await authenticateConversationCaller(
      c.req.raw,
      c.env,
      false,
      c.var.requestId,
    );
    if (!auth.ok) return auth.response;
    const authMs = Math.round(performance.now() - timingStartedAt);
    const bounded = await boundedIngressRequest(c.req.raw, maxBytes);
    if (bounded instanceof Response) return bounded;
    const forwardStartedAt = performance.now();
    const response = await forwardToConversation(
      bounded,
      c.env,
      c.req.param("id"),
      `/local-turns/${operation}`,
      auth.caller,
    );
    log("info", "conversation_local_turn_request_timing", {
      requestId: c.var.requestId,
      operation,
      status: response.status,
      authMs,
      durableObjectMs: Math.round(performance.now() - forwardStartedAt),
      totalMs: Math.round(performance.now() - timingStartedAt),
    });
    return response;
  });
};
localTurn("begin", CLOUD_BUILDER_BODY_LIMITS.localTurnBegin);
localTurn("finish", CLOUD_BUILDER_BODY_LIMITS.localTurnFinish);
localTurn("tool", CLOUD_BUILDER_BODY_LIMITS.tinyControl);

app.all("/cloud-home/:rest{.*}", userAuth(), async (c, next) => {
  const response = await handleUserCloudHomeRoute({
    request: c.req.raw,
    env: c.env,
    ownerId: c.var.caller.ownerId,
    withLease: cloudHomeLeaseRunner(c.env),
  });
  if (response) return response;
  await next();
});

// Sandbox-originated broker calls authenticate with their one-time capability
// inside the exact BuildSession. They intentionally sit above the
// service-secret gate; no other route shares this exception.
app.all(`/sessions/:sessionId{${BROKER_SESSION_ID}}/turn-broker`, async (c) => {
  const brokerSessionId = c.req.param("sessionId");
  const request = c.req.raw;
  const piConversation = /^pi(?::|%3[Aa])([A-Za-z0-9._~-]{1,128})$/u.exec(brokerSessionId)?.[1];
  const response = piConversation
    ? await c.env.ORCHESTRATOR_SESSIONS.getByName(piConversation).fetch(
        new Request("https://orchestrator-session/pi-turn-broker", request),
      )
    : await c.env.BUILD_SESSIONS.getByName(brokerSessionId).fetch(
        new Request("https://build-session/turn-broker", request),
      );
  if (devAcceptanceProbesEnabled(c.env)) {
    const diagnosticTarget = validateTurnBrokerTarget(
      request.headers.get(TURN_BROKER_HEADERS.targetMethod),
      request.headers.get(TURN_BROKER_HEADERS.targetPath),
    );
    log("info", "turn_broker_public_response", {
      threadId: brokerSessionId,
      targetKind: diagnosticTarget?.kind ?? "rejected",
      status: response.status,
    });
  }
  return response;
});

// ── Service-secret gate ───────────────────────────────────────────────────
// Everything past this point is server-to-server. Nothing may be registered
// below it without the gate in front.

app.use(serviceSecret);

app.post("/conversations/:id/cancel", jsonBody(tinyControl), (c) =>
  forwardBody(
    c.env.ORCHESTRATOR_SESSIONS.getByName(c.req.param("id")),
    "https://orchestrator-session/cancel",
    c.req.raw,
  ),
);
app.get("/conversations/:id/journal", (c) => {
  const probe = new URL("https://orchestrator-session/journal");
  probe.search = new URL(c.req.url).search;
  return c.env.ORCHESTRATOR_SESSIONS.getByName(c.req.param("id")).fetch(
    probe.toString(),
    { method: "GET" },
  );
});
app.post("/sessions/:sessionId/cancel", jsonBody(tinyControl), (c) =>
  forwardBody(
    c.env.BUILD_SESSIONS.getByName(c.req.param("sessionId")),
    "https://build-session/cancel",
    c.req.raw,
  ),
);
app.post("/sessions/:sessionId/expire", jsonBody(tinyControl), (c) =>
  forwardBody(
    c.env.BUILD_SESSIONS.getByName(c.req.param("sessionId")),
    "https://build-session/expire-agent-turn",
    c.req.raw,
  ),
);
app.post("/internal/sandboxes/retire", jsonBody(tinyControl), (c) =>
  retireSandboxInstance(c.env, c.req.raw),
);

app.notFound(() => json({ error: "Not found." }, 404));
app.onError((error) => {
  throw error;
});

export const worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return withBrowserCors(
      request,
      async () => withSecurityHeaders(request, await app.fetch(request, env, ctx)),
      env,
    );
  },
  async scheduled(controller, env, ctx) {
    const { runScheduled } = await import("../cron.js");
    await runScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<Env>;
