import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import type { Socket } from "node:net";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolRequest,
  type CallToolResult,
  type JSONRPCMessage,
  type ServerNotification,
  type ServerRequest,
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
import {
  forkCancelableInterval,
  forkCancelableTimeout,
} from "./effect-runtime.js";
import { claudeCodePostToolUseHookResponse } from "./claude-code-output-redaction.js";
import { waitsForUser } from "@stella/contracts/long-tool-call";
import {
  CLAUDE_CODE_STELLA_SERVER_NAME,
  legacyClaudeCodeToolAliases,
  LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX,
} from "@stella/contracts/claude-code-tool-names";
import {
  CLAUDE_CODE_MCP_PROGRESS_HEARTBEAT_MS,
  CLAUDE_CODE_STELLA_TOOL_CEILING_MS,
  stellaToolCeilingText,
} from "./claude-code-mcp-timeouts.js";

const HOST = "127.0.0.1";

type CallToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;
const MAX_TOOL_RESULT_CHARS = 80_000;
const MAX_SETTLED_CALL_LEDGER_ENTRIES = 512;
const MAX_HOOK_BODY_BYTES = 32 * 1024 * 1024;

const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
};

type ProgressNotification = {
  method: "notifications/progress";
  params: {
    progressToken: string | number;
    progress: number;
    message: string;
  };
};

/**
 * Progress for one tool call: tool updates as they come, and a heartbeat when
 * nothing else was sent for half the interval. Without a progress token the
 * client asked for no progress, so nothing is sent.
 */
const startCallProgress = (
  progressToken: string | number | undefined,
  send: (notification: ProgressNotification) => Promise<void>,
  heartbeatMs: number,
): { update: (message: string) => void; stop: () => void } => {
  if (progressToken === undefined) {
    return { update: () => undefined, stop: () => undefined };
  }
  const startedAt = Date.now();
  let lastSentAt = startedAt;
  let progress = 0;
  const update = (message: string) => {
    progress += 1;
    lastSentAt = Date.now();
    void send({
      method: "notifications/progress",
      params: { progressToken, progress, message },
    }).catch(() => undefined);
  };
  const stop =
    heartbeatMs > 0
      ? forkCancelableInterval(heartbeatMs, () => {
          if (Date.now() - lastSentAt < heartbeatMs / 2) return;
          update(`Still running (${formatElapsed(Date.now() - startedAt)})`);
        })
      : () => undefined;
  return { update, stop };
};

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

/**
 * Stella's tools on one Claude Code process's own stdin/stdout. The process
 * lists them as an in-process ("sdk") MCP server, so with
 * `CLAUDE_AGENT_SDK_MCP_NO_PREFIX=1` the model sees their plain names.
 */
export type ClaudeCodeToolControlChannel = {
  /**
   * The control request to write first on the process's stdin: it registers
   * Stella's server and maps old prefixed tool names onto the plain ones.
   */
  initializeLine: string;
  /** Takes one stdout event; true when it was this channel's (answer written). */
  handle: (event: Record<string, unknown>) => boolean;
  /** Whether the process on this channel has listed Stella's tools. */
  listed: () => boolean;
  close: () => void;
};

