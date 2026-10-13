/**
 * Stella's resident context: the prompt sections that describe the user and
 * where this conversation runs (personality, memory, skills, devices,
 * destination, engine and model, media access, language) as the conversation's first message
 * after the system prompt, never inside it.
 *
 * pi-durable already keeps these sections the cache-friendly way in the
 * transcript: a complete baseline at the head of each context window, and a
 * positional `pi.system` patch where one changed. But pi-ai sends a system
 * message in the middle of a conversation only to models flagged for it, and
 * merges every other one into the leading system prompt, so any change (a
 * device going offline, a memory write) would rewrite the top of the request
 * and miss the provider prompt cache for the whole conversation.
 *
 * `residentContextHook` reshapes each request instead: the resident sections
 * of every system message go out as a hidden user message at that same
 * position. The baseline lands right after the system prompt; a later change
 * lands in front of the next input (a user message, or an agent's report or
 * message) and carries only what changed since the model last saw it. A
 * context update never starts or steers a turn: one written mid-turn is held
 * until that next input, and repeated updates fold into the latest state,
 * so a device that went offline and back shows nothing; compaction writes a
 * fresh baseline, which folds the changes in. The system prompt itself keeps
 * only Stella's static prompt, so it reads the same for every conversation.
 * The transcript is unchanged; this is a pure function of it, so every request
 * of a conversation renders the same bytes for the same history.
 */
import { GenerationTask, hook } from "@earendil-works/pi-durable";
import type { Message, ModelThinkingLevel, SystemMessage, UserMessage } from "@earendil-works/pi-ai";
import { SYSTEM_REMINDER_TAG, wrapSystemReminder } from "@stella/contracts/system-reminders";
import { CLAUDE_CODE_PROVIDER_ID } from "../engine/selection.ts";
import { accountProviderOfRegistryId } from "../provider/account-byok.ts";
import { parseStellaModelId, STELLA_PROVIDER_ID } from "../provider/stella.ts";

/** The sections of `stellaPromptExtension` that are user and environment state, in prompt order. */
export const RESIDENT_SECTION_KEYS: ReadonlySet<string> = new Set([
  "personality",
  "main-memory",
  "skills",
  "execution-devices",
  "execution-destination",
  "engine-model",
  "working-directory",
  "media-access",
  "response-language",
]);

export const ENGINE_MODEL_SECTION = "engine-model";

export type RunsOn = { engine: "Stella" | "Claude Code"; model: string; reasoning?: string };

const CLAUDE_CODE_ALIASES = ["opus", "sonnet", "haiku", "fable"];

const describeRunsOn = (run: RunsOn): string =>
  `${run.engine}, model ${run.model}${run.reasoning ? `, reasoning ${run.reasoning}` : ""}`;

export const engineModelText = (run: RunsOn): string => `You run on ${describeRunsOn(run)}.`;

const sectionRunsOn = (text: string | undefined): RunsOn | undefined => {
  const match = text?.match(/You run on (Stella|Claude Code), model (.+?)(?:, reasoning (\w+))?\.\n?<\/engine-model>/);
  if (!match) return undefined;
  return { engine: match[1] as RunsOn["engine"], model: match[2]!, ...(match[3] ? { reasoning: match[3] } : {}) };
};

export const runsOn = (provider: string, modelId: string, thinkingLevel?: ModelThinkingLevel): RunsOn => {
  const reasoning = thinkingLevel === undefined || thinkingLevel === "off" ? {} : { reasoning: thinkingLevel };
  if (provider === CLAUDE_CODE_PROVIDER_ID) return { engine: "Claude Code", model: modelId, ...reasoning };
  const model =
    provider === STELLA_PROVIDER_ID
      ? (parseStellaModelId(modelId)?.alias ?? modelId)
      : `${accountProviderOfRegistryId(provider) ?? provider}/${modelId}`;
  return { engine: "Stella", model, ...reasoning };
};

const replyRunsOn = (message: Message): RunsOn | undefined => {
  if (message.role !== "assistant" || message.api.startsWith("stella")) return undefined;
  if (message.api.startsWith("claude-code")) return { engine: "Claude Code", model: message.model };
  return runsOn(message.provider, message.model);
};

