/**
 * The user's message takes over the main chat's turn. Whatever the turn is
 * doing when a message arrives ends early, on every engine, so the message is
 * read next: a model response that is thinking or writing a call is cut
 * (reply text already being written is let finish), a running tool call is
 * handed back, and one that has not started does not start. The run itself
 * goes on with the message.
 *
 * It also bounds what a main-chat turn waits for: a model that went silent and
 * a tool call that never returns end by themselves.
 */
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Models,
  type TextContent,
} from "@earendil-works/pi-ai";
import {
  defineExtension,
  GenerationTask,
  hook,
  InboxDoc,
  LiveDoc,
  ProviderDoc,
  ToolTask,
  wrapTool,
  type Conversation,
  type ConversationId,
  type Extension,
  type Harness,
  type HookApi,
  type ToolExecutionResult,
  type ToolRegistration,
  type UserInput,
} from "@earendil-works/pi-durable";
import { isStopMessage } from "@stella/contracts/stop-message";
import { yieldToolCall } from "@stella/runtime/kernel/tools/tool-call-yield";
import { LOCAL_PROVIDER_ID } from "../provider/byok.ts";
import { noteCutCall, takeCutCall, TakenOver } from "../engine/taken-over.ts";
import { StellaAgentDoc } from "./agent-doc.ts";

export const TAKEOVER_EXTENSION = "stella-takeover";

/** A call that finishes by itself this soon is let finish. */
const CALL_GRACE_MS = 1_500;
/** How long a call asked to hand back early has before it is ended. */
const YIELD_GRACE_MS = 1_500;
/** Reply text that stops coming this long no longer holds the message back. */
const TEXT_STALL_MS = 4_000;
/** A stopped request whose connection or process doesn't let go by then is left behind. */
const ABORT_SETTLE_MS = 10_000;
const TICK_MS = 250;
const TAKEOVER_LIMIT_MS = 60_000;

/** A model request that has not begun to answer by then is given up and tried again. */
const MODEL_START_LIMIT_MS = 90_000;
/** The same for a response that goes silent midway; hidden reasoning can be quiet for a while. */
const MODEL_SILENCE_LIMIT_MS = 3 * 60_000;
/** After the computer slept or the process stood still, a connection that stays silent this long is dead. */
const AFTER_SLEEP_LIMIT_MS = 30_000;
const SLEEP_GAP_MS = 20_000;

const CALL_LIMIT_MS = 3 * 60_000;
/** Calls that wait for the user, or carry their own bound and can be slow by nature. */
const CALL_LIMITS_MS: Readonly<Record<string, number>> = {
  ask_user: Number.POSITIVE_INFINITY,
  request_secure_input: Number.POSITIVE_INFINITY,
  code: 11 * 60_000,
  image_gen: 15 * 60_000,
};

const AGENT_CALLS = ["spawn_agent", "send_message", "stop_agent", "agent_status", "switch_destination"] as const;

const CUT_CALL_TEXT =
  "Cut off: the user sent a new message while this ran. It may have partly run, or still finish by itself. Read the message first; repeat this only if it is still wanted and a check shows it didn't go through.";
const UNSTARTED_CALL_TEXT =
  "the user sent a new message before this ran, so it did not run. Read the message first; make the call again only if it is still wanted.";
const YIELDED_CALL_TEXT =
  "The user sent a new message, so Stella stopped waiting; the cell is still running. Read the message first. If the cell is no longer wanted, end it with terminate.";
const lateCallText = (name: string, ms: number): string =>
  `${name} had not finished after ${Math.round(ms / 60_000)} minutes, so Stella stopped waiting for it. It may still go through by itself: check before trying again, and say so plainly if it matters to the user.`;

const TAKEOVER_NOTE =
  "<system-reminder>The user sent this while you were still working, and it cut off what you were doing: anything you had not finished writing was dropped, and a call without a result did not finish. Do what this message says. What they asked before still stands unless this changes or cancels it. If they tell you to stop, stop what they mean (stop_agent for a task) and confirm in a few words.</system-reminder>";

