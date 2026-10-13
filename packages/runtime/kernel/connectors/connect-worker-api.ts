/**
 * The frozen `connect` object graph inside the Node REPL worker.
 *
 * Mirrors `browser-use/worker-api.ts`: this function's SOURCE is embedded
 * into the eval'd worker (via `toString()`), so keep every runtime
 * dependency inside the function body. It only shapes/validates arguments
 * and forwards them over the kernel protocol (`connect-call` messages);
 * all real work — catalog resolution, the CLI bridge, the backend
 * connector action broker — happens host-side in
 * `connectors/connect-service.ts`.
 */

export type ConnectWorkerMethod = "discover" | "connectors" | "addMcp" | "remove";

export type ConnectWorkerCall = (
  method: ConnectWorkerMethod,
  args: readonly unknown[],
) => Promise<unknown>;

export interface ConnectWorkerApi {
  documentation(): string;
  discover(query: string): Promise<unknown>;
  connectors(): Promise<unknown>;
  addMcp(options: Readonly<Record<string, unknown>>): Promise<unknown>;
  remove(id: string): Promise<unknown>;
}

/**
 * Installs the `connect` client inside the Node REPL worker. Keep every
 * runtime dependency inside this function: its source is stringified into
 * the worker bootstrap.
 */
export function installConnectWorkerApi(
  callConnect: ConnectWorkerCall,
): ConnectWorkerApi {
  if (typeof callConnect !== "function") {
    throw new TypeError("callConnect must be a function.");
  }

  const DOCUMENTATION = `Connect client — manages the user's connections to third-party services (Gmail, Google Docs, Notion, Slack, MCP servers, ...). All methods are async; failures throw Error with the broker's message.

Connected services' actions are tools: every action of an enabled connector is callable here as tools.<connector>_<action>(args), for example tools.gmail_send_email({ ... }). Find them with await tools.$search({ query: "gmail send" }), read one's input schema with await tools.$describe(name), and call it with a plain object; args are checked against that schema first. Enabling or disabling a connector adds or removes its tools immediately.

connect.discover(query) — keyword-search the whole integration catalog (max 8 matches), with each match's enabled/connected state and a "next" hint to follow.
connect.connectors() — connectors enabled right now: { id, name, kind, connected, description }; MCP servers also say where they run (reach, where).
connect.addMcp({ id, name?, transport, auth? }) — add an MCP server to the user's account, so its tools work in the cloud and on every computer. transport is { url } (streamable HTTP) or { command, args?, env?, cwd? } (stdio, added on the computer that runs it: device-only, reached through that computer while it is online); auth (optional) is { type: "oauth" | "api_key", tokenKey?, headerName?, scheme? }. Probes the server, saves it, and returns { imported, toolCount, tools, where } with the new tool names. A server that needs a credential is still saved (probeDeferred: true) with one <id>_authorize tool, which asks the user for it on a computer and then lists the server's tools; credentials stay on that computer, and the cloud reaches the server through it.
  await connect.addMcp({ id: "linear", name: "Linear", transport: { url: "https://mcp.linear.app/mcp" }, auth: { type: "oauth" } });
  await connect.addMcp({ id: "my-tools", transport: { command: "npx", args: ["-y", "my-mcp-server"] } });
connect.remove(id) — remove an MCP server from the account (its tools go away everywhere), or an API connector, with its saved config and credentials. Store integrations are disabled in the Store instead.

If a service is not connected, follow discover's "next" hint (an inline connect card through connector_status, or the Store) instead of retrying.

Example:
const [match] = await tools.$search({ query: "google docs comment" });
const schema = await tools.$describe(match.name);
const result = await tools[match.name]({ document_id: "..." });`;

  const requireNonEmptyString = (value: unknown, name: string): string => {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`connect: ${name} must be a non-empty string.`);
    }
    return value.trim();
  };
  // Cross-realm safe: REPL cells build objects in the vm context, whose
  // Object.prototype is a different identity than this function's realm.
  const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null || prototype === Object.prototype) return true;
    return (
      Object.getPrototypeOf(prototype) === null &&
      typeof prototype.constructor === "function" &&
      prototype.constructor.name === "Object"
    );
  };
  const requirePlainObject = (
    value: unknown,
    name: string,
  ): Record<string, unknown> => {
    if (!isPlainObject(value)) {
      throw new TypeError(`connect: ${name} must be a plain object.`);
    }
    return value;
  };

  const connect: ConnectWorkerApi = Object.freeze({
    documentation: () => DOCUMENTATION,
    discover: (query: string) =>
      callConnect("discover", [requireNonEmptyString(query, "query")]),
    connectors: () => callConnect("connectors", []),
    addMcp: (options: Readonly<Record<string, unknown>>) =>
      callConnect("addMcp", [requirePlainObject(options, "options")]),
    remove: (id: string) =>
      callConnect("remove", [requireNonEmptyString(id, "id")]),
  });
  const REPLACED_BY_TOOLS = new Set(["call", "actions", "schema"]);
  return new Proxy(connect, {
    get: (target, property, receiver) => {
      if (typeof property === "string" && REPLACED_BY_TOOLS.has(property)) {
        throw new TypeError(
          `connect.${property} no longer exists: connected services' actions are tools. Find one with await tools.$search({ query }), see its schema with await tools.$describe(name), and call it as await tools.<name>(args).`,
        );
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
