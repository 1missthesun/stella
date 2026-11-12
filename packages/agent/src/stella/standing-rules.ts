import {
  RULES_MEMORY_DISPLAY_PATH,
  RULES_MEMORY_MAX_CHARS,
  rulesMemoryCapNote,
} from "@stella/runtime/kernel/memory/memory-layout";
import { shapeResidentMemoryDoc } from "@stella/runtime/kernel/memory/resident-doc-shape";

export const startupDoc = (path: string, content: string | undefined): string | undefined =>
  content === undefined || content.trim() === ""
    ? undefined
    : `<startup_doc path="${path}">\n${content.trim()}\n</startup_doc>`;

export const rulesDoc = (raw: string | null | undefined): string | undefined =>
  startupDoc(
    RULES_MEMORY_DISPLAY_PATH,
    raw ? shapeResidentMemoryDoc(raw, RULES_MEMORY_MAX_CHARS, rulesMemoryCapNote) : undefined,
  );

const STANDING_RULES_LEAD =
  "The user's standing rules, kept by Stella from what they have told her. They hold for all your work, ahead of your general instructions; only your brief can set one aside, by saying so for this task. Agents you start see them too, so leave them out of their briefs.";

/** `memories/rules.md` as a task or helper sees it, on every engine and host. */
export const standingRulesSection = (raw: string | null | undefined): string | undefined => {
  const doc = rulesDoc(raw);
  return doc && `${STANDING_RULES_LEAD}\n${doc}`;
};
