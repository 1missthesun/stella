import { findDelegatedModelMentions } from "@stella/contracts/model-mentions";
import type { Run } from "../rune";

/** desktop-ui's `ModelMentionText` as text runs: delegated `@model` mentions tinted inside the line. */
export function modelMentionRuns(text: string, mention: { color: string; bg: string }): Run[] {
  const mentions = findDelegatedModelMentions(text);
  if (mentions.length === 0) return [{ t: text }];
  const runs: Run[] = [];
  let cursor = 0;
  for (const m of mentions) {
    if (m.start > cursor) runs.push({ t: text.slice(cursor, m.start) });
    runs.push({ t: text.slice(m.start, m.end), c: mention.color, bg: mention.bg });
    cursor = m.end;
  }
  if (cursor < text.length) runs.push({ t: text.slice(cursor) });
  return runs;
}
