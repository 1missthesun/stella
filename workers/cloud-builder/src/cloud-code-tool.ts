import type { TSchema } from "@sinclair/typebox";
import type {
  AgentTool,
  AgentToolResult,
} from "@stella/runtime/kernel/agent-core/types.js";
import type { Value as TypeBoxValue } from "@sinclair/typebox/value";
import {
  CODE_TOOL_NAME,
  LEGACY_NODE_REPL_TOOL_NAME,
  toolRequiresExplicitApproval,
} from "@stella/runtime/kernel/tools/code-tool.js";
import { CODE_TOOL_HISTORY_SENTENCE } from "@stella/runtime/kernel/tools/defs/code-def.js";
import {
  buildDemotedCodeSuffix,
  describeToolCatalogEntry,
  searchToolCatalog,
  type DemotedToolCatalogEntry,
} from "@stella/runtime/kernel/tools/code-catalog.js";
import { sanitizeToolVisibleText } from "@stella/runtime/kernel/tools/safety.js";
import type { ConnectorToolEntry } from "@stella/runtime/kernel/connectors/connector-tools.js";
import {
  runMemoryRequest,
  type MemoryClient,
} from "@stella/runtime/kernel/memory/memory-client.js";
import { AgentToolSuspendedError } from "@stella/runtime/kernel/agent-core/suspension.js";
import {
  isMapRouteArtifact,
  type MapRouteArtifact,
} from "@stella/contracts/map-artifact";
import {
  boundedJsonPreview,
  cloneBoundedJsonValue,
  truncateUtf8,
  type BoundedJsonLimits,
} from "./cloud-code-bounds.js";
import {
  CLOUD_CODE_MAX_CONCURRENT_TOOL_CALLS,
  CLOUD_CODE_MAX_SOURCE_BYTES,
  CLOUD_CODE_MAX_TIMEOUT_MS,
  CLOUD_CODE_MAX_TOOL_CALLS,
  CloudCodeNestedToolError,
  executeCloudCode,
  prepareCloudCodeTools,
  type CloudCodeExecutionRequest,
  type CloudCodeExecutionResult,
  type CloudCodeIntrinsic,
  type CloudCodeToolDefinition,
} from "./cloud-code-executor.js";
import {
  CLOUD_CODE_BROWSER_INTRINSIC,
  CLOUD_CODE_CONNECT_INTRINSIC,
  CLOUD_CODE_DESCRIBE_INTRINSIC,
  CLOUD_CODE_HISTORY_INTRINSIC,
  CLOUD_CODE_MEMORY_INTRINSIC,
  CLOUD_CODE_SEARCH_INTRINSIC,
} from "./cloud-code-worker-executor.js";
import { sha256Hex } from "./hash.js";
import type {
  CloudBrowserClient,
  CloudBrowserScreenshot,
} from "./cloud-browser.js";
import type { ToolReplayPolicy } from "./tool-replay.js";
import { historyReadView } from "@stella/contracts/history-search";

const CLOUD_CODE_MODEL_OUTPUT_MAX_BYTES = 50_000;
const CLOUD_CODE_NESTED_RESULT_MAX_BYTES = 128 * 1024;
const MAX_INLINE_TOOL_DESCRIPTION_CHARS = 96_000;
const TOOL_DESCRIPTION_CHUNK_CHARS = 64_000;
const MAX_LIFTED_MAPS = 3;
const MAX_LIFTED_SCREENSHOTS = 3;

type LiftedScreenshot = CloudBrowserScreenshot["image"];

/**
 * Tools that never appear inside code. Same set the device kernel excludes:
 * code itself (no recursion), its legacy alias, and the parallel dispatcher.
 */
const CODE_EXCLUDED_TOOL_NAMES: ReadonlySet<string> = new Set([
  CODE_TOOL_NAME,
  LEGACY_NODE_REPL_TOOL_NAME,
  "multi_tool_use_parallel",
]);

