/**
 * The account's custom MCP servers (`@stella/contracts/backend/mcp-servers`).
 *
 * A row says what the server is and where it is reached from. Remote servers
 * that need no sign-in are called straight from here; a stdio server, a
 * local-network URL, or a remote server whose credential a computer holds is
 * reached through that computer's presence socket while it is online and
 * accepting work. No credential, stdio command or environment is ever
 * stored here: computers keep those.
 *
 * Computers sync through the owner calls (`mcpServers.*`); cloud turns use
 * the internal operations (`mcp.*`), which also add servers and refresh a
 * directly reachable server's tools when its listing is stale.
 */

import {
  MCP_SERVER_ID_PATTERN,
  mcpServerReach,
  type McpServerAuth,
  type McpServerCalls,
  type McpServerPut,
  type McpServerRecord,
  type McpServerTool,
} from "@stella/contracts/backend/mcp-servers";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { redactSensitiveText } from "@stella/contracts/sensitive-data";
import { connectorToolName } from "@stella/runtime/kernel/connectors/connector-tools.js";
import { parseAddMcpOptions } from "@stella/runtime/kernel/connectors/mcp-add-options.js";
import {
  ConnectorAuthError,
  McpHttpSession,
} from "@stella/runtime/kernel/connectors/mcp-http-session.js";
import {
  array,
  boolean,
  empty,
  json,
  literal,
  object,
  optional,
  string,
} from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";

const MAX_SERVERS = 50;
const MAX_TOOLS = 500;
const TOOLS_REFRESH_MS = 60 * 60_000;
const PROBE_RETRY_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 60_000;
const SESSION_CACHE_LIMIT = 32;

