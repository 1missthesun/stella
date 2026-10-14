import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import type { Socket } from "node:net";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import type {
  ToolMetadata,
  ToolResult,
  ToolUpdateCallback,
} from "../tools/types.js";
import { TOOL_RESULT_AUTHORIZED_IMAGES } from "../tools/types.js";
import {
  extractAttachImageBlocks,
  neutralizeLegacyAttachImageMarkers,
  prepareAuthorizedToolImageBlocks,
} from "../agent-runtime/tool-adapters.js";
import { normalizeProviderToolInputSchema } from "../tools/provider-tool-schema.js";
import {
  sanitizeToolError,
  sanitizeToolResult,
  sanitizeToolVisibleText,
} from "../tools/safety.js";
import { forkCancelableTimeout } from "./effect-runtime.js";
import { claudeCodePostToolUseHookResponse } from "./claude-code-output-redaction.js";

const HOST = "127.0.0.1";
const MAX_TOOL_RESULT_CHARS = 80_000;
const MAX_SETTLED_CALL_LEDGER_ENTRIES = 512;
const MAX_HOOK_BODY_BYTES = 32 * 1024 * 1024;

export type ClaudeCodeToolMcpActiveTurn = {
  identityScope?: string;
  claimNativeToolUseId?: (
    toolName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<string>;
  nativeToolCallIds?: boolean;
  checkToolUseIntegrity?: (
    toolName: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<{ stopReason: string; explanation?: string } | undefined>;
  executeTool: (
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
  ) => Promise<ToolResult>;
  onToolUpdate?: (args: {
    toolCallId: string;
    toolName: string;
    update: ToolResult;
  }) => void;
  onToolResult?: (args: {
    toolCallId: string;
    toolName: string;
    result: ToolResult;
  }) => void;
  onToolResponseWritten?: (args: {
    toolCallId: string;
    toolName: string;
  }) => void | Promise<void>;
};

export type ClaudeCodeToolMcpHost = {
  url: string;
  authorizationHeader: string;
  toolCatalogHash: string;
  postToolUseHook: { url: string; headers: { Authorization: string } };
  mcpServerConfig: {
    type: "http";
    url: string;
    headers: { Authorization: string };
  };
  abortActiveCalls: (reason?: unknown) => void;
  waitForClientReady: (
    signal?: AbortSignal,
    timeoutMs?: number,
  ) => Promise<void>;
  resetClientSessions: (reason?: unknown) => Promise<void>;
  close: () => Promise<void>;
};

export type CreateClaudeCodeToolMcpHostOptions = {
  tools: readonly ToolMetadata[];
  identityScope?: string;
  allowLegacyImagePathReopen?: boolean;
  getActiveTurn: () =>
    | ClaudeCodeToolMcpActiveTurn
    | undefined
    | Promise<ClaudeCodeToolMcpActiveTurn | undefined>;
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const stringifyUnknown = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const LEADING_ERROR_PREFIX_RE = /^(?:\s*(?:Error:|\[TOOL_ERROR\]))+\s*/;

const toolErrorText = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const bare = message.replace(LEADING_ERROR_PREFIX_RE, "");
  return `Error: ${sanitizeToolError(bare || "The tool failed.")}`;
};

const summarizeUpdate = (update: ToolResult): string => {
  if (update.error) return update.error;
  const text = stringifyUnknown(update.result);
  return text.length > 1_000 ? `${text.slice(0, 1_000)}...` : text;
};

const trimToolResult = (value: string): string =>
  value.length <= MAX_TOOL_RESULT_CHARS
    ? value
    : `${value.slice(0, MAX_TOOL_RESULT_CHARS)}\n...[tool result truncated]`;

const awaitWithAbort = async <T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  if (signal.aborted) {
    throw signal.reason ?? new Error("Tool call aborted");
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() => reject(signal.reason ?? new Error("Tool call aborted")));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    void pending.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
};

const toolResultToMcp = async (
  result: ToolResult,
  options: { allowLegacyImagePathReopen: boolean },
): Promise<CallToolResult> => {
  const rawResult = result.error
    ? ""
    : sanitizeToolVisibleText(
        stringifyUnknown(sanitizeToolResult(result.result)),
      );
  const { text: resolvedResult, images: legacyImages } =
    options.allowLegacyImagePathReopen
      ? await extractAttachImageBlocks(rawResult, { provider: "anthropic" })
      : {
          text: neutralizeLegacyAttachImageMarkers(rawResult),
          images: [],
        };
  const authorizedImages = await prepareAuthorizedToolImageBlocks(
    result[TOOL_RESULT_AUTHORIZED_IMAGES],
    { provider: "anthropic" },
  );
  const text = trimToolResult(
    result.error ? toolErrorText(result.error) : resolvedResult,
  );
  const content: CallToolResult["content"] = [];
  if (text || legacyImages.length + authorizedImages.length === 0) {
    content.push({ type: "text", text });
  }
  for (const image of legacyImages) {
    content.push({
      type: "image",
      data: image.data,
      mimeType: image.mimeType,
    });
  }
  for (const image of authorizedImages) {
    content.push({
      type: "image",
      data: image.data,
      mimeType: image.mimeType,
    });
  }
  return {
    content,
    ...(result.error ? { isError: true } : {}),
  };
};

const unauthorized = (response: http.ServerResponse) => {
  response.writeHead(401, {
    "content-type": "application/json",
    "www-authenticate": "Bearer",
  });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    }),
  );
};

