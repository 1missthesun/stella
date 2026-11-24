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
import { ANTIGRAVITY_CLI_PROVIDER_ID, CLAUDE_CODE_PROVIDER_ID } from "../engine/selection.ts";
import { accountProviderOfRegistryId } from "../provider/account-byok-ids.ts";
import { parseStellaModelId, STELLA_PROVIDER_ID } from "../provider/stella.ts";

export const RESIDENT_SECTION_KEYS: ReadonlySet<string> = new Set([
  "personality",
  "main-memory",
  "standing-rules",
  "skills",
  "execution-devices",
  "execution-destination",
  "engine-model",
  "working-directory",
  "media-access",
  "email",
  "response-language",
]);

export const ENGINE_MODEL_SECTION = "engine-model";

export type RunsOn = { engine: "Stella" | "Claude Code" | "Google Antigravity"; model: string; reasoning?: string };

const CLAUDE_CODE_ALIASES = ["opus", "sonnet", "haiku", "fable"];

const describeRunsOn = (run: RunsOn): string =>
  `${run.engine}, model ${run.model}${run.reasoning ? `, reasoning ${run.reasoning}` : ""}`;

export const engineModelText = (run: RunsOn): string => `You run on ${describeRunsOn(run)}.`;

const sectionRunsOn = (text: string | undefined): RunsOn | undefined => {
  const match = text?.match(/You run on (Stella|Claude Code|Google Antigravity), model (.+?)(?:, reasoning (\w+))?\.\n?<\/engine-model>/);
  if (!match) return undefined;
  return { engine: match[1] as RunsOn["engine"], model: match[2]!, ...(match[3] ? { reasoning: match[3] } : {}) };
};

export const runsOn = (provider: string, modelId: string, thinkingLevel?: ModelThinkingLevel): RunsOn => {
  const reasoning = thinkingLevel === undefined || thinkingLevel === "off" ? {} : { reasoning: thinkingLevel };
  if (provider === CLAUDE_CODE_PROVIDER_ID) return { engine: "Claude Code", model: modelId, ...reasoning };
  if (provider === ANTIGRAVITY_CLI_PROVIDER_ID) return { engine: "Google Antigravity", model: modelId, ...reasoning };
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

const PATCH_MAX_SHARE = 0.6;
const PATCH_MAX_CELLS = 4_000_000;
const SHORTENED_PREFIX_CHARS = 40;
const SHORTENED_PREFIX_STEP = 20;
const SHORTENED_MIN_SAVED = 20;

type DiffLine = { kind: "same" | "removed" | "added"; text: string };

/** The line diff of `before` → `after` (longest common subsequence), or undefined when too large to compute. */
const lineDiff = (before: readonly string[], after: readonly string[]): DiffLine[] | undefined => {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  if (a.length * b.length > PATCH_MAX_CELLS) return undefined;
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      middle.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (j < b.length && (i === a.length || table[i * width + j + 1]! >= table[(i + 1) * width + j]!)) {
      middle.push({ kind: "added", text: b[j]! });
      j += 1;
    } else {
      middle.push({ kind: "removed", text: a[i]! });
      i += 1;
    }
  }
  return [
    ...before.slice(0, start).map((text): DiffLine => ({ kind: "same", text })),
    ...middle,
    ...before.slice(endBefore).map((text): DiffLine => ({ kind: "same", text })),
  ];
};

const PATCH_LEAD = (name: string) =>
  `Changed lines of ${name} only (- old line, cut to its start where it ends in …; + new line; a leading space marks an unchanged line, for place).`;

/** What the model knows the part as: its file for a startup doc, else its tag. */
const partName = (key: string, text: string): string => text.match(/<startup_doc path="([^"]+)">/)?.[1] ?? `<${key}>`;

const wrapperOf = (lines: readonly string[]): { open: string; close: string } | undefined => {
  const open = lines[0];
  const close = lines[lines.length - 1];
  const tag = open?.match(/^<([a-z_-]+)[ >]/)?.[1];
  return tag && lines.length >= 2 && close === `</${tag}>` ? { open: open!, close: close! } : undefined;
};

/**
 * A changed part as only its changed lines, when that is unambiguous and much
 * shorter: every removed line and every line shown for place occurs once in
 * the copy the model has. Otherwise undefined, and the whole part goes.
 */