const sameRun = (a: RunsOn, b: RunsOn): boolean => {
  if (a.engine !== b.engine) return false;
  if (a.model === b.model) return true;
  if (a.engine !== "Claude Code") return false;
  const alias = (model: string) => CLAUDE_CODE_ALIASES.find((name) => model.includes(name));
  return alias(a.model) !== undefined && alias(a.model) === alias(b.model);
};

const changedText = (key: string, text: string, before: string | undefined, ranOn: RunsOn | undefined): string => {
  if (key !== ENGINE_MODEL_SECTION) return text;
  const now = sectionRunsOn(text);
  const told = sectionRunsOn(before);
  const was = ranOn && !(told && sameRun(told, ranOn)) ? ranOn : told;
  if (was && now && sameRun(was, now) && (was.reasoning === undefined || was.reasoning === now.reasoning)) return text;
  return was && now ? `<${key}>\nChanged: your last reply ran on ${describeRunsOn(was)}; you now run on ${describeRunsOn(now)}.\n</${key}>` : text;
};

const BASELINE_HEADER = "Context about the user and where this conversation runs. A later update replaces a part of it by name.";
const CHANGE_HEADER = "This context changed. Each part below replaces the earlier part of the same name; the rest still holds.";

/**
 * Whether a user message is resident context: the complete `baseline`, or a
 * `change` to it. Engines that hand the model a conversation as text (Claude
 * Code) use it to deliver the context whole.
 */
export const residentContextKind = (message: Message): "baseline" | "change" | undefined => {
  if (message.role !== "user") return undefined;
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content.length === 1 && message.content[0]!.type === "text"
        ? message.content[0]!.text
        : "";
  if (text.startsWith(`<${SYSTEM_REMINDER_TAG}>${BASELINE_HEADER}`)) return "baseline";
  if (text.startsWith(`<${SYSTEM_REMINDER_TAG}>${CHANGE_HEADER}`)) return "change";
  return undefined;
};

const residentText = (
  sections: [string, string | null][],
  baseline: boolean,
  before?: ReadonlyMap<string, string>,
  ranOn?: RunsOn,
): string => {
  const shown = sections
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([key, text]) => (before ? changedText(key, text, before.get(key), ranOn) : text));
  const removed = sections.filter(([, text]) => text === null).map(([key]) => key);
  const lines = [
    baseline ? BASELINE_HEADER : CHANGE_HEADER,
    ...shown,
    ...(removed.length > 0 ? [`No longer applies: ${removed.join(", ")}.`] : []),
  ];
  return wrapSystemReminder(lines.join("\n\n"));
};

/** Each resident message's whole context as of it, every change applied, rendered as a baseline. */
const residentState = new WeakMap<Message, string>();

const residentOrder = [...RESIDENT_SECTION_KEYS];

const recordState = (message: Message, seen: ReadonlyMap<string, string>) => {
  const sections = [...seen].sort(([a], [b]) => residentOrder.indexOf(a) - residentOrder.indexOf(b));
  residentState.set(message, residentText(sections, true));
};

/**
 * The resident context as of the end of `messages`, every change applied: one
 * baseline to hand a model that is starting over (a fresh session, or one whose
 * own compaction left the context behind). Undefined when there is none.
 */
export const residentContextAsOf = (messages: readonly Message[]): string | undefined => {
  const last = messages.findLast((message) => residentContextKind(message) !== undefined);
  if (last === undefined) return undefined;
  const state = residentState.get(last);
  if (state !== undefined) return state;
  const at = messages.findLastIndex((message) => residentContextKind(message) === "baseline");
  if (at < 0) return undefined;
  return messages
    .slice(at)
    .filter((message) => residentContextKind(message) !== undefined)
    .map((message) => (typeof message.content === "string" ? message.content : message.content.map((part) => (part.type === "text" ? part.text : "")).join("")))
    .join("\n\n");
};

/**
 * Move the resident sections of each system message into a user message at its
 * place: the baseline right after the system prompt, a change in front of the
 * user message that started its turn, so the user's own words stay last. A
 * system message left with nothing (no static section, text or tool change)
 * is dropped.
 */
