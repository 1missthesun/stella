import type { EmailFound, EmailThread } from "@stella/contracts/backend/email";

export { plainText, reflowText, senderOf, snippetPoint } from "@stella/contracts/email-brief";

const mailLine = (item: { from: string; fromAddress: string; subject: string; account: string; messageId: string; threadId: string }) =>
  `from ${item.from} <${item.fromAddress}>, subject "${item.subject}" (account ${item.account}, message_id ${item.messageId}, thread_id ${item.threadId})`;

const EMAIL_TOOL_HINT =
  "When the user's message is about this, act on these emails with the email tool (read, reply, draft) using their account and message_id. Save replies as Gmail drafts unless they clearly say to send.";

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
