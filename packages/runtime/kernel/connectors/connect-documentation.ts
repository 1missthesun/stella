/**
 * `connect.documentation()` text — the one description of the connector
 * client every code runtime hands the model. `installConnectWorkerApi`
 * (device kernel worker) carries a byte-identical inline copy because its
 * source is stringified into the eval'd worker and cannot import; a unit
 * test pins the two together.
 */
export const CONNECT_DOCUMENTATION = `Connect client — manages the user's connections to third-party services (Gmail, Google Docs, Notion, Slack, MCP servers, ...). All methods are async; failures throw Error with the broker's message.

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