export const withResidentContext = (messages: readonly Message[]): readonly Message[] => {
  let changed = false;
  let baselineSeen = false;
  const out: Message[] = [];
  const residentMessages = new Set<Message>();
  const seen = new Map<string, string>();
  const pending = new Map<string, string | null>();
  let pendingTimestamp = 0;
  let pendingAt: number | undefined;
  let ranOn: RunsOn | undefined;
  let checked: RunsOn | undefined;
  const forced = new Set<string>();
  const hold = (sections: [string, string | null][], timestamp: number) => {
    for (const [key, text] of sections) {
      pending.delete(key);
      pending.set(key, text);
    }
    pendingTimestamp = timestamp;
  };
  const place = () => {
    const at = pendingAt;
    pendingAt = undefined;
    if (at === undefined) return;
    const sections = [...pending].filter(([key, text]) =>
      forced.has(key) || (text === null ? seen.has(key) : seen.get(key) !== text),
    );
    pending.clear();
    forced.clear();
    if (sections.length === 0) return;
    const before = new Map(seen);
    for (const [key, text] of sections) {
      if (text === null) seen.delete(key);
      else seen.set(key, text);
    }
    const user: UserMessage = { role: "user", content: residentText(sections, false, before, ranOn), timestamp: pendingTimestamp };
    out.splice(at, 0, user);
    residentMessages.add(user);
    recordState(user, seen);
  };
  for (const message of messages) {
    if (message.role === "user" && ranOn !== undefined && ranOn !== checked && baselineSeen) {
      const current = sectionRunsOn(pending.get(ENGINE_MODEL_SECTION) ?? seen.get(ENGINE_MODEL_SECTION));
      if (current) {
        checked = ranOn;
        if (!sameRun(current, ranOn) && !pending.has(ENGINE_MODEL_SECTION)) {
          hold([[ENGINE_MODEL_SECTION, seen.get(ENGINE_MODEL_SECTION)!]], message.timestamp);
          forced.add(ENGINE_MODEL_SECTION);
        }
      }
    }
    if (message.role === "user" && pending.size > 0 && pendingAt === undefined) pendingAt = out.length;
    if (message.role !== "system" && message.role !== "user") place();
    if (message.role === "assistant") ranOn = replyRunsOn(message) ?? ranOn;
    if (message.role !== "system" || message.sections === undefined) {
      out.push(message);
      continue;
    }
    const entries = Object.entries(message.sections);
    const resident = entries.filter(([key]) => RESIDENT_SECTION_KEYS.has(key));
    if (resident.length === 0) {
      out.push(message);
      continue;
    }
    changed = true;
    const staticSections = entries.filter(([key]) => !RESIDENT_SECTION_KEYS.has(key));
    const { sections: _sections, ...rest } = message;
    const system: SystemMessage =
      staticSections.length > 0 ? { ...rest, sections: Object.fromEntries(staticSections) } : rest;
    if (
      system.sections !== undefined ||
      system.content.length > 0 ||
      (system.toolsAdded?.length ?? 0) > 0 ||
      (system.toolsRemoved?.length ?? 0) > 0
    ) {
      out.push(system);
    }
    if (baselineSeen) {
      // A change lands in front of the input that starts a turn, folded with any change held since. One
      // written mid-turn is held for the next input, so it never reaches the running turn.
      let end = out.length;
      while (end > 0 && out[end - 1]!.role === "system") end -= 1;
      let at = end;
      while (at > 0 && out[at - 1]!.role === "user" && !residentMessages.has(out[at - 1]!)) at -= 1;
      hold(resident, message.timestamp);
      if (at < end) pendingAt = Math.min(pendingAt ?? at, at);
      continue;
    }
    // The first system message of a context is its complete baseline; after a compaction it is written
    // behind the kept messages, and it belongs at the head.
    let at = 0;
    while (at < out.length && out[at]!.role === "system") at += 1;
    for (const [key, text] of resident) if (text !== null) seen.set(key, text);
    const user: UserMessage = {
      role: "user",
      content: residentText(resident, true),
      timestamp: message.timestamp,
    };
    out.splice(at, 0, user);
    residentMessages.add(user);
    recordState(user, seen);
    baselineSeen = true;
  }
  place();
  return changed ? out : messages;
};

export const residentContextHook = hook(GenerationTask, {
  beforeRequest: (request) => {
    const messages = withResidentContext(request.messages);
    return messages === request.messages ? undefined : { messages };
  },
});
