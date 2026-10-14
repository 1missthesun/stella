import type { ConnectorCommandConfig } from "./types.js";

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const validateMcpConnectorId = (value: string): string => {
  const id = value.trim().toLowerCase();
  if (
    !id ||
    id === "." ||
    id === ".." ||
    id.includes("/") ||
    id.includes("\\") ||
    id.length > 64 ||
    !/^[a-z0-9._-]+$/u.test(id)
  ) {
    throw new Error(
      `Invalid connector id: ${value}. Use up to 64 lowercase letters, digits, ".", "_", "-".`,
    );
  }
  return id;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isStringRecordValue = (
  value: unknown,
): value is Record<string, string> =>
  isPlainRecord(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

export const parseAddMcpOptions = (raw: Record<string, unknown>): {
  command: ConnectorCommandConfig;
} => {
  if (typeof raw.id !== "string" || !raw.id.trim()) {
    throw new Error("connect.addMcp requires an id string.");
  }
  const id = validateMcpConnectorId(raw.id);
  const displayName =
    typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim()
      : undefined;

  const transport = raw.transport;
  if (!isPlainRecord(transport)) {
    throw new Error(
      'connect.addMcp requires transport: { url } or { command, args?, env?, cwd? }.',
    );
  }
  const url = typeof transport.url === "string" ? transport.url.trim() : "";
  const commandName =
    typeof transport.command === "string" ? transport.command.trim() : "";
  if (Boolean(url) === Boolean(commandName)) {
    throw new Error(
      "connect.addMcp transport must have exactly one of url or command.",
    );
  }
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`connect.addMcp transport.url is not a valid URL: ${url}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("connect.addMcp transport.url must be http(s).");
    }
  }
  if (transport.args !== undefined && !isStringArray(transport.args)) {
    throw new Error("connect.addMcp transport.args must be an array of strings.");
  }
  if (transport.env !== undefined && !isStringRecordValue(transport.env)) {
    throw new Error(
      "connect.addMcp transport.env must be a string-to-string record.",
    );
  }
  if (transport.cwd !== undefined && typeof transport.cwd !== "string") {
    throw new Error("connect.addMcp transport.cwd must be a string.");
  }

  let auth: ConnectorCommandConfig["auth"] = { type: "none" };
  if (raw.auth !== undefined) {
    if (!isPlainRecord(raw.auth)) {
      throw new Error("connect.addMcp auth must be a plain object.");
    }
    const authType = raw.auth.type;
    if (authType !== "oauth" && authType !== "api_key") {
      throw new Error('connect.addMcp auth.type must be "oauth" or "api_key".');
    }
    const tokenKey =
      typeof raw.auth.tokenKey === "string" && raw.auth.tokenKey.trim()
        ? raw.auth.tokenKey.trim()
        : id;
    const headerName =
      typeof raw.auth.headerName === "string" && raw.auth.headerName.trim()
        ? raw.auth.headerName.trim()
        : undefined;
    const scheme = raw.auth.scheme;
    if (
      scheme !== undefined &&
      scheme !== "bearer" &&
      scheme !== "basic" &&
      scheme !== "oauth" &&
      scheme !== "raw"
    ) {
      throw new Error(
        'connect.addMcp auth.scheme must be "bearer" | "basic" | "oauth" | "raw".',
      );
    }
    auth = {
      type: authType,
      tokenKey,
      ...(headerName ? { headerName } : {}),
      ...(scheme ? { scheme } : {}),
    };
  }

  const command: ConnectorCommandConfig = url
    ? {
        id,
        displayName,
        ...(description ? { description } : {}),
        transport: "streamable_http",
        url,
        auth,
      }
    : {
        id,
        displayName,
        ...(description ? { description } : {}),
        transport: "stdio",
        command: commandName,
        args: isStringArray(transport.args) ? transport.args : [],
        ...(typeof transport.cwd === "string" && transport.cwd
          ? { cwd: transport.cwd }
          : {}),
        ...(isStringRecordValue(transport.env) &&
        Object.keys(transport.env).length
          ? { env: transport.env }
          : {}),
        auth,
      };
  return { command };
};