const linePatch = (key: string, text: string, before: string): string | undefined => {
  const was = before.split("\n");
  const now = text.split("\n");
  const wrapper = wrapperOf(was);
  const inner = wrapper && wrapperOf(now)?.open === wrapper.open && wrapperOf(now)?.close === wrapper.close;
  const a = inner ? was.slice(1, -1) : was;
  const b = inner ? now.slice(1, -1) : now;
  const diff = lineDiff(a, b);
  if (!diff) return undefined;
  const counts = new Map<string, number>();
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1);
  const once = (line: string) => counts.get(line) === 1;
  const prefixOnce = (prefix: string) => a.filter((line) => line.startsWith(prefix)).length === 1;
  // The shortest start of the line (from a few words on) that no other line shares.
  const shown = (line: string) => {
    for (let length = SHORTENED_PREFIX_CHARS; length + SHORTENED_MIN_SAVED < line.length; length += SHORTENED_PREFIX_STEP) {
      const prefix = line.slice(0, length);
      if (prefixOnce(prefix)) return `${prefix}…`;
    }
    return line;
  };
  const out: string[] = [];
  let index = 0;
  while (index < diff.length) {
    if (diff[index]!.kind === "same") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < diff.length && diff[end]!.kind !== "same") end += 1;
    const hunk = diff.slice(index, end);
    if (hunk.every((line) => line.text.trim() === "")) {
      index = end;
      continue;
    }
    for (const line of hunk) if (line.kind === "removed" && line.text.trim() !== "" && !once(line.text)) return undefined;
    const placeBefore = diff.slice(0, index).findLast((line) => line.kind === "same" && line.text.trim() !== "");
    const placeAfter = diff.slice(end).find((line) => line.kind === "same" && line.text.trim() !== "");
    const anchoredByRemoval = hunk.some((line) => line.kind === "removed" && line.text.trim() !== "");
    const place = placeBefore ?? placeAfter;
    if (!anchoredByRemoval && place && !once(place.text)) return undefined;
    // A removed line already shows where; only a pure addition needs an unchanged line beside it.
    if (!anchoredByRemoval && place === placeBefore && placeBefore) out.push(` ${shown(placeBefore.text)}`);
    for (const line of hunk) if (line.kind === "removed" && line.text.trim() !== "") out.push(`-${shown(line.text)}`);
    for (const line of hunk) if (line.kind === "added" && line.text.trim() !== "") out.push(`+${line.text}`);
    if (!anchoredByRemoval && place === placeAfter && placeAfter && !placeBefore) out.push(` ${shown(placeAfter.text)}`);
    index = end;
  }
  const body = [PATCH_LEAD(partName(key, text)), ...out];
  const patch = inner ? [wrapper!.open, ...body, wrapper!.close].join("\n") : body.join("\n");
  return patch.length < text.length * PATCH_MAX_SHARE ? patch : undefined;
};

const changedText = (key: string, text: string, before: string | undefined, ranOn: RunsOn | undefined): string => {
  if (key !== ENGINE_MODEL_SECTION) return before === undefined ? text : (linePatch(key, text, before) ?? text);
  const now = sectionRunsOn(text);
  const told = sectionRunsOn(before);
  const was = ranOn && !(told && sameRun(told, ranOn)) ? ranOn : told;
  if (was && now && sameRun(was, now) && (was.reasoning === undefined || was.reasoning === now.reasoning)) return text;
  return was && now ? `<${key}>\nChanged: your last reply ran on ${describeRunsOn(was)}; you now run on ${describeRunsOn(now)}.\n</${key}>` : text;
};

const BASELINE_HEADER = "Context about the user and where this conversation runs. A later update replaces a part of it by name.";
const CHANGE_HEADER = "This context changed. Each part below replaces its earlier copy or lists its changed lines; the rest still holds.";

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

const residentState = new WeakMap<Message, string>();

const residentOrder = [...RESIDENT_SECTION_KEYS];

const recordState = (message: Message, seen: ReadonlyMap<string, string>) => {
  const sections = [...seen].sort(([a], [b]) => residentOrder.indexOf(a) - residentOrder.indexOf(b));
  residentState.set(message, residentText(sections, true));
};

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
      let end = out.length;
      while (end > 0 && out[end - 1]!.role === "system") end -= 1;
      let at = end;
      while (at > 0 && out[at - 1]!.role === "user" && !residentMessages.has(out[at - 1]!)) at -= 1;
      hold(resident, message.timestamp);
      if (at < end) pendingAt = Math.min(pendingAt ?? at, at);
      continue;
    }
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
