import type {
  EmailBrief,
  EmailBriefBlock,
  EmailDigest,
  EmailFound,
  EmailItem,
  EmailThread,
} from "@stella/contracts/backend/email";

export { briefOf, plainText, senderOf } from "@stella/contracts/email-brief";
import { plainText, senderOf } from "@stella/contracts/email-brief";

const mailLine = (item: { from: string; fromAddress: string; subject: string; account: string; messageId: string; threadId: string }) =>
  `from ${item.from} <${item.fromAddress}>, subject "${item.subject}" (account ${item.account}, message_id ${item.messageId}, thread_id ${item.threadId})`;

const itemLine = (item: EmailItem) =>
  mailLine({ from: senderOf(item.from), fromAddress: item.fromAddress, subject: item.subject, account: item.account, messageId: item.messageId, threadId: item.threadId });

const EMAIL_TOOL_HINT =
  "When the user's message is about this, act on these emails with the email tool (read, reply, draft) using their account and message_id. Save replies as Gmail drafts unless they clearly say to send.";

/** What Stella reads with the next message while a briefing is on screen. */
export const briefingSnapshot = (digest: EmailDigest, brief: EmailBrief, when: string): string => {
  const byId = new Map(digest.items.map((item) => [item.itemId, item]));
  const lines = [
    `The user has their email briefing from ${when} open in Stella's Email tab. It reads:`,
    plainText(brief.lead),
  ];
  for (const section of brief.sections) {
    lines.push(`${section.heading}:`);
    for (const block of section.blocks) {
      lines.push(`- ${plainText(block.title)}${block.points.length ? `: ${block.points.map(plainText).join(" ")}` : ""}`);
      for (const id of block.itemIds) {
        const item = byId.get(id);
        if (item) lines.push(`  email ${itemLine(item)}`);
      }
    }
  }
  lines.push(EMAIL_TOOL_HINT);
  return lines.join("\n");
};

/** What Stella reads with the next message while one point of a briefing is selected. */
export const blockSnapshot = (digest: EmailDigest, block: EmailBriefBlock): string => {
  const byId = new Map(digest.items.map((item) => [item.itemId, item]));
  return [
    `The user selected this point of their email briefing in Stella's Email tab: ${plainText(block.title)}${
      block.points.length ? `: ${block.points.map(plainText).join(" ")}` : ""
    }`,
    "The emails it covers:",
    ...block.itemIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [`- ${itemLine(item)}`] : [];
    }),
    EMAIL_TOOL_HINT,
  ].join("\n");
};

export const foundSnapshot = (mail: EmailFound): string =>
  [
    `The user selected this email in Stella's Email tab: ${mailLine(mail)}. Gmail's preview: ${mail.snippet}`,
    EMAIL_TOOL_HINT,
  ].join("\n");

export const threadSnapshot = (thread: EmailThread): string => {
  const last = thread.messages[thread.messages.length - 1];
  return [
    `The user is reading this email thread in Stella's Email tab: "${thread.subject}" (account ${thread.account}, thread_id ${thread.threadId}, ${thread.messages.length} messages).`,
    ...(last ? [`The newest message: from ${last.from} <${last.fromAddress}>, message_id ${last.messageId}. It begins: ${last.text.slice(0, 600)}`] : []),
    EMAIL_TOOL_HINT,
  ].join("\n");
};
