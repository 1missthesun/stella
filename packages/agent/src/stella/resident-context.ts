/**
 * Stella's resident context: the prompt sections that describe the user and
 * where this conversation runs (personality, memory, skills, devices,
 * destination, media access, language) as the conversation's first message
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
import type { Message, SystemMessage, UserMessage } from "@earendil-works/pi-ai";
import { wrapSystemReminder } from "@stella/contracts/system-reminders";

/** The sections of `stellaPromptExtension` that are user and environment state, in prompt order. */
export const RESIDENT_SECTION_KEYS: ReadonlySet<string> = new Set([
  "personality",
  "main-memory",
  "skills",
  "execution-devices",
  "execution-destination",
  "working-directory",
  "media-access",
  "response-language",
]);

const residentText = (sections: [string, string | null][], baseline: boolean): string => {
  const shown = sections.filter((entry): entry is [string, string] => entry[1] !== null).map(([, text]) => text);
  const removed = sections.filter(([, text]) => text === null).map(([key]) => key);
  const lines = [
    baseline
      ? "Context about the user and where this conversation runs. A later update replaces a part of it by name."
      : "This context changed. Each part below replaces the earlier part of the same name; the rest still holds.",
    ...shown,
    ...(removed.length > 0 ? [`No longer applies: ${removed.join(", ")}.`] : []),
  ];
  return wrapSystemReminder(lines.join("\n\n"));
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
    const sections = [...pending].filter(([key, text]) => (text === null ? seen.has(key) : seen.get(key) !== text));
    pending.clear();
    if (sections.length === 0) return;
    for (const [key, text] of sections) {
      if (text === null) seen.delete(key);
      else seen.set(key, text);
    }
    const user: UserMessage = { role: "user", content: residentText(sections, false), timestamp: pendingTimestamp };
    out.splice(at, 0, user);
    residentMessages.add(user);
  };
  for (const message of messages) {
    if (message.role === "user" && pending.size > 0 && pendingAt === undefined) pendingAt = out.length;
    if (message.role !== "system" && message.role !== "user") place();
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
