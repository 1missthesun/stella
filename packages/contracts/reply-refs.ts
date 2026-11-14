import { SYSTEM_REMINDER_TAG } from "@stella/contracts/system-reminders";

export const REPLY_REFS_FENCE_TAG = "refs";

/**
 * What a turn writes when it has nothing to post: a reply that is only this
 * (a refs block after it still adds its reactions) is no message at all, on
 * every surface. A written marker instead of an empty reply works on every
 * model: some can't end a turn with no text, and Claude Code nudges one that
 * does.
 */
export const SILENT_REPLY_MARKER = "<no-reply/>";

const SILENT_MARKER_RE =
  /^<\/?\s*no[-_ ]?(?:reply|response)\s*\/?>(?:\s*<\/\s*no[-_ ]?(?:reply|response)\s*>)?$/i;
const SILENT_TOKEN_RE = /^no[-_](?:reply|response)$/i;
const SILENT_BRACKETED_RE = /^[(\[]\s*no (?:reply|response)\s*[)\]]$/i;
/**
 * Placeholders models wrote for "nothing to say" before the marker: Claude
 * Code's own "No response requested." (it writes that line into a session it
 * resumes after an interruption, where the model then reads it as its own
 * earlier reply) and its close variants. Matched only as the whole reply.
 */
const SILENT_PHRASE_RE =
  /^no (?:reply|response|answer)(?: is)? (?:requested|needed|required|necessary|warranted|expected)$/i;

