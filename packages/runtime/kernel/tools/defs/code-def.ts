/**
 * The `code` tool's model-visible surface, split from the executable
 * definition so workerd hosts advertise the byte-identical tool. The kernel
 * behind it uses `worker_threads`; the cloud DO substitutes its own Dynamic
 * Worker executor for that name.
 */

/** Shared by the device and cloud `code` descriptions. */
export const CODE_TOOL_HISTORY_SENTENCE =
  "history: await history.search(text, { kinds, limit, order }) finds messages and agent reports in this conversation's whole history, await history.sql(query, params) runs one read-only SELECT over it, and await history.read(fromSeq, toSeq) returns { records: [{ seq, role, at, text }] } for a seq range.";

export const CODE_TOOL_DESCRIPTION =
  "Run JavaScript with top-level await in Stella's persistent code runtime; bindings persist within one generation (use var for reusable names). Globals: codeRuntime, sky, browser, connect, history, and tools; the stella-computer-macos / stella-computer-windows and stella-browser skills document sky and browser, and codeRuntime.help() lists its helpers. End with an expression to return its value; codeRuntime.write(...) and console.log also print. A long cell yields a cell_id: call code again with it to read new output or terminate it. A failed cell returns the output it printed before the error. tools exposes allowed Stella tools: tools.$list() for exact names (bracket notation for non-identifier names, such as tools[\"mcp.server/tool\"](...)), tools.$search({ query: \"<capability>\" }) for ranked signatures, and tools.$describe(name) for a complete schema. Use Promise.all for independent calls. Nested calls keep permissions, cancellation, and file tracking; tools requiring explicit approval must be called directly. Every action of a connected service is a deferred tool here too, named <service>_<action> (tools.gmail_send_email); connect manages the connections (connect.documentation()). " +
  CODE_TOOL_HISTORY_SENTENCE;

/**
 * The orchestrator's `code`: the same runtime without `sky` and `browser`
 * (computer use and browser control belong to agents), with its file access
 * stated plainly.
 */
export const CODE_TOOL_ORCHESTRATOR_DESCRIPTION =
  "Run JavaScript with top-level await in a persistent runtime on the computer you run on (use var for bindings you reuse). Globals: tools, connect, history, memory (when on), codeRuntime. node:fs works on absolute paths; codeRuntime.emitImage(path) shows you an image; no processes, computer use or browser. End with an expression to return it; console.log prints. A long cell returns a cell_id to call again with. tools.$search({ query }) finds a tool and tools.$describe(name) gives its full schema. Every action of a connected service is a deferred tool here, named <service>_<action> (tools.gmail_send_email); connect manages the connections (connect.documentation()). Cards from tools called here (map, connector_status) render in the chat as usual.";

export const CODE_TOOL_CLOUD_AGENT_DESCRIPTION =
  "Run JavaScript with top-level await in Stella's persistent code runtime in your cloud sandbox; bindings persist within one generation (use var for reusable names). Globals: codeRuntime, connect, history, and tools; there is no sky or browser in the cloud. node:fs reads and writes your workspace and fetch reaches the network, as Bash does. End with an expression to return its value; codeRuntime.write(...) and console.log also print. A long cell yields a cell_id: call code again with it to read new output or terminate it. A failed cell returns the output it printed before the error. tools exposes your other tools (tools.Bash, tools.Read, tools.web, ...): tools.$list() for exact names, tools.$search({ query: \"<capability>\" }) for ranked signatures, and tools.$describe(name) for a complete schema. Use Promise.all for independent calls. Nested calls keep permissions and cancellation; tools requiring explicit approval must be called directly. Every action of a connected service is a deferred tool here too, named <service>_<action> (tools.gmail_send_email) and found with tools.$search; connect manages the connections (connect.documentation()). " +
  CODE_TOOL_HISTORY_SENTENCE;

export const CODE_TOOL_PROMPT_SNIPPET =
  "Run persistent JavaScript, orchestrate allowed Stella tools and connected services' actions, and control apps through the sky/browser globals";

export const CODE_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    code: {
      type: "string",
      description: "JavaScript to evaluate with top-level await.",
    },
    timeout_ms: {
      type: "number",
      description: "Optional evaluation timeout in milliseconds.",
    },
    yield_time_ms: {
      type: "number",
      description:
        "How long to await a new cell before returning a resumable cell_id. Defaults to 30000ms.",
    },
    cell_id: {
      type: "string",
      description: "ID returned by a running code cell.",
    },
    wait_ms: {
      type: "number",
      description:
        "How long to observe cell_id for terminal output. Defaults to 10000ms.",
    },
    terminate: {
      type: "boolean",
      description:
        "Stop cell_id. This resets the runtime, so bindings are lost.",
    },
  },
};

/** Replay policy (`ToolReplayPolicy` in ../types.ts). Arbitrary code that can call effectful nested tools. */
export const CODE_TOOL_REPLAY = "unsafe" as const;