const cloudCodeToolDescription = (browser: boolean): string =>
  `Run JavaScript with top-level await in Stella's cloud code runtime — a fresh isolated sandbox per call. Call the immutable globals directly: connect, history, tools${browser ? ", and browser" : ""}. End with an expression to return its value; console.log lines come back in a [console] section. Bindings do not persist between calls and there is no cell_id, codeRuntime, or sky${browser ? "" : ", or browser"} in this session, so do the whole computation in one call and return a structured-cloneable value. The sandbox has no network and no secrets of its own; reach the outside world only through tools${browser ? ", connect, and browser" : " and connect"}. ${browser ? `${CLOUD_CODE_BROWSER_SENTENCE} ` : ""}tools exposes allowed Stella tools. Use tools.$list() for exact names/access expressions; non-identifier names require bracket notation such as tools[\"mcp.server/tool\"](...). Use tools.$search({ query: \"<capability>\" }) for ranked signatures, and tools.$describe(name) for a complete unfamiliar schema. Use Promise.all for independent calls. Nested tools retain permissions, cancellation, and route artifacts, and a failing nested call rejects with the tool's own error so you can catch it; tools requiring explicit approval are unavailable inside code and must be called directly. Every action of a connected service is a tool here too, named <service>_<action> (tools.gmail_send_email) and found with tools.$search; connect manages the connections themselves (connect.documentation()). ` +
  `${CODE_TOOL_HISTORY_SENTENCE} ` +
  `One execution may make at most ${CLOUD_CODE_MAX_TOOL_CALLS} nested tool calls, with at most ${CLOUD_CODE_MAX_CONCURRENT_TOOL_CALLS} running concurrently, and runs for at most ${Math.round(CLOUD_CODE_MAX_TIMEOUT_MS / 1000)} seconds.`;

const CLOUD_CODE_BROWSER_SENTENCE =
  `browser drives Stella's private cloud browser (one persistent signed-in profile, kept between turns; it is not the user's own browser). Each method is one awaited command. browser.open(url, { allowedOrigins? }) starts at an https URL and limits navigation to its origin plus allowedOrigins. browser.open, navigate(url), observe(), back(), forward(), and reload() return { url, title, text, elements }: text is the page's visible text, and elements lists the visible controls as { ref, role, name, selector?, href?, checked?, disabled?, sensitive? } (sensitive marks password, email, code, and card fields). Selectors are Playwright selectors (CSS, text=, role=, xpath=, chains) or ref=eN from the latest observation; refs change after navigation, so observe again. Actions: click(selector), fill(selector, value), press(selector, key), select(selector, value), check(selector), uncheck(selector), hover(selector), text(selector), wait(selector, timeoutMs?), and scroll({ direction?, amount?, selector? }). browser.evaluate(script, arg?) runs a JavaScript expression, or a function source string called with arg, in the page and returns its JSON result (use it for DOM reads, localStorage, or same-origin fetch with the page's session). browser.cookies(urls?), setCookies(cookies), and clearCookies() manage the profile's cookies. browser.requests({ limit? }) lists recent network requests and responseBody(url) returns one response's body. browser.screenshot({ fullPage? }) attaches a picture to this code call's result (up to ${MAX_LIFTED_SCREENSHOTS} per call). Also tabs(), focusTab(tabId), and close(). For signing in, prefer handing the login to the user: call browser.requestLoginTakeover({ allowedOrigins: [origin], displayOrigin: origin, startUrl?, displayTitle?, verification: { expectedOrigin: origin, authenticatedSelector, loggedOutSelector, resumeUrl } }) with one exact https origin everywhere. loggedOutSelector names something visible now only when signed out; authenticatedSelector names something that appears only once signed in (such as text=Sign out); they must differ and cannot be refs. It hands the login screen to the user on their phone or desktop and pauses this task until they finish: make it the last call in that code cell. Type a password or card number yourself only when the user gave it to you in this conversation. When the task continues, this code call's result says whether sign-in was approved, canceled, or expired; on approval, browser.open the site again and carry on signed in.`;

const CLOUD_CODE_PARAMETERS = {
  type: "object",
  properties: {
    code: {
      type: "string",
      minLength: 1,
      maxLength: CLOUD_CODE_MAX_SOURCE_BYTES,
      description: "JavaScript to evaluate with top-level await.",
    },
    timeout_ms: {
      type: "integer",
      minimum: 1,
      maximum: CLOUD_CODE_MAX_TIMEOUT_MS,
      description: "Optional evaluation timeout in milliseconds.",
    },
  },
  required: ["code"],
  additionalProperties: false,
} as const;

type CloudCodeParameters = Readonly<{
  code: string;
  timeout_ms?: number;
}>;

export type CloudCodeSourceAgentTool = AgentTool & {
  approval?: unknown;
  outputSchema?: TSchema;
  workingText?: string;
  demoted?: {
    searchTerms?: readonly string[];
    requiredConnectorProvider?: string;
  };
  replay?: ToolReplayPolicy;
};

