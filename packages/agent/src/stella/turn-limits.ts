import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import { steadyNow } from "@stella/contracts/server-clock";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Message,
  type Models,
} from "@earendil-works/pi-ai";
import {
  defineExtension,
  GenerationTask,
  hook,
  ProviderDoc,
  ToolTask,
  wrapTool,
  type Conversation,
  type Extension,
  type Harness,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { LOCAL_PROVIDER_ID } from "../provider/byok.ts";
import { STELLA_PROVIDER_ID } from "../provider/stella.ts";
import { CLAUDE_CODE_PROVIDER_ID } from "../engine/selection.ts";
import { isContextHandoffNotesRequest } from "@stella/contracts/context-handoff";

const isBackgroundHandoffRequest = (messages: readonly Message[]): boolean => {
  const last = messages.at(-1);
  if (last?.role !== "user") return false;
  const text = typeof last.content === "string" ? last.content : last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
  return isContextHandoffNotesRequest(text);
};

export const TURN_LIMITS_EXTENSION = "stella-turn-limits";

const ABORT_SETTLE_MS = 10_000;
const TICK_MS = 250;

const MODEL_START_LIMIT_MS = 90_000;
const UNSTREAMED_LIMIT_MS = 5 * 60_000;
const MODEL_SILENCE_LIMIT_MS = 2 * 60_000;
const AUDIBLE_SILENCE_LIMIT_MS = 60_000;
const AFTER_SLEEP_LIMIT_MS = 30_000;
const SLEEP_GAP_MS = 20_000;

const CALL_LIMIT_MS = 3 * 60_000;
const CALL_LIMITS_MS: Readonly<Record<string, number>> = {
  ask_user: Number.POSITIVE_INFINITY,
  request_secure_input: Number.POSITIVE_INFINITY,
  code: Number.POSITIVE_INFINITY,
  image_gen: 15 * 60_000,
};

const AGENT_CALLS = ["spawn_agent", "send_message", "stop_agent", "agent_status", "switch_destination"] as const;

const lateCallText = (name: string, ms: number): string =>
  `${name} had not finished after ${Math.round(ms / 60_000)} minutes, so Stella stopped waiting for it. It may still go through by itself: check before trying again, and say so plainly if it matters to the user.`;

type StreamArgs = Parameters<Models["streamSimple"]>;
type Phase = "opening" | "thinking" | "text" | "call";

const emptyMessage = (model: StreamArgs[0]): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop",
  timestamp: Date.now(),
});

const phaseOf = (event: AssistantMessageEvent): Phase | undefined => {
  switch (event.type) {
    case "thinking_start":
    case "thinking_delta":
      return "thinking";
    case "text_delta":
      return "text";
    case "toolcall_start":
    case "toolcall_delta":
      return "call";
    default:
      return undefined;
  }
};

export type TurnLimitsEngine = {
  compacting(sessionId: string): boolean;
  holding(sessionId: string): boolean;
  lastSignAt(sessionId: string): number | undefined;
};

export type TurnLimitsOptions = {
  engines?: readonly TurnLimitsEngine[];
  watches?(provider: string): boolean;
};

export type TurnLimits = {
  models(models: Models): Models;
  extension: Extension;
  bind(harness: Harness, root: Conversation): void;
};

