import { constants as fsConstants, promises as fsPromises } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { forkDelayed } from "./effect-runtime.js";
import { runtimeIpcPathUsesFilesystem } from "@stella/node-shared/worker/runtime-paths.js";
import { maxAutomationSocketPathBytes } from "@stella/node-shared/computer-use/automation-socket-paths.js";
import {
  cliBridgeTokenMatches,
  isUsableCliBridgeToken,
  parseCliBridgeEndpoint,
} from "@stella/node-shared/connectors/cli-bridge-endpoint.js";
import type {
  AutomationDaemonSpawnParams,
  AutomationDaemonSpawnResult,
  BackendConnectorActionResult,
  BackendConnectorActionsResult,
} from "../kernel/connectors/cli-broker-client.js";
import type {
  MediaHttpResult,
  MediaOperation,
} from "../kernel/cli/media-request.js";
import {
  ACCOUNT_MCP_OPS,
  type AccountMcpHttpResult,
  type AccountMcpOperation,
} from "../kernel/cli/account-mcp-request.js";
import type {
  XApiHttpResult,
  XApiOperation,
} from "../kernel/cli/x-api-request.js";

export const maxCliBridgeSocketPathBytes = maxAutomationSocketPathBytes;

const maxWindowsPipeNameChars = 256;

type RequestMessage = {
  id?: string | number;
  method?: string;
  params?: unknown;
  auth?: unknown;
};

type ResponseMessage =
  | { id: string | number; result: unknown }
  | { id: string | number; error: { message: string } };

export type CliBridgeHandlers = {
  requestConnectorCredential: (params: {
    tokenKey: string;
    displayName: string;
    authType?: "api_key" | "oauth";
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
    conversationId?: string;
    agentId?: string;
    toolCallId?: string;
  }) => Promise<
    | { ok: true }
    | { ok: false; reason: "cancelled" | "timeout" | "unsupported" | string }
  >;
  runBackendConnectorAction?: (params: {
    connectorId: string;
    action: string;
    input: Record<string, unknown>;
    requestId?: string;
    account?: string;
    signal?: AbortSignal;
  }) => Promise<BackendConnectorActionResult>;
  listBackendConnections?: (params: {
    signal?: AbortSignal;
  }) => Promise<{ ok: true; connections: unknown[] } | { ok: false; reason: string }>;
  listBackendConnectorActions?: (params: {
    connectorId: string;
    action?: string;
    query?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  }) => Promise<BackendConnectorActionsResult>;
  cancelConnectorCredential?: (params: {
    conversationId?: string;
    toolCallId: string;
  }) => Promise<void>;
  requestDesktopPermission?: (params: {
    kind: "accessibility" | "screen";
  }) =>
    | Promise<
        | { ok: true; granted: boolean; alreadyGranted: boolean }
        | { ok: false; reason: string }
      >
    | { ok: true; granted: boolean; alreadyGranted: boolean }
    | { ok: false; reason: string };
  /**
   * Forwarded to the Electron host so the desktop_automation daemon is
   * spawned by the live app process (single "Stella" TCC identity) instead
   * of the detached worker's process tree.
   */
  spawnAutomationDaemon?: (
    params: AutomationDaemonSpawnParams,
  ) => Promise<AutomationDaemonSpawnResult>;
  requestMedia?: (
    params: MediaOperation & { deviceId?: string; signal?: AbortSignal },
  ) => Promise<MediaHttpResult>;
  requestAccountMcp?: (
    params: AccountMcpOperation & { signal?: AbortSignal },
  ) => Promise<AccountMcpHttpResult>;
  requestXApi?: (
    params: XApiOperation & { signal?: AbortSignal },
  ) => Promise<XApiHttpResult>;
};

