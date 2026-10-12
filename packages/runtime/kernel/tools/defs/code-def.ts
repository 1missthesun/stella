/**
 * The `code` tool's model-visible surface, split from the executable
 * definition so workerd hosts advertise the byte-identical tool. The kernel
 * behind it uses `worker_threads`; the cloud DO substitutes its own Dynamic
 * Worker executor for that name.
 */

/** Shared by the device and cloud `code` descriptions. */
export const CODE_TOOL_HISTORY_SENTENCE =
  "history: await history.search(text, { kinds, limit, order }) finds messages and agent reports in this conversation's whole history, await history.sql(query, params) runs one read-only SELECT over it, and await history.read(fromSeq, toSeq) returns its full records for a seq range.";

export const CODE_TOOL_DESCRIPTION =
  "Run JavaScript with top-level await in Stella's persistent code runtime; bindings persist within one generation (use var for reusable names). Globals: codeRuntime, sky, browser, connect, history, and tools; the stella-computer and stella-browser skills document sky and browser, and codeRuntime.help() lists its helpers. End with an expression to return its value; codeRuntime.write(...) and console.log also print. A long cell yields a cell_id: call code again with it to read new output or terminate it. A failed cell returns the output it printed before the error. tools exposes allowed Stella tools: tools.$list() for exact names (bracket notation for non-identifier names, such as tools[\"mcp.server/tool\"](...)), tools.$search({ query: \"<capability>\" }) for ranked signatures, and tools.$describe(name) for a complete schema. Use Promise.all for independent calls. Nested calls keep permissions, cancellation, and file tracking; tools requiring explicit approval must be called directly. " +
  CODE_TOOL_HISTORY_SENTENCE;

/**
 * The orchestrator's `code`: the same runtime without `sky` and `browser`
 * (computer use and browser control belong to agents), with its file access
 * stated plainly.
 */
export const CODE_TOOL_ORCHESTRATOR_DESCRIPTION =
  "Run JavaScript with top-level await in Stella's persistent code runtime on the computer you run on; use var for bindings you reuse. Globals: codeRuntime, connect, history, memory (when on), and tools. node:fs reads, writes and edits files there (absolute paths); codeRuntime.emitImage(path) shows you an image. No process spawning. End with an expression to return it; console.log and codeRuntime.write print. A long cell yields a cell_id to call code with again. tools.$list(), tools.$search({ query }) and tools.$describe(name) find tools; call them as tools.<name>(args) (bracket notation for other names). " +
  CODE_TOOL_HISTORY_SENTENCE;

export const CODE_TOOL_PROMPT_SNIPPET =
  "Run persistent JavaScript, orchestrate allowed Stella tools, and control apps through the sky/browser/connect globals";

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