export function createTurnLimits(options: TurnLimitsOptions, report: (error: unknown) => void): TurnLimits {
  const engines = options.engines ?? [];
  let harness: Harness | undefined;
  let root: Conversation | undefined;
  let rootSession: string | undefined;
  const stalls = new Map<string, number>();
  const limits = new Map<string, ReturnType<typeof setTimeout>>();
  const late = new Map<string, string>();

  const stream = (models: Models, args: StreamArgs) => {
    const [model, transcript, streamOptions] = args;
    const sessionId = streamOptions?.sessionId;
    // A background handoff's notes request runs beside the turn, which the watchdog guards; it has a deadline of its own.
    if (!sessionId || sessionId !== rootSession || isBackgroundHandoffRequest(transcript.messages)) return models.streamSimple(...args);
    const out = createAssistantMessageEventStream();
    const controller = new AbortController();
    const outer = streamOptions?.signal;
    const fromOuter = () => {
      controller.abort(outer?.reason);
      setTimeout(() => {
        if (ended) return;
        release();
        const message: AssistantMessage = { ...(partial ?? emptyMessage(model)), stopReason: "aborted", errorMessage: "Stopped." };
        out.push({ type: "error", reason: "aborted", error: message });
        out.end(message);
      }, ABORT_SETTLE_MS);
    };
    if (outer?.aborted) fromOuter();
    else outer?.addEventListener("abort", fromOuter, { once: true });
    let partial: AssistantMessage | undefined;
    let phase: Phase = "opening";
    let begun = false;
    let lastEventAt = performance.now();
    let lastTickAt = performance.now();
    let lastSteadyAt = steadyNow();
    let sleptAt: number | undefined;
    let ended = false;

    const release = () => {
      ended = true;
      clearInterval(timer);
      outer?.removeEventListener("abort", fromOuter);
    };
    const end = (errorMessage: string, reason: unknown) => {
      if (ended || outer?.aborted) return;
      release();
      const message: AssistantMessage = { ...(partial ?? emptyMessage(model)), content: [], stopReason: "error", errorMessage };
      out.push({ type: "error", reason: "error", error: message });
      out.end(message);
      controller.abort(reason);
    };
    const stalled = () => {
      const times = (stalls.get(sessionId) ?? 0) + 1;
      if (times > 1) stalls.delete(sessionId);
      else stalls.set(sessionId, times);
      report(new Error(`${model.provider}/${model.id} sent nothing for ${Math.round((performance.now() - lastEventAt) / 1000)} s; attempt ${times}.`));
      // pi tries an error that reads as a timeout again; the second in a row ends the turn.
      const errorMessage =
        times === 1
          ? "The model request timed out."
          : "The model stopped responding, also when Stella tried again. Your message is kept: send it again, or pick another model.";
      end(errorMessage, new Error(errorMessage));
    };
    const check = () => {
      if (ended) return;
      const at = performance.now();
      const steadyAt = steadyNow();
      if (at - lastTickAt > SLEEP_GAP_MS || steadyAt - lastSteadyAt > SLEEP_GAP_MS) sleptAt = at;
      lastTickAt = at;
      lastSteadyAt = steadyAt;
      if (model.provider === LOCAL_PROVIDER_ID || options.watches?.(model.provider) === false || engines.some((engine) => engine.holding(sessionId) || engine.compacting(sessionId))) {
        lastEventAt = at;
        return;
      }
      const signs = engines.flatMap((engine) => engine.lastSignAt(sessionId) ?? []);
      const signAt = Math.max(lastEventAt, ...signs);
      const limit = !begun
        ? model.provider === STELLA_PROVIDER_ID
          ? UNSTREAMED_LIMIT_MS
          : MODEL_START_LIMIT_MS
        : model.provider === CLAUDE_CODE_PROVIDER_ID || phase === "text"
          ? AUDIBLE_SILENCE_LIMIT_MS
          : MODEL_SILENCE_LIMIT_MS;
      if (at - signAt > limit || (sleptAt !== undefined && signAt < sleptAt && at - sleptAt > AFTER_SLEEP_LIMIT_MS)) stalled();
    };
    const timer = setInterval(check, TICK_MS);

    void (async () => {
      const inner = models.streamSimple(model, transcript, { ...streamOptions, signal: controller.signal });
      for await (const event of inner) {
        if (ended) return;
        lastEventAt = performance.now();
        phase = phaseOf(event) ?? phase;
        if ("partial" in event) partial = event.partial;
        begun = true;
        if (event.type === "done" || event.type === "error") {
          release();
          if (event.type === "done") stalls.delete(sessionId);
        }
        out.push(event);
      }
      const settled = ended && partial === undefined ? undefined : await inner.result();
      if (settled) {
        release();
        out.end(settled);
      }
    })().catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      end(errorMessage, error);
    });
    return out;
  };

  const extension = defineExtension({
    name: TURN_LIMITS_EXTENSION,
    wraps: AGENT_CALLS.map((name) =>
      wrapTool({ name } as ToolRegistration, (inner) => ({
        ...inner,
        async execute(args, api, context) {
          const signal = context.abortSignal;
          if (api.conversationId !== root?.id || !signal) return await inner.execute(args, api, context);
          let onAbort = () => {};
          const aborted = new Promise<never>((_, reject) => {
            onAbort = () => reject(signal.reason ?? new Error(`Tool ${name} was aborted`));
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          });
          const running = inner.execute(args, api, context);
          running.catch(() => undefined);
          aborted.catch(() => undefined);
          try {
            return await Promise.race([running, aborted]);
          } finally {
            signal.removeEventListener("abort", onAbort);
          }
        },
      })),
    ),
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async (_request, api, context) => {
          if (api.conversationId !== root?.id) return undefined;
          rootSession = (await api.snapshot(ProviderDoc, api.conversationId, context))?.sessionId;
          return undefined;
        },
      }),
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          if (api.conversationId !== root?.id) return undefined;
          const limit = CALL_LIMITS_MS[call.name] ?? CALL_LIMIT_MS;
          if (Number.isFinite(limit) && !limits.has(call.id)) {
            limits.set(
              call.id,
              setTimeout(() => {
                limits.delete(call.id);
                late.set(call.id, lateCallText(call.name, limit));
                void harness?.abortTask(api.taskId, BACKGROUND_CONTEXT).catch(report);
              }, limit),
            );
          }
          return undefined;
        },
        afterTool: (call, result) => {
          clearTimeout(limits.get(call.id));
          limits.delete(call.id);
          const text = late.get(call.id);
          return text === undefined ? undefined : { ...result, output: [...(result.output ?? []), { type: "text", text }], isError: true };
        },
      }),
    ],
  });

  return {
    models: (models) =>
      new Proxy(models, {
        get(target, key, receiver) {
          if (key === "streamSimple") return (...args: StreamArgs) => stream(target, args);
          const value = Reflect.get(target, key, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    extension,
    bind(nextHarness, nextRoot) {
      harness = nextHarness;
      root = nextRoot;
    },
  };
}
