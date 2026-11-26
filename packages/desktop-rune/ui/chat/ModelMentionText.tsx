import { findDelegatedModelMentions } from "@stella/contracts/model-mentions";
import type { Run } from "../rune";

/** `.model-mention-inline`'s inline background; a user bubble's (`.event-item.user`) is `USER_MENTION_BOX`. */
export const MENTION_BOX: Run["box"] = { radius: 3 };
export const USER_MENTION_BOX: Run["box"] = { pad: 4, margin: 1, radius: 5 };

/** desktop-ui's `ModelMentionText` as text runs: delegated `@model` mentions tinted inside the line. */
export function modelMentionRuns(text: string, mention: { color: string; bg: string }, box: Run["box"] = MENTION_BOX): Run[] {
  const mentions = findDelegatedModelMentions(text);
  if (mentions.length === 0) return [{ t: text }];
  const runs: Run[] = [];
  let cursor = 0;
  for (const m of mentions) {
    if (m.start > cursor) runs.push({ t: text.slice(cursor, m.start) });
    runs.push({ t: text.slice(m.start, m.end), c: mention.color, bg: mention.bg, box });
    cursor = m.end;
  }
  if (cursor < text.length) runs.push({ t: text.slice(cursor) });
  return runs;
}
