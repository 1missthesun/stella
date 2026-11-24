import type { Context } from "@earendil-works/chord/context";
import type { ConversationId, ToolExecutionApi, ToolRegistration, Tx, Wrap } from "@earendil-works/pi-durable";
import { PI_ASK_FIRST_PREFIX } from "@stella/contracts/pi-chat";
import { StellaAgentDoc } from "./agent-doc.ts";

const ASK_USER = "ask_user";
const REQUEST_SECURE_INPUT = "request_secure_input";
export const STELLA_FIRST_TOOLS: readonly string[] = [ASK_USER, REQUEST_SECURE_INPUT];

const STELLA_FIRST_WAIT_MS = 90_000;
const STELLA_FIRST_POLL_MS = 1_000;
const STELLA_FIRST_PASS_MS = 15 * 60_000;
const SECURE_INPUT_SAVED_ONLY_ARG = "__savedOnly";

export type StellaFirstHost = {
  tellStella(api: ToolExecutionApi, key: string, message: string, context: Context): Promise<boolean>;
};

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object") : [];

const QUESTION_MAX_CHARS = 2_000;
const OPTION_MAX_CHARS = 500;

const describeQuestions = (args: Record<string, unknown>): string =>
  list(args.questions)
    .map((question) => {
      const options = list(question.options)
        .map((option) => {
          const label = text(option.label, OPTION_MAX_CHARS);
          const hint = text(option.hint, OPTION_MAX_CHARS);
          return label ? `  - ${label}${hint ? ` (${hint})` : ""}` : "";
        })
        .filter(Boolean);
      const detail = text(question.detail, QUESTION_MAX_CHARS);
      return [`- ${text(question.question, QUESTION_MAX_CHARS)}`, ...(detail ? [`  ${detail}`] : []), ...options].join("\n");
    })
    .join("\n");

const describeSecureCard = (args: Record<string, unknown>): string => {
  const service = text(args.service, 200);
  const account = text(args.account, 200);
  const preset = text(args.preset, 16);
  const fields = list(args.fields)
    .map((field) => text(field.label, OPTION_MAX_CHARS) || text(field.id, 48))
    .filter(Boolean);
  const asked = [preset === "login" ? "username and password" : preset === "card" ? "payment card" : "", ...fields]
    .filter(Boolean)
    .join(", ");
  const detail = text(args.detail, QUESTION_MAX_CHARS);
  return [
    `a secure card: "${text(args.purpose, QUESTION_MAX_CHARS)}"`,
    service ? ` for ${service}${account ? ` (account ${account})` : ""}` : "",
    asked ? `, asking for ${asked}` : "",
    args.replace_saved === true ? " (the value saved for it did not work)" : "",
    detail ? `. Detail: ${detail}` : "",
  ].join("");
};

const SAVED_LIST_MAX = 40;

const describeSavedHere = (savedHere: readonly Record<string, unknown>[]): string => {
  if (savedHere.length === 0) return "Nothing is saved in Stella on this computer.";
  const lines = savedHere.slice(0, SAVED_LIST_MAX).map((entry) => {
    const account = text(entry.account, 200);
    const fields = Array.isArray(entry.fields) ? entry.fields.map((field) => text(field, 60)).filter(Boolean) : [];
    return `- ${text(entry.service, 200)}${account ? ` (${account})` : ""}${fields.length ? `: ${fields.join(", ")}` : ""}`;
  });
  return `Nothing saved in Stella on this computer matched that service. Saved here (names only):\n${lines.join("\n")}`;
};

const noteFor = (tool: string, args: Record<string, unknown>, savedHere?: readonly Record<string, unknown>[]): string =>
  [
    tool === ASK_USER
      ? `${PI_ASK_FIRST_PREFIX} I'd ask them:\n${describeQuestions(args)}`
      : `${PI_ASK_FIRST_PREFIX} I'd show them ${describeSecureCard(args)}.`,
    ...(savedHere ? [describeSavedHere(savedHere)] : []),
    `It goes to them in ${STELLA_FIRST_WAIT_MS / 1000} seconds unless you reply.`,
  ].join("\n\n");

const repliedText = (tool: string, reply: string): string =>
  `Stella saw this before it reached the user, and answered instead:\n\n${reply}\n\nAct on her answer. If she says only the user can give this, call ${tool} again and it goes straight to them.`;

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

export const takeStellaReply = async (tx: Tx, conversationId: ConversationId, message: string): Promise<boolean> => {
  if (!message.includes(FROM_STELLA)) return false;
  const role = await tx.doc(StellaAgentDoc, conversationId);
  if (!role.askingStella || role.askingStella.reply !== undefined) return false;
  role.askingStella.reply = message;
  return true;
};

export const answersAsk = async (api: ToolExecutionApi, conversationId: ConversationId, message: string, context: Context): Promise<boolean> => {
  if (!message.includes(FROM_STELLA)) return false;
  const asking = (await api.snapshot(StellaAgentDoc, conversationId, context))?.askingStella;
  return !!asking && asking.reply === undefined;
};

const setAsking = (api: ToolExecutionApi, key: string | undefined, context: Context) =>
  api.commit(async (tx) => {
    const role = await tx.doc(StellaAgentDoc, api.conversationId);
    if (key) role.askingStella = { key };
    else delete role.askingStella;
    return undefined;
  }, context);

const notSaved = (result: Awaited<ReturnType<ToolRegistration["execute"]>>): Record<string, unknown>[] | undefined => {
  const details = (result as { details?: unknown } | undefined)?.details;
  if (!details || typeof details !== "object" || (details as { outcome?: unknown }).outcome !== "not_saved") return undefined;
  return list((details as { savedHere?: unknown }).savedHere);
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
  savedHere?: readonly Record<string, unknown>[],
): Promise<string | undefined> => {
  const key = `stella-first:${String(api.taskId)}`;
  await setAsking(api, key, context);
  try {
    const told = await host.tellStella(api, key, noteFor(tool, args, savedHere), context).catch(() => false);
    if (!told) return undefined;
    const signal = context.abortSignal;
    const deadline = Date.now() + STELLA_FIRST_WAIT_MS;
    while (Date.now() < deadline && !signal?.aborted) {
      await sleep(Math.min(STELLA_FIRST_POLL_MS, deadline - Date.now()), signal);
      const reply = (await api.snapshot(StellaAgentDoc, api.conversationId, context))?.askingStella?.reply;
      if (reply !== undefined) return reply;
    }
    if (signal?.aborted) throw signal.reason ?? new Error(`Tool ${tool} was aborted`);
    return undefined;
  } finally {
    await setAsking(api, undefined, context).catch(() => undefined);
  }
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
        let savedHere: Record<string, unknown>[] | undefined;
        if (name === REQUEST_SECURE_INPUT && input.replace_saved !== true) {
          const saved = await tool.execute({ ...input, [SECURE_INPUT_SAVED_ONLY_ARG]: true }, api, context);
          savedHere = notSaved(saved);
          if (!savedHere) return saved;
          if (input.saved_only === true) return saved;
        }
        const reply = await askStella(host, name, input, api, context, savedHere);
        if (reply === undefined) return await tool.execute(args, api, context);
        await markPass(api, name, context);
        return { output: [{ type: "text", text: repliedText(name, reply) }] };
      },
    }),
  }));
