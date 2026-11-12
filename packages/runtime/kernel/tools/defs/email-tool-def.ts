export const EMAIL_TOOL_NAME = "email";

export const EMAIL_TOOL_SEARCH_TERMS = [
  "email",
  "gmail",
  "inbox",
  "mail",
  "reply",
  "draft",
  "instruction",
  "rule",
  "filter",
  "notify",
  "urgent",
  "important",
  "summary",
] as const;

export const EMAIL_TOOL_DESCRIPTOR = {
  name: EMAIL_TOOL_NAME,
  label: "Email",
  workingText: "Working on email",
  description:
    "Stella's email sorting: it sorts the user's new Gmail as it arrives (urgent mail is shown at once, the rest in short numbered summaries in the chat), and this tool acts on those emails and keeps the user's standing instructions.\n" +
    "Acting on an email from a card (\"reply to the second one\"): use the `account` and `message_id` from the card's note. 'read' returns the whole email. 'reply' sends a reply in its thread to the sender (`all`: true to reply to everyone on it) with `body` as plain text; send only when the user asked you to reply or send. 'draft' saves the same reply as a Gmail draft instead, for when they asked for a draft or you should check with them first.\n" +
    "Standing instructions: 'add' saves one the user gave in plain words: `text` (their words), `when` (which emails it is about, as a short description the sorter checks every new email against, e.g. \"An email from the landlord Priya Shah about the apartment or rent\"), and `do`: 'tell' (show that email to them right away) or 'act' (start Stella on that email with the instruction; only when it asks for an action such as replying, forwarding, filing or drafting). 'list' shows the instructions and the what-matters note. 'remove' deletes one by ruleId. 'note' replaces the what-matters note (`note`, a few plain sentences about them in the third person) when the user says what they do or don't care about in their email.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "reply", "draft", "add", "list", "remove", "note"] },
      account: { type: "string", description: "read/reply/draft: the Gmail address the email is in, from the card's note." },
      message_id: { type: "string", description: "read/reply/draft: the email's message_id from the card's note." },
      body: { type: "string", description: "reply/draft: the reply text, written as the user, without the quoted original." },
      all: { type: "boolean", description: "reply/draft: reply to everyone on the email, not just the sender." },
      text: { type: "string", description: "add: the instruction in the user's words." },
      when: { type: "string", description: "add: which emails it is about." },
      do: { type: "string", enum: ["tell", "act"], description: "add: tell (surface at once) or act (start Stella on it)." },
      ruleId: { type: "string", description: "remove: the instruction's id from list." },
      note: { type: "string", description: "note: the full new what-matters note." },
    },
    required: ["action"],
  },
} as const;

export const EMAIL_MAIL_ACTIONS = ["read", "reply", "draft"] as const;
export type EmailMailAction = (typeof EMAIL_MAIL_ACTIONS)[number];
export const isEmailMailAction = (value: unknown): value is EmailMailAction =>
  EMAIL_MAIL_ACTIONS.includes(value as EmailMailAction);

export type EmailInstructionRule = { ruleId: string; text: string; when: string; action: string };

export const formatEmailInstructions = (rules: readonly EmailInstructionRule[], note: string): string =>
  [
    rules.length > 0
      ? `Standing email instructions:\n${rules.map((rule) => `- ${rule.ruleId} (${rule.action}): "${rule.text}" — when: ${rule.when}`).join("\n")}`
      : "No standing email instructions.",
    `What-matters note: ${note.trim() || "(empty; the sorter uses its defaults)"}`,
  ].join("\n");
