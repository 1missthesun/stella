/**
 * Claude Code's own compaction, as its stream-json output shows it: a
 * `system`/`compact_boundary` line, then the synthetic user message that
 * opens the compacted session with the summary. The summary is what every
 * other host of the conversation can start from, so it becomes the
 * conversation's checkpoint.
 */

export type ClaudeCodeCompaction = {
  /** The boundary's uuid: one compaction, however often it is reported. */
  id: string;
  summary: string;
  trigger?: string;
  preTokens?: number;
};

/** Keeps a summary within the journal checkpoint's 256 KB, however it encodes. */
const SUMMARY_MAX_CHARS = 64_000;

const LOCAL_TRANSCRIPT_NOTE = "\n\nIf you need specific details from before compaction";

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const contentText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const record = asRecord(part);
      return record?.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n");
};

/**
 * The summary as another host should read it: without the closing note that
 * points at this computer's session file and tells the CLI to carry on.
 */
export const claudeCodeSummaryText = (text: string): string => {
  const cut = text.indexOf(LOCAL_TRANSCRIPT_NOTE);
  return (cut >= 0 ? text.slice(0, cut) : text).trim().slice(0, SUMMARY_MAX_CHARS);
};

/** Watches one CLI's stream lines and returns each compaction once its summary arrives. */
export const createClaudeCodeCompactionDetector = () => {
  let boundary: { id: string; trigger?: string; preTokens?: number } | undefined;
  const seen = new Set<string>();
  return (event: Record<string, unknown>): ClaudeCodeCompaction | undefined => {
    if (event.type === "system" && event.subtype === "compact_boundary") {
      const id = typeof event.uuid === "string" && event.uuid ? event.uuid : `compact:${Date.now()}`;
      const metadata = asRecord(event.compact_metadata);
      boundary = {
        id,
        ...(typeof metadata?.trigger === "string" ? { trigger: metadata.trigger } : {}),
        ...(typeof metadata?.pre_tokens === "number" ? { preTokens: metadata.pre_tokens } : {}),
      };
      return undefined;
    }
    if (!boundary || event.type !== "user" || event.isReplay === true) return undefined;
    const current = boundary;
    boundary = undefined;
    if (seen.has(current.id)) return undefined;
    const summary = claudeCodeSummaryText(contentText(asRecord(event.message)?.content));
    if (!summary) return undefined;
    seen.add(current.id);
    return { ...current, summary };
  };
};
