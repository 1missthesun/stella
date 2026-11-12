export const EMAIL_INSTRUCTIONS_TOOL_NAME = "email_instructions";

export const EMAIL_INSTRUCTIONS_SEARCH_TERMS = [
  "email",
  "gmail",
  "inbox",
  "mail",
  "instruction",
  "rule",
  "filter",
  "notify",
  "urgent",
  "important",
  "summary",
] as const;

export const EMAIL_INSTRUCTIONS_TOOL_DESCRIPTOR = {
  name: EMAIL_INSTRUCTIONS_TOOL_NAME,
  label: "Email instructions",
  workingText: "Updating email instructions",
  description:
    "Standing instructions for Stella's email sorting, which sorts the user's new Gmail as it arrives (urgent mail is shown at once, the rest in short summaries in the chat). action 'add' saves an instruction the user gave in plain words: `text` (their words), `when` (which emails it is about, as a short description the sorter checks every new email against, e.g. \"An email from the landlord Priya Shah about the apartment or rent\"), and `do`: 'tell' (show that email to them right away) or 'act' (start Stella on that email with the instruction; only when it asks for an action such as replying, forwarding, filing or drafting). 'list' shows the instructions and the what-matters note. 'remove' deletes one by ruleId. 'note' replaces the what-matters note (`note`, a few plain sentences about them in the third person) when the user says what they do or don't care about in their email.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "list", "remove", "note"] },
      text: { type: "string", description: "add: the instruction in the user's words." },
      when: { type: "string", description: "add: which emails it is about." },
      do: { type: "string", enum: ["tell", "act"], description: "add: tell (surface at once) or act (start Stella on it)." },
      ruleId: { type: "string", description: "remove: the instruction's id from list." },
      note: { type: "string", description: "note: the full new what-matters note." },
    },
    required: ["action"],
  },
} as const;

export type EmailInstructionRule = { ruleId: string; text: string; when: string; action: string };

export const formatEmailInstructions = (rules: readonly EmailInstructionRule[], note: string): string =>
  [
    rules.length > 0
      ? `Standing email instructions:\n${rules.map((rule) => `- ${rule.ruleId} (${rule.action}): "${rule.text}" — when: ${rule.when}`).join("\n")}`
      : "No standing email instructions.",
    `What-matters note: ${note.trim() || "(empty; the sorter uses its defaults)"}`,
  ].join("\n");
