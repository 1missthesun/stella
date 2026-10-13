/**
 * Client for the worker's CLI bridge UDS. The node_repl `connect` client
 * (via `connect-service.ts`) dials it when an MCP/REST call fails with
 * auth, the host asks the user with a secure input card in the calling
 * chat, persists the token, and we get `{ ok: true }` back so
 * the caller can retry the original operation. Backend Composio actions
 * are brokered through the same socket (`connector.runBackendAction`),
 * and the `stella-computer` daemon-spawn RPC rides it too.
 *
 * Wire protocol mirrors `runtime/worker/cli-bridge-server.ts`: one
 * connection = one line of JSON request, one line of JSON response,
 * server closes. Keeps the dependency surface small (no shared RPC
 * client framework needed) and avoids holding a long-lived socket
 * open across the credential card.
 */

import { connect, type Socket } from "node:net";
import { z } from "zod";

import { forkTimeoutFiber } from "./effect-runtime.js";
import { parseCliBridgeEndpoint } from "./cli-bridge-endpoint.js";
import type { ConnectorTokenPayload } from "./oauth.js";
import type {
  MediaHttpResult,
  MediaOperation,
} from "../cli/media-request.js";
import type {
  XApiHttpResult,
  XApiOperation,
} from "../cli/x-api-request.js";

/**
 * Shape of the worker→host connector token-store RPC (owner-only local
 * IPC; see `setConnectorTokenStoreBroker` wiring in `worker/server.ts`).
 * Not a CLI-bridge method.
 */
export type ConnectorTokenStoreRequest =
  | { operation: "load"; tokenKey: string }
  | { operation: "save"; tokenKey: string; payload: ConnectorTokenPayload }
  | { operation: "delete"; tokenKeys: string[] };

export type ConnectorTokenStoreResult =
  | { ok: true; payload?: ConnectorTokenPayload | null }
  | { ok: false; reason: string };

export type ConnectorCredentialResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "timeout" | "unsupported" | string };

export type BackendConnectorActionResult =
  | { ok: true; result: unknown }
  | {
      ok: false;
      reason:
        | "not_signed_in"
        | "auth_expired"
        | "connector_unavailable"
        | "action_not_allowed"
        | "backend_error"
        | "bridge_unavailable"
        | string;
      status?: number;
      message?: string;
      requestId?: string;
    };

export type BackendConnectorCatalogAction = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type BackendConnectorActionsResult =
  | {
      ok: true;
      actionCount: number;
      actions: BackendConnectorCatalogAction[];
      nextCursor: string | null;
    }
  | {
      ok: false;
      reason: string;
      status?: number;
      message?: string;
    };

export type DesktopPermissionRequestResult =
  | { ok: true; granted: boolean; alreadyGranted: boolean }
  | { ok: false; reason: string };

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
let nextRequestId = 1;

const spawnSuccessSchema = z.looseObject({
  ok: z.literal(true),
  pid: z.number(),
  hostPid: z.number(),
});

const isSpawnSuccess = (
  value: unknown,
): value is z.infer<typeof spawnSuccessSchema> =>
  spawnSuccessSchema.safeParse(value).success;

const permissionSuccessSchema = z.looseObject({
  ok: z.literal(true),
  granted: z.boolean(),
  alreadyGranted: z.boolean(),
});

const isPermissionSuccess = (
  value: unknown,
): value is z.infer<typeof permissionSuccessSchema> =>
  permissionSuccessSchema.safeParse(value).success;

