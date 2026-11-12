import type { EmailBrief, EmailBriefBlock, EmailDigest, EmailItem } from "./backend/email.js";

/** Plain text of the briefing's light markdown, for labels and Stella's context. */
export const plainText = (markdown: string): string => markdown.replace(/\*\*|__/gu, "").replace(/(^|\s)\*(\S[^*]*)\*/gu, "$1$2");

export const senderOf = (from: string): string =>
  from.replace(/\s*<[^>]*>\s*$/u, "").replace(/^"|"$/gu, "") || from;

const TONE_RANK = { urgent: 0, needs_you: 1, fyi: 2 } as const;

/**
 * Two sections under one heading read as a mistake: fold them, keeping the
 * stronger tone (older briefings can have this). Then the most pressing first:
 * urgent, then needs you, then the rest, each keeping the writer's order.
 */
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
  sections.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
  return { ...brief, sections };
};

/**
 * The briefing a digest shows. Summaries carry one the model wrote; urgent
 * and instruction rows, and older summaries, are laid out from their items.
 */
/** Same on desktop and phone. */
export const briefOf = (digest: EmailDigest, words: { needsYou: string; worthKnowing: string; urgent: string; lead: string }): EmailBrief => {
  if (digest.brief) return foldHeadings(digest.brief);
  // An urgent or asked-about email leads with its line, so its point doesn't repeat it.
  const single = digest.kind !== "summary" && digest.items.length === 1;
  const block = (item: EmailItem): EmailBriefBlock => ({
    itemIds: [item.itemId],
    title: `**${senderOf(item.from)}** · ${item.subject}`,
    points: item.line && !single ? [item.line] : [],
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


/** A search result's Gmail preview as one short point: about two lines, cut at a word. */
export const snippetPoint = (snippet: string, max = 140): string => {
  // Marketing mail pads previews with invisible joiners and soft hyphens; drop them before measuring.
  const text = snippet.replace(/[\u034F\u00AD\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/gu, "").replace(/\s+/gu, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/u, "")}…`;
};

const LIST_OR_QUOTE = /^\s*(?:[-*•>]|\d+[.)])\s/u;

/**
 * Plain-text mail is often hard-wrapped near 70–80 columns, which reads as
 * ragged lines on a narrow screen: join wrapped lines back into paragraphs,
 * leaving blank lines, short lines (greetings, sign-offs), lists and quotes.
 */
export const reflowText = (text: string): string =>
  text
    .split(/\n[ \t]*\n/u)
    .map((paragraph) => {
      const lines = paragraph.split("\n");
      let out = lines[0] ?? "";
      for (let index = 1; index < lines.length; index += 1) {
        const previous = lines[index - 1]!;
        const line = lines[index]!;
        const wrapped = previous.trimEnd().length >= 45 && line.trim() !== "" && !LIST_OR_QUOTE.test(line) && !LIST_OR_QUOTE.test(previous);
        out += wrapped ? ` ${line.trimStart()}` : `\n${line}`;
      }
      return out;
    })
    .join("\n\n");

// Today --------------------------------------------------------------------------

export type LaterChoiceId = "suggested" | "tonight" | "tomorrow" | "weekend" | "nextWeek";
export type LaterChoice = { id: LaterChoiceId; at: number };

/**
 * The times Later offers, in the device's own time: Stella's suggestion for
 * this item first (when it is still ahead), then this evening, tomorrow
 * morning, the weekend and next week. Same on desktop and phone.
 */
export const laterChoices = (now: number, suggestion?: { at: number }): LaterChoice[] => {
  const base = new Date(now);
  const at = (days: number, hour: number): number => {
    const day = new Date(base);
    day.setDate(day.getDate() + days);
    day.setHours(hour, 0, 0, 0);
    return day.getTime();
  };
  const weekday = base.getDay();
  const out: LaterChoice[] = [];
  if (suggestion && suggestion.at > now + 15 * 60_000) out.push({ id: "suggested", at: suggestion.at });
  if (base.getHours() < 17) out.push({ id: "tonight", at: at(0, 18) });
  out.push({ id: "tomorrow", at: at(1, 9) });
  if (weekday >= 1 && weekday <= 4) out.push({ id: "weekend", at: at(6 - weekday, 9) });
  out.push({ id: "nextWeek", at: at((8 - weekday) % 7 || 7, 9) });
  return out.filter((choice, index) => index === 0 || !out.slice(0, index).some((other) => Math.abs(other.at - choice.at) < 45 * 60_000));
};

/** A time ahead (or just past), short: "18:00", "Fri 09:00", "24 Nov 09:00", in the locale's own form. */
export const whenLabel = (locale: string, at: number, now: number): string => {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  const near = Math.abs(at - now) < 6 * 86_400_000;
  return new Intl.DateTimeFormat(locale, {
    ...(sameDay ? {} : near ? { weekday: "short" } : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
};

/** Today's open items in the order they show: urgent, needs you, worth knowing. */
export const TODAY_TONES = ["urgent", "needs_you", "fyi"] as const;
