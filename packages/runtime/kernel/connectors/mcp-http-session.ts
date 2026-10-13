/**
 * One streamable-HTTP MCP session: `initialize`, then `tools/list` and
 * `tools/call`, over plain `fetch`. Platform-neutral (no Node built-ins), so
 * the desktop's connector bridge and the cloud worker share it. Credentials
 * come from the caller's `authHeaders`; this module never stores any.
 */

import { guardWithAbortTimeout } from "./effect-runtime.js";
import type { ConnectorToolCallResult, ConnectorToolInfo } from "./types.js";

/** Thrown when a connector request comes back with an HTTP auth status
 *  (401/403/407). Lets callers branch
 *  on auth failure vs. real probe errors without parsing message strings. */
export class ConnectorAuthError extends Error {
  readonly kind = "auth_required" as const;
  constructor(
    readonly status: number,
    readonly serverDisplayName: string,
    readonly tokenKey: string | undefined,
    bodyPreview: string,
  ) {
    super(
      `${serverDisplayName} connector request failed (${status}): ${bodyPreview.slice(0, 500)}`,
    );
    this.name = "ConnectorAuthError";
  }
}

const AUTH_STATUSES = new Set([401, 403, 407]);
const REQUEST_TIMEOUT_MS = 60_000;

type RpcMessage = {
  jsonrpc?: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string; code?: number; data?: unknown };
};

const parseSseMessages = (text: string): RpcMessage[] => {
  const messages: RpcMessage[] = [];
  for (const block of text.split(/\n\n+/u)) {
    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      messages.push(JSON.parse(data) as RpcMessage);
    } catch {
      // Ignore malformed non-RPC SSE frames.
    }
  }
  return messages;
};

/**
 * Optional server-provided usage guidance from the MCP `initialize`
 * response (`result.instructions`).
 */
const readInstructions = (result: unknown): string | undefined => {
  const instructions =
    result && typeof result === "object"
      ? (result as { instructions?: unknown }).instructions
      : undefined;
  return typeof instructions === "string" && instructions.trim()
    ? instructions.trim()
    : undefined;
};

export type McpHttpServer = {
  displayName: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: { type?: string; tokenKey?: string };
};

export type McpHttpSessionOptions = {
  /**
   * Headers that carry the server's credential, or `{}` for none. Throw
   * `ConnectorAuthError` when the server needs one that is missing.
   */
  authHeaders: () => Promise<Record<string, string>>;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export class McpHttpSession {
  private sessionId: string | null = null;
  private initialized = false;
  /** From the last successful `initialize` (see {@link readInstructions}). */
  instructions: string | undefined;

  constructor(
    private readonly server: McpHttpServer,
    private readonly options: McpHttpSessionOptions,
  ) {}

  private async headers() {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(this.server.headers ?? {}),
      ...(await this.options.authHeaders()),
    };
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }
    return headers;
  }

  private async post(body: unknown, label: string): Promise<Response> {
    if (!this.server.url) {
      throw new Error(`${this.server.displayName} does not have a URL.`);
    }
    const url = this.server.url;
    const doFetch = this.options.fetch ?? fetch;
    const headers = await this.headers();
    // Seam: fetch needs a real AbortSignal for the guard, so the controller
    // stays (sanctioned ratchet pin); the timer is a scoped Effect fiber
    // interrupted when the request settles.
    const controller = new AbortController();
    return await guardWithAbortTimeout({
      timeoutMs: this.options.timeoutMs ?? REQUEST_TIMEOUT_MS,
      onTimeout: () => controller.abort(),
      run: async () =>
        await doFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
      mapError: (error) =>
        controller.signal.aborted
          ? new Error(`${this.server.displayName} timed out waiting for ${label}.`)
          : error,
    });
  }

  private async request(
    method: string,
    params?: unknown,
    recoverSession = true,
  ): Promise<unknown> {
    const id = crypto.randomUUID();
    const response = await this.post(
      {
        jsonrpc: "2.0",
        id,
        method,
        ...(params === undefined ? {} : { params }),
      },
      method,
    );
    const responseSessionId = response.headers.get("mcp-session-id");
    if (responseSessionId) this.sessionId = responseSessionId;
    const text = await response.text();
    if (!response.ok) {
      if (
        response.status === 404 &&
        recoverSession &&
        this.sessionId &&
        method !== "initialize"
      ) {
        this.sessionId = null;
        this.initialized = false;
        await this.initialize();
        return await this.request(method, params, false);
      }
      if (AUTH_STATUSES.has(response.status)) {
        throw new ConnectorAuthError(
          response.status,
          this.server.displayName,
          this.server.auth?.tokenKey,
          text,
        );
      }
      throw new Error(
        `${this.server.displayName} connector request failed (${response.status}): ${text.slice(0, 500)}`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    let messages: RpcMessage[];
    try {
      messages = contentType.includes("text/event-stream")
        ? parseSseMessages(text)
        : [JSON.parse(text) as RpcMessage];
    } catch {
      throw new Error(
        `${this.server.displayName} sent a response that is not MCP JSON for ${method}.`,
      );
    }
    const message = messages.find((entry) => String(entry.id) === id);
    if (!message) {
      throw new Error(
        `${this.server.displayName} did not return a response for ${method}.`,
      );
    }
    if (message.error) {
      throw new Error(message.error.message ?? `${method} failed.`);
    }
    return message.result;
  }

  private async notify(method: string, params?: unknown) {
    const response = await this.post(
      {
        jsonrpc: "2.0",
        method,
        ...(params === undefined ? {} : { params }),
      },
      method,
    );
    await response.body?.cancel().catch(() => undefined);
  }

  async initialize() {
    if (this.initialized) return;
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stella", version: "0" },
    });
    this.instructions = readInstructions(result) ?? this.instructions;
    await this.notify("notifications/initialized");
    this.initialized = true;
  }

  async listTools(): Promise<ConnectorToolInfo[]> {
    await this.initialize();
    const tools: ConnectorToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = (await this.request(
        "tools/list",
        cursor ? { cursor } : undefined,
      )) as { tools?: unknown[]; nextCursor?: unknown } | undefined;
      if (Array.isArray(result?.tools)) {
        tools.push(...(result.tools as ConnectorToolInfo[]));
      }
      cursor =
        typeof result?.nextCursor === "string" && result.nextCursor
          ? result.nextCursor
          : undefined;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ConnectorToolCallResult> {
    await this.initialize();
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    return result as ConnectorToolCallResult;
  }

  close() {
    this.sessionId = null;
    this.initialized = false;
  }
}

/** The header a stored credential goes in, per the connector's auth scheme. */
export const mcpCredentialHeader = (
  token: string,
  auth: { headerName?: string; scheme?: "bearer" | "basic" | "oauth" | "raw" } | undefined,
): Record<string, string> => {
  const scheme = auth?.scheme ?? "bearer";
  const value =
    scheme === "raw"
      ? token
      : scheme === "basic"
        ? `Basic ${token}`
        : scheme === "oauth"
          ? `OAuth ${token}`
          : `Bearer ${token}`;
  return { [auth?.headerName ?? "authorization"]: value };
};
