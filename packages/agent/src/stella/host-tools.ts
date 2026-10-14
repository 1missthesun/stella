import type { Context, JsonValue } from "@earendil-works/chord";
import { withAbortSignal, withoutAbortSignal } from "@earendil-works/chord/context";
import type { ImageContent, TextContent, TSchema } from "@earendil-works/pi-ai";
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import { defineExtension, type Extension, type ToolRegistration } from "@earendil-works/pi-durable";
import {
  needsProviderToolSchemaNormalization,
  normalizeProviderToolInputSchema,
} from "@stella/runtime/kernel/tools/provider-tool-schema";
import { StellaAgentDoc } from "./agent-doc.ts";

export const STELLA_ORCHESTRATOR_TOOLS = "stella-tools-orchestrator";
export const STELLA_AGENT_TOOLS = "stella-tools-agent";

export type StellaToolRole = "orchestrator" | "general";

export const STELLA_HARNESS_TOOL_NAMES: ReadonlySet<string> = new Set([
  "spawn_agent",
  "send_message",
  "stop_agent",
  "agent_status",
  "Bash",
  "exec_command",
  "write_stdin",
  "apply_patch",
  "Write",
  "Edit",
  "Grep",
  "multi_tool_use_parallel",
  "NoResponse",
  "node_repl",
  "switch_destination",
]);

export type StellaToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  replay?: "safe" | "keyed" | "unsafe";
  codeOnly?: { searchTerms?: readonly string[] };
};

export type StellaToolCall = {
  role: StellaToolRole;
  name: string;
  callId: string;
  args: Record<string, unknown>;
  threadId?: string;
};

export type StellaToolOutcome = {
  content: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
};

export interface StellaToolHost {
  specs(role: StellaToolRole): readonly StellaToolSpec[];
  run(call: StellaToolCall, context: Context): Promise<StellaToolOutcome>;
}

const jsonDetails = (details: unknown): JsonValue | undefined => {
  if (details === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(details)) as JsonValue;
  } catch {
    return undefined;
  }
};

/**
 * The schema the model is sent, and the check a call's arguments still pass.
 * Providers refuse different root keywords (OpenAI: a root `oneOf`, `not` or
 * `enum`; Anthropic: root combinators), and one refused tool fails the whole
 * request. A schema with any of them goes out loosened to one plain object,
 * and the call is checked against the original before it runs.
 */
const providerSchema = (
  spec: StellaToolSpec,
): Pick<ToolRegistration, "parameters" | "prepareArguments"> => {
  if (!needsProviderToolSchemaNormalization(spec.parameters)) {
    return { parameters: spec.parameters as unknown as TSchema };
  }
  const original = { name: spec.name, description: spec.description, parameters: spec.parameters as unknown as TSchema };
  return {
    parameters: normalizeProviderToolInputSchema(spec.parameters) as unknown as TSchema,
    prepareArguments: (args) =>
      validateToolArguments(original, { type: "toolCall", id: "", name: spec.name, arguments: (args ?? {}) as Parameters<typeof validateToolArguments>[1]["arguments"] }),
  };
};

const register = (role: StellaToolRole, spec: StellaToolSpec, host: StellaToolHost): ToolRegistration => ({
  name: spec.name,
  description: spec.description,
  ...providerSchema(spec),
  replay: spec.replay === "safe" || spec.replay === "keyed" ? "safe" : "unsafe",
  async execute(args, api, context) {
    const agent = role === "general" ? await api.snapshot(StellaAgentDoc, api.conversationId, context) : undefined;
    // pi-durable cancels a call's context when the call ends. Work a tool
    // leaves running (a code cell that yielded) must outlive the call, so the
    // host's signal follows the context only while the call is in flight.
    const controller = new AbortController();
    const parent = context.abortSignal;
    let stop: ((reason: unknown) => void) | undefined;
    const stopped = new Promise<never>((_, reject) => {
      stop = reject;
    });
    const forward = () => {
      controller.abort(parent?.reason);
      stop?.(parent?.reason ?? new Error(`Tool ${spec.name} was aborted`));
    };
    if (parent?.aborted) forward();
    else parent?.addEventListener("abort", forward, { once: true });
    let outcome: StellaToolOutcome;
    try {
      const running = host.run(
        {
          role,
          name: spec.name,
          callId: api.callId,
          args: (args ?? {}) as Record<string, unknown>,
          ...(agent?.threadId ? { threadId: agent.threadId } : {}),
        },
        withAbortSignal(controller.signal, withoutAbortSignal(context)),
      );
      running.catch(() => undefined);
      stopped.catch(() => undefined);
      outcome = await Promise.race([running, stopped]);
    } finally {
      parent?.removeEventListener("abort", forward);
    }
    const details = jsonDetails(outcome.details);
    return {
      content: outcome.content.length > 0 ? outcome.content : [{ type: "text", text: "(no output)" }],
      ...(outcome.isError ? { isError: true } : {}),
      ...(details === undefined ? {} : { details }),
    };
  },
});

export const STELLA_CODE_TOOL_NAME = "code";

export function stellaToolExtensions(host: StellaToolHost | undefined): Extension[] {
  const build = (role: StellaToolRole, name: string) => {
    const specs = host?.specs(role) ?? [];
    const code = specs.some((spec) => spec.name === STELLA_CODE_TOOL_NAME);
    return defineExtension({
      name,
      tools: host ? specs.filter((spec) => !(code && spec.codeOnly)).map((spec) => register(role, spec, host)) : [],
    });
  };
  return [build("orchestrator", STELLA_ORCHESTRATOR_TOOLS), build("general", STELLA_AGENT_TOOLS)];
}

export const agentToolSelection = { remove: [{ name: STELLA_ORCHESTRATOR_TOOLS }] } as const;