export const MCP_SERVERS_MIGRATION = {
  id: "mcpServers.1-init",
  statements: [
    `CREATE TABLE mcp_servers (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       description TEXT,
       transport TEXT NOT NULL,
       url TEXT,
       auth_json TEXT NOT NULL,
       device_id TEXT,
       tools_json TEXT,
       tools_updated_at INTEGER,
       needs_auth INTEGER NOT NULL DEFAULT 0,
       probe_failed_at INTEGER,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  ],
};

type Row = {
  id: string;
  name: string;
  description: string | null;
  transport: string;
  url: string | null;
  auth_json: string;
  device_id: string | null;
  tools_json: string | null;
  tools_updated_at: number | null;
  needs_auth: number;
  probe_failed_at: number | null;
  created_at: number;
  updated_at: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const logEvent = (event: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ event, ...fields }));

const readAuth = (raw: string): McpServerAuth => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && (parsed.type === "none" || parsed.type === "oauth" || parsed.type === "api_key")) {
      return {
        type: parsed.type,
        ...(typeof parsed.tokenKey === "string" ? { tokenKey: parsed.tokenKey } : {}),
        ...(typeof parsed.headerName === "string" ? { headerName: parsed.headerName } : {}),
        ...(parsed.scheme === "bearer" ||
        parsed.scheme === "basic" ||
        parsed.scheme === "oauth" ||
        parsed.scheme === "raw"
          ? { scheme: parsed.scheme }
          : {}),
      };
    }
  } catch {}
  return { type: "none" };
};

const normalizeTool = (value: unknown): McpServerTool | null => {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) return null;
  return {
    name: value.name.slice(0, 200),
    ...(typeof value.title === "string" ? { title: value.title.slice(0, 300) } : {}),
    ...(typeof value.description === "string"
      ? { description: value.description.slice(0, 4_000) }
      : {}),
    ...(isRecord(value.inputSchema) ? { inputSchema: value.inputSchema } : {}),
    ...(isRecord(value.annotations) ? { annotations: value.annotations } : {}),
  };
};

const normalizeTools = (values: readonly unknown[]): McpServerTool[] =>
  values
    .map(normalizeTool)
    .filter((tool): tool is McpServerTool => tool !== null)
    .slice(0, MAX_TOOLS);

const readTools = (raw: string | null): McpServerTool[] | undefined => {
  if (raw === null) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeTools(parsed) : undefined;
  } catch {
    return undefined;
  }
};

const toRecord = (row: Row): McpServerRecord => {
  const tools = readTools(row.tools_json);
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    transport: row.transport === "stdio" ? "stdio" : "streamable_http",
    ...(row.url ? { url: row.url } : {}),
    auth: readAuth(row.auth_json),
    ...(row.device_id ? { deviceId: row.device_id } : {}),
    ...(tools ? { tools } : {}),
    ...(row.tools_updated_at !== null ? { toolsUpdatedAt: row.tools_updated_at } : {}),
    needsAuth: row.needs_auth === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const readRow = (db: OwnerDbReader, id: string): Row | null =>
  db.one<Row>("SELECT * FROM mcp_servers WHERE id = ?", id);

const listRecords = (db: OwnerDbReader): McpServerRecord[] =>
  db.all<Row>("SELECT * FROM mcp_servers ORDER BY name COLLATE NOCASE, id").map(toRecord);

const requireRecord = (db: OwnerDbReader, id: string): McpServerRecord => {
  const row = readRow(db, id);
  if (!row) {
    throw new RpcError(
      "NOT_FOUND",
      `No MCP server named ${id} is on this account. List them with connect.connectors().`,
    );
  }
  return toRecord(row);
};

const writeTools = (
  ctx: OwnerContext,
  id: string,
  update: { tools?: McpServerTool[]; needsAuth?: boolean; failed?: boolean },
) => {
  if (update.failed) {
    ctx.db.run("UPDATE mcp_servers SET probe_failed_at = ? WHERE id = ?", ctx.now, id);
    return;
  }
  if (update.tools) {
    ctx.db.run(
      `UPDATE mcp_servers
         SET tools_json = ?, tools_updated_at = ?, needs_auth = 0, probe_failed_at = NULL, updated_at = ?
       WHERE id = ?`,
      JSON.stringify(update.tools),
      ctx.now,
      ctx.now,
      id,
    );
    return;
  }
  if (update.needsAuth) {
    ctx.db.run(
      "UPDATE mcp_servers SET needs_auth = 1, probe_failed_at = ?, updated_at = ? WHERE id = ?",
      ctx.now,
      ctx.now,
      id,
    );
  }
};

const ownerDevices = async (ctx: OwnerContext): Promise<DeviceDestination[]> =>
  await ctx.host.deviceDestinations().catch(() => []);

const deviceLabel = (devices: readonly DeviceDestination[], deviceId: string): string =>
  devices.find((device) => device.deviceId === deviceId)?.label?.trim() || "your computer";

// ---------------------------------------------------------------------------
// Direct remote calls (servers that need no credential)
// ---------------------------------------------------------------------------

const sessions = new Map<string, McpHttpSession>();

const directSession = (ownerId: string, record: McpServerRecord, timeoutMs: number) => {
  const key = `${ownerId}\0${record.id}\0${record.url ?? ""}\0${timeoutMs}`;
  const cached = sessions.get(key);
  if (cached) return cached;
  const session = new McpHttpSession(
    {
      displayName: record.name,
      ...(record.url ? { url: record.url } : {}),
      auth: record.auth,
    },
    { authHeaders: async () => ({}), timeoutMs },
  );
  sessions.set(key, session);
  while (sessions.size > SESSION_CACHE_LIMIT) {
    sessions.delete(sessions.keys().next().value!);
  }
  return session;
};

const forgetSessions = (ownerId: string, id: string) => {
  for (const key of [...sessions.keys()]) {
    if (key.startsWith(`${ownerId}\0${id}\0`)) sessions.delete(key);
  }
};

const failureMessage = (error: unknown, fallback: string): string =>
  redactSensitiveText(
    error instanceof Error && error.message.trim() ? error.message.slice(0, 1_000) : fallback,
  );

const signInMessage = (record: McpServerRecord): string =>
  `${record.name} needs sign-in. Stella's cloud keeps no credentials, so sign-in happens on one of your computers: have an agent there call tools.${connectorToolName(record.id, "authorize")}(). After that its tools work here through that computer while it is online.`;

const probeDirect = async (
  ctx: OwnerContext,
  record: McpServerRecord,
): Promise<{ tools: McpServerTool[] } | { needsAuth: true }> => {
  try {
    const tools = normalizeTools(
      await directSession(ctx.ownerId, record, PROBE_TIMEOUT_MS).listTools(),
    );
    return { tools };
  } catch (error) {
    if (error instanceof ConnectorAuthError) return { needsAuth: true };
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Reaching a server
// ---------------------------------------------------------------------------

type ToolCallResult = { result: unknown };

const relay = async (
  ctx: OwnerContext,
  record: McpServerRecord,
  deviceId: string,
  method: "mcp.listTools" | "mcp.callTool",
  params: Record<string, unknown>,
): Promise<unknown> => {
  const devices = await ownerDevices(ctx);
  const device = devices.find((candidate) => candidate.deviceId === deviceId);
  const label = deviceLabel(devices, deviceId);
  if (!device) {
    throw new RpcError(
      "UNAVAILABLE",
      `${record.name} runs on a computer that is no longer signed in to this account. Add it again from a computer that has it.`,
      { retryable: false, reason: "device_gone" },
    );
  }
  if (!device.online) {
    throw new RpcError(
      "UNAVAILABLE",
      `${record.name} is device-only: it runs on ${label}, which is offline. Open Stella on ${label} and try again.`,
      { retryable: true, reason: "device_offline" },
    );
  }
  if (!device.remoteExecutionEnabled) {
    ctx.host.askDeviceConsent({ deviceId, requestedAt: ctx.now });
    throw new RpcError(
      "FORBIDDEN",
      `${record.name} runs on ${label}, which isn't accepting work from your other devices. Stella asked there; once it's allowed (Connect, under your computers), try again.`,
      { retryable: true, reason: "device_not_enabled" },
    );
  }
  const answer = await ctx.host.relayDeviceRequest({
    deviceId,
    method,
    params: { ...params, id: record.id },
  });
  if (answer.ok) return answer.value;
  const reason = answer.code === "device_offline" ? "device_offline" : `device_${answer.code}`;
  throw new RpcError(
    answer.code === "device_offline" || answer.code === "timeout" || answer.code === "device_busy"
      ? "UNAVAILABLE"
      : "CONFLICT",
    answer.code === "device_offline"
      ? `${record.name} is device-only: it runs on ${label}, which is offline. Open Stella on ${label} and try again.`
      : `${record.name} on ${label}: ${answer.message}`,
    { retryable: answer.code !== "forbidden" && answer.code !== "bad_request", reason },
  );
};

const callServer = async (
  ctx: OwnerContext,
  id: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> => {
  const record = requireRecord(ctx.db, id);
  const reach = mcpServerReach(record);
  const started = Date.now();
  const outcome = (ok: boolean, route: string) =>
    logEvent("mcp_tool_called", {
      ownerId: ctx.ownerId,
      server: record.id,
      tool: tool.slice(0, 120),
      route,
      ok,
      ms: Date.now() - started,
    });
  if (reach.kind === "unreachable") {
    outcome(false, "none");
    throw new RpcError(
      "FORBIDDEN",
      reach.reason === "needs_sign_in"
        ? signInMessage(record)
        : `${record.name} runs on a computer, and none is recorded for it. Add it again from that computer.`,
      { retryable: false, reason: reach.reason },
    );
  }
  if (reach.kind === "device") {
    try {
      const value = await relay(ctx, record, reach.deviceId, "mcp.callTool", { tool, args });
      outcome(true, "device");
      return { result: isRecord(value) && "result" in value ? value.result : value };
    } catch (error) {
      outcome(false, "device");
      throw error;
    }
  }
  try {
    const result = await directSession(ctx.ownerId, record, CALL_TIMEOUT_MS).callTool(tool, args);
    outcome(true, "direct");
    return { result };
  } catch (error) {
    outcome(false, "direct");
    if (error instanceof ConnectorAuthError) {
      writeTools(ctx, record.id, { needsAuth: true });
      throw new RpcError(
        "FORBIDDEN",
        `${record.name} refused the call without a credential. Remove it and add it again with auth: { type: "oauth" } or { type: "api_key" }, then sign in on a computer.`,
        { retryable: false, reason: "needs_sign_in" },
      );
    }
    throw new RpcError("UNAVAILABLE", failureMessage(error, `${record.name} could not run ${tool}.`), {
      retryable: true,
      reason: "server_failed",
    });
  }
};

/** Stale listings of directly reachable servers, refreshed in parallel. */
const refreshStale = async (ctx: OwnerContext): Promise<void> => {
  const stale = listRecords(ctx.db).filter((record) => {
    if (mcpServerReach(record).kind !== "anywhere") return false;
    const row = readRow(ctx.db, record.id);
    if (row?.probe_failed_at && ctx.now - row.probe_failed_at < PROBE_RETRY_MS) return false;
    return !record.toolsUpdatedAt || ctx.now - record.toolsUpdatedAt > TOOLS_REFRESH_MS;
  });
  await Promise.all(
    stale.map(async (record) => {
      try {
        const probe = await probeDirect(ctx, record);
        writeTools(ctx, record.id, probe);
      } catch {
        writeTools(ctx, record.id, { failed: true });
      }
    }),
  );
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

const assertRoom = (ctx: OwnerContext, id: string) => {
  if (readRow(ctx.db, id)) return;
  const count = ctx.db.one<{ count: number }>("SELECT COUNT(*) AS count FROM mcp_servers")?.count ?? 0;
  if (count >= MAX_SERVERS) {
    throw new RpcError(
      "CONFLICT",
      `This account already has ${MAX_SERVERS} MCP servers. Remove one with connect.remove(id) first.`,
    );
  }
};

const saveServer = (
  ctx: OwnerContext,
  input: McpServerPut,
): McpServerRecord => {
  assertRoom(ctx, input.id);
  const existing = readRow(ctx.db, input.id);
  const tools = input.tools ? normalizeTools(input.tools) : undefined;
  ctx.db.run(
    `INSERT INTO mcp_servers
       (id, name, description, transport, url, auth_json, device_id, tools_json, tools_updated_at, needs_auth, probe_failed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       transport = excluded.transport,
       url = excluded.url,
       auth_json = excluded.auth_json,
       device_id = excluded.device_id,
       tools_json = excluded.tools_json,
       tools_updated_at = excluded.tools_updated_at,
       needs_auth = excluded.needs_auth,
       probe_failed_at = NULL,
       updated_at = excluded.updated_at`,
    input.id,
    input.name,
    input.description ?? null,
    input.transport,
    input.transport === "stdio" ? null : (input.url ?? null),
    JSON.stringify(input.auth),
    input.deviceId ?? existing?.device_id ?? null,
    tools ? JSON.stringify(tools) : (existing?.tools_json ?? null),
    tools ? ctx.now : (existing?.tools_updated_at ?? null),
    input.needsAuth === undefined
      ? tools
        ? 0
        : (existing?.needs_auth ?? 0)
      : input.needsAuth
        ? 1
        : 0,
    existing?.created_at ?? ctx.now,
    ctx.now,
  );
  forgetSessions(ctx.ownerId, input.id);
  return requireRecord(ctx.db, input.id);
};

const removeServer = (ctx: OwnerContext, id: string): boolean => {
  const existed = Boolean(readRow(ctx.db, id));
  if (existed) ctx.db.run("DELETE FROM mcp_servers WHERE id = ?", id);
  forgetSessions(ctx.ownerId, id);
  logEvent("mcp_server_removed", { ownerId: ctx.ownerId, server: id, existed });
  return existed;
};

const rateLimit = (ctx: OwnerContext, key: string) =>
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    key,
    { count: 120, windowMs: 60_000 },
    "Too many MCP server changes. Please wait a moment.",
  );

// ---------------------------------------------------------------------------
// Cloud `connect.addMcp`
// ---------------------------------------------------------------------------

type CloudAddResult = {
  server: McpServerRecord;
  probeDeferred?: true;
  hint?: string;
};

const addFromCloud = async (ctx: OwnerContext, raw: unknown): Promise<CloudAddResult> => {
  if (!isRecord(raw)) {
    throw new RpcError("BAD_REQUEST", "connect.addMcp requires an options object.");
  }
  let command;
  try {
    ({ command } = parseAddMcpOptions(raw));
  } catch (error) {
    throw new RpcError("BAD_REQUEST", error instanceof Error ? error.message : String(error));
  }
  if (command.transport === "stdio") {
    throw new RpcError(
      "BAD_REQUEST",
      "A stdio MCP server runs as a program on one computer, so it is added there: have an agent on that computer call connect.addMcp. Once added, it is usable from here while that computer is online.",
      { retryable: false, reason: "stdio_in_cloud" },
    );
  }
  const url = command.url ?? "";
  if (mcpServerReach({ transport: "streamable_http", auth: { type: "none" }, url }).kind !== "anywhere") {
    throw new RpcError(
      "BAD_REQUEST",
      `${url} is a local-network address, which only the computer on that network can reach. Add it from an agent on that computer.`,
      { retryable: false, reason: "local_url_in_cloud" },
    );
  }
  rateLimit(ctx, "mcpServers.add");
  const auth: McpServerAuth = {
    type: command.auth?.type ?? "none",
    ...(command.auth?.tokenKey ? { tokenKey: command.auth.tokenKey } : {}),
    ...(command.auth?.headerName ? { headerName: command.auth.headerName } : {}),
    ...(command.auth?.scheme ? { scheme: command.auth.scheme } : {}),
  };
  const base: McpServerPut = {
    id: command.id,
    name: command.displayName,
    ...(command.description ? { description: command.description } : {}),
    transport: "streamable_http",
    url,
    auth,
  };
  const existing = readRow(ctx.db, command.id);
  const keepDevice =
    existing && existing.url === url && auth.type !== "none" && existing.device_id
      ? { deviceId: existing.device_id }
      : {};
  if (auth.type !== "none") {
    assertRoom(ctx, command.id);
    const server = saveServer(ctx, { ...base, ...keepDevice, needsAuth: !keepDevice.deviceId });
    logEvent("mcp_server_saved", { ownerId: ctx.ownerId, server: server.id, from: "cloud", auth: auth.type });
    return keepDevice.deviceId
      ? { server }
      : { server, probeDeferred: true, hint: signInMessage(server) };
  }
  assertRoom(ctx, command.id);
  const probeRecord: McpServerRecord = {
    ...base,
    needsAuth: false,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  let tools: McpServerTool[];
  try {
    tools = normalizeTools(
      await directSession(ctx.ownerId, probeRecord, CALL_TIMEOUT_MS).listTools(),
    );
  } catch (error) {
    forgetSessions(ctx.ownerId, command.id);
    if (error instanceof ConnectorAuthError) {
      throw new RpcError(
        "FORBIDDEN",
        `${command.displayName} requires sign-in (${failureMessage(error, "auth required")}). Add it with auth: { type: "oauth" } (or "api_key"); sign-in then happens on one of your computers.`,
        { retryable: false, reason: "needs_sign_in" },
      );
    }
    throw new RpcError(
      "UNAVAILABLE",
      `Couldn't list ${command.displayName}'s tools: ${failureMessage(error, "the server did not answer")}`,
      { retryable: true, reason: "probe_failed" },
    );
  }
  const server = saveServer(ctx, { ...base, tools, needsAuth: false });
  logEvent("mcp_server_saved", { ownerId: ctx.ownerId, server: server.id, from: "cloud", tools: tools.length });
  return { server };
};

/** Cloud `<id>_authorize`: list the tools through the computer that signed in. */
const authorizeFromCloud = async (ctx: OwnerContext, id: string): Promise<McpServerRecord> => {
  const record = requireRecord(ctx.db, id);
  const reach = mcpServerReach(record);
  if (reach.kind === "unreachable") {
    throw new RpcError("FORBIDDEN", signInMessage(record), {
      retryable: false,
      reason: "needs_sign_in",
    });
  }
  if (reach.kind === "anywhere") {
    const probe = await probeDirect(ctx, record);
    writeTools(ctx, record.id, probe);
    if ("needsAuth" in probe) {
      throw new RpcError("FORBIDDEN", signInMessage(record), {
        retryable: false,
        reason: "needs_sign_in",
      });
    }
    return requireRecord(ctx.db, id);
  }
  const value = await relay(ctx, record, reach.deviceId, "mcp.listTools", {});
  const tools = isRecord(value) && Array.isArray(value.tools) ? normalizeTools(value.tools) : [];
  writeTools(ctx, record.id, { tools });
  return requireRecord(ctx.db, id);
};

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

const idParser = string({ min: 1, max: 64, pattern: MCP_SERVER_ID_PATTERN });

const authParser = object({
  type: literal("none", "oauth", "api_key"),
  tokenKey: optional(string({ max: 200 })),
  headerName: optional(string({ max: 200 })),
  scheme: optional(literal("bearer", "basic", "oauth", "raw")),
});

const putParser = object({
  id: idParser,
  name: string({ min: 1, max: 200 }),
  description: optional(string({ max: 2_000 })),
  transport: literal("streamable_http", "stdio"),
  url: optional(string({ max: 2_000, pattern: /^https?:\/\//iu })),
  auth: authParser,
  deviceId: optional(string({ min: 1, max: 128 })),
  tools: optional(array(json({ maxBytes: 64 * 1024 }), { max: MAX_TOOLS })),
  needsAuth: optional(boolean()),
});

const callParser = object({
  id: idParser,
  tool: string({ min: 1, max: 200 }),
  args: json({ maxBytes: 24 * 1024 }),
});

const putFromComputer = async (
  ctx: OwnerContext,
  args: McpServerCalls["mcpServers.put"]["args"],
): Promise<{ server: McpServerRecord }> => {
  rateLimit(ctx, "mcpServers.put");
  if (args.transport === "streamable_http" && !args.url) {
    throw new RpcError("BAD_REQUEST", "A remote MCP server needs a url.");
  }
  if (args.deviceId) {
    const devices = await ownerDevices(ctx);
    if (!devices.some((device) => device.deviceId === args.deviceId)) {
      throw new RpcError("BAD_REQUEST", "That computer is not signed in to this account.");
    }
  }
  const server = saveServer(ctx, {
    ...args,
    ...(args.tools ? { tools: normalizeTools(args.tools) } : {}),
  });
  logEvent("mcp_server_saved", {
    ownerId: ctx.ownerId,
    server: server.id,
    from: "computer",
    transport: server.transport,
    tools: server.tools?.length ?? null,
  });
  return { server };
};

const callArgs = (raw: unknown): Record<string, unknown> => {
  if (!isRecord(raw)) throw new RpcError("BAD_REQUEST", "args must be an object.");
  return raw;
};

export const mcpServersDomain = {
  name: "mcpServers",
  migrations: [MCP_SERVERS_MIGRATION],
  calls: {
    "mcpServers.list": {
      scope: "owner",
      parse: empty(),
      handler: (ctx) => ({ servers: listRecords(ctx.db) }),
    },
    "mcpServers.put": {
      scope: "owner",
      parse: putParser as never,
      handler: putFromComputer,
    },
    "mcpServers.remove": {
      scope: "owner",
      parse: object({ id: idParser }),
      handler: (ctx, args) => {
        rateLimit(ctx, "mcpServers.remove");
        return { removed: removeServer(ctx, args.id) };
      },
    },
    "mcpServers.call": {
      scope: "owner",
      parse: callParser as never,
      handler: (ctx, args) => callServer(ctx, args.id, args.tool, callArgs(args.args)),
    },
  },
  internal: {
    "mcp.list": async (ctx, raw) => {
      if (isRecord(raw) && raw.refresh === true) await refreshStale(ctx);
      const servers = listRecords(ctx.db);
      const wanted = new Set(servers.flatMap((server) => (server.deviceId ? [server.deviceId] : [])));
      const devices = wanted.size
        ? (await ownerDevices(ctx))
            .filter((device) => wanted.has(device.deviceId))
            .map((device) => ({
              deviceId: device.deviceId,
              ...(device.label?.trim() ? { label: device.label.trim() } : {}),
              online: device.online,
              acceptsWork: device.remoteExecutionEnabled,
            }))
        : [];
      return { servers, devices };
    },
    "mcp.add": (ctx, raw) => addFromCloud(ctx, isRecord(raw) ? raw.options : undefined),
    "mcp.remove": (ctx, raw) => {
      const id = idParser(isRecord(raw) ? raw.id : undefined, "id");
      requireRecord(ctx.db, id);
      return { removed: removeServer(ctx, id) };
    },
    "mcp.call": (ctx, raw) => {
      const args = callParser(raw);
      return callServer(ctx, args.id, args.tool, callArgs(args.args));
    },
    "mcp.authorize": async (ctx, raw) => ({
      server: await authorizeFromCloud(ctx, idParser(isRecord(raw) ? raw.id : undefined, "id")),
    }),
  },
  purge: (ctx, mode) => {
    if (mode === "delete") {
      ctx.db.run("DELETE FROM mcp_servers");
      sessions.clear();
    }
    return { pending: false };
  },
} satisfies OwnerDomain;
