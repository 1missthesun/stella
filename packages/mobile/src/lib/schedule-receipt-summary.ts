/**
 * Anything that reads as serialized structure is never receipt copy: the
 * persisted schedule side-channel JSON, a non-envelope JSON result, or — the
 * sneaky one — a runtime `resultPreview` sliced at 200 chars mid-envelope,
 * which fails `JSON.parse` yet would otherwise fall through to the raw-string
 * path and render truncated JSON garbage in chat. Prefix check on purpose:
 * a parse test cannot recognise the truncated forms.
 */
const looksLikeSerializedStructure = (text: string): boolean =>
  text.startsWith("{") || text.startsWith("[");

const textFromToolResultEnvelope = (value: unknown): string | undefined => {
  const record =
    value && typeof value === "object" ? (value as { content?: unknown }) : null;
  const content = Array.isArray(record?.content)
    ? record!.content
    : (() => {
        if (typeof value !== "string") return undefined;
        const trimmed = value.trim();
        if (!trimmed.startsWith("{") || !trimmed.includes('"content"')) {
          return undefined;
        }
        try {
          const parsed = JSON.parse(trimmed) as { content?: unknown };
          return Array.isArray(parsed.content) ? parsed.content : undefined;
        } catch {
          return undefined;
        }
      })();
  if (!content) return undefined;
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      const text = (block as { text?: unknown }).text as string;
      if (text.trim()) return text.trim();
    }
  }
  return undefined;
};

export const pickScheduleToolSummary = (payload: {
  resultPreview?: unknown;
  result?: unknown;
}): string | undefined => {
  const candidates: unknown[] = [payload.resultPreview, payload.result];
  const nestedResult =
    payload.result && typeof payload.result === "object"
      ? (payload.result as { result?: unknown }).result
      : undefined;
  if (nestedResult !== undefined) {
    candidates.unshift(nestedResult);
  }

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const envelopeText = textFromToolResultEnvelope(candidate);
    if (envelopeText) {
      // An envelope whose text block is itself serialized structure renders
      // nothing from this candidate; a later candidate may still be prose.
      if (looksLikeSerializedStructure(envelopeText)) continue;
      return envelopeText;
    }
    const text = candidate.trim();
    if (!text || looksLikeSerializedStructure(text)) continue;
    return text;
  }
  return undefined;
};

export const scheduleReceiptText = (payload: {
  resultPreview?: unknown;
  result?: unknown;
}): string | undefined => {
  const envelopeText = textFromToolResultEnvelope(payload.result);
  // An envelope whose text is itself serialized structure (the persisted
  // side-channel JSON, say) renders nothing — and must not fall through to
  // the raw-string path.
  if (envelopeText) {
    return looksLikeSerializedStructure(envelopeText)
      ? undefined
      : envelopeText;
  }
  return pickScheduleToolSummary(payload);
};