/** Whether a whole reply (refs block already removed) says only "nothing to post". */
export const isSilentReplyText = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length > 48) return false;
  if (SILENT_BRACKETED_RE.test(trimmed)) return true;
  const bare = trimmed
    .replace(/^[`*_"'\u201c\u201d\u2018\u2019]+|[`*_"'\u201c\u201d\u2018\u2019]+$/g, "")
    .trim();
  if (SILENT_MARKER_RE.test(bare) || SILENT_TOKEN_RE.test(bare)) return true;
  return SILENT_PHRASE_RE.test(bare.replace(/[.!\u2026]+$/u, "").replace(/\s+/g, " ").trim());
};

export type RawReplyRef =
  | { kind: "message"; sequence: number }
  | { kind: "agent"; threadId: string };

export type ReplyRef =
  | {
      kind: "message";
      sequence: number;
      id: string;
      role: "user" | "assistant";
      preview: string;
    }
  | {
      kind: "agent";
      threadId: string;
      title: string;
    };

const FENCE_RE = new RegExp(
  `(?:^|\\n)[ \\t]*(\`{3,}|~{3,})[ \\t]*${REPLY_REFS_FENCE_TAG}[ \\t]*\\n([\\s\\S]*?)\\n?[ \\t]*\\1[ \\t]*$`,
);

export type ReplyReaction = { sequence: number; emoji: string };

export type MessageReaction = { emoji: string; at: number };

const REACTION_LINE_RE =
  /^react(?:ion)?s?\s*[:=]?\s*(?:#|m(?:essage)?\s*#?)?\s*(\d{1,9})\s*[:=]?\s*(\S+)$/i;
const EMOJI_CHAR_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{3030}\u{303D}\u{3297}\u{3299}\u{00A9}\u{00AE}\u{203C}\u{2049}\u{2122}\u{2139}\u{20E3}]/u;
const MAX_REACTION_CHARS = 32;

const normalizeReactionEmoji = (value: string): string | null => {
  const emoji = value.trim().replace(/^[`'"]+|[`'"]+$/g, "");
  if (!emoji || emoji.length > MAX_REACTION_CHARS) return null;
  if (!EMOJI_CHAR_RE.test(emoji) || /[A-Za-z]/.test(emoji)) return null;
  return emoji;
};

const parseReactionLine = (line: string): ReplyReaction | null => {
  const match = REACTION_LINE_RE.exec(line);
  if (!match) return null;
  const sequence = Number.parseInt(match[1]!, 10);
  const emoji = normalizeReactionEmoji(match[2]!);
  return Number.isSafeInteger(sequence) && sequence >= 0 && emoji
    ? { sequence, emoji }
    : null;
};

export const readMessageReaction = (
  payload: unknown,
): MessageReaction | null => {
  if (!payload || typeof payload !== "object") return null;
  const reaction = (payload as { reaction?: unknown }).reaction;
  if (!reaction || typeof reaction !== "object") return null;
  const { emoji, at } = reaction as { emoji?: unknown; at?: unknown };
  if (typeof emoji !== "string") return null;
  const normalized = normalizeReactionEmoji(emoji);
  return normalized
    ? { emoji: normalized, at: typeof at === "number" ? at : 0 }
    : null;
};

const MESSAGE_LINE_RE = /^(?:#|m(?:essage)?\s*#?)\s*(\d{1,9})$/i;
const AGENT_LINE_RE = /^(?:agent|thread|thread_id)\s*[:=]\s*(.+)$/i;
const BARE_AGENT_LINE_RE = /^[a-z0-9][a-z0-9_.-]{0,199}$/i;

const parseRefLine = (line: string): RawReplyRef | null => {
  const trimmed = line
    .trim()
    .replace(/^[-*•]\s+/, "")
    .replace(/[,;]$/, "");
  if (!trimmed) return null;
  const message = MESSAGE_LINE_RE.exec(trimmed);
  if (message) {
    const sequence = Number.parseInt(message[1]!, 10);
    return Number.isSafeInteger(sequence) && sequence > 0
      ? { kind: "message", sequence }
      : null;
  }
  const agent = AGENT_LINE_RE.exec(trimmed);
  if (agent) {
    const threadId = agent[1]!.trim().replace(/^[`'"]|[`'"]$/g, "");
    return threadId ? { kind: "agent", threadId } : null;
  }
  if (BARE_AGENT_LINE_RE.test(trimmed)) {
    return { kind: "agent", threadId: trimmed };
  }
  return null;
};

/**
 * An assistant reply's visible text, its reply refs and its reactions. A reply
 * that says only "nothing to post" (see `isSilentReplyText`) has no text.
 */
export const splitReplyRefs = (
  text: string,
): { text: string; refs: RawReplyRef[]; reactions: ReplyReaction[] } => {
  const trimmedEnd = text.replace(/\s+$/, "");
  const match = FENCE_RE.exec(trimmedEnd);
  if (!match || match.index === undefined) {
    return { text: isSilentReplyText(text) ? "" : text, refs: [], reactions: [] };
  }
  const body = match[2] ?? "";
  const seen = new Set<string>();
  const refs: RawReplyRef[] = [];
  const reactionsBySequence = new Map<number, ReplyReaction>();
  for (const line of body.split(/\r?\n/)) {
    const cleaned = line
      .trim()
      .replace(/^[-*•]\s+/, "")
      .replace(/[,;]$/, "");
    const reaction = parseReactionLine(cleaned);
    if (reaction) {
      reactionsBySequence.delete(reaction.sequence);
      reactionsBySequence.set(reaction.sequence, reaction);
      continue;
    }
    if (/^react/i.test(cleaned)) continue;
    const ref = parseRefLine(line);
    if (!ref) continue;
    const key =
      ref.kind === "message" ? `m:${ref.sequence}` : `a:${ref.threadId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  const stripped = trimmedEnd.slice(0, match.index).replace(/\s+$/, "");
  return {
    text: isSilentReplyText(stripped) ? "" : stripped,
    refs,
    reactions: [...reactionsBySequence.values()],
  };
};

const contentTexts = (content: unknown): string[] => {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      texts.push((block as { text: string }).text);
    }
  }
  return texts;
};

export const splitMessageReplyRefs = (
  message: { content?: unknown } | undefined,
): { text: string; refs: RawReplyRef[]; reactions: ReplyReaction[] } => {
  const texts: string[] = [];
  const seen = new Set<string>();
  const refs: RawReplyRef[] = [];
  const reactionsBySequence = new Map<number, ReplyReaction>();
  for (const block of contentTexts(message?.content)) {
    const split = splitReplyRefs(block);
    const text = split.text.trim();
    if (text) texts.push(text);
    for (const ref of split.refs) {
      const key =
        ref.kind === "message" ? `m:${ref.sequence}` : `a:${ref.threadId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
    for (const reaction of split.reactions) {
      reactionsBySequence.delete(reaction.sequence);
      reactionsBySequence.set(reaction.sequence, reaction);
    }
  }
  return {
    text: texts.join("\n\n"),
    refs,
    reactions: [...reactionsBySequence.values()],
  };
};

export const formatMessageRefTag = (sequence: number): string =>
  `<${SYSTEM_REMINDER_TAG}>message #${sequence}</${SYSTEM_REMINDER_TAG}>`;

export const MESSAGE_REF_TAG_RE = new RegExp(
  `\\s*<${SYSTEM_REMINDER_TAG}>message #\\d+<\\/${SYSTEM_REMINDER_TAG}>`,
  "gi",
);

export const appendMessageRefTag = (text: string, sequence: number): string => {
  const body = text.replace(/\s+$/, "");
  if (!body) return text;
  return `${body}\n\n${formatMessageRefTag(sequence)}`;
};

export const stripMessageRefTag = (text: string): string =>
  text.replace(MESSAGE_REF_TAG_RE, "");

export type ConversationFocusRoot =
  | { kind: "message"; id: string }
  | { kind: "agent"; threadId: string };

export type ReplyCounts = {
  messages: Record<string, number>;
  agents: Record<string, number>;
};

const PREVIEW_MAX_CHARS = 160;

export const toReplyPreview = (text: string): string => {
  const compact = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= PREVIEW_MAX_CHARS) return compact;
  return `${compact.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
};
