import type { Context } from "@earendil-works/chord";
import { InboxDoc, type ToolExecutionApi, type ToolRegistration, type Wrap } from "@earendil-works/pi-durable";
import { StellaAgentDoc } from "./agent-doc.ts";

/**
 * A task's question or secure card goes to Stella before it reaches the user:
 * she holds the user's memory and this conversation, so she can often settle
 * it herself. The tool waits for her reply (her send_message, queued in the
 * task's inbox), which then reaches the task as its next input. With no reply in time, or once she has answered and the
 * task asks again, the card goes to the user as before. Values the user saved
 * on this computer are reused first, without asking anyone.
 */

const ASK_USER = "ask_user";
const REQUEST_SECURE_INPUT = "request_secure_input";
export const STELLA_FIRST_TOOLS: readonly string[] = [ASK_USER, REQUEST_SECURE_INPUT];

const STELLA_FIRST_WAIT_MS = 90_000;
const STELLA_FIRST_POLL_MS = 1_000;
/** After Stella replied, the task's next ask of the same kind goes straight to the user. */
const STELLA_FIRST_PASS_MS = 15 * 60_000;
const SECURE_INPUT_SAVED_ONLY_ARG = "__savedOnly";

export type StellaFirstHost = {
  /** Deliver a note to the Stella this agent works for, now. False when she can't be reached from here. */
  tellStella(api: ToolExecutionApi, key: string, message: string, context: Context): Promise<boolean>;
};

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object") : [];

const describeQuestions = (args: Record<string, unknown>): string =>
  list(args.questions)
    .map((question) => {
      const options = list(question.options)
        .map((option) => text(option.label, 80))
        .filter(Boolean)
        .join(" / ");
      const detail = text(question.detail, 300);
      return `- ${text(question.question, 300)}${options ? ` (${options})` : ""}${detail ? `: ${detail}` : ""}`;
    })
    .join("\n");

const describeSecureCard = (args: Record<string, unknown>): string => {
  const service = text(args.service, 120);
  const account = text(args.account, 120);
  const preset = text(args.preset, 16);
  const fields = list(args.fields)
    .map((field) => text(field.label, 80) || text(field.id, 48))
    .filter(Boolean);
  const asked = [preset === "login" ? "username and password" : preset === "card" ? "payment card" : "", ...fields]
    .filter(Boolean)
    .join(", ");
  const detail = text(args.detail, 400);
  return [
    `a secure card: "${text(args.purpose, 300)}"`,
    service ? ` for ${service}${account ? ` (account ${account})` : ""}` : "",
    asked ? `, asking for ${asked}` : "",
    args.replace_saved === true ? " (the value saved for it did not work)" : "",
    detail ? `. Detail: ${detail}` : "",
  ].join("");
};

const noteFor = (tool: string, args: Record<string, unknown>): string =>
  [
    tool === ASK_USER
      ? `Before asking the user, I'm checking with you. I'd ask them:\n${describeQuestions(args)}`
      : `Before asking the user, I'm checking with you. I'd show them ${describeSecureCard(args)}.`,
    `I'm waiting for your reply with send_message. If what you know settles it (a standing rule, memory, an earlier answer, or how to go on without it), tell me and the user sees nothing. If only the user can give it, say so and it goes to them. With no reply in ${STELLA_FIRST_WAIT_MS / 1000} seconds it goes to them anyway.`,
  ].join("\n\n");

const repliedText = (tool: string): string =>
  `Stella saw this before it reached the user, and replied; her message follows. Act on it. If she says only the user can give this, call ${tool} again and it goes straight to them.`;

const sleep = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

const FROM_STELLA = '<agent-message from="Stella"';

const inputText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : "")).join("\n")
      : "";

/** Queued messages from Stella in this agent's inbox, by submission id. */
const stellaMessages = async (api: ToolExecutionApi, context: Context): Promise<string[]> =>
  ((await api.snapshot(InboxDoc, api.conversationId, context))?.items ?? [])
    .filter((item) => item.mode !== "write" && inputText(item.content).includes(FROM_STELLA))
    .map((item) => String(item.id));

const notSaved = (result: Awaited<ReturnType<ToolRegistration["execute"]>>): boolean => {
  const details = (result as { details?: unknown } | undefined)?.details;
  return !!details && typeof details === "object" && (details as { outcome?: unknown }).outcome === "not_saved";
};

const markPass = (api: ToolExecutionApi, tool: string | undefined, context: Context) =>
  api.commit(async (tx) => {
    const role = await tx.doc(StellaAgentDoc, api.conversationId);
    if (tool) role.stellaReplied = { tool, at: Date.now() };
    else delete role.stellaReplied;
    return undefined;
  }, context);

const askStella = async (
  host: StellaFirstHost,
  tool: string,
  args: Record<string, unknown>,
  api: ToolExecutionApi,
  context: Context,
): Promise<boolean> => {
  const before = new Set(await stellaMessages(api, context));
  const told = await host
    .tellStella(api, `stella-first:${String(api.taskId)}`, noteFor(tool, args), context)
    .catch(() => false);
  if (!told) return false;
  const signal = context.abortSignal;
  const deadline = Date.now() + STELLA_FIRST_WAIT_MS;
  while (Date.now() < deadline && !signal?.aborted) {
    await sleep(Math.min(STELLA_FIRST_POLL_MS, deadline - Date.now()), signal);
    if ((await stellaMessages(api, context)).some((id) => !before.has(id))) return true;
  }
  if (signal?.aborted) throw signal.reason ?? new Error(`Tool ${tool} was aborted`);
  return false;
};

export const stellaFirstWraps = (host: StellaFirstHost): Wrap[] =>
  STELLA_FIRST_TOOLS.map((name) => ({
    tool: name,
    wrap: (tool: ToolRegistration): ToolRegistration => ({
      ...tool,
      async execute(args, api, context) {
        const role = await api.snapshot(StellaAgentDoc, api.conversationId, context);
        if (!role || role.agentType === "orchestrator" || !role.threadId) return await tool.execute(args, api, context);
        const input = (args ?? {}) as Record<string, unknown>;
        const replied = role.stellaReplied;
        if (replied?.tool === name && Date.now() - replied.at < STELLA_FIRST_PASS_MS) {
          await markPass(api, undefined, context);
          return await tool.execute(args, api, context);
        }
        if (name === REQUEST_SECURE_INPUT && input.replace_saved !== true) {
          const saved = await tool.execute({ ...input, [SECURE_INPUT_SAVED_ONLY_ARG]: true }, api, context);
          if (!notSaved(saved)) return saved;
        }
        if (!(await askStella(host, name, input, api, context))) return await tool.execute(args, api, context);
        await markPass(api, name, context);
        return { content: [{ type: "text", text: repliedText(name) }] };
      },
    }),
  }));