const sendRequest = (
  socketPath: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const id = nextRequestId++;
    let buffer = "";
    let settled = false;

    const endpoint = parseCliBridgeEndpoint(socketPath);
    const socket: Socket = connect(endpoint.path);
    // Effect timer fiber instead of setTimeout; the cancel thunk below is
    // the old clearTimeout.
    const cancelTimeout = forkTimeoutFiber(timeoutMs, () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`cli-bridge: timed out after ${timeoutMs}ms`));
    });

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      socket.destroy();
      reject(error);
    };

    socket.setEncoding("utf-8");
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          id,
          method,
          params,
          ...(endpoint.token ? { auth: endpoint.token } : {}),
        })}\n`,
      );
    });
    socket.on("data", (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) return;
      const line = buffer.slice(0, newlineIndex);
      try {
        const message = JSON.parse(line) as
          | { id: string | number; result: unknown }
          | { id: string | number; error: { message: string } };
        if ("error" in message) {
          fail(
            new Error(message.error?.message ?? "cli-bridge: handler error"),
          );
          return;
        }
        if (settled) return;
        settled = true;
        cancelTimeout();
        socket.end();
        resolve(message.result);
      } catch (error) {
        fail(
          new Error(
            `cli-bridge: invalid response (${(error as Error).message})`,
          ),
        );
      }
    });
    socket.on("error", (error) => fail(error));
    socket.on("close", () => {
      if (settled) return;
      // Closed before any response arrived.
      fail(new Error("cli-bridge: connection closed without a response"));
    });
  });

export const requestConnectorCredentialFromBridge = async ({
  socketPath,
  tokenKey,
  displayName,
  authType,
  resourceUrl,
  oauthClientId,
  oauthResource,
  scopes,
  preregisteredOAuth,
  description,
  placeholder,
  caller,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  socketPath: string;
  tokenKey: string;
  displayName: string;
  /** `"oauth"` switches the host to the browser-based flow and requires `resourceUrl`. */
  authType?: "api_key" | "oauth";
  /** MCP server URL used for protected-resource metadata discovery when `authType==="oauth"`. */
  resourceUrl?: string;
  oauthClientId?: string;
  oauthResource?: string;
  scopes?: string[];
  preregisteredOAuth?: {
    clientId: string;
    authorizationEndpoint: string;
    tokenEndpoint?: string;
    responseType?: "code" | "token";
    resourceUrl?: string;
    oauthResource?: string | null;
    callbackUrl?: string;
    callbackId?: string;
    callbackMode?: "local" | "external";
    scopeSeparator?: string;
    usesPkce?: boolean;
    authorizationRedirectParam?: string;
    authorizationParams?: Record<string, string>;
    tokenRedirectParam?: string;
    tokenAuth?: "body" | "basic";
    tokenExchange?: {
      type: "backend";
      provider: string;
    };
  };
  description?: string;
  placeholder?: string;
  /** Who made the call, so the credential card opens in their chat. */
  caller?: { conversationId?: string; agentId?: string; toolCallId?: string };
  timeoutMs?: number;
}): Promise<ConnectorCredentialResult> => {
  const result = await sendRequest(
    socketPath,
    "connector.requestCredential",
    {
      tokenKey,
      displayName,
      authType,
      resourceUrl,
      oauthClientId,
      oauthResource,
      scopes,
      preregisteredOAuth,
      description,
      placeholder,
      ...(caller ? { caller } : {}),
    },
    timeoutMs,
  );
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "invalid_response" };
  }
  const record = result as Record<string, unknown>;
  if (record.ok === true) return { ok: true };
  return {
    ok: false,
    reason:
      typeof record.reason === "string" && record.reason
        ? record.reason
        : "unknown",
  };
};

/** Withdraw the open credential card of a caller whose run stopped. */
export const cancelConnectorCredentialFromBridge = async ({
  socketPath,
  caller,
  timeoutMs = 10_000,
}: {
  socketPath: string;
  caller: { conversationId?: string; toolCallId?: string };
  timeoutMs?: number;
}): Promise<void> => {
  await sendRequest(socketPath, "connector.cancelCredential", { caller }, timeoutMs);
};

export const requestBackendConnectorActionFromBridge = async ({
  socketPath,
  connectorId,
  action,
  input,
  requestId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  socketPath: string;
  connectorId: string;
  action: string;
  input: Record<string, unknown>;
  requestId?: string;
  timeoutMs?: number;
}): Promise<BackendConnectorActionResult> => {
  const result = await sendRequest(
    socketPath,
    "connector.runBackendAction",
    { connectorId, action, input, requestId },
    timeoutMs,
  );
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "invalid_response" };
  }
  const record = result as Record<string, unknown>;
  if (record.ok === true) return { ok: true, result: record.result };
  return {
    ok: false,
    reason:
      typeof record.reason === "string" && record.reason
        ? record.reason
        : "bridge_unavailable",
    ...(typeof record.status === "number" ? { status: record.status } : {}),
    ...(typeof record.message === "string" ? { message: record.message } : {}),
    ...(typeof record.requestId === "string"
      ? { requestId: record.requestId }
      : {}),
  };
};

export const requestBackendConnectorActionsFromBridge = async ({
  socketPath,
  connectorId,
  action,
  query,
  cursor,
  limit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  socketPath: string;
  connectorId: string;
  action?: string;
  query?: string;
  cursor?: string;
  limit?: number;
  timeoutMs?: number;
}): Promise<BackendConnectorActionsResult> => {
  const result = await sendRequest(
    socketPath,
    "connector.listBackendActions",
    { connectorId, action, query, cursor, limit },
    timeoutMs,
  );
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "invalid_response" };
  }
  const record = result as Record<string, unknown>;
  if (record.ok !== true) {
    return {
      ok: false,
      reason:
        typeof record.reason === "string" && record.reason
          ? record.reason
          : "bridge_unavailable",
      ...(typeof record.status === "number" ? { status: record.status } : {}),
      ...(typeof record.message === "string"
        ? { message: record.message }
        : {}),
    };
  }
  if (!Array.isArray(record.actions)) {
    return { ok: false, reason: "invalid_response" };
  }
  const actions = record.actions.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const candidate = value as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name : "";
    if (!/^[A-Z][A-Z0-9_]{1,127}$/u.test(name)) return [];
    const inputSchema =
      candidate.inputSchema &&
      typeof candidate.inputSchema === "object" &&
      !Array.isArray(candidate.inputSchema)
        ? (candidate.inputSchema as Record<string, unknown>)
        : undefined;
    return [
      {
        name,
        ...(typeof candidate.title === "string"
          ? { title: candidate.title }
          : {}),
        ...(typeof candidate.description === "string"
          ? { description: candidate.description }
          : {}),
        ...(inputSchema ? { inputSchema } : {}),
      },
    ];
  });
  return {
    ok: true,
    actionCount:
      typeof record.actionCount === "number" &&
      Number.isSafeInteger(record.actionCount) &&
      record.actionCount >= 0
        ? record.actionCount
        : actions.length,
    actions,
    nextCursor:
      typeof record.nextCursor === "string" ? record.nextCursor : null,
  };
};

export type AutomationDaemonSpawnParams = {
  /** Unix socket path the daemon should listen on. */
  daemonSocketPath: string;
  /** File the daemon writes its pid into once ready. */
  pidPath: string;
  /** File the host appends the daemon's stdout/stderr to. */
  logPath: string;
  sessionId: string;
  stateDir: string;
  /** Extra STELLA_COMPUTER_* env vars to forward to the daemon. */
  env?: Record<string, string>;
};

export type AutomationDaemonSpawnResult =
  | { ok: true; pid: number; hostPid: number }
  | { ok: false; reason: string };

/**
 * Ask the Electron host (via the worker's CLI bridge) to spawn the
 * desktop_automation daemon so macOS attributes its Accessibility (TCC)
 * checks to the live Stella.app process instead of the detached worker's
 * (possibly dead) responsibility chain.
 */
export const requestAutomationDaemonSpawnFromBridge = async ({
  socketPath,
  params,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  socketPath: string;
  params: AutomationDaemonSpawnParams;
  timeoutMs?: number;
}): Promise<AutomationDaemonSpawnResult> => {
  let result: unknown;
  try {
    result = await sendRequest(
      socketPath,
      "computerUse.spawnAutomationDaemon",
      params,
      timeoutMs,
    );
  } catch (error) {
    return {
      ok: false,
      reason: (error as Error).message || "bridge_unavailable",
    };
  }
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "invalid_response" };
  }
  const record = result as Record<string, unknown>;
  if (isSpawnSuccess(record)) {
    return { ok: true, pid: record.pid, hostPid: record.hostPid };
  }
  return {
    ok: false,
    reason:
      typeof record.reason === "string" && record.reason
        ? record.reason
        : "unsupported",
  };
};

/** One `stella-media` call made with the worker's live Stella session. */
export const requestMediaFromBridge = async ({
  socketPath,
  operation,
  deviceId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  socketPath: string;
  operation: MediaOperation;
  deviceId?: string;
  timeoutMs?: number;
}): Promise<MediaHttpResult> => {
  const result = await sendRequest(
    socketPath,
    "media.request",
    { ...operation, ...(deviceId ? { deviceId } : {}) },
    timeoutMs,
  );
  const record =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : null;
  if (!record || typeof record.status !== "number") {
    throw new Error("cli-bridge: invalid media response");
  }
  return { status: record.status, body: record.body };
};

/** One `stella-x-api` call made with the worker's live Stella session. */
export const requestXApiFromBridge = async ({
  socketPath,
  operation,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  socketPath: string;
  operation: XApiOperation;
  timeoutMs?: number;
}): Promise<XApiHttpResult> => {
  const result = await sendRequest(socketPath, "x.request", operation, timeoutMs);
  const record =
    result && typeof result === "object"
      ? (result as Record<string, unknown>)
      : null;
  if (!record || typeof record.status !== "number") {
    throw new Error("cli-bridge: invalid X response");
  }
  return { status: record.status, body: record.body };
};

export const requestDesktopPermissionFromBridge = async ({
  socketPath,
  kind,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  socketPath: string;
  kind: "accessibility" | "screen";
  timeoutMs?: number;
}): Promise<DesktopPermissionRequestResult> => {
  const result = await sendRequest(
    socketPath,
    "system.requestPermission",
    { kind },
    timeoutMs,
  );
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "invalid_response" };
  }
  const record = result as Record<string, unknown>;
  if (isPermissionSuccess(record)) {
    return {
      ok: true,
      granted: record.granted,
      alreadyGranted: record.alreadyGranted,
    };
  }
  return {
    ok: false,
    reason:
      typeof record.reason === "string" && record.reason
        ? record.reason
        : "unavailable",
  };
};

/**
 * One call to the account's MCP server registry (`mcpServers.<op>`) through
 * the worker's live Stella session. Resolves with the call's value; throws
 * with the backend's message (and `reason`, when it gave one).
 */
export class AccountMcpError extends Error {
  constructor(
    message: string,
    readonly reason: string | undefined,
    readonly status: number,
  ) {
    super(message);
    this.name = "AccountMcpError";
  }
}

export const requestAccountMcpFromBridge = async ({
  socketPath,
  op,
  args,
  timeoutMs = 150_000,
}: {
  socketPath: string;
  op: "list" | "put" | "remove" | "call";
  args: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<unknown> => {
  const result = (await sendRequest(
    socketPath,
    "connector.accountMcp",
    { op, args },
    timeoutMs,
  )) as { status?: unknown; body?: unknown } | null;
  const status = typeof result?.status === "number" ? result.status : 0;
  const body =
    result?.body && typeof result.body === "object"
      ? (result.body as Record<string, unknown>)
      : null;
  if (body?.ok === true) return body.value;
  const error =
    body?.error && typeof body.error === "object"
      ? (body.error as Record<string, unknown>)
      : body;
  throw new AccountMcpError(
    typeof error?.message === "string" && error.message
      ? error.message
      : typeof error?.error === "string"
        ? error.error
        : `The account's MCP servers are unavailable (${status}).`,
    typeof error?.reason === "string"
      ? error.reason
      : typeof error?.code === "string"
        ? error.code
        : undefined,
    status,
  );
};