export type CloudConnectClient = Readonly<{
  discover(query: string): Promise<unknown>;
  connectors(): Promise<unknown>;
  addMcp(options: Readonly<Record<string, unknown>>): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  tools(reserved?: ReadonlySet<string>): Promise<ConnectorToolEntry[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    reserved?: ReadonlySet<string>,
  ): Promise<unknown>;
}>;

export type CloudHistoryClient = Readonly<{
  search(text: string, options: unknown): Promise<unknown>;
  sql(query: string, params: readonly SqlStorageValue[]): unknown;
  read(fromSeq: number, toSeq: number): Promise<unknown>;
}>;

export type CloudCodeExecute = (
  request: CloudCodeExecutionRequest,
) => Promise<CloudCodeExecutionResult>;

export type CreateCloudCodeAgentToolOptions = Readonly<{
  loader: WorkerLoader;
  tools: readonly CloudCodeSourceAgentTool[];
  executionScope: string;
  connect?: CloudConnectClient;
  history?: CloudHistoryClient;
  memory?: MemoryClient;
  browser?: CloudBrowserClient;
  executeCode?: CloudCodeExecute;
}>;

const NESTED_RESULT_LIMITS: BoundedJsonLimits = Object.freeze({
  maxBytes: CLOUD_CODE_NESTED_RESULT_MAX_BYTES,
  maxDepth: 16,
  maxNodes: 4_096,
  maxEntries: 4_096,
  maxStringBytes: CLOUD_CODE_NESTED_RESULT_MAX_BYTES,
});

export const isCloudCodeReachableTool = (
  tool: Pick<CloudCodeSourceAgentTool, "name" | "approval">,
): boolean =>
  !CODE_EXCLUDED_TOOL_NAMES.has(tool.name) &&
  !tool.name.startsWith("$") &&
  !toolRequiresExplicitApproval(tool.approval);

const modelTextForResult = (result: CloudCodeExecutionResult): string => {
  const sections: string[] = [];
  if (result.ok) {
    sections.push(
      result.result === undefined
        ? ""
        : typeof result.result === "string"
          ? result.result
          : boundedJsonPreview(result.result, CLOUD_CODE_MODEL_OUTPUT_MAX_BYTES),
    );
  } else {
    sections.push(`Error (${result.code}): ${result.error}`);
  }
  if (result.logs && result.logs.length > 0) {
    sections.push(`[console]\n${result.logs.join("\n")}`);
  }
  return truncateUtf8(
    sanitizeToolVisibleText(sections.filter(Boolean).join("\n\n")),
    CLOUD_CODE_MODEL_OUTPUT_MAX_BYTES,
  );
};

const textOfContent = (
  content: AgentToolResult<unknown>["content"],
): string | null => {
  if (content.length === 1 && content[0]?.type === "text") {
    return content[0].text;
  }
  const texts = content.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
  return texts.length === content.length && texts.length > 0
    ? texts.join("\n")
    : null;
};

const structuredText = (text: string): unknown => {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return text;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return text;
  }
};

const nestedValueForCode = (
  rawName: string,
  result: AgentToolResult<unknown>,
): unknown => {
  if (result.isError) {
    throw new CloudCodeNestedToolError(
      textOfContent(result.content) ?? `Nested tool "${rawName}" failed.`,
    );
  }
  const text = textOfContent(result.content);
  const value = cloneBoundedJsonValue(
    text === null ? { content: result.content } : structuredText(text),
    NESTED_RESULT_LIMITS,
  );
  if (!value.ok) {
    throw new CloudCodeNestedToolError(
      `Nested tool "${rawName}" returned too much data.`,
    );
  }
  return value.value;
};

const collectLiftedMaps = (
  details: unknown,
  sink: MapRouteArtifact[],
): void => {
  if (!details || typeof details !== "object" || Array.isArray(details)) return;
  const record = details as Record<string, unknown>;
  const candidates = Array.isArray(record.maps) ? record.maps : [record.map];
  for (const candidate of candidates) {
    if (sink.length >= MAX_LIFTED_MAPS) return;
    if (isMapRouteArtifact(candidate)) sink.push(candidate);
  }
};

/**
 * TypeBox's `Value.Check` validates without code generation, which is what
 * makes it usable inside workerd: Workers forbid `new Function`, so an
 * Ajv-compiled validator can never run here. The module is loaded lazily,
 * only once a turn actually builds the Code tool, so it stays off the
 * Durable Object's startup path.
 */
