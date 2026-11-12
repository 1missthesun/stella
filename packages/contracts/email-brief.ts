import type { EmailBrief, EmailBriefBlock, EmailDigest, EmailItem } from "./backend/email.js";

/** Plain text of the briefing's light markdown, for labels and Stella's context. */
export const plainText = (markdown: string): string => markdown.replace(/\*\*|__/gu, "").replace(/(^|\s)\*(\S[^*]*)\*/gu, "$1$2");

export const senderOf = (from: string): string =>
  from.replace(/\s*<[^>]*>\s*$/u, "").replace(/^"|"$/gu, "") || from;

const TONE_RANK = { urgent: 0, needs_you: 1, fyi: 2 } as const;

/** Two sections under one heading read as a mistake: fold them, keeping the stronger tone (older briefings can have this). */
const foldHeadings = (brief: EmailBrief): EmailBrief => {
  const sections: EmailBrief["sections"] = [];
  for (const section of brief.sections) {
    const same = sections.find((entry) => entry.heading.toLowerCase() === section.heading.toLowerCase());
    if (!same) sections.push({ ...section, blocks: [...section.blocks] });
    else {
      same.blocks.push(...section.blocks);
      if (TONE_RANK[section.tone] < TONE_RANK[same.tone]) same.tone = section.tone;
    }
  }
  return sections.length === brief.sections.length ? brief : { ...brief, sections };
};

/**
 * The briefing a digest shows. Summaries carry one the model wrote; urgent
 * and instruction rows, and older summaries, are laid out from their items.
 */
/** Same on desktop and phone. */
export const briefOf = (digest: EmailDigest, words: { needsYou: string; worthKnowing: string; urgent: string; lead: string }): EmailBrief => {
  if (digest.brief) return foldHeadings(digest.brief);
  const block = (item: EmailItem): EmailBriefBlock => ({
    itemIds: [item.itemId],
    title: `**${senderOf(item.from)}** · ${item.subject}`,
    points: item.line ? [item.line] : [],
  });
  const urgent = digest.items.filter((item) => item.bucket === "urgent");
  const needs = digest.items.filter((item) => item.bucket === "needs_you");
  const rest = digest.items.filter((item) => item.bucket !== "urgent" && item.bucket !== "needs_you");
  const first = digest.items[0];
  const lead =
    digest.kind !== "summary" && first
      ? `**${senderOf(first.from)}**: ${first.line ?? first.subject}`
      : words.lead;
  return {
    lead,
    sections: [
      ...(urgent.length ? [{ heading: words.urgent, tone: "urgent" as const, blocks: urgent.map(block) }] : []),
      ...(needs.length ? [{ heading: words.needsYou, tone: "needs_you" as const, blocks: needs.map(block) }] : []),
      ...(rest.length ? [{ heading: words.worthKnowing, tone: "fyi" as const, blocks: rest.map(block) }] : []),
    ],
  };
};

