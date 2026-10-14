import type { ReplyRef } from "@stella/contracts/reply-refs";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const parseReplyRefs = (value: unknown): ReplyRef[] => {
  if (!Array.isArray(value)) return [];
  const refs: ReplyRef[] = [];
  for (const candidate of value) {
    const ref = asRecord(candidate);
    if (!ref) continue;
    if (
      ref.kind === "message" &&
      typeof ref.id === "string" &&
      ref.id &&
      typeof ref.sequence === "number"
    ) {
      refs.push({
        kind: "message",
        id: ref.id,
        sequence: ref.sequence,
        role: ref.role === "assistant" ? "assistant" : "user",
        preview: typeof ref.preview === "string" ? ref.preview : "",
      });
    } else if (
      ref.kind === "agent" &&
      typeof ref.threadId === "string" &&
      ref.threadId
    ) {
      refs.push({
        kind: "agent",
        threadId: ref.threadId,
        title: typeof ref.title === "string" ? ref.title : ref.threadId,
      });
    }
  }
  return refs;
};

export const replyRefsFromPayload = (
  payload: Record<string, unknown> | undefined,
): ReplyRef[] => {
  const metadata = asRecord(payload?.metadata);
  const runtime = asRecord(metadata?.runtime);
  return parseReplyRefs(runtime?.replyRefs);
};

export const replyRefsKey = (refs: readonly ReplyRef[] | undefined): string =>
  refs && refs.length > 0
    ? refs
        .map((ref) =>
          ref.kind === "message"
            ? `m:${ref.id}:${ref.preview}`
            : `a:${ref.threadId}:${ref.title}`,
        )
        .join("\0")
    : "";