type TypeBoxValueModule = typeof TypeBoxValue;

let typeBoxValuePromise: Promise<TypeBoxValueModule> | undefined;

const loadTypeBoxValue = (): Promise<TypeBoxValueModule> =>
  (typeBoxValuePromise ??= import("@sinclair/typebox/value").then(
    (module) => module.Value,
  ));

const definitionForAgentTool = (
  tool: CloudCodeSourceAgentTool,
  value: TypeBoxValueModule,
  liftedMaps: Map<string, MapRouteArtifact[]>,
): CloudCodeToolDefinition => ({
  rawName: tool.name,
  description: tool.description,
  inputSchema: tool.parameters,
  ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  approval: toolRequiresExplicitApproval(tool.approval)
    ? "required"
    : "not_required",
  execute: async (input, context) => {
    // TypeBox schemas can be checked without eval in workerd. Some discovered
    // MCP sources provide plain JSON Schema instead; those tools retain their
    // own host-side validation rather than compiling untrusted schemas with
    // Ajv/new Function in the Worker.
    if (
      Object.getOwnPropertySymbols(tool.parameters).includes(
        Symbol.for("TypeBox.Kind"),
      ) &&
      !value.Check(tool.parameters, input)
    ) {
      throw new CloudCodeNestedToolError(
        `Nested tool "${tool.name}" received invalid arguments.`,
      );
    }
    const result = await tool.execute(
      context.toolCallId,
      input as Record<string, unknown>,
      context.signal,
    );
    const sink = liftedMaps.get(context.executionId);
    if (sink) collectLiftedMaps(result.details, sink);
    return nestedValueForCode(tool.name, result);
  },
});

const catalogEntryForTool = (
  tool: CloudCodeSourceAgentTool,
): DemotedToolCatalogEntry & {
  description: string;
  parameters: Record<string, unknown>;
} => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters as unknown as Record<string, unknown>,
  ...(tool.outputSchema
    ? { outputSchema: tool.outputSchema as unknown as Record<string, unknown> }
    : {}),
  ...(tool.approval !== undefined ? { approval: tool.approval } : {}),
  ...(tool.label ? { label: tool.label } : {}),
  ...(tool.workingText ? { workingText: tool.workingText } : {}),
  ...(tool.demoted ? { demoted: tool.demoted } : {}),
});

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const searchIntrinsic =
  (catalog: readonly DemotedToolCatalogEntry[]): CloudCodeIntrinsic =>
  async (input) => {
    const args = asRecord(input);
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) {
      throw new Error("tools.$search requires a non-empty query string.");
    }
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    return searchToolCatalog(catalog, query, limit);
  };

const describeIntrinsic =
  (
    catalog: readonly (DemotedToolCatalogEntry & {
      description: string;
      parameters: Record<string, unknown>;
    })[],
  ): CloudCodeIntrinsic =>
  async (input) => {
    const args = asRecord(input);
    const name = typeof args.name === "string" ? args.name.trim() : "";
    const tool = catalog.find((entry) => entry.name === name);
    if (!tool) {
      throw new Error(
        `Tool "${name}" is unknown or not available to describe in this context.`,
      );
    }
    const description = describeToolCatalogEntry(tool);
    const serialized = JSON.stringify(description);
    const cursor = typeof args.cursor === "number" ? args.cursor : undefined;
    if (serialized.length <= MAX_INLINE_TOOL_DESCRIPTION_CHARS) {
      if (cursor !== undefined && cursor !== 0) {
        throw new Error(
          `Tool "${name}" does not have another description page.`,
        );
      }
      return description;
    }
    const start = cursor ?? 0;
    if (start >= serialized.length) {
      throw new Error(
        `Tool "${name}" description cursor is past the end of the document.`,
      );
    }
    let end = Math.min(serialized.length, start + TOOL_DESCRIPTION_CHUNK_CHARS);
    if (end < serialized.length && /[\uD800-\uDBFF]/.test(serialized.charAt(end - 1))) {
      end -= 1;
    }
    const nextCursor = end < serialized.length ? end : undefined;
    return {
      name,
      complete: nextCursor === undefined,
      format: "lossless-json-chunks",
      totalChars: serialized.length,
      totalBytes: new TextEncoder().encode(serialized).byteLength,
      sha256: await sha256Hex(serialized),
      cursor: start,
      chunk: serialized.slice(start, end),
      ...(nextCursor !== undefined ? { nextCursor } : {}),
      instruction:
        "Concatenate chunk values in cursor order, requesting each nextCursor with await tools.$describe(name, { cursor: nextCursor }), then JSON.parse the exact combined string. No schema fields were clipped.",
    };
  };

