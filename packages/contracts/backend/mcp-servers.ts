/**
 * Custom MCP servers belong to the account. Each row says what the server is
 * and where it can be reached from:
 *
 * - A remote server (streamable HTTP) that needs no sign-in is called
 *   directly from wherever the caller runs: the cloud or any computer.
 * - A remote server that needs sign-in keeps its credential on the computer
 *   that signed in (Stella's cloud keeps no secrets). Computers sign in on
 *   their own; the cloud reaches it through the computer named in
 *   `deviceId` while that computer is online.
 * - A local (stdio) server runs only on the computer that added it
 *   (`deviceId`). Its command and environment never leave that computer;
 *   everywhere else reaches it through that computer while it is online.
 */

export const MCP_SERVER_ID_PATTERN = /^[a-z0-9._-]{1,64}$/u;

export type McpServerTransport = "streamable_http" | "stdio";

export type McpServerAuth = {
  type: "none" | "oauth" | "api_key";
  tokenKey?: string;
  headerName?: string;
  scheme?: "bearer" | "basic" | "oauth" | "raw";
};

export type McpServerTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type McpServerRecord = {
  id: string;
  name: string;
  description?: string;
  transport: McpServerTransport;
  /** Remote servers only. */
  url?: string;
  auth: McpServerAuth;
  /**
   * The computer that runs it (stdio) or holds its credential (remote with
   * sign-in). Absent for a remote server anyone can call directly.
   */
  deviceId?: string;
  /** The server's tools as last listed, when known. */
  tools?: McpServerTool[];
  toolsUpdatedAt?: number;
  /** The last listing was refused for want of a credential. */
  needsAuth: boolean;
  createdAt: number;
  updatedAt: number;
};

/** Where a server can be reached from, as callers explain it. */
export type McpServerReach =
  | { kind: "anywhere" }
  | { kind: "device"; deviceId: string; reason: "local" | "credential" }
  | { kind: "unreachable"; reason: "needs_sign_in" | "no_device" };

/** A remote URL that only resolves on the computer that added it. */
export const isLocalMcpUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  } catch {
    return false;
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    (!host.includes(".") && !host.includes(":"))
  ) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return (
    host.includes(":") &&
    (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80"))
  );
};

export const mcpServerReach = (
  record: Pick<McpServerRecord, "transport" | "auth" | "deviceId" | "url">,
): McpServerReach => {
  if (record.transport === "stdio" || isLocalMcpUrl(record.url)) {
    return record.deviceId
      ? { kind: "device", deviceId: record.deviceId, reason: "local" }
      : { kind: "unreachable", reason: "no_device" };
  }
  if (record.auth.type === "none") return { kind: "anywhere" };
  return record.deviceId
    ? { kind: "device", deviceId: record.deviceId, reason: "credential" }
    : { kind: "unreachable", reason: "needs_sign_in" };
};

export type McpServerPut = {
  id: string;
  name: string;
  description?: string;
  transport: McpServerTransport;
  url?: string;
  auth: McpServerAuth;
  /** The calling computer, for a stdio server or one it holds a credential for. */
  deviceId?: string;
  tools?: McpServerTool[];
  needsAuth?: boolean;
};

export type McpServerCalls = {
  /** Every MCP server on the account. */
  "mcpServers.list": {
    args: Record<string, never>;
    result: { servers: McpServerRecord[] };
  };
  /**
   * Add or update a server from a computer. Fields the computer leaves out
   * keep their stored values.
   */
  "mcpServers.put": {
    args: McpServerPut;
    result: { server: McpServerRecord };
  };
  "mcpServers.remove": {
    args: { id: string };
    result: { removed: boolean };
  };
  /** Run one tool wherever the server can be reached from the cloud. */
  "mcpServers.call": {
    args: { id: string; tool: string; args: Record<string, unknown> };
    result: { result: unknown };
  };
};