const inputText = (content: UserInput): string =>
  typeof content === "string"
    ? content
    : content
        .flatMap((part) =>
          part.type === "text" && !(part as TextContent & { stella?: { hidden?: boolean } }).stella?.hidden ? [part.text] : [],
        )
        .join(" ");

/** What the user typed is only "stop", in some words. */
export const isStopInput = (content: UserInput): boolean => isStopMessage(inputText(content).trim());

export const withTakeoverNote = (content: UserInput): UserInput => {
  const note: TextContent & { stella: { hidden: true } } = { type: "text", text: TAKEOVER_NOTE, stella: { hidden: true } };
  return [...(typeof content === "string" ? [{ type: "text" as const, text: content }] : content), note];
};

type StreamArgs = Parameters<Models["streamSimple"]>;
type Phase = "opening" | "thinking" | "text" | "call";
type ActiveStream = { wanted: boolean; now: boolean; writing(): boolean; check(): void };

/** What a cut response leaves: the text the user may already have read, without thinking or half-written calls. */
const messageOf = (model: StreamArgs[0], partial: AssistantMessage | undefined): AssistantMessage =>
  partial
    ? {
        ...partial,
        content: partial.content.filter((part): part is TextContent => part.type === "text" && part.text.trim().length > 0),
        stopReason: "stop",
      }
    : {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };

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

/** What an engine driving a CLI knows about its own step. */
export type TakeoverEngine = {
  /** Cutting the step now would throw away the context it is compacting. */
  compacting(sessionId: string): boolean;
  /** The step waits for the user's plan or sign-in, which the chat shows. */
  holding(sessionId: string): boolean;
  /** When the CLI last showed a sign of life in the step under way. */
  lastSignAt(sessionId: string): number | undefined;
  /** The CLI runs this call itself: it cannot be kept from starting. */
  ownsCall(callId: string): boolean;
};

export type TakeoverOptions = {
  engines?: readonly TakeoverEngine[];
  /** A later user turn waits outside pi's inbox (the cloud queues each turn). */
  userWaiting?(): boolean;
};