type ConnectMethod = "discover" | "connectors" | "addMcp" | "remove";

const CONNECT_METHODS: ReadonlySet<string> = new Set<ConnectMethod>([
  "discover",
  "connectors",
  "addMcp",
  "remove",
]);

const connectIntrinsic =
  (client: CloudConnectClient | undefined): CloudCodeIntrinsic =>
  async (input) => {
    const request = asRecord(input);
    const method = typeof request.method === "string" ? request.method : "";
    if (!CONNECT_METHODS.has(method)) {
      throw new Error(`connect.${method || "?"} is not a connect method.`);
    }
    if (!client) {
      throw new Error(
        "connect is unavailable in this session: connected services could not be reached.",
      );
    }
    return await invokeCloudConnect(
      client,
      method,
      Array.isArray(request.args) ? request.args : [],
    );
  };

export const invokeCloudConnect = async (
  client: CloudConnectClient,
  method: string,
  args: readonly unknown[],
): Promise<unknown> => {
  if (!CONNECT_METHODS.has(method)) {
    throw new Error(`connect.${method || "?"} is not a connect method.`);
  }
  switch (method as ConnectMethod) {
    case "discover":
      return await client.discover(String(args[0] ?? ""));
    case "connectors":
      return await client.connectors();
    case "addMcp":
      return await client.addMcp(asRecord(args[0]));
    case "remove":
      return await client.remove(String(args[0] ?? ""));
  }
};

const historyIntrinsic =
  (client: CloudHistoryClient | undefined): CloudCodeIntrinsic =>
  async (input) => {
    const request = asRecord(input);
    const args = Array.isArray(request.args) ? request.args : [];
    if (!client) {
      throw new Error("history is unavailable in this session.");
    }
    switch (request.method) {
      case "search":
        if (typeof args[0] !== "string" || !args[0].trim()) {
          throw new Error("history.search requires the text to look for.");
        }
        return await client.search(args[0], args[1] ?? {});
      case "sql":
        if (typeof args[0] !== "string" || !args[0].trim()) {
          throw new Error("history.sql requires a non-empty query string.");
        }
        if (args[1] !== undefined && !Array.isArray(args[1])) {
          throw new Error("history.sql params must be an array.");
        }
        return client.sql(args[0], (args[1] ?? []) as SqlStorageValue[]);
      case "read":
        if (!Number.isSafeInteger(args[0]) || !Number.isSafeInteger(args[1])) {
          throw new Error("history.read requires integer fromSeq and toSeq.");
        }
        {
          const rows = await client.read(args[0] as number, args[1] as number);
          return asRecord(args[2]).raw === true ? rows : historyReadView(rows);
        }
      default:
        throw new Error(
          `history.${String(request.method ?? "?")} is not a history method.`,
        );
    }
  };

const memoryIntrinsic =
  (client: MemoryClient): CloudCodeIntrinsic =>
  async (input) =>
    await runMemoryRequest(client, input);

const isScreenshotResult = (
  value: unknown,
): value is CloudBrowserScreenshot =>
  Boolean(value) &&
  typeof value === "object" &&
  typeof (value as { image?: { data?: unknown } }).image?.data === "string";

const browserIntrinsic =
  (
    client: CloudBrowserClient,
    screenshots: Map<string, LiftedScreenshot[]>,
  ): CloudCodeIntrinsic =>
  async (input, context) => {
    const request = asRecord(input);
    const method = typeof request.method === "string" ? request.method : "";
    const args = Array.isArray(request.args) ? request.args : [];
    if (method === "screenshot") {
      const sink = screenshots.get(context.executionId);
      if (!sink) throw new Error("browser.screenshot ran outside a code call.");
      if (sink.length >= MAX_LIFTED_SCREENSHOTS) {
        throw new Error(
          `One code call can take at most ${MAX_LIFTED_SCREENSHOTS} screenshots.`,
        );
      }
      const result = await client.call(method, args, context.signal);
      if (!isScreenshotResult(result)) {
        throw new Error("Cloud browser returned an invalid screenshot.");
      }
      sink.push(result.image);
      return {
        screenshot: `attached as image ${sink.length} of this code call's result`,
        width: result.image.width,
        height: result.image.height,
      };
    }
    return await client.call(method, args, context.signal);
  };