const sameSecret = (actual: string | undefined, expected: string): boolean => {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(actualBytes, expectedBytes)
  );
};

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Claude Code MCP host did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, HOST);
  });

const closeHttpServer = (
  server: http.Server,
  sockets: ReadonlySet<Socket>,
): Promise<void> =>
  new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections?.();
    for (const socket of sockets) socket.destroy();
  });

export const createClaudeCodeToolMcpHost = async (
  options: CreateClaudeCodeToolMcpHostOptions,
): Promise<ClaudeCodeToolMcpHost> => {
  const allowLegacyImagePathReopen =
    options.allowLegacyImagePathReopen !== false;
  const tools = options.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // Claude rejects root combinators. The host still dispatches through
    // Stella's original catalog and execution-side validators.
    inputSchema: normalizeProviderToolInputSchema(tool.parameters),
  }));
  const names = new Set<string>();
  for (const tool of tools) {
    if (!tool.name || names.has(tool.name)) {
      throw new Error(
        tool.name
          ? `Duplicate Claude Code MCP tool: ${tool.name}`
          : "Claude Code MCP tools must have names",
      );
    }
    names.add(tool.name);
    if (tool.inputSchema.type !== "object") {
      throw new Error(
        `Claude Code MCP tool ${tool.name} must have an object JSON schema`,
      );
    }
  }

  const catalogHash = crypto
    .createHash("sha256")
    .update(stableJson(tools))
    .digest("hex");
  const bearer = `Bearer ${crypto.randomBytes(32).toString("base64url")}`;
  const endpointPath = `/mcp/${crypto.randomBytes(32).toString("base64url")}`;
  const hookPath = `/hooks/${crypto.randomBytes(32).toString("base64url")}`;
  let callGeneration = new AbortController();
  const callLedger = new Map<string, Promise<CallToolResult>>();
  const responseDelivery = new AsyncLocalStorage<{
    acknowledgements: Set<() => void | Promise<void>>;
    catalogListed: boolean;
  }>();
  const settledCallLedgerKeys = new Set<string>();
  const clientReadyWaiters = new Set<() => void>();
  let catalogListed = false;
  const announceClientReady = () => {
    catalogListed = true;
    for (const resolve of clientReadyWaiters) resolve();
    clientReadyWaiters.clear();
  };
  const trimCallLedger = () => {
    if (settledCallLedgerKeys.size <= MAX_SETTLED_CALL_LEDGER_ENTRIES) return;
    for (const key of callLedger.keys()) {
      if (!settledCallLedgerKeys.has(key)) continue;
      callLedger.delete(key);
      settledCallLedgerKeys.delete(key);
      if (settledCallLedgerKeys.size <= MAX_SETTLED_CALL_LEDGER_ENTRIES) break;
    }
  };

  const configureMcpServer = (mcpServer: Server) => {
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const delivery = responseDelivery.getStore();
      if (delivery) delivery.catalogListed = true;
      return { tools };
    });
    mcpServer.setRequestHandler(
      CallToolRequestSchema,
      async (request, extra) => {
        if (!names.has(request.params.name)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Tool is not available in this Stella session: ${request.params.name}`,
          );
        }
        const turn = await awaitWithAbort(
          Promise.resolve(options.getActiveTurn()),
          extra.signal,
        );
        const integrityCheck = turn?.checkToolUseIntegrity?.(
          request.params.name,
          request.params.arguments ?? {},
          extra.signal,
        );
        const truncation = integrityCheck
          ? await awaitWithAbort(integrityCheck, extra.signal)
          : undefined;
        if (truncation) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Refusing ${request.params.name}: your stream ended with ` +
              `stop_reason "${truncation.stopReason}" while these arguments ` +
              `were still being written, so they are cut off mid-value and ` +
              `were NOT executed. Reissue the call with complete arguments` +
              `${truncation.explanation ? ` (${truncation.explanation})` : ""}.`,
          );
        }
        const clientSessionId = extra.sessionId ?? "stateless";
        const durableScope = crypto
          .createHash("sha256")
          .update(turn?.identityScope ?? options.identityScope ?? "unscoped")
          .digest("hex")
          .slice(0, 24);
        const canonicalRequestHash = crypto
          .createHash("sha256")
          .update(request.params.name)
          .update("\0")
          .update(stableJson(request.params.arguments ?? {}))
          .digest("hex");
        const claimNativeId =
          turn?.nativeToolCallIds === true && turn.claimNativeToolUseId
            ? turn.claimNativeToolUseId
            : undefined;
        const durableImageGen =
          request.params.name === "image_gen" && !claimNativeId;
        const nativeToolUseId =
          durableImageGen && turn?.claimNativeToolUseId
            ? await awaitWithAbort(
                turn.claimNativeToolUseId(
                  request.params.name,
                  request.params.arguments ?? {},
                  extra.signal,
                ),
                extra.signal,
              )
            : undefined;
        if (durableImageGen && !nativeToolUseId) {
          throw new McpError(
            ErrorCode.InternalError,
            "Claude did not expose a durable tool_use identity for image_gen; refusing an unsafe submission.",
          );
        }
        let toolCallId = nativeToolUseId
          ? `claude:${durableScope}:${nativeToolUseId}:${canonicalRequestHash.slice(0, 24)}`
          : `mcp:${clientSessionId}:${String(extra.requestId)}`;
        const ledgerKey = durableImageGen
          ? `${durableScope}:${nativeToolUseId}:${request.params.name}:${canonicalRequestHash}`
          : `${clientSessionId}:${String(extra.requestId)}:${request.params.name}`;
        const registerDeliveryAcknowledgement = () => {
          if (request.params.name !== "image_gen") return;
          const acknowledgement = turn?.onToolResponseWritten;
          const delivery = responseDelivery.getStore();
          if (!acknowledgement || !delivery) return;
          delivery.acknowledgements.add(() =>
            acknowledgement({
              toolCallId,
              toolName: request.params.name,
            }),
          );
        };
        const previous = callLedger.get(ledgerKey);
        if (previous) {
          const result = await awaitWithAbort(previous, extra.signal);
          registerDeliveryAcknowledgement();
          return result;
        }

        const execution = (async (): Promise<CallToolResult> => {
          if (!turn) {
            return {
              content: [
                {
                  type: "text",
                  text: "No Stella turn is active for this tool call.",
                },
              ],
              isError: true,
            };
          }

          const callSignal = AbortSignal.any([
            extra.signal,
            callGeneration.signal,
          ]);

          let progress = 0;
          const progressToken = request.params._meta?.progressToken;
          const onUpdate: ToolUpdateCallback = (update) => {
            turn.onToolUpdate?.({
              toolCallId,
              toolName: request.params.name,
              update,
            });
            if (progressToken !== undefined) {
              progress += 1;
              void extra
                .sendNotification({
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress,
                    message: summarizeUpdate(update),
                  },
                })
                .catch(() => undefined);
            }
          };

          try {
            if (claimNativeId) {
              toolCallId = await awaitWithAbort(
                claimNativeId(
                  request.params.name,
                  request.params.arguments ?? {},
                  callSignal,
                ),
                callSignal,
              );
            }
            const result = await awaitWithAbort(
              turn.executeTool(
                toolCallId,
                request.params.name,
                request.params.arguments ?? {},
                callSignal,
                onUpdate,
              ),
              callSignal,
            );
            turn.onToolResult?.({
              toolCallId,
              toolName: request.params.name,
              result,
            });
            return await awaitWithAbort(
              toolResultToMcp(result, { allowLegacyImagePathReopen }),
              callSignal,
            );
          } catch (error) {
            if (callSignal.aborted) throw error;
            return {
              content: [
                {
                  type: "text",
                  text: toolErrorText(error),
                },
              ],
              isError: true,
            };
          }
        })();
        callLedger.set(ledgerKey, execution);
        void execution.then(
          () => {
            settledCallLedgerKeys.add(ledgerKey);
            trimCallLedger();
          },
          () => {
            settledCallLedgerKeys.add(ledgerKey);
            trimCallLedger();
          },
        );
        const result = await execution;
        registerDeliveryAcknowledgement();
        return result;
      },
    );
  };

  type McpClientSession = {
    server: Server;
    transport: StreamableHTTPServerTransport;
  };
  const clientSessions = new Map<string, McpClientSession>();
  const pendingSessions = new Set<McpClientSession>();
  const createClientSession = async (): Promise<McpClientSession> => {
    const server = new Server(
      { name: "stella-claude-code-tools", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    configureMcpServer(server);
    const state = {} as McpClientSession;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sessionId) => {
        pendingSessions.delete(state);
        clientSessions.set(sessionId, state);
      },
      onsessionclosed: (sessionId) => {
        clientSessions.delete(sessionId);
      },
    });
    state.server = server;
    state.transport = transport;
    pendingSessions.add(state);
    await server.connect(transport);
    return state;
  };

  const sockets = new Set<Socket>();
  let closed = false;
  const answerHook = async (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > MAX_HOOK_BODY_BYTES) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
        return;
      }
      chunks.push(chunk as Buffer);
    }
    let body: unknown = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      body = null;
    }
    const answer = await claudeCodePostToolUseHookResponse(body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(answer));
  };
  const httpServer = http.createServer((request, response) => {
    if (request.url === hookPath && request.method === "POST") {
      if (!sameSecret(request.headers.authorization, bearer)) {
        unauthorized(response);
        return;
      }
      void answerHook(request, response).catch(() => {
        if (!response.headersSent) {
          response.writeHead(200, { "content-type": "application/json" });
        }
        if (!response.writableEnded) response.end("{}");
      });
      return;
    }
    if (request.url !== endpointPath) {
      response.writeHead(404).end();
      return;
    }
    if (!sameSecret(request.headers.authorization, bearer)) {
      unauthorized(response);
      return;
    }
    const sessionHeader = request.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;
    const handle = async () => {
      let state: McpClientSession | undefined;
      if (sessionId) {
        state = clientSessions.get(sessionId);
        if (!state) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32001, message: "MCP session not found" },
              id: null,
            }),
          );
          return;
        }
      } else {
        state = await createClientSession();
      }
      const delivery = {
        acknowledgements: new Set<() => void | Promise<void>>(),
        catalogListed: false,
      };
      let responseFinished = false;
      response.once("finish", () => {
        responseFinished = true;
        if (delivery.catalogListed) announceClientReady();
        for (const acknowledge of delivery.acknowledgements) {
          void Promise.resolve(acknowledge()).catch(() => undefined);
        }
        delivery.acknowledgements.clear();
      });
      response.once("close", () => {
        if (!responseFinished) delivery.acknowledgements.clear();
      });
      await responseDelivery.run(delivery, () =>
        state.transport.handleRequest(request, response),
      );
      if (!state.transport.sessionId) {
        pendingSessions.delete(state);
        await state.server.close().catch(() => undefined);
      }
    };
    void handle().catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json" });
      }
      if (!response.writableEnded) {
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    });
  });
  httpServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  const port = await listen(httpServer);
  const url = `http://${HOST}:${port}${endpointPath}`;
  const abortActiveCalls = (reason?: unknown) => {
    const ending = callGeneration;
    callGeneration = new AbortController();
    ending.abort(reason);
  };
  const resetClientSessions = async (reason?: unknown) => {
    abortActiveCalls(
      reason ?? new Error("Claude Code MCP client sessions reset"),
    );
    const sessions = [...clientSessions.values(), ...pendingSessions.values()];
    clientSessions.clear();
    pendingSessions.clear();
    catalogListed = false;
    await Promise.allSettled(sessions.map((state) => state.server.close()));
  };
  const waitForClientReady = async (
    signal?: AbortSignal,
    timeoutMs = 10_000,
  ): Promise<void> => {
    if (catalogListed) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const onReady = () => finish();
      const onAbort = () =>
        finish(signal?.reason ?? new Error("Claude MCP startup canceled."));
      const cancelTimer = forkCancelableTimeout(timeoutMs, () =>
        finish(new Error("Claude MCP tool catalog did not initialize.")),
      );
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        cancelTimer();
        signal?.removeEventListener("abort", onAbort);
        clientReadyWaiters.delete(onReady);
        if (error) reject(error);
        else resolve();
      };
      clientReadyWaiters.add(onReady);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else if (catalogListed) onReady();
    });
  };
  const close = async () => {
    if (closed) return;
    closed = true;
    const resetPromise = resetClientSessions(
      new Error("Claude Code MCP host closed"),
    );
    callLedger.clear();
    settledCallLedgerKeys.clear();
    await Promise.allSettled([
      resetPromise,
      closeHttpServer(httpServer, sockets),
    ]);
  };

  return {
    url,
    authorizationHeader: bearer,
    toolCatalogHash: catalogHash,
    postToolUseHook: {
      url: `http://${HOST}:${port}${hookPath}`,
      headers: { Authorization: bearer },
    },
    mcpServerConfig: {
      type: "http",
      url,
      headers: { Authorization: bearer },
    },
    abortActiveCalls,
    waitForClientReady,
    resetClientSessions,
    close,
  };
};