export type Takeover = {
  models(models: Models): Models;
  extension: Extension;
  bind(harness: Harness, root: Conversation): void;
  /** Whether a message sent now would cut something (`now` as for `begin`). */
  cuts(context: Context, options?: { now?: boolean }): Promise<boolean>;
  /** Ends what the turn is doing so the waiting message is read; `now` also cuts reply text and gives calls no grace. */
  begin(context: Context, options?: { now?: boolean }): Promise<void>;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function createTakeover(options: TakeoverOptions, report: (error: unknown) => void): Takeover {
  const engines = options.engines ?? [];
  let harness: Harness | undefined;
  let root: Conversation | undefined;
  let rootSession: string | undefined;
  let queuedAtRequest = false;
  let under: { now: boolean } | undefined;
  const streams = new Map<string, ActiveStream>();
  const stalls = new Map<string, number>();
  const limits = new Map<string, ReturnType<typeof setTimeout>>();
  const late = new Map<string, string>();
  const yielded = new Set<string>();

  const userQueued = async (read: Pick<HookApi, "snapshot">, conversation: ConversationId, context: Context): Promise<boolean> =>
    options.userWaiting?.() === true ||
    ((await read.snapshot(InboxDoc, conversation, context))?.items.some((item) => item.mode === "steer") ?? false);

  const stream = (models: Models, args: StreamArgs) => {
    const [model, transcript, streamOptions] = args;
    const sessionId = streamOptions?.sessionId;
    if (!sessionId || sessionId !== rootSession) return models.streamSimple(...args);
    const out = createAssistantMessageEventStream();
    const controller = new AbortController();
    const outer = streamOptions?.signal;
    const fromOuter = () => {
      controller.abort(outer?.reason);
      setTimeout(() => {
        if (ended) return;
        release();
        const message: AssistantMessage = { ...messageOf(model, partial), content: partial?.content ?? [], stopReason: "aborted", errorMessage: "Stopped." };
        out.push({ type: "error", reason: "aborted", error: message });
        out.end(message);
      }, ABORT_SETTLE_MS);
    };
    if (outer?.aborted) fromOuter();
    else outer?.addEventListener("abort", fromOuter, { once: true });
    let partial: AssistantMessage | undefined;
    let phase: Phase = "opening";
    let begun = false;
    let lastEventAt = Date.now();
    let lastTickAt = Date.now();
    let sleptAt: number | undefined;
    let ended = false;

    const release = () => {
      ended = true;
      clearInterval(timer);
      outer?.removeEventListener("abort", fromOuter);
      if (streams.get(sessionId) === active) streams.delete(sessionId);
    };
    const end = (message: AssistantMessage, reason: unknown) => {
      if (ended || outer?.aborted) return;
      release();
      out.push(
        message.stopReason === "error"
          ? { type: "error", reason: "error", error: message }
          : { type: "done", reason: "stop", message },
      );
      out.end(message);
      controller.abort(reason);
    };
    const stalled = () => {
      const times = (stalls.get(sessionId) ?? 0) + 1;
      if (times > 1) stalls.delete(sessionId);
      else stalls.set(sessionId, times);
      report(new Error(`${model.provider}/${model.id} sent nothing for ${Math.round((Date.now() - lastEventAt) / 1000)} s; attempt ${times}.`));
      // pi tries an error that reads as a timeout again; the second in a row ends the turn.
      const errorMessage =
        times === 1
          ? "The model request timed out."
          : "The model stopped responding, also when Stella tried again. Your message is kept: send it again, or pick another model.";
      end({ ...messageOf(model, partial), content: [], stopReason: "error", errorMessage }, new Error(errorMessage));
    };
    const active: ActiveStream = {
      wanted: queuedAtRequest || options.userWaiting?.() === true,
      now: false,
      writing: () => phase === "text" && Date.now() - lastEventAt < TEXT_STALL_MS,
      check() {
        if (ended) return;
        const at = Date.now();
        if (active.wanted && !engines.some((engine) => engine.compacting(sessionId))) {
          if (active.now || !active.writing()) return end(messageOf(model, partial), new TakenOver());
        }
        if (at - lastTickAt > SLEEP_GAP_MS) sleptAt = at;
        lastTickAt = at;
        // A model on the user's own computer can take minutes to read a long conversation.
        if (model.provider === LOCAL_PROVIDER_ID || engines.some((engine) => engine.holding(sessionId) || engine.compacting(sessionId))) {
          lastEventAt = at;
          return;
        }
        const signAt = Math.max(lastEventAt, ...engines.map((engine) => engine.lastSignAt(sessionId) ?? 0));
        const silent = at - signAt;
        const limit = begun ? MODEL_SILENCE_LIMIT_MS : MODEL_START_LIMIT_MS;
        if (silent > limit || (sleptAt !== undefined && signAt < sleptAt && at - sleptAt > AFTER_SLEEP_LIMIT_MS)) stalled();
      },
    };
    const timer = setInterval(() => active.check(), TICK_MS);
    queuedAtRequest = false;
    streams.set(sessionId, active);

    void (async () => {
      active.check();
      if (ended) return;
      const inner = models.streamSimple(model, transcript, { ...streamOptions, signal: controller.signal });
      for await (const event of inner) {
        if (ended) return;
        lastEventAt = Date.now();
        phase = phaseOf(event) ?? phase;
        if ("partial" in event) partial = event.partial;
        if (phase !== "opening") begun = true;
        if (event.type === "done" || event.type === "error") {
          release();
          if (event.type === "done") stalls.delete(sessionId);
        }
        out.push(event);
        active.check();
      }
      const settled = ended && partial === undefined ? undefined : await inner.result();
      if (settled) {
        release();
        out.end(settled);
      }
    })().catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      end({ ...messageOf(model, partial), content: [], stopReason: "error", errorMessage }, error);
    });
    return out;
  };

  const cutCalls = async (since: Map<string, number>, now: boolean, context: Context): Promise<void> => {
    const live = await harness!.snapshot(LiveDoc, root!.id, context);
    for (const slot of live?.tools ?? []) {
      if (slot.taskId === undefined || slot.status === "done") continue;
      const first = since.get(slot.callId) ?? Date.now();
      since.set(slot.callId, first);
      const waited = Date.now() - first;
      if (!now && waited < CALL_GRACE_MS) continue;
      if (!now && !yielded.has(slot.callId) && yieldToolCall(slot.callId)) {
        yielded.add(slot.callId);
        continue;
      }
      if (yielded.has(slot.callId) && waited < CALL_GRACE_MS + YIELD_GRACE_MS) continue;
      noteCutCall(slot.callId);
      await harness!.abortTask(slot.taskId, context);
    }
  };

  const endedText = (call: { id: string; name: string }): string | undefined => {
    const lateText = late.get(call.id);
    late.delete(call.id);
    if (lateText !== undefined) return lateText;
    if (yielded.delete(call.id)) return takeCutCall(call.id) ? CUT_CALL_TEXT : YIELDED_CALL_TEXT;
    return takeCutCall(call.id) ? CUT_CALL_TEXT : undefined;
  };

  const extension = defineExtension({
    name: TAKEOVER_EXTENSION,
    // These talk to other computers and to the cloud, and end with their context only when that answers.
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
          queuedAtRequest = await userQueued(api, api.conversationId, context);
          return undefined;
        },
      }),
      hook(ToolTask, {
        beforeTool: async (call, api, context) => {
          if (api.conversationId !== root?.id) return undefined;
          if (!engines.some((engine) => engine.ownsCall(call.id)) && (await userQueued(api, api.conversationId, context))) {
            return { block: UNSTARTED_CALL_TEXT };
          }
          const limit = CALL_LIMITS_MS[call.name] ?? CALL_LIMIT_MS;
          if (Number.isFinite(limit) && !limits.has(call.id)) {
            limits.set(
              call.id,
              setTimeout(() => {
                limits.delete(call.id);
                if (yieldToolCall(call.id)) return;
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
          const text = endedText(call);
          return text === undefined
            ? undefined
            : {
                ...result,
                output: [...(result.output ?? []), { type: "text", text }],
                ...(text === YIELDED_CALL_TEXT ? {} : { isError: true }),
              };
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
    async cuts(context, { now = false } = {}) {
      if (!harness || !root) return false;
      const live = await harness.snapshot(LiveDoc, root.id, context);
      if (!live?.run) return false;
      const active = rootSession ? streams.get(rootSession) : undefined;
      return active ? now || !active.writing() : (live.tools?.length ?? 0) > 0;
    },
    async begin(context, { now = false } = {}) {
      if (!harness || !root) return;
      if (under) {
        under.now ||= now;
        return;
      }
      const mine = { now };
      under = mine;
      const since = new Map<string, number>();
      const deadline = Date.now() + TAKEOVER_LIMIT_MS;
      try {
        while (Date.now() < deadline) {
          if (!(await harness.snapshot(LiveDoc, root.id, context))?.run) return;
          if (!(await userQueued(harness, root.id, context))) return;
          const active = rootSession ? streams.get(rootSession) : undefined;
          if (active) {
            active.wanted = true;
            active.now ||= mine.now;
            active.check();
          }
          await cutCalls(since, mine.now, context);
          await sleep(TICK_MS);
        }
      } finally {
        if (under === mine) under = undefined;
      }
    },
  };
}