export const createCloudCodeAgentTool = async (
  options: CreateCloudCodeAgentToolOptions,
): Promise<AgentTool> => {
  const sourceTools = options.tools.filter(isCloudCodeReachableTool);
  const value = await loadTypeBoxValue();
  const liftedMaps = new Map<string, MapRouteArtifact[]>();
  const liftedScreenshots = new Map<string, LiftedScreenshot[]>();
  const prepared = await prepareCloudCodeTools(
    sourceTools.map((tool) => definitionForAgentTool(tool, value, liftedMaps)),
  );
  const catalog = sourceTools.map(catalogEntryForTool);
  const demoted = catalog.filter((entry) => entry.demoted !== undefined);
  const reservedNames: ReadonlySet<string> = new Set(
    sourceTools.map((tool) => tool.name),
  );
  const connect = options.connect;
  const intrinsics: Record<string, CloudCodeIntrinsic> = {
    [CLOUD_CODE_CONNECT_INTRINSIC]: connectIntrinsic(connect),
    [CLOUD_CODE_HISTORY_INTRINSIC]: historyIntrinsic(options.history),
    ...(options.browser
      ? {
          [CLOUD_CODE_BROWSER_INTRINSIC]: browserIntrinsic(
            options.browser,
            liftedScreenshots,
          ),
        }
      : {}),
    ...(options.memory
      ? {
          [CLOUD_CODE_MEMORY_INTRINSIC]: memoryIntrinsic(options.memory),
        }
      : {}),
  };
  const executeCode = options.executeCode ?? executeCloudCode;

  return {
    name: CODE_TOOL_NAME,
    label: "Code",
    workingText: "Running code",
    description: `${cloudCodeToolDescription(Boolean(options.browser))}${buildDemotedCodeSuffix(demoted)}`,
    parameters: CLOUD_CODE_PARAMETERS as unknown as TSchema,
    execute: async (toolCallId, params, signal) => {
      const args = params as CloudCodeParameters;
      const executionId = `code:${await sha256Hex(
        `${options.executionScope}\0${toolCallId}`,
      )}`;
      const sink: MapRouteArtifact[] = [];
      liftedMaps.set(executionId, sink);
      const screenshots: LiftedScreenshot[] = [];
      liftedScreenshots.set(executionId, screenshots);
      const connectorTools = connect
        ? await connect.tools(reservedNames).catch(() => [])
        : [];
      const liveCatalog = [...catalog, ...connectorTools];
      let result: CloudCodeExecutionResult;
      try {
        result = await executeCode({
          loader: options.loader,
          code: args.code,
          tools: prepared,
          executionId,
          intrinsics: {
            ...intrinsics,
            [CLOUD_CODE_SEARCH_INTRINSIC]: searchIntrinsic(liveCatalog),
            [CLOUD_CODE_DESCRIBE_INTRINSIC]: describeIntrinsic(liveCatalog),
          },
          ...(connect && connectorTools.length > 0
            ? {
                dynamicTools: Object.fromEntries(
                  connectorTools.map((entry) => [
                    entry.name,
                    async (input: unknown) =>
                      await connect.callTool(entry.name, asRecord(input), reservedNames),
                  ]),
                ),
              }
            : {}),
          ...(args.timeout_ms === undefined
            ? {}
            : { timeoutMs: args.timeout_ms }),
          ...(signal ? { signal } : {}),
        });
      } finally {
        liftedMaps.delete(executionId);
        liftedScreenshots.delete(executionId);
      }
      const suspension = options.browser?.suspension();
      if (suspension) throw new AgentToolSuspendedError(suspension);
      const text = modelTextForResult(result);
      const maps = sink;
      return {
        content: [
          { type: "text", text },
          ...screenshots.map((image) => ({
            type: "image" as const,
            data: image.data,
            mimeType: image.mimeType,
          })),
        ],
        details: {
          code: result.ok
            ? { ok: true, output: text, toolCallId }
            : {
                ok: false,
                code: result.code,
                error: result.error,
                ...(result.tool ? { tool: result.tool } : {}),
                ...(result.cleanup ? { cleanup: result.cleanup } : {}),
                toolCallId,
              },
          ...(maps.length > 0 ? { maps } : {}),
        },
        isError: !result.ok,
      };
    },
  };
};