export type CliBridgeServer = {
  socketPath: string;
  stop: () => Promise<void>;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasUnrecognizedKeys = (
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean => {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return true;
  }
  return false;
};

const parseTrimmedString = (
  value: unknown,
  options?: { min?: number; max?: number; lower?: boolean },
): string | null => {
  if (typeof value !== "string") return null;
  let out = value.trim();
  if (options?.lower) out = out.toLowerCase();
  if (options?.min !== undefined && out.length < options.min) return null;
  if (options?.max !== undefined && out.length > options.max) return null;
  return out;
};

const parseOptionalTrimmedString = (
  value: unknown,
  options?: { min?: number; max?: number; lower?: boolean },
): { ok: true; value: string | undefined } | { ok: false } => {
  if (value === undefined) return { ok: true, value: undefined };
  const parsed = parseTrimmedString(value, options);
  return parsed === null ? { ok: false } : { ok: true, value: parsed };
};

const RUN_BACKEND_ACTION_KEYS = new Set([
  "connectorId",
  "action",
  "input",
  "requestId",
  "account",
]);

const parseRunBackendActionParams = (
  params: unknown,
):
  | {
      ok: true;
      data: {
        connectorId: string;
        action: string;
        input: Record<string, unknown>;
        requestId?: string;
        account?: string;
      };
    }
  | { ok: false; unrecognizedKeys?: boolean } => {
  if (!isPlainRecord(params)) return { ok: false };
  if (hasUnrecognizedKeys(params, RUN_BACKEND_ACTION_KEYS)) {
    return { ok: false, unrecognizedKeys: true };
  }
  const connectorId = parseTrimmedString(params.connectorId, { min: 1, lower: true });
  const action = parseTrimmedString(params.action, { min: 1 });
  if (!connectorId || !action || !isPlainRecord(params.input)) return { ok: false };
  const account = parseOptionalTrimmedString(params.account, { min: 1, max: 320 });
  if (!account.ok) return { ok: false };
  const requestId = parseTrimmedString(params.requestId, { min: 1 }) ?? undefined;
  return {
    ok: true,
    data: {
      connectorId,
      action,
      input: params.input,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(account.value !== undefined ? { account: account.value } : {}),
    },
  };
};

const LIST_BACKEND_ACTIONS_KEYS = new Set([
  "connectorId",
  "action",
  "query",
  "cursor",
  "limit",
]);

const parseListBackendActionsParams = (
  params: unknown,
): {
  connectorId: string;
  action?: string;
  query?: string;
  cursor?: string;
  limit?: number;
} | null => {
  if (!isPlainRecord(params) || hasUnrecognizedKeys(params, LIST_BACKEND_ACTIONS_KEYS)) {
    return null;
  }
  const connectorId = parseTrimmedString(params.connectorId, { min: 1, lower: true });
  if (!connectorId) return null;
  const action = parseOptionalTrimmedString(params.action, { min: 1 });
  const query = parseOptionalTrimmedString(params.query, { min: 1 });
  const cursor = parseOptionalTrimmedString(params.cursor, { min: 1, max: 256 });
  if (!action.ok || !query.ok || !cursor.ok) return null;
  let limit: number | undefined;
  if (params.limit !== undefined) {
    if (
      typeof params.limit !== "number" ||
      !Number.isInteger(params.limit) ||
      params.limit < 1 ||
      params.limit > 100
    ) {
      return null;
    }
    limit = params.limit;
  }
  return {
    connectorId,
    ...(action.value !== undefined ? { action: action.value } : {}),
    ...(query.value !== undefined ? { query: query.value } : {}),
    ...(cursor.value !== undefined ? { cursor: cursor.value } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
};

const parseRequestPermissionParams = (
  params: unknown,
): { kind: "accessibility" | "screen" } | null => {
  if (!isPlainRecord(params)) return null;
  if (params.kind !== "accessibility" && params.kind !== "screen") return null;
  return { kind: params.kind };
};

const parseSpawnAutomationDaemonParams = (
  params: unknown,
): {
  daemonSocketPath: string;
  pidPath: string;
  logPath: string;
  sessionId: string;
  stateDir: string;
  env?: unknown;
} | null => {
  if (!isPlainRecord(params)) return null;
  const nonEmpty = (value: unknown): string | null =>
    typeof value === "string" && value.length >= 1 ? value : null;
  const daemonSocketPath = nonEmpty(params.daemonSocketPath);
  const pidPath = nonEmpty(params.pidPath);
  const logPath = nonEmpty(params.logPath);
  const sessionId = nonEmpty(params.sessionId);
  const stateDir = nonEmpty(params.stateDir);
  if (!daemonSocketPath || !pidPath || !logPath || !sessionId || !stateDir) {
    return null;
  }
  return {
    daemonSocketPath,
    pidPath,
    logPath,
    sessionId,
    stateDir,
    ...(params.env !== undefined ? { env: params.env } : {}),
  };
};

const MEDIA_MODELS_KEYS = new Set(["op", "deviceId"]);
const MEDIA_JOB_KEYS = new Set(["op", "jobId", "deviceId"]);
const MEDIA_GENERATE_KEYS = new Set(["op", "request", "idempotencyKey", "deviceId"]);

const parseMediaRequestParams = (
  params: unknown,
): (MediaOperation & { deviceId?: string }) | null => {
  if (!isPlainRecord(params)) return null;
  const deviceId = parseOptionalTrimmedString(params.deviceId, { min: 1, max: 128 });
  if (!deviceId.ok) return null;
  if (params.op === "models") {
    if (hasUnrecognizedKeys(params, MEDIA_MODELS_KEYS)) return null;
    return {
      op: "models",
      ...(deviceId.value !== undefined ? { deviceId: deviceId.value } : {}),
    };
  }
  if (params.op === "job") {
    if (hasUnrecognizedKeys(params, MEDIA_JOB_KEYS)) return null;
    const jobId = parseTrimmedString(params.jobId, { min: 1, max: 256 });
    if (!jobId) return null;
    return {
      op: "job",
      jobId,
      ...(deviceId.value !== undefined ? { deviceId: deviceId.value } : {}),
    };
  }
  if (params.op === "generate") {
    if (hasUnrecognizedKeys(params, MEDIA_GENERATE_KEYS)) return null;
    if (typeof params.request !== "string" || params.request.length < 2) return null;
    const idempotencyKey = parseOptionalTrimmedString(params.idempotencyKey, {
      min: 1,
      max: 256,
    });
    if (!idempotencyKey.ok) return null;
    return {
      op: "generate",
      request: params.request,
      ...(idempotencyKey.value !== undefined
        ? { idempotencyKey: idempotencyKey.value }
        : {}),
      ...(deviceId.value !== undefined ? { deviceId: deviceId.value } : {}),
    };
  }
  return null;
};

const X_CONNECT_URL_KEYS = new Set(["op"]);
const X_FINISH_CONNECT_KEYS = new Set(["op", "connectCode"]);
const X_REQUEST_KEYS = new Set(["op", "path", "method", "query", "body"]);
const X_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const parseXApiRequestParams = (params: unknown): XApiOperation | null => {
  if (!isPlainRecord(params)) return null;
  if (params.op === "connectUrl") {
    return hasUnrecognizedKeys(params, X_CONNECT_URL_KEYS) ? null : { op: "connectUrl" };
  }
  if (params.op === "connections") {
    return hasUnrecognizedKeys(params, X_CONNECT_URL_KEYS) ? null : { op: "connections" };
  }
  if (params.op === "finishConnect") {
    if (hasUnrecognizedKeys(params, X_FINISH_CONNECT_KEYS)) return null;
    const connectCode = parseTrimmedString(params.connectCode, { min: 1, max: 64 });
    return connectCode ? { op: "finishConnect", connectCode } : null;
  }
  if (params.op === "request") {
    if (hasUnrecognizedKeys(params, X_REQUEST_KEYS)) return null;
    const reqPath = parseTrimmedString(params.path, { min: 1, max: 2048 });
    if (!reqPath) return null;
    let method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | undefined;
    if (params.method !== undefined) {
      if (typeof params.method !== "string" || !X_HTTP_METHODS.has(params.method)) {
        return null;
      }
      method = params.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    }
    if (params.query !== undefined && !isPlainRecord(params.query)) return null;
    return {
      op: "request",
      path: reqPath,
      ...(method !== undefined ? { method } : {}),
      ...(params.query !== undefined ? { query: params.query } : {}),
      ...(params.body !== undefined ? { body: params.body } : {}),
    };
  }
  return null;
};

const ACCOUNT_MCP_KEYS = new Set(["op", "args"]);
const ACCOUNT_MCP_OP_SET = new Set<string>(ACCOUNT_MCP_OPS);

const parseAccountMcpParams = (params: unknown): AccountMcpOperation | null => {
  if (!isPlainRecord(params) || hasUnrecognizedKeys(params, ACCOUNT_MCP_KEYS)) {
    return null;
  }
  if (typeof params.op !== "string" || !ACCOUNT_MCP_OP_SET.has(params.op)) return null;
  if (!isPlainRecord(params.args)) return null;
  return {
    op: params.op as AccountMcpOperation["op"],
    args: params.args,
  };
};

const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REQUEST_BYTES = 1024 * 1024;

const writeResponse = (socket: Socket, response: ResponseMessage) => {
  if (socket.destroyed) return;
  socket.end(`${JSON.stringify(response)}\n`);
};

const handleConnection = (
  socket: Socket,
  handlers: CliBridgeHandlers,
  log: (message: string, error?: unknown) => void,
  activeSockets: Set<Socket>,
  requiredToken: string | undefined,
) => {
  const connectionAbort = new AbortController();
  activeSockets.add(socket);
  socket.on("close", () => {
    activeSockets.delete(socket);
    connectionAbort.abort("cli_disconnected");
  });

  let buffer = "";
  let resolved = false;
  const timeout = forkDelayed(REQUEST_TIMEOUT_MS, () => {
    if (!resolved) {
      resolved = true;
      writeResponse(socket, {
        id: 0,
        error: { message: "cli-bridge: request timed out before reading line" },
      });
    }
  });

  socket.setEncoding("utf-8");
  socket.on("data", (chunk: string) => {
    if (resolved) return;
    buffer += chunk;
    if (buffer.length > MAX_REQUEST_BYTES) {
      resolved = true;
      timeout.cancel();
      writeResponse(socket, {
        id: 0,
        error: { message: "cli-bridge: request exceeded size limit" },
      });
      return;
    }
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex < 0) return;
    const line = buffer.slice(0, newlineIndex);
    resolved = true;
    timeout.cancel();

    let request: RequestMessage;
    try {
      request = JSON.parse(line) as RequestMessage;
    } catch (error) {
      writeResponse(socket, {
        id: 0,
        error: {
          message: `cli-bridge: invalid JSON (${(error as Error).message})`,
        },
      });
      return;
    }
    const id = request.id ?? 0;
    if (requiredToken && !cliBridgeTokenMatches(requiredToken, request.auth)) {
      writeResponse(socket, {
        id,
        error: { message: "cli-bridge: unauthorized" },
      });
      return;
    }
    const method = request.method;
    if (typeof method !== "string") {
      writeResponse(socket, {
        id,
        error: { message: "cli-bridge: missing method" },
      });
      return;
    }

    void (async () => {
      try {
        const result = await dispatch(
          method,
          request.params,
          handlers,
          connectionAbort.signal,
        );
        writeResponse(socket, { id, result });
      } catch (error) {
        const message = (error as Error).message ?? "cli-bridge: handler threw";
        log(`handler ${method} threw`, error);
        writeResponse(socket, { id, error: { message } });
      }
    })();
  });
  socket.on("error", (error) => {
    log("socket error", error);
  });
};

const dispatch = async (
  method: string,
  params: unknown,
  handlers: CliBridgeHandlers,
  signal?: AbortSignal,
): Promise<unknown> => {
  switch (method) {
    case "connector.runBackendAction": {
      if (!handlers.runBackendConnectorAction) {
        return { ok: false, reason: "unsupported" };
      }
      const parsed = parseRunBackendActionParams(params);
      if (!parsed.ok) {
        if (parsed.unrecognizedKeys) {
          throw new Error(
            "connector.runBackendAction: arbitrary transport fields are not allowed",
          );
        }
        throw new Error(
          "connector.runBackendAction: connectorId, action, and object input are required",
        );
      }
      const { connectorId, action, input, requestId, account } = parsed.data;
      return await handlers.runBackendConnectorAction({
        connectorId,
        action,
        input,
        ...(requestId ? { requestId } : {}),
        ...(account ? { account } : {}),
        ...(signal ? { signal } : {}),
      });
    }
    case "connector.listBackendConnections": {
      if (!handlers.listBackendConnections) {
        return { ok: false, reason: "unsupported" };
      }
      return await handlers.listBackendConnections(signal ? { signal } : {});
    }
    case "connector.listBackendActions": {
      if (!handlers.listBackendConnectorActions) {
        return { ok: false, reason: "unsupported" };
      }
      const parsed = parseListBackendActionsParams(params);
      if (!parsed) {
        throw new Error(
          "connector.listBackendActions: connectorId and valid optional filters are required",
        );
      }
      const { connectorId, action, query, cursor, limit } = parsed;
      return await handlers.listBackendConnectorActions({
        connectorId,
        ...(action ? { action } : {}),
        ...(query ? { query } : {}),
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
        ...(signal ? { signal } : {}),
      });
    }
    case "system.requestPermission": {
      if (!handlers.requestDesktopPermission) {
        return { ok: false, reason: "unsupported" };
      }
      const parsed = parseRequestPermissionParams(params);
      if (!parsed) {
        throw new Error(
          "system.requestPermission: unsupported permission kind",
        );
      }
      return await handlers.requestDesktopPermission(parsed);
    }
    case "computerUse.spawnAutomationDaemon": {
      if (!handlers.spawnAutomationDaemon) {
        return { ok: false, reason: "unsupported" };
      }
      const parsed = parseSpawnAutomationDaemonParams(params);
      if (!parsed) {
        throw new Error(
          "computerUse.spawnAutomationDaemon: daemonSocketPath, pidPath, logPath, sessionId, and stateDir are required",
        );
      }
      const { daemonSocketPath, pidPath, logPath, sessionId, stateDir } = parsed;
      const env =
        parsed.env && typeof parsed.env === "object"
          ? Object.fromEntries(
              Object.entries(parsed.env).filter(
                (entry): entry is [string, string] =>
                  entry[0].startsWith("STELLA_COMPUTER_") &&
                  typeof entry[1] === "string",
              ),
            )
          : undefined;
      return await handlers.spawnAutomationDaemon({
        daemonSocketPath,
        pidPath,
        logPath,
        sessionId,
        stateDir,
        ...(env ? { env } : {}),
      });
    }
    case "media.request": {
      if (!handlers.requestMedia) {
        throw new Error("media.request: unsupported");
      }
      const parsed = parseMediaRequestParams(params);
      if (!parsed) {
        throw new Error("media.request: a valid media operation is required");
      }
      return await handlers.requestMedia({
        ...parsed,
        ...(signal ? { signal } : {}),
      });
    }
    case "connector.accountMcp": {
      if (!handlers.requestAccountMcp) {
        throw new Error("connector.accountMcp: unsupported");
      }
      const parsed = parseAccountMcpParams(params);
      if (!parsed) {
        throw new Error("connector.accountMcp: a valid registry operation is required");
      }
      return await handlers.requestAccountMcp({
        ...parsed,
        ...(signal ? { signal } : {}),
      });
    }
    case "x.request": {
      if (!handlers.requestXApi) {
        throw new Error("x.request: unsupported");
      }
      const parsed = parseXApiRequestParams(params);
      if (!parsed) {
        throw new Error("x.request: a valid X operation is required");
      }
      return await handlers.requestXApi({
        ...parsed,
        ...(signal ? { signal } : {}),
      });
    }
    case "connector.cancelCredential": {
      const request =
        params && typeof params === "object"
          ? (params as Record<string, unknown>)
          : {};
      const caller =
        request.caller && typeof request.caller === "object"
          ? (request.caller as Record<string, unknown>)
          : {};
      const id = (value: unknown) =>
        typeof value === "string" && value.trim() && value.length <= 256
          ? value.trim()
          : undefined;
      const toolCallId = id(caller.toolCallId);
      const conversationId = id(caller.conversationId);
      if (!toolCallId || !handlers.cancelConnectorCredential) return { ok: false };
      await handlers.cancelConnectorCredential({
        toolCallId,
        ...(conversationId ? { conversationId } : {}),
      });
      return { ok: true };
    }
    case "connector.requestCredential": {
      const record =
        params && typeof params === "object"
          ? (params as Record<string, unknown>)
          : {};
      const tokenKey =
        typeof record.tokenKey === "string" ? record.tokenKey.trim() : "";
      if (!tokenKey) {
        throw new Error("connector.requestCredential: tokenKey is required");
      }
      const displayName =
        typeof record.displayName === "string" && record.displayName.trim()
          ? record.displayName.trim()
          : tokenKey;
      const authType =
        record.authType === "oauth" || record.authType === "api_key"
          ? record.authType
          : undefined;
      const resourceUrl =
        typeof record.resourceUrl === "string" && record.resourceUrl.trim()
          ? record.resourceUrl.trim()
          : undefined;
      const oauthClientId =
        typeof record.oauthClientId === "string" && record.oauthClientId.trim()
          ? record.oauthClientId.trim()
          : undefined;
      const oauthResource =
        typeof record.oauthResource === "string" && record.oauthResource.trim()
          ? record.oauthResource.trim()
          : undefined;
      const scopes = Array.isArray(record.scopes)
        ? record.scopes.filter(
            (scope): scope is string => typeof scope === "string",
          )
        : undefined;
      const preregisteredOAuth =
        record.preregisteredOAuth &&
        typeof record.preregisteredOAuth === "object"
          ? (record.preregisteredOAuth as Record<string, unknown>)
          : null;
      const authorizationParams =
        preregisteredOAuth?.authorizationParams &&
        typeof preregisteredOAuth.authorizationParams === "object" &&
        !Array.isArray(preregisteredOAuth.authorizationParams)
          ? Object.fromEntries(
              Object.entries(
                preregisteredOAuth.authorizationParams as Record<
                  string,
                  unknown
                >,
              ).filter(
                (entry): entry is [string, string] =>
                  typeof entry[0] === "string" && typeof entry[1] === "string",
              ),
            )
          : null;
      const normalizedPreregisteredOAuth =
        preregisteredOAuth &&
        typeof preregisteredOAuth.clientId === "string" &&
        preregisteredOAuth.clientId.trim() &&
        typeof preregisteredOAuth.authorizationEndpoint === "string" &&
        preregisteredOAuth.authorizationEndpoint.trim()
          ? {
              clientId: preregisteredOAuth.clientId.trim(),
              authorizationEndpoint:
                preregisteredOAuth.authorizationEndpoint.trim(),
              ...(typeof preregisteredOAuth.tokenEndpoint === "string" &&
              preregisteredOAuth.tokenEndpoint.trim()
                ? { tokenEndpoint: preregisteredOAuth.tokenEndpoint.trim() }
                : {}),
              ...(preregisteredOAuth.responseType === "token"
                ? { responseType: "token" as const }
                : {}),
              ...(typeof preregisteredOAuth.resourceUrl === "string" &&
              preregisteredOAuth.resourceUrl.trim()
                ? { resourceUrl: preregisteredOAuth.resourceUrl.trim() }
                : {}),
              ...(typeof preregisteredOAuth.oauthResource === "string"
                ? { oauthResource: preregisteredOAuth.oauthResource }
                : preregisteredOAuth.oauthResource === null
                  ? { oauthResource: null }
                  : {}),
              ...(typeof preregisteredOAuth.callbackUrl === "string" &&
              preregisteredOAuth.callbackUrl.trim()
                ? { callbackUrl: preregisteredOAuth.callbackUrl.trim() }
                : {}),
              ...(typeof preregisteredOAuth.callbackId === "string" &&
              preregisteredOAuth.callbackId.trim()
                ? { callbackId: preregisteredOAuth.callbackId.trim() }
                : {}),
              ...(preregisteredOAuth.callbackMode === "external"
                ? { callbackMode: "external" as const }
                : preregisteredOAuth.callbackMode === "local"
                  ? { callbackMode: "local" as const }
                  : {}),
              ...(typeof preregisteredOAuth.scopeSeparator === "string"
                ? { scopeSeparator: preregisteredOAuth.scopeSeparator }
                : {}),
              ...(typeof preregisteredOAuth.usesPkce === "boolean"
                ? { usesPkce: preregisteredOAuth.usesPkce }
                : {}),
              ...(typeof preregisteredOAuth.authorizationRedirectParam ===
              "string"
                ? {
                    authorizationRedirectParam:
                      preregisteredOAuth.authorizationRedirectParam,
                  }
                : {}),
              ...(authorizationParams && Object.keys(authorizationParams).length
                ? {
                    authorizationParams,
                  }
                : {}),
              ...(typeof preregisteredOAuth.tokenRedirectParam === "string"
                ? { tokenRedirectParam: preregisteredOAuth.tokenRedirectParam }
                : {}),
              ...(preregisteredOAuth.tokenAuth === "basic"
                ? { tokenAuth: "basic" as const }
                : preregisteredOAuth.tokenAuth === "body"
                  ? { tokenAuth: "body" as const }
                  : {}),
              ...(preregisteredOAuth.tokenExchange &&
              typeof preregisteredOAuth.tokenExchange === "object" &&
              (preregisteredOAuth.tokenExchange as Record<string, unknown>)
                .type === "backend" &&
              typeof (
                preregisteredOAuth.tokenExchange as Record<string, unknown>
              ).provider === "string"
                ? {
                    tokenExchange: {
                      type: "backend" as const,
                      provider: (
                        preregisteredOAuth.tokenExchange as Record<
                          string,
                          string
                        >
                      ).provider,
                    },
                  }
                : {}),
            }
          : undefined;
      if (authType === "oauth" && !resourceUrl) {
        throw new Error(
          "connector.requestCredential: resourceUrl is required for authType=oauth",
        );
      }
      const description =
        typeof record.description === "string" ? record.description : undefined;
      const placeholder =
        typeof record.placeholder === "string" ? record.placeholder : undefined;
      const caller =
        record.caller && typeof record.caller === "object"
          ? (record.caller as Record<string, unknown>)
          : {};
      const callerId = (value: unknown) =>
        typeof value === "string" && value.trim() && value.length <= 256
          ? value.trim()
          : undefined;
      const conversationId = callerId(caller.conversationId);
      const agentId = callerId(caller.agentId);
      const toolCallId = callerId(caller.toolCallId);
      return await handlers.requestConnectorCredential({
        tokenKey,
        displayName,
        authType,
        resourceUrl,
        oauthClientId,
        oauthResource,
        scopes,
        preregisteredOAuth: normalizedPreregisteredOAuth,
        description,
        placeholder,
        ...(conversationId ? { conversationId } : {}),
        ...(agentId ? { agentId } : {}),
        ...(toolCallId ? { toolCallId } : {}),
      });
    }
    default:
      throw new Error(`cli-bridge: unknown method "${method}"`);
  }
};

export const startCliBridgeServer = async ({
  socketPath,
  handlers,
  log = () => {},
}: {
  socketPath: string;
  handlers: CliBridgeHandlers;
  log?: (message: string, error?: unknown) => void;
}): Promise<CliBridgeServer> => {
  const endpoint = parseCliBridgeEndpoint(socketPath);
  const listenPath = endpoint.path;
  const usesFilesystem = runtimeIpcPathUsesFilesystem(listenPath);
  const requiredToken = usesFilesystem ? undefined : endpoint.token;
  if (!usesFilesystem) {
    if (!isUsableCliBridgeToken(requiredToken)) {
      throw new Error(
        "cli-bridge: a named-pipe endpoint needs a per-session token",
      );
    }
    if (listenPath.length > maxWindowsPipeNameChars) {
      throw new Error(
        `cli-bridge: pipe name "${listenPath}" exceeds ${maxWindowsPipeNameChars} characters`,
      );
    }
  }
  const socketPathBytes = Buffer.byteLength(listenPath, "utf8");
  if (usesFilesystem && socketPathBytes > maxCliBridgeSocketPathBytes) {
    throw new Error(
      `cli-bridge: socket path "${listenPath}" is ${socketPathBytes} bytes, ` +
        `exceeding the ${maxCliBridgeSocketPathBytes}-byte ceiling kept under ` +
        "the 104-byte macOS sun_path limit. The runtime IPC root is too long " +
        "to host Unix domain sockets.",
    );
  }
  const socketDir = path.dirname(listenPath);
  if (usesFilesystem) {
    await fsPromises.mkdir(socketDir, { recursive: true, mode: 0o700 });
    const currentUid =
      typeof process.getuid === "function" ? process.getuid() : null;
    const initialDirectoryStat = await fsPromises.lstat(socketDir);
    if (
      initialDirectoryStat.isSymbolicLink() ||
      !initialDirectoryStat.isDirectory() ||
      (currentUid !== null && initialDirectoryStat.uid !== currentUid)
    ) {
      throw new Error(
        "cli-bridge: socket directory is not private and owned by the current user",
      );
    }
    const directoryHandle = await fsPromises.open(
      socketDir,
      fsConstants.O_RDONLY |
        (fsConstants.O_DIRECTORY ?? 0) |
        (fsConstants.O_NOFOLLOW ?? 0),
    );
    let directoryStat;
    try {
      await directoryHandle.chmod(0o700);
      directoryStat = await directoryHandle.stat();
    } finally {
      await directoryHandle.close();
    }
    if (
      !directoryStat.isDirectory() ||
      (currentUid !== null && directoryStat.uid !== currentUid) ||
      (directoryStat.mode & 0o077) !== 0
    ) {
      throw new Error(
        "cli-bridge: socket directory is not private and owned by the current user",
      );
    }
    const staleStat = await fsPromises.lstat(listenPath).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (staleStat) {
      if (
        staleStat.isSymbolicLink() ||
        !staleStat.isSocket() ||
        (currentUid !== null && staleStat.uid !== currentUid)
      ) {
        throw new Error(
          "cli-bridge: refusing to replace an unsafe stale socket path",
        );
      }
      await fsPromises.unlink(listenPath);
    }
  }

  // Track live connections so `stop()` can tear them down rather than
  // waiting indefinitely for an in-flight credential round-trip to
  // complete. An accepted socket whose handler is awaiting the host
  // dialog can otherwise outlive the worker's intended shutdown window
  // (reset/reinit/app quit) because `server.close()` only stops
  // accepting new connections — it does not interrupt existing ones.
  const activeSockets = new Set<Socket>();

  let acceptingRequests = false;
  const server: Server = createServer((socket) => {
    if (!acceptingRequests) {
      socket.destroy();
      return;
    }
    handleConnection(socket, handlers, log, activeSockets, requiredToken);
  });
  server.on("error", (error) => {
    log("server error", error);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(listenPath);
  });

  try {
    if (!usesFilesystem) {
      acceptingRequests = true;
      return {
        socketPath,
        stop: () => stopServer(server, activeSockets),
      };
    }
    await fsPromises.chmod(listenPath, 0o600);
    const socketStat = await fsPromises.lstat(listenPath);
    const currentUid =
      typeof process.getuid === "function" ? process.getuid() : null;
    if (
      socketStat.isSymbolicLink() ||
      !socketStat.isSocket() ||
      (currentUid !== null && socketStat.uid !== currentUid) ||
      (socketStat.mode & 0o177) !== 0
    ) {
      throw new Error("cli-bridge: socket permissions could not be secured");
    }
    acceptingRequests = true;
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (usesFilesystem) {
      await fsPromises.unlink(listenPath).catch(() => undefined);
      await fsPromises.rmdir(socketDir).catch(() => undefined);
    }
    throw error;
  }

  return {
    socketPath,
    stop: () =>
      stopServer(server, activeSockets).then(() => {
        void fsPromises
          .unlink(listenPath)
          .catch(() => undefined)
          .then(() => fsPromises.rmdir(socketDir).catch(() => undefined));
      }),
  };
};

const stopServer = (server: Server, activeSockets: Set<Socket>) =>
  new Promise<void>((resolve) => {
    for (const socket of activeSockets) {
      socket.destroy();
    }
    activeSockets.clear();
    server.close(() => resolve());
  });