export type ClaudeCodeToolMcpHost = {
  toolCatalogHash: string;
  /** The names Stella's tools carry in Claude Code, in catalog order. */
  claudeToolNames: readonly string[];
  postToolUseHook: { url: string; headers: { Authorization: string } };
  /**
   * Serve this host's tools over a Claude Code process's stdin/stdout.
   * `listed`: the process already listed this exact catalog on an earlier
   * channel (a kept process picked up again). Claude Code lists an SDK
   * server's tools once per process, so it will not list them again, and the
   * host counts its catalog as loaded from the start.
   */
  openControlChannel: (
    write: (line: string) => void,
    options?: { listed?: boolean },
  ) => ClaudeCodeToolControlChannel;
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
  /** Defaults to `CLAUDE_CODE_MCP_PROGRESS_HEARTBEAT_MS`; <= 0 sends none. */
  progressHeartbeatMs?: number;
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
  const progressHeartbeatMs =
    options.progressHeartbeatMs ?? CLAUDE_CODE_MCP_PROGRESS_HEARTBEAT_MS;
  const stellaNames = options.tools.map((tool) => tool.name);
  const tools = options.tools.map((tool) => ({
    // The name the model sees: Stella's own, with no prefix.
    name: tool.name,
    description: tool.description,
    // Claude rejects root combinators. The host still dispatches through
    // Stella's original catalog and execution-side validators.
    inputSchema: normalizeProviderToolInputSchema(tool.parameters),
  }));
  /** Claude Code's name for each tool → Stella's own. */
  const stellaNameOf = new Map<string, string>();
  for (const [index, tool] of tools.entries()) {
    const stellaName = options.tools[index]!.name;
    if (!tool.name || stellaNameOf.has(tool.name)) {
      throw new Error(
        tool.name
          ? `Duplicate Claude Code MCP tool: ${tool.name}`
          : "Claude Code MCP tools must have names",
      );
    }
    stellaNameOf.set(tool.name, stellaName);
    if (tool.inputSchema.type !== "object") {
      throw new Error(
        `Claude Code MCP tool ${tool.name} must have an object JSON schema`,
      );
    }
  }
  /** Stella's name for a call: the plain name, or an old prefixed one. */
  const resolveStellaName = (claudeName: string): string | undefined =>
    stellaNameOf.get(claudeName) ??
    (claudeName.startsWith(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX)
      ? stellaNameOf.get(
          claudeName.slice(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX.length),
        )
      : undefined);

  const catalogHash = crypto
    .createHash("sha256")
    .update(stableJson(tools))
    .digest("hex");
  const bearer = `Bearer ${crypto.randomBytes(32).toString("base64url")}`;
  const hookPath = `/hooks/${crypto.randomBytes(32).toString("base64url")}`;
  const nextCallGeneration = () => new AbortController();
  let callGeneration = nextCallGeneration();
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
        const progress = startCallProgress(
          request.params._meta?.progressToken,
          (notification) => extra.sendNotification(notification),
          progressHeartbeatMs,
        );
        try {
          return await callTool(request, extra, progress.update);
        } finally {
          progress.stop();
        }
      },
    );
  };

  const callTool = async (
    request: CallToolRequest,
    extra: CallToolExtra,
    reportProgress: (message: string) => void,
  ): Promise<CallToolResult> => {
    // `claudeName` is what the model called (and what the native tool_use
    // correlator saw); `toolName` is Stella's own name for the tool.
    const claudeName = request.params.name;
    const toolName = resolveStellaName(claudeName);
    if (!toolName) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Tool is not available in this Stella session: ${claudeName}`,
      );
    }
    const turn = await awaitWithAbort(
      Promise.resolve(options.getActiveTurn()),
      extra.signal,
    );
    const integrityCheck = turn?.checkToolUseIntegrity?.(
      claudeName,
      request.params.arguments ?? {},
      extra.signal,
    );
    const truncation = integrityCheck
      ? await awaitWithAbort(integrityCheck, extra.signal)
      : undefined;
    if (truncation) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Refusing ${claudeName}: your stream ended with ` +
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
      .update(toolName)
      .update("\0")
      .update(stableJson(request.params.arguments ?? {}))
      .digest("hex");
    const claimNativeId =
      turn?.nativeToolCallIds === true && turn.claimNativeToolUseId
        ? turn.claimNativeToolUseId
        : undefined;
    const durableImageGen = toolName === "image_gen" && !claimNativeId;
    const nativeToolUseId =
      durableImageGen && turn?.claimNativeToolUseId
        ? await awaitWithAbort(
            turn.claimNativeToolUseId(
              claudeName,
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
      ? `${durableScope}:${nativeToolUseId}:${toolName}:${canonicalRequestHash}`
      : `${clientSessionId}:${String(extra.requestId)}:${toolName}`;
    const registerDeliveryAcknowledgement = () => {
      if (toolName !== "image_gen") return;
      const acknowledgement = turn?.onToolResponseWritten;
      const delivery = responseDelivery.getStore();
      if (!acknowledgement || !delivery) return;
      delivery.acknowledgements.add(() =>
        acknowledgement({
          toolCallId,
          toolName: toolName,
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

      const ceiling = waitsForUser(toolName)
        ? undefined
        : AbortSignal.timeout(CLAUDE_CODE_STELLA_TOOL_CEILING_MS);
      const callSignal = AbortSignal.any([
        extra.signal,
        callGeneration.signal,
        ...(ceiling ? [ceiling] : []),
      ]);

      const onUpdate: ToolUpdateCallback = (update) => {
        turn.onToolUpdate?.({
          toolCallId,
          toolName: toolName,
          update,
        });
        reportProgress(summarizeUpdate(update));
      };

      try {
        if (claimNativeId) {
          toolCallId = await awaitWithAbort(
            claimNativeId(
              claudeName,
              request.params.arguments ?? {},
              callSignal,
            ),
            callSignal,
          );
        }
        const result = await awaitWithAbort(
          turn.executeTool(
            toolCallId,
            toolName,
            request.params.arguments ?? {},
            callSignal,
            onUpdate,
          ),
          callSignal,
        );
        turn.onToolResult?.({
          toolCallId,
          toolName: toolName,
          result,
        });
        return await awaitWithAbort(
          toolResultToMcp(result, { allowLegacyImagePathReopen }),
          callSignal,
        );
      } catch (error) {
        if (
          ceiling?.aborted &&
          !extra.signal.aborted &&
          !callGeneration.signal.aborted
        ) {
          const text = stellaToolCeilingText(toolName);
          turn.onToolResult?.({
            toolCallId,
            toolName: toolName,
            result: { error: text },
          });
          return { content: [{ type: "text", text }], isError: true };
        }
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
  };

  /** One stdin/stdout channel per Claude Code process. */
  type ControlChannelState = { server: Server; close: () => void };
  const channels = new Set<ControlChannelState>();
  const aliases = legacyClaudeCodeToolAliases(stellaNames);
  const openControlChannel = (
    write: (line: string) => void,
    channelOptions?: { listed?: boolean },
  ): ClaudeCodeToolControlChannel => {
    let listed = channelOptions?.listed === true;
    if (listed) announceClientReady();
    const initializeRequestId = `stella-init-${crypto.randomUUID()}`;
    const initializeLine = JSON.stringify({
      type: "control_request",
      request_id: initializeRequestId,
      request: {
        subtype: "initialize",
        sdkMcpServers: [CLAUDE_CODE_STELLA_SERVER_NAME],
        toolAliases: aliases,
      },
    });
    const server = new Server(
      { name: "stella-claude-code-tools", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    configureMcpServer(server);
    /** The CLI's control request waiting on each JSON-RPC request id. */
    const awaiting = new Map<
      string | number,
      {
        requestId: string;
        delivery: {
          acknowledgements: Set<() => void | Promise<void>>;
          catalogListed: boolean;
        };
      }
    >();
    let closed = false;
    const answer = (requestId: string, mcpResponse: unknown) =>
      write(
        JSON.stringify({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: requestId,
            response: { mcp_response: mcpResponse },
          },
        }),
      );
    const transport: Transport = {
      // Distinct per process: JSON-RPC ids restart at 0 with every CLI, and
      // call identities and the call ledger key on (session, id).
      sessionId: crypto.randomUUID(),
      start: async () => undefined,
      send: async (message: JSONRPCMessage) => {
        if (closed) return;
        if (
          "id" in message &&
          message.id !== undefined &&
          ("result" in message || "error" in message)
        ) {
          const waiting = awaiting.get(message.id);
          if (waiting) {
            awaiting.delete(message.id);
            answer(waiting.requestId, message);
            if (waiting.delivery.catalogListed) {
              listed = true;
              announceClientReady();
            }
            for (const acknowledge of waiting.delivery.acknowledgements) {
              void Promise.resolve(acknowledge()).catch(() => undefined);
            }
            return;
          }
        }
        // Progress notifications (and anything else the server starts) go
        // to the CLI as its own control requests.
        write(
          JSON.stringify({
            type: "control_request",
            request_id: crypto.randomUUID(),
            request: {
              subtype: "mcp_message",
              server_name: CLAUDE_CODE_STELLA_SERVER_NAME,
              message,
            },
          }),
        );
      },
      close: async () => {
        if (closed) return;
        closed = true;
        awaiting.clear();
        transport.onclose?.();
      },
    };
    void server.connect(transport).catch(() => undefined);
    const state: ControlChannelState = {
      server,
      close: () => {
        channels.delete(state);
        void server.close().catch(() => undefined);
      },
    };
    channels.add(state);
    const handle = (event: Record<string, unknown>): boolean => {
      if (event.type === "control_response") {
        const response = event.response as { request_id?: unknown } | undefined;
        return response?.request_id === initializeRequestId;
      }
      if (event.type !== "control_request") return false;
      const request = event.request as
        | { subtype?: unknown; server_name?: unknown; message?: unknown }
        | undefined;
      if (
        request?.subtype !== "mcp_message" ||
        request.server_name !== CLAUDE_CODE_STELLA_SERVER_NAME
      ) {
        return false;
      }
      const requestId =
        typeof event.request_id === "string" ? event.request_id : "";
      const message = request.message as JSONRPCMessage | undefined;
      if (closed || !message || typeof message !== "object") {
        answer(requestId, {
          jsonrpc: "2.0",
          id: (message as { id?: unknown } | undefined)?.id ?? 0,
          error: { code: -32001, message: "Stella's tools are not available." },
        });
        return true;
      }
      if (
        "method" in message &&
        "id" in message &&
        message.id !== null &&
        message.id !== undefined
      ) {
        const delivery = {
          acknowledgements: new Set<() => void | Promise<void>>(),
          catalogListed: false,
        };
        awaiting.set(message.id, { requestId, delivery });
        responseDelivery.run(delivery, () => transport.onmessage?.(message));
        return true;
      }
      // A notification (initialized, cancelled) or a reply: nothing to wait for.
      transport.onmessage?.(message);
      answer(requestId, { jsonrpc: "2.0", result: {}, id: 0 });
      return true;
    };
    return { initializeLine, handle, listed: () => listed, close: state.close };
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
    const answer = await claudeCodePostToolUseHookResponse(body, (name) =>
      resolveStellaName(name) !== undefined || name.startsWith("mcp__"),
    );
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(answer));
  };
  // The loopback HTTP server only answers Claude Code's PostToolUse hook.
  const httpServer = http.createServer((request, response) => {
    if (request.url !== hookPath || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
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
  });
  // Claude Code's fetch reuses idle keep-alive sockets and does not retry a
  // POST the server closed under it (ECONNRESET), so idle sockets stay open
  // until the client closes them.
  httpServer.keepAliveTimeout = 0;
  httpServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  const port = await listen(httpServer);
  const abortActiveCalls = (reason?: unknown) => {
    const ending = callGeneration;
    callGeneration = nextCallGeneration();
    ending.abort(reason);
  };
  const resetClientSessions = async (reason?: unknown) => {
    abortActiveCalls(
      reason ?? new Error("Claude Code MCP client sessions reset"),
    );
    const ending = [...channels];
    catalogListed = false;
    for (const channel of ending) channel.close();
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
    toolCatalogHash: catalogHash,
    claudeToolNames: tools.map((tool) => tool.name),
    postToolUseHook: {
      url: `http://${HOST}:${port}${hookPath}`,
      headers: { Authorization: bearer },
    },
    openControlChannel,
    abortActiveCalls,
    waitForClientReady,
    resetClientSessions,
    close,
  };
};
